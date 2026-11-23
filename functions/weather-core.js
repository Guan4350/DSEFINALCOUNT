'use strict';

/**
 * Pure HKO weather cache logic.
 *
 * It is shared by:
 *   - functions/weather.js (optional Cloud Functions / Blaze path)
 *   - scripts/weather-sync/sync.js (GitHub Actions / Spark path)
 *
 * The browser never imports this file and never requests HKO directly.
 */

const QUOTES = require('./weatherQuotes.json');

const WEATHER_URL =
  'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';
const WEATHER_DOC_PATH = 'weather/current';
const WEATHER_SOURCE = 'hko-rhrread';
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 3;
const RETRY_BASE_MS = 700;

/**
 * Official HKO weather-icon captions (Chinese) mapped to the quote groups.
 * Reference: https://www.weather.gov.hk/textonly/v2/explain/wxicon_c.htm
 */
const ICON_MAP = {
  50: { text: '陽光充沛', category: 'sunny' },
  51: { text: '間有陽光', category: 'sunny' },
  52: { text: '短暫陽光', category: 'sunny' },
  53: { text: '間有陽光幾陣驟雨', category: 'heavyRain' },
  54: { text: '短暫陽光有驟雨', category: 'heavyRain' },
  60: { text: '多雲', category: 'cloudy' },
  61: { text: '密雲', category: 'overcast' },
  62: { text: '微雨', category: 'lightRain' },
  63: { text: '雨', category: 'lightRain' },
  64: { text: '大雨', category: 'heavyRain' },
  65: { text: '雷暴', category: 'thunder' },
  70: { text: '天色良好', category: 'sunny' },
  71: { text: '天色良好', category: 'sunny' },
  72: { text: '天色良好', category: 'sunny' },
  73: { text: '天色良好', category: 'sunny' },
  74: { text: '天色良好', category: 'sunny' },
  75: { text: '天色良好', category: 'sunny' },
  76: { text: '大致多雲', category: 'cloudy' },
  77: { text: '天色大致良好', category: 'sunny' },
  80: { text: '大風', category: 'windy' },
  81: { text: '乾燥', category: 'cloudy' },
  82: { text: '潮濕', category: 'cloudy' },
  83: { text: '霧', category: 'fog' },
  84: { text: '薄霧', category: 'fog' },
  85: { text: '煙霞', category: 'fog' },
  90: { text: '熱', category: 'hot' },
  91: { text: '暖', category: 'sunny' },
  92: { text: '涼', category: 'cloudy' },
  93: { text: '冷', category: 'cold' },
};

const FALLBACK_ICON = { text: '天氣報告', category: 'cloudy' };
const WEATHER_CATEGORIES = Object.keys(QUOTES);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function iconMeta(code) {
  return ICON_MAP[Number(code)] || FALLBACK_ICON;
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickReading(list, preferred = '香港天文台') {
  if (!Array.isArray(list) || list.length === 0) return null;
  return (
    list.find((item) => item && item.place === preferred)
    || list.find((item) => item && item.place === '京士柏')
    || list[0]
  );
}

function normalizeUnit(value, fallback) {
  return String(value || fallback || '').trim() || fallback;
}

function normalizeWeather(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('HKO response is not a JSON object');
  }

  const temperatureReading = pickReading(raw.temperature && raw.temperature.data);
  const humidityReading = pickReading(raw.humidity && raw.humidity.data);
  const temperature = asFiniteNumber(temperatureReading && temperatureReading.value);
  const humidity = asFiniteNumber(humidityReading && humidityReading.value);

  if (temperature === null) throw new Error('HKO response has no usable temperature');
  if (humidity === null) throw new Error('HKO response has no usable humidity');

  const rawIcon = Array.isArray(raw.icon) ? raw.icon[0] : raw.icon;
  const iconCode = asFiniteNumber(rawIcon);
  const icon = iconMeta(iconCode);
  let category = icon.category;

  // The icon describes the sky, while the quote groups also include
  // temperature bands. Keep thunder/rain as the stronger signal.
  if (temperature <= 12) category = 'cold';
  else if (temperature >= 33 && !['thunder', 'heavyRain', 'lightRain'].includes(category)) {
    category = 'hot';
  }

  const weatherUpdateTime = String(raw.updateTime || '').trim() || new Date().toISOString();
  const officialText = String(raw.weather || '').trim();

  return {
    // rhrread currently exposes the icon code only; use the official HKO
    // caption unless a future response includes a weather text field.
    condition: officialText || icon.text,
    conditionCode: iconCode === null ? 0 : Math.round(iconCode),
    category,
    temperature: Math.round(temperature * 10) / 10,
    temperatureUnit: normalizeUnit(temperatureReading.unit, 'C'),
    temperaturePlace: String(temperatureReading.place || '香港天文台'),
    humidity: Math.round(humidity),
    humidityUnit: normalizeUnit(humidityReading.unit, 'percent'),
    humidityPlace: String(humidityReading.place || '香港天文台'),
    weatherUpdateTime,
    iconUpdateTime: String(raw.iconUpdateTime || '').trim() || undefined,
    source: WEATHER_SOURCE,
    lang: 'tc',
  };
}

async function fetchWithTimeout(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DSEFinalCountWeather/1.0 (+https://guan4350.github.io/DSEFINALCOUNT/)',
      },
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('HKO request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and normalize one HKO rhrread snapshot. Retries transient failures.
 * A caller catches the final error and leaves the previous Firestore cache
 * untouched except for lastAttemptAt/lastError/stale.
 */
async function fetchWeatherSnapshot(options = {}) {
  const url = options.url || WEATHER_URL;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const retries = Number.isInteger(options.retries) ? options.retries : FETCH_RETRIES;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      if (!response.ok) throw new Error(`HKO HTTP ${response.status}`);
      const raw = await response.json();
      return normalizeWeather(raw);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw new Error(
    `HKO weather fetch failed after ${retries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function pickQuote(category, previousText) {
  const pool = QUOTES[category] || QUOTES.cloudy || [];
  if (pool.length === 0) return { text: '', source: '' };
  const available =
    previousText && pool.length > 1
      ? pool.filter((quote) => quote.text !== previousText)
      : pool;
  const quote = available[Math.floor(Math.random() * available.length)] || pool[0];
  return { text: quote.text, source: quote.source };
}

function buildWeatherDoc(weather, quote) {
  const now = new Date().toISOString();
  return {
    condition: weather.condition,
    conditionCode: weather.conditionCode,
    category: weather.category,
    temperature: weather.temperature,
    temperatureUnit: weather.temperatureUnit,
    temperaturePlace: weather.temperaturePlace,
    humidity: weather.humidity,
    humidityUnit: weather.humidityUnit,
    humidityPlace: weather.humidityPlace,
    quoteText: quote.text,
    quoteSource: quote.source,
    weatherUpdateTime: weather.weatherUpdateTime,
    iconUpdateTime: weather.iconUpdateTime || '',
    fetchedAt: now,
    lastAttemptAt: now,
    lastError: '',
    stale: false,
    source: WEATHER_SOURCE,
    lang: 'tc',
  };
}

function buildFailurePatch(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    lastAttemptAt: new Date().toISOString(),
    lastError: message.slice(0, 500),
    stale: true,
    source: WEATHER_SOURCE,
  };
}

module.exports = {
  WEATHER_URL,
  WEATHER_DOC_PATH,
  WEATHER_SOURCE,
  WEATHER_CATEGORIES,
  ICON_MAP,
  normalizeWeather,
  fetchWeatherSnapshot,
  pickQuote,
  buildWeatherDoc,
  buildFailurePatch,
  iconMeta,
};

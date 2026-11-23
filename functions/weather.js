'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/logger');
const admin = require('firebase-admin');
const {
  WEATHER_DOC_PATH,
  fetchWeatherSnapshot,
  pickQuote,
  buildWeatherDoc,
  buildFailurePatch,
} = require('./weather-core');

const REGION = 'asia-east1';

async function refreshWeather() {
  const ref = admin.firestore().doc(WEATHER_DOC_PATH);
  const previous = await ref.get();
  const previousData = previous.exists ? previous.data() : undefined;

  try {
    const weather = await fetchWeatherSnapshot();
    const quote = pickQuote(
      weather.category,
      previousData && previousData.category === weather.category
        ? previousData.quoteText
        : undefined,
    );
    await ref.set(buildWeatherDoc(weather, quote));
    logger.info('[weather-sync] ok', {
      condition: weather.condition,
      temperature: weather.temperature,
      humidity: weather.humidity,
      category: weather.category,
      quoteSource: quote.source,
    });
  } catch (error) {
    const patch = buildFailurePatch(error);
    await ref.set(patch, { merge: true }).catch((writeError) => {
      logger.error('[weather-sync] failed to persist error state', {
        error: String(writeError),
      });
    });
    logger.error('[weather-sync] failed; previous cache retained', {
      error: patch.lastError,
      hadPreviousCache: Boolean(previousData && previousData.fetchedAt),
    });
  }
}

exports.syncWeather = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'Asia/Hong_Kong',
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    await refreshWeather();
  },
);

exports.refreshWeather = refreshWeather;

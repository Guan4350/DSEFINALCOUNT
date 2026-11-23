import { useEffect, useMemo, useState } from 'react';
import type { WeatherCategory, WeatherSnapshot } from '../types';
import { useApp } from '../contexts/AppContext';
import { watchWeatherSnapshot } from '../lib/cloud';
import { firebaseConfigured } from '../lib/firebase';
import { Icon } from './Icons';

const STALE_AFTER_MS = 90 * 60 * 1000;

function formatReading(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function temperatureUnit(unit: string): string {
  return unit === 'C' ? '°C' : unit;
}

function humidityUnit(unit: string): string {
  return unit === 'percent' ? '%' : unit;
}

function formatUpdated(snapshot: WeatherSnapshot): string {
  const raw = snapshot.weatherUpdateTime || snapshot.fetchedAt;
  if (!raw) return '時間未明';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('zh-HK', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WeatherGlyph({ category }: { category: WeatherCategory }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const cloud = (
    <path
      d="M18 43h27a8 8 0 0 0 0-16 12 12 0 0 0-23-3 8 8 0 0 0-4 19Z"
      {...common}
    />
  );

  return (
    <svg className="weather-glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {category === 'sunny' && (
        <>
          <circle cx="32" cy="32" r="10" {...common} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1="32"
              y1="13"
              x2="32"
              y2="7"
              {...common}
              transform={`rotate(${angle} 32 32)`}
            />
          ))}
        </>
      )}
      {category === 'cloudy' && (
        <>
          {cloud}
          <path d="M17 23a8 8 0 0 1 15-3" {...common} opacity=".55" />
        </>
      )}
      {category === 'overcast' && (
        <>
          {cloud}
          <path d="M24 50h24a7 7 0 0 0 0-14" {...common} opacity=".45" />
        </>
      )}
      {(category === 'lightRain' || category === 'heavyRain' || category === 'thunder') && (
        <>
          {cloud}
          {category === 'thunder' ? (
            <path d="M31 46l-5 9h6l-2 7 9-11h-5l3-5" {...common} />
          ) : (
            <>
              <line x1="25" y1="49" x2="22" y2="56" {...common} />
              <line x1="34" y1="49" x2="31" y2="56" {...common} />
              <line x1="43" y1="49" x2="40" y2="56" {...common} />
              {category === 'heavyRain' && (
                <>
                  <line x1="29" y1="53" x2="26" y2="59" {...common} opacity=".65" />
                  <line x1="38" y1="53" x2="35" y2="59" {...common} opacity=".65" />
                </>
              )}
            </>
          )}
        </>
      )}
      {category === 'windy' && (
        <>
          <path d="M12 27h27a6 6 0 1 0-6-6" {...common} />
          <path d="M12 36h38a6 6 0 1 1-6 6" {...common} />
          <path d="M17 45h13" {...common} opacity=".55" />
        </>
      )}
      {category === 'fog' && (
        <>
          <path d="M18 27a9 9 0 0 1 17-4" {...common} />
          <line x1="12" y1="36" x2="52" y2="36" {...common} />
          <line x1="16" y1="43" x2="48" y2="43" {...common} opacity=".7" />
          <line x1="22" y1="50" x2="42" y2="50" {...common} opacity=".45" />
        </>
      )}
      {category === 'cold' && (
        <>
          <line x1="32" y1="10" x2="32" y2="54" {...common} />
          <line x1="13" y1="21" x2="51" y2="43" {...common} />
          <line x1="51" y1="21" x2="13" y2="43" {...common} />
          <path d="M26 14l6 5 6-5M26 50l6-5 6 5M15 28l7 1 2-7M49 36l-7-1-2 7" {...common} />
        </>
      )}
      {category === 'hot' && (
        <>
          <circle cx="32" cy="26" r="9" {...common} />
          <path d="M17 46c5-4 9 4 14 0s9 4 14 0" {...common} />
          <path d="M17 53c5-4 9 4 14 0s9 4 14 0" {...common} opacity=".55" />
        </>
      )}
    </svg>
  );
}

interface WeatherCardProps {
  className?: string;
}

/**
 * Standalone, embeddable HKO card. It reads only the Firestore cache; no
 * browser request is ever made to data.weather.gov.hk.
 */
export function WeatherCard({ className = '' }: WeatherCardProps) {
  const { user } = useApp();
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');

  useEffect(() => {
    if (!firebaseConfigured || !user) {
      setSnapshot(null);
      setLoading(false);
      setReadError('');
      return undefined;
    }
    let active = true;
    setLoading(true);
    const unsubscribe = watchWeatherSnapshot(
      (next) => {
        if (!active) return;
        setSnapshot(next);
        setLoading(false);
        setReadError('');
      },
      () => {
        if (!active) return;
        setLoading(false);
        setReadError('天氣資料更新中');
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  const stale = useMemo(() => {
    if (!snapshot) return true;
    if (snapshot.stale) return true;
    if (readError) return true;
    const fetched = Date.parse(snapshot.fetchedAt);
    return !Number.isFinite(fetched) || Date.now() - fetched > STALE_AFTER_MS;
  }, [readError, snapshot]);

  if (loading && !snapshot) {
    return (
      <section className={`card weather-card weather-card-placeholder ${className}`.trim()} aria-busy="true">
        <div className="weather-head">
          <div>
            <div className="eyebrow">Hong Kong Observatory</div>
            <div className="weather-condition">天氣資料更新中</div>
          </div>
          <span className="weather-glyph weather-glyph-muted"><Icon name="cloud" size={38} /></span>
        </div>
        <p className="weather-placeholder-copy">正在讀取天文台快取。</p>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className={`card weather-card weather-card-placeholder ${className}`.trim()}>
        <div className="weather-head">
          <div>
            <div className="eyebrow">Hong Kong Observatory</div>
            <div className="weather-condition">天氣資料更新中</div>
          </div>
          <span className="weather-glyph weather-glyph-muted"><Icon name="cloud" size={38} /></span>
        </div>
        <p className="weather-placeholder-copy">
          {!firebaseConfigured
            ? '尚未連接 Firebase 天氣快取。'
            : !user
              ? '登入後顯示香港天文台即時天氣。'
              : '背景同步尚未寫入快取，稍後會自動更新。'}
        </p>
      </section>
    );
  }

  const category = snapshot.category;
  return (
    <section className={`card weather-card${stale ? ' is-stale' : ''} ${className}`.trim()} aria-label="香港天文台天氣">
      <div className="weather-head">
        <div className="weather-heading">
          <div className="eyebrow">Hong Kong Observatory / live cache</div>
          <div className="weather-condition">{snapshot.condition}</div>
          <div className="weather-place">
            {snapshot.temperaturePlace}
            {snapshot.conditionCode > 0 ? <span className="weather-code"> · {snapshot.conditionCode}</span> : null}
          </div>
        </div>
        <div className="weather-glyph-wrap">
          <WeatherGlyph category={category} />
        </div>
      </div>

      <div className="weather-readings">
        <div className="weather-reading">
          <span className="weather-reading-value">
            {formatReading(snapshot.temperature)}
            <small>{temperatureUnit(snapshot.temperatureUnit)}</small>
          </span>
          <span className="weather-reading-label">氣溫</span>
        </div>
        <div className="weather-reading">
          <span className="weather-reading-value">
            {snapshot.humidity}
            <small>{humidityUnit(snapshot.humidityUnit)}</small>
          </span>
          <span className="weather-reading-label">相對濕度</span>
        </div>
      </div>

      {snapshot.quoteText ? (
        <blockquote className="weather-quote">
          <p>「{snapshot.quoteText}」</p>
          <footer>— {snapshot.quoteSource || '佚名'}</footer>
        </blockquote>
      ) : null}

      <div className="weather-foot">
        <span>天文台更新 {formatUpdated(snapshot)}</span>
        {stale ? <span className="weather-stale">天氣資料更新中</span> : <span className="weather-live">已同步</span>}
      </div>
    </section>
  );
}

'use strict';

/**
 * GitHub Actions weather cache refresher (Spark-compatible path).
 *
 * HKO is fetched only here / in the optional Cloud Function. The browser only
 * reads Firestore weather/current. A failed refresh leaves the previous
 * weather and quote untouched.
 */

const admin = require('firebase-admin');
const {
  WEATHER_DOC_PATH,
  fetchWeatherSnapshot,
  pickQuote,
  buildWeatherDoc,
  buildFailurePatch,
} = require('../../functions/weather-core');

function parseCredentials(raw) {
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set; add the service-account JSON as a GitHub Actions secret.');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  }
}

async function main() {
  const credentials = parseCredentials(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(credentials) });
  const db = admin.firestore();
  const ref = db.doc(WEATHER_DOC_PATH);
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
    console.log('[weather-sync] ok', JSON.stringify({
      condition: weather.condition,
      temperature: weather.temperature,
      humidity: weather.humidity,
      category: weather.category,
      quoteSource: quote.source,
      hadPreviousCache: Boolean(previousData && previousData.fetchedAt),
    }));
  } catch (error) {
    const patch = buildFailurePatch(error);
    await ref.set(patch, { merge: true }).catch((writeError) => {
      console.error('[weather-sync] failed to persist error state', String(writeError));
    });
    console.error('[weather-sync] failed; previous cache retained', patch.lastError);
    // The cache is intentionally preserved. A red run makes the outage visible
    // in Actions without affecting the UI.
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[weather-sync] fatal', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

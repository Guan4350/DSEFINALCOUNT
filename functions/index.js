'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/logger');
const admin = require('firebase-admin');
const ICAL = require('ical.js');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const REGION = 'asia-east1';
const MAX_USERS_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_GAP_MS = 350;
const DEFAULT_SUBJECTS = {
  chi: 'sub-chi',
  eng: 'sub-eng',
  math: 'sub-math',
  csd: 'sub-csd',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashKey(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function cleanRawIcal(input) {
  return String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

function safeAutoUrl(raw) {
  const value = String(raw || '').trim().replace(/^webcal:\/\//i, 'https://');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid iCal URL');
  }
  if (url.protocol !== 'https:') throw new Error('only https iCal URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.local')
    || host === '0.0.0.0'
    || host === '::1'
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('private/local iCal URLs are not allowed');
  }
  url.hash = '';
  return url.toString();
}

async function fetchIcal(url) {
  let current = url;
  let status = 0;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar,text/plain,*/*',
          'User-Agent': 'DSEFinalCountCalendarSync/1.0 (+https://guan4350.github.io/DSEFINALCOUNT/)',
        },
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('iCal fetch timeout');
      throw new Error(`iCal fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    status = response.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`iCal redirect ${status} without location`);
      current = safeAutoUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`iCal HTTP ${status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) throw new Error('iCal response too large');
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('iCal response too large');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('response is not a valid iCalendar feed');
    return { text: cleanRawIcal(text), httpStatus: status };
  }
  throw new Error('too many iCal redirects');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function hkLocal(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function dateOnly(time) {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

function deriveType(summary, categories) {
  const haystack = `${summary} ${categories}`.toUpperCase();
  if (haystack.includes('SBA')) return 'sba';
  if (haystack.includes('MOCK')) return 'mock';
  if (haystack.includes('DSE')) return 'dse';
  if (haystack.includes('EXAM') || haystack.includes('考試') || haystack.includes('期考')) return 'school';
  if (haystack.includes('STUDY') || haystack.includes('溫習') || haystack.includes('REVISION')) return 'study';
  return 'custom';
}

function mapSubject(summary) {
  const text = summary.toUpperCase();
  if (text.includes('中文') || text.includes('CHINESE')) return DEFAULT_SUBJECTS.chi;
  if (text.includes('英文') || text.includes('ENGLISH')) return DEFAULT_SUBJECTS.eng;
  if (text.includes('數學') || text.includes('MATH')) return DEFAULT_SUBJECTS.math;
  if (text.includes('公民') || text.includes('CSD')) return DEFAULT_SUBJECTS.csd;
  return '';
}

function parseFeed(text, uid) {
  const jcal = ICAL.parse(text);
  const root = new ICAL.Component(jcal);
  const calendars = root.name === 'vcalendar' ? [root] : root.getAllSubcomponents('vcalendar');
  const events = [];
  const warnings = [];
  for (const calendar of calendars.length ? calendars : [root]) {
    for (const component of calendar.getAllSubcomponents('vevent')) {
      try {
        const event = new ICAL.Event(component);
        if (String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') {
          continue;
        }
        if (!event.startDate) {
          warnings.push('VEVENT without DTSTART');
          continue;
        }
        const allDay = Boolean(event.startDate.isDate);
        const summary = event.summary || '未命名 iCal 事件';
        const categories = String(component.getFirstPropertyValue('categories') || '');
        const rruleValue = component.getFirstProperty('rrule')?.getFirstValue();
        const rrule = rruleValue ? String(rruleValue) : '';
        const start = allDay ? dateOnly(event.startDate) : hkLocal(event.startDate.toJSDate());
        const end = event.endDate
          ? allDay ? dateOnly(event.endDate) : hkLocal(event.endDate.toJSDate())
          : undefined;
        const externalId = event.uid || `${summary}-${start}`;
        events.push({
          id: `ical-${hashKey(externalId)}`,
          uid,
          title: summary.slice(0, 180),
          start,
          end,
          allDay,
          type: deriveType(summary, categories),
          subjectId: mapSubject(summary),
          paper: '',
          description: (event.description || '').slice(0, 4000),
          location: String(component.getFirstPropertyValue('location') || '').slice(0, 200),
          rrule: rrule.slice(0, 1000),
          source: 'ics',
          externalId,
          etag: '',
          deleted: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        warnings.push(`skip malformed VEVENT: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { events, warnings };
}

function comparable(event) {
  return [
    event.title,
    event.start,
    event.end || '',
    Boolean(event.allDay),
    event.type,
    event.description || '',
    event.location || '',
    event.rrule || '',
    event.externalId || '',
  ].join('\u0001');
}

async function existingIcsEvents(uid) {
  const snap = await db.collection('userCalendarEvents').where('uid', '==', uid).limit(1000).get();
  return snap.docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .filter((item) => item.data.source === 'ics');
}

async function commitBatch(ops) {
  for (let index = 0; index < ops.length; index += 400) {
    const batch = db.batch();
    for (const op of ops.slice(index, index + 400)) {
      if (op.type === 'set') batch.set(op.ref, op.data, { merge: false });
      else batch.delete(op.ref);
    }
    await batch.commit();
  }
}

async function syncUser(configDoc, runId) {
  const uid = configDoc.id;
  const started = Date.now();
  const config = configDoc.data();
  const url = safeAutoUrl(config.icalAutoUrl);
  const { text, httpStatus } = await fetchIcal(url);
  const { events, warnings } = parseFeed(text, uid);
  const existing = await existingIcsEvents(uid);
  const existingByExternal = new Map(existing.map((item) => [String(item.data.externalId || ''), item]));
  const seen = new Set();
  const ops = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    seen.add(event.externalId);
    const previous = existingByExternal.get(event.externalId);
    const payload = {
      ...event,
      subjectId: event.subjectId || previous?.data.subjectId || '',
      paper: previous?.data.paper || '',
    };
    const ref = db.collection('userCalendarEvents').doc(`${uid}__${event.id}`);
    if (!previous) {
      ops.push({ type: 'set', ref, data: payload });
      added += 1;
    } else if (comparable(previous.data) !== comparable(payload)) {
      ops.push({ type: 'set', ref, data: payload });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  let removed = 0;
  for (const item of existing) {
    if (!seen.has(String(item.data.externalId || ''))) {
      ops.push({ type: 'delete', ref: item.ref });
      removed += 1;
    }
  }

  await commitBatch(ops);
  await configDoc.ref.update({
    icalLastSyncAt: new Date().toISOString(),
    icalLastStatus: 'ok',
    icalLastError: warnings[0] ? warnings[0].slice(0, 500) : '',
    icalLastEventCount: events.length,
    icalLastHttpStatus: httpStatus,
    icalLastDurationMs: Date.now() - started,
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('[ical-sync] ok', {
    runId,
    uid,
    httpStatus,
    events: events.length,
    added,
    updated,
    removed,
    skipped,
    warnings: warnings.slice(0, 3),
    durationMs: Date.now() - started,
  });
}

async function markError(configDoc, runId, error) {
  const uid = configDoc.id;
  const message = error instanceof Error ? error.message : String(error);
  logger.error('[ical-sync] failed', { runId, uid, error: message });
  await configDoc.ref.update({
    icalLastSyncAt: new Date().toISOString(),
    icalLastStatus: 'error',
    icalLastError: message.slice(0, 500),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch((writeError) => {
    logger.error('[ical-sync] failed to write error status', { runId, uid, error: String(writeError) });
  });
}

exports.syncIcal = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Hong_Kong',
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const runId = `ical-${Date.now()}`;
    const started = Date.now();
    logger.info('[ical-sync] start', { runId, maxUsers: MAX_USERS_PER_RUN });
    try {
      const snapshot = await db
        .collection('calendarSyncConfig')
        .where('icalAutoEnabled', '==', true)
        .limit(100)
        .get();
      const configDocs = snapshot.docs
        .slice()
        .sort((a, b) => String(a.data().icalLastSyncAt || '').localeCompare(String(b.data().icalLastSyncAt || '')))
        .slice(0, MAX_USERS_PER_RUN);
      logger.info('[ical-sync] users', { runId, enabled: snapshot.size, selected: configDocs.length });
      if (snapshot.size > MAX_USERS_PER_RUN) {
        logger.warn('[ical-sync] user cap reached; oldest-synced users are selected first', {
          runId,
          cap: MAX_USERS_PER_RUN,
          enabled: snapshot.size,
        });
      }
      if (configDocs.length === 0) {
        logger.info('[ical-sync] no users enabled');
        return;
      }
      for (const configDoc of configDocs) {
        const config = configDoc.data();
        if (!config.icalAutoUrl) {
          logger.warn('[ical-sync] enabled without URL', { runId, uid: configDoc.id });
          continue;
        }
        try {
          await syncUser(configDoc, runId);
        } catch (error) {
          await markError(configDoc, runId, error);
        }
        await sleep(USER_GAP_MS);
      }
      logger.info('[ical-sync] done', { runId, users: configDocs.length, durationMs: Date.now() - started });
    } catch (error) {
      logger.error('[ical-sync] fatal scheduler error', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);


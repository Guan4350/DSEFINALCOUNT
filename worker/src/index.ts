import { Hono } from 'hono';
import type { Env, FirebaseUser, SyncSummary } from './types';
import { verifyFirebaseRequest } from './auth';
import { Firestore, fromFields, getBool, getNumber, getString } from './firestore';
import {
  createCalDavConnection,
  createGoogleConnection,
  deleteRemoteEventById,
  disconnectUser,
  listDueConnections,
  syncUser,
} from './sync';
import { buildGoogleAuthUrl, exchangeGoogleCode } from './google';
import { verifyState } from './crypto';

const app = new Hono<{ Bindings: Env }>();

function allowedOrigins(env: Env): string[] {
  return (env.APP_ORIGIN || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const allowed = allowedOrigins(c.env);
  if (origin && allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Max-Age', '86400');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/health', (c) => c.json({ ok: true, service: 'dse-calendar-bridge', time: new Date().toISOString() }));

async function requireUser(c: { req: { raw: Request }; env: Env }): Promise<FirebaseUser> {
  return verifyFirebaseRequest(c.req.raw, c.env);
}

async function readJson<T>(c: { req: { json: () => Promise<unknown>; header: (name: string) => string | undefined } }): Promise<T> {
  const length = Number(c.req.header('content-length') || 0);
  if (length > 64_000) throw new Error('Request body too large.');
  return (await c.req.json()) as T;
}

function hkDateParts(date = new Date()): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return { year: get('year'), month: get('month'), day: get('day') };
}

function hkToday(): string {
  const { year, month, day } = hkDateParts();
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Candidate';
}

function summaryResponse(summary: SyncSummary): Record<string, unknown> {
  return { ok: true, summary };
}

app.post('/api/checkin', async (c) => {
  const user = await requireUser(c);
  const body = await readJson<{ date?: string }>(c);
  const date = body.date;
  if (!validDate(date)) return c.json({ error: 'date must be YYYY-MM-DD.' }, 400);

  const today = hkToday();
  const yesterday = addDays(today, -1);
  if (date !== today && date !== yesterday) {
    return c.json({ error: '只可打卡今日或過去 24 小時內的一日。' }, 400);
  }

  const fs = new Firestore(c.env);
  const profileDoc = await fs.get(`users/${user.uid}`);
  const profile = profileDoc ? fromFields(profileDoc.fields || {}) : {};
  const displayName = sanitizeName(getString(profile, 'displayName', user.name || 'Candidate'));

  const tasks = await fs.runQuery(`users/${user.uid}`, {
    from: [{ collectionId: 'tasks' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'completed' },
        op: 'EQUAL',
        value: { booleanValue: true },
      },
    },
    limit: 200,
  });
  const completed = tasks.filter((doc) => {
    const data = fromFields(doc.fields || {});
    const completedAt = getString(data, 'completedAt').slice(0, 10);
    const dueDate = getString(data, 'dueDate');
    return completedAt === date || dueDate === date;
  }).length;
  if (completed < 1) {
    return c.json({ error: '打卡前請先完成至少一個當日任務。' }, 400);
  }

  const checkinPath = `users/${user.uid}/checkins/${date}`;
  const statsPath = `users/${user.uid}/meta/stats`;
  const leaderboardPath = `leaderboard/${user.uid}`;
  const transaction = await fs.beginTransaction();

  try {
    const existing = await fs.get(checkinPath, transaction);
    if (existing) {
      const stats = await fs.get(statsPath, transaction);
      const data = stats ? fromFields(stats.fields || {}) : {};
      return c.json({
        checkin: {
          date,
          completedTaskCount: getNumber(fromFields(existing.fields || {}), 'completedTaskCount', completed),
          createdAt: getString(fromFields(existing.fields || {}), 'createdAt', new Date().toISOString()),
          source: 'worker',
        },
        stats: {
          currentStreak: getNumber(data, 'currentStreak'),
          longestStreak: getNumber(data, 'longestStreak'),
          totalDays: getNumber(data, 'totalDays'),
          lastCheckinDate: getString(data, 'lastCheckinDate') || date,
        },
      });
    }

    const statsDoc = await fs.get(statsPath, transaction);
    const stats = statsDoc ? fromFields(statsDoc.fields || {}) : {};
    const lastDate = getString(stats, 'lastCheckinDate');
    if (lastDate && lastDate > date) {
      return c.json({ error: '不可補簽比最後一次打卡更早的日期。' }, 400);
    }
    const previousStreak = getNumber(stats, 'currentStreak');
    const currentStreak = !lastDate ? 1 : lastDate === addDays(date, -1) ? previousStreak + 1 : 1;
    const totalDays = getNumber(stats, 'totalDays') + 1;
    const longestStreak = Math.max(getNumber(stats, 'longestStreak'), currentStreak);
    const now = new Date();
    const visible = getBool(profile, 'leaderboardOptIn', false);

    const checkinFields = {
      date,
      completedTaskCount: completed,
      createdAt: now,
      source: 'worker',
    };
    const statsFields = {
      currentStreak,
      longestStreak,
      totalDays,
      lastCheckinDate: date,
      updatedAt: now,
    };
    const leaderboardFields = {
      displayName,
      currentStreak,
      totalDays,
      visible,
      updatedAt: now,
    };

    await fs.commit(transaction, [
      fs.updateWrite(checkinPath, checkinFields, { exists: false }),
      fs.updateWrite(statsPath, statsFields),
      fs.updateWrite(leaderboardPath, leaderboardFields),
    ]);

    return c.json({
      checkin: {
        date,
        completedTaskCount: completed,
        createdAt: now.toISOString(),
        source: 'worker',
      },
      stats: {
        currentStreak,
        longestStreak,
        totalDays,
        lastCheckinDate: date,
      },
    });
  } catch (error) {
    const existing = await fs.get(checkinPath);
    if (existing) {
      const stats = await fs.get(statsPath);
      const data = stats ? fromFields(stats.fields || {}) : {};
      return c.json({
        checkin: {
          date,
          completedTaskCount: getNumber(fromFields(existing.fields || {}), 'completedTaskCount', completed),
          createdAt: getString(fromFields(existing.fields || {}), 'createdAt', new Date().toISOString()),
          source: 'worker',
        },
        stats: {
          currentStreak: getNumber(data, 'currentStreak'),
          longestStreak: getNumber(data, 'longestStreak'),
          totalDays: getNumber(data, 'totalDays'),
          lastCheckinDate: getString(data, 'lastCheckinDate') || date,
        },
      });
    }
    throw error;
  }
});

app.post('/api/leaderboard/visibility', async (c) => {
  const user = await requireUser(c);
  const body = await readJson<{ optIn?: boolean }>(c);
  if (typeof body.optIn !== 'boolean') return c.json({ error: 'optIn must be boolean.' }, 400);
  const fs = new Firestore(c.env);
  const profileDoc = await fs.get(`users/${user.uid}`);
  const profile = profileDoc ? fromFields(profileDoc.fields || {}) : {};
  const displayName = sanitizeName(getString(profile, 'displayName', user.name || 'Candidate'));
  const statsDoc = await fs.get(`users/${user.uid}/meta/stats`);
  const stats = statsDoc ? fromFields(statsDoc.fields || {}) : {};
  const now = new Date();

  await fs.patch(`users/${user.uid}`, {
    leaderboardOptIn: body.optIn,
    updatedAt: now,
  });
  await fs.patch(`leaderboard/${user.uid}`, {
    displayName,
    currentStreak: getNumber(stats, 'currentStreak'),
    totalDays: getNumber(stats, 'totalDays'),
    visible: body.optIn,
    updatedAt: now,
  });
  return c.json({ ok: true, visible: body.optIn });
});

app.get('/api/calendar/status', async (c) => {
  const user = await requireUser(c);
  const fs = new Firestore(c.env);
  const doc = await fs.get(`calendarConnections/${user.uid}`);
  if (!doc) return c.json({ connected: false });
  const connection = fromFields(doc.fields || {});
  return c.json({
    connected: true,
    provider: getString(connection, 'provider'),
    label: getString(connection, 'label'),
    lastSyncAt: getString(connection, 'lastSyncAt') || undefined,
    lastError: getString(connection, 'lastError') || undefined,
    status: getString(connection, 'status', 'idle'),
  });
});

app.post('/api/calendar/caldav/connect', async (c) => {
  const user = await requireUser(c);
  const body = await readJson<{ label?: string; url?: string; username?: string; password?: string }>(c);
  if (!body.url || !body.username || !body.password) {
    return c.json({ error: 'url, username and password are required.' }, 400);
  }
  if (body.url.length > 500 || body.username.length > 200 || body.password.length > 500) {
    return c.json({ error: 'CalDAV credentials are too long.' }, 400);
  }
  const fs = new Firestore(c.env);
  const connection = await createCalDavConnection(c.env, fs, user.uid, {
    label: body.label || 'CalDAV',
    url: body.url,
    username: body.username,
    password: body.password,
  });
  return c.json({
    connected: true,
    provider: connection.provider,
    label: connection.label,
    status: connection.status || 'idle',
  });
});

app.post('/api/calendar/event-delete', async (c) => {
  const user = await requireUser(c);
  const body = await readJson<{ eventId?: string }>(c);
  if (!body.eventId) return c.json({ error: 'eventId is required.' }, 400);
  const fs = new Firestore(c.env);
  await deleteRemoteEventById(c.env, fs, user.uid, body.eventId);
  return c.json({ ok: true });
});

app.post('/api/calendar/disconnect', async (c) => {
  const user = await requireUser(c);
  const fs = new Firestore(c.env);
  await disconnectUser(c.env, fs, user.uid);
  return c.json({ ok: true });
});

app.post('/api/calendar/sync', async (c) => {
  const user = await requireUser(c);
  const fs = new Firestore(c.env);
  const summary = await syncUser(c.env, fs, user.uid, 'manual');
  return c.json(summaryResponse(summary));
});

app.post('/api/calendar/google/oauth-url', async (c) => {
  const user = await requireUser(c);
  const url = await buildGoogleAuthUrl(c.env, user.uid);
  return c.json({ url });
});

app.get('/api/calendar/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const appOrigin = allowedOrigins(c.env)[0] || '';
  if (error || !code || !state) {
    return c.redirect(`${appOrigin}/?google=error`);
  }
  try {
    const uid = await verifyState(c.env, state);
    const tokens = await exchangeGoogleCode(c.env, code);
    const fs = new Firestore(c.env);
    await createGoogleConnection(c.env, fs, uid, tokens.refreshToken);
    return c.redirect(`${appOrigin}/?google=connected`);
  } catch {
    return c.redirect(`${appOrigin}/?google=error`);
  }
});

app.post('/webhooks/google', async (c) => {
  const channelId = c.req.header('x-goog-channel-id') || '';
  const token = c.req.header('x-goog-channel-token') || '';
  const state = c.req.header('x-goog-resource-state') || '';
  if (!channelId) return c.body(null, 204);
  if (state === 'sync') return c.body(null, 204);
  const fs = new Firestore(c.env);
  const channelDoc = await fs.get(`webhookChannels/${channelId}`);
  if (!channelDoc) return c.body(null, 204);
  const channel = fromFields(channelDoc.fields || {});
  if (getString(channel, 'token') !== token) return c.body(null, 204);
  const uid = getString(channel, 'uid');
  if (!uid) return c.body(null, 204);
  try {
    await syncUser(c.env, fs, uid, 'google-webhook');
  } catch {
    // Google will retry; cron is the fallback.
  }
  return c.body(null, 204);
});

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : String(error);
  const status = /Missing Firebase|Invalid Firebase|no subject|Invalid OAuth/i.test(message)
    ? 401
    : /required|only|must|too long|too large|No calendar|No CalDAV|CalDAV|Google Calendar/i.test(message)
      ? 400
      : 500;
  return c.json({ error: message.slice(0, 500) }, status);
});

async function scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const fs = new Firestore(env);
  const due = await listDueConnections(fs);
  for (const item of due.slice(0, 8)) {
    try {
      await syncUser(env, fs, item.uid, 'cron');
    } catch {
      // Each connection stores its own error; continue with the next.
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};

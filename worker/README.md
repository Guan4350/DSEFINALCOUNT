> **Deferred Mode C prototype.** This Worker is not used by the current Mode B (Firebase-only) build. Do not deploy it for Mode B. Keep it as reference for a later CalDAV/Google Calendar phase.

# DSE Calendar Bridge

Cloudflare Worker that provides the small amount of server-side behaviour a static dashboard cannot safely do:

- verify Firebase ID tokens;
- validate and write check-ins / stats / leaderboard with a Firestore transaction;
- discover and sync iCloud/CalDAV calendars;
- connect to Google Calendar with OAuth and `syncToken`;
- receive Google push notifications and cron-poll CalDAV.

## Stack

- Hono
- `jose` for Firebase ID token verification and service-account JWT
- `ical.js` for RFC5545
- Firestore REST (no Firebase Admin SDK, small Worker bundle)
- AES-GCM for CalDAV/Google credentials

## Local

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars
npm install
npx wrangler dev
```

`GET /health` works without secrets. Most other routes need Firebase auth and a service account.

## Deploy

```bash
npx wrangler login
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
npx wrangler secret put CALDAV_ENC_KEY
npx wrangler secret put STATE_SECRET
# optional:
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

Edit the non-secret values in `wrangler.toml`:

- `APP_ORIGIN` — comma-separated exact front-end origins
- `FIREBASE_PROJECT_ID`
- `WEBHOOK_BASE_URL` — public Worker origin (Google push)
- `GOOGLE_REDIRECT_URI` — optional; derived from `WEBHOOK_BASE_URL`
- `ALLOWED_CALDAV_HOSTS` — optional comma-separated exact hostnames

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness |
| POST | `/api/checkin` | Firebase | Validate completed task + write one check-in |
| POST | `/api/leaderboard/visibility` | Firebase | Opt in/out and refresh public fields |
| GET | `/api/calendar/status` | Firebase | Sanitized connection status |
| POST | `/api/calendar/caldav/connect` | Firebase | Discover + encrypt CalDAV credentials |
| POST | `/api/calendar/sync` | Firebase | Manual sync |
| POST | `/api/calendar/event-delete` | Firebase | Delete remote event before local removal |
| POST | `/api/calendar/disconnect` | Firebase | Remove connection |
| POST | `/api/calendar/google/oauth-url` | Firebase | Signed Google OAuth URL |
| GET | `/api/calendar/google/callback` | signed state | OAuth callback |
| POST | `/webhooks/google` | channel token | Google push notification |
| scheduled | cron `*/15 * * * *` | Cloudflare | Poll due connections |

## Security guardrails

- Direct client writes to `checkins` and `leaderboard` are denied by Firestore rules.
- Worker requests verify a Firebase ID token except health/OAuth callback/webhook.
- Check-ins use the deterministic ID `users/{uid}/checkins/{date}` and a transaction.
- CalDAV URLs must be HTTPS and not literal private hosts; use `ALLOWED_CALDAV_HOSTS` to lock down.
- Credentials are encrypted; status responses never include secrets.
- No generic outbound proxy route.

See [../docs/CALDAV.md](../docs/CALDAV.md) and [../docs/SECURITY.md](../docs/SECURITY.md).

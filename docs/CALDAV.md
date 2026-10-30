# Deferred Mode C — CalDAV / Google Calendar design notes

> **Status: not implemented in the current Mode B build.** The Mode B UI has no CalDAV, Google Calendar or Worker controls. The existing `worker/` directory is a prototype/reference and is not imported by the app. The following notes are kept for a later phase.

## 1. Why a Worker is required

GitHub Pages is a static origin. It can:

- parse an `.ics` file the user selects;
- generate an `.ics` download;
- call Google Calendar API with a short-lived OAuth token (CORS is enabled by Google).

It cannot reliably:

- call iCloud CalDAV directly from the browser (iCloud does not send the CORS headers needed for a browser preflight);
- keep a CalDAV password secret;
- run a cron poll;
- receive a Google push notification.

The Cloudflare Worker is the smallest additional component that can do those four things. It is not a generic proxy: it verifies a Firebase ID token on every app route and stores only encrypted credentials.

## 2. Provider matrix

| Provider | Path | Two-way? | Change detection |
| --- | --- | --- | --- |
| iCloud / Apple Calendar | CalDAV | Yes, when the Worker can reach the account | ctag + calendar-query on change, plus cron; no webhook |
| Fastmail / Nextcloud / Radicale / Baikal | CalDAV | Yes | ctag + calendar-query; server may support sync-collection |
| Google Calendar | Calendar API v3 (OAuth) | Yes | `syncToken` + optional push channel |
| Google CalDAV | Not used | — | Legacy endpoint is not a practical path for new browser apps |
| Manual `.ics` | File | No | Snapshot import/export |

## 3. Data mapping

Firestore event document (`users/{uid}/events/{eventId}`):

| Field | Meaning |
| --- | --- |
| `uid` | Stable iCalendar UID; used to match remote objects |
| `start` | `YYYY-MM-DD` (all-day) or local `YYYY-MM-DDTHH:mm:ss` |
| `end` | Exclusive end for all-day events |
| `allDay` | Boolean |
| `type` | `dse` / `mock` / `school` / `sba` / `study` / `custom` |
| `subjectId` | Local subject ID |
| `source` | `local` / `ics` / `caldav` / `google` |
| `externalId` | CalDAV href or Google event id |
| `etag` | CalDAV ETag when available |
| `updatedAt` | Firestore timestamp used for last-write-wins |
| `deleted` | Tombstone flag |

When the user edits an event in the UI, the editor sets `source:'local'` and a fresh `updatedAt`. The Worker treats that as a local change and pushes it. Events pulled from a remote provider keep the remote timestamp so they do not immediately bounce back.

## 4. CalDAV flow

### Discovery

1. `PROPFIND Depth:0` on the supplied URL for `current-user-principal` and `calendar-home-set`.
2. `PROPFIND Depth:1` on the home for `resourcetype` containing `calendar`, `displayname`.
3. Choose the calendar whose display name matches the connection label, otherwise the first calendar.
4. Store the resolved calendar URL.

### Pull

1. `PROPFIND Depth:0` for `getctag` (or `sync-token`).
2. If the ctag is unchanged, **do not** fetch calendar data. Query only local events with `updatedAt > lastSyncAt` and push dirty local events.
3. If the ctag changed, `REPORT calendar-query` for a window of −365 to +730 days, with `calendar-data` and `getetag`.
4. Parse each VEVENT with `ical.js`; convert times to `Asia/Hong_Kong`; choose master events for recurring series.
5. Match by `UID`; newer remote timestamp updates Firestore; newer local timestamp with `source:'local'` is pushed.

### Push

`PUT` to `<calendar-url>/<encodeURIComponent(uid)>.ics` with `text/calendar` and a stable UID. The Worker returns the response ETag if present. A local delete calls `DELETE` on the stored href before the Firestore document is removed.

### Conflict handling

If both sides changed since `lastSyncAt` and the timestamps differ, the Worker writes a `syncLogs` document with:

- provider;
- event UID/title;
- local and remote timestamps;
- chosen resolution (newer timestamp wins).

This is last-write-wins, not a three-way merge. For exam dates, review `syncLogs` if two devices edit at once.

## 5. Google Calendar flow

### OAuth

1. The front-end asks the Worker for an OAuth URL (`POST /api/calendar/google/oauth-url`).
2. The Worker signs a 10-minute state JWT containing the Firebase UID.
3. Google redirects to `/api/calendar/google/callback`.
4. The Worker verifies the state, exchanges the code, encrypts the refresh token, stores the connection, and redirects to the app with `?google=connected`.
5. A push channel is registered if `WEBHOOK_BASE_URL` is public.

Scopes: `https://www.googleapis.com/auth/calendar`. This is broad because the app needs to read and write calendar events. If you only need one calendar, narrow this to `calendar.events` plus a suitable read scope and test the calendar-list calls.

### Sync

- First sync: `events.list` with `singleEvents=false`, `showDeleted=true`, time window −365/+730 days.
- Later syncs: `syncToken`; only changed/deleted events are returned.
- `410 GONE`: discard the token and perform a full resync.
- Local dirty events are queried by `updatedAt > lastSyncAt`, not by loading the entire event collection.
- Push creates or patches events with `extendedProperties.private.dse_uid`.
- Google push notifications arrive at `/webhooks/google`; the Worker checks the channel token in `webhookChannels/{channelId}` and triggers a sync. Cron is still the fallback if a channel expires.

## 6. Security

- CalDAV password / Google refresh token: AES-256-GCM, 96-bit random IV, key from `CALDAV_ENC_KEY`.
- The front-end never receives credentials or tokens back from the Worker.
- `calendarConnections/{uid}` and `webhookChannels/{id}` are unreadable/unwritable by clients.
- CalDAV URLs must be HTTPS and must not resolve to literal private hosts.
- `ALLOWED_CALDAV_HOSTS` can lock the bridge to iCloud/Fastmail/your Nextcloud host.
- Google push tokens are stored in a deny-all collection; only the Worker can read them.
- OAuth state is a signed, short-lived JWT.

## 7. Known limitations

- **No iCloud webhook.** Polling is the only standards-based option. A manual **立即同步** button appears in settings.
- **ctag is not universal.** If a CalDAV server does not expose a ctag or sync-token, the Worker falls back to a full calendar-query on each poll. Lower the cron frequency for such servers.
- **Remote deletion detection is conservative.** The Worker processes VEVENTs in the query window; an event moved far outside the window may look absent. Google's `showDeleted` handles deletions cleanly.
- **Recurring events are stored as master events** with RRULE; the UI expands them with FullCalendar's rrule plugin. Per-occurrence exceptions are not fully round-tripped by the Worker.
- **No attendee/invitation handling.** This is a personal study calendar, not a groupware server.
- **Google OAuth app verification.** For a small Testing-mode app, add each user as a test user. A public production app may require Google verification because of the calendar scope.

## 8. Minimal manual test

```bash
# Health
curl https://YOUR-WORKER.workers.dev/health

# Authenticated status (replace token)
curl -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  https://YOUR-WORKER.workers.dev/api/calendar/status

# Manual sync
curl -X POST -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  https://YOUR-WORKER.workers.dev/api/calendar/sync
```

A Firebase ID token can be copied from the browser's IndexedDB while signed in for temporary debugging. Do not paste production tokens into a shell history you do not control.

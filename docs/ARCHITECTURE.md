# Architecture — Mode A + Mode B

## 1. Two modes, one static bundle

```text
                    ┌──────────────────────────────┐
                    │ Vite + React static bundle   │
                    │ GitHub Pages                 │
                    └──────────────┬───────────────┘
                                   │
                 all six VITE_FIREBASE_* empty?
                         ┌─────────┴─────────┐
                         │ yes               │ no
                         ▼                   ▼
                 ┌──────────────┐    ┌─────────────────────┐
                 │ Mode A       │    │ Mode B              │
                 │ localStorage │    │ Firebase Auth       │
                 │ no network   │    │ Google only         │
                 └──────────────┘    │ Firestore Spark     │
                                     │ asia-east2           │
                                     └─────────────────────┘
```

`src/lib/firebase.ts` requires **all six** config values before calling `initializeApp`. A partial config behaves as Mode A rather than creating a half-working Firebase app.

## 2. Front-end state

`AppContext` is the single store.

- Boot: `loadData()` → `normalizeData()` → localStorage.
- Mutations: build a new `AppData`, save, update state and a ref.
- Sign-in: `ensureProfile` → `fetchCloudSnapshot` → merge.
- Merge is local-first:
  - cloud tasks/events win on identical IDs;
  - local-only tasks/events stay visible;
  - check-ins are merged by date (cloud wins);
  - reflections merge with cloud precedence;
  - settings come from `meta/settings` when present.
- A one-click import is explicit. There is no silent auto-upload.
- Only the leaderboard reads from Firestore after hydration. It uses a 60-second one-shot poll while the page is visible, pauses when hidden, and can be refreshed manually. No realtime listener is opened.

## 3. Data model

```text
users/{uid}
  displayName, leaderboardOptIn, photoURL, email, createdAt, updatedAt

users/{uid}/tasks/{taskId}
  title, subjectId, dueDate, dueTime, completed, completedAt,
  completedDate, notes, kind, createdAt, updatedAt, rolledFrom,
  rolloverCount, source

users/{uid}/events/{eventId}
  uid, title, start, end, allDay, type, subjectId, paper, description,
  location, rrule, source, externalId, etag, updatedAt, deleted

users/{uid}/checkins/{YYYY-MM-DD}
  date, completedTaskCount, taskId, createdAt, source
  (create only; no update/delete)

users/{uid}/meta/stats
  currentStreak, longestStreak, totalDays, lastCheckinDate, updatedAt

users/{uid}/meta/settings
  dseYear, dseStartDate, dseEndDate, studyStartDate,
  hiddenSystemExamIds, semesterMode, timezone, updatedAt

users/{uid}/reflections/{YYYY-MM-DD}
  date, text, updatedAt

leaderboard/{uid}
  uid, displayName, currentStreak, totalDays, visible,
  writes, windowStart, updatedAt

systemExams/{year}
  year, source, label, events[], updatedAt   (admin write only)

admins/{uid}
  active: true                               (manual console setup)
```

### Why `completedDate` exists

A check-in must prove a completed task for that exact date. `completedDate` is a date-only value that rules can compare directly to the check-in document ID. `completedAt` is still kept for display/analysis.

## 4. Check-in transaction (Mode B)

`src/lib/cloudModeB.ts`:

1. Open a Firestore transaction.
2. Read the deterministic check-in doc `checkins/{date}`. If it exists, return it (idempotent).
3. Read `meta/stats` and the referenced task.
4. Verify `task.completed === true` and `task.completedDate === date`.
5. Compute current / longest / total streak.
6. Set check-in and stats in one transaction. The public `leaderboard/{uid}` document is synced immediately afterwards, outside that transaction, so a throttled board write can never roll back a saved check-in.
7. Security rules independently verify the task ownership/completion via `get()`.

The check-in document ID itself is the primary one-per-day lock. Rules deny update/delete, so a past check-in cannot be edited.

## 5. Leaderboard

- Opt-in default false.
- Only the user's own document is writable.
- Readable if signed in and `visible == true`; the owner can also read a hidden document.
- Query is capped at 100 visible documents.
- `LeaderboardView` performs a one-shot `getDocs` immediately, then every 60 seconds while the document is visible. The interval stops on `visibilitychange`/unmount, and **手動更新** runs the same query on demand. There is no `onSnapshot` subscription.
- Public metric writes are metered by rules: `leaderboard/{uid}` stores `writes` and `windowStart`, allowing 20 metered changes (display name, streak, total days) per rolling hour. Visibility-only changes are exempt so opting out is immediate.
- No tasks, images, notes or study minutes are copied to the leaderboard.
- Writes are triggered only by check-in/profile sync/import, not by the poll. Firestore rules enforce one check-in per date, ownership and the write budget; they do not compute streaks.

## 6. System DSE timetable

`src/data/dse2025.ts` contains the 2025 HKEAA finalised written timetable (subject, paper, date, start/end). `src/lib/systemExams.ts`:

- Converts the system dataset to read-only calendar events.
- Uses a Firestore `systemExams/{year}` document when an admin has published one.
- Otherwise, for a non-2025 year, shifts the 2025 month/day by `year - 2025` and marks every event `estimated`.
- Maps common core subjects to the default subject IDs; electives map to the user's custom elective subject when the name matches.

Users store only `hiddenSystemExamIds`; they never mutate the system dataset. Admin writes are gated by `admins/{uid}`.

## 7. Theme system

`tailwind.config.ts` is the single source for both palettes:

- **Light (default):** `#ffffff` / `#f8f8f8` paper, `#222222` ink, `#666666` secondary, `#F2C046` gold, light-gray borders.
- **Dark (optional):** the original `#0B1622` / `#142436` / `#0F4C81` / `#2A70B9` / `#C8D6E4` / `#7A8FA6` palette.
- The config emits CSS variables through a Tailwind `addBase` plugin. `src/styles/app.css` consumes only those variables; layout rules are unchanged.
- `src/lib/theme.ts` stores `light | dark` under `dse-candidate:theme`, applies `data-theme` on `<html>`, and updates the browser theme-color meta tag.
- An inline bootstrap in `index.html` prevents a dark-mode flash for users who previously selected it.

The media/PDF/image previews still use neutral grays from variables; no component structure or font family changed.

## 8. Images

Images are compressed to WebP (max 1280 px, quality 0.72), then stored as data URLs in localStorage. Caps:

- 8 images/day
- soft cap around 3.8 MB of image data
- 4.6 MB total local data guard

No Firebase Storage is initialised. Images are excluded from cloud sync by design.

## 9. Local data import

`importLocalData()`:

1. Normalizes completed tasks with `completedDate`.
2. Batch-writes tasks, events, reflections and settings.
3. Iterates up to 90 local check-ins; only dates with a matching completed task are written.
4. Syncs the public leaderboard once for the whole import, so historical check-ins do not consume one rate-limit slot each.
5. Reports imported/skipped counts.
6. Reloads the cloud snapshot.

Stable local IDs make this idempotent for tasks/events/reflections/settings. Check-in document IDs make it idempotent for dates.

## 10. Deferred Mode C

The `worker/` folder is an earlier prototype for CalDAV / Google Calendar. It is **not** imported by the Mode B client, not referenced in Settings, and not needed for deployment. It should be treated as design reference only until Mode C is explicitly started.

## 11. Non-goals

- No public study-detail leaderboard.
- No Firebase Storage images.
- No paid backend or Blaze.
- No task/event/leaderboard realtime listeners.
- No CalDAV/Worker in Mode B.

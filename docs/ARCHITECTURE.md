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
  - timer sessions are merged by id (cloud wins, local-only runs stay visible for one-click import);
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
  hiddenSystemExamIds, semesterMode, timezone,
  clockOffsetMs, selectedSubjectIds, updatedAt

users/{uid}/reflections/{YYYY-MM-DD}
  date, text, updatedAt

users/{uid}/timerSessions/{sessionId}
  date, subjectId, subjectName, paper, mode, startedAt, endedAt,
  durationSeconds, plannedSeconds, notes, completed, updatedAt

users/{uid}/timerState/current
  mode, subjectId, subjectName, paper, notes, plannedSeconds,
  referenceSeconds, startedAt(server), runningSince(server|null),
  accumulatedMs, status, updatedAt(server)

leaderboard/{uid}
  uid, displayName, currentStreak, totalDays, weeklySeconds, weekKey,
  visible, writes, windowStart, updatedAt

leaderboardWinner/{weekKey}__{uid}
  weekKey, uid, displayName, durationSeconds, quote,
  imageData(approved only), imageStatus, settlementDate, archived, updatedAt

winnerCardSubmissions/{weekKey}__{uid}
  weekKey, uid, imageData(pending/rejected), updatedAt

systemExams/{year}
  year, source, label, events[], timezone, referenceUrl, updatedAt
  (public read; admin write only)

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

## 6. Calendar, countdown and subject focus

### Two-way calendar

`CalendarView` uses FullCalendar month (default), week, day and list views. Clicking/selecting a date opens the exam editor; clicking an existing event or task opens the same editor for that record. New or edited records flow back through `AppContext` → `localStorage` immediately and → `users/{uid}/events` in Mode B, so FullCalendar re-renders from the same `allEvents` array.

The event editor validates:

- title, ISO date and `HH:MM` time (when not all-day);
- end after start (same-day or multi-day);
- duplicate title + type + subject + exact start (including read-only system exams);
- optional recurrence (`FREQ=DAILY|WEEKLY|MONTHLY`), preserved as an RRULE for FullCalendar and `.ics`.

### High-precision countdown

`src/lib/clock.ts` is the clock boundary:

- `eventStartMs` parses a stored wall-clock time as **UTC+8**, so a 08:30 HKEAA paper stays 08:30 even if the viewer’s device is in another timezone.
- `useSecondTick` aligns a one-second interval to the system clock.
- `countdownParts` returns days / hours / minutes / seconds and a past flag.
- `clockOffsetMs` is a user-entered correction, bounded to ±5 minutes. The settings panel compares the live Hong Kong clock with time.is/HKEAA and writes the offset to `meta/settings` (Mode B) or localStorage (Mode A).

`src/lib/exams.ts` filters exam types (`dse`, `mock`, `school`, `sba`), sorts by the exact HKT timestamp, keeps all-day exams visible for the rest of their day, and optionally filters by selected subject IDs.

### Subject focus

`settings.selectedSubjectIds` is a validated string array. The dashboard builds a Set from it and only offers exams whose `subjectId` is selected. The hero, the per-subject sidebar and the upcoming-exam list all apply that filter; the `DSE 首科` footer remains as a clearly-labelled global reference. If none are selected the dashboard shows a prompt; if several selected exams are close, a horizontally scrollable rail plus previous/next controls changes the active countdown.

Custom electives are ordinary `subjects` with `category: 'ELECTIVE'`; the settings panel offers common DSE elective presets. `systemExams` maps a subject by exact name first, then by name containment, then to the generic elective subject.

### Focus timer and study statistics

`TimerView` keeps a single active timer in component state. Starting it opens a portal-based full-screen focus stage (subject/paper header, oversized HH:MM:SS clock, start/remaining/end progress bar, Newton's-cradle progress accent, bottom controls). The overlay uses the Octavarium sky/grass/silver palette at low opacity in light mode and a near-black `#1C242C` surface in dark mode; it is not a separate route and can be exited without losing the running timer.

- **Persistence**: start/pause/resume write `users/{uid}/timerState/current` with Firestore `serverTimestamp()` values. On reload/background return, the client reads that document and reconstructs elapsed time from the server timestamps plus a small measured offset; `setInterval` only triggers rendering. Mode A uses an equivalent localStorage record.
- **Countdown**: planned seconds from the built-in `src/data/dsePapers.json` library or a custom 1–600 minute input; elapsed time is derived from absolute timestamps, not decremented. It changes colour at 15 and 5 minutes, rings a Web Audio bell at zero, marks itself complete and saves.
- **Stopwatch**: counts elapsed time until **標記完成**; its progress bar uses the selected paper duration as a visual reference.
- **Pause / resume** accumulates `accumulatedMs` and sets `runningSince` to null or a fresh server timestamp. **Abandon** discards the run without writing anything. Wake Lock is requested while running (re-acquired on visibility) and released on pause/finish.
- Completed runs become `users/{uid}/timerSessions/{id}` with subject, paper, start/end, duration, mode, notes and `completed`. Mode A writes the same object to `localStorage`; Mode B writes locally first, then Firestore, so a network failure never loses the local record.
- `src/lib/timer.ts` reads the built-in JSON paper durations; the user can override the duration for a run.
- `TimerStats` filters completed sessions to the last 7 or 30 days, renders a subject-share donut and a multi-subject daily-minutes line chart with inline SVG, and exports the filtered sessions as UTF-8 CSV. No chart dependency is added.

### Weekly encouragement card

- `leaderboard.weeklySeconds` + `weekKey` (Monday date) are updated after every completed timer, but only visible/opt-in leaderboard entries are ranked.
- `leaderboardWinner/{weekKey}__{uid}` stores each candidate card. The current top user can edit their own quote/image; an old top card remains in the collection and is shown in the history wall when the top uid changes.
- No Storage: the selected image is compressed in the browser to a ≤700,000-character WebP data URL and saved to the private `winnerCardSubmissions/{weekKey}__{uid}` document. The public card keeps `imageData` empty while pending/rejected; an admin approval copies the data into the public card with `imageStatus: approved`. Quotes are capped at 80 characters and filtered locally for sensitive words. `poster.ts` draws a PNG share card on canvas.



## 7. System DSE timetable

`src/data/dse2025.ts` contains the 2025 HKEAA finalised written timetable (subject, paper, date, start/end). `src/lib/systemExams.ts`:

- Converts the system dataset to read-only calendar events.
- Uses a Firestore `systemExams/{year}` document when an admin has published one.
- `systemExams` documents declare `timezone: 'Asia/Hong_Kong'`, a `referenceUrl` (recurso DSE Countdown) and `updatedAt`; admins can load the current timetable into the JSON editor, validate every date/time, and replace it. The rules require this shape, and only an admin can write.
- Otherwise, for a non-2025 year, shifts the 2025 month/day by `year - 2025` and marks every event `estimated`.
- Maps common core subjects to the default subject IDs; electives map to the user's custom elective subject when the name matches.

Users store only `hiddenSystemExamIds`; they never mutate the system dataset. Admin writes are gated by `admins/{uid}`.

## 8. Theme system

`tailwind.config.ts` is the single source for both palettes:

- **Light (default):** `#ffffff` / `#f8f8f8` paper, `#222222` ink, `#666666` secondary, `#F2C046` gold, light-gray borders.
- **Dark (optional):** the original `#0B1622` / `#142436` / `#0F4C81` / `#2A70B9` / `#C8D6E4` / `#7A8FA6` palette.
- The config emits CSS variables through a Tailwind `addBase` plugin. `src/styles/app.css` consumes only those variables; layout rules are unchanged.
- `src/lib/theme.ts` stores `light | dark` under `dse-candidate:theme`, applies `data-theme` on `<html>`, and updates the browser theme-color meta tag.
- An inline bootstrap in `index.html` prevents a dark-mode flash for users who previously selected it.

The media/PDF/image previews still use neutral grays from variables; no component structure or font family changed.

## 9. Images

Mistake-photo images are compressed to WebP (max 1280 px, quality 0.72), then stored as data URLs in localStorage. Caps:

- 8 images/day
- soft cap around 3.8 MB of image data
- 4.6 MB total local data guard

No Firebase Storage is used at all. Mistake photos stay local; the optional weekly-winner-card image uses a compressed Firestore data URL (≤700k characters) with a private pending submission and admin approval.

## 10. Local data import

`importLocalData()`:

1. Normalizes completed tasks with `completedDate`.
2. Batch-writes tasks, events, reflections and settings.
3. Iterates up to 90 local check-ins; only dates with a matching completed task are written.
4. Syncs the public leaderboard once for the whole import, so historical check-ins do not consume one rate-limit slot each.
5. Reports imported/skipped counts.
6. Reloads the cloud snapshot.

Stable local IDs make this idempotent for tasks/events/reflections/settings. Check-in document IDs make it idempotent for dates.

## 11. Deferred Mode C

The `worker/` folder is an earlier prototype for CalDAV / Google Calendar. It is **not** imported by the Mode B client, not referenced in Settings, and not needed for deployment. It should be treated as design reference only until Mode C is explicitly started.

## 12. Non-goals

- No public study-detail leaderboard.
- No Firebase Storage at all; weekly-winner images are compressed Firestore data URLs.
- No paid backend or Blaze.
- No task/event/leaderboard realtime listeners.
- No CalDAV/Worker in Mode B.

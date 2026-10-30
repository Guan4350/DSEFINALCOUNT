# Deployment guide — Mode B (Firebase Spark)

Mode B adds Google login, Firestore cross-device sync and an opt-in streak leaderboard. It does **not** include CalDAV, Google Calendar OAuth or a Cloudflare Worker. Those are deferred Mode C.

Mode A is the fallback: leave all six Firebase variables empty.

---

## 0. Prerequisites

- Node.js 20+
- pnpm (`corepack enable` once) or npm
- A GitHub account
- A Firebase project on the **Spark** plan
- No billing account, no Cloud Functions, no Firebase Storage

---

## 1. Run Mode A locally first

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Leave every `VITE_FIREBASE_*` value empty. Confirm:

- sidebar says **Local only**
- dashboard shows **本機模式**
- **設定 → 主題** switches white-gold / deep navy
- system DSE countdowns appear (estimated 2027 dates in the demo)
- adding a task, creating an event and exporting `.ics` work

This proves the static app is healthy before Firebase is involved.

---

## 2. Create the Firebase project

1. Firebase Console → **Create project**.
2. Confirm the plan is **Spark**. Do not add a billing account.
3. Add a **Web app** (`</>`), copy the six `firebaseConfig` values.
4. **Build → Authentication → Sign-in method** → enable **Google only**.
   Do not enable anonymous, email/password, phone or other providers.
5. **Build → Firestore Database → Create database**.
   - Location: **asia-east2 (Hong Kong)**.
   - This cannot be changed later. If the project already has a Firestore database in another region, create a new Firebase project rather than trying to move it.
   - Start in production mode.

### Authorized domains

Authentication → Settings → Authorized domains:

- `localhost`
- `your-name.github.io` (origin only, no repository path)

Without this, Google sign-in may open a popup that immediately closes.

---

## 3. Fill `.env.local`

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...:web:...
```

Restart `pnpm dev`. The sidebar should switch to **Cloud idle**, and the header should show **Google 登入**.

- All six empty → Mode A.
- A partially filled config is treated as Mode A (not a broken half-Mode-B).
- Never put a service-account JSON or Google client secret in a `VITE_*` value.
- **Never commit `.env.local`.** It is already in `.gitignore`; keep it local. GitHub Pages receives the same values through repository Actions Variables (section 6).

---

## 4. Publish Firestore rules

Open [../firestore.rules](../firestore.rules) and paste it into **Firestore Database → Rules → Publish**.

Manual smoke checks after publishing:

1. Sign in with Google.
2. Add a task; it should appear under `users/{uid}/tasks`.
3. Complete it; create a check-in from the dashboard. A `users/{uid}/checkins/{date}` document should be created.
4. Open the leaderboard and opt in; `leaderboard/{uid}` should exist with `visible: true`, `writes` ≥ 1 and a `windowStart` timestamp.
5. Opt out; `visible` should become false and the row should disappear for other signed-in users.
6. Press **手動更新**; the board should re-read immediately. Leave it open for 60 seconds to see the automatic poll (no realtime listener is opened).

### Indexes

Current queries use automatic single-field indexes:

- tasks: `updatedAt` (order)
- events: `start` (order)
- check-ins: `date >=`
- reflections: `date` (order)
- leaderboard: `visible == true` (read every 60 seconds while the page is visible)

No composite index is required. If the console prompts for one, accept it and wait for the build.

### Optional: admin account

Only an admin can replace the official DSE timetable. Create the admin marker manually:

1. Sign in once.
2. Firebase Console → Authentication → Users → copy your UID.
3. Firestore → **Start collection** `admins` → document ID = your UID → field `active` (boolean) = `true`.
4. Reload the app. **設定 → Admin / HKEAA** appears.

Do not add a client-side route that creates `admins/{uid}`; the rules deny all admin-marker writes.

---

## 5. Seed / update the official timetable

The app ships with a local transcription of the 2025 HKEAA finalised written timetable. It is used immediately in Mode A and as a fallback in Mode B.

For an admin:

1. **設定 → Admin / HKEAA**.
2. **寫入 2025 HKEAA 基底** writes `systemExams/2025`.
3. For another year, paste a JSON array and choose the target year, or adjust the selected DSE year and use the admin JSON uploader.
4. Normal users can only hide system events; they cannot edit or delete them.

The app labels non-2025 years as estimates. Estimate logic shifts the 2025 month/day by the year difference; it does not model HKEAA's weekday decisions. Always check [HKEAA](https://www.hkeaa.edu.hk/en/hkdse/event_timetable/).

---

## 6. Deploy GitHub Pages

1. Push to GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. Add repository **Variables**:

| Variable | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | from Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | your project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | your bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from Firebase |
| `VITE_FIREBASE_APP_ID` | from Firebase |
| `VITE_BASE_PATH` | `/<repo>/` for a project site, `/` for a user site |

4. Run **Actions → Deploy to GitHub Pages**.
5. Open the Pages URL, sign in, and repeat the smoke checks.

If assets 404, `VITE_BASE_PATH` is wrong. If login fails, add the Pages origin to Firebase authorized domains.

---

## 7. Local → cloud import

After first sign-in:

1. The app merges local-only data into the current view.
2. A banner/card tells you if local-only records exist.
3. **設定 → 跨裝置同步 → 上傳本機資料** writes local tasks, events, reflections, settings and check-ins to Firestore.
4. Check-ins are imported only when a matching completed task exists. The rest are skipped and reported.
5. Re-importing is safe for tasks/events/reflections/settings because IDs are stable; check-ins are create-only and duplicate dates are ignored.

Images are never uploaded. Export a JSON backup before clearing browser storage.

---

## 8. Quota model (Spark)

Free tier, per day (check current Firebase terms):

- 50,000 Firestore reads
- 20,000 writes
- 1 GiB stored
- No automatic billing on Spark

This project intentionally avoids:

- Firebase Storage
- Cloud Functions
- realtime listeners of any kind (the leaderboard is polled every 60 seconds)
- background workers/cron
- public leaderboard reads beyond the visible opt-in documents

The **今日用量估算** panel is a local estimate, not an official bill. Reduce usage by:

- keeping the leaderboard closed when not needed
- not repeatedly reloading the app
- keeping the user group small
- using Mode A for users who do not need sync

If Spark hits its daily quota, it stops serving for the day; it does not charge you.

---

## 9. Mode A fallback test

1. Clear all six `VITE_FIREBASE_*` values in `.env.local`.
2. Restart `pnpm dev`.
3. Sidebar must say **Local only**.
4. No Google button; no Firestore network request; all local features work.
5. Re-fill the values and restart to return to Mode B.

---

## 10. Troubleshooting

### Mode B does not activate

All six values must be non-empty, and the dev server must be restarted after editing `.env.local`. Vite does not hot-reload environment values.

### Google popup closes

Add the exact origin to Firebase Authentication → Authorized domains.

### `Missing or insufficient permissions`

Publish the current [../firestore.rules](../firestore.rules). Check that the signed-in UID owns the document path.

### Check-in says completed date does not match

A check-in requires a task with `completedDate === date`. Toggle the task complete again after deploying this version, or re-import after normalizing completed dates. Older local tasks with only `completedAt` are normalized during import by the app.

### Leaderboard empty

- The default is opt-in off.
- Open the leaderboard and switch **顯示在排行榜** on.
- The board updates on a 60-second poll; press **手動更新** to check immediately.
- If the user changed display name or opt-in, wait for the profile sync to finish; then reload once.

### Leaderboard update says it is too frequent

The security rules meter public metric writes at 20 per rolling hour. Visibility-only changes (opting out) are exempt. Wait for the window, or keep using the local board; no data is lost.

### Upgrading from a build without the write budget

`leaderboard/{uid}` now requires `writes` and `windowStart`. If an older build already created board documents, delete those documents in Firestore Console; the app recreates them on the next check-in or profile sync.

### Admin section missing

Create `admins/{uid}` with `active: true` manually, then reload. Admin markers cannot be self-created by rules.

### GitHub Pages blank

Set `VITE_BASE_PATH=/<repo>/` and redeploy.

### Images fail

Close to the localStorage cap. Export a JSON backup and delete old images. This is intentional: Mode B does not use Firebase Storage.

### Firestore location is wrong

Firestore locations are immutable. Create a new Firebase project in `asia-east2` and update the six env values; do not attempt an in-place migration.

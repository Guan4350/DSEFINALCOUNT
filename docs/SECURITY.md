# Security, privacy and Spark quota

## 1. Boundary

| Component | Trust | Capabilities |
| --- | --- | --- |
| Static front-end | untrusted | Own profile, tasks, events, reflections, settings, check-ins, leaderboard doc |
| Firestore rules | enforcement | Ownership, field shape, one check-in per date, task-reference proof, admin-only system data |
| Firebase Auth | identity | Google OAuth only |
| Service account | not used | Mode B never needs one; never add it to the front-end |
| Cloudflare Worker | not used | Deferred Mode C |

## 2. Rules summary

Source of truth: [../firestore.rules](../firestore.rules).

| Path | Read | Write |
| --- | --- | --- |
| `users/{uid}` | own | own, whitelisted profile fields |
| `users/{uid}/tasks/{id}` | own | own, validated shape; `updatedAt == request.time` |
| `users/{uid}/events/{id}` | own | own, validated shape; `updatedAt == request.time` |
| `users/{uid}/checkins/{date}` | own | **create only**; must reference own task with `completedDate == date` |
| `users/{uid}/meta/stats` | own | own, validated stats shape |
| `users/{uid}/meta/settings` | own | own, validated settings shape |
| `users/{uid}/reflections/{date}` | own | own, ≤5,000 chars |
| `leaderboard/{uid}` | signed-in and (own or `visible == true`) | own only, validated shape, 20 metered writes/hour |
| `systemExams/{year}` | public read | admin only |
| `admins/{uid}` | own only | **deny** (manual console setup) |
| legacy Worker paths | deny | deny |
| everything else | deny | deny |

### Check-in proof

```text
checkin doc id = 2026-11-03
checkin.taskId = task-abc
rules:
  get(users/{uid}/tasks/task-abc).data.completed == true
  get(...).data.completedDate == "2026-11-03"
```

This prevents a check-in without a completed task. It does not prove the user genuinely studied; they control their own task data. That limitation is explicit because Mode B has no server-side worker.

### One-per-day lock

The check-in document ID is the date. `create` is allowed, `update` and `delete` are denied. A retry with the same date fails and the client returns the existing record.

### Leaderboard rate limit / abuse

- Only the owner can write their `leaderboard/{uid}` document.
- Allowed fields are exactly `uid`, `displayName`, `currentStreak`, `totalDays`, `visible`, `writes`, `windowStart`, `updatedAt`.
- **Rules-enforced write budget:** metered changes (display name, streak, total days) are limited to 20 per rolling one-hour window. Inside a window `writes` must equal the old value + 1; the only accepted reset is `writes == 1` with `windowStart == request.time` after the window has expired. A client cannot reset the counter early.
- A visibility-only change is exempt from the budget, so opting out for privacy is always immediate and never fails because of the rate limit.
- The app writes on check-in, profile change and once per local import, not on the poll. The 60-second leaderboard poll is read-only.
- Firestore rules cannot compute a streak, and they cannot enforce a global per-second quota shared by every collection; the budget above is per leaderboard document. The client computes the public numbers; the protection is ownership, shape, one check-in per day, the write budget and the small group model. Do not treat this leaderboard as examination-integrity data.

## 3. Privacy

- `leaderboardOptIn` defaults false.
- Only name, currentStreak and totalDays are copied to the public document.
- No email, photo, subjects, task text, reflections, images or study minutes.
- Hidden documents are readable by their owner only; other signed-in users cannot read them.
- The poll stops when the page is hidden or the leaderboard view unmounts; no realtime listener is kept open.
- Images never leave the device.

## 4. Admin model

- Admin markers are manually created in Firestore Console: `admins/{auth.uid}` with `active: true`.
- Rules allow reading your own admin marker only; no client can create/update/delete an admin marker.
- `systemExams/{year}` write requires `exists(admins/{uid})`.
- The app shows the admin section only after reading the marker.
- Never put an admin UID or service-account credential in a `VITE_*` variable as an authorization mechanism.

## 5. Secrets

Mode B needs no service account, no private key, no OAuth client secret and no Worker secret.

Never commit:

- `.env.local` with real project values (ignored)
- service-account JSON
- Apple app-specific passwords
- Google OAuth client secrets
- Worker secrets

The Firebase web API key is a public identifier; Firestore rules are the authorization boundary.

## 6. Spark quota

Free daily limits (confirm in Firebase Console; they can change):

- 50k document reads
- 20k document writes
- 1 GiB stored

No Blaze, Cloud Functions, Firebase Storage, cron or realtime listeners are configured.

Rough behaviour:

- Sign-in hydrate: profile, up to 400 tasks, 400 events, 400 check-ins, 120 reflections, stats, settings. This is the largest cost.
- Normal day: a few task writes, one check-in transaction (2 writes) plus one leaderboard sync (1 write).
- Leaderboard poll: at most 100 public documents per 60 seconds, only while the page is visible; paused when hidden and stopped on unmount.
- No periodic polling when the app is idle.

The **今日用量估算** panel is a front-end estimate, not an official bill. If the quota is reached, Spark stops for the day; it does not auto-charge.

## 7. Operational advice

- Keep the group small; the initial hydrate can approach 50k reads for 40–50 active users.
- Close the leaderboard page when not needed; its 60-second poll stops as soon as the tab is hidden.
- Do not add task/event/leaderboard realtime listeners.
- Use Mode A for users who do not need sync.
- Export a JSON backup before clearing storage; images are local only.
- Review Firebase Console usage weekly.

## 8. Incident response

1. **Rules issue**: fix and republish immediately; rules apply per request.
2. **Admin marker compromised**: delete `admins/{uid}` in console; system data becomes read-only to that account.
3. **Leaderboard abuse**: set the user's `visible` to false, delete their `leaderboard/{uid}` with console/admin access, or temporarily deny leaderboard reads in rules.
4. **Quota exhaustion**: wait for the daily reset, reduce users, or switch affected users to Mode A. Never upgrade to Blaze to solve a design problem.
5. **Credential leak**: Mode B has no service-account secret. If a Firebase web key is abused, restrict API key usage in Google Cloud Console; the key is not an auth secret but can be abused for quota.

# DSE Final Count — optional Blaze iCal function

> The Spark-compatible scheduler is [../scripts/ical-sync](../scripts/ical-sync) + [../.github/workflows/ical-sync.yml](../.github/workflows/ical-sync.yml). Use this Functions folder only if you choose Blaze; do not run both schedulers.

Firebase Functions v2 scheduled job that fetches each user's public iCloud/iCal URL
server-side (no browser CORS), parses VEVENTs, and reconciles `userCalendarEvents`.

- Region: `asia-east1`
- Schedule: every 60 minutes (`Asia/Hong_Kong`)
- Max 25 users per run, sequential with 350 ms gap, 15 s fetch timeout
- Per-user failures are logged and written to `calendarSyncConfig`; they never abort the run
- One-way only: Apple iCal → website

Deploy:

```bash
firebase deploy --only functions
```

The Firebase deploy creates/updates the Cloud Scheduler job automatically. Verify/run:

```bash
gcloud scheduler jobs list --location=asia-east1
gcloud scheduler jobs run firebase-schedule-syncIcal-asia-east1 --location=asia-east1
```

Requires a Blaze (pay-as-you-go) Firebase project for Functions + Scheduler.

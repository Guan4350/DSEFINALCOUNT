# GitHub Actions iCal sync

Spark-compatible replacement for the optional Firebase Functions scheduler.
It runs hourly from `.github/workflows/ical-sync.yml`, fetches public iCloud/iCal
URLs server-side, parses VEVENTs and reconciles `source: 'ics'` documents in
`userCalendarEvents`.

## GitHub setup

1. Google Cloud Console → IAM & Admin → Service Accounts.
2. Create `ical-sync-runner` and grant **Cloud Datastore User** (`roles/datastore.user`) on the Firebase project.
3. Create a JSON key for that account.
4. GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: the complete service-account JSON.
5. Push the workflow. Run it once manually from **Actions → iCal auto-sync → Run workflow**.

Never commit the service-account JSON. It is encrypted as a GitHub secret.

## Limits

- Public repo: Actions minutes are free. Private repo: hourly runs consume minutes.
- Scheduled workflows can be delayed, and GitHub disables schedules after 60 days
  without repository activity.
- Per run: 25 users, sequential, 350 ms gap, 15 s fetch timeout, 5 MB cap.
- One-way only: Apple iCal → website.

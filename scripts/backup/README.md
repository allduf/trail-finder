# Nightly backup

Until the four secrets below are added, the nightly job skips quietly (a note in the run, no failure).

The Supabase free plan keeps no backups. Every night `.github/workflows/backup.yml` makes one encrypted file with
the whole database (accounts, settings, saved trips, tours, rides, spots, cabin trips, posts, I agree records,
usage) and every stored photo, and keeps it 30 days in a private Cloudflare R2 bucket.

- **Encrypted before it leaves the runner** (AES-256, with `BACKUP_PASSWORD`). Without the password the files can't
  be opened, by anyone, including us. Keep the password in your password manager too.
- **Never in the repository, never an Actions artifact, never in a log.** The repository and its logs are public:
  the backup prints "done" lines only, and a restore prints only how many rows and photos it put back; never names,
  ids or contents.
- **30 days.** Older copies are deleted each night, and an R2 rule (set-up step 1.4) deletes them after 30 days even if the job
  stops running. The privacy page says 30 days: change `KEEP_DAYS`, the R2 rule and the privacy page together.
- **Checked every night.** After encrypting, the job opens the file again, checks a checksum of every file inside,
  uploads it, and reads it back from R2 to make sure the copy there is the same.
- **Tested.** `bash scripts/backup/test/run.sh` builds a throwaway database from `supabase/*.sql` with made-up
  people, backs it up and restores it three ways, comparing every row and photo. It runs on every pull request that
  changes the backup.

## Set it up (once, about 10 minutes)

### 1. Cloudflare R2 bucket

1. Sign in at dash.cloudflare.com (the account that hosts trailfinderapp.ca).
2. Left menu: **R2 Object Storage**. If asked, turn on R2 (Cloudflare may ask for a card; the free amount is 10 GB, and the
   backups are far smaller).
3. **Create bucket**. Name: `trailfinder-backups`. Location: Automatic. Storage class: Standard. Create.
   Leave **Public access** off (the default).
4. Open the bucket, **Settings**, **Object lifecycle rules**, **Add rule**: name `delete after 30 days`, applies to
   the whole bucket, **Delete objects** after **30 days**. Save. (A safety net: the nightly job already deletes
   copies older than 30 days.)
5. Back on the R2 page: **Manage API tokens** (or "API" at the top right), **Create API token**
   (an "Account API token" or "User API token" both work).
   - Name: `Trail Finder backups`
   - Permissions: **Object Read & Write**
   - Specify bucket: **Apply to specific buckets only**, `trailfinder-backups`
   - TTL: Forever
   - Create. Copy the **Access Key ID** and the **Secret Access Key** (shown once). Paste them only into GitHub
     (step 4), never into a chat.

### 2. Database connection

1. Supabase dashboard, the Trail Finder project, **Connect** (top of the page).
2. Choose **Session pooler** (GitHub's computers can't reach the "Direct connection").
3. Copy the URI. It looks like `postgresql://postgres.<project>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
4. Put your database password in place of `[YOUR-PASSWORD]` (no brackets). If you don't know it: Project Settings,
   Database, **Reset database password**. Nothing in the app uses this password, so resetting it is fine.

### 3. Backup password

Make a long password (your password manager can make one; 30+ characters). **Save it in your password manager
first.** If it is lost, every backup is unreadable.

### 4. GitHub secrets

github.com/allduf/trail-finder, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**,
one at a time:

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | the URI from step 2, with the password in it |
| `BACKUP_PASSWORD` | the password from step 3 |
| `R2_ACCESS_KEY_ID` | Access Key ID from step 1.5 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key from step 1.5 |

`SUPABASE_SECRET_KEY` is already there (photos are fetched with it).

### 5. First run

Actions, **Nightly backup**, **Run workflow**. It takes a few minutes. Then Actions, **Restore from backup**,
Run workflow with mode **check**: it should say the backup opened and every checksum matches.
After that it runs by itself every night at 3:23 am (4:23 am in summer). If a night fails, GitHub emails you, and the
Monday report lists failed jobs.

## Put things back

Actions, **Restore from backup**, **Run workflow**. Pick the date (or `latest`) and a mode. Every mode only **adds
what is missing**: rows already there are never changed or deleted, so running it twice does nothing the second time.

| Mode | When | What it does |
|---|---|---|
| `check` | any time | Opens the backup and checks every file in it. Changes nothing. |
| `person` | one person lost their things (a bad sync, a bug) | Puts back that person's missing rows (settings, trips, rides, spots, posts) and photos. Give their user id: Supabase, Authentication, Users, copy the User UID. If their account itself is gone (deleted by mistake), it comes back too. |
| `missing` | many people lost things in one bad day | Puts back every missing row and photo, for people who still have an account, and rows that belong to no account (shared cabin trips, usage). Accounts deleted since the backup stay deleted. Optional: one table only (for example `shared_trips`). |
| `new-project` | the Supabase project itself is gone | Loads everything (tables, rules, functions, accounts, rows, photos) into a **new, empty** Supabase project. See below. |

Things to know:

- A person's **newer** changes always win: if a trip was edited after the backup, the edit stays.
- Something a person **deleted on purpose** after the backup comes back with `missing` or `person`. Use the
  narrowest mode, and the newest backup from before the problem.
- "I agree" records are kept without the account when an account is deleted (privacy page); a restored account does
  not get them linked again.

### Whole project lost (`new-project`)

1. Create a new Supabase project (same region if possible).
2. Add three secrets to the repository: `NEW_SUPABASE_DB_URL` (its Session pooler URI, as in step 2 above),
   `NEW_SUPABASE_URL` (`https://<new project>.supabase.co`) and `NEW_SUPABASE_SECRET_KEY` (its secret key).
3. Run **Restore from backup** with mode `new-project`. It stops if the new project already has accounts.
4. Then point the app at the new project (the Supabase address and publishable key in `account.js` and the
   workflows), set the sign-in settings again (Authentication, URL configuration and the email sender), and
   redeploy the Edge Functions in `supabase/functions/`. Then, for accounts deleted since the backup date,
   delete them again (Supabase, Authentication, Users).

## Run it yourself

```bash
# make a backup into ./backup-out (needs psql and pg_dump 15 or newer, gpg, jq, curl)
SUPABASE_DB_URL='...' BACKUP_PASSWORD='...' SUPABASE_SECRET_KEY='...' bash scripts/backup/backup.sh
# open and check one
BACKUP_PASSWORD='...' bash scripts/backup/restore.sh check backup-out/tf-backup-2026-11-19.tgz.gpg
```

Inside the encrypted file: `db/schema.sql` (tables, functions, row-level security rules), `db/data-auth.sql`
(accounts and photo records), `db/data-public.sql` (every row), `json/<table>.json` (the same rows, used by `person`
and `missing`), `files/<bucket>/...` (photos), `manifest.txt` (counts) and `checksums.sha256`.

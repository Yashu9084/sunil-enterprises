# Render Free + MongoDB Atlas

This is the current deployment route. AWS files are retained as an alternative; they are not required. No public service has been created by committing this configuration.

## Deploy through your own accounts

1. In MongoDB Atlas, create or select a **Free/M0** replica-set cluster. Prefer Singapore, matching the Render Blueprint, if offered in your free-region choices. Do not select a paid tier unless intended.
2. Under **Database Access**, create a dedicated database user. Give it `readWrite` access to the `sunil_enterprises` database only; it does not need Atlas organization/project administration. Save a generated password in your password manager.
3. Choose **Connect → Drivers → Node.js**. Copy the `mongodb+srv://...` connection string. Replace the password placeholder with the database user's password, URL-encoding special characters. Keep `retryWrites=true&w=majority`. This is a database credential, not your Atlas website login. Keep the completed URI private.
4. Open [Deploy to Render](https://render.com/deploy?repo=https://github.com/Yashu9084/sunil-enterprises). Alternatively choose **New → Blueprint**, connect GitHub, grant access to this repository and choose branch `main`. Render reads `render.yaml` from the repository.
5. Confirm the web service uses the **Free** plan, Singapore and Node 24. Paste the complete Atlas URI into the private `MONGODB_URI` field. The Blueprint sets `MONGODB_DB=sunil_enterprises`, `STORAGE_BACKEND=mongodb`, production mode and proxy trust. It generates a private `SETUP_TOKEN`. No persistent Render disk, custom domain or Caddy service is needed.
6. In Render, find the service's **Connect / Outbound** addresses (the dashboard may call these outbound IP ranges). Add **all listed addresses/ranges** to Atlas **Network Access → IP Access List**. Use the ranges shown for your service rather than assuming Render has one permanent outbound IP. If the initial deploy starts before Atlas network access is ready, fix the allowlist, then manually deploy again.
7. Wait for a successful deployment and healthy `/api/status`. Open the HTTPS `onrender.com` URL shown by Render. Use this URL on phones and for PWA installation. Render supplies the trusted HTTPS certificate; use its hostname rather than an IP address.
8. In Render's **Environment** settings, privately reveal/copy the generated `SETUP_TOKEN`. Enter it on the app's first-owner setup screen. Set your own owner username and strong password. Do not send the token, MongoDB URI, database password or owner password in chat. The token is needed only for first-owner setup.
9. With fictitious records, check one signed estimate, one purchase, GST and non-GST balances, a direct customer-to-supplier payment, PDF sharing and phone installation. Restart/redeploy the service and verify those records and the signature remain. Create an encrypted backup and keep the file and passphrase safely in separate places before entering real books.
10. Send only the public `https://...onrender.com` URL back for external verification. The deployment cannot be verified from GitHub push success alone.

Automatic deploys are off in the Blueprint. After reviewing a change and CI checks, use **Manual Deploy → Deploy latest commit** in Render. Preserve the same Atlas URI and database name across deploys. Never replace the database with a new empty one just to fix a login.

## What persists and how money is protected

MongoDB Atlas is the authoritative record store. `ledger_rows` contains separate records for users, parties, signed documents (including proof image data), payments, allocations, adjustments, audit entries, settings and sessions. `ledger_meta` contains the format and committed revision. This is not a periodic SQLite upload or an ephemeral-only database. Treat these collections as app-owned: manual Atlas edits bypass revision checks and must not be used to correct shop transactions.

The existing integer-paise calculation/validation engine uses a private, disposable SQLite projection in a random temporary directory. Each process rebuilds it from a consistent MongoDB snapshot, and detects revision changes before serving another API request. Startup streams MongoDB rows instead of loading all proof images into memory at once. A commit scans row fingerprints and sends only changed records to MongoDB; the work still grows with ledger size and should be measured before scaling a large shop.

The whole request's changes commit in one MongoDB transaction with majority acknowledgement and a revision comparison. The app withholds the successful response and login cookie until that commit succeeds. A concurrent writer cannot spend the same balance using an old projection; it receives a conflict and must refresh/retry. Failed requests discard local changes before the next request. A network failure around commit can leave the outcome temporarily uncertain, so reuse the same estimate/payment request ID on retry. Do not recreate a payment as a new entry simply because the response was interrupted.

All authenticated API access inside one process is serialized, including async proof handling and restore. MongoDB must support transactions: Atlas replica sets do, a standalone local `mongod` does not. Startup fails closed when MongoDB is unavailable; Render is never allowed to silently fall back to its temporary disk.

## Backups and recovery

Free Render web services do not provide a persistent disk or dependable always-running scheduled jobs. This Blueprint does **not** claim automatic scheduled backups. In the owner UI, download an encrypted backup after the day's work and store dated copies outside Atlas/Render. Retain the passphrase separately and regularly test restoration. Atlas replication is not a substitute for an independent backup.

Existing `.skbackup` files remain compatible. To move existing SQLite shop data to Atlas, first make an encrypted backup, set up the Render owner, then use the owner backup preview/restore workflow. This deliberately replaces the target books after typed confirmation and invalidates sessions. It is not an automatic data import from any developer's local directory.

Before browser restore, an encrypted pre-restore snapshot is retained in Atlas `restore_safety`. It uses the passphrase entered for that restore and survives host restarts. Only complete backups have a `ready` manifest. The restore response includes its safety ID; operators can also inspect ready manifests in Atlas. Retain/clean incomplete chunks and old safety backups under an explicit retention policy to avoid exhausting the free storage quota.

For CLI operations, securely configure `MONGODB_URI`, `MONGODB_DB=sunil_enterprises` and `BACKUP_PASSPHRASE` in a trusted operator terminal. Add that terminal's public IP to Atlas temporarily, then remove it afterwards. Never put credentials in shell history or command-line arguments. `owner:create`, `owner:reset`, `backup`, and `backup:restore` use MongoDB when configured; without a URI they target a local SQLite installation. Stop/suspend the web service before operator writes or restore, and resume after verification. Free Render may not provide a web shell: run these commands from a trusted computer with Node 24+ instead.

```sh
npm run backup -- /secure/location/shop.skbackup
npm run backup:check -- /secure/location/shop.skbackup
# Suspend the web service first; explicitly configure CONFIRM_RESTORE=RESTORE.
npm run backup:restore -- /secure/location/shop.skbackup
# Recover an encrypted safety snapshot using its ready-manifest ID:
node scripts/safety-backup.mjs BACKUP_ID /secure/location/safety.skbackup
```

Operator owner reset reads the new password from a hidden terminal prompt. Restore uses the owner accounts in the backup. Do not upload password hashes or plaintext database exports to GitHub. The backup instructions in [OPERATIONS.md](OPERATIONS.md) still apply; the local `DATA_DIR` is not a recoverable authoritative ledger in MongoDB mode.

## Free-plan limits

Render Free can sleep after inactivity (commonly 15 minutes), so the first visit may take roughly a minute to wake. Limits include shared monthly free instance hours and limited memory/CPU; current limits and eligibility must be checked in your account. Avoid artificial keep-alive traffic. A sleeping service cannot accept financial writes until it wakes.

Atlas Free has limited storage (commonly 512 MB), including signed images, indexes and safety backups, with separate connection/throughput limits and idle-cluster policies. Large paper photos consume storage faster than drawn signatures. Monitor Atlas usage and Render memory/errors. Choose an always-on plan and adequate database capacity if wake-up delay or growth interferes with the shop rush. Free tiers provide no promise of uninterrupted availability or unlimited permanent free storage.

## Local verification

```sh
npm test
npm run test:browser
# Docker required; creates and removes a disposable MongoDB replica set:
npm run test:mongo -- --browser
```

Mongo tests cover financial transaction rollback after an injected database failure, optimistic concurrency, signed evidence and session survival after a forced process kill with a new empty filesystem, payment retry deduplication, cross-GST balances, the API lifecycle and browser workflow. No real Atlas account or business data is used for these tests.

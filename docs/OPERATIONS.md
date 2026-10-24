# Operations and recovery

For **Render + MongoDB Atlas**, follow [RENDER.md](RENDER.md) first. MongoDB is authoritative; its temporary SQLite calculation cache is rebuilt on restart. Operator commands now use MongoDB when `MONGODB_URI` is configured. Local-disk persistence and local pre-restore snapshots below describe standalone SQLite installations. Render Free does not provide scheduled backups in this configuration: download independent encrypted copies regularly.


## Data and access

Use Node 24+, one application process and a persistent local `DATA_DIR`. It contains SQLite/WAL files and signed images inside the database. The application uses transactions and foreign keys; never reset or delete this directory to fix a login issue. Keep file access limited to the service account. Never commit the directory, `.env`, backups or credentials.

Production owner setup is closed unless a private `SETUP_TOKEN` is configured. Prefer creating the owner privately via CLI before exposure:

```sh
npm run owner:create -- --username owner --name 'Shop owner'
```

The CLI prompts for a hidden password; do not place passwords in arguments or shell history. Stop the app before administrative recovery. To recover a forgotten owner password without deleting records:

```sh
npm run owner:reset -- --username owner
```

This revokes the owner's previous sessions. Staff passwords and active access are managed through the owner's app interface. Use long unique passwords and a password manager.

## Backups

In the owner UI choose **Encrypted backup**. Enter the account password and a separate backup passphrase. The `.skbackup` uses AES-256-GCM authenticated encryption with a random salt/IV and scrypt-derived key. It includes users/password hashes, financial records, proof images and audit history; it omits live sessions. Keep passphrases outside the backup location. JSON export is a readable archive, not the disaster-recovery format.

For scheduled or larger backups, securely inject `BACKUP_PASSPHRASE` into the job environment and run:

```sh
npm run backup -- /secure-backup-location/shop-timestamp.skbackup
npm run backup:check -- /secure-backup-location/shop-timestamp.skbackup
```

Create the destination directory first. The command refuses to overwrite an existing file. Schedule at least daily and copy encrypted files off the server using your chosen backup provider. Keep multiple dated copies and test a restore into a separate data directory. Production scheduling/off-server storage is configured when the deployment target is chosen; a backup on the same server alone is insufficient disaster recovery.

Do not copy a live SQLite main file by itself: committed records may still be in its WAL. The app/CLI backup uses a consistent SQLite snapshot.

## Restore

Browser restore (up to 40 MB) requires an authenticated owner, current account password, backup passphrase, successful preview and typed `RESTORE`. It validates integrity and foreign keys, retains a restricted local pre-restore safety snapshot, swaps the database, invalidates sessions and logs the restoration. Sign in with the credentials contained in the backup. The safety copy is plaintext and must remain restricted; include its handling in your retention policy.

For an offline restore, **stop the app first**. Securely inject `BACKUP_PASSPHRASE`, set `CONFIRM_RESTORE=RESTORE` and use:

```sh
npm run backup:check -- /path/to/file.skbackup
npm run backup:restore -- /path/to/file.skbackup
```

Set `DATA_DIR` to the intended destination. The existing database is snapshotted before replacement; sessions in the restored database are removed. Restart the app and verify counts, one customer/supplier balance, a direct payment and a signed PDF. Test in a separate directory before replacing real books. Do not run offline restore against a running server or multiple replicas.

## Reconciliation and corrections

The app does not read bank feeds. Confirm payer, recipient, reference and amount against the actual statement. For direct payments, select each side’s GST category independently. Owner reconciliation flags record that check. Reversed records stay visible and stop affecting balances. Returns may create negative balances (credits); refund those or explicitly apply estimate credit to another record in the same party/category. The account total is authoritative; unapplied credits may coexist with individual unpaid estimates.

Never fix money by editing the SQLite file, mutating a signed estimate or deleting a row. Use the audited correction workflows. When importing paper accounts, enter opening balances once and keep original signed papers unless their proof has been captured. If an opening is wrong, reverse it and enter its corrected replacement.

## Updates

Take and authenticate a backup first. Stop the app, install locked dependencies, build and restart. Additive schema migrations run on startup and are repeatable. Do not roll old code back against a newer database schema without a tested matching backup. Verify the ledger tests in a disposable database and perform the smoke workflow before switching traffic.

See [deployment preparation](DEPLOYMENT.md) for the supplied container configuration. Deployment instructions do not themselves create a public service. The Render Blueprint is configured separately through your account.


## Clear business records while preserving the shop

The owner can open **Shop & staff** (phone: **More**) → **Delete business data**, enter the current owner password, and type `DELETE SHOP DATA`. This clears customers/suppliers, estimates and their images, purchases, payments, allocations, opening balances, corrections, reconciliation entries and prior transaction audit history. Shop settings and every user account/password/role remain. Sessions are revoked on all devices; sign in again with the same credentials. One security audit event records that the reset occurred, without retaining original financial rows.

The financial deletion is transactional, including its MongoDB revision commit; failure does not intentionally leave a partially emptied book. Previously downloaded/off-server backups and Atlas `restore_safety` copies are not deleted by this operation. Do not restore an old backup unless you intend to bring those records back. A local workspace reset does not reset a live Render/Atlas deployment: perform the reset through the live app using its authenticated owner account.

import { resolve } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openLedger } from "../server/ledger.js";
import {
  snapshot,
  encryptBackup,
  decryptBackup,
  validateBackup,
} from "../server/backups.js";
const mode = process.argv[2] || "create",
  dir = resolve(process.env.DATA_DIR || "data"),
  path = resolve(dir, "shop.sqlite"),
  file = process.argv[3];
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase)
  throw Error("Supply BACKUP_PASSPHRASE through a secure environment binding.");
if (!file)
  throw Error("Usage: node scripts/backup.mjs create|check|restore FILE");
if (!["create", "check", "restore"].includes(mode))
  throw Error("Unknown backup action.");
if (mode === "create") {
  const db = openLedger(path);
  try {
    const bytes = encryptBackup(snapshot(db), passphrase);
    writeFileSync(resolve(file), bytes, { mode: 0o600, flag: "wx" });
    console.log("Encrypted backup created. Store a copy off this server.");
  } finally {
    db.close();
  }
} else {
  const bytes = decryptBackup(readFileSync(resolve(file)), passphrase);
  const info = validateBackup(bytes);
  if (mode === "check")
    console.log(
      "Backup authenticated; integrity and foreign keys valid. Records:",
      JSON.stringify(info.counts),
    );
  else {
    if (process.env.CONFIRM_RESTORE !== "RESTORE")
      throw Error(
        "Stop the application and set CONFIRM_RESTORE=RESTORE to replace its database.",
      );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
      const current = openLedger(path);
      try {
        writeFileSync(
          resolve(dir, "pre-restore-" + Date.now() + ".sqlite"),
          snapshot(current),
          { mode: 0o600 },
        );
      } finally {
        current.close();
      }
    }
    const replacement = resolve(dir, "restore-" + Date.now() + ".sqlite");
    writeFileSync(replacement, bytes, { mode: 0o600 });
    const db = openLedger(replacement);
    db.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    renameSync(replacement, path);
    chmodSync(path, 0o600);
    console.log(
      "Restored. Sign in with an owner account contained in the backup.",
    );
  }
}

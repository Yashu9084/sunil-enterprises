import { resolve } from "node:path";
import { writeFileSync, readFileSync, renameSync, chmodSync } from "node:fs";
import { openOperatorStore } from "../server/operator-store.js";
import { openLedger } from "../server/ledger.js";
import {
  snapshot,
  encryptBackup,
  decryptBackup,
  validateBackup,
} from "../server/backups.js";
const mode = process.argv[2] || "create",
  file = process.argv[3];
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase)
  throw Error("Supply BACKUP_PASSPHRASE through a secure environment binding.");
if (!file)
  throw Error("Usage: node scripts/backup.mjs create|check|restore FILE");
if (!["create", "check", "restore"].includes(mode))
  throw Error("Unknown backup action.");
const bytes =
  mode === "create"
    ? null
    : decryptBackup(readFileSync(resolve(file)), passphrase);
const info = bytes ? validateBackup(bytes) : null;
if (mode === "check") {
  console.log(
    "Backup authenticated; integrity and foreign keys valid. Records:",
    JSON.stringify(info.counts),
  );
} else {
  if (mode === "restore" && process.env.CONFIRM_RESTORE !== "RESTORE")
    throw Error(
      "Stop the application and set CONFIRM_RESTORE=RESTORE to replace its database.",
    );
  const storage = await openOperatorStore();
  try {
    if (mode === "create") {
      writeFileSync(
        resolve(file),
        encryptBackup(snapshot(storage.db), passphrase),
        { mode: 0o600, flag: "wx" },
      );
      console.log("Encrypted backup created. Store a copy off this server.");
    } else {
      const safety = snapshot(storage.db);
      if (storage.mongo) {
        const id = await storage.mongo.retainSafetyBackup(
          encryptBackup(safety, passphrase),
        );
        console.log(
          "Encrypted pre-restore safety backup retained in MongoDB:",
          id,
        );
      } else {
        writeFileSync(
          resolve(storage.directory, "pre-restore-" + Date.now() + ".sqlite"),
          safety,
          { mode: 0o600 },
        );
      }
      const replacement = resolve(
        storage.directory,
        "restore-" + Date.now() + ".sqlite",
      );
      writeFileSync(replacement, bytes, { mode: 0o600 });
      const restored = openLedger(replacement);
      restored.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)");
      restored.close();
      storage.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      storage.db.close();
      try {
        renameSync(replacement, storage.path);
      } finally {
        storage.db = openLedger(storage.path);
      }
      chmodSync(storage.path, 0o600);
      await storage.mongo?.persist();
      console.log(
        "Restored. Sign in with an owner account contained in the backup.",
      );
    }
  } finally {
    await storage.close();
  }
}

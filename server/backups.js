import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const magic = Buffer.from("SUNILKHATA1");
function key(password, salt) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw Error("Backup passphrase must contain 12–256 characters.");
  return scryptSync(password, salt, 32);
}
export function encryptBackup(bytes, password) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(password, salt), iv),
    body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), body]);
}
export function decryptBackup(bytes, password) {
  if (
    bytes.length < magic.length + 44 ||
    !bytes.subarray(0, magic.length).equals(magic)
  )
    throw Error("Not a Sunil Khata encrypted backup.");
  const offset = magic.length,
    salt = bytes.subarray(offset, offset + 16),
    iv = bytes.subarray(offset + 16, offset + 28),
    tag = bytes.subarray(offset + 28, offset + 44);
  try {
    const cipher = createDecipheriv("aes-256-gcm", key(password, salt), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([
      cipher.update(bytes.subarray(offset + 44)),
      cipher.final(),
    ]);
  } catch {
    throw Error("Incorrect backup passphrase or damaged backup.");
  }
}
export function snapshot(db) {
  const dir = mkdtempSync(join(tmpdir(), "sunil-backup-")),
    file = join(dir, "snapshot.sqlite");
  try {
    db.prepare("VACUUM INTO ?").run(file);
    const copy = new DatabaseSync(file);
    copy.exec("DELETE FROM sessions;");
    copy.close();
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export function validateBackup(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "sunil-check-")),
    file = join(dir, "check.sqlite");
  let d;
  try {
    writeFileSync(file, bytes, { mode: 0o600 });
    d = new DatabaseSync(file, { readOnly: true });
    if (
      d.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      d.prepare("PRAGMA foreign_key_check").all().length
    )
      throw Error("Backup database validation failed.");
    for (const table of [
      "users",
      "parties",
      "documents",
      "payments",
      "adjustments",
      "allocations",
      "reversals",
      "audit",
      "settings",
    ])
      if (
        !d
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table)
      )
        throw Error("Backup schema is unsupported.");
    if (
      !d.prepare("SELECT id FROM users WHERE role='owner' AND active=1").get()
    )
      throw Error("Backup has no active owner.");
    const users = d
      .prepare("SELECT id,name,username,role,active FROM users")
      .all();
    const counts = Object.fromEntries(
      ["parties", "documents", "payments", "adjustments"].map((t) => [
        t,
        d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n,
      ]),
    );
    return { users, counts };
  } catch (e) {
    throw Error(
      e.message.startsWith("Backup")
        ? e.message
        : "Backup database validation failed.",
    );
  } finally {
    d?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

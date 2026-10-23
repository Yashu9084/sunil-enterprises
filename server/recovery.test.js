import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
test("operator CLI bootstraps, resets, authenticates backups, and restores to a separate directory", () => {
  const root = mkdtempSync(join(tmpdir(), "sunil-recovery-")),
    source = join(root, "source"),
    target = join(root, "target"),
    file = join(root, "shop.skbackup"),
    pass = randomBytes(16).toString("hex"),
    backupPass = randomBytes(16).toString("hex");
  const run = (script, args = [], input = "", extra = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        DATA_DIR: source,
        BACKUP_PASSPHRASE: backupPass,
        ...extra,
      },
      input,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    run(
      "scripts/admin.mjs",
      ["create", "--username", "owner", "--name", "Shop owner"],
      pass,
    );
    run(
      "scripts/admin.mjs",
      ["reset", "--username", "owner"],
      randomBytes(16).toString("hex"),
    );
    run("scripts/backup.mjs", ["create", file]);
    assert.match(
      run("scripts/backup.mjs", ["check", file]),
      /integrity and foreign keys valid/,
    );
    run("scripts/backup.mjs", ["restore", file], "", {
      DATA_DIR: target,
      CONFIRM_RESTORE: "RESTORE",
    });
    const db = new DatabaseSync(join(target, "shop.sqlite"), {
      readOnly: true,
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner'").get().n,
      1,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

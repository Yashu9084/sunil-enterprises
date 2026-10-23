import { parseArgs } from "node:util";
import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { openLedger } from "../server/ledger.js";
import { audit, transaction } from "../server/operations.js";
const action = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: { name: { type: "string" }, username: { type: "string" } },
});
if (!["create", "reset"].includes(action) || !values.username) {
  console.error(
    "Usage: node scripts/admin.mjs create|reset --username OWNER [--name NAME]. Stop the application first.",
  );
  process.exit(1);
}
async function secret() {
  if (!stdin.isTTY) {
    const value = readFileSync(0, "utf8").replace(/\r?\n$/, "");
    return value;
  }
  stdout.write("Password (12–256 characters): ");
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  return new Promise((resolve, reject) => {
    let value = "";
    const on = (text, key) => {
      if (key.ctrl && key.name === "c") {
        stdin.setRawMode(false);
        stdin.removeListener("keypress", on);
        reject(Error("Cancelled."));
      } else if (key.name === "return") {
        stdin.setRawMode(false);
        stdin.removeListener("keypress", on);
        stdin.pause();
        stdout.write("\n");
        resolve(value);
      } else if (key.name === "backspace") value = value.slice(0, -1);
      else if (!key.ctrl && text) value += text;
    };
    stdin.on("keypress", on);
    stdin.resume();
  });
}
const password = await secret();
if (
  password.length < 12 ||
  password.length > 256 ||
  !/^[a-zA-Z0-9_.-]{3,50}$/.test(values.username)
)
  throw Error(
    "Use a valid username (3–50 letters/digits/._-) and a password of 12–256 characters.",
  );
const dir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = openLedger(resolve(dir, "shop.sqlite"));
try {
  transaction(db, () => {
    const salt = randomBytes(16).toString("hex"),
      hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
    if (action === "create") {
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        throw Error(
          "The shop already has accounts. Use reset to recover its owner.",
        );
      if (!values.name?.trim()) throw Error("Provide --name for the owner.");
      const r = db
        .prepare("INSERT INTO users(name,username,hash,role) VALUES(?,?,?,?)")
        .run(values.name, values.username.toLowerCase(), hash, "owner");
      audit(
        db,
        Number(r.lastInsertRowid),
        "bootstrap",
        "user",
        Number(r.lastInsertRowid),
      );
    } else {
      const u = db
        .prepare("SELECT id FROM users WHERE username=? AND role='owner'")
        .get(values.username.toLowerCase());
      if (!u) throw Error("Owner account not found.");
      db.prepare("UPDATE users SET hash=?,active=1 WHERE id=?").run(hash, u.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
      audit(db, u.id, "recovery", "user", u.id);
    }
  });
  console.log(
    action === "create"
      ? "Owner account created."
      : "Owner password reset; old sessions revoked.",
  );
} finally {
  db.close();
}

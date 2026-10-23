import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { openLedger } from "./ledger.js";
import { MongoLedgerStore } from "./mongo-store.js";
export async function startTestServer(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sunil-api-"));
  const uri = extra.MONGODB_URI ?? process.env.TEST_MONGODB_URI ?? "";
  const database =
    extra.MONGODB_DB || "sunil_test_" + randomUUID().replaceAll("-", "");
  const child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      // Never let a developer's real database leak into disposable tests.
      RENDER: "false",
      MONGODB_URI: uri,
      MONGODB_DB: database,
      STORAGE_BACKEND: process.env.TEST_MONGODB_URI ? "mongodb" : "sqlite",
      NODE_ENV: "production",
      ALLOW_LOCAL_SETUP: "1",
      PORT: "0",
      DATA_DIR: dir,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server did not start: " + output)),
      45000,
    );
    child.stdout.on("data", (b) => {
      output += b;
      const match = output.match(/listening on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (b) => (output += b));
    child.on("exit", () => {
      clearTimeout(timer);
      reject(Error("Server exited: " + output));
    });
  });
  return {
    get output() {
      return output;
    },
    base: `http://localhost:${port}`,
    dir,
    database,
    async seed(fn) {
      const cacheDir = uri ? mkdtempSync(join(tmpdir(), "sunil-seed-")) : dir;
      const db = openLedger(join(cacheDir, "shop.sqlite"));
      let store;
      try {
        if (uri)
          store = await MongoLedgerStore.connect({
            uri,
            database,
            getLedger: () => db,
          });
        fn(db);
        await store?.persist();
      } finally {
        db.close();
        await store?.close();
        if (uri) rmSync(cacheDir, { recursive: true, force: true });
      }
    },
    async close(signal = "SIGTERM") {
      child.kill(signal);
      await new Promise((r) =>
        child.exitCode !== null || child.signalCode !== null
          ? r()
          : child.once("exit", r),
      );
      rmSync(dir, { recursive: true, force: true });
      if (uri && !extra.MONGODB_DB) {
        const client = await new MongoClient(uri).connect();
        try {
          await client.db(database).dropDatabase();
        } finally {
          await client.close();
        }
      }
    },
  };
}

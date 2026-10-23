import { mkdtempSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { openLedger } from "./ledger.js";
import { MongoLedgerStore } from "./mongo-store.js";

export async function openOperatorStore() {
  const remote =
    process.env.STORAGE_BACKEND === "mongodb" ||
    Boolean(process.env.MONGODB_URI);
  if ((remote || process.env.RENDER === "true") && !process.env.MONGODB_URI)
    throw Error(
      "MONGODB_URI is required; refusing local-only operator changes.",
    );
  const directory = remote
    ? mkdtempSync(join(tmpdir(), "sunil-operator-"))
    : resolve(process.env.DATA_DIR || "data");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "shop.sqlite");
  const storage = {
    directory,
    path,
    remote,
    db: openLedger(path),
    mongo: null,
  };
  chmodSync(path, 0o600);
  try {
    if (remote)
      storage.mongo = await MongoLedgerStore.connect({
        uri: process.env.MONGODB_URI,
        database: process.env.MONGODB_DB || "sunil_enterprises",
        getLedger: () => storage.db,
      });
  } catch (error) {
    storage.db.close();
    if (remote) rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  storage.close = async () => {
    storage.db.close();
    await storage.mongo?.close();
    if (remote) rmSync(directory, { recursive: true, force: true });
  };
  return storage;
}

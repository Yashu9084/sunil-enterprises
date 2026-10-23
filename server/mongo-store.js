import { createHash } from "node:crypto";
import { MongoClient, BSON } from "mongodb";
import { migrateOperations } from "./operations.js";

// MongoDB is authoritative. SQLite is a disposable projection for the existing
// exact-money rules, joins and PDF generation; its files are never durability.
export class StoreConflictError extends Error {}
export function ledgerTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => {
      if (!/^[a-z_]+$/.test(name)) throw Error("Unsupported ledger table.");
      const columns = db.prepare(`PRAGMA table_info(${name})`).all();
      const primary = columns
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      if (!primary.length) throw Error("Ledger table has no primary key.");
      return { name, columns: columns.map((c) => c.name), primary };
    });
}
export function* ledgerRows(db) {
  for (const { name, primary } of ledgerTables(db)) {
    for (const raw of db.prepare(`SELECT * FROM ${name}`).iterate()) {
      const row = { ...raw };
      const _id = name + ":" + JSON.stringify(primary.map((key) => row[key]));
      const document = { _id, table: name, row };
      if (BSON.calculateObjectSize(document) > 15 * 1024 * 1024)
        throw Error("Signed record is too large. Use a smaller proof photo.");
      yield [_id, document];
    }
  }
}
function fingerprint(document) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}
async function projectRows(db, documents) {
  const baseline = new Map();
  const tables = ledgerTables(db),
    allowed = new Map(tables.map((t) => [t.name, t]));
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    for (const { name } of tables) db.exec(`DELETE FROM ${name}`);
    for await (const { _id, table, row } of documents) {
      baseline.set(_id, fingerprint({ _id, table, row }));
      const spec = allowed.get(table);
      if (!spec || !row || typeof row !== "object")
        throw Error("Unsupported MongoDB ledger schema.");
      const columns = Object.keys(row);
      if (columns.some((c) => !spec.columns.includes(c)))
        throw Error("MongoDB ledger requires a newer app version.");
      db.prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      ).run(...columns.map((c) => row[c]));
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("MongoDB ledger references failed validation.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
  migrateOperations(db);
  return baseline;
}

export class MongoLedgerStore {
  constructor(client, database, getLedger) {
    this.client = client;
    this.database = database;
    this.getLedger = getLedger;
    this.rows = database.collection("ledger_rows");
    this.meta = database.collection("ledger_meta");
    this.revision = null;
    this.baseline = new Map();
    this.dirty = true;
  }
  static async connect({ uri, database, getLedger }) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      retryWrites: true,
    });
    try {
      await client.connect();
      const store = new MongoLedgerStore(
        client,
        client.db(database),
        getLedger,
      );
      await store.initialize();
      return store;
    } catch (error) {
      await client.close();
      // Never print a driver error that might include credentials or a URI.
      throw Error(
        "MongoDB connection failed. Check the private URI, database permissions, network access and replica-set transaction support.",
      );
    }
  }
  async initialize() {
    await this.meta.updateOne(
      { _id: "ledger" },
      { $setOnInsert: { revision: 0, format: 1 } },
      { upsert: true, writeConcern: { w: "majority" } },
    );
    await this.rows.createIndex({ table: 1 });
    await this.refresh();
    // Also proves that multi-document transactions are supported before listen.
    await this.persist();
  }
  invalidate() {
    this.dirty = true;
  }
  async refresh() {
    const head = await this.meta.findOne(
      { _id: "ledger" },
      { readConcern: { level: "majority" } },
    );
    if (!head || head.format !== 1)
      throw Error("Unsupported MongoDB ledger format.");
    if (!this.dirty && head.revision === this.revision) return;
    this.dirty = true;
    const session = this.client.startSession();
    let loaded;
    try {
      await session.withTransaction(
        async () => {
          const meta = await this.meta.findOne({ _id: "ledger" }, { session });
          if (!meta || meta.format !== 1)
            throw Error("Unsupported MongoDB ledger format.");
          const baseline = await projectRows(
            this.getLedger(),
            this.rows.find({}, { session }).batchSize(50),
          );
          loaded = { meta, baseline };
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          maxCommitTimeMS: 15000,
          // Keep driver CSOT off for streaming non-awaitData getMore cursors.
          // Connection/socket deadlines still apply to snapshot reads.
        },
      );
    } finally {
      await session.endSession();
    }
    this.revision = loaded.meta.revision;
    this.baseline = loaded.baseline;
    this.dirty = false;
  }
  async persist() {
    if (this.dirty)
      throw Error("MongoDB projection must be refreshed before saving.");
    const current = new Map(),
      operations = [];
    for (const [id, doc] of ledgerRows(this.getLedger())) {
      const digest = fingerprint(doc);
      current.set(id, digest);
      if (digest !== this.baseline.get(id))
        operations.push({
          replaceOne: { filter: { _id: id }, replacement: doc, upsert: true },
        });
    }
    for (const id of this.baseline.keys())
      if (!current.has(id))
        operations.push({ deleteOne: { filter: { _id: id } } });
    if (!operations.length) return;
    const session = this.client.startSession();
    const revision = this.revision;
    try {
      await session.withTransaction(
        async () => {
          const head = await this.meta.findOneAndUpdate(
            { _id: "ledger", revision, format: 1 },
            { $inc: { revision: 1 } },
            { session, returnDocument: "after" },
          );
          if (!head)
            throw new StoreConflictError(
              "Ledger changed in another process. Refresh and retry.",
            );
          await this.rows.bulkWrite(operations, { session, ordered: true });
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          maxCommitTimeMS: 15000,
          timeoutMS: 20000,
        },
      );
      this.baseline = current;
      this.revision = revision + 1;
    } catch (error) {
      this.invalidate();
      throw error;
    } finally {
      await session.endSession();
    }
  }
  // Safety snapshots survive a free-host restart. Stored in chunks below BSON's
  // document-size limit, with a ready manifest only after every chunk exists.
  async retainSafetyBackup(bytes) {
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID(),
      collection = this.database.collection("restore_safety");
    const size = 4 * 1024 * 1024;
    const chunks = [];
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += size, index++
    )
      chunks.push({
        _id: `${id}:${index}`,
        backup: id,
        index,
        bytes: new BSON.Binary(bytes.subarray(offset, offset + size)),
      });
    await collection.insertMany(chunks, { writeConcern: { w: "majority" } });
    await collection.insertOne(
      { _id: id, ready: true, chunks: chunks.length, createdAt: new Date() },
      { writeConcern: { w: "majority" } },
    );
    return id;
  }
  async close() {
    await this.client.close();
  }
}

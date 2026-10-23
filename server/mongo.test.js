import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { openLedger, recordPayment, balance } from "./ledger.js";
import { MongoLedgerStore, StoreConflictError } from "./mongo-store.js";
import { startTestServer } from "./test-support.js";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uri = process.env.TEST_MONGODB_URI;
const uniqueDatabase = () => "sunil_test_" + randomUUID().replaceAll("-", "");

test(
  "MongoDB transactions prevent concurrent overspending across independent application projections",
  { skip: !uri },
  async () => {
    const database = uniqueDatabase(),
      a = openLedger(":memory:"),
      b = openLedger(":memory:");
    let first, second;
    const client = await new MongoClient(uri).connect();
    try {
      first = await MongoLedgerStore.connect({
        uri,
        database,
        getLedger: () => a,
      });
      a.exec(
        "INSERT INTO users(id,name,username,hash,role) VALUES(1,'Owner','owner','test','owner'); INSERT INTO parties(id,name,kind) VALUES(1,'Customer','customer'); INSERT INTO documents(id,kind,party_id,tax_mode,items,total,created_by) VALUES(1,'sale',1,'gst','[]',10000,1)",
      );
      await first.persist();
      second = await MongoLedgerStore.connect({
        uri,
        database,
        getLedger: () => b,
      });
      const payment = {
        customer_id: 1,
        amount: 7500,
        tax_mode: "gst",
        reference: "TRANSFER-A",
        request_id: "concurrent-payment-a",
      };
      recordPayment(a, payment, 1);
      recordPayment(
        b,
        {
          ...payment,
          reference: "TRANSFER-B",
          request_id: "concurrent-payment-b",
        },
        1,
      );
      await first.persist();
      await assert.rejects(second.persist(), StoreConflictError);
      await second.refresh();
      assert.equal(balance(b, 1, "gst").receivable, 2500);
      assert.equal(b.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
      assert.throws(() =>
        recordPayment(
          b,
          {
            ...payment,
            reference: "TRANSFER-C",
            request_id: "concurrent-payment-c",
          },
          1,
        ),
      );
      const stored = await client
        .db(database)
        .collection("ledger_rows")
        .find({ table: "payments" })
        .toArray();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].row.amount, 7500);
    } finally {
      await first?.close();
      await second?.close();
      a.close();
      b.close();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);

test(
  "MongoDB failure after revision update aborts all financial rows and reloads the committed ledger",
  { skip: !uri || process.env.TEST_MONGODB_FAULTS !== "1" },
  async () => {
    const database = uniqueDatabase(),
      appName = randomUUID(),
      db = openLedger(":memory:");
    const client = await new MongoClient(uri, { appName }).connect();
    const admin = await new MongoClient(uri).connect();
    const store = new MongoLedgerStore(client, client.db(database), () => db);
    try {
      await store.initialize();
      db.exec(
        "INSERT INTO users(id,name,username,hash,role) VALUES(1,'Owner','owner','test','owner'); INSERT INTO parties(id,name,kind) VALUES(1,'Customer','customer'); INSERT INTO documents(id,kind,party_id,tax_mode,items,total,created_by) VALUES(1,'sale',1,'gst','[]',10000,1)",
      );
      await store.persist();
      const revision = store.revision;
      recordPayment(
        db,
        {
          customer_id: 1,
          amount: 5000,
          tax_mode: "gst",
          reference: "FAULT",
          request_id: "fault-payment-01",
        },
        1,
      );
      await admin
        .db("admin")
        .command({
          configureFailPoint: "failCommand",
          mode: { times: 1 },
          data: { failCommands: ["update"], appName, errorCode: 2 },
        });
      await assert.rejects(store.persist());
      assert.equal(
        (
          await client
            .db(database)
            .collection("ledger_meta")
            .findOne({ _id: "ledger" })
        ).revision,
        revision,
      );
      assert.equal(
        await client
          .db(database)
          .collection("ledger_rows")
          .countDocuments({ table: "payments" }),
        0,
      );
      assert.equal(
        await client
          .db(database)
          .collection("ledger_rows")
          .countDocuments({ table: "allocations" }),
        0,
      );
      await store.refresh();
      assert.equal(balance(db, 1, "gst").receivable, 10000);
    } finally {
      await admin
        .db("admin")
        .command({ configureFailPoint: "failCommand", mode: "off" });
      db.close();
      await client.db(database).dropDatabase();
      await store.close();
      await admin.close();
    }
  },
);

test(
  "signed proof, sessions and cross-GST direct payments survive a killed server and an empty filesystem",
  { skip: !uri },
  async () => {
    const database = uniqueDatabase(),
      client = await new MongoClient(uri).connect();
    const settings = {
      MONGODB_URI: uri,
      MONGODB_DB: database,
      STORAGE_BACKEND: "mongodb",
    };
    let server = await startTestServer(settings),
      cookie = "";
    const password = randomBytes(16).toString("hex");
    async function api(path, body) {
      const response = await fetch(server.base + "/api/" + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200, await response.clone().text());
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return response.json();
    }
    try {
      await api("setup", { name: "Owner", username: "owner", password });
      await api("login", { username: "owner", password });
      const customer = (
        await api("parties", { name: "Customer", kind: "customer" })
      ).id;
      const supplier = (
        await api("parties", { name: "Supplier", kind: "supplier" })
      ).id;
      const proof =
        "data:image/png;base64," +
        (
          await sharp({
            create: {
              width: 50,
              height: 30,
              channels: 3,
              background: "#123456",
            },
          })
            .png()
            .toBuffer()
        ).toString("base64");
      const sale = {
        kind: "sale",
        party_id: customer,
        tax_mode: "gst",
        items: [{ name: "Pipe", qty: 1, price: 10000, gst: 0 }],
        signature: proof,
        request_id: "persistent-sale-01",
      };
      const document = (await api("documents", sale)).id;
      const signature = (await api("documents/" + document)).signature;
      await api("documents", {
        kind: "purchase",
        party_id: supplier,
        tax_mode: "non-gst",
        items: [{ name: "Pipe", qty: 1, price: 10000, gst: 0 }],
        request_id: "persistent-purchase-01",
      });
      const payment = {
        customer_id: customer,
        supplier_id: supplier,
        amount: 4000,
        customer_tax_mode: "gst",
        supplier_tax_mode: "non-gst",
        reference: "PERSISTENT-UPI-01",
        request_id: "persistent-payment-01",
      };
      const id = (await api("payments", payment)).id;
      const originalDir = server.dir;
      await server.close("SIGKILL");
      server = await startTestServer(settings);
      assert.notEqual(server.dir, originalDir);
      const state = await api("state");
      assert.equal(state.payments.length, 1);
      assert.equal(
        state.parties.find((p) => p.id === customer).balances.gst.receivable,
        6000,
      );
      assert.equal(
        state.parties.find((p) => p.id === supplier).balances["non-gst"]
          .payable,
        6000,
      );
      assert.equal((await api("documents/" + document)).signature, signature);
      assert.equal((await api("documents", sale)).id, document);
      assert.equal((await api("payments", payment)).id, id);
      assert.equal((await api("state")).payments.length, 1);
      assert.equal(
        await client
          .db(database)
          .collection("ledger_rows")
          .countDocuments({ table: "payments" }),
        1,
      );
    } finally {
      await server.close();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);

test(
  "operator tools import an existing SQLite backup, reset the Atlas owner, export and recover durable safety snapshots",
  { skip: !uri },
  async () => {
    const database = uniqueDatabase(),
      directory = mkdtempSync(join(tmpdir(), "sunil-mongo-recovery-"));
    const password = randomBytes(16).toString("hex"),
      passphrase = randomBytes(16).toString("hex");
    const localBackup = join(directory, "local.skbackup"),
      remoteBackup = join(directory, "remote.skbackup"),
      safety = join(directory, "safety.skbackup");
    const client = await new MongoClient(uri).connect();
    const local = {
      MONGODB_URI: "",
      STORAGE_BACKEND: "sqlite",
      RENDER: "false",
      DATA_DIR: directory,
      BACKUP_PASSPHRASE: passphrase,
    };
    const remote = {
      ...local,
      MONGODB_URI: uri,
      STORAGE_BACKEND: "mongodb",
      MONGODB_DB: database,
    };
    const run = (script, args, environment, input) =>
      execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, ...environment },
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    try {
      run(
        "scripts/admin.mjs",
        ["create", "--username", "owner", "--name", "Owner"],
        local,
        password,
      );
      run("scripts/backup.mjs", ["create", localBackup], local);
      run("scripts/backup.mjs", ["restore", localBackup], {
        ...remote,
        CONFIRM_RESTORE: "RESTORE",
      });
      assert.equal(
        await client
          .db(database)
          .collection("ledger_rows")
          .countDocuments({ table: "users", "row.username": "owner" }),
        1,
      );
      run(
        "scripts/admin.mjs",
        ["reset", "--username", "owner"],
        remote,
        randomBytes(16).toString("hex"),
      );
      run("scripts/backup.mjs", ["create", remoteBackup], remote);
      assert.match(
        run("scripts/backup.mjs", ["check", remoteBackup], local),
        /integrity and foreign keys valid/,
      );
      // A second restore captures a nonempty, independently recoverable safety copy.
      run("scripts/backup.mjs", ["restore", localBackup], {
        ...remote,
        CONFIRM_RESTORE: "RESTORE",
      });
      const manifests = await client
        .db(database)
        .collection("restore_safety")
        .find({ ready: true })
        .sort({ createdAt: -1 })
        .toArray();
      assert.equal(manifests.length, 2);
      run("scripts/safety-backup.mjs", [manifests[0]._id, safety], remote);
      assert.ok(readFileSync(safety).length > 100);
      assert.match(
        run("scripts/backup.mjs", ["check", safety], local),
        /integrity and foreign keys valid/,
      );
    } finally {
      await client.db(database).dropDatabase();
      await client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./test-support.js";
test("owner reset removes the business book atomically but preserves organisation and accounts", async () => {
  const server = await startTestServer();
  let cookie = "";
  const password = "long-owner-test-password";
  async function api(path, body, status = 200) {
    const r = await fetch(server.base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const text = await r.text();
    assert.equal(r.status, status, text.slice(0, 300));
    return JSON.parse(text);
  }
  try {
    await api("setup", { name: "Owner", username: "owner", password });
    await api("login", { username: "owner", password });
    await api("users", { name: "Staff", username: "staff", password });
    await server.seed((db) => {
      db.exec(
        "INSERT INTO parties(id,name,kind) VALUES(1,'Customer','customer'); INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by) VALUES('sale',1,'gst','[]',10000,1); INSERT INTO payments(customer_id,amount,tax_mode,reference,created_by,request_id) VALUES(1,5000,'gst','PAID',1,'reset-payment-01'); INSERT INTO allocations(payment_id,side,document_id,amount) VALUES(1,'receivable',1,5000)",
      );
      db.prepare("INSERT OR REPLACE INTO settings VALUES('shop',?)").run(
        JSON.stringify({ name: "Keep this organisation" }),
      );
    });
    await api(
      "shop/reset-data",
      { current_password: "wrong", confirmation: "DELETE SHOP DATA" },
      400,
    );
    await api(
      "shop/reset-data",
      { current_password: password, confirmation: "" },
      400,
    );
    assert.equal((await api("state")).parties.length, 1);
    await api("login", { username: "staff", password });
    await api(
      "shop/reset-data",
      { current_password: password, confirmation: "DELETE SHOP DATA" },
      403,
    );
    await api("login", { username: "owner", password });
    const reset = await api("shop/reset-data", {
      current_password: password,
      confirmation: "DELETE SHOP DATA",
    });
    assert.equal(reset.deleted.documents, 1);
    assert.equal(reset.deleted.payments, 1);
    assert.equal(reset.backupsDeleted, false);
    await api("state", null, 401);
    await api("login", { username: "owner", password });
    const state = await api("state");
    assert.equal(state.parties.length, 0);
    assert.equal(state.documents.length, 0);
    assert.equal(state.payments.length, 0);
    assert.equal(state.users.length, 2);
    assert.equal(state.settings.name, "Keep this organisation");
    await api("login", { username: "staff", password });
    assert.equal((await api("state")).parties.length, 0);
  } finally {
    await server.close();
  }
});

test("a reset failure rolls back already-deleted financial rows", async () => {
  const { openLedger } = await import("./ledger.js");
  const { resetShopData } = await import("./reset-shop.js");
  const db = openLedger(":memory:");
  try {
    db.exec(
      "INSERT INTO users(id,name,username,hash,role) VALUES(1,'Owner','owner','test','owner'); INSERT INTO parties(id,name,kind) VALUES(1,'Customer','customer'); INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by) VALUES('sale',1,'gst','[]',10000,1); INSERT INTO payments(customer_id,amount,tax_mode,reference,created_by,request_id) VALUES(1,5000,'gst','PAID',1,'reset-rollback-01'); INSERT INTO allocations(payment_id,side,document_id,amount) VALUES(1,'receivable',1,5000); CREATE TRIGGER block_reset BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'Reset interrupted'); END",
    );
    assert.throws(() => resetShopData(db, 1), /Reset interrupted/);
    for (const table of [
      "parties",
      "documents",
      "payments",
      "allocations",
      "users",
    ])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1);
  } finally {
    db.close();
  }
});

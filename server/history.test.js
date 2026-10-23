import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startTestServer } from "./test-support.js";
test("paged history and selected-party balances include records outside the recent phone window", async () => {
  const service = await startTestServer();
  let cookie = "";
  const password = randomBytes(20).toString("hex");
  async function api(path, body) {
    const r = await fetch(service.base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(r.status, 200);
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r.json();
  }
  try {
    await api("setup", { name: "Owner", username: "owner", password });
    await api("login", { username: "owner", password });
    const party = (
      await api("parties", { name: "Long-running account", kind: "customer" })
    ).id;
    const db = new DatabaseSync(join(service.dir, "shop.sqlite"));
    db.exec("BEGIN");
    for (let i = 0; i < 600; i++)
      db.prepare(
        "INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by,created_at) VALUES('sale',?,'non-gst','[]',10000,1,'2025-01-01T00:00:00Z')",
      ).run(party);
    db.exec("COMMIT");
    db.close();
    const state = await api("state");
    assert.equal(state.documents.length, 250);
    assert.equal(state.today.count, 0);
    assert.equal(state.parties[0].balances["non-gst"].receivable, 6000000);
    const first = await api("records?type=document");
    assert.equal(first.rows.length, 50);
    assert.equal(first.total, 600);
    assert.equal(first.pages, 12);
    const oldest = await api("records?type=document&q=SE-0001");
    assert.equal(oldest.rows[0].id, 1);
    const open = await api("parties/" + party + "/open?mode=non-gst");
    assert.equal(open.length, 600);
    assert.equal(
      (await api("records?type=document&page=12")).rows.at(-1).id,
      1,
    );
  } finally {
    await service.close();
  }
});

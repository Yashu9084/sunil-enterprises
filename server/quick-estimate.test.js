import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { startTestServer } from "./test-support.js";
test("photo + total accepts no items, is idempotent and auditable, and participates in balances, filters and exports", async () => {
  const server = await startTestServer();
  let cookie = "";
  const password = "a-long-unique-password";
  const photo =
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 80, height: 100, channels: 3, background: "white" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  async function api(path, body, status = 200, raw = false) {
    const r = await fetch(server.base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const text = await r.text();
    assert.equal(r.status, status, text.slice(0, 300));
    return raw ? text : JSON.parse(text);
  }
  try {
    await api("setup", { name: "Owner", username: "owner", password });
    await api("login", { username: "owner", password });
    const party = (
      await api("parties", { name: "Quick customer", kind: "both" })
    ).id;
    const draft = {
      kind: "sale",
      tax_mode: "gst",
      party_id: party,
      entry_mode: "photo",
      items: [],
      total: 76000,
      photo,
      request_id: "quick-estimate-01",
    };
    await api("documents", { ...draft, photo: null }, 400);
    await api("documents", { ...draft, total: 1.01 }, 400);
    await api("documents", { ...draft, items: [{ name: "Hidden item" }] }, 400);
    const saved = await api("documents", draft);
    assert.equal((await api("documents", draft)).id, saved.id);
    await api("documents", { ...draft, total: 76100 }, 400);
    const record = await api("documents/" + saved.id);
    assert.deepEqual(record.items, []);
    assert.equal(record.entry_mode, "photo");
    assert.equal(record.total, 76000);
    assert.ok(record.photo);
    await api("documents", {
      ...draft,
      kind: "purchase",
      tax_mode: "non-gst",
      total: 50000,
      request_id: "quick-purchase-01",
    });
    const state = await api("state");
    assert.equal(state.parties[0].balances.gst.receivable, 76000);
    assert.equal(state.parties[0].balances["non-gst"].payable, 50000);
    const filtered = await api(
      "records?type=document&entry_mode=photo&kind=sale&tax_mode=gst",
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.rows[0].id, saved.id);
    const csv = await api(
      "reports/export.csv?report=documents&entry_mode=photo",
      null,
      200,
      true,
    );
    assert.ok(csv.includes("760.00"));
    assert.ok(csv.includes("500.00"));
    assert.ok(csv.includes("photo"));
    const pdf = await api(
      "reports/export.pdf?report=documents",
      null,
      200,
      true,
    );
    assert.ok(pdf.startsWith("%PDF"));
    await api("reports?from=2026-10-03&to=2026-10-01", null, 400);
    const passphrase = "test-backup-passphrase-long";
    const backup = await fetch(server.base + "/api/backups/create", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: password, passphrase }),
    });
    assert.equal(backup.status, 200);
    const bytes = Buffer.from(await backup.arrayBuffer());
    await api("backups/restore", {
      current_password: password,
      passphrase,
      file: bytes.toString("base64"),
      confirmation: "RESTORE",
    });
    await api("login", { username: "owner", password });
    assert.equal((await api("documents/" + saved.id)).entry_mode, "photo");
    await api("users", { name: "Staff", username: "staff", password });
    await api("login", { username: "staff", password });
    await api("reports/export.csv?report=documents", null, 403, true);
  } finally {
    await server.close();
  }
});

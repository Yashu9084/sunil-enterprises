import sharp from "sharp";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startTestServer } from "./test-support.js";
test("shop lifecycle: proof, allocation, returns, refunds, reversals, staff controls, encrypted backup and restoration", async () => {
  const server = await startTestServer();
  let cookie = "";
  const password = randomBytes(16).toString("hex"),
    passphrase = randomBytes(16).toString("hex");
  let n = 0;
  async function request(path, body, status = 200, raw = false) {
    const r = await fetch(server.base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    let bytes;
    try {
      bytes = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      throw Error(path + ": " + e.message + " Server output: " + server.output);
    }
    assert.equal(
      r.status,
      status,
      `${path}: ${bytes.toString().slice(0, 1000)}`,
    );
    return raw ? bytes : bytes.length ? JSON.parse(bytes) : null;
  }
  const key = () => `lifecycle-request-${++n}`;
  const image =
    "data:image/png;base64," +
    (
      await sharp({
        create: {
          width: 100,
          height: 40,
          channels: 4,
          background: { r: 21, g: 62, b: 53, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  try {
    await request("setup", { name: "Owner", username: "owner", password });
    await request("login", { username: "owner", password });
    const c = (await request("parties", { name: "ग्राहक", kind: "customer" }))
        .id,
      s = (await request("parties", { name: "Supplier", kind: "supplier" })).id;
    const opening = {
      type: "opening",
      party_id: c,
      tax_mode: "non-gst",
      side: "receivable",
      amount: 10000,
      reason: "Old ledger page 3",
      request_id: key(),
    };
    await request("adjustments", opening);
    await request("adjustments", opening);
    assert.equal(
      (await request("state")).parties.find((p) => p.id === c).balances[
        "non-gst"
      ].receivable,
      10000,
    );
    const sale = {
      kind: "sale",
      party_id: c,
      tax_mode: "gst",
      items: [{ name: "पाइप", qty: 2.5, price: 10000, gst: 0 }],
      signature: image,
      request_id: key(),
    };
    const id = (await request("documents", sale)).id;
    assert.equal((await request("documents", sale)).id, id);
    await request(
      "documents",
      { ...sale, signature: null, request_id: key() },
      400,
    );
    await request(
      "documents",
      {
        ...sale,
        signature: "data:image/png;base64,aGVsbG8=",
        request_id: key(),
      },
      400,
    );
    await request("documents", {
      kind: "purchase",
      party_id: s,
      tax_mode: "gst",
      items: [{ name: "Pipe", qty: 3, price: 10000, gst: 0 }],
      request_id: key(),
    });
    const payment = {
      customer_id: c,
      supplier_id: s,
      amount: 20000,
      tax_mode: "gst",
      reference: "UPI-001",
      request_id: key(),
    };
    const pid = (await request("payments", payment)).id;
    await request("payments", payment);
    assert.equal((await request("documents/" + id)).allocated, 20000);
    await request(
      "payments",
      { ...payment, amount: 6000, request_id: key() },
      400,
    );
    await request("adjustments", {
      type: "return",
      party_id: c,
      document_id: id,
      side: "receivable",
      tax_mode: "gst",
      amount: 15000,
      reason: "Returned damaged goods",
      request_id: key(),
    });
    assert.equal(
      (await request("state")).parties.find((p) => p.id === c).balances.gst
        .receivable,
      -10000,
    );
    const refund = {
      customer_id: c,
      flow: "refund",
      amount: 10000,
      tax_mode: "gst",
      reference: "REFUND-001",
      request_id: key(),
    };
    await request("payments", refund);
    assert.equal(
      (await request("state")).parties.find((p) => p.id === c).balances.gst
        .receivable,
      0,
    );
    await request("payments", { ...refund, amount: 1, request_id: key() }, 400);
    const statement = await request("statements/" + c);
    const savedProof = statement.documents[0].signature;
    assert.ok(savedProof.startsWith("data:image/png;base64,"));
    assert.equal(statement.allocations[0].document_id, id);
    const pdf = await request(
      "statements/" + c + "/pdf?lang=hi",
      null,
      200,
      true,
    );
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.ok(pdf.length > 1000);
    await request("payments/reconcile", {
      payment_id: pid,
      reference: "Bank statement line 6",
    });
    await request("payments/reverse", {
      payment_id: pid,
      reason: "Wrong transfer was recorded",
      request_id: key(),
    });
    const balances = (await request("state")).parties;
    assert.equal(balances.find((p) => p.id === s).balances.gst.payable, 30000);
    assert.equal(
      balances.find((p) => p.id === c).balances.gst.receivable,
      20000,
    );
    await request("users", { name: "Staff", username: "staff", password });
    const uid = (await request("state")).users.find(
      (u) => u.username === "staff",
    ).id;
    const ownerCookie = cookie;
    await request("login", { username: "staff", password });
    const staffCookie = cookie;
    await request("adjustments", { ...opening, request_id: key() }, 403);
    await request("audit", null, 403);
    cookie = ownerCookie;
    await request("users/" + uid + "/manage", { active: false });
    cookie = staffCookie;
    await request("state", null, 401);
    cookie = ownerCookie;
    const backup = await request(
      "backups/create",
      { current_password: password, passphrase },
      200,
      true,
    );
    assert.ok(backup.subarray(0, 11).equals(Buffer.from("SUNILKHATA1")));
    await request("parties", { name: "After backup", kind: "customer" });
    await request(
      "backups/restore",
      {
        current_password: password,
        passphrase: "incorrect-passphrase",
        file: backup.toString("base64"),
        preview: true,
      },
      400,
    );
    const preview = await request("backups/restore", {
      current_password: password,
      passphrase,
      file: backup.toString("base64"),
      preview: true,
    });
    assert.equal(preview.counts.parties, 2);
    await request("backups/restore", {
      current_password: password,
      passphrase,
      file: backup.toString("base64"),
      confirmation: "RESTORE",
    });
    await request("state", null, 401);
    await request("login", { username: "owner", password });
    assert.equal((await request("state")).parties.length, 2);
    assert.equal((await request("documents/" + id)).signature, savedProof);
    assert.equal(
      (await request("state")).parties.find((p) => p.id === c).balances.gst
        .receivable,
      20000,
    );
  } finally {
    await server.close();
  }
});
test("production owner setup is closed without a private token", async () => {
  const s = await startTestServer({ ALLOW_LOCAL_SETUP: "0", SETUP_TOKEN: "" });
  try {
    const r = await fetch(s.base + "/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Attacker",
        username: "owner",
        password: "long-enough-password",
      }),
    });
    assert.equal(r.status, 403);
    assert.equal(
      (await (await fetch(s.base + "/api/status")).json()).needsSetup,
      true,
    );
  } finally {
    await s.close();
  }
});

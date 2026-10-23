import test from "node:test";
import assert from "node:assert/strict";
import {
  openLedger,
  calculateItems,
  balance,
  recordPayment,
} from "./ledger.js";
test("GST rounds per line using integer paise", () => {
  assert.equal(
    calculateItems([{ name: "Pipe", qty: 3, price: 10001, gst: 18 }], "gst")
      .total,
    35404,
  );
  assert.equal(
    calculateItems([{ name: "Pipe", qty: 3, price: 10001, gst: 18 }], "non-gst")
      .total,
    30003,
  );
  assert.throws(() =>
    calculateItems([{ name: "x", qty: 1.1234, price: 100 }], "gst"),
  );
});
test("direct payment reduces both balances once, preserves tax separation, and rolls back overpayment", () => {
  const d = openLedger(":memory:");
  d.prepare(
    "INSERT INTO users(id,name,username,hash,role) VALUES(1,?,?,?,?)",
  ).run("Owner", "owner", "unused", "owner");
  d.prepare("INSERT INTO parties(id,name,kind) VALUES(1,?,?)").run(
    "Customer",
    "customer",
  );
  d.prepare("INSERT INTO parties(id,name,kind) VALUES(2,?,?)").run(
    "Supplier",
    "supplier",
  );
  const insert = d.prepare(
    "INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by) VALUES(?,?,?,?,?,1)",
  );
  insert.run("sale", 1, "gst", "[]", 1000000);
  insert.run("sale", 1, "non-gst", "[]", 300000);
  insert.run("purchase", 2, "gst", "[]", 800000);
  const p = {
    customer_id: 1,
    supplier_id: 2,
    amount: 400000,
    tax_mode: "gst",
    reference: "UPI-123",
    request_id: "request-0001",
  };
  recordPayment(d, p, 1);
  recordPayment(d, p, 1);
  assert.deepEqual(balance(d, 1, "gst"), { receivable: 600000, payable: 0 });
  assert.equal(balance(d, 2, "gst").payable, 400000);
  assert.equal(balance(d, 1, "non-gst").receivable, 300000);
  assert.throws(() =>
    recordPayment(d, { ...p, amount: 500000, request_id: "request-0002" }, 1),
  );
  assert.equal(balance(d, 1, "gst").receivable, 600000);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
  d.close();
});
test("a second connection cannot overspend an updated customer balance", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "khata-test-")),
    path = join(dir, "ledger.db");
  const a = openLedger(path),
    b = openLedger(path);
  try {
    a.prepare(
      "INSERT INTO users(id,name,username,hash,role) VALUES(1,?,?,?,?)",
    ).run("Owner", "owner", "unused", "owner");
    a.prepare("INSERT INTO parties(id,name,kind) VALUES(1,?,?)").run(
      "Customer",
      "customer",
    );
    a.prepare(
      "INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by) VALUES(?,?,?,?,?,1)",
    ).run("sale", 1, "non-gst", "[]", 100000);
    recordPayment(
      a,
      {
        customer_id: 1,
        amount: 60000,
        tax_mode: "non-gst",
        reference: "FIRST",
        request_id: "connection-001",
      },
      1,
    );
    assert.throws(() =>
      recordPayment(
        b,
        {
          customer_id: 1,
          amount: 60000,
          tax_mode: "non-gst",
          reference: "SECOND",
          request_id: "connection-002",
        },
        1,
      ),
    );
    assert.equal(balance(b, 1, "non-gst").receivable, 40000);
    assert.equal(a.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

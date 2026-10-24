import test from "node:test";
import assert from "node:assert/strict";
import { openLedger, balance } from "./ledger.js";
import { buildReport, dayStart } from "./reports.js";
import { reportCsv } from "./report-export.js";
function book() {
  const db = openLedger(":memory:");
  db.exec(
    "INSERT INTO users(id,name,username,hash,role) VALUES(1,'Owner','owner','test','owner'); INSERT INTO parties(id,name,kind) VALUES(1,'Customer','customer'),(2,'Supplier','supplier'),(3,'=Dangerous Excel name','customer')",
  );
  return db;
}
function document(db, id, kind, party, mode, total, date, entry = "items") {
  const items =
    entry === "photo"
      ? []
      : [
          {
            name: "Bearing 32211",
            qty: 2,
            price: total / 2,
            gst: 0,
            tax: 0,
            base: total,
            total,
          },
        ];
  db.prepare(
    "INSERT INTO documents(id,kind,party_id,tax_mode,items,total,created_by,created_at,entry_mode) VALUES(?,?,?,?,?,?,1,?,?)",
  ).run(id, kind, party, mode, JSON.stringify(items), total, date, entry);
}
test("India date boundaries and complete-book filtered totals do not depend on pagination", () => {
  const db = book();
  try {
    document(db, 1, "sale", 1, "gst", 100, "2026-09-30T18:29:59.999Z");
    for (let i = 2; i <= 62; i++)
      document(
        db,
        i,
        "sale",
        1,
        "gst",
        100,
        "2026-09-30T18:30:00.000Z",
        i === 2 ? "photo" : "items",
      );
    document(db, 63, "sale", 1, "gst", 100, "2026-10-01T18:30:00.000Z");
    const report = buildReport(db, {
      report: "documents",
      from: "2026-10-01",
      to: "2026-10-01",
    });
    assert.equal(report.total, 61);
    assert.equal(report.rows.length, 50);
    assert.equal(report.metrics.sales, 6100);
    assert.equal(
      buildReport(db, {
        report: "documents",
        from: "2026-10-01",
        to: "2026-10-01",
        entry_mode: "photo",
      }).total,
      1,
    );
    assert.equal(
      reportCsv(
        buildReport(
          db,
          { report: "documents", from: "2026-10-01", to: "2026-10-01" },
          { allRows: true },
        ),
      ).split("\r\n").length,
      63,
    );
    assert.throws(() => dayStart("2026-02-30"));
    assert.throws(() =>
      buildReport(db, { from: "2026-10-02", to: "2026-10-01" }),
    );
  } finally {
    db.close();
  }
});
test("opening/closing and document allocations reconstruct reversal dates and cross-GST direct transfers", () => {
  const db = book();
  try {
    document(db, 1, "sale", 1, "gst", 10000, "2026-09-29T10:00:00.000Z");
    document(
      db,
      2,
      "purchase",
      2,
      "non-gst",
      20000,
      "2026-09-29T10:00:00.000Z",
      "photo",
    );
    db.prepare(
      "INSERT INTO payments(id,customer_id,supplier_id,amount,tax_mode,supplier_tax_mode,reference,created_by,request_id,created_at) VALUES(1,1,2,4000,'gst','non-gst','DIRECT',1,'report-direct-01','2026-10-02T10:00:00.000Z')",
    ).run();
    db.exec(
      "INSERT INTO allocations(payment_id,side,document_id,amount) VALUES(1,'receivable',1,4000),(1,'payable',2,4000)",
    );
    db.exec(
      "INSERT INTO reversals(payment_id,reason,created_by,request_id,created_at) VALUES(1,'Incorrect entry',1,'report-reverse-01','2026-10-08T10:00:00.000Z')",
    );
    const earlier = buildReport(db, {
      report: "ledger",
      party: 1,
      from: "2026-10-01",
      to: "2026-10-05",
    });
    const gst = earlier.positions.find((p) => p.tax_mode === "gst");
    assert.equal(gst.opening_receivable, 10000);
    assert.equal(gst.closing_receivable, 6000);
    assert.equal(earlier.metrics.direct, 4000);
    assert.equal(earlier.metrics.received, 0);
    assert.equal(earlier.metrics.paid, 0);
    assert.equal(earlier.metrics.net_shop_movement, 0);
    const beforeReverse = buildReport(db, {
      report: "documents",
      to: "2026-10-05",
      party: 1,
    });
    assert.equal(beforeReverse.rows[0].allocated, 4000);
    const later = buildReport(db, {
      report: "ledger",
      party: 1,
      from: "2026-10-06",
      to: "2026-10-09",
      q: "DIRECT",
    });
    assert.equal(
      later.positions.find((p) => p.tax_mode === "gst").opening_receivable,
      6000,
    );
    assert.equal(
      later.positions.find((p) => p.tax_mode === "gst").closing_receivable,
      10000,
    );
    assert.equal(later.rows[0].receivable_delta, 4000);
    assert.equal(later.metrics.direct, -4000);
    assert.equal(
      buildReport(db, {
        report: "payments",
        to: "2026-10-05",
        tax_mode: "non-gst",
      }).total,
      1,
    );
    assert.equal(
      buildReport(db, { report: "documents", to: "2026-10-09", party: 1 })
        .rows[0].allocated,
      0,
    );
    assert.equal(balance(db, 1, "gst").receivable, 10000);
  } finally {
    db.close();
  }
});
test("returns and their reversals enter their own periods; credits never offset other accounts", () => {
  const db = book();
  try {
    document(db, 1, "sale", 1, "gst", 10000, "2026-09-29T10:00:00.000Z");
    db.exec(
      "INSERT INTO adjustments(id,party_id,tax_mode,side,type,amount,document_id,reason,created_by,request_id,created_at) VALUES(1,1,'gst','receivable','return',-2000,1,'Returned part',1,'report-return-01','2026-10-02T10:00:00.000Z'),(2,3,'gst','receivable','opening',-3000,NULL,'Old customer credit',1,'report-credit-01','2026-09-29T10:00:00.000Z')",
    );
    db.exec(
      "INSERT INTO adjustment_reversals(adjustment_id,reason,created_by,request_id,created_at) VALUES(1,'Correction',1,'report-adjust-rev-01','2026-10-06T10:00:00.000Z')",
    );
    const earlier = buildReport(db, { from: "2026-10-01", to: "2026-10-05" });
    assert.equal(earlier.metrics.net_sales, -2000);
    assert.equal(earlier.bookTotals.collect, 8000);
    assert.equal(earlier.bookTotals.customer_credit, 3000);
    const later = buildReport(db, { from: "2026-10-06", to: "2026-10-07" });
    assert.equal(later.metrics.net_sales, 2000);
    const balanceReport = buildReport(db, {
      report: "balances",
      to: "2026-10-07",
      balance_status: "credit",
    });
    assert.equal(balanceReport.rows.length, 1);
    assert.equal(balanceReport.rows[0].party_id, 3);
    const csv = reportCsv(balanceReport);
    assert.ok(csv.includes("'=Dangerous Excel name"));
  } finally {
    db.close();
  }
});
test("photo-only gross values are included financially and explicitly excluded from item quantities", () => {
  const db = book();
  try {
    document(
      db,
      1,
      "sale",
      1,
      "non-gst",
      76000,
      "2026-10-02T10:00:00.000Z",
      "photo",
    );
    document(db, 2, "sale", 1, "non-gst", 20000, "2026-10-02T10:00:00.000Z");
    const report = buildReport(db, {
      report: "items",
      from: "2026-10-01",
      to: "2026-10-05",
    });
    assert.equal(report.metrics.sales, 96000);
    assert.equal(report.metrics.photo_count, 1);
    assert.equal(report.metrics.photo_total, 76000);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].quantity, 2);
    assert.equal(report.rows[0].amount, 20000);
  } finally {
    db.close();
  }
});

test("cash/bank/refund movement and bank matching filters stay distinct from direct transfers", () => {
  const db = book();
  try {
    document(db, 1, "sale", 1, "gst", 10000, "2026-10-01T08:00:00.000Z");
    document(db, 2, "purchase", 2, "gst", 10000, "2026-10-01T08:00:00.000Z");
    db.exec(
      "INSERT INTO payments(id,customer_id,supplier_id,amount,tax_mode,flow,method,reference,created_by,request_id,created_at) VALUES(1,1,NULL,5000,'gst','settlement','cash','CASH-IN',1,'cash-report-01','2026-10-02T08:00:00.000Z'),(2,NULL,2,4000,'gst','settlement','bank','BANK-OUT',1,'cash-report-02','2026-10-03T08:00:00.000Z'),(3,1,NULL,1000,'gst','refund','cash','CASH-REFUND',1,'cash-report-03','2026-10-04T08:00:00.000Z')",
    );
    db.exec(
      "INSERT INTO reconciliations(payment_id,reference,created_by,created_at)VALUES(2,'BANK-STATEMENT-LINE',1,'2026-10-05T08:00:00.000Z')",
    );
    const report = buildReport(db, { from: "2026-10-01", to: "2026-10-04" });
    assert.equal(report.metrics.received, 5000);
    assert.equal(report.metrics.paid, 4000);
    assert.equal(report.metrics.customer_refunds, 1000);
    assert.equal(report.metrics.net_shop_movement, 0);
    assert.equal(report.methods.cash, 4000);
    assert.equal(report.methods.bank, -4000);
    assert.equal(
      buildReport(db, {
        report: "payments",
        to: "2026-10-04",
        reconciled: "yes",
      }).total,
      0,
    );
    assert.equal(
      buildReport(db, {
        report: "payments",
        to: "2026-10-05",
        reconciled: "yes",
        method: "bank",
      }).rows[0].reference,
      "BANK-OUT",
    );
    assert.equal(
      buildReport(db, { report: "payments", to: "2026-10-05", flow: "refund" })
        .rows[0].reference,
      "CASH-REFUND",
    );
  } finally {
    db.close();
  }
});

test("item-name search selects matching lines and still discloses photo-only records whose items are unknown", () => {
  const db = book();
  try {
    document(db, 1, "sale", 1, "gst", 10000, "2026-10-01T10:00:00.000Z");
    document(
      db,
      2,
      "sale",
      1,
      "gst",
      76000,
      "2026-10-01T10:00:00.000Z",
      "photo",
    );
    const items = [
      {
        name: "Bearing 32211",
        qty: 2,
        price: 3000,
        gst: 0,
        total: 6000,
        tax: 0,
      },
      { name: "Washer", qty: 4, price: 1000, gst: 0, total: 4000, tax: 0 },
    ];
    db.prepare("UPDATE documents SET items=? WHERE id=1").run(
      JSON.stringify(items),
    );
    const report = buildReport(db, {
      report: "items",
      q: "32211",
      to: "2026-10-05",
    });
    assert.equal(report.total, 1);
    assert.equal(report.rows[0].name, "Bearing 32211");
    assert.equal(report.metrics.item_amount, 6000);
    assert.equal(report.metrics.photo_count, 1);
    assert.equal(report.metrics.photo_total, 76000);
  } finally {
    db.close();
  }
});

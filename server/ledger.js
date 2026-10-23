import {
  migrateOperations,
  allocate,
  allocateRefund,
  audit,
} from "./operations.js";
import { DatabaseSync } from "node:sqlite";
export function openLedger(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','both')),gstin TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('sale','purchase')),party_id INTEGER NOT NULL REFERENCES parties(id),request_id TEXT UNIQUE,tax_mode TEXT NOT NULL CHECK(tax_mode IN ('gst','non-gst')),items TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>0),signature TEXT,photo TEXT,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),created_by INTEGER NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES parties(id),supplier_id INTEGER REFERENCES parties(id),amount INTEGER NOT NULL CHECK(amount>0),tax_mode TEXT NOT NULL CHECK(tax_mode IN ('gst','non-gst')),reference TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),created_by INTEGER NOT NULL REFERENCES users(id),request_id TEXT UNIQUE NOT NULL,CHECK(customer_id IS NOT NULL OR supplier_id IS NOT NULL));`);
  if (
    !db
      .prepare("PRAGMA table_info(documents)")
      .all()
      .some((c) => c.name === "request_id")
  )
    db.exec("ALTER TABLE documents ADD COLUMN request_id TEXT");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS document_request_id ON documents(request_id)",
  );
  db.exec("PRAGMA busy_timeout=5000");
  migrateOperations(db);
  return db;
}
export { calculateItems } from "../shared/money.js";
export function balance(db, id, mode) {
  const sums = db
    .prepare(
      "SELECT kind,COALESCE(SUM(total),0) total FROM documents WHERE party_id=? AND tax_mode=? GROUP BY kind",
    )
    .all(id, mode);
  const sales = sums.find((x) => x.kind === "sale")?.total || 0,
    purchases = sums.find((x) => x.kind === "purchase")?.total || 0;
  const received = db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN p.flow='refund' THEN -p.amount ELSE p.amount END),0) n FROM payments p LEFT JOIN reversals r ON r.payment_id=p.id WHERE p.customer_id=? AND p.tax_mode=? AND r.id IS NULL",
    )
    .get(id, mode).n;
  const paid = db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN p.flow='refund' THEN -p.amount ELSE p.amount END),0) n FROM payments p LEFT JOIN reversals r ON r.payment_id=p.id WHERE p.supplier_id=? AND COALESCE(p.supplier_tax_mode,p.tax_mode)=? AND r.id IS NULL",
    )
    .get(id, mode).n;
  const adjustments = db
    .prepare(
      "SELECT a.side,SUM(a.amount) n FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.party_id=? AND a.tax_mode=? AND r.id IS NULL GROUP BY a.side",
    )
    .all(id, mode);
  return {
    receivable:
      sales -
      received +
      (adjustments.find((a) => a.side === "receivable")?.n || 0),
    payable:
      purchases -
      paid +
      (adjustments.find((a) => a.side === "payable")?.n || 0),
  };
}

export function recordPayment(db, p, user) {
  if (
    typeof p.reference !== "string" ||
    !p.reference.trim() ||
    p.reference.length > 200 ||
    String(p.notes || "").length > 1000
  )
    throw Error(
      "Enter a payment reference up to 200 characters and notes up to 1,000 characters.",
    );
  const flow = p.flow || "settlement",
    method = p.method || "upi";
  if (!["upi", "bank", "cash"].includes(method))
    throw Error("Select UPI, bank transfer or cash.");
  const selection = {};
  for (const key of ["customer_documents", "supplier_documents"])
    if (p[key] !== undefined) {
      if (
        !Array.isArray(p[key]) ||
        p[key].some((i) => !Number.isSafeInteger(Number(i)))
      )
        throw Error("Invalid allocation selection.");
      selection[key] = [...new Set(p[key].map(Number))].sort((a, b) => a - b);
    }
  const allocationRequest = JSON.stringify(selection);
  const customer = p.customer_id ? Number(p.customer_id) : null,
    supplier = p.supplier_id ? Number(p.supplier_id) : null,
    amount = Number(p.amount);
  const customerMode = p.customer_tax_mode || p.tax_mode,
    supplierMode = p.supplier_tax_mode || p.tax_mode,
    primaryMode = customer ? customerMode : supplierMode;
  if (
    (customer && !["gst", "non-gst"].includes(customerMode)) ||
    (supplier && !["gst", "non-gst"].includes(supplierMode))
  )
    throw Error("Choose the GST category for both customer and supplier.");
  if (
    (!customer && !supplier) ||
    !["settlement", "refund"].includes(flow) ||
    (flow === "refund" && customer && supplier) ||
    customer === supplier ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !["gst", "non-gst"].includes(primaryMode) ||
    !String(p.reference || "").trim() ||
    !/^[-a-zA-Z0-9]{8,100}$/.test(p.request_id || "")
  )
    throw Error(
      "Check payer, recipient, amount, tax category, and payment reference.",
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare("SELECT * FROM payments WHERE request_id=?")
      .get(p.request_id);
    if (existing) {
      if (
        existing.customer_id !== customer ||
        existing.supplier_id !== supplier ||
        existing.amount !== amount ||
        existing.tax_mode !== primaryMode ||
        existing.supplier_tax_mode !== (supplier ? supplierMode : null) ||
        existing.reference !== p.reference ||
        existing.flow !== flow ||
        existing.method !== method ||
        existing.created_by !== user ||
        existing.notes !== String(p.notes || "") ||
        existing.allocation_request !== allocationRequest
      )
        throw Error("This request was already used for a different payment.");
      db.exec("COMMIT");
      return existing.id;
    }
    if (
      db
        .prepare(
          "SELECT p.id FROM payments p LEFT JOIN reversals r ON r.payment_id=p.id WHERE p.customer_id IS ? AND p.supplier_id IS ? AND p.tax_mode=? AND p.supplier_tax_mode IS ? AND p.method=? AND p.flow=? AND lower(trim(p.reference))=lower(trim(?)) AND r.id IS NULL",
        )
        .get(
          customer,
          supplier,
          primaryMode,
          supplier ? supplierMode : null,
          method,
          flow,
          p.reference,
        )
    )
      throw Error(
        "This payment reference is already recorded for these accounts and GST category. Search it before recording again.",
      );
    const sign = flow === "refund" ? -1 : 1;
    if (
      customer &&
      sign * balance(db, customer, customerMode).receivable < amount
    )
      throw Error(
        flow === "refund"
          ? "Refund exceeds the customer credit."
          : "Amount exceeds this customer’s outstanding balance in the selected tax category.",
      );
    if (supplier && sign * balance(db, supplier, supplierMode).payable < amount)
      throw Error(
        flow === "refund"
          ? "Refund exceeds the supplier credit."
          : "Amount exceeds this supplier’s outstanding balance in the selected tax category.",
      );
    const r = db
      .prepare(
        "INSERT INTO payments(customer_id,supplier_id,amount,tax_mode,reference,notes,created_by,request_id,flow,allocation_request,method,destination_snapshot,supplier_tax_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        customer,
        supplier,
        amount,
        primaryMode,
        p.reference,
        String(p.notes || ""),
        user,
        p.request_id,
        flow,
        allocationRequest,
        method,
        JSON.stringify({
          method,
          details: (flow === "refund" ? customer : supplier)
            ? JSON.parse(
                db
                  .prepare("SELECT payment_details FROM parties WHERE id=?")
                  .get(flow === "refund" ? customer : supplier)
                  ?.payment_details || "{}",
              )
            : JSON.parse(
                db.prepare("SELECT value FROM settings WHERE key='shop'").get()
                  ?.value || "{}",
              ),
        }),
        supplier ? supplierMode : null,
      );
    const id = Number(r.lastInsertRowid);
    if (flow === "settlement") {
      if (customer)
        allocate(
          db,
          id,
          customer,
          customerMode,
          "receivable",
          amount,
          p.customer_documents || null,
        );
      if (supplier)
        allocate(
          db,
          id,
          supplier,
          supplierMode,
          "payable",
          amount,
          p.supplier_documents || null,
        );
    }
    if (flow === "refund")
      allocateRefund(
        db,
        id,
        customer || supplier,
        primaryMode,
        customer ? "receivable" : "payable",
        amount,
      );
    audit(db, user, flow, "payment", id, {
      amount,
      customer,
      supplier,
      customer_mode: customerMode,
      supplier_mode: supplierMode,
    });
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

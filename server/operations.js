import { balance } from "./ledger.js";
export const modes = ["gst", "non-gst"];
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function requestKey(value) {
  if (!/^[-a-zA-Z0-9]{8,100}$/.test(value || ""))
    throw Error("Missing request identifier. Reopen the form.");
  return value;
}
export function amount(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100000000000)
    throw Error("Enter a positive amount with at most two decimal places.");
  return value;
}
export function reason(value) {
  const s = String(value || "").trim();
  if (s.length < 3 || s.length > 1000)
    throw Error("Enter a reason between 3 and 1,000 characters.");
  return s;
}
export function audit(db, user, action, entity, id, details = {}) {
  db.prepare(
    "INSERT INTO audit(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)",
  ).run(user, action, entity, Number(id), JSON.stringify(details));
}
export function migrateOperations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS credit_transfers(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),source_document_id INTEGER NOT NULL REFERENCES documents(id),target_document_id INTEGER NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL CHECK(amount>0),created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TABLE IF NOT EXISTS credit_requests(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,source_id INTEGER NOT NULL REFERENCES documents(id),target_id INTEGER NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS refund_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),document_id INTEGER NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL CHECK(amount>0));
 CREATE TABLE IF NOT EXISTS adjustment_reversals(id INTEGER PRIMARY KEY,adjustment_id INTEGER NOT NULL UNIQUE REFERENCES adjustments(id),reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),request_id TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS adjustments(id INTEGER PRIMARY KEY,party_id INTEGER NOT NULL REFERENCES parties(id),tax_mode TEXT NOT NULL CHECK(tax_mode IN ('gst','non-gst')),side TEXT NOT NULL CHECK(side IN ('receivable','payable')),type TEXT NOT NULL CHECK(type IN ('opening','return','void')),amount INTEGER NOT NULL CHECK(amount!=0),document_id INTEGER REFERENCES documents(id),reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),request_id TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS reversals(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),request_id TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS allocations(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),side TEXT NOT NULL CHECK(side IN ('receivable','payable')),document_id INTEGER REFERENCES documents(id),opening_id INTEGER REFERENCES adjustments(id),amount INTEGER NOT NULL CHECK(amount>0),CHECK((document_id IS NULL)!=(opening_id IS NULL)));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,entity_id INTEGER NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reconciliations(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),reference TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE INDEX IF NOT EXISTS documents_party ON documents(party_id,tax_mode);
 CREATE INDEX IF NOT EXISTS payments_customer ON payments(customer_id,tax_mode);
 CREATE INDEX IF NOT EXISTS payments_supplier ON payments(supplier_id,tax_mode);
 CREATE INDEX IF NOT EXISTS adjustments_party ON adjustments(party_id,tax_mode);
 CREATE INDEX IF NOT EXISTS allocations_document ON allocations(document_id);
 CREATE INDEX IF NOT EXISTS adjustments_document ON adjustments(document_id);
 CREATE INDEX IF NOT EXISTS allocations_opening ON allocations(opening_id);
 CREATE INDEX IF NOT EXISTS transfers_source ON credit_transfers(source_document_id);
 CREATE INDEX IF NOT EXISTS transfers_target ON credit_transfers(target_document_id);
 CREATE INDEX IF NOT EXISTS refunds_document ON refund_allocations(document_id);
 CREATE INDEX IF NOT EXISTS payment_reference ON payments(reference,tax_mode);`);
  const add = (table, col, def) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === col)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  add("users", "active", "INTEGER NOT NULL DEFAULT 1");
  add("payments", "supplier_tax_mode", "TEXT");
  db.exec(
    "UPDATE payments SET supplier_tax_mode=tax_mode WHERE supplier_id IS NOT NULL AND supplier_tax_mode IS NULL",
  );
  add("payments", "flow", "TEXT NOT NULL DEFAULT 'settlement'");
  add("payments", "allocation_request", "TEXT NOT NULL DEFAULT '{}'");
  add("documents", "due_date", "TEXT");
  add("documents", "source_photo", "TEXT");
  add("documents", "entry_mode", "TEXT NOT NULL DEFAULT 'items'");
  add("parties", "address", "TEXT NOT NULL DEFAULT ''");
  add("parties", "payment_details", "TEXT NOT NULL DEFAULT '{}'");
  add("payments", "method", "TEXT NOT NULL DEFAULT 'upi'");
  add("payments", "destination_snapshot", "TEXT NOT NULL DEFAULT '{}'");
  add("documents", "party_snapshot", "TEXT");
  add("documents", "shop_snapshot", "TEXT");
  // Allocate legacy payments once without changing their amounts or balances.
  if (
    !db
      .prepare("SELECT value FROM settings WHERE key='allocation_migration'")
      .get()
  )
    transaction(db, () => {
      for (const p of db.prepare("SELECT * FROM payments ORDER BY id").all()) {
        if (p.customer_id)
          allocate(db, p.id, p.customer_id, p.tax_mode, "receivable", p.amount);
        if (p.supplier_id)
          allocate(
            db,
            p.id,
            p.supplier_id,
            p.supplier_tax_mode || p.tax_mode,
            "payable",
            p.amount,
          );
      }
      db.prepare("INSERT INTO settings VALUES(?,?)").run(
        "allocation_migration",
        "1",
      );
    });
}
export function documentStatus(db, doc) {
  const credit = db
    .prepare(
      "SELECT COALESCE(SUM(a.amount),0) n FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.document_id=? AND r.id IS NULL",
    )
    .get(doc.id).n;
  const paid = paidOnDocument(db, doc.id);
  return {
    ...doc,
    adjusted_total: doc.total + credit,
    allocated: paid,
    outstanding: Math.max(0, doc.total + credit - paid),
    credit: Math.max(0, paid - doc.total - credit),
    voided: !!db
      .prepare(
        "SELECT a.id FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.document_id=? AND a.type='void' AND r.id IS NULL",
      )
      .get(doc.id),
  };
}
export function allocate(
  db,
  paymentId,
  party,
  mode,
  side,
  value,
  selection = null,
) {
  const kind = side === "receivable" ? "sale" : "purchase";
  let targets = [
    ...db
      .prepare(
        "SELECT * FROM documents WHERE party_id=? AND tax_mode=? AND kind=? ORDER BY id",
      )
      .all(party, mode, kind)
      .map((d) => {
        const s = documentStatus(db, d);
        return {
          document_id: d.id,
          opening_id: null,
          due: s.outstanding,
          created_at: d.created_at,
        };
      }),
    ...db
      .prepare(
        "SELECT a.* FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.party_id=? AND a.tax_mode=? AND a.side=? AND a.type='opening' AND a.amount>0 AND r.id IS NULL",
      )
      .all(party, mode, side)
      .map((o) => {
        const used = db
          .prepare(
            "SELECT COALESCE(SUM(a.amount),0) n FROM allocations a LEFT JOIN reversals r ON r.payment_id=a.payment_id WHERE opening_id=? AND r.id IS NULL",
          )
          .get(o.id).n;
        return {
          document_id: null,
          opening_id: o.id,
          due: Math.max(0, o.amount - used),
          created_at: o.created_at,
        };
      }),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (selection) {
    if (!Array.isArray(selection) || selection.length > 500)
      throw Error("Invalid estimate selection.");
    const chosen = [...new Set(selection.map(Number))];
    targets = targets.filter(
      (x) => x.document_id && chosen.includes(x.document_id),
    );
    if (chosen.length !== targets.length)
      throw Error(
        "Choose estimates belonging to the same party and GST category.",
      );
    if (targets.reduce((s, x) => s + x.due, 0) < value)
      throw Error(
        "Amount exceeds the selected estimates’ outstanding balance.",
      );
  }
  let remaining = value;
  for (const target of targets) {
    const use = Math.min(remaining, target.due);
    if (use > 0)
      db.prepare(
        "INSERT INTO allocations(payment_id,side,document_id,opening_id,amount) VALUES(?,?,?,?,?)",
      ).run(paymentId, side, target.document_id, target.opening_id, use);
    remaining -= use;
    if (!remaining) break;
  }
  if (selection && remaining)
    throw Error("Could not allocate the full payment.");
}
export function addAdjustment(db, p, user) {
  return transaction(db, () => {
    const key = requestKey(p.request_id),
      previous = db
        .prepare("SELECT * FROM adjustments WHERE request_id=?")
        .get(key);
    if (previous) {
      if (
        previous.created_by !== user ||
        previous.type !== p.type ||
        previous.reason !== String(p.reason || " ").trim() ||
        previous.party_id !== Number(p.party_id) ||
        previous.tax_mode !== p.tax_mode ||
        previous.side !== p.side ||
        previous.amount !==
          (p.type === "opening" ? Number(p.amount) : -Number(p.amount)) ||
        previous.document_id !== (p.document_id ? Number(p.document_id) : null)
      )
        throw Error(
          "This request identifier was already used for another adjustment.",
        );
      return previous.id;
    }
    const why = reason(p.reason),
      party = Number(p.party_id),
      value = amount(Number(p.amount));
    if (
      !modes.includes(p.tax_mode) ||
      !["receivable", "payable"].includes(p.side) ||
      !["opening", "return", "void"].includes(p.type)
    )
      throw Error("Invalid adjustment category.");
    const account = db.prepare("SELECT * FROM parties WHERE id=?").get(party);
    if (
      !account ||
      !(
        account.kind === "both" ||
        account.kind === (p.side === "receivable" ? "customer" : "supplier")
      )
    )
      throw Error("Choose a matching party account.");
    let doc = null;
    if (p.type === "opening") {
      if (p.document_id)
        throw Error("Opening balances cannot refer to an estimate.");
      if (
        db
          .prepare(
            "SELECT a.id FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.party_id=? AND a.tax_mode=? AND a.side=? AND a.type='opening' AND r.id IS NULL",
          )
          .get(party, p.tax_mode, p.side)
      )
        throw Error(
          "An opening balance is already recorded for this account/category.",
        );
      if (
        !db
          .prepare(
            "SELECT id FROM adjustments WHERE party_id=? AND tax_mode=? AND side=? AND type='opening'",
          )
          .get(party, p.tax_mode, p.side) &&
        (db
          .prepare(
            "SELECT id FROM documents WHERE party_id=? AND tax_mode=? LIMIT 1",
          )
          .get(party, p.tax_mode) ||
          db
            .prepare(
              "SELECT id FROM payments WHERE (customer_id=? OR supplier_id=?) AND tax_mode=? LIMIT 1",
            )
            .get(party, party, p.tax_mode))
      )
        throw Error(
          "Enter opening balances before transactions. Existing records must not be double counted.",
        );
    } else {
      doc = db
        .prepare("SELECT * FROM documents WHERE id=?")
        .get(Number(p.document_id));
      if (
        !doc ||
        doc.party_id !== party ||
        doc.tax_mode !== p.tax_mode ||
        (doc.kind === "sale" ? "receivable" : "payable") !== p.side
      )
        throw Error("Document does not match this account.");
      const s = documentStatus(db, doc);
      if (s.voided) throw Error("This record is already cancelled.");
      if (value > s.adjusted_total)
        throw Error("Credit exceeds the remaining document value.");
      if (p.type === "void" && value !== s.adjusted_total)
        throw Error("Cancellation must reverse the remaining document value.");
    }
    const r = db
      .prepare(
        "INSERT INTO adjustments(party_id,tax_mode,side,type,amount,document_id,reason,created_by,request_id) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        party,
        p.tax_mode,
        p.side,
        p.type,
        p.type === "opening" ? value : -value,
        doc?.id || null,
        why,
        user,
        key,
      );
    const id = Number(r.lastInsertRowid);
    audit(db, user, p.type, "adjustment", id, {
      party,
      amount: p.type === "opening" ? value : -value,
    });
    return id;
  });
}
export function reversePayment(db, p, user) {
  return transaction(db, () => {
    const id = Number(p.payment_id),
      why = reason(p.reason),
      key = requestKey(p.request_id);
    const existing = db
      .prepare("SELECT * FROM reversals WHERE request_id=?")
      .get(key);
    if (existing) {
      if (
        existing.payment_id !== id ||
        existing.reason !== why ||
        existing.created_by !== user
      )
        throw Error("Request identifier already used.");
      return existing.id;
    }
    const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(id);
    if (!payment) throw Error("Payment not found.");
    if (db.prepare("SELECT id FROM reversals WHERE payment_id=?").get(id))
      throw Error("Payment already reversed.");
    const r = db
      .prepare(
        "INSERT INTO reversals(payment_id,reason,created_by,request_id) VALUES(?,?,?,?)",
      )
      .run(id, why, user, key);
    audit(db, user, "reverse", "payment", id, { reason: why });
    return Number(r.lastInsertRowid);
  });
}
// Transfers move existing settlement allocations between documents; they never
// create money. Reversing the originating payment disables its transfers too.
export function paidOnDocument(db, id) {
  const original = db
    .prepare(
      "SELECT COALESCE(SUM(a.amount),0) n FROM allocations a LEFT JOIN reversals r ON r.payment_id=a.payment_id WHERE a.document_id=? AND r.id IS NULL",
    )
    .get(id).n;
  const moved = db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN t.target_document_id=? THEN t.amount ELSE -t.amount END),0) n FROM credit_transfers t LEFT JOIN reversals r ON r.payment_id=t.payment_id WHERE (t.source_document_id=? OR t.target_document_id=?) AND r.id IS NULL",
    )
    .get(id, id, id).n;
  const refunded = db
    .prepare(
      "SELECT COALESCE(SUM(f.amount),0) n FROM refund_allocations f LEFT JOIN reversals r ON r.payment_id=f.payment_id WHERE f.document_id=? AND r.id IS NULL",
    )
    .get(id).n;
  return original + moved - refunded;
}
export function allocateRefund(db, id, party, mode, side, value) {
  let remaining = value;
  const kind = side === "receivable" ? "sale" : "purchase";
  for (const doc of db
    .prepare(
      "SELECT * FROM documents WHERE party_id=? AND tax_mode=? AND kind=? ORDER BY id",
    )
    .all(party, mode, kind)) {
    const credit = documentStatus(db, doc).credit,
      use = Math.min(credit, remaining);
    if (use > 0)
      db.prepare(
        "INSERT INTO refund_allocations(payment_id,document_id,amount) VALUES(?,?,?)",
      ).run(id, doc.id, use);
    remaining -= use;
    if (!remaining) break;
  }
  if (remaining)
    throw Error(
      "Refund credit could not be matched to its original estimates.",
    );
}
export function transferCredit(db, p, user) {
  return transaction(db, () => {
    const key = requestKey(p.request_id),
      value = amount(Number(p.amount)),
      source = db
        .prepare("SELECT * FROM documents WHERE id=?")
        .get(Number(p.source_id)),
      target = db
        .prepare("SELECT * FROM documents WHERE id=?")
        .get(Number(p.target_id));
    const existing = db
      .prepare("SELECT * FROM credit_requests WHERE request_id=?")
      .get(key);
    if (existing) {
      if (
        existing.source_id !== Number(p.source_id) ||
        existing.target_id !== Number(p.target_id) ||
        existing.amount !== value
      )
        throw Error("Request identifier already used.");
      return existing.id;
    }
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.party_id !== target.party_id ||
      source.tax_mode !== target.tax_mode ||
      source.kind !== target.kind
    )
      throw Error(
        "Choose two different records in the same party and GST category.",
      );
    if (
      documentStatus(db, source).credit < value ||
      documentStatus(db, target).outstanding < value
    )
      throw Error("Amount exceeds available credit or target balance.");
    const contributions = db
      .prepare(
        `SELECT payment_id,SUM(amount) amount FROM (SELECT a.payment_id,a.amount FROM allocations a WHERE document_id=? UNION ALL SELECT payment_id,amount FROM credit_transfers WHERE target_document_id=? UNION ALL SELECT payment_id,-amount FROM credit_transfers WHERE source_document_id=?) x WHERE NOT EXISTS(SELECT 1 FROM reversals r WHERE r.payment_id=x.payment_id) GROUP BY payment_id HAVING SUM(amount)>0 ORDER BY payment_id`,
      )
      .all(source.id, source.id, source.id);
    let remaining = value;
    for (const c of contributions) {
      const use = Math.min(c.amount, remaining);
      if (use > 0)
        db.prepare(
          "INSERT INTO credit_transfers(payment_id,source_document_id,target_document_id,amount,created_by) VALUES(?,?,?,?,?)",
        ).run(c.payment_id, source.id, target.id, use, user);
      remaining -= use;
      if (!remaining) break;
    }
    if (remaining)
      throw Error("Unable to match credit to the original payment.");
    const r = db
      .prepare(
        "INSERT INTO credit_requests(request_id,source_id,target_id,amount,created_by) VALUES(?,?,?,?,?)",
      )
      .run(key, source.id, target.id, value, user);
    audit(db, user, "apply-credit", "document", target.id, {
      source_id: source.id,
      amount: value,
    });
    return Number(r.lastInsertRowid);
  });
}

export function reverseAdjustment(db, p, user) {
  return transaction(db, () => {
    const key = requestKey(p.request_id),
      why = reason(p.reason),
      id = Number(p.adjustment_id),
      a = db.prepare("SELECT * FROM adjustments WHERE id=?").get(id);
    if (!a) throw Error("Adjustment not found.");
    const previous = db
      .prepare("SELECT * FROM adjustment_reversals WHERE request_id=?")
      .get(key);
    if (previous) {
      if (previous.adjustment_id !== id || previous.reason !== why)
        throw Error("Request identifier already used.");
      return previous.id;
    }
    if (
      db
        .prepare("SELECT id FROM adjustment_reversals WHERE adjustment_id=?")
        .get(id)
    )
      throw Error("This adjustment was already reversed.");
    const r = db
      .prepare(
        "INSERT INTO adjustment_reversals(adjustment_id,reason,created_by,request_id) VALUES(?,?,?,?)",
      )
      .run(id, why, user, key);
    audit(db, user, "reverse-adjustment", "adjustment", id, { reason: why });
    return Number(r.lastInsertRowid);
  });
}

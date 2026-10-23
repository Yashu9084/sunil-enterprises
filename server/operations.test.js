import test from "node:test";
import assert from "node:assert/strict";
import {
  openLedger,
  recordPayment,
  balance,
  calculateItems,
} from "./ledger.js";
import {
  addAdjustment,
  reverseAdjustment,
  reversePayment,
  documentStatus,
  transferCredit,
} from "./operations.js";
import {
  encryptBackup,
  decryptBackup,
  snapshot,
  validateBackup,
} from "./backups.js";
function fixture() {
  const d = openLedger(":memory:");
  d.prepare(
    "INSERT INTO users(id,name,username,hash,role) VALUES(1,?,?,?,?)",
  ).run("Owner", "owner", "not-a-real-hash", "owner");
  d.prepare("INSERT INTO parties(id,name,kind) VALUES(1,?,?)").run(
    "Customer",
    "customer",
  );
  d.prepare("INSERT INTO parties(id,name,kind) VALUES(2,?,?)").run(
    "Supplier",
    "supplier",
  );
  let n = 0;
  const key = () => `operation-request-${++n}`;
  const doc = (value, party = 1, mode = "gst") =>
    Number(
      d
        .prepare(
          "INSERT INTO documents(kind,party_id,tax_mode,items,total,created_by) VALUES(?,?,?,?,?,1)",
        )
        .run(party === 1 ? "sale" : "purchase", party, mode, "[]", value)
        .lastInsertRowid,
    );
  return { d, key, doc };
}
test("selected allocations reject mismatched parties, do not leave partial direct payments, and preserve idempotency", () => {
  const { d, key, doc } = fixture();
  try {
    const a = doc(10000),
      b = doc(20000),
      s = doc(30000, 2);
    const request = {
      customer_id: 1,
      supplier_id: 2,
      tax_mode: "gst",
      amount: 15000,
      reference: "DIRECT",
      request_id: key(),
      customer_documents: [b],
      supplier_documents: [s],
    };
    const id = recordPayment(d, request, 1);
    assert.equal(
      documentStatus(d, d.prepare("SELECT * FROM documents WHERE id=?").get(a))
        .allocated,
      0,
    );
    assert.equal(
      documentStatus(d, d.prepare("SELECT * FROM documents WHERE id=?").get(b))
        .allocated,
      15000,
    );
    assert.equal(recordPayment(d, request, 1), id);
    assert.throws(() =>
      recordPayment(d, { ...request, customer_documents: [a] }, 1),
    );
    assert.throws(() =>
      recordPayment(
        d,
        {
          ...request,
          amount: 10000,
          request_id: key(),
          customer_documents: [s],
        },
        1,
      ),
    );
    assert.equal(d.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
    assert.equal(balance(d, 2, "gst").payable, 15000);
  } finally {
    d.close();
  }
});
test("returned paid goods produce credit; transfer and refund consume it, payment reversals preserve arithmetic", () => {
  const { d, key, doc } = fixture();
  try {
    const source = doc(10000),
      target = doc(10000);
    const paid = recordPayment(
      d,
      {
        customer_id: 1,
        tax_mode: "gst",
        amount: 10000,
        reference: "PAID",
        request_id: key(),
        customer_documents: [source],
      },
      1,
    );
    const credit = addAdjustment(
      d,
      {
        type: "return",
        party_id: 1,
        document_id: source,
        tax_mode: "gst",
        side: "receivable",
        amount: 8000,
        reason: "Goods returned",
        request_id: key(),
      },
      1,
    );
    const transfer = {
      source_id: source,
      target_id: target,
      amount: 5000,
      request_id: key(),
    };
    transferCredit(d, transfer, 1);
    transferCredit(d, transfer, 1);
    assert.equal(
      documentStatus(
        d,
        d.prepare("SELECT * FROM documents WHERE id=?").get(source),
      ).credit,
      3000,
    );
    assert.equal(
      documentStatus(
        d,
        d.prepare("SELECT * FROM documents WHERE id=?").get(target),
      ).outstanding,
      5000,
    );
    assert.equal(balance(d, 1, "gst").receivable, 2000);
    assert.throws(() =>
      recordPayment(
        d,
        {
          customer_id: 1,
          flow: "refund",
          tax_mode: "gst",
          amount: 1,
          reference: "NO-CREDIT",
          request_id: key(),
        },
        1,
      ),
    );
    const targetPayment = recordPayment(
      d,
      {
        customer_id: 1,
        tax_mode: "gst",
        amount: 2000,
        reference: "NET-SETTLEMENT",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 0);
    const extraCredit = addAdjustment(
      d,
      {
        type: "return",
        party_id: 1,
        document_id: target,
        tax_mode: "gst",
        side: "receivable",
        amount: 1000,
        reason: "Additional return",
        request_id: key(),
      },
      1,
    );
    const refund = recordPayment(
      d,
      {
        customer_id: 1,
        flow: "refund",
        tax_mode: "gst",
        amount: 1000,
        reference: "REFUND",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 0);
    assert.throws(() =>
      transferCredit(
        d,
        {
          source_id: source,
          target_id: target,
          amount: 3001,
          request_id: key(),
        },
        1,
      ),
    );
    reversePayment(
      d,
      {
        payment_id: refund,
        reason: "Wrong refund recorded",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, -1000);
    reversePayment(
      d,
      { payment_id: paid, reason: "Wrong payment recorded", request_id: key() },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 9000);
    assert.equal(
      documentStatus(
        d,
        d.prepare("SELECT * FROM documents WHERE id=?").get(target),
      ).allocated,
      2000,
    );
    reverseAdjustment(
      d,
      {
        adjustment_id: credit,
        reason: "Return did not happen",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 17000);
  } finally {
    d.close();
  }
});
test("opening balance can be corrected without deleting history; duplicate credits and cancellations rejected", () => {
  const { d, key, doc } = fixture();
  try {
    const p = {
      type: "opening",
      party_id: 1,
      tax_mode: "non-gst",
      side: "receivable",
      amount: 5000,
      reason: "Old ledger entry",
      request_id: key(),
    };
    const id = addAdjustment(d, p, 1);
    assert.equal(addAdjustment(d, p, 1), id);
    assert.throws(() => addAdjustment(d, { ...p, request_id: key() }, 1));
    recordPayment(
      d,
      {
        customer_id: 1,
        tax_mode: "non-gst",
        amount: 1000,
        reference: "OPENING",
        request_id: key(),
      },
      1,
    );
    reverseAdjustment(
      d,
      { adjustment_id: id, reason: "Wrong opening amount", request_id: key() },
      1,
    );
    addAdjustment(d, { ...p, amount: 6000, request_id: key() }, 1);
    assert.equal(balance(d, 1, "non-gst").receivable, 5000);
    const a = doc(10000);
    addAdjustment(
      d,
      {
        type: "void",
        document_id: a,
        party_id: 1,
        tax_mode: "gst",
        side: "receivable",
        amount: 10000,
        reason: "Duplicate estimate",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 0);
    assert.throws(() =>
      addAdjustment(
        d,
        {
          type: "return",
          document_id: a,
          party_id: 1,
          tax_mode: "gst",
          side: "receivable",
          amount: 1,
          reason: "Another credit",
          request_id: key(),
        },
        1,
      ),
    );
  } finally {
    d.close();
  }
});
test("fractional quantities use exact scaled integers and per-line tax rounding", () => {
  assert.equal(
    calculateItems([{ name: "Wire", qty: 1.125, price: 999, gst: 18 }], "gst")
      .total,
    1326,
  );
  assert.throws(() =>
    calculateItems([{ name: "Wire", qty: 1.0001, price: 999 }], "gst"),
  );
});
test("backup tampering and incorrect passphrases fail authentication", () => {
  const { d } = fixture();
  try {
    const pass = "a-long-test-passphrase";
    const plain = snapshot(d),
      encoded = encryptBackup(plain, pass);
    assert.ok(decryptBackup(encoded, pass).equals(plain));
    assert.equal(validateBackup(plain).counts.parties, 2);
    assert.throws(() => decryptBackup(encoded, "wrong-long-passphrase"));
    encoded[encoded.length - 1] ^= 1;
    assert.throws(() => decryptBackup(encoded, pass));
    assert.throws(() => validateBackup(Buffer.from("not sqlite")));
  } finally {
    d.close();
  }
});
test("same bank reference from independent phones is blocked but a corrected reversed payment can be recorded", () => {
  const { d, key, doc } = fixture();
  try {
    doc(10000);
    const p = {
      customer_id: 1,
      tax_mode: "gst",
      amount: 1000,
      reference: " UPI-unique ",
      request_id: key(),
    };
    const id = recordPayment(d, p, 1);
    assert.throws(
      () =>
        recordPayment(
          d,
          { ...p, reference: "upi-UNIQUE", request_id: key() },
          1,
        ),
      /already recorded/,
    );
    reversePayment(
      d,
      { payment_id: id, reason: "Wrong amount entered", request_id: key() },
      1,
    );
    recordPayment(d, { ...p, amount: 2000, request_id: key() }, 1);
    assert.equal(balance(d, 1, "gst").receivable, 8000);
  } finally {
    d.close();
  }
});
test("fractional GST rates have the same exact paise rounding as integer rates", () => {
  assert.equal(
    calculateItems([{ name: "Item", qty: 1, price: 5000, gst: 0.29 }], "gst")
      .total,
    5015,
  );
  assert.equal(
    calculateItems([{ name: "Item", qty: 1, price: 10000, gst: 40 }], "gst")
      .total,
    14000,
  );
});
test("a direct payment can settle different GST categories on its two sides and reversal restores both", () => {
  const { d, key, doc } = fixture();
  try {
    const a = doc(10000, 1, "gst"),
      b = doc(8000, 2, "non-gst");
    const p = {
      customer_id: 1,
      supplier_id: 2,
      tax_mode: "gst",
      supplier_tax_mode: "non-gst",
      amount: 4000,
      reference: "CROSS-GST",
      request_id: key(),
      customer_documents: [a],
      supplier_documents: [b],
    };
    const id = recordPayment(d, p, 1);
    assert.equal(recordPayment(d, p, 1), id);
    assert.equal(balance(d, 1, "gst").receivable, 6000);
    assert.equal(balance(d, 1, "non-gst").receivable, 0);
    assert.equal(balance(d, 2, "non-gst").payable, 4000);
    assert.equal(balance(d, 2, "gst").payable, 0);
    assert.equal(
      documentStatus(d, d.prepare("SELECT * FROM documents WHERE id=?").get(b))
        .allocated,
      4000,
    );
    reversePayment(
      d,
      {
        payment_id: id,
        reason: "Wrong cross-category transfer",
        request_id: key(),
      },
      1,
    );
    assert.equal(balance(d, 1, "gst").receivable, 10000);
    assert.equal(balance(d, 2, "non-gst").payable, 8000);
  } finally {
    d.close();
  }
});

import { canonicalProof } from "./images.js";
import PDFDocument from "pdfkit";
import { resolve } from "node:path";
import { documentStatus } from "./operations.js";
import { balance } from "./ledger.js";
const rupees = (n) =>
  "INR " +
  (n / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const date = (s) =>
  new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
export async function renderPdf(
  db,
  {
    documentId,
    partyId,
    mode = "all",
    proof = true,
    lang = "en",
    paymentId = null,
  },
  res,
) {
  let records = documentId
    ? db.prepare("SELECT * FROM documents WHERE id=?").all(documentId)
    : db
        .prepare("SELECT * FROM documents WHERE party_id=? ORDER BY id")
        .all(partyId)
        .filter((d) => mode === "all" || d.tax_mode === mode);
  if (paymentId && partyId) {
    const p = db
      .prepare(
        "SELECT * FROM payments WHERE id=? AND (customer_id=? OR supplier_id=?)",
      )
      .get(paymentId, partyId, partyId);
    if (!p) {
      res
        .status(400)
        .json({ error: "Payment does not belong to this account." });
      return;
    }
    const ids = new Set([
      ...db
        .prepare("SELECT document_id FROM allocations WHERE payment_id=?")
        .all(paymentId)
        .map((a) => a.document_id),
      ...db
        .prepare(
          "SELECT source_document_id,target_document_id FROM credit_transfers WHERE payment_id=?",
        )
        .all(paymentId)
        .flatMap((a) => [a.source_document_id, a.target_document_id]),
    ]);
    records = records.filter((d) => ids.has(d.id));
  }
  if (proof)
    for (const d of records)
      for (const key of ["signature", "photo"])
        if (d[key])
          try {
            d[key] = await canonicalProof(d[key]);
          } catch {
            d[key] = null;
          }
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: documentId ? "Signed estimate" : "Account statement",
      Author: "Sunil Enterprises",
    },
  });
  doc.registerFont("Shop", resolve("assets/fonts/NotoSansDevanagari.ttf"));
  doc.font("Shop");
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${documentId ? "estimate-" + documentId : "statement-" + partyId}.pdf"`,
  });
  doc.on("error", () => res.destroy());
  doc.pipe(res);
  const t = (en, hi) => (lang === "hi" ? hi : en);
  const line = (text, size = 10, color = "#384b3f") => {
    if (doc.y > 750) doc.addPage();
    doc.fontSize(size).fillColor(color).text(String(text), { lineGap: 3 });
  };
  const gap = () => doc.moveDown(0.6);
  const image = (data, label, maxHeight) => {
    if (!data) return;
    try {
      const bytes = Buffer.from(data.split(",")[1], "base64");
      if (doc.y + maxHeight + 30 > 760) doc.addPage();
      line(label, 10);
      doc.image(bytes, 42, doc.y, { fit: [510, maxHeight], align: "left" });
      doc.y += maxHeight + 15;
    } catch {
      line(
        t(
          "Image could not be rendered; original proof remains in the application.",
          "चित्र नहीं खुल सका; मूल प्रमाण ऐप में सुरक्षित है।",
        ),
      );
    }
  };
  const document = (d) => {
    const s = documentStatus(db, d),
      p =
        JSON.parse(d.party_snapshot || "null") ||
        db.prepare("SELECT * FROM parties WHERE id=?").get(d.party_id),
      shop =
        JSON.parse(d.shop_snapshot || "null") ||
        JSON.parse(
          db.prepare("SELECT value FROM settings WHERE key='shop'").get()
            ?.value || "{}",
        );
    line(shop.name || "Sunil Enterprises", 20, "#153e35");
    if (shop.address) line(shop.address, 9);
    if (shop.phone) line(shop.phone, 9);
    if (shop.gstin) line("GSTIN: " + shop.gstin, 9);
    gap();
    line(
      d.kind === "sale"
        ? t(
            "SALES ESTIMATE — NOT A TAX INVOICE",
            "बिक्री अनुमान — टैक्स इनवॉइस नहीं",
          )
        : t("PURCHASE RECORD", "खरीद रिकॉर्ड"),
      11,
    );
    line(
      "SE-" +
        String(d.id).padStart(4, "0") +
        " · " +
        date(d.created_at) +
        " · " +
        d.tax_mode.toUpperCase(),
      10,
    );
    line(p.name, 13);
    if (p.address) line(p.address, 9);
    if (p.phone) line(p.phone, 9);
    if (p.gstin) line("GSTIN: " + p.gstin, 9);
    if (d.due_date)
      line(t("Payment due: ", "भुगतान की आखिरी तारीख: ") + d.due_date);
    gap();
    for (const i of JSON.parse(d.items)) {
      line(i.name, 11);
      line(
        `${i.qty} × ${rupees(i.price)}   |   GST ${i.gst}%: ${rupees(i.tax)}   |   ${rupees(i.total)}`,
        9,
      );
      gap();
    }
    line(t("Original total: ", "मूल कुल राशि: ") + rupees(d.total), 13);
    line(
      t("Net after credits: ", "क्रेडिट के बाद: ") + rupees(s.adjusted_total),
    );
    line(t("Payment allocated: ", "जुड़ा भुगतान: ") + rupees(s.allocated));
    line(
      t("Remaining on this record: ", "इस रिकॉर्ड पर बाकी: ") +
        rupees(s.outstanding),
    );
    if (s.credit)
      line(
        t("Credit on this record: ", "इस रिकॉर्ड पर क्रेडिट: ") +
          rupees(s.credit),
      );
    if (s.voided)
      line(
        t(
          "CANCELLED — original preserved for audit",
          "रद्द — मूल रिकॉर्ड सुरक्षित है",
        ),
        12,
        "#a54e35",
      );
    if (d.notes) line(d.notes, 10);
    for (const a of db
      .prepare("SELECT * FROM adjustments WHERE document_id=?")
      .all(d.id))
      line(
        `${a.type} · ${rupees(a.amount)} · ${date(a.created_at)} · ${a.reason}${db.prepare("SELECT id FROM adjustment_reversals WHERE adjustment_id=?").get(a.id) ? " · REVERSED" : ""}`,
        9,
      );
    if (proof) {
      image(d.signature, t("Customer signature", "ग्राहक के हस्ताक्षर"), 110);
      image(d.photo, t("Signed paper estimate", "हस्ताक्षर वाला कागज़"), 400);
      if (!d.signature && !d.photo)
        line(
          t("No signed proof attached.", "हस्ताक्षर वाला प्रमाण नहीं है।"),
          9,
        );
    }
    gap();
    line(
      t(
        "This estimate is not a statutory tax invoice. Payment entries are records, not bank verification.",
        "यह अनुमान टैक्स इनवॉइस नहीं है। भुगतान रिकॉर्ड बैंक पुष्टि नहीं है।",
      ),
      8,
      "#7c887c",
    );
  };
  if (documentId) {
    const d = records[0];
    if (!d) {
      doc.end();
      return;
    }
    document(d);
  } else {
    const p = db.prepare("SELECT * FROM parties WHERE id=?").get(partyId);
    line(
      t(
        "Account statement & signed estimates",
        "खाता विवरण और हस्ताक्षर वाले अनुमान",
      ),
      19,
    );
    line(p.name, 15);
    line(date(new Date().toISOString()), 9);
    if (p.address) line(p.address);
    gap();
    for (const m of ["gst", "non-gst"].filter(
      (m) => mode === "all" || m === mode,
    )) {
      const b = balance(db, p.id, m);
      line(m.toUpperCase(), 12);
      line(t("Customer balance: ", "ग्राहक बकाया: ") + rupees(b.receivable));
      line(t("Supplier balance: ", "सप्लायर बकाया: ") + rupees(b.payable));
      gap();
    }
    line(
      t(
        "Negative balances represent credit. Payments may be allocated across multiple estimates.",
        "ऋणात्मक बकाया क्रेडिट है। एक भुगतान कई अनुमानों में बँट सकता है।",
      ),
      9,
    );
    gap();
    line(t("Payments", "भुगतान"), 13);
    const payments = db
      .prepare(
        "SELECT p.*,r.id reversed FROM payments p LEFT JOIN reversals r ON r.payment_id=p.id WHERE customer_id=? OR supplier_id=? ORDER BY p.id",
      )
      .all(p.id, p.id);
    for (const pay of payments.filter(
      (x) =>
        (mode === "all" ||
          (x.supplier_id === p.id
            ? x.supplier_tax_mode || x.tax_mode
            : x.tax_mode) === mode) &&
        (!paymentId || x.id === paymentId),
    )) {
      const customer =
          db
            .prepare("SELECT name FROM parties WHERE id=?")
            .get(pay.customer_id || 0)?.name || t("Our shop", "हमारी दुकान"),
        supplier =
          db
            .prepare("SELECT name FROM parties WHERE id=?")
            .get(pay.supplier_id || 0)?.name || t("Our shop", "हमारी दुकान");
      line(
        `#${pay.id} · ${rupees(pay.amount)} · ${pay.reference} · ${pay.supplier_id === p.id ? pay.supplier_tax_mode || pay.tax_mode : pay.tax_mode}${pay.reversed ? " · REVERSED" : ""}`,
        10,
      );
      line(
        (pay.flow === "refund"
          ? supplier + " → " + customer
          : customer + " → " + supplier) +
          " · " +
          date(pay.created_at),
        9,
      );
      for (const a of db
        .prepare("SELECT * FROM allocations WHERE payment_id=?")
        .all(pay.id))
        line(
          `${a.side}: ${a.document_id ? "SE-" + String(a.document_id).padStart(4, "0") : "Opening #" + a.opening_id} · ${rupees(a.amount)}`,
          8,
        );
      gap();
    }
    line(t("Opening balances / corrections", "शुरुआती बकाया / सुधार"), 13);
    for (const a of db
      .prepare("SELECT * FROM adjustments WHERE party_id=? ORDER BY id")
      .all(p.id)
      .filter((a) => mode === "all" || a.tax_mode === mode)) {
      line(
        `${a.type} · ${a.tax_mode} · ${rupees(a.amount)} · ${date(a.created_at)}`,
        9,
      );
      line(
        a.reason +
          (db
            .prepare(
              "SELECT id FROM adjustment_reversals WHERE adjustment_id=?",
            )
            .get(a.id)
            ? " · REVERSED"
            : ""),
        9,
      );
    }
    for (const d of records) {
      doc.addPage();
      document(d);
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor("#8b948c")
      .text(`${i + 1} / ${range.count}`, 42, 790, { lineBreak: false });
  }
  doc.end();
}

import PDFDocument from "pdfkit";
import { resolve } from "node:path";
import { buildReport } from "./reports.js";
const column = (key, label, money = false) => ({ key, label, money });
export function reportColumns(type) {
  if (type === "summary")
    return [
      column("section", "Section"),
      column("label", "Metric"),
      column("value", "Value"),
      column("unit", "Unit"),
    ];
  if (type === "documents")
    return [
      column("date", "Date"),
      column("reference", "Estimate"),
      column("party", "Party"),
      column("kind", "Type"),
      column("tax_mode", "GST category"),
      column("entry_mode", "Entry"),
      column("total", "Original INR", true),
      column("adjusted_total", "Net INR", true),
      column("allocated", "Allocated INR", true),
      column("outstanding", "Due INR", true),
      column("status", "Status"),
    ];
  if (type === "payments")
    return [
      column("date", "Date"),
      column("reference", "Reference"),
      column("from", "From"),
      column("to", "To"),
      column("tax_mode", "Customer GST"),
      column("supplier_tax_mode", "Supplier GST"),
      column("route", "Route"),
      column("method", "Method"),
      column("flow", "Flow"),
      column("amount", "Amount INR", true),
      column("status", "Status"),
      column("reconciliation_reference", "Bank match"),
    ];
  if (type === "balances")
    return [
      column("party", "Party"),
      column("tax_mode", "GST category"),
      column("opening_receivable", "Opening customer INR", true),
      column("opening_payable", "Opening supplier INR", true),
      column("closing_receivable", "Closing customer INR", true),
      column("closing_payable", "Closing supplier INR", true),
    ];
  if (type === "ledger")
    return [
      column("date", "Date"),
      column("tax_mode", "GST category"),
      column("event", "Event"),
      column("reference", "Reference"),
      column("notes", "Details"),
      column("receivable_delta", "Customer change INR", true),
      column("payable_delta", "Supplier change INR", true),
      column("running_receivable", "Customer balance INR", true),
      column("running_payable", "Supplier balance INR", true),
    ];
  if (type === "items")
    return [
      column("name", "Item / part"),
      column("kind", "Type"),
      column("tax_mode", "GST category"),
      column("quantity", "Quantity"),
      column("amount", "Original amount INR", true),
      column("tax", "Original GST INR", true),
    ];
  return [
    column("date", "Date"),
    column("sales", "Gross sales INR", true),
    column("purchases", "Gross purchases INR", true),
    column("receivable_movement", "Customer balance change INR", true),
    column("payable_movement", "Supplier balance change INR", true),
  ];
}
export function exportRows(report) {
  if (report.filters.report === "summary")
    return [
      ...Object.entries(report.metrics).map(([label, amount]) => ({
        section: "Period activity",
        label,
        value: label.endsWith("count")
          ? String(amount)
          : (amount / 100).toFixed(2),
        unit: label.endsWith("count") ? "records" : "INR",
      })),
      ...Object.entries(report.bookTotals).map(([label, amount]) => ({
        section: "Balances at end date",
        label,
        value: (amount / 100).toFixed(2),
        unit: "INR",
      })),
      ...Object.entries(report.methods).map(([label, amount]) => ({
        section: "Net shop movement by method",
        label,
        value: (amount / 100).toFixed(2),
        unit: "INR",
      })),
      ...report.gst.flatMap((g) =>
        ["sales", "purchases"].map((key) => ({
          section: g.tax_mode,
          label: key,
          value: (g[key] / 100).toFixed(2),
          unit: "INR",
        })),
      ),
    ];
  const rows =
    report.filters.report === "ledger"
      ? [
          ...(report.positions || []).map((p) => ({
            date: report.filters.from || "Beginning",
            tax_mode: p.tax_mode,
            event: "opening-balance",
            notes:
              "Balances include every movement, even when search narrows this list.",
            running_receivable: p.opening_receivable,
            running_payable: p.opening_payable,
          })),
          ...report.rows,
          ...(report.positions || []).map((p) => ({
            date: report.filters.to,
            tax_mode: p.tax_mode,
            event: "closing-balance",
            running_receivable: p.closing_receivable,
            running_payable: p.closing_payable,
          })),
        ]
      : report.rows;
  return rows.map((row) => ({
    ...row,
    date:
      row.date ||
      (row.created_at &&
        new Date(new Date(row.created_at).getTime() + 19800000)
          .toISOString()
          .slice(0, 10)),
    reference:
      report.filters.report === "documents"
        ? "SE-" + String(row.id).padStart(4, "0")
        : row.reference,
    from: row.flow === "refund" ? row.supplier : row.customer,
    to: row.flow === "refund" ? row.customer : row.supplier,
    tax_mode:
      report.filters.report === "payments" && !row.customer_id
        ? ""
        : row.tax_mode,
    supplier_tax_mode: row.supplier_id
      ? row.supplier_tax_mode || row.tax_mode
      : "",
  }));
}
export function csvCell(value, numeric = false) {
  let text = String(value ?? "");
  if (!numeric && (/^[\s]*[=+\-@\t\r]/.test(text) || /^\d+$/.test(text)))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(report) {
  const columns = reportColumns(report.filters.report);
  const data = [
    columns.map((c) => csvCell(c.label)).join(","),
    ...exportRows(report).map((row) =>
      columns
        .map((c) =>
          csvCell(
            c.money ? ((row[c.key] || 0) / 100).toFixed(2) : row[c.key],
            c.money ||
              typeof row[c.key] === "number" ||
              (c.key === "value" && report.filters.report === "summary"),
          ),
        )
        .join(","),
    ),
  ];
  return "\ufeff" + data.join("\r\n") + "\r\n";
}
const hiLabels = {
  Section: "भाग",
  Metric: "हिसाब",
  Value: "राशि / संख्या",
  Unit: "इकाई",
  Date: "तारीख",
  Estimate: "अनुमान",
  Party: "पार्टी",
  Type: "प्रकार",
  "GST category": "GST श्रेणी",
  Entry: "तरीका",
  "Original INR": "मूल राशि रु.",
  "Net INR": "बदली राशि रु.",
  "Allocated INR": "जुड़ा भुगतान रु.",
  "Due INR": "बाकी रु.",
  Status: "स्थिति",
  Reference: "रेफरेंस",
  From: "किससे",
  To: "किसको",
  "Customer GST": "ग्राहक GST",
  "Supplier GST": "सप्लायर GST",
  Route: "रास्ता",
  Method: "तरीका",
  Flow: "भुगतान / वापसी",
  "Amount INR": "राशि रु.",
  "Bank match": "बैंक मिलान",
  "Opening customer INR": "ग्राहक शुरुआती रु.",
  "Opening supplier INR": "सप्लायर शुरुआती रु.",
  "Closing customer INR": "ग्राहक आखिरी रु.",
  "Closing supplier INR": "सप्लायर आखिरी रु.",
  Event: "रिकॉर्ड",
  Details: "विवरण",
  "Customer change INR": "ग्राहक बदलाव रु.",
  "Supplier change INR": "सप्लायर बदलाव रु.",
  "Customer balance INR": "ग्राहक बकाया रु.",
  "Supplier balance INR": "सप्लायर बकाया रु.",
  "Item / part": "सामान / पार्ट",
  Quantity: "मात्रा",
  "Original amount INR": "मूल राशि रु.",
  "Original GST INR": "मूल GST रु.",
  "Gross sales INR": "कुल बिक्री रु.",
  "Gross purchases INR": "कुल खरीद रु.",
  "Customer balance change INR": "ग्राहक बदलाव रु.",
  "Supplier balance change INR": "सप्लायर बदलाव रु.",
};
export function renderReportPdf(report, res) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 32, bottom: 40, left: 32, right: 32 },
    bufferPages: true,
  });
  doc
    .registerFont("Shop", resolve("assets/fonts/NotoSansDevanagari.ttf"))
    .font("Shop");
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${report.filters.report}-report.pdf"`,
  });
  doc.on("error", () => res.destroy());
  doc.pipe(res);
  const width = doc.page.width - 64;
  const line = (text, size = 11) => {
    doc
      .fontSize(size)
      .fillColor("#16291c")
      .text(String(text), 32, doc.y, { width });
    doc.moveDown(0.3);
  };
  line("Sunil Enterprises — " + report.filters.report.toUpperCase(), 20);
  line(
    `${report.filters.from || "Beginning"} to ${report.filters.to} (India time) | ${report.filters.tax_mode} | ${report.total} matching rows`,
  );
  if (report.positions?.length)
    for (const p of report.positions)
      line(
        `${p.party} | ${p.tax_mode} | Customer opening ${(p.opening_receivable / 100).toFixed(2)}, closing ${(p.closing_receivable / 100).toFixed(2)} | Supplier opening ${(p.opening_payable / 100).toFixed(2)}, closing ${(p.closing_payable / 100).toFixed(2)} INR`,
      );
  if (
    ["summary", "daybook", "documents"].includes(report.filters.report)
  )
    line(
      `Gross sales ${(report.metrics.sales / 100).toFixed(2)} | Gross purchases ${(report.metrics.purchases / 100).toFixed(2)} INR`,
    );
  if (["summary", "daybook", "payments"].includes(report.filters.report))
    line(
      `Received by shop ${(report.metrics.received / 100).toFixed(2)} | Paid by shop ${(report.metrics.paid / 100).toFixed(2)} | Direct ${(report.metrics.direct / 100).toFixed(2)} INR`,
    );
  line(
    "Filters: " +
      Object.entries(report.filters)
        .filter(
          ([key, value]) =>
            !["start", "end", "page", "from", "to", "report"].includes(key) &&
            value &&
            value !== "all",
        )
        .map(([key, value]) => `${key}=${value}`)
        .join(" | "),
    9,
  );
  line(
    "Long text may be shortened in this PDF; the CSV contains full details.",
    9,
  );
  line(
    "Negative balances are credit. Reversals use their recorded date; direct transfers do not pass through the shop.",
    9,
  );
  if (report.filters.report === "items")
    line(
      `Photo-only records excluded from item detail: ${report.metrics.photo_count}, total ${(report.metrics.photo_total / 100).toFixed(2)} INR. Original item values before unallocated returns.`,
      10,
    );
  const cols = reportColumns(report.filters.report).map((c) => ({
      ...c,
      label:
        report.filters.lang === "hi" ? hiLabels[c.label] || c.label : c.label,
    })),
    cellWidth = width / cols.length;
  const heading = () => {
    const y = doc.y;
    doc.rect(32, y, width, 36).fill("#e8eee7");
    cols.forEach((c, i) =>
      doc
        .fontSize(9)
        .fillColor("#172b20")
        .text(c.label, 32 + i * cellWidth + 4, y + 4, {
          width: cellWidth - 8,
          height: 30,
        }),
    );
    doc.y = y + 36;
  };
  heading();
  for (const row of exportRows(report)) {
    const values = cols.map((c) =>
      c.money
        ? ((row[c.key] || 0) / 100).toFixed(2)
        : String(row[c.key] ?? "").slice(0, 160) +
          (String(row[c.key] ?? "").length > 160 ? "…" : ""),
    );
    let height = Math.max(
      28,
      ...values.map(
        (value) =>
          doc.fontSize(10).heightOfString(value, { width: cellWidth - 8 }) + 10,
      ),
    );
    // Keep a complete row on one page; CSV retains text shortened above.
    if (doc.y + height > doc.page.height - 48) {
      doc.addPage();
      line(report.filters.report + " — continued", 13);
      heading();
    }
    const y = doc.y;
    values.forEach((value, i) =>
      doc
        .fontSize(10)
        .fillColor("#111111")
        .text(value, 32 + i * cellWidth + 4, y + 5, {
          width: cellWidth - 8,
          align: cols[i].money ? "right" : "left",
        }),
    );
    doc
      .strokeColor("#b5c1b6")
      .lineWidth(0.5)
      .moveTo(32, y + height)
      .lineTo(32 + width, y + height)
      .stroke();
    doc.y = y + height;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .text(`${i + 1} / ${range.count}`, 32, doc.page.height - 28, {
        lineBreak: false,
      });
  }
  doc.end();
}
export function exportReport(db, query, response, format) {
  const report = buildReport(db, query, { allRows: true });
  if (format === "pdf") return renderReportPdf(report, response);
  response
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.filters.report}-${report.filters.to}.csv"`,
    })
    .send(reportCsv(report));
}

import React, { useEffect, useState } from "react";
import { api, money, date } from "./lib.js";
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const dayAgo = (n) =>
  new Date(Date.now() + 19800000 - n * 86400000).toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 7) + "-01";
const reports = [
  ["summary", "Overview", "सारांश"],
  ["documents", "Estimates & purchases", "अनुमान और खरीद"],
  ["payments", "Payments", "भुगतान"],
  ["balances", "Outstanding & credits", "बकाया और क्रेडिट"],
  ["ledger", "Party statement", "पार्टी का खाता"],
  ["daybook", "Daily activity", "रोज़ का हिसाब"],
  ["items", "Item-wise", "सामान के अनुसार"],
];
export function ReportFilters({
  value,
  onChange,
  parties,
  type = "documents",
  t,
  search = true,
  users = [],
}) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const select = (key, label, options) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value[key] || "all"}
        onChange={(e) => set(key, e.target.value)}
      >
        {options.map(([v, en, hi]) => (
          <option key={v} value={v}>
            {t(en, hi)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="report-filters no-print">
      <div className="report-presets">
        <button
          type="button"
          onClick={() => onChange({ ...value, from: today(), to: today() })}
        >
          {t("Today", "आज")}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...value, from: dayAgo(6), to: today() })}
        >
          {t("Last 7 days", "पिछले 7 दिन")}
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({ ...value, from: monthStart(), to: today() })
          }
        >
          {t("This month", "इस महीने")}
        </button>
        <button
          type="button"
          onClick={() => {
            const day = today();
            const year =
              Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0);
            onChange({ ...value, from: `${year}-04-01`, to: day });
          }}
        >
          {t("Financial year", "वित्त वर्ष")}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...value, from: "", to: "" })}
        >
          {t("All dates", "सभी तारीखें")}
        </button>
      </div>
      <div className="report-filter-grid">
        <label>
          {t("From date", "कब से")}
          <input
            aria-label="From date"
            type="date"
            value={value.from || ""}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label>
          {t("To date", "कब तक")}
          <input
            aria-label="To date"
            type="date"
            value={value.to || ""}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        <label>
          {t("Party", "पार्टी")}
          <select
            aria-label="Report party"
            value={value.party || ""}
            onChange={(e) => set("party", e.target.value)}
          >
            <option value="">{t("All parties", "सभी पार्टियाँ")}</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {select("tax_mode", t("GST category", "GST श्रेणी"), [
          ["all", "Both categories", "दोनों श्रेणियाँ"],
          ["gst", "GST", "GST"],
          ["non-gst", "Non-GST", "बिना GST"],
        ])}
        {["documents", "items"].includes(type) &&
          select("kind", t("Record type", "रिकॉर्ड का प्रकार"), [
            ["all", "Sales and purchases", "बिक्री और खरीद"],
            ["sale", "Sales", "बिक्री"],
            ["purchase", "Purchases", "खरीद"],
          ])}
        {type === "documents" && (
          <>
            {select("entry_mode", t("Entry method", "भरने का तरीका"), [
              ["all", "All entries", "सभी रिकॉर्ड"],
              ["photo", "Photo + total", "फोटो + कुल राशि"],
              ["items", "With item details", "सामान के विवरण वाले"],
            ])}
            {select("status", t("Estimate status", "अनुमान की स्थिति"), [
              ["all", "All statuses", "सभी स्थितियाँ"],
              ["unpaid", "Unpaid", "भुगतान बाकी"],
              ["partial", "Part paid", "कुछ भुगतान हुआ"],
              ["settled", "Settled", "हिसाब पूरा"],
              ["overdue", "Overdue", "तारीख निकल गई"],
              ["credit", "Credit remaining", "क्रेडिट बाकी"],
              ["cancelled", "Cancelled", "रद्द"],
            ])}
          </>
        )}
        {["documents", "payments"].includes(type) && users.length > 0 && (
          <label>
            {t("Entered by", "किसने भरा")}
            <select
              aria-label="Entered by"
              value={value.staff || ""}
              onChange={(e) => set("staff", e.target.value)}
            >
              <option value="">{t("All staff", "सभी स्टाफ")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "balances" &&
          select("balance_status", t("Balance filter", "बकाया चुनें"), [
            ["all", "All balances", "सभी खाते"],
            ["due", "Money to collect or pay", "लेना या देना बाकी"],
            ["credit", "Credits / advances", "क्रेडिट / अग्रिम"],
            ["zero", "Zero balances", "हिसाब पूरा"],
          ])}
        {type === "payments" && (
          <>
            {select("route", t("Payment route", "भुगतान का रास्ता"), [
              ["all", "All routes", "सभी रास्ते"],
              ["received", "Customer to shop", "ग्राहक से दुकान"],
              ["paid", "Shop to supplier", "दुकान से सप्लायर"],
              ["direct", "Customer to supplier", "ग्राहक से सप्लायर सीधे"],
            ])}
            {select("method", t("Payment method", "भुगतान का तरीका"), [
              ["all", "All methods", "सभी तरीके"],
              ["cash", "Cash", "नकद"],
              ["upi", "UPI", "UPI"],
              ["bank", "Bank", "बैंक"],
            ])}
            {select("flow", t("Payment flow", "भुगतान या वापसी"), [
              ["all", "Payments and refunds", "भुगतान और वापसी"],
              ["settlement", "Payments", "भुगतान"],
              ["refund", "Refunds", "वापसी"],
            ])}
            {select("status", t("Payment status", "भुगतान की स्थिति"), [
              ["all", "Active and reversed", "सही और वापस किए गए"],
              ["active", "Active", "सही रिकॉर्ड"],
              ["reversed", "Reversed", "वापस किया गया रिकॉर्ड"],
            ])}
            {select("reconciled", t("Bank matching", "बैंक से मिलान"), [
              ["all", "Matched and unmatched", "सभी रिकॉर्ड"],
              ["yes", "Matched", "मिलान हुआ"],
              ["no", "Not matched", "मिलान नहीं हुआ"],
            ])}
          </>
        )}
        {search && (
          <label>
            {t("Search", "खोजें")}
            <input
              aria-label="Report search"
              value={value.q || ""}
              onChange={(e) => set("q", e.target.value)}
              placeholder={t("Name, reference or notes", "नाम, रेफरेंस या नोट")}
            />
          </label>
        )}
      </div>
      <button type="button" className="text-btn" onClick={() => onChange({})}>
        {t("Reset filters", "फिल्टर हटाएँ")}
      </button>
    </div>
  );
}
const columns = {
  summary: [
    ["date", "Date", "तारीख"],
    ["sales", "Gross sales", "कुल बिक्री", 1],
    ["purchases", "Gross purchases", "कुल खरीद", 1],
    ["receivable_movement", "Customer change", "ग्राहक खाते में बदलाव", 1],
    ["payable_movement", "Supplier change", "सप्लायर खाते में बदलाव", 1],
  ],
  documents: [
    ["id", "Record", "रिकॉर्ड"],
    ["created_at", "Date", "तारीख"],
    ["party", "Party", "पार्टी"],
    ["kind", "Type", "प्रकार"],
    ["tax_mode", "GST", "GST"],
    ["entry_mode", "Entry", "तरीका"],
    ["total", "Original", "मूल राशि", 1],
    ["outstanding", "Outstanding", "बाकी", 1],
    ["status", "Status", "स्थिति"],
  ],
  payments: [
    ["created_at", "Date", "तारीख"],
    ["reference", "Reference", "रेफरेंस"],
    ["customer", "Customer / shop", "ग्राहक / दुकान"],
    ["supplier", "Supplier / shop", "सप्लायर / दुकान"],
    ["route", "Route", "रास्ता"],
    ["tax_mode", "Customer GST", "ग्राहक GST"],
    ["supplier_tax_mode", "Supplier GST", "सप्लायर GST"],
    ["flow", "Payment / refund", "भुगतान / वापसी"],
    ["method", "Method", "तरीका"],
    ["amount", "Amount", "राशि", 1],
    ["status", "Status", "स्थिति"],
  ],
  balances: [
    ["party", "Party", "पार्टी"],
    ["tax_mode", "GST", "GST"],
    ["opening_receivable", "Customer opening", "ग्राहक का शुरुआती बकाया", 1],
    ["closing_receivable", "Customer closing", "ग्राहक का आखिरी बकाया", 1],
    ["opening_payable", "Supplier opening", "सप्लायर का शुरुआती बकाया", 1],
    ["closing_payable", "Supplier closing", "सप्लायर का आखिरी बकाया", 1],
  ],
  ledger: [
    ["created_at", "Date", "तारीख"],
    ["tax_mode", "GST", "GST"],
    ["event", "Event", "रिकॉर्ड"],
    ["reference", "Reference", "रेफरेंस"],
    ["notes", "Details", "विवरण"],
    ["receivable_delta", "Customer change", "ग्राहक खाते में बदलाव", 1],
    ["payable_delta", "Supplier change", "सप्लायर खाते में बदलाव", 1],
    ["running_receivable", "Customer balance", "ग्राहक बकाया", 1],
    ["running_payable", "Supplier balance", "सप्लायर बकाया", 1],
  ],
  items: [
    ["name", "Item / part", "सामान / पार्ट"],
    ["kind", "Type", "प्रकार"],
    ["tax_mode", "GST", "GST"],
    ["quantity", "Quantity", "मात्रा"],
    ["amount", "Original total", "मूल कुल राशि", 1],
    ["tax", "Original GST", "मूल GST", 1],
  ],
};
export function Reports({
  state,
  t,
  initialReport = "summary",
  initialParty = "",
  compact = false,
}) {
  const [type, setType] = useState(initialReport),
    [filters, setFilters] = useState({
      from: monthStart(),
      to: today(),
      party: initialParty,
    }),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const change = (next) => {
    setFilters(next);
    setPage(1);
    setData(null);
  };
  const query = new URLSearchParams(
    Object.entries({
      ...filters,
      report: type,
      page,
      lang: localStorage.getItem("lang") || "en",
    }).filter(([, v]) => v !== "" && v !== undefined),
  ).toString();
  useEffect(() => {
    if (type === "ledger" && !filters.party) {
      setData(null);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api("reports?" + query)
          .then((d) => {
            if (!cancelled) setData(d);
          })
          .catch((e) => {
            if (!cancelled) {
              setError(e.message);
              setData(null);
            }
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          }),
      180,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const cols = columns[type] || columns.summary;
  const statusText = (value) =>
    ({
      photo: t("Photo + total", "फोटो + कुल राशि"),
      items: t("Item details", "सामान का विवरण"),
      sale: t("Sale", "बिक्री"),
      purchase: t("Purchase", "खरीद"),
      unpaid: t("Unpaid", "बाकी"),
      partial: t("Part paid", "कुछ भुगतान"),
      settled: t("Settled", "हिसाब पूरा"),
      cancelled: t("Cancelled", "रद्द"),
      credit: t("Credit", "क्रेडिट"),
      reversed: t("Reversed", "वापस किया गया"),
      active: t("Active", "सही"),
      received: t("Customer → shop", "ग्राहक → दुकान"),
      paid: t("Shop → supplier", "दुकान → सप्लायर"),
      direct: t("Customer → supplier", "ग्राहक → सप्लायर"),
      refund: t("Refund", "वापसी"),
      settlement: t("Payment", "भुगतान"),
      opening: t("Opening balance", "शुरुआती बकाया"),
      return: t("Return", "सामान वापसी"),
      void: t("Cancellation", "रद्द"),
      "reverse-opening": t("Opening reversed", "शुरुआती बकाया वापस"),
      "reverse-return": t("Return reversed", "सामान वापसी रद्द"),
      "reverse-void": t("Cancellation reversed", "रद्द करने का सुधार"),
      "payment-reversal": t("Payment reversed", "भुगतान रिकॉर्ड वापस"),
      cash: t("Cash", "नकद"),
      bank: t("Bank", "बैंक"),
      upi: "UPI",
      "non-gst": t("Non-GST", "बिना GST"),
      gst: "GST",
    })[value] || value;
  const displayCell = (row, key) => {
    if (key === "created_at") return date(row[key]);
    if (key === "id") return "SE-" + String(row[key]).padStart(4, "0");
    if (
      type === "payments" &&
      ((key === "tax_mode" && !row.customer_id) ||
        (key === "supplier_tax_mode" && !row.supplier_id))
    )
      return "—";
    const value = row[key] ?? "—";
    return [
      "kind",
      "tax_mode",
      "supplier_tax_mode",
      "entry_mode",
      "status",
      "route",
      "method",
      "flow",
      "event",
    ].includes(key)
      ? statusText(value)
      : value;
  };
  return (
    <section className="panel reports" aria-label="Reports">
      <div className="panel-title">
        <h2>{t("Reports & statements", "रिपोर्ट और खाता विवरण")}</h2>
      </div>
      {!compact && (
        <div className="report-tabs no-print">
          {reports.map(([id, en, hi]) => (
            <button
              type="button"
              key={id}
              className={type === id ? "selected" : ""}
              onClick={() => {
                setType(id);
                change({
                  from: filters.from,
                  to: filters.to,
                  party: filters.party,
                  tax_mode: filters.tax_mode,
                });
              }}
            >
              {t(en, hi)}
            </button>
          ))}
        </div>
      )}
      <ReportFilters
        value={filters}
        onChange={change}
        parties={state.parties}
        type={type}
        t={t}
        users={state.users || []}
        search={!["summary", "daybook"].includes(type)}
      />
      {type === "ledger" && !filters.party && (
        <p className="notice">
          {t(
            "Choose a party to see its opening, movements and closing balances.",
            "शुरुआती बकाया, लेन-देन और आखिरी बकाया देखने के लिए पार्टी चुनें।",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p role="status">
          {t("Loading complete-book totals…", "पूरे खाते का हिसाब आ रहा है…")}
        </p>
      )}
      {data && (
        <>
          <p className="hint">
            {data.filters.from || t("Beginning", "शुरुआत")} → {data.filters.to}{" "}
            ·{" "}
            {t(
              "India time. Balances and status are as of the end date.",
              "भारत का समय। बकाया और स्थिति आखिरी तारीख तक की हैं।",
            )}
          </p>
          {["summary", "documents", "items"].includes(type) && (
            <p>
              {t("Sales records", "बिक्री रिकॉर्ड")}: {data.metrics.sales_count}{" "}
              · {t("Purchase records", "खरीद रिकॉर्ड")}:{" "}
              {data.metrics.purchase_count} ·{" "}
              {t("Photo-only records", "केवल फोटो वाले रिकॉर्ड")}:{" "}
              {data.metrics.photo_count}
            </p>
          )}
          <div className="report-metrics">
            {[
              [t("Gross sales", "कुल बिक्री"), data.metrics.sales],
              [
                t("Net sales after corrections", "सुधार के बाद बिक्री"),
                data.metrics.net_sales,
              ],
              [t("Gross purchases", "कुल खरीद"), data.metrics.purchases],
              [t("Received by shop", "दुकान को मिला"), data.metrics.received],
              [t("Paid by shop", "दुकान ने दिया"), data.metrics.paid],
              [t("Direct transfers", "सीधे ट्रांसफर"), data.metrics.direct],
              [
                t("Customer refunds", "ग्राहक को वापसी"),
                data.metrics.customer_refunds,
              ],
              [
                t("Supplier refunds", "सप्लायर से वापसी"),
                data.metrics.supplier_refunds,
              ],
              [
                t("To collect at end date", "आखिरी तारीख पर लेना बाकी"),
                data.bookTotals.collect,
              ],
              [
                t("To pay at end date", "आखिरी तारीख पर देना बाकी"),
                data.bookTotals.pay,
              ],
              [
                t("Customer credits", "ग्राहकों का क्रेडिट"),
                data.bookTotals.customer_credit,
              ],
              [
                t("Supplier advances", "सप्लायर को अग्रिम"),
                data.bookTotals.supplier_credit,
              ],
            ]
              .filter(([label]) => {
                if (["summary", "daybook"].includes(type)) return true;
                if (["balances", "ledger"].includes(type))
                  return [
                    t("To collect at end date", "आखिरी तारीख पर लेना बाकी"),
                    t("To pay at end date", "आखिरी तारीख पर देना बाकी"),
                    t("Customer credits", "ग्राहकों का क्रेडिट"),
                    t("Supplier advances", "सप्लायर को अग्रिम"),
                  ].includes(label);
                if (type === "items") return false;
                if (type === "payments")
                  return [
                    t("Received by shop", "दुकान को मिला"),
                    t("Paid by shop", "दुकान ने दिया"),
                    t("Direct transfers", "सीधे ट्रांसफर"),
                    t("Customer refunds", "ग्राहक को वापसी"),
                    t("Supplier refunds", "सप्लायर से वापसी"),
                  ].includes(label);
                return [
                  t("Gross sales", "कुल बिक्री"),
                  t("Gross purchases", "कुल खरीद"),
                ].includes(label);
              })
              .map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{money(value)}</strong>
                </div>
              ))}
          </div>
          {type === "summary" && (
            <>
              <h3>{t("GST / non-GST activity", "GST / बिना GST का हिसाब")}</h3>
              <div className="statement-balances">
                {data.gst.map((g) => (
                  <span key={g.tax_mode}>
                    {g.tax_mode.toUpperCase()} · {t("Sales", "बिक्री")}{" "}
                    {money(g.sales)} · {t("Purchases", "खरीद")}{" "}
                    {money(g.purchases)}
                  </span>
                ))}
              </div>
              <p>
                {t(
                  "Net money movement through shop (direct transfers excluded)",
                  "दुकान में पैसे का कुल बदलाव (सीधे ट्रांसफर अलग हैं)",
                )}
                : {money(data.metrics.net_shop_movement)} · Cash{" "}
                {money(data.methods.cash)} · UPI {money(data.methods.upi)} ·
                Bank {money(data.methods.bank)}
              </p>
            </>
          )}
          {data.positions?.map((p) => (
            <div className="notice" key={p.tax_mode}>
              {p.party} · {p.tax_mode}:{" "}
              {t(
                "Customer opening → closing",
                "ग्राहक का शुरुआती → आखिरी बकाया",
              )}{" "}
              {money(p.opening_receivable)} → {money(p.closing_receivable)} ·{" "}
              {t(
                "Supplier opening → closing",
                "सप्लायर का शुरुआती → आखिरी बकाया",
              )}{" "}
              {money(p.opening_payable)} → {money(p.closing_payable)}
            </div>
          ))}
          <p className="hint">
            {t(
              "Direct transfers never count as shop bank receipts/payments. Negative balances are credits; categories are not offset.",
              "सीधे ट्रांसफर दुकान के बैंक में आए/गए पैसे नहीं हैं। ऋणात्मक बकाया क्रेडिट है; श्रेणियाँ अलग रखी जाती हैं।",
            )}
          </p>
          {type === "items" && (
            <p className="notice">
              {t(
                "Original item quantities/values, before returns. Records without item details:",
                "वापसी से पहले की मूल मात्रा/राशि। बिना सामान के विवरण वाले रिकॉर्ड:",
              )}{" "}
              {data.metrics.photo_count} · {money(data.metrics.photo_total)}
              <br />
              {t("Matching item total", "मिलते सामान की कुल राशि")}:{" "}
              {money(data.metrics.item_amount || 0)}
            </p>
          )}
          {type === "ledger" && (
            <p className="hint">
              {t(
                "Search filters the list, not the opening/closing balances. Each GST category has its own running balance.",
                "खोज सिर्फ सूची पर लगती है, शुरुआती/आखिरी बकाया पर नहीं। दोनों GST श्रेणियों का हिसाब अलग है।",
              )}
            </p>
          )}
          {state.user.role === "owner" && (
            <div className="button-group no-print">
              <a
                className="secondary"
                href={"/api/reports/export.csv?" + query}
              >
                {t("Download CSV (all matches)", "CSV डाउनलोड (सभी रिकॉर्ड)")}
              </a>
              <a
                className="secondary"
                href={"/api/reports/export.pdf?" + query}
                target="_blank"
                rel="noreferrer"
              >
                {t("Download report PDF", "रिपोर्ट PDF डाउनलोड")}
              </a>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {cols.map(([key, en, hi, m]) => (
                    <th key={key} className={m ? "right" : ""}>
                      {t(en, hi)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.id || i}>
                    {cols.map(([key, en, hi, m]) => (
                      <td key={key} className={m ? "right" : ""}>
                        {m ? money(row[key] || 0) : displayCell(row, key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.total && (
            <p>
              {t(
                "No records match these filters.",
                "इन फिल्टर में कोई रिकॉर्ड नहीं मिला।",
              )}
            </p>
          )}
          <div className="pagination no-print">
            <span>
              {data.total} {t("matching rows", "मिलते रिकॉर्ड")} · {data.page}/
              {data.pages}
            </span>
            <button
              className="secondary"
              disabled={loading || data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              {t("Previous", "पिछला")}
            </button>
            <button
              className="secondary"
              disabled={loading || data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              {t("Next", "अगला")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

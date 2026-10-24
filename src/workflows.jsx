import { Reports } from "./Reports.jsx";
import React, { useState } from "react";
import {
  Plus,
  Download,
  ShieldCheck,
  FileText,
  Check,
  ArrowLeftRight,
} from "lucide-react";
import { money, date, paise, api, download, sharePdf } from "./lib.js";
export function AdjustmentForm({ state, modal, save, busy, t, setError }) {
  const doc = modal.doc,
    [kind, setKind] = useState(doc ? "return" : "opening"),
    [mode, setMode] = useState(doc?.tax_mode || "non-gst"),
    [key] = useState(() => crypto.randomUUID());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = Object.fromEntries(new FormData(e.currentTarget));
          save("adjustments", {
            ...f,
            type: kind,
            tax_mode: mode,
            document_id: doc?.id,
            party_id: doc?.party_id || f.party_id,
            side: doc
              ? doc.kind === "sale"
                ? "receivable"
                : "payable"
              : f.side,
            amount: kind === "void" ? doc.adjusted_total : paise(f.amount),
            request_id: key,
          });
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      {doc ? (
        <>
          <p>
            {t("Record", "रिकॉर्ड")} SE-{String(doc.id).padStart(4, "0")} ·{" "}
            {money(doc.adjusted_total)}
          </p>
          <label>
            {t("Action", "कार्य")}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="return">
                {t("Return / credit adjustment", "वापसी / राशि कम करें")}
              </option>
              <option value="void">
                {t("Cancel this record", "यह रिकॉर्ड रद्द करें")}
              </option>
            </select>
          </label>
        </>
      ) : (
        <>
          <div className="notice">
            {t(
              "Enter balances from the old paper ledger before adding transactions. Enter each category once; do not include estimates already recorded here.",
              "लेन-देन शुरू करने से पहले पुराने खाते की बकाया राशि डालें। हर श्रेणी में एक बार ही डालें। यहाँ दर्ज अनुमानों को दोबारा न जोड़ें।",
            )}
          </div>
          <label>
            {t("Party", "पार्टी")}
            <select
              name="party_id"
              required
              defaultValue={modal.party?.id || ""}
            >
              <option value="">{t("Choose party", "पार्टी चुनें")}</option>
              {state.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Balance type", "बकाया का प्रकार")}
            <select name="side">
              <option value="receivable">
                {t("Customer owes our shop", "ग्राहक से हमें लेना है")}
              </option>
              <option value="payable">
                {t("Our shop owes supplier", "हमें सप्लायर को देना है")}
              </option>
            </select>
          </label>
          <label>
            {t("Tax category", "GST श्रेणी")}
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="non-gst">Non-GST</option>
              <option value="gst">GST</option>
            </select>
          </label>
        </>
      )}
      {kind !== "void" && (
        <label>
          {t("Amount (₹)", "राशि (₹)")}
          <input name="amount" required inputMode="decimal" />
        </label>
      )}
      <label>
        {t("Reason / old ledger reference", "कारण / पुराने खाते का संदर्भ")}
        <textarea name="reason" required minLength={3} maxLength={1000} />
      </label>
      <div className="notice">
        {t(
          "The original record stays unchanged. A separate dated entry will explain this change. Credits on paid estimates can be refunded from Payments.",
          "पुराना रिकॉर्ड नहीं बदलेगा। बदलाव अलग तारीख वाले रिकॉर्ड में रहेगा। भुगतान किए अनुमान पर क्रेडिट को भुगतान स्क्रीन से वापस कर सकते हैं।",
        )}
      </div>
      <button className="primary full" disabled={busy}>
        {t("Confirm & save adjustment", "पुष्टि करके बदलाव सेव करें")}
      </button>
    </form>
  );
}
export function ReverseForm({ modal, save, busy, t }) {
  const [key] = useState(() => crypto.randomUUID());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        save("payments/reverse", {
          payment_id: modal.payment.id,
          reason: f.reason,
          request_id: key,
        });
      }}
    >
      <div className="notice">
        {t(
          "This corrects a mistaken entry; it does not undo a bank transfer. Both affected balances will be restored. The original entry remains visible.",
          "इससे गलत रिकॉर्ड सुधरेगा; बैंक ट्रांसफर वापस नहीं होगा। दोनों खातों का बकाया वापस जुड़ेगा। पुराना रिकॉर्ड दिखाई देता रहेगा।",
        )}
      </div>
      <h3>
        {money(modal.payment.amount)} · {modal.payment.reference}
      </h3>
      <label>
        {t("Reason for reversal", "भुगतान रिकॉर्ड पलटने का कारण")}
        <textarea name="reason" minLength={3} required />
      </label>
      <button className="primary full" disabled={busy}>
        {t("Confirm reversal", "पलटने की पुष्टि करें")}
      </button>
    </form>
  );
}
export function StaffForm({ modal, save, busy, t }) {
  const u = modal.staff;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        save("users/" + u.id + "/manage", {
          active: f.active === "yes",
          ...(f.password ? { password: f.password } : {}),
        });
      }}
    >
      <h3>
        {u.name} · {u.username}
      </h3>
      <label>
        {t("Account access", "खाते की पहुँच")}
        <select name="active" defaultValue={u.active ? "yes" : "no"}>
          <option value="yes">{t("Active", "चालू")}</option>
          <option value="no">{t("Disabled", "बंद")}</option>
        </select>
      </label>
      <label>
        {t("New password (optional)", "नया पासवर्ड (वैकल्पिक)")}
        <input
          name="password"
          type="password"
          minLength={12}
          maxLength={256}
          autoComplete="new-password"
        />
      </label>
      <p>
        {t(
          "Saving signs this staff member out of all phones. Their old financial entries remain.",
          "सेव करने पर यह स्टाफ सभी फोन से साइन आउट होगा। उसके पुराने लेन-देन रहेंगे।",
        )}
      </p>
      <button className="primary full" disabled={busy}>
        {t("Save staff access", "स्टाफ की पहुँच सेव करें")}
      </button>
    </form>
  );
}
export function PasswordForm({ onDone, setError, busy, setBusy, t }) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          await api("password", f);
          onDone();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t("Current password", "अभी का पासवर्ड")}
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        {t("New password", "नया पासवर्ड")}
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
        />
      </label>
      <p>
        {t(
          "All your devices will be signed out. Sign in with the new password.",
          "आपके सभी डिवाइस साइन आउट होंगे। नए पासवर्ड से साइन इन करें।",
        )}
      </p>
      <button className="primary full" disabled={busy}>
        {t("Change password", "पासवर्ड बदलें")}
      </button>
    </form>
  );
}
export function BackupForm({ restore, onDone, setError, busy, setBusy, t }) {
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (restore) {
        if (!file) throw Error("Select an encrypted backup file.");
        const result = await api("backups/restore", {
          ...f,
          file,
          preview: !preview,
        });
        if (!preview) setPreview(result);
        else onDone(true);
      } else {
        const r = await fetch("/api/backups/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(f),
        });
        if (!r.ok) throw Error((await r.json()).error);
        download(
          await r.blob(),
          "sunil-khata-" + new Date().toISOString().slice(0, 10) + ".skbackup",
        );
        onDone(false);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="notice">
        {restore
          ? t(
              "Restoring replaces current records with the backup. A safety copy is kept on the server. All devices will sign out; use an owner login from the backup.",
              "बहाली से अभी के रिकॉर्ड बैकअप से बदलेंगे। सर्वर पर सुरक्षा कॉपी रहेगी। सभी फोन साइन आउट होंगे; बैकअप के मालिक खाते से साइन इन करें।",
            )
          : t(
              "This encrypted backup includes accounts, records, signed proof and staff logins. Keep the file and its passphrase safely in separate places. Lost passphrases cannot be recovered.",
              "इस सुरक्षित बैकअप में खाते, रिकॉर्ड, हस्ताक्षर और स्टाफ लॉगिन हैं। फाइल और उसका पासफ्रेज़ अलग सुरक्षित जगह रखें। खोया पासफ्रेज़ वापस नहीं मिलेगा।",
            )}
      </div>
      {restore && (
        <label>
          {t(
            "Encrypted backup file (.skbackup)",
            "सुरक्षित बैकअप फाइल (.skbackup)",
          )}
          <input
            type="file"
            accept=".skbackup"
            required
            onChange={(e) => {
              const chosen = e.target.files[0];
              setPreview(null);
              if (!chosen) return;
              if (chosen.size > 40 * 1024 * 1024) {
                setError(
                  "Backup is larger than the 40 MB browser restore limit. Use the documented offline restore procedure.",
                );
                return;
              }
              const r = new FileReader();
              r.onload = () => setFile(String(r.result).split(",")[1]);
              r.readAsDataURL(chosen);
            }}
          />
        </label>
      )}
      <label>
        {t("Your current account password", "आपके खाते का अभी का पासवर्ड")}
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        {t(
          "Backup passphrase (12+ characters)",
          "बैकअप पासफ्रेज़ (कम से कम 12 अक्षर)",
        )}
        <input
          name="passphrase"
          type="password"
          required
          minLength={12}
          maxLength={256}
          autoComplete="off"
          onChange={() => setPreview(null)}
        />
      </label>
      {preview && (
        <div className="restore-preview">
          <h3>{t("Backup contents", "बैकअप में क्या है")}</h3>
          {Object.entries(preview.counts).map(([k, v]) => (
            <p key={k}>
              {k}: {v}
            </p>
          ))}
          <p>
            {t("Owner login", "मालिक का लॉगिन")}:{" "}
            {preview.users
              .filter((u) => u.role === "owner")
              .map((u) => u.username)
              .join(", ")}
          </p>
          <label>
            {t(
              "Type RESTORE to replace the current shop",
              "अभी की दुकान के रिकॉर्ड बदलने के लिए RESTORE लिखें",
            )}
            <input
              name="confirmation"
              required
              pattern="RESTORE"
              autoComplete="off"
            />
          </label>
        </div>
      )}
      <button className="primary full" disabled={busy || (restore && !file)}>
        {busy
          ? t("Please wait…", "कृपया प्रतीक्षा करें…")
          : restore
            ? preview
              ? t("Replace records & restore", "रिकॉर्ड बदलें और बहाल करें")
              : t("Check backup first", "पहले बैकअप जाँचें")
            : t("Download encrypted backup", "सुरक्षित बैकअप डाउनलोड करें")}
      </button>
    </form>
  );
}
export function StatementView({ statement: s, t, setError, state }) {
  const [mode, setMode] = useState("all"),
    [proof, setProof] = useState(true),
    [paymentScope, setPaymentScope] = useState(
      s.paymentId ? String(s.paymentId) : "all",
    );
  const selectedIds =
    paymentScope === "all"
      ? null
      : new Set([
          ...s.allocations
            .filter((a) => a.payment_id === Number(paymentScope))
            .map((a) => a.document_id),
          ...(s.credit_transfers || [])
            .filter((a) => a.payment_id === Number(paymentScope))
            .flatMap((a) => [a.source_document_id, a.target_document_id]),
        ]);
  const docs = s.documents.filter(
    (d) =>
      (mode === "all" || d.tax_mode === mode) &&
      (!selectedIds || selectedIds.has(d.id)),
  );
  return (
    <>
      <div className="print-head">
        <h2>
          {t(
            "Account statement & signed proof",
            "खाता विवरण और हस्ताक्षर वाले रिकॉर्ड",
          )}
        </h2>
        <h3>{s.party.name}</h3>
        <p>
          {s.party.phone} · {s.party.address}
        </p>
      </div>
      {state && (
        <details className="period-statement no-print">
          <summary>
            {t("Date-range account statement", "तारीख के अनुसार खाता विवरण")}
          </summary>
          <Reports
            state={state}
            t={t}
            initialReport="ledger"
            initialParty={s.party.id}
            compact
          />
        </details>
      )}
      <div className="button-group no-print">
        <select
          aria-label="Statement tax category"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="all">
            {t("Both GST categories", "दोनों GST श्रेणियाँ")}
          </option>
          <option value="gst">GST</option>
          <option value="non-gst">Non-GST</option>
        </select>
        <select
          aria-label="Statement payment scope"
          value={paymentScope}
          onChange={(e) => setPaymentScope(e.target.value)}
        >
          <option value="all">
            {t("All payments and estimates", "सभी भुगतान और अनुमान")}
          </option>
          {s.payments.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id} · {p.reference} · {money(p.amount)}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={proof}
            onChange={(e) => setProof(e.target.checked)}
          />
          {t("Include signed proof", "हस्ताक्षर वाले रिकॉर्ड शामिल करें")}
        </label>
        <button
          className="primary"
          onClick={() =>
            sharePdf(
              `statements/${s.party.id}/pdf?mode=${mode}&proof=${proof ? "1" : "0"}&lang=${localStorage.getItem("lang") || "en"}&payment=${paymentScope}`,
              `statement-${s.party.id}.pdf`,
            ).catch((e) => setError(e.message))
          }
        >
          <Download size={16} />
          {t("Share / download PDF", "PDF शेयर / डाउनलोड करें")}
        </button>
      </div>
      {["gst", "non-gst"]
        .filter((m) => mode === "all" || mode === m)
        .map((m) => (
          <div className="statement-balances" key={m}>
            <strong>{m.toUpperCase()}</strong>
            <span>
              {s.balances[m].receivable >= 0
                ? t("To collect", "लेना है")
                : t("Customer credit", "ग्राहक का क्रेडिट")}
              : {money(Math.abs(s.balances[m].receivable))}
            </span>
            <span>
              {s.balances[m].payable >= 0
                ? t("To pay", "देना है")
                : t("Supplier credit", "सप्लायर से क्रेडिट")}
              : {money(Math.abs(s.balances[m].payable))}
            </span>
          </div>
        ))}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Record", "रिकॉर्ड")}</th>
              <th>{t("Date", "तारीख")}</th>
              <th>{t("Category", "श्रेणी")}</th>
              <th>{t("Net value", "बदली हुई राशि")}</th>
              <th>{t("Allocated", "जुड़ा भुगतान")}</th>
              <th>{t("Remaining", "बाकी")}</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  SE-{String(d.id).padStart(4, "0")}
                  {d.voided ? " · Cancelled" : ""}
                  <small>
                    {d.signature || d.photo
                      ? t("Signed proof attached", "हस्ताक्षर वाला प्रमाण है")
                      : t("No signed proof", "हस्ताक्षर वाला प्रमाण नहीं है")}
                  </small>
                </td>
                <td>{date(d.created_at)}</td>
                <td>{d.tax_mode}</td>
                <td>{money(d.adjusted_total)}</td>
                <td>{money(d.allocated)}</td>
                <td>
                  {money(d.outstanding)}
                  {d.credit > 0 && <small>Credit {money(d.credit)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{t("Payments & allocation", "भुगतान और उसका बँटवारा")}</h3>
      {s.payments
        .filter(
          (p) =>
            (mode === "all" ||
              (p.supplier_id === s.party.id
                ? p.supplier_tax_mode || p.tax_mode
                : p.tax_mode) === mode) &&
            (paymentScope === "all" || p.id === Number(paymentScope)),
        )
        .map((p) => (
          <div
            className={"statement-entry " + (p.reversed ? "reversed" : "")}
            key={p.id}
          >
            <strong>
              #{p.id} · {money(p.amount)} · {p.reference}
            </strong>
            <p>
              {date(p.created_at)} ·{" "}
              {p.supplier_id === s.party.id
                ? p.supplier_tax_mode || p.tax_mode
                : p.tax_mode}{" "}
              ·{" "}
              {p.flow === "refund"
                ? t("Refund", "पैसा वापसी")
                : t("Payment", "भुगतान")}
              {p.reversed ? " · REVERSED" : ""}
            </p>
            <small>
              {s.allocations
                .filter((a) => a.payment_id === p.id)
                .map(
                  (a) =>
                    `${a.side === "receivable" ? "Customer" : "Supplier"} → ${a.document_id ? "SE-" + String(a.document_id).padStart(4, "0") : "Opening #" + a.opening_id}: ${money(a.amount)}`,
                )
                .join(" · ")}
            </small>
          </div>
        ))}
      <h3>{t("Opening balances & corrections", "शुरुआती बकाया और बदलाव")}</h3>
      {s.adjustments
        .filter((a) => mode === "all" || a.tax_mode === mode)
        .map((a) => (
          <div className="statement-entry" key={a.id}>
            <strong>
              {a.type} · {money(a.amount)} · {a.tax_mode}
            </strong>
            <p>
              {date(a.created_at)} · {a.reason}
              {s.adjustment_reversals?.some((r) => r.adjustment_id === a.id)
                ? " · REVERSED"
                : ""}
            </p>
          </div>
        ))}
      {proof &&
        docs.map((d) => (
          <section className="statement-doc" key={d.id}>
            <h3>
              SE-{String(d.id).padStart(4, "0")} · {date(d.created_at)} ·{" "}
              {money(d.total)}
            </h3>
            <p>{d.items.map((i) => `${i.name} × ${i.qty}`).join(" · ")}</p>
            {d.signature && (
              <img
                className="proof signature-proof"
                src={d.signature}
                alt={`Signature for SE-${String(d.id).padStart(4, "0")}`}
              />
            )}
            {d.photo && (
              <img
                className="proof"
                src={d.photo}
                alt={`Signed paper for SE-${String(d.id).padStart(4, "0")}`}
              />
            )}
            {!d.signature && !d.photo && (
              <p>
                {t(
                  "No signed proof attached. Keep the original paper.",
                  "हस्ताक्षर वाला प्रमाण नहीं है। पुराना कागज़ सुरक्षित रखें।",
                )}
              </p>
            )}
          </section>
        ))}
    </>
  );
}
export function ShopForm({ state, save, busy, t }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save("settings", Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      {[
        ["name", "Shop name", "दुकान का नाम"],
        ["address", "Address", "पता"],
        ["phone", "Phone", "फोन"],
        ["gstin", "GSTIN", "GSTIN"],
        [
          "upi",
          "Shop UPI ID (for reference)",
          "दुकान का UPI ID (संदर्भ के लिए)",
        ],
        ["account_holder", "Bank account holder", "बैंक खाते का नाम"],
        ["account_number", "Bank account number", "बैंक खाता नंबर"],
        ["bank_name", "Bank name", "बैंक का नाम"],
        ["ifsc", "IFSC", "IFSC"],
      ].map(([k, en, hi]) => (
        <label key={k}>
          {t(en, hi)}
          <input
            name={k}
            defaultValue={
              state.settings[k] || (k === "name" ? "Sunil Enterprises" : "")
            }
            required={k === "name"}
          />
        </label>
      ))}
      <button className="primary full" disabled={busy}>
        {t("Save shop details", "दुकान की जानकारी सेव करें")}
      </button>
    </form>
  );
}
export function CreditForm({ modal, state, save, busy, t, setError }) {
  const [key] = useState(() => crypto.randomUUID()),
    source = modal.doc;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = Object.fromEntries(new FormData(e.currentTarget));
          save("credits/apply", {
            source_id: source.id,
            target_id: Number(f.target_id),
            amount: paise(f.amount),
            request_id: key,
          });
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      <div className="notice">
        {t(
          "Use credit from this estimate against another estimate in the same account. No money is transferred and the party’s net balance stays unchanged.",
          "इस अनुमान का क्रेडिट इसी खाते के दूसरे अनुमान में लगाएँ। पैसा ट्रांसफर नहीं होगा और पार्टी का कुल बकाया नहीं बदलेगा।",
        )}
      </div>
      <p>
        SE-{String(source.id).padStart(4, "0")} ·{" "}
        {t("Available credit", "उपलब्ध क्रेडिट")} {money(source.credit)}
      </p>
      <label>
        {t("Apply to estimate", "इस अनुमान में लगाएँ")}
        <select name="target_id" required>
          <option value="">{t("Select an estimate", "अनुमान चुनें")}</option>
          {state.documents
            .filter(
              (d) =>
                d.id !== source.id &&
                d.party_id === source.party_id &&
                d.tax_mode === source.tax_mode &&
                d.kind === source.kind &&
                d.outstanding > 0,
            )
            .map((d) => (
              <option key={d.id} value={d.id}>
                SE-{String(d.id).padStart(4, "0")} · {money(d.outstanding)}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t("Credit amount (₹)", "क्रेडिट की राशि (₹)")}
        <input name="amount" inputMode="decimal" required />
      </label>
      <button className="primary full" disabled={busy}>
        {t("Apply credit", "क्रेडिट लगाएँ")}
      </button>
    </form>
  );
}
export function ReverseAdjustmentForm({ modal, save, busy, t }) {
  const [key] = useState(() => crypto.randomUUID());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save("adjustments/reverse", {
          adjustment_id: modal.adjustment.id,
          reason: new FormData(e.currentTarget).get("reason"),
          request_id: key,
        });
      }}
    >
      <p>
        {t(
          "Undo the accounting effect of this adjustment. The original entry and this reversal remain in the audit trail.",
          "इस बदलाव का हिसाब वापस लें। पुराना रिकॉर्ड और यह वापसी इतिहास में सुरक्षित रहेंगे।",
        )}
      </p>
      <h3>
        {modal.adjustment.type} · {money(modal.adjustment.amount)}
      </h3>
      <label>
        {t("Reason", "कारण")}
        <textarea name="reason" minLength={3} required />
      </label>
      <button className="primary full" disabled={busy}>
        {t("Confirm reversal", "वापसी की पुष्टि करें")}
      </button>
    </form>
  );
}

export function BankFields({ details, t }) {
  return (
    <>
      {[
        ["upi", "UPI ID", "UPI ID"],
        ["account_holder", "Account holder name", "खाते में नाम"],
        ["account_number", "Account number", "खाता नंबर"],
        ["bank_name", "Bank name", "बैंक का नाम"],
        ["ifsc", "IFSC", "IFSC"],
      ].map(([k, en, hi]) => (
        <label key={k}>
          {t(en, hi)}
          <input
            name={k}
            defaultValue={details[k] || ""}
            autoComplete="off"
            maxLength={k === "account_number" ? 30 : 100}
          />
        </label>
      ))}
    </>
  );
}

export function ResetShopForm({ t, onReset }) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="reset-shop">
      <summary>
        {t("Delete business data", "दुकान के लेन-देन का डेटा मिटाएँ")}
      </summary>
      <p>
        {t(
          "Deletes all customers/suppliers, estimates/photos, purchases, payments, opening balances, corrections and transaction history. Shop details and user accounts stay. All devices will be signed out.",
          "सभी ग्राहक/सप्लायर, अनुमान/फोटो, खरीद, भुगतान, शुरुआती बकाया, सुधार और लेन-देन का इतिहास मिटेगा। दुकान का विवरण और यूज़र खाते रहेंगे। सभी फोन से साइन आउट होगा।",
        )}
      </p>
      <p>
        {t(
          "Previously downloaded backups and retained restore-safety backups are not erased.",
          "पहले डाउनलोड किए गए बैकअप और सुरक्षित रखे पुराने बैकअप नहीं मिटेंगे।",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("shop/reset-data", {
              current_password: password,
              confirmation,
            });
            sessionStorage.clear();
            onReset();
          } catch (error) {
            setError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("Current owner password", "मालिक का वर्तमान पासवर्ड")}
          <input
            type="password"
            required
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t("Type DELETE SHOP DATA", "DELETE SHOP DATA लिखें")}
          <input
            required
            value={confirmation}
            autoComplete="off"
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || confirmation !== "DELETE SHOP DATA"}
        >
          {busy
            ? t("Deleting…", "मिटा रहे हैं…")
            : t("Delete all business records", "सभी लेन-देन के रिकॉर्ड मिटाएँ")}
        </button>
      </form>
    </details>
  );
}

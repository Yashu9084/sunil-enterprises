import { calculateItems } from "../shared/money.js";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  FileText,
  ArrowLeftRight,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Check,
  ChevronRight,
  LogOut,
  Download,
  ShieldCheck,
  Menu,
  X,
  Trash2,
  PenLine,
  Camera,
  Wallet,
  Package,
  CheckCircle2,
} from "lucide-react";
import "./style.css";
import { Reports, ReportFilters } from "./Reports.jsx";
import { PhotoItems } from "./PhotoItems.jsx";
import { tr, hindi } from "./i18n.js";
import { money, date, paise, api, sharePdf } from "./lib.js";
import {
  AdjustmentForm,
  ReverseForm,
  StaffForm,
  PasswordForm,
  BackupForm,
  StatementView,
  ShopForm,
  CreditForm,
  ReverseAdjustmentForm,
  BankFields,
} from "./workflows.jsx";
function App() {
  const modalRef = useRef(null),
    busyRef = useRef(false);
  const [status, setStatus] = useState(null),
    [state, setState] = useState(null),
    [page, setPage] = useState("home"),
    [records, setRecords] = useState(null),
    [recordPage, setRecordPage] = useState(1),
    [recordFilters, setRecordFilters] = useState({}),
    [recordsLoading, setRecordsLoading] = useState(false),
    [lang, setLang] = useState(localStorage.getItem("lang") || "en"),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [busy, setBusy] = useState(false),
    [partyFilter, setPartyFilter] = useState(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const root = modalRef.current;
    const focusable = () =>
      [...root.querySelectorAll("button,input,select,textarea,a[href]")].filter(
        (e) => !e.disabled,
      );
    focusable()[0]?.focus();
    const handle = (e) => {
      if (e.key === "Escape" && !busyRef.current) setModal(null);
      if (e.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    root.addEventListener("keydown", handle);
    return () => {
      root.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [!!modal]);
  busyRef.current = busy;
  const t = (en, hi) => (lang === "hi" ? hi || hindi[en] || en : en);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  async function refresh() {
    let d;
    try {
      d = await api("state");
    } catch (e) {
      if (e.status === 401) {
        setState(null);
        setModal(null);
        sessionStorage.clear();
      }
      throw e;
    }
    setState(d);
    return d;
  }
  useEffect(() => {
    api("status")
      .then(setStatus)
      .then(() => refresh().catch(() => {}))
      .catch((e) => setError(e.message));
    const on = () => setOffline(!navigator.onLine);
    addEventListener("online", on);
    addEventListener("offline", on);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (navigator.onLine) refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [!!state]);
  useEffect(() => {
    setRecordPage(1);
    setRecords(null);
  }, [page, query, partyFilter, recordFilters]);
  useEffect(() => {
    if (!state || !["documents", "payments"].includes(page)) return;
    let cancelled = false;
    setRecordsLoading(true);
    const timer = setTimeout(() => {
      api(
        "records?" +
          new URLSearchParams({
            ...recordFilters,
            type: page === "payments" ? "payment" : "document",
            page: recordPage,
            q: query,
            party: recordFilters.party || partyFilter || 0,
          }).toString(),
      )
        .then((r) => {
          if (!cancelled) setRecords(r);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setRecordsLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, query, partyFilter, recordPage, state, recordFilters]);
  const notify = (s) => {
    setToast(s);
    setTimeout(() => setToast(""), 4500);
  };
  async function save(path, body) {
    if (offline) {
      setError("Connect to the internet to save financial records.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await api(path, body);
      await refresh();
      setModal(null);
      notify(t("Saved successfully", "सफलतापूर्वक सेव हुआ"));
      return d;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const party = (id) => state?.parties.find((p) => p.id === id);
  const paymentLabel = (p) => {
    const from = party(p.customer_id)?.name || t("Our shop", "हमारी दुकान"),
      to = party(p.supplier_id)?.name || t("Our shop", "हमारी दुकान");
    return p.flow === "refund" ? `${to} → ${from}` : `${from} → ${to}`;
  };
  const signOut = () => {
    setState(null);
    setModal(null);
    sessionStorage.clear();
  };
  const open = (m) => {
    setError("");
    setModal(m);
  };
  if (!status)
    return (
      <div className="loading">
        <div>
          {error ? (
            <>
              <h2>
                {t(
                  "Connect to open your shop",
                  "दुकान खोलने के लिए इंटरनेट जोड़ें",
                )}
              </h2>
              <p>{tr(error)}</p>
              <p>
                {t(
                  "Financial records stay on the server. Reconnect to open them safely.",
                  "लेन-देन के रिकॉर्ड सर्वर पर सुरक्षित हैं। उन्हें खोलने के लिए दोबारा कनेक्ट करें।",
                )}
              </p>
              <button className="primary" onClick={() => location.reload()}>
                {t("Try again", "फिर कोशिश करें")}
              </button>
            </>
          ) : (
            tr("Loading your shop…")
          )}
        </div>
      </div>
    );
  if (!state)
    return (
      <div className="auth">
        <button
          className="language auth-language"
          onClick={() => {
            const l = lang === "en" ? "hi" : "en";
            localStorage.setItem("lang", l);
            setLang(l);
          }}
        >
          {lang === "en" ? "हिंदी" : "English"}
        </button>
        <div className="auth-brand">
          <div className="logo">
            <FileText />
          </div>
          <h1>Sunil Enterprises</h1>
          <p>
            {tr("A simpler day at the shop.")}
            <br />
            आपकी दुकान का डिजिटल खाता
          </p>
        </div>
        <form
          className="auth-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            const f = Object.fromEntries(new FormData(e.currentTarget));
            try {
              if (status.needsSetup) {
                await api("setup", f);
                setStatus({ needsSetup: false });
              }
              await api("login", f);
              await refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">{tr("DIGITAL KHATA")}</span>
          <h2>
            {status.needsSetup ? tr("Set up your shop") : tr("Welcome back")}
          </h2>
          <p>
            {status.needsSetup
              ? tr("Create the owner account before adding staff.")
              : tr("Sign in to see your shop’s records.")}
          </p>
          {status.needsSetup && status.setupRequiresToken && (
            <label>
              {tr("Private setup token")}
              <input
                name="setup_token"
                type="password"
                required
                autoComplete="off"
              />
            </label>
          )}
          {status.needsSetup && (
            <label>
              {tr("Your name")}
              <input name="name" required autoComplete="name" />
            </label>
          )}
          <label>
            {tr("Username")}
            <input name="username" required autoComplete="username" />
          </label>
          <label>
            {tr("Password")}
            <input
              name="password"
              type="password"
              required
              minLength={status.needsSetup ? 12 : 1}
              autoComplete={
                status.needsSetup ? "new-password" : "current-password"
              }
            />
          </label>
          {status.needsSetup && (
            <small>
              {tr(
                "Use at least 12 characters. Each staff member gets a separate account.",
              )}
            </small>
          )}
          {error && <div className="error">{tr(error)}</div>}
          <button className="primary" disabled={busy}>
            {busy
              ? tr("Please wait…")
              : status.needsSetup
                ? tr("Create shop account")
                : tr("Sign in")}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <p className="auth-foot">
          {tr("Your estimates. Your signatures. Every rupee accounted for.")}
        </p>
      </div>
    );
  let receivable = 0,
    payable = 0;
  state.parties.forEach((p) =>
    Object.values(p.balances).forEach((b) => {
      receivable += Math.max(0, b.receivable);
      payable += Math.max(0, b.payable);
    }),
  );
  const recordParty = modal?.doc?.party_snapshot
    ? JSON.parse(modal.doc.party_snapshot)
    : party(modal?.doc?.party_id);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const todays = state.documents.filter(
    (d) =>
      new Date(d.created_at).toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      }) === today && d.kind === "sale",
  );
  const nav = [
    ["home", LayoutDashboard, t("Overview", "एक नज़र")],
    ["documents", FileText, t("Estimates & purchases", "अनुमान और खरीद")],
    ["parties", Users, t("Customers & suppliers", "ग्राहक और सप्लायर")],
    ["payments", ArrowLeftRight, t("Payments", "भुगतान")],
    ["reports", BarChart3, t("Reports", "रिपोर्ट")],
    ["settings", ShieldCheck, t("Shop & staff", "दुकान और स्टाफ")],
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" onClick={() => setPage("home")}>
          <div className="logo">
            <FileText size={23} />
          </div>
          <span>
            sunil<span className="brand-sub">ENTERPRISES</span>
          </span>
        </a>
        <div className="workspace-label">{tr("YOUR WORKSPACE")}</div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setRecordFilters({});
                setPartyFilter(null);
                setQuery("");
              }}
            >
              <Icon size={20} />
              <span>{label}</span>
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={25} />
          <strong>{t("Every detail, together.", "हर हिसाब, एक जगह।")}</strong>
          <p>
            {t(
              "Signed estimates and clear balances. Less paperwork, more peace of mind.",
              "हस्ताक्षर वाले अनुमान और साफ हिसाब। कम कागज़, ज़्यादा सुकून।",
            )}
          </p>
        </div>
        <div className="profile">
          <div className="avatar">{state.user.name[0]}</div>
          <div>
            <strong>{state.user.name}</strong>
            <small>
              {state.user.role === "owner"
                ? tr("Shop owner")
                : tr("Staff member")}
            </small>
          </div>
          <button
            className="icon-btn"
            title="Sign out"
            onClick={async () => {
              await api("logout", {});
              setState(null);
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            {tr("Workspace")}
            <ChevronRight size={14} />{" "}
            <span>{nav.find((n) => n[0] === page)?.[2]}</span>
          </div>
          <div className="header-right">
            <span className={"connection " + (offline ? "offline" : "")}>
              <i />
              {offline ? tr("Offline · view only") : tr("Connected")}
            </span>
            <button
              className="language"
              onClick={() => {
                const l = lang === "en" ? "hi" : "en";
                setLang(l);
                localStorage.setItem("lang", l);
              }}
            >
              {lang === "en" ? "हिंदी" : "English"}
            </button>
            <div className="avatar small">{state.user.name[0]}</div>
          </div>
        </header>
        <main>
          {offline && (
            <div className="error">
              {tr(
                "Connection lost. Showing records loaded on this device. Reconnect before saving.",
              )}
            </div>
          )}
          <div className="page-title">
            <div>
              <span className="eyebrow">SUNIL ENTERPRISES · DIGITAL KHATA</span>
              <h1>
                {page === "home"
                  ? t("A clear view of your shop.", "आपकी दुकान का पूरा हिसाब।")
                  : nav.find((n) => n[0] === page)?.[2]}
              </h1>
              <p>
                {page === "home"
                  ? t(
                      "Every sale, every payment, all in one place.",
                      "हर बिक्री, हर भुगतान, सब एक जगह।",
                    )
                  : t(
                      "Simple records. Clear balances.",
                      "आसान रिकॉर्ड। साफ हिसाब।",
                    )}
              </p>
            </div>
            <span className="date-pill">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "long",
              })}
            </span>
          </div>
          {page === "home" && (
            <>
              <button
                className="text-btn no-print"
                onClick={() => setPage("reports")}
              >
                <BarChart3 size={18} />
                {t(
                  "Date-range reports & statements",
                  "तारीख के अनुसार रिपोर्ट और खाता",
                )}
              </button>
              <section className="stats">
                <Stat
                  label={t("To collect", "ग्राहकों से लेना है")}
                  value={money(receivable)}
                  icon={ArrowDownLeft}
                  color="green"
                  sub={tr("Across all customer accounts")}
                />
                <Stat
                  label={t("To pay", "सप्लायर को देना है")}
                  value={money(payable)}
                  icon={ArrowUpRight}
                  color="orange"
                  sub={tr("Across all supplier accounts")}
                />
                <Stat
                  label={t("Today’s estimates", "आज के अनुमान")}
                  value={money(state.today.total)}
                  icon={FileText}
                  color="blue"
                  sub={`${state.today.count} ${t("estimates created today", "अनुमान आज बने")}`}
                />
              </section>
              <section className="quick-grid">
                <button
                  onClick={() => open({ type: "document", kind: "sale" })}
                >
                  <span className="quick-icon">
                    <Plus />
                  </span>
                  <span>
                    <strong>{t("New estimate", "नया अनुमान")}</strong>
                    <small>
                      {t(
                        "Add items, take a signature, done.",
                        "सामान जोड़ें, हस्ताक्षर लें, हो गया।",
                      )}
                    </small>
                  </span>
                  <ArrowUpRight size={20} />
                </button>
                <button onClick={() => open({ type: "payment" })}>
                  <span className="quick-icon light">
                    <ArrowLeftRight />
                  </span>
                  <span>
                    <strong>{t("Record a payment", "भुगतान दर्ज करें")}</strong>
                    <small>
                      {t(
                        "Shop or direct supplier payment.",
                        "दुकान या सीधे सप्लायर को भुगतान।",
                      )}
                    </small>
                  </span>
                  <ArrowUpRight size={20} />
                </button>
              </section>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h2>{t("Recent activity", "हाल का लेन-देन")}</h2>
                    <button
                      className="text-btn"
                      onClick={() => setPage("documents")}
                    >
                      {tr("View records")}
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  {!state.documents.length && !state.payments.length ? (
                    <Empty
                      icon={FileText}
                      title={tr("Your first record starts here")}
                      text={tr(
                        "Create an estimate or add a purchase. Your activity will appear here.",
                      )}
                    />
                  ) : (
                    [
                      ...state.documents.map((d) => ({
                        ...d,
                        event: "document",
                      })),
                      ...state.payments.map((p) => ({
                        ...p,
                        event: "payment",
                      })),
                    ]
                      .sort((a, b) => b.created_at.localeCompare(a.created_at))
                      .slice(0, 6)
                      .map((d) => (
                        <div
                          className="activity"
                          key={d.event + d.id}
                          onClick={() =>
                            d.event === "document" &&
                            api("documents/" + d.id)
                              .then((x) => open({ type: "detail", doc: x }))
                              .catch((e) => setError(e.message))
                          }
                        >
                          <span
                            className={
                              "activity-icon " +
                              (d.event === "payment" ? "green" : "")
                            }
                          >
                            {d.event === "payment" ? (
                              <ArrowLeftRight size={19} />
                            ) : (
                              <FileText size={19} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {d.event === "payment"
                                ? paymentLabel(d)
                                : party(d.party_id)?.name}
                            </strong>
                            <small>
                              {d.event === "payment"
                                ? tr("Payment recorded")
                                : d.kind === "sale"
                                  ? `Estimate #SE-${String(d.id).padStart(4, "0")}`
                                  : tr("Purchase recorded")}{" "}
                              · {date(d.created_at)}
                            </small>
                          </div>
                          <div className="activity-amount">
                            <strong>{money(d.total || d.amount)}</strong>
                            <Badge mode={d.tax_mode} />
                            {d.event === "payment" &&
                              d.customer_id &&
                              d.supplier_id &&
                              d.supplier_tax_mode !== d.tax_mode && (
                                <>
                                  <span> → </span>
                                  <Badge mode={d.supplier_tax_mode} />
                                </>
                              )}
                          </div>
                        </div>
                      ))
                  )}
                </section>
                <section className="panel getting-started">
                  <span className="eyebrow">
                    {tr("A LITTLE LESS PAPERWORK")}
                  </span>
                  <div className="paper-art">
                    <FileText size={66} strokeWidth={1.1} />
                    <span>
                      <Check size={20} />
                    </span>
                  </div>
                  <h2>
                    {t(
                      "The familiar way. Made easier.",
                      "वही पुराना तरीका। अब और आसान।",
                    )}
                  </h2>
                  <p>
                    {tr(
                      "Make an estimate, keep the signed proof, and find it in seconds when it’s time to settle.",
                    )}
                  </p>
                  <div className="mini-step">
                    <CheckCircle2 size={17} />
                    {tr("Separate GST & non-GST balances")}
                  </div>
                  <div className="mini-step">
                    <CheckCircle2 size={17} />
                    {tr("Customer-to-supplier payments")}
                  </div>
                  <div className="mini-step">
                    <CheckCircle2 size={17} />
                    {tr("Signed proof with every record")}
                  </div>
                  <button
                    className="secondary"
                    onClick={() => open({ type: "party" })}
                  >
                    <Plus size={17} />
                    {tr("Add your first customer")}
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "parties" && (
            <section className="panel">
              <div className="panel-title">
                <h2>
                  {state.parties.length}{" "}
                  {t("customers & suppliers", "ग्राहक और सप्लायर")}
                </h2>
                <button
                  className="primary"
                  onClick={() => open({ type: "party" })}
                >
                  <Plus size={17} />
                  {tr("Add party")}
                </button>
              </div>
              {state.user.role === "owner" && (
                <button
                  className="text-btn"
                  onClick={() => open({ type: "adjustment" })}
                >
                  {t("Add opening balance", "शुरुआती बकाया जोड़ें")}
                </button>
              )}
              <SearchBox query={query} setQuery={setQuery} />
              {!state.parties.length ? (
                <Empty
                  icon={Users}
                  title={tr("Know exactly who owes what")}
                  text={tr(
                    "Add a customer or supplier to start their account.",
                  )}
                />
              ) : (
                <div className="party-grid">
                  {state.parties
                    .filter(
                      (p) =>
                        p.name.toLowerCase().includes(query.toLowerCase()) ||
                        p.phone.includes(query),
                    )
                    .map((p) => (
                      <button
                        className="party-card"
                        key={p.id}
                        onClick={() => {
                          api("statements/" + p.id)
                            .then((statement) =>
                              open({ type: "statement", statement }),
                            )
                            .catch((e) => setError(e.message));
                        }}
                      >
                        <div className="party-card-head">
                          <div className="avatar">{p.name[0]}</div>
                          <span className="tag">
                            {tr(
                              p.kind === "both"
                                ? "Both customer & supplier"
                                : p.kind === "customer"
                                  ? "Customer"
                                  : "Supplier",
                            )}
                          </span>
                        </div>
                        <h3>{p.name}</h3>
                        <p>{p.phone || "No phone number"}</p>
                        {["gst", "non-gst"].map((mode) => (
                          <div className="balance-row" key={mode}>
                            <Badge mode={mode} />
                            <div>
                              <small>
                                {p.balances[mode].receivable < 0
                                  ? t("Customer credit", "ग्राहक का क्रेडिट")
                                  : t("Collect", "लेना है")}{" "}
                                {money(Math.abs(p.balances[mode].receivable))}
                              </small>
                              <small>
                                {p.balances[mode].payable < 0
                                  ? t("Supplier credit", "सप्लायर का क्रेडिट")
                                  : t("Pay", "देना है")}{" "}
                                {money(Math.abs(p.balances[mode].payable))}
                              </small>
                            </div>
                          </div>
                        ))}
                        <span className="text-link">
                          {t(
                            "View account & signed records",
                            "खाता और हस्ताक्षर वाले रिकॉर्ड देखें",
                          )}{" "}
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </section>
          )}
          {page === "documents" && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>
                    {partyFilter
                      ? party(partyFilter)?.name
                      : t("All records", "सभी रिकॉर्ड")}
                  </h2>
                  {partyFilter && (
                    <button
                      className="text-btn"
                      onClick={() => setPartyFilter(null)}
                    >
                      {tr("Clear customer filter")}
                    </button>
                  )}
                </div>
                <div className="button-group">
                  <button
                    className="secondary"
                    onClick={() => open({ type: "document", kind: "purchase" })}
                  >
                    <Package size={16} />
                    {tr("Purchase")}
                  </button>
                  <button
                    className="primary"
                    onClick={() => open({ type: "document", kind: "sale" })}
                  >
                    <Plus size={16} />
                    {tr("Estimate")}
                  </button>
                </div>
              </div>
              <SearchBox query={query} setQuery={setQuery} />
              <ReportFilters
                value={{
                  ...recordFilters,
                  party: recordFilters.party || partyFilter || "",
                }}
                onChange={(next) => {
                  setPartyFilter(null);
                  setRecordFilters(next);
                }}
                parties={state.parties}
                users={state.users || []}
                type="documents"
                search={false}
                t={t}
              />
              {records && (
                <p className="hint">
                  {records.total}{" "}
                  {t(
                    "matching records. Filters apply to the whole book.",
                    "मिलते रिकॉर्ड। फिल्टर पूरे खाते पर लागू हैं।",
                  )}
                </p>
              )}

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{tr("Record")}</th>
                      <th>{tr("Customer / supplier")}</th>
                      <th>{tr("Date")}</th>
                      <th>{tr("Category")}</th>
                      <th className="right">{tr("Amount")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(records?.rows || []).map((d) => (
                      <tr
                        key={d.id}
                        onClick={() =>
                          api("documents/" + d.id)
                            .then((doc) => open({ type: "detail", doc }))
                            .catch((e) => setError(e.message))
                        }
                      >
                        <td>
                          <strong>SE-{String(d.id).padStart(4, "0")}</strong>
                          <small>
                            {d.kind === "sale"
                              ? tr("Sales estimate")
                              : "Purchase"}
                            {d.entry_mode === "photo" &&
                              " · " + t("Photo + total", "फोटो + कुल राशि")}
                          </small>
                        </td>
                        <td>{party(d.party_id)?.name}</td>
                        <td>
                          {date(d.created_at)}
                          {d.due_date && d.outstanding > 0 && (
                            <small
                              className={d.due_date < today ? "overdue" : ""}
                            >
                              {t("Due date", "आखिरी तारीख")}: {d.due_date}
                            </small>
                          )}
                        </td>
                        <td>
                          <Badge mode={d.tax_mode} />
                        </td>
                        <td className="right">
                          <strong>{money(d.adjusted_total)}</strong>
                          <small>
                            {d.voided
                              ? t("Cancelled", "रद्द")
                              : d.outstanding === 0
                                ? t("Settled", "हिसाब पूरा")
                                : t("Due", "बाकी") + " " + money(d.outstanding)}
                          </small>
                        </td>
                        <td>
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recordsLoading && (
                <p className="hint">
                  {t("Loading records…", "रिकॉर्ड खुल रहे हैं…")}
                </p>
              )}
              <Pagination
                records={records}
                page={recordPage}
                setPage={setRecordPage}
                loading={recordsLoading}
                t={t}
              />
              {records && !records.total && (
                <Empty
                  icon={FileText}
                  title={tr("A fresh page for your shop")}
                  text={tr(
                    "Add your first estimate or purchase. Signed records will stay together here.",
                  )}
                />
              )}
            </section>
          )}
          {page === "payments" && (
            <section className="panel">
              <div className="panel-title">
                <h2>{t("Payment history", "भुगतान का रिकॉर्ड")}</h2>
                <button
                  className="primary"
                  onClick={() => open({ type: "payment" })}
                >
                  <Plus size={16} />
                  {tr("Record payment")}
                </button>
              </div>
              <div className="notice">
                <ArrowLeftRight size={20} />
                <span>
                  {tr(
                    "Direct payments settle both accounts in one entry. GST and non-GST balances stay separate.",
                  )}
                </span>
              </div>
              <SearchBox query={query} setQuery={setQuery} />
              <ReportFilters
                value={{
                  ...recordFilters,
                  party: recordFilters.party || partyFilter || "",
                }}
                onChange={(next) => {
                  setPartyFilter(null);
                  setRecordFilters(next);
                }}
                parties={state.parties}
                users={state.users || []}
                type="payments"
                search={false}
                t={t}
              />
              {records && (
                <p className="hint">
                  {records.total}{" "}
                  {t(
                    "matching records. Filters apply to the whole book.",
                    "मिलते रिकॉर्ड। फिल्टर पूरे खाते पर लागू हैं।",
                  )}
                </p>
              )}

              {(records?.rows || []).map((p) => (
                <div className="activity" key={p.id}>
                  <span className="activity-icon green">
                    <ArrowLeftRight size={19} />
                  </span>
                  <div>
                    <strong>{paymentLabel(p)}</strong>
                    <small>
                      {p.reference} · {date(p.created_at)}
                    </small>
                    <small>
                      {p.notes} · {p.method?.toUpperCase()}
                      {p.method === "upi" &&
                      p.destination_snapshot &&
                      JSON.parse(p.destination_snapshot).details?.upi
                        ? " · " + JSON.parse(p.destination_snapshot).details.upi
                        : ""}
                    </small>
                    <button
                      className="text-btn"
                      onClick={() =>
                        api("statements/" + (p.customer_id || p.supplier_id))
                          .then((statement) =>
                            open({
                              type: "statement",
                              statement: { ...statement, paymentId: p.id },
                            }),
                          )
                          .catch((e) => setError(e.message))
                      }
                    >
                      {t(
                        "Signed records for this payment",
                        "इस भुगतान के हस्ताक्षर वाले रिकॉर्ड",
                      )}
                    </button>
                    <small>
                      {p.flow === "refund" ? t("Refund", "पैसा वापसी") : ""}
                      {state.reversals.find((r) => r.payment_id === p.id)
                        ? t(" · Reversed", " · रिकॉर्ड पलटा गया")
                        : state.reconciliations.find(
                              (r) => r.payment_id === p.id,
                            )
                          ? t(" · Reconciled", " · मिलान हो गया")
                          : t(" · Not reconciled", " · बैंक से जाँचना बाकी")}
                    </small>
                    {state.user.role === "owner" &&
                      !state.reversals.some((r) => r.payment_id === p.id) && (
                        <div className="button-group">
                          <button
                            className="text-btn"
                            onClick={() =>
                              open({ type: "reverse", payment: p })
                            }
                          >
                            {t("Reverse wrong entry", "गलत रिकॉर्ड पलटें")}
                          </button>
                          {!state.reconciliations.some(
                            (r) => r.payment_id === p.id,
                          ) && (
                            <button
                              className="text-btn"
                              onClick={() =>
                                open({ type: "reconcile", payment: p })
                              }
                            >
                              {t("Confirm bank match", "बैंक से मिलान करें")}
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                  <div className="activity-amount">
                    <strong>{money(p.amount)}</strong>
                    <Badge mode={p.tax_mode} />
                    {p.customer_id &&
                      p.supplier_id &&
                      p.supplier_tax_mode !== p.tax_mode && (
                        <>
                          <span> → </span>
                          <Badge mode={p.supplier_tax_mode} />
                        </>
                      )}
                  </div>
                </div>
              ))}
              <Pagination
                records={records}
                page={recordPage}
                setPage={setRecordPage}
                loading={recordsLoading}
                t={t}
              />
              {records && !records.total && (
                <Empty
                  icon={Wallet}
                  title={tr("Every payment has a clear trail")}
                  text={tr(
                    "Record the payer, recipient and reference after confirming payment.",
                  )}
                />
              )}
            </section>
          )}
          {page === "reports" && <Reports state={state} t={t} />}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="panel">
                <h2>{t("Reports & statements", "रिपोर्ट और खाता विवरण")}</h2>
                <p>
                  {t(
                    "Filter the full book, check opening/closing balances and export reports.",
                    "पूरा खाता छाँटें, शुरुआती/आखिरी बकाया देखें और रिपोर्ट निकालें।",
                  )}
                </p>
                <button className="primary" onClick={() => setPage("reports")}>
                  <BarChart3 size={18} /> {t("Open reports", "रिपोर्ट खोलें")}
                </button>
              </section>
              <section className="panel">
                <h2>{tr("Shop & staff")}</h2>
                <p>
                  {tr("Separate logins keep a record of who saved each entry.")}
                </p>
                {state.users.map((u) => (
                  <div className="activity" key={u.id}>
                    <div className="avatar">{u.name[0]}</div>
                    <div>
                      <strong>{u.name}</strong>
                      <small>
                        {u.username} · {u.role}
                      </small>
                    </div>
                    <span className="tag">
                      {u.active ? t("Active", "चालू") : t("Disabled", "बंद")}
                    </span>
                    {u.role === "staff" && (
                      <button
                        className="text-btn"
                        onClick={() => open({ type: "staff-manage", staff: u })}
                      >
                        {t("Manage", "बदलें")}
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="text-btn"
                  onClick={() => open({ type: "password" })}
                >
                  {t("Change my password", "अपना पासवर्ड बदलें")}
                </button>
                {state.user.role === "owner" ? (
                  <button
                    className="primary"
                    onClick={() => open({ type: "staff" })}
                  >
                    <Plus size={16} />
                    {tr("Add staff member")}
                  </button>
                ) : (
                  <p>{tr("Ask the shop owner to manage staff accounts.")}</p>
                )}
              </section>
              {state.user.role === "owner" && (
                <section className="panel">
                  <h2>{t("Shop details", "दुकान की जानकारी")}</h2>
                  <ShopForm state={state} save={save} busy={busy} t={t} />
                  <button
                    className="text-btn"
                    onClick={() =>
                      api("audit")
                        .then((rows) => open({ type: "audit", rows }))
                        .catch((e) => setError(e.message))
                    }
                  >
                    {t("View audit trail", "बदलावों का इतिहास देखें")}
                  </button>
                </section>
              )}
              {state.user.role === "owner" && (
                <section className="panel">
                  <h2>
                    {t(
                      "Opening balances & corrections",
                      "शुरुआती बकाया और सुधार",
                    )}
                  </h2>
                  {state.adjustments.slice(0, 100).map((a) => (
                    <div className="statement-entry" key={a.id}>
                      <strong>
                        {party(a.party_id)?.name} · {a.type} · {money(a.amount)}
                      </strong>
                      <p>
                        {a.reason} · {a.tax_mode}
                      </p>
                      {state.adjustment_reversals.some(
                        (r) => r.adjustment_id === a.id,
                      ) ? (
                        <small>{t("Reversed", "वापस लिया गया")}</small>
                      ) : (
                        <button
                          className="text-btn"
                          onClick={() =>
                            open({ type: "adjustment-reverse", adjustment: a })
                          }
                        >
                          {t("Reverse wrong adjustment", "गलत बदलाव वापस लें")}
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
              <section className="panel">
                <h2>{tr("Keep a copy of your records")}</h2>
                <p>
                  {tr(
                    "Export estimates, signed images, parties and payment history. Store your exports securely.",
                  )}
                </p>
                {state.user.role === "owner" && (
                  <div className="button-group">
                    <button
                      className="secondary"
                      onClick={() => open({ type: "backup" })}
                    >
                      <Download size={17} />
                      {t("Encrypted backup", "सुरक्षित बैकअप")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => open({ type: "restore" })}
                    >
                      {t("Restore backup", "बैकअप बहाल करें")}
                    </button>
                    <a className="text-btn" href="/api/backup" download>
                      {t("Export JSON archive", "JSON रिकॉर्ड डाउनलोड करें")}
                    </a>
                  </div>
                )}
                <h3>{tr("Install on your phone")}</h3>
                <p>
                  {tr(
                    "Open this app in Chrome and choose “Add to Home screen” or “Install app” from the browser menu. Installation requires HTTPS.",
                  )}
                </p>
                <div className="notice">
                  {t(
                    "GST-tagged estimates are not tax invoices. Record every transaction under the correct GST category and confirm tax treatment with your accountant.",
                    "GST वाले अनुमान टैक्स इनवॉइस नहीं हैं। हर लेन-देन सही GST श्रेणी में दर्ज करें और अपने अकाउंटेंट से कर की पुष्टि करें।",
                  )}
                </div>
              </section>
            </div>
          )}
          {error && !modal && <div className="error">{tr(error)}</div>}
          <footer>
            <span>
              <ShieldCheck size={14} />
              {tr("Every entry has a trail.")}
            </span>
            <span>{tr("Made for the way your shop works.")}</span>
          </footer>
        </main>
        <nav className="mobile-nav">
          {nav.slice(0, 4).map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setRecordFilters({});
                setPartyFilter(null);
                setQuery("");
              }}
            >
              <Icon size={21} />
              <small>
                {id === "documents"
                  ? t("Estimates", "अनुमान")
                  : id === "parties"
                    ? t("People", "पार्टी")
                    : label}
              </small>
            </button>
          ))}
          <button onClick={() => setPage("settings")}>
            <Menu size={21} />
            <small>{tr("More")}</small>
          </button>
        </nav>
      </div>
      {modal && (
        <div className="modal-backdrop">
          <section
            className={
              "modal " +
              (["detail", "statement"].includes(modal.type)
                ? "document-detail"
                : "")
            }
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={modal.type}
          >
            <div className="modal-title">
              <h2>
                {modal.type === "document"
                  ? t("New record", "नया रिकॉर्ड")
                  : modal.type === "payment"
                    ? t("Record payment", "भुगतान दर्ज करें")
                    : modal.type === "party"
                      ? t(
                          "Add customer or supplier",
                          "ग्राहक या सप्लायर जोड़ें",
                        )
                      : modal.type === "staff"
                        ? "Add staff member"
                        : modal.type === "detail"
                          ? `Estimate SE-${String(modal.doc.id).padStart(4, "0")}`
                          : {
                              "adjustment-reverse": t(
                                "Reverse correction",
                                "बदलाव वापस लें",
                              ),
                              credit: t(
                                "Apply estimate credit",
                                "अनुमान का क्रेडिट लगाएँ",
                              ),
                              adjustment: t(
                                "Opening balance / correction",
                                "शुरुआती बकाया / सुधार",
                              ),
                              reverse: t(
                                "Reverse payment entry",
                                "भुगतान का रिकॉर्ड पलटें",
                              ),
                              statement: t("Account statement", "खाता विवरण"),
                              "staff-manage": t(
                                "Manage staff",
                                "स्टाफ में बदलाव",
                              ),
                              password: t("Change password", "पासवर्ड बदलें"),
                              backup: t(
                                "Create encrypted backup",
                                "सुरक्षित बैकअप बनाएँ",
                              ),
                              restore: t("Restore backup", "बैकअप बहाल करें"),
                              audit: t("Audit trail", "बदलावों का इतिहास"),
                              reconcile: t(
                                "Match bank payment",
                                "बैंक भुगतान मिलाएँ",
                              ),
                            }[modal.type]}
              </h2>
              <button
                className="icon-btn"
                aria-label="Close"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            {error && <div className="error">{tr(error)}</div>}
            {modal.type === "credit" && (
              <CreditForm
                modal={modal}
                state={state}
                save={save}
                busy={busy}
                t={t}
                setError={setError}
              />
            )}
            {modal.type === "adjustment" && (
              <AdjustmentForm
                state={state}
                modal={modal}
                save={save}
                busy={busy}
                t={t}
                setError={setError}
              />
            )}
            {modal.type === "reverse" && (
              <ReverseForm modal={modal} save={save} busy={busy} t={t} />
            )}
            {modal.type === "staff-manage" && (
              <StaffForm modal={modal} save={save} busy={busy} t={t} />
            )}
            {modal.type === "password" && (
              <PasswordForm
                onDone={signOut}
                setError={setError}
                busy={busy}
                setBusy={setBusy}
                t={t}
              />
            )}
            {["backup", "restore"].includes(modal.type) && (
              <BackupForm
                restore={modal.type === "restore"}
                onDone={(restored) => {
                  if (restored) signOut();
                  else {
                    setModal(null);
                    notify(
                      t(
                        "Encrypted backup downloaded",
                        "सुरक्षित बैकअप डाउनलोड हुआ",
                      ),
                    );
                  }
                }}
                setError={setError}
                busy={busy}
                setBusy={setBusy}
                t={t}
              />
            )}
            {modal.type === "statement" && (
              <>
                {state.user.role === "owner" && (
                  <button
                    className="text-btn no-print"
                    onClick={() =>
                      open({ type: "party", party: modal.statement.party })
                    }
                  >
                    {t(
                      "Edit contact & payment details",
                      "संपर्क और भुगतान की जानकारी बदलें",
                    )}
                  </button>
                )}
                <StatementView
                  state={state}
                  statement={modal.statement}
                  t={t}
                  setError={setError}
                />
              </>
            )}
            {modal.type === "audit" && (
              <div>
                {modal.rows.map((r) => (
                  <div className="statement-entry" key={r.id}>
                    <strong>
                      {r.user_name} · {r.action} · {r.entity} #{r.entity_id}
                    </strong>
                    <p>
                      {date(r.created_at)} · {r.details}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {modal.type === "adjustment-reverse" && (
              <ReverseAdjustmentForm
                modal={modal}
                save={save}
                busy={busy}
                t={t}
              />
            )}
            {modal.type === "reconcile" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save("payments/reconcile", {
                    payment_id: modal.payment.id,
                    reference: new FormData(e.currentTarget).get("reference"),
                  });
                }}
              >
                <p>
                  {t(
                    "Check the actual bank or UPI statement before confirming.",
                    "पुष्टि करने से पहले बैंक या UPI का असली स्टेटमेंट देखें।",
                  )}
                </p>
                <label>
                  {t("Bank statement reference", "बैंक स्टेटमेंट का संदर्भ")}
                  <input name="reference" required minLength={3} />
                </label>
                <button className="primary full" disabled={busy}>
                  {t("Confirm bank match", "बैंक से मिलान करें")}
                </button>
              </form>
            )}
            {modal.type === "document" && (
              <DocumentForm
                modal={modal}
                state={state}
                t={t}
                save={save}
                setError={setError}
                busy={busy}
                offline={offline}
                refresh={refresh}
              />
            )}
            {modal.type === "payment" && (
              <PaymentForm
                state={state}
                t={t}
                save={save}
                setError={setError}
                busy={busy}
                offline={offline}
              />
            )}
            {modal.type === "party" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(
                    modal.party ? "parties/" + modal.party.id : "parties",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                }}
              >
                <label>
                  {tr("Name")}
                  <input
                    name="name"
                    required
                    autoFocus
                    defaultValue={modal.party?.name}
                  />
                </label>
                <label>
                  {tr("Account type")}
                  <select
                    name="kind"
                    defaultValue={modal.party?.kind || "customer"}
                    disabled={!!modal.party}
                  >
                    <option value="customer">{tr("Customer")}</option>
                    <option value="supplier">{tr("Supplier")}</option>
                    <option value="both">
                      {tr("Both customer & supplier")}
                    </option>
                  </select>
                </label>
                <label>
                  {tr("Phone")}
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={modal.party?.phone}
                  />
                </label>
                <label>
                  {tr("GSTIN (optional)")}
                  <input name="gstin" defaultValue={modal.party?.gstin} />
                </label>
                <label>
                  {tr("Address")}
                  <input name="address" defaultValue={modal.party?.address} />
                </label>
                <details className="payment-details">
                  <summary>
                    {t(
                      "Bank / UPI details (optional)",
                      "बैंक / UPI की जानकारी (वैकल्पिक)",
                    )}
                  </summary>
                  <BankFields
                    details={
                      modal.party
                        ? JSON.parse(modal.party.payment_details || "{}")
                        : {}
                    }
                    t={t}
                  />
                </details>
                <button className="primary full" disabled={busy}>
                  {tr("Save party")}
                </button>
              </form>
            )}
            {modal.type === "staff" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(
                    "users",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                }}
              >
                <label>
                  {tr("Name")}
                  <input name="name" required />
                </label>
                <label>
                  {tr("Username")}
                  <input name="username" required autoComplete="off" />
                </label>
                <label>
                  {tr("Initial password")}
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <p>
                  {tr(
                    "At least 12 characters. Share privately with this staff member.",
                  )}
                </p>
                <button className="primary full" disabled={busy}>
                  {tr("Create staff account")}
                </button>
              </form>
            )}
            {modal.type === "detail" && (
              <>
                <div className="print-head">
                  <h2>Sunil Enterprises</h2>
                  <p>
                    {modal.doc.kind === "sale"
                      ? "SALES ESTIMATE — NOT A TAX INVOICE"
                      : "PURCHASE RECORD"}
                  </p>
                </div>
                <div className="detail-meta">
                  <div>
                    <small>
                      {modal.doc.kind === "sale" ? "Customer" : "Supplier"}
                    </small>
                    <h3>{recordParty?.name}</h3>
                    <p>{recordParty?.phone}</p>
                  </div>
                  <div>
                    <Badge mode={modal.doc.tax_mode} />
                    <p>{date(modal.doc.created_at)}</p>
                    <small>
                      Record #{modal.doc.id} · Staff #{modal.doc.created_by}
                    </small>
                  </div>
                </div>
                {modal.doc.entry_mode === "photo" ? (
                  <p className="notice">
                    {t(
                      "Photo + total record. Item details were not entered.",
                      "फोटो + कुल राशि का रिकॉर्ड। सामान का विवरण नहीं भरा गया।",
                    )}
                  </p>
                ) : (
                  <>
                    {" "}
                    <table className="estimate-sheet">
                      <colgroup>
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "40%" }} />
                        <col style={{ width: "24%" }} />
                        <col style={{ width: "24%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="right">{tr("Qty")}</th>
                          <th>{t("Item / part", "सामान / पार्ट")}</th>
                          <th className="right">{t("Rate", "भाव")}</th>
                          <th className="right">{tr("Total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modal.doc.items.map((i, n) => (
                          <tr key={n}>
                            <td className="right">{i.qty}</td>
                            <td>
                              {i.name}
                              {modal.doc.tax_mode === "gst" && (
                                <small>
                                  GST {i.gst}% · {money(i.tax)}
                                </small>
                              )}
                            </td>
                            <td className="right">{money(i.price)}</td>
                            <td className="right">{money(i.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                <div className="form-total">
                  <span>{tr("Total")}</span>
                  <strong>{money(modal.doc.total)}</strong>
                </div>
                <p>{modal.doc.notes}</p>
                {modal.doc.signature ? (
                  <>
                    <h3>{tr("Customer signature")}</h3>
                    <img
                      className="proof signature-proof"
                      alt="Customer signature captured for this estimate"
                      src={modal.doc.signature}
                    />
                  </>
                ) : (
                  <p className="hint">{tr("No digital signature attached.")}</p>
                )}
                {modal.doc.photo && (
                  <>
                    <h3>{tr("Signed paper proof")}</h3>
                    <img
                      className="proof"
                      alt="Signed paper estimate"
                      src={modal.doc.photo}
                    />
                  </>
                )}
                {modal.doc.source_photo && (
                  <>
                    <h3>
                      {t(
                        "Source list — reference only",
                        "मूल सूची — केवल संदर्भ",
                      )}
                    </h3>
                    <img
                      className="proof"
                      src={modal.doc.source_photo}
                      alt={t(
                        "Source list, not customer signature",
                        "मूल सूची, ग्राहक के हस्ताक्षर नहीं",
                      )}
                    />
                  </>
                )}
                <div className="notice">
                  {t("Net value", "बदली हुई राशि")}:{" "}
                  {money(modal.doc.adjusted_total)} ·{" "}
                  {t("Allocated", "जुड़ा भुगतान")}: {money(modal.doc.allocated)}{" "}
                  · {t("Due", "बाकी")}: {money(modal.doc.outstanding)}
                </div>
                {modal.doc.adjustments?.map((a) => (
                  <p key={a.id}>
                    {a.type}: {money(a.amount)} · {a.reason}
                  </p>
                ))}
                <div className="button-group no-print">
                  <button
                    className="primary"
                    onClick={() =>
                      sharePdf(
                        "documents/" + modal.doc.id + "/pdf?lang=" + lang,
                        "estimate-" + modal.doc.id + ".pdf",
                      ).catch((e) => setError(e.message))
                    }
                  >
                    {t("Share signed PDF", "हस्ताक्षर वाला PDF शेयर करें")}
                  </button>
                  {state.user.role === "owner" && modal.doc.credit > 0 && (
                    <button
                      className="secondary"
                      onClick={() => open({ type: "credit", doc: modal.doc })}
                    >
                      {t(
                        "Apply credit to another estimate",
                        "क्रेडिट दूसरे अनुमान में लगाएँ",
                      )}
                    </button>
                  )}
                  {state.user.role === "owner" &&
                    !modal.doc.voided &&
                    modal.doc.adjusted_total > 0 && (
                      <button
                        className="secondary"
                        onClick={() =>
                          open({ type: "adjustment", doc: modal.doc })
                        }
                      >
                        {t("Return / cancel", "वापसी / रद्द करें")}
                      </button>
                    )}
                  <button className="secondary" onClick={() => window.print()}>
                    <Download size={17} />
                    {tr("Print / save PDF")}
                  </button>
                  <button
                    className="primary"
                    onClick={async () => {
                      const text = `Sunil Enterprises\nEstimate SE-${String(modal.doc.id).padStart(4, "0")}\n${recordParty?.name}\n${modal.doc.items.map((i) => `${i.name} × ${i.qty}: ${money(i.total)}`).join("\n")}\nTotal: ${money(modal.doc.total)}\n${modal.doc.tax_mode.toUpperCase()} · ${date(modal.doc.created_at)}\nEstimate only, not a tax invoice. For signed proof, request the PDF.`;
                      try {
                        if (navigator.share)
                          await navigator.share({
                            title: "Sunil Enterprises estimate",
                            text,
                          });
                        else {
                          await navigator.clipboard.writeText(text);
                          notify(
                            "Estimate summary copied. Attach the saved PDF for signed proof.",
                          );
                        }
                      } catch (e) {
                        if (e.name !== "AbortError")
                          setError(
                            "Sharing unavailable. Use Print / save PDF.",
                          );
                      }
                    }}
                  >
                    {tr("Share summary")}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <p className="hint no-print">
                  {tr(
                    "To share signed proof on WhatsApp, save this record as a PDF and attach it. Summary sharing contains text only.",
                  )}
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
    </div>
  );
}
function DocumentForm({
  modal,
  state,
  t,
  save,
  setError,
  busy,
  offline,
  refresh,
}) {
  const draftKey = "estimate-draft-" + state.user.id;
  const [draft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) || "null");
    } catch {
      return null;
    }
  });
  const [entryMode, setEntryMode] = useState(draft?.entryMode || "items");
  const [quickTotal, setQuickTotal] = useState(draft?.quickTotal || "");
  const [requestId, setRequestId] = useState(
    () => draft?.requestId || crypto.randomUUID(),
  );
  const [partySearch, setPartySearch] = useState(""),
    [quickParty, setQuickParty] = useState(false),
    [quickName, setQuickName] = useState(""),
    [quickPhone, setQuickPhone] = useState(""),
    [addingParty, setAddingParty] = useState(false);
  const [partyId, setPartyId] = useState(draft?.partyId || ""),
    [notes, setNotes] = useState(draft?.notes || ""),
    [dueDate, setDueDate] = useState(draft?.dueDate || "");
  const [kind, setKind] = useState(modal.kind || draft?.kind || "sale"),
    [mode, setMode] = useState(draft?.mode || "non-gst"),
    [items, setItems] = useState(
      draft?.items || [{ name: "", qty: 1, price: "", gst: 18 }],
    ),
    [signature, setSignature] = useState(null),
    [photo, setPhoto] = useState(null),
    [sourcePhoto, setSourcePhoto] = useState(null);
  useEffect(() => {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        kind,
        mode,
        items,
        requestId,
        partyId,
        notes,
        dueDate,
        entryMode,
        quickTotal,
      }),
    );
  }, [
    kind,
    mode,
    items,
    partyId,
    notes,
    dueDate,
    entryMode,
    quickTotal,
    requestId,
  ]);
  useEffect(() => {
    const leave = (e) => {
      if (quickTotal || items.some((i) => i.name || i.price)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [items, quickTotal]);
  let quickAmount = 0;
  try {
    quickAmount = paise(quickTotal);
  } catch {}
  const total = items.reduce((sum, item) => {
    try {
      return (
        sum +
        calculateItems([{ ...item, price: paise(item.price) }], mode).total
      );
    } catch {
      return sum;
    }
  }, 0);
  const patch = (idx, k, v) =>
    setItems(items.map((i, j) => (j === idx ? { ...i, [k]: v } : i)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = Object.fromEntries(new FormData(e.currentTarget));
          save("documents", {
            ...f,
            request_id: requestId,
            kind,
            tax_mode: mode,
            signature,
            photo,
            source_photo: sourcePhoto,
            entry_mode: entryMode,
            ...(entryMode === "photo" ? { total: paise(quickTotal) } : {}),
            items:
              entryMode === "photo"
                ? []
                : items.map((i) => ({
                    ...i,
                    qty: Number(i.qty),
                    price: paise(i.price),
                    gst: Number(i.gst),
                  })),
          }).then((result) => {
            if (result) sessionStorage.removeItem(draftKey);
          });
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      {draft && (
        <div className="draft-note">
          {t("Draft restored", "अधूरा अनुमान वापस खुला")}
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              sessionStorage.removeItem(draftKey);
              setRequestId(crypto.randomUUID());
              setPartyId("");
              setNotes("");
              setDueDate("");
              setSignature(null);
              setPhoto(null);
              setSourcePhoto(null);
              setQuickTotal("");
              setEntryMode("items");
              setItems([{ name: "", qty: 1, price: "", gst: 18 }]);
            }}
          >
            {t("Start fresh", "नया शुरू करें")}
          </button>
        </div>
      )}
      <div className="segmented">
        <button
          type="button"
          className={kind === "sale" ? "selected" : ""}
          onClick={() => {
            setKind("sale");
            setPartyId("");
            setPartySearch("");
          }}
        >
          {t("Sales estimate", "बिक्री अनुमान")}
        </button>
        <button
          type="button"
          className={kind === "purchase" ? "selected" : ""}
          onClick={() => {
            setKind("purchase");
            setPartyId("");
            setPartySearch("");
          }}
        >
          {t("Purchase", "खरीद")}
        </button>
      </div>
      <input
        aria-label="Find customer or supplier"
        placeholder={t(
          "Find party by name or phone",
          "नाम या फोन से पार्टी खोजें",
        )}
        value={partySearch}
        onChange={(e) => setPartySearch(e.target.value)}
      />
      <label>
        {kind === "sale" ? t("Customer", "ग्राहक") : t("Supplier", "सप्लायर")}
        <select
          name="party_id"
          required
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
        >
          <option value="">{tr("Select a party…")}</option>
          {state.parties
            .filter(
              (p) =>
                p.kind === "both" ||
                p.kind === (kind === "sale" ? "customer" : "supplier"),
            )
            .filter(
              (p) =>
                String(p.id) === String(partyId) ||
                !partySearch ||
                `${p.name} ${p.phone}`
                  .toLowerCase()
                  .includes(partySearch.toLowerCase()),
            )
            .map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        className="text-btn"
        onClick={() => setQuickParty(!quickParty)}
      >
        <Plus size={16} />
        {t("Add a new party here", "यहीं नई पार्टी जोड़ें")}
      </button>
      {quickParty && (
        <div className="quick-party">
          <label>
            {t("Name", "नाम")}
            <input
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
            />
          </label>
          <label>
            {t("Phone", "फोन")}
            <input
              type="tel"
              value={quickPhone}
              onChange={(e) => setQuickPhone(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={addingParty || !quickName.trim()}
            onClick={async () => {
              setAddingParty(true);
              try {
                const r = await api("parties", {
                  name: quickName,
                  phone: quickPhone,
                  kind: kind === "sale" ? "customer" : "supplier",
                });
                await refresh();
                setPartyId(String(r.id));
                setQuickParty(false);
                setPartySearch("");
              } catch (e) {
                setError(e.message);
              } finally {
                setAddingParty(false);
              }
            }}
          >
            {t("Save & select party", "पार्टी सेव करके चुनें")}
          </button>
        </div>
      )}
      <TaxSelect mode={mode} setMode={setMode} />
      <div className="segmented" aria-label="Estimate entry method">
        <button
          type="button"
          className={entryMode === "items" ? "selected" : ""}
          onClick={() => setEntryMode("items")}
        >
          {t("Enter items", "सामान भरें")}
        </button>
        <button
          type="button"
          className={entryMode === "photo" ? "selected" : ""}
          onClick={() => setEntryMode("photo")}
        >
          {t("Photo + total", "फोटो + कुल राशि")}
        </button>
      </div>
      {entryMode === "photo" && (
        <div className="quick-estimate">
          <label>
            {t("Final total in rupees", "कुल रकम रुपये में")}
            <input
              aria-label="Final total in rupees"
              inputMode="decimal"
              required
              value={quickTotal}
              onChange={(e) => setQuickTotal(e.target.value)}
            />
          </label>
          <p className="hint">
            {t(
              "Enter the final amount including any GST. No item entry or AI reading is needed.",
              "GST सहित आखिरी कुल रकम भरें। सामान भरने या AI से पढ़वाने की ज़रूरत नहीं है।",
            )}
          </p>
          <p>
            {t(
              "Attach a photo below. For sales, use the customer-signed estimate photo.",
              "नीचे फोटो जोड़ें। बिक्री के लिए ग्राहक के हस्ताक्षर वाले अनुमान की फोटो लें।",
            )}
          </p>
        </div>
      )}
      {entryMode === "items" && (
        <>
          <datalist id="gst-rates">
            {[0, 0.25, 1.5, 3, 5, 12, 18, 28, 40].map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </datalist>
          <datalist id="item-history">
            {(state.catalog || [])
              .filter((i) => i.kind === kind)
              .map((i) => (
                <option key={i.name} value={i.name}>
                  {money(i.price)}
                </option>
              ))}
          </datalist>
          {!sourcePhoto && (
            <PhotoItems
              mode={mode}
              offline={offline}
              busy={busy}
              t={t}
              available={state.photoReadingAvailable}
              onApply={(scanned, source) => {
                const existing = items.filter(
                  (i) => i.name.trim() || i.price !== "",
                );
                if (existing.length + scanned.length > 100) {
                  setError("Add at most 100 items per estimate.");
                  return false;
                }
                setItems([...existing, ...scanned]);
                setSourcePhoto(source);
              }}
            />
          )}
          {sourcePhoto && (
            <p className="draft-note">
              {t(
                "Source list photo retained. Customer signature is still required for a sale.",
                "सूची की फोटो रखी गई है। बिक्री के लिए ग्राहक के हस्ताक्षर अभी भी ज़रूरी हैं।",
              )}
            </p>
          )}
          <div className="item-head">
            <h3>{t("Items", "सामान")}</h3>
            <span>{tr("Prices before GST · quantities up to 3 decimals")}</span>
          </div>
          {items.map((i, idx) => (
            <div className="item-row" key={idx}>
              <input
                placeholder="Item name / सामान"
                list="item-history"
                aria-label="Item name"
                required
                value={i.name}
                onChange={(e) => {
                  const found = state.catalog?.find(
                    (p) => p.name === e.target.value && p.kind === kind,
                  );
                  setItems(
                    items.map((item, j) =>
                      j === idx
                        ? {
                            ...item,
                            name: e.target.value,
                            ...(found
                              ? {
                                  price: (found.price / 100).toFixed(2),
                                  gst: found.gst,
                                }
                              : {}),
                          }
                        : item,
                    ),
                  );
                }}
              />
              <input
                aria-label="Quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
                value={i.qty}
                onChange={(e) => patch(idx, "qty", e.target.value)}
              />
              <input
                aria-label="Unit price in rupees"
                placeholder="₹ price"
                inputMode="decimal"
                required
                value={i.price}
                onChange={(e) => patch(idx, "price", e.target.value)}
              />
              {mode === "gst" && (
                <input
                  aria-label="GST rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  list="gst-rates"
                  value={i.gst}
                  onChange={(e) => patch(idx, "gst", e.target.value)}
                  required
                />
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove item"
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, j) => j !== idx))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            className="text-btn"
            type="button"
            onClick={() =>
              setItems([...items, { name: "", qty: 1, price: "", gst: 18 }])
            }
          >
            <Plus size={16} /> {t("Add another item", "और सामान जोड़ें")}
          </button>
        </>
      )}
      <div className="form-total">
        <span>{t("Estimate total", "कुल राशि")}</span>
        <strong>{money(entryMode === "photo" ? quickAmount : total)}</strong>
      </div>
      <label>
        {t("Notes / supplier invoice number", "नोट / सप्लायर बिल नंबर")}
        <input
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={tr("Optional")}
        />
      </label>
      <label>
        {t("Payment due date (optional)", "भुगतान की आखिरी तारीख (वैकल्पिक)")}
        <input
          type="date"
          name="due_date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>
      {entryMode === "items" && (
        <>
          <h3>
            <PenLine size={17} />{" "}
            {t("Customer signature", "ग्राहक के हस्ताक्षर")}
          </h3>
          <Signature key={requestId} onChange={setSignature} />
        </>
      )}
      <label className="upload">
        <Camera size={20} />
        {photo
          ? "Signed photo attached ✓"
          : t(
              "Attach signed paper photo",
              "हस्ताक्षर वाले कागज़ की फोटो जोड़ें",
            )}
        <input
          type="file"
          aria-label="Estimate photo"
          required={entryMode === "photo" && !photo}
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) {
              setError("Photo must be smaller than 5 MB.");
              return;
            }
            const r = new FileReader();
            r.onload = () => setPhoto(r.result);
            r.readAsDataURL(f);
          }}
        />
      </label>
      <p className="hint">
        {tr(
          "Saved records cannot be edited. Check all amounts before saving. GST-tagged records are estimates, not tax invoices.",
        )}
      </p>
      <button className="primary full" disabled={busy || offline}>
        {busy ? tr("Saving…") : t("Save record", "रिकॉर्ड सेव करें")}
        <Check size={18} />
      </button>
    </form>
  );
}
function PaymentForm({ state, t, save, setError, busy, offline }) {
  const [type, setType] = useState("direct"),
    [mode, setMode] = useState("non-gst"),
    [supplierMode, setSupplierMode] = useState("non-gst"),
    [requestId] = useState(() => crypto.randomUUID()),
    [customer, setCustomer] = useState(""),
    [supplier, setSupplier] = useState(""),
    [method, setMethod] = useState("upi"),
    [custom, setCustom] = useState(false),
    [openDocuments, setOpenDocuments] = useState([]);
  const actualSupplierMode = type === "direct" ? supplierMode : mode;
  useEffect(() => {
    setSupplierMode(mode);
  }, [mode]);
  useEffect(() => {
    setCustom(false);
  }, [type, mode, customer, supplier, actualSupplierMode]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      customer ? api("parties/" + customer + "/open?mode=" + mode) : [],
      supplier
        ? api("parties/" + supplier + "/open?mode=" + actualSupplierMode)
        : [],
    ])
      .then((rows) => {
        if (!cancelled) setOpenDocuments(rows.flat());
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [customer, supplier, mode, actualSupplierMode]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = Object.fromEntries(new FormData(e.currentTarget));
          save("payments", {
            ...f,
            ...(custom && ["direct", "received"].includes(type)
              ? {
                  customer_documents: new FormData(e.currentTarget)
                    .getAll("customer_documents")
                    .map(Number),
                }
              : {}),
            ...(custom && ["direct", "paid"].includes(type)
              ? {
                  supplier_documents: new FormData(e.currentTarget)
                    .getAll("supplier_documents")
                    .map(Number),
                }
              : {}),
            tax_mode: mode,
            supplier_tax_mode: actualSupplierMode,
            method,
            flow: type.startsWith("refund") ? "refund" : "settlement",
            amount: paise(f.amount),
            request_id: requestId,
          });
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      <label>
        {t("Payment route", "पैसा किस रास्ते से आया?")}
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="direct">{tr("Customer → supplier (direct)")}</option>
          <option value="received">{tr("Customer → our shop")}</option>
          <option value="paid">{tr("Our shop → supplier")}</option>
          <option value="refund-customer">
            {tr("Refund: our shop → customer")}
          </option>
          <option value="refund-supplier">
            {tr("Refund: supplier → our shop")}
          </option>
        </select>
      </label>
      {type === "direct" && (
        <h3>{t("Customer GST category", "ग्राहक की GST श्रेणी")}</h3>
      )}
      <TaxSelect mode={mode} setMode={setMode} />
      {type === "direct" && (
        <>
          <h3>{t("Supplier GST category", "सप्लायर की GST श्रेणी")}</h3>
          <TaxSelect mode={supplierMode} setMode={setSupplierMode} />
        </>
      )}
      {["direct", "received", "refund-customer"].includes(type) && (
        <label>
          {type === "refund-customer"
            ? t("Customer receiving refund", "रिफंड पाने वाला ग्राहक")
            : t("Customer paying", "भुगतान करने वाला ग्राहक")}
          <select
            name="customer_id"
            required
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="">{tr("Choose customer…")}</option>
            {state.parties
              .filter((p) => p.kind !== "supplier")
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {type.startsWith("refund") ? "Credit" : "Due"}{" "}
                  {money(
                    type.startsWith("refund")
                      ? -p.balances[mode].receivable
                      : p.balances[mode].receivable,
                  )}
                </option>
              ))}
          </select>
        </label>
      )}
      {["direct", "paid", "refund-supplier"].includes(type) && (
        <label>
          {type === "refund-supplier"
            ? t("Supplier sending refund", "रिफंड भेजने वाला सप्लायर")
            : t("Supplier receiving", "पैसा पाने वाला सप्लायर")}
          <select
            name="supplier_id"
            required
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">{tr("Choose supplier…")}</option>
            {state.parties
              .filter((p) => p.kind !== "customer")
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {type.startsWith("refund") ? "Credit" : "Payable"}{" "}
                  {money(
                    type.startsWith("refund")
                      ? -p.balances[actualSupplierMode].payable
                      : p.balances[actualSupplierMode].payable,
                  )}
                </option>
              ))}
          </select>
        </label>
      )}
      {!type.startsWith("refund") && (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => setCustom(e.target.checked)}
            />
            {t("Choose specific estimates", "खास अनुमान चुनें")}
          </label>
          <p className="hint">
            {t(
              "Default: settle the oldest estimates and opening balances first.",
              "सामान्य तरीका: पहले सबसे पुराने अनुमान और शुरुआती बकाया चुकाएँ।",
            )}
          </p>
          {custom &&
            [
              ["customer_documents", customer, "sale"],
              ["supplier_documents", supplier, "purchase"],
            ]
              .filter(([name]) =>
                name === "customer_documents"
                  ? ["direct", "received"].includes(type)
                  : ["direct", "paid"].includes(type),
              )
              .map(([name, id, kind]) => (
                <div className="allocation-list" key={name}>
                  <h3>
                    {name === "customer_documents"
                      ? t("Customer estimates", "ग्राहक के अनुमान")
                      : t("Supplier purchases", "सप्लायर की खरीद")}
                  </h3>
                  {openDocuments
                    .filter(
                      (d) =>
                        d.party_id === Number(id) &&
                        d.kind === kind &&
                        d.tax_mode ===
                          (name === "customer_documents"
                            ? mode
                            : actualSupplierMode) &&
                        d.outstanding > 0,
                    )
                    .map((d) => (
                      <label className="checkbox" key={d.id}>
                        <input name={name} value={d.id} type="checkbox" />
                        SE-{String(d.id).padStart(4, "0")} ·{" "}
                        {money(d.outstanding)}
                      </label>
                    ))}
                </div>
              ))}
        </>
      )}
      <label>
        {t("Amount received / paid (₹)", "भुगतान की राशि (₹)")}
        <input name="amount" inputMode="decimal" placeholder="0.00" required />
      </label>
      <label>
        {t("Payment method", "भुगतान का तरीका")}
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="upi">UPI</option>
          <option value="bank">{t("Bank transfer", "बैंक ट्रांसफर")}</option>
          <option value="cash">{t("Cash", "नकद")}</option>
        </select>
      </label>
      {supplier && !type.startsWith("refund") && (
        <div className="notice">
          <div>
            <strong>
              {state.parties.find((p) => p.id === Number(supplier))?.name}
            </strong>
            <p>
              {(() => {
                const details = JSON.parse(
                  state.parties.find((p) => p.id === Number(supplier))
                    ?.payment_details || "{}",
                );
                return method === "upi"
                  ? details.upi ||
                      t(
                        "Add a UPI ID in the supplier account.",
                        "सप्लायर खाते में UPI ID जोड़ें।",
                      )
                  : method === "bank"
                    ? [
                        details.bank_name,
                        details.account_holder,
                        details.account_number,
                        details.ifsc,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : t(
                        "Confirm cash receipt with the supplier.",
                        "सप्लायर से नकद रसीद की पुष्टि करें।",
                      );
              })()}
            </p>
            <button
              type="button"
              className="text-btn"
              onClick={async (e) => {
                try {
                  const details = JSON.parse(
                      state.parties.find((p) => p.id === Number(supplier))
                        ?.payment_details || "{}",
                    ),
                    value = e.currentTarget
                      .closest("form")
                      .querySelector("input[name=amount]").value,
                    text = `${state.settings.name || "Sunil Enterprises"}\n${t("Please pay", "कृपया भुगतान करें")}: ${value ? "INR " + value : ""}\n${t("Recipient", "पाने वाला")}: ${state.parties.find((p) => p.id === Number(supplier))?.name}\n${method === "upi" ? "UPI: " + (details.upi || "") : ["Bank: " + (details.bank_name || ""), "Account holder: " + (details.account_holder || ""), "Account: " + (details.account_number || ""), "IFSC: " + (details.ifsc || "")].join("\n")}\n${t("Confirm the recipient name in your banking app before paying. Share the payment reference after transfer.", "भुगतान से पहले बैंक ऐप में पाने वाले का नाम जाँचें। ट्रांसफर के बाद भुगतान रेफरेंस भेजें।")}`;
                  if (
                    (method === "upi" && !details.upi) ||
                    (method === "bank" &&
                      (!details.account_number || !details.ifsc))
                  )
                    throw Error(
                      "Add the supplier payment details before sharing instructions.",
                    );
                  if (navigator.share)
                    await navigator.share({
                      text,
                      title: "Payment instructions",
                    });
                  else {
                    await navigator.clipboard.writeText(text);
                    setError(
                      t(
                        "Payment instructions copied. Sharing instructions does not record a payment.",
                        "भुगतान की जानकारी कॉपी हुई। शेयर करने से भुगतान दर्ज नहीं होता।",
                      ),
                    );
                  }
                } catch (e) {
                  if (e.name !== "AbortError") setError(e.message);
                }
              }}
            >
              {t("Share payment instructions", "भुगतान की जानकारी शेयर करें")}
            </button>
          </div>
        </div>
      )}
      <label>
        {t(
          "UPI / bank reference or cash receipt number",
          "UPI / बैंक रेफरेंस या नकद रसीद नंबर",
        )}
        <input
          name="reference"
          required
          placeholder={tr("Enter reference for reconciliation")}
        />
      </label>
      <label>
        {t("Notes", "नोट")}
        <input
          name="notes"
          placeholder={tr("Bank name, confirmation details…")}
        />
      </label>
      <div className="notice">
        <ShieldCheck size={20} />
        <span>
          {type === "direct"
            ? tr("Both customer and supplier balances will update together.")
            : tr("The selected party’s balance will update.")}{" "}
          {tr(
            "Record only after confirming the transfer. This app does not transfer money.",
          )}
        </span>
      </div>
      <button className="primary full" disabled={busy || offline}>
        {busy
          ? t("Recording…", "दर्ज हो रहा है…")
          : t("Confirm & record payment", "पुष्टि करके भुगतान दर्ज करें")}
      </button>
    </form>
  );
}

function TaxSelect({ mode, setMode }) {
  return (
    <fieldset className="tax-select">
      <legend>{tr("Tax category / GST श्रेणी")}</legend>
      <div className="segmented">
        <button
          type="button"
          className={mode === "non-gst" ? "selected" : ""}
          onClick={() => setMode("non-gst")}
        >
          Non-GST / बिना GST
        </button>
        <button
          type="button"
          className={mode === "gst" ? "selected" : ""}
          onClick={() => setMode("gst")}
        >
          GST / GST सहित
        </button>
      </div>
    </fieldset>
  );
}
function Signature({ onChange }) {
  const ref = useRef(),
    drawing = useRef(false);
  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * ref.current.width) / r.width,
      ((e.clientY - r.top) * ref.current.height) / r.height,
    ];
  };
  return (
    <div className="signature">
      <canvas
        ref={ref}
        width="800"
        height="220"
        aria-label="Draw customer signature"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const c = ref.current.getContext("2d");
          c.beginPath();
          c.moveTo(...pos(e));
          c.strokeStyle = "#153e35";
          c.lineWidth = 3;
          c.lineCap = "round";
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = ref.current.getContext("2d");
          c.lineTo(...pos(e));
          c.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current.toDataURL());
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <span>Sign here / यहाँ हस्ताक्षर करें</span>
      <button
        type="button"
        className="text-btn"
        onClick={() => {
          ref.current.getContext("2d").clearRect(0, 0, 800, 220);
          onChange(null);
        }}
      >
        {tr("Clear")}
      </button>
    </div>
  );
}
function Stat({ label, value, icon: Icon, color, sub }) {
  return (
    <article className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className={"stat-icon " + color}>
          <Icon size={19} />
        </span>
      </div>
      <h2>{value}</h2>
      <p>{sub}</p>
    </article>
  );
}
function Badge({ mode }) {
  return (
    <span className={"badge " + (mode === "gst" ? "gst" : "")}>
      {mode === "gst" ? "GST" : "Non-GST"}
    </span>
  );
}
function Empty({ icon: Icon, title, text }) {
  return (
    <div className="empty">
      <span>
        <Icon size={28} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Pagination({ records, page, setPage, loading, t }) {
  if (!records) return null;
  return (
    <div className="pagination">
      <span>
        {records.total} {t("records", "रिकॉर्ड")} · {t("Page", "पृष्ठ")} {page}/
        {records.pages}
      </span>
      <div className="button-group">
        <button
          className="secondary"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("Previous", "पिछला")}
        </button>
        <button
          className="secondary"
          disabled={page >= records.pages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("Next", "अगला")}
        </button>
      </div>
    </div>
  );
}
function SearchBox({ query, setQuery }) {
  return (
    <div className="search">
      <Search size={18} />
      <input
        aria-label="Search records"
        placeholder={tr("Search by name or estimate number…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js");

// Operational reporting over the complete book, never the phone's recent-row cache.
export const indiaDay = (value) =>
  new Date(new Date(value).getTime() + 19800000).toISOString().slice(0, 10);
export function dayStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Use a valid date (YYYY-MM-DD).");
  const ms = Date.parse(value + "T00:00:00+05:30");
  if (!Number.isFinite(ms) || indiaDay(ms) !== value)
    throw Error("Use a valid calendar date.");
  return ms;
}
const choose = (value, values, fallback = "all") => {
  const result = String(value || fallback);
  if (!values.includes(result)) throw Error("Invalid report filter.");
  return result;
};
export function reportFilters(query = {}) {
  const from = String(query.from || ""),
    to = String(query.to || indiaDay(new Date()));
  const start = from ? new Date(dayStart(from)).toISOString() : "0000";
  const end = new Date(dayStart(to) + 86400000).toISOString();
  if (start >= end) throw Error("From date must not be after to date.");
  const party = Number(query.party || 0);
  if (!Number.isSafeInteger(party) || party < 0)
    throw Error("Choose a valid party.");
  const staff = Number(query.staff || 0);
  if (!Number.isSafeInteger(staff) || staff < 0)
    throw Error("Choose a valid staff member.");
  return {
    from,
    to,
    start,
    end,
    party,
    staff,
    q: String(query.q || "")
      .trim()
      .slice(0, 100)
      .toLowerCase(),
    lang: choose(query.lang, ["en", "hi"], "en"),
    report: choose(
      query.report,
      [
        "summary",
        "documents",
        "payments",
        "balances",
        "ledger",
        "items",
        "daybook",
      ],
      "summary",
    ),
    tax_mode: choose(query.tax_mode, ["all", "gst", "non-gst"]),
    kind: choose(query.kind, ["all", "sale", "purchase"]),
    entry_mode: choose(query.entry_mode, ["all", "items", "photo"]),
    balance_status: choose(query.balance_status, [
      "all",
      "due",
      "credit",
      "zero",
    ]),
    status: choose(query.status, [
      "all",
      "unpaid",
      "partial",
      "settled",
      "credit",
      "cancelled",
      "overdue",
      "active",
      "reversed",
    ]),
    route: choose(query.route, ["all", "received", "paid", "direct"]),
    method: choose(query.method, ["all", "cash", "upi", "bank"]),
    flow: choose(query.flow, ["all", "settlement", "refund"]),
    reconciled: choose(query.reconciled, ["all", "yes", "no"]),
    page: Math.max(1, Math.min(1000000, Math.floor(Number(query.page)) || 1)),
  };
}
const plus = (a, b) => {
  const result = a + b;
  if (!Number.isSafeInteger(result))
    throw Error(
      "Report total exceeds safe arithmetic limits. Use a shorter date range.",
    );
  return result;
};
const totalOf = (rows, field) =>
  rows.reduce((sum, row) => plus(sum, row[field] || 0), 0);
const reference = (id) => "SE-" + String(id).padStart(4, "0");

export function buildReport(db, query = {}, { allRows = false } = {}) {
  const f = reportFilters(query),
    inPeriod = (date) => date >= f.start && date < f.end;
  const parties = db
    .prepare("SELECT id,name,phone,kind FROM parties ORDER BY name")
    .all();
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  if (f.party && !partyMap.has(f.party)) throw Error("Party not found.");
  if (f.report === "ledger" && !f.party)
    throw Error("Select a party for its opening and closing statement.");
  const name = (id) => partyMap.get(id)?.name || "Our shop";
  const matchesTax = (mode) => f.tax_mode === "all" || mode === f.tax_mode;
  const matchesParty = (id) => !f.party || id === f.party;
  const search = (...values) =>
    !f.q || values.join(" ").toLowerCase().includes(f.q);
  const documents = db
    .prepare(
      "SELECT id,kind,party_id,tax_mode,entry_mode,items,total,notes,created_at,due_date,created_by FROM documents WHERE created_at<? ORDER BY created_at,id",
    )
    .all(f.end);
  const payments = db
    .prepare("SELECT * FROM payments WHERE created_at<? ORDER BY created_at,id")
    .all(f.end);
  const adjustments = db
    .prepare(
      "SELECT * FROM adjustments WHERE created_at<? ORDER BY created_at,id",
    )
    .all(f.end);
  const reversed = new Map(
    db
      .prepare("SELECT * FROM reversals WHERE created_at<?")
      .all(f.end)
      .map((r) => [r.payment_id, r]),
  );
  const adjustmentReversed = new Map(
    db
      .prepare("SELECT * FROM adjustment_reversals WHERE created_at<?")
      .all(f.end)
      .map((r) => [r.adjustment_id, r]),
  );
  const reconciliation = new Map(
    db
      .prepare("SELECT * FROM reconciliations WHERE created_at<?")
      .all(f.end)
      .map((r) => [r.payment_id, r]),
  );
  const paymentMap = new Map(payments.map((p) => [p.id, p]));
  const activePayment = (id) => paymentMap.has(id) && !reversed.has(id);
  const paid = new Map(),
    corrections = new Map(),
    voided = new Set();
  const increment = (map, id, amount) =>
    map.set(id, plus(map.get(id) || 0, amount));
  for (const a of db
    .prepare(
      "SELECT document_id,payment_id,amount FROM allocations WHERE document_id IS NOT NULL",
    )
    .iterate())
    if (activePayment(a.payment_id)) increment(paid, a.document_id, a.amount);
  for (const a of db
    .prepare("SELECT * FROM credit_transfers WHERE created_at<?")
    .iterate(f.end))
    if (activePayment(a.payment_id)) {
      increment(paid, a.source_document_id, -a.amount);
      increment(paid, a.target_document_id, a.amount);
    }
  for (const a of db.prepare("SELECT * FROM refund_allocations").iterate())
    if (activePayment(a.payment_id)) increment(paid, a.document_id, -a.amount);
  for (const a of adjustments)
    if (a.document_id && !adjustmentReversed.has(a.id)) {
      increment(corrections, a.document_id, a.amount);
      if (a.type === "void") voided.add(a.document_id);
    }
  const events = [];
  const event = (
    id,
    date,
    party,
    mode,
    type,
    ref,
    note,
    receive,
    payable,
    extra = {},
  ) => {
    if (!matchesParty(party) || !matchesTax(mode)) return;
    events.push({
      id,
      created_at: date,
      date: indiaDay(date),
      party_id: party,
      party: name(party),
      tax_mode: mode,
      event: type,
      reference: ref,
      notes: note || "",
      receivable_delta: receive,
      payable_delta: payable,
      ...extra,
    });
  };
  for (const d of documents)
    event(
      "d" + d.id,
      d.created_at,
      d.party_id,
      d.tax_mode,
      d.kind,
      reference(d.id),
      d.notes,
      d.kind === "sale" ? d.total : 0,
      d.kind === "purchase" ? d.total : 0,
    );
  for (const a of adjustments) {
    event(
      "a" + a.id,
      a.created_at,
      a.party_id,
      a.tax_mode,
      a.type,
      a.document_id ? reference(a.document_id) : "Opening #" + a.id,
      a.reason,
      a.side === "receivable" ? a.amount : 0,
      a.side === "payable" ? a.amount : 0,
    );
    const r = adjustmentReversed.get(a.id);
    if (r)
      event(
        "ar" + r.id,
        r.created_at,
        a.party_id,
        a.tax_mode,
        "reverse-" + a.type,
        "Adjustment #" + a.id,
        r.reason,
        a.side === "receivable" ? -a.amount : 0,
        a.side === "payable" ? -a.amount : 0,
      );
  }
  for (const p of payments) {
    const direction = p.flow === "refund" ? 1 : -1;
    if (p.customer_id)
      event(
        "pc" + p.id,
        p.created_at,
        p.customer_id,
        p.tax_mode,
        p.flow,
        p.reference,
        p.notes,
        direction * p.amount,
        0,
      );
    if (p.supplier_id)
      event(
        "ps" + p.id,
        p.created_at,
        p.supplier_id,
        p.supplier_tax_mode || p.tax_mode,
        p.flow,
        p.reference,
        p.notes,
        0,
        direction * p.amount,
      );
    const r = reversed.get(p.id);
    if (r) {
      if (p.customer_id)
        event(
          "rc" + r.id,
          r.created_at,
          p.customer_id,
          p.tax_mode,
          "payment-reversal",
          p.reference,
          r.reason,
          -direction * p.amount,
          0,
        );
      if (p.supplier_id)
        event(
          "rs" + r.id,
          r.created_at,
          p.supplier_id,
          p.supplier_tax_mode || p.tax_mode,
          "payment-reversal",
          p.reference,
          r.reason,
          0,
          -direction * p.amount,
        );
    }
  }
  const priority = (event) =>
    ["sale", "purchase"].includes(event)
      ? 0
      : event === "opening"
        ? 1
        : ["return", "void"].includes(event)
          ? 2
          : ["settlement", "refund"].includes(event)
            ? 3
            : 4;
  events.sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      priority(a.event) - priority(b.event) ||
      a.id.localeCompare(b.id),
  );
  const positions = new Map();
  for (const party of parties.filter((p) => matchesParty(p.id)))
    for (const mode of ["gst", "non-gst"].filter(matchesTax)) {
      positions.set(`${party.id}:${mode}`, {
        party_id: party.id,
        party: party.name,
        kind: party.kind,
        tax_mode: mode,
        opening_receivable: 0,
        opening_payable: 0,
        closing_receivable: 0,
        closing_payable: 0,
      });
    }
  for (const e of events) {
    const position = positions.get(`${e.party_id}:${e.tax_mode}`);
    if (!position) continue;
    position.closing_receivable = plus(
      position.closing_receivable,
      e.receivable_delta,
    );
    position.closing_payable = plus(position.closing_payable, e.payable_delta);
    if (e.created_at < f.start) {
      position.opening_receivable = plus(
        position.opening_receivable,
        e.receivable_delta,
      );
      position.opening_payable = plus(
        position.opening_payable,
        e.payable_delta,
      );
    }
    e.running_receivable = position.closing_receivable;
    e.running_payable = position.closing_payable;
  }
  const balances = [...positions.values()].filter(
    (p) =>
      (f.report !== "balances" ||
        search(p.party, partyMap.get(p.party_id)?.phone)) &&
      (f.balance_status === "all" ||
        (f.balance_status === "due"
          ? p.closing_receivable > 0 || p.closing_payable > 0
          : f.balance_status === "credit"
            ? p.closing_receivable < 0 || p.closing_payable < 0
            : p.closing_receivable === 0 && p.closing_payable === 0)),
  );
  const docs = documents
    .map((d) => {
      const adjusted = plus(d.total, corrections.get(d.id) || 0),
        allocated = paid.get(d.id) || 0;
      const outstanding = Math.max(0, adjusted - allocated),
        credit = Math.max(0, allocated - adjusted);
      const status = voided.has(d.id)
        ? "cancelled"
        : credit > 0
          ? "credit"
          : outstanding === 0
            ? "settled"
            : allocated > 0
              ? "partial"
              : "unpaid";
      return {
        ...d,
        party: name(d.party_id),
        adjusted_total: adjusted,
        allocated,
        outstanding,
        credit,
        voided: voided.has(d.id),
        status,
        overdue: !!d.due_date && d.due_date < f.to && outstanding > 0,
      };
    })
    .filter(
      (d) =>
        inPeriod(d.created_at) &&
        (!f.staff || d.created_by === f.staff) &&
        matchesParty(d.party_id) &&
        matchesTax(d.tax_mode) &&
        (f.kind === "all" || d.kind === f.kind) &&
        (f.entry_mode === "all" || d.entry_mode === f.entry_mode) &&
        (f.status === "all" ||
          (f.status === "overdue" ? d.overdue : d.status === f.status)) &&
        search(
          d.party,
          partyMap.get(d.party_id)?.phone,
          reference(d.id),
          d.notes,
          ...(f.report === "items"
            ? JSON.parse(d.items).map((i) => i.name)
            : []),
        ),
    );
  const payRows = payments
    .map((p) => ({
      ...p,
      customer: name(p.customer_id),
      supplier: name(p.supplier_id),
      route:
        p.customer_id && p.supplier_id
          ? "direct"
          : p.customer_id
            ? "received"
            : "paid",
      status: reversed.has(p.id) ? "reversed" : "active",
      reconciled: reconciliation.has(p.id),
      reconciliation_reference: reconciliation.get(p.id)?.reference || "",
    }))
    .filter(
      (p) =>
        (!f.staff || p.created_by === f.staff) &&
        (!f.party || p.customer_id === f.party || p.supplier_id === f.party) &&
        (f.tax_mode === "all" ||
          (p.customer_id && p.tax_mode === f.tax_mode) ||
          (p.supplier_id &&
            (p.supplier_tax_mode || p.tax_mode) === f.tax_mode)) &&
        (f.route === "all" || p.route === f.route) &&
        (f.method === "all" || p.method === f.method) &&
        (f.flow === "all" || p.flow === f.flow) &&
        (f.status === "all" || p.status === f.status) &&
        (f.reconciled === "all" || p.reconciled === (f.reconciled === "yes")) &&
        search(
          p.customer,
          p.supplier,
          p.reference,
          p.notes,
          p.reconciliation_reference,
        ),
    );
  const periodPayments = payRows.filter((p) => inPeriod(p.created_at));
  const photoScope =
    f.report === "items"
      ? documents.filter(
          (d) =>
            d.entry_mode === "photo" &&
            inPeriod(d.created_at) &&
            matchesParty(d.party_id) &&
            matchesTax(d.tax_mode) &&
            (f.kind === "all" || d.kind === f.kind) &&
            (!f.staff || d.created_by === f.staff),
        )
      : docs.filter((d) => d.entry_mode === "photo");
  const metrics = {
    sales_count: docs.filter((d) => d.kind === "sale").length,
    purchase_count: docs.filter((d) => d.kind === "purchase").length,
    sales: totalOf(
      docs.filter((d) => d.kind === "sale"),
      "total",
    ),
    purchases: totalOf(
      docs.filter((d) => d.kind === "purchase"),
      "total",
    ),
    photo_count: photoScope.length,
    photo_total: totalOf(photoScope, "total"),
    received: 0,
    paid: 0,
    direct: 0,
    customer_refunds: 0,
    supplier_refunds: 0,
    direct_refunds: 0,
    net_shop_movement: 0,
  };
  const methods = { cash: 0, upi: 0, bank: 0 };
  for (const p of payRows)
    for (const movement of [
      { date: p.created_at, sign: 1 },
      ...(reversed.has(p.id)
        ? [{ date: reversed.get(p.id).created_at, sign: -1 }]
        : []),
    ]) {
      if (!inPeriod(movement.date)) continue;
      const value = movement.sign * p.amount;
      const key =
        p.flow === "refund"
          ? p.route === "direct"
            ? "direct_refunds"
            : p.route === "received"
              ? "customer_refunds"
              : "supplier_refunds"
          : p.route;
      metrics[key] = plus(metrics[key], value);
      const net =
        p.route === "direct"
          ? 0
          : value *
            (p.route === "received" ? 1 : -1) *
            (p.flow === "refund" ? -1 : 1);
      metrics.net_shop_movement = plus(metrics.net_shop_movement, net);
      methods[p.method] = plus(methods[p.method] || 0, net);
    }
  const periodEvents = events.filter((e) => inPeriod(e.created_at));
  metrics.sales_corrections = periodEvents
    .filter((e) =>
      ["return", "void", "reverse-return", "reverse-void"].includes(e.event),
    )
    .reduce((s, e) => plus(s, e.receivable_delta), 0);
  metrics.purchase_corrections = periodEvents
    .filter((e) =>
      ["return", "void", "reverse-return", "reverse-void"].includes(e.event),
    )
    .reduce((s, e) => plus(s, e.payable_delta), 0);
  metrics.net_sales = plus(metrics.sales, metrics.sales_corrections);
  metrics.net_purchases = plus(metrics.purchases, metrics.purchase_corrections);
  const bookTotals = {};
  for (const field of [
    "opening_receivable",
    "opening_payable",
    "closing_receivable",
    "closing_payable",
  ])
    bookTotals[field] = totalOf(balances, field);
  for (const field of ["collect", "pay", "customer_credit", "supplier_credit"])
    bookTotals[field] = 0;
  for (const b of balances) {
    bookTotals.collect = plus(
      bookTotals.collect,
      Math.max(0, b.closing_receivable),
    );
    bookTotals.pay = plus(bookTotals.pay, Math.max(0, b.closing_payable));
    bookTotals.customer_credit = plus(
      bookTotals.customer_credit,
      Math.max(0, -b.closing_receivable),
    );
    bookTotals.supplier_credit = plus(
      bookTotals.supplier_credit,
      Math.max(0, -b.closing_payable),
    );
  }
  const dailyMap = new Map();
  for (const e of periodEvents) {
    if (!search(e.party, e.reference, e.notes)) continue;
    const row = dailyMap.get(e.date) || {
      date: e.date,
      sales: 0,
      purchases: 0,
      receivable_movement: 0,
      payable_movement: 0,
    };
    if (e.event === "sale") row.sales = plus(row.sales, e.receivable_delta);
    if (e.event === "purchase")
      row.purchases = plus(row.purchases, e.payable_delta);
    row.receivable_movement = plus(row.receivable_movement, e.receivable_delta);
    row.payable_movement = plus(row.payable_movement, e.payable_delta);
    dailyMap.set(e.date, row);
  }
  const itemMap = new Map();
  if (f.report === "items")
    for (const d of docs)
      for (const item of JSON.parse(d.items)) {
        if (!search(item.name, d.party, reference(d.id), d.notes)) continue;
        const key = `${d.kind}:${d.tax_mode}:${item.name}`;
        const row = itemMap.get(key) || {
          name: item.name,
          kind: d.kind,
          tax_mode: d.tax_mode,
          quantity_milli: 0,
          amount: 0,
          tax: 0,
        };
        row.quantity_milli = plus(
          row.quantity_milli,
          Math.round(item.qty * 1000),
        );
        row.amount = plus(row.amount, item.total);
        row.tax = plus(row.tax, item.tax);
        itemMap.set(key, row);
      }
  if (f.report === "items")
    metrics.item_amount = totalOf([...itemMap.values()], "amount");
  const gst = ["gst", "non-gst"].filter(matchesTax).map((mode) => ({
    tax_mode: mode,
    sales: totalOf(
      docs.filter((d) => d.kind === "sale" && d.tax_mode === mode),
      "total",
    ),
    purchases: totalOf(
      docs.filter((d) => d.kind === "purchase" && d.tax_mode === mode),
      "total",
    ),
  }));
  const all =
    f.report === "documents"
      ? docs.map(({ items, ...d }) => d).reverse()
      : f.report === "payments"
        ? periodPayments.reverse()
        : f.report === "balances"
          ? balances
          : f.report === "ledger"
            ? periodEvents.filter((e) => search(e.reference, e.notes, e.event))
            : f.report === "items"
              ? [...itemMap.values()].map((i) => ({
                  ...i,
                  quantity: i.quantity_milli / 1000,
                }))
              : [...dailyMap.values()];
  const total = all.length,
    page = Math.min(f.page, Math.max(1, Math.ceil(total / 50)));
  return {
    filters: f,
    metrics,
    methods,
    bookTotals,
    gst,
    positions: f.party ? balances : undefined,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 50)),
    rows: allRows ? all : all.slice((page - 1) * 50, page * 50),
    notes: [
      "Dates use India time. Balances and document status are as of the end of the selected to date.",
      "Direct transfers settle both parties but never count as money through the shop.",
      "Item reports show original item quantities and values, before unallocated returns; photo-only totals are reported separately.",
      "Statement balances include every movement; text search only narrows the visible statement rows.",
    ],
  };
}

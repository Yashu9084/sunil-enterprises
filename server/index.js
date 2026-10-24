import express from "express";
import { buildReport } from "./reports.js";
import { exportReport } from "./report-export.js";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { MongoLedgerStore } from "./mongo-store.js";
import { durableApi } from "./durable-api.js";
import {
  openLedger,
  calculateItems,
  balance,
  recordPayment,
} from "./ledger.js";
import {
  addAdjustment,
  reversePayment,
  documentStatus,
  audit,
  transaction,
  reason,
  transferCredit,
  reverseAdjustment,
} from "./operations.js";
import { canonicalProof, canonicalSource } from "./images.js";
import { extractEstimate } from "./estimate-ai.js";
import { renderPdf } from "./pdf.js";
import {
  snapshot,
  encryptBackup,
  decryptBackup,
  validateBackup,
} from "./backups.js";
const mongoEnabled =
  process.env.STORAGE_BACKEND === "mongodb" || Boolean(process.env.MONGODB_URI);
if ((mongoEnabled || process.env.RENDER === "true") && !process.env.MONGODB_URI)
  throw Error(
    "MONGODB_URI is required for MongoDB/Render deployment; refusing local-only storage.",
  );
const data = mongoEnabled
  ? mkdtempSync(join(tmpdir(), "sunil-mongo-cache-"))
  : resolve(process.env.DATA_DIR || "data");
mkdirSync(data, { recursive: true, mode: 0o700 });
let databaseVersion = 0;
let db = openLedger(resolve(data, "shop.sqlite"));
chmodSync(resolve(data, "shop.sqlite"), 0o600);
const mongoStore = mongoEnabled
  ? await MongoLedgerStore.connect({
      uri: process.env.MONGODB_URI,
      database: process.env.MONGODB_DB || "sunil_enterprises",
      getLedger: () => db,
    })
  : null;
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  });
  if (process.env.NODE_ENV === "production")
    res.set({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
  next();
});
app.disable("x-powered-by");
app.use("/api/backups/restore", express.json({ limit: "64mb" }));
app.use(express.json({ limit: "12mb" }));
const validPassword = (p) =>
  typeof p === "string" && p.length >= 12 && p.length <= 256;
const validAccount = (n, u, p) =>
  typeof n === "string" &&
  n.trim().length > 0 &&
  n.length <= 100 &&
  typeof u === "string" &&
  /^[a-zA-Z0-9_.-]{3,50}$/.test(u) &&
  validPassword(p);
const hash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
};
const verify = (p, h) => {
  const [salt, key] = h.split(":");
  return timingSafeEqual(scryptSync(p, salt, 64), Buffer.from(key, "hex"));
};
const digest = (t) => createHash("sha256").update(t).digest("hex");
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin).host;
    } catch {}
    if (origin !== req.headers.host)
      return res.status(403).json({ error: "Request origin rejected." });
  }
  next();
});
if (mongoStore) app.use("/api", durableApi(mongoStore));
app.get("/api/status", (req, res) =>
  res.json({
    needsSetup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
    photoReadingAvailable: Boolean(process.env.OPENAI_API_KEY),
    setupRequiresToken:
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_LOCAL_SETUP !== "1",
  }),
);
app.post("/api/setup", (req, res) => {
  if (db.prepare("SELECT id FROM users LIMIT 1").get())
    return res.status(409).json({ error: "Shop already initialized." });
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LOCAL_SETUP !== "1"
  ) {
    const expected = process.env.SETUP_TOKEN,
      supplied = String(req.body.setup_token || "");
    if (
      !expected ||
      !supplied ||
      !timingSafeEqual(
        Buffer.from(digest(expected)),
        Buffer.from(digest(supplied)),
      )
    )
      return res.status(403).json({
        error:
          "Owner setup requires the private setup token configured on the server.",
      });
  }
  const { name, username, password } = req.body;
  if (!validAccount(name, username, password))
    return res.status(400).json({
      error: "Enter a name, username and password of at least 12 characters.",
    });
  db.prepare("INSERT INTO users(name,username,hash,role) VALUES(?,?,?,?)").run(
    String(name),
    String(username).toLowerCase(),
    hash(password),
    "owner",
  );
  res.json({ ok: true });
});
const attempts = new Map();
app.post("/api/login", (req, res) => {
  const key = req.ip,
    now = Date.now(),
    a = attempts.get(key);
  for (const [ip, item] of attempts)
    if (now - item.time >= 600000) attempts.delete(ip);
  if (attempts.size > 10000) attempts.clear();
  if (a && now - a.time < 600000 && a.count >= 20)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 10 minutes." });
  if (!a || now - a.time >= 600000) attempts.set(key, { time: now, count: 0 });
  const { username, password } = req.body;
  const u = db
    .prepare("SELECT * FROM users WHERE username=?")
    .get(String(username || "").toLowerCase());
  if (
    !u ||
    !u.active ||
    typeof password !== "string" ||
    password.length > 256 ||
    !verify(password, u.hash)
  ) {
    attempts.get(key).count++;
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  attempts.delete(key);
  db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
  const t = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(t),
    u.id,
    now + 43200000,
  );
  res.setHeader(
    "Set-Cookie",
    `session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  const t = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("session="))
    ?.slice(8);
  req.user =
    t &&
    db
      .prepare(
        "SELECT u.id,u.name,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>? AND u.active=1",
      )
      .get(digest(t), Date.now());
  if (!req.user) return res.status(401).json({ error: "Please sign in." });
  req.databaseVersion = databaseVersion;
  next();
});
// Read-only AI work must not hold the financial request queue during the network call.
const scanUsage = new Map();
app.post("/api/estimates/extract", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error:
        "Photo reading is not configured. Ask the owner to set OPENAI_API_KEY privately in Render.",
    });
  }
  const now = Date.now();
  for (const [id, usage] of scanUsage)
    if (!usage.active && now - usage.start > 3600000) scanUsage.delete(id);
  const user = req.user.id;
  const usage = scanUsage.get(user) || { start: now, count: 0, active: false };
  if (usage.active || usage.count >= 20)
    return res.status(429).json({
      error:
        "Photo reading limit reached. Wait a while or enter items manually.",
    });
  const catalog = db
    .prepare("SELECT items FROM documents ORDER BY id DESC LIMIT 100")
    .all()
    .flatMap((d) => JSON.parse(d.items).map((i) => i.name));
  usage.active = true;
  usage.count++;
  scanUsage.set(user, usage);
  req.releaseProjection?.();
  try {
    const result = await extractEstimate({
      image: req.body.image,
      mode: req.body.tax_mode,
      catalog: [...new Set(catalog)],
    });
    res.json({
      ...result,
      source_photo: await canonicalSource(req.body.image),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    usage.active = false;
  }
});
app.post("/api/logout", (req, res) => {
  const t = (req.headers.cookie || "").match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (t) db.prepare("DELETE FROM sessions WHERE token=?").run(digest(t));
  res.setHeader(
    "Set-Cookie",
    "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/state", (req, res) => {
  const parties = db
    .prepare("SELECT * FROM parties ORDER BY name")
    .all()
    .map((p) => ({
      ...p,
      balances: {
        gst: balance(db, p.id, "gst"),
        "non-gst": balance(db, p.id, "non-gst"),
      },
    }));
  res.json({
    user: req.user,
    today: db
      .prepare(
        "SELECT COUNT(*) count,COALESCE(SUM(d.total+(SELECT COALESCE(SUM(a.amount),0) FROM adjustments a LEFT JOIN adjustment_reversals r ON r.adjustment_id=a.id WHERE a.document_id=d.id AND r.id IS NULL)),0) total FROM documents d WHERE d.kind='sale' AND date(d.created_at,'+5 hours','+30 minutes')=date('now','+5 hours','+30 minutes')",
      )
      .get(),
    catalog: [
      ...new Map(
        db
          .prepare(
            "SELECT items,kind FROM documents ORDER BY id DESC LIMIT 500",
          )
          .all()
          .reverse()
          .flatMap((d) =>
            JSON.parse(d.items).map((i) => ({ ...i, kind: d.kind })),
          )
          .map((i) => [i.kind + ":" + i.name, i]),
      ).values(),
    ].slice(0, 500),
    parties,
    documents: db
      .prepare(
        "SELECT id,kind,party_id,tax_mode,entry_mode,total,created_at,created_by,due_date FROM documents ORDER BY id DESC LIMIT 250",
      )
      .all()
      .map((d) => documentStatus(db, d)),
    payments: db
      .prepare("SELECT * FROM payments ORDER BY id DESC LIMIT 250")
      .all(),
    photoReadingAvailable: Boolean(process.env.OPENAI_API_KEY),
    adjustments: db.prepare("SELECT * FROM adjustments ORDER BY id DESC").all(),
    adjustment_reversals: db
      .prepare("SELECT * FROM adjustment_reversals")
      .all(),
    reversals: db.prepare("SELECT * FROM reversals").all(),
    reconciliations: db.prepare("SELECT * FROM reconciliations").all(),
    settings: JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key='shop'").get()?.value ||
        "{}",
    ),
    users:
      req.user.role === "owner"
        ? db.prepare("SELECT id,name,username,role,active FROM users").all()
        : [],
  });
});
const paymentDetails = (p) =>
  Object.fromEntries(
    ["account_holder", "account_number", "bank_name", "ifsc", "upi"].map(
      (k) => [
        k,
        String(p[k] || "")
          .trim()
          .slice(0, k === "account_number" ? 30 : 100),
      ],
    ),
  );
app.post("/api/parties", (req, res) => {
  const p = req.body;
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 100 ||
    String(p.address || "").length > 1000 ||
    String(p.phone || "").length > 30 ||
    String(p.gstin || "").length > 20 ||
    !["customer", "supplier", "both"].includes(p.kind)
  )
    return res.status(400).json({ error: "Enter a party name and type." });
  const r = db
    .prepare(
      "INSERT INTO parties(name,phone,kind,gstin,address,payment_details) VALUES(?,?,?,?,?,?)",
    )
    .run(
      String(p.name).trim(),
      String(p.phone || ""),
      p.kind,
      String(p.gstin || ""),
      String(p.address || ""),
      JSON.stringify(paymentDetails(p)),
    );
  audit(db, req.user.id, "create", "party", Number(r.lastInsertRowid));
  res.json({ id: Number(r.lastInsertRowid) });
});
function validateProof(value) {
  if (!value) return;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    value,
  );
  if (!match) throw Error("Use a PNG, JPEG or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  const valid =
    match[1] === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid || bytes.length > 5 * 1024 * 1024)
    throw Error("Choose a valid image smaller than 5 MB.");
}
app.post("/api/documents", async (req, res) => {
  try {
    const p = req.body;
    if (
      !["sale", "purchase"].includes(p.kind) ||
      !["gst", "non-gst"].includes(p.tax_mode)
    )
      throw Error("Choose document type and tax category.");
    const party = db
      .prepare("SELECT * FROM parties WHERE id=?")
      .get(Number(p.party_id));
    if (
      !party ||
      !(
        party.kind === "both" ||
        party.kind === (p.kind === "sale" ? "customer" : "supplier")
      )
    )
      throw Error("Choose a suitable customer or supplier.");
    if (String(p.notes || "").length > 1000)
      throw Error("Notes must be 1,000 characters or fewer.");
    const entryMode = p.entry_mode || "items";
    if (!["items", "photo"].includes(entryMode))
      throw Error("Choose item entry or photo + total.");
    let result;
    if (entryMode === "photo") {
      if (p.items && (!Array.isArray(p.items) || p.items.length))
        throw Error("Photo-only records must not contain item rows.");
      if (
        !Number.isSafeInteger(p.total) ||
        p.total <= 0 ||
        p.total > 100000000000
      )
        throw Error("Enter a positive total with at most two decimal places.");
      if (!p.photo)
        throw Error(
          "Attach the estimate or purchase photo before saving a photo-only record.",
        );
      result = { items: [], total: p.total };
    } else result = calculateItems(p.items, p.tax_mode);
    p.signature = await canonicalProof(p.signature);
    p.photo = await canonicalProof(p.photo);
    p.source_photo = await canonicalSource(p.source_photo);
    if (
      !db
        .prepare("SELECT id FROM users WHERE id=? AND active=1")
        .get(req.user.id)
    )
      throw Error("Your access has been disabled. Contact the shop owner.");
    if (req.databaseVersion !== databaseVersion)
      throw Error("The database was restored. Sign in again before saving.");
    if (!/^[-a-zA-Z0-9]{8,100}$/.test(p.request_id || ""))
      throw Error("Missing save identifier. Reload the form.");
    const previous = db
      .prepare("SELECT * FROM documents WHERE request_id=?")
      .get(p.request_id);
    if (previous) {
      if (
        previous.created_by !== req.user.id ||
        previous.party_id !== Number(p.party_id) ||
        previous.kind !== p.kind ||
        previous.tax_mode !== p.tax_mode ||
        previous.items !== JSON.stringify(result.items) ||
        previous.total !== result.total ||
        previous.entry_mode !== entryMode ||
        previous.signature !== (p.signature || null) ||
        previous.photo !== (p.photo || null) ||
        previous.source_photo !== (p.source_photo || null) ||
        previous.notes !== String(p.notes || "") ||
        previous.due_date !== (p.due_date || null)
      )
        throw Error(
          "This save identifier was already used for another record.",
        );
      return res.json({ id: previous.id });
    }
    if (p.kind === "sale" && !p.signature && !p.photo)
      throw Error(
        "Capture the customer signature or attach the signed paper before saving a sale.",
      );
    validateProof(p.signature);
    validateProof(p.photo);
    if (
      p.due_date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ||
        !Number.isFinite(Date.parse(p.due_date)) ||
        new Date(p.due_date).toISOString().slice(0, 10) !== p.due_date)
    )
      throw Error("Invalid due date.");
    const id = transaction(db, () => {
      const r = db
        .prepare(
          "INSERT INTO documents(kind,party_id,tax_mode,items,total,signature,photo,notes,created_by,request_id,due_date,party_snapshot,shop_snapshot,source_photo,entry_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          p.kind,
          Number(p.party_id),
          p.tax_mode,
          JSON.stringify(result.items),
          result.total,
          p.signature || null,
          p.photo || null,
          String(p.notes || ""),
          req.user.id,
          p.request_id,
          p.due_date || null,
          JSON.stringify(party),
          db.prepare("SELECT value FROM settings WHERE key='shop'").get()
            ?.value || JSON.stringify({ name: "Sunil Enterprises" }),
          p.source_photo || null,
          entryMode,
        );
      audit(db, req.user.id, "create", "document", Number(r.lastInsertRowid), {
        total: result.total,
        entry_mode: entryMode,
      });
      return Number(r.lastInsertRowid);
    });
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/documents/:id", (req, res) => {
  const d = db
    .prepare("SELECT * FROM documents WHERE id=?")
    .get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: "Estimate not found." });
  res.json({
    ...documentStatus(db, d),
    items: JSON.parse(d.items),
    adjustments: db
      .prepare("SELECT * FROM adjustments WHERE document_id=? ORDER BY id")
      .all(d.id),
    allocations: db
      .prepare(
        "SELECT a.*,p.reference,r.id reversed FROM allocations a JOIN payments p ON p.id=a.payment_id LEFT JOIN reversals r ON r.payment_id=p.id WHERE a.document_id=?",
      )
      .all(d.id),
  });
});
app.post("/api/payments", (req, res) => {
  try {
    res.json({ id: recordPayment(db, req.body, req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/users", (req, res) => {
  if (req.user.role !== "owner") return res.sendStatus(403);
  const { name, username, password } = req.body;
  if (!validAccount(name, username, password))
    return res.status(400).json({
      error: "Name, username and a 12-character password are required.",
    });
  try {
    db.prepare(
      "INSERT INTO users(name,username,hash,role) VALUES(?,?,?,?)",
    ).run(name, String(username).toLowerCase(), hash(password), "staff");
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Username already exists." });
  }
});
app.get("/api/backup", (req, res) => {
  if (req.user.role !== "owner") return res.sendStatus(403);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="sunil-ledger-backup.json"',
  );
  res.json({
    version: 2,
    adjustments: db.prepare("SELECT * FROM adjustments").all(),
    adjustment_reversals: db
      .prepare("SELECT * FROM adjustment_reversals")
      .all(),
    reversals: db.prepare("SELECT * FROM reversals").all(),
    allocations: db.prepare("SELECT * FROM allocations").all(),
    credit_transfers: db.prepare("SELECT * FROM credit_transfers").all(),
    refund_allocations: db.prepare("SELECT * FROM refund_allocations").all(),
    reconciliations: db.prepare("SELECT * FROM reconciliations").all(),
    audit: db.prepare("SELECT * FROM audit").all(),
    settings: db.prepare("SELECT * FROM settings").all(),
    exportedAt: new Date().toISOString(),
    parties: db.prepare("SELECT * FROM parties").all(),
    documents: db.prepare("SELECT * FROM documents").all(),
    payments: db.prepare("SELECT * FROM payments").all(),
    users: db.prepare("SELECT id,name,username,role,active FROM users").all(),
  });
});

const owner = (req, res, next) =>
  req.user.role === "owner"
    ? next()
    : res
        .status(403)
        .json({ error: "Only the shop owner can perform this action." });
const action = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
app.get(
  "/api/reports",
  action((req) => buildReport(db, req.query)),
);
for (const format of ["csv", "pdf"])
  app.get("/api/reports/export." + format, owner, (req, res) => {
    try {
      exportReport(db, req.query, res, format);
    } catch (error) {
      if (!res.headersSent) res.status(400).json({ error: error.message });
      else res.destroy();
    }
  });
app.get(
  "/api/records",
  action((req) =>
    buildReport(db, {
      ...req.query,
      report: req.query.type === "payment" ? "payments" : "documents",
    }),
  ),
);
app.get(
  "/api/parties/:id/open",
  action((req) => {
    const id = Number(req.params.id),
      mode = req.query.mode === "gst" ? "gst" : "non-gst";
    return db
      .prepare(
        "SELECT id,kind,party_id,tax_mode,total,created_at FROM documents WHERE party_id=? AND tax_mode=? ORDER BY id",
      )
      .all(id, mode)
      .map((d) => documentStatus(db, d))
      .filter((d) => d.outstanding > 0 || d.credit > 0);
  }),
);
app.post(
  "/api/parties/:id",
  owner,
  action((req) => {
    const p = req.body;
    if (!String(p.name || "").trim() || String(p.name).length > 100)
      throw Error("Enter a name up to 100 characters.");
    const id = Number(req.params.id);
    if (!db.prepare("SELECT id FROM parties WHERE id=?").get(id))
      throw Error("Party not found.");
    db.prepare(
      "UPDATE parties SET name=?,phone=?,address=?,gstin=?,payment_details=? WHERE id=?",
    ).run(
      p.name,
      String(p.phone || "").slice(0, 30),
      String(p.address || "").slice(0, 1000),
      String(p.gstin || "").slice(0, 20),
      JSON.stringify(paymentDetails(p)),
      id,
    );
    audit(db, req.user.id, "edit", "party", id);
    return { ok: true };
  }),
);
app.post(
  "/api/adjustments/reverse",
  owner,
  action((req) => ({ id: reverseAdjustment(db, req.body, req.user.id) })),
);
app.post(
  "/api/credits/apply",
  owner,
  action((req) => ({ id: transferCredit(db, req.body, req.user.id) })),
);
app.post(
  "/api/adjustments",
  owner,
  action((req) => ({ id: addAdjustment(db, req.body, req.user.id) })),
);
app.post(
  "/api/payments/reverse",
  owner,
  action((req) => ({ id: reversePayment(db, req.body, req.user.id) })),
);
app.post(
  "/api/payments/reconcile",
  owner,
  action((req) => {
    const p = db
      .prepare("SELECT id FROM payments WHERE id=?")
      .get(Number(req.body.payment_id));
    if (
      !p ||
      db.prepare("SELECT id FROM reversals WHERE payment_id=?").get(p.id)
    )
      throw Error("Choose an active payment.");
    const ref = reason(req.body.reference);
    if (
      db.prepare("SELECT id FROM reconciliations WHERE payment_id=?").get(p.id)
    )
      throw Error("Payment is already reconciled.");
    db.prepare(
      "INSERT INTO reconciliations(payment_id,reference,created_by) VALUES(?,?,?)",
    ).run(p.id, ref, req.user.id);
    audit(db, req.user.id, "reconcile", "payment", p.id, { reference: ref });
    return { ok: true };
  }),
);
app.post(
  "/api/users/:id/manage",
  owner,
  action((req) =>
    transaction(db, () => {
      const u = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(Number(req.params.id));
      if (!u || u.role === "owner")
        throw Error(
          "Choose a staff account. Use Change password for the owner account.",
        );
      if (req.body.password) {
        if (!validPassword(req.body.password))
          throw Error("Password must contain 12–256 characters.");
        db.prepare("UPDATE users SET hash=? WHERE id=?").run(
          hash(req.body.password),
          u.id,
        );
      }
      if (typeof req.body.active === "boolean")
        db.prepare("UPDATE users SET active=? WHERE id=?").run(
          req.body.active ? 1 : 0,
          u.id,
        );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
      audit(db, req.user.id, "manage", "user", u.id, {
        active: req.body.active,
        passwordReset: !!req.body.password,
      });
      return { ok: true };
    }),
  ),
);
app.post(
  "/api/password",
  action((req) => {
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (
      !verify(String(req.body.current_password || ""), u.hash) ||
      !validPassword(req.body.password)
    )
      throw Error(
        "Check the current password; the new password needs 12–256 characters.",
      );
    transaction(db, () => {
      db.prepare("UPDATE users SET hash=? WHERE id=?").run(
        hash(req.body.password),
        u.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
      audit(db, u.id, "password", "user", u.id);
    });
    return { ok: true, signInAgain: true };
  }),
);
app.post(
  "/api/settings",
  owner,
  action((req) => {
    const p = req.body;
    if (!String(p.name || "").trim() || String(p.name).length > 100)
      throw Error("Enter the shop name.");
    const value = {
      name: String(p.name),
      address: String(p.address || ""),
      phone: String(p.phone || ""),
      gstin: String(p.gstin || ""),
      ...paymentDetails(p),
    };
    db.prepare(
      "INSERT INTO settings VALUES('shop',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(JSON.stringify(value));
    audit(db, req.user.id, "update", "settings", 0);
    return { ok: true };
  }),
);
app.get("/api/audit", owner, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT a.*,u.name user_name FROM audit a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500",
      )
      .all(),
  ),
);
app.get(
  "/api/statements/:id",
  action((req) => {
    const party = db
      .prepare("SELECT * FROM parties WHERE id=?")
      .get(Number(req.params.id));
    if (!party) throw Error("Party not found.");
    return {
      party,
      adjustment_reversals: db
        .prepare(
          "SELECT r.* FROM adjustment_reversals r JOIN adjustments a ON a.id=r.adjustment_id WHERE a.party_id=?",
        )
        .all(party.id),
      credit_transfers: db
        .prepare(
          "SELECT t.* FROM credit_transfers t JOIN documents d ON d.id=t.source_document_id WHERE d.party_id=?",
        )
        .all(party.id),
      balances: {
        gst: balance(db, party.id, "gst"),
        "non-gst": balance(db, party.id, "non-gst"),
      },
      documents: db
        .prepare("SELECT * FROM documents WHERE party_id=? ORDER BY id")
        .all(party.id)
        .map((d) => ({ ...documentStatus(db, d), items: JSON.parse(d.items) })),
      payments: db
        .prepare(
          "SELECT p.*,r.id reversed,r.reason reversal_reason FROM payments p LEFT JOIN reversals r ON r.payment_id=p.id WHERE customer_id=? OR supplier_id=? ORDER BY p.id",
        )
        .all(party.id, party.id),
      adjustments: db
        .prepare("SELECT * FROM adjustments WHERE party_id=?")
        .all(party.id),
      allocations: db
        .prepare(
          "SELECT a.* FROM allocations a JOIN payments p ON p.id=a.payment_id WHERE p.customer_id=? OR p.supplier_id=?",
        )
        .all(party.id, party.id),
    };
  }),
);
app.post("/api/backups/create", owner, (req, res) => {
  try {
    const u = db.prepare("SELECT hash FROM users WHERE id=?").get(req.user.id);
    if (!verify(String(req.body.current_password || ""), u.hash))
      throw Error("Incorrect account password.");
    const bytes = encryptBackup(snapshot(db), req.body.passphrase);
    audit(db, req.user.id, "backup", "database", 0);
    res
      .set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          'attachment; filename="sunil-khata-' +
          new Date().toISOString().slice(0, 10) +
          '.skbackup"',
      })
      .send(bytes);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post(
  "/api/backups/restore",
  owner,
  action(async (req) => {
    const u = db.prepare("SELECT hash FROM users WHERE id=?").get(req.user.id);
    if (!verify(String(req.body.current_password || ""), u.hash))
      throw Error("Incorrect account password.");
    const bytes = decryptBackup(
        Buffer.from(String(req.body.file || ""), "base64"),
        req.body.passphrase,
      ),
      info = validateBackup(bytes);
    if (req.body.preview) return info;
    if (req.body.confirmation !== "RESTORE")
      throw Error("Type RESTORE to replace the current shop records.");
    let safetyBackupId;
    if (mongoStore)
      safetyBackupId = await mongoStore.retainSafetyBackup(
        encryptBackup(snapshot(db), req.body.passphrase),
      );
    const backups = resolve(data, "backups");
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const safety = resolve(backups, "pre-restore-" + Date.now() + ".sqlite");
    writeFileSync(safety, snapshot(db), { mode: 0o600 });
    const replacement = resolve(
      data,
      "restore-" + randomBytes(8).toString("hex") + ".sqlite",
    );
    writeFileSync(replacement, bytes, { mode: 0o600 });
    const replacementDb = openLedger(replacement);
    replacementDb.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)");
    replacementDb.close();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    databaseVersion++;
    try {
      renameSync(replacement, resolve(data, "shop.sqlite"));
    } finally {
      db = openLedger(resolve(data, "shop.sqlite"));
    }
    const restoredOwner = db
      .prepare(
        "SELECT id FROM users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1",
      )
      .get();
    audit(db, restoredOwner.id, "restore", "database", 0, {
      authenticated_operator: req.user.username,
      counts: info.counts,
    });
    return { ok: true, signInAgain: true, counts: info.counts, safetyBackupId };
  }),
);
app.get("/api/documents/:id/pdf", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM documents WHERE id=?").get(id))
    return res.status(404).json({ error: "Record not found." });
  renderPdf(db, { documentId: id, lang: req.query.lang }, res);
});
app.get("/api/statements/:id/pdf", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM parties WHERE id=?").get(id))
    return res.status(404).json({ error: "Party not found." });
  renderPdf(
    db,
    {
      partyId: id,
      mode: ["gst", "non-gst"].includes(req.query.mode)
        ? req.query.mode
        : "all",
      proof: req.query.proof !== "0",
      lang: req.query.lang,
      paymentId: Number(req.query.payment) || null,
    },
    res,
  );
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((err, req, res, next) => {
  console.error(err.message);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(err.status === 413 ? 413 : 500).json({
    error:
      err.status === 413
        ? "File is too large. Use a smaller photo or backup."
        : "Request failed. Please try again.",
  });
});
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () =>
    console.log("Sunil Enterprises listening on port " + server.address().port),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      db.close();
      await mongoStore?.close();
      if (mongoEnabled) rmSync(data, { recursive: true, force: true });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });

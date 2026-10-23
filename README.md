# Sunil Enterprises · Digital Khata

A shared web app and installable PWA for a shop that works with signed estimates, credit sales, purchases, and customer-to-supplier payments. React + Express + SQLite; Node **24+**. No external database or cloud account is needed for local use.

## Run locally

```sh
npm ci
npm run dev
```

The development server uses port 3000. Create the owner account on first launch, add staff from **Shop & staff**, and use fictitious records for the initial walkthrough. Every phone connects to the **same server**. Separate installations have separate books.

```sh
npm test                # ledger, API lifecycle, authorization and backup tests
npm run test:browser    # production build + real Chromium workflow in a disposable shop
npm run build
npm start
```

The browser test uses `/usr/bin/chromium` if available, otherwise a Playwright browser (`npx playwright install chromium`). It creates and removes its own test data and server. `PLAYWRIGHT_USE_BUNDLED=1` forces the bundled browser. Runtime records live in ignored `data/shop.sqlite`, or the persistent `DATA_DIR` you configure. Do not put real records in Git.

## Shop workflow

1. Add customers and suppliers. A party can be both. Store their phone, address, GSTIN and optional bank/UPI details.
2. Before entering transactions, record old paper-ledger opening balances separately for GST/non-GST and receivable/payable. Do not double count old estimates as both an opening balance and new sales.
3. Make a sales estimate or purchase record. Enter quantities (up to three decimal places), prices and GST rates where applicable. Repeated item names suggest the latest price for the same sales/purchase workflow. Sales require an on-screen signature or signed-paper photo. Optional due dates highlight overdue estimates.
4. After independently confirming receipt, record a customer-to-shop, shop-to-supplier, or direct customer-to-supplier payment. Select UPI, bank or cash and keep the transfer/receipt reference. Direct payments settle **both** accounts atomically. Choose the GST category independently for each side; a GST customer receipt can settle a non-GST supplier bill and vice versa. If a real transfer covers categories, enter separate portions with the same reference.
5. Payment allocation defaults to oldest records and opening balances first. Select particular estimates when needed. Partial payments are supported. Balance validation runs against the server's latest data, so two phones cannot both spend the same remaining balance.
6. Open a party account for its statement and signed estimates, or open **Signed records for this payment** for a settlement packet. Download/share the actual PDF through the device share sheet; desktop browsers download it when file sharing is unavailable. Text summary sharing is separate.
7. For mistakes, the owner records returns/credits, cancels remaining document value, reverses incorrect payments, or reverses incorrect adjustments. Original records remain. Refund genuine credits through Payments or apply an overpaid estimate's credit to another estimate in the same account/category. Reversing a payment also disables credit transfers derived from it.

[Hindi shop guide](docs/SHOP_GUIDE.hi.md) · [Operations and recovery](docs/OPERATIONS.md) · [Deployment preparation](docs/DEPLOYMENT.md)

## Financial model

Money is stored in integer paise. Quantities are scaled to thousandths for exact per-line rounding; the server calculates totals. Each line rounds its base and GST to paise. GST/non-GST accounts and customer/supplier sides stay separate. A party's credit is not silently offset against another party's debt.

Example: a customer owes ₹10,000 and the shop owes a supplier ₹8,000 under GST. A confirmed ₹4,000 direct payment leaves ₹6,000 to collect and ₹4,000 to pay. Non-GST accounts do not change, and no money is recorded as passing through the shop's bank account.

Returns reduce document value and may produce credit after payment. Refunds consume that credit. Credit application moves an existing payment allocation, without creating money or changing the party's net balance. Reversals preserve the original and append a dated audit entry. Opening balance replacements likewise preserve their history.

Signed estimates retain party/shop snapshots, so later contact changes do not rewrite the original PDF. Uploaded images are decoded, orientation-corrected and resized to at most 2000×2000 pixels; valid photos under 5 MB are accepted. Malformed/decompression-bomb images are rejected.

## Shared phones and offline behavior

Owner/staff accounts use HTTP-only session cookies and 12-hour sessions. The owner can disable staff, reset staff passwords, and inspect the audit trail. Staff cannot alter access, make financial corrections, restore/export backups, or edit shop details. Password changes revoke previous sessions. Credentials are never embedded in the client bundle.

Balances refresh every 15 seconds. Search and history are paginated; old records remain searchable. The PWA precaches its static shell. It does **not** cache authenticated financial API responses. During a connection loss, records already loaded remain visible and new financial writes are blocked. Reloading offline shows a reconnect screen. Unsaved text drafts stay in that browser tab and are cleared on sign-out; signature/photo drafts are not saved to browser storage. Reconnect to load the books and complete the signature/save workflow. This design deliberately avoids conflicting offline ledgers across staff phones.

## Backup and recovery

The owner can create a passphrase-encrypted `.skbackup` containing the full ledger, signed proofs and staff accounts. Sessions are removed. Restore first authenticates the backup and checks SQLite integrity and foreign keys, previews the record counts, and requires the current owner's password plus typed `RESTORE`. The running shop is replaced only after validation; a pre-restore safety snapshot is retained locally and sessions are revoked. Sign in using an owner account from the backup.

Browser restore accepts files up to 40 MB; use the documented offline CLI for larger files. JSON export is an unencrypted record archive, **not** a restorable system backup. Losing the backup passphrase makes the encrypted backup unrecoverable. Keep encrypted off-server copies and test recovery regularly.

## Deployment status and scope

Production code, Docker/Compose files, TLS proxy configuration, private owner setup, health checks and recovery tooling are included. **Public deployment has not been performed.** Initialize privately, attach durable storage, configure HTTPS and off-server backups, and perform the real-device shop acceptance walkthrough before switching the books over.

These are **estimates and commercial ledger records**, not statutory GST invoices, GST credit notes, e-invoices or tax filing software. The GST toggle records the selected treatment; it does not determine a transaction's legal tax status. Record every transaction in accordance with applicable law and have the accountant verify GST rates and opening balances. The app does not send money, access bank accounts or automatically verify transfers. Bank matching is an owner-confirmed reconciliation record. Duplicate active references for the same route, method and GST category are rejected, including entries made independently on different phones. Signature images preserve evidence but do not independently verify identity or customer acceptance of electronic signatures.

The app targets one shop on one Node process with SQLite on a local persistent disk. Do not run multiple app replicas or place the database on an unreliable/shared network filesystem. Automated OCR, stock valuation, statutory invoicing, automatic WhatsApp sending and banking integrations are outside this estimate/ledger workflow. Hindi/English interfaces are included; customer names, staff-entered notes, references and technical identifiers retain their original text.

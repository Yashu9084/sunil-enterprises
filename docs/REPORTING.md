# Quick photo estimates and reporting

## Photo + total

In **New estimate** or **Purchase**, choose **Photo + total**, select the party and GST/non-GST category, enter the final total in rupees, attach the paper photo and save. Sales use the customer-signed estimate photo. No item name, quantity, unit price or AI call is required. The entered total includes any GST; tax components are not guessed.

The saved record stores `entry_mode=photo`, `items=[]`, its exact integer-paise total, signed photo, party/shop snapshots and audit entry. It participates in balances, payment allocation, partial payments, direct transfers, returns/cancellations, statements, backup/restore and PDF sharing. Normal item entry and the optional AI-assisted reader remain available. Retried saves reuse the request ID; changing a total with an already-used ID is rejected.

Drafts retain the typed total, not the photo. After a reload, reattach the photo before saving. Original saved records stay immutable; use the existing audited corrections workflow for mistakes.

## Where to find reports

Use **Reports** in the desktop sidebar, **More → Open reports** on a phone, or **Date-range reports & statements** on Overview. Estimates and Payments also have their own filters. Inside a party's signed statement, expand **Date-range account statement** for the financial ledger; existing signed-proof/payment packets stay available separately.

| View | What it answers | Relevant filters |
| --- | --- | --- |
| Overview | Gross sales/purchases, net activity after returns/cancellations, shop receipts/payments, refunds, direct transfers, GST/non-GST activity and ending dues/credits | Dates, party, GST category |
| Estimates & purchases | Original/net amounts, allocated payments, outstanding/credit and settlement status | Dates, party, GST, sale/purchase, item/photo entry, unpaid/partial/settled/credit/cancelled/overdue, staff, search |
| Payments | Who paid whom, independent customer/supplier GST categories, method, refunds, reversal and bank matching | Dates, party, either side's GST category, route, cash/UPI/bank, payment/refund, active/reversed, bank matched/unmatched, staff, reference/notes search |
| Outstanding & credits | Opening and closing customer/supplier balances without netting unrelated accounts | Dates, party, GST, due/credit/zero accounts, party search |
| Party statement | Opening balances, all period movements, running balances and closing balances | Party, dates, GST, reference/notes search |
| Daily activity | Daily original sales/purchases and changes in customer/supplier accounts | Dates, party, GST |
| Item-wise | Original entered quantities, item/part values and original GST amounts | Dates, party, GST, sale/purchase, item/name/reference search |

Presets include Today, Last 7 days, This month, Financial year (April–March), and All dates. Custom dates can select any period. Reset clears filters. Staff selection is shown to the owner using the existing account list. Staff can view reports; bulk CSV/PDF export remains owner-only.

## Date and balance semantics

Dates use **Asia/Kolkata**. From/to include the entire selected India calendar days. Blank From means the beginning; blank To means the end of today. Filters use recorded timestamps, not a date inferred from handwriting or the photo's camera metadata.

Opening balances include all movements before From. Closing balances and document settlement status include movements through To. A reversal enters the books on the reversal's recorded date: an earlier period still shows the original payment or adjustment until its reversal. Returns, cancellations, opening adjustments, refunds and their reversals are included. Allocations, credit transfers and refund allocations reconstruct document status as of To.

A direct customer-to-supplier transfer settles both accounts, possibly under different GST categories, but contributes **zero** money movement through the shop. Refunds have their own direction. Net movement by cash/UPI/bank excludes direct transfers. These are recorded movements, not live bank balances or automatic confirmation of a real transfer. A bank match is the existing owner-confirmed matching record as of To.

Customer receivables, supplier payables and credits remain separate per party and GST category. For example, one customer's ₹1,000 due and another's ₹300 credit show ₹1,000 to collect and ₹300 customer credit, not ₹700 to collect. A party that is both customer and supplier keeps separate sides.

Statement text search narrows displayed rows only; it never removes movements from opening, running or closing balances. Record-list filters select issue/record dates; overdue status checks the due date as of To. Ending balance cards describe all selected party/GST accounts; record-type, staff and payment-method filters are used only on the corresponding lists/activity, not to invent a partial party balance.

## Complete totals and exports

Reporting reads all matching financial records from the authoritative ledger projection, without the phone's 250-recent-document/500-catalog limits. Screens paginate 50 rows; financial totals are computed before pagination. CSV and PDF exports include all matches. Statement exports include opening/closing balances; summary CSV includes metric units so record counts cannot be mistaken for rupees. CSV includes a UTF-8 BOM for Hindi in Excel and neutralizes spreadsheet-formula text.

Reports show original gross values and corrections separately where appropriate. Net period sales can be negative when an older estimate is returned/cancelled during the selected period. Item quantities/values are original entered lines **before unallocated returns**; this is not a stock or cost-of-goods calculation. Photo-only estimates are included financially but excluded from item quantities. Their count/total is shown separately; even an item-name search cannot establish what items are in those photos.

Quick GST-tagged totals have no inferred CGST/SGST breakdown. These commercial estimate reports are not statutory GST returns, inventory valuation, or profit accounts. Actual profit requires stock/cost information this app does not collect.

PDFs use the selected report language for column headings and preserve Hindi names. Long text may be shortened for a readable PDF row; CSV retains full detail. Signed originals and their proof remain accessible through the existing record/statement PDF workflow.

## Deployment and checks

No new secrets or external services are required. Back up the shop before deploying the latest Git commit on Render. Startup adds the entry-mode column with default `items` for existing documents. Keep the same Atlas URI/database. New fields are preserved by MongoDB commits and encrypted backups.

Checks cover India midnight boundaries, invalid dates, totals across multiple pages, historical reversal timing, separate GST legs, refunds and method totals, bank matching as of date, credits without offsetting, item-search coverage, CSV formula safety, photo-only idempotency/validation, owner export permissions, and encrypted restoration. Browser checks cover quick entry, retained photo proof, filters, full exports, party opening/closing, and phone layout. Run `npm test` and `npm run test:mongo -- --browser`.

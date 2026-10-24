import { transaction, audit } from "./operations.js";
// Keep the organisation/settings and identities. Remove only the business book.
export const businessTables = [
  "credit_requests",
  "credit_transfers",
  "refund_allocations",
  "allocations",
  "adjustment_reversals",
  "reversals",
  "reconciliations",
  "audit",
  "payments",
  "adjustments",
  "documents",
  "parties",
  "sessions",
];
export function resetShopData(db, userId) {
  return transaction(db, () => {
    const deleted = {};
    for (const table of businessTables) {
      deleted[table] = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
      db.exec(`DELETE FROM ${table}`);
    }
    audit(db, userId, "reset-business-data", "database", 0, { deleted });
    return deleted;
  });
}

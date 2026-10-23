export function calculateItems(items, taxMode) {
  if (!["gst", "non-gst"].includes(taxMode))
    throw Error("Choose a GST category.");
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw Error("Add 1–100 items.");
  let total = 0;
  const normalized = items.map((i) => {
    const name = String(i.name || "").trim(),
      qty = Number(i.qty),
      price = Number(i.price),
      gst = taxMode === "gst" ? Number(i.gst || 0) : 0;
    if (
      typeof i.name !== "string" ||
      !name ||
      name.length > 200 ||
      !/^\d+(\.\d{1,3})?$/.test(String(i.qty)) ||
      qty <= 0 ||
      qty > 100000 ||
      !Number.isSafeInteger(price) ||
      price < 0 ||
      price > 100000000 ||
      !/^\d+(\.\d{1,2})?$/.test(String(gst)) ||
      gst < 0 ||
      gst > 100
    )
      throw Error(
        "Check item name, quantity (up to 3 decimal places), price, and GST rate.",
      );
    const milli = Math.round(qty * 1000);
    const base = Number((BigInt(milli) * BigInt(price) + 500n) / 1000n),
      tax = Number(
        (BigInt(base) * BigInt(Math.round(gst * 100)) + 5000n) / 10000n,
      );
    total += base + tax;
    return { name, qty, price, gst, base, tax, total: base + tax };
  });
  if (!Number.isSafeInteger(total) || total <= 0 || total > 100000000000)
    throw Error("Invalid document total.");
  return { items: normalized, total };
}

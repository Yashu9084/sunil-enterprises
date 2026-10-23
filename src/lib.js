export const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n / 100);
export const date = (s) =>
  new Date(s).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
export function paise(s) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(s)))
    throw Error("Enter an amount with at most two decimal places.");
  const [a, b = ""] = String(s).split(".");
  const result = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw Error("Amount is too large.");
  return result;
}
export async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw Error("Server unavailable. Check your connection and try again.");
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error("Server unavailable. Check your connection and try again.");
  }
  if (!r.ok) {
    const e = Error(d.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  return d;
}
export async function sharePdf(path, filename) {
  const r = await fetch("/api/" + path);
  if (!r.ok) throw Error("Could not create the PDF.");
  const blob = await r.blob(),
    file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  download(blob, filename);
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

import { startTestServer } from "../server/test-support.js";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
const service = await startTestServer();
let browser, page;
try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_USE_BUNDLED !== "1" &&
    existsSync("/usr/bin/chromium")
      ? { executablePath: "/usr/bin/chromium" }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(service.base);
  await page.getByRole("heading", { name: "Set up your shop" }).waitFor();
  const password = randomBytes(16).toString("hex");
  await page.getByLabel("Your name").fill("Sunil Ji");
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create shop account" }).click();
  await page
    .getByRole("heading", { name: "A clear view of your shop." })
    .waitFor();
  await page.getByRole("button", { name: "Add your first customer" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Sharma Traders");
  await page.getByRole("button", { name: "Save party" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "New estimate" }).click();
  await page
    .locator("select[name=party_id]")
    .selectOption({ label: "Sharma Traders" });
  await page.getByLabel("Item name", { exact: true }).fill("PVC pipe");
  await page.getByLabel("Quantity", { exact: true }).fill("10");
  await page.getByLabel("Unit price in rupees").fill("250");
  const canvas = page.locator("canvas");
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 50, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 150, b.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("₹2,500.00").first().waitFor();
  await page
    .getByRole("button", { name: "Record a payment", exact: false })
    .first()
    .click();
  await page.locator("select").first().selectOption("received");
  await page
    .locator("select[name=customer_id]")
    .selectOption({ label: "Sharma Traders · Due ₹2,500.00" });
  await page.getByLabel("Amount received / paid").fill("3000");
  await page.getByLabel("UPI / bank reference").fill("BROWSER-TEST");
  await page.getByRole("button", { name: "Confirm & record payment" }).click();
  await page.getByText("Amount exceeds this customer").waitFor();
  assert.equal(
    await page.getByLabel("Amount received / paid").inputValue(),
    "3000",
    "Invalid save must preserve form input",
  );
  await page.getByLabel("Amount received / paid").fill("500");
  await page.getByRole("button", { name: "Confirm & record payment" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("₹2,000.00").first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "No horizontal mobile overflow",
  );
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "Estimates" })
    .click();
  await page.getByText("SE-0001", { exact: true }).click();
  await page
    .getByAltText("Customer signature captured for this estimate")
    .waitFor();
  // Share the actual signed PDF rather than a text-only summary.
  let [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Share signed PDF", exact: true }).click(),
  ]);
  assert.ok(
    readFileSync(await download.path())
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-")),
  );
  await page
    .getByRole("button", { name: "Return / cancel", exact: true })
    .click();
  await page.getByRole("dialog").locator("input[name=amount]").fill("500");
  await page
    .getByRole("dialog")
    .locator("textarea[name=reason]")
    .fill("Returned one damaged pipe");
  await page.getByRole("button", { name: "Confirm & save adjustment" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "People" })
    .click();
  await page.getByRole("button", { name: "Add party", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Gupta Supply");
  await page
    .getByRole("dialog")
    .locator("select[name=kind]")
    .selectOption("supplier");
  await page.getByRole("button", { name: "Save party", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Add opening balance", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator("select[name=party_id]")
    .selectOption({ label: "Gupta Supply" });
  await page
    .getByRole("dialog")
    .locator("select[name=side]")
    .selectOption("payable");
  await page.getByRole("dialog").locator("input[name=amount]").fill("1000");
  await page
    .getByRole("dialog")
    .locator("textarea[name=reason]")
    .fill("Old paper ledger page 5");
  await page.getByRole("button", { name: "Confirm & save adjustment" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "Payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page
    .locator("select[name=customer_id]")
    .selectOption({ label: "Sharma Traders · Due ₹1,500.00" });
  await page
    .locator("select[name=supplier_id]")
    .selectOption({ label: "Gupta Supply · Payable ₹1,000.00" });
  await page.locator("input[name=amount]").fill("1000");
  await page.locator("input[name=reference]").fill("DIRECT-BROWSER-001");
  await page
    .getByRole("button", { name: "Confirm & record payment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  // One transfer may settle a GST sale and a non-GST purchase independently.
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "Estimates" })
    .click();
  await page.getByRole("button", { name: "Purchase", exact: true }).click();
  await page
    .locator("select[name=party_id]")
    .selectOption({ label: "Gupta Supply" });
  await page
    .getByLabel("Item name", { exact: true })
    .fill("Cross-category purchase");
  await page.getByLabel("Unit price in rupees").fill("200");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await page
    .locator("select[name=party_id]")
    .selectOption({ label: "Sharma Traders" });
  await page.getByLabel("Item name", { exact: true }).fill("GST sale");
  await page.getByLabel("Unit price in rupees").fill("100");
  await page
    .getByRole("button", { name: "GST / GST सहित", exact: true })
    .click();
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const signBox = await page.locator("canvas").boundingBox();
  await page.mouse.move(signBox.x + 40, signBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(signBox.x + 150, signBox.y + 65, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "Payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page
    .locator(".modal .segmented")
    .nth(0)
    .getByRole("button", { name: "GST / GST सहित", exact: true })
    .click();
  await page
    .locator(".modal .segmented")
    .nth(1)
    .getByRole("button", { name: "Non-GST / बिना GST", exact: true })
    .click();
  await page
    .locator("select[name=customer_id]")
    .selectOption({ label: "Sharma Traders · Due ₹118.00" });
  await page
    .locator("select[name=supplier_id]")
    .selectOption({ label: "Gupta Supply · Payable ₹200.00" });
  await page.locator("input[name=amount]").fill("50");
  await page.locator("input[name=reference]").fill("CROSS-CATEGORY-001");
  await page
    .getByRole("button", { name: "Confirm & record payment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const crossState = await (
    await page.request.get(service.base + "/api/state")
  ).json();
  assert.equal(
    crossState.parties.find((p) => p.name === "Sharma Traders").balances.gst
      .receivable,
    6800,
  );
  assert.equal(
    crossState.parties.find((p) => p.name === "Gupta Supply").balances[
      "non-gst"
    ].payable,
    15000,
  );
  assert.equal(
    crossState.parties.find((p) => p.name === "Gupta Supply").balances.gst
      .payable,
    0,
  );
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "People" })
    .click();
  await page
    .locator(".party-card")
    .filter({ hasText: "Sharma Traders" })
    .click();
  await page.getByAltText("Signature for SE-0001").waitFor();
  [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Share / download PDF", exact: true })
      .click(),
  ]);
  assert.ok(
    readFileSync(await download.path())
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-")),
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Encrypted backup", exact: true })
    .click();
  const passphrase = randomBytes(16).toString("hex");
  await page.locator("input[name=current_password]").fill(password);
  await page.locator("input[name=passphrase]").fill(passphrase);
  [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Download encrypted backup", exact: true })
      .click(),
  ]);
  const backupFile = await download.path();
  assert.ok(
    readFileSync(backupFile).subarray(0, 11).equals(Buffer.from("SUNILKHATA1")),
  );
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles(backupFile);
  await page.locator("input[name=current_password]").fill(password);
  await page.locator("input[name=passphrase]").fill(passphrase);
  await page
    .getByRole("button", { name: "Check backup first", exact: true })
    .click();
  await page.getByRole("heading", { name: "Backup contents" }).waitFor();
  await page.locator("input[name=confirmation]").fill("RESTORE");
  await page
    .getByRole("button", { name: "Replace records & restore", exact: true })
    .click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "Overview" })
    .click();
  await page.getByText("₹568.00", { exact: true }).first().waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));

  await page.getByRole("button", { name: "हिंदी", exact: true }).click();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "एक नज़र" })
    .click();
  await page
    .getByRole("heading", { name: "आपकी दुकान का पूरा हिसाब।" })
    .waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  assert.ok(
    await page.evaluate(
      () =>
        navigator.serviceWorker.controller ||
        navigator.serviceWorker.getRegistration(),
    ),
  );
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "दुकान खोलने के लिए इंटरनेट जोड़ें" })
    .waitFor();
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "फिर कोशिश करें" }).click();
  await page
    .getByRole("heading", { name: "आपकी दुकान का पूरा हिसाब।" })
    .waitFor();
  console.log(
    "Browser smoke passed: owner onboarding, party creation, signed estimate, validation preserving input, partial, direct and cross-GST payments, returns, opening balances, signed PDFs, encrypted backup and UI restoration, mobile layout, Hindi navigation, service worker registration.",
  );
  await browser.close();
} catch (error) {
  console.error(
    "Dialog at failure:",
    await page
      ?.locator("[role=dialog]")
      .innerText()
      .catch(() => "none"),
  );
  await page
    ?.screenshot({ path: "/tmp/sunil-browser-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await service.close();
}

import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { startTestServer } from "../server/test-support.js";
const service = await startTestServer({ OPENAI_API_KEY: "" });
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
  page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(service.base);
  await page.getByLabel("Your name").fill("Report owner");
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-enough-password");
  await page.getByRole("button", { name: "Create shop account" }).click();
  await page.getByRole("button", { name: "Add your first customer" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Quick customer");
  await page.getByRole("button", { name: "Save party" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "New estimate" }).click();
  await page
    .locator("select[name=party_id]")
    .selectOption({ label: "Quick customer" });
  await page
    .getByRole("button", { name: "Photo + total", exact: true })
    .click();
  assert.equal(await page.getByLabel("Item name", { exact: true }).count(), 0);
  await page.getByLabel("Final total in rupees").fill("760.00");
  const photo = await sharp({
    create: { width: 100, height: 160, channels: 3, background: "#efeee0" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Estimate photo", { exact: true }).setInputFiles({
    name: "signed-estimate.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Estimates & purchases", exact: true })
    .click();
  await page.getByLabel("Entry method", { exact: true }).selectOption("photo");
  await page
    .getByRole("cell", { name: "₹760.00", exact: false })
    .first()
    .waitFor();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  const report = page.locator("section.reports");
  await report.getByText("₹760.00", { exact: true }).first().waitFor();
  await report
    .locator(".report-tabs")
    .getByRole("button", { name: "Estimates & purchases", exact: true })
    .click();
  await report
    .getByLabel("Entry method", { exact: true })
    .selectOption("photo");
  await report
    .getByRole("cell", { name: "Photo + total", exact: true })
    .waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    report
      .getByRole("link", { name: "Download CSV (all matches)", exact: true })
      .click(),
  ]);
  const csv = readFileSync(await download.path(), "utf8");
  assert.match(csv, /760\.00/);
  assert.match(csv, /photo/);
  const href = await report
    .getByRole("link", { name: "Download report PDF", exact: true })
    .getAttribute("href");
  const pdf = await page.request.get(service.base + href);
  assert.equal(pdf.status(), 200);
  assert.ok((await pdf.body()).subarray(0, 4).equals(Buffer.from("%PDF")));
  await report
    .locator(".report-tabs")
    .getByRole("button", { name: "Party statement", exact: true })
    .click();
  await report
    .getByLabel("Report party")
    .selectOption({ label: "Quick customer" });
  await report
    .getByText(/Customer opening → closing/)
    .first()
    .waitFor();
  assert.match(await report.innerText(), /₹0\.00 → ₹760\.00/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).click();
  await page.locator(".reset-shop summary").click();
  await page.getByLabel("Current owner password", { exact: true }).fill("long-enough-password");
  await page.getByLabel("Type DELETE SHOP DATA", { exact: true }).fill("DELETE SHOP DATA");
  await page.getByRole("button", { name: "Delete all business records", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "A clear view of your shop." }).waitFor();
  const cleared = await (await page.request.get(service.base + "/api/state")).json();
  assert.equal(cleared.parties.length, 0);
  assert.equal(cleared.documents.length, 0);
  assert.equal(cleared.payments.length, 0);
  assert.equal(cleared.user.name, "Report owner");
  assert.deepEqual(errors, []);
  console.log(
    "Quick/report browser passed: photo + total without items or AI, saved proof, entry filters, full CSV/PDF exports, opening/closing statement and phone layout.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({
      path: "/tmp/sunil-report-error.png",
      fullPage: true,
    });
    console.error((await page.locator("body").innerText()).slice(-3500));
  }
  throw error;
} finally {
  await browser?.close();
  await service.close();
}

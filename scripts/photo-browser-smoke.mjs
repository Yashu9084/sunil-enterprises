import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { startTestServer } from "../server/test-support.js";
const service = await startTestServer({
  OPENAI_API_KEY: "test-browser-placeholder",
});
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
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const image = await sharp({
    create: { width: 200, height: 300, channels: 3, background: "#eeeedd" },
  })
    .png()
    .toBuffer();
  const source = "data:image/png;base64," + image.toString("base64");
  let scans = 0;
  await page.route("**/api/estimates/extract", (route) => {
    scans++;
    return route.fulfill({
      json: {
        items: [
          {
            raw_text: "4 बेयरिंग 32211 ×190 760",
            name: "बेयरिंग 32211",
            qty: "4",
            price: "190.00",
            gst: "0",
            line_amount: 76000,
            computed_total: 76000,
            uncertain_fields: ["name"],
            notes: "Check the part number",
          },
          {
            raw_text: "2 पिस्टन 87 — rate unclear",
            name: "पिस्टन 87",
            qty: "2",
            price: "",
            gst: "0",
            line_amount: 80000,
            computed_total: null,
            uncertain_fields: ["unit_price"],
            notes: "Rate is unclear",
          },
        ],
        written_total: 160000,
        calculated_total: null,
        warnings: ["Check all rows"],
        source_photo: source,
      },
    });
  });
  await page.goto(service.base);
  await page.getByLabel("Your name").fill("Owner");
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-enough-password");
  await page.getByRole("button", { name: "Create shop account" }).click();
  await page.getByRole("button", { name: "Add your first customer" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Photo customer");
  await page.getByRole("button", { name: "Save party" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "New estimate" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('select[name="party_id"]')
    .selectOption({ label: "Photo customer" });
  // Existing manually entered items must survive import.
  await page.getByLabel("Item name", { exact: true }).fill("Existing washer");
  await page.getByLabel("Unit price in rupees", { exact: true }).fill("10");
  await page
    .locator("summary")
    .filter({ hasText: "Read items from a photo" })
    .click();
  await page
    .getByLabel("Photo to read items")
    .setInputFiles({ name: "list.png", mimeType: "image/png", buffer: image });
  await page
    .getByRole("button", { name: "Read this photo", exact: true })
    .click();
  await page.getByLabel("Scanned item 1", { exact: true }).waitFor();
  assert.equal(scans, 1);
  const apply = page.getByRole("button", {
    name: "Add checked items to estimate",
  });
  assert.equal(await apply.isDisabled(), true);
  assert.equal(
    await page.getByLabel("Checked scanned line 2").isDisabled(),
    true,
  );
  await page.getByLabel("Scanned rate 2").fill("400");
  await page.getByLabel("Checked scanned line 1").check();
  await page.getByLabel("Checked scanned line 2").check();
  assert.equal(await apply.isDisabled(), true); // Written total differs: 1600 versus 1560.
  await page
    .getByText(
      "I checked the difference. Use the calculated total from these items.",
    )
    .click();
  assert.equal(await apply.isEnabled(), true);
  // Any edit revokes that row's review and total acknowledgement.
  await page
    .getByLabel("Scanned item 1", { exact: true })
    .fill("बेयरिंग 32211 checked");
  assert.equal(
    await page.getByLabel("Checked scanned line 1").isChecked(),
    false,
  );
  assert.equal(await apply.isDisabled(), true);
  await page.getByLabel("Checked scanned line 1").check();
  await page
    .getByText(
      "I checked the difference. Use the calculated total from these items.",
    )
    .click();
  await apply.click();
  assert.deepEqual(
    await page
      .getByLabel("Item name", { exact: true })
      .evaluateAll((nodes) => nodes.map((n) => n.value)),
    ["Existing washer", "बेयरिंग 32211 checked", "पिस्टन 87"],
  );
  // Source photo does not replace the separate customer-signature requirement.
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const visible = await canvas.boundingBox();
  await page.mouse.move(visible.x + 20, visible.y + 30);
  await page.mouse.down();
  await page.mouse.move(visible.x + 100, visible.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const response = await page.request.get(service.base + "/api/state");
  const state = await response.json();
  assert.equal(state.documents.length, 1);
  const record = await (
    await page.request.get(
      service.base + "/api/documents/" + state.documents[0].id,
    )
  ).json();
  assert.ok(record.source_photo.startsWith("data:image/jpeg;base64,"));
  assert.ok(record.signature);
  assert.equal(record.total, 157000);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Photo workflow passed: review gates, blank rate correction, total mismatch acknowledgement, append without losing items, signed save and retained source photo on phone layout. AI response mocked; no API charges.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({
      path: "/tmp/sunil-photo-error.png",
      fullPage: true,
    });
    console.error((await page.locator("body").innerText()).slice(0, 3000));
  }
  throw error;
} finally {
  await browser?.close();
  await service.close();
}

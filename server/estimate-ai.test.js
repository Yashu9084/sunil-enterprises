import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  extractEstimate,
  validateExtraction,
  decimalPaise,
} from "./estimate-ai.js";
import { startTestServer } from "./test-support.js";
const row = (overrides = {}) => ({
  raw_text: "4 बेयरिंग 32211 ×190 760",
  name: "बेयरिंग 32211",
  quantity: "4",
  unit_price: "190",
  line_amount: "760",
  gst_rate: null,
  uncertain_fields: [],
  notes: "",
  ...overrides,
});
const page = (items = [row()], written_total = "760") => ({
  items,
  written_total,
  warnings: [],
});

test("handwritten quantities, unit rates and part numbers remain separate and arithmetic mismatches are flagged", () => {
  assert.equal(decimalPaise("190.05"), 19005);
  assert.equal(decimalPaise("190.005"), null);
  const good = validateExtraction(page(), "non-gst");
  assert.equal(good.items[0].name, "बेयरिंग 32211");
  assert.equal(good.items[0].qty, "4");
  assert.equal(good.items[0].price, "190.00");
  assert.equal(good.calculated_total, 76000);
  assert.equal(good.warnings.length, 0);
  const bad = validateExtraction(
    page([row({ unit_price: "760" })], "800"),
    "non-gst",
  );
  assert.ok(bad.items[0].uncertain_fields.includes("line_amount"));
  assert.ok(bad.warnings.some((w) => w.includes("written amount")));
  assert.ok(bad.warnings.some((w) => w.includes("page total")));
});
test("unreadable amounts stay blank rather than becoming zero, quantity one or an inferred rate", () => {
  const missing = validateExtraction(
    page(
      [row({ name: "", quantity: null, unit_price: null, line_amount: "800" })],
      null,
    ),
    "gst",
  );
  assert.equal(missing.items[0].qty, "");
  assert.equal(missing.items[0].price, "");
  assert.equal(missing.items[0].gst, "");
  assert.equal(missing.calculated_total, null);
  assert.deepEqual(missing.items[0].uncertain_fields.sort(), [
    "gst_rate",
    "name",
    "quantity",
    "unit_price",
  ]);
});
test("vision request uses structured output, explicit no-storage, spelling-only context and sanitized errors", async () => {
  const image =
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 80, height: 80, channels: 3, background: "white" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  let calls = 0;
  const result = await extractEstimate({
    image,
    mode: "non-gst",
    catalog: ["Bearing 32211"],
    apiKey: "test-private-key",
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.input[1].content[1].detail, "high");
      assert.ok(
        body.input[1].content[1].image_url.startsWith(
          "data:image/jpeg;base64,",
        ),
      );
      assert.match(body.input[1].content[0].text, /Bearing 32211/);
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: [
            {
              content: [{ type: "output_text", text: JSON.stringify(page()) }],
            },
          ],
        }),
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.items[0].price, "190.00");
  await assert.rejects(
    extractEstimate({
      image,
      mode: "non-gst",
      apiKey: "test-private-key",
      fetcher: async () => ({ ok: false, status: 401 }),
    }),
    (error) =>
      !error.message.includes("test-private-key") &&
      error.message.includes("configured correctly"),
  );
  await assert.rejects(
    extractEstimate({
      image: "data:image/png;base64,aGVsbG8=",
      mode: "non-gst",
      apiKey: "test",
      fetcher: async () => {
        throw Error("must not call upstream");
      },
    }),
    /damaged/,
  );
});
test("AI reading requires authentication and configuration, and source lists alone cannot authorize a sale", async () => {
  const service = await startTestServer({ OPENAI_API_KEY: "" });
  let cookie = "";
  async function api(path, body) {
    const r = await fetch(service.base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  try {
    assert.equal(
      (await api("estimates/extract", { image: "x", tax_mode: "non-gst" }))
        .status,
      401,
    );
    await api("setup", {
      name: "Owner",
      username: "owner",
      password: "long-enough-password",
    });
    await api("login", { username: "owner", password: "long-enough-password" });
    assert.equal(
      (await api("estimates/extract", { image: "x", tax_mode: "non-gst" }))
        .status,
      503,
    );
    const party = await (
      await api("parties", { name: "Customer", kind: "customer" })
    ).json();
    const image =
      "data:image/png;base64," +
      (
        await sharp({
          create: { width: 80, height: 80, channels: 3, background: "white" },
        })
          .png()
          .toBuffer()
      ).toString("base64");
    const draft = {
      kind: "sale",
      tax_mode: "non-gst",
      party_id: party.id,
      items: [{ name: "बेयरिंग 32211", qty: 4, price: 19000, gst: 0 }],
      source_photo: image,
      request_id: "scan-signed-proof-01",
    };
    const unsigned = await api("documents", draft);
    assert.equal(unsigned.status, 400);
    assert.match((await unsigned.json()).error, /signature/);
    const saved = await (
      await api("documents", { ...draft, signature: image })
    ).json();
    const original = await (await api("documents/" + saved.id)).json();
    assert.ok(original.source_photo.startsWith("data:image/jpeg;base64,"));
    assert.equal(original.total, 76000);
    const repeat = await (
      await api("documents", { ...draft, signature: image })
    ).json();
    assert.equal(repeat.id, saved.id);
  } finally {
    await service.close();
  }
});

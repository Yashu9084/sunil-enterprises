import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { durableApi } from "./durable-api.js";

test("API withholds success and cookies until durable commit, then fails closed and refreshes after an error", async () => {
  let cached = 0,
    durable = 0,
    dirty = false,
    fail = false;
  let enterCommit, allowCommit;
  const entered = new Promise((resolve) => {
    enterCommit = resolve;
  });
  const gate = new Promise((resolve) => {
    allowCommit = resolve;
  });
  const store = {
    async refresh() {
      if (dirty) {
        cached = durable;
        dirty = false;
      }
    },
    invalidate() {
      dirty = true;
    },
    async persist() {
      enterCommit();
      await gate;
      if (fail) throw Error("Private database details must never leak");
      durable = cached;
    },
  };
  const app = express();
  app.use(durableApi(store));
  app.post("/", (req, res) => {
    cached++;
    res.cookie("session", "private");
    res.json({ count: cached });
  });
  app.get("/", (req, res) => res.json({ count: cached }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    let received = false;
    const pending = fetch(base, { method: "POST" }).then((response) => {
      received = true;
      return response;
    });
    await entered;
    assert.equal(received, false);
    assert.equal(durable, 0);
    allowCommit();
    const saved = await pending;
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("set-cookie"), "session=private; Path=/");
    assert.deepEqual(await saved.json(), { count: 1 });
    assert.equal(durable, 1);
    fail = true;
    const failed = await fetch(base, { method: "POST" });
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("set-cookie"), null);
    assert.doesNotMatch(await failed.text(), /Private database details/);
    assert.equal(durable, 1);
    assert.deepEqual(await (await fetch(base)).json(), { count: 1 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an authorized photo reader can release the projection while AI is pending, without persisting any ledger changes", async () => {
  let reading, complete;
  const started = new Promise((resolve) => {
    reading = resolve;
  });
  const gate = new Promise((resolve) => {
    complete = resolve;
  });
  const store = {
    async refresh() {},
    async persist() {
      throw Error("Photo extraction must not write the ledger");
    },
  };
  const app = express();
  app.use("/api", durableApi(store));
  app.post("/api/estimates/extract", async (req, res) => {
    req.releaseProjection();
    reading();
    await gate;
    res.json({ draft: true });
  });
  app.get("/api/state", (req, res) => res.json({ available: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const pending = fetch(base + "/api/estimates/extract", { method: "POST" });
    await started;
    const state = await fetch(base + "/api/state", {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(state.status, 200);
    assert.deepEqual(await state.json(), { available: true });
    complete();
    assert.deepEqual(await (await pending).json(), { draft: true });
  } finally {
    complete();
    await new Promise((resolve) => server.close(resolve));
  }
});

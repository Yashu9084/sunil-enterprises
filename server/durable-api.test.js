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

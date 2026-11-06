import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The scheduled functions are the punctual trigger for the whole product, so
 * their dispatch contract is worth pinning. They are plain ESM with a global
 * `fetch`, which makes them testable without a Netlify runtime.
 */

const LIB = new URL("../../netlify/lib/dispatch-scan.mjs", import.meta.url);

async function loadLib() {
  // Cache-bust so each test gets a fresh module instance (the token is read per
  // call, but CONFIG is module state).
  return import(`${LIB.href}?t=${Math.random()}`);
}

test("dispatchScan posts the window in client_payload", async () => {
  process.env.GITHUB_DISPATCH_TOKEN = "t";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status: 204, ok: true };
  };

  const { dispatchScan } = await loadLib();
  const result = await dispatchScan("03:30");

  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/actions\/workflows\/scan\.yml\/dispatches$/);

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ref, "main");
  // Without this the workflow cannot attribute the run to a window.
  assert.equal(body.client_payload.window, "03:30");
  assert.equal(body.client_payload.source, "netlify-schedule");
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);
});

test("dispatchScan does not retry a configuration error", async () => {
  process.env.GITHUB_DISPATCH_TOKEN = "t";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { status: 401, ok: false, json: async () => ({ message: "Bad credentials" }) };
  };

  const { dispatchScan } = await loadLib();
  const result = await dispatchScan("03:30", { attempts: 3 });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(calls, 1, "401 must not be retried");
});

test("dispatchScan fails loudly when the token is missing", async () => {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };

  const { runScheduledWindow } = await loadLib();
  await assert.rejects(() => runScheduledWindow("10:30"), /GITHUB_DISPATCH_TOKEN/);
});

test("runScheduledWindow throws when the dispatch fails", async () => {
  process.env.GITHUB_DISPATCH_TOKEN = "t";
  globalThis.fetch = async () => ({ status: 500, ok: false });

  const { runScheduledWindow } = await loadLib();
  // A silent failure here is how the original cron drift went unnoticed.
  await assert.rejects(() => runScheduledWindow("10:30"), /dispatch failed/);
});

test("the scheduled function modules declare the configured windows", () => {
  const fns = new URL("../../netlify/functions/", import.meta.url);
  const morning = readFileSync(new URL("scheduled-scan-morning.mjs", fns), "utf8");
  const evening = readFileSync(new URL("scheduled-scan-evening.mjs", fns), "utf8");
  assert.match(morning, /schedule: "30 3 \* \* 1-5"/);
  assert.match(evening, /schedule: "30 10 \* \* 1-5"/);
});

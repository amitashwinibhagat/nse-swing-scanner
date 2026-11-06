import { test } from "node:test";
import assert from "node:assert/strict";

import { summarizeLabel, summarizeTrades, tradeStatus } from "./trades.js";

/**
 * Regression suite for the bug that white-screened the dashboard:
 * a trade saved with `shares: 0` produced `{pnlAbs: 0, pnlPct: null}`, and the
 * journal header did `summary.pnlPct.toFixed(1)` unguarded.
 */

const priced = { ABC: 110 };

test("a zero-share trade yields null P&L instead of a half-populated object", () => {
  const s = summarizeTrades(
    [{ symbol: "ABC", entry: 100, shares: 0, stop: 90, target: 120 }],
    priced,
  );
  assert.equal(s.priced, 1);
  assert.equal(s.invested, 0);
  assert.equal(s.pnlAbs, null, "pnlAbs must be null when nothing was invested");
  assert.equal(s.pnlPct, null);
});

test("the journal header can always render a string", () => {
  const zero = summarizeTrades([{ symbol: "ABC", entry: 100, shares: 0 }], priced);
  assert.equal(typeof summarizeLabel(zero), "string");

  const normal = summarizeTrades([{ symbol: "ABC", entry: 100, shares: 10 }], priced);
  assert.equal(normal.pnlPct, 10);
  assert.equal(summarizeLabel(normal), null);
});

test("unpriced symbols are counted, never silently dropped", () => {
  const s = summarizeTrades(
    [
      { symbol: "ABC", entry: 100, shares: 10 },
      { symbol: "MISSING", entry: 50, shares: 5 },
    ],
    priced,
  );
  assert.equal(s.count, 2);
  assert.equal(s.priced, 1);
  assert.equal(s.unpriced, 1);
  assert.equal(s.pnlAbs, 100);
});

test("no trades at all is a valid, labelled state", () => {
  const s = summarizeTrades([], {});
  assert.equal(s.count, 0);
  assert.equal(s.pnlAbs, null);
  assert.equal(summarizeLabel(s), "No trades");
});

test("tradeStatus reports stop and target before open", () => {
  const trade = { symbol: "ABC", entry: 100, shares: 10, stop: 95, target: 120 };
  assert.equal(tradeStatus(trade, 94).state, "stopped");
  assert.equal(tradeStatus(trade, 121).state, "target");
  assert.equal(tradeStatus(trade, 105).state, "open");
  assert.equal(tradeStatus(trade, null).state, "unpriced");
});

test("R-multiple is measured against the entry-to-stop risk", () => {
  const trade = { symbol: "ABC", entry: 100, shares: 10, stop: 90, target: 130 };
  const st = tradeStatus(trade, 120);
  assert.equal(st.rMultiple, 2);
});

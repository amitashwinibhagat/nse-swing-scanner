import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeStale,
  formatScanTimestamp,
  joinLabels,
  normalizeScan,
  sourceHealthOf,
  topBandClaim,
  topBandEvidence,
  unverifiedGateLabels,
} from "./scanData.js";

/**
 * These encode the payload/UX assumptions that used to fail silently:
 * an unvalidated `stocks` array (blank page), a hardcoded "measured edge"
 * claim, a date/time formatted in two different zones, and a 30-minute
 * staleness grace that fired every trading day.
 */

const row = (symbol, over = {}) => ({ symbol, gate_pass: false, ...over });

test("normalizeScan rejects payloads that would crash the render", () => {
  for (const bad of [null, undefined, "nope", {}, { stocks: null }, { stocks: [] }]) {
    const res = normalizeScan(bad);
    assert.equal(res.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(typeof res.reason, "string");
  }
});

test("normalizeScan rejects a stocks array with no usable rows", () => {
  assert.equal(normalizeScan({ stocks: [null, {}, { symbol: "" }] }).ok, false);
});

test("normalizeScan drops unusable rows and backfills counters", () => {
  const res = normalizeScan({
    generated_at: "2026-11-05T11:19:00+00:00",
    stocks: [row("A", { gate_pass: true }), null, row("B")],
  });
  assert.equal(res.ok, true);
  assert.equal(res.scan.stocks.length, 2);
  assert.equal(res.scan.universe_size, 2);
  assert.equal(res.scan.gate_pass_count, 1);
});

test("normalizeScan keeps existing counters when they are sane", () => {
  const res = normalizeScan({ universe_size: 501, gate_pass_count: 7, stocks: [row("A")] });
  assert.equal(res.scan.universe_size, 501);
  assert.equal(res.scan.gate_pass_count, 7);
});

test("sourceHealthOf reports an outage when a fail-closed gate is degraded", () => {
  const health = sourceHealthOf(
    { source_health: { critical_source_failed: true, degraded_gates: ["corporate_actions"] } },
    null,
  );
  assert.equal(health.critical, true);
  assert.deepEqual(health.degraded, ["corporate_actions"]);
  assert.equal(health.known, true);
});

test("sourceHealthOf is tolerant of an older payload without source_health", () => {
  const health = sourceHealthOf({ stocks: [] }, { source_health: { critical_source_failed: true } });
  assert.equal(health.critical, true, "falls back to scan_status.json");
  assert.equal(sourceHealthOf({}, {}).known, false);
});

test("joinLabels reads like a sentence", () => {
  assert.equal(joinLabels(["corporate_actions"]), "corporate actions");
  assert.equal(
    joinLabels(["corporate_actions", "surveillance"]),
    "corporate actions and surveillance (T-group / ASM / GSM)",
  );
  assert.equal(joinLabels([]), "");
});

test("topBandEvidence refuses to claim an edge the data does not show", () => {
  const negative = {
    windows: { "T+5": { buckets: { "63+": { n: 1025, mean: -0.26, ci95: { low: -0.54, high: 0.02 } } } } },
  };
  assert.equal(topBandEvidence(negative).established, false);

  const positive = {
    windows: { "T+5": { buckets: { "63+": { n: 96, mean: 3.76, ci95: { low: 2.56, high: 4.95 } } } } },
  };
  assert.equal(topBandEvidence(positive).established, true);

  // A positive CI on a tiny cohort is not evidence either.
  const tiny = {
    windows: { "T+5": { buckets: { "63+": { n: 5, mean: 4.0, ci95: { low: 0.5, high: 8.0 } } } } },
  };
  assert.equal(topBandEvidence(tiny).established, false);

  assert.equal(topBandEvidence(null).established, false);
});

test("topBandClaim never asserts an edge without evidence", () => {
  const negative = {
    windows: { "T+5": { buckets: { "63+": { n: 1025, mean: -0.26, ci95: { low: -0.54, high: 0.02 } } } } },
  };
  const claim = topBandClaim(negative);
  assert.match(claim, /no established edge/);
  assert.doesNotMatch(claim, /edge vs the Nifty/);

  assert.match(topBandClaim(null), /tracker loading/);
  assert.match(topBandClaim(null, "HTTP 404"), /tracker unavailable \(HTTP 404\)/);
  assert.match(topBandClaim({ windows: {} }), /no closed outcomes/);
});

test("computeStale honours the server's measured grace period", () => {
  const status = {
    next_expected_utc: "2026-11-06T03:30:00+00:00",
    stale_after_minutes: 480,
  };
  // 11:19 UTC = the normal morning run; still inside the measured grace.
  const atRun = Date.parse("2026-11-06T11:19:00+00:00");
  assert.equal(computeStale(null, status, atRun), false);
  // 12:00 UTC = 8.5 h after the window; past grace.
  assert.equal(computeStale(null, status, Date.parse("2026-11-06T12:00:00+00:00")), true);
});

test("computeStale falls back to a documented default without a grace field", () => {
  const status = { next_expected_utc: "2026-11-06T03:30:00+00:00" };
  assert.equal(computeStale(null, status, Date.parse("2026-11-06T05:00:00+00:00")), false);
  assert.equal(computeStale(null, status, Date.parse("2026-11-06T13:00:00+00:00")), true);
});

test("computeStale tolerates a missing scan_status.json", () => {
  // 2 h old, no status: not stale.
  assert.equal(
    computeStale("2026-11-06T10:00:00+00:00", null, Date.parse("2026-11-06T12:00:00+00:00")),
    false,
  );
  // 2 days old, no status: stale.
  assert.equal(
    computeStale("2026-11-04T10:00:00+00:00", null, Date.parse("2026-11-06T12:00:00+00:00")),
    true,
  );
});

test("scan timestamps are formatted in one timezone", () => {
  // 03:30 UTC is 09:00 IST on the SAME calendar day.
  assert.equal(formatScanTimestamp("2026-11-06T03:30:00Z"), "06 Nov · 09:00 am IST");
  // 20:30 UTC is 02:00 IST the NEXT day — date and time must agree.
  assert.equal(formatScanTimestamp("2026-11-05T20:30:00Z"), "06 Nov · 02:00 am IST");
  assert.equal(formatScanTimestamp("not-a-date"), "");
});

test("unverifiedGateLabels names gates that were skipped, not checked", () => {
  assert.deepEqual(unverifiedGateLabels({ unverified_gates: [] }), []);
  assert.deepEqual(
    unverifiedGateLabels({ unverified_gates: ["corporate_actions_unverified"] }),
    ["corporate actions"],
  );
  assert.deepEqual(
    unverifiedGateLabels({
      unverified_gates: ["corporate_actions_unverified", "holdings_conviction_unverified"],
    }),
    ["corporate actions", "shareholding (Screener.in)"],
  );
  // A payload from before the field existed must not blow up.
  assert.deepEqual(unverifiedGateLabels({}), []);
  assert.deepEqual(unverifiedGateLabels(null), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY_STATES,
  computeEntryState,
  entryAction,
  evaluatePlanState,
  planAction,
  relativeStrengthFactor,
  relativeStrengthPenalty,
  scoredOnCount,
  SCORE_KEY_TOTAL,
  exitWarnings,
} from "./scanPlan.js";

/**
 * The scanner anchors the plan to its own close: `entry_zone_high` IS
 * `current_price`. So evaluating a *fresh* row can only ever say "in zone" —
 * which is what the card's action banner used to do for every pick, every day.
 * These tests pin the honest behaviour (plan from a prior snapshot vs today's
 * price) and the honest fallback labelling.
 */

const PLAN = {
  entry_zone_low: 96,
  entry_zone_high: 100,
  stop_loss: 94,
  target_1: 106,
  target_2: 110,
};

test("a fresh row is structurally always 'in zone'", () => {
  const fresh = { ...PLAN, current_price: 100 };
  assert.equal(computeEntryState(fresh).state, ENTRY_STATES.IN_ZONE);
});

test("a prior plan evaluated against a later price can be any state", () => {
  assert.equal(evaluatePlanState(PLAN, 97).state, ENTRY_STATES.IN_ZONE);
  assert.equal(evaluatePlanState(PLAN, 92).state, ENTRY_STATES.STOPPED);
  assert.equal(evaluatePlanState(PLAN, 104).state, ENTRY_STATES.EXTENDED);
  assert.equal(evaluatePlanState(PLAN, 108).state, ENTRY_STATES.AT_T1);
  assert.equal(evaluatePlanState(PLAN, 112).state, ENTRY_STATES.AT_T2);
  assert.equal(evaluatePlanState(PLAN, 95).state, ENTRY_STATES.BELOW_ZONE);
});

test("evaluatePlanState rejects an incomplete plan or a bad price", () => {
  assert.equal(evaluatePlanState({}, 100), null);
  assert.equal(evaluatePlanState(PLAN, null), null);
  assert.equal(evaluatePlanState(null, 100), null);
});

test("planAction marks its basis so the UI can be honest about it", () => {
  const withPrior = planAction({ ...PLAN, current_price: 108 }, PLAN);
  assert.equal(withPrior.basis, "prior_plan");
  assert.equal(withPrior.label, "At target 1");

  const planOnly = planAction({ ...PLAN, current_price: 100 }, null);
  assert.equal(planOnly.basis, "plan_only");
  assert.equal(planOnly.label, "In the buy zone");
});

test("entryAction is a thin wrapper with no duplicated copy drift", () => {
  const fresh = { ...PLAN, current_price: 100 };
  const { basis, ...fromPlanAction } = planAction(fresh, null);
  assert.equal(basis, "plan_only");
  assert.deepEqual(entryAction(fresh), fromPlanAction);
});

test("relativeStrengthPenalty mirrors the backend additive thresholds", () => {
  // Points subtracted, not a multiplier: a multiplier capped the top score.
  assert.equal(relativeStrengthPenalty(-20, -5), 15);   // delta -15 -> hard
  assert.equal(relativeStrengthPenalty(-8, -2), 8);     // delta -6  -> mild
  assert.equal(relativeStrengthPenalty(-4, -1), 0);
  assert.equal(relativeStrengthPenalty(-6, -6), 0);     // no bonus any more
  assert.equal(relativeStrengthPenalty(null, -1), 0);
});

test("relativeStrengthFactor is display-only and never exceeds 1", () => {
  assert.equal(relativeStrengthFactor(-4, -1), 1.0);
  assert.ok(relativeStrengthFactor(-20, -5) < 1.0);
  assert.ok(relativeStrengthFactor(-8, -2) < 1.0);
  // The retired x1.05 bonus must not be reproduced.
  assert.equal(relativeStrengthFactor(-6, -6), 1.0);
});

test("scoredOnCount tracks the six live weighted components", () => {
  // support_proximity was retired in weights-2026-11-v2; SCORE_KEYS must not
  // still count it, or every row looks permanently under-scored.
  const sub = {
    valuation_compression: 1,
    oversold_positioning: 1,
    drawdown_sweetspot: 1,
    volume_capitulation: 1,
    quality_composite: 1,
    conviction_holding: 1,
  };
  assert.equal(SCORE_KEY_TOTAL, 6);
  assert.equal(scoredOnCount(sub), 6);
  assert.equal(scoredOnCount({ ...sub, conviction_holding: null }), 5);
  assert.equal(scoredOnCount(null), 0);
  // A retired key present in an old payload must not inflate the count.
  assert.equal(scoredOnCount({ ...sub, support_proximity: 1 }), 6);
});

test("exitWarnings needs a full 63-session swing high, not a 21-session one", () => {
  const capped = exitWarnings({
    entry_zone_high: 100,
    target_1: 120,
    swing_high_63d: 108,
    atr_expansion_ratio: 1.0,
  });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].key, "t1_capped");

  const expanding = exitWarnings({
    entry_zone_high: 100,
    target_1: 120,
    swing_high_63d: 130,
    atr_expansion_ratio: 1.5,
  });
  assert.equal(expanding.length, 1);
  assert.equal(expanding[0].key, "atr_expanding");
});

// --- shortlist fallback -----------------------------------------------------
// The default view is `gate_pass && score >= 63`. When nothing clears that band
// the page used to be empty even though names had passed every gate. These pin
// the split the fallback relies on.

import { TOP_PICK_MIN_SCORE, splitShortlist } from "./picks.js";

test("splitShortlist separates evidenced picks from on-deck passes", () => {
  const stocks = [
    { symbol: "TOP", gate_pass: true, swing_score: 81 },
    { symbol: "DECK", gate_pass: true, swing_score: 66 },
    { symbol: "LOW", gate_pass: true, swing_score: 34 },
    { symbol: "FAIL", gate_pass: false, swing_score: 88 },
  ];
  const s = splitShortlist(stocks);
  assert.deepEqual(s.topPicks.map((x) => x.symbol), ["TOP"]);
  assert.deepEqual(s.onDeck.map((x) => x.symbol), ["DECK", "LOW"]);
  assert.deepEqual(s.screened.map((x) => x.symbol), ["FAIL"]);
});

test("a high score does not make a failing row a pick", () => {
  const s = splitShortlist([{ symbol: "X", gate_pass: false, swing_score: 99 }]);
  assert.equal(s.counts.topPicks, 0);
  assert.equal(s.counts.onDeck, 0, "a failed row is never on deck");
  assert.equal(s.counts.screened, 1);
});

test("on-deck is empty when everything clears the band", () => {
  const s = splitShortlist([{ symbol: "A", gate_pass: true, swing_score: 79 }]);
  assert.equal(s.counts.topPicks, 1);
  assert.equal(s.counts.onDeck, 0);
});

test("the fallback only engages when picks are empty AND passes exist", () => {
  const allBelow = splitShortlist([
    { symbol: "A", gate_pass: true, swing_score: 66 },
    { symbol: "B", gate_pass: true, swing_score: 41 },
  ]);
  assert.equal(allBelow.counts.topPicks, 0);
  assert.equal(allBelow.counts.onDeck, 2);
  // This is the exact condition App.jsx uses to switch the heading.
  assert.equal(allBelow.counts.topPicks === 0 && allBelow.counts.onDeck > 0, true);

  const nothingPassed = splitShortlist([{ symbol: "A", gate_pass: false, swing_score: 66 }]);
  assert.equal(nothingPassed.counts.topPicks === 0 && nothingPassed.counts.onDeck > 0, false);
});

test("the band threshold tracks the tracker's top band, not the page's mood", () => {
  // A guard against "just lower it so the page looks busy". 74 is the pass_v4
  // top band: the v3 63 re-expressed on the v2 score scale (same 18% share).
  assert.equal(TOP_PICK_MIN_SCORE, 74);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY_STATES,
  computeEntryState,
  entryAction,
  evaluatePlanState,
  planAction,
  relativeStrengthFactor,
  scoredOnCount,
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

test("relativeStrengthFactor mirrors the backend thresholds", () => {
  assert.equal(relativeStrengthFactor(-20, -5), 0.7);   // delta -15
  assert.equal(relativeStrengthFactor(-8, -2), 0.85);   // delta -6
  assert.equal(relativeStrengthFactor(-4, -1), 1.0);
  assert.equal(relativeStrengthFactor(-6, -6), 1.05);   // index correcting, stock tracking
  assert.equal(relativeStrengthFactor(null, -1), 1.0);
});

test("scoredOnCount counts all seven weighted components", () => {
  const sub = {
    valuation_compression: 1,
    oversold_positioning: 1,
    support_proximity: 1,
    drawdown_sweetspot: 1,
    volume_capitulation: 1,
    quality_composite: 1,
    conviction_holding: 1,
  };
  assert.equal(scoredOnCount(sub), 7);
  assert.equal(scoredOnCount({ ...sub, conviction_holding: null }), 6);
  assert.equal(scoredOnCount(null), 0);
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

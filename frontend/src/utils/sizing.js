// Position sizing and risk math, shared by the shortlist card and the detail
// drawer so a customer sees the same numbers wherever they look.
//
// Convention (matches DetailDrawer): size off the TOP of the entry zone, the
// worst-case fill if price tags the zone. Never understate risk.

export const SIZING_LS_KEY = "nseSwingSizing";
export const DEFAULT_SIZING = { capital: 500000, riskPct: 1.0 };

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function readSizing() {
  if (typeof window === "undefined") return DEFAULT_SIZING;
  try {
    const raw = localStorage.getItem(SIZING_LS_KEY);
    if (!raw) return DEFAULT_SIZING;
    const v = JSON.parse(raw);
    const capital = isNum(+v.capital) && +v.capital > 0 ? +v.capital : DEFAULT_SIZING.capital;
    const riskPct = isNum(+v.riskPct) && +v.riskPct > 0 ? +v.riskPct : DEFAULT_SIZING.riskPct;
    return { capital, riskPct };
  } catch {
    return DEFAULT_SIZING;
  }
}

export function saveSizing(sizing) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIZING_LS_KEY, JSON.stringify(sizing));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Risk and reward per share, in INR and as a percentage of the zone-high
 * entry. Returns null when the plan is incomplete or malformed.
 */
export function planRiskReward(stock) {
  if (!stock) return null;
  const zh = stock.entry_zone_high;
  const stop = stock.stop_loss;
  const t1 = stock.target_1;
  if (!isNum(zh) || !isNum(stop) || !isNum(t1) || zh <= 0 || stop >= zh) return null;
  const riskPerShare = zh - stop;
  const rewardPerShare = t1 - zh;
  return {
    riskPerShare,
    rewardPerShare,
    riskPct: (riskPerShare / zh) * 100,
    rewardPct: (rewardPerShare / zh) * 100,
    rr: rewardPerShare > 0 ? rewardPerShare / riskPerShare : null,
  };
}

/**
 * Shares to buy and rupees at risk for the customer's capital / risk budget.
 * `shares` can be 0 when the budget is too small for one share — callers
 * should say so rather than rounding up risk.
 */
export function computePositionSize(stock, sizing = DEFAULT_SIZING) {
  const rr = planRiskReward(stock);
  if (!rr) return null;
  const capital = sizing?.capital;
  const riskPct = sizing?.riskPct;
  if (!isNum(capital) || capital <= 0 || !isNum(riskPct) || riskPct <= 0) return null;
  const riskAmount = capital * (riskPct / 100);
  const shares = Math.floor(riskAmount / rr.riskPerShare);
  return {
    shares,
    notional: shares * stock.entry_zone_high,
    riskAmount,
    riskPerShare: rr.riskPerShare,
    budgetTooSmall: shares === 0,
  };
}

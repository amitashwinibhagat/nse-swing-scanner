// Personal trade journal — local-only, no server, no brokerage.
//
// The app cannot know what the customer actually did, so this is a log the
// customer owns. We store their fill, then compare it to the latest scan close
// on every render. Status is descriptive, never a recommendation to exit.

export const TRADES_LS_KEY = "nseSwingTrades";
export const TRADES_EVENT = "nseSwingTradesChange";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanTrade(t) {
  if (!t || typeof t.symbol !== "string" || !t.symbol) return null;
  const out = {
    symbol: t.symbol,
    entry: isNum(t.entry) ? t.entry : null,
    shares: isNum(t.shares) ? Math.max(0, Math.floor(t.shares)) : 0,
    stop: isNum(t.stop) ? t.stop : null,
    target: isNum(t.target) ? t.target : null,
    takenAt: typeof t.takenAt === "string" ? t.takenAt : new Date().toISOString(),
    scanDate: typeof t.scanDate === "string" ? t.scanDate : null,
  };
  if (out.entry == null || out.entry <= 0) return null;
  return out;
}

export function readTrades() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRADES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanTrade).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeTrades(trades) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRADES_LS_KEY, JSON.stringify(trades));
    window.dispatchEvent(new CustomEvent(TRADES_EVENT));
  } catch {
    /* quota / private mode — the journal is best-effort */
  }
}

/**
 * Where a logged trade stands against the latest scan close.
 * R-multiple is per-share P&L divided by per-share risk at entry.
 */
export function tradeStatus(trade, latestPrice) {
  if (!trade) return null;
  if (!isNum(latestPrice) || !isNum(trade.entry) || trade.entry <= 0) {
    return {
      state: "unpriced",
      label: "No fresh price",
      tone: "muted",
      pnlPct: null,
      pnlAbs: null,
      rMultiple: null,
    };
  }
  const pnlPct = ((latestPrice - trade.entry) / trade.entry) * 100;
  const pnlAbs = (latestPrice - trade.entry) * (trade.shares || 0);
  let rMultiple = null;
  if (isNum(trade.stop) && trade.entry > trade.stop) {
    rMultiple = (latestPrice - trade.entry) / (trade.entry - trade.stop);
  }
  if (isNum(trade.stop) && latestPrice <= trade.stop) {
    return { state: "stopped", label: "Stop hit", tone: "danger", pnlPct, pnlAbs, rMultiple };
  }
  if (isNum(trade.target) && latestPrice >= trade.target) {
    return { state: "target", label: "Target reached", tone: "success", pnlPct, pnlAbs, rMultiple };
  }
  return {
    state: "open",
    label: "Open",
    tone: pnlPct >= 0 ? "success" : "warning",
    pnlPct,
    pnlAbs,
    rMultiple,
  };
}

/**
 * Aggregate P&L across priced trades. Unpriced symbols are counted, not
 * silently dropped, so the totals never pretend to cover everything.
 */
export function summarizeTrades(trades, priceBySymbol) {
  const list = Array.isArray(trades) ? trades : [];
  let invested = 0;
  let value = 0;
  let priced = 0;
  let unpriced = 0;
  for (const t of list) {
    const p = priceBySymbol?.[t.symbol];
    if (!isNum(p) || !isNum(t.entry) || !isNum(t.shares)) {
      unpriced += 1;
      continue;
    }
    priced += 1;
    invested += t.entry * t.shares;
    value += p * t.shares;
  }
  const pnlAbs = priced > 0 ? value - invested : null;
  const pnlPct = priced > 0 && invested > 0 ? (pnlAbs / invested) * 100 : null;
  return { count: list.length, priced, unpriced, invested, value, pnlAbs, pnlPct };
}

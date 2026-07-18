// Delta utilities for the B2 "since last scan" strip.
// Pure functions over snapshot data so they are unit-testable in isolation.

const EVENING_HOUR_UTC = 8; // >= 8 UTC → pm slot (per scanner/snapshot_writer)

function isEvening(label) {
  // label like "2026-07-18-pm" — slot is the part after the last dash.
  const parts = label.split("-");
  return parts[parts.length - 1] === "pm";
}

function snapshotDate(label) {
  // YYYY-MM-DD-{am|pm} → Date in UTC.
  const [y, m, d] = label.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Pick the "previous" snapshot to diff against the current one.
 * Per the plan F5 heuristic: evening-to-evening is the comparison that
 * actually changes — morning scan repeats prior close and produces an
 * empty delta. Falls back to the most-recent prior scan if no prior
 * evening exists (first scan ever).
 *
 * @param {Array<{date:string, slot:string, file:string, generated_at:string}>} index
 * @param {{date:string, slot:string}} current  current snapshot's metadata
 * @returns {{date:string, slot:string, file:string}|null}
 */
export function pickPreviousSnapshot(index, current) {
  if (!Array.isArray(index) || index.length === 0) return null;
  const sorted = [...index].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.slot === b.slot ? 0 : a.slot === "am" ? -1 : 1;
  });
  const curKey = `${current.date}-${current.slot}`;
  const curIdx = sorted.findIndex((e) => `${e.date}-${e.slot}` === curKey);
  if (curIdx <= 0) return null;
  const prior = sorted.slice(0, curIdx);

  // Prefer the most recent prior evening scan.
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    if (prior[i].slot === "pm") return prior[i];
  }
  // Otherwise most-recent prior scan (morning of same day, or older).
  return prior[prior.length - 1];
}

/**
 * Compute the user-visible deltas between two snapshots.
 *
 * @param {Array} currentStocks  full latest_scan.stocks
 * @param {Array} previousStocks full previous_snapshot.stocks
 * @param {(symbol:string)=>boolean} isWatched  watchlist predicate
 * @returns {{
 *   newPasses: Array<{symbol:string, swing_score:number}>,
 *   droppedPasses: Array<{symbol:string}>,
 *   watchlistTriggers: Array<{symbol:string, change:string, detail:string}>,
 *   unchangedPassCount: number,
 * }}
 */
export function computeDeltas(currentStocks, previousStocks, isWatched) {
  const curBySym = new Map();
  for (const s of currentStocks || []) curBySym.set(s.symbol, s);
  const prevBySym = new Map();
  for (const s of previousStocks || []) prevBySym.set(s.symbol, s);

  const newPasses = [];
  const droppedPasses = [];
  let unchangedPassCount = 0;

  for (const [sym, cur] of curBySym) {
    const prev = prevBySym.get(sym);
    const curPass = !!cur.gate_pass;
    const prevPass = !!(prev && prev.gate_pass);
    if (curPass && !prevPass) {
      newPasses.push({ symbol: sym, swing_score: cur.swing_score ?? null });
    } else if (!curPass && prevPass) {
      droppedPasses.push({ symbol: sym });
    } else if (curPass && prevPass) {
      unchangedPassCount += 1;
    }
  }

  // Watchlist triggers: only for watched symbols; compare entry-state
  // between prev and cur snapshots. The plan names "entered zone / stopped
  // / hit T1" as the interesting transitions.
  const watchlistTriggers = [];
  if (typeof isWatched === "function") {
    for (const sym of (curBySym.keys?.() ?? [])) {
      if (!isWatched(sym)) continue;
      const cur = curBySym.get(sym);
      const prev = prevBySym.get(sym);
      if (!prev || !cur) continue;
      const curEntry = _entryTag(cur);
      const prevEntry = _entryTag(prev);
      if (curEntry === prevEntry) continue;
      // Prefer stop / target exits over zone transitions.
      const importance = (t) =>
        t === "stopped" ? 3 : t === "at_t1" || t === "at_t2" ? 2 : 1;
      if (importance(curEntry) >= importance(prevEntry) || curEntry === "stopped") {
        watchlistTriggers.push({
          symbol: sym,
          change: `${prevEntry || "—"} → ${curEntry}`,
          detail: curEntry === "stopped"
            ? `stop breached`
            : curEntry === "at_t1"
              ? `T1 reached`
              : curEntry === "at_t2"
                ? `T2 reached`
                : curEntry === "in_zone"
                  ? `pulled back into zone`
                  : curEntry,
        });
      }
    }
  }

  newPasses.sort((a, b) => (b.swing_score ?? -1) - (a.swing_score ?? -1));
  droppedPasses.sort((a, b) => a.symbol.localeCompare(b.symbol));
  watchlistTriggers.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return { newPasses, droppedPasses, watchlistTriggers, unchangedPassCount };
}

function _entryTag(stock) {
  const p = stock.current_price;
  const zl = stock.entry_zone_low;
  const zh = stock.entry_zone_high;
  const stop = stock.stop_loss;
  const t1 = stock.target_1;
  const t2 = stock.target_2;
  if (![p, zl, zh, stop, t1].every((v) => typeof v === "number")) return null;
  if (typeof t2 === "number" && p >= t2) return "at_t2";
  if (p >= t1) return "at_t1";
  if (p <= stop) return "stopped";
  if (p > zh) return "extended";
  if (p < zl) return "below_zone";
  return "in_zone";
}

export { _entryTag as _entryTagForTesting, isEvening, snapshotDate, EVENING_HOUR_UTC };
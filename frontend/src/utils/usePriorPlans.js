import { useEffect, useState } from "react";

import { resolveIndexEntry } from "./recentPicks.js";

/**
 * Load the plan + price from the previous snapshot, keyed by symbol.
 *
 * Why: the scanner anchors every plan to its own close (`entry_zone_high` IS
 * `current_price`), so evaluating a fresh row against its own plan always
 * returns "in zone". The only honest question is "how has the price moved
 * since this plan was written?", which needs the prior levels.
 *
 * Returns `{ plans, priorMeta }`, where `plans[symbol]` is the prior snapshot's
 * row (levels + the price at the time). Missing/unfetchable history is a
 * normal state: cards then fall back to a plan-only, clearly-labelled action.
 */
export default function usePriorPlans(history, currentGeneratedAt) {
  const [plans, setPlans] = useState({});
  const [priorMeta, setPriorMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPlans({});
    setPriorMeta(null);

    const current = resolveIndexEntry(history, currentGeneratedAt);
    if (!current) return undefined;
    const idx = history.indexOf(current);
    if (idx <= 0) return undefined;
    const prior = history[idx - 1];

    fetch(`/data/snapshots/${prior.file}`, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((snap) => {
        if (cancelled || !snap) return;
        if (!Array.isArray(snap.stocks)) return;
        const bySymbol = {};
        for (const row of snap.stocks) {
          if (row && row.symbol) bySymbol[row.symbol] = row;
        }
        setPlans(bySymbol);
        setPriorMeta(prior);
      })
      .catch(() => {
        /* history is optional; the cards degrade to plan-only actions */
      });

    return () => {
      cancelled = true;
    };
  }, [history, currentGeneratedAt]);

  return { plans, priorMeta };
}

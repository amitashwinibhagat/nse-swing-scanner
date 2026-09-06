import { useEffect, useState } from "react";
import { buildRecentPicks, picksSummaryLine, resolveIndexEntry, isStripWorthy, formatSnapshotLabel } from "../utils/recentPicks.js";

const HISTORY_URL = "/data/snapshots/history_index.json";
const PERF_URL = "/data/performance.json";

/**
 * "Receipts" banner, above the fold: the one-line public claim backed by the
 * outcome tracker (the 63+ band's established edge at T+5/T+10/T+20),
 * computed from performance.json — never hardcoded numbers.
 *
 * Renders nothing when performance.json is missing, the payload is empty,
 * or the top-band CI doesn't actually support the claim (the tracker owns
 * the truth; this banner only mirrors it).
 */
export function ReceiptsBanner() {
  const [perf, setPerf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(PERF_URL, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setPerf(d);
      } catch {
        /* performance.json absent → banner stays hidden */
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (!perf || !perf.windows) return null;

  const t5 = perf.windows["T+5"]?.buckets?.["63+"];
  if (!t5 || typeof t5.mean !== "number" || !t5.ci95) return null;
  // The claim requires the CI to be entirely above zero — verify, don't assume.
  if (!(t5.ci95.low > 0)) return null;
  if (typeof t5.n !== "number" || t5.n < 20) return null;

  const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <section className="receipts-banner" aria-label="Tracker evidence summary">
      <span className="receipts-tag" aria-hidden="true">RECEIPTS</span>
      <p>
        Suggestions with a score of <b>63+</b> have beaten the Nifty 50 by{" "}
        <b>{pct(t5.mean)}</b> on average within 5 sessions{" "}
        <span className="receipts-ci">(95% CI {pct(t5.ci95.low)} to {pct(t5.ci95.high)}, n={t5.n})</span>.
        Every pick is scored against what actually happened —{" "}
        <a href="#perf-heading">see the full track record</a>.
      </p>
    </section>
  );
}

const MAX_PICK_CHIPS = 14;

/**
 * Recent-picks scorecard strip: what happened to the previous scan's
 * suggestions, judged against the currently rendered scan's prices.
 * Deliberately honest by construction — no pick is dropped; names without
 * a fresh price show as "unpriced".
 */
export default function RecentPicksStrip({ currentGeneratedAt }) {
  const [history, setHistory] = useState([]);
  const [latestStocks, setLatestStocks] = useState(null);
  const [built, setBuilt] = useState(null);
  const [priorMeta, setPriorMeta] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Latest-scan stocks for the price lookup. In dev the parent re-renders
  // with new data; here we fetch the canonical committed file.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/data/latest_scan.json", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setLatestStocks(d?.stocks ?? null);
      } catch {
        /* ignore */
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(HISTORY_URL, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setHistory(Array.isArray(d) ? d : []);
      } catch {
        /* ignore — no history is the common first-scan state */
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cur = resolveIndexEntry(history, currentGeneratedAt);
      if (!cur) {
        setPriorMeta(null);
        return;
      }
      const idx = history.indexOf(cur);
      if (idx <= 0) {
        setPriorMeta(null);
        return;
      }
      // Most recent prior snapshot (am-or-pm). Unlike DeltaStrip we do not
      // skip same-day mornings: a morning scan's picks vs tonight's prices
      // is still a legitimate, readable receipts line.
      const prior = history[idx - 1];
      try {
        const r = await fetch(`/data/snapshots/${prior.file}`, { cache: "no-store" });
        if (!r.ok) throw new Error("fetch failed");
        const snap = await r.json();
        if (cancelled) return;
        setPriorMeta(prior);
        setBuilt(buildRecentPicks(snap, { stocks: latestStocks || [] }));
      } catch {
        if (!cancelled) {
          setPriorMeta(null);
          setBuilt(null);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [history, currentGeneratedAt, latestStocks]);

  if (dismissed) return null;
  if (!isStripWorthy(built)) return null;

  const summaryLine = picksSummaryLine(built.summary);
  const visible = built.picks.slice(0, MAX_PICK_CHIPS);
  const overflow = built.picks.length - visible.length;

  return (
    <div className="delta-strip recent-picks" role="status">
      <div className="delta-head">
        <h2>
          Last scan&apos;s picks, tracked{" "}
          <span className="recent-picks-since">
            {priorMeta ? `· ${formatSnapshotLabel(priorMeta)} cohort` : ""}
          </span>
        </h2>
        <button
          type="button"
          className="search-clear"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss recent picks strip"
        >
          ×
        </button>
      </div>
      {summaryLine && <p className="recent-picks-summary">{summaryLine}</p>}
      <div className="recent-picks-chips">
        {visible.map((p) => (
          <span
            key={p.symbol}
            className={`entry-state entry-${p.tone} recent-pick`}
            title={p.tooltip}
          >
            <span className="recent-pick-sym">{p.symbol}</span>
            <span className="recent-pick-state">{p.stateLabel}</span>
            {p.changePct != null && (
              <span className="recent-pick-chg">
                {p.changePct > 0 ? "+" : ""}
                {p.changePct.toFixed(1)}%
              </span>
            )}
          </span>
        ))}
        {overflow > 0 && <span className="delta-more">+{overflow} more in the cohort</span>}
      </div>
      <p className="recent-picks-fineprint">
        Judged against the latest scan&apos;s close — not advice, just the scoreboard.
        Full attribution in the forward-return section below.
      </p>
    </div>
  );
}

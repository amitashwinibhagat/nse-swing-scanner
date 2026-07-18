import { useEffect, useState } from "react";
import { computeDeltas, pickPreviousSnapshot } from "../utils/delta.js";

const HISTORY_URL = "/data/snapshots/history_index.json";

/**
 * Dismissible banner that surfaces the actionable changes since the prior
 * snapshot. Visible only when there are non-zero deltas.
 *
 * @param {{currentGeneratedAt:string, stocks:Array,
 *   watchlist:{has:(s:string)=>boolean}}} props
 */
export default function DeltaStrip({ currentGeneratedAt, stocks, watchlist }) {
  const [history, setHistory] = useState([]);
  const [latestMeta, setLatestMeta] = useState(null);
  const [previousStocks, setPreviousStocks] = useState(null);
  const [previousMeta, setPreviousMeta] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Reset dismissal when the underlying scan changes.
    setDismissed(false);
    async function load() {
      try {
        const r = await fetch(HISTORY_URL, { cache: "no-store" });
        if (!r.ok) return;
        const idx = await r.json();
        if (!cancelled && Array.isArray(idx)) setHistory(idx);
      } catch {
        /* ignore — no history is the common first-scan state */
      }
    }
    load();
    return () => { cancelled = true; };
  }, [currentGeneratedAt]);

  useEffect(() => {
    // Resolve which history_index entry corresponds to the currently
    // rendered scan. Match by generated_at first; fall back to date+slot
    // derived from the timestamp.
    if (!Array.isArray(history) || history.length === 0 || !currentGeneratedAt) {
      setLatestMeta(null);
      return;
    }
    const match = history.find((e) => e.generated_at === currentGeneratedAt);
    if (match) {
      setLatestMeta(match);
      return;
    }
    const d = new Date(currentGeneratedAt);
    if (Number.isNaN(d.getTime())) {
      setLatestMeta(null);
      return;
    }
    const dateStr = d.toISOString().slice(0, 10);
    const slot = d.getUTCHours() >= 8 ? "pm" : "am";
    const fallback = history.find((e) => e.date === dateStr && e.slot === slot);
    setLatestMeta(fallback || null);
  }, [history, currentGeneratedAt]);

  useEffect(() => {
    let cancelled = false;
    async function loadPrev() {
      if (!latestMeta) {
        setPreviousStocks(null);
        setPreviousMeta(null);
        return;
      }
      const prev = pickPreviousSnapshot(history, latestMeta);
      if (!prev) {
        setPreviousStocks(null);
        setPreviousMeta(null);
        return;
      }
      try {
        const r = await fetch(`/data/snapshots/${prev.file}`, { cache: "no-store" });
        if (!r.ok) return;
        const scan = await r.json();
        if (!cancelled) {
          setPreviousStocks(scan.stocks || []);
          setPreviousMeta(prev);
        }
      } catch {
        /* ignore */
      }
    }
    loadPrev();
    return () => { cancelled = true; };
  }, [history, latestMeta]);

  if (dismissed || !previousStocks || !previousMeta) return null;

  const deltas = computeDeltas(stocks, previousStocks, watchlist?.has);
  const total = deltas.newPasses.length + deltas.droppedPasses.length + deltas.watchlistTriggers.length;
  if (total === 0) return null;

  return (
    <div className="delta-strip" role="status">
      <div className="delta-head">
        <span>
          Changes since <b>{previousMeta.date}-{previousMeta.slot}</b> ({previousMeta.date}):
        </span>
        <button
          type="button"
          className="search-clear"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss changes since last scan"
          title="Dismiss"
        >
          {"×"}
        </button>
      </div>
      {deltas.newPasses.length > 0 && (
        <div className="delta-section">
          <span className="delta-tag tag-new">NEW PASS · {deltas.newPasses.length}</span>
          <span className="delta-list">
            {deltas.newPasses.slice(0, 8).map((p) => (
              <span key={p.symbol} className="delta-chip">
                {p.symbol}
                {typeof p.swing_score === "number" && (
                  <span className="delta-chip-score">{p.swing_score.toFixed(0)}</span>
                )}
              </span>
            ))}
            {deltas.newPasses.length > 8 && <span className="delta-more">+{deltas.newPasses.length - 8} more</span>}
          </span>
        </div>
      )}
      {deltas.droppedPasses.length > 0 && (
        <div className="delta-section">
          <span className="delta-tag tag-drop">DROPPED · {deltas.droppedPasses.length}</span>
          <span className="delta-list">
            {deltas.droppedPasses.slice(0, 8).map((p) => (
              <span key={p.symbol} className="delta-chip drop">{p.symbol}</span>
            ))}
            {deltas.droppedPasses.length > 8 && <span className="delta-more">+{deltas.droppedPasses.length - 8} more</span>}
          </span>
        </div>
      )}
      {deltas.watchlistTriggers.length > 0 && (
        <div className="delta-section">
          <span className="delta-tag tag-wl">WATCHLIST · {deltas.watchlistTriggers.length}</span>
          <span className="delta-list">
            {deltas.watchlistTriggers.map((t) => (
              <span key={t.symbol} className="delta-chip watch" title={t.detail}>
                {t.symbol} <span className="delta-chip-arrow">{t.change}</span>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
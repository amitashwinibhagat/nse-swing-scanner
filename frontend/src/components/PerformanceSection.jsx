import { useEffect, useState } from "react";

const PERFORMANCE_URL = "/data/performance.json";

/**
 * C2: Score-bucket hit-rate view from data/performance.json.
 * Hidden when the file is missing or empty (first weeks after B1 lands).
 *
 * Statistical honesty baked into the copy:
 *  - N shown prominently (small cohorts dominate this dataset)
 *  - Excess return vs ^NSEI (per-name, not pooled)
 *  - Explicit "descriptive" framing; not a backtest
 */
export default function PerformanceSection() {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | loaded | empty | error

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(PERFORMANCE_URL, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setState("empty");
          return;
        }
        const j = await r.json();
        if (cancelled) return;
        if (!j || (j.meta && j.meta.snapshots_used === 0)) {
          setState("empty");
        } else {
          setData(j);
          setState("loaded");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (state === "loading" || state === "error") return null;
  if (state === "empty") {
    return (
      <section className="performance">
        <h3>Forward-return attribution</h3>
        <p className="na">
          Performance data is not yet available. The outcome tracker runs weekly
          (Saturday 09:30 IST); after the first scan plus one trailing window
          (~20 trading days), per-bucket cohort stats will appear here.
        </p>
      </section>
    );
  }

  const windows = Object.keys(data.windows || {});
  const buckets = ["80+", "70-79", "60-69", "<60"];

  return (
    <section className="performance" aria-labelledby="perf-heading">
      <h3 id="perf-heading">Forward-return attribution</h3>
      <p className="perf-note">
        Per-snapshot cohorts of gate-passed names. Excess return vs Nifty 50
        over each window. N shown per cell — small cohorts dominate, treat as
        descriptive cohort statistics, not an edge.
      </p>
      <div className="perf-meta">
        <span>Snapshots: <b>{data.meta.snapshots_used}</b></span>
        <span>Total passed: <b>{data.meta.total_passed}</b></span>
        <span>Retention: <b>{data.retention_days}d</b></span>
      </div>
      <div className="perf-grid">
        <div className="perf-table-wrap">
          <table className="perf-table">
            <thead>
              <tr>
                <th>Window</th>
                <th>Bucket</th>
                <th>N</th>
                <th>Median</th>
                <th>Q1</th>
                <th>Q3</th>
                <th>Untrackable</th>
              </tr>
            </thead>
            <tbody>
              {windows.flatMap((w) =>
                buckets.flatMap((b) => {
                  const cell = data.windows[w]?.buckets?.[b];
                  if (!cell || cell.n === 0) return [];
                  return [
                    <tr key={`${w}-${b}`}>
                      <td>{w}</td>
                      <td>{b}</td>
                      <td>{cell.n}</td>
                      <td className={_tone(cell.median)}>
                        {cell.median == null ? "—" : `${cell.median > 0 ? "+" : ""}${cell.median}%`}
                      </td>
                      <td>{cell.q1 == null ? "—" : `${cell.q1}%`}</td>
                      <td>{cell.q3 == null ? "—" : `${cell.q3}%`}</td>
                      <td>{_colUntrackable(data, w, buckets.indexOf(b), cell.n)}</td>
                    </tr>,
                  ];
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="perf-fineprint">
        Untrackable = delisted / suspended / yfinance fetch failed. Tracked
        separately, never silently dropped. Overlapping T+20 windows across
        consecutive scans are autocorrelated — do not pool per-name rows.
      </p>
    </section>
  );
}

function _tone(v) {
  if (v == null) return "";
  if (v > 0) return "positive";
  if (v < 0) return "negative";
  return "";
}

function _colUntrackable(data, window, bucketIdx, n) {
  // Compact one-number readout per row; exact number for the window overall.
  const w = data.windows?.[window];
  if (!w) return "—";
  return String(w.untrackable_count ?? 0);
}
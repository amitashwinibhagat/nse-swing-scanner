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
  const regimes = ["risk_on", "neutral", "risk_off", "unknown"];
  const regimeLabels = {
    risk_on: "Risk-on (Nifty > +2% vs 200EMA)",
    neutral: "Neutral (±2%)",
    risk_off: "Risk-off (< −2%)",
    unknown: "Unknown",
  };
  const hasRegime = !!data.by_regime;
  // Statistical guardrail: render regime cell numbers only when N >= 5.
  const REGIME_N_FLOOR = 5;

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

      {hasRegime && (
        <>
          <h4 className="perf-subhead">By market regime</h4>
          <p className="perf-note">
            Same cohorts split by the Nifty-vs-200EMA regime at scan time. A
            90-day window is roughly one regime, so treat the split as
            directional, not significant. Cells with N &lt; {REGIME_N_FLOOR}
            render as "insufficient data" rather than a misleading median.
          </p>
          <div className="perf-table-wrap">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>Window</th>
                  <th>Regime</th>
                  <th>N</th>
                  <th>Median excess</th>
                  <th>IQR</th>
                </tr>
              </thead>
              <tbody>
                {windows.flatMap((w) =>
                  regimes.flatMap((rg) => {
                    const cell = data.by_regime[w]?.[rg];
                    if (!cell || cell.n === 0) return [];
                    const insufficient = cell.n < REGIME_N_FLOOR;
                    return [
                      <tr key={`${w}-${rg}`}>
                        <td>{w}</td>
                        <td>{regimeLabels[rg] || rg}</td>
                        <td>{cell.n}</td>
                        <td className={_tone(cell.median)}>
                          {insufficient || cell.median == null
                            ? "insufficient data"
                            : `${cell.median > 0 ? "+" : ""}${cell.median}%`}
                        </td>
                        <td>
                          {insufficient || cell.q1 == null || cell.q3 == null
                            ? "—"
                            : `${cell.q1}% / ${cell.q3}%`}
                        </td>
                      </tr>,
                    ];
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="perf-fineprint">
            Calibration raw material: <code>performance.json</code> now carries
            a <code>per_name</code> array (snapshot, symbol, score, bucket,
            regime, confirmation, per-window excess) so future score→probability
            calibration can fit without re-walking snapshots. The confirmation
            overlay is A/B-label only today — its hit-rate delta publishes here
            once N is sufficient.
          </p>
        </>
      )}
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
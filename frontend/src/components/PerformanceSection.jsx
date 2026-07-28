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
 *  - Empty trackable state surfaces reason breakdown (P0 integrity)
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
  const buckets =
    (data.meta && data.meta.buckets) ||
    ["60+", "55-59", "50-54", "<50"];
  const regimes = ["risk_on", "neutral", "risk_off", "unknown"];
  const regimeLabels = {
    risk_on: "Risk-on (Nifty > +2% vs 200EMA)",
    neutral: "Neutral (±2%)",
    risk_off: "Risk-off (< −2%)",
    unknown: "Unknown",
  };
  const hasRegime = !!data.by_regime;
  const REGIME_N_FLOOR = 5;
  const HIT_RATE_N_FLOOR = 20;

  const t5Track = data.meta?.trackable_count?.["T+5"] ?? data.windows?.["T+5"]?.trackable_count ?? 0;
  const t5Untrack = data.meta?.untrackable_count?.["T+5"] ?? data.windows?.["T+5"]?.untrackable_count ?? 0;
  const t5Open = data.meta?.window_not_closed_count?.["T+5"] ?? data.windows?.["T+5"]?.window_not_closed_count ?? 0;
  const anyTrackable = windows.some(
    (w) => (data.windows[w]?.trackable_count ?? 0) > 0,
  );
  const reasons = data.windows?.["T+5"]?.reasons || {};

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
        {data.meta.bucket_scheme && (
          <span>Buckets: <b>{data.meta.bucket_scheme}</b></span>
        )}
        <span>T+5 trackable: <b>{t5Track}</b></span>
        <span>T+5 untrackable: <b>{t5Untrack}</b></span>
        <span>T+5 not closed: <b>{t5Open}</b></span>
      </div>

      {!anyTrackable && (
        <div className="perf-alert" role="status">
          <p>
            <b>No closed outcomes yet.</b>{" "}
            {t5Open > 0 && t5Untrack === 0
              ? "Forward windows are still open — T+5 needs ~1 week after each snapshot."
              : "Outcome fetch did not resolve prices for closed windows."}
          </p>
          {Object.keys(reasons).length > 0 && (
            <p className="perf-fineprint">
              T+5 reasons:{" "}
              {Object.entries(reasons)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="perf-grid">
        <div className="perf-table-wrap">
          <table className="perf-table">
            <thead>
              <tr>
                <th>Window</th>
                <th>Bucket</th>
                <th>N</th>
                <th>Median</th>
                <th>Hit rate</th>
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
                  const showHit =
                    cell.hit_rate != null && cell.n >= HIT_RATE_N_FLOOR;
                  return [
                    <tr key={`${w}-${b}`}>
                      <td>{w}</td>
                      <td>{b}</td>
                      <td>{cell.n}</td>
                      <td className={_tone(cell.median)}>
                        {cell.median == null ? "—" : `${cell.median > 0 ? "+" : ""}${cell.median}%`}
                      </td>
                      <td>
                        {showHit
                          ? `${Math.round(cell.hit_rate * 100)}%`
                          : cell.n > 0
                            ? `n<${HIT_RATE_N_FLOOR}`
                            : "—"}
                      </td>
                      <td>{cell.q1 == null ? "—" : `${cell.q1}%`}</td>
                      <td>{cell.q3 == null ? "—" : `${cell.q3}%`}</td>
                      <td>{String(data.windows?.[w]?.untrackable_count ?? 0)}</td>
                    </tr>,
                  ];
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="perf-fineprint">
        Untrackable = delisted / suspended / yfinance fetch failed. Window not
        closed = forward horizon still open (not a failure). Tracked
        separately, never silently dropped. Hit rate shown only when N ≥ {HIT_RATE_N_FLOOR}.
        Overlapping T+20 windows across consecutive scans are autocorrelated —
        do not pool per-name rows.
      </p>

      {hasRegime && (
        <>
          <h4 className="perf-subhead">By market regime</h4>
          <p className="perf-note">
            Same cohorts split by the Nifty-vs-200EMA regime at scan time. A
            90-day window is roughly one regime, so treat the split as
            directional, not significant. Cells with N &lt; {REGIME_N_FLOOR}
            render as &quot;insufficient data&quot; rather than a misleading median.
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
            Calibration raw material: <code>performance.json</code> carries
            a <code>per_name</code> array (snapshot, symbol, score, bucket,
            regime, confirmation, per-window excess). Confirmation overlay is
            A/B-label only until N is sufficient.
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

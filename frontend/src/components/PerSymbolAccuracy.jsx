import { useMemo, useState } from "react";

/**
 * Per-symbol accuracy lookup — score-at-suggestion-time vs realized excess
 * returns, grouped client-side from performance.json's per_name rows.
 *
 * Honesty rules (mirror PerformanceSection):
 *  - Untrackable / still-open windows are shown as their reason, never
 *    dropped from the table and never averaged into aggregates.
 *  - Hit rates shown only when the symbol has >= MIN_APPEARANCES trackable
 *    T+5 outcomes.
 */

const WINDOWS = ["T+5", "T+10", "T+20"];
const MIN_APPEARANCES = 3;

function fmtPct(v) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtHit(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function median(sortedVals) {
  const n = sortedVals.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedVals[mid] : (sortedVals[mid - 1] + sortedVals[mid]) / 2;
}

function toneClass(v) {
  if (v == null) return "";
  if (v > 0) return "positive";
  if (v < 0) return "negative";
  return "";
}

function buildBySymbol(perName) {
  const map = new Map();
  for (const row of perName || []) {
    const sym = row.symbol;
    if (!sym) continue;
    if (!map.has(sym)) {
      map.set(sym, { symbol: sym, rows: [] });
    }
    map.get(sym).rows.push(row);
  }
  const out = [...map.values()];
  for (const entry of out) {
    entry.rows.sort((a, b) => (a.snapshot < b.snapshot ? 1 : -1)); // newest first
    const t5 = entry.rows
      .map((r) => r.windows?.["T+5"]?.excess_return_pct)
      .filter((v) => v != null)
      .sort((a, b) => a - b);
    entry.t5Count = t5.length;
    entry.t5Median = median(t5);
    entry.t5Hit = t5.length ? t5.filter((v) => v > 0).length / t5.length : null;
    entry.latestScore = entry.rows.find((r) => r.score != null)?.score ?? null;
  }
  out.sort((a, b) => b.rows.length - a.rows.length);
  return out;
}

export default function PerSymbolAccuracy({ data }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const symbols = useMemo(
    () => (data ? buildBySymbol(data.per_name) : []),
    [data],
  );

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return symbols.filter((e) => e.symbol.toUpperCase().includes(q)).slice(0, 12);
  }, [symbols, query]);

  if (!data) return null;

  return (
    <div className="per-symbol-accuracy">
      <h4 className="perf-subhead">Per-symbol accuracy lookup</h4>
      <p className="perf-note">
        Look up any suggested stock to see the score it carried at suggestion
        time and what actually happened next (excess vs Nifty 50). Windows
        still open or untrackable are shown as such — never dropped.
      </p>
      <input
        className="per-symbol-search"
        type="search"
        placeholder="Search symbol (e.g. RELIANCE)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        aria-label="Search symbol"
      />

      {query.trim() !== "" && results.length === 0 && (
        <p className="perf-fineprint">No suggested symbol matches “{query}”.</p>
      )}

      {results.length > 0 && (
        <div className="perf-table-wrap">
          <table className="perf-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Scans in</th>
                <th>Latest score</th>
                <th>T+5 median</th>
                <th>T+5 hit rate</th>
              </tr>
            </thead>
            <tbody>
              {results.map((e) => (
                <tr
                  key={e.symbol}
                  className={selected === e.symbol ? "selected" : ""}
                  onClick={() => setSelected(e.symbol === selected ? null : e.symbol)}
                  style={{ cursor: "pointer" }}
                >
                  <td>{e.symbol}</td>
                  <td>{e.rows.length}</td>
                  <td>{e.latestScore ?? "—"}</td>
                  <td className={toneClass(e.t5Median)}>
                    {e.t5Count > 0 ? fmtPct(e.t5Median) : "—"}
                  </td>
                  <td>
                    {e.t5Count >= MIN_APPEARANCES ? fmtHit(e.t5Hit) : `n<${MIN_APPEARANCES}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (() => {
        const entry = symbols.find((e) => e.symbol === selected);
        if (!entry) return null;
        return (
          <div className="per-symbol-detail">
            <h5>
              {entry.symbol} — {entry.rows.length} snapshot
              {entry.rows.length === 1 ? "" : "s"}, newest first
            </h5>
            <div className="perf-table-wrap">
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Snapshot</th>
                    <th>Score</th>
                    <th>Bucket</th>
                    {WINDOWS.map((w) => (
                      <th key={w}>{w} excess</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entry.rows.map((row) => (
                    <tr key={row.snapshot}>
                      <td>{row.snapshot}</td>
                      <td>{row.score ?? "—"}</td>
                      <td>{row.bucket}</td>
                      {WINDOWS.map((w) => {
                        const cell = row.windows?.[w];
                        if (!cell) return <td key={w}>—</td>;
                        if (cell.excess_return_pct != null) {
                          return (
                            <td key={w} className={toneClass(cell.excess_return_pct)}>
                              {fmtPct(cell.excess_return_pct)}
                            </td>
                          );
                        }
                        return (
                          <td key={w} className="perf-fineprint">
                            {cell.reason === "window_not_closed" ? "open" : cell.reason || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

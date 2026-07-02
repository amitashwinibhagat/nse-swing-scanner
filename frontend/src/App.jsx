import { Fragment, useEffect, useMemo, useState } from "react";
import Kpi from "./components/Kpi.jsx";
import SegmentedControl from "./components/SegmentedControl.jsx";
import SubscoreBars from "./components/SubscoreBars.jsx";

function IconSearch() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="m13.5 13.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M10 3v10m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const COLUMNS = [
  { key: "symbol", label: "Stock" },
  { key: "gate_pass", label: "Gate" },
  { key: "swing_score", label: "Score" },
  { key: "current_price", label: "Price" },
  { key: "pct_off_52wk_high", label: "% off 52W" },
  { key: "rsi14", label: "RSI-14" },
  { key: "target_1", label: "T1" },
  { key: "stop_loss", label: "Stop" },
  { key: "delivery_value_inr", label: "Del. val (₹cr)" },
  { key: "holdings_conviction_pct", label: "Hold %" },
  { key: "f_score", label: "F-Score" },
  { key: "trailing_pe", label: "P/E (T / 5Y)" },
];

const STALE_HOURS = 18;
const ADMIN_COOLDOWN_MS = 10 * 60 * 1000;
const ADMIN_SECRET_LS_KEY = "nseSwingAdminSecret";
const ADMIN_LAST_TRIGGER_LS_KEY = "nseSwingLastTriggerAt";
const ACTIONS_URL =
  "https://github.com/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml";

function fmt(v, digits = 2, suffix = "") {
  if (v === null || v === undefined) return <span className="na">—</span>;
  if (typeof v !== "number") return <span className="na">—</span>;
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtSigned(v, digits = 2, suffix = "%") {
  if (v === null || v === undefined) return <span className="na">—</span>;
  if (typeof v !== "number") return <span className="na">—</span>;
  const cls = v < 0 ? "negative" : v > 0 ? "positive" : "";
  return <span className={cls}>{v.toFixed(digits)}{suffix}</span>;
}

function fmtPrice(v) {
  if (v === null || v === undefined) return <span className="na">—</span>;
  if (typeof v !== "number") return <span className="na">—</span>;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtCr(v) {
  if (v === null || v === undefined) return <span className="na">—</span>;
  if (typeof v !== "number") return <span className="na">—</span>;
  return (v / 1_00_00_000).toFixed(1);
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return (Date.now() - t) / (1000 * 60 * 60);
}

function exportCsv(rows, filename = "nse_swing_scan.csv") {
  if (!rows.length) return;
  const cols = [
    "symbol", "company_name", "industry", "gate_pass", "swing_score",
    "current_price", "pct_off_52wk_high", "rsi14", "atr14",
    "entry_zone_low", "entry_zone_high", "stop_loss", "target_1", "target_2",
    "risk_reward_target_1", "risk_reward_target_2",
    "delivery_value_inr", "delivery_qty", "delivery_pct", "delivery_as_of",
    "surveillance_is_restricted", "surveillance_restriction_type", "surveillance_source_status",
    "holdings_promoter_pct", "holdings_fii_pct", "holdings_dii_pct", "holdings_conviction_pct",
    "pending_corporate_action", "f_score", "trailing_pe", "avg_pe_5y", "gate_fail_reason",
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(r[c])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | passed
  const [sortKey, setSortKey] = useState("swing_score");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  const isAdmin =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("admin") === "1";

  const [adminSecret, setAdminSecret] = useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ADMIN_SECRET_LS_KEY) || null;
  });
  const [lastTriggerAt, setLastTriggerAt] = useState(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(ADMIN_LAST_TRIGGER_LS_KEY);
    return v ? Number(v) : null;
  });
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState(null);
  const [triggerError, setTriggerError] = useState(null);

  useEffect(() => {
    fetch("/data/latest_scan.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.stocks;
    if (filter === "passed") r = r.filter((s) => s.gate_pass);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      r = r.filter(
        (s) =>
          s.symbol?.toUpperCase().includes(q) ||
          s.company_name?.toUpperCase().includes(q) ||
          s.industry?.toUpperCase().includes(q)
      );
    }
    const sorted = [...r].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [data, search, filter, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function onRowKey(e, symbol) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded(expanded === symbol ? null : symbol);
    }
  }

  function cooldownRemainingMs() {
    if (!lastTriggerAt) return 0;
    const elapsed = Date.now() - lastTriggerAt;
    return Math.max(0, ADMIN_COOLDOWN_MS - elapsed);
  }

  function fmtCooldown(ms) {
    const min = Math.ceil(ms / 60000);
    return `${min} min`;
  }

  async function runScanNow() {
    setTriggerError(null);
    setTriggerStatus(null);

    const remaining = cooldownRemainingMs();
    if (remaining > 0) {
      setTriggerError(`Cooldown active — try again in ${fmtCooldown(remaining)}.`);
      return;
    }

    let secret = adminSecret;
    if (!secret) {
      const entered = window.prompt("Admin scan secret");
      if (!entered) return;
      secret = entered.trim();
      localStorage.setItem(ADMIN_SECRET_LS_KEY, secret);
      setAdminSecret(secret);
    }

    setTriggerBusy(true);
    try {
      const res = await fetch("/.netlify/functions/trigger-scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.status === 401) {
        localStorage.removeItem(ADMIN_SECRET_LS_KEY);
        setAdminSecret(null);
        setTriggerError("Invalid admin secret. Stored secret cleared.");
        return;
      }
      if (res.status === 202) {
        const now = Date.now();
        localStorage.setItem(ADMIN_LAST_TRIGGER_LS_KEY, String(now));
        setLastTriggerAt(now);
        setTriggerStatus("queued");
        return;
      }
      setTriggerError("Scan trigger failed. Check Netlify function logs.");
    } catch (e) {
      setTriggerError(`Scan trigger failed: ${e.message}`);
    } finally {
      setTriggerBusy(false);
    }
  }

  function forgetAdminSecret() {
    localStorage.removeItem(ADMIN_SECRET_LS_KEY);
    setAdminSecret(null);
    setTriggerError(null);
    setTriggerStatus(null);
  }

  if (error) {
    return (
      <div className="app">
        <div className="empty-state" role="alert">
          <h2>Scan data not found</h2>
          <p>
            Could not load <code>/data/latest_scan.json</code> ({error}). If
            this is a fresh deploy, the first GitHub Actions run hasn't
            completed yet — trigger it manually from the Actions tab, or wait
            for the next scheduled run.
          </p>
        </div>
      </div>
    );
  }

  if (data && data._placeholder) {
    return (
      <div className="app">
        <header className="ticker-header">
          <h1>NSE Swing Scanner</h1>
        </header>
        <div className="empty-state" role="status" aria-live="polite">
          <h2>First scan in progress…</h2>
          <p>
            The scheduled GitHub Actions scan is still running. The dashboard
            will populate with results automatically once the scan finishes and
            commits <code>latest_scan.json</code>. Initial runs take
            ~20-35 minutes (Screener.in shareholding scraping is the slow
            part); subsequent scheduled runs are faster thanks to the on-disk
            cache.
          </p>
          <p>
            You can watch progress on the
            {" "}<a href="https://github.com/amitashwinibhagat/nse-swing-scanner/actions/workflows/scan.yml">Actions tab</a>.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <div className="empty-state" role="status" aria-live="polite">
          <h2>Loading latest scan…</h2>
        </div>
      </div>
    );
  }

  const generatedAt = new Date(data.generated_at);
  const stale = hoursSince(data.generated_at) > STALE_HOURS;

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-top">
          <div className="hero-title">
            <h1>NSE Swing Scanner</h1>
            <p className="hero-sub">
              {data.universe_size}-stock universe · 7 hard gates · Free data, transparent scoring
            </p>
          </div>
          <div className="kpi-row">
            <Kpi label="Universe" value={data.universe_size} />
            <Kpi
              label="Gate-passed"
              value={data.gate_pass_count}
              delta={`${((data.gate_pass_count / data.universe_size) * 100).toFixed(1)}% of universe`}
              accent="success"
            />
            <Kpi
              label={stale ? `Stale (>${STALE_HOURS}h)` : "Last scan"}
              value={`${generatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ${generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`}
              accent={stale ? "danger" : "accent"}
            />
          </div>
        </div>

        <div className="filter-bar">
          <label className="search-wrap">
            <IconSearch />
            <input
              id="search"
              type="text"
              placeholder="Filter by symbol, company, sector…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                {"×"}
              </button>
            )}
          </label>
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            ariaLabel="Stock filter"
            options={[
              { value: "all", label: `All · ${data.stocks.length}` },
              { value: "passed", label: `Passed · ${data.gate_pass_count}` },
            ]}
          />
          <button
            className="export-pill"
            onClick={() => exportCsv(rows)}
            title="Export current view as CSV"
          >
            <IconDownload />
            <span>Export CSV</span>
          </button>
        </div>
      </header>

      {stale && (
        <div className="stale-banner" role="status">
          Scan data is older than {STALE_HOURS} hours. The scheduled GitHub Action
          may have failed — check the Actions tab.
        </div>
      )}

      {isAdmin && (
        <div className="admin-controls" role="region" aria-label="Admin controls">
          <button
            className="admin-button"
            onClick={runScanNow}
            disabled={triggerBusy || cooldownRemainingMs() > 0}
            aria-busy={triggerBusy}
          >
            {triggerBusy ? "Queuing…" : "Run scan now"}
          </button>
          {adminSecret && (
            <button
              className="admin-button secondary"
              onClick={forgetAdminSecret}
              title="Clear the locally stored admin secret"
            >
              Forget admin secret
            </button>
          )}
          {cooldownRemainingMs() > 0 && (
            <span className="admin-status">
              Cooldown: {fmtCooldown(cooldownRemainingMs())} remaining
            </span>
          )}
          {triggerStatus === "queued" && (
            <span className="admin-status">
              Scan queued/running. Typical runtime is 20-35 minutes. Watch
              progress on{" "}
              <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
                GitHub Actions
              </a>
              .
            </span>
          )}
          {triggerError && (
            <span className="admin-error" role="alert">{triggerError}</span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <h2>No stocks match</h2>
          <p>Try clearing the filter or search term.</p>
        </div>
      ) : (
        <table className="scan-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={sortKey === c.key ? "sorted" : ""}
                  onClick={() => toggleSort(c.key)}
                  scope="col"
                  aria-sort={
                    sortKey === c.key
                      ? sortDir === "asc" ? "ascending" : "descending"
                      : "none"
                  }
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.symbol}>
                <tr
                  onClick={() => setExpanded(expanded === s.symbol ? null : s.symbol)}
                  onKeyDown={(e) => onRowKey(e, s.symbol)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={expanded === s.symbol}
                  aria-label={`${s.symbol} ${s.company_name} — ${s.gate_pass ? "pass" : "fail"}`}
                >
                  <td className="symbol-cell">
                    {s.symbol}
                    <span className="company">{s.company_name}</span>
                  </td>
                  <td>
                    <span className={`gate-badge ${s.gate_pass ? "pass" : "fail"}`}>
                      {s.gate_pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="score-cell">{s.swing_score ?? <span className="na">—</span>}</td>
                  <td>{fmtPrice(s.current_price)}</td>
                  <td>{fmtSigned(s.pct_off_52wk_high)}</td>
                  <td>{fmt(s.rsi14, 1)}</td>
                  <td>{fmtPrice(s.target_1)}</td>
                  <td>{fmtPrice(s.stop_loss)}</td>
                  <td>{fmtCr(s.delivery_value_inr)}</td>
                  <td>{fmt(s.holdings_conviction_pct, 1, "%")}</td>
                  <td>{s.f_score ?? <span className="na">—</span>}/9</td>
                  <td>
                    {s.avg_pe_5y != null && s.trailing_pe != null
                      ? `${s.trailing_pe.toFixed(1)} / ${s.avg_pe_5y.toFixed(1)}`
                      : <span className="na">—</span>}
                  </td>
                </tr>
                {expanded === s.symbol && (
                  <tr className="detail-row">
                    <td colSpan={COLUMNS.length}>
                      <div className="detail-panel">
                        <div className="detail-grid">
                          <div>
                            <h4>Hard gates</h4>
                            <ul className="kv">
                              <li><span>F-Score</span><b>{s.f_score ?? "—"}/9</b></li>
                              <li><span>Delivery (₹cr)</span><b>{fmtCr(s.delivery_value_inr)}</b></li>
                              <li><span>Holdings conviction</span><b>{fmt(s.holdings_conviction_pct, 1, "%")}</b></li>
                              <li><span>T-group / suspension</span><b>{s.surveillance_is_restricted ? `YES (${s.surveillance_restriction_type})` : "no"}</b></li>
                              <li><span>Pending corporate action</span><b>{s.pending_corporate_action ? "YES" : "no"}</b></li>
                            </ul>
                          </div>
                          <div>
                            <h4>ATR plan</h4>
                            <ul className="kv">
                              <li><span>ATR(14)</span><b>{fmtPrice(s.atr14)}</b></li>
                              <li><span>Entry zone</span><b>{s.entry_zone_low != null ? `${fmtPrice(s.entry_zone_low)} – ${fmtPrice(s.entry_zone_high)}` : "—"}</b></li>
                              <li><span>Stop</span><b>{fmtPrice(s.stop_loss)}</b></li>
                              <li><span>Target 1 (R:R)</span><b>{fmtPrice(s.target_1)} ({s.risk_reward_target_1?.toFixed(2) ?? "—"})</b></li>
                              <li><span>Target 2 (R:R)</span><b>{fmtPrice(s.target_2)} ({s.risk_reward_target_2?.toFixed(2) ?? "—"})</b></li>
                            </ul>
                          </div>
                          <div>
                            <h4>Source status</h4>
                            <ul className="kv">
                              <li><span>Delivery</span><b className={`src-${s.delivery_source_status || "missing"}`}>{s.delivery_source_status || "missing"}</b></li>
                              <li><span>Surveillance</span><b className={`src-${s.surveillance_source_status || "missing"}`}>{s.surveillance_source_status || "missing"}</b></li>
                              <li><span>Holdings</span><b className={`src-${s.holdings_source_status || "missing"}`}>{s.holdings_source_status || "missing"}</b></li>
                              <li><span>Corp actions</span><b className={`src-${s.corporate_actions_status || "missing"}`}>{s.corporate_actions_status || "missing"}</b></li>
                              <li><span>Nifty 50 vs 200EMA</span><b>{fmtSigned(s.market_index_pct_from_ema200)}</b></li>
                            </ul>
                          </div>
                        </div>
                        {!s.gate_pass && s.gate_fail_reason && (
                          <div className="fail-reason">Gate fail: {s.gate_fail_reason}</div>
                        )}
                        <SubscoreBars subScores={s.sub_scores} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <div className="footer-note">
        Screening layer only — not investment advice, not a buy/sell signal.
        Not SEBI-registered research. Free data sources: yfinance (price),
        NSE bhavcopy (delivery), Screener.in (holdings), NSE corporate filings.
        Spot-check any candidate against the source provider before acting.
        See <code>docs/methodology.md</code> and the Limitations section in
        the README for the full list of assumptions and source fragility.
      </div>
    </div>
  );
}

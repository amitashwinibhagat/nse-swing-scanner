import { Fragment, useEffect, useMemo, useState } from "react";
import Kpi from "./components/Kpi.jsx";
import SegmentedControl from "./components/SegmentedControl.jsx";
import SubscoreBars from "./components/SubscoreBars.jsx";
import StockCard from "./components/StockCard.jsx";
import DetailDrawer from "./components/DetailDrawer.jsx";
import { SkeletonGrid } from "./components/Skeleton.jsx";
import Rationale from "./components/Rationale.jsx";
import DeltaStrip from "./components/DeltaStrip.jsx";
import PerformanceSection from "./components/PerformanceSection.jsx";
import useWatchlist from "./utils/useWatchlist.js";
import { computeEntryState, confirmationChip, earningsChip, regimeFromMarketIndex, relativeStrengthFactor } from "./utils/scanPlan.js";

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

function IconGrid() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3"  y="3"  width="6" height="6" rx="1.2" />
      <rect x="11" y="3"  width="6" height="6" rx="1.2" />
      <rect x="3"  y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="1.2" />
      <path d="M3 9h14" />
      <path d="M9 4v12" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M16.5 12.5A6.5 6.5 0 0 1 7.5 3.5a6.5 6.5 0 1 0 9 9Z" strokeLinejoin="round" />
    </svg>
  );
}

const THEME_LS_KEY = "nseSwingTheme";
const VIEW_LS_KEY = "nseSwingViewMode";
const FILTER_LS_KEY = "nseSwingFilter";
const SCAN_STATUS_URL = "/data/scan_status.json";
const VALID_FILTERS = ["all", "passed", "watchlist"];

const COLUMNS = [
  { key: "symbol", label: "Stock" },
  { key: "gate_pass", label: "Gate" },
  { key: "swing_score", label: "Score" },
  { key: "current_price", label: "Price" },
  { key: "pct_off_52wk_high", label: "% off 52W" },
  { key: "rsi14", label: "RSI-14" },
  { key: "target_1", label: "T1" },
  { key: "stop_loss", label: "Stop" },
  { key: "adv_value_inr", label: "ADV (₹cr)" },
  { key: "holdings_conviction_pct", label: "Hold %" },
  { key: "f_score", label: "F-Score" },
  { key: "trailing_pe", label: "P/E (T / 5Y)" },
];

const STALE_HOURS = 18;
const STALE_GRACE_MS = 30 * 60 * 1000;
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

function fmtRelativeAge(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

function fmtDrift(status) {
  if (!status || status.drift_minutes == null) return "";
  if (status.drift_minutes === 0) return "on schedule";
  return `${status.drift_minutes} min late`;
}

function freshnessAccent(iso) {
  const h = hoursSince(iso);
  if (h < 14) return "success";
  if (h < 20) return "warning";
  return "danger";
}

function computeStale(generatedAt, scanStatus) {
  const next = scanStatus && scanStatus.next_expected_utc;
  if (next) {
    return Date.now() > new Date(next).getTime() + STALE_GRACE_MS;
  }
  return hoursSince(generatedAt) > STALE_HOURS;
}

function exportCsv(rows, filename = "nse_swing_scan.csv") {
  if (!rows.length) return;
  const cols = [
    "symbol", "company_name", "industry", "gate_pass", "swing_score",
    "current_price", "pct_off_52wk_high", "rsi14", "atr14",
    "entry_zone_low", "entry_zone_high", "stop_loss", "target_1", "target_2",
    "risk_reward_target_1", "risk_reward_target_2",
    "adv_value_inr", "adv_sessions", "liquidity_gate_path",
    "surveillance_is_restricted", "surveillance_restriction_type", "surveillance_source_status",
    "holdings_promoter_pct", "holdings_fii_pct", "holdings_dii_pct", "holdings_conviction_pct",
    "pending_corporate_action", "f_score", "trailing_pe", "avg_pe_5y", "gate_fail_reason",
    // B3/B4 additions
    "gate_results", "earnings_date", "earnings_within_days", "earnings_source_status",
    // 1.3.0 accuracy plumbing
    "confirmation_state", "rsi_delta_3d", "close_up_1d", "vol_ratio_3v20",
    "swing_high_63d", "atr_expansion_ratio",
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
  const [scanStatus, setScanStatus] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(() => {
    if (typeof window === "undefined") return "all";
    try {
      const v = localStorage.getItem(FILTER_LS_KEY);
      return VALID_FILTERS.includes(v) ? v : "all";
    } catch {
      return "all";
    }
  }); // all | passed | watchlist
  const [sortKey, setSortKey] = useState("swing_score");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  // Admin UI is rendered when either:
  //   - the URL has ?admin=1 (or ?admin=true) as a query string, OR
  //   - the path is /admin or /admin/ (with optional trailing slash).
  // The path form is friendlier to type/bookmark; the query-string form
  // remains supported and is what the README documents.
  const isAdmin = (() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("admin");
    if (q === "1" || q === "true") return true;
    const path = window.location.pathname.replace(/\/+$/, "");
    return path === "/admin" || path.endsWith("/admin");
  })();

  const [adminSecret, setAdminSecret] = useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ADMIN_SECRET_LS_KEY) || null;
  });

  // Theme: dark default; respects localStorage, falls back to system pref
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem(THEME_LS_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });

  // View mode: cards default; persisted
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "cards";
    const stored = localStorage.getItem(VIEW_LS_KEY);
    return stored === "cards" || stored === "table" ? stored : "cards";
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

  useEffect(() => {
    fetch(SCAN_STATUS_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((s) => {
        if (s && s.generated_at) setScanStatus(s);
      })
      .catch(() => {
        // scan_status.json is best-effort; missing/invalid falls back to
        // deriving freshness from latest_scan.json's generated_at.
      });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_LS_KEY, theme); } catch {}
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_LS_KEY, viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_LS_KEY, filter); } catch {}
  }, [filter]);

  const watchlist = useWatchlist();

  const regime = useMemo(() => {
    if (!data) return null;
    for (const s of data.stocks) {
      if (typeof s.market_index_pct_from_ema200 === "number") {
        return regimeFromMarketIndex(s.market_index_pct_from_ema200);
      }
    }
    return null;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.stocks;
    if (filter === "passed") r = r.filter((s) => s.gate_pass);
    if (filter === "watchlist") r = r.filter((s) => watchlist.has(s.symbol));
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
      // Pin watchlist symbols to the top when the user is browsing the
      // passed list — helps a returning user see what they care about first.
      const aw = watchlist.has(a.symbol) ? 1 : 0;
      const bw = watchlist.has(b.symbol) ? 1 : 0;
      if (aw !== bw) return bw - aw;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [data, search, filter, sortKey, sortDir, watchlist.symbols]);

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
        setTriggerError(
          "Invalid admin secret. Recover it from Netlify env var SCAN_TRIGGER_SECRET, or trigger directly with: gh workflow run scan.yml --repo amitashwinibhagat/nse-swing-scanner"
        );
        return;
      }
      if (res.status === 202) {
        const now = Date.now();
        localStorage.setItem(ADMIN_LAST_TRIGGER_LS_KEY, String(now));
        setLastTriggerAt(now);
        setTriggerStatus("queued");
        return;
      }
      let detail = "Check Netlify function logs.";
      try {
        const body = await res.json();
        if (body && body.error) detail = `Server error: ${body.error}.`;
      } catch {}
      setTriggerError(`Scan trigger failed (HTTP ${res.status}). ${detail}`);
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
        <header className="hero">
          <div className="hero-top">
            <div className="hero-title">
              <h1>NSE Swing Scanner</h1>
              <p className="hero-sub">Loading latest scan…</p>
            </div>
          </div>
        </header>
        <SkeletonGrid n={6} />
      </div>
    );
  }

  const generatedAt = new Date(data.generated_at);
  const stale = computeStale(data.generated_at, scanStatus);

  const relativeAge = fmtRelativeAge(data.generated_at);
  const driftNote = fmtDrift(scanStatus);
  const driftSuffix = scanStatus && scanStatus.scheduled_window_utc
    ? ` (${scanStatus.scheduled_window_utc} UTC)`
    : "";
  const freshnessDelta = [
    relativeAge,
    driftNote ? `• ${driftNote}${driftSuffix}` : "",
  ].filter(Boolean).join(" ");

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
            {regime && (
              <Kpi
                label="Regime"
                value={regime.label}
                delta={regime.value}
                accent={regime.tone}
                title="Nifty 50 distance to its 200-day EMA, computed at scan time."
              />
            )}
            <Kpi
              label="Last scan"
              value={`${generatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ${generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`}
              delta={freshnessDelta || undefined}
              accent={freshnessAccent(data.generated_at)}
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
              { value: "watchlist", label: `Watchlist · ${watchlist.symbols.length}` },
            ]}
          />
          <div className="icon-group">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                aria-pressed={viewMode === "cards"}
                onClick={() => setViewMode("cards")}
                title="Card view"
                aria-label="Card view"
              >
                <IconGrid />
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "table"}
                onClick={() => setViewMode("table")}
                title="Table view"
                aria-label="Table view"
              >
                <IconTable />
              </button>
            </div>
          </div>
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
          {scanStatus && scanStatus.next_expected_utc ? (
            <>
              No fresh scan since {fmtRelativeAge(data.generated_at)}. The
              next scheduled scan was due{" "}
              {fmtRelativeAge(scanStatus.next_expected_utc)} and did not
              arrive — check the{" "}
              <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
                Actions tab
              </a>
              .
            </>
          ) : (
            <>
              Scan data is older than {STALE_HOURS} hours. The scheduled
              GitHub Action may have failed — check the{" "}
              <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
                Actions tab
              </a>
              .
            </>
          )}
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
        <>
          <DeltaStrip
            currentGeneratedAt={data.generated_at}
            stocks={rows}
            watchlist={watchlist}
          />
          {viewMode === "cards" ? (
        <>
          <div className="stock-grid">
            {rows.map((s) => (
              <StockCard
                key={s.symbol}
                stock={s}
                expanded={expanded === s.symbol}
                onToggle={() => setExpanded(expanded === s.symbol ? null : s.symbol)}
                watchlist={watchlist}
              />
            ))}
          </div>
          {expanded && (() => {
            const s = rows.find((r) => r.symbol === expanded);
            return s ? (
              <DetailDrawer
                stock={s}
                onClose={() => setExpanded(null)}
                watchlist={watchlist}
                scanDate={data.generated_at}
              />
            ) : null;
          })()}
        </>
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
                    <span className="symbol-line">
                      {s.symbol}
                      <button
                        type="button"
                        className={`watch-star sm ${watchlist.has(s.symbol) ? "on" : ""}`}
                        onClick={(e) => { e.stopPropagation(); watchlist.toggle(s.symbol); }}
                        aria-pressed={watchlist.has(s.symbol)}
                        aria-label={
                          watchlist.has(s.symbol)
                            ? `Remove ${s.symbol} from watchlist`
                            : `Add ${s.symbol} to watchlist`
                        }
                        title={watchlist.has(s.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                      >
                        <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                          <path
                            d="M10 2.5l2.47 5 5.53.8-4 3.9.94 5.5L10 14.98 5.06 17.7l.94-5.5-4-3.9 5.53-.8L10 2.5z"
                            fill={watchlist.has(s.symbol) ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </span>
                    <span className="company">{s.company_name}</span>
                    {(() => {
                      const es = computeEntryState(s);
                      if (!es) return null;
                      return (
                        <span
                          className={`entry-state sm entry-${es.tone}`}
                          title={es.tooltip}
                        >
                          <span className="entry-state-dot" aria-hidden="true" />
                          {es.label}
                        </span>
                      );
                    })()}
                    {(() => {
                      const ea = earningsChip(s);
                      if (!ea) return null;
                      return (
                        <span
                          className={`entry-state sm entry-${ea.tone}`}
                          title={ea.tooltip}
                        >
                          <span className="entry-state-dot" aria-hidden="true" />
                          {ea.label}
                        </span>
                      );
                    })()}
                    {(() => {
                      const cf = confirmationChip(s);
                      if (!cf) return null;
                      return (
                        <span
                          className={`entry-state sm entry-${cf.tone}`}
                          title={cf.tooltip}
                        >
                          <span className="entry-state-dot" aria-hidden="true" />
                          {cf.label}
                        </span>
                      );
                    })()}
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
                  <td title={`20-day average traded value from yfinance (sessions: ${s.adv_sessions ?? 0}). Used by the liquidity hard gate.`}>
                    {fmtCr(s.adv_value_inr)}
                  </td>
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
                              <li>
                                <span>Liquidity / ADV (₹cr){s.liquidity_gate_path && <span className="gate-path"> {s.liquidity_gate_path}</span>}</span>
                                <b>{fmtCr(s.adv_value_inr)}</b>
                              </li>
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
                        <SubscoreBars
                          subScores={s.sub_scores}
                          marketCorrectionFactor={relativeStrengthFactor(
                            s.pct_from_ema200,
                            s.market_index_pct_from_ema200,
                          )}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
          )}
        </>
      )}

      <Rationale />

      <PerformanceSection />

      <div className="footer-note">
        Screening layer only — not investment advice, not a buy/sell signal.
        Not SEBI-registered research. Free data sources: yfinance (price),
        NSE bhavcopy (delivery), Screener.in (holdings), NSE corporate filings.
        Spot-check any candidate against the source provider before acting.
        See the <a href="/methodology.html">Methodology page</a> for the full
        list of assumptions, scoring formula, and source fragility.
      </div>

      <div className="byline">
        An experimental product of{" "}
        <a
          href="https://www.datadab.com"
          target="_blank"
          rel="noreferrer"
        >
          DataDab LLP
        </a>
        .
      </div>
    </div>
  );
}

"""
performance.py
Forward-return attribution for the gate-passed cohort of each historical
snapshot. Implements the C1 plan item.

Statistical rules (per the strategic review §6 — non-negotiable):
  - Report per-scan-date cohorts, not pooled per-name rows (avoid the
    apparent N-inflation from overlapping T+20 windows across consecutive
    scans).
  - Report N per cohort, median + IQR (not just mean — small samples
    and skewed distributions make means misleading).
  - Mark untrackable symbols (delisted / suspended / yfinance fetch
    failed) as a separate bucket; never silently drop them.
  - Compute excess return per-name vs ^NSEI over the same window — pooled
    stock returns without subtracting the index overstate hit rate in
    bull regimes and understate it in bear regimes.

Cohorts: T+5, T+10, T+20 trading sessions from the snapshot date.
Trailing window: matches snapshot retention (90 days).

This module is import-safe (no yfinance dependency at import time) so
it can be tested without network access.
"""
from __future__ import annotations

import datetime
import json
import os
import statistics
from typing import Dict, List, Optional, Tuple

# Trading days to evaluate at. T+5/T+10/T+20 covers short and medium swing
# windows; widen cautiously — small-sample noise grows fast.
WINDOWS = [5, 10, 20]


def _percentile(sorted_vals: List[float], p: float) -> Optional[float]:
    """Linear-interpolated percentile (no numpy). p in [0, 100]."""
    n = len(sorted_vals)
    if n == 0:
        return None
    if n == 1:
        return sorted_vals[0]
    k = (p / 100) * (n - 1)
    f = int(k)
    c = min(f + 1, n - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def cohort_stats(returns_pct: List[float]) -> dict:
    """
    Median + IQR + N for one cohort. Returns None when empty.
    """
    if not returns_pct:
        return {"n": 0, "median": None, "q1": None, "q3": None, "mean": None}
    s = sorted(returns_pct)
    median = statistics.median(s)
    mean = statistics.fmean(s)
    # Linear interpolation on the sorted list. statistics.quantiles uses
    # method='inclusive' (matches numpy default) for IQR comparability.
    q1 = _percentile(s, 25)
    q3 = _percentile(s, 75)
    return {
        "n": len(s),
        "median": round(median, 2),
        "q1": round(q1, 2) if q1 is not None else None,
        "q3": round(q3, 2) if q3 is not None else None,
        "mean": round(mean, 2),
    }


def score_bucket(score: Optional[float]) -> str:
    if not isinstance(score, (int, float)):
        return "unknown"
    if score >= 80:
        return "80+"
    if score >= 70:
        return "70-79"
    if score >= 60:
        return "60-69"
    return "<60"


def _window_label(window: int) -> str:
    return f"T+{window}"


def build_performance_payload(
    snapshots: List[Tuple[str, dict]],
    forward_returns: Dict[Tuple[str, str], Dict[int, dict]],
    *,
    retention_days: int = 90,
) -> dict:
    """
    Combine snapshot metadata with pre-computed forward returns into the
    `data/performance.json` payload.

    Args:
      snapshots: list of (snapshot_label, scan_payload) e.g.
                 [("2026-07-18-pm", {...}), ...] sorted ascending.
      forward_returns: dict keyed by (snapshot_label, symbol) -> {5: {...},
                 10: {...}, 20: {...}}. Each per-window dict has shape
                 {"stock_return_pct": float|None,
                  "index_return_pct": float|None,
                  "excess_return_pct": float|None,
                  "untrackable": bool,
                  "reason": str|None}.

    Returns a JSON-serialisable dict with three sections:
      - per_window: aggregated stats by (window, score_bucket)
      - per_scan:   per-snapshot cohort stats (by window)
      - meta:       config + count of untrackable symbols
    """
    per_window_buckets: Dict[int, Dict[str, List[float]]] = {
        w: {"80+": [], "70-79": [], "60-69": [], "<60": [], "unknown": []}
        for w in WINDOWS
    }
    per_window_untrackable: Dict[int, int] = {w: 0 for w in WINDOWS}
    per_scan: List[dict] = []

    for label, scan in snapshots:
        passed = [s for s in scan.get("stocks", []) if s.get("gate_pass")]
        bucket_excess: Dict[int, Dict[str, List[float]]] = {
            w: {"80+": [], "70-79": [], "60-69": [], "<60": [], "unknown": []}
            for w in WINDOWS
        }
        for s in passed:
            sym = s.get("symbol")
            key = (label, sym)
            fetches = forward_returns.get(key, {})
            bucket = score_bucket(s.get("swing_score"))
            for w in WINDOWS:
                fr = fetches.get(w)
                if not fr or fr.get("untrackable") or fr.get("excess_return_pct") is None:
                    per_window_untrackable[w] += 1
                    continue
                excess = fr["excess_return_pct"]
                per_window_buckets[w][bucket].append(excess)
                bucket_excess[w][bucket].append(excess)

        cohort_summary = {"date": label, "passed_count": len(passed), "windows": {}}
        for w in WINDOWS:
            all_excess: List[float] = []
            for vals in bucket_excess[w].values():
                all_excess.extend(vals)
            cohort_summary["windows"][_window_label(w)] = {
                "n": len(all_excess),
                "stats": cohort_stats(all_excess),
            }
        per_scan.append(cohort_summary)

    out_windows = {}
    for w in WINDOWS:
        bucket_stats = {}
        for b, vals in per_window_buckets[w].items():
            bucket_stats[b] = cohort_stats(vals)
        out_windows[_window_label(w)] = {
            "buckets": bucket_stats,
            "untrackable_count": per_window_untrackable[w],
        }

    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "retention_days": retention_days,
        "windows": out_windows,
        "per_scan": per_scan,
        "meta": {
            "snapshots_used": len(snapshots),
            "total_passed": sum(len([s for s in scan.get("stocks", []) if s.get("gate_pass")]) for _, scan in snapshots),
            "windows": WINDOWS,
        },
    }


def write_performance_payload(payload: dict, output_path: str) -> None:
    """Pretty-print; the file is human-readable and small."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


# --- Live forward-return computation (yfinance) -----------------------------

def fetch_forward_returns(
    snapshots: List[Tuple[str, dict]],
    *,
    cache_dir: Optional[str] = None,
    no_cache: bool = False,
) -> Dict[Tuple[str, str], Dict[int, dict]]:
    """
    For each (snapshot_label, symbol) where the stock gate-passed, fetch
    the closing prices at snapshot_date, snapshot_date + W, and the Nifty
    (^NSEI) close at the same dates. Compute per-name excess returns.

    Returns: dict keyed by (label, symbol) -> {window: per-window dict}.

    Per-window dict:
      {
        "stock_return_pct":  float | None,
        "index_return_pct":  float | None,
        "excess_return_pct": float | None,
        "untrackable":       bool,
        "reason":            str | None,
      }
    """
    import yfinance as yf  # deferred — keeps this module import-safe for tests

    cache_path = os.path.join(cache_dir, "performance_prices.json") if cache_dir else None
    prices_cache: Dict[str, dict] = {}
    if cache_path and os.path.exists(cache_path) and not no_cache:
        try:
            with open(cache_path, "r") as f:
                prices_cache = json.load(f)
        except (OSError, json.JSONDecodeError):
            prices_cache = {}

    out: Dict[Tuple[str, str], Dict[int, dict]] = {}

    for label, scan in snapshots:
        generated_at = scan.get("generated_at", "")[:10]   # YYYY-MM-DD
        try:
            scan_date = datetime.date.fromisoformat(generated_at)
        except ValueError:
            continue
        # Fetch end date covers T+20 plus weekends/holidays buffer (~33 cal days)
        end_date = scan_date + datetime.timedelta(days=33)

        passed = [s for s in scan.get("stocks", []) if s.get("gate_pass")]
        if not passed:
            continue

        tickers = sorted({s.get("yf_ticker") or f"{s.get('symbol')}.NS" for s in passed})
        # Include Nifty for the index benchmark
        all_tickers = tickers + ["^NSEI"]

        # Fetch closes once per (date, ticker). Cache by ticker.
        closes_by_ticker: Dict[str, Dict[str, float]] = {}
        for tk in all_tickers:
            cached_entry = prices_cache.get(tk)
            if (
                cached_entry
                and cached_entry.get("end_date") == end_date.isoformat()
                and not no_cache
            ):
                closes_by_ticker[tk] = cached_entry.get("closes", {})
                continue
            try:
                df = yf.download(
                    tk,
                    start=scan_date.isoformat(),
                    end=end_date.isoformat(),
                    progress=False,
                    auto_adjust=True,
                )
                if df is None or df.empty or "Close" not in df.columns:
                    closes_by_ticker[tk] = {}
                else:
                    closes_by_ticker[tk] = {
                        idx.strftime("%Y-%m-%d"): float(row["Close"])
                        for idx, row in df.iterrows()
                    }
            except Exception as e:
                closes_by_ticker[tk] = {}
            prices_cache[tk] = {
                "end_date": end_date.isoformat(),
                "closes": closes_by_ticker[tk],
            }

        if cache_path:
            try:
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                with open(cache_path, "w") as f:
                    json.dump(prices_cache, f, indent=2)
            except OSError:
                pass

        def _pick_close(tk: str, target: datetime.date) -> Optional[float]:
            series = closes_by_ticker.get(tk) or {}
            # Walk forward up to 7 calendar days to tolerate weekends/holidays.
            for offset in range(0, 8):
                d = target + datetime.timedelta(days=offset)
                v = series.get(d.isoformat())
                if v is not None:
                    return v
            return None

        index_closes = closes_by_ticker.get("^NSEI", {})
        index_start = _pick_close("^NSEI", scan_date)

        for s in passed:
            sym = s.get("symbol")
            tk = s.get("yf_ticker") or f"{sym}.NS"
            stock_start = _pick_close(tk, scan_date)
            per_window: Dict[int, dict] = {}
            for w in WINDOWS:
                target = scan_date + datetime.timedelta(days=int(w * 365 / 252 + 2))
                # Convert trading-day offset to ~calendar days; +2 buffer for
                # weekends/holidays. _pick_close then walks forward up to 7
                # days to land on a real trading session.
                stock_end = _pick_close(tk, target)
                index_end = _pick_close("^NSEI", target)

                if stock_start is None or stock_end is None:
                    per_window[w] = {
                        "stock_return_pct": None,
                        "index_return_pct": None,
                        "excess_return_pct": None,
                        "untrackable": True,
                        "reason": "missing_stock_price",
                    }
                    continue
                sr = (stock_end / stock_start - 1) * 100
                if index_start is None or index_end is None:
                    per_window[w] = {
                        "stock_return_pct": round(sr, 2),
                        "index_return_pct": None,
                        "excess_return_pct": None,
                        "untrackable": False,
                        "reason": "missing_index_price",
                    }
                    continue
                ir = (index_end / index_start - 1) * 100
                per_window[w] = {
                    "stock_return_pct": round(sr, 2),
                    "index_return_pct": round(ir, 2),
                    "excess_return_pct": round(sr - ir, 2),
                    "untrackable": False,
                    "reason": None,
                }
            out[(label, sym)] = per_window

    return out
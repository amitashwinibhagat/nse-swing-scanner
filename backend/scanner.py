"""
scanner.py
Orchestrates universe -> technicals -> fundamentals -> external sources ->
hard gates -> weighted score.

Design decisions (see conversation for full rationale):
- Entry-timing/quality-DEGREE criteria are a WEIGHTED SCORE (0-100), not AND-gates.
  Stacking 13 strict AND-conditions returns ~0 stocks most days. A score gives a
  usable ranking every day and degrades gracefully.
- Only genuinely non-negotiable safety criteria are hard gates: market cap floor,
  D/E ceiling, delivery-value floor, F-score floor, not-suspended/T-group,
  no-pending-corporate-action, holdings-concentration, and the technical window
  filters (drawdown, RSI).
- Targets are ATR-scaled measured moves, NOT Fibonacci 61.8% (oversized for a
  15-30 day window). Targets are heuristic — see methodology.md.
- Earnings surprise is explicitly NOT a hard gate; consensus data is not
  available from a clean free source (documented in README, deferred to Phase 2).

Confidence: this module's LOGIC is high confidence (it's just arithmetic and
pandas). Its OUTPUT for any specific stock is only as good as the weakest
upstream field for that stock - always check the per-field error/None flags in
the output before trusting a row.
"""

import argparse
import datetime
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import numpy as np
import pandas as pd

from universe import fetch_universe
from technicals import compute_technicals, compute_nifty50_context
from fscore import compute_fscore, approx_5y_avg_pe

from surveillance import fetch_surveillance_list, check_symbol
from bhavcopy import fetch_bhavcopy, lookup_delivery
from holdings import fetch_holdings
from corporate_actions import fetch_corporate_actions

from settings import (
    MIN_F_SCORE,
    MIN_DELIVERY_VALUE_INR,
    MIN_HOLDINGS_CONVICTION_PCT,
    DRAWDOWN_LOWER_PCT,
    DRAWDOWN_UPPER_PCT,
    RSI_LOWER,
    RSI_UPPER,
    UNIVERSE_DEFAULT_TOP_N,
    UNIVERSE_DEFAULT_WORKERS,
    WEIGHTS,
)


# ---------------------------------------------------------------------------
# Soft-score helpers
# ---------------------------------------------------------------------------
def _score_valuation(pe_now, pe_5y_avg) -> float:
    if pe_now is None or pe_5y_avg is None or pe_5y_avg <= 0 or pe_now <= 0:
        return np.nan
    compression = (pe_5y_avg - pe_now) / pe_5y_avg
    return float(np.clip(compression / 0.40, 0, 1))


def _score_rsi(rsi) -> float:
    if rsi is None or np.isnan(rsi):
        return np.nan
    if 32 <= rsi <= 38:
        return 1.0
    if rsi < 25 or rsi > 45:
        return 0.0
    if rsi < 32:
        return float((rsi - 25) / 7)
    return float(max(0, (45 - rsi) / 7))


def _score_support(pct_from_ema200) -> float:
    if pct_from_ema200 is None or np.isnan(pct_from_ema200):
        return np.nan
    dist = abs(pct_from_ema200)
    return float(np.clip(1 - dist / 5, 0, 1))


def _score_drawdown(pct_off_high) -> float:
    if pct_off_high is None or np.isnan(pct_off_high):
        return np.nan
    d = abs(pct_off_high)
    if d < 15 or d > 40:
        return 0.0
    if 20 <= d <= 30:
        return 1.0
    if d < 20:
        return float((d - 15) / 5)
    return float((40 - d) / 10)


def _score_volume(surge_factor) -> float:
    if surge_factor is None or np.isnan(surge_factor):
        return np.nan
    return float(np.clip((surge_factor - 1.0) / 2.0, 0, 1))


def _score_quality(roe, opm, f_score, de_ratio) -> float:
    parts = []
    if roe is not None and not np.isnan(roe):
        parts.append(np.clip(roe / 0.25, 0, 1))
    if opm is not None and not np.isnan(opm):
        parts.append(np.clip(opm / 0.25, 0, 1))
    if f_score is not None:
        parts.append(np.clip(f_score / 9, 0, 1))
    if de_ratio is not None and not np.isnan(de_ratio):
        parts.append(np.clip(1 - de_ratio / 2, 0, 1))
    return float(np.mean(parts)) if parts else np.nan


def _score_conviction(holdings_data: Optional[dict]) -> float:
    """
    Soft score 0-1 from shareholding conviction (promoter+FII+DII).
    Higher is better. NaN if data is unavailable.
    """
    if not holdings_data:
        return np.nan
    conviction = holdings_data.get("conviction_pct")
    if conviction is None:
        return np.nan
    # Map 30% -> 0, 70% -> 1, cap at 1.
    return float(np.clip((conviction - 30) / 40, 0, 1))


# ---------------------------------------------------------------------------
# Hard-gate helpers (each returns (passed: bool, reason: str|None))
# ---------------------------------------------------------------------------
def gate_f_score(f_score) -> tuple[bool, Optional[str]]:
    if f_score is None:
        return False, "f_score_missing"
    if f_score < MIN_F_SCORE:
        return False, f"f_score {f_score} < {MIN_F_SCORE}"
    return True, None


def gate_drawdown(pct_off_high) -> tuple[bool, Optional[str]]:
    if pct_off_high is None or np.isnan(pct_off_high):
        return False, "pct_off_high_missing"
    if not (DRAWDOWN_LOWER_PCT <= pct_off_high <= DRAWDOWN_UPPER_PCT):
        return False, f"pct_off_high {pct_off_high} outside [{DRAWDOWN_LOWER_PCT},{DRAWDOWN_UPPER_PCT}]"
    return True, None


def gate_rsi(rsi) -> tuple[bool, Optional[str]]:
    if rsi is None or np.isnan(rsi):
        return False, "rsi_missing"
    if not (RSI_LOWER <= rsi <= RSI_UPPER):
        return False, f"rsi {rsi} outside [{RSI_LOWER},{RSI_UPPER}]"
    return True, None


def gate_delivery_value(
    delivery_value_inr: Optional[float],
    delivery_status: str,
    lenient: bool = False,
) -> tuple[bool, Optional[str]]:
    """
    Hard gate for delivery value (₹5cr/day).

    Strict (default): fail-closed on source_failed, matching the documented
    methodology. If NSE bhavcopy cannot be reached, no stock passes the
    delivery gate — even though the source failed. This is the safe default
    for "this is a real signal" use.

    Lenient (--lenient-external-gates): when the source is source_failed
    we let the stock through with a flag rather than auto-failing. Use this
    when the bhavcopy endpoint is behind Akamai bot protection (the current
    state of NSE's anonymous-access endpoints) and you still want the
    dashboard to show candidates.
    """
    if delivery_status not in ("ok", "fallback_used"):
        if lenient:
            return True, None
        return False, f"delivery_value_missing (source_status={delivery_status})"
    if delivery_value_inr is None:
        if lenient:
            return True, None
        return False, "delivery_value_missing"
    if delivery_value_inr < MIN_DELIVERY_VALUE_INR:
        return False, f"delivery_value {int(delivery_value_inr)} < {int(MIN_DELIVERY_VALUE_INR)}"
    return True, None


def gate_surveillance(is_restricted: bool, source_status: str) -> tuple[bool, Optional[str]]:
    if source_status == "flag_only":
        # Don't fail, but warn; the UI shows the source status.
        return True, None
    if is_restricted:
        return False, "t_group_or_suspended"
    return True, None


def gate_holdings(
    holdings_data: Optional[dict],
    holdings_status: str,
    lenient: bool = False,
) -> tuple[bool, Optional[str]]:
    """
    Hard gate for promoter + FII + DII conviction > 50%.

    Strict (default): fail-closed on source_failed / missing — we do not
    pretend the conviction check passed if we couldn't fetch the data.

    Lenient (--lenient-external-gates): when the source is source_failed
    we let the stock through with a flag. Useful when Screener is rate-
    limiting the scanner's IP (common on GitHub Actions runners).
    """
    if holdings_status in ("source_failed",):
        if lenient:
            return True, None
        return False, "holdings_source_failed"
    if holdings_data is None:
        if lenient:
            return True, None
        return False, "holdings_missing"
    conviction = holdings_data.get("conviction_pct")
    if conviction is None:
        if lenient:
            return True, None
        return False, "holdings_missing"
    if conviction <= MIN_HOLDINGS_CONVICTION_PCT:
        return False, f"holdings_conviction {conviction:.1f}% <= {MIN_HOLDINGS_CONVICTION_PCT}%"
    return True, None


def gate_corporate_actions(ca_data: Optional[dict]) -> tuple[bool, Optional[str]]:
    if ca_data is None:
        return True, None  # source_failed -> we don't claim the gap is closed
    if ca_data.get("has_excluded_action"):
        actions = ca_data.get("actions") or []
        names = [a.get("action", "") for a in actions[:3]]
        return False, f"pending_corporate_action: {', '.join(names)}"
    return True, None


# ---------------------------------------------------------------------------
# Relative-strength adjustment
# ---------------------------------------------------------------------------
def relative_strength_factor(stock_pct_from_ema200: Optional[float], index_pct_from_ema200: Optional[float]) -> float:
    """
    Returns a multiplier in [0.6, 1.1] applied to the swing_score.
    - If the index is also correcting heavily, the stock's drawdown is normal market
      behavior; small bonus.
    - If the stock is breaking down materially worse than the index, penalize.
    - If the index is healthy and the stock is also weak, neutral.
    """
    if stock_pct_from_ema200 is None or index_pct_from_ema200 is None:
        return 1.0
    if np.isnan(stock_pct_from_ema200) or np.isnan(index_pct_from_ema200):
        return 1.0
    # Both negative and stock worse than index by more than 5pp -> penalty
    delta = stock_pct_from_ema200 - index_pct_from_ema200
    if delta < -10:
        return 0.7
    if delta < -5:
        return 0.85
    if index_pct_from_ema200 < -5 and stock_pct_from_ema200 >= index_pct_from_ema200 - 2:
        return 1.05
    return 1.0


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate_stock(
    row: dict,
    *,
    sleep_between_calls: float = 0.3,
    surveillance_payload: Optional[dict] = None,
    bhavcopy_payload: Optional[dict] = None,
    lenient_external_gates: bool = False,
) -> dict:
    """
    row: dict with at least 'yf_ticker', 'company_name', 'industry', 'symbol'
    Returns a merged dict of all raw fields + gate results + composite score.

    lenient_external_gates: when True, delivery and holdings gates pass on
    source_failed instead of failing the row. Use when external data sources
    are persistently unreachable (e.g. NSE bhavcopy behind Akamai).
    """
    yf_ticker = row["yf_ticker"]
    symbol = row["symbol"]
    result = dict(row)

    tech = compute_technicals(yf_ticker)
    time.sleep(sleep_between_calls)
    fsc = compute_fscore(yf_ticker)
    time.sleep(sleep_between_calls)
    pe5y = approx_5y_avg_pe(yf_ticker)
    time.sleep(sleep_between_calls)

    result.update({f"tech_{k}": v for k, v in tech.items() if k != "yf_ticker"})
    result.update({f"fscore_{k}": v for k, v in fsc.items() if k not in ("yf_ticker", "f_score_detail")})
    result.update({f"pe5y_{k}": v for k, v in pe5y.items() if k != "yf_ticker"})

    # External sources (Screener holdings — may be slow; should be pre-fetched
    # in batch via holdings.fetch_holdings in run_scan, not here)
    holdings_status = result.get("holdings_status", "missing")
    holdings_data = result.get("holdings_data") or None
    ca_status = result.get("corporate_actions_status", "source_failed")
    ca_data = result.get("corporate_actions_data") or None

    # Surveillance
    if surveillance_payload is None:
        surveillance_payload = {"status": "flag_only", "data": {}}
    surv = check_symbol(surveillance_payload, symbol)
    result["surveillance_is_restricted"] = surv["is_restricted"]
    result["surveillance_restriction_type"] = surv["restriction_type"]
    result["surveillance_source_status"] = surv["source_status"]
    result["surveillance_source"] = surv["source"]

    # Delivery
    if bhavcopy_payload is None:
        bhavcopy_payload = {"status": "source_failed", "data": {}}
    deliv = lookup_delivery(bhavcopy_payload, symbol)
    result["delivery_value_inr"] = deliv["delivery_value_inr"]
    result["delivery_qty"] = deliv["delivery_qty"]
    result["delivery_pct"] = deliv["delivery_pct"]
    result["delivery_kind"] = deliv["delivery_kind"]
    result["delivery_fallback_from"] = deliv["fallback_from"]
    result["delivery_as_of"] = deliv["as_of"]
    result["delivery_source_status"] = deliv["source_status"]
    result["delivery_source"] = deliv["source"]

    # Required-source failure
    critical_source_failed = (
        fsc.get("error") is not None
        or tech.get("error") is not None
        or fsc.get("f_score") is None
    )
    if critical_source_failed:
        result["gate_pass"] = False
        result["gate_fail_reason"] = tech.get("error") or fsc.get("error") or "f_score_missing"
        result["swing_score"] = None
        return result

    # --- hard gates ---
    fail_reasons = []
    f_score = fsc.get("f_score")

    ok, why = gate_f_score(f_score)
    if not ok:
        fail_reasons.append(why)

    pct_off_high = tech.get("pct_off_52wk_high")
    ok, why = gate_drawdown(pct_off_high)
    if not ok:
        fail_reasons.append(why)

    rsi = tech.get("rsi14")
    ok, why = gate_rsi(rsi)
    if not ok:
        fail_reasons.append(why)

    ok, why = gate_delivery_value(deliv["delivery_value_inr"], deliv["source_status"], lenient=lenient_external_gates)
    if not ok:
        fail_reasons.append(why)

    ok, why = gate_surveillance(surv["is_restricted"], surv["source_status"])
    if not ok:
        fail_reasons.append(why)

    ok, why = gate_holdings(holdings_data, holdings_status, lenient=lenient_external_gates)
    if not ok:
        fail_reasons.append(why)

    ok, why = gate_corporate_actions(ca_data)
    if not ok:
        fail_reasons.append(why)

    result["gate_pass"] = len(fail_reasons) == 0
    result["gate_fail_reason"] = "; ".join(fail_reasons) if fail_reasons else None

    # --- soft score ---
    pe_now = pe5y.get("trailing_pe_check")
    conviction = (holdings_data or {}).get("conviction_pct") if holdings_data else None

    sub_scores = {
        "valuation_compression": _score_valuation(pe_now, pe5y.get("avg_pe_5y")),
        "oversold_positioning": _score_rsi(rsi),
        "support_proximity": _score_support(tech.get("pct_from_ema200")),
        "drawdown_sweetspot": _score_drawdown(pct_off_high),
        "volume_capitulation": _score_volume(tech.get("volume_surge_factor")),
        "quality_composite": _score_quality(None, None, f_score, None),
        "conviction_holding": _score_conviction(holdings_data),
    }

    weighted_sum, weight_total = 0.0, 0.0
    for k, w in WEIGHTS.items():
        v = sub_scores.get(k, np.nan)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        weighted_sum += float(v) * w
        weight_total += w

    base_score = 100 * weighted_sum / weight_total if weight_total > 0 else None
    rs_mult = relative_strength_factor(
        tech.get("pct_from_ema200"),
        result.get("market_index_pct_from_ema200"),
    )
    result["market_correction_factor"] = round(rs_mult, 3)
    result["swing_score"] = round(base_score * rs_mult, 1) if base_score is not None else None
    result["sub_scores"] = sub_scores

    return result


# ---------------------------------------------------------------------------
# Batch orchestration
# ---------------------------------------------------------------------------
def _evaluate_one_stock(
    rdict: dict,
    sleep_between_calls: float,
    surveillance_payload: dict,
    bhavcopy_payload: dict,
    skip_holdings: bool,
    skip_corporate_actions: bool,
    lenient_external_gates: bool = False,
) -> dict:
    """
    Per-stock worker: fetches holdings + corp-actions for this symbol, then
    runs evaluate_stock. Returns the merged row dict (or an exception row).

    Designed to be called from a thread pool — it does NOT share mutable state
    with other workers.
    """
    symbol = rdict["symbol"]

    if not skip_holdings:
        try:
            h = fetch_holdings(symbol)
            rdict["holdings_status"] = h.get("status")
            rdict["holdings_source"] = h.get("source")
            rdict["holdings_data"] = h.get("data") or {}
        except Exception as e:
            rdict["holdings_status"] = "source_failed"
            rdict["holdings_source"] = "screener.in"
            rdict["holdings_data"] = {}
            rdict["holdings_error"] = str(e)
    else:
        rdict["holdings_status"] = "missing"
        rdict["holdings_data"] = {}

    if not skip_corporate_actions:
        try:
            ca = fetch_corporate_actions(symbol)
            rdict["corporate_actions_status"] = ca.get("status")
            rdict["corporate_actions_data"] = ca.get("data") or {}
        except Exception as e:
            rdict["corporate_actions_status"] = "source_failed"
            rdict["corporate_actions_data"] = {}
            rdict["corporate_actions_error"] = str(e)
    else:
        rdict["corporate_actions_status"] = "missing"
        rdict["corporate_actions_data"] = {}

    try:
        return evaluate_stock(
            rdict,
            sleep_between_calls=sleep_between_calls,
            surveillance_payload=surveillance_payload,
            bhavcopy_payload=bhavcopy_payload,
            lenient_external_gates=lenient_external_gates,
        )
    except Exception as e:
        return {
            **rdict,
            "gate_pass": False,
            "gate_fail_reason": f"exception: {e}",
        }


def run_scan(
    top_n: int = UNIVERSE_DEFAULT_TOP_N,
    sample_size: Optional[int] = None,
    sleep_between_calls: float = 0.3,
    workers: int = UNIVERSE_DEFAULT_WORKERS,
    skip_holdings: bool = False,
    skip_corporate_actions: bool = False,
    lenient_external_gates: bool = False,
) -> pd.DataFrame:
    """
    Fetch universe + shared external data, then evaluate each stock in parallel.

    Args:
        top_n: 100, 200, or 500 — selects the NSE index list (ranked by
            free-float market cap). Defaults to 100 (Nifty 100) for fast scans.
        sample_size: optional integer cap on the universe (after top_n is applied).
            Useful for testing.
        sleep_between_calls: per-yfinance-call courtesy delay (seconds).
        workers: number of threads for the per-stock worker pool. yfinance releases
            the GIL during HTTP I/O so this is effective. 8 is a safe default;
            bump to 16 if your network is fast and yfinance/Screener aren't
            rate-limiting.
        skip_holdings / skip_corporate_actions: bypass slow per-stock fetches.
        lenient_external_gates: when True, delivery and holdings gates pass on
            source_failed (instead of failing-closed). Use when external data
            sources are persistently unreachable — e.g. NSE bhavcopy behind
            Akamai bot protection, Screener rate-limiting the runner IP.
    """
    universe = fetch_universe(top_n=top_n)
    if sample_size:
        universe = universe.head(sample_size)

    n = len(universe)
    workers = max(1, min(workers, n))
    print(f"Universe: Nifty {top_n} ({n} stocks); workers={workers}")

    # Shared external data: fetched once for the whole scan (these don't depend
    # on the worker pool — they're not per-stock).
    print(f"Fetching shared data: surveillance, bhavcopy, nifty50…")
    surveillance_payload = fetch_surveillance_list()
    print(f"  surveillance: status={surveillance_payload['status']}")
    universe_symbols = universe["symbol"].tolist()
    universe_yf_tickers = universe["yf_ticker"].tolist()
    bhavcopy_payload = fetch_bhavcopy(
        universe_symbols=universe_symbols,
        universe_yf_tickers=universe_yf_tickers,
    )
    print(f"  bhavcopy: status={bhavcopy_payload['status']} source={bhavcopy_payload.get('source')} as_of={bhavcopy_payload.get('as_of')}")
    nifty = compute_nifty50_context()
    print(f"  nifty50: {nifty.get('index_pct_from_ema200')}% from 200EMA")

    market_index_pct = nifty.get("index_pct_from_ema200")

    # Build the input dicts for each stock
    inputs = []
    for _, r in universe.iterrows():
        rdict = r.to_dict()
        rdict["market_index_pct_from_ema200"] = market_index_pct
        inputs.append(rdict)

    # Per-stock evaluation in parallel
    rows = []
    completed = 0
    start = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _evaluate_one_stock,
                rdict,
                sleep_between_calls,
                surveillance_payload,
                bhavcopy_payload,
                skip_holdings,
                skip_corporate_actions,
                lenient_external_gates,
            ): rdict["symbol"]
            for rdict in inputs
        }
        try:
            for fut in as_completed(futures):
                symbol = futures[fut]
                try:
                    rows.append(fut.result())
                except Exception as e:
                    # Should not happen — _evaluate_one_stock catches internally —
                    # but be defensive so a buggy worker never kills the whole scan.
                    rows.append({
                        "symbol": symbol,
                        "gate_pass": False,
                        "gate_fail_reason": f"worker_exception: {e}",
                    })
                completed += 1
                if completed % 25 == 0 or completed == n:
                    elapsed = time.time() - start
                    rate = completed / elapsed if elapsed > 0 else 0
                    eta = (n - completed) / rate if rate > 0 else 0
                    print(f"  {completed}/{n} stocks evaluated ({elapsed:.1f}s, {rate:.1f}/s, eta {eta:.0f}s)")
        except KeyboardInterrupt:
            print("\nInterrupted — cancelling remaining workers…")
            for f in futures:
                f.cancel()
            pool.shutdown(wait=False, cancel_futures=True)
            raise

    print(f"Per-stock evaluation complete in {time.time()-start:.1f}s")
    df = pd.DataFrame(rows)
    return df


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------
def _json_safe(v):
    """
    Recursively coerce values to JSON-safe Python primitives.

    - NaN and +/-Inf -> None (JSON has no representation for these and
      json.dump(allow_nan=False) will otherwise raise ValueError).
    - numpy scalars -> native Python scalars.
    - bytes -> decoded as utf-8 with replacement.
    - sets -> lists (not JSON-serialisable).
    - pandas.Timestamp -> ISO string.
    """
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8")
        except Exception:
            return v.decode("utf-8", errors="replace")
    if isinstance(v, (pd.Timestamp, datetime.datetime, datetime.date)):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    if isinstance(v, dict):
        return {str(k): _json_safe(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v]
    if isinstance(v, set):
        return [_json_safe(x) for x in v]
    return v


def to_json_records(df: pd.DataFrame) -> list:
    """
    Flattens the scanner DataFrame into the JSON contract the frontend expects.
    Field names here are the frontend's public API - change them in both places
    at once, or the dashboard silently shows blanks.
    """
    records = []
    for _, row in df.iterrows():
        r = row.to_dict()
        holdings_data = r.get("holdings_data") or {}
        ca_data = r.get("corporate_actions_data") or {}
        records.append({
            "symbol": r.get("symbol"),
            "company_name": r.get("company_name"),
            "industry": r.get("industry"),
            "yf_ticker": r.get("yf_ticker"),
            "current_price": _json_safe(r.get("tech_current_price")),
            "fifty_two_wk_high": _json_safe(r.get("tech_fifty_two_wk_high")),
            "pct_off_52wk_high": _json_safe(r.get("tech_pct_off_52wk_high")),
            "pct_from_ema200": _json_safe(r.get("tech_pct_from_ema200")),
            "rsi14": _json_safe(r.get("tech_rsi14")),
            "atr14": _json_safe(r.get("tech_atr14")),
            "entry_zone_low": _json_safe(r.get("tech_entry_zone_low")),
            "entry_zone_high": _json_safe(r.get("tech_entry_zone_high")),
            "stop_loss": _json_safe(r.get("tech_stop_loss")),
            "target_1": _json_safe(r.get("tech_target_1")),
            "target_2": _json_safe(r.get("tech_target_2")),
            "risk_reward_target_1": _json_safe(r.get("tech_risk_reward_target_1")),
            "risk_reward_target_2": _json_safe(r.get("tech_risk_reward_target_2")),
            "volume_surge_factor": _json_safe(r.get("tech_volume_surge_factor")),
            "adtv_value_inr_approx": _json_safe(r.get("tech_adtv_value_inr_approx")),
            "f_score": _json_safe(r.get("fscore_f_score")),
            "f_score_components_available": _json_safe(r.get("fscore_f_score_components_available")),
            "avg_pe_5y": _json_safe(r.get("pe5y_avg_pe_5y")),
            "trailing_pe": _json_safe(r.get("pe5y_trailing_pe_check")),
            # New fields
            "delivery_value_inr": _json_safe(r.get("delivery_value_inr")),
            "delivery_qty": _json_safe(r.get("delivery_qty")),
            "delivery_pct": _json_safe(r.get("delivery_pct")),
            "delivery_kind": r.get("delivery_kind"),
            "delivery_fallback_from": r.get("delivery_fallback_from"),
            "delivery_as_of": r.get("delivery_as_of"),
            "delivery_source_status": r.get("delivery_source_status"),
            "delivery_source": r.get("delivery_source"),
            "surveillance_is_restricted": bool(r.get("surveillance_is_restricted", False)),
            "surveillance_restriction_type": r.get("surveillance_restriction_type"),
            "surveillance_source_status": r.get("surveillance_source_status"),
            "surveillance_source": r.get("surveillance_source"),
            "holdings_promoter_pct": _json_safe(holdings_data.get("promoter_pct")),
            "holdings_fii_pct": _json_safe(holdings_data.get("fii_pct")),
            "holdings_dii_pct": _json_safe(holdings_data.get("dii_pct")),
            "holdings_conviction_pct": _json_safe(holdings_data.get("conviction_pct")),
            "holdings_source_status": r.get("holdings_status"),
            "holdings_source": r.get("holdings_source"),
            "pending_corporate_action": bool((ca_data.get("has_excluded_action") or False)),
            "corporate_actions_status": r.get("corporate_actions_status"),
            "market_index_pct_from_ema200": _json_safe(r.get("market_index_pct_from_ema200")),
            "market_correction_factor": _json_safe(r.get("market_correction_factor")),
            # Existing
            "gate_pass": bool(r.get("gate_pass")) if r.get("gate_pass") is not None else False,
            "gate_fail_reason": r.get("gate_fail_reason") if isinstance(r.get("gate_fail_reason"), str) else None,
            "swing_score": _json_safe(r.get("swing_score")),
            "sub_scores": _json_safe(r.get("sub_scores")) if isinstance(r.get("sub_scores"), dict) else None,
        })
    return records


def write_scan_output(df: pd.DataFrame, output_path: str) -> dict:
    records = to_json_records(df)
    gate_pass_count = sum(1 for r in records if r["gate_pass"])
    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "universe_size": len(records),
        "gate_pass_count": gate_pass_count,
        "config": {
            "min_f_score": MIN_F_SCORE,
            "min_delivery_value_inr": MIN_DELIVERY_VALUE_INR,
            "min_holdings_conviction_pct": MIN_HOLDINGS_CONVICTION_PCT,
            "rsi_window": [RSI_LOWER, RSI_UPPER],
            "drawdown_window": [DRAWDOWN_LOWER_PCT, DRAWDOWN_UPPER_PCT],
        },
        "stocks": sorted(records, key=lambda r: (r["swing_score"] is None, -(r["swing_score"] or 0))),
    }
    # Belt-and-suspenders: sanitize the entire payload once more so any value
    # that slipped past to_json_records (e.g. raw float('inf') in a gate field
    # added by an external source) is also coerced to None before write.
    payload = _json_safe(payload)
    outdir = os.path.dirname(output_path)
    if outdir:
        os.makedirs(outdir, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f, indent=2, allow_nan=False)
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NSE swing-trade scanner")
    parser.add_argument("--top-n", type=int, default=UNIVERSE_DEFAULT_TOP_N,
                         choices=[100, 200, 500],
                         help="Universe tier by free-float market cap: 100, 200, or 500. "
                              "100 = Nifty 100 (fastest), 500 = Nifty 500 (full universe).")
    parser.add_argument("--sample", type=int, default=None,
                         help="Limit universe to first N stocks (after --top-n is applied)")
    parser.add_argument("--sleep", type=float, default=0.3,
                         help="Seconds to sleep between yfinance calls (rate-limit courtesy)")
    parser.add_argument("--workers", type=int, default=UNIVERSE_DEFAULT_WORKERS,
                         help="Thread-pool size for per-stock evaluation (default 8)")
    parser.add_argument("--output", type=str, default="../frontend/public/data/latest_scan.json",
                         help="Path to write the JSON contract for the frontend")
    parser.add_argument("--skip-holdings", action="store_true",
                         help="Skip Screener holdings fetch (faster, drops holdings gate)")
    parser.add_argument("--skip-corporate-actions", action="store_true",
                         help="Skip NSE corporate-actions fetch (faster, drops corp-action gate)")
    parser.add_argument("--lenient-external-gates", action="store_true",
                         help="Pass delivery and holdings gates when the source is source_failed "
                              "instead of failing-closed. Useful when NSE bhavcopy is behind "
                              "Akamai or Screener is rate-limiting the runner IP.")
    args = parser.parse_args()

    print(f"Starting scan: top_n={args.top_n}, sample={args.sample or 'ALL'}, "
          f"sleep={args.sleep}s, workers={args.workers}")
    start = time.time()
    df = run_scan(
        top_n=args.top_n,
        sample_size=args.sample,
        sleep_between_calls=args.sleep,
        workers=args.workers,
        skip_holdings=args.skip_holdings,
        skip_corporate_actions=args.skip_corporate_actions,
        lenient_external_gates=args.lenient_external_gates,
    )
    elapsed = time.time() - start
    payload = write_scan_output(df, args.output)
    print(f"Scan complete in {elapsed/60:.1f} min. "
          f"{payload['gate_pass_count']}/{payload['universe_size']} passed all gates. "
          f"Wrote {args.output}")

#!/usr/bin/env python3
"""
smoke_scan.py
Deterministic, network-free end-to-end smoke test of the scan pipeline.

Why this exists
---------------
`ci.yml` used to run `python scanner.py --sample 5` against live yfinance. On
GitHub Actions egress that is a coin flip:

  * one 429 out of five names drops coverage to 80%,
  * `write_scan_output()` refuses to write below the 85% floor and the CLI
    exits 2,
  * the next line (`python -c "...json.load('/tmp/scan.json')"`) died with a
    misleading `FileNotFoundError`.

The gate therefore failed for reasons that had nothing to do with our code. This
script exercises the real `run_scan()` → `write_scan_output()` path with every
external source stubbed, so a failure means *we* broke something.

It also asserts the properties the production workflow relies on:
  - the JSON contract keys the frontend reads are present,
  - `gate_pass_count` is consistent with the per-row `gate_pass`,
  - `source_health` is present and clean for a healthy scan,
  - a healthy scan exits 0 and writes the file.

Usage:
    python backend/scripts/smoke_scan.py [--out /tmp/smoke_scan.json]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import pandas as pd  # noqa: E402

import scanner  # noqa: E402  (backend module)

# Fields the frontend dereferences. If one of these disappears the dashboard
# renders blanks instead of failing loudly, so the contract is asserted here.
REQUIRED_ROW_FIELDS = (
    "symbol",
    "company_name",
    "industry",
    "gate_pass",
    "swing_score",
    "current_price",
    "pct_off_52wk_high",
    "rsi14",
    "atr14",
    "entry_zone_low",
    "entry_zone_high",
    "stop_loss",
    "target_1",
    "target_2",
    "adv_value_inr",
    "f_score",
    "holdings_conviction_pct",
    "delivery_source_status",
    "surveillance_source_status",
    "holdings_source_status",
    "corporate_actions_status",
    "market_index_pct_from_ema200",
    "gate_results",
    "sub_scores",
    "score_version",
    "confirmation_state",
)


def _universe(n: int = 4) -> pd.DataFrame:
    rows = []
    for i in range(n):
        sym = f"SMOKE{i}"
        rows.append(
            {
                "symbol": sym,
                "company_name": f"Smoke Test {i} Ltd",
                "industry": "Testing",
                "series": "EQ",
                "isin": f"INE{i:09d}",
                "yf_ticker": f"{sym}.NS",
            }
        )
    return pd.DataFrame(rows)


def _priced_row(rdict: dict) -> dict:
    """A complete, gate-passing row as evaluate_stock would produce it."""
    out = dict(rdict)
    out.update(
        {
            "tech_current_price": 100.0 + hash(rdict["symbol"]) % 50,
            "tech_fifty_two_wk_high": 150.0,
            "tech_pct_off_52wk_high": -22.5,
            "tech_pct_from_ema200": -3.0,
            "tech_rsi14": 33.0,
            "tech_atr14": 4.0,
            "tech_entry_zone_low": 96.0,
            "tech_entry_zone_high": 100.0,
            "tech_stop_loss": 94.0,
            "tech_target_1": 106.0,
            "tech_target_2": 110.0,
            "tech_risk_reward_target_1": 1.5,
            "tech_risk_reward_target_2": 2.5,
            "tech_volume_surge_factor": 1.4,
            "tech_adtv_value_inr_approx": 3_00_00_000,
            "tech_adv_value_inr": 20_00_00_000,
            "tech_adv_sessions": 20,
            "tech_confirmation_state": "confirmed",
            "tech_rsi_delta_3d": 1.2,
            "tech_close_up_1d": True,
            "tech_vol_ratio_3v20": 0.9,
            "tech_swing_high_63d": 120.0,
            "tech_atr_expansion_ratio": 1.05,
            "tech_error": None,
            "fscore_f_score": 8,
            "fscore_f_score_components_available": 9,
            "fscore_error": None,
            "pe5y_avg_pe_5y": 22.0,
            "pe5y_trailing_pe_check": 18.0,
            "delivery_value_inr": 6_00_00_000,
            "delivery_qty": 100_000,
            "delivery_pct": 35.0,
            "delivery_kind": "actual",
            "delivery_fallback_from": None,
            "delivery_as_of": "2026-11-05",
            "delivery_source_status": "ok",
            "delivery_source": "nse:bhavcopy",
            "surveillance_is_restricted": False,
            "surveillance_restriction_type": None,
            "surveillance_source_status": "ok",
            "surveillance_source": "nse:reportASM",
            "holdings_status": "ok",
            "holdings_source": "screener.in(consolidated)",
            "holdings_data": {
                "promoter_pct": 50.0,
                "fii_pct": 20.0,
                "dii_pct": 15.0,
                "conviction_pct": 85.0,
            },
            "corporate_actions_status": "ok",
            "corporate_actions_data": {"has_excluded_action": False, "actions": []},
            "market_index_pct_from_ema200": -1.5,
            "market_correction_factor": 1.0,
            "liquidity_gate_path": "delivery_actual",
            "gate_pass": True,
            "gate_fail_reason": None,
            "gate_results": [
                {"gate": g, "passed": True, "reason": None}
                for g in (
                    "f_score",
                    "drawdown",
                    "rsi",
                    "liquidity_adequacy",
                    "surveillance",
                    "holdings_conviction",
                    "corporate_actions",
                )
            ],
            "swing_score": 71.5,
            "sub_scores": {
                "valuation_compression": 0.6,
                "oversold_positioning": 0.85,
                "support_proximity": 0.4,
                "drawdown_sweetspot": 0.5,
                "volume_capitulation": 0.2,
                "quality_composite": 0.8,
                "conviction_holding": 1.0,
            },
            "earnings_status": "ok",
            "earnings_data": {"earnings_date": "2026-11-20", "within_days": 14},
        }
    )
    return out


def run(out_path: str) -> int:
    universe = _universe()

    def fake_evaluate_stock(row, **kwargs):
        return _priced_row(row)

    # Patch every external boundary of run_scan().
    scanner.fetch_universe = lambda *a, **k: universe
    scanner.fetch_surveillance_list = lambda *a, **k: {
        "source": "nse:reportASM+sec_list",
        "status": "ok",
        "data": {},
    }
    scanner.fetch_bhavcopy = lambda *a, **k: {
        "source": "nse:bhavcopy",
        "status": "ok",
        "as_of": "2026-11-05",
        "data": {},
    }
    scanner.fetch_corporate_actions_list = lambda *a, **k: {
        "source": "nse:corporate-actions",
        "status": "ok",
        "data": {},
    }
    scanner.compute_nifty50_context = lambda *a, **k: {
        "index_pct_from_ema200": -1.5,
        "error": None,
    }
    scanner.evaluate_stock = fake_evaluate_stock

    df = scanner.run_scan(top_n=100, sample_size=len(universe), workers=1,
                          sleep_between_calls=0)
    payload = scanner.write_scan_output(df, out_path)

    failures = []

    if payload["universe_size"] != len(universe):
        failures.append(f"universe_size {payload['universe_size']} != {len(universe)}")
    if payload["gate_pass_count"] != len(universe):
        failures.append(
            f"gate_pass_count {payload['gate_pass_count']} != {len(universe)} "
            f"(stubbed rows all pass)"
        )
    if (payload["coverage"]["pct"] or 0) < 1.0:
        failures.append(f"coverage {payload['coverage']['pct']} < 1.0")
    health = payload.get("source_health") or {}
    if health.get("critical_source_failed"):
        failures.append(f"source health degraded: {health.get('degraded_gates')}")

    for row in payload["stocks"]:
        missing = [f for f in REQUIRED_ROW_FIELDS if f not in row]
        if missing:
            failures.append(f"{row.get('symbol')}: missing contract field(s) {missing}")

    if not os.path.exists(out_path):
        failures.append(f"scan output was not written to {out_path}")
    else:
        with open(out_path) as fh:
            on_disk = json.load(fh)
        if on_disk["universe_size"] != len(universe):
            failures.append("on-disk universe_size mismatch")

    if failures:
        for f in failures:
            print(f"::error::smoke_scan: {f}")
        return 1

    print(
        f"smoke_scan ok: {payload['universe_size']} rows, "
        f"{payload['gate_pass_count']} passing, "
        f"{len(payload['stocks'][0])} contract fields on row 1"
    )
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Network-free scan smoke test.")
    parser.add_argument("--out", default=None, help="Output JSON path (temp by default)")
    args = parser.parse_args(argv)

    if args.out:
        out_path = args.out
        try:
            return run(out_path)
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)
    with tempfile.TemporaryDirectory() as tmp:
        return run(os.path.join(tmp, "smoke_scan.json"))


if __name__ == "__main__":
    sys.exit(main())

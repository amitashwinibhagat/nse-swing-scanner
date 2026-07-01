"""Tests for the JSON output contract writer."""
import json
import os
import tempfile

import numpy as np
import pandas as pd
import pytest

from scanner import to_json_records, write_scan_output


def _make_df():
    return pd.DataFrame([{
        "symbol": "RELIANCE",
        "company_name": "Reliance Industries",
        "industry": "Oil & Gas",
        "yf_ticker": "RELIANCE.NS",
        "tech_current_price": 2900.0,
        "tech_fifty_two_wk_high": 3200.0,
        "tech_pct_off_52wk_high": -9.4,
        "tech_pct_from_ema200": -3.1,
        "tech_rsi14": 32.5,
        "tech_atr14": 50.0,
        "tech_entry_zone_low": 2875.0,
        "tech_entry_zone_high": 2900.0,
        "tech_stop_loss": 2825.0,
        "tech_target_1": 2975.0,
        "tech_target_2": 3025.0,
        "tech_risk_reward_target_1": 1.5,
        "tech_risk_reward_target_2": 2.5,
        "tech_volume_surge_factor": 1.2,
        "tech_adtv_value_inr_approx": 1_000_000_000.0,
        "fscore_f_score": 7,
        "fscore_f_score_components_available": 9,
        "pe5y_avg_pe_5y": 25.0,
        "pe5y_trailing_pe_check": 22.0,
        "delivery_value_inr": 6_00_00_000,
        "delivery_qty": 100_000,
        "delivery_pct": 35.0,
        "delivery_as_of": "2026-07-01",
        "delivery_source_status": "ok",
        "delivery_source": "nse:bhavcopy",
        "surveillance_is_restricted": False,
        "surveillance_restriction_type": None,
        "surveillance_source_status": "ok",
        "surveillance_source": "nse",
        "holdings_data": {"promoter_pct": 50.0, "fii_pct": 19.0, "dii_pct": 20.0, "conviction_pct": 89.0},
        "holdings_status": "ok",
        "holdings_source": "screener.in",
        "corporate_actions_data": {"has_excluded_action": False, "actions": []},
        "corporate_actions_status": "ok",
        "market_index_pct_from_ema200": -3.0,
        "market_correction_factor": 1.05,
        "gate_pass": True,
        "gate_fail_reason": None,
        "swing_score": 78.5,
        "sub_scores": {"valuation_compression": 0.5, "oversold_positioning": 1.0},
    }])


def test_to_json_records_required_fields_present():
    df = _make_df()
    records = to_json_records(df)
    assert len(records) == 1
    r = records[0]
    for k in ("symbol", "current_price", "rsi14", "atr14", "target_1", "stop_loss",
              "delivery_value_inr", "holdings_conviction_pct", "f_score",
              "trailing_pe", "gate_pass", "swing_score", "delivery_source_status",
              "surveillance_source_status", "holdings_source_status",
              "pending_corporate_action", "market_index_pct_from_ema200"):
        assert k in r, f"missing key: {k}"


def test_to_json_records_strips_nan():
    df = _make_df()
    records = to_json_records(df)
    r = records[0]
    # No NaN tokens allowed
    s = json.dumps(r)
    assert "NaN" not in s


def test_write_scan_output_writes_valid_json(tmp_path):
    df = _make_df()
    out = tmp_path / "scan.json"
    payload = write_scan_output(df, str(out))
    assert payload["universe_size"] == 1
    assert payload["gate_pass_count"] == 1
    assert "config" in payload
    # Must be valid JSON
    with open(out) as f:
        reloaded = json.load(f)
    assert reloaded["universe_size"] == 1

"""Tests for the bhavcopy CSV parser."""
import pandas as pd
import pytest

from bhavcopy import _parse_bhavcopy


def test_parse_bhavcopy_standard():
    csv = """SYMBOL,CLOSE,DELIVQTY,DELIVVAL
RELIANCE,2900,123456,78901.5
TCS,3500,98765,34567.8
INFY,1500,50000,7500.0
"""
    df = pd.read_csv(pd.io.common.StringIO(csv))
    parsed = _parse_bhavcopy(df)
    assert "RELIANCE" in parsed
    assert "TCS" in parsed
    assert parsed["RELIANCE"]["delivery_qty"] == 123456
    # NSE publishes delivery value in lakhs
    assert parsed["RELIANCE"]["delivery_value_inr"] == pytest.approx(78901.5 * 1_00_000)
    assert parsed["TCS"]["delivery_value_inr"] == pytest.approx(34567.8 * 1_00_000)


def test_parse_bhavcopy_fallback_to_qty_close():
    """If DELIVVAL column is missing, derive value from DELIVQTY * CLOSE."""
    csv = """SYMBOL,CLOSE,DELIVQTY
RELIANCE,2900,100
"""
    df = pd.read_csv(pd.io.common.StringIO(csv))
    parsed = _parse_bhavcopy(df)
    assert parsed["RELIANCE"]["delivery_value_inr"] == pytest.approx(100 * 2900)


def test_parse_bhavcopy_no_symbol_column_returns_empty():
    csv = """FOO,BAR
1,2
"""
    df = pd.read_csv(pd.io.common.StringIO(csv))
    parsed = _parse_bhavcopy(df)
    assert parsed == {}


def test_parse_bhavcopy_handles_missing_delivery_columns():
    csv = """SYMBOL,CLOSE
RELIANCE,2900
"""
    df = pd.read_csv(pd.io.common.StringIO(csv))
    parsed = _parse_bhavcopy(df)
    # No delivery columns means we can't compute a value
    assert "RELIANCE" not in parsed or "delivery_value_inr" not in parsed.get("RELIANCE", {})

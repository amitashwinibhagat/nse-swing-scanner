"""Tests for the named hard-gate functions in scanner.py."""
import math

import numpy as np
import pytest

from scanner import (
    gate_f_score,
    gate_drawdown,
    gate_rsi,
    gate_delivery_value,
    gate_surveillance,
    gate_holdings,
    gate_corporate_actions,
    relative_strength_factor,
)
from settings import MIN_F_SCORE, MIN_DELIVERY_VALUE_INR, MIN_HOLDINGS_CONVICTION_PCT, DRAWDOWN_LOWER_PCT, DRAWDOWN_UPPER_PCT, RSI_LOWER, RSI_UPPER


def test_gate_f_score_pass():
    ok, why = gate_f_score(MIN_F_SCORE)
    assert ok and why is None


def test_gate_f_score_fail():
    ok, why = gate_f_score(MIN_F_SCORE - 1)
    assert not ok
    assert why and "f_score" in why


def test_gate_f_score_missing():
    ok, why = gate_f_score(None)
    assert not ok
    assert why == "f_score_missing"


def test_gate_drawdown_pass():
    ok, why = gate_drawdown(-25.0)
    assert ok and why is None


def test_gate_drawdown_outside_window():
    ok, why = gate_drawdown(-10.0)
    assert not ok
    assert "outside" in why


def test_gate_drawdown_missing():
    ok, why = gate_drawdown(None)
    assert not ok
    assert why == "pct_off_high_missing"


def test_gate_rsi_pass():
    ok, why = gate_rsi(32.0)
    assert ok and why is None


def test_gate_rsi_outside_window():
    ok, why = gate_rsi(20.0)
    assert not ok


def test_gate_delivery_pass():
    ok, why = gate_delivery_value(MIN_DELIVERY_VALUE_INR, "ok")
    assert ok and why is None


def test_gate_delivery_too_low():
    ok, why = gate_delivery_value(MIN_DELIVERY_VALUE_INR - 1, "ok")
    assert not ok
    assert "delivery_value" in why


def test_gate_delivery_source_failed_fails_closed():
    ok, why = gate_delivery_value(1_000_000_000, "source_failed")
    assert not ok
    assert "source_failed" in why


def test_gate_surveillance_clean():
    ok, why = gate_surveillance(False, "ok")
    assert ok and why is None


def test_gate_surveillance_restricted():
    ok, why = gate_surveillance(True, "ok")
    assert not ok
    assert why == "t_group_or_suspended"


def test_gate_surveillance_flag_only_passes():
    # flag_only means we couldn't confirm, not that we know it's restricted
    ok, why = gate_surveillance(False, "flag_only")
    assert ok and why is None


def test_gate_holdings_pass():
    ok, why = gate_holdings({"conviction_pct": 70.0}, "ok")
    assert ok and why is None


def test_gate_holdings_too_low():
    ok, why = gate_holdings({"conviction_pct": MIN_HOLDINGS_CONVICTION_PCT}, "ok")
    assert not ok


def test_gate_holdings_source_failed_fails_closed():
    ok, why = gate_holdings({"conviction_pct": 80.0}, "source_failed")
    assert not ok


def test_gate_corporate_actions_no_action():
    ok, why = gate_corporate_actions({"has_excluded_action": False, "actions": []})
    assert ok and why is None


def test_gate_corporate_actions_excluded():
    ok, why = gate_corporate_actions({"has_excluded_action": True, "actions": [{"action": "BONUS 2:1"}]})
    assert not ok
    assert "BONUS" in why


def test_gate_corporate_actions_source_failed_passes():
    # If we couldn't fetch, we don't claim to have screened it
    ok, why = gate_corporate_actions(None)
    assert ok and why is None


def test_relative_strength_penalty():
    # Stock much weaker than index -> penalty
    f = relative_strength_factor(-25.0, -5.0)
    assert f < 0.9


def test_relative_strength_bonus():
    # Index correcting and stock tracking it
    f = relative_strength_factor(-7.0, -8.0)
    assert f >= 1.0


def test_relative_strength_neutral_when_missing():
    assert relative_strength_factor(None, -5.0) == 1.0
    assert relative_strength_factor(-5.0, None) == 1.0

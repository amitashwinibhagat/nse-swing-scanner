"""Tests for the named hard-gate functions in scanner.py."""
from scanner import (
    gate_f_score,
    gate_drawdown,
    gate_rsi,
    gate_liquidity_adequacy,
    gate_surveillance,
    gate_holdings,
    gate_corporate_actions,
    relative_strength_penalty,
)
from settings import (
    MIN_F_SCORE,
    MIN_DELIVERY_VALUE_INR,
    MIN_ADV_VALUE_INR,
    MIN_ADV_SECONDARY_FLOOR_INR,
    MIN_HOLDINGS_CONVICTION_PCT,
)


def test_gate_f_score_pass():
    ok, why = gate_f_score(MIN_F_SCORE, 9)
    assert ok and why is None


def test_gate_f_score_fail():
    ok, why = gate_f_score(MIN_F_SCORE - 1, 9)
    assert not ok
    assert why and "f_score" in why


def test_gate_f_score_missing():
    ok, why = gate_f_score(None, 9)
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


def test_gate_liquidity_pass_via_actual_delivery():
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_SECONDARY_FLOOR_INR,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR,
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert ok and why is None


def test_gate_liquidity_pass_via_adv_when_delivery_thin():
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_VALUE_INR,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR - 1,
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert ok and why is None


def test_gate_liquidity_pass_via_adv_when_proxy_only():
    """Single-day proxy alone must NOT satisfy the gate; ADV does."""
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_VALUE_INR,
        delivery_value_inr=1_000_000_000,  # would have passed old proxy gate
        delivery_kind="traded_value_proxy",
        delivery_status="ok",
    )
    assert ok and why is None


def test_gate_liquidity_proxy_only_fails():
    """Proxy without sufficient ADV must fail (was the source of the false PASSes)."""
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_VALUE_INR - 1,
        delivery_value_inr=1_000_000_000,
        delivery_kind="traded_value_proxy",
        delivery_status="ok",
    )
    assert not ok
    assert "adv" in why


def test_gate_liquidity_actual_too_low_and_adv_missing_fails():
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=None,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR - 1,
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert not ok
    assert "liquidity_missing" in why


def test_gate_liquidity_adv_below_floor_with_real_delivery_above_passes():
    """If real delivery ≥ ₹5cr, the actual path passes even when ADV is low."""
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_VALUE_INR - 1,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR,
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert ok and why is None


def test_gate_liquidity_adv_below_floor_fails():
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_VALUE_INR - 1,
        delivery_value_inr=None,
        delivery_kind=None,
        delivery_status="source_failed",
    )
    assert not ok
    assert "adv" in why


def test_gate_liquidity_delivery_path_requires_secondary_adv_floor():
    """A thinly-traded name with a single high-delivery day must NOT pass."""
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=MIN_ADV_SECONDARY_FLOOR_INR - 1,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR,  # real delivery satisfies primary
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert not ok
    assert "secondary" in why


def test_gate_liquidity_delivery_path_missing_adv_fails():
    """Delivery path needs ADV for the secondary floor; ADV must not be None."""
    ok, why = gate_liquidity_adequacy(
        adv_value_inr=None,
        delivery_value_inr=MIN_DELIVERY_VALUE_INR,
        delivery_kind="actual",
        delivery_status="ok",
    )
    assert not ok
    assert "liquidity_missing" in why


def test_gate_liquidity_lenient_not_a_parameter():
    """--lenient-external-gates must NOT loosen the liquidity gate by design.

    The new gate signature intentionally drops the `lenient` kwarg: the 20d
    ADV path makes the gate reliable even when bhavcopy is unreachable,
    so there is no source-failure case to relax. Pin the contract here.
    """
    import inspect
    sig = inspect.signature(gate_liquidity_adequacy)
    assert "lenient" not in sig.parameters


def test_gate_surveillance_clean():
    ok, why = gate_surveillance(False, "ok")
    assert ok and why is None


def test_gate_surveillance_restricted():
    ok, why = gate_surveillance(True, "ok")
    assert not ok
    assert why == "t_group_or_suspended"


def test_gate_surveillance_fails_closed_when_unverified():
    """flag_only means "could not confirm". Treating it as clean is what made
    this gate a no-op in production (every endpoint 404'd)."""
    ok, why = gate_surveillance(False, "flag_only")
    assert not ok
    assert "surveillance_unverified" in why


def test_gate_surveillance_lenient_override_allows_unverified():
    """Lenient passes now carry a marker instead of None, so the row can be
    labelled "not verified" rather than reading as a clean pass."""
    ok, why = gate_surveillance(False, "flag_only", lenient=True)
    assert ok
    assert "unverified" in why and "(lenient)" in why


def test_gate_surveillance_still_fails_on_a_known_restriction():
    ok, why = gate_surveillance(True, "ok", lenient=True)
    assert not ok
    assert why == "t_group_or_suspended"


def test_gate_drawdown_rejects_partial_52wk_window():
    ok, why = gate_drawdown(-20.0, partial_52wk_window=True)
    assert not ok
    assert "partial_window" in why


def test_gate_drawdown_accepts_full_window():
    ok, why = gate_drawdown(-20.0, partial_52wk_window=False)
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


def test_gate_holdings_source_failed_lenient_passes():
    """The data present is fine, but the SOURCE failed — so the row passed
    without the gate being verified, and now says so."""
    ok, why = gate_holdings({"conviction_pct": 80.0}, "source_failed", lenient=True)
    assert ok
    assert "holdings_conviction_unverified" in why


def test_gate_holdings_missing_lenient_passes():
    ok, why = gate_holdings(None, "missing", lenient=True)
    assert ok
    assert "holdings_conviction_unverified" in why


def test_gate_holdings_real_conviction_pass_has_no_marker():
    ok, why = gate_holdings({"conviction_pct": 80.0}, "ok", lenient=True)
    assert ok and why is None


def test_gate_holdings_strict_still_rejects_low_conviction_in_lenient_mode():
    """Lenient mode does NOT relax the actual >50% conviction check; only the missing-source case."""
    ok, why = gate_holdings({"conviction_pct": 30.0}, "ok", lenient=True)
    assert not ok
    assert "conviction" in why


def test_gate_corporate_actions_no_action():
    ok, why = gate_corporate_actions({"has_excluded_action": False, "actions": []}, "ok")
    assert ok and why is None


def test_gate_corporate_actions_excluded():
    ok, why = gate_corporate_actions({"has_excluded_action": True, "actions": [{"action": "BONUS 2:1"}]}, "ok")
    assert not ok
    assert "BONUS" in why


def test_gate_corporate_actions_source_failed_fails_closed():
    ok, why = gate_corporate_actions(None)
    assert not ok
    assert why == "corporate_actions_source_failed"


def test_gate_corporate_actions_can_be_disabled():
    ok, why = gate_corporate_actions(None, enabled=False)
    assert ok and why == "gate_disabled"


def test_gate_f_score_requires_all_components():
    ok, why = gate_f_score(MIN_F_SCORE, 8)
    assert not ok
    assert "components_missing" in why


def test_relative_strength_penalty_is_additive():
    """Points subtracted, not a multiplier: a multiplier caps the top score
    (base x 0.70 <= 70) and made the 72 band unreachable for 13.5% of rows."""
    from settings import RELATIVE_STRENGTH_HARD_PENALTY, RELATIVE_STRENGTH_MILD_PENALTY

    assert relative_strength_penalty(-25.0, -5.0) == RELATIVE_STRENGTH_HARD_PENALTY
    # Boundary is strict: delta == -10 is mild; -10.1 is hard.
    assert relative_strength_penalty(-12.0, -2.0) == RELATIVE_STRENGTH_MILD_PENALTY
    assert relative_strength_penalty(-12.1, -2.0) == RELATIVE_STRENGTH_HARD_PENALTY
    assert relative_strength_penalty(-8.0, -2.0) == RELATIVE_STRENGTH_MILD_PENALTY
    assert relative_strength_penalty(-4.0, -2.0) == 0.0


def test_relative_strength_has_no_bonus():
    """The former x1.05 'index correcting, stock tracking it' bonus marked the
    WORST cohort (T+20 -6.45%): weakness in a weak tape, not strength."""
    assert relative_strength_penalty(-7.0, -8.0) == 0.0
    assert relative_strength_penalty(0.0, -9.0) == 0.0


def test_relative_strength_neutral_when_missing():
    assert relative_strength_penalty(None, -5.0) == 0.0
    assert relative_strength_penalty(-5.0, None) == 0.0


def test_additive_penalty_keeps_the_top_band_reachable():
    """The whole point of the change: a perfect base score still reaches the top
    band even with the heaviest penalty applied."""
    from performance import BUCKET_BANDS

    top_cut = BUCKET_BANDS[0][1]
    from settings import RELATIVE_STRENGTH_HARD_PENALTY

    assert 100.0 - RELATIVE_STRENGTH_HARD_PENALTY >= top_cut


# --- source-health rollup (P0: silent gate outage) -------------------------

from scanner import compute_source_health  # noqa: E402


def _row(ca="ok", surv="ok", hold="ok", gate_pass=False):
    return {
        "corporate_actions_status": ca,
        "surveillance_source_status": surv,
        "holdings_source_status": hold,
        "gate_pass": gate_pass,
    }


def test_source_health_flags_a_universe_wide_gate_outage():
    records = [_row(ca="source_failed") for _ in range(5)]
    health = compute_source_health(records)
    assert health["critical_source_failed"] is True
    assert "corporate_actions" in health["degraded_gates"]
    assert health["corporate_actions"]["source_failed"] == 5


def test_source_health_is_clean_when_every_gate_verified():
    records = [_row() for _ in range(5)]
    health = compute_source_health(records)
    assert health["critical_source_failed"] is False
    assert health["degraded_gates"] == []


def test_source_health_ignores_a_minority_of_failures():
    """Per-symbol misses are normal (Screener has no page for a few tickers)
    and must not be escalated to an incident."""
    records = [_row() for _ in range(9)] + [_row(hold="missing")]
    health = compute_source_health(records)
    assert health["critical_source_failed"] is False


def test_source_health_flags_flag_only_surveillance():
    records = [_row(surv="flag_only") for _ in range(3)]
    health = compute_source_health(records)
    assert "surveillance" in health["degraded_gates"]


def test_gate_corporate_actions_lenient_allows_an_unverifiable_feed():
    """NSE blocks this endpoint from Actions egress, and this gate alone zeroed
    the PASS list in 2026-10/11. The documented opt-out must cover it."""
    ok, why = gate_corporate_actions(None, "source_failed", lenient=True)
    assert ok
    assert "unverified" in why


def test_gate_corporate_actions_still_fails_closed_without_lenient():
    ok, why = gate_corporate_actions(None, "source_failed")
    assert not ok
    assert why == "corporate_actions_source_failed"


def test_gate_corporate_actions_lenient_does_not_excuse_a_real_action():
    ok, why = gate_corporate_actions(
        {"has_excluded_action": True, "actions": [{"action": "BONUS 1:1"}]},
        "ok",
        lenient=True,
    )
    assert not ok
    assert "BONUS" in why


def test_lenient_pass_is_labelled_and_not_counted_as_critical():
    """The label travels: gate reason -> unverified_gates -> JSON -> UI."""
    ok, why = gate_corporate_actions(None, "source_failed", lenient=True)
    assert ok and "(lenient)" in why
    # The reporting rule used by evaluate_stock: strip the marker for display.
    assert why.split(" (lenient)")[0] == "corporate_actions_unverified"

    import scanner
    records = [{
        "corporate_actions_status": "source_failed",
        "surveillance_source_status": "ok",
        "holdings_source_status": "ok",
        "gate_pass": True,
    }]
    health = scanner.compute_source_health(records)
    assert "corporate_actions" in health["degraded_gates"]
    # Rows still pass, so this is a labelled degradation, not an incident.
    assert health["critical_source_failed"] is False


def test_lenient_pass_marker_survives_into_gate_results():
    """Regression: `reason` was only stored for FAILING gates, so a lenient
    PASS lost its marker and the UI showed a clean, fully-checked PASS."""
    import scanner

    assert scanner._gate_reason(True, "corporate_actions_unverified (lenient)") == \
        "corporate_actions_unverified (lenient)"
    assert scanner._gate_reason(True, "gate_disabled") == "gate_disabled"
    assert scanner._gate_reason(True, None) is None
    # A real failure keeps its reason untouched.
    assert scanner._gate_reason(False, "rsi 50 outside") == "rsi 50 outside"

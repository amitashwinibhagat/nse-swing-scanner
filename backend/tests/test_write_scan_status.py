"""Tests for scripts/write_scan_status.py — window attribution + drift."""

import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, ".."))
for p in (BACKEND, os.path.join(BACKEND, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

import write_scan_status  # noqa: E402

SCAN = {"generated_at": "2026-11-05T11:19:00+00:00", "gate_pass_count": 8, "universe_size": 501}


def _status(now, fired):
    return write_scan_status.build_status(
        scan=SCAN,
        trigger="schedule",
        fired_window=fired,
        commit_sha="abc",
        run_id="1",
        now=now,
    )


def test_morning_run_attributes_to_the_morning_cron_not_the_nearest_clock():
    """The production bug: an 11:19 UTC run was attributed to the 10:30 window
    with drift_minutes=49, hiding a 7.7-hour scheduler delay."""
    now = datetime.datetime(2026, 11, 5, 11, 19, tzinfo=datetime.timezone.utc)
    status = _status(now, "03:30")
    assert status["scheduled_window_utc"] == "03:30"
    assert status["drift_minutes"] == 469          # 7h49m, the truth
    assert status["scheduled_window_at_utc"] == "2026-11-05T03:30:00+00:00"


def test_evening_run_attributes_to_the_evening_cron():
    now = datetime.datetime(2026, 11, 5, 18, 10, tzinfo=datetime.timezone.utc)
    status = _status(now, "10:30")
    assert status["scheduled_window_utc"] == "10:30"
    assert status["drift_minutes"] == 460


def test_a_run_before_its_window_attributes_to_the_previous_day():
    now = datetime.datetime(2026, 11, 5, 3, 0, tzinfo=datetime.timezone.utc)
    status = _status(now, "10:30")
    assert status["scheduled_window_at_utc"] == "2026-11-04T10:30:00+00:00"
    assert status["drift_minutes"] == 16 * 60 + 30


def test_weekend_attribution_never_lands_on_a_weekend():
    # Monday 07:00 UTC, morning cron has not fired yet -> previous Friday... but
    # the cron does not run on weekends, so Monday's own 03:30 is correct.
    now = datetime.datetime(2026, 11, 9, 7, 0, tzinfo=datetime.timezone.utc)  # Monday
    status = _status(now, "03:30")
    assert status["scheduled_window_at_utc"] == "2026-11-09T03:30:00+00:00"


def test_ad_hoc_run_has_no_schedule_to_be_late_against():
    now = datetime.datetime(2026, 11, 5, 12, 0, tzinfo=datetime.timezone.utc)
    status = _status(now, "")
    assert status["scheduled_window_utc"] is None
    assert status["drift_minutes"] is None
    assert status["stale_after_minutes"] is None


def test_status_carries_next_window_and_staleness_grace():
    now = datetime.datetime(2026, 11, 5, 11, 19, tzinfo=datetime.timezone.utc)
    status = _status(now, "03:30")
    assert status["next_expected_utc"] == "2026-11-06T03:30:00+00:00"
    # Grace must exceed measured scheduler drift (median 5.4h, p75 6.6h) or the
    # dashboard shows a false "no fresh scan" banner every trading day.
    assert status["stale_after_minutes"] >= 7 * 60


def test_status_surfaces_source_health_for_the_dashboard():
    scan = dict(SCAN)
    scan["source_health"] = {
        "critical_source_failed": True,
        "degraded_gates": ["corporate_actions"],
        "corporate_actions": {"source_failed": 501, "dominant": "source_failed"},
    }
    status = write_scan_status.build_status(
        scan=scan, trigger="schedule", fired_window="03:30",
        commit_sha="abc", run_id="1",
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=datetime.timezone.utc),
    )
    assert status["source_health"]["critical_source_failed"] is True
    assert status["source_health"]["degraded_gates"] == ["corporate_actions"]
    assert status["gate_pass_count"] == 8


def test_staleness_grace_is_adaptive_to_the_trigger():
    """A punctual scheduler and a 5-hour-late cron cannot share one threshold:
    tight enough for the former cries wolf on the latter, loose enough for the
    latter hides a real outage for most of a session."""
    now = datetime.datetime(2026, 11, 5, 10, 31, tzinfo=datetime.timezone.utc)

    punctual = write_scan_status.build_status(
        scan=SCAN, trigger="repository_dispatch", fired_window="10:30",
        commit_sha="abc", run_id="1", now=now, source="external-scheduler",
    )
    assert punctual["stale_after_minutes"] == 90
    assert punctual["schedule_source"] == "external-scheduler"

    fallback = write_scan_status.build_status(
        scan=SCAN, trigger="schedule", fired_window="10:30",
        commit_sha="abc", run_id="1", now=now, source="github-cron",
    )
    assert fallback["stale_after_minutes"] == 8 * 60
    assert fallback["schedule_source"] == "github-cron"

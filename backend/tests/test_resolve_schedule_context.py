"""Tests for scripts/resolve_schedule_context.py — window attribution + dedupe."""

import datetime
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, ".."))
for p in (BACKEND, os.path.join(BACKEND, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

import resolve_schedule_context as rsc  # noqa: E402

UTC = datetime.timezone.utc

MORNING_CRON = "30 3 * * 1-5"
EVENING_CRON = "30 10 * * 1-5"


def _scan(tmp_path, generated_at):
    path = tmp_path / "latest_scan.json"
    path.write_text(json.dumps({"generated_at": generated_at, "stocks": []}))
    return path


# --- trigger -> window ------------------------------------------------------

def test_scheduled_run_maps_the_cron_to_a_window():
    out = rsc.resolve(
        event="schedule",
        fired_cron=MORNING_CRON,
        morning_url="https://hc/m",
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["window_utc"] == "03:30"
    assert out["slot"] == "am"
    assert out["healthcheck_url"] == "https://hc/m"
    assert out["scheduled"] == "true"
    assert out["source"] == "github-cron"


def test_evening_cron_uses_the_evening_url():
    out = rsc.resolve(
        event="schedule",
        fired_cron=EVENING_CRON,
        evening_url="https://hc/e",
        now=datetime.datetime(2026, 11, 5, 18, 10, tzinfo=UTC),
    )
    assert out["window_utc"] == "10:30"
    assert out["slot"] == "pm"
    assert out["healthcheck_url"] == "https://hc/e"


def test_external_dispatch_names_its_own_window():
    out = rsc.resolve(
        event="repository_dispatch",
        payload_window="10:30",
        evening_url="https://hc/e",
        now=datetime.datetime(2026, 11, 5, 10, 30, tzinfo=UTC),
    )
    assert out["window_utc"] == "10:30"
    assert out["source"] == "external-scheduler"
    assert out["scheduled"] == "true"


def test_external_dispatch_with_a_bad_window_is_an_error():
    """A typo must be loud: silently treating it as ad-hoc would lose the
    healthcheck and the snapshot slot for that slot."""
    with pytest.raises(ValueError, match="is not one of"):
        rsc.resolve(event="repository_dispatch", payload_window="9:00")


def test_manual_dispatch_has_no_window_and_no_ping():
    out = rsc.resolve(event="workflow_dispatch", now=datetime.datetime.now(UTC))
    assert out["window_utc"] == ""
    assert out["scheduled"] == "false"
    assert out["healthcheck_url"] == ""
    assert out["skip"] == "false"
    assert out["source"] == "manual"


# --- duplicate suppression --------------------------------------------------

def test_late_cron_skips_when_the_punctual_run_already_covered_the_window(tmp_path):
    """The money case: Netlify fires at 03:30, GitHub's cron arrives at 11:19
    for the SAME window. The second must not scan or commit again."""
    latest = _scan(tmp_path, "2026-11-05T03:31:00+00:00")
    out = rsc.resolve(
        event="schedule",
        fired_cron=MORNING_CRON,
        latest_scan_path=latest,
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["skip"] == "true"
    assert "already covered" in out["skip_reason"]


def test_no_skip_when_the_last_scan_predates_the_window(tmp_path):
    latest = _scan(tmp_path, "2026-11-04T18:12:00+00:00")
    out = rsc.resolve(
        event="schedule",
        fired_cron=MORNING_CRON,
        latest_scan_path=latest,
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["skip"] == "false"


def test_a_run_exactly_at_the_window_does_not_skip_a_fresh_window(tmp_path):
    """Boundary: a scan generated AT 03:30:00 counts as covering 03:30."""
    latest = _scan(tmp_path, "2026-11-05T03:30:00+00:00")
    out = rsc.resolve(
        event="repository_dispatch",
        payload_window="03:30",
        latest_scan_path=latest,
        now=datetime.datetime(2026, 11, 5, 3, 30, 30, tzinfo=UTC),
    )
    assert out["skip"] == "true"


def test_a_missing_scan_never_skips(tmp_path):
    """A missing/unreadable scan is exactly what these triggers exist to fix."""
    missing = tmp_path / "nope.json"
    out = rsc.resolve(
        event="schedule",
        fired_cron=MORNING_CRON,
        latest_scan_path=missing,
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["skip"] == "false"

    corrupt = tmp_path / "bad.json"
    corrupt.write_text("{not json")
    out = rsc.resolve(
        event="schedule",
        fired_cron=MORNING_CRON,
        latest_scan_path=corrupt,
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["skip"] == "false"


def test_manual_runs_are_never_skipped():
    out = rsc.resolve(
        event="workflow_dispatch",
        latest_scan_path=None,
        now=datetime.datetime(2026, 11, 5, 11, 19, tzinfo=UTC),
    )
    assert out["skip"] == "false"


# --- window math ------------------------------------------------------------

def test_window_occurrence_never_lands_on_a_weekend():
    # Monday 2026-11-09 02:00 UTC: the morning window has not fired yet, so the
    # most recent occurrence is Friday's — not Sunday's.
    occurrence = rsc.window_occurrence((3, 30), datetime.datetime(2026, 11, 9, 2, 0, tzinfo=UTC))
    assert occurrence == datetime.datetime(2026, 11, 6, 3, 30, tzinfo=UTC)


def test_cli_writes_github_output(tmp_path, monkeypatch, capsys):
    out_file = tmp_path / "out.txt"
    latest = _scan(tmp_path, "2026-11-04T18:12:00+00:00")
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setenv("GH_EVENT_NAME", "schedule")
    monkeypatch.setenv("GH_EVENT_SCHEDULE", MORNING_CRON)
    monkeypatch.setenv("MORNING_URL", "https://hc/m")

    code = rsc.main(["--latest-scan", str(latest), "--now", "2026-11-05T11:19:00+00:00"])

    assert code == 0
    written = dict(
        line.split("=", 1) for line in out_file.read_text().splitlines() if "=" in line
    )
    assert written["window_utc"] == "03:30"
    assert written["skip"] == "false"
    assert written["slot"] == "am"

"""
Tests for backend/scripts/watchdog_check.py — the schedule-aware watchdog
decision logic that replaced the trigger-on-every-stale-tick behaviour
(1.3.3 fix for duplicate queued scans).
"""
import datetime
import importlib.util
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
SCRIPTS_DIR = os.path.join(BACKEND_DIR, "scripts")
for p in (BACKEND_DIR, SCRIPTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import watchdog_check  # noqa: E402
from scan_schedule import next_scheduled_window  # noqa: E402

UTC = datetime.timezone.utc


def dt(y, mo, d, h, mi):
    return datetime.datetime(y, mo, d, h, mi, tzinfo=UTC)


def make_status(next_expected_iso):
    return {"next_expected_utc": next_expected_iso, "trigger": "schedule"}


class TestIsScanLate(unittest.TestCase):
    def test_fresh_when_before_next_window(self):
        status = make_status("2026-09-01T10:30:00+00:00")
        self.assertFalse(watchdog_check.is_scan_late(status, None, dt(2026, 9, 1, 10, 0), 30))

    def test_fresh_within_grace_after_next_window(self):
        status = make_status("2026-09-01T03:30:00+00:00")
        # generated_at fallback not needed; next window in the future.
        self.assertFalse(watchdog_check.is_scan_late(status, None, dt(2026, 9, 1, 3, 40), 30))

    def test_late_past_grace(self):
        # next_expected 03:30 + 30 min grace; now 04:15 -> late.
        status = make_status("2026-09-01T03:30:00+00:00")
        self.assertTrue(watchdog_check.is_scan_late(status, None, dt(2026, 9, 1, 4, 15), 30))

    def test_no_status_falls_back_to_generated_at_next_window(self):
        latest = {"generated_at": "2026-08-31T16:12:00+00:00"}
        # Monday 03:50: next window after generated_at is 10:30 — not late.
        self.assertFalse(watchdog_check.is_scan_late(None, latest, dt(2026, 8, 31, 17, 0), 30))

    def test_no_data_at_all_is_late(self):
        self.assertTrue(watchdog_check.is_scan_late(None, None, dt(2026, 9, 1, 4, 0), 30))


class TestShouldTrigger(unittest.TestCase):
    def setUp(self):
        # A scan that is genuinely late: latest scan Monday 16:00, next window
        # Tuesday 03:30, grace 30 -> late from 04:00 Tuesday.
        self.latest = {"generated_at": "2026-08-31T16:00:00+00:00"}
        self.status = make_status("2026-09-01T03:30:00+00:00")
        self.late_now = dt(2026, 9, 1, 4, 45)

    def test_triggers_when_late_and_idle(self):
        trigger, _ = watchdog_check.should_trigger(
            run_state="none", latest=self.latest, status=self.status,
            marker_dt=None, now=self.late_now,
        )
        self.assertTrue(trigger)

    def test_never_triggers_when_queued(self):
        trigger, reason = watchdog_check.should_trigger(
            run_state="queued", latest=self.latest, status=self.status,
            marker_dt=None, now=self.late_now,
        )
        self.assertFalse(trigger)
        self.assertIn("queued", reason)

    def test_never_triggers_when_in_progress(self):
        trigger, _ = watchdog_check.should_trigger(
            run_state="in_progress", latest=self.latest, status=self.status,
            marker_dt=None, now=self.late_now,
        )
        self.assertFalse(trigger)

    def test_cooldown_blocks_duplicate_trigger(self):
        marker = self.late_now - datetime.timedelta(minutes=10)
        trigger, reason = watchdog_check.should_trigger(
            run_state="none", latest=self.latest, status=self.status,
            marker_dt=marker, now=self.late_now, cooldown_min=45,
        )
        self.assertFalse(trigger)
        self.assertIn("cooldown", reason)

    def test_cooldown_expired_allows_trigger(self):
        marker = self.late_now - datetime.timedelta(minutes=50)
        trigger, _ = watchdog_check.should_trigger(
            run_state="none", latest=self.latest, status=self.status,
            marker_dt=marker, now=self.late_now, cooldown_min=45,
        )
        self.assertTrue(trigger)

    def test_fresh_scan_never_triggers(self):
        fresh_status = make_status("2026-09-02T03:30:00+00:00")
        trigger, _ = watchdog_check.should_trigger(
            run_state="none", latest=self.latest, status=fresh_status,
            marker_dt=None, now=dt(2026, 9, 1, 5, 0),
        )
        self.assertFalse(trigger)


class TestMarkerIO(unittest.TestCase):
    def test_marker_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "marker")
            now = dt(2026, 9, 1, 4, 45)
            watchdog_check.write_marker(path, now)
            self.assertEqual(watchdog_check.read_marker(path), now)

    def test_read_marker_missing_file(self):
        self.assertIsNone(watchdog_check.read_marker("/nonexistent/marker"))

    def test_read_marker_corrupt_content(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "marker")
            with open(path, "w") as f:
                f.write("not-a-date")
            self.assertIsNone(watchdog_check.read_marker(path))


class TestMainExitCodes(unittest.TestCase):
    def test_exit_10_on_trigger(self):
        with tempfile.TemporaryDirectory() as td:
            latest = os.path.join(td, "latest.json")
            with open(latest, "w") as f:
                f.write('{"generated_at": "2026-08-31T16:00:00+00:00"}')
            marker = os.path.join(td, "marker")
            code = watchdog_check.main([
                "--latest", latest,
                "--marker", marker,
                "--now", "2026-09-01T04:45:00+00:00",
            ])
            self.assertEqual(code, 10)

    def test_exit_0_when_run_in_progress(self):
        with tempfile.TemporaryDirectory() as td:
            latest = os.path.join(td, "latest.json")
            with open(latest, "w") as f:
                f.write('{"generated_at": "2026-08-31T16:00:00+00:00"}')
            marker = os.path.join(td, "marker")
            code = watchdog_check.main([
                "--latest", latest,
                "--marker", marker,
                "--run-state", "in_progress",
                "--now", "2026-09-01T04:45:00+00:00",
            ])
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()

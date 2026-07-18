"""Smoke tests for backend/earnings.py (B3 plan item)."""
import datetime
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import earnings  # noqa: E402


class TestFetchEarningsUncached(unittest.TestCase):
    def test_returns_missing_when_no_dates(self):
        """No upcoming earnings date from yfinance → status='missing'."""
        with mock.patch.object(earnings, "_extract_next_earnings_date", return_value=None):
            result = earnings._fetch_earnings_uncached("RELIANCE.NS")
        self.assertEqual(result["status"], "missing")
        self.assertIsNone(result.get("data"))
        self.assertEqual(result["source"], "yfinance:earnings")

    def test_returns_ok_with_within_days(self):
        """When yfinance returns a near-future date, status='ok' + within_days
        matches the actual delta from real 'today' (no datetime mocking)."""
        with mock.patch.object(earnings, "_extract_next_earnings_date", return_value="2099-12-31"):
            result = earnings._fetch_earnings_uncached("RELIANCE.NS")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["earnings_date"], "2099-12-31")
        # Far-future date → large positive within_days
        self.assertGreater(result["data"]["within_days"], 1000)

    def test_handles_unparseable_iso(self):
        """Bad date string from yfinance → source_failed."""
        with mock.patch.object(earnings, "_extract_next_earnings_date", return_value="not-a-date"):
            result = earnings._fetch_earnings_uncached("RELIANCE.NS")
        self.assertEqual(result["status"], "source_failed")
        self.assertIsNone(result.get("data"))
        self.assertIn("Unparseable", result.get("error", ""))

    def test_fetch_earnings_envelope_includes_symbol(self):
        with mock.patch.object(earnings, "_extract_next_earnings_date", return_value=None):
            result = earnings.fetch_earnings("RELIANCE", "RELIANCE.NS")
        self.assertEqual(result["symbol"], "RELIANCE")
        self.assertEqual(result["status"], "missing")


if __name__ == "__main__":
    unittest.main()
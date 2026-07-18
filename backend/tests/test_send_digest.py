"""Tests for backend/scripts/send_digest.py (C3 plan item)."""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.abspath(os.path.join(HERE, "..", "scripts"))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import send_digest  # noqa: E402


def _make_scan(idx_pct=-3.5, passed_count=3, n=500, with_stale=False):
    stocks = []
    for i in range(passed_count):
        stocks.append({
            "symbol": f"SYM{i}",
            "gate_pass": True,
            "swing_score": 80 - i,
            "current_price": 1000 + i * 10,
            "rsi14": 32,
            "target_1": 1100 + i * 10,
            "stop_loss": 950 + i * 10,
            "market_index_pct_from_ema200": idx_pct,
            "delivery_source_status": "ok",
            "surveillance_source_status": "source_failed" if with_stale else "ok",
            "holdings_source_status": "ok",
            "corporate_actions_status": "ok",
        })
    return {
        "generated_at": "2026-07-18T10:31:00+00:00",
        "universe_size": n,
        "gate_pass_count": passed_count,
        "stocks": stocks,
    }


class TestBuildMessage(unittest.TestCase):
    def test_includes_top_pass_and_regime(self):
        with tempfile.TemporaryDirectory() as f:
            path = os.path.join(f, "latest.json")
            with open(path, "w") as fp:
                json.dump(_make_scan(idx_pct=-3.5, passed_count=3), fp)
            msg = send_digest.build_message(path, None)
        self.assertIsNotNone(msg)
        self.assertIn("NSE Swing Scanner", msg)
        self.assertIn("Regime", msg)
        self.assertIn("Below 200EMA", msg)
        self.assertIn("PASS", msg)
        self.assertIn("SYM0", msg)
        self.assertIn("Top 5", msg)

    def test_no_pass_does_not_crash(self):
        # When passed_count=0 the stocks array is empty so we cannot
        # derive a regime; the message falls back to (unknown).
        with tempfile.TemporaryDirectory() as f:
            path = os.path.join(f, "latest.json")
            with open(path, "w") as fp:
                json.dump(_make_scan(idx_pct=2.0, passed_count=0), fp)
            msg = send_digest.build_message(path, None)
        self.assertIn("No names passed", msg)
        self.assertIn("(unknown)", msg)

    def test_missing_file_returns_none(self):
        self.assertIsNone(send_digest.build_message("/nonexistent/latest.json", None))

    def test_stale_sources_listed(self):
        with tempfile.TemporaryDirectory() as f:
            path = os.path.join(f, "latest.json")
            with open(path, "w") as fp:
                json.dump(_make_scan(idx_pct=-1.0, passed_count=1, with_stale=True), fp)
            msg = send_digest.build_message(path, None)
        self.assertIn("Source warnings", msg)
        self.assertIn("Surveillance", msg)


class TestSendTelegram(unittest.TestCase):
    def test_missing_secrets_skips_soft(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            ok, info = send_digest.send_telegram("hello")
        self.assertFalse(ok)
        self.assertIn("not set", info)

    def test_http_error_is_soft(self):
        env = {"TELEGRAM_BOT_TOKEN": "x", "TELEGRAM_CHAT_ID": "1"}
        with mock.patch.dict(os.environ, env, clear=False):
            with mock.patch("urllib.request.urlopen") as u:
                u.side_effect = __import__("urllib.error").error.HTTPError(
                    "http://x", 400, "Bad Request", {}, __import__("io").BytesIO(b"oops")
                )
                ok, info = send_digest.send_telegram("hello")
        self.assertFalse(ok)
        self.assertIn("HTTPError", info)


if __name__ == "__main__":
    unittest.main()
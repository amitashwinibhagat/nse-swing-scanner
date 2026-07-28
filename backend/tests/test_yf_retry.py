"""Tests for backend/yf_retry.py."""
import os
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import yf_retry  # noqa: E402
from cache import cached_call, read_cache  # noqa: E402


class TestRateLimitDetection(unittest.TestCase):
    def test_markers(self):
        self.assertTrue(yf_retry.is_rate_limit_error("Too Many Requests. Rate limited."))
        self.assertTrue(yf_retry.is_rate_limit_error(Exception("HTTP 429")))
        self.assertFalse(yf_retry.is_rate_limit_error("insufficient_history"))
        self.assertTrue(yf_retry.is_rate_limit_payload(
            {"error": "fetch_failed: Too Many Requests. Rate limited.", "f_score": None}
        ))
        self.assertFalse(yf_retry.is_rate_limit_payload({"error": None}))
        self.assertFalse(yf_retry.should_cache_yf_payload(
            {"error": "fetch_failed: rate limited"}
        ))
        self.assertTrue(yf_retry.should_cache_yf_payload({"error": None, "rsi14": 30}))


class TestCallWithRetry(unittest.TestCase):
    def test_succeeds_first_try(self):
        self.assertEqual(yf_retry.call_with_retry(lambda: 42, max_attempts=3), 42)

    def test_retries_then_succeeds(self):
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("Too Many Requests. Rate limited.")
            return "ok"

        with patch("yf_retry.time.sleep"):
            self.assertEqual(yf_retry.call_with_retry(flaky, max_attempts=3, base_delay_s=0.01), "ok")
        self.assertEqual(calls["n"], 3)

    def test_retries_on_retryable_result(self):
        calls = {"n": 0}

        def empty_then_data():
            calls["n"] += 1
            if calls["n"] < 2:
                return {}
            return {"Close": 1}

        with patch("yf_retry.time.sleep"):
            got = yf_retry.call_with_retry(
                empty_then_data,
                max_attempts=3,
                base_delay_s=0.01,
                retryable_result=lambda d: not d,
            )
        self.assertEqual(got, {"Close": 1})

    def test_non_retryable_raises_immediately(self):
        calls = {"n": 0}

        def boom():
            calls["n"] += 1
            raise ValueError("hard fail")

        with self.assertRaises(ValueError):
            yf_retry.call_with_retry(boom, max_attempts=3)
        self.assertEqual(calls["n"], 1)


class TestCachedCallShouldCache(unittest.TestCase):
    def test_rate_limit_not_written(self,):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            # Ensure cache is enabled
            old = os.environ.pop("NSE_SWING_NO_CACHE", None)
            try:
                result = cached_call(
                    "rl:test",
                    3600,
                    lambda: {"error": "fetch_failed: Too Many Requests. Rate limited."},
                    cache_dir=tmp,
                    should_cache=yf_retry.should_cache_yf_payload,
                )
                self.assertIn("Too Many", result["error"])
                self.assertIsNone(read_cache("rl:test", cache_dir=tmp))

                ok = cached_call(
                    "ok:test",
                    3600,
                    lambda: {"error": None, "v": 1},
                    cache_dir=tmp,
                    should_cache=yf_retry.should_cache_yf_payload,
                )
                self.assertEqual(ok["v"], 1)
                self.assertEqual(read_cache("ok:test", cache_dir=tmp)["v"], 1)
            finally:
                if old is not None:
                    os.environ["NSE_SWING_NO_CACHE"] = old
                else:
                    os.environ["NSE_SWING_NO_CACHE"] = "1"


if __name__ == "__main__":
    unittest.main()

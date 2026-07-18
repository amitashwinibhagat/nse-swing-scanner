"""Tests for backend/performance.py (C1 plan item)."""
import datetime
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import performance  # noqa: E402


class TestCohortStats(unittest.TestCase):
    def test_empty(self):
        s = performance.cohort_stats([])
        self.assertEqual(s["n"], 0)
        self.assertIsNone(s["median"])
        self.assertIsNone(s["q1"])

    def test_single(self):
        s = performance.cohort_stats([5.0])
        self.assertEqual(s["n"], 1)
        self.assertEqual(s["median"], 5.0)
        self.assertEqual(s["mean"], 5.0)

    def test_known_distribution(self):
        # 1..10 → median 5.5, q1 ~3.25, q3 ~7.75 (inclusive)
        vals = [float(i) for i in range(1, 11)]
        s = performance.cohort_stats(vals)
        self.assertEqual(s["n"], 10)
        self.assertEqual(s["median"], 5.5)
        self.assertEqual(s["q1"], 3.25)
        self.assertEqual(s["q3"], 7.75)
        self.assertEqual(s["mean"], 5.5)

    def test_skewed(self):
        # Heavy right tail — median should be far below the mean.
        vals = [-5.0, -3.0, -1.0, 0.0, 0.0, 1.0, 50.0]
        s = performance.cohort_stats(vals)
        self.assertEqual(s["median"], 0.0)
        self.assertGreater(s["mean"], s["median"])


class TestScoreBucket(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual(performance.score_bucket(85.0), "80+")
        self.assertEqual(performance.score_bucket(80.0), "80+")
        self.assertEqual(performance.score_bucket(75.0), "70-79")
        self.assertEqual(performance.score_bucket(70.0), "70-79")
        self.assertEqual(performance.score_bucket(65.0), "60-69")
        self.assertEqual(performance.score_bucket(60.0), "60-69")
        self.assertEqual(performance.score_bucket(59.9), "<60")
        self.assertEqual(performance.score_bucket(None), "unknown")


def _scan(symbols_with_scores, idx_pct=-1.5, confirmations=None):
    """Build a synthetic scan. confirmations: optional {symbol: state} map."""
    stocks = []
    for i, (sym, sc) in enumerate(symbols_with_scores):
        s = {
            "symbol": sym,
            "gate_pass": True,
            "swing_score": sc,
            "market_index_pct_from_ema200": idx_pct,
        }
        if confirmations and sym in confirmations:
            s["confirmation_state"] = confirmations[sym]
        stocks.append(s)
    return {
        "generated_at": "2026-07-15T10:31:00+00:00",
        "stocks": stocks,
    }


class TestBuildPayload(unittest.TestCase):
    def test_per_scan_and_buckets(self):
        snapshots = [
            ("2026-07-15-pm", _scan([("A", 85), ("B", 75), ("C", 65), ("D", 50)])),
            ("2026-07-16-pm", _scan([("A", 82), ("B", 78), ("E", 88)])),
        ]
        # Synthetic forward returns — each symbol returns +2% vs index in
        # each window; one symbol is untrackable.
        forward = {
            ("2026-07-15-pm", "A"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-15-pm", "B"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-15-pm", "C"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-15-pm", "D"): {
                w: {"untrackable": True, "reason": "delisted",
                    "stock_return_pct": None, "index_return_pct": None,
                    "excess_return_pct": None} for w in (5, 10, 20)
            },
            ("2026-07-16-pm", "A"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-16-pm", "B"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-16-pm", "E"): {w: _perf(2.0) for w in (5, 10, 20)},
        }
        payload = performance.build_performance_payload(snapshots, forward, retention_days=90)

        # Two scans used, four + three = seven passed.
        self.assertEqual(payload["meta"]["snapshots_used"], 2)
        self.assertEqual(payload["meta"]["total_passed"], 7)
        self.assertEqual(payload["retention_days"], 90)

        # Per-scan cohorts at T+20 (the slowest window to land).
        ps20 = [c["windows"]["T+20"]["n"] for c in payload["per_scan"]]
        self.assertEqual(ps20, [3, 3])  # D was untrackable

        # Buckets at T+20: 80+ = [A, A, E] = 3, 70-79 = [B, B] = 2,
        # 60-69 = [C] = 1, <60 = [] = 0.
        buckets = payload["windows"]["T+20"]["buckets"]
        self.assertEqual(buckets["80+"]["n"], 3)
        self.assertEqual(buckets["70-79"]["n"], 2)
        self.assertEqual(buckets["60-69"]["n"], 1)
        self.assertEqual(buckets["<60"]["n"], 0)
        self.assertEqual(buckets["80+"]["median"], 2.0)

        # Untrackable counted (D counts in all three windows).
        self.assertEqual(payload["windows"]["T+20"]["untrackable_count"], 1)
        self.assertEqual(payload["windows"]["T+5"]["untrackable_count"], 1)

    def test_no_snapshots_emits_empty_payload(self):
        payload = performance.build_performance_payload([], {}, retention_days=0)
        self.assertEqual(payload["meta"]["snapshots_used"], 0)
        self.assertEqual(payload["per_scan"], [])
        # All windows present, all buckets empty.
        for w_label in ("T+5", "T+10", "T+20"):
            self.assertIn(w_label, payload["windows"])
            for b in ("80+", "70-79", "60-69", "<60", "unknown"):
                self.assertEqual(payload["windows"][w_label]["buckets"][b]["n"], 0)


def _perf(excess):
    return {
        "stock_return_pct": round(excess, 2),
        "index_return_pct": 0.0,
        "excess_return_pct": round(excess, 2),
        "untrackable": False,
        "reason": None,
    }


class TestRegimeAndPerName(unittest.TestCase):
    def test_regime_tag_thresholds(self):
        self.assertEqual(performance.regime_tag(3.0), "risk_on")
        self.assertEqual(performance.regime_tag(2.01), "risk_on")
        self.assertEqual(performance.regime_tag(2.0), "neutral")  # strict >
        self.assertEqual(performance.regime_tag(1.9), "neutral")
        self.assertEqual(performance.regime_tag(-1.9), "neutral")
        self.assertEqual(performance.regime_tag(-2.0), "neutral")  # strict <
        self.assertEqual(performance.regime_tag(-2.01), "risk_off")
        self.assertEqual(performance.regime_tag(-5.0), "risk_off")
        self.assertEqual(performance.regime_tag(None), "unknown")

    def test_per_name_rows_carry_regime_and_confirmation(self):
        snapshots = [
            ("2026-07-15-pm", _scan(
                [("A", 85), ("B", 75)],
                idx_pct=-3.5,
                confirmations={"A": "confirmed", "B": "anticipatory"},
            )),
        ]
        forward = {
            ("2026-07-15-pm", "A"): {w: _perf(2.0) for w in (5, 10, 20)},
            ("2026-07-15-pm", "B"): {w: _perf(-1.0) for w in (5, 10, 20)},
        }
        payload = performance.build_performance_payload(snapshots, forward)
        per_name = payload["per_name"]
        self.assertEqual(len(per_name), 2)
        by_sym = {r["symbol"]: r for r in per_name}
        self.assertEqual(by_sym["A"]["regime"], "risk_off")  # idx_pct=-3.5
        self.assertEqual(by_sym["A"]["confirmation"], "confirmed")
        self.assertEqual(by_sym["A"]["bucket"], "80+")
        self.assertEqual(by_sym["B"]["confirmation"], "anticipatory")
        self.assertEqual(by_sym["B"]["windows"]["T+20"]["excess_return_pct"], -1.0)
        # Cohort-level regime tag too
        self.assertEqual(payload["per_scan"][0]["regime"], "risk_off")

    def test_by_regime_splits_cohorts(self):
        snapshots = [
            ("2026-07-14-pm", _scan([("X", 80)], idx_pct=3.0)),    # risk_on
            ("2026-07-15-pm", _scan([("Y", 80)], idx_pct=-3.0)),   # risk_off
        ]
        forward = {
            ("2026-07-14-pm", "X"): {w: _perf(4.0) for w in (5, 10, 20)},
            ("2026-07-15-pm", "Y"): {w: _perf(-2.0) for w in (5, 10, 20)},
        }
        payload = performance.build_performance_payload(snapshots, forward)
        t20 = payload["by_regime"]["T+20"]
        self.assertEqual(t20["risk_on"]["n"], 1)
        self.assertEqual(t20["risk_on"]["median"], 4.0)
        self.assertEqual(t20["risk_off"]["n"], 1)
        self.assertEqual(t20["risk_off"]["median"], -2.0)
        self.assertEqual(t20["neutral"]["n"], 0)

    def test_per_name_untrackable_marked(self):
        snapshots = [("2026-07-15-pm", _scan([("A", 80)]))]
        # No forward returns at all → untrackable
        payload = performance.build_performance_payload(snapshots, {})
        row = payload["per_name"][0]
        self.assertTrue(row["windows"]["T+20"]["untrackable"])
        self.assertIsNone(row["windows"]["T+20"]["excess_return_pct"])


if __name__ == "__main__":
    unittest.main()
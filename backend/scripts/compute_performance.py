#!/usr/bin/env python3
"""
compute_performance.py
Weekly outcome tracker: read snapshot history, fetch forward returns for
the gate-passed cohort, write data/performance.json.

Implements the C1 plan item. Statistical discipline lives in
backend/performance.py; this script is the CLI + IO shell.

Usage:
    python backend/scripts/compute_performance.py \\
        --snapshots ../frontend/public/data/snapshots \\
        --output ../frontend/public/data/performance.json \\
        [--cache-dir backend/cache] [--no-cache]

Exit codes:
  0  success (even if no snapshots — payload reports "snapshots_used": 0)
  1  invalid arguments / IO error / zero trackable when data should exist
"""
import argparse
import json
import os
import sys
from typing import List, Tuple

# Script dir is on sys.path when run as `python scripts/compute_performance.py`;
# backend/ (parent) is not — add it so `import performance` resolves.
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPTS_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from performance import (  # noqa: E402
    WINDOWS,
    build_performance_payload,
    fetch_forward_returns,
    outcome_quality_ok,
    write_performance_payload,
)
from snapshot_writer import SNAPSHOT_FILENAME_RE  # noqa: E402


def load_snapshots(snapshots_dir: str) -> List[Tuple[str, dict]]:
    """Load every dated snapshot file in snapshots_dir, sorted ascending."""
    if not os.path.isdir(snapshots_dir):
        return []
    out: List[Tuple[str, dict]] = []
    for name in os.listdir(snapshots_dir):
        m = SNAPSHOT_FILENAME_RE.match(name)
        if not m:
            continue
        path = os.path.join(snapshots_dir, name)
        try:
            with open(path, "r") as f:
                scan = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        date_str = m.group(1)
        slot = m.group(2)
        label = f"{date_str}-{slot}"
        out.append((label, scan))
    out.sort(key=lambda kv: (kv[0].split("-")[0:3], kv[0].split("-")[3]))
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Compute forward-return attribution from snapshot history.")
    p.add_argument("--snapshots", required=True, help="Directory of dated snapshot files")
    p.add_argument("--output", required=True, help="Path to write performance.json")
    p.add_argument("--cache-dir", default=None, help="Cache directory for fetched prices (default: alongside snapshots)")
    p.add_argument("--no-cache", action="store_true", help="Bypass the prices cache (force re-fetch)")
    p.add_argument(
        "--allow-empty-trackable",
        action="store_true",
        help="Do not fail when T+5 trackable_count is 0 despite untrackable rows",
    )
    args = p.parse_args(argv)

    cache_dir = args.cache_dir or os.path.join(os.path.dirname(args.snapshots), "..", "..", "backend", "cache")
    cache_dir = os.path.abspath(cache_dir)

    snapshots = load_snapshots(args.snapshots)
    if not snapshots:
        payload = build_performance_payload([], {}, retention_days=0)
        payload["meta"]["note"] = "No snapshots available yet — outcome tracker is empty."
        write_performance_payload(payload, args.output)
        print(f"compute_performance: 0 snapshots; wrote empty payload to {args.output}")
        return 0

    try:
        forward = fetch_forward_returns(
            snapshots,
            cache_dir=cache_dir,
            no_cache=args.no_cache,
        )
    except Exception as e:
        print(f"::error::compute_performance: forward-return fetch failed: {e}", file=sys.stderr)
        return 1

    payload = build_performance_payload(snapshots, forward)
    write_performance_payload(payload, args.output)
    n = payload["meta"]["snapshots_used"]
    t5 = (payload["meta"].get("trackable_count") or {}).get("T+5", 0)
    u5 = (payload["meta"].get("untrackable_count") or {}).get("T+5", 0)
    nc5 = (payload["meta"].get("window_not_closed_count") or {}).get("T+5", 0)
    print(
        f"compute_performance: {n} snapshots; windows={WINDOWS}; "
        f"T+5 trackable={t5} untrackable={u5} not_closed={nc5}; "
        f"output={args.output}"
    )

    ok, reason = outcome_quality_ok(payload)
    if not ok and not args.allow_empty_trackable:
        print(f"::error::compute_performance: {reason}", file=sys.stderr)
        return 1
    if not ok:
        print(f"::warning::compute_performance: {reason} (allowed)")
    else:
        print(f"compute_performance: quality ok ({reason})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

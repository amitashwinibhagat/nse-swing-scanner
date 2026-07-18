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
  1  invalid arguments / IO error
"""
import argparse
import json
import os
import sys
from typing import List, Tuple

from performance import (
    WINDOWS,
    build_performance_payload,
    fetch_forward_returns,
    write_performance_payload,
)
from snapshot_writer import SNAPSHOT_FILENAME_RE, parse_iso_utc


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
    print(
        f"compute_performance: {n} snapshots; windows={WINDOWS}; "
        f"output={args.output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
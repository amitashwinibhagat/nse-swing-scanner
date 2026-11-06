#!/usr/bin/env python3
"""
write_scan_status.py
Writes frontend/public/data/scan_status.json — the metadata file the dashboard
reads for freshness, drift and the "next scan due" note.

Why this is a script and not a heredoc in scan.yml
--------------------------------------------------
It used to be ~50 lines of inline Python inside the workflow. Two consequences:

  * `check_workflow_scripts.py` could not see it (it only discovers
    `python scripts/*.py` invocations), so a rename of `scan_schedule` would
    break the status file with no CI signal.
  * the whole body was wrapped in `except Exception: warn; sys.exit(0)`, which
    turned a real bug into a permanent, silent warning — and a stale
    scan_status.json then corrupts the watchdog's staleness math.

The script now fails loudly and is covered by the same invocation guard as
every other entrypoint.

Window attribution: the workflow passes the cron that actually fired
(`github.event.schedule`) through `GH_EVENT_SCHEDULE`. Attribution uses that,
so drift is the true scheduler delay instead of the nearest-wall-clock guess
that reported "49 min late" for a run that was 7.7 h late.

Usage (from scan.yml, cwd=backend):
    GH_EVENT_NAME=schedule GH_EVENT_SCHEDULE=03:30 ... \\
        python scripts/write_scan_status.py
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from scan_schedule import (  # noqa: E402
    attribute_fired_window,
    expected_staleness_minutes,
    next_scheduled_window,
    scheduled_cron_string,
    window_for_cron,
)


def build_status(
    *,
    scan: dict,
    trigger: str,
    fired_window: str,
    commit_sha: str,
    run_id: str,
    now: datetime.datetime,
    source: str = "github-cron",
) -> dict:
    """
    Compose the status payload.

    `fired_window` is the *window label* the workflow resolved from
    `github.event.schedule` (e.g. "03:30"), or "" for an unscheduled run.
    """
    cron = ""
    if fired_window:
        try:
            hh, mm = (int(part) for part in fired_window.split(":"))
            cron = scheduled_cron_string([(hh, mm)])
        except (ValueError, TypeError):
            cron = ""
    scheduled_window_utc, drift_minutes, occurrence = attribute_fired_window(now, cron)
    next_expected = next_scheduled_window(now)
    window = window_for_cron(cron) if cron else None

    payload = {
        "generated_at": scan.get("generated_at"),
        "triggered_at": now.isoformat(),
        "commit_sha": commit_sha,
        "run_id": run_id,
        "trigger": trigger,
        "scheduled_window_utc": scheduled_window_utc,
        "scheduled_cron": scheduled_cron_string(),
        "scheduled_window_at_utc": occurrence.isoformat() if occurrence else None,
        "next_expected_utc": next_expected.isoformat() if next_expected else None,
        "drift_minutes": drift_minutes,
        # How late a run may be before the dashboard calls the feed stale.
        # Derived from measured scheduler drift; see scan_schedule.
        # Adaptive: 90 min for the punctual external scheduler, 8 h for the
        # GitHub-cron fallback (see scan_schedule).
        "stale_after_minutes": (
            expected_staleness_minutes(window, source) if window else None
        ),
        "schedule_source": source,
    }

    health = scan.get("source_health")
    if isinstance(health, dict):
        payload["source_health"] = {
            "critical_source_failed": bool(health.get("critical_source_failed")),
            "degraded_gates": health.get("degraded_gates") or [],
        }
    payload["gate_pass_count"] = scan.get("gate_pass_count")
    payload["universe_size"] = scan.get("universe_size")
    return payload


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Write scan_status.json.")
    parser.add_argument("--scan", default="../frontend/public/data/latest_scan.json")
    parser.add_argument("--out", default="../frontend/public/data/scan_status.json")
    parser.add_argument("--now", default=None, help="Override now (ISO); for tests")
    args = parser.parse_args(argv)

    with open(args.scan, "r") as fh:
        scan = json.load(fh)

    now = (
        datetime.datetime.fromisoformat(args.now.replace("Z", "+00:00"))
        if args.now
        else datetime.datetime.now(datetime.timezone.utc)
    )

    status = build_status(
        scan=scan,
        trigger=os.environ.get("GH_EVENT_NAME", "unknown"),
        fired_window=os.environ.get("GH_EVENT_SCHEDULE", "").strip(),
        commit_sha=os.environ.get("GH_SHA", ""),
        run_id=os.environ.get("GH_RUN_ID", ""),
        now=now,
        source=os.environ.get("GH_SCHEDULE_SOURCE", "github-cron"),
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fh:
        json.dump(status, fh, indent=2)

    print(json.dumps(status, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

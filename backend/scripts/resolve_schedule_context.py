#!/usr/bin/env python3
"""
resolve_schedule_context.py
Decides, for one workflow run, which scan window it belongs to and whether it
should run at all.

Why this is a script and not an inline heredoc
---------------------------------------------
Two reasons, both learned the hard way on this repo:

  * `check_workflow_scripts.py` only discovers `python scripts/*.py`
    invocations, so logic hidden in a heredoc is never smoke-tested and a
    rename can break it with no CI signal.
  * the skip decision (below) is the duplicate-suppression mechanism. It needs
    tests, and tests need an importable module.

Three triggers converge here
----------------------------
  schedule            the GitHub cron that fired (`github.event.schedule`).
                      Best-effort: measured median 5.4 h late on this repo.
  repository_dispatch an external punctual scheduler (Netlify scheduled
                      functions) which names the window in `client_payload`.
  workflow_dispatch   a human. No window, no pings, never skipped.

Duplicate suppression
---------------------
Both the punctual scheduler and GitHub's cron can fire for the SAME window
(GitHub's can arrive hours later). `scan.yml` uses `concurrency` with
`cancel-in-progress: false`, so the second run starts only after the first
finishes — which means its checkout already contains the first run's commit.
If that commit's `generated_at` is at or after the window occurrence, the
window is covered and the run is skipped instead of scanning twice.

A missing/unreadable last-good scan never skips: a missing scan is exactly
what these triggers exist to fix.

Usage (from scan.yml, cwd=backend):
    GH_EVENT_NAME=schedule GH_EVENT_SCHEDULE="30 3 * * 1-5" \\
    GH_PAYLOAD_WINDOW= MORNING_URL=... EVENING_URL=... \\
        python scripts/resolve_schedule_context.py

Writes `key=value` lines to $GITHUB_OUTPUT (or --stdout for local runs).
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from scan_schedule import (  # noqa: E402
    WINDOWS,
    scheduled_cron_string,
    window_for_cron,
    window_label,
    window_occurrence,
    window_slot,
)


def _parse_window_label(value: str) -> Optional[tuple]:
    """'03:30' -> (3, 30), or None when it is not a configured window."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        hh, mm = (int(part) for part in value.split(":"))
    except (TypeError, ValueError):
        return None
    return window_for_cron(scheduled_cron_string([(hh, mm)]))


def _last_scan_generated_at(path: Path) -> Optional[datetime.datetime]:
    try:
        with path.open() as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    raw = (payload or {}).get("generated_at")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def resolve(
    *,
    event: str,
    fired_cron: str = "",
    payload_window: str = "",
    morning_url: str = "",
    evening_url: str = "",
    latest_scan_path: Optional[Path] = None,
    now: Optional[datetime.datetime] = None,
) -> dict:
    """
    The decision, as a plain dict.

    Raises ValueError when a repository_dispatch names a window that is not
    configured — a typo there would otherwise be silently treated as an ad-hoc
    run with no attribution and no healthcheck.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)

    if event == "schedule":
        window = window_for_cron(fired_cron)
        source = "github-cron"
    elif event == "repository_dispatch":
        window = _parse_window_label(payload_window)
        if payload_window and window is None:
            raise ValueError(
                f"repository_dispatch window {payload_window!r} is not one of {WINDOWS}"
            )
        source = "external-scheduler"
    else:
        window = None
        source = "manual"

    skip = False
    skip_reason = ""
    occurrence_iso = ""
    if window is not None:
        occurrence = window_occurrence(window, now)
        occurrence_iso = occurrence.isoformat()
        if latest_scan_path is not None:
            last = _last_scan_generated_at(Path(latest_scan_path))
            if last is not None and last >= occurrence:
                skip = True
                skip_reason = (
                    f"window {occurrence_iso} already covered by a scan "
                    f"generated at {last.isoformat()}"
                )

    label = window_label(window) if window else ""
    if label == "morning":
        url = morning_url
    elif label == "evening":
        url = evening_url
    else:
        url = ""

    return {
        "trigger": event,
        "source": source,
        "window_utc": f"{window[0]:02d}:{window[1]:02d}" if window else "",
        "window_occurrence_utc": occurrence_iso,
        "slot": window_slot(window) or "",
        "healthcheck_url": url,
        "scheduled": "true" if window else "false",
        "skip": "true" if skip else "false",
        "skip_reason": skip_reason,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Resolve which scan window this run belongs to, and whether to skip it."
    )
    parser.add_argument(
        "--latest-scan",
        default="../frontend/public/data/latest_scan.json",
        help="Last committed scan, used to detect an already-covered window",
    )
    parser.add_argument(
        "--now", default=None, help="Override now (ISO); for tests"
    )
    parser.add_argument(
        "--stdout", action="store_true", help="Print key=value instead of writing $GITHUB_OUTPUT"
    )
    args = parser.parse_args(argv)

    now = None
    if args.now:
        now = datetime.datetime.fromisoformat(args.now.replace("Z", "+00:00"))
        if now.tzinfo is None:
            now = now.replace(tzinfo=datetime.timezone.utc)

    try:
        out = resolve(
            event=os.environ.get("GH_EVENT_NAME", ""),
            fired_cron=os.environ.get("GH_EVENT_SCHEDULE", ""),
            payload_window=os.environ.get("GH_PAYLOAD_WINDOW", ""),
            morning_url=os.environ.get("MORNING_URL", ""),
            evening_url=os.environ.get("EVENING_URL", ""),
            latest_scan_path=Path(args.latest_scan) if args.latest_scan else None,
            now=now,
        )
    except ValueError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    print(json.dumps(out, indent=2))
    if out["skip"] == "true":
        print(f"::notice::skipping scan — {out['skip_reason']}")

    if args.stdout:
        for key, value in out.items():
            print(f"{key}={value}")
        return 0

    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a") as fh:
            for key, value in out.items():
                fh.write(f"{key}={value}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

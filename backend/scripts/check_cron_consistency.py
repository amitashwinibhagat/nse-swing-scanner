#!/usr/bin/env python3
"""
CI guard: assert that the weekday scan cron expressions in
.github/workflows/scan.yml (the live schedule) match the SCAN_WINDOWS_UTC
list in backend/settings.py — the single source of truth consumed by
scan_status.json's window attribution and watchdog_check.py's staleness
logic. Also sanity-checks the watchdog's 15-min cron window.

History: this guard previously validated .circleci/config.yml's `triggers:`
block. Those triggers are inert on GitHub App projects (documented in the
CircleCI config, removed in 1.3.3), so the guard was checking a schedule
that never ran. It now checks the schedule that actually fires scans.

If you add or change a scheduled scan window, update BOTH
.github/workflows/scan.yml's `on.schedule` AND SCAN_WINDOWS_UTC in
backend/settings.py in the same commit — this script fails CI until they
agree.

Usage:
    python backend/scripts/check_cron_consistency.py
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_YML = REPO_ROOT / ".github" / "workflows" / "scan.yml"
WATCHDOG_YML = REPO_ROOT / ".github" / "workflows" / "watchdog.yml"
NETLIFY_TOML = REPO_ROOT / "netlify.toml"
SCHEDULED_FN_DIR = REPO_ROOT / "frontend" / "netlify" / "functions"

_BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND_DIR))

from settings import SCAN_WINDOWS_UTC  # noqa: E402
from scan_schedule import WINDOW_LABELS, scheduled_cron_string  # noqa: E402


def extract_scan_cron_entries(text: str) -> list:
    """Weekday once-an-hour scan crons: 'M H * * 1-5' (not watchdog */15)."""
    return re.findall(r'^\s+- cron:\s*"(\d+ \d+ \* \* 1-5)"', text, flags=re.MULTILINE)


def expected_cron_strings(windows) -> list:
    return [f"{m} {h} * * 1-5" for h, m in windows]


def main() -> int:
    failures = []

    # --- scan.yml crons vs SCAN_WINDOWS_UTC (the load-bearing check) ---
    if not SCAN_YML.exists():
        print(f"::error::scan.yml not found at {SCAN_YML}")
        return 1
    text = SCAN_YML.read_text()
    found = extract_scan_cron_entries(text)
    expected = expected_cron_strings(SCAN_WINDOWS_UTC)
    if found != expected:
        failures.append(
            f"Scan cron entries in {SCAN_YML.relative_to(REPO_ROOT)} don't match "
            f"SCAN_WINDOWS_UTC in backend/settings.py.\n"
            f"  found:    {found}\n"
            f"  expected: {expected}\n"
            f"  Update both in the same commit."
        )

    # --- every configured window must have a display label + slot ---
    missing_labels = [w for w in SCAN_WINDOWS_UTC if w not in WINDOW_LABELS]
    if missing_labels:
        failures.append(
            "SCAN_WINDOWS_UTC contains window(s) with no entry in "
            f"scan_schedule.WINDOW_LABELS: {missing_labels}. The workflow resolves "
            "the healthcheck URL and snapshot slot from that mapping, so a new "
            "window without a label silently loses its pings and --slot."
        )

    # --- every window's cron string must be usable as a lookup key ---
    for window in SCAN_WINDOWS_UTC:
        cron = scheduled_cron_string([window])
        if cron not in found:
            failures.append(
                f"window {window} maps to cron '{cron}', which is not present in "
                "scan.yml's on.schedule."
            )

    # --- the punctual Netlify scheduler must agree with the same windows ---
    #
    # GitHub's cron is hours late, so the actual punctual trigger is a pair of
    # Netlify scheduled functions dispatching repository_dispatch. They are a
    # THIRD copy of the schedule (YAML + settings.py + netlify.toml), so this
    # guard has to check them or they will silently drift apart.
    if NETLIFY_TOML.exists():
        toml_text = NETLIFY_TOML.read_text()
        netlify_schedules = re.findall(
            r'\[functions\."([^"]+)"\]\s*\n\s*schedule\s*=\s*"([^"]+)"',
            toml_text,
        )
        netlify_crons = sorted(cron for _, cron in netlify_schedules)
        if netlify_crons != sorted(expected):
            failures.append(
                "netlify.toml scheduled-function crons don't match SCAN_WINDOWS_UTC.\n"
                f"  found:    {netlify_crons}\n"
                f"  expected: {sorted(expected)}\n"
                "  The Netlify functions are the punctual trigger; the GitHub crons "
                "are only the fallback."
            )

        # Each scheduled function module must declare the SAME cron inline.
        # Netlify honours netlify.toml, but a module/TOML mismatch means one of
        # the two is a lie and the next reader will trust the wrong one.
        for fn_name, toml_cron in netlify_schedules:
            module = SCHEDULED_FN_DIR / f"{fn_name}.mjs"
            if not module.is_file():
                failures.append(
                    f"netlify.toml schedules {fn_name!r} but "
                    f"frontend/netlify/functions/{fn_name}.mjs does not exist."
                )
                continue
            module_text = module.read_text()
            match = re.search(r'schedule:\s*"([^"]+)"', module_text)
            if not match:
                failures.append(f"{module.name}: no `config.schedule` exported.")
            elif match.group(1) != toml_cron:
                failures.append(
                    f"{module.name}: config.schedule {match.group(1)!r} != "
                    f"netlify.toml {toml_cron!r}."
                )
    else:
        failures.append("netlify.toml not found — the punctual scheduler is unconfigured.")

    # --- watchdog cron sanity: 15-min cadence, weekday hours 1-20 UTC ---
    if WATCHDOG_YML.exists():
        wtext = WATCHDOG_YML.read_text()
        watchdog_crons = re.findall(r'^\s+- cron:\s*"([^"]+)"', wtext, flags=re.MULTILINE)
        if "*/15 1-20 * * 1-5" not in watchdog_crons:
            failures.append(
                "watchdog.yml cron must be '*/15 1-20 * * 1-5' (15-min ticks, "
                "06:30-01:30 IST weekdays). The window must cover the observed "
                "evening scan completion (~18:10 UTC), not stop at 13:00. Found: "
                f"{watchdog_crons or 'none'}. If you intentionally changed the "
                "watchdog window, update this guard in the same commit."
            )

    if failures:
        for f in failures:
            print("::error::" + f)
        return 1

    print(f"OK: {len(found)} scan cron entries match SCAN_WINDOWS_UTC; watchdog cron ok.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

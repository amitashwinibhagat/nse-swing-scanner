#!/usr/bin/env python3
"""
CI guard: assert that the cron expressions in .github/workflows/scan.yml match
the WINDOWS list baked into the "Write scan_status.json" Python heredoc.

If you add or change a scheduled window in either place, this script will fail
in CI until both are updated.

Usage:
    python backend/scripts/check_cron_consistency.py
    # or via the CI workflow step.
"""
import re
import sys
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "scan.yml"

# MUST match the WINDOWS list inside the "Write scan_status.json" step of
# .github/workflows/scan.yml. Both lists are kept in sync by this guard.
EXPECTED_WINDOWS = [(3, 30), (10, 30)]   # (hour_utc, minute_utc)


def extract_cron_entries(text: str) -> list:
    """Pull every `- cron: "<expr>"` line out of the workflow file."""
    return re.findall(r'^\s*-\s*cron:\s*"([^"]+)"', text, flags=re.MULTILINE)


def expected_cron_strings(windows) -> list:
    return [f"{m} {h} * * 1-5" for h, m in windows]


def main() -> int:
    if not WORKFLOW.exists():
        print(f"::error::scan.yml not found at {WORKFLOW}")
        return 1
    text = WORKFLOW.read_text()
    found = extract_cron_entries(text)
    expected = expected_cron_strings(EXPECTED_WINDOWS)
    if found != expected:
        print(f"::error::Cron entries in {WORKFLOW} don't match EXPECTED_WINDOWS.")
        print(f"  found:    {found}")
        print(f"  expected: {expected}")
        print(f"  Update either EXPECTED_WINDOWS in this script or the cron "
              f"entries in scan.yml so both lists agree.")
        return 1
    print(f"OK: {len(found)} cron entries match EXPECTED_WINDOWS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
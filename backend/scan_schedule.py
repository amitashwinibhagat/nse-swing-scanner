"""
scan_schedule.py
Single source of truth for the twice-daily scan schedule and the window
attribution / next-expected-window math.

Consumers:
  - .github/workflows/scan.yml  ("Resolve schedule context" + write_scan_status)
  - backend/scripts/write_scan_status.py (scan_status.json)
  - backend/scripts/watchdog_check.py (staleness decision)
  - backend/scripts/check_cron_consistency.py (CI guard)

If you change the cron expressions in .github/workflows/scan.yml, change
SCAN_WINDOWS_UTC (in settings.py) in the same commit — the CI guard fails
until both agree.
"""
from __future__ import annotations

import datetime
from typing import List, Optional, Tuple

from settings import SCAN_WINDOWS_UTC

# Re-exported for convenience so consumers import only this module.
WINDOWS: List[Tuple[int, int]] = SCAN_WINDOWS_UTC

# Display label for each window. The morning window is the pre-open scan
# (03:30 UTC = 09:00 IST) and the evening window is post-close
# (10:30 UTC = 16:00 IST). These names are what the healthcheck secrets and
# the snapshot slot are keyed on, and the only place that mapping lives.
WINDOW_LABELS = {
    (3, 30): "morning",
    (10, 30): "evening",
}

# Snapshot slot per window, consumed by snapshot_writer (--slot).
WINDOW_SLOTS = {"morning": "am", "evening": "pm"}


def window_label(window: Optional[Tuple[int, int]]) -> Optional[str]:
    """'morning' / 'evening' for a (hour, minute) window, else None."""
    if not window:
        return None
    return WINDOW_LABELS.get(tuple(window))


def window_slot(window: Optional[Tuple[int, int]]) -> Optional[str]:
    """'am' / 'pm' snapshot slot for a window, else None."""
    label = window_label(window)
    return WINDOW_SLOTS.get(label) if label else None


def window_for_cron(cron: str) -> Optional[Tuple[int, int]]:
    """
    Inverse of `scheduled_cron_string`: '30 3 * * 1-5' -> (3, 30).

    Returns None for a cron that is not one of the configured windows, which is
    how a caller detects "this workflow was dispatched, not scheduled".
    """
    cron = (cron or "").strip()
    if not cron:
        return None
    for window in WINDOWS:
        if scheduled_cron_string([window]) == cron:
            return window
    return None


def clock_minute_delta(a: datetime.datetime, b: datetime.datetime) -> int:
    """Circular distance in minutes between two wall-clock HH:MM values."""
    a_m = a.hour * 60 + a.minute
    b_m = b.hour * 60 + b.minute
    return min(abs(a_m - b_m), 1440 - abs(a_m - b_m))


def most_recent_window(
    now: datetime.datetime,
    windows: List[Tuple[int, int]] = WINDOWS,
) -> Optional[Tuple[datetime.datetime, str]]:
    """
    The scheduled window most plausibly responsible for a scan completing at
    `now`: the closest-past candidate among today's windows plus YESTERDAY'S
    LAST window only (yesterday's earlier windows are too far back to
    plausibly be "the most recent past cron"; including them caused
    misattribution in the 00:00–first-window UTC span — fixed in 1.1.3).

    Returns (window_dt, "HH:MM") or None when no candidate is in the past.

    WARNING: this is a *fallback* for runs whose cron we cannot see (manual
    dispatch, repository_dispatch). It is wrong by construction under large
    scheduler drift — the closest wall-clock window is not necessarily the one
    that fired. Prefer `attribute_fired_window` whenever the caller has
    `github.event.schedule`.
    """
    today = now.date()
    cands: List[Tuple[datetime.datetime, str]] = []
    for h, m in windows:
        cands.append((
            datetime.datetime.combine(today, datetime.time(h, m), tzinfo=datetime.timezone.utc),
            f"{h:02d}:{m:02d}",
        ))
    last_h, last_m = windows[-1]
    cands.append((
        datetime.datetime.combine(
            today - datetime.timedelta(days=1),
            datetime.time(last_h, last_m),
            tzinfo=datetime.timezone.utc,
        ),
        f"{last_h:02d}:{last_m:02d}",
    ))
    past = [(dt, label) for dt, label in cands if dt <= now]
    if not past:
        return None
    return min(past, key=lambda p: clock_minute_delta(now, p[0]))


def window_occurrence(
    window: Tuple[int, int],
    now: datetime.datetime,
) -> datetime.datetime:
    """
    The most recent scheduled occurrence of `window` at or before `now`.

    Weekday-aware: GitHub's crons (and the Netlify scheduler that mirrors them)
    only fire Mon-Fri, so a Monday-morning run can never be "yesterday's"
    (Sunday) window. Walking backwards past a weekend is the difference between
    reporting a real drift and reporting a 60-hour fictitious one.
    """
    h, m = window
    candidate = datetime.datetime.combine(
        now.date(), datetime.time(h, m), tzinfo=datetime.timezone.utc
    )
    if candidate > now:
        candidate -= datetime.timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate -= datetime.timedelta(days=1)
    return candidate


def attribute_fired_window(
    now: datetime.datetime,
    fired_cron: Optional[str],
    windows: List[Tuple[int, int]] = WINDOWS,
) -> Tuple[Optional[str], Optional[int], Optional[int]]:
    """
    Attribute a run to the cron that actually fired it.

    Returns (scheduled_window_utc, drift_minutes, window_occurrence_dt).

    `fired_cron` is `github.event.schedule`. When it is present and matches one
    of the configured windows, the window's *most recent past occurrence* is
    the truth — drift is then the real scheduler delay (hours, in production)
    instead of the 30-60 minutes the nearest-wall-clock heuristic reported every
    morning. When the cron is absent (workflow_dispatch / repository_dispatch),
    fall back to the heuristic and report `drift_minutes = None` with
    `scheduled_window_utc = None`, because an ad-hoc run has no schedule to be
    late against.
    """
    window = window_for_cron(fired_cron) if fired_cron else None
    if window is None:
        return None, None, None

    h, m = window
    occurrence = window_occurrence(window, now)
    drift = int((now - occurrence).total_seconds() // 60)
    return f"{h:02d}:{m:02d}", drift, occurrence


def attribute_window(
    now: datetime.datetime,
    windows: List[Tuple[int, int]] = WINDOWS,
) -> Tuple[Optional[str], Optional[int]]:
    """
    (scheduled_window_utc, drift_minutes) for a scan completing at `now`,
    using the nearest-wall-clock heuristic.

    Kept for backwards compatibility and for callers with no cron; prefer
    `attribute_fired_window`.
    """
    chosen = most_recent_window(now, windows)
    if chosen is None:
        return None, None
    dt, label = chosen
    drift = int((now - dt).total_seconds() // 60)
    return label, drift


def next_scheduled_window(
    now: datetime.datetime,
    windows: List[Tuple[int, int]] = WINDOWS,
) -> Optional[datetime.datetime]:
    """
    Next future scheduled window (Mon-Fri only — matches the cron's
    `* * 1-5` weekday constraint). The frontend uses this instead of a
    clock-time threshold so the staleness banner doesn't fire on weekends
    when no scan is expected. NSE holidays are NOT skipped (documented
    limitation — the banner tolerates them via its grace period).
    """
    base_date = now.date()
    for offset in range(7):
        cand_date = base_date + datetime.timedelta(days=offset)
        if cand_date.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
            continue
        for h, m in windows:
            cand_dt = datetime.datetime.combine(
                cand_date, datetime.time(h, m), tzinfo=datetime.timezone.utc,
            )
            if cand_dt > now:
                return cand_dt
    return None


def scheduled_cron_string(windows: List[Tuple[int, int]] = WINDOWS) -> str:
    """Cron expression(s) as a display string, e.g. '30 3 * * 1-5'."""
    return ", ".join(f"{m} {h} * * 1-5" for h, m in windows)


# How late a run may be before the dashboard calls the feed stale, depending
# on WHO triggered it. Both numbers are measured, not guessed:
#
#   external-scheduler (Netlify): fires on Netlify's own UTC scheduler, which is
#       not subject to GitHub's runner queue. 90 minutes covers a cold function
#       start, the GitHub queue for the dispatched workflow, and a 20-40 minute
#       scan. Beyond that something is genuinely broken.
#   github-cron (fallback): measured median delay 5.4 h, p75 6.6 h, max 10 h. A
#       grace shorter than that makes the banner fire on every trading day even
#       when everything is "working". 8 h covers p75 with margin.
STALE_AFTER_MINUTES_PUNCTUAL = 90
STALE_AFTER_MINUTES_FALLBACK = 8 * 60


def expected_staleness_minutes(
    window: Optional[Tuple[int, int]],
    source: str = "github-cron",
) -> int:
    """
    How late a run may be before the dashboard should call the feed stale.

    Adaptive on purpose: the punctual scheduler and the GitHub-cron fallback
    differ in reliability by an order of magnitude, so a single threshold is
    either so tight that it cries wolf on the fallback path or so loose that it
    hides a real outage for most of a trading session.
    """
    del window
    if source == "external-scheduler":
        return STALE_AFTER_MINUTES_PUNCTUAL
    return STALE_AFTER_MINUTES_FALLBACK

"""
source_status.py
Shared source-status envelope for every external data fetch in the scanner.

Every function that reads from outside the process (NSE, BSE, Screener, yfinance,
bhavcopy, etc.) should return a dict that includes a "status" key from the
SOURCE_STATUSES set, so the scanner/UI can never silently treat a missing
or failed fetch as a passing signal.
"""

from typing import Any, Optional


SOURCE_STATUSES = {
    "ok",              # Source returned usable data
    "missing",         # Source is reachable, no record for this symbol/date
    "source_failed",   # Source was unreachable / returned an error
    "fallback_used",   # Primary source failed, a secondary source returned data
    "flag_only",       # Source could not confirm; scanner must flag, not auto-pass
    "not_applicable",  # This source does not apply for this symbol (e.g. corporate action for a clean stock)
}


def make_status(
    source: str,
    status: str,
    *,
    as_of: Optional[str] = None,
    error: Optional[str] = None,
    data: Any = None,
    **extra,
) -> dict:
    """
    Build a standardized status dict.

    `data` is the actual payload (numbers, list, dict, etc).
    `**extra` is for module-specific fields (e.g. `quarter`, `delivery_value_inr`).
    """
    if status not in SOURCE_STATUSES:
        raise ValueError(f"Unknown source status: {status!r}; expected one of {sorted(SOURCE_STATUSES)}")
    out = {
        "source": source,
        "status": status,
    }
    if as_of is not None:
        out["as_of"] = as_of
    if error is not None:
        out["error"] = error
    if data is not None:
        out["data"] = data
    out.update(extra)
    return out


def worst_status(*statuses: str) -> str:
    """Return the most pessimistic of several status strings. Used to roll up
    multiple sub-source fetches into a single overall source status."""
    order = ["ok", "not_applicable", "fallback_used", "flag_only", "missing", "source_failed"]
    rank = {s: i for i, s in enumerate(order)}
    if not statuses:
        return "ok"
    return max(statuses, key=lambda s: rank.get(s, len(order)))

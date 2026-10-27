"""
corporate_actions.py
Pending corporate actions (next ~30 days).

Resolution chain:
  1. Probe NSE corporate-action JSON endpoints (best-effort).
  2. If unavailable, return 'source_failed' so the scanner can flag rather
     than silently pass.

The exact NSE API path changes; we try a few known candidates.
"""

from datetime import date, datetime, timedelta
from collections import defaultdict
from typing import List, Optional

from nse_client import nse_get_json
from source_status import make_status
from cache import read_cache, write_cache
from settings import CORPORATE_ACTION_LOOKAHEAD_DAYS, CORPORATE_ACTIONS_CACHE_TTL_SECONDS

# Action types we treat as "excluded" — they create artificial price moves that
# contaminate the technical signal.
EXCLUDED_ACTION_TYPES = {
    "SPLIT",
    "BONUS",
    "RIGHTS",
    "DEEMERGER",
    "DEMERGER",
    "MERGER",
    "AMALGAMATION",
    "DELISTING",
    "SUSPENSION",
}

# Best-guess NSE endpoints; NSE has changed these before.
NSE_CA_CANDIDATES = [
    "/api/corporates-corporateActions",
    "/api/corporate-actions",
    "/api/equity-corporateActions",
]


CORPORATE_ACTIONS_CACHE_KEY = "ca:list:v2"


def _probe_nse_corporate_actions(timeout: int = 10) -> Optional[dict]:
    for path in NSE_CA_CANDIDATES:
        data = nse_get_json(path, timeout=timeout)
        if data is None:
            continue
        if isinstance(data, dict) and "data" in data:
            return data
        if isinstance(data, list):
            return {"_raw": data}
    return None


def _has_excluded_action_within(actions: List[dict], days: int) -> bool:
    cutoff = date.today() + timedelta(days=days)
    for a in actions:
        ex = a.get("ex_date")
        if not ex:
            continue
        try:
            d = datetime.fromisoformat(str(ex)[:10]).date()
        except Exception:
            continue
        # If the ex-date is within the next `days` days (or in the past few days,
        # a stock is still risky to enter on the technicals)
        if date.today() - timedelta(days=3) <= d <= cutoff:
            for excl in EXCLUDED_ACTION_TYPES:
                if excl in a.get("action", ""):
                    return True
    return False


def _normalise_action_rows(payload: dict) -> Optional[List[dict]]:
    """Return normalized action rows, or None when the payload shape is invalid."""
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if rows is None and isinstance(payload, dict):
        rows = payload.get("_raw")
    if not isinstance(rows, list):
        return None
    out: List[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        symbol = str(r.get("symbol") or r.get("SYMBOL") or "").strip().upper()
        if not symbol:
            continue
        action = str(r.get("subject") or r.get("purpose") or r.get("action") or "").upper()
        ex_date = r.get("exDate") or r.get("ex_date") or r.get("recordDate") or r.get("record_date")
        out.append({"symbol": symbol, "action": action, "ex_date": ex_date})
    return out


def fetch_corporate_actions_list(
    *,
    lookahead_days: int = CORPORATE_ACTION_LOOKAHEAD_DAYS,
) -> dict:
    """Fetch and index the NSE action list once for the whole scan.

    The NSE endpoint returns a market-wide list and does not accept the symbol
    passed to the old per-stock helper. Keeping one cached indexed payload
    avoids repeating the same endpoint probe hundreds of times.
    """
    cached = read_cache(
        f"{CORPORATE_ACTIONS_CACHE_KEY}:{lookahead_days}",
        max_age_seconds=CORPORATE_ACTIONS_CACHE_TTL_SECONDS,
    )
    if cached is not None:
        return cached

    payload = _probe_nse_corporate_actions()
    if payload is None:
        return make_status(
            source="nse:corporate-actions",
            status="source_failed",
            data=None,
            error="NSE corporate-actions endpoint not reachable",
        )

    rows = _normalise_action_rows(payload)
    if rows is None:
        return make_status(
            source="nse:corporate-actions",
            status="source_failed",
            data=None,
            error="NSE corporate-actions response shape was not a list",
        )

    by_symbol = defaultdict(list)
    for row in rows:
        by_symbol[row["symbol"]].append({
            "action": row["action"],
            "ex_date": row["ex_date"],
        })

    indexed = {
        symbol: {
            "has_excluded_action": _has_excluded_action_within(actions, lookahead_days),
            "actions": actions,
        }
        for symbol, actions in by_symbol.items()
    }
    result = make_status(
        source="nse:corporate-actions",
        status="ok",
        data=indexed,
    )
    write_cache(f"{CORPORATE_ACTIONS_CACHE_KEY}:{lookahead_days}", result)
    return result


def lookup_corporate_actions(payload: dict, symbol: str) -> dict:
    """Return the indexed action result for one symbol."""
    status = payload.get("status", "source_failed")
    if status == "source_failed":
        return make_status(
            source=payload.get("source", "nse:corporate-actions"),
            status=status,
            data=None,
            error=payload.get("error"),
        )
    hit = (payload.get("data") or {}).get(symbol.upper())
    if hit is None:
        return make_status(
            source=payload.get("source", "nse:corporate-actions"),
            status="not_applicable",
            data={"has_excluded_action": False, "actions": []},
        )
    return make_status(
        source=payload.get("source", "nse:corporate-actions"),
        status="ok",
        data=hit,
    )


def fetch_corporate_actions(symbol: str, *, lookahead_days: int = CORPORATE_ACTION_LOOKAHEAD_DAYS) -> dict:
    """
    Returns a source_status dict for one symbol.
    """
    payload = fetch_corporate_actions_list(lookahead_days=lookahead_days)
    return lookup_corporate_actions(payload, symbol)

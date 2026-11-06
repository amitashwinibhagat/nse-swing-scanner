"""
corporate_actions.py
Pending corporate actions (next ~N days), fetched once per scan and indexed by
symbol.

Why this module is shaped the way it is
---------------------------------------
The NSE endpoint is a market-wide list, not a per-symbol lookup:

    GET /api/corporates-corporateActions
        ?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY

Called without those parameters it returns HTTP 200 with the body
`Missing index` — which json-decode fails on, so a naive probe reports
"source_failed" forever. That exact mistake (plus an ISO-only date parser
against NSE's `DD-Mon-YYYY` ex-dates) made this gate fail for 100% of the
universe from 2026-10-27 to 2026-11-05 and zeroed the whole PASS list.
Both are now covered by regression tests in tests/test_corporate_actions.py.

Date handling: NSE publishes ex-dates as `06-Nov-2026`. We accept the ISO form
too (older payloads and the test fixtures use it). An excluded action whose
date cannot be parsed is treated as *in window* — a split/bonus we cannot date
is exactly the contamination risk this gate exists to keep out, so fail closed.
"""

from datetime import date, datetime, timedelta, timezone
from collections import defaultdict
from typing import List, Optional

from nse_client import nse_get
from source_status import make_status
from cache import cache_disabled, read_cache, write_cache
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
    "BUY BACK",
    "BUYBACK",
    "CAPITAL REDUCTION",
    "SCHEME OF ARRANGEMENT",
}

# NSE's corporate-actions endpoint requires index + a date range. `index=equities`
# is the only value we need (the universe is cash-market equities).
NSE_CA_ENDPOINT = "/api/corporates-corporateActions"

# Accepted ex-date formats, most specific first. NSE's is `%d-%b-%Y`.
_DATE_FORMATS = ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d %b %Y")

CORPORATE_ACTIONS_CACHE_KEY = "ca:list:v3"

# IST is the exchange clock. Corporate-action ex-dates are IST calendar dates,
# so "today" must be evaluated in IST, not UTC (the two differ for any run
# between 18:30 and 24:00 UTC).
_IST = timezone(timedelta(hours=5, minutes=30))


def ist_today() -> date:
    """Today's date on the exchange clock (IST)."""
    return datetime.now(_IST).date()


def parse_action_date(value) -> Optional[date]:
    """
    Parse an ex-date/record-date from an NSE payload into a `date`.

    Handles `06-Nov-2026` (NSE), `2026-11-06`, `06-11-2026`, `06/11/2026` and
    `06 Nov 2026`. Returns None when the value is missing or unparseable.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text in ("-", "NA", "N/A", "None", "null"):
        return None
    # Drop a time component if present, e.g. "2026-11-06T00:00:00.000".
    text = text.split("T")[0].strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    # Last resort: ISO with a time part.
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def _probe_nse_corporate_actions(
    *,
    lookahead_days: int = CORPORATE_ACTION_LOOKAHEAD_DAYS,
    today: Optional[date] = None,
    timeout: int = 15,
    diagnostics: Optional[dict] = None,
) -> Optional[dict]:
    """
    Fetch the market-wide action list for [today-3d, today+lookahead].

    Returns the decoded JSON (a list of action rows) or None when the endpoint
    is unreachable or returned a non-list body.

    `diagnostics` (optional dict) is filled with what actually happened — HTTP
    status, body preview, the exact query — so a `source_failed` in CI can be
    diagnosed from the workflow log instead of guessed at. NSE has several
    distinct failure modes here (Akamai block, "Missing index", a cookie that
    expired mid-run) and they need different fixes.
    """
    today = today or ist_today()
    frm = today - timedelta(days=3)
    to = today + timedelta(days=lookahead_days)
    params = {
        "index": "equities",
        "from_date": frm.strftime("%d-%m-%Y"),
        "to_date": to.strftime("%d-%m-%Y"),
    }
    if diagnostics is not None:
        diagnostics["url"] = NSE_CA_ENDPOINT
        diagnostics["params"] = dict(params)

    # Fetch the raw response (not just the decoded JSON) so the status code and
    # body are available for the failure message.
    resp = nse_get(NSE_CA_ENDPOINT, params=params, timeout=timeout)
    if resp is None:
        if diagnostics is not None:
            diagnostics["error"] = "no 2xx response (blocked, timed out, or non-200)"
        return None

    body = resp.text or ""
    if diagnostics is not None:
        diagnostics["status"] = resp.status_code
        diagnostics["body_preview"] = body[:200].replace("\n", " ")

    try:
        data = resp.json()
    except ValueError:
        if diagnostics is not None:
            diagnostics["error"] = "response was not JSON"
        return None

    if diagnostics is not None:
        diagnostics["type"] = type(data).__name__
        if isinstance(data, dict):
            diagnostics["keys"] = list(data.keys())[:8]

    window = {"from": frm.isoformat(), "to": to.isoformat()}
    if isinstance(data, list):
        return {"_raw": data, "_window": window}
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return {"_raw": data["data"], "_window": window}
    if diagnostics is not None:
        diagnostics["error"] = "JSON body did not contain a row list"
    return None


def _has_excluded_action_within(
    actions: List[dict],
    days: int,
    *,
    today: Optional[date] = None,
) -> bool:
    """
    True when an excluded action has an ex-date inside
    [today - 3d, today + `days`]. A recent past ex-date still counts: entering
    on technicals into a stock that just split is the same contamination.
    """
    today = today or ist_today()
    lower = today - timedelta(days=3)
    upper = today + timedelta(days=days)
    for action in actions:
        label = str(action.get("action") or action.get("subject") or "").upper()
        if not any(excl in label for excl in EXCLUDED_ACTION_TYPES):
            continue
        ex = parse_action_date(action.get("ex_date") or action.get("exDate"))
        if ex is None:
            # Excluded action we cannot date: fail closed (see module docstring).
            return True
        if lower <= ex <= upper:
            return True
    return False


def _normalise_action_rows(payload: dict) -> Optional[List[dict]]:
    """Return normalised action rows, or None when the payload shape is invalid."""
    if not isinstance(payload, dict):
        return None
    rows = payload.get("_raw")
    if rows is None:
        rows = payload.get("data")
    if not isinstance(rows, list):
        return None
    out: List[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or row.get("SYMBOL") or "").strip().upper()
        if not symbol:
            continue
        action = str(
            row.get("subject") or row.get("purpose") or row.get("action") or ""
        ).strip().upper()
        ex_date = (
            row.get("exDate")
            or row.get("ex_date")
            or row.get("recordDate")
            or row.get("record_date")
        )
        out.append({"symbol": symbol, "action": action, "ex_date": ex_date})
    return out


def fetch_corporate_actions_list(
    *,
    lookahead_days: int = CORPORATE_ACTION_LOOKAHEAD_DAYS,
    today: Optional[date] = None,
) -> dict:
    """
    Fetch and index the NSE action list once for the whole scan.

    Returns a source_status envelope whose `data` is
    `{SYMBOL: {"has_excluded_action": bool, "actions": [...]}}`.

    Failures are NOT cached: a transient NSE outage used to be written to disk
    for a full TTL, extending a bad scan by hours.
    """
    today = today or ist_today()
    cache_key = f"{CORPORATE_ACTIONS_CACHE_KEY}:{lookahead_days}:{today.isoformat()}"
    if not cache_disabled():
        cached = read_cache(cache_key, max_age_seconds=CORPORATE_ACTIONS_CACHE_TTL_SECONDS)
        if cached is not None:
            return cached

    diagnostics: dict = {}
    payload = _probe_nse_corporate_actions(
        lookahead_days=lookahead_days, today=today, diagnostics=diagnostics
    )
    if payload is None:
        detail = diagnostics.get("error") or "unknown failure"
        if diagnostics.get("status"):
            detail = f"{detail} (HTTP {diagnostics['status']})"
        preview = diagnostics.get("body_preview")
        if preview:
            detail = f"{detail}: {preview!r}"
        print(f"::warning::corporate_actions: {detail} — params={diagnostics.get('params')}")
        return make_status(
            source="nse:corporate-actions",
            status="source_failed",
            data=None,
            error=detail,
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
        by_symbol[row["symbol"]].append(
            {"action": row["action"], "ex_date": row["ex_date"]}
        )

    indexed = {
        symbol: {
            "has_excluded_action": _has_excluded_action_within(
                actions, lookahead_days, today=today
            ),
            "actions": actions,
        }
        for symbol, actions in by_symbol.items()
    }
    result = make_status(
        source="nse:corporate-actions",
        status="ok",
        as_of=today.isoformat(),
        data=indexed,
        extra={
            "window": payload.get("_window"),
            "rows": len(rows),
            "symbols_with_actions": len(indexed),
            "symbols_with_excluded_action": sum(
                1 for v in indexed.values() if v["has_excluded_action"]
            ),
        },
    )
    if not cache_disabled():
        write_cache(cache_key, result)
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
        as_of=payload.get("as_of"),
        data=hit,
    )


def fetch_corporate_actions(
    symbol: str, *, lookahead_days: int = CORPORATE_ACTION_LOOKAHEAD_DAYS
) -> dict:
    """Per-symbol convenience wrapper (fetches/uses the shared indexed list)."""
    payload = fetch_corporate_actions_list(lookahead_days=lookahead_days)
    return lookup_corporate_actions(payload, symbol)

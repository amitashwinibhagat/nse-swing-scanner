"""
earnings.py
Upcoming-earnings-date lookup for gate-passed names.

The intent is NOT a hard gate — yfinance NSE earnings dates are frequently
missing or stale. This module surfaces the data so the UI can render a
warning chip ("Earnings in N days") and the user can decide.

Resolution chain:
  1. yfinance Ticker.calendar (next earnings date)
  2. yfinance Ticker.get_earnings_dates() — wider net, may surface older
     reported dates plus the next one. We pick the closest strictly-future
     date.

Missing / source-failed status is returned honestly; the UI must fail-open
(no chip rendered) rather than auto-blocking a PASS.
"""

from datetime import datetime, timedelta
from typing import Optional

from source_status import make_status
from cache import cached_call

# Earnings within this many days of the scan are surfaced as a warning.
# Outside the window, the chip is hidden (data still fetched for caching).
EARNINGS_WARN_DAYS = 14
# TTL for the earnings cache — yfinance earnings dates change rarely,
# but caching too long means we miss a fresh announcement.
EARNINGS_CACHE_TTL_SECONDS = 12 * 60 * 60   # 12 hours


def _extract_next_earnings_date(yf_ticker: str) -> Optional[str]:
    """
    Try yfinance and return the next future earnings date as an ISO string
    (YYYY-MM-DD), or None when not available.
    """
    try:
        import yfinance as yf
        t = yf.Ticker(yf_ticker)
    except Exception:
        return None

    # Preferred: Ticker.calendar (a DataFrame with 'Earnings Date' index).
    try:
        cal = t.calendar
        if cal is not None and not cal.empty:
            # The "Earnings Date" row carries the date(s).
            try:
                ed = cal.loc["Earnings Date"]
                # May be a single Timestamp or a list of Timestamps.
                if hasattr(ed, "__iter__") and not isinstance(ed, str):
                    candidates = [d for d in ed if d is not None]
                else:
                    candidates = [ed]
                today = datetime.utcnow().date()
                future = []
                for d in candidates:
                    try:
                        dd = d.date() if hasattr(d, "date") else datetime.fromisoformat(str(d)[:10]).date()
                    except Exception:
                        continue
                    if dd >= today:
                        future.append(dd)
                if future:
                    return min(future).isoformat()
            except Exception:
                pass
    except Exception:
        pass

    # Fallback: get_earnings_dates() returns a DatetimeIndex of past + future dates.
    try:
        dates = t.get_earnings_dates(limit=8)
        if dates is not None and len(dates) > 0:
            today = datetime.utcnow().date()
            future = []
            for d in dates:
                try:
                    dd = d.date() if hasattr(d, "date") else datetime.fromisoformat(str(d)[:10]).date()
                except Exception:
                    continue
                if dd >= today:
                    future.append(dd)
            if future:
                return min(future).isoformat()
    except Exception:
        pass

    return None


def fetch_earnings(symbol: str, yf_ticker: str) -> dict:
    """
    Returns a source_status envelope for one symbol.

    Data shape on status='ok':
        { "earnings_date": "2026-08-04", "within_days": 3 }
    On status='missing' / 'source_failed', `data` is None — the UI must
    not render a chip in that case.
    """
    cache_key = f"earnings:{symbol.upper()}"
    result = cached_call(
        cache_key,
        EARNINGS_CACHE_TTL_SECONDS,
        _fetch_earnings_uncached,
        yf_ticker,
    )
    # Always set symbol in the envelope for traceability.
    result["symbol"] = symbol
    return result


def _fetch_earnings_uncached(yf_ticker: str) -> dict:
    iso = _extract_next_earnings_date(yf_ticker)
    if iso is None:
        return make_status(
            source="yfinance:earnings",
            status="missing",
            data=None,
            error="No upcoming earnings date from yfinance",
        )

    try:
        ed = datetime.fromisoformat(iso[:10]).date()
    except Exception:
        return make_status(
            source="yfinance:earnings",
            status="source_failed",
            data=None,
            error=f"Unparseable earnings date from yfinance: {iso!r}",
        )

    within = (ed - datetime.utcnow().date()).days
    return make_status(
        source="yfinance:earnings",
        status="ok",
        as_of=datetime.utcnow().isoformat()[:10],
        data={"earnings_date": iso, "within_days": within},
    )
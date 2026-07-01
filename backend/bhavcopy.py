"""
bhavcopy.py
Latest-day delivery volume data.

Resolution chain (per the publish plan):
  1. NSE daily bhavcopy / security-wise delivery report.
  2. If NSE is unreachable, return 'source_failed' and let the scanner
     decide whether to fail-closed or flag for that run.

The exact archive URL for NSE's bhavcopy is at
https://nsearchives.nseindia.com/content/equities/ (path includes the date).
We probe a few likely filenames; NSE publishes two relevant files per session:
  - eq_bhavcopy_full_YYYYMMDD.csv
  - sec_bhavdata_full_YYYYMMDD.csv (security-wise delivery)

If neither is reachable, we report source_failed and the scanner will
emit a delivery_status flag in the JSON.
"""

import io
import json
import time
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import pandas as pd
import requests

from nse_client import nse_get, NSE_ARCHIVES_BASE
from source_status import make_status
from cache import read_cache, write_cache
from settings import BHAVCOPY_CACHE_TTL_SECONDS

ARCHIVES_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*",
    "Referer": "https://www.nseindia.com/",
}

# Bhavcopy filenames NSE typically publishes
BHAVCOPY_FILENAMES = [
    "eq_bhavcopy_full_{date}.csv",
    "sec_bhavdata_full_{date}.csv",
]


def _bhavcopy_url_for(d: date) -> List[str]:
    d_str = d.strftime("%Y%m%d")
    return [
        f"{NSE_ARCHIVES_BASE}/content/equities/" + fn.format(date=d_str)
        for fn in BHAVCOPY_FILENAMES
    ]


def fetch_bhavcopy(timeout: int = 15, max_lookback_days: int = 5) -> dict:
    """
    Try to fetch the most recent available bhavcopy. Returns a source_status
    dict with:
      - data: dict mapping SYMBOL -> {delivery_qty, delivery_value_inr, delivery_pct}
      - as_of: the trade date the file represents
    """
    cache_key = f"bhavcopy:latest"
    cached = read_cache(cache_key, max_age_seconds=BHAVCOPY_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    today = date.today()
    last_err: Optional[str] = None
    for offset in range(0, max_lookback_days + 1):
        d = today - timedelta(days=offset)
        for url in _bhavcopy_url_for(d):
            try:
                resp = requests.get(url, headers=ARCHIVES_HEADERS, timeout=timeout)
            except Exception as e:
                last_err = str(e)
                continue
            if resp.status_code != 200 or len(resp.text) < 100:
                last_err = f"HTTP {resp.status_code}"
                continue
            try:
                df = pd.read_csv(io.StringIO(resp.text))
            except Exception as e:
                last_err = f"csv parse failed: {e}"
                continue
            parsed = _parse_bhavcopy(df)
            if parsed:
                result = make_status(
                    source=f"nse:{url}",
                    status="ok",
                    as_of=d.isoformat(),
                    data=parsed,
                )
                write_cache(cache_key, result)
                return result
    result = make_status(
        source="nse:bhavcopy",
        status="source_failed",
        data={},
        error=last_err or "no bhavcopy reachable in lookback window",
    )
    write_cache(cache_key, result)
    return result


def _parse_bhavcopy(df: pd.DataFrame) -> Dict[str, dict]:
    """
    Normalize column names and extract per-symbol delivery qty / value / pct.
    NSE column names vary; we lowercase + strip + match.
    """
    df.columns = [str(c).strip().lower() for c in df.columns]
    sym_col = next((c for c in ("symbol", "symbol_nse", "scrip") if c in df.columns), None)
    if sym_col is None:
        return {}
    deliv_qty_col = next((c for c in ("delivqty", "delivery_qty", "del_qty") if c in df.columns), None)
    deliv_val_col = next((c for c in ("delivval", "delivery_value", "del_val") if c in df.columns), None)
    deliv_pct_col = next((c for c in ("deliv_per", "delivery_pct", "del_pct") if c in df.columns), None)
    close_col = next((c for c in ("close", "close_price", "last") if c in df.columns), None)
    out: Dict[str, dict] = {}
    for _, row in df.iterrows():
        sym = str(row[sym_col]).strip().upper()
        if not sym or sym in ("SYMBOL", "NAN"):
            continue
        rec = {}
        if deliv_qty_col is not None and pd.notna(row.get(deliv_qty_col)):
            rec["delivery_qty"] = float(row[deliv_qty_col])
        if deliv_val_col is not None and pd.notna(row.get(deliv_val_col)):
            v = float(row[deliv_val_col])
            # NSE publishes delivery value in lakhs of rupees; convert to INR.
            rec["delivery_value_inr"] = v * 1_00_000
        elif deliv_qty_col is not None and close_col is not None:
            q = row.get(deliv_qty_col)
            p = row.get(close_col)
            if pd.notna(q) and pd.notna(p):
                rec["delivery_value_inr"] = float(q) * float(p)
        if deliv_pct_col is not None and pd.notna(row.get(deliv_pct_col)):
            rec["delivery_pct"] = float(row[deliv_pct_col])
        if rec:
            out[sym] = rec
    return out


def lookup_delivery(bhavcopy_payload: dict, symbol: str) -> dict:
    """
    Look up a single symbol in a bhavcopy source_status payload.
    """
    overall = bhavcopy_payload.get("status", "source_failed")
    per = bhavcopy_payload.get("data") or {}
    hit = per.get(symbol.upper())
    if hit is not None:
        return {
            "delivery_qty": hit.get("delivery_qty"),
            "delivery_value_inr": hit.get("delivery_value_inr"),
            "delivery_pct": hit.get("delivery_pct"),
            "as_of": bhavcopy_payload.get("as_of"),
            "source_status": overall,
            "source": bhavcopy_payload.get("source"),
        }
    return {
        "delivery_qty": None,
        "delivery_value_inr": None,
        "delivery_pct": None,
        "as_of": bhavcopy_payload.get("as_of"),
        "source_status": "missing" if overall == "ok" else overall,
        "source": bhavcopy_payload.get("source"),
    }

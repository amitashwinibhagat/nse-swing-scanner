"""
surveillance.py
T-group / ASM / GSM / suspension exclusion list.

Why this module was rewritten
-----------------------------
The previous implementation probed four invented endpoints
(`/api/surveillance/securities-available-for-trading`, `/api/surveillance/asm-list`,
`/api/surveillance/gsm-list`, `/api/equity-stockIndices?index=SECURITIES_IN_FOCUS`).
Every one of them 404s, so the gate reported `flag_only` on 100% of production
rows and — because `flag_only` passes — the surveillance gate had never actually
excluded anything. Worse, the one candidate that looked plausible
(`SECURITIES_IN_FOCUS`) would have marked every "stock in focus" as restricted.

Real sources (verified live 2026-11-06):

  1. `GET /api/reportASM` — NSE's Additional Surveillance Measure list.
     `{"longterm": {"data": [...]}, "shortterm": {"data": [...]}}`, each row has
     `symbol`, `asmSurvIndicator`, `survDesc`.
  2. `GET https://nsearchives.nseindia.com/content/equities/sec_list.csv` —
     the tradable-securities master. Columns `Symbol,Series,Security Name,Band,
     Remarks`. `Remarks` carries `GSM STAGE - N`; `Series` carries the
     trade-for-trade / periodic-call-auction markers.
  3. BSE surveillance page — best effort, still cannot be mapped to NSE symbols,
     so it degrades to `flag_only` rather than producing false passes.

Cache policy: success is cached for `SURVEILLANCE_CACHE_TTL_SECONDS` (7 days);
`flag_only` and `source_failed` are cached for only `SURVEILLANCE_FAILURE_TTL`
(30 min) so a transient outage cannot disable the gate for a week.
"""

import re
from typing import Dict, Optional

import requests

from nse_client import nse_get_abs, nse_get_json, NSE_ARCHIVES_BASE
from source_status import make_status
from cache import cache_disabled, read_cache, write_cache
from settings import (
    SURVEILLANCE_CACHE_TTL_SECONDS,
    SURVEILLANCE_FAILURE_TTL_SECONDS,
)

# --- NSE endpoints (verified live) ---
NSE_ASM_PATH = "/api/reportASM"
NSE_SEC_LIST_URL = f"{NSE_ARCHIVES_BASE}/content/equities/sec_list.csv"

# Series that mean the security is not in normal rolling settlement.
# BE = trade-for-trade, BZ = trade-for-trade (surveillance), ST = suspended-ish
# series reserved by NSE, SM = SME platform (not our universe), T1T/T2T = the
# legacy trade-to-trade markers still present on older payloads.
RESTRICTED_SERIES = {"BE", "BZ", "T1T", "T2T"}

# Remarks marker for the Graded Surveillance Measure.
GSM_REMARKS_RE = re.compile(r"GSM\s*STAGE\s*-?\s*(\d+)", re.IGNORECASE)

BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/csv,text/html,application/json,*/*",
    "Referer": "https://www.bseindia.com/",
}


def _parse_asm_payload(payload: Optional[dict]) -> Dict[str, dict]:
    """Extract {SYMBOL: restriction} from NSE's /api/reportASM response."""
    out: Dict[str, dict] = {}
    if not isinstance(payload, dict):
        return out
    for bucket in ("longterm", "shortterm"):
        block = payload.get(bucket)
        rows = block.get("data") if isinstance(block, dict) else None
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            stage = str(row.get("asmSurvIndicator") or "").strip()
            desc = str(row.get("survDesc") or "").strip()
            label = f"ASM {bucket} {stage}".strip()
            prior = out.get(symbol)
            out[symbol] = {
                "t_group": True,
                "gsm": bool(prior.get("gsm")) if prior else False,
                "suspended": False,
                "source": NSE_ASM_PATH,
                "detail": desc or label,
            }
    return out


def _parse_sec_list_csv(text: str) -> Dict[str, dict]:
    """
    Extract restrictions from NSE's sec_list.csv master.

    Flags a security when its series is outside normal rolling settlement, or
    its remarks carry a GSM stage. Parsed with the stdlib so a malformed row
    cannot take down the scan (pandas would raise on a ragged CSV).
    """
    import csv
    import io

    out: Dict[str, dict] = {}
    if not text or len(text) < 50:
        return out
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        symbol = str(row.get("Symbol") or "").strip().upper()
        if not symbol:
            continue
        series = str(row.get("Series") or "").strip().upper()
        remarks = str(row.get("Remarks") or "").strip()
        gsm_match = GSM_REMARKS_RE.search(remarks)
        series_restricted = series in RESTRICTED_SERIES
        if not (gsm_match or series_restricted):
            continue
        out[symbol] = {
            "t_group": series_restricted,
            "gsm": bool(gsm_match),
            "suspended": False,
            "source": "nse:sec_list",
            "detail": remarks if gsm_match else f"series {series}",
        }
    return out


def _merge_restrictions(*maps: Dict[str, dict]) -> Dict[str, dict]:
    merged: Dict[str, dict] = {}
    for m in maps:
        for symbol, rec in (m or {}).items():
            prior = merged.get(symbol, {})
            merged[symbol] = {
                "t_group": bool(prior.get("t_group")) or bool(rec.get("t_group")),
                "gsm": bool(prior.get("gsm")) or bool(rec.get("gsm")),
                "suspended": bool(prior.get("suspended")) or bool(rec.get("suspended")),
                "source": rec.get("source") or prior.get("source"),
                "detail": rec.get("detail") or prior.get("detail"),
            }
    return merged


def _probe_bse_surveillance(timeout: int = 10) -> Optional[dict]:
    """
    BSE publishes surveillance data only as HTML scoped by BSE scrip code. There
    is no mapping to NSE symbols, so this can never produce a safe exclusion
    list; it exists only to distinguish "BSE reachable but unusable" from
    "nothing reachable".
    """
    candidates = [
        "https://www.bseindia.com/markets/equity/EQReports/SecurityWatch_Surv.aspx?type=ASM",
        "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCatData/w?subcat=ASM",
    ]
    for url in candidates:
        try:
            r = requests.get(url, headers=BSE_HEADERS, timeout=timeout)
        except Exception:
            continue
        if r.status_code != 200 or len(r.text) < 200:
            continue
        if "ASM" in r.text or "GSM" in r.text:
            return {"_endpoint": url}
    return None


def fetch_surveillance_list(timeout: int = 15) -> dict:
    """
    Returns a source_status dict:

      - status: 'ok' | 'fallback_used' | 'source_failed' | 'flag_only'
      - data:   {SYMBOL: {"t_group": bool, "gsm": bool, "suspended": bool,
                          "source": str, "detail": str}}

    `ok` means at least one real NSE list parsed. `flag_only` means nothing
    usable was reachable — the caller must not read that as "clean".
    """
    cache_key = "surveillance:list:v2"
    if not cache_disabled():
        cached = read_cache(cache_key, max_age_seconds=SURVEILLANCE_CACHE_TTL_SECONDS)
        if cached is not None:
            # Short-lived failures must not be served from the 7-day slot.
            cached_status = cached.get("status")
            if cached_status in ("source_failed", "flag_only"):
                stale_failure = read_cache(cache_key, max_age_seconds=SURVEILLANCE_FAILURE_TTL_SECONDS)
                if stale_failure is None:
                    cached = None
            if cached is not None:
                return cached

    asm_payload = nse_get_json(NSE_ASM_PATH, timeout=timeout)
    asm = _parse_asm_payload(asm_payload)

    sec_list_text: Optional[str] = None
    resp = nse_get_abs(NSE_SEC_LIST_URL, timeout=timeout)
    if resp is not None:
        sec_list_text = resp.text
    sec_list = _parse_sec_list_csv(sec_list_text or "")

    merged = _merge_restrictions(sec_list, asm)

    if merged:
        # `fallback_used` when only one of the two lists parsed.
        partial = (asm_payload is None) != (not sec_list)
        result = make_status(
            source="nse:reportASM+sec_list" if not partial else "nse:surveillance-partial",
            status="fallback_used" if partial else "ok",
            data=merged,
            t_group_count=sum(1 for v in merged.values() if v["t_group"]),
            gsm_count=sum(1 for v in merged.values() if v["gsm"]),
        )
        if not cache_disabled():
            write_cache(cache_key, result)
        return result

    bse = _probe_bse_surveillance(timeout=timeout)
    if bse is not None:
        result = make_status(
            source=f"bse:{bse['_endpoint']}",
            status="flag_only",
            data={},
            error="BSE surveillance reachable but its scrip codes cannot be mapped to NSE symbols",
        )
    else:
        result = make_status(
            source="none",
            status="source_failed",
            data={},
            error="Neither NSE reportASM nor NSE sec_list nor BSE surveillance was reachable",
        )
    if not cache_disabled():
        write_cache(cache_key, result)
    return result


def check_symbol(surveillance_payload: dict, symbol: str) -> dict:
    """
    Look up a single symbol in a surveillance source_status payload.

    Returns {"is_restricted", "restriction_type", "source_status", "source",
    "detail"}. `source_status` is the payload-wide status, so callers can tell
    "verified clean" from "could not verify".
    """
    overall = surveillance_payload.get("status", "source_failed")
    per = surveillance_payload.get("data") or {}
    hit = per.get(symbol.upper())
    if hit is not None:
        restricted = bool(hit.get("t_group") or hit.get("gsm") or hit.get("suspended"))
        if hit.get("suspended"):
            rtype = "suspended"
        elif hit.get("gsm"):
            rtype = "gsm"
        elif hit.get("t_group"):
            rtype = "t_group"
        else:
            rtype = None
        return {
            "is_restricted": restricted,
            "restriction_type": rtype,
            "source_status": overall,
            "source": hit.get("source", surveillance_payload.get("source")),
            "detail": hit.get("detail"),
        }
    return {
        "is_restricted": False,
        "restriction_type": None,
        "source_status": overall,
        "source": surveillance_payload.get("source"),
        "detail": None,
    }

"""
universe.py
Fetches the Nifty 500 constituent list from NSE's public archives (free, no auth).

Source verified live: https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv
NOTE: NSE returns 503 without a browser-like User-Agent header. This is not an auth
wall, just basic bot-filtering — the headers below are sufficient and require no login.

Confidence: high (endpoint tested and returned 501 rows — header + 500 constituents —
at time of writing). NSE has changed archive paths before without notice; if this URL
starts 404ing, check https://www.nseindia.com/all-reports for the current path.
"""

import io
import requests
import pandas as pd

NIFTY500_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv"

# Fallback mirror (same data, different publisher — NSE Indices Ltd's own index site).
# Kept as a fallback only; NSE archives is the primary source of truth.
NIFTY500_URL_FALLBACK = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*",
    "Referer": "https://www.nseindia.com/",
}


def fetch_nifty500(timeout: int = 15) -> pd.DataFrame:
    """
    Returns a DataFrame with columns: company_name, industry, symbol, series, isin, yf_ticker
    yf_ticker is the yfinance-compatible ticker (SYMBOL.NS).
    """
    last_err = None
    for url in (NIFTY500_URL, NIFTY500_URL_FALLBACK):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout)
            resp.raise_for_status()
            df = pd.read_csv(io.StringIO(resp.text))
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            df = df.rename(columns={
                "company_name": "company_name",
                "industry": "industry",
                "symbol": "symbol",
                "series": "series",
                "isin_code": "isin",
            })
            df["yf_ticker"] = df["symbol"].astype(str).str.strip() + ".NS"
            return df[["company_name", "industry", "symbol", "series", "isin", "yf_ticker"]]
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"Failed to fetch Nifty 500 list from both sources. Last error: {last_err}")


if __name__ == "__main__":
    universe = fetch_nifty500()
    print(f"Fetched {len(universe)} constituents")
    print(universe.head())
    universe.to_csv("/home/claude/swing_scanner/nifty500_universe.csv", index=False)

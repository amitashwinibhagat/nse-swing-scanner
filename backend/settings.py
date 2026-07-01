"""
settings.py
Centralized scanner configuration. Tunable thresholds live here so they can be
adjusted without touching scanner.py / module code.
"""

# Universe
UNIVERSE_DEFAULT_TOP_N = 100                # default top-N-by-market-cap tier (Nifty 100/200/500)
UNIVERSE_DEFAULT_WORKERS = 8                # default thread-pool size for per-stock evaluation
UNIVERSE_DEFAULT_SLEEP_BETWEEN_CALLS = 0.3  # seconds, per-yfinance-call courtesy delay

# Hard gate thresholds (non-negotiable safety filters)
MIN_MARKET_CAP_CR = 500            # Rs crore
MAX_DE_RATIO = 1.0
MIN_F_SCORE = 6                    # relaxed from spec ">7" — see README
MIN_DELIVERY_VALUE_INR = 5_00_00_000   # Rs 5 crore, latest available trading day
MIN_HOLDINGS_CONVICTION_PCT = 50   # promoter + FII + DII > 50%

# Hard gate windows (technical)
DRAWDOWN_LOWER_PCT = -40.0
DRAWDOWN_UPPER_PCT = -15.0
RSI_LOWER = 25
RSI_UPPER = 40

# Corporate action lookback
CORPORATE_ACTION_LOOKAHEAD_DAYS = 30

# Soft score weights — sum to 1.0. See README/methodology for rationale.
# `conviction_holding` activates once holdings data is wired in.
WEIGHTS = {
    "valuation_compression": 0.20,
    "oversold_positioning": 0.15,
    "support_proximity": 0.15,
    "drawdown_sweetspot": 0.10,
    "volume_capitulation": 0.10,
    "quality_composite": 0.20,
    "conviction_holding": 0.10,
}

# Source-cache TTLs (seconds)
HOLDINGS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 * 3   # ~90 days (quarterly-ish)
BHAVCOPY_CACHE_TTL_SECONDS = 60 * 60 * 12            # half a day
SURVEILLANCE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7    # weekly
CORPORATE_ACTIONS_CACHE_TTL_SECONDS = 60 * 60 * 12   # half a day

# Stale-data threshold for the UI (hours)
STALE_DATA_HOURS = 18

# ATR / entry / target parameters
ATR_PERIOD = 14
ENTRY_ZONE_ATR_FRACTION = 0.5
STOP_LOSS_ATR_MULT = 1.0
TARGET_1_ATR_MULT = 1.5
TARGET_2_ATR_MULT = 2.5

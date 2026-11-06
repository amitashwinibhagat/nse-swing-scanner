"""
settings.py
Centralized scanner configuration. Tunable thresholds live here so they can be
adjusted without touching scanner.py / module code.
"""

# Universe
UNIVERSE_DEFAULT_TOP_N = 500                # default top-N-by-market-cap tier (Nifty 100/200/500)
UNIVERSE_DEFAULT_WORKERS = 8                # default thread-pool size for per-stock evaluation
UNIVERSE_DEFAULT_SLEEP_BETWEEN_CALLS = 0.3  # seconds, per-yfinance-call courtesy delay

# Hard gate thresholds (non-negotiable safety filters)
MIN_F_SCORE = 6                    # relaxed from spec ">7" — see README
MIN_F_SCORE_COMPONENTS = 9         # fail closed when any Piotroski component is unavailable
MIN_DELIVERY_VALUE_INR = 5_00_00_000   # Rs 5 crore, latest available trading day (only used when delivery_kind == "actual")
MIN_HOLDINGS_CONVICTION_PCT = 50   # promoter + FII + DII > 50%

# Liquidity Adequacy hard gate: 20d average traded value (volume × close) floor.
# This is the replacement for the single-day traded-value proxy. Two times the old
# delivery floor because traded value is typically 2-3x real delivery; calibrated
# against Nifty 500 mid-cap names.
MIN_ADV_VALUE_INR = 10_00_00_000   # Rs 10 crore
ADV_LOOKBACK_SESSIONS = 20
ADV_MIN_SESSIONS = 15              # allow short histories (IPO, new listing)

# Secondary floor when the real-delivery path satisfies the gate: require
# ADV at least 30% of MIN_ADV_VALUE_INR. Prevents a thinly traded name from
# passing via a single high-delivery day (block deal / closing-auction spike).
MIN_ADV_SECONDARY_FLOOR_INR = 3_00_00_000   # Rs 3 crore

# Per-universe ADV outlier hard ceiling. yfinance occasionally surfaces
# multi-100x volume spikes on the first session after suspension/resumption;
# clamping protects the gate and the UI from a single outlier distorting
# the PASS list. The ceiling is well above any legitimate 20d ADV for the
# Nifty 500 universe (largest names average ~₹1000cr ADV).
ADV_HARD_CEILING_INR = 5_000_00_00_000  # Rs 5000 crore

# Hard gate windows (technical)
DRAWDOWN_LOWER_PCT = -40.0
DRAWDOWN_UPPER_PCT = -15.0
RSI_LOWER = 25
RSI_UPPER = 40

# Corporate action lookback
CORPORATE_ACTION_LOOKAHEAD_DAYS = 30

# Soft score weights — sum to 1.0. See README/methodology for rationale.
#
# Bump SCORE_VERSION whenever WEIGHTS changes: snapshots stamp it per row
# (scanner.to_json_records) so the tracker can attribute score-regime changes
# to a date. Promotion protocol: docs/feedback + evaluate_feedback.
#
# 2026-11 v2 — `support_proximity` REMOVED (was 0.15).
#
# It measured |pct_from_ema200| and scored 0 beyond 5%. The gates select names
# 15-40% off their high, which in practice means they sit far from the 200EMA:
# across 5,796 tracked rows it was **0.0 in 80% of cases**, mean 0.09. A
# component that is mechanically zero for the population it scores is not a
# signal — it is a constant that caps the achievable score. Worse, it read the
# SAME input as the relative-strength multiplier (which already penalises
# distance below the 200EMA), so a name far below support was punished twice:
# once by a 0.00 component and again by an x0.70 multiplier.
#
# The effect was structural: with support at 0 the best attainable base score
# is 85.0, and 85.0 x 0.70 = 59.5 — below the 63 shortlist cut. 14.3% of all
# tracked rows were therefore *incapable* of ever being a top pick no matter
# how good their other six components were. Its rank IC was negative at every
# window (-0.010 / -0.011 / -0.028).
#
# The freed 15% was redistributed PROPORTIONALLY across the remaining
# components (each keeps its relative weight), not handed to the strongest
# one — an in-sample IC-weighting pass is the overfit this project's own
# promotion checklist forbids.
WEIGHTS = {
    "valuation_compression": 4 / 17,   # 0.235294…
    "oversold_positioning": 3 / 17,    # 0.176471…
    "drawdown_sweetspot": 2 / 17,      # 0.117647…
    "volume_capitulation": 2 / 17,
    "quality_composite": 4 / 17,
    "conviction_holding": 2 / 17,
}

SCORE_VERSION = "weights-2026-11-v2"

# Scheduled scan windows — SINGLE SOURCE OF TRUTH for the twice-daily cadence.
# Consumed by:
#   - scan.yml's "Write scan_status.json" heredoc (imports this module)
#   - backend/scripts/check_cron_consistency.py (CI guard vs the YAML crons)
#   - backend/scripts/watchdog_check.py (next-expected-window staleness logic)
# If you change the cron schedule in .github/workflows/scan.yml, change it here
# in the same commit — the CI guard fails until both agree.
SCAN_WINDOWS_UTC = [(3, 30), (10, 30)]   # (hour_utc, minute_utc), Mon-Fri

# Source-cache TTLs (seconds)
HOLDINGS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 * 3   # ~90 days (quarterly-ish)
BHAVCOPY_CACHE_TTL_SECONDS = 60 * 60 * 12            # half a day
SURVEILLANCE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7    # weekly (successful fetch only)
# A failed/provisional surveillance fetch must NOT be pinned for a week: a
# single outage used to disable the gate until the next weekly refresh.
SURVEILLANCE_FAILURE_TTL_SECONDS = 60 * 30           # 30 minutes
CORPORATE_ACTIONS_CACHE_TTL_SECONDS = 60 * 60 * 12   # half a day
YF_CACHE_TTL_SECONDS = 60 * 60 * 12                 # 12 h for yfinance-derived fields (price-dependent)
YF_FUNDAMENTAL_CACHE_TTL_SECONDS = 60 * 60 * 24     # 24 h for F-score (balance-sheet-quarterly)

# Stale-data threshold for the UI (hours)
STALE_DATA_HOURS = 18

# ATR / entry / target parameters
ATR_PERIOD = 14
ENTRY_ZONE_ATR_FRACTION = 0.5
STOP_LOSS_ATR_MULT = 1.0
TARGET_1_ATR_MULT = 1.5
TARGET_2_ATR_MULT = 2.5

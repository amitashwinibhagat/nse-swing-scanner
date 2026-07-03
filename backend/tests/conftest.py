"""Pytest config: add backend dir to sys.path so `import source_status` etc. works."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Tests must exercise the live yfinance / Screener / NSE code paths, not
# short-circuit on a stale on-disk cache. The compute_* and fetch_* helpers
# honour NSE_SWING_NO_CACHE=1 to bypass their caches; set it here at session
# start so every test inherits it.
os.environ.setdefault("NSE_SWING_NO_CACHE", "1")

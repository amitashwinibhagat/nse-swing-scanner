"""
cache.py
Tiny on-disk JSON cache for source payloads that change slowly.

Used for:
  - Shareholding (Screener): changes quarterly
  - Bhavcopy rollups: change daily but rarely need re-download within a day
  - Surveillance list: changes weekly
  - F-score / P/E: cached to avoid re-hitting yfinance in CI

We deliberately avoid a key-value DB dependency (diskcache, redis, etc.) to keep
the dependency surface small. For the volumes involved (~500 symbols), plain
JSON files keyed by source+symbol+date are fine.
"""

import json
import os
import time
from pathlib import Path
from typing import Callable, Optional, TypeVar

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
Path(DEFAULT_CACHE_DIR).mkdir(parents=True, exist_ok=True)

# Single bypass flag read by `cached_call`. Tests set this in conftest.py so
# compute_* and fetch_* helpers exercise the live yfinance / Screener / NSE
# code paths instead of short-circuiting on stale cache.
NO_CACHE_ENV_VAR = "NSE_SWING_NO_CACHE"

T = TypeVar("T")


def _safe_key(key: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in key)


def cache_path(cache_dir: str, key: str) -> str:
    return os.path.join(cache_dir, f"{_safe_key(key)}.json")


def read_cache(key: str, cache_dir: str = DEFAULT_CACHE_DIR, max_age_seconds: Optional[int] = None) -> Optional[dict]:
    """
    Read a cached payload by key. Returns None if missing or older than max_age_seconds.
    """
    path = cache_path(cache_dir, key)
    if not os.path.exists(path):
        return None
    if max_age_seconds is not None:
        age = time.time() - os.path.getmtime(path)
        if age > max_age_seconds:
            return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def write_cache(key: str, value: dict, cache_dir: str = DEFAULT_CACHE_DIR) -> None:
    path = cache_path(cache_dir, key)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(value, f, indent=2, default=str)
    os.replace(tmp, path)


def clear_cache(cache_dir: str = DEFAULT_CACHE_DIR) -> int:
    """Remove all cache files. Returns the number of files removed."""
    if not os.path.isdir(cache_dir):
        return 0
    n = 0
    for name in os.listdir(cache_dir):
        if name.endswith(".json"):
            try:
                os.remove(os.path.join(cache_dir, name))
                n += 1
            except OSError:
                pass
    return n


def cached_call(
    key: str,
    ttl_seconds: int,
    fn: Callable[..., T],
    *args,
    cache_dir: str = DEFAULT_CACHE_DIR,
    **kwargs,
) -> T:
    """
    Cache-aside wrapper. On a hit, returns the cached value. On a miss, calls
    `fn(*args, **kwargs)`, writes the result to disk, and returns it.

    Bypassed (always calls fn) when the `NSE_SWING_NO_CACHE` env var is set to
    a truthy value — used by tests to exercise the live code paths.

    Centralising the env-var check + read-then-write pattern here means new
    cached functions don't need to copy the boilerplate, and the bypass flag
    has exactly one read site (here).
    """
    if not os.environ.get(NO_CACHE_ENV_VAR):
        cached = read_cache(key, cache_dir=cache_dir, max_age_seconds=ttl_seconds)
        if cached is not None:
            return cached
    result = fn(*args, **kwargs)
    if not os.environ.get(NO_CACHE_ENV_VAR):
        try:
            write_cache(key, result, cache_dir=cache_dir)
        except (OSError, TypeError):
            # Cache write failure must not break the caller. On-disk cache
            # is best-effort; the next call will simply recompute.
            pass
    return result

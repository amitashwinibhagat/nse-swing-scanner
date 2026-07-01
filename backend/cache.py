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
from typing import Optional

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
Path(DEFAULT_CACHE_DIR).mkdir(parents=True, exist_ok=True)


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

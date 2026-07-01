"""Tests for the on-disk cache."""
import json
import os
import tempfile
import time

import pytest

from cache import read_cache, write_cache, clear_cache


def test_write_read_roundtrip(tmp_path):
    write_cache("foo:bar", {"hello": "world"}, cache_dir=str(tmp_path))
    got = read_cache("foo:bar", cache_dir=str(tmp_path))
    assert got == {"hello": "world"}


def test_missing_returns_none(tmp_path):
    assert read_cache("never:written", cache_dir=str(tmp_path)) is None


def test_max_age_expired(tmp_path):
    write_cache("foo:expired", {"v": 1}, cache_dir=str(tmp_path))
    # Manually backdate the mtime
    p = os.path.join(str(tmp_path), "foo_expired.json")
    old = time.time() - 999
    os.utime(p, (old, old))
    assert read_cache("foo:expired", cache_dir=str(tmp_path), max_age_seconds=10) is None
    # No max age returns it
    assert read_cache("foo:expired", cache_dir=str(tmp_path)) == {"v": 1}


def test_unsafe_key_is_sanitized(tmp_path):
    write_cache("weird/key with spaces!", {"x": 1}, cache_dir=str(tmp_path))
    got = read_cache("weird/key with spaces!", cache_dir=str(tmp_path))
    assert got == {"x": 1}
    # And the file exists with a sanitized name
    files = [f for f in os.listdir(str(tmp_path)) if f.endswith(".json")]
    assert any("weird_key_with_spaces" in f for f in files)


def test_clear_cache(tmp_path):
    write_cache("a:1", {"v": 1}, cache_dir=str(tmp_path))
    write_cache("a:2", {"v": 2}, cache_dir=str(tmp_path))
    n = clear_cache(cache_dir=str(tmp_path))
    assert n == 2
    assert read_cache("a:1", cache_dir=str(tmp_path)) is None

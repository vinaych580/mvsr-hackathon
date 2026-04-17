"""Tests for the data_ingestion.cache decorator."""

from __future__ import annotations

import os
import sys
import time
import tempfile
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def isolated_cache_dir(monkeypatch):
    tmp = tempfile.mkdtemp(prefix="agrisim-cache-")
    monkeypatch.setenv("AGRISIM_CACHE_DIR", tmp)
    # Re-import so _memory is fresh per test
    from data_ingestion import cache as cache_mod
    cache_mod._memory.clear()
    yield tmp


def test_cache_hits_avoid_recompute():
    from data_ingestion.cache import cached

    calls = {"n": 0}

    @cached(ttl_seconds=60, key="unit_test_fn")
    def expensive(x):
        calls["n"] += 1
        return x * 2

    assert expensive(3) == 6
    assert expensive(3) == 6
    assert calls["n"] == 1, "second call should have been served from cache"


def test_cache_ttl_expiry():
    from data_ingestion.cache import cached

    calls = {"n": 0}

    @cached(ttl_seconds=1, key="unit_test_ttl")
    def f(x):
        calls["n"] += 1
        return x

    f(1); f(1)
    assert calls["n"] == 1
    time.sleep(1.2)
    f(1)
    assert calls["n"] == 2

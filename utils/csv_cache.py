"""
Process-wide CSV cache with automatic mtime-based invalidation and pre-built
indexes for common lookups. Drop-in replacement for the various ad-hoc
`list(csv.DictReader(...))` loaders that used to run on every request.

All hot API endpoints re-read the same small CSV files hundreds of times per
minute. Parsing mandi_prices.csv (~2.8k rows) alone costs milliseconds but
compounds on hot paths. This module parses each file exactly once per mtime
and serves subsequent calls from memory in O(1) lookup dicts.

Thread-safe via a single RLock; safe under uvicorn / FastAPI's asyncio loop.
"""
from __future__ import annotations

import csv
import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

# Project root (two levels above this file). utils/ lives at the project root.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = _PROJECT_ROOT / "dataset"

_lock = threading.RLock()
# { filename : (mtime_ns, rows) }
_row_cache: Dict[str, tuple] = {}
# { filename : { index_kind : dict } }
_idx_cache: Dict[str, Dict[str, dict]] = {}


def _resolve(name: str) -> Path:
    """Accept either a bare filename or an absolute/relative path."""
    p = Path(name)
    if p.is_absolute() or p.exists():
        return p
    return DATASET_DIR / name


def load(name: str) -> List[Dict[str, str]]:
    """Return the rows of `name` as a list of dicts.

    Re-parses the file only when its mtime changes. The returned list is a
    shared reference — callers must NOT mutate it.
    """
    path = _resolve(name)
    try:
        mtime = path.stat().st_mtime_ns
    except FileNotFoundError:
        return []

    with _lock:
        cached = _row_cache.get(path.name)
        if cached and cached[0] == mtime:
            return cached[1]

    # Parse outside the lock so concurrent different-file loads don't serialize.
    with path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    with _lock:
        _row_cache[path.name] = (mtime, rows)
        _idx_cache.pop(path.name, None)  # invalidate derived indexes
    return rows


def index_by(name: str, key: str) -> Dict[str, List[Dict[str, str]]]:
    """Return rows of `name` grouped by the given column. Cached per (file, key)."""
    rows = load(name)
    with _lock:
        buckets = _idx_cache.setdefault(name, {})
        idx = buckets.get(f"by:{key}")
        if idx is None:
            idx = {}
            for r in rows:
                idx.setdefault(r.get(key, ""), []).append(r)
            buckets[f"by:{key}"] = idx
    return idx


def first_by(name: str, key: str, value: str) -> Optional[Dict[str, str]]:
    """Return the first row where row[key] == value, or None."""
    rows = index_by(name, key).get(value)
    return rows[0] if rows else None


def dict_by(name: str, key: str) -> Dict[str, Dict[str, str]]:
    """Map key -> row (last-wins). Cached per (file, key)."""
    with _lock:
        buckets = _idx_cache.setdefault(name, {})
        idx = buckets.get(f"dict:{key}")
        if idx is not None:
            return idx
    built = {r.get(key, ""): r for r in load(name)}
    with _lock:
        _idx_cache[name][f"dict:{key}"] = built
    return built


def clear() -> None:
    """Drop all caches (for tests / manual invalidation)."""
    with _lock:
        _row_cache.clear()
        _idx_cache.clear()


def stats() -> dict:
    """Small diagnostic — size of each cached file."""
    with _lock:
        return {
            "files": {k: {"rows": len(v[1]), "mtime_ns": v[0]} for k, v in _row_cache.items()},
            "indexes": {k: list(v.keys()) for k, v in _idx_cache.items()},
        }

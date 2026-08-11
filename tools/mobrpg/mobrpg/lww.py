"""Timestamp-only LWW sync decisions. No hashes, no stored baselines.

Design: docs/plans/2026-07-25-mobrpg-sync-lww-design.md §2.
"""
from __future__ import annotations

import datetime as _dt

SKEW_SECONDS = 120.0


def parse_ts(value) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v / 1000.0 if v > 1e11 else v  # epoch millis vs seconds
    s = str(value).strip()
    # Server returns `lastModified` as an ISO-8601 string with a trailing Z
    # (Task 1); the Z-suffix rewrite below is the hot path. py3.10's
    # fromisoformat can't parse "Z" directly, so this stays even once we
    # drop older interpreters. Epoch millis/seconds handling above is
    # defensive tolerance for other timestamp sources.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"  # py3.10 fromisoformat can't parse Z
    dt = _dt.datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt.timestamp()


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def decide(mtime: float, last_synced, updated, skew: float = SKEW_SECONDS) -> str:
    ls = parse_ts(last_synced) if not isinstance(last_synced, float) else last_synced
    up = parse_ts(updated) if not isinstance(updated, float) else updated
    if ls is None:
        # Never synced: no baseline exists, so neither side can win on
        # timestamps. The caller compares content and stamps (#147).
        return "baseline"
    vault_dirty = mtime > ls
    server_dirty = up is not None and up > ls
    if not vault_dirty and not server_dirty:
        return "skip"
    if vault_dirty and not server_dirty:
        return "push"
    if server_dirty and not vault_dirty:
        return "pull"
    if abs(mtime - up) < skew:
        return "tie"
    return "push" if mtime > up else "pull"

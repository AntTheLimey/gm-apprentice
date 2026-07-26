import pytest
from mobrpg import lww


def test_parse_ts_iso_z_py310_safe():
    assert lww.parse_ts("2026-07-25T12:00:00Z") == pytest.approx(1784980800.0, abs=1)

def test_parse_ts_epoch_millis_and_seconds_and_empty():
    assert lww.parse_ts(1784980800000) == pytest.approx(1784980800.0)
    assert lww.parse_ts(1784980800) == pytest.approx(1784980800.0)
    assert lww.parse_ts("") is None and lww.parse_ts(None) is None

def test_decide_never_synced_is_tie_when_both_exist():
    # No last_synced: both sides "dirty" -> human adjudicates via suggestion
    assert lww.decide(mtime=1000.0, last_synced=None, updated=900.0) == "tie"

def test_decide_matrix():
    ls = 1000.0
    assert lww.decide(900.0, ls, 900.0) == "skip"          # neither newer
    assert lww.decide(2000.0, ls, 900.0) == "push"         # vault only
    assert lww.decide(900.0, ls, 2000.0) == "pull"         # server only
    assert lww.decide(5000.0, ls, 2000.0) == "push"        # both; vault newer by >skew
    assert lww.decide(2000.0, ls, 5000.0) == "pull"        # both; server newer by >skew
    assert lww.decide(2000.0, ls, 2060.0) == "tie"         # both; within 120s skew

def test_decide_no_server_timestamp_with_dirty_vault_is_push():
    assert lww.decide(2000.0, 1000.0, None) == "push"

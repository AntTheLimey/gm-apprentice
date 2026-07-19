from mobrpg import merge3


def test_disjoint_changes_auto_combine():
    base = "line 1\nline 2\nline 3\nline 4\nline 5"
    ours = "line 1\nVAULT 2\nline 3\nline 4\nline 5"
    theirs = "line 1\nline 2\nline 3\nCANON 4\nline 5"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert "VAULT 2" in merged
    assert "CANON 4" in merged
    assert "line 1" in merged and "line 5" in merged


def test_identical_edits_do_not_conflict():
    base = "a\nb\nc"
    ours = "a\nBOTH\nc"
    theirs = "a\nBOTH\nc"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "a\nBOTH\nc"


def test_one_sided_change_wins_without_conflict():
    base = "a\nb\nc"
    ours = "a\nb\nc"          # vault unchanged
    theirs = "a\nCANON\nc"    # canon changed
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "a\nCANON\nc"


def test_overlapping_change_produces_conflict_markers():
    base = "a\nb\nc"
    ours = "a\nVAULT\nc"
    theirs = "a\nCANON\nc"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is True
    assert "<<<<<<< vault" in merged
    assert "VAULT" in merged
    assert "=======" in merged
    assert "CANON" in merged
    assert ">>>>>>> mobRPG" in merged


def test_unchanged_when_nobody_edits():
    base = "a\nb\nc"
    merged, conflict = merge3.merge3(base, base, base)
    assert conflict is False
    assert merged == "a\nb\nc"

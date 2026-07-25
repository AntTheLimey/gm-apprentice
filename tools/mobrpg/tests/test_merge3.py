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


def test_crlf_preserved_on_one_sided_canon_change():
    base = "a\r\nb\r\nc"
    ours = "a\r\nb\r\nc"          # vault unchanged
    theirs = "a\r\nCANON\r\nc"    # canon changed
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "a\r\nCANON\r\nc"
    assert "\r\n" in merged
    # no bare LF slipped in
    assert merged.replace("\r\n", "") .find("\n") == -1


def test_crlf_preserved_on_auto_combined_disjoint_changes():
    base = "line 1\r\nline 2\r\nline 3\r\nline 4\r\nline 5"
    ours = "line 1\r\nVAULT 2\r\nline 3\r\nline 4\r\nline 5"
    theirs = "line 1\r\nline 2\r\nline 3\r\nCANON 4\r\nline 5"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "line 1\r\nVAULT 2\r\nline 3\r\nCANON 4\r\nline 5"


def test_crlf_preserved_through_conflict_markers():
    base = "a\r\nb\r\nc"
    ours = "a\r\nVAULT\r\nc"
    theirs = "a\r\nCANON\r\nc"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is True
    assert "\r\n" in merged
    # every physical line ends with CRLF, none with a bare LF
    assert "\n" not in merged.replace("\r\n", "")
    assert "<<<<<<< vault" in merged
    assert ">>>>>>> mobRPG" in merged


def test_lf_stays_lf_when_dominant():
    base = "a\nb\nc"
    ours = "a\nb\nc"
    theirs = "a\nCANON\nc"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "a\nCANON\nc"
    assert "\r" not in merged


def test_one_sided_multiline_deletion_auto_merges():
    base = "a\nb\nc\nd\ne"
    ours = "a\nb\nc\nd\ne"     # vault unchanged
    theirs = "a\ne"            # canon deleted b, c, d
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert merged == "a\ne"


def test_both_sides_multiline_change_conflicts():
    base = "a\nb\nc\nd\ne"
    ours = "a\nVAULT1\nVAULT2\nd\ne"
    theirs = "a\nCANON1\nCANON2\nd\ne"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is True
    assert "<<<<<<< vault" in merged
    assert "VAULT1" in merged and "VAULT2" in merged
    assert "=======" in merged
    assert "CANON1" in merged and "CANON2" in merged
    assert ">>>>>>> mobRPG" in merged


def test_crlf_preserved_via_pull_desc_section_roundtrip():
    """Integration: a CRLF description merged through merge3 keeps CRLF, matching
    section.py's own CRLF preservation on the canon-merge path."""
    base = "Intro line.\r\n\r\nBody paragraph one.\r\nBody paragraph two.\r\n"
    ours = "Intro line.\r\n\r\nBody paragraph one.\r\nBody paragraph two.\r\n"
    theirs = "Intro line.\r\n\r\nBody paragraph one edited.\r\nBody paragraph two.\r\n"
    merged, conflict = merge3.merge3(base, ours, theirs)
    assert conflict is False
    assert "edited" in merged
    assert "\r\n" in merged
    assert "\n" not in merged.replace("\r\n", "")

from mobrpg import section
from mobrpg.section import gm_notes_split


BODY = ("## Overview\n\nCanon prose.\n\n"
        "## Appearances\n\nSession 3: crossed vacuum.\n\n"
        "## Points of Interest\n\n"
        "## Source References\n\n- wrapup 03\n\n"
        "## GM Notes\n\nSecret.\n")


def test_split_vault_only_extracts_all_configured_sections():
    canon, tail = section.split_vault_only(BODY)
    assert "Canon prose." in canon
    assert "## Points of Interest" in canon          # not vault-only
    for kept in ("## Appearances", "Session 3", "## Source References",
                 "wrapup 03", "## GM Notes", "Secret."):
        assert kept in tail and kept not in canon


def test_split_vault_only_custom_titles():
    canon, tail = section.split_vault_only(BODY, titles=("Points of Interest",))
    assert "## Points of Interest" in tail
    assert "## GM Notes" in canon                    # custom list REPLACES default


def test_split_vault_only_no_sections_is_identity():
    assert section.split_vault_only("plain prose\n") == ("plain prose\n", "")


def test_drop_empty_sections_removes_heading_only_sections():
    out = section.drop_empty_sections(BODY)
    assert "## Points of Interest" not in out        # empty scaffold heading
    assert "## Overview" in out and "Canon prose." in out


def test_gm_notes_split_roundtrip_and_boundary():
    body = "Intro.\n\n## History\n\nStuff.\n\n## GM Notes\n\nSecret.\n"
    main, tail = gm_notes_split(body)
    assert main + tail == body
    assert tail.startswith("## GM Notes")
    assert "Secret." in tail and "Secret." not in main

def test_gm_notes_split_absent_and_crlf():
    assert gm_notes_split("Just prose.\n") == ("Just prose.\n", "")
    body = "A.\r\n\r\n## GM Notes\r\nS.\r\n"
    main, tail = gm_notes_split(body)
    assert main + tail == body and tail.startswith("## GM Notes")

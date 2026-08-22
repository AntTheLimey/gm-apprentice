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


# ---------------------------------------------------------------------------
# Fenced code blocks are not section boundaries. A ``` block containing a line
# that starts with "## " used to end the enclosing section early: everything
# below it fell out of the vault-only tail and into the canon (push) slice.
# ---------------------------------------------------------------------------

FENCED_GM = ("## Overview\n\nCanon prose.\n\n"
             "## GM Notes\n\n"
             "The hag's real numbers:\n\n"
             "```\n"
             "## Stat block\n"
             "STR 14, HP 22\n"
             "```\n\n"
             "She betrays the party in act three.\n")


def test_fenced_h2_does_not_end_a_vault_only_section_early():
    canon, tail = section.split_vault_only(FENCED_GM)
    assert canon + tail == FENCED_GM                 # nothing lost or reordered
    assert canon.strip() == "## Overview\n\nCanon prose."
    for secret in ("## Stat block", "STR 14, HP 22",
                   "She betrays the party in act three."):
        assert secret in tail and secret not in canon


def test_fenced_vault_only_heading_in_canon_prose_is_not_a_boundary():
    # A note documenting the vault template quotes "## GM Notes" inside a fence.
    # Treating that as a real heading moved the rest of the canon into the tail.
    body = ("## Overview\n\nThe note template looks like:\n\n"
            "```markdown\n"
            "## GM Notes\n"
            "(secrets go here)\n"
            "```\n\n"
            "Real canon continues here.\n")
    canon, tail = section.split_vault_only(body)
    assert tail == ""
    assert canon == body
    assert "Real canon continues here." in canon


def test_tilde_fences_and_longer_fences_are_honoured():
    body = ("## Overview\n\nProse.\n\n"
            "~~~\n## GM Notes\n~~~\n\n"
            "````\n## Notes\n```\nstill fenced\n````\n\n"
            "Tail prose.\n")
    canon, tail = section.split_vault_only(body)
    assert tail == "" and canon == body


def test_unclosed_fence_does_not_swallow_the_vault_only_sections():
    # An unbalanced ``` marker in canon prose opens a fence that never closes.
    # Treating the rest of the note as code left NO H2 boundary below it, so the
    # tail came back empty: GM Notes fell into the canon (push) slice, and a pull
    # had nothing to preserve. An unbalanced document must degrade to the
    # fence-blind behavior, not to a leak.
    body = ("## Overview\n\nProse with a stray marker:\n\n"
            "```\nnever closed\n\n"
            "## GM Notes\n\nSecret.\n")
    canon, tail = section.split_vault_only(body)
    assert canon + tail == body
    assert tail == "## GM Notes\n\nSecret.\n"
    assert "Secret." not in canon


def test_fence_whose_closer_is_indented_four_spaces_is_unterminated_not_a_trap():
    # A ``` opened at 0-3 spaces whose "closer" sits at 4+ (a code block nested
    # in a list) is unterminated by CommonMark — the same EOF trap.
    body = ("## Overview\n\n- item:\n\n  ```\n  code\n      ```\n\n"
            "## GM Notes\n\nSecret.\n")
    canon, tail = section.split_vault_only(body)
    assert canon + tail == body
    assert tail == "## GM Notes\n\nSecret.\n"
    assert "Secret." not in canon


def test_drop_empty_sections_ignores_fenced_headings():
    md = ("## Overview\n\n"
          "```\n## Properties\n```\n\n"
          "## Properties\n\n")
    out = section.drop_empty_sections(md)
    assert "```\n## Properties\n```" in out          # the fenced line survives
    assert out.rstrip().endswith("```")              # the real empty one is gone

from mobrpg import section


BODY_TRAILING = (
    "\n## Overview\n\nA resident of the station.\n\n"
    "## Motivations & Secrets\n\nWants out.\n\n"
    "## Appearances\n\n- Session 2\n\n"
    "## Source References\n\n- API import\n\n"
    "## GM Notes\n\nSecretly the informant.\n"
)

BODY_INTERLEAVED = (
    "\n## Overview\n\nAn NPC.\n\n"
    "## Notes\n\nquick note\n\n"
    "## Motivations & Secrets\n\nhidden agenda\n\n"
    "## Source References\n\n- import\n"
)

BODY_NO_GM = "\n## Overview\n\nJust canon prose, no GM-only sections.\n"

BODY_WITH_H1 = "\n# Silas Wren\n\nLede paragraph.\n\n## GM Notes\n\nkiller\n"


def test_region_is_prefix_up_to_first_gm_heading():
    region, _ = section.canon_section(BODY_TRAILING)
    assert "## Overview" in region
    assert "## Motivations & Secrets" in region
    assert "## Appearances" not in region
    assert "## Source References" not in region
    assert "## GM Notes" not in region


def test_identity_reinsert_trailing():
    region, reinsert = section.canon_section(BODY_TRAILING)
    assert reinsert(region) == BODY_TRAILING


def test_identity_reinsert_interleaved():
    # First GM-only heading is `## Notes`; everything after it (incl. the
    # Motivations section) is the preserved tail. Still an exact round-trip.
    region, reinsert = section.canon_section(BODY_INTERLEAVED)
    assert "## Notes" not in region
    assert "## Motivations & Secrets" not in region
    assert reinsert(region) == BODY_INTERLEAVED


def test_identity_reinsert_no_gm_sections():
    region, reinsert = section.canon_section(BODY_NO_GM)
    assert region.strip() == BODY_NO_GM.strip() or region == BODY_NO_GM
    assert reinsert(region) == BODY_NO_GM


def test_h1_stays_in_region():
    region, _ = section.canon_section(BODY_WITH_H1)
    assert "# Silas Wren" in region
    assert "Lede paragraph." in region
    assert "## GM Notes" not in region


def test_crlf_body_protects_gm_tail():
    # re.M `$` won't match before the `\r` of a `\r\n`, so a CRLF heading line
    # must still be recognised or the GM-only tail leaks into the region and
    # gets clobbered by take-canon.
    crlf = "Lede paragraph.\r\n\r\n## GM Notes\r\n\r\nkiller\r\n"
    region, reinsert = section.canon_section(crlf)
    assert "## GM Notes" not in region
    assert "killer" not in region
    assert reinsert(region) == crlf


def test_changed_region_preserves_tail_and_separates():
    _, reinsert = section.canon_section(BODY_TRAILING)
    out = reinsert("## Overview\n\nRewritten canon prose.")
    assert "Rewritten canon prose." in out
    # GM-only tail preserved verbatim
    assert "## GM Notes\n\nSecretly the informant." in out
    assert "## Appearances" in out
    # no gluing: the heading after the region starts on its own line
    assert "prose.## Appearances" not in out
    assert "\n## Appearances" in out

from mobrpg import links

# suggest._key("Marsh Hag") normalizes to "marshhag" (lowercased, punctuation and
# spaces stripped) — the index is keyed by that, not the raw display name.
IDX = {"marshhag": "e-77"}
FMT = links.URL_FMT


def test_push_rewrites_resolvable_wikilink_and_flattens_rest():
    md_in = "See [[Marsh Hag]] and [[Unknown Person]] and [go](notes/x.md) and [ok](https://a.b)."
    out = links.rewrite_md_for_push(md_in, IDX, "w1", FMT)
    assert FMT.format(world="w1", eid="e-77") in out
    assert "[[" not in out
    assert "Unknown Person" in out and "](notes/x.md)" not in out and "go" in out
    assert "https://a.b" in out


def test_push_alias_uses_display_text_resolves_by_name():
    out = links.rewrite_md_for_push("Meet [[Marsh Hag|the crone]].", IDX, "w1", FMT)
    assert f"[the crone]({FMT.format(world='w1', eid='e-77')})" in out


def test_pull_rewrites_known_element_urls_to_wikilinks():
    url = FMT.format(world="w1", eid="e-77")
    md_in = f"See [Marsh Hag]({url}) and [ext](https://a.b)."
    out = links.rewrite_md_for_pull(md_in, {"e-77": "Marsh Hag"})
    assert "[[Marsh Hag]]" in out and "https://a.b" in out


def test_pull_leaves_unknown_element_urls_untouched():
    url = FMT.format(world="w1", eid="e-99")
    md_in = f"See [Ghost]({url})."
    out = links.rewrite_md_for_pull(md_in, {"e-77": "Marsh Hag"})
    assert url in out and "[[" not in out


# ---- image embeds (#184) — an embed points at a vault attachment with no
# upstream counterpart, so a push must drop it, not flatten it to junk text ----

def test_push_drops_image_embed_line():
    md_in = "Intro.\n\n![[Eris System.jpg]]\n\nSee [[Marsh Hag]].\n"
    out = links.rewrite_md_for_push(md_in, IDX, "w1", FMT)
    assert "Eris System.jpg" not in out
    assert "!" not in out
    assert FMT.format(world="w1", eid="e-77") in out


def test_push_drops_sized_embed_width_is_not_an_alias():
    # In an Obsidian embed the pipe is a display width, not an alias:
    # ![[map.svg|697]] must vanish, never become the literal "!697".
    out = links.rewrite_md_for_push("![[Meridian-system-map.svg|697]]\nProse.",
                                    IDX, "w1", FMT)
    assert "697" not in out
    assert "!" not in out
    assert "Prose." in out


def test_push_inline_embed_leaves_surrounding_text():
    out = links.rewrite_md_for_push("before ![[m.png]] after", IDX, "w1", FMT)
    assert "m.png" not in out
    assert "before" in out and "after" in out


def test_push_embed_between_words_preserves_spacing():
    # `\s*` greediness must not weld the surrounding words together.
    out = links.rewrite_md_for_push("The gate opened![[Corwin]] stood there.",
                                    IDX, "w1", FMT)
    assert "openedstood" not in out
    assert "opened" in out and "stood there." in out


def test_push_embed_lines_do_not_merge_paragraphs():
    import re as _re
    out = links.rewrite_md_for_push("Para one.\n\n![[map.png]]\n\nPara two.",
                                    IDX, "w1", FMT)
    assert _re.search(r"Para one\.\n\n+Para two\.", out)


def test_push_embed_with_no_trailing_space_keeps_a_separator():
    out = links.rewrite_md_for_push("before ![[m.png]]after", IDX, "w1", FMT)
    assert "beforeafter" not in out
    assert "before after" in out


def test_push_malformed_multiline_embed_does_not_eat_prose():
    # `[^\]]+` spanning newlines could delete unrelated prose up to the next ]]
    out = links.rewrite_md_for_push("keep ![[foo\nbar]] this line too", IDX, "w1", FMT)
    assert "keep" in out and "this line too" in out


# ---------------------------------------------------------------------------
# normalize_element_links_for_compare (#190) — an mobRPG element-link anchor
# reduces to an id-keyed marker regardless of its exact HTML shape, so
# `sync`'s content compare isn't sensitive to display-text (alias) differences
# or to how the anchor's OTHER attributes happen to be ordered/quoted.
# ---------------------------------------------------------------------------

EL_URL = FMT.format(world="w1", eid="e-77")


def test_normalize_reduces_a_plain_anchor_to_an_id_marker():
    html = f'<p>See <a href="{EL_URL}">the crone</a>.</p>'
    out = links.normalize_element_links_for_compare(html, FMT)
    assert out == "<p>See [[e-77]].</p>"


def test_normalize_matches_regardless_of_display_text():
    # Two different alias/display texts over the SAME target must reduce to
    # the identical marker.
    a = links.normalize_element_links_for_compare(
        f'<a href="{EL_URL}">the crone</a>', FMT)
    b = links.normalize_element_links_for_compare(
        f'<a href="{EL_URL}">Marsh Hag</a>', FMT)
    assert a == b == "[[e-77]]"


def test_normalize_handles_attributes_before_href():
    # An anchor whose href isn't the first attribute (a shape our own
    # md_to_html never produces, but a server-side re-render could) must
    # still reduce to the SAME marker as the equivalent href-first anchor —
    # otherwise the two sides of a compare drift apart instead of together.
    plain = links.normalize_element_links_for_compare(
        f'<a href="{EL_URL}">Name</a>', FMT)
    reordered = links.normalize_element_links_for_compare(
        f'<a rel="noopener" target="_blank" href="{EL_URL}">Name</a>', FMT)
    assert plain == reordered == "[[e-77]]"


def test_normalize_handles_single_quoted_href():
    single = links.normalize_element_links_for_compare(
        f"<a href='{EL_URL}'>Name</a>", FMT)
    double = links.normalize_element_links_for_compare(
        f'<a href="{EL_URL}">Name</a>', FMT)
    assert single == double == "[[e-77]]"


def test_normalize_tolerates_a_trailing_slash_on_the_href():
    out = links.normalize_element_links_for_compare(f'<a href="{EL_URL}/">Name</a>', FMT)
    assert out == "[[e-77]]"


def test_normalize_leaves_external_links_untouched():
    html = '<p>See the <a href="https://example.com/rules">official rules</a>.</p>'
    out = links.normalize_element_links_for_compare(html, FMT)
    assert out == html                          # untouched — text can carry real meaning


def test_normalize_a_link_to_a_different_element_still_differs():
    # The marker is keyed on eid, so retargeting a link to a DIFFERENT
    # element is still a real, detectable difference.
    other_url = FMT.format(world="w1", eid="e-88")
    a = links.normalize_element_links_for_compare(f'<a href="{EL_URL}">Name</a>', FMT)
    b = links.normalize_element_links_for_compare(f'<a href="{other_url}">Name</a>', FMT)
    assert a != b

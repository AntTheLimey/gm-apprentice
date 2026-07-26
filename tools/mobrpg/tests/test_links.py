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

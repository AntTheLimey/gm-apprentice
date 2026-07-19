from mobrpg.commands import pull_desc
from mobrpg import node, section

BODY = (
    "\n## Overview\n\nA ruthless smuggler with hidden debts.\n\n"
    "## GM Notes\n\nSecretly the informant.\n"
)
REGION = section.canon_section(BODY)[0]
CANON_HTML = "<h2>Overview</h2><p>A ruthless smuggler with hidden debts.</p>"
NOW = "2026-07-19T14:02:00Z"


def _node(**over):
    nd = {
        "world_id": "w1", "external_ref": "regency:npc/silas_wren",
        "element_id": "el-1", "element_kind": "Person",
        "canon_base_md": REGION,
        "canon_html_hash": pull_desc.html_hash(CANON_HTML),
        "canon_synced_at": NOW,
    }
    nd.update(over)
    return nd


# ---- classify ----

def test_classify_in_sync():
    assert pull_desc.classify(_node(), BODY, CANON_HTML) == "in-sync"


def test_classify_canon_only_when_only_html_changed():
    changed = "<h2>Overview</h2><p>Now a reformed smuggler.</p>"
    assert pull_desc.classify(_node(), BODY, changed) == "canon-only"


def test_classify_vault_only_when_only_body_changed():
    edited_body = BODY.replace("hidden debts", "enormous debts")
    assert pull_desc.classify(_node(), edited_body, CANON_HTML) == "vault-only"


def test_classify_conflict_when_both_changed():
    edited_body = BODY.replace("hidden debts", "enormous debts")
    changed = "<h2>Overview</h2><p>Now a reformed smuggler.</p>"
    assert pull_desc.classify(_node(), edited_body, changed) == "conflict"


def test_classify_separate_policy_skips():
    assert pull_desc.classify(_node(description_policy="separate"), BODY, CANON_HTML) == "separate"


def test_classify_unbaselined_when_no_base():
    nd = _node()
    del nd["canon_base_md"]
    assert pull_desc.classify(nd, BODY, CANON_HTML) == "unbaselined"


# ---- resolve ----

def test_resolve_take_canon_replaces_region_and_rebaselines():
    changed_html = "<h2>Overview</h2><p>Now a reformed smuggler.</p>"
    new_node, new_body, note = pull_desc.resolve(_node(), BODY, changed_html, "take-canon", NOW)
    assert "reformed smuggler" in new_body
    assert "## GM Notes\n\nSecretly the informant." in new_body   # tail preserved
    assert new_node["canon_html_hash"] == pull_desc.html_hash(changed_html)
    assert "reformed smuggler" in new_node["canon_base_md"]
    assert note == ""


def test_resolve_keep_vault_clears_the_conflict():
    edited_body = BODY.replace("hidden debts", "enormous debts")
    changed_html = "<h2>Overview</h2><p>Now a reformed smuggler.</p>"
    new_node, new_body, note = pull_desc.resolve(_node(), edited_body, changed_html, "keep-vault", NOW)
    assert new_body == edited_body                        # vault prose untouched
    # re-baselined so the next classify reports in-sync
    assert pull_desc.classify(new_node, new_body, changed_html) == "in-sync"


def test_resolve_merge_clean_combines_and_rebaselines():
    # vault edits one paragraph, canon adds a distinct one -> disjoint, no markers
    body = "\n## Overview\n\nParagraph one.\n\nParagraph two.\n\n## GM Notes\n\nx\n"
    base = section.canon_section(body)[0]
    nd = _node(canon_base_md=base, canon_html_hash=pull_desc.html_hash("<p>base</p>"))
    edited = body.replace("Paragraph one.", "Paragraph ONE edited.")
    canon_html = "<h2>Overview</h2><p>Paragraph one.</p><p>Paragraph two CANON.</p>"
    new_node, new_body, note = pull_desc.resolve(nd, edited, canon_html, "merge", NOW)
    assert "<<<<<<<" not in new_body
    assert note == ""
    assert new_node["canon_synced_at"] == NOW


def test_resolve_merge_conflict_leaves_markers_and_does_not_rebaseline():
    edited_body = BODY.replace("hidden debts", "enormous debts")
    changed_html = "<h2>Overview</h2><p>A ruthless smuggler with secret debts.</p>"
    original = _node()
    new_node, new_body, note = pull_desc.resolve(original, edited_body, changed_html, "merge", NOW)
    assert "<<<<<<< vault" in new_body
    assert ">>>>>>> mobRPG" in new_body
    assert note != ""
    # base/hash NOT advanced while markers remain
    assert new_node["canon_base_md"] == original["canon_base_md"]
    assert new_node["canon_html_hash"] == original["canon_html_hash"]


def test_resolve_baseline_captures_current_state_without_touching_prose():
    nd = _node()
    del nd["canon_base_md"]
    del nd["canon_html_hash"]                       # unbaselined
    new_node, new_body, note = pull_desc.resolve(nd, BODY, CANON_HTML, "baseline", NOW)
    assert new_body == BODY                          # prose untouched
    assert new_node["canon_html_hash"] == pull_desc.html_hash(CANON_HTML)
    assert new_node["canon_base_md"] == section.canon_section(BODY)[0]
    assert new_node["canon_synced_at"] == NOW
    # freshly baselined -> next classify is in-sync
    assert pull_desc.classify(new_node, BODY, CANON_HTML) == "in-sync"


def test_baseline_is_the_only_resolve_allowed_without_only():
    # per-entity outcomes need a target; batch baseline does not.
    assert pull_desc._requires_only("take-canon", None) is True
    assert pull_desc._requires_only("merge", None) is True
    assert pull_desc._requires_only("separate", None) is True
    assert pull_desc._requires_only("baseline", None) is False
    assert pull_desc._requires_only("baseline", "npc/x") is False


def test_resolve_separate_sets_policy_and_leaves_body():
    new_node, new_body, note = pull_desc.resolve(_node(), BODY, CANON_HTML, "separate", NOW)
    assert new_node["description_policy"] == "separate"
    assert new_body == BODY


# ---- file write path ----

def test_rebuild_writes_node_scalars_and_body_preserving_frontmatter():
    txt = ("---\n"
           "type: npc\n"
           'occupation: "Broker"   # hand comment\n'
           + node.emit_node(_node())
           + "---" + BODY)
    changed_html = "<h2>Overview</h2><p>Now a reformed smuggler.</p>"
    body = pull_desc._body_of(txt)
    new_node, new_body, _ = pull_desc.resolve(_node(), body, changed_html, "take-canon", NOW)
    out = pull_desc._rebuild(txt, new_node, new_body)
    # authored frontmatter survives
    assert 'occupation: "Broker"   # hand comment\n' in out
    # new node scalar landed and re-reads
    reread = node.read_node(out)
    assert reread["canon_html_hash"] == pull_desc.html_hash(changed_html)
    assert "reformed smuggler" in reread["canon_base_md"]
    # new body prose landed, GM tail preserved
    assert "reformed smuggler" in pull_desc._body_of(out)
    assert "## GM Notes\n\nSecretly the informant." in out


def test_rebuild_survives_dashes_in_scalar_and_body():
    # canon_base_md holding a GFM table separator (| --- |) and a body with a
    # thematic-break --- rule must NOT confuse the frontmatter split.
    body_with_rule = "\n## Overview\n\nBefore.\n\n---\n\nAfter.\n\n## GM Notes\n\nx\n"
    nd = _node(canon_base_md="| A | B |\n| --- | --- |\n| 1 | 2 |")
    txt = ("---\ntype: npc\n" + node.emit_node(nd) + "---" + body_with_rule)
    # body extracted correctly despite the --- rule inside it
    assert pull_desc._body_of(txt) == body_with_rule
    new_node = dict(nd, canon_html_hash="sha256:new",
                    canon_base_md="| C | D |\n| --- | --- |\n| 3 | 4 |")
    out = pull_desc._rebuild(txt, new_node, body_with_rule)
    reread = node.read_node(out)
    assert reread is not None
    assert reread["canon_html_hash"] == "sha256:new"
    assert reread["canon_base_md"] == "| C | D |\n| --- | --- |\n| 3 | 4 |"
    assert pull_desc._body_of(out) == body_with_rule


def test_find_note_prefers_exact_and_rejects_ambiguous():
    notes = [
        ("/v/Characters/NPCs/Silas Wren.md", "", {"external_ref": "space:npc/silas_wren"}),
        ("/v/Characters/NPCs/Silas Bracken.md", "", {"external_ref": "space:npc/silas_bracken"}),
    ]
    # exact external_ref wins
    assert pull_desc._find_note(notes, "space:npc/silas_wren")[0] == notes[0][0]
    # unambiguous suffix resolves
    assert pull_desc._find_note(notes, "silas_bracken")[0] == notes[1][0]
    # ambiguous suffix (both paths end with ".md") -> no match, with a reason
    match, reason = pull_desc._find_note(notes, ".md")
    assert match is None
    assert "ambiguous" in reason.lower()

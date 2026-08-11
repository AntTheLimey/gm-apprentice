from mobrpg import node
from mobrpg.node import emit_node

FM = ('---\n'
      'type: npc\n'
      'occupation: "Order Field Agent, Linguist"   # hand comment\n'
      'aliases: [Bells, "Agent Bellamy"]\n'
      '---\n'
      '# Imogen\n\nBody text with a colon: yes.\n')

NODE = {
    "world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
    "element_id": None, "element_kind": "Person", "review_state": "pending",
    "last_synced": "2026-07-18", "review_note": "",
    "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
    "relationships": [
        {"predicate": "imprisoned_by", "target": "[[Dr_Erasmus_Hume]]",
         "event_type": "Generic", "event_id": None, "review_state": "pending"}],
    "languages": [],
}


def test_emit_is_json_valued_yaml():
    text = node.emit_node(NODE)
    assert text.startswith("mobrpg:\n")
    assert '  element_id: null\n' in text
    assert '  element_kind: "Person"\n' in text
    assert '    profession: "Priest"\n' in text
    assert '  languages: []\n' in text
    assert '    - predicate: "imprisoned_by"\n' in text
    assert '      event_id: null\n' in text


def test_round_trip_dict_identity():
    text = node.emit_node(NODE)
    assert node.read_node("---\n" + text + "---\n") == NODE


def test_write_inserts_and_preserves_authored_bytes():
    out = node.write_node(FM, NODE)
    # authored lines survive byte-for-byte (comment, flow list, body colon)
    assert 'occupation: "Order Field Agent, Linguist"   # hand comment\n' in out
    assert 'aliases: [Bells, "Agent Bellamy"]\n' in out
    assert 'Body text with a colon: yes.\n' in out
    # node now present and re-readable
    assert node.read_node(out) == NODE


def test_write_replaces_existing_block_only():
    once = node.write_node(FM, NODE)
    updated = dict(NODE, review_state="accepted", element_id="e-123")
    twice = node.write_node(once, updated)
    assert node.read_node(twice) == updated
    assert twice.count("mobrpg:\n") == 1          # replaced, not duplicated
    assert twice.count("occupation:") == 1        # authored content untouched


def test_read_none_when_absent():
    assert node.read_node("---\ntype: npc\n---\nbody\n") is None
    assert node.read_node("no frontmatter here") is None


def test_write_preserves_crlf_opening_fence():
    md = "---\r\ntype: npc\r\n---\r\nbody\r\n"
    out = node.write_node(md, {"world_id": "w1"})
    # the CRLF opening fence bytes survive verbatim
    assert out.startswith("---\r\n")
    # every authored non-mobrpg line is byte-identical
    assert "type: npc\r\n" in out
    assert out.endswith("---\r\nbody\r\n")
    assert node.read_node(out) == {"world_id": "w1", "relationships": [],
                                   "languages": []}


def test_write_preserves_blank_line_before_following_key():
    fm = ('---\n'
          'type: npc\n'
          'mobrpg:\n'
          '  world_id: "w1"\n'
          '\n'
          'author: bob\n'
          '---\n'
          'body\n')
    out = node.write_node(fm, {"world_id": "w2"})
    # the blank line separating the mobrpg block from author: bob survives
    assert '\n\nauthor: bob\n' in out
    assert 'author: bob\n' in out
    # and the node still round-trips as the updated node
    assert node.read_node(out) == {"world_id": "w2", "relationships": [],
                                   "languages": []}


def test_canon_base_scalars_absent_when_unset():
    # Back-compat: a node without the new scalars emits none of them.
    text = node.emit_node(NODE)
    for k in ("canon_html_hash", "canon_base_md", "canon_synced_at",
              "description_policy"):
        assert k not in text


def test_previous_ref_round_trips_when_present():
    n = dict(NODE, external_ref="canticle:new/Path", previous_ref="canticle:old/Path")
    text = node.emit_node(n)
    assert '  previous_ref: "canticle:old/Path"\n' in text
    assert node.read_node("---\n" + text + "---\n")["previous_ref"] == "canticle:old/Path"


def test_previous_ref_absent_when_unset():
    # a node without previous_ref must not emit the key (backward compatible)
    assert "previous_ref" not in node.emit_node(NODE)


def test_split_frontmatter_ignores_leading_thematic_break():
    # A note with NO YAML frontmatter that opens with a `---` thematic break and
    # has a later `---` must not be treated as frontmatter — otherwise write_node
    # splices the machine block into the prose region.
    md = "---\n\nIntro.\n\n---\n\nBody.\n"
    assert node._split_frontmatter(md) == (None, None, None)
    assert node.read_node(md) is None
    out = node.write_node(md, {"world_id": "w1"})
    # a fresh fence is created; the prose survives verbatim below it
    assert out.startswith("---\n")
    assert out.endswith(md)
    assert node.read_node(out) == {"world_id": "w1", "relationships": [],
                                   "languages": []}


def test_split_frontmatter_valid_yaml_with_leading_blank_line():
    # Frontmatter whose first line after the opening fence is blank is still
    # valid YAML — it must NOT be misread as absent. (Regression from the B4
    # "blank line after the fence => prose" guard; the old str.split('---',2)
    # path parsed this correctly.)
    md = "---\n\ntype: npc\nsecret_key: hush\n---\n\nReal body.\n"
    pre, fm, post = node._split_frontmatter(md)
    assert pre == "---\n"
    assert "type: npc" in fm and "secret_key: hush" in fm
    assert post.startswith("---")
    # write_node splices the machine block INSIDE the real frontmatter (above the
    # closing fence) — never as a second fence that demotes type:/secret_key: to
    # prose, and the private key is never pushed up as a description.
    out = node.write_node(md, {"world_id": "w1"})
    assert out.startswith("---\n")
    assert "type: npc\n" in out
    assert "secret_key: hush\n" in out
    assert out.count("---") == 2                 # only the opening + closing fence
    assert out.rstrip().endswith("Real body.")
    assert node.read_node(out) == {"world_id": "w1", "relationships": [],
                                   "languages": []}


def test_split_frontmatter_ignores_leading_break_before_prose_line():
    # A note with NO frontmatter whose body opens with '---' immediately followed
    # by a non-blank PROSE line (and a later '---') is prose, not frontmatter —
    # otherwise write_node splices the machine block into the prose region.
    md = "---\nSome intro text\n\n---\n\nBody paragraph.\n"
    assert node._split_frontmatter(md) == (None, None, None)
    assert node.read_node(md) is None
    out = node.write_node(md, {"world_id": "w1", "element_id": "el_9",
                               "review_state": "pending", "determined": {},
                               "relationships": [], "languages": []})
    # the machine block sits in a fresh fence ABOVE the untouched prose
    assert out.endswith(md)
    assert "mobrpg:" in out.split(md)[0]
    assert node.read_node(out)["element_id"] == "el_9"


def test_split_frontmatter_requires_exact_opening_fence():
    # `----` and `--- text` are prose, not a YAML fence
    assert node._split_frontmatter("----\nx\n---\n") == (None, None, None)
    assert node._split_frontmatter("--- x\ntype: npc\n---\nbody\n") == (None, None, None)


def test_emit_node_honors_crlf_eol_argument():
    text = node.emit_node({"world_id": "w1"}, "\r\n")
    assert text == ('mobrpg:\r\n  world_id: "w1"\r\n'
                    '  relationships: []\r\n  languages: []\r\n')


def test_write_node_matches_crlf_dominant_file_no_mixed_eol():
    md = "---\r\ntype: npc\r\n---\r\nbody\r\n"
    out = node.write_node(md, {"world_id": "w1"})
    # no lone LF remains once every CRLF is stripped — the block is uniform CRLF
    assert "\r\n" in out
    assert "\n" not in out.replace("\r\n", "")


def test_emit_node_strips_dead_scalars():
    node = {"element_id": "e1", "content_hash": "sha256:x", "canon_html_hash": "y",
            "canon_base_md": "z", "canon_synced_at": "t", "description_policy": "p",
            "last_synced": "2026-07-25T00:00:00Z"}
    out = emit_node(node)
    for dead in ("content_hash", "canon_html_hash", "canon_base_md",
                 "canon_synced_at", "description_policy"):
        assert dead not in out
    assert "last_synced" in out


def test_content_hash_removed():
    import mobrpg.node as n
    assert not hasattr(n, "content_hash")


def test_pending_ref_round_trips_when_present():
    n = dict(NODE, pending_ref="canticle:upd/Characters/NPCs/Imogen_Bellamy#abc123def456")
    text = node.emit_node(n)
    assert ('  pending_ref: '
            '"canticle:upd/Characters/NPCs/Imogen_Bellamy#abc123def456"\n') in text
    assert node.read_node("---\n" + text + "---\n")["pending_ref"] == \
        "canticle:upd/Characters/NPCs/Imogen_Bellamy#abc123def456"


def test_pending_ref_absent_when_unset():
    # a node that has never been pushed as an update must not emit the key
    assert "pending_ref" not in node.emit_node(NODE)

from mobrpg import node

FM = ('---\n'
      'type: npc\n'
      'occupation: "Order Field Agent, Linguist"   # hand comment\n'
      'aliases: [Bells, "Agent Bellamy"]\n'
      '---\n'
      '# Imogen\n\nBody text with a colon: yes.\n')

NODE = {
    "world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
    "element_id": None, "element_kind": "Person", "review_state": "pending",
    "content_hash": "sha256:abc", "last_synced": "2026-07-18", "review_note": "",
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

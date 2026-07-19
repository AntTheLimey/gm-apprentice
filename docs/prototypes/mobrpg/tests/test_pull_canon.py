from mobrpg.commands import pull_canon
from mobrpg import node

BASE = {"world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
        "element_id": None, "element_kind": "Person", "review_state": "pending",
        "content_hash": "sha256:x", "last_synced": "", "review_note": "",
        "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
        "relationships": [{"predicate": "friend_of", "target": "Nathaniel_Rooke",
                           "event_type": "Generic", "event_id": None,
                           "review_state": "pending"}],
        "languages": []}


def test_accept_unchanged_fills_ids():
    live = {"state": "accepted", "element_id": "el-1",
            "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
            "event_ids": {"friend_of|Nathaniel_Rooke": "ev-1"}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "accepted" and out["element_id"] == "el-1"
    assert out["relationships"][0]["event_id"] == "ev-1"
    assert out["relationships"][0]["review_state"] == "accepted"


def test_accept_after_edit_overwrites_determined():
    live = {"state": "accepted", "element_id": "el-1",
            "determined": {"profession": "Cultist", "race": "Human", "sex": "Female"},
            "event_ids": {}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "edited"
    assert out["determined"]["profession"] == "Cultist"


def test_dismissed_records_note_and_preserves():
    live = {"state": "dismissed", "element_id": None, "review_note": "dup",
            "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "dismissed" and out["review_note"] == "dup"
    assert out["determined"] == BASE["determined"]      # vault preserved


def test_deleted_flags_and_clears_id():
    prior = dict(BASE, element_id="el-1", review_state="accepted")
    live = {"state": "deleted", "element_id": "el-1", "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(prior, live)
    assert out["review_state"] == "deleted" and out["element_id"] is None


def test_pending_left_untouched():
    live = {"state": "pending", "element_id": None, "determined": {}, "event_ids": {}}
    assert pull_canon.apply_state(BASE, live) == BASE


def test_scaffold_note_creates_minimal_file():
    live = {"state": "accepted", "element_id": "new-1", "name": "Hidden Cult",
            "kind": "faction", "element_kind": "Organization",
            "determined": {"organization_type": "Cult"}, "event_ids": {}}
    rel, text = pull_canon.scaffold_note("canticle:Factions/Hidden_Cult", live, "canticle")
    assert rel == "Factions/Hidden_Cult.md"
    assert text.startswith("---\ntype: faction\n")
    n = node.read_node(text)
    assert n["element_id"] == "new-1" and n["review_state"] == "accepted"
    assert n["element_kind"] == "Organization"
    assert "# Hidden Cult" in text

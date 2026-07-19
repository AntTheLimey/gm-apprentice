import json
from mobrpg import node
from mobrpg.commands import backfill


def _vault(tmp_path):
    (tmp_path / "Characters/NPCs").mkdir(parents=True)
    (tmp_path / "Characters/NPCs/Imogen_Bellamy.md").write_text(
        "---\ntype: npc\n---\nBody.\n", encoding="utf-8")
    (tmp_path / "Characters/NPCs/Nathaniel_Rooke.md").write_text(
        "---\ntype: npc\n---\nBody.\n", encoding="utf-8")
    return str(tmp_path)


def _crosswalk():
    return {"worldId": "w1", "entities": [
        {"name": "Imogen Bellamy", "kind": "npc", "mobrpg_id": "im-1"},
        {"name": "Ghost Person", "kind": "npc", "mobrpg_id": "gh-1"}],
        "relationships": [
        {"subject": "Imogen Bellamy", "target": "Nathaniel Rooke",
         "predicate": "friend_of", "mobrpg_event_id": "ev-1"}]}


def test_nodes_from_crosswalk(tmp_path):
    v = _vault(tmp_path)
    nodes, unresolved = backfill.nodes_from_crosswalk(_crosswalk(), v, "canticle")
    key = str(tmp_path / "Characters/NPCs/Imogen_Bellamy.md")
    assert nodes[key]["element_id"] == "im-1"
    assert nodes[key]["review_state"] == "accepted"
    assert nodes[key]["element_kind"] == "Person"
    assert nodes[key]["relationships"][0]["event_id"] == "ev-1"
    assert any("Ghost Person" in u for u in unresolved)   # no vault file


def _dict_crosswalk():
    # detect_updates format: dict keyed by element_id, carries the mobRPG kind
    # and vault_path directly.
    return {
        "im-1": {"name": "Imogen Bellamy", "kind": "person",
                 "vault_path": "Characters/NPCs/Imogen_Bellamy.md"},
        "no-1": {"name": "Nathaniel Rooke", "kind": "organization",
                 "vault_path": "Characters/NPCs/Nathaniel_Rooke.md"},
        "gh-1": {"name": "Ghost Person", "kind": "person",
                 "vault_path": "Characters/NPCs/Ghost.md"},   # file doesn't exist
    }


def test_nodes_from_dict_keyed_crosswalk(tmp_path):
    v = _vault(tmp_path)
    nodes, unresolved = backfill.nodes_from_crosswalk(_dict_crosswalk(), v, "space_game")
    key = str(tmp_path / "Characters/NPCs/Imogen_Bellamy.md")
    assert nodes[key]["element_id"] == "im-1"
    assert nodes[key]["element_kind"] == "Person"
    assert nodes[key]["review_state"] == "accepted"
    assert nodes[key]["external_ref"] == "space_game:Characters/NPCs/Imogen_Bellamy"
    # mobRPG kind maps correctly (not defaulted to Person)
    rooke = str(tmp_path / "Characters/NPCs/Nathaniel_Rooke.md")
    assert nodes[rooke]["element_kind"] == "Organization"
    assert any("gh-1" in u or "Ghost" in u for u in unresolved)


def test_run_writes_nodes(tmp_path, capsys):
    v = _vault(tmp_path)
    cw = tmp_path / "cw.json"
    cw.write_text(json.dumps(_crosswalk()), encoding="utf-8")
    rc = backfill.run(["w1", "--vault", v, "--crosswalk", str(cw), "--execute"])
    assert rc == 0
    f = tmp_path / "Characters/NPCs/Imogen_Bellamy.md"
    assert node.read_node(f.read_text())["element_id"] == "im-1"

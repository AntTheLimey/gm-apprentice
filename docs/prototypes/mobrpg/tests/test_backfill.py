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


def test_run_writes_nodes(tmp_path, capsys):
    v = _vault(tmp_path)
    cw = tmp_path / "cw.json"
    cw.write_text(json.dumps(_crosswalk()), encoding="utf-8")
    rc = backfill.run(["w1", "--vault", v, "--crosswalk", str(cw), "--execute"])
    assert rc == 0
    f = tmp_path / "Characters/NPCs/Imogen_Bellamy.md"
    assert node.read_node(f.read_text())["element_id"] == "im-1"

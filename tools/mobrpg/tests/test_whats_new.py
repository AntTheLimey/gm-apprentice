import json
from mobrpg import node
from mobrpg.commands import whats_new


EXTRACT = {
    "worldId": "w1",
    "entities": [
        {"id": "a", "kind": "person", "name": "Alice"},
        {"id": "b", "kind": "item", "name": "Widget"},        # new: not linked
    ],
    "types": {
        "creature/type": [{"id": "t1", "name": "Lamprey"}],   # new: not in vault map
        "organization/type": [{"id": "t2", "name": "Corp"}],  # known
    },
}


def test_diff_world_reports_new_gone_and_new_types():
    vault_nodes = {"a": {"name": "Alice", "path": "/v/Alice.md"},
                   "z": {"name": "Ghost", "path": "/v/Ghost.md"}}   # z: gone upstream
    vault_types = {"corp"}
    d = whats_new.diff_world(EXTRACT, vault_nodes, vault_types)
    assert [e["id"] for e in d["new_entities"]] == ["b"]
    assert d["linked"] == 1                                          # Alice linked
    assert [g["name"] for g in d["gone"]] == ["Ghost"]              # z absent from world
    assert [t["name"] for t in d["new_types"]] == ["Lamprey"]      # Corp known, Lamprey new


def test_diff_world_all_in_sync():
    vault_nodes = {"a": {"name": "Alice", "path": "/a"}, "b": {"name": "Widget", "path": "/b"}}
    d = whats_new.diff_world(EXTRACT, vault_nodes, {"corp", "lamprey"})
    assert d["new_entities"] == [] and d["gone"] == [] and d["new_types"] == []
    assert d["linked"] == 2


def test_run_reads_extract_file_and_reports(tmp_path, capsys, monkeypatch):
    # a vault with one linked node (Alice) so the extract's Alice is 'linked'
    (tmp_path / "Characters/NPCs").mkdir(parents=True)
    nd = {"world_id": "", "external_ref": "space_game:Characters/NPCs/Alice",
          "element_id": "a", "element_kind": "Person", "review_state": "accepted",
          "relationships": [], "languages": []}
    (tmp_path / "Characters/NPCs/Alice.md").write_text(
        "---\ntype: npc\n" + node.emit_node(nd) + "---\nBody\n", encoding="utf-8")
    ex = tmp_path / "extract.json"
    ex.write_text(json.dumps(EXTRACT), encoding="utf-8")
    rc = whats_new.run(["w1", "--vault", str(tmp_path), "--extract", str(ex)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Widget" in out          # the new entity is reported
    assert "Lamprey" in out         # the new type is reported

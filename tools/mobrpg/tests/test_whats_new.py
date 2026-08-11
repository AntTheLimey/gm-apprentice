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


# --- #148: a type already in the map's _discoveredVocab reports as recorded, --
# --- unbound rather than new (no vault note uses it yet) -----------------------

def test_diff_world_recorded_unbound_reports_separately_from_new():
    # Lamprey is genuinely new (mobRPG has never surfaced it before). "Ghoul" was
    # already discovered by a prior `map init`/`sync` (recorded in the map's
    # _discoveredVocab) but no vault note has adopted it yet -- that is not new
    # work, so it must not read as unfinished `map` work on every run. The match
    # is folded (case/whitespace) per #148's _merge_key contract.
    extract = {
        "worldId": "w1",
        "entities": [],
        "types": {"creature/type": [{"id": "t1", "name": "Lamprey"},
                                    {"id": "t2", "name": " Ghoul  Variant "}]},
    }
    discovered_vocab = {"creature/type": ["ghoul  variant"]}
    d = whats_new.diff_world(extract, {}, set(), discovered_vocab)
    assert [t["name"] for t in d["new_types"]] == ["Lamprey"]
    assert [t["name"] for t in d["unbound_types"]] == [" Ghoul  Variant "]


def test_diff_world_no_discovered_vocab_treats_all_as_new():
    # Backward compatible default: without a discovered_vocab argument, every
    # not-yet-mapped type stays "new" (existing 3-arg call sites keep working).
    d = whats_new.diff_world(EXTRACT, {}, set())
    assert [t["name"] for t in d["new_types"]] == ["Lamprey", "Corp"]
    assert d["unbound_types"] == []


def test_run_reports_recorded_unbound_from_map(tmp_path, capsys, monkeypatch):
    (tmp_path / "_meta").mkdir(parents=True)
    mp = {"_discoveredVocab": {"creature/type": ["lamprey"]}}
    (tmp_path / "_meta" / "mobrpg-map.json").write_text(json.dumps(mp), encoding="utf-8")
    ex = tmp_path / "extract.json"
    ex.write_text(json.dumps(EXTRACT), encoding="utf-8")
    rc = whats_new.run(["w1", "--vault", str(tmp_path), "--extract", str(ex)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "recorded, unbound (no vault note uses it yet)" in out
    assert "Lamprey" in out


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

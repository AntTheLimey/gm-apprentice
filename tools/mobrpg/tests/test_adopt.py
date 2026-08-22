import json

from mobrpg import client, node
from mobrpg.commands import adopt


def _map():
    return {
        "vaultNamespace": "space_game", "worldId": "w1",
        "kinds": {"npc": "person", "location": "political", "faction": "organization",
                  "item": "item", "creature": "creature"},
        "locationRouting": {},
        "classifiers": {"profession": {}, "organizationType": {}, "creatureType": {}, "sex": {}},
        "relationshipTypes": {},
    }


def _vault(tmp_path):
    (tmp_path / "_meta").mkdir(parents=True)
    (tmp_path / "_meta/mobrpg-map.json").write_text(json.dumps(_map()), encoding="utf-8")
    return tmp_path


def _note(tmp_path, rel, fm="type: npc"):
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\n{fm}\n---\nBody.\n", encoding="utf-8")
    return p


def _fake_live(mapping):
    """mapping: {element_kind: [{'id','name'}, ...]} -> a client._request stub
    that answers the per-kind list endpoint."""
    def stub(method, path, *, token=None, query=None, body=None):
        ek = path.rsplit("/", 1)[-1]
        return {"content": mapping.get(ek, []), "page": {"totalPages": 1}}
    return stub


def _auth(monkeypatch):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")


def test_exact_match_stamps_accepted_node(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    _note(v, "Characters/NPCs/Imogen Bellamy.md")
    _auth(monkeypatch)
    monkeypatch.setattr(client, "_request",
                        _fake_live({"person": [{"id": "im-id", "name": "Imogen Bellamy"}]}))
    assert adopt.run(["w1", "--vault", str(v), "--execute"]) == 0
    nd = node.read_node((v / "Characters/NPCs/Imogen Bellamy.md").read_text())
    assert nd["element_id"] == "im-id"
    assert nd["element_kind"] == "Person"
    assert nd["review_state"] == "accepted"
    assert "stamped 1" in capsys.readouterr().out


def test_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    p = _note(v, "Characters/NPCs/Imogen Bellamy.md")
    before = p.read_text()
    _auth(monkeypatch)
    monkeypatch.setattr(client, "_request",
                        _fake_live({"person": [{"id": "im-id", "name": "Imogen Bellamy"}]}))
    assert adopt.run(["w1", "--vault", str(v)]) == 0
    assert p.read_text() == before
    assert "would stamp 1" in capsys.readouterr().out


def test_ambiguous_is_never_stamped(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    p = _note(v, "Characters/NPCs/John Smith.md")
    _auth(monkeypatch)
    monkeypatch.setattr(client, "_request", _fake_live({"person": [
        {"id": "a", "name": "John Smith"}, {"id": "b", "name": "John Smith"}]}))
    assert adopt.run(["w1", "--vault", str(v), "--execute"]) == 0
    nd = node.read_node(p.read_text())
    assert nd is None or not nd.get("element_id")
    assert "ambiguous" in capsys.readouterr().out


def test_unmatched_reported_not_stamped(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    p = _note(v, "Characters/NPCs/Nobody Here.md")
    _auth(monkeypatch)
    monkeypatch.setattr(client, "_request", _fake_live({"person": []}))
    assert adopt.run(["w1", "--vault", str(v), "--execute"]) == 0
    assert node.read_node(p.read_text()) is None
    assert "no live match: Nobody Here" in capsys.readouterr().out


def test_alias_resolves_the_match(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    _note(v, "Characters/NPCs/Bells.md", fm='type: npc\naliases:\n  - "Imogen Bellamy"')
    _auth(monkeypatch)
    monkeypatch.setattr(client, "_request",
                        _fake_live({"person": [{"id": "im-id", "name": "Imogen Bellamy"}]}))
    assert adopt.run(["w1", "--vault", str(v), "--execute"]) == 0
    nd = node.read_node((v / "Characters/NPCs/Bells.md").read_text())
    assert nd["element_id"] == "im-id"


def test_already_linked_short_circuits_without_api(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    linked = {"world_id": "w1", "external_ref": "space_game:Characters/NPCs/Imogen Bellamy",
              "element_id": "existing", "element_kind": "Person", "review_state": "accepted",
              "relationships": [], "languages": []}
    p = v / "Characters/NPCs/Imogen Bellamy.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("---\ntype: npc\n" + node.emit_node(linked) + "---\nBody.\n", encoding="utf-8")

    def boom():
        raise AssertionError("must not authenticate when nothing to adopt")
    monkeypatch.setattr(client, "get_access_token", boom)
    assert adopt.run(["w1", "--vault", str(v), "--execute"]) == 0
    assert node.read_node(p.read_text())["element_id"] == "existing"   # untouched
    assert "nothing to adopt" in capsys.readouterr().out


def test_kind_filter_scopes_the_pull(tmp_path, monkeypatch, capsys):
    v = _vault(tmp_path)
    _note(v, "Characters/NPCs/Imogen Bellamy.md")
    _note(v, "Locations/British Museum.md", fm="type: location")
    _auth(monkeypatch)
    seen_kinds = []

    def stub(method, path, *, token=None, query=None, body=None):
        seen_kinds.append(path.rsplit("/", 1)[-1])
        return {"content": [{"id": "im-id", "name": "Imogen Bellamy"}], "page": {"totalPages": 1}}
    monkeypatch.setattr(client, "_request", stub)
    assert adopt.run(["w1", "--vault", str(v), "--kind", "npc", "--execute"]) == 0
    assert seen_kinds == ["person"]                     # only the npc→person endpoint pulled

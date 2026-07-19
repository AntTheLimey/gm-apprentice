import json
from mobrpg import client
from mobrpg.commands import pull


def test_html_to_md_basic():
    assert pull.html_to_md("<p>Hello <strong>world</strong></p>") == "Hello **world**"
    assert pull.html_to_md(None) == ""


def test_role_from_event_name():
    assert pull.role_from_event_name("Holger, Leader of Security", "Holger") == "Leader of Security"
    assert pull.role_from_event_name("", "Holger") is None


def _fake_request_factory():
    lists = {
        "person": [{"id": "p1", "name": "Holger"}],
        "organization": [{"id": "o1", "name": "Station Security"}],
        "political": [], "landfeature": [], "item": [], "creature": [],
        "culture": [], "race": [], "event": [{"id": "e1", "name": "Holger, Leader"}],
        "organization/type": [], "political/type": [],
    }
    singles = {
        ("person", "p1"): {"id": "p1", "name": "Holger", "description": "<p>Guard</p>",
                            "notes": [], "relations": []},
        ("organization", "o1"): {"id": "o1", "name": "Station Security",
                                 "description": "", "notes": [], "relations": []},
        ("event", "e1"): {"id": "e1", "name": "Holger, Leader", "eventType": "Leadership",
                          "title": "Leader",
                          "relations": [{"type": "Link", "sourceId": "e1", "targetId": "p1"},
                                        {"type": "Link", "sourceId": "e1", "targetId": "o1"}]},
    }

    def fake(method, path, *, token=None, query=None, body=None):
        parts = path.strip("/").split("/")  # world/{w}/{kind...}/{id?}
        # /world/{w}/{kind}            -> list  (parts: world, w, kind[, sub])
        # /world/{w}/{kind}/{id}       -> single
        tail = parts[2:]
        # try single: last segment is an id present in singles
        for (kind, eid), val in singles.items():
            if tail == kind.split("/") + [eid]:
                return val
        kind = "/".join(tail)
        return {"content": lists.get(kind, [])}

    return fake


def test_extract_builds_relationship(monkeypatch):
    monkeypatch.setattr(client, "_request", _fake_request_factory())
    result = pull.extract("world-1", "tok")
    names = {e["name"] for e in result["entities"]}
    assert names == {"Holger", "Station Security"}
    holger = next(e for e in result["entities"] if e["name"] == "Holger")
    assert holger["body_md"] == "Guard"
    rels = holger["relationships"]
    assert any(r["target"] == "Station Security" and r["predicate"] == "leads" for r in rels)


def test_run_writes_json(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok")
    monkeypatch.setattr(client, "_request", _fake_request_factory())
    monkeypatch.setattr(client, "whoami", lambda token: {"id": "u1"})
    out = tmp_path / "extract.json"
    rc = pull.run(["world-1", "--out", str(out)])
    assert rc == 0
    data = json.loads(out.read_text())
    assert data["worldId"] == "world-1"
    assert len(data["entities"]) == 2


def _make_fake(lists=None, singles=None):
    """Generic version of _fake_request_factory, parameterized per-test."""
    lists = lists or {}
    singles = singles or {}

    def fake(method, path, *, token=None, query=None, body=None):
        parts = path.strip("/").split("/")  # world/{w}/{kind...}/{id?}
        tail = parts[2:]
        for (kind, eid), val in singles.items():
            if tail == kind.split("/") + [eid]:
                return val
        kind = "/".join(tail)
        return {"content": lists.get(kind, [])}

    return fake


def test_employ_event_refines_predicate_to_located_at(monkeypatch):
    lists = {
        "person": [{"id": "p1", "name": "Alice"}],
        "political": [{"id": "po1", "name": "City State"}],
        "organization": [{"id": "o1", "name": "Guild"}],
        "event": [{"id": "e1", "name": "Alice, Envoy"}, {"id": "e2", "name": "Alice, Member"}],
    }
    singles = {
        ("person", "p1"): {"id": "p1", "name": "Alice", "description": "",
                            "notes": [], "relations": []},
        ("political", "po1"): {"id": "po1", "name": "City State", "description": "",
                                "notes": [], "relations": []},
        ("organization", "o1"): {"id": "o1", "name": "Guild", "description": "",
                                  "notes": [], "relations": []},
        ("event", "e1"): {"id": "e1", "name": "Alice, Envoy", "eventType": "Employ",
                          "title": "Envoy",
                          "relations": [{"type": "Link", "sourceId": "e1", "targetId": "p1"},
                                        {"type": "Link", "sourceId": "e1", "targetId": "po1"}]},
        ("event", "e2"): {"id": "e2", "name": "Alice, Member", "eventType": "Membership",
                          "title": "Member",
                          "relations": [{"type": "Link", "sourceId": "e2", "targetId": "p1"},
                                        {"type": "Link", "sourceId": "e2", "targetId": "o1"}]},
    }
    monkeypatch.setattr(client, "_request", _make_fake(lists, singles))
    result = pull.extract("world-1", "tok")
    alice = next(e for e in result["entities"] if e["name"] == "Alice")
    rels = alice["relationships"]
    # Employ event + political object -> predicate refined to located_at
    assert any(r["target"] == "City State" and r["predicate"] == "located_at" for r in rels)
    # Non-Employ event keeps the eventType-mapped predicate (Membership -> member_of)
    assert any(r["target"] == "Guild" and r["predicate"] == "member_of" for r in rels)


def test_notes_split_by_hidden(monkeypatch):
    lists = {"person": [{"id": "p1", "name": "Bob"}]}
    singles = {
        ("person", "p1"): {"id": "p1", "name": "Bob", "description": "",
                            "notes": [{"note": "<p>public</p>", "hidden": False},
                                      {"note": "<p>secret</p>", "hidden": True}],
                            "relations": []},
    }
    monkeypatch.setattr(client, "_request", _make_fake(lists, singles))
    result = pull.extract("world-1", "tok")
    bob = next(e for e in result["entities"] if e["name"] == "Bob")
    assert bob["notes_public"] == ["public"]
    assert bob["notes_gm"] == ["secret"]


def test_attribute_edge_becomes_classifier(monkeypatch):
    lists = {
        "organization": [{"id": "o1", "name": "Guild"}],
        "organization/type": [{"id": "t1", "name": "Faction"}],
    }
    singles = {
        ("organization", "o1"): {"id": "o1", "name": "Guild", "description": "", "notes": [],
                                  "relations": [{"type": "Attribute", "sourceId": "t1",
                                                 "targetId": "o1"}]},
    }
    monkeypatch.setattr(client, "_request", _make_fake(lists, singles))
    result = pull.extract("world-1", "tok")
    guild = next(e for e in result["entities"] if e["name"] == "Guild")
    assert {"kind": "organization/type", "name": "Faction"} in guild["classifiers"]


def test_landfeature_types_become_classifiers(monkeypatch):
    lists = {"landfeature": [{"id": "lf1", "name": "Terra"}]}
    singles = {
        ("landfeature", "lf1"): {"id": "lf1", "name": "Terra", "description": "", "notes": [],
                                  "relations": [], "landFeatureTypes": ["Planet"]},
    }
    monkeypatch.setattr(client, "_request", _make_fake(lists, singles))
    result = pull.extract("world-1", "tok")
    terra = next(e for e in result["entities"] if e["name"] == "Terra")
    assert {"kind": "landfeature/subType", "name": "Planet"} in terra["classifiers"]


def test_role_from_event_name_comma_fallback():
    assert pull.role_from_event_name("Zeb, Envoy of X", "Nobody") == "Envoy of X"


def test_extract_emits_classifier_types_section(monkeypatch):
    lists = {
        "creature/type": [{"id": "ct1", "name": "Thideian Furry Lamprey"},
                          {"id": "ct2", "name": "Chitinoteuthis"}],
        "organization/type": [{"id": "ot1", "name": "Guild"}],
        "political/type": [{"id": "pt1", "name": "Town"}, {"id": "pt2", "name": "City"}],
    }
    monkeypatch.setattr(client, "_request", _make_fake(lists, {}))
    result = pull.extract("world-1", "tok")
    types = result["types"]
    assert {t["name"] for t in types["creature/type"]} == {"Thideian Furry Lamprey", "Chitinoteuthis"}
    assert types["organization/type"] == [{"id": "ot1", "name": "Guild"}]
    assert {t["name"] for t in types["political/type"]} == {"Town", "City"}
    # each entry is a bare {id, name} record
    assert types["creature/type"][0] == {"id": "ct1", "name": "Thideian Furry Lamprey"}


def test_extract_types_section_handles_empty_or_missing(monkeypatch):
    # no /type endpoints return anything -> section present, all keys empty lists
    monkeypatch.setattr(client, "_request", _make_fake({}, {}))
    result = pull.extract("world-1", "tok")
    assert result["types"] == {"creature/type": [], "organization/type": [], "political/type": []}


def test_extract_types_section_survives_non_json_endpoint(monkeypatch):
    def fake(method, path, *, token=None, query=None, body=None):
        if path.endswith("/creature/type"):
            raise ValueError("not JSON")  # some /type endpoints 404 / return non-JSON
        if path.endswith("/political/type"):
            return {"content": [{"id": "pt1", "name": "Town"}]}
        return {"content": []}

    monkeypatch.setattr(client, "_request", fake)
    result = pull.extract("world-1", "tok")
    assert result["types"]["creature/type"] == []
    assert result["types"]["political/type"] == [{"id": "pt1", "name": "Town"}]


def test_run_reports_api_error_and_writes_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok")

    def raise_api_error(token):
        raise client.ApiError(401, "bad token", "/user/me")

    monkeypatch.setattr(client, "whoami", raise_api_error)
    out = tmp_path / "x.json"
    rc = pull.run(["world-1", "--out", str(out)])
    assert rc == 1
    captured = capsys.readouterr()
    assert "ERROR" in captured.err
    assert not out.exists()

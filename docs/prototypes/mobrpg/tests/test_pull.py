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
    out = tmp_path / "extract.json"
    rc = pull.run(["world-1", "--out", str(out)])
    assert rc == 0
    data = json.loads(out.read_text())
    assert data["worldId"] == "world-1"
    assert len(data["entities"]) == 2

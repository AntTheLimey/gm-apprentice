"""#307: a 200 text/html answer, driven through the real client._request, must
keep meaning "this kind holds no elements" to every caller that relied on the
old JSONDecodeError (a ValueError)."""
import io

from mobrpg import client
import json

from mobrpg.commands import adopt, pull, rel_baseline, suggestions, sync_cmd


class _Resp(io.BytesIO):
    headers = {"Content-Type": "text/html"}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _html_everywhere(monkeypatch):
    monkeypatch.setattr(client.urllib.request, "urlopen",
                        lambda req, timeout=None: _Resp(b"<!doctype html><html></html>"))


def test_live_element_ids_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull.live_element_ids("w1", "tok") == set()


def test_list_all_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull._list_all("w1", "race", "tok") == []


def test_get_one_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull._get_one("w1", "race", "r1", "tok") == {}


def test_relations_fetch_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert rel_baseline._get_relations("w1", "person", "p1", "tok") == []


def _json_except_html(monkeypatch, json_for):
    """urlopen fake: JSON for a path in json_for (path -> payload), HTML otherwise."""
    def urlopen(req, timeout=None):
        path = req.full_url.split("/api", 1)[1].split("?")[0]
        if path in json_for:
            r = _Resp(json.dumps(json_for[path]).encode())
            r.headers = {"Content-Type": "application/json"}
            return r
        return _Resp(b"<!doctype html><html></html>")
    monkeypatch.setattr(client.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")


def test_sync_fetch_treats_html_200_as_unknown(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    fetch = sync_cmd._make_fetch("w1", "tok")
    assert fetch({"element_kind": "Person", "element_id": "p1"}) == (None, "unknown")


def test_suggestions_fetch_elements_marks_html_200_as_missing(
        monkeypatch, unblock_client_network, tmp_path, capsys):
    _json_except_html(monkeypatch, {"/world/w1/suggestion": [
        {"id": "s1", "typeName": "Person", "resultElementId": "r1",
         "externalRef": "", "payload": {"name": "Vela"}}]})
    rc = suggestions.run(["w1", "--correlate", "--fetch-elements", "--json",
                          "--vault", str(tmp_path)])
    assert rc == 0
    row = json.loads(capsys.readouterr().out)[0]
    assert row["elementExists"] is False


def test_adopt_reports_html_200_listing_cleanly(monkeypatch, unblock_client_network,
                                                tmp_path, capsys):
    (tmp_path / "_meta").mkdir()
    (tmp_path / "_meta/mobrpg-map.json").write_text(json.dumps({
        "vaultNamespace": "x", "worldId": "w1",
        "kinds": {"npc": "person", "location": "political", "faction": "organization",
                  "item": "item", "creature": "creature"},
        "locationRouting": {},
        "classifiers": {"profession": {}, "organizationType": {}, "creatureType": {}, "sex": {}},
        "relationshipTypes": {}}), encoding="utf-8")
    note = tmp_path / "Characters" / "NPCs" / "Imogen.md"
    note.parent.mkdir(parents=True)
    note.write_text("---\ntype: npc\n---\nBody.\n", encoding="utf-8")
    _json_except_html(monkeypatch, {})
    assert adopt.run(["w1", "--vault", str(tmp_path)]) == 1
    assert "ERROR listing live" in capsys.readouterr().err

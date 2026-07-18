import json
import os

from mobrpg import client
from mobrpg.commands import map_cmd as m


def _make_vault(tmp_path):
    def w(rel, fm):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"---\n{fm}\n---\nbody\n", encoding="utf-8")
    w("Locations/Hopital.md", 'type: location\nlocation_type: "Hospital, research facility"')
    w("Locations/Nile.md", 'type: location\nlocation_type: "River"')
    w("Locations/Fourviere.md", 'type: location\nlocation_type: "District"')
    w("Characters/NPCs/Abbe.md",
      'type: npc\noccupation: "Priest, cult evangelist"\ngender: Male\n'
      'relationships:\n  - target: "[[X]]"\n    type: serves\n  - target: "[[Y]]"\n    type: enemy_of')
    w("Creatures/Spawn.md", 'type: creature\ncreature_type: "Mythos Entity"')
    return str(tmp_path)


def test_scan_vault(tmp_path):
    vocab = m.scan_vault(_make_vault(tmp_path))
    assert vocab["location_type"] == {"Hospital": 1, "River": 1, "District": 1}
    assert vocab["occupation"] == {"Priest": 1}
    assert vocab["gender"] == {"Male": 1}
    assert vocab["creature_type"] == {"Mythos Entity": 1}
    assert vocab["predicate"] == {"serves": 1, "enemy_of": 1}


def test_route_location():
    disc = {"political/type": {"district": "dist-id"}}
    assert m._route_location("Hospital", disc) == {
        "target": "political", "politicalType": "Hospital", "mobrpgId": None, "status": "review"}
    assert m._route_location("River", disc)["target"] == "landfeature"
    assert m._route_location("River", disc)["landFeatureType"] == "River"
    d = m._route_location("District", disc)
    assert d["status"] == "bound" and d["mobrpgId"] == "dist-id"


def test_bind_matches_existing_else_new():
    existing = {"occultist": "occ-id"}
    assert m._bind("Occultist", existing, "person/profession")["status"] == "bound"
    assert m._bind("Priest", existing, "person/profession")["status"] == "new"


def test_init_then_sync(tmp_path, monkeypatch):
    vault = _make_vault(tmp_path)
    # mobRPG starts with only "District" as a political type
    state = {"political/type": [{"name": "District", "id": "dist-id"}]}

    def fake(method, path, *, token=None, body=None):
        if path == "/world":
            return [{"id": "w1", "name": "Regency"}]
        for kind, items in state.items():
            if f"/world/w1/{kind}" in path:
                return items
        return []

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)

    mp = str(tmp_path / "_meta" / "mobrpg-map.json")
    assert m.run(["init", "w1", "--vault", vault, "--map", mp, "--now", "T0"]) == 0
    data = json.load(open(mp))
    assert data["locationRouting"]["Hospital"]["status"] == "review"     # new political type
    assert data["locationRouting"]["River"]["target"] == "landfeature"
    assert data["locationRouting"]["District"]["status"] == "bound"      # matched existing

    # init refuses to clobber
    assert m.run(["init", "w1", "--vault", vault, "--map", mp]) == 2

    # GM later creates a Hospital political type in mobRPG -> sync promotes it to bound
    state["political/type"].append({"name": "Hospital", "id": "hosp-id"})
    assert m.run(["sync", "w1", "--vault", vault, "--map", mp, "--now", "T1"]) == 0
    data = json.load(open(mp))
    assert data["locationRouting"]["Hospital"]["status"] == "bound"
    assert data["locationRouting"]["Hospital"]["mobrpgId"] == "hosp-id"


def test_sync_preserves_confirmed(tmp_path, monkeypatch):
    vault = _make_vault(tmp_path)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda method, path, *, token=None, body=None:
                        [{"id": "w1", "name": "R"}] if path == "/world" else [])
    mp = str(tmp_path / "_meta" / "mobrpg-map.json")
    m.run(["init", "w1", "--vault", vault, "--map", mp, "--now", "T0"])
    data = json.load(open(mp))
    # human curates Hospital -> landfeature and confirms it
    data["locationRouting"]["Hospital"] = {"target": "landfeature", "landFeatureType": "Hill",
                                           "confirmed": True}
    json.dump(data, open(mp, "w"))
    m.run(["sync", "w1", "--vault", vault, "--map", mp, "--now", "T1"])
    data = json.load(open(mp))
    assert data["locationRouting"]["Hospital"] == {"target": "landfeature",
                                                   "landFeatureType": "Hill", "confirmed": True}

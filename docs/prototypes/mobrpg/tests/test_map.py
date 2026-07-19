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
    # obviously-not-a-landfeature -> Political type (new), not parked in review
    assert m._route_location("Hospital", disc) == {
        "target": "political", "politicalType": "Hospital", "mobrpgId": None, "status": "new"}
    # exact enum -> landfeature
    assert m._route_location("River", disc)["target"] == "landfeature"
    assert m._route_location("River", disc)["landFeatureType"] == "River"
    # synonym of an enum value -> landfeature
    assert m._route_location("waterway", disc)["target"] == "landfeature"
    assert m._route_location("waterway", disc)["landFeatureType"] == "River"
    # existing type -> bound
    d = m._route_location("District", disc)
    assert d["status"] == "bound" and d["mobrpgId"] == "dist-id"


def test_bind_matches_existing_else_new():
    existing = {"occultist": "occ-id"}
    assert m._bind("Occultist", existing, "person/profession")["status"] == "bound"
    assert m._bind("Priest", existing, "person/profession")["status"] == "new"


# --- G2: genuinely-ambiguous vocab is parked in status "review" ---------------

def test_route_location_embedded_feature_word_goes_to_review():
    disc = {"political/type": {}}
    # "River Valley" embeds the landfeature word "river" but isn't itself a clean
    # feature -> ambiguous (a river/valley, or a district named after one?) -> review.
    r = m._route_location("River Valley", disc)
    assert r["status"] == "review"
    assert r["landFeatureType"] == "River"            # the matched feature hint
    assert r["politicalType"] == "River Valley"       # the tentative political default
    assert r["target"] == "political"


def test_route_location_embedded_synonym_word_goes_to_review():
    disc = {"political/type": {}}
    r = m._route_location("Old Mill Creek", disc)     # "creek" is a synonym of Stream
    assert r["status"] == "review" and r["landFeatureType"] == "Stream"


def test_route_location_plain_political_not_reviewed():
    disc = {"political/type": {}}
    # no landfeature word anywhere -> stays a plain new political type, never review.
    assert m._route_location("Hospital", disc)["status"] == "new"
    assert m._route_location("Town", disc)["status"] == "new"


def test_route_location_clean_feature_still_landfeature_not_review():
    disc = {"political/type": {}}
    assert m._route_location("River", disc)["target"] == "landfeature"
    assert m._route_location("River", disc)["status"] == "new"


def test_bind_near_duplicate_of_existing_goes_to_review():
    existing = {"occultist": "occ-id"}
    r = m._bind("Occultists", existing, "person/profession")   # plural variant
    assert r["status"] == "review"
    assert r["nearExisting"] == "occultist" and r["nearId"] == "occ-id"


def test_bind_distant_value_still_new_not_review():
    existing = {"occultist": "occ-id"}
    assert m._bind("Priest", existing, "person/profession")["status"] == "new"


def test_merge_classifier_review_resolution_survives_and_promotes():
    # A GM-resolved classifier review (via the same status:"confirmed" idiom that
    # works for locations) must survive sync; and a review whose type later exists
    # must promote to bound.
    old = {"classifiers": {
        "profession": {
            "Occultists": {"target": "person/profession", "name": "Occultists",
                           "status": "confirmed", "mobrpgId": "occ-id"},        # GM-resolved
            "Archaeologist": {"target": "person/profession", "name": "Archaeologist",
                              "status": "review", "nearExisting": "archeologist"},
        }}}
    new = {"classifiers": {
        "profession": {
            "Occultists": {"target": "person/profession", "name": "Occultists",
                           "status": "review", "nearExisting": "occultist"},     # recomputed
            "Archaeologist": {"target": "person/profession", "name": "Archaeologist",
                              "status": "bound", "mobrpgId": "arch-id"},          # now exists
        }}}
    merged, _ = m._merge(old, new)
    prof = merged["classifiers"]["profession"]
    assert prof["Occultists"]["status"] == "confirmed"      # human decision preserved
    assert prof["Archaeologist"]["status"] == "bound"       # review promoted to bound


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
    assert data["locationRouting"]["Hospital"]["status"] == "new"        # new political type
    assert data["locationRouting"]["Hospital"]["target"] == "political"
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

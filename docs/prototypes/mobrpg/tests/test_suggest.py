import os
from mobrpg.commands import suggest


def _vault(tmp_path):
    def w(rel, fm, body="Body text."):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"---\n{fm}\n---\n{body}\n", encoding="utf-8")
    w("Characters/NPCs/Imogen_Bellamy.md",
      'type: npc\ntags:\n  - chapter-1\naliases:\n  - "Bells"\n  - Agent Bellamy\n'
      'occupation: "Order Field Agent, Linguist"\ngender: Female\n'
      'relationships:\n  - target: "[[Dr_Erasmus_Hume]]"\n    type: imprisoned_by\n'
      '    description: "Held captive"\n  - target: "[[Nathaniel_Rooke]]"\n    type: friend_of')
    w("Locations/British_Museum.md", 'type: location\ntags:\n  - chapter-1\nlocation_type: "Museum"')
    w("Items & Artifacts/Liber_Ivonis.md", 'type: item\ntags:\n  - chapter-2\n')
    return str(tmp_path)


def test_collect_entities_parses_and_filters(tmp_path):
    v = _vault(tmp_path)
    ents = suggest.collect_entities(v, chapter="chapter-1")
    names = {e["name"] for e in ents}
    assert names == {"Imogen Bellamy", "British Museum"}   # chapter-2 item excluded
    im = next(e for e in ents if e["name"] == "Imogen Bellamy")
    assert im["kind"] == "npc"
    assert im["aliases"] == ["Bells", "Agent Bellamy"]
    assert im["occupation"].startswith("Order Field Agent")
    assert im["gender"] == "Female"
    assert im["description"].startswith("<p>") and "Body text" in im["description"]
    assert im["relationships"] == [
        {"target": "Dr_Erasmus_Hume", "predicate": "imprisoned_by", "desc": "Held captive"},
        {"target": "Nathaniel_Rooke", "predicate": "friend_of", "desc": ""}]


def test_collect_entities_kind_and_only(tmp_path):
    v = _vault(tmp_path)
    assert {e["name"] for e in suggest.collect_entities(v, kind="location")} == {"British Museum"}
    assert {e["name"] for e in suggest.collect_entities(v, only="imogen")} == {"Imogen Bellamy"}


def test_item_builders():
    c = suggest._create("e1", "Dr X", {"type": "Person", "languages": [], "equipment": []},
                        description="<p>hi</p>", altNames=["Doc"], external_ref="canticle:x")
    assert c["ref"] == "e1" and c["operation"] == "CreateElement"
    assert c["payload"]["operation"] == "CreateElement" and c["payload"]["name"] == "Dr X"
    assert c["payload"]["data"]["type"] == "Person" and c["externalRef"] == "canticle:x"
    r = suggest._relation("Attribute", "suggestion:t1", "suggestion:e1", ["t1", "e1"])
    assert r["operation"] == "AddRelation" and "ref" not in r
    assert r["payload"] == {"operation": "AddRelation", "sourceRef": "suggestion:t1",
                            "targetRef": "suggestion:e1", "type": "Attribute"}
    assert r["dependsOn"] == ["t1", "e1"]


def test_resolve_classifier_and_lookup():
    assert suggest.resolve_classifier({"mobrpgId": "abc", "status": "proposed"}) == ("bound", "abc")
    assert suggest.resolve_classifier({"status": "drop", "name": "X"}) == ("drop", None)
    assert suggest.resolve_classifier({"name": "Servant"}) == ("create", "Servant")
    assert suggest.resolve_classifier(None) == ("drop", None)
    section = {"Priest": {"mobrpgId": "p1"}, "male": {"name": "Male"}}
    assert suggest._lookup(section, "Priest, cultist") == {"mobrpgId": "p1"}   # first token
    assert suggest._lookup(section, "Male") == {"name": "Male"}                # case-tolerant
    assert suggest._lookup(section, "Unknown") is None


def _map():
    return {
        "vaultNamespace": "canticle",
        "kinds": {"npc": "person", "pc": "person", "location": "political",
                  "faction": "organization", "item": "item", "creature": "creature"},
        "locationRouting": {
            "Museum": {"target": "political", "politicalType": "Museum", "mobrpgId": None, "status": "new"},
            "River": {"target": "landfeature", "landFeatureType": "River", "mobrpgId": None, "status": "new"}},
        "classifiers": {"profession": {}, "organizationType": {}, "creatureType": {}, "sex": {}},
        "relationshipTypes": {},
    }


def test_element_spec_routing():
    mp = _map()
    person = {"kind": "npc", "location_type": None}
    assert suggest.element_spec(person, mp)[0] == "person"
    assert suggest.element_spec(person, mp)[1] == {"type": "Person", "languages": [], "equipment": []}
    built = {"kind": "location", "location_type": "Museum"}
    assert suggest.element_spec(built, mp)[:2] == ("political", {"type": "Political", "titles": []})
    natural = {"kind": "location", "location_type": "River"}
    ek, data, route = suggest.element_spec(natural, mp)
    assert ek == "landfeature" and data == {"type": "LandFeature", "landFeatureTypes": ["River"]}


def test_element_items(tmp_path):
    mp = _map()
    ent = {"path": str(tmp_path / "Locations/British_Museum.md"), "kind": "location",
           "name": "British Museum", "aliases": ["BM"], "description": "<p>hi</p>",
           "location_type": "Museum"}
    items = suggest.element_items(ent, mp, "e1", str(tmp_path), "canticle")
    assert len(items) == 1
    assert items[0]["ref"] == "e1"
    assert items[0]["payload"]["data"]["type"] == "Political"
    assert items[0]["externalRef"] == "canticle:Locations/British_Museum"
    assert items[0]["payload"]["altNames"] == ["BM"]

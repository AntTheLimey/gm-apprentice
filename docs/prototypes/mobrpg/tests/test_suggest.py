import os

import pytest

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
    # an unresolved near-duplicate (map status "review") is skipped, never minted
    assert suggest.resolve_classifier(
        {"status": "review", "name": "Occultists", "nearExisting": "occultist"}) == ("drop", None)
    # ...but once the GM confirms it as genuinely new, it is created
    assert suggest.resolve_classifier(
        {"status": "confirmed", "name": "Occultists"}) == ("create", "Occultists")
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


def test_classifier_items_profession_bound_and_create():
    mp = _map()
    mp["classifiers"]["profession"] = {
        "Priest": {"mobrpgId": "prof-real", "status": "proposed", "name": "Priest"},
        "Housemaid": {"name": "Servant", "status": "proposed"}}
    ent = {"kind": "npc", "occupation": "Priest, cultist", "location_type": None}
    items, unmapped = suggest.classifier_items(ent, mp, "e1", "race-h", "e1")
    edges = [i for i in items if i["operation"] == "AddRelation"]
    # bound profession -> edge sourceRef is the REAL id, no Type create for it
    assert any(e["payload"]["sourceRef"] == "prof-real"
               and e["payload"]["targetRef"] == "suggestion:e1"
               and e["payload"]["type"] == "Attribute" for e in edges)

    ent2 = {"kind": "npc", "occupation": "Housemaid", "location_type": None}
    items2, _ = suggest.classifier_items(ent2, mp, "e1", "race-h", "e1")
    creates = [i for i in items2 if i["operation"] == "CreateElement"]
    assert any(c["payload"]["name"] == "Servant"
               and c["payload"]["data"]["type"] == "Profession" for c in creates)
    # edge points from the new Type's suggestion ref to the person
    tref = next(c["ref"] for c in creates if c["payload"]["name"] == "Servant")
    assert any(e["payload"]["sourceRef"] == f"suggestion:{tref}"
               and e["payload"]["targetRef"] == "suggestion:e1" for e in items2
               if e["operation"] == "AddRelation")


def test_classifier_items_political_type():
    mp = _map()
    ent = {"kind": "location", "location_type": "Museum"}
    items, _ = suggest.classifier_items(ent, mp, "e1", "race-h", "e1")
    creates = [i for i in items if i["operation"] == "CreateElement"]
    assert any(c["payload"]["data"]["type"] == "PoliticalType"
               and c["payload"]["name"] == "Museum" for c in creates)


def test_classifier_items_landfeature_has_no_edge():
    mp = _map()
    ent = {"kind": "location", "location_type": "River"}
    items, _ = suggest.classifier_items(ent, mp, "e1", "race-h", "e1")
    assert items == []   # subtype is inline on the element; no Type edge


def test_person_race_and_sex_edges():
    mp = _map()
    mp["classifiers"]["sex"] = {"female": {"name": "Female", "status": "new"}}
    ent = {"kind": "npc", "occupation": None, "gender": "Female", "location_type": None}
    items, _ = suggest.classifier_items(ent, mp, "e1", "race-human", "e1")
    edges = [i for i in items if i["operation"] == "AddRelation"]
    creates = [i for i in items if i["operation"] == "CreateElement"]
    # Race attached to person using the real race id
    assert any(e["payload"]["sourceRef"] == "race-human"
               and e["payload"]["targetRef"] == "suggestion:e1" for e in edges)
    # Sex element created
    sref = next(c["ref"] for c in creates if c["payload"]["data"]["type"] == "Sex")
    assert next(c for c in creates if c["ref"] == sref)["payload"]["name"] == "Female"
    # Race -> Sex (scoping, real race id as source) and Sex -> Person
    assert any(e["payload"]["sourceRef"] == "race-human"
               and e["payload"]["targetRef"] == f"suggestion:{sref}" for e in edges)
    assert any(e["payload"]["sourceRef"] == f"suggestion:{sref}"
               and e["payload"]["targetRef"] == "suggestion:e1" for e in edges)


def test_person_without_race_id_skips_race_and_sex():
    mp = _map()
    mp["classifiers"]["sex"] = {"female": {"name": "Female"}}
    ent = {"kind": "npc", "occupation": None, "gender": "Female", "location_type": None}
    items, reports = suggest.classifier_items(ent, mp, "e1", None, "e1")
    assert items == []           # no race id → cannot scope Sex → emit neither
    assert any("race" in r.lower() for r in reports)


def _crosswalk():
    return {
        "entities": [{"name": "Dr Erasmus Hume", "kind": "npc", "mobrpg_id": "hume-id"},
                     {"name": "Nathaniel Rooke", "kind": "npc", "mobrpg_id": "rooke-id"}],
        "relationships": [{"subject": "Imogen Bellamy", "target": "Nathaniel Rooke",
                           "predicate": "friend_of", "mobrpg_event_id": "ev-existing"}]}


def test_crosswalk_index():
    idx, linked = suggest.crosswalk_index(_crosswalk())
    assert idx[suggest._key("Dr_Erasmus_Hume")] == "hume-id"
    assert (suggest._key("Imogen Bellamy"), "friend_of", suggest._key("Nathaniel Rooke")) in linked


def test_relationship_items(tmp_path):
    mp = _map()
    mp["relationshipTypes"] = {"imprisoned_by": "Generic"}
    idx, linked = suggest.crosswalk_index(_crosswalk())
    ent = {"path": str(tmp_path / "Characters/NPCs/Imogen_Bellamy.md"), "name": "Imogen Bellamy",
           "relationships": [
               {"target": "Dr_Erasmus_Hume", "predicate": "imprisoned_by", "desc": "held"},
               {"target": "Nathaniel_Rooke", "predicate": "friend_of", "desc": ""},   # already linked -> skip
               {"target": "Unknown_Person", "predicate": "knows", "desc": ""}]}       # unresolvable -> skip
    items, skipped = suggest.relationship_items(ent, mp, "e1", idx, linked,
                                                str(tmp_path), "canticle", "e1")
    events = [i for i in items if i["operation"] == "CreateElement"]
    assert len(events) == 1
    ev = events[0]
    assert ev["payload"]["data"] == {"type": "Event", "eventType": "Generic"}
    assert ev["externalRef"].startswith("canticle:rel/")
    links = [i for i in items if i["operation"] == "AddRelation"]
    assert {l["payload"]["targetRef"] for l in links} == {"suggestion:e1", "hume-id"}
    assert all(l["payload"]["type"] == "Link" for l in links)
    assert any("Nathaniel" in s for s in skipped) and any("Unknown" in s for s in skipped)


def test_node_index_resolves_targets_from_mobrpg_nodes(tmp_path):
    from mobrpg import node
    (tmp_path / "Locations").mkdir(parents=True)
    sysn = {"world_id": "", "external_ref": "space_game:Locations/Eris System",
            "element_id": "eris-id", "element_kind": "LandFeature",
            "review_state": "accepted", "relationships": [], "languages": []}
    (tmp_path / "Locations/Eris System.md").write_text(
        "---\ntype: location\n" + node.emit_node(sysn) + "---\nBody\n", encoding="utf-8")
    body = {"world_id": "", "external_ref": "space_game:Locations/Eris II",
            "element_id": "eris2-id", "element_kind": "LandFeature", "review_state": "accepted",
            "relationships": [{"predicate": "part_of", "target": "[[Eris System]]",
                               "event_id": "ev9", "review_state": "accepted"}],
            "languages": []}
    (tmp_path / "Locations/Eris II.md").write_text(
        "---\ntype: location\n" + node.emit_node(body) + "---\nBody\n", encoding="utf-8")
    idx, linked = suggest.node_index(str(tmp_path))
    assert idx[suggest._key("Eris System")] == "eris-id"
    assert idx[suggest._key("Eris II")] == "eris2-id"
    # a node relationship already carrying an event_id is treated as already-linked
    assert (suggest._key("Eris II"), "part_of", suggest._key("Eris System")) in linked


def test_relationship_items_structural_predicate_is_a_parent_relation(tmp_path):
    # part_of is spatial hierarchy, not a reified event: it must emit a direct
    # WorldElementRelation (Parent), NOT an Event(eventType=...) — "Parent" is not
    # a valid EventType so the event path would build an invalid payload.
    mp = _map()
    mp["relationshipTypes"] = {"part_of": "Parent"}
    idx, linked = suggest.crosswalk_index(_crosswalk())
    ent = {"path": str(tmp_path / "Locations/Body.md"), "name": "Imogen Bellamy",
           "relationships": [{"target": "Dr_Erasmus_Hume", "predicate": "part_of", "desc": ""}]}
    items, skipped = suggest.relationship_items(ent, mp, "e1", idx, linked,
                                                str(tmp_path), "canticle", "e1")
    assert not any(i["operation"] == "CreateElement" for i in items)   # no reified Event
    rels = [i for i in items if i["operation"] == "AddRelation"]
    assert len(rels) == 1
    assert rels[0]["payload"]["type"] == "Parent"
    assert rels[0]["payload"]["sourceRef"] == "suggestion:e1"          # entity is the child
    assert rels[0]["payload"]["targetRef"] == "hume-id"                # target is the parent


def test_predicate_type_maps_containment_to_relations_and_events():
    from mobrpg.commands import map_cmd
    assert map_cmd.predicate_type("part_of") == "Parent"
    assert map_cmd.predicate_type("member_of") == "Membership"   # still an event
    assert map_cmd.predicate_type("owns") == "Reign"
    assert map_cmd.predicate_type("knows") == "Generic"          # sanctioned, unmapped
    assert "Parent" in map_cmd.RELATION_TYPES and "Membership" not in map_cmd.RELATION_TYPES


def test_predicate_type_covers_sanctioned_spatial_vocabulary():
    """The sanctioned spatial types must resolve to structural relations, not
    Generic events. The map was keyed on observed vault predicates
    (contains/hosts/adjacent_to), so a normalized vault would otherwise push
    every spatial edge as a Generic event."""
    from mobrpg.commands import map_cmd
    assert map_cmd.predicate_type("located_at") == "Parent"
    assert map_cmd.predicate_type("headquartered_at") == "Parent"
    assert map_cmd.predicate_type("borders") == "Link"
    assert map_cmd.predicate_type("spouse_of") == "Spouse"


def test_predicate_type_covers_sanctioned_event_vocabulary():
    """Sanctioned predicates must resolve to named eventTypes rather than
    falling through to Generic. `at_war_with`/`commands`/`rules` are the
    vocabulary forms of predicates the map only knew by off-vocab names."""
    from mobrpg.commands import map_cmd
    assert map_cmd.predicate_type("at_war_with") == "War"
    assert map_cmd.predicate_type("enemy_of") == "War"
    assert map_cmd.predicate_type("commands") == "Leadership"
    assert map_cmd.predicate_type("leads") == "Leadership"
    assert map_cmd.predicate_type("rules") == "Reign"


@pytest.mark.parametrize("predicate", [
    "contains", "hosts", "adjacent_to", "married_to",      # ex-structural aliases
    "led_by", "directed_by", "reign",                      # ex-eventtype aliases
    "charter_house_of", "pattern_echo", "owned_by",        # vault drift
])
def test_predicate_type_rejects_off_vocabulary_predicates(predicate):
    """Off-vocabulary predicates must fail, not resolve. Coercing them (to
    Generic, or via a back-compat alias) is what let vault drift reach mobRPG
    as untyped events — the vault is the thing to fix."""
    from mobrpg.commands import map_cmd
    with pytest.raises(map_cmd.UnknownPredicate):
        map_cmd.predicate_type(predicate)


def test_unknown_predicate_aggregate_lists_every_offender():
    """A drifted vault should be fixable in one pass, so the error names all of
    them rather than dying on the first."""
    from mobrpg.commands import map_cmd
    err = map_cmd.UnknownPredicate.aggregate(["contains", "hosts"])
    assert "contains" in str(err) and "hosts" in str(err) and "2 predicate" in str(err)


def test_every_mapped_predicate_is_in_the_ontology():
    """Guard against the original defect: the tables were keyed on predicates
    observed in vault data rather than on the ontology. Every key in both
    tables must exist in the controlled vocabulary, with no alias escape hatch."""
    from mobrpg.commands import map_cmd
    keys = set(map_cmd.PREDICATE_RELATION) | set(map_cmd.PREDICATE_EVENTTYPE)
    unsanctioned = keys - set(map_cmd.ONTOLOGY_PREDICATES)
    assert not unsanctioned, f"unsanctioned predicates in map: {sorted(unsanctioned)}"


def test_build_group_person_full(tmp_path):
    mp = _map()
    mp["classifiers"]["profession"] = {"Priest": {"mobrpgId": "prof-real"}}
    mp["classifiers"]["sex"] = {"female": {"name": "Female"}}
    mp["relationshipTypes"] = {"friend_of": "Generic"}
    idx = {suggest._key("Nathaniel Rooke"): "rooke-id"}
    ent = {"path": str(tmp_path / "Characters/NPCs/Imogen_Bellamy.md"), "kind": "npc",
           "name": "Imogen Bellamy", "aliases": [], "description": "<p>x</p>",
           "occupation": "Priest", "gender": "Female", "location_type": None,
           "faction_type": None, "creature_type": None,
           "relationships": [{"target": "Nathaniel_Rooke", "predicate": "friend_of", "desc": ""}]}
    items, reports = suggest.build_group(ent, mp, idx, set(), "race-h", str(tmp_path), "canticle", 1)
    assert items[0]["ref"] == "e1" and items[0]["payload"]["data"]["type"] == "Person"
    types = {i["payload"]["data"]["type"] for i in items if i["operation"] == "CreateElement"}
    assert {"Person", "Sex", "Event"} <= types    # profession is bound → no Profession create
    assert all(i["operation"] in ("CreateElement", "AddRelation") for i in items)


def test_chunk_groups_packs_and_never_splits():
    g1 = [{"x": i} for i in range(60)]
    g2 = [{"y": i} for i in range(60)]
    g3 = [{"z": i} for i in range(10)]
    chunks = suggest.chunk_groups([g1, g2, g3], cap=100)
    assert len(chunks) == 2
    assert len(chunks[0]) == 60 and len(chunks[1]) == 70   # g1 | g2+g3
    assert chunks[0] == g1                                 # group kept intact


def test_chunk_groups_oversized_group_errors():
    import pytest
    with pytest.raises(ValueError):
        suggest.chunk_groups([[{"x": i} for i in range(101)]], cap=100)


import json
from mobrpg import client


def test_run_dry_run_end_to_end(tmp_path, monkeypatch, capsys):
    # minimal vault
    d = tmp_path / "vault"
    (d / "Characters/NPCs").mkdir(parents=True)
    (d / "_meta").mkdir(parents=True)
    (d / "Characters/NPCs/Imogen_Bellamy.md").write_text(
        '---\ntype: npc\ntags:\n  - chapter-1\noccupation: "Priest"\ngender: Female\n---\nBody.\n',
        encoding="utf-8")
    (d / "_meta/mobrpg-map.json").write_text(json.dumps(_map()), encoding="utf-8")
    cw = tmp_path / "cw.json"
    cw.write_text(json.dumps(_crosswalk()), encoding="utf-8")

    monkeypatch.setattr(suggest, "discover_race_id", lambda w, t: "race-h")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    def boom(*a, **k):
        raise AssertionError("no write in dry-run")
    monkeypatch.setattr(client, "_request", boom)

    rc = suggest.run(["w1", "--vault", str(d), "--crosswalk", str(cw),
                      "--chapter", "chapter-1", "--out", str(tmp_path / "out")])
    assert rc == 0
    out = capsys.readouterr().out
    assert "DRY-RUN" in out and "Imogen Bellamy" in out


def test_run_namespace_and_label_not_hardcoded_canticle(tmp_path, monkeypatch, capsys):
    # A map missing vaultNamespace must NOT silently fall back to "canticle" —
    # derive it from the vault (basename here) so externalRefs correlate. And the
    # batch label must be derived, not hardcoded "Canticle".
    d = tmp_path / "space_game"
    (d / "Characters/NPCs").mkdir(parents=True)
    (d / "_meta").mkdir(parents=True)
    (d / "Characters/NPCs/Imogen_Bellamy.md").write_text(
        '---\ntype: npc\noccupation: "Priest"\ngender: Female\n---\nBody.\n', encoding="utf-8")
    mp = _map()
    del mp["vaultNamespace"]  # older map without the field
    (d / "_meta/mobrpg-map.json").write_text(json.dumps(mp), encoding="utf-8")
    cw = tmp_path / "cw.json"
    cw.write_text(json.dumps(_crosswalk()), encoding="utf-8")
    monkeypatch.setattr(suggest, "discover_race_id", lambda w, t: "race-h")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    rc = suggest.run(["w1", "--vault", str(d), "--crosswalk", str(cw),
                      "--out", str(tmp_path / "out")])
    assert rc == 0
    out = capsys.readouterr().out
    assert "space_game:Characters/NPCs/Imogen_Bellamy" in out
    assert "space_game suggest" in out
    assert "canticle:" not in out.lower()
    assert "Canticle suggest" not in out


def test_partition_entities_splits_linked_from_netnew():
    # An entity whose name (or an already-known key) resolves to an upstream
    # element id must NOT be re-created; the rest are net-new.
    ents = [{"name": "Imogen Bellamy", "aliases": []},
            {"name": "British Museum", "aliases": []},
            {"name": "Brand New NPC", "aliases": []}]
    ent_id_by_key = {suggest._key("Imogen Bellamy"): "im-id",
                     suggest._key("British Museum"): "bm-id"}
    netnew, linked = suggest.partition_entities(ents, ent_id_by_key)
    assert {e["name"] for e in netnew} == {"Brand New NPC"}
    assert {e["name"] for e in linked} == {"Imogen Bellamy", "British Museum"}


def test_run_skips_already_linked_creates(tmp_path, monkeypatch, capsys):
    # The central fix: `suggest` must NOT re-file an already-upstream entity as a
    # brand-new CreateElement. A note carrying a mobrpg: node with an element_id is
    # already linked; only the genuinely net-new note becomes a CreateElement.
    from mobrpg import node
    d = tmp_path / "space_game"
    (d / "Characters/NPCs").mkdir(parents=True)
    (d / "_meta").mkdir(parents=True)
    linked_node = {"world_id": "", "external_ref": "space_game:Characters/NPCs/Imogen_Bellamy",
                   "element_id": "im-id", "element_kind": "Person", "review_state": "accepted",
                   "relationships": [], "languages": []}
    (d / "Characters/NPCs/Imogen_Bellamy.md").write_text(
        "---\ntype: npc\noccupation: \"Priest\"\ngender: Female\n"
        + node.emit_node(linked_node) + "---\nBody.\n", encoding="utf-8")
    (d / "Characters/NPCs/Brand_New.md").write_text(
        '---\ntype: npc\noccupation: "Priest"\ngender: Female\n---\nBody.\n', encoding="utf-8")
    (d / "_meta/mobrpg-map.json").write_text(json.dumps(_map()), encoding="utf-8")
    cw = tmp_path / "cw.json"
    cw.write_text(json.dumps({"entities": [], "relationships": []}), encoding="utf-8")

    monkeypatch.setattr(suggest, "discover_race_id", lambda w, t: "race-h")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")

    rc = suggest.run(["w1", "--vault", str(d), "--crosswalk", str(cw),
                      "--out", str(tmp_path / "out")])
    assert rc == 0
    out = capsys.readouterr().out
    # net-new is created; already-linked is not re-created
    assert "CreateElement" in out and "Brand New" in out
    assert "Imogen Bellamy" not in out.split("skip")[0]  # not in the create summary
    # a batch JSON was written — assert Imogen has NO CreateElement item anywhere
    batch = json.load(open(tmp_path / "out" / "suggest-batch-1.json"))
    created = [it["payload"]["name"] for it in batch["suggestions"]
               if it.get("operation") == "CreateElement"]
    assert "Brand New" in created
    assert "Imogen Bellamy" not in created
    # and the run reports the linked entity was skipped
    assert "1" in out and "linked" in out.lower()


def test_determined_for_person_and_locations():
    mp = _map()
    mp["classifiers"]["profession"] = {"Priest": {"mobrpgId": "p1", "name": "Priest"}}
    mp["classifiers"]["sex"] = {"female": {"name": "Female"}}
    person = {"kind": "npc", "occupation": "Priest, cultist", "gender": "Female",
              "location_type": None, "faction_type": None, "creature_type": None}
    assert suggest.determined_for(person, mp) == {
        "profession": "Priest", "race": "Human", "sex": "Female"}

    built = {"kind": "location", "location_type": "Museum"}
    assert suggest.determined_for(built, mp) == {"political_type": "Museum"}
    natural = {"kind": "location", "location_type": "River"}
    assert suggest.determined_for(natural, mp) == {"land_feature_type": "River"}

    item = {"kind": "item"}
    assert suggest.determined_for(item, mp) == {"item_type": "Generic"}


import os as _os
from mobrpg import node as _node


def test_build_node_person(tmp_path):
    mp = _map()
    mp["classifiers"]["sex"] = {"female": {"name": "Female"}}
    ent = {"path": str(tmp_path / "Characters/NPCs/Imogen_Bellamy.md"), "kind": "npc",
           "name": "Imogen Bellamy", "aliases": ["Bells"], "description": "<p>x</p>",
           "occupation": "Priest", "gender": "Female", "location_type": None,
           "faction_type": None, "creature_type": None,
           "relationships": [{"target": "Nathaniel_Rooke", "predicate": "friend_of", "desc": ""}]}
    n = suggest.build_node(ent, mp, "canticle", str(tmp_path))
    assert n["external_ref"] == "canticle:Characters/NPCs/Imogen_Bellamy"
    assert n["element_id"] is None and n["review_state"] == "pending"
    assert n["element_kind"] == "Person"
    assert n["determined"] == {"profession": "Priest", "race": "Human", "sex": "Female"}
    assert n["relationships"][0] == {
        "predicate": "friend_of", "target": "Nathaniel_Rooke",
        "event_type": "Generic", "event_id": None, "review_state": "pending"}
    assert n["content_hash"].startswith("sha256:")


def test_write_back_writes_then_skips(tmp_path):
    mp = _map()
    d = tmp_path
    (d / "Characters/NPCs").mkdir(parents=True)
    f = d / "Characters/NPCs/Imogen_Bellamy.md"
    f.write_text('---\ntype: npc\noccupation: "Priest"\n---\nBody.\n', encoding="utf-8")
    ents = suggest.collect_entities(str(d), only="imogen")
    w, s = suggest.write_back(ents, mp, str(d), "canticle", execute=True)
    assert (w, s) == (1, 0)
    assert _node.read_node(f.read_text())["review_state"] == "pending"
    # second pass: unchanged content → skip, file untouched
    before = f.read_text()
    w2, s2 = suggest.write_back(suggest.collect_entities(str(d), only="imogen"),
                               mp, str(d), "canticle", execute=True)
    assert (w2, s2) == (0, 1)
    assert f.read_text() == before


def test_write_back_preserves_accepted_link_on_content_edit(tmp_path):
    """Editing an already-ratified note must not wipe its canon link.

    Regression: write_back rebuilt the node with build_node's defaults
    (element_id=None, review_state="pending"), so any payload-affecting vault
    edit silently destroyed an accepted element_id and reset the state.
    """
    mp = _map()
    d = tmp_path
    (d / "Characters/NPCs").mkdir(parents=True)
    f = d / "Characters/NPCs/Imogen_Bellamy.md"
    f.write_text('---\ntype: npc\noccupation: "Priest"\n---\nBody.\n', encoding="utf-8")

    # Establish the node, then ratify it the way pull-canon would.
    suggest.write_back(suggest.collect_entities(str(d), only="imogen"),
                       mp, str(d), "canticle", execute=True)
    n = _node.read_node(f.read_text())
    n["element_id"], n["review_state"] = "E-123", "accepted"
    f.write_text(_node.write_node(f.read_text(), n), encoding="utf-8")

    # GM edits payload-affecting content (occupation → new determined profession).
    f.write_text(f.read_text().replace('occupation: "Priest"',
                                        'occupation: "Linguist"'), encoding="utf-8")

    w, s = suggest.write_back(suggest.collect_entities(str(d), only="imogen"),
                              mp, str(d), "canticle", execute=True)
    assert (w, s) == (1, 0)                       # content changed → rewritten
    after = _node.read_node(f.read_text())
    assert after["element_id"] == "E-123"         # link preserved (was wiped to None)
    assert after["review_state"] == "accepted"    # not reset to "pending"

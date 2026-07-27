"""Person↔group affiliation events must match mobRPG's own construct.

mobRPG never asks a user to pick an eventType. The GUI hangs tabs off an
element and derives the type from which tab you were on: Reign/Employ live on a
Political element, Leadership/Membership on an Organization
(`site/src/component/world/elements/info/{person,political,organization}-info.tsx`),
and `formatEventName` in `site/src/helpers/event.helper.ts` names the result
"{Person}, {title} of|at {Group}".

Our flat predicate→eventType table knew nothing about what an edge pointed AT,
so the Space world ended up holding both conventions side by side:

    Tim's:  Opeyemi Tichá, Boss of Thides Serene Syndicate    (Leadership)
            Julija Borja, Marshal at MacMillian Station VI    (Employ)
    Ours:   Marek Solano, serves Corvid Financial             (Employ @ an Organization)
            Corvid Financial, employs Marek Solano            (subject backwards)
"""
import pytest

from mobrpg.commands import map_cmd
from mobrpg.commands import suggest


def _map():
    return {"kinds": {}, "classifiers": {}, "locationRouting": {}}


# --------------------------------------------------------------------------
# map_cmd.affiliation — the 2x2 grid
# --------------------------------------------------------------------------

@pytest.mark.parametrize("predicate,group_kind,expected", [
    # a person who runs the thing
    ("rules", "Political", "Reign"),
    ("owns", "Political", "Reign"),
    ("leads", "Organization", "Leadership"),
    # a person who belongs to the thing
    ("serves", "Political", "Employ"),
    ("member_of", "Organization", "Membership"),
    ("founded", "Organization", "Membership"),
    # the cases the flat table got wrong: same predicate, other kind of target
    ("serves", "Organization", "Membership"),
    ("member_of", "Political", "Employ"),
    ("leads", "Political", "Reign"),
    ("owns", "Organization", "Leadership"),
])
def test_affiliation_resolves_from_the_group_kind(predicate, group_kind, expected):
    assert map_cmd.affiliation(predicate, "Person", group_kind) == (expected, True)


def test_affiliation_inverts_the_stance_when_the_person_is_the_object():
    # "Corvid Financial employs Marek Solano" makes the PERSON the subordinate,
    # so it is the same event as "Marek Solano serves Corvid Financial".
    assert map_cmd.affiliation("employs", "Organization", "Person") == ("Membership", False)
    assert map_cmd.affiliation("serves", "Person", "Organization") == ("Membership", True)


def test_affiliation_declines_edges_that_are_not_person_to_group():
    assert map_cmd.affiliation("owns", "Organization", "Political") is None   # org owns a venue
    assert map_cmd.affiliation("member_of", "Person", "Person") is None
    assert map_cmd.affiliation("serves", "Person", "Item") is None
    assert map_cmd.affiliation("knows", "Person", "Organization") is None     # no stance


def test_event_types_for_kind_lists_what_the_gui_offers():
    assert map_cmd.event_types_for_kind("Political") == ["Employ", "Reign"]
    assert map_cmd.event_types_for_kind("Organization") == ["Leadership", "Membership"]
    assert map_cmd.event_types_for_kind("Item") == []


def test_a_regraded_edge_is_reported_with_the_reason(tmp_path):
    """`Alphonse member_of Station 45` regrades to Employ because Station 45 is
    authored as a location and mobRPG has no "member of a Political". The grid is
    right about mobRPG; the vault may be wrong about Station 45 — so say which."""
    ent = {"path": str(tmp_path / "Characters/NPCs/Alphonse.md"),
           "name": "Alphonse", "kind": "npc",
           "relationships": [{"target": "[[Station 45]]", "predicate": "member_of",
                              "desc": ""}]}
    idx = {suggest._key("Station 45"): "s45-id"}
    kinds = {suggest._key("Alphonse"): "Person",
             suggest._key("Station 45"): "Political"}
    items, reports = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Employ"
    assert any("Membership -> Employ" in r and "Political" in r for r in reports)


def test_an_unchanged_grid_result_is_not_reported(tmp_path):
    ent = {"path": str(tmp_path / "Characters/NPCs/Yael Corrin.md"),
           "name": "Yael Corrin", "kind": "npc",
           "relationships": [{"target": "[[Castellan Biodynamics]]",
                              "predicate": "member_of", "desc": ""}]}
    idx = {suggest._key("Castellan Biodynamics"): "cb-id"}
    kinds = {suggest._key("Yael Corrin"): "Person",
             suggest._key("Castellan Biodynamics"): "Organization"}
    _, reports = _rel_items(tmp_path, ent, idx, kinds)
    assert reports == []


def test_person_stance_predicates_are_all_in_the_ontology():
    # The stance table is keyed on the controlled vocabulary, like every other
    # predicate table here — a key that drifts out of it would silently stop
    # matching and fall back to the flat map.
    assert set(map_cmd._PERSON_STANCE) <= set(map_cmd.ONTOLOGY_PREDICATES)


def test_affiliation_naming_matches_formatEventName():
    # Defaults and prepositions are mobRPG's, not ours — event.helper.ts.
    assert map_cmd.AFFILIATION_NAMING == {
        "Reign": ("Owner", "of"),
        "Employ": ("Employment", "at"),
        "Membership": ("Member", "of"),
        "Leadership": ("Leader", "of"),
    }


# --------------------------------------------------------------------------
# suggest.relationship_items — emission
# --------------------------------------------------------------------------

def _rel_items(tmp_path, ent, idx, kinds, mp=None):
    return suggest.relationship_items(
        ent, mp or _map(), "e1", idx, set(), str(tmp_path), "space_game", "e1",
        kind_by_key=kinds)


def test_serves_an_organization_emits_membership_not_employ(tmp_path):
    ent = {"path": str(tmp_path / "Characters/NPCs/Marek Solano.md"),
           "name": "Marek Solano", "kind": "npc",
           "relationships": [{"target": "[[Corvid Financial]]", "predicate": "serves",
                              "desc": "Recovery agent on contract."}]}
    idx = {suggest._key("Corvid Financial"): "corvid-id"}
    kinds = {suggest._key("Marek Solano"): "Person",
             suggest._key("Corvid Financial"): "Organization"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Membership"
    assert ev["payload"]["name"] == "Marek Solano, Member of Corvid Financial"


def test_serves_a_political_still_emits_employ(tmp_path):
    ent = {"path": str(tmp_path / "Characters/NPCs/Yael Corrin.md"),
           "name": "Yael Corrin", "kind": "npc",
           "relationships": [{"target": "[[Castellan Station]]", "predicate": "serves",
                              "desc": ""}]}
    idx = {suggest._key("Castellan Station"): "castellan-id"}
    kinds = {suggest._key("Yael Corrin"): "Person",
             suggest._key("Castellan Station"): "Political"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Employ"
    assert ev["payload"]["name"] == "Yael Corrin, Employment at Castellan Station"


def test_org_subject_edge_names_the_person_first(tmp_path):
    # "Corvid Financial, employs Marek Solano" led with the organization; mobRPG's
    # naming always leads with the person, and the reviewer's direction inference
    # (foldReifiedEvents) reads the object off the name's tail token.
    ent = {"path": str(tmp_path / "Factions & Organizations/Corvid Financial.md"),
           "name": "Corvid Financial", "kind": "faction",
           "relationships": [{"target": "[[Marek Solano]]", "predicate": "employs",
                              "desc": ""}]}
    idx = {suggest._key("Marek Solano"): "marek-id"}
    kinds = {suggest._key("Corvid Financial"): "Organization",
             suggest._key("Marek Solano"): "Person"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Membership"
    assert ev["payload"]["name"] == "Marek Solano, Member of Corvid Financial"


def test_external_ref_identity_is_unchanged_by_the_naming(tmp_path):
    # The rel/ externalRef is the edge's identity across re-pushes; renaming the
    # event must not re-key it, or every affiliation would re-file as net-new.
    ent = {"path": str(tmp_path / "Characters/NPCs/Marek Solano.md"),
           "name": "Marek Solano", "kind": "npc",
           "relationships": [{"target": "[[Corvid Financial]]", "predicate": "serves",
                              "desc": ""}]}
    idx = {suggest._key("Corvid Financial"): "corvid-id"}
    kinds = {suggest._key("Marek Solano"): "Person",
             suggest._key("Corvid Financial"): "Organization"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["externalRef"] == (
        "space_game:rel/Characters/NPCs/Marek Solano/serves/corvidfinancial")


def test_unknown_target_kind_falls_back_to_the_flat_map(tmp_path):
    # Degrade to today's behaviour rather than guess: a target outside the kind
    # index (filtered out of this run) keeps the ontology's predicate mapping.
    ent = {"path": str(tmp_path / "Characters/NPCs/Someone.md"),
           "name": "Someone", "kind": "npc",
           "relationships": [{"target": "[[Mystery Group]]", "predicate": "serves",
                              "desc": ""}]}
    idx = {suggest._key("Mystery Group"): "mystery-id"}
    kinds = {suggest._key("Someone"): "Person"}     # index built, target absent from it
    items, reports = _rel_items(tmp_path, ent, idx, kinds)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Employ"          # ontology default
    assert ev["payload"]["name"] == "Someone, serves Mystery Group"
    assert any("Mystery Group" in r for r in reports)              # and it says so


def test_a_map_entry_restating_the_ontology_default_is_not_an_override(tmp_path):
    # `map init`/`map sync` write an entry for every predicate they discover, so
    # a real vault maps all of them (space_game: 25 of 25, `serves: Employ`
    # among them). Reading any entry as a human override would make the whole
    # grid dead code on every vault that has ever run `map`.
    mp = _map()
    mp["relationshipTypes"] = {"serves": "Employ"}       # == the ontology default
    ent = {"path": str(tmp_path / "Characters/NPCs/Marek Solano.md"),
           "name": "Marek Solano", "kind": "npc",
           "relationships": [{"target": "[[Corvid Financial]]", "predicate": "serves",
                              "desc": ""}]}
    idx = {suggest._key("Corvid Financial"): "corvid-id"}
    kinds = {suggest._key("Marek Solano"): "Person",
             suggest._key("Corvid Financial"): "Organization"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds, mp=mp)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Membership"


def test_map_relationship_type_override_still_wins(tmp_path):
    mp = _map()
    mp["relationshipTypes"] = {"serves": "Generic"}       # differs -> a real decision
    ent = {"path": str(tmp_path / "Characters/NPCs/Marek Solano.md"),
           "name": "Marek Solano", "kind": "npc",
           "relationships": [{"target": "[[Corvid Financial]]", "predicate": "serves",
                              "desc": ""}]}
    idx = {suggest._key("Corvid Financial"): "corvid-id"}
    kinds = {suggest._key("Marek Solano"): "Person",
             suggest._key("Corvid Financial"): "Organization"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds, mp=mp)
    ev = [i for i in items if i["operation"] == "CreateElement"][0]
    assert ev["payload"]["data"]["eventType"] == "Generic"


def test_structural_predicates_are_untouched(tmp_path):
    ent = {"path": str(tmp_path / "Locations/Nova Nexus.md"),
           "name": "Nova Nexus", "kind": "location",
           "relationships": [{"target": "[[Entertainment District]]",
                              "predicate": "part_of", "desc": ""}]}
    idx = {suggest._key("Entertainment District"): "district-id"}
    kinds = {suggest._key("Nova Nexus"): "Political",
             suggest._key("Entertainment District"): "Political"}
    items, _ = _rel_items(tmp_path, ent, idx, kinds)
    assert not any(i["operation"] == "CreateElement" for i in items)
    rel = [i for i in items if i["operation"] == "AddRelation"][0]
    assert rel["payload"]["type"] == "Link"
    assert rel["payload"]["sourceRef"] == "district-id"       # container first


# --------------------------------------------------------------------------
# duplicate affiliation collapse
# --------------------------------------------------------------------------

def _affiliation_group(tmp_path, ent, idx, kinds, seq):
    return suggest.build_group(ent, _map(), idx, set(), None, str(tmp_path),
                               "space_game", seq, None, kinds)[0]


def test_both_authored_halves_collapse_to_one_event(tmp_path):
    # The vault holds the same affiliation twice — `Marek serves Corvid` on the
    # person and `Corvid employs Marek` on the organization — and both landed in
    # Tim's world as separate Employ events on the 2026-07-20 push.
    kinds = {suggest._key("Marek Solano"): "Person",
             suggest._key("Corvid Financial"): "Organization"}
    idx = {}
    person = {"path": str(tmp_path / "Characters/NPCs/Marek Solano.md"),
              "name": "Marek Solano", "kind": "npc", "aliases": [],
              "relationships": [{"target": "[[Corvid Financial]]", "predicate": "serves",
                                 "desc": ""}]}
    org = {"path": str(tmp_path / "Factions & Organizations/Corvid Financial.md"),
           "name": "Corvid Financial", "kind": "faction", "aliases": [],
           "relationships": [{"target": "[[Marek Solano]]", "predicate": "employs",
                              "desc": ""}]}
    ref_by_key = {suggest._key("Marek Solano"): "e1",
                  suggest._key("Corvid Financial"): "e2"}
    groups = [
        suggest.build_group(person, _map(), idx, set(), None, str(tmp_path),
                            "space_game", 1, ref_by_key, kinds)[0],
        suggest.build_group(org, _map(), idx, set(), None, str(tmp_path),
                            "space_game", 2, ref_by_key, kinds)[0],
    ]
    events = [i for g in groups for i in g
              if i["payload"].get("data", {}).get("type") == "Event"]
    assert len(events) == 2                       # both halves emitted...
    groups, reports = suggest.dedupe_affiliation_events(groups, ["e1", "e2"])
    kept = [i for g in groups for i in g
            if i["payload"].get("data", {}).get("type") == "Event"]
    assert len(kept) == 1                          # ...one survives
    assert kept[0]["payload"]["name"] == "Marek Solano, Member of Corvid Financial"
    assert any("duplicate Membership" in r for r in reports)
    # the dropped event's Link items go with it — no dangling refs
    dead = "suggestion:e2v0"
    assert not any(i["payload"].get("sourceRef") == dead
                   or i["payload"].get("targetRef") == dead
                   for g in groups for i in g)


def test_generic_events_between_the_same_pair_both_survive(tmp_path):
    # eventType Generic says nothing, so `knows` and `trusts` between the same
    # two people are two facts, not one duplicated fact.
    kinds = {suggest._key("A"): "Person", suggest._key("B"): "Person"}
    ent = {"path": str(tmp_path / "Characters/NPCs/A.md"), "name": "A",
           "kind": "npc", "aliases": [],
           "relationships": [{"target": "[[B]]", "predicate": "knows", "desc": ""},
                             {"target": "[[B]]", "predicate": "trusts", "desc": ""}]}
    groups = [_affiliation_group(tmp_path, ent, {suggest._key("B"): "b-id"}, kinds, 1)]
    groups, reports = suggest.dedupe_affiliation_events(groups, ["e1"])
    kept = [i for g in groups for i in g
            if i["payload"].get("data", {}).get("type") == "Event"]
    assert len(kept) == 2 and reports == []


# --------------------------------------------------------------------------
# the kind index
# --------------------------------------------------------------------------

def test_node_kind_index_reads_canon_kinds_and_aliases(tmp_path):
    from mobrpg import node
    (tmp_path / "Factions & Organizations").mkdir(parents=True)
    nd = {"world_id": "", "external_ref": "space_game:Factions & Organizations/Corvid Financial",
          "element_id": "corvid-id", "element_kind": "Organization",
          "review_state": "accepted", "relationships": [], "languages": []}
    (tmp_path / "Factions & Organizations/Corvid Financial.md").write_text(
        '---\ntype: faction\naliases: ["Corvid"]\n' + node.emit_node(nd) + "---\nBody\n",
        encoding="utf-8")
    kinds = suggest.node_kind_index(str(tmp_path))
    assert kinds[suggest._key("Corvid Financial")] == "Organization"
    assert kinds[suggest._key("Corvid")] == "Organization"

"""Net-new relationship targets wire via in-batch suggestion refs, and the
co-location chunker keeps a source group and its net-new target group in the
same <=cap batch so `suggestion:<ref>` resolves. Oversized components split and
defer the spanning edges rather than emit an unresolvable cross-batch ref."""
import pytest
from mobrpg.commands import suggest


def _map():
    return {"vaultNamespace": "space_game",
            "kinds": {"npc": "person", "location": "political", "faction": "organization",
                      "item": "item"},
            "locationRouting": {}, "classifiers": {},
            "relationshipTypes": {}}


# ---- relationship_items: net-new target resolution ----

def test_structural_netnew_target_wires_to_suggestion_ref(tmp_path):
    mp = _map()
    ref_by_key = {suggest._key("Eris System"): "e7"}
    ent = {"path": str(tmp_path / "Locations/Eris II.md"), "name": "Eris II",
           "relationships": [{"target": "Eris System", "predicate": "part_of", "desc": ""}]}
    items, skipped = suggest.relationship_items(
        ent, mp, "e1", {}, set(), str(tmp_path), "space_game", "e1", ref_by_key)
    assert skipped == []
    rels = [i for i in items if i["operation"] == "AddRelation"]
    assert len(rels) == 1
    r = rels[0]
    assert r["payload"]["type"] == "Link"                  # part_of -> Link
    # container-first: Eris System (the net-new container) is the source
    assert r["payload"]["sourceRef"] == "suggestion:e7"
    assert r["payload"]["targetRef"] == "suggestion:e1"
    assert set(r["dependsOn"]) == {"e1", "e7"}
    assert r["_needs"] == "e7"                              # co-location marker for the chunker


def test_reified_event_netnew_target_tags_whole_unit(tmp_path):
    mp = _map(); mp["relationshipTypes"] = {"employs": "Employ"}
    ref_by_key = {suggest._key("Fei-Hung"): "e9"}
    ent = {"path": str(tmp_path / "Characters/NPCs/Opeyemi.md"), "name": "Opeyemi",
           "relationships": [{"target": "Fei-Hung", "predicate": "employs", "desc": "hires"}]}
    items, skipped = suggest.relationship_items(
        ent, mp, "e1", {}, set(), str(tmp_path), "space_game", "e1", ref_by_key)
    assert skipped == []
    # the whole reified unit (Event create + both Links) is tagged so it defers together
    assert items and all(i.get("_needs") == "e9" for i in items)
    tgt_links = [i for i in items if i["operation"] == "AddRelation"
                 and i["payload"]["targetRef"] == "suggestion:e9"]
    assert len(tgt_links) == 1 and "e9" in tgt_links[0]["dependsOn"]


def test_upstream_target_unchanged_and_untagged(tmp_path):
    mp = _map()
    idx = {suggest._key("Eris System"): "real-eris-id"}
    ref_by_key = {suggest._key("Eris System"): "e7"}       # also present net-new — real id wins
    ent = {"path": str(tmp_path / "Locations/Eris II.md"), "name": "Eris II",
           "relationships": [{"target": "Eris System", "predicate": "part_of", "desc": ""}]}
    items, skipped = suggest.relationship_items(
        ent, mp, "e1", idx, set(), str(tmp_path), "space_game", "e1", ref_by_key)
    r = [i for i in items if i["operation"] == "AddRelation"][0]
    # container-first: the upstream container resolves to its real id as the source
    assert r["payload"]["sourceRef"] == "real-eris-id"
    assert r["payload"]["targetRef"] == "suggestion:e1"
    assert "_needs" not in r and r["dependsOn"] == ["e1"]


def test_genuinely_unresolvable_target_still_skips(tmp_path):
    mp = _map(); mp["relationshipTypes"] = {"knows": "Generic"}
    ent = {"path": str(tmp_path / "x/A.md"), "name": "A",
           "relationships": [{"target": "Ghost", "predicate": "knows", "desc": ""}]}
    items, skipped = suggest.relationship_items(
        ent, mp, "e1", {}, set(), str(tmp_path), "ns", "e1", {})
    assert items == [] and any("Ghost" in s for s in skipped)


# ---- co-location chunker ----

def _grp(ref, filler=0, needs=None):
    g = [{"ref": ref, "operation": "CreateElement"}] + [{"pad": i} for i in range(filler)]
    if needs:
        g.append({"operation": "AddRelation",
                  "payload": {"targetRef": f"suggestion:{needs}", "type": "Parent"},
                  "dependsOn": [ref, needs], "_needs": needs})
    return g


def test_chunker_keeps_source_and_target_together_no_defer():
    g1 = _grp("e1", needs="e2")
    g2 = _grp("e2")
    chunks, deferred = suggest.chunk_groups_colocated([g1, g2], ["e1", "e2"], cap=100)
    assert len(chunks) == 1              # co-located in one batch
    assert deferred == []
    assert all("_needs" not in it for c in chunks for it in c)   # marker stripped from output


def test_chunker_defers_spanning_edge_when_component_exceeds_cap():
    # e1 (60 items incl. edge->e2) + e2 (60 items) = 120 > cap -> split -> edge defers
    g1 = _grp("e1", filler=58, needs="e2")   # 1 + 58 + 1 = 60
    g2 = _grp("e2", filler=59)               # 1 + 59      = 60
    chunks, deferred = suggest.chunk_groups_colocated([g1, g2], ["e1", "e2"], cap=100)
    assert len(chunks) == 2
    assert ("e1", "e2") in deferred
    flat = [it for c in chunks for it in c]
    # no dangling cross-batch suggestion ref survived
    assert not any(it.get("payload", {}).get("targetRef") == "suggestion:e2" for it in flat)
    assert all("_needs" not in it for it in flat)


def test_chunker_oversized_single_group_errors():
    with pytest.raises(ValueError):
        suggest.chunk_groups_colocated([[{"x": i} for i in range(101)]], ["e1"], cap=100)


def test_chunker_defers_unknown_target_ref_rather_than_keep_it():
    # a _needs ref that names no known group must be dropped (safe-defer), never
    # shipped as an unresolvable cross-batch suggestion ref.
    g1 = [{"ref": "e1", "operation": "CreateElement"},
          {"operation": "AddRelation",
           "payload": {"targetRef": "suggestion:e99", "type": "Parent"},
           "dependsOn": ["e1", "e99"], "_needs": "e99"}]
    chunks, deferred = suggest.chunk_groups_colocated([g1], ["e1"], cap=100)
    flat = [it for c in chunks for it in c]
    assert not any(it.get("payload", {}).get("targetRef") == "suggestion:e99" for it in flat)
    assert ("e1", "e99") in deferred


def test_chunker_three_way_component_stays_whole():
    # e1->e3, e2->e3 : all three must share a batch
    g1 = _grp("e1", needs="e3")
    g2 = _grp("e2", needs="e3")
    g3 = _grp("e3")
    chunks, deferred = suggest.chunk_groups_colocated([g1, g2, g3], ["e1", "e2", "e3"], cap=100)
    assert len(chunks) == 1 and deferred == []


# ---- dedupe_type_creates: one create per shared classifier type ----

def _type_create(ref, name, etype="Profession"):
    return {"ref": ref, "operation": "CreateElement",
            "payload": {"operation": "CreateElement", "name": name,
                        "data": {"type": etype}}, "dependsOn": []}

def _entity_create(ref, name):  # entities carry an externalRef; types never do
    return {"ref": ref, "operation": "CreateElement",
            "payload": {"operation": "CreateElement", "name": name, "data": {"type": "Person"}},
            "dependsOn": [], "externalRef": f"space_game:{name}"}

def _attr(src, tgt, depends):
    return {"operation": "AddRelation",
            "payload": {"operation": "AddRelation", "sourceRef": src, "targetRef": tgt,
                        "type": "Attribute"}, "dependsOn": list(depends)}


def test_dedupe_collapses_a_shared_type_to_one_create():
    # Two entities both mint "Station 45 Gang Member": one create must survive, the
    # borrower's Attribute edge re-points at it, and the borrower co-locates with the
    # owner so the in-batch suggestion ref resolves.
    g1 = [_entity_create("e2", "Alphonse"),
          _type_create("e2t0", "Station 45 Gang Member"),
          _attr("suggestion:e2t0", "suggestion:e2", ["e2t0", "e2"])]
    g2 = [_entity_create("e5", "Gio"),
          _type_create("e5t0", "Station 45 Gang Member"),
          _attr("suggestion:e5t0", "suggestion:e5", ["e5t0", "e5"])]
    groups, refs = suggest.dedupe_type_creates([g1, g2], ["e2", "e5"])
    creates = [it for g in groups for it in g
               if it["operation"] == "CreateElement" and "externalRef" not in it]
    assert len(creates) == 1 and creates[0]["ref"] == "e2t0"     # survivor is the first
    # Gio's Attribute edge now points at the survivor and needs the owner group
    gio_attr = next(it for it in groups[1] if it["operation"] == "AddRelation")
    assert gio_attr["payload"]["sourceRef"] == "suggestion:e2t0"
    assert "e5t0" not in gio_attr["dependsOn"] and "e2t0" in gio_attr["dependsOn"]
    assert gio_attr["_needs"] == "e2"
    # and the whole thing chunks into ONE valid batch (survivor co-located)
    chunks, deferred = suggest.chunk_groups_colocated(groups, refs, cap=100)
    assert deferred == []
    flat = [it for c in chunks for it in c]
    srcs = {it["payload"].get("sourceRef") for it in flat if it["operation"] == "AddRelation"}
    assert srcs == {"suggestion:e2t0"}                            # no dangling e5t0


def test_dedupe_keeps_distinct_types_and_entities():
    # different type names, and entity creates (which carry externalRef), are untouched.
    g1 = [_entity_create("e1", "A"), _type_create("e1t0", "Enforcer")]
    g2 = [_entity_create("e2", "B"), _type_create("e2t0", "Assassin")]
    groups, _ = suggest.dedupe_type_creates([g1, g2], ["e1", "e2"])
    creates = [it for g in groups for it in g if it["operation"] == "CreateElement"]
    assert len(creates) == 4                                       # nothing collapsed


def test_attach_classifier_recleans_a_stale_dirty_map_name():
    # The pushed CreateElement name comes from the map entry, which may predate
    # sanitization or have been hand-edited. The emission path must re-clean it, or
    # markup reaches mobRPG and a clean/dirty pair fails to dedupe.
    section = {"recovery agent (contracted to [[corvid financial]])": {
        "target": "person/profession",
        "name": "Recovery Agent (Contracted To [[Corvid Financial]])",  # stale dirty name
        "mobrpgId": None, "status": "new"}}
    items, _ = suggest._attach_classifier(
        section, "Recovery agent (contracted to [[Corvid Financial]])",
        "Profession", "e1", "e1t0")
    create = next(it for it in items if it["operation"] == "CreateElement")
    name = create["payload"]["name"]
    assert "[[" not in name and "(" not in name, f"leaked: {name!r}"
    assert name == "Recovery Agent"


def test_dedupe_leaves_a_relationship_needs_untouched():
    # A relationship edge already carries `_needs` for its net-new target. Dedup only
    # repoints edges that reference a removed *type* ref, so a relationship edge (whose
    # source/target are entity/event refs, never a type ref) must keep its own `_needs`.
    rel_edge = {"operation": "AddRelation",
                "payload": {"operation": "AddRelation", "sourceRef": "suggestion:e1",
                            "targetRef": "suggestion:e9", "type": "Link"},
                "dependsOn": ["e1", "e9"], "_needs": "e9"}
    g1 = [_entity_create("e1", "A"), _type_create("e1t0", "Guild", "OrganizationType"),
          _attr("suggestion:e1t0", "suggestion:e1", ["e1t0", "e1"]), rel_edge]
    g2 = [_entity_create("e2", "B"), _type_create("e2t0", "Guild", "OrganizationType"),
          _attr("suggestion:e2t0", "suggestion:e2", ["e2t0", "e2"])]
    groups, _ = suggest.dedupe_type_creates([g1, g2], ["e1", "e2"])
    survived = next(it for it in groups[0]
                    if it["operation"] == "AddRelation" and it["payload"].get("targetRef") == "suggestion:e9")
    assert survived["_needs"] == "e9"   # relationship co-location constraint intact


def test_dedupe_three_entities_share_one_type():
    g = lambda n: [_entity_create(f"e{n}", f"N{n}"), _type_create(f"e{n}t0", "Territory", "PoliticalType"),
                   _attr(f"suggestion:e{n}t0", f"suggestion:e{n}", [f"e{n}t0", f"e{n}"])]
    groups, refs = suggest.dedupe_type_creates([g(1), g(2), g(3)], ["e1", "e2", "e3"])
    creates = [it for gg in groups for it in gg if it["operation"] == "CreateElement" and "externalRef" not in it]
    assert len(creates) == 1 and creates[0]["ref"] == "e1t0"
    chunks, deferred = suggest.chunk_groups_colocated(groups, refs, cap=100)
    assert deferred == [] and len(chunks) == 1


def test_dedupe_repoints_a_type_referenced_as_target():
    # a Sex-style edge references the type as TARGET (race -> sex); repoint that too.
    g1 = [_entity_create("e1", "A"), _type_create("e1t0", "Female", "Sex"),
          _attr("race", "suggestion:e1t0", ["e1t0"])]
    g2 = [_entity_create("e2", "B"), _type_create("e2t0", "Female", "Sex"),
          _attr("race", "suggestion:e2t0", ["e2t0"])]
    groups, _ = suggest.dedupe_type_creates([g1, g2], ["e1", "e2"])
    edge = next(it for it in groups[1] if it["operation"] == "AddRelation")
    assert edge["payload"]["targetRef"] == "suggestion:e1t0" and edge["_needs"] == "e1"


# ---- collect_entities: skip non-entity sidecar notes (character-story) ----

def test_collect_entities_exclude_kinds(tmp_path):
    (tmp_path / "Characters/PCs").mkdir(parents=True)
    (tmp_path / "Characters/NPCs").mkdir(parents=True)
    (tmp_path / "Characters/PCs/Six.md").write_text("---\ntype: pc\n---\nB\n", encoding="utf-8")
    (tmp_path / "Characters/NPCs/Bob.md").write_text("---\ntype: npc\n---\nB\n", encoding="utf-8")
    names = {e["name"] for e in suggest.collect_entities(str(tmp_path), exclude_kinds={"pc"})}
    assert "Bob" in names and "Six" not in names
    # default (no exclusion) still collects PCs
    assert "Six" in {e["name"] for e in suggest.collect_entities(str(tmp_path))}


def test_strip_boilerplate_import_placeholder_and_comments():
    from mobrpg import md
    # the "imported as a named entity" stub reduces to empty
    s = "\n\n## Overview\n\n*(No description in mobRPG yet — imported as a named entity.)*\n\n## History\n"
    out = md.strip_boilerplate(s)
    assert "No description" not in out
    # import-provenance comment stripped, real prose kept
    s2 = "Real lore here.\n<!-- Imported from Tim's mobRPG 'Space' world. -->\n"
    out2 = md.strip_boilerplate(s2)
    assert "Real lore here." in out2 and "Imported from Tim" not in out2
    # gm-only blocks are removed ENTIRELY (content must never leak into a push)
    s3 = "Public.\n<!-- gm-only -->\nSECRET twist.\n<!-- /gm-only -->\nMore public."
    out3 = md.strip_boilerplate(s3)
    assert "Public." in out3 and "More public." in out3 and "SECRET" not in out3


def test_placeholder_only_description_is_empty_in_both_paths(tmp_path):
    from mobrpg.commands import suggest, suggest_desc
    body = "\n\n## Overview\n\n*(No description in mobRPG yet — imported as a named entity.)*\n\n## History\n"
    # entity push: a placeholder-only body yields the empty stub, not the placeholder text
    assert suggest._description(body) == "<p></p>"
    # suggest-desc: placeholder-only vault prose is no-prose (never suggested up), even vs an empty element
    is_cand, reason = suggest_desc.classify_candidate(suggest_desc.vault_html(body), "")
    assert is_cand is False and reason == "no-prose"


def test_collect_entities_provenance_filter(tmp_path):
    npcs = tmp_path / "Characters/NPCs"; npcs.mkdir(parents=True)
    (npcs / "A.md").write_text('---\ntype: npc\nprovenance: "midwife"\n---\nB\n', encoding="utf-8")
    (npcs / "B.md").write_text('---\ntype: npc\nprovenance: "mobrpg"\n---\nB\n', encoding="utf-8")
    (npcs / "C.md").write_text('---\ntype: npc\n---\nB\n', encoding="utf-8")  # unmarked
    names = lambda **k: {e["name"] for e in suggest.collect_entities(str(tmp_path), **k)}
    assert names() == {"A", "B", "C"}
    assert names(exclude_provenance={"midwife"}) == {"B", "C"}
    assert names(only_provenance={"midwife"}) == {"A"}
    # entities carry their provenance for reporting
    got = {e["name"]: e["provenance"] for e in suggest.collect_entities(str(tmp_path))}
    assert got == {"A": "midwife", "B": "mobrpg", "C": None}   # unmarked → None


def test_node_index_resolves_targets_by_alias(tmp_path):
    from mobrpg import node
    (tmp_path / "Locations").mkdir(parents=True)
    nd = {"world_id": "", "external_ref": "space_game:Locations/MacMillian Station IV",
          "element_id": "mac-id", "element_kind": "Political", "review_state": "accepted",
          "relationships": [], "languages": []}
    (tmp_path / "Locations/MacMillian Station IV.md").write_text(
        '---\ntype: location\naliases: ["Thides Station", "The Station"]\n'
        + node.emit_node(nd) + "---\nBody\n", encoding="utf-8")
    idx, _ = suggest.node_index(str(tmp_path))
    assert idx[suggest._key("MacMillian Station IV")] == "mac-id"
    assert idx[suggest._key("Thides Station")] == "mac-id"      # alias resolves to the same element
    assert idx[suggest._key("The Station")] == "mac-id"


def test_collect_entities_skips_type_mismatched_sidecars(tmp_path):
    pcs = tmp_path / "Characters/PCs"
    pcs.mkdir(parents=True)
    (pcs / "Six.md").write_text("---\ntype: pc\n---\nBody\n", encoding="utf-8")
    (pcs / "Six_Story.md").write_text("---\ntype: character-story\n---\nArc notes\n", encoding="utf-8")
    names = {e["name"] for e in suggest.collect_entities(str(tmp_path))}
    assert "Six" in names                       # the PC is an entity
    assert "Six Story" not in names             # the story sidecar is not pushed
    # untyped legacy notes are still collected (no type to reject)
    (pcs / "Legacy.md").write_text("---\nname: Legacy\n---\nBody\n", encoding="utf-8")
    assert "Legacy" in {e["name"] for e in suggest.collect_entities(str(tmp_path))}

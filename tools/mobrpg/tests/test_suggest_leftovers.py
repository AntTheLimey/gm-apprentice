"""Leftovers of the first oldest-issues batch (#348): suggest and rel_baseline edge cases."""
from mobrpg.commands import suggest


def test_a_linked_notes_edge_to_a_held_look_alike_says_held_not_two_notes_share_it():
    # The inn "The Woodland Ghost" is linked and live; the creature note "Woodland Ghost" is
    # unlinked and live, so it is held. Its key is shared by two notes, but that is not why the
    # edge from a linked note to it is not sent.
    ent = {"name": "Sir Aldric", "relationships": [
        {"target": "Woodland Ghost", "predicate": "visits", "desc": ""}]}
    notes: list = []
    held = suggest.held_relationship_count(
        [ent], {}, {}, set(), id_by_file={"The Woodland Ghost": "id-inn"},
        ambiguous={"woodlandghost"}, ref_by_file={}, notes=notes,
        held_names={"Woodland Ghost": "The Woodland Ghost"})
    assert held == 0
    assert len(notes) == 1 and "held" in notes[0] and "two notes share" not in notes[0]


def test_an_alias_two_linked_notes_share_names_both_owners_and_still_holds(tmp_path):
    from mobrpg import node
    (tmp_path / "Characters/NPCs").mkdir(parents=True)
    for stem in ("Vane", "Wren"):
        nd = {"world_id": "", "external_ref": f"w:{stem}", "element_id": f"{stem}-id",
              "element_kind": "Person", "review_state": "accepted", "relationships": [],
              "languages": []}
        (tmp_path / f"Characters/NPCs/{stem}.md").write_text(
            "---\ntype: npc\naliases: [The Count]\n" + node.emit_node(nd) + "---\nB\n",
            encoding="utf-8")
    aliases = suggest.linked_aliases(str(tmp_path))
    by_file, _ = suggest.node_files(str(tmp_path))
    notes: list = []
    net_new, linked, _ = suggest.partition_entities(
        [{"name": "The Count"}], {}, set(), by_file, notes=notes, alias_owner=aliases)
    assert net_new == [] and [e["name"] for e in linked] == ["The Count"]
    assert "Vane" in notes[0] and "Wren" in notes[0]


def _refs_by_target(tmp_path, order):
    ent = {"path": str(tmp_path / "Characters/NPCs/Bob.md"), "name": "Bob",
           "relationships": [{"target": t, "predicate": "knows", "desc": ""} for t in order]}
    items, _ = suggest.relationship_items(
        ent, {"relationshipTypes": {}}, "e1", {}, set(), str(tmp_path), "w", "e1",
        id_by_file={"The Woodland Ghost": "inn-id", "Woodland Ghost": "cr-id"},
        ambiguous={suggest._key("Woodland Ghost")})
    # each event is named "Bob, knows <target>"; pair the name with its ref
    return {i["payload"]["name"]: i["externalRef"] for i in items
            if i.get("externalRef", "").startswith("w:rel/")}


def test_reordering_two_look_alike_lines_does_not_swap_their_event_refs(tmp_path):
    a = _refs_by_target(tmp_path, ["The Woodland Ghost", "Woodland Ghost"])
    b = _refs_by_target(tmp_path, ["Woodland Ghost", "The Woodland Ghost"])
    assert len(a) == 2 and a == b


def test_kind_of_matches_a_name_in_another_case_like_the_edge_resolver_does():
    # Obsidian resolves [[woodland ghost]] to the note "Woodland Ghost"; the edge resolves it,
    # so its kind must too, even when the folded key is shared by a look-alike.
    kinds = {("=", "Woodland Ghost"): "Creature", ("=", "The Woodland Ghost"): "LandFeature"}
    assert suggest.kind_of(kinds, "woodland ghost") == "Creature"
    assert suggest.kind_of(kinds, "[[THE WOODLAND GHOST]]") == "LandFeature"
    # two notes whose names differ only in case, with different kinds: no guess
    clash = {("=", "Vane"): "Person", ("=", "vane"): "Item"}
    assert suggest.kind_of(clash, "VANE") is None

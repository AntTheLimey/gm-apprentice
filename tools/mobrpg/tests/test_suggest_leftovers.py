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


def test_kind_of_matches_a_name_in_another_case_like_the_edge_resolver_does():
    # Obsidian resolves [[woodland ghost]] to the note "Woodland Ghost"; the edge resolves it,
    # so its kind must too, even when the folded key is shared by a look-alike.
    kinds = {("=", "Woodland Ghost"): "Creature", ("=", "The Woodland Ghost"): "LandFeature"}
    assert suggest.kind_of(kinds, "woodland ghost") == "Creature"
    assert suggest.kind_of(kinds, "[[THE WOODLAND GHOST]]") == "LandFeature"
    # two notes whose names differ only in case, with different kinds: no guess
    clash = {("=", "Vane"): "Person", ("=", "vane"): "Item"}
    assert suggest.kind_of(clash, "VANE") is None

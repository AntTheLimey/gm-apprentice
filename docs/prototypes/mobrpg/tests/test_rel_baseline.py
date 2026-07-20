from mobrpg.commands import rel_baseline as rb


def _map():
    return {"relationshipTypes": {}}


def test_build_structural_index_keeps_only_known_both_ends():
    known = {"a", "b", "c"}
    rels_by = {
        "a": [{"id": "r1", "sourceId": "a", "targetId": "b", "type": "Parent"},
              {"id": "rx", "sourceId": "a", "targetId": "evt", "type": "Link"}],  # Link to Event -> excluded
        "b": [{"id": "r1", "sourceId": "a", "targetId": "b", "type": "Parent"},   # dup (seen from b) -> same id
              {"id": "r2", "sourceId": "b", "targetId": "zzz", "type": "Spouse"}],  # target not known -> excluded
    }
    idx = rb.build_structural_index(rels_by, known)
    assert idx == {("a", "Parent", "b"): "r1"}


def test_build_reified_index_groups_by_participants_and_type():
    known = {"a", "b", "c"}
    events = [
        {"id": "e1", "eventType": "Membership", "participants": ["a", "b"]},
        {"id": "e2", "eventType": "Membership", "participants": ["a", "b"]},  # ambiguous dup
        {"id": "e3", "eventType": "War", "participants": ["a", "c"]},
        {"id": "e4", "eventType": "Generic", "participants": ["a", "zzz"]},    # <2 known -> dropped
    ]
    idx = rb.build_reified_index(events, known)
    assert idx[(frozenset({"a", "b"}), "Membership")] == ["e1", "e2"]
    assert idx[(frozenset({"a", "c"}), "War")] == ["e3"]
    assert (frozenset({"a"}), "Generic") not in idx


def test_match_node_structural_and_reified_hits():
    mp = _map()
    id_by_key = {rb._key("Halcyon"): "h", rb._key("Thides System"): "t"}
    node = {"element_id": "corwin",
            "relationships": [
                {"predicate": "part_of", "target": "[[Thides System]]"},    # -> Parent (structural)
                {"predicate": "member_of", "target": "[[Halcyon]]"},        # -> Membership (reified)
                {"predicate": "member_of", "target": "[[Unknown Org]]"},    # target not upstream -> skip
            ]}
    structural = {("corwin", "Parent", "t"): "rel-1"}
    reified = {(frozenset({"corwin", "h"}), "Membership"): ["ev-9"]}
    eids, reviews = rb.match_node(node, id_by_key, structural, reified, mp)
    assert eids == {"part_of|[[Thides System]]": "rel-1",
                    "member_of|[[Halcyon]]": "ev-9"}
    assert reviews == []


def test_match_node_flags_ambiguous_reified():
    mp = _map()
    id_by_key = {rb._key("Halcyon"): "h"}
    node = {"element_id": "corwin",
            "relationships": [{"predicate": "member_of", "target": "[[Halcyon]]"}]}
    reified = {(frozenset({"corwin", "h"}), "Membership"): ["ev-1", "ev-2"]}
    eids, reviews = rb.match_node(node, id_by_key, {}, reified, mp)
    assert eids == {}                      # ambiguous -> not auto-stamped
    assert len(reviews) == 1 and "review" in reviews[0].lower()


def test_match_node_skips_already_baselined_relationship():
    mp = _map()
    id_by_key = {rb._key("Halcyon"): "h"}
    node = {"element_id": "corwin",
            "relationships": [{"predicate": "member_of", "target": "[[Halcyon]]",
                               "event_id": "already"}]}
    reified = {(frozenset({"corwin", "h"}), "Membership"): ["ev-1"]}
    eids, reviews = rb.match_node(node, id_by_key, {}, reified, mp)
    assert eids == {} and reviews == []


def test_build_structural_index_symmetrizes_link_and_spouse_only():
    known = {"a", "b"}
    rels_by = {"a": [{"id": "L", "sourceId": "a", "targetId": "b", "type": "Link"},
                     {"id": "P", "sourceId": "a", "targetId": "b", "type": "Parent"}]}
    idx = rb.build_structural_index(rels_by, known)
    assert idx[("a", "Link", "b")] == "L" and idx[("b", "Link", "a")] == "L"   # both dirs
    assert idx[("a", "Parent", "b")] == "P" and ("b", "Parent", "a") not in idx  # directional


def test_match_node_symmetric_match_from_opposite_end():
    mp = {"relationshipTypes": {"allied_with": "Link"}}
    id_by_key = {rb._key("Bravo"): "b"}
    # vault authors alpha--allied_with-->bravo; mobRPG stored the Link as (b -> a)
    node = {"element_id": "a",
            "relationships": [{"predicate": "allied_with", "target": "[[Bravo]]"}]}
    structural = rb.build_structural_index(
        {"b": [{"id": "L", "sourceId": "b", "targetId": "a", "type": "Link"}]}, {"a", "b"})
    eids, reviews = rb.match_node(node, id_by_key, structural, {}, mp)
    assert eids == {"allied_with|[[Bravo]]": "L"} and reviews == []


def test_match_node_does_not_reuse_one_upstream_event_for_two_edges():
    # Two different vault predicates between the same pair both collapse to Generic
    # and there is a single Generic upstream event — only the first may claim it.
    mp = {}
    id_by_key = {rb._key("Bravo"): "b"}
    node = {"element_id": "a", "relationships": [
        {"predicate": "knows", "target": "[[Bravo]]"},      # sanctioned -> Generic
        {"predicate": "trusts", "target": "[[Bravo]]"}]}    # sanctioned -> Generic
    reified = {(frozenset({"a", "b"}), "Generic"): ["ev-1"]}
    eids, reviews = rb.match_node(node, id_by_key, {}, reified, mp)
    assert list(eids.values()) == ["ev-1"] and len(eids) == 1   # only one stamped
    assert len(reviews) == 1 and "already claimed" in reviews[0]


def test_stamp_baseline_sets_event_id_and_leaves_rest_untouched():
    node = {"element_id": "corwin", "review_state": "edited", "determined": {"x": 1},
            "relationships": [
                {"predicate": "part_of", "target": "[[Thides System]]"},
                {"predicate": "member_of", "target": "[[Halcyon]]", "event_id": "keep"}]}
    out = rb.stamp_baseline(node, {"part_of|[[Thides System]]": "rel-1"})
    assert out["review_state"] == "edited" and out["determined"] == {"x": 1}   # node-level untouched
    assert out["relationships"][0]["event_id"] == "rel-1"
    assert out["relationships"][0]["review_state"] == "accepted"
    assert out["relationships"][1]["event_id"] == "keep"                       # pre-existing preserved
    # original not mutated
    assert "event_id" not in node["relationships"][0]


def test_stamp_baseline_noop_returns_input():
    node = {"element_id": "x", "relationships": []}
    assert rb.stamp_baseline(node, {}) is node

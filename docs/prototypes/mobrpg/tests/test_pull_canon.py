import pytest

from mobrpg.commands import pull_canon
from mobrpg import client
from mobrpg import node

BASE = {"world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
        "element_id": None, "element_kind": "Person", "review_state": "pending",
        "content_hash": "sha256:x", "last_synced": "", "review_note": "",
        "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
        "relationships": [{"predicate": "friend_of", "target": "Nathaniel_Rooke",
                           "event_type": "Generic", "event_id": None,
                           "review_state": "pending"}],
        "languages": []}


def test_accept_unchanged_fills_ids():
    live = {"state": "accepted", "element_id": "el-1",
            "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
            "event_ids": {"friend_of|Nathaniel_Rooke": "ev-1"}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "accepted" and out["element_id"] == "el-1"
    assert out["relationships"][0]["event_id"] == "ev-1"
    assert out["relationships"][0]["review_state"] == "accepted"


def test_accept_after_edit_overwrites_determined():
    live = {"state": "accepted", "element_id": "el-1",
            "determined": {"profession": "Cultist", "race": "Human", "sex": "Female"},
            "event_ids": {}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "edited"
    assert out["determined"]["profession"] == "Cultist"


def test_dismissed_records_note_and_preserves():
    live = {"state": "dismissed", "element_id": None, "review_note": "dup",
            "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "dismissed" and out["review_note"] == "dup"
    assert out["determined"] == BASE["determined"]      # vault preserved


def test_deleted_flags_and_clears_id():
    prior = dict(BASE, element_id="el-1", review_state="accepted")
    live = {"state": "deleted", "element_id": "el-1", "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(prior, live)
    assert out["review_state"] == "deleted" and out["element_id"] is None


def test_pending_left_untouched():
    live = {"state": "pending", "element_id": None, "determined": {}, "event_ids": {}}
    assert pull_canon.apply_state(BASE, live) == BASE


def test_scaffold_note_creates_minimal_file():
    live = {"state": "accepted", "element_id": "new-1", "name": "Hidden Cult",
            "kind": "faction", "element_kind": "Organization",
            "determined": {"organization_type": "Cult"}, "event_ids": {}}
    rel, text = pull_canon.scaffold_note("canticle:Factions/Hidden_Cult", live, "canticle")
    assert rel == "Factions/Hidden_Cult.md"
    assert text.startswith("---\ntype: faction\n")
    n = node.read_node(text)
    assert n["element_id"] == "new-1" and n["review_state"] == "accepted"
    assert n["element_kind"] == "Organization"
    assert "# Hidden Cult" in text


def _run_execute(monkeypatch, vault, live_by_ref):
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon, "_fetch_live",
                        lambda world, token, *, verify=True: live_by_ref)
    rc = pull_canon.run(["w1", "--vault", str(vault), "--execute"])
    assert rc == 0


def test_run_baseline_stamps_matched_event_ids(monkeypatch, tmp_path, capsys):
    import json
    from mobrpg.commands import suggest
    vault = tmp_path / "space_game"
    (vault / "Characters/NPCs").mkdir(parents=True)
    (vault / "Factions & Organizations").mkdir(parents=True)
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta/mobrpg-map.json").write_text("{}", encoding="utf-8")

    corwin = {"world_id": "w1", "external_ref": "space_game:Characters/NPCs/Corwin Dace",
              "element_id": "corwin", "element_kind": "Person", "review_state": "accepted",
              "relationships": [{"predicate": "member_of", "target": "[[Halcyon]]",
                                 "event_type": "Membership", "event_id": None,
                                 "review_state": "pending"}],
              "languages": []}
    (vault / "Characters/NPCs/Corwin Dace.md").write_text(
        "---\ntype: npc\n" + node.emit_node(corwin) + "---\nBody\n", encoding="utf-8")
    halcyon = {"world_id": "w1", "external_ref": "space_game:Factions & Organizations/Halcyon",
               "element_id": "h", "element_kind": "Organization", "review_state": "accepted",
               "relationships": [], "languages": []}
    (vault / "Factions & Organizations/Halcyon.md").write_text(
        "---\ntype: faction\n" + node.emit_node(halcyon) + "---\nBody\n", encoding="utf-8")

    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    # canned upstream graph: one reified Membership event linking corwin↔h
    reified = {(frozenset({"corwin", "h"}), "Membership"): ["ev-9"]}
    monkeypatch.setattr(pull_canon.rel_baseline, "fetch_upstream",
                        lambda world, token, nodes: ({}, reified, {"corwin", "h"}))

    rc = pull_canon.run(["w1", "--vault", str(vault), "--baseline", "--execute"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "matched 1 pre-existing upstream relationship" in out
    nd = node.read_node((vault / "Characters/NPCs/Corwin Dace.md").read_text(encoding="utf-8"))
    assert nd["relationships"][0]["event_id"] == "ev-9"
    assert nd["relationships"][0]["review_state"] == "accepted"


def test_run_baseline_dry_run_writes_nothing(monkeypatch, tmp_path, capsys):
    from mobrpg import node as _n
    vault = tmp_path / "space_game"
    (vault / "Characters/NPCs").mkdir(parents=True)
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta/mobrpg-map.json").write_text("{}", encoding="utf-8")
    corwin = {"world_id": "w1", "external_ref": "space_game:Characters/NPCs/Corwin Dace",
              "element_id": "corwin", "element_kind": "Person", "review_state": "accepted",
              "relationships": [{"predicate": "member_of", "target": "[[Halcyon]]",
                                 "event_type": "Membership", "event_id": None,
                                 "review_state": "pending"}], "languages": []}
    p = vault / "Characters/NPCs/Corwin Dace.md"
    p.write_text("---\ntype: npc\n" + _n.emit_node(corwin) + "---\nBody\n", encoding="utf-8")
    before = p.read_text(encoding="utf-8")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.rel_baseline, "fetch_upstream",
                        lambda world, token, nodes: ({}, {}, set()))
    rc = pull_canon.run(["w1", "--vault", str(vault), "--baseline"])
    assert rc == 0
    assert "dry-run" in capsys.readouterr().out
    assert p.read_text(encoding="utf-8") == before


def test_run_does_not_scaffold_reified_event_ref(monkeypatch, tmp_path, capsys):
    # An Accepted reified-relationship Event ref (rel/ prefix) must never scaffold a note.
    ref = "canticle:rel/Characters/NPCs/Imogen_Bellamy/friend_of/nathanielrooke"
    live = {ref: {"state": "accepted", "element_id": "ev-1", "element_kind": "Person",
                  "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, tmp_path, live)
    assert not (tmp_path / "rel").exists()
    assert list(tmp_path.rglob("*.md")) == []
    assert "0 node(s) updated" in capsys.readouterr().out


def test_run_skips_colonless_ref_without_crashing(monkeypatch, tmp_path, capsys):
    live = {"nocolonref": {"state": "accepted", "element_id": "el-9",
                           "element_kind": "Person", "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, tmp_path, live)
    assert list(tmp_path.rglob("*.md")) == []
    assert "0 node(s) updated" in capsys.readouterr().out


def test_run_skips_traversal_ref(monkeypatch, tmp_path, capsys):
    vault = tmp_path / "vault"
    vault.mkdir()
    ref = "canticle:../evil"
    live = {ref: {"state": "accepted", "element_id": "el-x", "element_kind": "Person",
                  "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, vault, live)
    assert not (tmp_path / "evil.md").exists()
    assert list(tmp_path.rglob("*.md")) == []
    assert "0 node(s) updated" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# G1 — determined_from_element: rebuild ratified `determined` off a live element.
# Fixtures below are trimmed from real payloads captured 2026-07-19 against the
# Regency Cthulhu world (4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb).
# ---------------------------------------------------------------------------

def _attr(source_type, name):
    return {"type": "Attribute", "source": {"type": source_type, "name": name}}


def test_determined_from_element_person_sex_race():
    el = {"type": "person", "name": "Miriam Doyle",
          "relations": [_attr("sex", "Female"), _attr("race", "Human")]}
    assert pull_canon.determined_from_element(el) == {"sex": "Female", "race": "Human"}


def test_determined_from_element_person_multi_profession_collapses():
    el = {"type": "person", "name": "Mr. Alfred Smythe",
          "relations": [_attr("race", "Human"), _attr("sex", "Male"),
                        _attr("profession", "Linguist"),
                        _attr("profession", "Cryptologist")]}
    out = pull_canon.determined_from_element(el)
    assert out["profession"] == "Cryptologist, Linguist"   # sorted, comma-joined
    assert out["race"] == "Human" and out["sex"] == "Male"


def test_determined_from_element_political_type():
    el = {"type": "political", "name": "Bath", "relations": [_attr("politicaltype", "Town")]}
    assert pull_canon.determined_from_element(el) == {"political_type": "Town"}


def test_determined_from_element_organization_type():
    el = {"type": "organization", "name": "The Aeternum Choir",
          "relations": [_attr("organizationtype", "Cult")]}
    assert pull_canon.determined_from_element(el) == {"organization_type": "Cult"}


def test_determined_from_element_item_type_from_attributes():
    el = {"type": "item", "name": "Liber Ivonis", "relations": [],
          "attributes": {"itemType": "Generic", "cost": 0.0, "weight": 0.0}}
    assert pull_canon.determined_from_element(el) == {"item_type": "Generic"}


def test_determined_from_element_landfeature_type_from_list():
    el = {"type": "landfeature", "name": "River Thames", "relations": [],
          "landFeatureTypes": ["River"]}
    assert pull_canon.determined_from_element(el) == {"land_feature_type": "River"}


def test_determined_from_element_no_classifiers_is_empty():
    el = {"type": "person", "name": "Nobody", "relations": []}
    assert pull_canon.determined_from_element(el) == {}


# ---------------------------------------------------------------------------
# G1 — _fetch_live: query all three states and verify accepted elements so the
# deleted / edited outcomes become reachable.
# ---------------------------------------------------------------------------

class _FakeApi:
    """Routes client._request by path. `elements` maps elementId -> payload;
    a missing id raises ApiError(404); ids in `errors` raise that status."""

    def __init__(self, by_state, elements=None, errors=None):
        self.by_state = by_state
        self.elements = elements or {}
        self.errors = errors or {}
        self.element_gets = []

    def __call__(self, method, path, *, token=None, **kw):
        if "/suggestion?reviewState=" in path:
            state = path.rsplit("=", 1)[1]
            return list(self.by_state.get(state, []))
        # element GET: /world/<w>/<ep>/<id>
        rid = path.rsplit("/", 1)[1]
        self.element_gets.append(rid)
        if rid in self.errors:
            raise client.ApiError(self.errors[rid], "err", path)
        if rid not in self.elements:
            raise client.ApiError(404, "not found", path)
        return self.elements[rid]


def _sug(ext, rid, etype="Person", note=""):
    return {"externalRef": ext, "resultElementId": rid,
            "payload": {"data": {"type": etype}}, "reviewNote": note}


def test_fetch_live_queries_all_three_states(monkeypatch):
    fake = _FakeApi(by_state={
        "Accepted": [_sug("c:A", "el-a")],
        "Dismissed": [_sug("c:D", None, note="dup")],
        "Pending": [_sug("c:P", None)],
    }, elements={"el-a": {"type": "person", "relations": [_attr("race", "Human")]}})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:A"]["state"] == "accepted"
    assert live["c:D"]["state"] == "dismissed" and live["c:D"]["review_note"] == "dup"
    assert live["c:P"]["state"] == "pending"


def test_fetch_live_populates_determined_from_element(monkeypatch):
    fake = _FakeApi(
        by_state={"Accepted": [_sug("c:Bath", "el-bath", etype="Political")]},
        elements={"el-bath": {"type": "political",
                              "relations": [_attr("politicaltype", "Town")]}})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:Bath"]["determined"] == {"political_type": "Town"}
    assert live["c:Bath"]["element_id"] == "el-bath"


def test_fetch_live_404_element_marks_deleted(monkeypatch):
    fake = _FakeApi(by_state={"Accepted": [_sug("c:Gone", "el-gone")]}, elements={})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:Gone"]["state"] == "deleted"


def test_fetch_live_transient_error_stays_accepted_not_deleted(monkeypatch):
    # A 500/network error must NOT be mistaken for deletion (would clear element_id).
    fake = _FakeApi(by_state={"Accepted": [_sug("c:Blip", "el-blip")]},
                    errors={"el-blip": 500})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert fake.element_gets == ["el-blip"]      # verification was attempted
    assert live["c:Blip"]["state"] == "accepted"  # ...but a 500 is not a deletion
    assert live["c:Blip"]["determined"] == {}


def test_fetch_live_accepted_wins_over_resubmitted_pending(monkeypatch):
    # Same externalRef with both an Accepted row and a later Pending re-submission
    # must keep the authoritative Accepted outcome, not be clobbered by Pending.
    fake = _FakeApi(by_state={
        "Accepted": [_sug("c:Dup", "el-dup", etype="Political")],
        "Pending": [_sug("c:Dup", None, etype="Political")],
    }, elements={"el-dup": {"type": "political",
                            "relations": [_attr("politicaltype", "Town")]}})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:Dup"]["state"] == "accepted"
    assert live["c:Dup"]["determined"] == {"political_type": "Town"}


def test_fetch_live_no_verify_skips_element_fetch(monkeypatch):
    fake = _FakeApi(by_state={"Accepted": [_sug("c:A", "el-a")]},
                    elements={"el-a": {"type": "person", "relations": []}})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok", verify=False)
    assert live["c:A"]["state"] == "accepted"
    assert fake.element_gets == []          # no element GET happened


def test_fetch_live_unknown_etype_skips_get_stays_accepted(monkeypatch):
    # A type with no TYPE_EP endpoint (e.g. a classifier Sex) can't be fetched;
    # it must stay plain-accepted without attempting (or mis-routing) a GET.
    fake = _FakeApi(by_state={"Accepted": [_sug("c:X", "el-x", etype="Sex")]})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:X"]["state"] == "accepted"
    assert fake.element_gets == []

import os

import pytest

from mobrpg.commands import pull_canon
from mobrpg import client
from mobrpg import lww
from mobrpg import node

BASE = {"world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
        "element_id": None, "element_kind": "Person", "review_state": "pending",
        "last_synced": "", "review_note": "",
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


def test_accept_stamps_last_synced():
    live = {"state": "accepted", "element_id": "el-1",
            "determined": {"profession": "Priest", "race": "Human", "sex": "Female"},
            "event_ids": {"friend_of|Nathaniel_Rooke": "ev-1"}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "accepted"
    assert out["last_synced"] != ""


def test_dismissed_stamps_last_synced():
    live = {"state": "dismissed", "element_id": None, "review_note": "dup",
            "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(BASE, live)
    assert out["review_state"] == "dismissed"
    assert out["last_synced"] != ""


def test_already_accepted_unchanged_does_not_restamp():
    prior = dict(BASE, review_state="accepted", element_id="el-1",
                 last_synced="2020-01-01T00:00:00Z")
    live = {"state": "accepted", "element_id": "el-1",
            "determined": dict(prior["determined"]), "event_ids": {}}
    out = pull_canon.apply_state(prior, live)
    assert out["review_state"] == "accepted"
    assert out["last_synced"] == "2020-01-01T00:00:00Z"


def test_already_dismissed_unchanged_does_not_restamp():
    prior = dict(BASE, review_state="dismissed", element_id=None,
                 review_note="dup", last_synced="2020-01-01T00:00:00Z")
    live = {"state": "dismissed", "element_id": None, "review_note": "dup",
            "determined": {}, "event_ids": {}}
    out = pull_canon.apply_state(prior, live)
    assert out["review_state"] == "dismissed"
    assert out["last_synced"] == "2020-01-01T00:00:00Z"


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
    # The #153 liveness gate calls pull.live_element_ids separately from
    # _fetch_live; treat every element_id already in the fake queue as live so
    # it never runs against the network and never perturbs these tests' own
    # scaffold/traversal assertions.
    live_ids = {v.get("element_id") for v in live_by_ref.values() if v.get("element_id")}
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: live_ids)
    rc = pull_canon.run(["w1", "--vault", str(vault), "--execute"])
    assert rc == 0


def test_dismiss_transition_pins_file_mtime(monkeypatch, tmp_path):
    # The accept/dismiss write must pin the file mtime to the fresh last_synced
    # stamp; otherwise mtime > last_synced leaves the note perpetually vault-dirty
    # and a dismissed suggestion gets re-filed on the next sync.
    vault = tmp_path / "vault"
    (vault / "Creatures").mkdir(parents=True)
    nd = {"world_id": "w1", "external_ref": "ns:Creatures/marsh-hag",
          "element_id": "e-77", "element_kind": "Creature", "review_state": "accepted",
          "last_synced": "2020-01-01T00:00:00Z", "review_note": "",
          "determined": {}, "relationships": [], "languages": []}
    p = vault / "Creatures/marsh-hag.md"
    p.write_text("---\ntype: creature\n" + node.emit_node(nd) + "---\nBody\n",
                 encoding="utf-8")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(
        pull_canon, "_fetch_live",
        lambda world, token, *, verify=True: {
            "ns:Creatures/marsh-hag": {"state": "dismissed", "element_id": None,
                                       "review_note": "dup", "determined": {},
                                       "event_ids": {}}})
    # Keep the #153 liveness gate off the network for this dismissed-only fixture.
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: {"e-77"})
    pull_canon.run(["w1", "--vault", str(vault), "--execute"])
    out = node.read_node(p.read_text(encoding="utf-8"))
    assert out["review_state"] == "dismissed"
    stamp = lww.parse_ts(out["last_synced"])
    assert stamp is not None
    assert os.path.getmtime(p) == stamp          # mtime pinned to the stamp


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


# ---------------------------------------------------------------------------
# #140 — scaffolding must not mint junk notes, and must not mis-kind real ones.
# ---------------------------------------------------------------------------

def test_run_does_not_scaffold_desc_suggestion_ref(monkeypatch, tmp_path, capsys):
    """A `desc/` ref is a description-suggestion handle, not a note path.

    Observed 2026-07-26 against the Dead End vault: an accepted `suggest-desc`
    suggestion (`space_game:desc/Items & Artifacts/Type II3-A`) scaffolded a junk
    stub at `desc/Items & Artifacts/Type II3-A.md` for an element whose real note
    was already linked. `suggest-desc` is gone, but its accepted cards live in the
    review queue forever, so pull-canon keeps meeting them.
    """
    vault = tmp_path / "vault"
    (vault / "desc").mkdir(parents=True)          # even if the root exists, reject it
    ref = "space_game:desc/Items & Artifacts/Type II3-A"
    live = {ref: {"state": "accepted", "element_id": "el-d", "element_kind": "Item",
                  "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, vault, live)
    assert list(vault.rglob("*.md")) == []
    assert "0 node(s) updated" in capsys.readouterr().out


def test_run_does_not_scaffold_into_an_unknown_root(monkeypatch, tmp_path, capsys):
    """Fail closed on ref namespaces we don't recognise.

    A prefix blocklist only rejects the shapes we already know about, so the next
    verb that mints a new ref namespace repeats #140. Scaffolding therefore
    requires the ref's first path segment to be a directory that already exists
    in the vault; anything else is reported, not created.
    """
    vault = tmp_path / "vault"
    (vault / "Characters" / "NPCs").mkdir(parents=True)
    ref = "space_game:sidecar/Characters/NPCs/Someone"
    live = {ref: {"state": "accepted", "element_id": "el-s", "element_kind": "Person",
                  "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, vault, live)
    assert list(vault.rglob("*.md")) == []
    out = capsys.readouterr().out
    assert "0 node(s) updated" in out
    assert ref in out                             # surfaced, not silently dropped


def test_run_scaffolds_a_known_root_with_the_canon_kind(monkeypatch, tmp_path):
    """The scaffolded note takes its kind from canon, not from a Person default."""
    vault = tmp_path / "vault"
    (vault / "Items & Artifacts").mkdir(parents=True)
    ref = "space_game:Items & Artifacts/Stolen Transport"
    live = {ref: {"state": "accepted", "element_id": "el-i", "element_kind": "Item",
                  "name": "Stolen Transport", "determined": {}, "event_ids": {}}}
    _run_execute(monkeypatch, vault, live)
    p = vault / "Items & Artifacts" / "Stolen Transport.md"
    assert p.exists()
    text = p.read_text(encoding="utf-8")
    assert text.startswith("---\ntype: item\n")
    assert node.read_node(text)["element_kind"] == "Item"


def test_fetch_live_carries_element_kind_and_name_into_the_summary(monkeypatch):
    """`_fetch_live` never populated kind or name, so every scaffolded note fell
    through `scaffold_note`'s defaults to Person/npc and an underscore-mangled
    name derived from the ref — regardless of what canon actually accepted."""
    fake = _FakeApi(
        by_state={"Accepted": [dict(_sug("c:Items/Relic", "el-r", etype="Item"),
                                    payload={"data": {"type": "Item"},
                                             "name": "The Relic"})]},
        elements={"el-r": {"type": "item", "relations": []}})
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    live = pull_canon._fetch_live("w1", "tok")
    assert live["c:Items/Relic"]["element_kind"] == "Item"
    assert live["c:Items/Relic"]["name"] == "The Relic"


# ---------------------------------------------------------------------------
# #141 (second half) — deletions that happen OUTSIDE the suggestion queue.
# `_fetch_live` only sees elements that came through review, so an element Tim
# deletes directly is reported by `whats-new` and then never flagged on its node.
# ---------------------------------------------------------------------------

def _linked_vault(tmp_path, *pairs):
    vault = tmp_path / "vault"
    (vault / "Characters" / "NPCs").mkdir(parents=True)
    for name, eid in pairs:
        nd = {"world_id": "w1", "external_ref": f"ns:Characters/NPCs/{name}",
              "element_id": eid, "element_kind": "Person", "review_state": "accepted",
              "last_synced": "", "review_note": "", "determined": {},
              "relationships": [], "languages": []}
        (vault / "Characters" / "NPCs" / f"{name}.md").write_text(
            "---\ntype: npc\n" + node.emit_node(nd) + "---\nBody\n", encoding="utf-8")
    return vault


def test_reconcile_deletions_flags_a_node_gone_from_upstream(monkeypatch, tmp_path, capsys):
    vault = _linked_vault(tmp_path, ("Alive", "el-live"), ("Six Field Sundries", "el-gone"))
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: {"el-live"})
    rc = pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions", "--execute"])
    assert rc == 0
    gone = node.read_node(
        (vault / "Characters/NPCs/Six Field Sundries.md").read_text(encoding="utf-8"))
    assert gone["review_state"] == "deleted" and gone["element_id"] is None
    still = node.read_node((vault / "Characters/NPCs/Alive.md").read_text(encoding="utf-8"))
    assert still["review_state"] == "accepted" and still["element_id"] == "el-live"
    assert "Six Field Sundries" in capsys.readouterr().out


def test_reconcile_deletions_is_dry_run_by_default(monkeypatch, tmp_path, capsys):
    vault = _linked_vault(tmp_path, ("Ghost", "el-gone"))
    before = (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: {"el-other"})
    assert pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions"]) == 0
    assert (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8") == before
    assert "dry-run" in capsys.readouterr().out


def test_reconcile_deletions_aborts_rather_than_flag_everything(monkeypatch, tmp_path, capsys):
    """A failed or truncated read looks exactly like "canon deleted everything".

    `pull._list_all` swallows every exception and returns [], so a transient
    failure on one kind would otherwise flag every note of that kind deleted.
    The pass must abort on an unreadable world, not act on it.
    """
    vault = _linked_vault(tmp_path, ("Ghost", "el-1"))
    before = (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")

    def _boom(world, token):
        raise client.ApiError(503, "upstream down", "/world/w1/person")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", _boom)
    rc = pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions", "--execute"])
    assert rc == 1
    assert (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8") == before


def test_reconcile_deletions_refuses_an_empty_world(monkeypatch, tmp_path):
    vault = _linked_vault(tmp_path, ("Ghost", "el-1"))
    before = (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8")
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: set())
    rc = pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions", "--execute"])
    assert rc == 1
    assert (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8") == before


def test_reconcile_deletions_is_idempotent(monkeypatch, tmp_path, capsys):
    vault = _linked_vault(tmp_path, ("Ghost", "el-1"))
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: {"el-other"})
    pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions", "--execute"])
    after = (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8")
    # element_id is cleared, so the note is no longer "linked" — a second pass is a no-op.
    pull_canon.run(["w1", "--vault", str(vault), "--reconcile-deletions", "--execute"])
    assert (vault / "Characters/NPCs/Ghost.md").read_text(encoding="utf-8") == after


# ---------------------------------------------------------------------------
# #153 — the main review-queue pass gates `live_by_ref` on world liveness
# before apply_state runs, so a still-Accepted create row whose element left
# the world can't re-stamp a dead id onto a node `--reconcile-deletions`
# already flagged deleted.
# ---------------------------------------------------------------------------

def test_accepted_row_with_dead_element_flags_deleted(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    (vault / "Characters" / "NPCs").mkdir(parents=True)

    # Node already correctly flagged: review_state deleted, element_id null.
    dead_nd = {"world_id": "w1", "external_ref": "ns:Characters/NPCs/Dead_Guy",
               "element_id": None, "element_kind": "Person", "review_state": "deleted",
               "last_synced": "", "review_note": "", "determined": {},
               "relationships": [], "languages": []}
    dead_path = vault / "Characters" / "NPCs" / "Dead_Guy.md"
    dead_path.write_text("---\ntype: npc\n" + node.emit_node(dead_nd) + "---\nBody\n",
                         encoding="utf-8")

    # A node whose element IS in the live set: stays accepted.
    live_nd = {"world_id": "w1", "external_ref": "ns:Characters/NPCs/Live_Guy",
               "element_id": "e-live", "element_kind": "Person", "review_state": "accepted",
               "last_synced": "2020-01-01T00:00:00Z", "review_note": "", "determined": {},
               "relationships": [], "languages": []}
    live_path = vault / "Characters" / "NPCs" / "Live_Guy.md"
    live_path.write_text("---\ntype: npc\n" + node.emit_node(live_nd) + "---\nBody\n",
                         encoding="utf-8")

    # Queue still holds the Accepted create with resultElementId e-dead for the
    # deleted node, and an Accepted row for the live node.
    live_by_ref = {
        "ns:Characters/NPCs/Dead_Guy": {"state": "accepted", "element_id": "e-dead",
                                        "element_kind": "Person", "determined": {},
                                        "event_ids": {}},
        "ns:Characters/NPCs/Live_Guy": {"state": "accepted", "element_id": "e-live",
                                        "element_kind": "Person", "determined": {},
                                        "event_ids": {}},
    }
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon, "_fetch_live",
                        lambda world, token, *, verify=True: live_by_ref)
    # live_element_ids returns a non-empty set NOT containing e-dead.
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", lambda w, t: {"e-live"})

    rc = pull_canon.run(["w1", "--vault", str(vault), "--execute"])
    assert rc == 0

    # The node must STAY deleted (not resurrect).
    dead_out = node.read_node(dead_path.read_text(encoding="utf-8"))
    assert dead_out["review_state"] == "deleted"
    assert dead_out["element_id"] is None

    live_out = node.read_node(live_path.read_text(encoding="utf-8"))
    assert live_out["review_state"] == "accepted"
    assert live_out["element_id"] == "e-live"


def test_unreadable_live_ids_skips_gate_with_warning(monkeypatch, tmp_path, capsys):
    vault = tmp_path / "vault"
    (vault / "Characters" / "NPCs").mkdir(parents=True)
    nd = {"world_id": "w1", "external_ref": "ns:Characters/NPCs/Maybe_Dead",
          "element_id": "e-old", "element_kind": "Person", "review_state": "accepted",
          "last_synced": "2020-01-01T00:00:00Z", "review_note": "", "determined": {},
          "relationships": [], "languages": []}
    path = vault / "Characters" / "NPCs" / "Maybe_Dead.md"
    path.write_text("---\ntype: npc\n" + node.emit_node(nd) + "---\nBody\n", encoding="utf-8")

    live_by_ref = {
        "ns:Characters/NPCs/Maybe_Dead": {"state": "accepted", "element_id": "e-new",
                                          "element_kind": "Person", "determined": {},
                                          "event_ids": {}},
    }
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon, "_fetch_live",
                        lambda world, token, *, verify=True: live_by_ref)

    def _boom(world, token):
        raise client.ApiError(503, "upstream down", "/world/w1/person")
    monkeypatch.setattr(pull_canon.pull, "live_element_ids", _boom)

    rc = pull_canon.run(["w1", "--vault", str(vault), "--execute"])
    assert rc == 0

    # pull.live_element_ids raises ApiError -> pass runs as before (no
    # deletion gating), and a WARNING line is printed to stderr.
    err = capsys.readouterr().err
    assert "WARNING" in err

    out = node.read_node(path.read_text(encoding="utf-8"))
    assert out["review_state"] == "accepted"
    assert out["element_id"] == "e-new"


def test_live_element_ids_raises_instead_of_returning_a_short_set(monkeypatch):
    from mobrpg.commands import pull as pull_mod
    calls = []

    def fake(method, path, *, token=None, query=None, **kw):
        calls.append(path)
        if path.endswith("/organization"):
            raise client.ApiError(500, "boom", path)
        return {"content": [{"id": "e1"}], "page": {"totalPages": 1}}
    monkeypatch.setattr(pull_mod.client, "_request", fake)
    with pytest.raises(client.ApiError):
        pull_mod.live_element_ids("w1", "tok")


def test_live_element_ids_tolerates_a_kind_with_an_empty_body(monkeypatch):
    """A kind holding no elements answers with an empty/non-JSON body, which the
    client surfaces as ValueError. That is "no rows", not "the world is
    unreadable" — the Space world's /race endpoint does exactly this, and
    treating it as a failure aborted `--reconcile-deletions` on every run.
    An ApiError still propagates, because that IS a failed read.
    """
    from mobrpg.commands import pull as pull_mod

    def fake(method, path, *, token=None, query=None, **kw):
        if path.endswith("/race"):
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return {"content": [{"id": f"{path.rsplit('/', 1)[1]}-1"}],
                "page": {"totalPages": 1}}
    monkeypatch.setattr(pull_mod.client, "_request", fake)
    ids = pull_mod.live_element_ids("w1", "tok")
    assert "person-1" in ids and "item-1" in ids
    assert not any(i.startswith("race") for i in ids)


def test_live_element_ids_follows_pagination(monkeypatch):
    from mobrpg.commands import pull as pull_mod

    def fake(method, path, *, token=None, query=None, **kw):
        page = (query or {}).get("page", 0)
        return {"content": [{"id": f"{path.rsplit('/', 1)[1]}-{page}"}],
                "page": {"totalPages": 2}}
    monkeypatch.setattr(pull_mod.client, "_request", fake)
    ids = pull_mod.live_element_ids("w1", "tok")
    assert "person-0" in ids and "person-1" in ids


def _attr(src_type, name):
    return {"id": "r", "type": "Attribute", "sourceId": "s", "targetId": "t",
            "source": {"type": src_type, "name": name}}


def test_canon_determined_reads_the_relation_endpoint_not_the_element():
    """GET /world/{id}/{kind}/{eid} returns `relations: []` for these elements —
    an empty stub, not an empty truth. Deriving `determined` from the element
    payload concludes every classifier was removed upstream and would wipe the
    block on every linked node. The /relation rows carry the real edges."""
    from mobrpg.commands import pull_canon
    # the element payload lies
    assert pull_canon.determined_from_element({"relations": []}) == {}
    # the relation rows tell the truth
    rows = [_attr("PoliticalType", "Gate")]
    assert pull_canon.determined_from_element({"relations": rows}) == {"political_type": "Gate"}


def test_refresh_only_overwrites_keys_canon_has_an_opinion_on(monkeypatch, tmp_path):
    """Canon silence is not contradiction. Many elements carry no classifier
    upstream at all, and a local value may be a proposal not yet pushed, so a
    key canon says nothing about must survive."""
    from mobrpg.commands import pull_canon
    old = {"political_type": "Hyperspace Gate", "profession": "Gatekeeper"}
    canon = pull_canon.determined_from_element({"relations": [_attr("PoliticalType", "Gate")]})
    merged = dict(old)
    merged.update(canon)
    assert merged == {"political_type": "Gate", "profession": "Gatekeeper"}


# ---------------------------------------------------------------------------
# #151 — updates carry their own `upd/<relpath>#<hash>` ref namespace, so an
# accept/dismiss of one update never burns the note's create ref. pull-canon
# maps such a ref back to its note and adjudicates the push the note is actually
# waiting on — the one whose ref it recorded in `pending_ref`.
# ---------------------------------------------------------------------------

def test_upd_ref_never_scaffolds(tmp_path):
    # `upd` exists as a real directory here, so the fail-closed known-root rule
    # would ADMIT this ref; what rejects it is the reserved-roots blocklist.
    (tmp_path / "upd").mkdir()
    assert not pull_canon._scaffoldable("ns:upd/People/x#abc123def456", str(tmp_path))


def test_note_ref_strips_upd_namespace():
    assert pull_canon._note_ref("ns:upd/People/x#abc123def456") == "ns:People/x"
    assert pull_canon._note_ref("ns:People/x") == "ns:People/x"
    assert pull_canon._note_ref("ns:rel/People/x") == "ns:rel/People/x"


REF_A = "ns:upd/Creatures/marsh-hag#aaaaaaaaaaaa"
REF_B = "ns:upd/Creatures/marsh-hag#bbbbbbbbbbbb"


def _pending_push_vault(tmp_path, pending_ref=REF_A, name="marsh-hag"):
    """A note in the state `sync` leaves behind after filing an update: a linked
    node marked review_state pending, recording the update ref it awaits."""
    vault = tmp_path / "vault"
    (vault / "Creatures").mkdir(parents=True)
    nd = {"world_id": "w1", "external_ref": f"ns:Creatures/{name}",
          "element_id": "e-77", "element_kind": "Creature", "review_state": "pending",
          "last_synced": "2020-01-01T00:00:00Z", "review_note": "",
          "determined": {}, "relationships": [], "languages": []}
    if pending_ref is not None:
        nd["pending_ref"] = pending_ref
    p = vault / "Creatures" / f"{name}.md"
    p.write_text("---\ntype: creature\n" + node.emit_node(nd) + "---\nBody\n",
                 encoding="utf-8")
    return vault, p


def _queue(monkeypatch, by_state, elements=None):
    fake = _FakeApi(by_state=by_state, elements=elements or {})
    monkeypatch.setattr(pull_canon.client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(pull_canon.client, "_request", fake)
    return fake


def test_accepted_upd_suggestion_adjudicates_pending_note(tmp_path, monkeypatch):
    vault, p = _pending_push_vault(tmp_path)
    _queue(monkeypatch, {"Accepted": [_sug(REF_A, "e-77", etype="Creature")]},
           elements={"e-77": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    out = node.read_node(p.read_text(encoding="utf-8"))
    assert out["review_state"] == "accepted"
    assert out["last_synced"] not in ("", "2020-01-01T00:00:00Z")
    assert out.get("pending_ref", "") == ""            # claim released
    stamp = lww.parse_ts(out["last_synced"])
    assert stamp is not None and os.path.getmtime(p) == stamp   # mtime pinned


def test_dismissed_upd_suggestion_clears_pending(tmp_path, monkeypatch):
    vault, p = _pending_push_vault(tmp_path)
    _queue(monkeypatch, {"Dismissed": [_sug(REF_A, None, etype="Creature",
                                            note="not canon")]})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    out = node.read_node(p.read_text(encoding="utf-8"))
    assert out["review_state"] == "dismissed"
    assert out["review_note"] == "not canon"
    assert out["last_synced"] not in ("", "2020-01-01T00:00:00Z")
    assert out.get("pending_ref", "") == ""


def test_pending_upd_suggestion_leaves_the_note_alone(tmp_path, monkeypatch, capsys):
    vault, p = _pending_push_vault(tmp_path)
    before = p.read_text(encoding="utf-8")
    _queue(monkeypatch, {"Pending": [_sug(REF_A, None, etype="Creature")]})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    assert p.read_text(encoding="utf-8") == before
    assert "0 node(s) updated" in capsys.readouterr().out


def test_stale_terminal_upd_row_does_not_adjudicate_a_newer_push(tmp_path, monkeypatch,
                                                                 capsys):
    """Accepted/Dismissed rows live in the queue forever.

    After accept -> re-edit -> re-push, the note is pending on a NEW ref while the
    OLD terminal row still answers for the same note path. Matching on the note
    path alone let that stale row adjudicate the new episode — stamping a verdict
    (and, when dismissed, a review note) the GM never gave to this content, and
    leaving the real row unreviewable. Only the ref the note is waiting on counts.
    """
    vault, p = _pending_push_vault(tmp_path, pending_ref=REF_B)
    before = p.read_text(encoding="utf-8")
    _queue(monkeypatch, {"Accepted": [_sug(REF_A, "e-77", etype="Creature")]},
           elements={"e-77": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    assert p.read_text(encoding="utf-8") == before      # still pending on REF_B
    assert "0 node(s) updated" in capsys.readouterr().out


def test_only_the_awaited_row_adjudicates_when_several_are_queued(tmp_path, monkeypatch):
    # The stale accepted row (REF_A) and the awaited dismissed one (REF_B) both
    # answer for this note; the note's own pending_ref decides which wins.
    vault, p = _pending_push_vault(tmp_path, pending_ref=REF_B)
    _queue(monkeypatch,
           {"Accepted": [_sug(REF_A, "e-77", etype="Creature")],
            "Dismissed": [_sug(REF_B, None, etype="Creature", note="stale prose")]},
           elements={"e-77": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    out = node.read_node(p.read_text(encoding="utf-8"))
    assert out["review_state"] == "dismissed"
    assert out["review_note"] == "stale prose"
    assert out.get("pending_ref", "") == ""


def test_legacy_pending_note_without_pending_ref_is_not_adjudicated(tmp_path, monkeypatch,
                                                                    capsys):
    # A note pushed before #151 records no pending_ref; its adjudication belongs to
    # the create-ref/apply_state path, not to a guess from an upd row.
    vault, p = _pending_push_vault(tmp_path, pending_ref=None)
    before = p.read_text(encoding="utf-8")
    _queue(monkeypatch, {"Accepted": [_sug(REF_A, "e-77", etype="Creature")]},
           elements={"e-77": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    assert p.read_text(encoding="utf-8") == before
    assert "0 node(s) updated" in capsys.readouterr().out


def test_upd_ref_dry_run_writes_nothing_and_counts_what_execute_would(tmp_path,
                                                                      monkeypatch, capsys):
    # Several upd rows for one note must not inflate the dry-run count above the
    # one node --execute would actually write.
    vault, p = _pending_push_vault(tmp_path, pending_ref=REF_B)
    before = p.read_text(encoding="utf-8")
    _queue(monkeypatch,
           {"Accepted": [_sug(REF_A, "e-77", etype="Creature")],
            "Dismissed": [_sug(REF_B, None, etype="Creature", note="not canon")]},
           elements={"e-77": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault)]) == 0
    dry = capsys.readouterr().out
    assert p.read_text(encoding="utf-8") == before
    assert "dry-run" in dry and "1 node(s) updated" in dry

    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    assert "1 node(s) updated" in capsys.readouterr().out      # same count, now real


def test_upd_row_without_a_note_is_reported_not_silently_dropped(tmp_path, monkeypatch,
                                                                 capsys):
    # Not the NOT SCAFFOLDED report — an update ref must never scaffold — but not
    # silence either: an adjudication with nowhere to land is a real finding.
    vault = tmp_path / "vault"
    (vault / "Creatures").mkdir(parents=True)
    _queue(monkeypatch,
           {"Accepted": [_sug("ns:upd/Creatures/ghost#abc123def456", "e-9",
                              etype="Creature")]},
           elements={"e-9": {"type": "creature", "relations": []}})
    assert pull_canon.run(["w1", "--vault", str(vault), "--execute"]) == 0
    out = capsys.readouterr().out
    assert list(vault.rglob("*.md")) == []
    assert "0 node(s) updated" in out
    assert "NOT SCAFFOLDED" not in out
    assert "1 update suggestion(s) skipped" in out

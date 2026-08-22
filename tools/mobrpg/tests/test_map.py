import json
import os
import unicodedata

from mobrpg import client
from mobrpg import node
from mobrpg.commands import map_cmd as m


def test_derive_namespace_from_node(tmp_path):
    # a note carrying a mobrpg: node -> namespace is the ref prefix, not a basename
    p = tmp_path / "Locations" / "Eris II.md"
    p.parent.mkdir(parents=True)
    body = node.write_node(
        "---\ntype: location\n---\nbody\n",
        {"external_ref": "space_game:Locations/Eris II", "element_id": "e1"})
    p.write_text(body, encoding="utf-8")
    assert m.derive_namespace(str(tmp_path)) == "space_game"


def test_derive_namespace_basename_fallback(tmp_path):
    # no note has a node -> fall back to the vault directory basename
    d = tmp_path / "my_campaign"
    (d / "Locations").mkdir(parents=True)
    (d / "Locations" / "Nile.md").write_text(
        "---\ntype: location\n---\nbody\n", encoding="utf-8")
    assert m.derive_namespace(str(d)) == "my_campaign"
    # trailing slash is tolerated
    assert m.derive_namespace(str(d) + "/") == "my_campaign"


def test_init_writes_derived_vault_namespace(tmp_path, monkeypatch):
    p = tmp_path / "Locations" / "Eris II.md"
    p.parent.mkdir(parents=True)
    body = node.write_node(
        "---\ntype: location\n---\nbody\n",
        {"external_ref": "space_game:Locations/Eris II", "element_id": "e1"})
    p.write_text(body, encoding="utf-8")
    monkeypatch.setenv("MOBRPG_TOKEN", "tok")
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(m, "discover", lambda world, token: {
        k: {} for k in ("political/type", "organization/type", "creature/type",
                        "person/race", "person/profession", "language", "landfeature")})
    monkeypatch.setattr(client, "_request", lambda *a, **k: [])
    out = tmp_path / "map.json"
    rc = m.run(["init", "w1", "--vault", str(tmp_path), "--out", str(out),
                "--now", "2026-01-01T00:00:00+00:00"])
    assert rc == 0
    data = json.loads(out.read_text())
    assert data["vaultNamespace"] == "space_game"


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


def test_classifier_name_strips_markup_that_must_never_reach_mobrpg():
    # A classifier name is a shared-vocabulary label in someone else's world. The GM's
    # occupation field is rich free text and stays that way in the vault; the pushed
    # label must be the clean base profession only.
    cases = {
        # wikilink markup must never leak upstream, however it is embedded
        "Recovery agent (contracted to [[Corvid Financial]])": "Recovery Agent",
        "Senior Compliance Officer — [[Castellan Biodynamics]], Asset Recovery": "Senior Compliance Officer",
        "Security guard, [[Nova Nexus]]": "Security Guard",
        # parenthetical qualifiers pollute a shared vocabulary with one-offs
        "Assassin (Serene Syndicate orbit)": "Assassin",
        "Bare-knuckle boxing champion (Thides system)": "Bare-Knuckle Boxing Champion",
        "Leader of Station Security (MacMillian Station IV)": "Leader Of Station Security",
        # clean values pass through unchanged (bar title-casing at the call site)
        "Station 45 Gang Member": "Station 45 Gang Member",
        "Enforcer": "Enforcer",
    }
    for raw, want in cases.items():
        got = m.classifier_name(raw)
        assert "[[" not in got and "(" not in got, f"{raw!r} -> {got!r} still has markup"
        assert got.title() == want, f"{raw!r} -> {got.title()!r}, wanted {want!r}"


def test_classifier_name_leaves_hyphenated_words_intact():
    # the em-dash clause stripper keys on a SPACED dash; hyphenated words have none.
    assert m.classifier_name("Bare-knuckle boxing champion") == "Bare-knuckle boxing champion"
    assert m.classifier_name("Sub-warden") == "Sub-warden"


def test_classifier_name_never_leaks_markup_even_when_malformed():
    # The invariant is absolute: no bracket or paren character survives, however
    # broken the input. Best-effort on the residual words; the guarantee is no leak.
    for raw in ["Recovery agent [[Corvid Financial",        # unclosed wikilink
                "Agent [[Corvid]",                           # single closing bracket
                "Assassin (Serene (elite) orbit)",           # nested parens
                "Assassin (Serene Syndicate orbit",          # unclosed paren
                "Guard ([[Nova]]"]:                          # mixed unbalanced
        got = m.classifier_name(raw)
        assert not (set("[]()") & set(got)), f"{raw!r} -> {got!r} leaked markup"
    # nested parens still recover the clean base term
    assert m.classifier_name("Assassin (Serene (elite) orbit)") == "Assassin"


def test_bind_stores_a_clean_name():
    # the name minted into the map (and thence a mobRPG create) is already sanitized.
    got = m._bind("Recovery agent (contracted to [[Corvid Financial]])", {}, "person/profession")
    assert got["name"] == "Recovery Agent"


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


def test_merge_keeps_a_resolved_binding_against_a_fresh_review():
    # The real space_game case: the GM bound org type `government` to Tim's existing
    # "Governmental". On the next run the near-duplicate matcher rediscovers that same
    # type by fuzzy match and proposes it as `review` -- a *proposal* must never
    # overwrite an already-*resolved* binding, and the save must not be silent.
    bound = {"target": "organization/type", "name": "Governmental",
             "mobrpgId": "929998de", "status": "bound"}
    old = {"classifiers": {"organizationType": {"government": bound}}}
    new = {"classifiers": {"organizationType": {"government": {
        "target": "organization/type", "name": "Government", "mobrpgId": None,
        "status": "review", "nearExisting": "governmental", "nearId": "929998de"}}}}
    merged, notes = m._merge(old, new)
    assert merged["classifiers"]["organizationType"]["government"] == bound
    assert any("government" in n for n in notes), "preservation must be reported, not silent"


def test_merge_keeps_a_resolved_location_route_against_a_fresh_proposal():
    # Same rule for locationRouting: a hand-made re-route carrying a real mobrpgId
    # survives a recomputed near-duplicate proposal.
    bound = {"target": "political", "politicalType": "Spaceship",
             "mobrpgId": "1ebccd7d", "status": "bound"}
    old = {"locationRouting": {"spaceship": bound}}
    new = {"locationRouting": {"spaceship": {"target": "political",
                                            "politicalType": "Spaceship",
                                            "mobrpgId": None, "status": "review",
                                            "nearExisting": "spaceship",
                                            "nearId": "1ebccd7d"}}}
    merged, notes = m._merge(old, new)
    assert merged["locationRouting"]["spaceship"] == bound
    assert any("spaceship" in n and "kept" in n for n in notes)


def test_merge_downgrades_a_binding_whose_upstream_type_vanished():
    # A fresh entry with NO id and no near-match means canon no longer has a type for
    # this value at all -- the held id is dangling. Keep it (a discovery blip must not
    # destroy the GM's decision) but stop claiming `bound`, so `map check` surfaces it
    # instead of silently reporting a healthy binding.
    old = {"classifiers": {"organizationType": {"cult": {
        "target": "organization/type", "name": "Cult",
        "mobrpgId": "gone-id", "status": "bound"}}}}
    new = {"classifiers": {"organizationType": {"cult": {
        "target": "organization/type", "name": "Cult",
        "mobrpgId": None, "status": "new"}}}}
    merged, notes = m._merge(old, new)
    entry = merged["classifiers"]["organizationType"]["cult"]
    assert entry["mobrpgId"] == "gone-id"          # decision not destroyed
    assert entry["status"] == "review"             # but no longer claims to be bound
    assert any("cult" in n and "no longer" in n for n in notes)
    # and it must be stable, not oscillate on the next sync
    again, _ = m._merge(merged, new)
    assert again["classifiers"]["organizationType"]["cult"] == entry


def test_merge_lets_a_stale_key_come_back_to_life():
    # A `stale` entry is a tombstone for a value that left the vault, not a resolution.
    # If the vault re-adds the value, the fresh entry must win -- otherwise the key is
    # frozen as stale forever, because every later sync sees the same tombstone.
    old = {"classifiers": {"organizationType": {"guild": {
        "target": "organization/type", "name": "Guild",
        "mobrpgId": "abc123", "status": "stale"}}}}
    fresh = {"target": "organization/type", "name": "Guild",
             "mobrpgId": None, "status": "new"}
    merged, _ = m._merge(old, {"classifiers": {"organizationType": {"guild": fresh}}})
    assert merged["classifiers"]["organizationType"]["guild"] == fresh


def test_merge_does_not_mutate_its_inputs():
    # `merged = dict(new)` is shallow, so writing merged["classifiers"][g] would reach
    # through into the caller's `new`.
    old = {"classifiers": {"organizationType": {"dropped": {"status": "bound",
                                                           "mobrpgId": "x"}}}}
    new = {"classifiers": {"organizationType": {"kept": {"status": "new",
                                                        "mobrpgId": None}}}}
    before = json.loads(json.dumps(new))
    m._merge(old, new)
    assert new == before, "merge leaked stale entries back into its `new` argument"


def test_merge_takes_a_fresh_binding_that_resolves_differently():
    # Preservation applies only against proposals. If canon now resolves the value to a
    # real (different) type, that is itself a resolution -- take it, and say so.
    old = {"classifiers": {"organizationType": {"guild": {
        "target": "organization/type", "name": "Guild",
        "mobrpgId": "old-id", "status": "bound"}}}}
    new = {"classifiers": {"organizationType": {"guild": {
        "target": "organization/type", "name": "Guild",
        "mobrpgId": "new-id", "status": "bound"}}}}
    merged, notes = m._merge(old, new)
    assert merged["classifiers"]["organizationType"]["guild"]["mobrpgId"] == "new-id"
    assert any("guild" in n for n in notes)


# --- #148: fold case/whitespace/unicode when matching vocab keys -----------

def test_merge_section_folds_case_no_stale_no_duplicate():
    old = {"chitinoteuthis": {"target": "creature/type", "mobrpgId": "id-1",
                              "status": "bound"}}
    new = {"Chitinoteuthis": {"target": "creature/type", "mobrpgId": None,
                              "status": "new"}}
    notes = []
    res = m._merge_section(old, new, "classifiers.creatureType", notes)
    assert list(res) == ["Chitinoteuthis"]           # vault casing wins, one entry
    assert res["Chitinoteuthis"]["mobrpgId"] == "id-1"
    assert res["Chitinoteuthis"]["status"] == "bound"
    assert not any("stale" in n for n in notes)


def test_merge_section_folds_whitespace_and_nfc():
    old = {"thideian chitinoteuthis ": {"mobrpgId": "id-1", "status": "bound"}}
    new = {"Thideian  Chitinoteuthis": {"mobrpgId": None, "status": "new"}}
    res = m._merge_section(old, new, "x", [])
    assert list(res) == ["Thideian  Chitinoteuthis"]
    assert res["Thideian  Chitinoteuthis"]["mobrpgId"] == "id-1"


def test_merge_section_still_flags_genuinely_gone_keys_stale():
    old = {"lamprey": {"mobrpgId": "id-2", "status": "bound"}}
    notes = []
    res = m._merge_section(old, {}, "x", notes)
    assert res["lamprey"]["status"] == "stale"
    assert any("stale" in n for n in notes)


def test_merge_section_stale_old_entry_revives_as_fresh_under_new_casing():
    # C1 (review): the fold-match shortcut must be gated to status=="bound" only.
    # A stale tombstone under the old casing must still revive as the fresh
    # proposal per _entry's stale rule, not get stuck as "stale" forever just
    # because the new casing folds to the same key.
    old = {"chitinoteuthis": {"target": "creature/type", "mobrpgId": "id-1",
                              "status": "stale"}}
    new = {"Chitinoteuthis": {"target": "creature/type", "mobrpgId": None,
                              "status": "new"}}
    res = m._merge_section(old, new, "x", [])
    assert list(res) == ["Chitinoteuthis"]
    assert res["Chitinoteuthis"]["status"] == "new"
    assert res["Chitinoteuthis"]["mobrpgId"] is None


def test_merge_section_confirmed_old_entry_wins_under_fold_mismatched_key():
    # C1 (review): a confirmed (human) decision must still win via _entry's
    # confirmed rule even when it is only reached via a fold-matched, not
    # literal, key -- the "bound" shortcut must not bypass this.
    old = {"chitinoteuthis": {"target": "creature/type", "mobrpgId": "id-1",
                              "confirmed": True}}
    new = {"Chitinoteuthis": {"target": "creature/type", "mobrpgId": None,
                              "status": "new"}}
    res = m._merge_section(old, new, "x", [])
    assert res["Chitinoteuthis"] == old["chitinoteuthis"]


def test_merge_section_collapses_old_side_case_variant_duplicates():
    # Important 2 (review): a pre-#148 sync could already have split one term
    # into a stale tombstone plus a bound duplicate under the old (unfolded)
    # matching. A later sync must collapse both old keys onto ONE output entry
    # (the bound one wins) and report the cleanup, not let iteration order
    # silently decide which survives.
    old = {
        "chitinoteuthis": {"target": "creature/type", "mobrpgId": "id-1", "status": "stale"},
        "CHITINOTEUTHIS": {"target": "creature/type", "mobrpgId": "id-1", "status": "bound"},
    }
    new = {"Chitinoteuthis": {"target": "creature/type", "mobrpgId": None, "status": "new"}}
    notes = []
    res = m._merge_section(old, new, "x", notes)
    assert list(res) == ["Chitinoteuthis"]
    assert res["Chitinoteuthis"]["status"] == "bound"
    assert res["Chitinoteuthis"]["mobrpgId"] == "id-1"
    assert any("collapsed duplicate" in n for n in notes)


def test_merge_section_second_new_side_duplicate_does_not_reuse_old_binding():
    # Minor 4 (review): two DISTINCT vault-side keys that both fold to the same
    # term must not both claim the same old mobrpgId. The first wins the
    # binding; the second is treated as its own (unbound) entry, with a note.
    old = {"chitinoteuthis": {"target": "creature/type", "mobrpgId": "id-1", "status": "bound"}}
    new = {
        "Chitinoteuthis": {"target": "creature/type", "mobrpgId": None, "status": "new"},
        "CHITINOTEUTHIS": {"target": "creature/type", "mobrpgId": None, "status": "new"},
    }
    notes = []
    res = m._merge_section(old, new, "x", notes)
    assert res["Chitinoteuthis"]["mobrpgId"] == "id-1"          # first match wins the binding
    assert res["Chitinoteuthis"]["status"] == "bound"
    assert res["CHITINOTEUTHIS"]["mobrpgId"] is None             # second match gets its own entry
    assert res["CHITINOTEUTHIS"]["status"] == "new"
    assert any("duplicate" in n for n in notes)


def test_merge_section_folds_unicode_nfc_vs_nfd():
    # Minor 6 (review): a real NFC-vs-NFD pair, not just an ASCII case/space
    # difference -- the same visible term encoded two different ways.
    nfd_key = unicodedata.normalize("NFD", "Tichá Chitinoteuthis")  # decomposed accent
    nfc_key = "Tichá Chitinoteuthis"                                 # precomposed
    old = {nfd_key: {"target": "creature/type", "mobrpgId": "id-7", "status": "bound"}}
    new = {nfc_key: {"target": "creature/type", "mobrpgId": None, "status": "new"}}
    res = m._merge_section(old, new, "x", [])
    assert list(res) == [nfc_key]
    assert res[nfc_key]["mobrpgId"] == "id-7"
    assert res[nfc_key]["status"] == "bound"


def test_init_then_sync(tmp_path, monkeypatch):
    vault = _make_vault(tmp_path)
    # mobRPG starts with only "District" as a political type
    state = {"political/type": [{"name": "District", "id": "dist-id"}]}

    def fake(method, path, *, token=None, query=None, body=None):
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


def test_build_map_sex_name_is_sanitized(tmp_path):
    # B3: the sex classifier was built as `v.title()`, bypassing classifier_name(),
    # so a gender value carrying markup leaked it into the map (and thence a push).
    disc = {k: {} for k in ("political/type", "organization/type", "creature/type",
                            "person/race", "person/profession", "language", "landfeature")}
    vocab = {"location_type": {}, "occupation": {}, "gender": {"male [[note]]": 1},
             "faction_type": {}, "creature_type": {}, "predicate": {}}
    mp = m.build_map("w1", {"name": "W"}, str(tmp_path), disc, vocab, "T0")
    entry = mp["classifiers"]["sex"]["male [[note]]"]
    assert not (set("[]") & set(entry["name"])), f"markup leaked: {entry['name']!r}"


def test_discover_follows_pagination(monkeypatch):
    # The old ?size=500 single fetch had no totalPages handling: a classifier kind
    # spanning more than one page was silently truncated (minting duplicate types).
    pages = {
        0: {"content": [{"name": "Priest", "id": "p1"}], "page": {"totalPages": 2}},
        1: {"content": [{"name": "Scholar", "id": "s1"}], "page": {"totalPages": 2}},
    }

    def stub(method, path, *, token=None, query=None, body=None):
        if "person/profession" in path:
            page = (query or {}).get("page", 0)
            return pages.get(page, {"content": [], "page": {"totalPages": 2}})
        return {"content": [], "page": {"totalPages": 1}}
    monkeypatch.setattr(client, "_request", stub)
    disc = m.discover("w1", "tok")
    assert disc["person/profession"] == {"priest": "p1", "scholar": "s1"}


def test_sync_preserves_confirmed(tmp_path, monkeypatch):
    vault = _make_vault(tmp_path)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda method, path, *, token=None, query=None, body=None:
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


def test_merge_preserves_unknown_top_level_keys():
    # `map sync` rebuilds the map from build_map's output, which knows nothing
    # about hand-authored top-level config. Dropping it silently deleted a GM's
    # `vaultOnlySections` list, and the very next `sync` reverted to the default
    # vault-only sections — pushing sections the vault had opted out — with no
    # warning anywhere.
    old = {"schema": "mobrpg-vault-map/v1",
           "vaultOnlySections": ["GM Notes", "Secrets"],
           "someFutureKey": {"a": 1},
           "classifiers": {}, "locationRouting": {}}
    new = {"schema": "mobrpg-vault-map/v1", "classifiers": {}, "locationRouting": {}}
    merged, _ = m._merge(old, new)
    assert merged["vaultOnlySections"] == ["GM Notes", "Secrets"]
    assert merged["someFutureKey"] == {"a": 1}


def test_merge_lets_a_rediscovered_value_win_over_the_old_one():
    # The carry-over is for keys build_map does NOT produce; a key it does
    # produce must still come from the fresh discovery.
    old = {"world": "Old Name", "classifiers": {}, "locationRouting": {}}
    new = {"world": "New Name", "classifiers": {}, "locationRouting": {}}
    assert m._merge(old, new)[0]["world"] == "New Name"

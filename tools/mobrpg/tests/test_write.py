import json
from mobrpg.commands import write_cmd


def test_write_materializes_extract(tmp_path):
    extract = {"entities": [{
        "kind": "person", "name": "Vela Kesh", "body_md": "A smuggler.",
        "relationships": [], "altNames": ["The Fox"],
        "notes_public": [], "notes_gm": ["Owes Tim money."], "classifiers": [],
    }]}
    src = tmp_path / "extract.json"
    src.write_text(json.dumps(extract), encoding="utf-8")
    out = tmp_path / "vault"
    rc = write_cmd.run([str(src), "--out", str(out), "--campaign", "Test Run"])
    assert rc == 0
    files = list(out.rglob("*.md"))
    assert len(files) == 1
    txt = files[0].read_text(encoding="utf-8")
    assert "Vela Kesh" in txt and "A smuggler." in txt
    assert "campaign: " in txt and "Test Run" in txt
    assert "## GM Notes" in txt and "Owes Tim money." in txt


def test_faction_part_of_scalar_is_derived_from_the_edge(tmp_path):
    # Faction/Organization carry a scalar `part_of` as well as the edge. It was
    # emitted hardcoded-empty while the edge was preserved, so a faction with a
    # real parent shipped with the two disagreeing.
    extract = {"entities": [{
        "id": "f1", "name": "Ashen Cell", "kind": "organization",
        "body_md": "A splinter group.", "notes_public": [], "notes_gm": [],
        "classifiers": [],
        "relationships": [{"target": "The Ashen Hand", "predicate": "part_of"}],
    }]}
    ep = tmp_path / "extract.json"
    ep.write_text(json.dumps(extract), encoding="utf-8")
    vault = tmp_path / "vault"
    write_cmd.run([str(ep), "--out", str(vault)])
    txt = next(vault.rglob("Ashen_Cell.md")).read_text(encoding="utf-8")
    part_of = next(line for line in txt.splitlines() if line.startswith("part_of:"))
    assert part_of == 'part_of: "[[The_Ashen_Hand]]"', part_of   # slug style, as parent_location
    # and the edge is still present — scalar and edge agree, not one or the other
    assert "type: part_of" in txt


def test_write_skips_existing_note_without_overwrite(tmp_path, capsys):
    # (#186) `write` had no existence check: any note whose path matched an
    # entity in the extract was replaced wholesale, hand-authored prose and all.
    extract = {"entities": [{
        "kind": "person", "name": "Vela Kesh", "body_md": "A smuggler.",
        "relationships": [], "altNames": [],
        "notes_public": [], "notes_gm": [], "classifiers": [],
    }]}
    src = tmp_path / "extract.json"
    src.write_text(json.dumps(extract), encoding="utf-8")
    out = tmp_path / "vault"
    existing = out / "Characters/NPCs/Vela_Kesh.md"
    existing.parent.mkdir(parents=True)
    existing.write_text("HAND-AUTHORED — do not clobber\n", encoding="utf-8")

    rc = write_cmd.run([str(src), "--out", str(out)])

    assert rc == 0
    assert existing.read_text(encoding="utf-8") == "HAND-AUTHORED — do not clobber\n"
    printed = capsys.readouterr().out
    assert "--overwrite" in printed          # tells the user how to replace
    assert "skipped" in printed


def test_write_overwrite_flag_replaces_existing_note(tmp_path):
    extract = {"entities": [{
        "kind": "person", "name": "Vela Kesh", "body_md": "A smuggler.",
        "relationships": [], "altNames": [],
        "notes_public": [], "notes_gm": [], "classifiers": [],
    }]}
    src = tmp_path / "extract.json"
    src.write_text(json.dumps(extract), encoding="utf-8")
    out = tmp_path / "vault"
    existing = out / "Characters/NPCs/Vela_Kesh.md"
    existing.parent.mkdir(parents=True)
    existing.write_text("old\n", encoding="utf-8")

    rc = write_cmd.run([str(src), "--out", str(out), "--overwrite"])

    assert rc == 0
    txt = existing.read_text(encoding="utf-8")
    assert "A smuggler." in txt
    assert "old" not in txt          # wholesale replacement, not an append


def test_write_reports_unsupported_kinds(tmp_path, capsys):
    # An extract entity of a kind write can't map was dropped without a trace,
    # making the written+skipped summary look like a complete accounting.
    extract = {"entities": [
        {"kind": "person", "name": "Vela Kesh", "body_md": "", "relationships": [],
         "altNames": [], "notes_public": [], "notes_gm": [], "classifiers": []},
        {"kind": "currency", "name": "Imperial Crown", "body_md": "", "relationships": [],
         "altNames": [], "notes_public": [], "notes_gm": [], "classifiers": []},
    ]}
    src = tmp_path / "extract.json"
    src.write_text(json.dumps(extract), encoding="utf-8")

    rc = write_cmd.run([str(src), "--out", str(tmp_path / "vault")])

    assert rc == 0
    printed = capsys.readouterr().out
    assert "unsupported kind" in printed


def test_write_reports_slug_collisions(tmp_path, capsys):
    # slug() maps "A/B" and "AB" to the same file; the second must not silently
    # vanish (default) or silently replace the first (--overwrite).
    extract = {"entities": [
        {"kind": "person", "name": "A/B", "body_md": "first", "relationships": [],
         "altNames": [], "notes_public": [], "notes_gm": [], "classifiers": []},
        {"kind": "person", "name": "AB", "body_md": "second", "relationships": [],
         "altNames": [], "notes_public": [], "notes_gm": [], "classifiers": []},
    ]}
    src = tmp_path / "extract.json"
    src.write_text(json.dumps(extract), encoding="utf-8")

    rc = write_cmd.run([str(src), "--out", str(tmp_path / "vault")])

    assert rc == 0
    # (#254) both reach the vault, each in its own file, and the run says so
    npcs = tmp_path / "vault" / "Characters/NPCs"
    assert sorted(p.name for p in npcs.glob("*.md")) == ["AB.md", "AB_(2).md"]
    assert "second" in (npcs / "AB_(2).md").read_text(encoding="utf-8")
    printed = capsys.readouterr().out
    assert "share a name" in printed and "'AB'" in printed


# ---- #252-#255 import fixes -------------------------------------------------

from mobrpg import node as _node


def _run_write(tmp_path, entities, *extra, world="w1"):
    ep = tmp_path / "extract.json"
    ep.write_text(json.dumps({"worldId": world, "entities": entities}), encoding="utf-8")
    vault = tmp_path / "vault"
    rc = write_cmd.run([str(ep), "--out", str(vault), "--name-style", "space", *extra])
    assert rc == 0
    return vault


def _ent(eid, kind, name, body="", **kw):
    return {"id": eid, "kind": kind, "name": name, "body_md": body,
            "altNames": [], "notes_public": [], "notes_gm": [],
            "classifiers": [], "relationships": [], **kw}


def test_write_converts_element_urls_in_bodies_to_wikilinks(tmp_path):
    # (#252) every URL shape mobRPG emits, with and without a host
    body = ("Manager of the [Hockhaus](/world/w1/link/h1), "
            "friend of [Anna](https://www.mobrpg.com/world/w1/link/a1/detail.html), "
            "rival of [the Dunlap boy](http://localhost:3000/world/w1/element/person/d1), "
            "at [the fair](/world/w1/link/ev1) and [somewhere](/world/w1/link/zz9).")
    vault = _run_write(tmp_path, [
        _ent("p1", "person", "Otto Brandt", body),
        _ent("h1", "political", "Hockhaus"),
        _ent("a1", "person", "Anna"),
        _ent("d1", "person", "Reginald Dunlap"),
    ])
    txt = (vault / "Characters/NPCs/Otto Brandt.md").read_text(encoding="utf-8")
    assert "Manager of the [[Hockhaus]]," in txt
    assert "friend of [[Anna]]," in txt
    assert "rival of [[Reginald Dunlap|the Dunlap boy]]," in txt
    # an event id or an unknown id collapses to its display text
    assert "at the fair and somewhere." in txt
    assert "/world/" not in txt


def test_write_writes_creatures_and_cultures(tmp_path):
    # (#253) creature and culture (and race) were dropped as unsupported kinds
    vault = _run_write(tmp_path, [
        _ent("c1", "creature", "Mire Lamprey", "Eats boats.",
             classifiers=[{"kind": "creature/type", "name": "Beast"}]),
        _ent("k1", "culture", "Highland Clans", "Feuding herders."),
        _ent("r1", "race", "Selkie", "Seal-folk."),
    ])
    cr = (vault / "Creatures/Mire Lamprey.md").read_text(encoding="utf-8")
    assert "type: creature" in cr and 'creature_type: "Beast"' in cr and "Eats boats." in cr
    cu = (vault / "Heritages/Highland Clans.md").read_text(encoding="utf-8")
    assert "type: heritage" in cu and "## Culture\n\nFeuding herders." in cu
    ra = (vault / "Heritages/Selkie.md").read_text(encoding="utf-8")
    assert "type: heritage" in ra and "## Biology\n\nSeal-folk." in ra
    assert _node.read_node(cu)["element_kind"] == "Culture"
    assert _node.read_node(ra)["element_kind"] == "Race"


def test_write_disambiguates_same_name_elements_instead_of_dropping(tmp_path, capsys):
    # (#254) same-name elements all reach the vault, deterministically named
    vault = _run_write(tmp_path, [
        _ent("u2", "person", "Urban Baltin", "Second."),
        _ent("u1", "person", "Urban Baltin", "First."),
        _ent("u3", "person", "Urban Baltin", "Third."),
    ])
    npcs = vault / "Characters/NPCs"
    by_id = {_node.read_node(p.read_text(encoding="utf-8"))["element_id"]: p.name
             for p in npcs.glob("*.md")}
    assert by_id == {"u1": "Urban Baltin.md", "u2": "Urban Baltin (2).md",
                     "u3": "Urban Baltin (3).md"}
    second = (npcs / "Urban Baltin (2).md").read_text(encoding="utf-8")
    assert 'name: "Urban Baltin"' in second        # the name itself is unchanged
    assert "`u2`" in second                          # the callout names the element id
    assert "not written" not in capsys.readouterr().out


def test_write_rerun_keeps_each_element_on_its_existing_note(tmp_path):
    # (#254) a later pull with a new same-name element must not reshuffle files
    vault = _run_write(tmp_path, [_ent("u5", "person", "James V", "Old.")])
    vault = _run_write(tmp_path, [_ent("u1", "person", "James V", "New."),
                                  _ent("u5", "person", "James V", "Old.")])
    npcs = vault / "Characters/NPCs"
    assert _node.read_node((npcs / "James V.md").read_text())["element_id"] == "u5"
    assert _node.read_node((npcs / "James V (2).md").read_text())["element_id"] == "u1"


def test_write_stamps_an_accepted_node_so_adopt_is_not_needed(tmp_path):
    # (#254) write knows every element id, so the node goes on at write time
    ent = _ent("p1", "person", "Vela Kesh",
               relationships=[{"target": "Hockhaus", "targetId": "h1",
                               "predicate": "located_at", "eventType": "Employ",
                               "eventId": "ev1", "role": None}])
    vault = _run_write(tmp_path, [ent, _ent("h1", "political", "Hockhaus")], world="w9")
    nd = _node.read_node((vault / "Characters/NPCs/Vela Kesh.md").read_text())
    assert nd["world_id"] == "w9"
    assert nd["element_id"] == "p1"
    assert nd["element_kind"] == "Person"
    assert nd["review_state"] == "accepted"
    assert nd["external_ref"] == "vault:Characters/NPCs/Vela Kesh"
    assert nd["relationships"] == [{"predicate": "located_at", "target": "Hockhaus",
                                    "event_type": "Employ", "event_id": "ev1",
                                    "review_state": "accepted"}]


def test_write_relationship_links_follow_the_target_id(tmp_path):
    # (#254) with two same-name targets, the edge must point at the right file
    ent = _ent("s1", "person", "Reginald Dunlap Jr",
               relationships=[{"target": "Reginald Dunlap", "targetId": "d2",
                               "predicate": "child_of", "eventType": None,
                               "role": None}])
    vault = _run_write(tmp_path, [ent, _ent("d1", "person", "Reginald Dunlap"),
                                  _ent("d2", "person", "Reginald Dunlap")])
    txt = (vault / "Characters/NPCs/Reginald Dunlap Jr.md").read_text(encoding="utf-8")
    assert 'target: "[[Reginald Dunlap (2)]]"' in txt


def test_write_maps_c1_control_characters_through_cp1252(tmp_path):
    # (#255) \x92/\x91 are cp1252 quotes mis-decoded as Latin-1; YAML rejects them
    vault = _run_write(tmp_path, [_ent("p1", "person", "Seachlann O\x92Neill",
                                       "He said \x93aye\x94 \x96 once.",
                                       altNames=["Sea\x91chlann"])])
    p = next((vault / "Characters/NPCs").glob("*.md"))
    txt = p.read_text(encoding="utf-8")
    assert not any("\x80" <= ch <= "\x9f" for ch in txt)
    assert 'name: "Seachlann O’Neill"' in txt
    assert "He said “aye” – once." in txt
    assert "Sea‘chlann" in txt


def test_write_emits_canon_status_not_the_legacy_key(tmp_path):
    vault = _run_write(tmp_path, [_ent("p1", "person", "Vela Kesh")])
    txt = (vault / "Characters/NPCs/Vela Kesh.md").read_text(encoding="utf-8")
    assert "canon_status: AUTHORITATIVE" in txt
    assert "source_confidence" not in txt


def test_write_quotes_names_that_contain_double_quotes(tmp_path):
    vault = _run_write(tmp_path, [_ent("p1", "person", 'Jan "Red" Kowal')])
    txt = next((vault / "Characters/NPCs").glob("*.md")).read_text(encoding="utf-8")
    assert 'name: "Jan \\"Red\\" Kowal"' in txt


def test_write_skips_an_element_already_linked_in_another_folder(tmp_path, capsys):
    # review: a PC note linked to a Person must not gain an NPC twin carrying
    # the same element_id (two linked notes for one element, the #257 hazard)
    pc = tmp_path / "vault/Characters/PCs/Vela Kesh.md"
    pc.parent.mkdir(parents=True)
    pc.write_text(_node.write_node("---\ntype: pc\n---\nBody.\n",
                                   {"external_ref": "vault:Characters/PCs/Vela Kesh",
                                    "element_id": "p1"}), encoding="utf-8")
    other = _ent("o1", "person", "Otto", "Knows [Vela](/world/w1/link/p1).")
    vault = _run_write(tmp_path, [_ent("p1", "person", "Vela Kesh"), other])
    assert not (vault / "Characters/NPCs/Vela Kesh.md").exists()
    assert "Knows [[Vela Kesh|Vela]]." in (vault / "Characters/NPCs/Otto.md").read_text()
    out = capsys.readouterr().out
    assert "already linked" in out and "Characters/PCs/Vela Kesh.md" in out


def test_write_rerun_does_not_re_report_shared_names(tmp_path, capsys):
    ents = [_ent("u1", "person", "Urban Baltin"), _ent("u2", "person", "Urban Baltin")]
    _run_write(tmp_path, ents)
    capsys.readouterr()
    _run_write(tmp_path, ents)
    assert "share a name" not in capsys.readouterr().out


def test_write_hand_renamed_unique_note_gets_no_shared_name_callout(tmp_path):
    # the element is linked to a renamed note; it shares its name with nothing
    renamed = tmp_path / "vault/Characters/NPCs/Vela the Fox.md"
    renamed.parent.mkdir(parents=True)
    renamed.write_text(_node.write_node("---\ntype: npc\n---\nBody.\n",
                                        {"external_ref": "vault:Characters/NPCs/Vela the Fox",
                                         "element_id": "p1"}), encoding="utf-8")
    vault = _run_write(tmp_path, [_ent("p1", "person", "Vela Kesh")], "--overwrite")
    assert "Shared name" not in (vault / "Characters/NPCs/Vela the Fox.md").read_text()


def test_write_plain_style_disambiguates_without_a_space():
    recs = [{"_key": "a", "kind": "person", "name": "Urban Baltin"},
            {"_key": "b", "kind": "person", "name": "Urban Baltin"}]
    paths = write_cmd.plan_paths(recs, {}, "plain")
    assert paths["b"] == "Characters/NPCs/Urban_Baltin_(2).md"


def test_write_unicode_forms_of_one_name_get_distinct_files():
    # macOS treats NFC and NFD spellings as one file
    recs = [{"_key": "a", "kind": "person", "name": "José"},
            {"_key": "b", "kind": "person", "name": "José"}]
    paths = write_cmd.plan_paths(recs, {}, "space")
    assert paths["b"] == "Characters/NPCs/José (2).md"


def test_write_heritage_keeps_every_template_section(tmp_path):
    vault = _run_write(tmp_path, [_ent("k1", "culture", "Highland Clans", "Herders.")])
    txt = (vault / "Heritages/Highland Clans.md").read_text(encoding="utf-8")
    heads = [l for l in txt.splitlines() if l.startswith("## ")]
    assert heads[:4] == ["## Biology", "## Culture", "## History", "## Second-Order Notes"]
    assert "## Culture\n\nHerders." in txt


def test_write_keeps_the_import_note_in_a_vault_only_section(tmp_path):
    # every template's Reconstruction Note sits under ## Source References, a
    # vault-only section; the faction one sat under ## History and was pushed
    from mobrpg import section
    vault = _run_write(tmp_path, [_ent("f1", "organization", "Ashen Hand", "Cult."),
                                  _ent("p1", "person", "Vela"), _ent("l1", "political", "Eris"),
                                  _ent("i1", "item", "Lamp"), _ent("c1", "creature", "Maw"),
                                  _ent("k1", "culture", "Clans")])
    for p in vault.rglob("*.md"):
        body = p.read_text(encoding="utf-8").split("\n---\n", 1)[1]
        heads, cur = {}, None
        for line in body.splitlines():
            if line.startswith("## "):
                cur = line[3:].strip()
            elif "Reconstruction Note" in line:
                heads[p.name] = cur
        assert heads[p.name] in section.DEFAULT_VAULT_ONLY, (p.name, heads[p.name])

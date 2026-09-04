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
        {"kind": "creature", "name": "Void Maw", "body_md": "", "relationships": [],
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
    printed = capsys.readouterr().out
    assert "collision" in printed
    assert "A/B" in printed and "AB" in printed

import glob
import json
import os

from mobrpg.commands import link_orphans

NOTE = """---
type: location
name: {name}
relationships: []
---
# {name}
"""


def _vault(tmp_path):
    vault = tmp_path / "vault"
    locs = vault / "Locations"
    locs.mkdir(parents=True)
    (locs / "Corwin System.md").write_text(NOTE.format(name="Corwin System"), encoding="utf-8")
    (locs / "Corwin I.md").write_text(NOTE.format(name="Corwin I"), encoding="utf-8")
    return vault


def _extract(tmp_path):
    extract = {"entities": [
        {"id": "id-sys", "name": "Corwin System", "kind": "political", "relationships": []},
        {"id": "id-planet", "name": "Corwin I", "kind": "landfeature", "relationships": []},
    ]}
    p = tmp_path / "extract.json"
    p.write_text(json.dumps(extract), encoding="utf-8")
    return p


def test_dry_run_reports_but_does_not_edit_vault_or_emit_sh(tmp_path):
    vault = _vault(tmp_path)
    extract = _extract(tmp_path)
    out = tmp_path / "out"
    planet_before = (vault / "Locations" / "Corwin I.md").read_text(encoding="utf-8")

    rc = link_orphans.run([str(extract), "--vault", str(vault),
                            "--out", str(out), "--systems", "Corwin"])

    assert rc == 0
    # vault untouched
    assert (vault / "Locations" / "Corwin I.md").read_text(encoding="utf-8") == planet_before
    # report present and names the derived link
    report = (out / "orphan-linking-report.md").read_text(encoding="utf-8")
    assert "Corwin I" in report and "Corwin System" in report and "part_of" in report
    data = json.loads((out / "orphan-linking.json").read_text(encoding="utf-8"))
    assert any(l["entity"] == "Corwin I" and l["target"] == "Corwin System"
               for l in data["linked"])
    # never emitted, dry-run or otherwise
    assert not glob.glob(os.path.join(out, "*.sh"))


def test_execute_adds_frontmatter_edge_and_still_no_sh(tmp_path):
    vault = _vault(tmp_path)
    extract = _extract(tmp_path)
    out = tmp_path / "out"

    rc = link_orphans.run([str(extract), "--vault", str(vault),
                            "--out", str(out), "--systems", "Corwin", "--execute"])

    assert rc == 0
    txt = (vault / "Locations" / "Corwin I.md").read_text(encoding="utf-8")
    assert '- target: "[[Corwin System]]"' in txt
    assert "type: part_of" in txt
    # the system note (no derivable parent) is untouched
    sys_txt = (vault / "Locations" / "Corwin System.md").read_text(encoding="utf-8")
    assert "relationships: []" in sys_txt
    assert not glob.glob(os.path.join(out, "*.sh"))


def test_systems_flag_defaults_empty_so_nothing_derives(tmp_path):
    vault = _vault(tmp_path)
    extract = _extract(tmp_path)
    out = tmp_path / "out"

    rc = link_orphans.run([str(extract), "--vault", str(vault), "--out", str(out)])

    assert rc == 0
    data = json.loads((out / "orphan-linking.json").read_text(encoding="utf-8"))
    assert data["linked"] == []
    assert any(n == "Corwin I" for _k, n in data["still_orphan"])


NOTE_NO_RELS = """---
type: location
name: {name}
---
# {name}
"""


def test_note_without_relationships_key_is_reported_not_claimed(tmp_path):
    # re.sub returns the text unchanged when nothing matches. That used to be
    # written back byte-identical while the report still claimed the link was
    # created — the edge vanished and the report lied about it.
    vault = tmp_path / "vault"
    locs = vault / "Locations"
    locs.mkdir(parents=True)
    (locs / "Corwin System.md").write_text(NOTE.format(name="Corwin System"), encoding="utf-8")
    (locs / "Corwin I.md").write_text(NOTE_NO_RELS.format(name="Corwin I"), encoding="utf-8")
    extract = _extract(tmp_path)
    out = tmp_path / "out"
    before = (locs / "Corwin I.md").read_text(encoding="utf-8")

    rc = link_orphans.run([str(extract), "--vault", str(vault),
                           "--out", str(out), "--systems", "Corwin", "--execute"])

    assert rc == 0
    assert (locs / "Corwin I.md").read_text(encoding="utf-8") == before  # untouched
    data = json.loads((out / "orphan-linking.json").read_text(encoding="utf-8"))
    assert data["linked"] == []                                          # not claimed
    assert any(u["entity"] == "Corwin I" for u in data["unwritable"])
    report = (out / "orphan-linking-report.md").read_text(encoding="utf-8")
    assert "could not be written" in report


def test_description_backslashes_survive_the_substitution():
    # `block` is a literal, not a replacement template: a backslash in the
    # JSON-encoded description must not be eaten as an escape (and `\u` would
    # have raised "bad escape" outright).
    text = "---\nname: X\nrelationships: []\n---\n"
    out = link_orphans.add_relationship(text, "Target", "part_of", r'a \ b "q" A')
    assert out is not None
    assert r"\\" in out          # the backslash is still escaped in the YAML value
    assert r"A" in out      # not consumed as a replacement-template escape


def test_appends_under_an_existing_relationships_block():
    text = ("---\nname: X\nrelationships:\n  - target: \"[[Other]]\"\n"
            "    type: knows\n---\n")
    out = link_orphans.add_relationship(text, "Target", "part_of", "why")
    assert out is not None
    assert '- target: "[[Other]]"' in out    # existing edge kept
    assert '- target: "[[Target]]"' in out   # new edge added


def test_entity_name_cannot_escape_its_folder(tmp_path):
    # `name` comes from the extract, which is built from the world API. A name
    # containing ../ resolved to an existing file outside the kind's folder and
    # that file was rewritten.
    vault = tmp_path / "vault"
    (vault / "Locations").mkdir(parents=True)
    (vault / "Locations" / "Corwin System.md").write_text(
        NOTE.format(name="Corwin System"), encoding="utf-8")
    outside = vault / "Characters"
    outside.mkdir()
    victim = outside / "Corwin I.md"
    victim.write_text(NOTE.format(name="Corwin I"), encoding="utf-8")
    before = victim.read_text(encoding="utf-8")

    # The "gate" rule matches on startswith + substring, not fullmatch, so a
    # name can satisfy it AND carry traversal segments.
    escaping = "Corwin Gate/../../Characters/Corwin I"
    extract = {"entities": [
        {"id": "id-sys", "name": "Corwin System", "kind": "political", "relationships": []},
        {"id": "id-p", "name": escaping, "kind": "landfeature", "relationships": []},
    ]}
    p = tmp_path / "extract.json"
    p.write_text(json.dumps(extract), encoding="utf-8")
    out = tmp_path / "out"

    rc = link_orphans.run([str(p), "--vault", str(vault), "--out", str(out),
                           "--systems", "Corwin", "--execute"])
    assert rc == 0
    assert victim.read_text(encoding="utf-8") == before   # untouched
    data = json.loads((out / "orphan-linking.json").read_text(encoding="utf-8"))
    assert data["linked"] == []

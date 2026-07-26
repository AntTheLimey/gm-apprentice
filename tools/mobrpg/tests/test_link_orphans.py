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

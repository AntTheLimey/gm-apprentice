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

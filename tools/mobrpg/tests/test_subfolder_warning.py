"""suggest and link-orphans say so when a note sits in a subfolder (#353): every
command lists `<folder>/*.md`, so the note is otherwise silently missed."""
import json

from mobrpg.commands import link_orphans, suggest


def _vault(tmp_path):
    for rel in ("Locations/Corwin System.md", "Characters/NPCs/Tom.md",
                "Characters/NPCs/Old/Dick.md"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("---\ntype: npc\nrelationships: []\n---\nBody\n", encoding="utf-8")


def test_suggest_collect_entities_warns_about_a_subfolder_note(tmp_path, capsys):
    _vault(tmp_path)
    names = [e["name"] for e in suggest.collect_entities(str(tmp_path))]
    assert "Tom" in names and "Dick" not in names
    assert "Characters/NPCs/Old/Dick.md" in capsys.readouterr().err


def test_link_orphans_warns_about_a_subfolder_note(tmp_path, capsys):
    _vault(tmp_path)
    ex = tmp_path / "extract.json"
    ex.write_text(json.dumps({"entities": []}), encoding="utf-8")
    link_orphans.run([str(ex), "--vault", str(tmp_path), "--out", str(tmp_path / "out")])
    assert "Characters/NPCs/Old/Dick.md" in capsys.readouterr().err

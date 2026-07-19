from mobrpg import node
from mobrpg.commands import relink

BASE_NODE = {
    "world_id": "w1", "external_ref": "canticle:Characters/NPCs/Imogen_Bellamy",
    "element_id": "el-1", "element_kind": "Person", "review_state": "accepted",
    "content_hash": "sha256:x", "last_synced": "", "review_note": "",
    "determined": {"sex": "Female"}, "relationships": [], "languages": [],
}


def _note_text(n):
    return "---\ntype: npc\nname: Imogen\n" + node.emit_node(n) + "---\n# Imogen\nbody\n"


def _write(tmp_path, rel, n):
    p = tmp_path / (rel + ".md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_note_text(n), encoding="utf-8")
    return p


# --- pure transform ---------------------------------------------------------

def test_relink_node_rewrites_ref_records_previous_keeps_element_id():
    out = relink.relink_node(BASE_NODE, "canticle:Characters/NPCs/Imogen_Rooke")
    assert out["external_ref"] == "canticle:Characters/NPCs/Imogen_Rooke"
    assert out["previous_ref"] == "canticle:Characters/NPCs/Imogen_Bellamy"
    assert out["element_id"] == "el-1"                    # identity preserved


# --- run() ------------------------------------------------------------------

def test_run_dry_run_does_not_modify(tmp_path, capsys):
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", BASE_NODE)
    before = p.read_text()
    rc = relink.run(["--vault", str(tmp_path), "--to", "Characters/NPCs/Imogen_Rooke"])
    assert rc == 0
    assert p.read_text() == before                        # untouched
    out = capsys.readouterr().out
    assert "dry-run" in out
    assert "Imogen_Bellamy" in out and "Imogen_Rooke" in out


def test_run_execute_rewrites_and_preserves_authored_fm(tmp_path):
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", BASE_NODE)
    rc = relink.run(["--vault", str(tmp_path), "--to",
                     "Characters/NPCs/Imogen_Rooke", "--execute"])
    assert rc == 0
    txt = p.read_text()
    n = node.read_node(txt)
    assert n["external_ref"] == "canticle:Characters/NPCs/Imogen_Rooke"
    assert n["previous_ref"] == "canticle:Characters/NPCs/Imogen_Bellamy"
    assert n["element_id"] == "el-1"
    assert "name: Imogen" in txt                          # authored frontmatter intact


def test_run_from_guard_mismatch_refuses(tmp_path):
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", BASE_NODE)
    rc = relink.run(["--vault", str(tmp_path), "--to", "Characters/NPCs/Imogen_Rooke",
                     "--from", "Characters/NPCs/Wrong_Name", "--execute"])
    assert rc != 0
    # file unchanged — still the old ref, no previous_ref
    n = node.read_node(p.read_text())
    assert n["external_ref"] == "canticle:Characters/NPCs/Imogen_Bellamy"
    assert "previous_ref" not in n


def test_run_from_guard_match_allows(tmp_path):
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", BASE_NODE)
    rc = relink.run(["--vault", str(tmp_path), "--to", "Characters/NPCs/Imogen_Rooke",
                     "--from", "Characters/NPCs/Imogen_Bellamy", "--execute"])
    assert rc == 0
    assert node.read_node(p.read_text())["external_ref"] == "canticle:Characters/NPCs/Imogen_Rooke"


def test_run_noop_when_already_linked(tmp_path, capsys):
    n = dict(BASE_NODE, external_ref="canticle:Characters/NPCs/Imogen_Rooke")
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", n)
    rc = relink.run(["--vault", str(tmp_path), "--to",
                     "Characters/NPCs/Imogen_Rooke", "--execute"])
    assert rc == 0
    assert "already" in capsys.readouterr().out.lower()
    assert "previous_ref" not in node.read_node(p.read_text())  # not touched


def test_run_errors_when_note_has_no_node(tmp_path):
    p = tmp_path / "Characters/NPCs/Plain.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("---\ntype: npc\n---\nbody\n", encoding="utf-8")
    rc = relink.run(["--vault", str(tmp_path), "--to",
                     "Characters/NPCs/Plain", "--execute"])
    assert rc != 0


def test_run_errors_when_note_missing(tmp_path):
    rc = relink.run(["--vault", str(tmp_path), "--to", "Nope/Missing", "--execute"])
    assert rc != 0


def test_run_refuses_traversal_to_path(tmp_path, capsys):
    rc = relink.run(["--vault", str(tmp_path), "--to", "../escape", "--execute"])
    assert rc != 0
    assert "escapes the vault" in capsys.readouterr().err   # the guard branch fired


def test_run_writes_canonical_ref_for_non_normalized_to(tmp_path):
    # A non-normalized --to must still produce the canonical external_ref, or a
    # future push would compute a different ref and mint a duplicate.
    p = _write(tmp_path, "Characters/NPCs/Imogen_Rooke", BASE_NODE)
    rc = relink.run(["--vault", str(tmp_path), "--execute",
                     "--to", "Characters/./NPCs/../NPCs/Imogen_Rooke"])
    assert rc == 0
    assert node.read_node(p.read_text())["external_ref"] == \
        "canticle:Characters/NPCs/Imogen_Rooke"

from mobrpg import vault as _vault


def _mk(tmp_path, rel, element_id=None):
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    nodeblock = ""
    if element_id is not None:
        nodeblock = f'mobrpg:\n  element_id: "{element_id}"\n'
    p.write_text(f"---\nname: X\n{nodeblock}---\n\nBody.\n", encoding="utf-8")
    return p


def test_iter_linked_notes_yields_only_linked(tmp_path):
    # Must live under a real mobrpg.commands.map_cmd.FOLDERS key — iter_linked_notes
    # only globs those folders (matches _iter_notes's original behavior).
    _mk(tmp_path, "Characters/NPCs/linked.md", element_id="e-1")
    _mk(tmp_path, "Characters/NPCs/unlinked.md")            # no node
    _mk(tmp_path, "Characters/NPCs/empty-id.md", element_id="")  # empty id
    got = list(_vault.iter_linked_notes(str(tmp_path)))
    assert len(got) == 1
    path, txt, nd = got[0]
    assert path.endswith("linked.md") and nd["element_id"] == "e-1"

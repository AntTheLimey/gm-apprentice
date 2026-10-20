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


def test_iter_linked_notes_skips_an_unreadable_note_and_says_so(tmp_path, capsys):
    # CodeRabbit on #351: one note it could not read stopped the first listing for every command.
    _mk(tmp_path, "Characters/NPCs/a-first.md", element_id="e-1")
    bad = tmp_path / "Characters" / "NPCs" / "b-bad.md"
    bad.write_bytes(b"---\nname: \xff\xfe\n---\n")
    _mk(tmp_path, "Characters/NPCs/c-last.md", element_id="e-3")
    got = [p.rsplit("/", 1)[1] for p, _t, _n in _vault.iter_linked_notes(str(tmp_path))]
    assert got == ["a-first.md", "c-last.md"]
    assert "b-bad.md" in capsys.readouterr().err


def test_a_note_in_a_subfolder_is_reported_not_silently_missed(tmp_path, capsys):
    # The vault layout is flat; a note one folder further down is invisible to every command.
    _mk(tmp_path, "Characters/NPCs/top.md", element_id="e-1")
    _mk(tmp_path, "Characters/NPCs/Retired/deep.md", element_id="e-2")
    got = [p.rsplit("/", 1)[1] for p, _t, _n in _vault.iter_linked_notes(str(tmp_path))]
    assert got == ["top.md"]
    err = capsys.readouterr().err
    assert "Characters/NPCs/Retired/deep.md" in err and "subfolder" in err

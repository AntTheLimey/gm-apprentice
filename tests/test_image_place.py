"""gma image place: file the kept pictures, link them, leave the rest."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image  # noqa: E402
import image_jobs  # noqa: E402
import image_place  # noqa: E402
import schema_rules  # noqa: E402
import vault_write  # noqa: E402
import vaultlib  # noqa: E402

JPG = b"\xff\xd8\xff\xe0" + b"1" * 32
JPG2 = b"\xff\xd8\xff\xe0" + b"2" * 32
RECAP = ("---\ntype: session_wrap\ncanon_status: canon\nsession: 3\n---\n"
         "# Session 03 Wrap-Up\n## Narrative Recap\n"
         "The party arrived at the mill.\n\n"
         "The miller said nothing at first.\n\n"
         "The miller then spoke.\n\n"
         "## Memorable Moments\n\nThe miller said nothing at first, again.\n")


def npc(extra=""):
    return f"---\ntype: npc\ncanon_status: AUTHORITATIVE\n{extra}---\n# Body\n"


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    vaultlib.forget_settings(None)
    monkeypatch.setenv("GMA_CACHE", str(tmp_path / "cache"))
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))
    yield
    vaultlib.forget_settings(None)


@pytest.fixture
def vault(tmp_path):
    v = tmp_path / "vault"
    files = {
        "_meta/vault-config.yaml": "version: 1\n",
        "NPCs/Anselm.md": npc(),
        "NPCs/Maître O'Brien's Ghost.md": npc(),
        "NPCs/Marta.md": npc('portrait: "_attachments/characters/marta.jpg"\n'),
        "NPCs/Rowan.md": npc(),
        "Sessions/Session 03 Wrap-Up.md": RECAP,
    }
    for rel, text in files.items():
        p = v / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    (v / "_attachments" / "characters").mkdir(parents=True)
    (v / "_attachments" / "characters" / "marta.jpg").write_bytes(JPG)
    return v


def entry(n, note, kind, dest, **kw):
    base = dict(n=n, note=note, kind=kind, prompt="p", refs=[], shape="3:4",
                pending="", dest=dest, after=None, replace=False,
                estimate=1.0, status="drawn", ext="jpg")
    base.update(kw)
    return image_jobs.Entry(**base)


def make_job(vault, entries, data=JPG):
    """Save a job whose drawn entries each have a real file in the folder."""
    job_id = "20261109-abcdef"
    folder = image_jobs.folder(job_id)
    folder.mkdir(parents=True, exist_ok=True)
    for e in entries:
        e.pending = str(folder / f"{e.n:02d}")
        if e.status in ("drawn", "held") and e.ext:
            Path(e.pending + "." + e.ext).write_bytes(data)
    job = image_jobs.Job(id=job_id, vault=str(vault), service="gemini",
                         model="m", priced=True, unprompted=False,
                         spent=0.0, entries=entries)
    image_jobs.save(job)
    return job


def anselm(**kw):
    return entry(1, "NPCs/Anselm.md", "npc", "_attachments/characters/anselm", **kw)


def scene(n=1, after="The miller said nothing", **kw):
    return entry(n, "Sessions/Session 03 Wrap-Up.md", "scene",
                 "_attachments/scenes/session-03-mill", after=after,
                 shape="16:9", **kw)


def tree(vault):
    return sorted(p.relative_to(vault).as_posix() for p in vault.rglob("*")
                  if p.is_file())


def snapshot(vault):
    return {p.relative_to(vault).as_posix(): p.read_bytes()
            for p in vault.rglob("*") if p.is_file()}


def run(vault, job, *argv):
    return image.main(["place", str(vault), job.id, *argv])


# --- keep, an entity --------------------------------------------------------

def test_keep_files_the_picture_and_sets_a_blank_portrait(vault, capsys):
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    dest = vault / "_attachments/characters/anselm.jpg"
    assert dest.read_bytes() == JPG
    text = (vault / "NPCs/Anselm.md").read_text(encoding="utf-8")
    assert 'portrait: "_attachments/characters/anselm.jpg"' in text
    assert vaultlib.extract_frontmatter(text)["portrait"] == \
        "_attachments/characters/anselm.jpg"
    assert not [f for f in schema_rules.frontmatter_findings(
        vaultlib.extract_frontmatter(text)) if f[0] == "ERROR"]
    assert Path(job.entries[0].pending + ".jpg").read_bytes() == JPG
    assert image_jobs.load(job.id).entries[0].status == "kept"
    out = capsys.readouterr().out
    assert "anselm.jpg" in out


def test_preview_changes_nothing(vault, capsys):
    job = make_job(vault, [anselm(), scene(2)])
    before = snapshot(vault)
    pending = snapshot(image_jobs.folder(job.id))
    assert run(vault, job, "--keep", "1", "2") == 0
    assert snapshot(vault) == before
    assert snapshot(image_jobs.folder(job.id)) == pending
    assert all(e.status == "drawn" for e in image_jobs.load(job.id).entries)
    assert "Would" in capsys.readouterr().out


def test_a_picture_with_no_verdict_blocks_everything(vault, capsys):
    job = make_job(vault, [anselm(), entry(2, "NPCs/Rowan.md", "npc",
                                           "_attachments/characters/rowan")])
    before = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 2
    assert snapshot(vault) == before
    assert Path(job.entries[0].pending + ".jpg").exists()
    assert ("picture 2 has no verdict: look at it, then keep or hold it"
            in capsys.readouterr().err)


def test_a_number_that_is_not_drawn_is_refused(vault, capsys):
    job = make_job(vault, [anselm(), entry(2, "NPCs/Rowan.md", "npc", "x",
                                           status="refused", ext=None)])
    assert run(vault, job, "--keep", "1", "2", "--write") == 2
    assert "picture 2" in capsys.readouterr().err
    assert run(vault, job, "--keep", "1", "9", "--write") == 2


def test_hold_leaves_it_out_of_the_vault_and_gives_the_path(vault, capsys):
    job = make_job(vault, [anselm()])
    before = snapshot(vault)
    assert run(vault, job, "--hold", "1", "--write") == 0
    assert snapshot(vault) == before
    held = Path(job.entries[0].pending + ".jpg")
    assert held.is_file()
    assert str(held) in capsys.readouterr().out
    assert image_jobs.load(job.id).entries[0].status == "held"


# --- keep, a scene ----------------------------------------------------------

def test_scene_embed_goes_after_its_paragraph(vault):
    job = make_job(vault, [scene()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    text = (vault / "Sessions/Session 03 Wrap-Up.md").read_text(encoding="utf-8")
    assert ("The miller said nothing at first.\n\n"
            "![[session-03-mill.jpg]]\n\n"
            "The miller then spoke.\n") in text
    assert (vault / "_attachments/scenes/session-03-mill.jpg").is_file()


def test_embed_after_unit():
    out = image_place.embed_after(RECAP, "The miller said   nothing", "a b.jpg")
    assert out is not None and "first.\n\n![[a b.jpg]]\n\nThe miller then" in out
    assert image_place.embed_after(out, "The miller said nothing", "a b.jpg") == out
    assert image_place.embed_after(RECAP, "The miller", "x.jpg") is None
    assert image_place.embed_after(RECAP, "Nobody says this", "x.jpg") is None
    assert image_place.embed_after("# no recap\n", "x", "x.jpg") is None


def test_embed_keeps_windows_line_endings():
    crlf = RECAP.replace("\n", "\r\n")
    out = image_place.embed_after(crlf, "The miller said nothing", "a.jpg")
    assert out is not None
    assert "first.\r\n\r\n![[a.jpg]]\r\n\r\nThe miller then" in out
    assert "\n" not in out.replace("\r\n", "")


def test_embed_is_not_added_twice(vault):
    job = make_job(vault, [scene()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    once = (vault / "Sessions/Session 03 Wrap-Up.md").read_text(encoding="utf-8")
    # A second picture with the same file name, as a redraw would give.
    job2 = make_job(vault, [scene(replace=True)], data=JPG2)
    assert run(vault, job2, "--keep", "1", "--write") == 0
    twice = (vault / "Sessions/Session 03 Wrap-Up.md").read_text(encoding="utf-8")
    assert twice == once
    assert twice.count("![[session-03-mill.jpg]]") == 1


@pytest.mark.parametrize("after", ["Nothing like this at all", "The miller"])
def test_recap_edited_since_the_plan_is_not_placed(vault, capsys, after):
    job = make_job(vault, [scene(after=after)])
    before = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before
    assert Path(job.entries[0].pending + ".jpg").is_file()
    assert ("the recap changed since the plan; picture 1 was not placed"
            in capsys.readouterr().out)
    assert image_jobs.load(job.id).entries[0].status == "drawn"


def test_embed_only_inside_the_recap_section(vault):
    # The opening words only repeat under Memorable Moments.
    job = make_job(vault, [scene(after="The miller said nothing at first, again")])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert "![[" not in (vault / "Sessions/Session 03 Wrap-Up.md").read_text(
        encoding="utf-8")


# --- the guard rails --------------------------------------------------------

def test_portrait_filled_since_the_plan_is_left_alone(vault, capsys):
    (vault / "NPCs/Anselm.md").write_text(
        npc('portrait: "_attachments/characters/other.jpg"\n'), encoding="utf-8")
    job = make_job(vault, [anselm()])
    before = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before
    assert Path(job.entries[0].pending + ".jpg").is_file()
    assert "picture 1 was not placed" in capsys.readouterr().out
    assert image_jobs.load(job.id).entries[0].status == "drawn"


def test_replace_swaps_and_removes_the_old_file(vault):
    marta = entry(1, "NPCs/Marta.md", "npc", "_attachments/characters/marta-2",
                  replace=True, ext="png")
    job = make_job(vault, [marta], data=b"\x89PNG\r\n\x1a\n" + b"3" * 16)
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert not (vault / "_attachments/characters/marta.jpg").exists()
    assert (vault / "_attachments/characters/marta-2.png").is_file()
    assert "marta-2.png" in (vault / "NPCs/Marta.md").read_text(encoding="utf-8")


def test_replace_keeps_the_old_file_when_another_note_links_it(vault):
    (vault / "NPCs/Rowan.md").write_text(
        npc() + "![[marta.jpg]]\n", encoding="utf-8")
    marta = entry(1, "NPCs/Marta.md", "npc", "_attachments/characters/marta-2",
                  replace=True)
    job = make_job(vault, [marta])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / "_attachments/characters/marta.jpg").is_file()
    assert (vault / "_attachments/characters/marta-2.jpg").is_file()


def test_replace_in_the_same_place_overwrites(vault):
    marta = entry(1, "NPCs/Marta.md", "npc", "_attachments/characters/marta",
                  replace=True)
    job = make_job(vault, [marta], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / "_attachments/characters/marta.jpg").read_bytes() == JPG2
    assert tree(vault).count("_attachments/characters/marta.jpg") == 1


def test_an_existing_picture_is_not_replaced_unasked(vault, capsys):
    (vault / "_attachments/characters/anselm.jpg").write_bytes(JPG2)
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert (vault / "_attachments/characters/anselm.jpg").read_bytes() == JPG2
    assert "was not placed" in capsys.readouterr().out


def test_names_with_spaces_apostrophes_and_accents(vault):
    note = "NPCs/Maître O'Brien's Ghost.md"
    dest = "_attachments/characters/" + image_jobs._slug(Path(note).stem)
    wrap = scene(2, after="The miller then")
    wrap.dest = "_attachments/scenes/" + image_jobs._slug("Maître O'Brien's Ghost")
    job = make_job(vault, [entry(1, note, "npc", dest), wrap])
    assert run(vault, job, "--keep", "1", "2", "--write") == 0
    fm = vaultlib.extract_frontmatter(
        (vault / note).read_text(encoding="utf-8"))
    assert (vault / fm["portrait"]).is_file()
    text = (vault / "Sessions/Session 03 Wrap-Up.md").read_text(encoding="utf-8")
    name = Path(wrap.dest).name + ".jpg"
    assert f"![[{name}]]" in text
    assert (vault / "_attachments/scenes" / name).is_file()


def test_a_failed_note_write_moves_the_picture_back(vault, monkeypatch, capsys):
    job = make_job(vault, [anselm()])
    before = snapshot(vault)

    def boom(batch):
        raise vault_write.WriteError("disk full")
    monkeypatch.setattr(vault_write, "apply", boom)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before
    assert Path(job.entries[0].pending + ".jpg").read_bytes() == JPG
    assert image_jobs.load(job.id).entries[0].status == "drawn"
    assert "disk full" in capsys.readouterr().out


def test_a_failed_replace_restores_the_old_file(vault, monkeypatch):
    marta = entry(1, "NPCs/Marta.md", "npc", "_attachments/characters/marta",
                  replace=True)
    job = make_job(vault, [marta], data=JPG2)
    before = snapshot(vault)
    monkeypatch.setattr(vault_write, "apply",
                        lambda b: (_ for _ in ()).throw(OSError("no")))
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before


def test_a_document_note_may_hold_a_portrait():
    assert "document" in schema_rules.PORTRAIT_TYPES


# --- the controller's rulings ------------------------------------------------

def test_a_missing_pending_file_is_reported(vault, capsys):
    job = make_job(vault, [anselm()])
    Path(job.entries[0].pending + ".jpg").unlink()
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert ("picture 1's file is missing from the job; draw it again"
            in capsys.readouterr().out)
    assert tree(vault).count("_attachments/characters/anselm.jpg") == 0


def test_placing_twice_does_nothing_twice(vault, capsys):
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    after_first = snapshot(vault)
    capsys.readouterr()
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert snapshot(vault) == after_first
    assert "already placed" in capsys.readouterr().out


def test_a_held_picture_can_be_kept_later(vault):
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--hold", "1", "--write") == 0
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / "_attachments/characters/anselm.jpg").is_file()
    assert image_jobs.load(job.id).entries[0].status == "kept"


def test_the_same_number_kept_and_held_is_refused(vault, capsys):
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--hold", "1", "--write") == 2
    assert "picture 1" in capsys.readouterr().err
    assert not (vault / "_attachments/characters/anselm.jpg").exists()


def test_destinations_outside_the_vault_are_refused(vault, capsys):
    e = anselm()
    e.dest = "../escape"
    job = make_job(vault, [e])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert not (vault.parent / "escape.jpg").exists()
    assert "outside the vault" in capsys.readouterr().out


def test_a_job_for_another_vault_is_refused(vault, tmp_path, capsys):
    job = make_job(vault, [anselm()])
    other = tmp_path / "other"
    other.mkdir()
    assert run(other, job, "--keep", "1", "--write") == 2
    assert "that job belongs to another vault" in capsys.readouterr().err


def test_an_unknown_job_is_exit_2(vault, capsys):
    assert image.main(["place", str(vault), "nonesuch", "--keep", "1"]) == 2
    assert "No picture job nonesuch" in capsys.readouterr().err


# --- fix round 1: copy, never move; never touch what was not asked --------------

CHARS = "_attachments/characters"


def test_a_picture_differing_only_in_case_is_not_overwritten(vault, capsys):
    (vault / CHARS / "Anselm.jpg").write_bytes(JPG2)
    job = make_job(vault, [anselm()])
    before = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before
    assert (vault / CHARS / "Anselm.jpg").read_bytes() == JPG2
    assert Path(job.entries[0].pending + ".jpg").read_bytes() == JPG
    assert "already has a picture" in capsys.readouterr().out
    assert image_jobs.load(job.id).entries[0].status == "drawn"


def test_a_picture_with_another_extension_blocks_too(vault):
    (vault / CHARS / "ANSELM.PNG").write_bytes(JPG2)
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert (vault / CHARS / "ANSELM.PNG").read_bytes() == JPG2


def test_a_replace_differing_only_in_case_keeps_one_file(vault):
    (vault / CHARS / "marta.jpg").unlink()
    (vault / CHARS / "Marta.jpg").write_bytes(JPG)
    (vault / "NPCs/Marta.md").write_text(
        npc(f'portrait: "{CHARS}/Marta.jpg"\n'), encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta", replace=True)
    job = make_job(vault, [m], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    files = [p for p in (vault / CHARS).iterdir()]
    assert len(files) == 1 and files[0].read_bytes() == JPG2
    fm = vaultlib.extract_frontmatter(
        (vault / "NPCs/Marta.md").read_text(encoding="utf-8"))
    assert (vault / fm["portrait"]).read_bytes() == JPG2


def test_a_copy_that_fails_half_way_leaves_the_old_picture(vault, monkeypatch,
                                                          capsys):
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta", replace=True)
    job = make_job(vault, [m], data=JPG2)
    before = snapshot(vault)
    real = image_place.shutil.copyfile
    calls = []

    def flaky(a, b):
        calls.append(a)
        if len(calls) == 2:          # the new picture, after the backup
            raise OSError("disk full")
        return real(a, b)
    monkeypatch.setattr(image_place.shutil, "copyfile", flaky)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert snapshot(vault) == before
    assert Path(job.entries[0].pending + ".jpg").read_bytes() == JPG2
    assert "disk full" in capsys.readouterr().out


def test_a_failed_undo_says_where_the_original_is(vault, monkeypatch, capsys):
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta", replace=True)
    job = make_job(vault, [m], data=JPG2)
    monkeypatch.setattr(vault_write, "apply",
                        lambda b: (_ for _ in ()).throw(vault_write.WriteError("x")))
    real = image_place.shutil.copyfile
    state = {"n": 0}

    def flaky(a, b):
        state["n"] += 1
        if state["n"] == 3:          # the restore
            raise OSError("gone")
        return real(a, b)
    monkeypatch.setattr(image_place.shutil, "copyfile", flaky)
    assert run(vault, job, "--keep", "1", "--write") == 1
    out = capsys.readouterr().out
    assert "could not be put back" in out and "replaced-01.jpg" in out
    assert "were put back" not in out


def test_a_failed_job_save_says_the_vault_changed_and_a_rerun_finishes(
        vault, monkeypatch, capsys):
    job = make_job(vault, [anselm()])
    real = image_jobs.save
    monkeypatch.setattr(image_jobs, "save",
                        lambda j: (_ for _ in ()).throw(OSError("x")))
    assert run(vault, job, "--keep", "1", "--write") == 1
    out = capsys.readouterr().out
    assert "The vault WAS changed" in out
    assert (vault / CHARS / "anselm.jpg").read_bytes() == JPG
    monkeypatch.setattr(image_jobs, "save", real)
    after_first = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 0
    out = capsys.readouterr().out
    assert "missing" not in out and "draw it again" not in out
    assert snapshot(vault) == after_first
    assert image_jobs.load(job.id).entries[0].status == "kept"


def test_an_interrupted_earlier_copy_is_accepted(vault):
    (vault / CHARS / "anselm.jpg").write_bytes(JPG)    # same bytes as the job
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    text = (vault / "NPCs/Anselm.md").read_text(encoding="utf-8")
    assert f'portrait: "{CHARS}/anselm.jpg"' in text
    assert (vault / CHARS / "anselm.jpg").read_bytes() == JPG


def test_a_cleanup_failure_does_not_fail_the_command(vault, monkeypatch,
                                                    capsys):
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m])
    monkeypatch.setattr(image_place, "_linked",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("no")))
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / CHARS / "marta.jpg").is_file()
    assert "Could not remove the old picture" in capsys.readouterr().out
    assert image_jobs.load(job.id).entries[0].status == "kept"


def test_the_job_keeps_its_copy(vault):
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert Path(job.entries[0].pending + ".jpg").read_bytes() == JPG


def test_the_old_picture_is_kept_when_a_canvas_links_it(vault):
    (vault / "map.canvas").write_text('{"file": "marta.JPG"}', encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / CHARS / "marta.jpg").is_file()


def test_a_bare_old_portrait_value_is_never_claimed_removed(vault, capsys):
    (vault / "NPCs/Rowan.md").write_text(npc('portrait: "rowan-old.jpg"\n'),
                                         encoding="utf-8")
    r = entry(1, "NPCs/Rowan.md", "npc", f"{CHARS}/rowan", replace=True)
    job = make_job(vault, [r])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert "Removed" not in capsys.readouterr().out


def test_embed_already_in_the_run_of_embeds_is_not_added_again():
    t = ("## Recap\nThe miller said.\n\n![[other.jpg]]\n\n![[a.jpg]]\n\nNext.\n")
    assert image_place.embed_after(t, "The miller", "a.jpg") == t


def test_embed_at_the_last_line_ends_with_a_newline():
    t = "## Recap\nThe miller said nothing."
    assert image_place.embed_after(t, "The miller", "a.jpg") == \
        "## Recap\nThe miller said nothing.\n\n![[a.jpg]]\n"


@pytest.mark.parametrize("field", ["portrait:\n  - a.jpg\n",
                                   "portrait: [a.jpg]\n",
                                   "portrait:\n  path: a.jpg\n"])
def test_a_portrait_that_is_not_a_single_value_is_never_written_over(
        vault, field):
    (vault / "NPCs/Rowan.md").write_text(npc(field), encoding="utf-8")
    before = (vault / "NPCs/Rowan.md").read_text(encoding="utf-8")
    r = entry(1, "NPCs/Rowan.md", "npc", f"{CHARS}/rowan", replace=True)
    job = make_job(vault, [r])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert (vault / "NPCs/Rowan.md").read_text(encoding="utf-8") == before
    assert not (vault / CHARS / "rowan.jpg").exists()


def test_a_note_without_frontmatter_is_not_placed(vault, capsys):
    (vault / "NPCs/Rowan.md").write_text("# Rowan\n", encoding="utf-8")
    job = make_job(vault, [entry(1, "NPCs/Rowan.md", "npc", f"{CHARS}/rowan")])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert "NPCs/Rowan.md has no frontmatter to hold a picture" in \
        capsys.readouterr().out
    assert not (vault / CHARS / "rowan.jpg").exists()


def test_a_preview_with_an_unplaceable_picture_says_so(vault, capsys):
    job = make_job(vault, [scene(after="Nothing like this")])
    assert run(vault, job, "--keep", "1") == 1
    out = capsys.readouterr().out
    assert out.strip().splitlines()[-1] == (
        "Some pictures cannot be placed (see above). Nothing was changed.")


def test_a_note_outside_the_vault_is_refused(vault, tmp_path, capsys):
    (tmp_path / "outside.md").write_text(npc(), encoding="utf-8")
    job = make_job(vault, [entry(1, "../outside.md", "npc", f"{CHARS}/x")])
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert "outside the vault" in capsys.readouterr().out
    assert not (vault / CHARS / "x.jpg").exists()
    assert (tmp_path / "outside.md").read_text(encoding="utf-8") == npc()


# --- fix round 2: the name on disk wins ------------------------------------------

def _listing(folder):
    return sorted(p.name for p in folder.iterdir())


def test_case_only_replace_names_the_note_as_the_disk_does(vault):
    (vault / CHARS / "marta.jpg").unlink()
    (vault / CHARS / "Marta.jpg").write_bytes(JPG)
    (vault / "NPCs/Marta.md").write_text(
        npc(f'portrait: "{CHARS}/Marta.jpg"\n'), encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta", replace=True)
    job = make_job(vault, [m], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    fm = vaultlib.extract_frontmatter(
        (vault / "NPCs/Marta.md").read_text(encoding="utf-8"))
    assert Path(fm["portrait"]).name in _listing(vault / CHARS)
    assert (vault / fm["portrait"]).read_bytes() == JPG2


def test_case_only_scene_replace_embeds_the_disk_name(vault):
    folder = vault / "_attachments/scenes"
    folder.mkdir(parents=True)
    (folder / "Session-03-Mill.jpg").write_bytes(JPG)
    job = make_job(vault, [scene(replace=True)], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    text = (vault / "Sessions/Session 03 Wrap-Up.md").read_text(encoding="utf-8")
    names = _listing(folder)
    assert len(names) == 1 and f"![[{names[0]}]]" in text
    assert (folder / names[0]).read_bytes() == JPG2


def test_the_rerun_path_uses_the_disk_name(vault):
    (vault / CHARS / "Anselm.jpg").write_bytes(JPG)    # same bytes as the job
    job = make_job(vault, [anselm()])
    assert run(vault, job, "--keep", "1", "--write") == 0
    fm = vaultlib.extract_frontmatter(
        (vault / "NPCs/Anselm.md").read_text(encoding="utf-8"))
    assert Path(fm["portrait"]).name in _listing(vault / CHARS)
    assert (vault / fm["portrait"]).read_bytes() == JPG
    assert _listing(vault / CHARS).count("Anselm.jpg") + \
        _listing(vault / CHARS).count("anselm.jpg") == 1


def test_sharp_s_is_not_mistaken_for_ss(vault, capsys):
    (vault / CHARS / "Straße.jpg").write_bytes(JPG)    # same bytes
    r = entry(1, "NPCs/Rowan.md", "npc", f"{CHARS}/strasse")
    job = make_job(vault, [r])
    # Whether this disk treats the two names as one file is the disk's say.
    same = image_place._same_file(vault / CHARS / "Straße.jpg",
                                  vault / CHARS / "strasse.jpg")
    rc = run(vault, job, "--keep", "1", "--write")
    text = (vault / "NPCs/Rowan.md").read_text(encoding="utf-8")
    if same:
        assert rc == 0
        fm = vaultlib.extract_frontmatter(text)
        assert Path(fm["portrait"]).name in _listing(vault / CHARS)
    else:
        assert rc == 1
        assert "already has a picture" in capsys.readouterr().out
        assert "portrait" not in text
        assert not (vault / CHARS / "strasse.jpg").exists()


def test_a_look_alike_name_is_not_filed_unless_the_disk_agrees(
        vault, tmp_path, monkeypatch, capsys):
    # The rule itself, whatever the disk: "already filed" needs samefile or
    # the exact target name, never a case-folded name match alone.
    (vault / CHARS / "Straße.jpg").write_bytes(JPG)
    here = image_place._existing(vault, f"{CHARS}/strasse")
    assert f"{CHARS}/Straße.jpg" in here          # blocking is the wide match
    # And on every machine: when the disk says they are two files, it blocks.
    monkeypatch.setattr(image_place, "_same_file", lambda a, b: False)
    r = entry(1, "NPCs/Rowan.md", "npc", f"{CHARS}/strasse")
    job = make_job(vault, [r])
    before = snapshot(vault)
    assert run(vault, job, "--keep", "1", "--write") == 1
    assert "already has a picture" in capsys.readouterr().out
    assert snapshot(vault) == before
    assert "portrait" not in (vault / "NPCs/Rowan.md").read_text(encoding="utf-8")


def test_a_url_encoded_markdown_link_keeps_the_old_picture(vault):
    (vault / CHARS / "old a.jpg").write_bytes(JPG)
    (vault / "NPCs/Marta.md").write_text(
        npc(f'portrait: "{CHARS}/old a.jpg"\n'), encoding="utf-8")
    (vault / "NPCs/Rowan.md").write_text(
        npc() + f"![x](../{CHARS}/old%20a.jpg)\n", encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / CHARS / "old a.jpg").is_file()


def test_a_link_in_the_templates_folder_keeps_the_old_picture(vault):
    (vault / "_Templates").mkdir()
    (vault / "_Templates/_Template_X.md").write_text(
        "![[marta.jpg]]\n", encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m])
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / CHARS / "marta.jpg").is_file()


# --- minor wave: P1-P6 ------------------------------------------------------

def test_a_wrong_case_embed_is_rewritten_not_doubled(vault):
    folder = vault / "_attachments/scenes"
    folder.mkdir(parents=True)
    (folder / "Session-03-Mill.jpg").write_bytes(JPG)
    if not image_place._same_file(folder / "Session-03-Mill.jpg",
                                  folder / "session-03-mill.jpg"):
        pytest.skip("this disk tells names apart by case: that embed names "
                    "another file")
    wrap = vault / "Sessions/Session 03 Wrap-Up.md"
    wrap.write_text(RECAP.replace(
        "The miller said nothing at first.\n\n",
        "The miller said nothing at first.\n\n![[session-03-mill.jpg]]\n\n", 1),
        encoding="utf-8")
    job = make_job(vault, [scene(replace=True)], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    name = _listing(folder)[0]
    text = wrap.read_text(encoding="utf-8")
    assert text.casefold().count("![[session-03-mill.jpg]]") == 1
    assert f"![[{name}]]" in text


def test_a_note_that_cannot_be_read_counts_as_a_use(vault):
    (vault / CHARS / "marta.jpg").write_bytes(JPG)
    (vault / "NPCs/Rowan.md").write_bytes(
        npc().encode() + "caf\xe9 ![[marta.jpg]]\n".encode("latin-1"))
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m], data=JPG2)
    assert run(vault, job, "--keep", "1", "--write") == 0
    assert (vault / CHARS / "marta.jpg").is_file()


def test_the_rerun_line_names_the_picture_as_the_disk_does(vault, capsys):
    (vault / CHARS / "Anselm.jpg").write_bytes(JPG)
    if not image_place._same_file(vault / CHARS / "Anselm.jpg",
                                  vault / CHARS / "anselm.jpg"):
        pytest.skip("this disk tells names apart by case")
    job = make_job(vault, [anselm(status="kept")])
    assert run(vault, job, "--keep", "1", "--write") == 0
    out = capsys.readouterr().out
    assert f"already placed at {CHARS}/Anselm.jpg" in out


def test_a_case_only_replace_preview_does_not_say_retire(vault, capsys):
    (vault / CHARS / "marta.jpg").unlink()
    (vault / CHARS / "Marta.jpg").write_bytes(JPG)
    (vault / "NPCs/Marta.md").write_text(
        npc(f'portrait: "{CHARS}/Marta.jpg"\n'), encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta", replace=True)
    job = make_job(vault, [m], data=JPG2)
    assert run(vault, job, "--keep", "1") == 0
    out = capsys.readouterr().out
    assert "retire" not in out
    assert f"replaces the existing file {CHARS}/Marta.jpg" in out


def test_a_job_that_cannot_be_saved_after_the_write_is_said_plainly(
        vault, monkeypatch, capsys):
    job = make_job(vault, [anselm()])

    def boom(j):
        raise TypeError("not serialisable")
    monkeypatch.setattr(image_jobs, "save", boom)
    assert run(vault, job, "--keep", "1", "--write") == 1
    out = capsys.readouterr().out
    assert "The vault WAS changed" in out and "TypeError" in out


# --- minor wave 2: P1-P3 ----------------------------------------------------

def test_an_unreadable_folder_keeps_the_old_picture(vault):
    import os
    if os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0):
        pytest.skip("folder permissions do not stop this user")
    hidden = vault / "Archive"
    hidden.mkdir()
    (hidden / "Old.md").write_text("![[marta.jpg]]\n", encoding="utf-8")
    m = entry(1, "NPCs/Marta.md", "npc", f"{CHARS}/marta-2", replace=True)
    job = make_job(vault, [m], data=JPG2)
    hidden.chmod(0)
    try:
        assert run(vault, job, "--keep", "1", "--write") == 0
    finally:
        hidden.chmod(0o755)
    assert (vault / CHARS / "marta.jpg").is_file()


RECAP_WITH = RECAP.replace("The miller said nothing at first.\n\n",
                           "The miller said nothing at first.\n\n{}\n\n", 1)
WHERE = "The miller said nothing"


def test_a_case_variant_embed_of_another_file_is_left_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(image_place, "_same_file", lambda a, b: False)
    t = RECAP_WITH.format("![[A.jpg]]")
    assert image_place.exact_embed_names(t, "a.jpg", tmp_path) == t
    out = image_place.embed_after(t, WHERE, "a.jpg", tmp_path)
    assert out is not None and "![[A.jpg]]" in out and "![[a.jpg]]" in out


def test_a_case_variant_embed_of_the_same_file_is_rewritten_not_doubled(
        tmp_path, monkeypatch):
    monkeypatch.setattr(image_place, "_same_file", lambda a, b: True)
    t = RECAP_WITH.format("![[A.jpg]]")
    fixed = image_place.exact_embed_names(t, "a.jpg", tmp_path)
    assert "![[a.jpg]]" in fixed and "![[A.jpg]]" not in fixed
    assert image_place.embed_after(t, WHERE, "a.jpg", tmp_path) == t


def test_an_embed_with_a_size_is_already_there_and_keeps_its_size(tmp_path):
    t = RECAP_WITH.format("![[a.jpg|300]]")
    assert image_place.embed_after(t, WHERE, "a.jpg", tmp_path) == t
    assert image_place.exact_embed_names(t, "a.jpg", tmp_path) == t


def test_a_renamed_embed_keeps_the_gms_size(tmp_path, monkeypatch):
    monkeypatch.setattr(image_place, "_same_file", lambda a, b: True)
    t = RECAP_WITH.format("![[A.jpg|300]]")
    out = image_place.exact_embed_names(t, "a.jpg", tmp_path)
    assert "![[a.jpg|300]]" in out
    assert image_place.embed_after(t, WHERE, "a.jpg", tmp_path) == t

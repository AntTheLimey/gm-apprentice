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
    assert not Path(job.entries[0].pending + ".jpg").exists()
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

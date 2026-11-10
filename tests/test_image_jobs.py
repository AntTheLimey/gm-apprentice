"""image_jobs.py: planning pictures (the real settings, a real small vault)."""

import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image_jobs  # noqa: E402
import image_keys  # noqa: E402
import tool_cache  # noqa: E402
import vaultlib  # noqa: E402

TODAY = date(2026, 11, 9)
SECRET = "sk-job-secret-text"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
GUIDE = ("---\ntype: meta\n---\n# Image Guidance\n"
         "## Direction\nShow the worst moment.\n"
         "## Always\nRegency, 1814.\n"
         "## Blocks\n### Oil\nDark oil painting.\n")
RECAP = ("---\ntype: session_wrap\ncanon_status: canon\nsession: 3\n---\n"
         "# Session 03 Wrap-Up\n## Narrative Recap\n"
         "The party arrived at the mill.\n\n"
         "The miller said nothing at first.\n\n"
         "The miller then spoke.\n\n## Other\nText.\n")


def note(kind, extra=""):
    return f"---\ntype: {kind}\n{extra}---\n# Body\n"


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    vaultlib.forget_settings(None)
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))
    monkeypatch.setattr(sys, "platform", "linux")

    def boom(*a, **k):
        raise AssertionError("the real keychain was touched")
    monkeypatch.setattr(image_keys, "RUN", boom)
    yield
    vaultlib.forget_settings(None)


def build(tmp_path, config=None, guide=GUIDE):
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    body = config if config is not None else (
        "vault:\n  images:\n    service: gemini\n"
        "    model: gemini-nano-banana-2.1\n")
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\n" + body, encoding="utf-8")
    files = {
        "NPCs/Anselm.md": note("npc"),
        "NPCs/Maître Anselme Godinot.md": note("npc"),
        "NPCs/Marta.md": note("npc", "portrait: _attachments/characters/marta.png\n"),
        "NPCs/Ghost.md": note("npc", "portrait: _attachments/characters/ghost.png\n"),
        "NPCs/Bad.md": note("npc", "portrait: _attachments/characters/bad.txt\n"),
        "NPCs/Big.md": note("npc", "portrait: _attachments/characters/big.png\n"),
        "PCs/Six.md": note("pc"),
        "Locations/Mill.md": note("location"),
        "Overview.md": note("campaign_overview"),
        "Sessions/Session 03 Wrap-Up.md": RECAP,
    }
    if guide is not None:
        files["_Campaign/Image_Guidance.md"] = guide
    for rel, text in files.items():
        p = vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    att = vault / "_attachments" / "characters"
    att.mkdir(parents=True)
    (att / "marta.png").write_bytes(PNG)
    (att / "bad.txt").write_bytes(b"not a picture")
    (att / "big.png").write_bytes(PNG + b"0" * (5 * 1024 * 1024))
    return vault


def one(vault, req, unprompted=False):
    job = image_jobs.plan(vault, [req], unprompted, TODAY)
    return job, job.entries[0]


def said(e):
    return " | ".join(e.said)


# --- one test per rule ---------------------------------------------------

def test_rule_1_no_service_or_model_stops(tmp_path):
    v = build(tmp_path, config="")
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(v, [{"for": "Anselm", "subject": "x"}], False, TODAY)
    assert str(err.value) == ("Choose a picture service and model first: gma "
                              "publish settings set vault.images.service gemini …")


def test_rule_2_no_key_stops(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(build(tmp_path), [{"for": "Anselm", "subject": "x"}],
                        False, TODAY)
    assert str(err.value) == ("No key found for gemini. Run in your own "
                              "terminal: gma image key gemini")


def test_rule_3_unpriced_stops_unless_allowed(tmp_path):
    cfg = "vault:\n  images:\n    service: gemini\n    model: mystery\n"
    v = build(tmp_path, config=cfg)
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(v, [{"for": "Anselm", "subject": "x"}], False, TODAY)
    assert str(err.value).startswith(
        "The apprentice does not know what mystery costs, so it cannot limit "
        "spending on it:")
    assert str(err.value).endswith(
        "gma publish settings set vault.images.price <cents>")


def test_rule_4_unprompted_off_stops_everything(tmp_path):
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(build(tmp_path), [{"for": "Anselm", "subject": "x"}],
                        True, TODAY)
    assert "drawing without asking is off for this vault" in str(err.value).lower()


def test_rule_4_unprompted_refuses_a_pc_and_unlisted_kinds(tmp_path):
    cfg = ("vault:\n  images:\n    service: gemini\n"
           "    model: gemini-nano-banana-2.1\n    auto: true\n"
           "    kinds: [npc]\n")
    v = build(tmp_path, config=cfg)
    job = image_jobs.plan(v, [{"for": "Six", "subject": "x"},
                              {"for": "Mill", "subject": "x"},
                              {"for": "Anselm", "subject": "x"}], True, TODAY)
    pc, loc, npc = job.entries
    assert pc.status == "refused"
    assert "a player's character is drawn only when asked for" in said(pc)
    assert loc.status == "refused" and "location" in said(loc)
    assert npc.status == "planned"


def test_a_pc_is_drawn_when_asked(tmp_path):
    job, e = one(build(tmp_path), {"for": "Six", "subject": "x"})
    assert e.status == "planned" and e.shape == "3:4"


def test_rule_5_existing_portrait_or_file_refuses_unless_replace(tmp_path):
    v = build(tmp_path)
    (v / "_attachments" / "characters" / "anselm.jpg").write_bytes(b"x")
    job = image_jobs.plan(v, [
        {"for": "Marta", "subject": "x"},
        {"for": "Anselm", "subject": "x"},
        {"for": "Marta", "subject": "x", "replace": True},
        {"for": "Anselm", "subject": "x", "replace": True}], False, TODAY)
    a, b, c, d = job.entries
    assert a.status == b.status == "refused"
    assert "it already has a picture" in said(a)
    assert "it already has a picture" in said(b)
    assert c.status == d.status == "planned" and c.replace


def test_rule_6_scene_after_must_match_exactly_one_paragraph(tmp_path):
    v = build(tmp_path)
    base = {"for": "Session 03 Wrap-Up", "subject": "the mill", "name": "mill"}
    job = image_jobs.plan(v, [
        {**base, "after": "The miller said"},
        {**base, "after": "The miller"},
        {**base, "after": "Nobody"}], False, TODAY)
    ok, many, none = job.entries
    assert ok.status == "planned" and ok.kind == "scene" and ok.shape == "16:9"
    assert ok.dest == "_attachments/scenes/session-03-mill"
    assert many.status == "refused" and "2 paragraphs" in said(many)
    assert none.status == "refused" and "no paragraph" in said(none)


def test_rule_6_recap_title_may_be_just_recap(tmp_path):
    v = build(tmp_path)
    p = v / "Sessions" / "Session 03 Wrap-Up.md"
    p.write_text(RECAP.replace("## Narrative Recap", "## recap"), encoding="utf-8")
    _, e = one(v, {"for": "Session 03 Wrap-Up", "subject": "s", "name": "m",
                   "after": "The party"})
    assert e.status == "planned"


def test_rule_7_references_are_dropped_with_a_line(tmp_path):
    v = build(tmp_path)
    _, e = one(v, {"for": "Anselm", "subject": "x",
                   "shows": ["Ghost", "Bad", "Big", "Nobody"]})
    assert e.status == "planned" and e.refs == []
    assert len(e.said) == 4


def test_rule_8_over_the_attempt_limit_is_refused(tmp_path):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: x\n"
           "    price: 9\n    attempt_limit: 5\n")
    _, e = one(build(tmp_path, config=cfg), {"for": "Anselm", "subject": "x"})
    assert e.status == "refused" and "over the limit for one attempt" in said(e)


def test_rule_8_references_are_dropped_to_fit(tmp_path):
    cfg = ("vault:\n  images:\n    service: gemini\n"
           "    model: gemini-nano-banana-2.1\n    attempt_limit: 4.0\n")
    v = build(tmp_path, config=cfg)
    _, e = one(v, {"for": "Anselm", "subject": "x", "shows": ["Marta"] * 3})
    assert e.status == "planned"
    assert len(e.refs) < 3 and "dropped" in said(e)
    assert e.estimate is not None and e.estimate <= 4.0


def test_rule_9_run_cap_trims_the_tail(tmp_path):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: x\n"
           "    price: 4\n    run_cap: 10\n")
    v = build(tmp_path, config=cfg)
    job = image_jobs.plan(v, [{"for": n, "subject": "x"} for n in
                              ("Anselm", "Six", "Mill", "Maître Anselme Godinot")],
                          False, TODAY)
    assert [e.status for e in job.entries] == ["planned", "planned",
                                               "trimmed", "trimmed"]
    assert "cap for one run" in said(job.entries[2])


# --- the extras -----------------------------------------------------------

def test_prompt_is_whole_and_holds_no_direction(tmp_path):
    _, e = one(build(tmp_path), {"for": "Anselm", "subject": "A man on a dock.",
                                 "blocks": ["Oil", "Etching"]})
    assert e.prompt == "Regency, 1814.\n\nDark oil painting.\n\nA man on a dock."
    assert "worst moment" not in e.prompt
    assert "Etching" in said(e)
    assert e.status == "planned"


def test_references_come_from_shows_in_order(tmp_path):
    v = build(tmp_path)
    (v / "NPCs" / "Second.md").write_text(
        note("npc", "portrait: _attachments/characters/second.png\n"),
        encoding="utf-8")
    (v / "_attachments" / "characters" / "second.png").write_bytes(PNG)
    _, e = one(v, {"for": "Anselm", "subject": "x", "shows": ["Second", "Marta"]})
    assert [Path(r).name for r in e.refs] == ["second.png", "marta.png"]
    assert all(Path(r).is_absolute() for r in e.refs)


def test_a_missing_or_oversized_reference_is_dropped_and_said(tmp_path, monkeypatch):
    v = build(tmp_path)
    _, e = one(v, {"for": "Anselm", "subject": "x", "shows": ["Ghost", "Big"]})
    assert e.refs == [] and "missing" in e.said[0] and "5 MB" in e.said[1]
    real = Path.read_bytes

    def flaky(self):
        if self.name == "marta.png":
            raise OSError("not downloaded")
        return real(self)
    monkeypatch.setattr(Path, "read_bytes", flaky)
    _, e = one(v, {"for": "Anselm", "subject": "x", "shows": ["Marta"]})
    assert e.refs == [] and "could not be read" in said(e)


def test_dest_for_names_with_spaces_apostrophes_and_accents(tmp_path):
    v = build(tmp_path)
    (v / "NPCs" / "O'Brien's Ghost.md").write_text(note("npc"), encoding="utf-8")
    job = image_jobs.plan(v, [{"for": "Maître Anselme Godinot", "subject": "x"},
                              {"for": "O'Brien's Ghost", "subject": "x"}],
                          False, TODAY)
    assert job.entries[0].dest == "_attachments/characters/maître-anselme-godinot"
    assert job.entries[1].dest == "_attachments/characters/o'brien's-ghost"


def test_a_stated_price_makes_any_model_priced(tmp_path):
    cfg = "vault:\n  images:\n    service: gemini\n    model: x\n    price: 3\n"
    job, e = one(build(tmp_path, config=cfg), {"for": "Anselm", "subject": "x"})
    assert job.priced and e.estimate == 3


def test_unpriced_on_plans_with_no_estimates(tmp_path):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: x\n"
           "    unpriced: true\n    run_cap: 1\n")
    job = image_jobs.plan(build(tmp_path, config=cfg),
                          [{"for": "Anselm", "subject": "x"},
                           {"for": "Six", "subject": "x"}], False, TODAY)
    assert not job.priced
    assert [e.status for e in job.entries] == ["planned", "planned"]
    assert all(e.estimate is None for e in job.entries)


def test_job_round_trips_and_holds_no_key(tmp_path):
    job, _ = one(build(tmp_path), {"for": "Anselm", "subject": "x"})
    assert image_jobs.load(job.id) == job
    assert SECRET not in image_jobs.job_file(job.id).read_text(encoding="utf-8")
    assert not list(image_jobs.folder(job.id).glob("*.tmp"))


def test_old_jobs_are_pruned(tmp_path):
    root = tool_cache.cache_root() / "images"
    for name, days in (("old", 15), ("recent", 13)):
        d = root / name
        d.mkdir(parents=True)
        (d / "job.json").write_text("{}", encoding="utf-8")
        t = time.time() - days * 86400 - 3600
        for p in (d / "job.json", d):
            os.utime(p, (t, t))
    image_jobs.prune(date.today())
    assert not (root / "old").exists() and (root / "recent").exists()


# --- rulings 2 to 5 ---------------------------------------------------------

def test_a_bad_requests_list_stops_naming_the_entry(tmp_path):
    v = build(tmp_path)
    with pytest.raises(image_jobs.Stop):
        image_jobs.plan(v, {"for": "x"}, False, TODAY)  # type: ignore[arg-type]
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(v, [{"for": "Anselm", "subject": "x"}, {"for": "Six"}],
                        False, TODAY)
    assert "Request 2" in str(err.value)


def test_an_unsupported_kind_is_refused_for_that_picture_only(tmp_path):
    job = image_jobs.plan(build(tmp_path), [{"for": "Overview", "subject": "x"},
                                            {"for": "Anselm", "subject": "x"}],
                          False, TODAY)
    assert job.entries[0].status == "refused"
    assert "pictures for a campaign_overview note are not supported yet" in said(
        job.entries[0])
    assert job.entries[1].status == "planned"


def test_an_unreadable_guidance_note_stops(tmp_path, monkeypatch):
    v = build(tmp_path)
    import image_guidance

    def boom(*a):
        raise OSError("not downloaded")
    monkeypatch.setattr(image_guidance, "read", boom)
    with pytest.raises(image_jobs.Stop) as err:
        image_jobs.plan(v, [{"for": "Anselm", "subject": "x"}], False, TODAY)
    assert str(err.value) == ("The Image Guidance note at "
                              "_Campaign/Image_Guidance.md could not be read.")


def test_no_guidance_note_is_said_once_and_prompts_are_the_subject(tmp_path):
    v = build(tmp_path, guide=None)
    job = image_jobs.plan(v, [{"for": "Anselm", "subject": "A man."},
                              {"for": "Six", "subject": "A woman."}], False, TODAY)
    line = "No Image Guidance note yet; pictures are drawn with no campaign style."
    assert sum(line in e.said for e in job.entries) == 1
    assert job.entries[0].prompt == "A man."


def test_a_damaged_state_file_propagates_for_the_cli(tmp_path):
    v = build(tmp_path)
    (v / vaultlib.STATE_FILE).write_text(
        json.dumps({"images": {"months": {"2026-11": {"cents": "lots"}}}}),
        encoding="utf-8")
    with pytest.raises(vaultlib.StateUnreadable):
        image_jobs.plan(v, [{"for": "Anselm", "subject": "x"}], False, TODAY)

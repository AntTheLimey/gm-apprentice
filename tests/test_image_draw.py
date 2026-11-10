"""gma image draw: every paid call is counted at once; nothing paid for is sent
twice; no attempt passes a limit. The service is a scripted `image_gemini.SEND`
built from real captured replies (tests/fixtures/image); no network, no key."""

import base64
import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image  # noqa: E402
import image_draw  # noqa: E402
import image_gemini  # noqa: E402
import image_jobs  # noqa: E402
import image_keys  # noqa: E402
import image_money  # noqa: E402
import vaultlib  # noqa: E402
from image_replies import Sender, fixture  # noqa: E402

TODAY = date(2026, 11, 9)
KEY = "AIza-FAKE-KEY-for-draw-tests-0000"
MODEL = "gemini-nano-banana-2.1"
CONFIG = f"vault:\n  images:\n    service: gemini\n    model: {MODEL}\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
OK = "gemini-thinking-minimal.json"    # a real picture, thinking minimal
OK_CENTS = 3.59                         # what its usage costs (the adapter tests)
ODD_PNG = b"\x89PNG\r\n\x1a\n" + b"redo picture"


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    vaultlib.forget_settings(None)
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", KEY)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))
    monkeypatch.setenv("GMA_CACHE", str(tmp_path / "cache"))
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(image, "_today", lambda: TODAY)

    def boom(*a, **k):
        raise AssertionError("the real keychain was touched")
    monkeypatch.setattr(image_keys, "RUN", boom)

    def no_network(*a, **k):
        raise AssertionError("a real call to the service")
    monkeypatch.setattr(image_gemini, "SEND", no_network)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path, count=3, config=CONFIG):
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    set_config(vault, config)
    for i in range(1, count + 1):
        p = vault / "NPCs" / f"P{i}.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("---\ntype: npc\n---\n# Body\n", encoding="utf-8")
    return vault


def set_config(vault, config):
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\n" + config, encoding="utf-8")
    vaultlib.forget_settings(None)


def start(tmp_path, count=3, config=CONFIG, shows=None):
    vault = make_vault(tmp_path, count, config)
    reqs = [{"for": f"P{i}", "subject": f"person {i}"}
            | ({"shows": shows} if shows else {}) for i in range(1, count + 1)]
    return vault, image_jobs.plan(vault, reqs, False, TODAY)


def script(monkeypatch, *replies):
    send = Sender(*replies)
    monkeypatch.setattr(image_gemini, "SEND", send)
    return send


def derived(name=OK, *, content=None, usage="keep", data=None, status=None):
    """A reply derived from a real one (as the adapter tests derive theirs)."""
    _, raw = fixture(name)
    reply = json.loads(raw)
    item = reply["steps"][1]["content"]
    if content is not None:
        reply["steps"][1]["content"] = content
    if data is not None:
        item[0]["data"] = data
    if usage is None:
        del reply["usage"]
    if status:
        reply["status"] = status
    return 200, json.dumps(reply).encode()


def month(vault):
    return image_money.spent(vault, TODAY)


def run(vault, job, *extra):
    return image.main(["draw", str(vault), job.id, *extra])


def reload(job):
    return image_jobs.load(job.id)


def pending_files(job):
    return sorted(p.name for p in image_jobs.folder(job.id).glob("[0-9][0-9].*")
                  if not p.name.endswith(".tmp"))


def test_draws_every_planned_picture_once(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert len(send.calls) == 3
    assert pending_files(job) == ["01.jpg", "02.jpg", "03.jpg"]
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn"] * 3
    assert [e.attempts for e in saved.entries] == [1, 1, 1]
    assert [e.cost for e in saved.entries] == [pytest.approx(OK_CENTS, abs=0.01)] * 3
    assert month(vault) == pytest.approx(sum(e.cost for e in saved.entries), abs=1e-3)
    assert saved.spent == pytest.approx(month(vault), abs=1e-3)
    out = capsys.readouterr().out
    assert "1. NPCs/P1.md: drawn," in out and "01.jpg, 3.59 cents" in out
    assert "This run: 3 pictures drawn, 10.76 cents" in out
    assert "This month: 10.76 of 2000 cents" in out


def test_running_draw_again_sends_nothing(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    before = month(vault)
    assert run(vault, job) == 0
    assert len(send.calls) == 3
    assert month(vault) == before
    assert "already drawn, nothing sent" in capsys.readouterr().out


def test_a_cut_off_run_resumes_without_repaying(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=9)
    cut = image_gemini.ServiceError("network", "could not reach the service: no route")
    send = script(monkeypatch, *([fixture(OK)] * 3 + [cut] * 3))
    assert run(vault, job) == 1
    assert len(send.calls) == 6                       # three failures stop the run
    out = capsys.readouterr().out
    assert "allow network access for gma image draw." in out
    assert "nothing was charged" in out
    saved = reload(job)
    assert [e.status for e in saved.entries].count("drawn") == 3
    assert [e.attempts for e in saved.entries[3:]] == [0] * 6   # nothing paid, nothing used
    assert month(vault) == pytest.approx(3 * OK_CENTS, abs=0.05)
    send2 = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert len(send2.calls) == 6                      # only the undone ones
    assert pending_files(job) == [f"{n:02d}.jpg" for n in range(1, 10)]
    assert month(vault) == pytest.approx(9 * OK_CENTS, abs=0.1)
    assert reload(job).spent == pytest.approx(month(vault))


def test_a_run_killed_mid_way_loses_nothing_paid(tmp_path, monkeypatch):
    vault, job = start(tmp_path)
    script(monkeypatch, fixture(OK), KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):
        run(vault, job)
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn", "planned", "planned"]
    assert month(vault) == pytest.approx(OK_CENTS, abs=0.01)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert len(send.calls) == 2


def test_a_refusal_is_reported_and_the_rest_draw(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    refusal = derived(content=[{"type": "text", "text": "I can't draw that"}])
    send = script(monkeypatch, fixture(OK), refusal, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 3
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn", "refused", "drawn"]
    assert saved.entries[1].said[-1] == "the service declined: I can't draw that"
    assert pending_files(job) == ["01.jpg", "03.jpg"]
    assert "2. NPCs/P2.md: refused, the service declined: I can't draw that" \
        in capsys.readouterr().out


def test_a_refusal_is_counted(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    refusal = derived(content=[])
    script(monkeypatch, refusal)
    run(vault, job)
    paid = pytest.approx(OK_CENTS, abs=0.01)
    saved = reload(job)
    assert saved.entries[0].attempts == 1
    assert saved.entries[0].cost == paid
    assert saved.spent == paid
    assert month(vault) == paid
    assert pending_files(job) == []


def test_redo_appends_what_was_wrong_and_replaces_the_file(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    redo_png = derived(data=base64.b64encode(ODD_PNG).decode())
    send = script(monkeypatch, fixture(OK), redo_png)
    assert run(vault, job) == 0
    assert pending_files(job) == ["01.jpg"]
    assert run(vault, job, "--redo", "1", "the cloak should be green.") == 0
    asked = send.calls[1]["input"][0]["text"]
    assert asked == (job.entries[0].prompt
                     + "\n\nThe last attempt was wrong: the cloak should be "
                       "green. Correct it.")
    assert send.calls[0]["input"][0]["text"] == job.entries[0].prompt
    assert pending_files(job) == ["01.png"]           # the old jpg is gone
    assert (image_jobs.folder(job.id) / "01.png").read_bytes() == ODD_PNG
    saved = reload(job)
    assert saved.entries[0].attempts == 2 and saved.entries[0].ext == "png"
    assert month(vault) == pytest.approx(2 * OK_CENTS, abs=0.1)


def test_redo_is_refused_past_the_vault_allowance(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    assert run(vault, job, "--redo", "1", "wrong hat") == 0
    assert len(send.calls) == 2
    before = month(vault)
    assert run(vault, job, "--redo", "1", "still wrong") == 1
    assert len(send.calls) == 2 and month(vault) == before
    assert "no redraws left (the vault allows 1)" in capsys.readouterr().out


def test_redraws_zero_allows_none(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=CONFIG + "    redraws: 0\n")
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    assert run(vault, job, "--redo", "1", "wrong") == 1
    assert len(send.calls) == 1
    assert "no redraws left (the vault allows 0)" in capsys.readouterr().out


def test_month_ceiling_stops_mid_run(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    image_money.record(vault, TODAY, 1990)     # room for two pictures, not three
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 2
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn", "drawn", "planned"]
    out = capsys.readouterr().out
    assert "3. NPCs/P3.md: not drawn, this month's ceiling (2000 cents) would be passed" in out
    assert "This run: 2 pictures drawn, 7.18 cents" in out
    assert "This month: 1997.18 of 2000 cents" in out


def test_the_month_figure_is_read_fresh_for_every_picture(tmp_path, monkeypatch):
    vault, job = start(tmp_path)

    class Elsewhere(Sender):
        def __call__(self, *a):
            reply = super().__call__(*a)
            if len(self.calls) == 1:                  # another process draws
                image_money.record(vault, TODAY, 1990)
            return reply
    send = Elsewhere(fixture(OK))
    monkeypatch.setattr(image_gemini, "SEND", send)
    assert run(vault, job) == 1
    assert len(send.calls) == 2                       # a cached figure would send 3


def test_the_run_cap_counts_what_the_job_spent(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, config=CONFIG + "    run_cap: 8\n")
    # planned within the cap? 3 x ~3.8 passes 8 only for two: the plan trims one
    assert [e.status for e in job.entries] == ["planned", "planned", "trimmed"]
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    assert len(send.calls) == 2


def test_stated_price_is_the_cost(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, config=CONFIG + "    price: 4\n")
    script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert [e.cost for e in reload(job).entries] == [4, 4, 4]
    assert month(vault) == 12
    assert "4.00 cents" in capsys.readouterr().out


def test_unpriced_draws_and_counts_pictures(tmp_path, monkeypatch, capsys):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: mystery\n"
           "    unpriced: true\n")
    vault, job = start(tmp_path, config=cfg)
    assert job.priced is False
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert len(send.calls) == 3
    assert month(vault) == 0
    assert image_money.unpriced_count(vault, TODAY) == 3
    saved = reload(job)
    assert [e.cost for e in saved.entries] == [None] * 3
    assert saved.spent == 0
    out = capsys.readouterr().out
    assert "drawn, " in out and "cost unknown" in out
    assert "This run: 3 pictures drawn, 0.00 cents, and 3 paid for at an unknown price" in out
    assert "This month: 0.00 of 2000 cents, and 3 pictures at an unknown price" in out


def test_auth_failure_stops_at_once_and_names_the_fix(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    send = script(monkeypatch, (401, b"{}"))
    assert run(vault, job) == 1
    assert len(send.calls) == 1
    out = capsys.readouterr().out
    assert "The picture service did not accept the key. Check the key: gma image key gemini" in out
    assert "not drawn" in out
    assert month(vault) == 0
    assert [e.status for e in reload(job).entries] == ["planned"] * 3


def test_quota_stops_at_once(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    send = script(monkeypatch, (429, b"{}"))
    assert run(vault, job) == 1 and len(send.calls) == 1
    assert "Check the account's limit or balance with the service." in capsys.readouterr().out


def test_the_key_is_in_no_output_or_job_file(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    leaky = image_gemini.ServiceError("reply", f"bad request {KEY}")
    script(monkeypatch, fixture(OK), leaky,
           (500, json.dumps({"error": {"message": f"echo {KEY}"}}).encode()),
           derived(content=[{"type": "text", "text": f"no {KEY}"}]))
    run(vault, job)
    run(vault, job)
    seen = capsys.readouterr()
    assert KEY not in seen.out + seen.err
    for p in list(image_jobs.folder(job.id).rglob("*")) + list(vault.rglob("*")):
        if p.is_file():
            assert KEY.encode() not in p.read_bytes(), p


def test_a_billed_failure_is_counted_and_uses_the_attempts(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    broken = derived(data=base64.b64encode(b"not a picture at all").decode())
    send = script(monkeypatch, broken)
    paid = pytest.approx(OK_CENTS, abs=0.01)
    assert run(vault, job) == 1
    e = reload(job).entries[0]
    assert e.status == "failed" and e.attempts == 1 and e.cost == paid
    assert month(vault) == paid and pending_files(job) == []
    assert run(vault, job) == 1                       # failed is drawn again ...
    assert reload(job).entries[0].attempts == 2 and len(send.calls) == 2
    before = month(vault)
    assert run(vault, job) == 1                       # ... until 1 + redraws is spent
    assert len(send.calls) == 2 and month(vault) == before
    assert "picture 1 has used all its attempts (the vault allows 2)" in capsys.readouterr().out


def test_a_network_failure_is_not_counted_and_uses_no_attempt(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, image_gemini.ServiceError("network", "the connection failed: OSError"))
    assert run(vault, job) == 1
    e = reload(job).entries[0]
    assert e.status == "failed" and e.attempts == 0 and e.cost is None
    assert month(vault) == 0 and image_money.unpriced_count(vault, TODAY) == 0
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0 and len(send.calls) == 1


def test_a_failed_redo_keeps_the_picture_already_drawn(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, fixture(OK), image_gemini.ServiceError("network", "down"))
    run(vault, job)
    assert run(vault, job, "--redo", "1", "wrong") == 1
    e = reload(job).entries[0]
    assert e.status == "drawn" and e.attempts == 1
    assert pending_files(job) == ["01.jpg"]


def test_a_picture_whose_reply_has_no_usage_is_counted_at_its_estimate(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    estimate = job.entries[0].estimate
    script(monkeypatch, derived(usage=None))
    assert run(vault, job) == 0
    e = reload(job).entries[0]
    assert e.cost == pytest.approx(estimate) and month(vault) == pytest.approx(estimate)


def test_thinking_needed_and_affordable_draws_with_thinking_and_remembers(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=2)
    send = script(monkeypatch, fixture("gemini-error-thinking-level.json"),
                  fixture("gemini-prompt-only.json"), fixture("gemini-prompt-only.json"))
    assert run(vault, job) == 0
    assert len(send.calls) == 3                       # 2 for the first, 1 for the next
    assert "generation_config" in send.calls[0]
    assert "generation_config" not in send.calls[1]
    assert "generation_config" not in send.calls[2]
    saved = reload(job)
    assert saved.needs_thinking is True
    assert [e.attempts for e in saved.entries] == [1, 1]   # the free refusal was no attempt
    assert month(vault) == pytest.approx(2 * 4.11, abs=0.05)


def test_thinking_needed_but_too_dear_is_not_sent(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=2, config=CONFIG + "    attempt_limit: 4.5\n")
    send = script(monkeypatch, fixture("gemini-error-thinking-level.json"))
    assert run(vault, job) == 1
    assert len(send.calls) == 2                       # one free call per picture
    out = capsys.readouterr().out
    assert ("this model will not draw without thinking, and with it this "
            "picture would pass the limit for one attempt") in out
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["planned", "planned"]
    assert [e.attempts for e in saved.entries] == [0, 0]
    assert saved.needs_thinking is False and month(vault) == 0


def test_a_redo_that_no_longer_fits_the_attempt_limit_is_not_sent(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    exact = job.entries[0].estimate
    set_config(vault, CONFIG + f"    attempt_limit: {exact}\n")
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert run(vault, job, "--redo", "1", "x" * 400) == 1
    assert len(send.calls) == 1
    assert "would pass the limit for one attempt" in capsys.readouterr().out
    assert reload(job).entries[0].status == "drawn"


def test_a_long_redo_note_is_cut_and_the_report_says_so(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    run(vault, job, "--redo", "1", "y" * 900)
    assert "Your note on picture 1 was cut to 500 characters." in capsys.readouterr().out
    assert send.calls[1]["input"][0]["text"].count("y") == 500


def test_a_missing_reference_is_dropped_and_the_picture_still_drawn(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, 2)
    (vault / "NPCs" / "Marta.md").write_text(
        "---\ntype: npc\nportrait: _attachments/characters/marta.png\n---\n",
        encoding="utf-8")
    (vault / "_attachments" / "characters").mkdir(parents=True)
    ref = vault / "_attachments" / "characters" / "marta.png"
    ref.write_bytes(PNG)
    job = image_jobs.plan(vault, [{"for": "P1", "subject": "a", "shows": ["Marta"]},
                                  {"for": "P2", "subject": "b", "shows": ["Marta"]}],
                          False, TODAY)
    assert [len(e.refs) for e in job.entries] == [1, 1]
    send = script(monkeypatch, fixture(OK))
    # one picture goes out with the likeness as a PNG ...
    assert run(vault, job) == 0
    parts = send.calls[0]["input"]
    assert [p["type"] for p in parts] == ["text", "image"]
    assert parts[1]["mime_type"] == "image/png"
    assert base64.b64decode(parts[1]["data"]) == PNG
    # ... and with the file gone, the next draw drops it and still draws
    ref.unlink()
    e = reload(job)
    e.entries[1].status = "planned"
    image_jobs.save(e)
    assert run(vault, job) == 0
    assert [p["type"] for p in send.calls[2]["input"]] == ["text"]
    assert "left out the reference picture marta.png: the file is missing" \
        in capsys.readouterr().out


def test_a_job_from_another_vault_is_refused_before_any_call(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    send = script(monkeypatch, fixture(OK))
    assert image.main(["draw", str(other), job.id]) == 2
    assert "that job belongs to another vault" in capsys.readouterr().err
    assert send.calls == [] and month(vault) == 0


def test_no_key_stops_before_any_call(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    monkeypatch.delenv("GEMINI_API_KEY")
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 2
    assert "No key found for gemini. Run in your own terminal: gma image key gemini" \
        in capsys.readouterr().err
    assert send.calls == []


def test_a_redo_of_a_picture_not_drawn_stops_before_any_call(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job, "--redo", "2", "wrong") == 2
    assert run(vault, job, "--redo", "9", "wrong") == 2
    assert run(vault, job, "--redo", "two", "wrong") == 2
    assert send.calls == []
    err = capsys.readouterr().err
    assert "has not been drawn yet" in err and "There is no picture 9" in err


def test_a_paid_picture_is_counted_even_if_it_cannot_be_written(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    monkeypatch.setattr(image_draw._Run, "keep_picture", lambda self, e, pic: False)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 1                       # a disk fault stops the run
    saved = reload(job)
    assert saved.entries[0].attempts == 1 and saved.entries[0].status == "failed"
    assert month(vault) == pytest.approx(OK_CENTS, abs=0.01)
    assert "paid for but could not be saved" in capsys.readouterr().out


def test_the_month_is_counted_before_the_picture_is_written(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    seen = {}
    real = image_money.record

    def spy(v, today, cents):
        seen["file_yet"] = bool(pending_files(job))
        seen["job_spent"] = job_in_memory.spent
        real(v, today, cents)
    job_in_memory = job
    monkeypatch.setattr(image_money, "record", spy)
    script(monkeypatch, fixture(OK))
    image_draw.draw(job, {}, TODAY)
    assert seen == {"file_yet": False, "job_spent": pytest.approx(OK_CENTS, abs=0.01)}


def test_a_job_that_cannot_be_saved_after_a_paid_picture_says_so(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=2)

    def broken(j):
        raise OSError("disk full")
    script(monkeypatch, fixture(OK))
    monkeypatch.setattr(image_jobs, "save", broken)
    assert run(vault, job) == 1
    out = capsys.readouterr().out
    assert "was paid for but could not be recorded in the job" in out
    assert "01.jpg" in out
    assert month(vault) == pytest.approx(OK_CENTS, abs=0.01)
    assert len(image_gemini.SEND.calls) == 1          # the run stopped


def test_the_report_shows_two_decimals(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=CONFIG + "    price: 4.5\n")
    script(monkeypatch, fixture(OK))
    run(vault, job)
    out = capsys.readouterr().out
    assert "4.50 cents" in out and "This run: 1 pictures drawn, 4.50 cents" in out


def test_a_month_count_that_cannot_be_updated_stops_the_run(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)

    def broken(*a):
        raise OSError("read-only")
    monkeypatch.setattr(image_money, "record", broken)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 1                       # no second paid call uncounted
    saved = reload(job)
    assert saved.entries[0].status == "drawn" and saved.entries[0].attempts == 1
    assert "paid for but this month's count could not be updated" \
        in capsys.readouterr().out


def test_an_unreadable_month_count_stops_before_any_call(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    (vault / "_meta" / "vault-state.json").write_text("{nope", encoding="utf-8")
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert send.calls == []
    assert "the month's count could not be read" in capsys.readouterr().out

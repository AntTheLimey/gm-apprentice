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
OFF = CONFIG + "    thinking: false\n"    # the vault turned thinking off
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
    assert ("This run: 3 pictures drawn, 10.76 cents "
                                  "(this job so far: 10.76 cents)") in out
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
    cut = image_gemini.ServiceError("network", "could not reach the service: no route", maybe_billed=False)
    send = script(monkeypatch, *([fixture(OK)] * 3 + [cut] * 3))
    assert run(vault, job) == 1
    assert len(send.calls) == 6                       # three failures stop the run
    out = capsys.readouterr().out
    assert "allow network access for gma image draw." in out
    assert "nothing was charged" not in out
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


def test_a_run_killed_while_a_request_is_out_counts_it_and_never_resends_it(
        tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, config=CONFIG + "    redraws: 0\n")
    estimate = job.entries[1].estimate
    script(monkeypatch, fixture(OK), KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):            # the program still stops
        run(vault, job)
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn", "failed", "planned"]
    e = saved.entries[1]
    assert e.attempts == 1 and e.cost == pytest.approx(estimate)
    assert month(vault) == pytest.approx(OK_CENTS + estimate, abs=0.01)
    assert saved.spent == pytest.approx(month(vault), abs=1e-3)
    out = capsys.readouterr().out
    assert ("2. NPCs/P2.md: failed, the request was interrupted (the reply was "
            "lost; it may have been charged, so it is counted at "
            f"{estimate:.2f} cents to be safe)") in out
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 1                       # only picture 3
    assert "picture 2 has used all its attempts (the vault allows 1)" \
        in capsys.readouterr().out


def test_an_interrupted_unpriced_request_counts_one_picture(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1, config=UNPRICED)
    script(monkeypatch, KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):
        run(vault, job)
    e = reload(job).entries[0]
    assert e.status == "failed" and e.attempts == 1 and e.cost is None
    assert image_money.unpriced_count(vault, TODAY) == 1 and month(vault) == 0


def test_an_interrupted_redo_keeps_the_earlier_picture(tmp_path, monkeypatch, capsys):
    vault, job, first, send = after_first_draw(tmp_path, monkeypatch,
                                               KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):
        run(vault, job, "--redo", "1", "wrong")
    check_earlier_picture_kept(vault, job, first, capsys)


def test_a_known_model_is_counted_at_its_real_cost_whatever_price_is_stated(
        tmp_path, monkeypatch, capsys):
    # A stated price of 1 cent once let five pictures through a 5 cent ceiling.
    vault, job = start(tmp_path, count=5,
                       config=OFF + "    month_cap: 5\n    price: 1\n")
    assert job.entries[0].estimate == pytest.approx(image_gemini.estimate(
        MODEL, image_jobs.SIZE, 0, len(job.entries[0].prompt.encode())))
    assert [e.status for e in job.entries] == ["planned"] + ["trimmed"] * 4
    for e in job.entries[1:]:                         # planned again, as if allowed
        e.status = "planned"
    image_jobs.save(job)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 1
    assert month(vault) == pytest.approx(OK_CENTS, abs=0.01)
    assert reload(job).entries[0].cost == pytest.approx(OK_CENTS, abs=0.01)
    assert "this month's ceiling (5 cents) would be passed" in capsys.readouterr().out


def test_a_refusal_is_reported_and_the_rest_draw(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    refusal = derived(content=[{"type": "text", "text": "I can't draw that"}])
    send = script(monkeypatch, fixture(OK), refusal, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 3
    saved = reload(job)
    assert [e.status for e in saved.entries] == ["drawn", "refused", "drawn"]
    assert saved.entries[1].said[-2] == "the service declined: I can't draw that"
    assert pending_files(job) == ["01.jpg", "03.jpg"]
    assert ("2. NPCs/P2.md: refused, the service declined: I can't draw that; "
            "plan it again with a different description") in capsys.readouterr().out
    assert saved.entries[1].said[-1] == "plan it again with a different description"


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
    vault, job = start(tmp_path, config=OFF + "    run_cap: 9\n")
    # planned within the cap? 3 x ~4.2 passes 9 only for two: the plan trims one
    assert [e.status for e in job.entries] == ["planned", "planned", "trimmed"]
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    assert len(send.calls) == 2


MYSTERY = "vault:\n  images:\n    service: gemini\n    model: mystery\n"


def test_stated_price_is_the_cost_of_a_model_with_no_rates(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, config=MYSTERY + "    price: 4\n")
    script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert [e.cost for e in reload(job).entries] == [4, 4, 4]
    assert month(vault) == 12
    assert "4.00 cents" in capsys.readouterr().out


def test_stated_price_is_not_the_cost_of_a_model_with_rates(tmp_path, monkeypatch):
    vault, job = start(tmp_path, config=CONFIG + "    price: 4\n")
    script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert [e.cost for e in reload(job).entries] == \
        [pytest.approx(OK_CENTS, abs=0.01)] * 3


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
    assert "This run: 3 pictures drawn at an unknown price" in out
    assert "This month: 0.00 of 2000 cents, and 3 pictures paid for at an unknown price" in out


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


def test_a_failure_before_sending_is_not_counted_and_uses_no_attempt(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, image_gemini.ServiceError("network", "could not reach the service: [Errno 61] Connection refused",
                                                    maybe_billed=False))
    assert run(vault, job) == 1
    e = reload(job).entries[0]
    assert e.status == "failed" and e.attempts == 0 and e.cost is None
    assert month(vault) == 0 and image_money.unpriced_count(vault, TODAY) == 0
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0 and len(send.calls) == 1


def test_a_failed_redo_keeps_the_picture_already_drawn(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, fixture(OK), image_gemini.ServiceError("network", "down", maybe_billed=False))
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
    vault, job = start(tmp_path, count=2, config=OFF + "    attempt_limit: 7\n")
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
    vault, job = start(tmp_path, count=2, config=OFF + "    attempt_limit: 4.5\n")
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
    vault, job = start(tmp_path, count=1, config=MYSTERY + "    price: 4.5\n")
    script(monkeypatch, fixture(OK))
    run(vault, job)
    out = capsys.readouterr().out
    assert "4.50 cents" in out and ("This run: 1 picture drawn, 4.50 cents "
                                  "(this job so far: 4.50 cents)") in out


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


# -- fix round 1 -----------------------------------------------------------------


def after_first_draw(tmp_path, monkeypatch, *more, config=CONFIG):
    """A one-picture job drawn once; `more` are the next replies."""
    vault, job = start(tmp_path, count=1, config=config)
    script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    first = (image_jobs.folder(job.id) / "01.jpg").read_bytes()
    send = script(monkeypatch, *more)
    return vault, job, first, send


def check_earlier_picture_kept(vault, job, first, capsys, attempts=2):
    e = reload(job).entries[0]
    assert e.status == "drawn" and e.ext == "jpg" and e.attempts == attempts
    assert (image_jobs.folder(job.id) / "01.jpg").read_bytes() == first
    assert pending_files(job) == ["01.jpg"]
    assert e.said[-1].startswith("the redraw failed (")
    assert e.said[-1].endswith("); the earlier picture is kept")
    assert reload(job).spent == pytest.approx(month(vault), abs=1e-3)
    assert month(vault) > OK_CENTS * 1.5          # the failed redraw was paid for
    capsys.readouterr()
    assert image.main(["place", str(vault), job.id, "--keep", "1"]) == 0
    assert "Nothing was changed" in capsys.readouterr().out    # it can still be kept


def test_a_refused_redo_keeps_the_earlier_picture(tmp_path, monkeypatch, capsys):
    vault, job, first, send = after_first_draw(
        tmp_path, monkeypatch, derived(content=[{"type": "text", "text": "no thanks"}]))
    assert run(vault, job, "--redo", "1", "wrong") == 1
    assert len(send.calls) == 1
    check_earlier_picture_kept(vault, job, first, capsys)
    assert "the service declined: no thanks" in reload(job).entries[0].said[-1]


def test_a_billed_error_on_a_redo_keeps_the_earlier_picture(tmp_path, monkeypatch, capsys):
    broken = derived(data=base64.b64encode(b"not a picture at all").decode())
    vault, job, first, send = after_first_draw(tmp_path, monkeypatch, broken)
    assert run(vault, job, "--redo", "1", "wrong") == 1
    check_earlier_picture_kept(vault, job, first, capsys)
    assert run(vault, job) == 0                      # a plain draw leaves it be
    assert len(send.calls) == 1


def test_a_lost_reply_on_a_redo_keeps_the_earlier_picture(tmp_path, monkeypatch, capsys):
    lost = image_gemini.ServiceError("network", "the reply was cut short: IncompleteRead",
                                     maybe_billed=True)
    vault, job, first, send = after_first_draw(tmp_path, monkeypatch, lost)
    assert run(vault, job, "--redo", "1", "wrong") == 1
    check_earlier_picture_kept(vault, job, first, capsys)


def test_a_lost_reply_is_counted_at_the_estimate_and_uses_an_attempt(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    estimate = job.entries[0].estimate
    script(monkeypatch, image_gemini.ServiceError(
        "network", "the reply was cut short: IncompleteRead", maybe_billed=True))
    assert run(vault, job) == 1
    e = reload(job).entries[0]
    assert e.status == "failed" and e.attempts == 1 and e.cost == pytest.approx(estimate)
    assert month(vault) == pytest.approx(estimate)
    out = capsys.readouterr().out
    assert (f"the reply was lost; it may have been charged, so it is counted at "
            f"{estimate:.2f} cents to be safe") in out
    assert "nothing was charged" not in out
    assert "allow network access for gma image draw." in out


def test_a_lost_reply_cannot_be_resent_past_the_attempts_across_runs(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    send = script(monkeypatch, image_gemini.ServiceError(
        "network", "the connection failed: TimeoutError", maybe_billed=True))
    for _ in range(4):
        run(vault, job)
    assert len(send.calls) == 2                       # 1 + redraws
    assert reload(job).entries[0].attempts == 2
    assert "used all its attempts (the vault allows 2)" in capsys.readouterr().out


def test_an_unpriced_lost_reply_counts_one_picture_at_an_unknown_price(tmp_path, monkeypatch, capsys):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: mystery\n"
           "    unpriced: true\n")
    vault, job = start(tmp_path, count=1, config=cfg)
    script(monkeypatch, image_gemini.ServiceError("network", "x", maybe_billed=True))
    run(vault, job)
    assert image_money.unpriced_count(vault, TODAY) == 1 and month(vault) == 0
    assert "so it is counted as one picture at an unknown price" in capsys.readouterr().out


UNPRICED = ("vault:\n  images:\n    service: gemini\n    model: mystery\n"
            "    unpriced: true\n")


def test_the_report_counts_replies_paid_for_that_gave_no_picture(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=UNPRICED)
    script(monkeypatch, image_gemini.ServiceError("network", "x", maybe_billed=True))
    run(vault, job)
    assert ("This run: no pictures drawn, 1 paid for at an unknown price"
            in capsys.readouterr().out)


def test_the_report_says_pictures_drawn_and_more_paid_for(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=3, config=UNPRICED)
    script(monkeypatch, fixture(OK), fixture(OK),
           image_gemini.ServiceError("network", "x", maybe_billed=True))
    run(vault, job)
    assert ("This run: 2 pictures drawn and 1 more paid for, all at an unknown price"
            in capsys.readouterr().out)


def test_the_report_says_one_picture_not_one_pictures(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=UNPRICED)
    script(monkeypatch, fixture(OK))
    run(vault, job)
    out = capsys.readouterr().out
    assert "This run: 1 picture drawn at an unknown price" in out
    assert "and 1 picture paid for at an unknown price" in out


def test_a_failure_before_sending_is_not_counted(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, image_gemini.ServiceError("network", "could not reach the service: refused", maybe_billed=False))
    run(vault, job)
    assert month(vault) == 0 and reload(job).entries[0].attempts == 0
    assert "nothing was charged" not in capsys.readouterr().out


def test_a_job_planned_unpriced_is_checked_when_the_price_setting_has_gone(tmp_path, monkeypatch, capsys):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: mystery\n"
           "    unpriced: true\n")
    vault, job = start(tmp_path, count=2, config=cfg)
    set_config(vault, cfg.replace("unpriced: true", "unpriced: false"))
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 2
    assert "does not know what mystery costs" in capsys.readouterr().err
    assert send.calls == []


def test_a_job_planned_unpriced_gets_every_fence_once_a_price_is_stated(tmp_path, monkeypatch, capsys):
    cfg = ("vault:\n  images:\n    service: gemini\n    model: mystery\n"
           "    unpriced: true\n")
    vault, job = start(tmp_path, count=2, config=cfg)
    assert [e.estimate for e in job.entries] == [None, None]
    set_config(vault, cfg + "    price: 9\n    attempt_limit: 5\n")   # over a 5 cent limit
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert send.calls == []
    assert "would pass the limit for one attempt" in capsys.readouterr().out
    set_config(vault, cfg + "    price: 4\n    run_cap: 5\n")
    assert run(vault, job) == 1
    assert len(send.calls) == 1                       # the second would pass the cap
    e = reload(job).entries
    assert e[0].estimate == 4 and e[0].cost == 4 and e[1].status == "planned"
    assert "the cap for one batch (5 cents) would be passed" in capsys.readouterr().out


def test_a_priced_job_keeps_the_attempt_limit_when_it_is_lowered_later(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    set_config(vault, CONFIG + "    attempt_limit: 1\n")
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1 and send.calls == []


def test_a_job_planned_on_a_stated_price_whose_price_is_gone_is_checked(tmp_path, monkeypatch, capsys):
    base = "vault:\n  images:\n    service: gemini\n    model: mystery\n"
    vault, job = start(tmp_path, count=2, config=base + "    price: 4\n")
    assert job.priced is True and [e.estimate for e in job.entries] == [4, 4]
    set_config(vault, base)                  # price removed; mystery has no rates
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 2
    assert "does not know what mystery costs" in capsys.readouterr().err
    assert send.calls == []
    set_config(vault, base + "    unpriced: true\n")
    assert run(vault, job) == 0
    assert len(send.calls) == 2
    assert image_money.unpriced_count(vault, TODAY) == 2 and month(vault) == 0
    assert "This run: 2 pictures drawn at an unknown price" in capsys.readouterr().out


def test_the_job_on_disk_shows_the_attempt_and_spend_before_the_picture_is_written(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    on_disk = {}

    def watch(self, e, pic):
        saved = reload(job)
        on_disk.update(attempts=saved.entries[0].attempts, spent=saved.spent,
                       status=saved.entries[0].status)
        return False
    monkeypatch.setattr(image_draw._Run, "keep_picture", watch)
    script(monkeypatch, fixture(OK))
    run(vault, job)
    assert on_disk == {"attempts": 1, "spent": pytest.approx(OK_CENTS, abs=0.01),
                       "status": "planned"}


def test_thinking_forced_by_the_model_does_not_say_turn_thinking_off(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, 1, OFF + "    attempt_limit: 6.2\n")
    for i in range(4):
        (vault / "NPCs" / f"R{i}.md").write_text(
            f"---\ntype: npc\nportrait: _attachments/characters/r{i}.png\n---\n",
            encoding="utf-8")
        (vault / "_attachments" / "characters").mkdir(parents=True, exist_ok=True)
        (vault / "_attachments" / "characters" / f"r{i}.png").write_bytes(PNG)
    job = image_jobs.plan(vault, [{"for": "P1", "subject": "x",
                                   "shows": [f"R{i}" for i in range(4)]}], False, TODAY)
    assert len(job.entries[0].refs) == 4
    job.needs_thinking = True
    image_jobs.save(job)
    send = script(monkeypatch, fixture("gemini-prompt-only.json"))
    assert run(vault, job) == 0
    out = capsys.readouterr().out
    assert ("This model will not draw without thinking, which costs more: raise "
            "the limit for one attempt to keep likenesses.") in out
    assert "turn thinking off" not in out
    assert len(send.calls[0]["input"]) < 5


def test_a_later_picture_that_does_not_fit_with_forced_thinking_gets_the_sentence(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=OFF + "    attempt_limit: 4.5\n")
    job.needs_thinking = True
    image_jobs.save(job)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1 and send.calls == []
    assert ("this model will not draw without thinking, and with it this "
            "picture would pass the limit for one attempt") in capsys.readouterr().out


def test_an_escaping_error_does_not_lose_the_report(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path)
    script(monkeypatch, fixture(OK), RuntimeError("surprise"))
    with pytest.raises(RuntimeError):
        run(vault, job)
    out = capsys.readouterr().out
    assert "1. NPCs/P1.md: drawn," in out
    assert reload(job).entries[0].status == "drawn" and month(vault) > 0


def test_a_line_already_said_is_not_added_again(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, image_gemini.ServiceError("reply", "the service is busy"))
    for _ in range(3):
        run(vault, job)
    said = reload(job).entries[0].said
    assert said.count("the service is busy") == 1


def test_the_run_cap_stops_a_call_that_the_plan_allowed(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, config=OFF)
    assert [e.status for e in job.entries] == ["planned"] * 3
    set_config(vault, OFF + "    run_cap: 8\n")         # lowered after the plan
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1
    assert len(send.calls) == 2
    assert "3. NPCs/P3.md: not drawn, the cap for one batch (8 cents) would be passed" \
        in capsys.readouterr().out


def test_a_redo_that_would_take_the_job_past_the_run_cap_is_not_sent(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=CONFIG + "    run_cap: 7\n")
    send = script(monkeypatch, fixture(OK))
    run(vault, job)
    assert run(vault, job, "--redo", "1", "wrong") == 1      # 3.59 + ~3.8 is over 7
    assert len(send.calls) == 1
    assert "the cap for one batch (7 cents) would be passed" in capsys.readouterr().out
    assert reload(job).entries[0].status == "drawn"


def test_a_declined_first_attempt_is_final_for_the_job(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    send = script(monkeypatch, derived(content=[{"type": "text", "text": "no"}]))
    assert run(vault, job) == 1
    before = month(vault)
    assert run(vault, job) == 0                       # nothing left to attempt
    assert len(send.calls) == 1 and month(vault) == before
    assert run(vault, job, "--redo", "1", "try again") == 2
    err = capsys.readouterr().err
    assert "plan it again with a different description" in err
    assert len(send.calls) == 1


def test_totals_that_cannot_be_read_after_a_draw_are_one_plain_line(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, fixture(OK))

    def broken(*a):
        raise vaultlib.StateUnreadable("vault-state.json is not valid JSON")
    monkeypatch.setattr(image_money, "unpriced_count", broken)
    assert run(vault, job) == 1
    assert capsys.readouterr().err == "vault-state.json is not valid JSON\n"


def test_the_last_reported_usage_is_kept_in_the_job_and_never_printed(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=2)
    script(monkeypatch, fixture(OK), derived(OK, usage=None))
    run(vault, job)
    first, second = reload(job).entries
    assert set(first.usage or {}) == {"input", "image", "other", "thought"}
    assert second.usage is None             # that reply carried none
    out = capsys.readouterr().out
    assert "thought" not in out and "'input'" not in out


def test_a_picture_not_sent_for_cost_with_thinking_on_names_thinking(tmp_path, monkeypatch, capsys):
    cfg = CONFIG + "    thinking: true\n"
    vault, job = start(tmp_path, count=1, config=cfg + "    attempt_limit: 7\n")
    set_config(vault, cfg + "    attempt_limit: 5\n")
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 1 and send.calls == []
    assert ("not drawn, this picture would pass the limit for one attempt "
            "(5 cents). Thinking is on, which costs more: raise the limit for "
            "one attempt or turn thinking off.") in capsys.readouterr().out


def test_a_redo_whose_reply_has_no_usage_clears_the_saved_usage(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert reload(job).entries[0].usage is not None
    script(monkeypatch, derived(OK, usage=None))
    assert run(vault, job, "--redo", "1", "darker") == 0
    assert reload(job).entries[0].usage is None


# -- final wave: A5, A7 -------------------------------------------------------

FORCED = ("This model will not draw without thinking, so pictures in this "
          "batch cost more and their cost varies.")


def test_thinking_forced_by_the_model_is_said_once_for_the_batch(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=2, config=OFF + "    attempt_limit: 7\n")
    script(monkeypatch, fixture("gemini-error-thinking-level.json"),
           fixture("gemini-prompt-only.json"), fixture("gemini-prompt-only.json"))
    assert run(vault, job) == 0
    out = capsys.readouterr().out
    assert out.count(FORCED) == 1
    first, second = reload(job).entries
    assert FORCED in first.said and FORCED not in second.said
    # a later draw of the same job (thinking already known) does not say it again
    script(monkeypatch, fixture("gemini-prompt-only.json"))
    assert run(vault, job, "--redo", "1", "darker") == 0
    assert FORCED not in capsys.readouterr().out


def test_a_vault_that_says_nothing_draws_with_thinking_on(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1)
    send = script(monkeypatch, fixture("gemini-prompt-only.json"))
    assert run(vault, job) == 0
    assert "generation_config" not in send.calls[0]
    assert job.entries[0].estimate == pytest.approx(image_gemini.estimate(
        MODEL, image_jobs.SIZE, 0, len(job.entries[0].prompt.encode()), True))


def test_a_vault_with_thinking_off_asks_for_the_least(tmp_path, monkeypatch):
    vault, job = start(tmp_path, count=1, config=OFF)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert send.calls[0]["generation_config"] == {"thinking_level": "minimal"}


def test_a_vault_with_thinking_on_is_not_told_the_model_forced_it(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1, config=CONFIG + "    thinking: true\n")
    script(monkeypatch, fixture("gemini-prompt-only.json"))
    assert run(vault, job) == 0
    assert FORCED not in capsys.readouterr().out


# -- final wave: B7 -----------------------------------------------------------

def test_a_reference_edited_to_point_outside_the_vault_is_never_sent(tmp_path, monkeypatch, capsys):
    vault, job = start(tmp_path, count=1)
    outside = tmp_path / "outside.png"
    outside.write_bytes(PNG)
    inside = vault / "_attachments" / "characters" / "link.png"
    inside.parent.mkdir(parents=True)
    inside.symlink_to(outside)                        # inside by name, outside in fact
    job.entries[0].refs = [str(outside), str(inside),
                           str(vault / ".." / "outside.png")]
    image_jobs.save(job)
    send = script(monkeypatch, fixture(OK))
    assert run(vault, job) == 0
    assert [p["type"] for p in send.calls[0]["input"]] == ["text"]
    out = capsys.readouterr().out
    for name in ("outside.png", "link.png"):
        assert f"left out the reference picture {name}: it is outside the vault" in out

"""The free picture sources: an installed Codex on a ChatGPT plan, and an agent
that draws with its own tool. Codex is a scripted `image_codex.RUN` fed the
real replies captured on 2026-11-10 (tests/fixtures/image/codex-*); no test
runs Codex, reaches a network or spends money."""

import subprocess
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image  # noqa: E402
import image_codex  # noqa: E402
import image_jobs  # noqa: E402
import tool_cache  # noqa: E402
import image_money  # noqa: E402
import vaultlib  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "image"
TODAY = date(2026, 11, 10)
PNG = b"\x89PNG\r\n\x1a\n" + b"codex picture"
JPG = b"\xff\xd8\xff\xe0" + b"my own picture"
DREW = (FIX / "codex-exec-drew.jsonl").read_text(encoding="utf-8")
SIGNED_OUT = (FIX / "codex-exec-signed-out.jsonl").read_text(encoding="utf-8")
RAN_COMMANDS = (FIX / "codex-exec-ran-commands.jsonl").read_text(encoding="utf-8")
DREW_THREAD = "01a1c5af-b9b3-71f3-9e0c-568551c5f9f6"
CHATGPT = (FIX / "codex-login-chatgpt.txt").read_text(encoding="utf-8")
NOT_IN = (FIX / "codex-login-none.txt").read_text(encoding="utf-8")


def done(stdout="", stderr="", code=0):
    return SimpleNamespace(stdout=stdout, stderr=stderr, returncode=code)


class Codex:
    """A scripted Codex: `login` is what `codex login status` prints; each
    `exec` answers with the next reply and, when the reply carries a
    picture, leaves it in Codex's own folder as the real one does."""

    def __init__(self, home, login=CHATGPT, login_code=0, replies=()):
        self.home, self.login, self.login_code = home, login, login_code
        self.replies = list(replies)
        self.execs: list[tuple[list[str], str]] = []

    def __call__(self, cmd, **kw):
        if cmd[1:3] == ["login", "status"]:
            return done(self.login, "", self.login_code)
        assert cmd[1] == "exec"
        self.execs.append((cmd, kw.get("input", "")))
        stdout, picture = self.replies.pop(0)
        if picture is not None:
            thread = image_codex.read_events(stdout).thread
            folder = self.home / "generated_images" / thread
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"exec-{len(self.execs)}.png").write_bytes(picture)
        return done(stdout, "Reading prompt from stdin...\n")


def drew(n):
    """The real 'drew' reply with its own thread, as each run has."""
    return DREW.replace(DREW_THREAD, f"01a1c5af-0000-0000-0000-{n:012d}")


@pytest.fixture
def codex(monkeypatch, tmp_path):
    home = tmp_path / "codex-home"
    monkeypatch.setenv("CODEX_HOME", str(home))
    monkeypatch.setattr(image_codex, "WHICH", lambda name: "/usr/local/bin/codex")
    fake = Codex(home)
    monkeypatch.setattr(image_codex, "RUN", fake)
    return fake


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    vaultlib.forget_settings(None)
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))
    monkeypatch.setenv("GMA_CACHE", str(tmp_path / "cache"))
    monkeypatch.setattr(image, "_today", lambda: TODAY)
    monkeypatch.setattr(sys, "platform", "linux")    # keys from a file, not the keychain
    yield
    vaultlib.forget_settings(None)


CODEX_CHOSEN = "vault:\n  images:\n    source: codex\n"


def make_vault(tmp_path, config=CODEX_CHOSEN, count=2):
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\n" + config, encoding="utf-8")
    for i in range(1, count + 1):
        p = vault / "NPCs" / f"P{i}.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("---\ntype: npc\nportrait:\n---\n# Body\n", encoding="utf-8")
    vaultlib.forget_settings(None)
    return vault


def requests(tmp_path, count=2, shows=None):
    import json
    reqs = [{"for": f"P{i}", "subject": f"person {i}"}
            | ({"shows": shows} if shows else {}) for i in range(1, count + 1)]
    f = tmp_path / "req.json"
    f.write_text(json.dumps(reqs), encoding="utf-8")
    return f


def plan(vault, tmp_path, *extra, count=2, shows=None):
    return image.main(["plan", str(vault), str(requests(tmp_path, count, shows)),
                       *extra])


def job_id(out):
    return out.splitlines()[0].split()[1]


GEMINI = "vault:\n  images:\n    service: gemini\n    model: gemini-nano-banana-2.1\n"


# --- signing in -------------------------------------------------------------

def test_a_chatgpt_sign_in_is_free(codex):
    assert image_codex.login().state == "chatgpt"


def test_not_signed_in(codex):
    codex.login, codex.login_code = NOT_IN, 1
    assert image_codex.login().state == "none"


def test_any_other_sign_in_is_paid(codex):
    # A real wording from the Codex program's own text.
    codex.login = "Logged in using personal access token\n"
    got = image_codex.login()
    assert got.state == "other" and "charged" in got.line


def test_no_codex_installed():
    assert image_codex.login().state == "missing"   # conftest: none installed


def test_a_codex_that_hangs_is_not_counted_on(codex, monkeypatch):
    def hang(*a, **k):
        raise subprocess.TimeoutExpired("codex", 30)
    monkeypatch.setattr(image_codex, "RUN", hang)
    assert image_codex.login().state == "unknown"


# --- reading what Codex said ----------------------------------------------

def test_reads_the_real_drew_reply():
    ev = image_codex.read_events(DREW)
    assert ev.thread == DREW_THREAD and ev.said == "DONE" and ev.errors == []


def test_reads_the_real_signed_out_reply_without_the_retries():
    ev = image_codex.read_events(SIGNED_OUT)
    assert ev.errors and all(not e.startswith("Reconnecting") for e in ev.errors)
    assert "401 Unauthorized" in ev.errors[-1]


def test_a_reply_where_codex_ran_commands_still_reads():
    ev = image_codex.read_events(RAN_COMMANDS)
    assert ev.thread and ev.said.startswith("TOOL:")


# --- one picture ------------------------------------------------------------

def test_draw_collects_the_picture_from_codex_folder(codex, tmp_path):
    codex.replies = [(DREW, PNG)]
    ref = tmp_path / "ref.png"
    ref.write_bytes(PNG)
    pic = image_codex.draw("a man at a desk", [str(ref)], "3:4", tmp_path)
    assert pic.data == PNG and pic.ext == "png"
    cmd, prompt = codex.execs[0]
    assert cmd[-1] == "-" and f"--image={ref}" in cmd
    assert cmd[cmd.index("--sandbox") + 1] == "read-only"
    assert "Portrait format, 3:4." in prompt and "likeness references" in prompt
    assert "a man at a desk" in prompt


def test_no_likeness_line_without_references(codex, tmp_path):
    codex.replies = [(DREW, PNG)]
    image_codex.draw("a dock", [], "16:9", tmp_path)
    assert "likeness" not in codex.execs[0][1]


def test_signed_out_stops_the_run(codex, tmp_path):
    codex.replies = [(SIGNED_OUT, None)]
    with pytest.raises(image_codex.Failed) as err:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert err.value.stop and "401" in err.value.message
    assert "Reconnecting" not in err.value.message


def test_a_refusal_is_a_refusal(codex, tmp_path):
    codex.replies = [(drew(1).replace('"DONE"', '"REFUSED: not that picture"'), None)]
    with pytest.raises(image_codex.Refused) as no:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert no.value.reason.strip() == "not that picture"


def test_a_reply_with_no_picture_fails_without_stopping(codex, tmp_path):
    codex.replies = [(drew(2), None)]
    with pytest.raises(image_codex.Failed) as err:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert not err.value.stop and "DONE" in err.value.message


def test_a_strange_thread_name_finds_no_picture(codex, tmp_path):
    (tmp_path / "codex-home" / "x.png").parent.mkdir(parents=True)
    (tmp_path / "codex-home" / "x.png").write_bytes(PNG)
    codex.replies = [(DREW.replace(DREW_THREAD, "../.."), None)]
    with pytest.raises(image_codex.Failed):
        image_codex.draw("x", [], "1:1", tmp_path)


def test_a_timeout_fails_that_picture_only(codex, monkeypatch, tmp_path):
    def slow(cmd, **k):
        raise subprocess.TimeoutExpired("codex", image_codex.TIMEOUT)
    monkeypatch.setattr(image_codex, "RUN", slow)
    with pytest.raises(image_codex.Failed) as err:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert not err.value.stop and "10 minutes" in err.value.message


# --- choosing the source: always the GM's ------------------------------------

def test_nothing_chosen_asks_the_gm_even_with_codex_signed_in(codex, tmp_path, capsys):
    assert plan(make_vault(tmp_path, ""), tmp_path) == 2
    assert capsys.readouterr().err.strip() == image_jobs.CHOOSE
    assert codex.execs == []


def test_codex_chosen_draws_with_codex(codex, tmp_path, capsys):
    assert plan(make_vault(tmp_path), tmp_path) == 0      # no Gemini key needed
    out = capsys.readouterr().out
    job = image_jobs.load(job_id(out))
    assert job.service == "codex" and not job.priced
    assert all(e.estimate is None for e in job.entries)
    assert "by Codex (its built-in image tool) on the ChatGPT plan, no money counted" in out
    assert "cents" not in out


def test_a_service_and_model_set_count_as_choosing_the_service(codex, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "AIza-FAKE")
    assert plan(make_vault(tmp_path, GEMINI), tmp_path) == 0
    out = capsys.readouterr().out
    assert image_jobs.load(job_id(out)).service == "gemini"
    assert ("Drawn by gemini, model gemini-nano-banana-2.1, on the GM's key: "
            "this costs money.") in out


def test_a_service_set_is_never_passed_over_for_codex(codex, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "AIza-FAKE")
    plan(make_vault(tmp_path, GEMINI), tmp_path)    # Codex is signed in, free
    assert image_jobs.load(job_id(capsys.readouterr().out)).service == "gemini"


def test_source_flag_names_codex_for_one_batch(codex, tmp_path, capsys):
    assert plan(make_vault(tmp_path, GEMINI), tmp_path, "--source", "codex") == 0
    assert image_jobs.load(job_id(capsys.readouterr().out)).service == "codex"


def test_the_vault_setting_wins_over_the_service_setting(codex, tmp_path, capsys):
    assert plan(make_vault(tmp_path, GEMINI + "    source: codex\n"), tmp_path) == 0
    assert image_jobs.load(job_id(capsys.readouterr().out)).service == "codex"


def test_codex_chosen_but_not_signed_in_stops(codex, tmp_path, capsys):
    codex.login, codex.login_code = NOT_IN, 1
    assert plan(make_vault(tmp_path), tmp_path) == 2
    assert "codex login" in capsys.readouterr().err


def test_codex_chosen_with_a_paid_sign_in_stops(codex, tmp_path, capsys):
    codex.login = "Logged in using personal access token\n"
    assert plan(make_vault(tmp_path), tmp_path) == 2
    err = capsys.readouterr().err
    assert "charged" in err and "codex login" in err


def test_self_chosen_in_the_vault(tmp_path, capsys):
    assert plan(make_vault(tmp_path, "vault:\n  images:\n    source: self\n"), tmp_path) == 0
    assert image_jobs.load(job_id(capsys.readouterr().out)).service == "self"


def test_unprompted_still_needs_the_switch_for_free_sources(codex, tmp_path, capsys):
    assert plan(make_vault(tmp_path), tmp_path, "--unprompted") == 2
    assert "Drawing without asking is off" in capsys.readouterr().err


# --- drawing through Codex ----------------------------------------------------

def test_codex_draws_the_job_and_no_money_is_counted(codex, tmp_path, capsys):
    vault = make_vault(tmp_path)
    plan(vault, tmp_path)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(1), PNG), (drew(2), PNG)]
    assert image.main(["draw", str(vault), jid]) == 0
    out = capsys.readouterr().out
    job = image_jobs.load(jid)
    assert [e.status for e in job.entries] == ["drawn", "drawn"]
    assert [e.attempts for e in job.entries] == [1, 1]
    assert job.spent == 0 and image_money.spent(vault, TODAY) == 0
    assert "This run: 2 pictures drawn by Codex (its built-in image tool) on the ChatGPT plan, no money counted" in out
    assert "This month" not in out
    # And the pictures place like any other.
    assert image.main(["place", str(vault), jid, "--keep", "1", "2", "--write"]) == 0
    assert "portrait: \"_attachments/characters/p1.png\"" in (vault / "NPCs" / "P1.md").read_text()


def test_a_codex_redo_says_what_was_wrong_and_keeps_the_limit(codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=1)
    plan(vault, tmp_path, count=1)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(1), PNG), (drew(2), PNG)]
    image.main(["draw", str(vault), jid])
    assert image.main(["draw", str(vault), jid, "--redo", "1", "no hat"]) == 0
    assert "The last attempt was wrong: no hat" in codex.execs[1][1]
    assert image.main(["draw", str(vault), jid, "--redo", "1", "still"]) == 1
    assert "no redraws left" in capsys.readouterr().out
    assert len(codex.execs) == 2


def test_signed_out_mid_job_stops_and_names_the_paid_way(codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=3)
    plan(vault, tmp_path, count=3)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(1), PNG), (SIGNED_OUT, None)]
    assert image.main(["draw", str(vault), jid]) == 1
    out = capsys.readouterr().out
    assert len(codex.execs) == 2
    assert "3. NPCs/P3.md: not drawn" in out
    assert "--source service" in out
    job = image_jobs.load(jid)
    assert [e.status for e in job.entries] == ["drawn", "failed", "planned"]
    assert job.entries[1].attempts == 0     # a failure uses no attempt


def test_a_failed_codex_redo_keeps_the_earlier_picture(codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=1)
    plan(vault, tmp_path, count=1)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(1), PNG), (drew(2), None)]
    image.main(["draw", str(vault), jid])
    assert image.main(["draw", str(vault), jid, "--redo", "1", "x"]) == 1
    e = image_jobs.load(jid).entries[0]
    assert e.status == "drawn" and Path(f"{e.pending}.png").read_bytes() == PNG


def test_three_codex_failures_in_a_row_stop_the_run(codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=4)
    plan(vault, tmp_path, count=4)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(n), None) for n in range(3)]
    assert image.main(["draw", str(vault), jid]) == 1
    assert len(codex.execs) == 3
    assert "3 pictures in a row" in capsys.readouterr().out


def test_a_codex_run_that_leaves_no_picture_uses_an_attempt_after_the_first(
        codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=1)
    plan(vault, tmp_path, count=1)
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(n), None) for n in range(1, 4)]
    seen = []
    for _ in range(3):
        assert image.main(["draw", str(vault), jid]) == 1
        seen.append(image_jobs.load(jid).entries[0].attempts)
    assert seen == [0, 1, 2]                 # the first is forgiven
    capsys.readouterr()
    assert image.main(["draw", str(vault), jid]) == 1
    assert "has used all its attempts" in capsys.readouterr().out
    assert len(codex.execs) == 3             # and Codex is not asked again


def test_a_codex_run_that_reports_an_error_is_not_blank(codex, tmp_path):
    codex.replies = [(SIGNED_OUT, None)]
    with pytest.raises(image_codex.Failed) as err:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert not err.value.blank
    codex.replies = [(drew(5), None)]
    with pytest.raises(image_codex.Failed) as err:
        image_codex.draw("x", [], "1:1", tmp_path)
    assert err.value.blank


def test_codex_gets_the_likeness_pictures(codex, tmp_path, capsys):
    vault = make_vault(tmp_path, count=2)
    pic = vault / "_attachments" / "npcs" / "p2.png"
    pic.parent.mkdir(parents=True)
    pic.write_bytes(PNG)
    (vault / "NPCs" / "P2.md").write_text(
        "---\ntype: npc\nportrait: _attachments/npcs/p2.png\n---\n", encoding="utf-8")
    import json
    reqs = tmp_path / "r.json"
    reqs.write_text(json.dumps([{"for": "P1", "subject": "x", "shows": ["P2"]}]))
    image.main(["plan", str(vault), str(reqs)])
    jid = job_id(capsys.readouterr().out)
    codex.replies = [(drew(1), PNG)]
    assert image.main(["draw", str(vault), jid]) == 0
    assert any(a.startswith("--image=") and a.endswith("p2.png")
               for a in codex.execs[0][0])


# --- an agent that draws for itself ------------------------------------------

def self_job(tmp_path, capsys, count=2, config=""):
    vault = make_vault(tmp_path, config, count=count)
    assert plan(vault, tmp_path, "--source", "self", count=count) == 0
    out = capsys.readouterr().out
    return vault, job_id(out), out


def test_a_self_plan_needs_no_service_and_prints_what_to_draw(tmp_path, capsys):
    vault, jid, out = self_job(tmp_path, capsys)
    assert "by you, with your own image tool" in out
    assert "prompt: person 1" in out and "shape: 3:4" in out
    assert "--picture N FILE" in out and "cents" not in out


def test_draw_on_a_self_job_says_how_to_hand_in(tmp_path, capsys):
    vault, jid, _ = self_job(tmp_path, capsys)
    assert image.main(["draw", str(vault), jid]) == 2
    assert "--picture N FILE" in capsys.readouterr().err


def test_handing_in_pictures(tmp_path, capsys):
    vault, jid, _ = self_job(tmp_path, capsys)
    a, b = tmp_path / "a.png", tmp_path / "b.jpg"
    a.write_bytes(PNG)
    b.write_bytes(JPG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a),
                       "--picture", "2", str(b)]) == 0
    out = capsys.readouterr().out
    assert "This run: 2 pictures drawn by you" in out
    job = image_jobs.load(jid)
    assert [e.ext for e in job.entries] == ["png", "jpg"]
    assert [e.attempts for e in job.entries] == [1, 1]
    assert a.exists()                       # copied, never moved
    assert image.main(["place", str(vault), jid, "--keep", "1", "2", "--write"]) == 0


def test_a_second_hand_in_is_a_redraw_under_the_limit(tmp_path, capsys):
    vault, jid, _ = self_job(tmp_path, capsys, count=1)
    a = tmp_path / "a.png"
    a.write_bytes(PNG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a)]) == 0
    b = tmp_path / "b.jpg"
    b.write_bytes(JPG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(b)]) == 0
    e = image_jobs.load(jid).entries[0]
    assert e.ext == "jpg" and not Path(f"{e.pending}.png").exists()
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a)]) == 1
    assert "no redraws left" in capsys.readouterr().out


def test_a_file_that_is_not_a_picture_is_refused_before_any_is_taken(tmp_path, capsys):
    vault, jid, _ = self_job(tmp_path, capsys)
    a, bad = tmp_path / "a.png", tmp_path / "notes.txt"
    a.write_bytes(PNG)
    bad.write_text("hello")
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a),
                       "--picture", "2", str(bad)]) == 2
    assert "not a PNG or JPEG" in capsys.readouterr().err
    assert [e.status for e in image_jobs.load(jid).entries] == ["planned", "planned"]


def test_hand_in_and_redo_do_not_mix(tmp_path, capsys):
    vault, jid, _ = self_job(tmp_path, capsys)
    a = tmp_path / "a.png"
    a.write_bytes(PNG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a),
                       "--redo", "1", "x"]) == 2


def test_a_picture_cannot_be_handed_in_for_a_codex_job(codex, tmp_path, capsys):
    vault = make_vault(tmp_path)
    plan(vault, tmp_path)
    jid = job_id(capsys.readouterr().out)
    a = tmp_path / "a.png"
    a.write_bytes(PNG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a)]) == 2
    assert "not by you" in capsys.readouterr().err


# --- status -------------------------------------------------------------------

def test_status_says_nothing_chosen_and_whether_codex_can_draw(codex, tmp_path, capsys):
    assert image.main(["status", str(make_vault(tmp_path, ""))]) == 0
    out = capsys.readouterr().out
    assert "source: none chosen; the GM chooses" in out
    assert ("codex: Codex is signed in with a ChatGPT plan (can draw with no "
            "money counted, if chosen)") in out


def test_status_without_codex_installed_says_nothing_of_it(tmp_path, capsys):
    image.main(["status", str(make_vault(tmp_path, GEMINI))])
    out = capsys.readouterr().out
    assert "source: service (from the service setting)" in out and "codex:" not in out


# --- an agent in a sandbox that cannot write to the cache folder -------------

def sandboxed(monkeypatch, tmp_path):
    """The cache folder refuses writes, as Codex's workspace sandbox does;
    the temp folder takes them."""
    locked = tmp_path / "locked-cache"
    monkeypatch.setenv("GMA_CACHE", str(locked))
    monkeypatch.setattr(image_jobs, "TEMP", lambda: str(tmp_path / "tmp"))
    real = image_jobs._writable
    monkeypatch.setattr(image_jobs, "_writable",
                        lambda root: False if locked in root.parents or root == locked / "images"
                        else real(root))
    return tmp_path / "tmp" / "gm-apprentice-images"


def test_a_sandboxed_agent_keeps_its_jobs_in_the_temp_folder(tmp_path, monkeypatch, capsys):
    temp_root = sandboxed(monkeypatch, tmp_path)
    vault, jid, out = self_job(tmp_path, capsys, count=1)
    assert f"Job file: {temp_root / jid / 'job.json'}" in out
    a = tmp_path / "a.png"
    a.write_bytes(PNG)
    assert image.main(["draw", str(vault), jid, "--picture", "1", str(a)]) == 0
    assert (temp_root / jid / "01.png").read_bytes() == PNG
    assert image.main(["place", str(vault), jid, "--keep", "1", "--write"]) == 0


def test_a_job_made_in_the_temp_folder_is_found_outside_the_sandbox(tmp_path, monkeypatch, capsys):
    temp_root = sandboxed(monkeypatch, tmp_path)
    vault, jid, _ = self_job(tmp_path, capsys, count=1)
    monkeypatch.setattr(image_jobs, "_writable", lambda root: True)   # the GM's own terminal
    # the next process that can write to the cache folder moves the job there
    moved = tool_cache.cache_root() / "images" / jid
    assert image_jobs.folder(jid) == moved
    assert not (temp_root / jid).exists()
    assert image_jobs.load(jid).id == jid


def test_nowhere_to_write_names_both_places(tmp_path, monkeypatch, capsys):
    sandboxed(monkeypatch, tmp_path)
    monkeypatch.setattr(image_jobs, "_writable", lambda root: False)
    monkeypatch.setattr(image_jobs, "save", lambda job: (_ for _ in ()).throw(PermissionError()))
    assert plan(make_vault(tmp_path), tmp_path, "--source", "self") == 2
    err = capsys.readouterr().err
    assert "PermissionError" in err and "gm-apprentice-images" in err and "sandbox" in err


def test_old_jobs_in_the_temp_folder_are_tidied_too(tmp_path, monkeypatch):
    temp_root = sandboxed(monkeypatch, tmp_path)
    old = temp_root / "20261001-abcdef"
    old.mkdir(parents=True)
    import os
    stamp = 1759276800   # 2025-10-01
    os.utime(old, (stamp, stamp))
    image_jobs.prune(TODAY)
    assert not old.exists()


def test_a_self_plan_with_nothing_planned_does_not_say_to_draw(tmp_path, capsys):
    vault = make_vault(tmp_path, count=1)
    (vault / "NPCs" / "P1.md").write_text(
        "---\ntype: npc\nportrait: x.png\n---\n", encoding="utf-8")
    assert plan(vault, tmp_path, "--source", "self", count=1) == 1
    out = capsys.readouterr().out
    assert "it already has a picture" in out and "--picture N FILE" not in out


# --- the sign-in is checked again when drawing ---------------------------------

def test_a_codex_signed_in_another_way_since_the_plan_draws_nothing(codex, tmp_path, capsys):
    vault = make_vault(tmp_path)
    plan(vault, tmp_path)
    jid = job_id(capsys.readouterr().out)
    codex.login = "Logged in using personal access token\n"
    assert image.main(["draw", str(vault), jid]) == 2
    assert codex.execs == []
    err = capsys.readouterr().err
    assert "charged" in err and "the GM agrees" in err


# --- the real runner: whole process group on a timeout, UTF-8 always ----------

def test_a_timeout_ends_the_program_beneath_the_launcher(tmp_path):
    # A launcher that starts a child holding the output pipe, as Codex's
    # npm launcher does, then both wait.
    child = "import time; time.sleep(60)"
    launcher = ("import subprocess, sys, time; "
                f"subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(60)")
    import time
    start = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        image_codex._run([sys.executable, "-c", launcher], timeout=1)
    assert time.monotonic() - start < 20


def test_codex_output_is_read_as_utf8_whatever_the_code_page(tmp_path):
    said = "I’ll draw “her” …"
    got = image_codex._run(
        [sys.executable, "-c",
         f"import sys; sys.stdout.buffer.write({said!r}.encode('utf-8')); "
         "sys.stdout.buffer.write(sys.stdin.buffer.read())"],
        input="Hôtel de Brissac", timeout=30)
    assert got.stdout == said + "Hôtel de Brissac"


def test_an_errored_run_does_not_make_the_next_blank_run_count(codex, tmp_path, capsys):
    import json
    vault = make_vault(tmp_path, count=1)
    plan(vault, tmp_path, count=1)
    jid = job_id(capsys.readouterr().out)
    errored = drew(1) + json.dumps({"type": "error", "message": "tool broke"}) + "\n"
    codex.replies = [(errored, None), (drew(2), None)]
    assert image.main(["draw", str(vault), jid]) == 1      # an error: no attempt
    assert image.main(["draw", str(vault), jid]) == 1      # the first blank run
    assert image_jobs.load(jid).entries[0].attempts == 0   # forgiven
    codex.replies = [(drew(3), None)]
    assert image.main(["draw", str(vault), jid]) == 1      # the second blank
    assert image_jobs.load(jid).entries[0].attempts == 1

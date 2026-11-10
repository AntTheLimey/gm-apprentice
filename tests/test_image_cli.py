"""gma image: status and key."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image  # noqa: E402
import image_gemini  # noqa: E402
import image_keys  # noqa: E402
import vaultlib  # noqa: E402

SECRET = "sk-very-secret-text"


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    vaultlib.forget_settings(None)
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))
    monkeypatch.setattr(sys, "platform", "linux")

    def boom(*a, **k):
        raise AssertionError("the real keychain was touched")
    monkeypatch.setattr(image_keys, "RUN", boom)

    def no_network(*a, **k):
        raise AssertionError("a real call to the service")
    monkeypatch.setattr(image_gemini, "SEND", no_network)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path: Path, body: str = "") -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\n" + body, encoding="utf-8")
    return vault


def test_status_without_a_key(tmp_path, capsys):
    assert image.main(["status", str(make_vault(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "key: none found" in out
    assert "0 of 2000 cents" in out
    assert "_Campaign/Image_Guidance.md (not written yet)" in out
    assert "unprompted drawing: off" in out
    assert "none chosen" in out


def test_status_with_a_key_never_prints_it(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    assert image.main(["status", str(make_vault(tmp_path))]) == 0
    out = capsys.readouterr()
    assert "key: found (environment)" in out.out
    assert SECRET not in out.out + out.err


def test_status_guidance_note_present(tmp_path, capsys):
    v = make_vault(tmp_path)
    (v / "_Campaign").mkdir()
    (v / "_Campaign" / "Image_Guidance.md").write_text("x")
    image.main(["status", str(v)])
    out = capsys.readouterr().out
    assert "_Campaign/Image_Guidance.md" in out and "not written yet" not in out


def test_status_not_a_vault(tmp_path, capsys):
    assert image.main(["status", str(tmp_path / "nope")]) == 2


def test_key_needs_a_terminal(monkeypatch, capsys):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
    assert image.main(["key", "gemini"]) == 2
    assert ("Run this in your own terminal window: gma image key gemini"
            in capsys.readouterr().out)


def test_key_stores_and_does_not_echo(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(image_keys.getpass, "getpass", lambda prompt="": SECRET)
    assert image.main(["key", "gemini"]) == 0
    out = capsys.readouterr()
    assert SECRET not in out.out + out.err
    assert image_keys.find("gemini") == (SECRET, "key file")


def test_key_unknown_service(capsys):
    assert image.main(["key", "nonesuch"]) == 2
    assert "no drawing service called" in capsys.readouterr().err


def test_status_prints_the_real_month_count(tmp_path, capsys, monkeypatch):
    from datetime import date
    import image_money
    v = make_vault(tmp_path)
    today = date(2026, 11, 30)
    monkeypatch.setattr(image, "_today", lambda: today)
    image_money.record(v, today, 3.4)
    image_money.record(v, today, 4.1)
    image_money.record(v, today, None)
    assert image.main(["status", str(v)]) == 0
    out = capsys.readouterr().out
    assert "spent this month: 7.50 of 2000 cents" in out
    assert "pictures paid for this month at an unknown price: 1" in out


def test_status_says_when_the_state_file_is_broken(tmp_path, capsys):
    v = make_vault(tmp_path)
    (v / "_meta" / "vault-state.json").write_text("{nope", encoding="utf-8")
    assert image.main(["status", str(v)]) == 2
    assert "not valid JSON" in capsys.readouterr().err


def test_status_says_one_line_for_a_damaged_count(tmp_path, capsys):
    v = make_vault(tmp_path)
    (v / "_meta" / "vault-state.json").write_text(
        '{"images": {"months": {"2026-11": [1999]}}}', encoding="utf-8")
    assert image.main(["status", str(v)]) == 2
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and "images" in err and "vault-state.json" in err


# --- plan -----------------------------------------------------------------

def plan_vault(tmp_path: Path, model: str, extra: str = "") -> Path:
    v = make_vault(tmp_path, "vault:\n  images:\n    service: gemini\n"
                   f"    model: {model}\n{extra}")
    (v / "NPCs").mkdir()
    (v / "NPCs" / "Anselm.md").write_text(
        "---\ntype: npc\n---\n# Anselm\n", encoding="utf-8")
    return v


def requests(tmp_path: Path, items) -> Path:
    import json
    p = tmp_path / "requests.json"
    p.write_text(json.dumps(items), encoding="utf-8")
    return p


def test_plan_unpriced_stop_prints_the_exact_sentence(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "mystery-model")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "A man."}])
    assert image.main(["plan", str(v), str(req)]) == 2
    out = capsys.readouterr()
    assert out.err.strip() == (
        "The apprentice does not know what mystery-model costs, so it cannot "
        "limit spending on it: the limit per attempt, the cap per run and the "
        "month's ceiling will not apply. To draw anyway: gma publish settings "
        "set vault.images.unpriced on. To keep the limits, state the price: "
        "gma publish settings set vault.images.price <cents>")
    assert SECRET not in out.out + out.err


def test_plan_prints_the_job(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "A man."},
                              {"for": "Nobody", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 0
    out = capsys.readouterr().out
    print(out)
    assert "1. NPCs/Anselm.md: planned, about" in out
    assert "2. Nobody: refused" in out
    assert "Estimated total: about" in out and "Job file:" in out
    assert SECRET not in out


def test_plan_with_nothing_to_draw_exits_1(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Nobody", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 1


def test_plan_bad_requests_and_bad_state_exit_2_without_a_traceback(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert image.main(["plan", str(v), str(bad)]) == 2
    assert image.main(["plan", str(v), str(tmp_path / "missing.json")]) == 2
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}, {"for": "y"}])
    assert image.main(["plan", str(v), str(req)]) == 2
    assert "Request 2" in capsys.readouterr().err
    (v / vaultlib.STATE_FILE).write_text(
        '{"images": {"months": {"2026-11": {"cents": "lots"}}}}', encoding="utf-8")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 2
    assert "vault-state.json" in capsys.readouterr().err


def test_plan_unwritable_job_folder_says_so(tmp_path, monkeypatch, capsys):
    import image_jobs
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])

    def boom(job):
        raise PermissionError("no")
    monkeypatch.setattr(image_jobs, "save", boom)
    assert image.main(["plan", str(v), str(req)]) == 2
    assert "could not be saved (PermissionError)" in capsys.readouterr().err


# --- minor wave: K1, K3, K4, K6, J3 ---------------------------------------

def test_status_carries_on_when_the_keychain_is_silent(tmp_path, monkeypatch, capsys):
    def silent(service):
        raise image_keys.StoreUnavailable(
            "The keychain did not answer. Unlock it and try again.")
    monkeypatch.setattr(image_keys, "find", silent)
    assert image.main(["status", str(make_vault(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "key: The keychain did not answer. Unlock it and try again." in out
    assert "spent this month" in out


def test_plan_stops_when_the_keychain_is_silent(tmp_path, monkeypatch, capsys):
    def silent(service):
        raise image_keys.StoreUnavailable(
            "The keychain did not answer. Unlock it and try again.")
    monkeypatch.setattr(image_keys, "find", silent)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 2
    assert capsys.readouterr().err.strip() == (
        "The keychain did not answer. Unlock it and try again.")


def test_key_failure_on_a_mac_is_plain(monkeypatch, capsys):
    import subprocess
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)

    def run(cmd, **kw):
        raise subprocess.CalledProcessError(1, cmd)
    monkeypatch.setattr(image_keys, "RUN", run)
    assert image.main(["key", "gemini"]) == 1
    err = capsys.readouterr().err
    assert err.strip() == ("The key was not stored. If the two entries did "
                           "not match, run the command again.")
    assert "security" not in err


def test_key_reports_a_set_aside_file(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(image_keys.getpass, "getpass", lambda prompt="": SECRET)
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    (cfg / "keys.json").write_text("[1]")
    assert image.main(["key", "gemini"]) == 0
    out = capsys.readouterr().out
    assert "set aside as keys.json.unreadable." in out and SECRET not in out


def test_the_image_group_has_help_text():
    ap = image.build_parser()
    sub = next(a for a in ap._actions if a.dest == "command")
    assert sub.help


# --- minor wave: J3 ---------------------------------------------------

def test_a_stray_os_error_is_one_plain_line(tmp_path, monkeypatch, capsys):
    import image_money
    v = make_vault(tmp_path)

    def boom(*a, **k):
        raise PermissionError(13, "Permission denied", "/some/path")
    monkeypatch.setattr(image_money, "spent", boom)
    assert image.main(["status", str(v)]) == 1
    err = capsys.readouterr().err
    assert err == "Could not read or write /some/path: Permission denied.\n"


def test_a_stray_os_error_without_a_path(tmp_path, monkeypatch, capsys):
    import image_money
    v = make_vault(tmp_path)

    def boom(*a, **k):
        raise OSError("odd")
    monkeypatch.setattr(image_money, "spent", boom)
    assert image.main(["status", str(v)]) == 1
    assert capsys.readouterr().err == "Could not read or write odd.\n"


# --- minor wave 2: C1 -------------------------------------------------------

@pytest.mark.parametrize("command", ["status", "plan", "draw", "place"])
def test_unavailable_settings_are_one_plain_line_for_every_command(
        command, tmp_path, monkeypatch, capsys):
    import image_money
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 0
    job = next(line for line in capsys.readouterr().out.splitlines()
               if line.startswith("Job ")).split()[1]

    def boom(*a, **k):
        raise vaultlib.SettingsUnavailable("x could not be read")
    monkeypatch.setattr(image_money, "limits", boom)
    if command == "place":
        # place never reads the limits; the same wrapper must still cover it.
        import image_jobs
        monkeypatch.setattr(image_jobs, "load", boom)
    argv = {"status": ["status", str(v)],
            "plan": ["plan", str(v), str(req)],
            "draw": ["draw", str(v), job],
            "place": ["place", str(v), job, "--keep", "1"]}[command]
    assert image.main(argv) == 2
    assert capsys.readouterr().err == "x could not be read\n"


# --- minor wave 2: C5, K1 ---------------------------------------------------

def test_status_for_a_service_with_no_key_store_says_so(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    import image_money
    v = make_vault(tmp_path)
    real = image_money.limits(v)
    # The settings reader may refuse an unknown service; a newer vault may not.
    monkeypatch.setattr(image_money, "limits",
                        lambda vault: real._replace(service="other"))
    assert image.main(["status", str(v)]) == 0
    out = capsys.readouterr().out
    assert "key: this version cannot store a key for other" in out
    assert "found" not in out and SECRET not in out

def test_a_failed_write_after_setting_the_old_file_aside_says_both(
        monkeypatch, tmp_path, capsys):
    import os
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(image_keys.getpass, "getpass", lambda prompt="": SECRET)
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    (cfg / "keys.json").write_text("[1]")
    real_open = os.open

    def no_new_file(path, *a, **k):
        if str(path).endswith(".tmp"):
            raise PermissionError(13, "Permission denied", str(path))
        return real_open(path, *a, **k)
    monkeypatch.setattr(os, "open", no_new_file)
    assert image.main(["key", "gemini"]) == 1
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and SECRET not in err
    assert "not stored" in err and "Permission denied" in err
    assert "set aside as keys.json.unreadable" in err
    assert (cfg / "keys.json.unreadable").is_file()


# --- final wave: A3, A4 -----------------------------------------------------

def test_status_shows_the_month_in_two_decimals(tmp_path, capsys, monkeypatch):
    from datetime import date
    import image_money
    v = make_vault(tmp_path)
    today = date(2026, 11, 30)
    monkeypatch.setattr(image, "_today", lambda: today)
    image_money.record(v, today, 33.7181)
    assert image.main(["status", str(v)]) == 0
    assert "spent this month: 33.72 of 2000 cents" in capsys.readouterr().out


@pytest.mark.parametrize("written, said", [
    ("month_cap: 500c",
     'vault.images.month_cap is "500c"; it takes a number, 0 or more.'),
    ("attempt_limit: -3",
     "vault.images.attempt_limit is -3; it takes a number, 0 or more.")])
@pytest.mark.parametrize("command", ["status", "plan", "draw"])
def test_a_money_setting_that_cannot_be_read_stops_every_command(
        command, written, said, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])
    assert image.main(["plan", str(v), str(req)]) == 0
    job = next(line for line in capsys.readouterr().out.splitlines()
               if line.startswith("Job ")).split()[1]
    config = v / "_meta" / "vault-config.yaml"
    config.write_text(config.read_text(encoding="utf-8") + f"    {written}\n",
                      encoding="utf-8")
    vaultlib.forget_settings(None)
    argv = {"status": ["status", str(v)],
            "plan": ["plan", str(v), str(req)],
            "draw": ["draw", str(v), job]}[command]
    assert image.main(argv) == 2
    out = capsys.readouterr()
    assert out.err == said + "\n"
    assert "Job " not in out.out and "drawn" not in out.out


# --- final wave: C1 ---------------------------------------------------------

def test_the_image_summary_names_no_command_that_does_not_exist():
    import gma
    assert gma.COMMANDS["image"].summary == (
        "Draw a vault's pictures inside its spending limits.")


# --- review round: a guidance path that is not text (#639) -------------------

@pytest.mark.parametrize("command", ["status", "plan"])
def test_a_guidance_path_that_is_a_number_is_one_plain_line(command, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    v = plan_vault(tmp_path, "gemini-nano-banana-2.1", "    guidance: 5\n")
    req = requests(tmp_path, [{"for": "Anselm", "subject": "x"}])
    argv = ["status", str(v)] if command == "status" else ["plan", str(v), str(req)]
    assert image.main(argv) == 2
    assert capsys.readouterr().err == "vault.images.guidance must be the path of a note.\n"

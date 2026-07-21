import subprocess
import pytest
from mobrpg import cli


def test_help_lists_all_verbs_and_llms_pointer(capsys):
    rc = cli.main(["--help"])
    out = capsys.readouterr().out
    assert rc == 0
    for verb in ("whoami", "pull", "push", "suggest", "sync", "images"):
        assert verb in out
    assert "llms.txt" in out


def test_no_args_prints_help(capsys):
    rc = cli.main([])
    out = capsys.readouterr().out
    assert rc == 0
    assert "pull" in out


def test_unknown_verb_exits_2(capsys):
    rc = cli.main(["frobnicate"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "frobnicate" in err


def test_fallback_verb_shells_out_with_argv(monkeypatch):
    calls = {}

    def fake_run(cmd, **kwargs):
        calls["cmd"] = cmd

        class R:
            returncode = 0
        return R()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    rc = cli.main(["push", "world-1", "--chapter", "chapter-2", "--execute"])
    assert rc == 0
    # script path is the last-but-args element; args passed through verbatim
    assert calls["cmd"][1].endswith("push_to_mobrpg.py")
    assert calls["cmd"][2:] == ["world-1", "--chapter", "chapter-2", "--execute"]


def test_fallback_returns_child_exit_code(monkeypatch):
    def fake_run(cmd, **kwargs):
        class R:
            returncode = 7
        return R()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    assert cli.main(["images", "world-1", "/vault", "/xwalk.json"]) == 7


def test_auth_verb_is_native(monkeypatch):
    called = {}

    def fake_auth(argv):
        called["argv"] = argv
        return 0

    monkeypatch.setitem(cli.NATIVE, "auth", fake_auth)
    assert cli.main(["auth", "status"]) == 0
    assert called["argv"] == ["status"]


def test_auth_in_verb_help():
    assert any(v == "auth" for v, _ in cli.VERB_HELP)

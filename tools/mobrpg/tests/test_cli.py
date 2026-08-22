import pytest
from mobrpg import cli


def test_help_lists_native_verbs_and_llms_pointer(capsys):
    rc = cli.main(["--help"])
    out = capsys.readouterr().out
    assert rc == 0
    for verb in ("whoami", "pull", "suggest", "sync", "write", "images", "link-orphans"):
        assert verb in out
    assert "llms.txt" in out


def test_help_does_not_list_removed_shellout_verbs(capsys):
    rc = cli.main(["--help"])
    out = capsys.readouterr().out
    assert rc == 0
    listed = {line.strip().split()[0] for line in out.splitlines() if line.startswith("  ")}
    for verb in ("merge", "push", "types", "links", "pull-desc", "suggest-desc"):
        assert verb not in listed, f"{verb} should no longer be a listed command"


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


def test_no_fallback_dict_or_shellout():
    """Task 14: the shell-out layer is gone entirely — every verb is native."""
    assert not hasattr(cli, "FALLBACK")
    assert not hasattr(cli, "_shellout")


def test_removed_verbs_are_unknown(capsys):
    for verb in ("merge", "push", "types", "links"):
        rc = cli.main([verb])
        err = capsys.readouterr().err
        assert rc == 2
        assert verb in err


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


def test_new_native_verbs_are_registered():
    for verb in ("sync", "write", "images", "link-orphans"):
        assert verb in cli.NATIVE, f"{verb} missing from NATIVE"
        assert any(v == verb for v, _ in cli.VERB_HELP), f"{verb} missing from VERB_HELP"

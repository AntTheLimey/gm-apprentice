"""image_keys.py: where a drawing service's key is found and stored."""

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image_keys  # noqa: E402


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GMA_CONFIG", str(tmp_path / "cfg"))

    def boom(*a, **k):
        raise AssertionError("the real keychain was touched")
    monkeypatch.setattr(image_keys, "RUN", boom)


def test_environment_wins(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k-env")
    assert image_keys.find("gemini") == ("k-env", "environment")


def test_second_environment_name(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "k-google")
    assert image_keys.find("gemini") == ("k-google", "environment")


def test_key_file_when_nothing_else(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    (tmp_path / "cfg").mkdir()
    (tmp_path / "cfg" / "keys.json").write_text('{"gemini": "k-file"}')
    assert image_keys.find("gemini") == ("k-file", "key file")


def test_keychain_on_a_mac(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    seen = []

    def run(cmd, **kw):
        seen.append(cmd)
        return SimpleNamespace(returncode=0, stdout="k-chain\n")
    monkeypatch.setattr(image_keys, "RUN", run)
    assert image_keys.find("gemini") == ("k-chain", "keychain")
    assert seen[0][:2] == ["security", "find-generic-password"]
    assert "gm-apprentice.images" in seen[0] and "gemini" in seen[0]


def test_nothing_found_on_a_mac_is_not_an_error(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(image_keys, "RUN", lambda cmd, **kw: SimpleNamespace(
        returncode=44, stdout=""))
    assert image_keys.find("gemini") is None


def test_nothing_found_elsewhere(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert image_keys.find("gemini") is None


def test_unreadable_key_file_is_a_miss(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    (tmp_path / "cfg").mkdir()
    (tmp_path / "cfg" / "keys.json").write_text("not json")
    assert image_keys.find("gemini") is None


def test_config_dir_follows_the_override(tmp_path):
    assert image_keys.config_dir() == tmp_path / "cfg"


def test_store_refuses_without_a_terminal(monkeypatch):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
    with pytest.raises(image_keys.NeedsTerminal):
        image_keys.store("gemini")


def test_stored_key_file_is_private(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(image_keys.getpass, "getpass", lambda prompt="": "k-new")
    assert image_keys.store("gemini") == "key file"
    f = tmp_path / "cfg" / "keys.json"
    assert f.stat().st_mode & 0o777 == 0o600
    assert image_keys.find("gemini") == ("k-new", "key file")


def test_store_on_a_mac_hands_the_terminal_to_security(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    seen = []

    def run(cmd, **kw):
        seen.append((cmd, kw))
        return subprocess.CompletedProcess(cmd, 0)
    monkeypatch.setattr(image_keys, "RUN", run)
    assert image_keys.store("gemini") == "keychain"
    cmd, kw = seen[0]
    assert cmd[:2] == ["security", "add-generic-password"] and "-U" in cmd
    assert "capture_output" not in kw and "stdout" not in kw


# --- minor wave: K1-K5 ----------------------------------------------------

def test_keychain_lookup_has_a_timeout(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    seen = []

    def run(cmd, **kw):
        seen.append(kw)
        return SimpleNamespace(returncode=44, stdout="")
    monkeypatch.setattr(image_keys, "RUN", run)
    image_keys.find("gemini")
    assert seen[0].get("timeout") == 10


def test_a_silent_keychain_is_store_unavailable(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")

    def run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 10)
    monkeypatch.setattr(image_keys, "RUN", run)
    with pytest.raises(image_keys.StoreUnavailable) as e:
        image_keys.find("gemini")
    assert str(e.value) == "The keychain did not answer. Unlock it and try again."


def _typed(monkeypatch, key="k-new"):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(image_keys.getpass, "getpass", lambda prompt="": key)


def test_a_wide_key_file_is_never_written_while_wide(monkeypatch, tmp_path):
    import os
    _typed(monkeypatch)
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    f = cfg / "keys.json"
    f.write_text('{"other": "k-other"}')
    os.chmod(f, 0o644)
    modes = []
    real_replace = os.replace

    def spy(src, dst):
        modes.append(os.stat(src).st_mode & 0o777)
        return real_replace(src, dst)
    monkeypatch.setattr(os, "replace", spy)
    image_keys.store("gemini")
    assert modes == [0o600]
    assert f.stat().st_mode & 0o777 == 0o600
    import json
    assert json.loads(f.read_text()) == {"other": "k-other", "gemini": "k-new"}
    assert [p.name for p in cfg.iterdir()] == ["keys.json"]


def test_a_failed_write_keeps_the_old_keys(monkeypatch, tmp_path):
    import json
    import os
    _typed(monkeypatch)
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    f = cfg / "keys.json"
    f.write_text('{"other": "k-other"}')

    def boom(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        image_keys.store("gemini")
    assert json.loads(f.read_text()) == {"other": "k-other"}
    assert [p.name for p in cfg.iterdir()] == ["keys.json"]


def test_a_keys_file_that_is_not_an_object_is_set_aside(monkeypatch, tmp_path):
    import json
    _typed(monkeypatch)
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    (cfg / "keys.json").write_text('["not", "an", "object"]')
    (cfg / "keys.json.unreadable").write_text("older")
    msg = image_keys.store("gemini")
    assert "The old keys file could not be read and was set aside as " \
           "keys.json.unreadable." in msg
    assert (cfg / "keys.json.unreadable").read_text() == '["not", "an", "object"]'
    assert json.loads((cfg / "keys.json").read_text()) == {"gemini": "k-new"}


def test_unknown_service_is_a_value_error(monkeypatch):
    with pytest.raises(ValueError):
        image_keys.find("nonesuch")
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    with pytest.raises(ValueError):
        image_keys.store("nonesuch")


# --- final wave: B8 ---------------------------------------------------------

@pytest.mark.parametrize("status, stdout, found", [
    (44, "", None), (0, "k-chain\n", ("k-chain", "keychain"))])
def test_the_keychain_answers_found_or_not_there(monkeypatch, status, stdout, found):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(image_keys, "RUN", lambda cmd, **kw: SimpleNamespace(
        returncode=status, stdout=stdout))
    assert image_keys.find("gemini") == found


@pytest.mark.parametrize("status", [1, 36, 51, 128])
def test_a_keychain_that_refuses_is_not_read_as_no_key(monkeypatch, status):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(image_keys, "RUN", lambda cmd, **kw: SimpleNamespace(
        returncode=status, stdout=""))
    with pytest.raises(image_keys.StoreUnavailable) as e:
        image_keys.find("gemini")
    assert str(e.value) == ("The keychain would not give up the key (it may be "
                            "locked, or access was refused). Unlock it and try again.")

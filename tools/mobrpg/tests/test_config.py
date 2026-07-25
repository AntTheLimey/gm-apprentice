import json
import os
import stat

import pytest

from mobrpg import config


def test_config_dir_override_wins(monkeypatch):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", "/tmp/override-x")
    assert config.config_dir() == "/tmp/override-x"


def test_config_dir_posix_xdg(monkeypatch):
    monkeypatch.delenv("MOBRPG_CONFIG_DIR", raising=False)
    monkeypatch.setattr(os, "name", "posix")
    monkeypatch.setenv("XDG_CONFIG_HOME", "/xdg")
    assert config.config_dir() == os.path.join("/xdg", "mobrpg")


def test_config_dir_posix_default(monkeypatch):
    monkeypatch.delenv("MOBRPG_CONFIG_DIR", raising=False)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setattr(os, "name", "posix")
    monkeypatch.setattr(os.path, "expanduser", lambda p: p.replace("~", "/home/u"))
    assert config.config_dir() == os.path.join("/home/u/.config", "mobrpg")


def test_config_dir_windows_appdata(monkeypatch):
    monkeypatch.delenv("MOBRPG_CONFIG_DIR", raising=False)
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setenv("APPDATA", r"C:\Users\u\AppData\Roaming")
    assert config.config_dir() == os.path.join(r"C:\Users\u\AppData\Roaming", "mobrpg")


def test_write_read_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    cred = {"access_token": "a", "refresh_token": "r",
            "user": {"email": "gm@x.io"}, "source": "import"}
    config.write(cred)
    assert config.read() == cred


def test_read_missing_returns_none(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "empty"))
    assert config.read() is None


def test_read_corrupt_returns_none(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    os.makedirs(tmp_path / "cfg", exist_ok=True)
    (tmp_path / "cfg" / "credentials.json").write_text("{not json")
    assert config.read() is None


def test_write_sets_0600_on_posix(monkeypatch, tmp_path):
    if os.name == "nt":
        return
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "a"})
    mode = stat.S_IMODE(os.stat(config.credentials_path()).st_mode)
    assert mode == 0o600


def test_write_sets_dir_0700_on_posix(monkeypatch, tmp_path):
    if os.name == "nt":
        return
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "a"})
    mode = stat.S_IMODE(os.stat(config.config_dir()).st_mode)
    assert mode == 0o700


def test_write_tightens_perms_on_preexisting_loose_file(monkeypatch, tmp_path):
    if os.name == "nt":
        return
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    os.makedirs(tmp_path / "cfg", exist_ok=True)
    loose = tmp_path / "cfg" / "credentials.json"
    loose.write_text("{}")
    os.chmod(loose, 0o644)
    config.write({"access_token": "a"})
    mode = stat.S_IMODE(os.stat(config.credentials_path()).st_mode)
    assert mode == 0o600


def test_write_no_world_readable_window_via_temp(monkeypatch, tmp_path):
    """The file that ends up holding the secret must be 0600 before it becomes
    the destination — i.e. writing goes through a temp file created 0600 and an
    atomic rename, never a truncate-in-place of a loose-perm destination."""
    if os.name == "nt":
        return
    cfgdir = tmp_path / "cfg"
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(cfgdir))
    os.makedirs(cfgdir, exist_ok=True)
    dest = cfgdir / "credentials.json"
    dest.write_text("{}")
    os.chmod(dest, 0o644)

    seen = {}
    real_replace = os.replace

    def spy_replace(src, dst):
        seen["src"] = str(src)
        seen["dst"] = str(dst)
        seen["src_mode"] = stat.S_IMODE(os.stat(src).st_mode)
        return real_replace(src, dst)

    monkeypatch.setattr(config.os, "replace", spy_replace)
    config.write({"access_token": "s3cr3t"})
    # The staged file holding the secret was already 0600 before the rename.
    assert seen["src_mode"] == 0o600
    # It was a temp file, not an in-place write of the destination.
    assert seen["src"] != str(dest)
    assert seen["dst"] == str(dest)
    assert config.read()["access_token"] == "s3cr3t"


def test_write_atomic_preserves_original_on_failure(monkeypatch, tmp_path):
    """A failure at the rename step must leave the pre-existing credential file
    untouched (no truncate-in-place)."""
    if os.name == "nt":
        return
    cfgdir = tmp_path / "cfg"
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(cfgdir))
    os.makedirs(cfgdir, exist_ok=True)
    dest = cfgdir / "credentials.json"
    dest.write_text('{"access_token": "original"}')

    def boom(src, dst):
        raise OSError("simulated rename failure")

    monkeypatch.setattr(config.os, "replace", boom)
    with pytest.raises(OSError):
        config.write({"access_token": "new"})
    assert json.loads(dest.read_text())["access_token"] == "original"


def test_write_windows_branch_skips_chmod(monkeypatch, tmp_path):
    """On Windows (os.name == 'nt'), write() must take the no-chmod path: the
    per-user %APPDATA% profile is already ACL-scoped, so neither the config dir
    nor the credential file should ever have os.chmod() called on them, and the
    round-trip must still succeed via the same atomic-temp-then-replace write."""
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))

    calls = []
    real_chmod = os.chmod

    def spy_chmod(path, mode):
        calls.append((path, mode))
        return real_chmod(path, mode)

    monkeypatch.setattr(config.os, "chmod", spy_chmod)
    config.write({"access_token": "a"})
    assert calls == []
    assert config.read() == {"access_token": "a"}


def test_clear(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "a"})
    assert config.clear() is True
    assert config.clear() is False
    assert config.read() is None

import json
import os
import stat

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


def test_clear(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "a"})
    assert config.clear() is True
    assert config.clear() is False
    assert config.read() is None

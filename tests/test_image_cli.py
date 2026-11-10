"""gma image: status and key."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import image  # noqa: E402
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

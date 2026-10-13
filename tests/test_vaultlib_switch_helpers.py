"""The three small readings of `Settings` the scripts share: what the GM
wrote in the vault file, the site switch as written, and whether the vault
has a site when the lines tool cannot say."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"))

import vaultlib  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def make(tmp_path: Path, publish: str | None) -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    if publish is not None:
        (vault / "_meta" / "vault-config.md").write_text(
            f"---\npublish:\n{publish}---\n", encoding="utf-8")
    return vault


@pytest.mark.parametrize("word, want", [
    ("true", True), ("True", True), ("yes", True), ("ON", True),
    ('"yes"', True), ("'on'", True), ("true # for now", True),
    ("false", False), ("No", False), ("off", False), ('"false"', False),
    ("maybe", False), ("", False), ("~", False), ("null", False),
    ("0", False), ("1", False), ("[a]", False),
])
def test_the_switch_as_written(tmp_path, word, want):
    s = vaultlib.settings(make(tmp_path, f"  site: {word}\n"))
    assert vaultlib.site_switch_written(s) is want


def test_a_switch_not_written_is_none(tmp_path):
    for publish in (None, "  mode: player\n", "  site_dir: x\n"):
        vaultlib.forget_settings(None)
        s = vaultlib.settings(make(tmp_path / str(publish)[:3], publish))
        assert vaultlib.site_switch_written(s) is None


def test_a_switch_from_the_site_file_is_not_the_vault_files(tmp_path):
    vault = make(tmp_path, "  mode: player\n")
    config = tmp_path / "vault.config.json"
    config.write_text('{"siteTitle": "T"}', encoding="utf-8")
    s = vaultlib.settings(vault, site_config=config)
    assert s.origins["publish.site_title"] == "site-file"
    assert not vaultlib.written_in_vault_file(s, "publish.site_title")
    assert vaultlib.written_in_vault_file(
        vaultlib.settings(vault), "publish.mode")


@pytest.mark.parametrize("publish, want", [
    (None, False),
    ("  mode: player\n", False),
    ("  site_dir: /some/site\n", True),
    ("  site: true\n", True),
    ("  site: false\n  site_dir: /some/site\n", False),
    ("  site: maybe\n  site_dir: /some/site\n", False),
    ("  site: true\n", True),
])
def test_a_site_when_the_lines_tool_cannot_say(tmp_path, publish, want):
    s = vaultlib.settings(make(tmp_path, publish))
    assert vaultlib.site_without_tool(s) is want


def test_writing_a_settings_file_atomically_forgets_what_was_read(tmp_path):
    import migrate_core
    vault = make(tmp_path, "  mode: player\n")
    assert vaultlib.settings(vault).get("publish.mode") == "player"
    migrate_core.write_text_atomic(
        vault / "_meta" / "vault-config.md", "---\npublish:\n  mode: full\n---\n")
    assert vaultlib.settings(vault).get("publish.mode") == "full"


def test_writing_a_note_keeps_what_was_read(tmp_path, monkeypatch):
    import migrate_core
    vault = make(tmp_path, "  mode: player\n")
    vaultlib.settings(vault)
    migrate_core.write_text_atomic(vault / "Note.md", "x\n")

    def no_run(*_a, **_k):
        raise AssertionError("the tool was asked again")

    monkeypatch.setattr(vaultlib.subprocess, "run", no_run)
    assert vaultlib.settings(vault).get("publish.mode") == "player"

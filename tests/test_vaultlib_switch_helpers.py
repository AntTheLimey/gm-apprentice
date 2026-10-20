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
    for publish in (None, "  connections: web\n", "  site_dir: x\n"):
        vaultlib.forget_settings(None)
        s = vaultlib.settings(make(tmp_path / str(publish)[:3], publish))
        assert vaultlib.site_switch_written(s) is None


def test_a_switch_from_the_site_file_is_not_the_vault_files(tmp_path):
    vault = make(tmp_path, "  connections: web\n")
    config = tmp_path / "vault.config.json"
    config.write_text('{"siteTitle": "T"}', encoding="utf-8")
    s = vaultlib.settings(vault, site_config=config)
    assert s.origins["player_site.title"] == "site-file"
    assert not vaultlib.written_in_vault_file(s, "player_site.title")
    assert vaultlib.written_in_vault_file(
        vaultlib.settings(vault), "player_site.features.connections")


@pytest.mark.parametrize("publish, want", [
    (None, False),  # no vault-config file at all
    ("  site_dir: /some/site\n", True),  # a site folder that does not exist
])
def test_a_site_without_a_switch_word_or_a_tool(tmp_path, publish, want):
    # The rest of the table is in test_layouts_both.py, on both layouts;
    # these two are the ones its vaults cannot be.
    s = vaultlib.settings(make(tmp_path, publish))
    assert vaultlib.site_without_tool(s) is want


def test_a_site_switch_that_is_no_switch_word_is_off_without_the_tool(tmp_path):
    # The other cases of this table are in test_layouts_both.py, on both
    # layouts. A word that is no switch is refused when the file moves to
    # the new layout, so this one stays here, on the layout that can hold it.
    s = vaultlib.settings(make(tmp_path, "  site: maybe\n  site_dir: /some/site\n"))
    assert vaultlib.site_without_tool(s) is False


def test_writing_a_settings_file_atomically_forgets_what_was_read(tmp_path):
    import migrate_core
    vault = make(tmp_path, "  connections: web\n")
    assert vaultlib.settings(vault).get("player_site.features.connections") == "web"
    migrate_core.write_text_atomic(
        vault / "_meta" / "vault-config.md", "---\npublish:\n  connections: cards\n---\n")
    assert vaultlib.settings(vault).get("player_site.features.connections") == "cards"


def test_writing_a_note_keeps_what_was_read(tmp_path, monkeypatch):
    import migrate_core
    vault = make(tmp_path, "  connections: web\n")
    vaultlib.settings(vault)
    migrate_core.write_text_atomic(vault / "Note.md", "x\n")

    def no_run(*_a, **_k):
        raise AssertionError("the tool was asked again")

    monkeypatch.setattr(vaultlib, "run_tool", no_run)
    assert vaultlib.settings(vault).get("player_site.features.connections") == "web"

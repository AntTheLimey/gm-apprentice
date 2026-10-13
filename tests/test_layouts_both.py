"""What reads the vault's settings reads them the same on both layouts: each
test builds the vault the old way and, for "new", takes it across with the
publish tool's `settings move`. The old-layout tests elsewhere stay as they
are; they exercise the legacy path."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import dnd_ddb  # noqa: E402
import migrate  # noqa: E402
import migrate_vault as mv  # noqa: E402
import relink  # noqa: E402
import vault_check as vc  # noqa: E402
import vault_scaffold as vs  # noqa: E402
import vaultlib  # noqa: E402
from layouts import LAYOUTS, on_layout  # noqa: E402

PLUGIN = vaultlib.plugin_version()[0]


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path: Path, publish: str = "", stamp: str | None = None) -> Path:
    """An old-layout vault: `publish` is the lines under `publish:`."""
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True)
    version = f'gm_apprentice_version: "{stamp}"\n' if stamp else ""
    (vault / "_meta" / "vault-config.md").write_text(
        f'---\ntype: meta\n{version}publish:\n  system: "coc-7e"\n{publish}---\n',
        encoding="utf-8")
    return vault


@pytest.fixture(params=LAYOUTS)
def layout(request):
    return request.param


# ---- reading ---------------------------------------------------------------

def test_a_written_value_and_a_default_read_the_same(tmp_path, layout):
    vault = on_layout(make_vault(
        tmp_path, "  connections: web\n  exclude_sections: [Spoilers]\n"), layout)
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.connections") == "web"
    assert s.written("player_site.features.connections")
    assert s.get("player_site.hide.sections") == ["Spoilers"]
    assert s.get("vault.system") == "coc-7e"
    assert s.get("player_site.hide.mode") == "player"
    assert not s.written("player_site.hide.mode")
    assert s.has_site_block and not s.inline


def test_only_new_names_are_known(tmp_path, layout):
    s = vaultlib.settings(on_layout(make_vault(tmp_path), layout))
    with pytest.raises(KeyError):
        s.get("publish.connections")
    assert not [n for n in s.values if n.startswith("publish.")]


def with_bad_value(tmp_path: Path, layout: str) -> Path:
    """A vault whose hiding-drafts setting holds a word that is no switch,
    written in the layout's own name for it."""
    if layout == "legacy":
        return make_vault(tmp_path, "  exclude_drafts: sideways\n")
    vault = on_layout(make_vault(tmp_path), layout)
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\nplayer_site:\n  hide:\n    drafts: sideways\n", encoding="utf-8")
    return vault


def test_a_fault_names_the_setting_in_the_new_name(tmp_path, layout):
    vault = with_bad_value(tmp_path, layout)
    (fault,) = vaultlib.settings(vault).faults
    assert fault["setting"] == "player_site.hide.drafts"
    # The name is as the file writes it.
    assert fault["name"] == ("publish.exclude_drafts" if layout == "legacy"
                             else "player_site.hide.drafts")
    assert vaultlib.settings(vault).origins["player_site.hide.drafts"] == "fault"


def test_the_lists_of_folders_come_tidied(tmp_path, layout):
    vault = on_layout(make_vault(
        tmp_path, '  exclude_dirs: ["Secrets/", "./Private", "GM\\\\Stuff"]\n'), layout)
    assert vaultlib.settings(vault).get("player_site.hide.folders") == [
        "Secrets", "Private", "GM/Stuff"]


def test_raw_is_asked_by_the_new_name_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, "  exclude_sections: [A, B]\n"), layout)
    assert vaultlib.settings_raw(vault, "player_site.hide.sections") == ["A", "B"]
    assert vaultlib.settings_raw(vault, "player_site.hide.fields") is None


def test_a_name_only_the_old_file_has_is_not_there_on_the_new_layout(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, "  wrap_up:\n    player_sections: [Recap]\n"), layout)
    block = vaultlib.settings_raw(vault, "publish.wrap_up")
    if layout == "legacy":
        assert block == {"player_sections": ["Recap"]}
        assert mv.read_wrap_up_player_sections(vault) == ["Recap"]
    else:
        assert block is None
        assert mv.read_wrap_up_player_sections(vault) == []
        assert mv.find_wrapup_sections_key(vault) == []


# ---- writing ---------------------------------------------------------------

def test_set_add_and_unset_by_new_names_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, "  exclude_sections: [A]\n"), layout)
    assert vaultlib.settings_set(vault, [("player_site.features.connections", "web")]) == [
        "player_site.features.connections"]
    assert vaultlib.settings_add(vault, "player_site.hide.sections", ["B"]) == ["B"]
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.connections") == "web"
    assert s.get("player_site.hide.sections") == ["A", "B"]
    assert vaultlib.settings_unset(vault, ["player_site.features.connections"]) == [
        "player_site.features.connections"]
    assert not vaultlib.settings(vault).written("player_site.features.connections")


def test_a_refused_value_says_why_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path), layout)
    with pytest.raises(vaultlib.SettingsUnavailable) as caught:
        vaultlib.settings_set(vault, [("player_site.features.connections", "sideways")])
    assert caught.value.refused


# ---- the switch helpers ----------------------------------------------------

@pytest.mark.parametrize("publish, switch, no_tool", [
    ("", None, False),
    ("  site_dir: /some/site\n", None, True),
    ("  site: true\n", True, True),
    ("  site: false\n  site_dir: /some/site\n", False, False),
])
def test_the_site_switch_helpers_agree(tmp_path, layout, publish, switch, no_tool):
    site = tmp_path / "site"
    site.mkdir()
    (site / "vault.config.json").write_text('{"vaultPath": "../vault"}', encoding="utf-8")
    publish = publish.replace("/some/site", site.as_posix())
    s = vaultlib.settings(on_layout(make_vault(tmp_path, publish), layout))
    assert vaultlib.site_switch_written(s) is switch
    assert vaultlib.site_without_tool(s) is no_tool


# ---- finding and marking a vault -------------------------------------------

def test_a_note_finds_its_vault_by_either_settings_file(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path), layout)
    note = vault / "Characters" / "NPCs" / "A.md"
    note.parent.mkdir(parents=True)
    note.write_text("x", encoding="utf-8")
    assert dnd_ddb.find_vault(note) == vault.resolve()


def test_a_vault_with_no_settings_file_is_not_found_or_a_site(tmp_path):
    bare = tmp_path / "bare"
    (bare / "Notes").mkdir(parents=True)
    assert dnd_ddb.find_vault(bare / "Notes" / "a.md") is None
    assert relink._has_site(bare) is False


def test_relink_asks_about_a_site_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, "  site: false\n"), layout)
    assert relink._has_site(vault) is False


# ---- the stamp through the scripts ----------------------------------------

def test_the_migrate_gate_reads_the_stamp_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, stamp="1.10.20"), layout)
    assert migrate.gate(vault) == ("1.10.20", PLUGIN)


def test_the_migrate_gate_refuses_a_vault_with_no_stamp_on_both(tmp_path, layout):
    refused = migrate.gate(on_layout(make_vault(tmp_path), layout))
    assert isinstance(refused, str) and "no recorded version" in refused


def test_the_migrate_stamp_writes_where_the_layout_keeps_it(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path, stamp="1.10.20"), layout)
    migrate._stamp(vault, PLUGIN)
    assert vaultlib.read_stamp(vault) == PLUGIN
    assert (vault / "_meta" / "vault-state.json").exists() == (layout == "new")


def test_migrate_stops_on_a_broken_state_file(tmp_path):
    vault = on_layout(make_vault(tmp_path, stamp="1.10.20"), "new")
    (vault / "_meta" / "vault-state.json").write_text("{broken", encoding="utf-8")
    refused = migrate.gate(vault)
    assert isinstance(refused, str) and "vault-state.json is not valid JSON" in refused


def test_the_scaffold_refuses_a_vault_with_no_stamp_on_both(tmp_path, layout):
    vault = on_layout(make_vault(tmp_path), layout)
    with pytest.raises(vs.ScaffoldError) as caught:
        vs._refuse_unusable_version(vault, PLUGIN)
    assert "gm_apprentice_version" in str(caught.value)
    assert ("vault-state.json" in str(caught.value)) == (layout == "new")


def test_the_scaffold_does_not_bring_the_old_file_back(tmp_path):
    vault = on_layout(make_vault(tmp_path, stamp=PLUGIN), "new")
    pieces = vs.missing(vault, "coc-7e", campaign="C", version=PLUGIN, inbox=False)
    assert "_meta/vault-config.md" not in [p.rel for p in pieces]
    assert "_meta/vault-config.yaml" not in [p.rel for p in pieces]


# ---- the Settings check ----------------------------------------------------

def test_the_settings_check_lists_a_fault_on_both(tmp_path, layout, monkeypatch, capsys):
    vault = with_bad_value(tmp_path, layout)
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault), "settings"])
    assert vc.run() == 0
    out = capsys.readouterr().out
    file_name = "_meta/vault-config.md" if layout == "legacy" else "_meta/vault-config.yaml"
    assert f"STOP\t{file_name}\t" in out
    assert "exclude_drafts" in out or "hide.drafts" in out


def test_a_misspelt_key_is_fixed_on_both_files(
        tmp_path, layout, monkeypatch, capsys):
    if layout == "legacy":
        vault = make_vault(tmp_path, "  exclude_sectoins: [Secrets]\n")
    else:
        vault = on_layout(make_vault(tmp_path), layout)
        (vault / "_meta" / "vault-config.yaml").write_text(
            "version: 1\nplayer_site:\n  hide:\n    sectoins: [Secrets]\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault), "settings", "--fix"])
    assert vc.run() == 0
    out = capsys.readouterr().out
    vaultlib.forget_settings(None)
    s = vaultlib.settings(vault)
    assert "Secrets" in s.get("player_site.hide.sections")
    assert "GM Notes" in s.get("player_site.hide.sections")   # the built-in list stays
    assert "fixed:" in out and "Settings: no faults" in out
    if layout == "new":
        text = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
        assert "sectoins" not in text

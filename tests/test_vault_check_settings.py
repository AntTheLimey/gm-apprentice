"""vault_check.py's Settings check, against the real publish tool: it lists
the faults in a vault's settings file, fixes the ones whose fix is certain
and leaves the rest to the GM."""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import vault_check as vc  # noqa: E402
import vaultlib  # noqa: E402

CONFIG = "_meta/vault-config.md"


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path: Path, publish: str | None, name: str = "vault",
               raw: str | None = None) -> Path:
    """A vault whose settings file holds `publish` (the lines under
    `publish:`), or `raw` as the whole frontmatter."""
    vault = tmp_path / name
    (vault / "_meta").mkdir(parents=True)
    if raw is not None:
        front = raw
    elif publish is None:
        front = "type: meta"
    else:
        front = "type: meta\npublish:\n" + publish
    (vault / CONFIG).write_text(f"---\n{front}\n---\n", encoding="utf-8")
    return vault


def run(monkeypatch, capsys, vault: Path, *args: str):
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault), *args])
    vaultlib.forget_settings(None)
    code = vc.run()
    out = capsys.readouterr()
    return code, out.out, out.err


def settings_check(monkeypatch, capsys, vault, *args):
    return run(monkeypatch, capsys, vault, "settings", *args)


def text(vault: Path) -> str:
    return (vault / CONFIG).read_text(encoding="utf-8")


def fault_names(vault: Path) -> list[str]:
    vaultlib.forget_settings(vault)
    return [f["name"] for f in vaultlib.settings(vault).faults]


def test_a_clean_vault_has_no_faults(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  link_previews: off\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert (code, out.strip()) == (0, "Settings: no faults")


def test_a_misspelt_hiding_list_is_moved_and_keeps_the_built_in_headings(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  exclude_sectoins: [GM Notes, Secrets]\n")
    built_in = vaultlib.settings_default("player_site.hide.sections")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert code == 0
    first, fix = out.splitlines()[:2]
    assert first.startswith("STOP\t")
    assert "publish.exclude_sectoins is not a setting" in first
    assert fix == ("fix: move this to publish.exclude_sections, "
                   "keeping the built-in headings")
    assert "exclude_sections" not in text(vault).replace("exclude_sectoins", "")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0
    assert out.splitlines()[0].startswith("fixed: moved publish.exclude_sectoins")
    assert out.strip().endswith("Settings: no faults")
    got = vaultlib.settings(vault).get("player_site.hide.sections")
    assert got == built_in + ["Secrets"]
    assert "exclude_sectoins" not in text(vault)


def test_a_value_the_setting_will_not_take_is_listed_not_fixed(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  link_preview: sideways\n")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    lines = out.splitlines()
    assert lines[0].startswith("WARN\t")
    assert not any(line.startswith("fix:") for line in lines)
    assert "takes on, desktop or off" in out
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert not out.startswith("fixed:")


def test_an_old_container_child_is_moved_to_its_new_name(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  backend:\n    statusBar: true\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert "fixed: moved publish.backend.statusBar to publish.live_stats" in out
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.live_stats") is True
    assert s.faults == []
    assert "backend" not in text(vault)


def test_a_retired_setting_is_removed(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  total_sessions: 12\n  link_previews: off\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "fix: remove publish.total_sessions" in out
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert "total_sessions" not in text(vault)
    assert "link_previews: off" in text(vault)
    assert fault_names(vault) == []


def test_a_rename_onto_a_name_already_set_is_listed_with_both_values(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "  exclude_sectoins: [Secrets]\n  exclude_sections: [Plans]\n")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "fix:" not in out
    assert '["Secrets"]' in out and '["Plans"]' in out
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before


def test_an_old_name_whose_new_name_is_set_is_listed_not_fixed(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  backend:\n    statusBar: true\n  live_stats: false\n")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "is an old name" in out and "fix:" not in out
    assert "true" in out and "false" in out
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before


def test_fix_twice_changes_nothing_the_second_time(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  total_sessions: 3\n"
                  "  link_preview: sideways\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    after_first = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0 and text(vault) == after_first
    assert "fixed:" not in out
    assert "publish.link_preview is not a setting" in out


def test_json_rows_carry_the_certain_flag_and_the_operations(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  link_preview: sideways\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    data = json.loads(out)
    assert data["applied"] == []
    stop, warn = data["faults"]
    assert (stop["level"], stop["fault"], stop["kind"], stop["certain"]) == (
        "stop", "unknown-name", "certain", True)
    assert stop["operations"] == [
        {"op": "add", "name": "publish.exclude_sections",
         "entries": ["Secrets"]},
        {"op": "unset", "names": ["publish.exclude_sectoins"]}]
    assert stop["fix"].startswith("move this to publish.exclude_sections")
    assert (warn["certain"], warn["operations"], warn["fix"]) == (
        False, [], None)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix", "--json")
    data = json.loads(out)
    assert [a["name"] for a in data["applied"]] == ["publish.exclude_sectoins"]
    assert [f["name"] for f in data["faults"]] == ["publish.link_preview"]


def test_a_clean_vault_in_json_is_empty(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  link_previews: off\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    assert json.loads(out)["faults"] == []


def test_a_misspelt_switch_that_hides_more_is_moved(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  exclude_draft: true\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert vaultlib.settings(vault).get("player_site.hide.drafts") is True
    assert fault_names(vault) == []


def test_a_misspelt_mode_is_proposed_not_applied_by_fix(
        tmp_path, monkeypatch, capsys):
    """Moving `full` onto publish.mode would show players more."""
    vault = make_vault(tmp_path, "  modee: full\n")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert "proposed: move this to publish.mode" in out
    assert "fix:" not in out and "1 proposed fix is waiting" in out


def test_an_inline_block_has_no_fix_and_fix_writes_nothing(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, None, raw="type: meta\npublish: {total_sessions: 3}")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert code == 0 and "written on one line" in out and "fix:" not in out
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert out.count("Nothing was written") == 1


def test_invalid_yaml_is_one_row_with_no_fix(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, None, raw="type: meta\npublish: [unclosed")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0
    assert out.startswith("STOP\t")
    assert "not valid YAML" in out and "fix:" not in out
    assert len(out.splitlines()) == 1


def test_without_node_the_check_gives_the_one_plain_line(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  total_sessions: 3\n")
    monkeypatch.setattr(vaultlib.shutil, "which", lambda *_: None)
    code, out, err = settings_check(monkeypatch, capsys, vault)
    assert code == 2 and out == ""
    assert err.strip() == ("error: could not read the vault's settings: "
                           "node is not on PATH")


def test_all_shows_a_settings_row_only_when_there_is_a_fault(
        tmp_path, monkeypatch, capsys):
    clean = make_vault(tmp_path, "  link_previews: off\n", "clean")
    _, out, _ = run(monkeypatch, capsys, clean, "all")
    assert "## settings" not in out
    faulty = make_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  total_sessions: 3\n",
        "faulty")
    _, out, _ = run(monkeypatch, capsys, faulty, "all")
    rows = out.split("## settings\n# count: 1\n")[1].splitlines()
    assert len(rows) == 1
    assert rows[0].startswith("ERROR\t")
    assert "2 settings faults (1 stop, 1 warn)" in rows[0]
    assert "settings" in rows[0].split("run ")[1]


def test_wrapup_carries_the_same_row(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  exclude_sectoins: [Secrets]\n")
    _, out, _ = run(monkeypatch, capsys, vault, "wrapup")
    assert "## settings" in out
    clean = make_vault(tmp_path, "  link_previews: off\n", "clean")
    _, out, _ = run(monkeypatch, capsys, clean, "wrapup")
    assert "## settings" not in out


def test_after_fix_only_uncertain_faults_remain_and_nothing_is_shown_more(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "  exclude_sectoins: [Secrets]\n  exclude_feilds: [Cost]\n"
        "  exclude_callouts: [secret]\n  total_sessions: 3\n"
        "  link_preview: sideways\n  mode: nonsense\n")
    names = ("player_site.hide.sections", "player_site.hide.fields",
             "player_site.hide.callouts", "player_site.hide.drafts")
    before = {n: vaultlib.settings(vault).get(n) for n in names}
    settings_check(monkeypatch, capsys, vault, "--fix")
    vaultlib.forget_settings(vault)
    s = vaultlib.settings(vault)
    assert sorted(f["name"] for f in s.faults) == [
        "publish.link_preview", "publish.mode"]
    for n in ("player_site.hide.sections", "player_site.hide.fields"):
        assert set(before[n]) <= set(s.get(n))
    assert "Cost" in s.get("player_site.hide.fields")
    assert "Secrets" in s.get("player_site.hide.sections")
    assert s.get("player_site.hide.callouts") == ["secret"]


def test_two_misspellings_of_one_name_both_land(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  exclude_sectons: [Plans]\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    got = vaultlib.settings(vault).get("player_site.hide.sections")
    assert "Secrets" in got and "Plans" in got
    assert fault_names(vault) == []


def test_a_removal_that_fails_after_the_write_says_so_and_stops(
        tmp_path, monkeypatch, capsys):
    """The right name is written first, so a failure half-way leaves the
    vault hiding at least what it did before."""
    vault = make_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  total_sessions: 3\n")
    before_hidden = vaultlib.settings(vault).get("player_site.hide.sections")

    real = vc.settings_unset

    def refuse(where, names):
        if where != vault:  # the trial on a copy still works
            return real(where, names)
        raise vaultlib.SettingsUnavailable("disk full", refused=True)

    monkeypatch.setattr(vc, "settings_unset", refuse)
    monkeypatch.setattr(sys, "argv",
                        ["vault_check.py", str(vault), "settings", "--fix"])
    code = vc.run()
    err = capsys.readouterr().err
    assert code == 2
    assert "the new value was written but the old key could not be removed" in err
    assert "disk full" in err
    monkeypatch.undo()
    vaultlib.forget_settings(vault)
    s = vaultlib.settings(vault)
    assert set(before_hidden) <= set(s.get("player_site.hide.sections"))
    assert "Secrets" in s.get("player_site.hide.sections")
    assert "total_sessions" in text(vault)  # nothing further was changed


def site_vault(tmp_path, publish_lines, site_json=None):
    site = tmp_path / "site"
    site.mkdir()
    vault = make_vault(
        tmp_path, f"  site: true\n  site_dir: {site}\n{publish_lines}")
    (site / "vault.config.json").write_text(
        json.dumps({"vaultPath": "../vault", **(site_json or {})}),
        encoding="utf-8")
    return vault, site


def test_the_frontmatter_row_names_the_fault_that_stopped_the_tool(
        tmp_path):
    vault, _ = site_vault(tmp_path, "  exclude_sectoins: [Secrets]\n")
    vc.use_publish_tool(vc.PUBLISH_TOOL)
    rows = vc.check_frontmatter(vault, None)
    row = next(r for r in rows if "could not be consulted" in r)
    assert "publish.exclude_sectoins is not a setting." in row
    assert "?." not in row and ".." not in row
    assert "Settings check" in row


def test_the_frontmatter_row_names_a_stop_that_follows_a_warning(tmp_path):
    vault, _ = site_vault(
        tmp_path, "  exclude_sectoins: [Secrets]\n  total_sessions: 3\n")
    vc.use_publish_tool(vc.PUBLISH_TOOL)
    row = next(r for r in vc.check_frontmatter(vault, None)
               if "could not be consulted" in r)
    assert "publish.exclude_sectoins is not a setting" in row
    assert "exited 1: Fix it" not in row


def test_a_fault_in_the_site_folders_file_is_listed_with_no_fix(
        tmp_path, monkeypatch, capsys):
    vault, site = site_vault(
        tmp_path, "  link_previews: off\n",
        {"backend": {"statusBar": True}})
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0 and text(vault) == before
    lines = out.splitlines()
    assert "publish.backend.statusBar" in lines[0] or "backend.statusBar" in lines[0]
    assert "site folder's vault.config.json" in lines[0]
    assert lines[1].startswith("note: ") and "vault update" in lines[1]
    assert not any(ln.startswith(("fix:", "proposed:")) for ln in lines)
    assert "Settings: no faults" not in out
    _, out, _ = run(monkeypatch, capsys, vault, "all")
    assert "## settings" in out


PROPOSED = [
    ("inbx: true", "publish.inbx", "publish.inbox", "turns publish.inbox on"),
    ("live_stat: true", "publish.live_stat", "publish.live_stats",
     "turns publish.live_stats on"),
    ("sit: true", "publish.sit", "publish.site", "turns publish.site on"),
    ("character_sheet: false", "publish.character_sheet",
     "publish.character_sheets", "turns publish.character_sheets off"),
    ("pc_prose_section: [Backstory, Secrets]", "publish.pc_prose_section",
     "publish.pc_prose_sections", '["Backstory", "Secrets"]'),
]


@pytest.mark.parametrize("line,name,target,words", PROPOSED)
def test_a_fix_that_switches_or_publishes_more_waits_for_a_name(
        tmp_path, monkeypatch, capsys, line, name, target, words):
    vault = make_vault(tmp_path, f"  {line}\n")
    before = text(vault)
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert f"proposed: move this to {target}" in out and words in out
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert not out.startswith("fixed:")
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--apply", name)
    assert out.startswith(f"fixed: moved {name} to {target}")
    assert name.removeprefix("publish.") + ":" not in text(vault).replace(
        target.removeprefix("publish.") + ":", "")
    assert fault_names(vault) == []


def test_apply_takes_several_names_and_refuses_a_name_with_no_fix(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  inbx: true\n  live_stat: true\n  link_preview: sideways\n")
    before = text(vault)
    code, out, err = settings_check(
        monkeypatch, capsys, vault, "--apply", "publish.inbx",
        "publish.link_preview")
    assert code == 2 and out == ""
    assert "no fix to apply for publish.link_preview" in err
    assert text(vault) == before
    code, out, _ = settings_check(
        monkeypatch, capsys, vault, "--apply", "publish.inbx",
        "publish.live_stat")
    assert out.count("fixed:") == 2
    assert fault_names(vault) == ["publish.link_preview"]
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.inbox") is True and s.get("player_site.features.live_stats") is True


def test_apply_with_a_certain_fix_works_too(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  total_sessions: 3\n")
    settings_check(monkeypatch, capsys, vault, "--apply", "publish.total_sessions")
    assert fault_names(vault) == []


def test_json_marks_certain_proposed_and_none(tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "  total_sessions: 3\n  inbx: true\n  link_preview: sideways\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    data = json.loads(out)
    assert [f["kind"] for f in data["faults"]] == [
        "certain", "proposed", "none"]
    assert data["waiting"] == 1
    assert data["faults"][1]["operations"][0] == {
        "op": "set", "name": "publish.inbox", "value": True}


def test_fix_alone_switches_nothing_on_and_no_allow_list_grows(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "  inbx: true\n  live_stat: true\n  sit: true\n"
        "  character_sheet: false\n  pc_prose_section: [Backstory, Secrets]\n"
        "  modee: full\n  exclude_sectoins: [Secrets]\n"
        "  backend:\n    statusBar: true\n  total_sessions: 4\n")
    names = [n for n in vaultlib.settings(vault).values]
    before = vaultlib.settings(vault).values
    settings_check(monkeypatch, capsys, vault, "--fix")
    after = vaultlib.settings(vault).values
    # The only differences: the hiding list grew, and the old name's value
    # (statusBar) is read the same as before.
    changed = {n for n in names if before[n] != after[n]}
    assert changed == {"player_site.hide.sections"}
    assert set(before["player_site.hide.sections"]) <= set(
        after["player_site.hide.sections"])
    assert after["player_site.features.inbox"] is False
    assert after["player_site.sheets.prose_sections"] == before[
        "player_site.sheets.prose_sections"]


@pytest.mark.parametrize("old,value,target", [
    ("backend:\n    statusBar", "true", "publish.live_stats"),
    ("backend:\n    statusBar", "false", "publish.live_stats"),
    ("backend:\n    inbox", "true", "publish.inbox"),
    ("images:\n    maxWidth", "800", "publish.images.max_width"),
])
def test_an_old_name_reads_the_same_before_and_after_the_move(
        tmp_path, monkeypatch, capsys, old, value, target):
    vault = make_vault(tmp_path, f"  {old}: {value}\n")
    before = vaultlib.settings(vault).values
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    (row,) = json.loads(out)["faults"]
    assert row["kind"] == "certain"
    settings_check(monkeypatch, capsys, vault, "--fix")
    vaultlib.forget_settings(vault)
    assert vaultlib.settings(vault).values == before
    assert fault_names(vault) == []


def test_a_fix_says_what_it_does_to_comments(tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  # sessions so far\n  total_sessions: 3 # old count\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "its comment on the same line is removed with it" in out
    assert "the comment line above it stays" in out
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    assert len(json.loads(out)["faults"][0]["comments"]) == 2


def test_callouts_fix_does_not_claim_a_built_in_list(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  exclude_callout: [secret]\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "fix: move this to publish.exclude_callouts" in out
    assert "built-in" not in out


def test_a_refused_row_names_the_key_the_gm_wrote(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  exclude_sectoins: true\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    note = next(ln for ln in out.splitlines() if ln.startswith("note:"))
    assert "publish.exclude_sectoins holds true" in note
    assert "publish.exclude_sections takes a list of headings" in note


def test_wrapup_without_node_still_runs_and_says_so(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  total_sessions: 3\n")
    monkeypatch.setattr(vaultlib.shutil, "which", lambda *_: None)
    code, out, _ = run(monkeypatch, capsys, vault, "wrapup")
    assert code == 0
    assert "the settings could not be checked" in out


def test_a_hiding_list_one_level_too_deep_is_moved_and_never_hides_less(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "  theme:\n    exclude_sections: [Plans]\n"
        "  landing:\n    exclude_drafts: true\n")
    built_in = vaultlib.settings_default("player_site.hide.sections")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert code == 0
    assert "STOP\t" in out and "publish.theme.exclude_sections" in out
    assert "fix: move this to publish.exclude_sections" in out
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert "fixed: moved publish.theme.exclude_sections" in out
    assert "fixed: moved publish.landing.exclude_drafts" in out
    assert out.strip().endswith("Settings: no faults")
    got = vaultlib.settings(vault)
    assert got.get("player_site.hide.sections") == built_in + ["Plans"]
    assert got.get("player_site.hide.drafts") is True
    assert "Plans" in text(vault)
    assert text(vault).count("exclude_sections") == 1


def test_a_hiding_list_beside_publish_is_listed_with_no_fix(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, None, raw="type: meta\nexclude_sections: [Rumours]\n"
        "publish:\n  mode: player")
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    lines = out.splitlines()
    assert code == 0
    assert lines[0].startswith("STOP\t")
    assert ("exclude_sections is written beside publish:; it belongs "
            "under it") in lines[0]
    assert not any(line.startswith(("fix:", "proposed:")) for line in lines)
    assert any(line.startswith("note: ") and "by hand" in line
               for line in lines)
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before


def test_publish_overrides_exclude_is_listed_with_the_only_override(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "  overrides:\n    exclude: [a]\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "The only override is publish.overrides.fields." in out
    assert not any(line.startswith("fix:") for line in out.splitlines())


class NewFileBase(unittest.TestCase):
    def vault(self, yaml_text):
        root = Path(tempfile.mkdtemp(prefix="vc-newfix-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "V"
        (vault / "_meta").mkdir(parents=True)
        (vault / "_meta" / "vault-config.yaml").write_text(yaml_text, "utf-8")
        return vault

    def rows(self, vault):
        vc.forget_settings(None)
        return vc.plan_settings(vault)[0]


class NewFileFixTests(NewFileBase):
    """A mis-named key in the NEW file is fixed in place by the settings
    command's carry, with the same certain/proposed rule as on the old file."""

    def test_a_stray_hiding_key_is_a_certain_fix_that_adds_to_the_right_list(self):
        vault = self.vault("version: 1\nplayer_site:\n  exclude_sections: [Rumours]\n")
        (row,) = [r for r in self.rows(vault) if r.fault["name"].endswith("exclude_sections")]
        self.assertEqual(row.kind, "certain")
        self.assertEqual(row.ops[0]["op"], "carry")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(vc.check_settings(vault, True, [], False), 0)
        vc.forget_settings(None)
        got = vc.settings(vault).get("player_site.hide.sections")
        self.assertIn("Rumours", got)
        self.assertIn("GM Notes", got)
        self.assertEqual(self.rows(vault), [])

    def test_a_stray_plain_value_is_proposed_and_applied_only_by_name(self):
        vault = self.vault("version: 1\nplayer_site:\n  site_title: Hollow\n")
        (row,) = self.rows(vault)
        self.assertEqual(row.kind, "proposed")
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, True, [], False)
        self.assertIn("site_title", (vault / "_meta" / "vault-config.yaml").read_text())
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, False, ["player_site.site_title"], False)
        vc.forget_settings(None)
        self.assertEqual(vc.settings(vault).get("player_site.title"), "Hollow")

    def test_a_stray_value_the_setting_refuses_has_no_fix(self):
        vault = self.vault("version: 1\nplayer_site:\n  searchh: maybe\n")
        (row,) = self.rows(vault)
        self.assertEqual((row.kind, row.ops), ("none", []))

    def test_a_left_over_old_file_is_a_certain_removal_when_it_holds_nothing_more(self):
        vault = self.vault("version: 1\nplayer_site:\n  title: Hollow\n")
        old = vault / "_meta" / "vault-config.md"
        old.write_text("---\ntype: meta\npublish:\n  site_title: Hollow\n---\n", "utf-8")
        (row,) = self.rows(vault)
        self.assertEqual(row.kind, "certain")
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, True, [], False)
        self.assertFalse(old.exists())

    def test_a_left_over_old_file_with_more_in_it_is_proposed_and_names_the_keys(self):
        vault = self.vault("version: 1\nplayer_site:\n  title: Hollow\n")
        old = vault / "_meta" / "vault-config.md"
        old.write_text("---\ntype: meta\npublish:\n  site_title: Hollow\n  search: false\n---\n", "utf-8")
        (row,) = self.rows(vault)
        self.assertEqual(row.kind, "proposed")
        self.assertIn("player_site.features.search", row.fix)
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, True, [], False)
        self.assertTrue(old.exists())    # --fix leaves a proposed fix alone
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, False, [str(old.relative_to(vault))], False)
        self.assertFalse(old.exists())

    def test_an_empty_new_file_is_copied_under_its_own_name(self):
        vault = self.vault("")
        self.assertEqual(vc.plan_settings(vault)[0], [])


class StrayBlockTests(NewFileBase):
    """A stray BLOCK in the new file (the old `publish:` block, or a group out
    of place) is fixed one setting at a time, and a stray hiding key beside a
    list that is already set adds to it."""

    def fix_all(self, vault):
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, True, [], False)
        vc.forget_settings(None)

    def test_the_old_publish_block_is_moved_child_by_child_and_removed(self):
        vault = self.vault(
            "version: 1\npublish:\n  exclude_sections: [Rumours]\n"
            "  site_title: Hollow\n  mystery_key: 3\n")
        rows = self.rows(vault)
        by = {r.fault["name"]: r for r in rows}
        self.assertEqual(by["publish.exclude_sections"].kind, "certain")
        self.assertEqual(by["publish.site_title"].kind, "proposed")
        self.assertEqual(by["publish"].kind, "none")     # the block itself: no fix
        self.fix_all(vault)
        got = vc.settings(vault)
        self.assertIn("Rumours", got.get("player_site.hide.sections"))
        self.assertIn("GM Notes", got.get("player_site.hide.sections"))
        self.assertIn("site_title", (vault / "_meta" / "vault-config.yaml").read_text())  # proposed: waits
        with contextlib.redirect_stdout(io.StringIO()):
            vc.check_settings(vault, False, ["publish.site_title"], False)
        vc.forget_settings(None)
        self.assertEqual(vc.settings(vault).get("player_site.title"), "Hollow")
        text = (vault / "_meta" / "vault-config.yaml").read_text()
        self.assertIn("mystery_key", text)               # maps to nothing: the block stays, listed
        self.assertTrue(any(r.fault["name"] == "publish" for r in self.rows(vault)))

    def test_a_block_whose_every_child_moves_is_gone(self):
        vault = self.vault("version: 1\npublish:\n  exclude_sections: [Rumours]\n"
                           "  exclude_fields: [secret_x]\n")
        self.fix_all(vault)
        self.assertNotIn("publish", (vault / "_meta" / "vault-config.yaml").read_text())
        self.assertEqual(self.rows(vault), [])

    def test_a_misplaced_group_goes_to_its_right_place(self):
        vault = self.vault("version: 1\nfeatures:\n  hide:\n    drafts: true\n")
        (row,) = [r for r in self.rows(vault) if r.fault["name"] == "features.hide.drafts"]
        self.assertEqual(row.ops[0], {"op": "carry", "from": "features.hide.drafts",
                                       "to": "player_site.hide.drafts"})

    def test_a_stray_hiding_list_is_added_to_a_list_already_set(self):
        vault = self.vault("version: 1\nplayer_site:\n  hide:\n"
                           "    sections: [Existing]\n    sectoins: [Mine]\n")
        (row,) = self.rows(vault)
        self.assertEqual(row.kind, "certain")
        self.fix_all(vault)
        got = vc.settings(vault).get("player_site.hide.sections")
        self.assertEqual(sorted(got), ["Existing", "Mine"])
        self.assertEqual(self.rows(vault), [])

    def test_an_old_named_list_beside_the_right_one_is_added_too(self):
        vault = self.vault("version: 1\nplayer_site:\n  exclude_sections: [Mine]\n"
                           "  hide:\n    sections: [Existing]\n")
        self.fix_all(vault)
        self.assertEqual(sorted(vc.settings(vault).get("player_site.hide.sections")),
                         ["Existing", "Mine"])

    def test_two_different_plain_values_stay_a_question_that_says_which_wins(self):
        vault = self.vault("version: 1\nplayer_site:\n  title: Right\n  site_title: Stray\n")
        (row,) = self.rows(vault)
        self.assertEqual(row.kind, "proposed")
        self.assertIn("this value wins", row.fix)
        self.assertIn("Right", row.fix)
        same = self.vault("version: 1\nplayer_site:\n  title: Same\n  site_title: Same\n")
        (row2,) = self.rows(same)
        self.assertEqual(row2.kind, "certain")


class SiteFileKeyTests(NewFileBase):
    """A vault already on the new file whose site folder's vault.config.json
    still holds settings the vault decides differently: the Settings check
    lists each and fixes them all, the tool doing the work across both files."""

    def moved_vault_with_site_keys(self, **keys):
        import json
        import site_fixture
        from layouts import move_to_new_layout
        root = Path(tempfile.mkdtemp(prefix="vc-sitekeys-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "V"
        (vault / "_meta").mkdir(parents=True)
        (vault / "_meta" / "vault-config.md").write_text(
            "---\ntype: meta\npublish:\n  site_title: Mine\n  exclude_sections: [A]\n---\n",
            encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None, private=True)
        site = site_fixture.point_site_at(vault)
        move_to_new_layout(vault)
        site_file = site / "vault.config.json"
        config = json.loads(site_file.read_text())
        site_file.write_text(json.dumps({**config, **keys}, indent=4) + "\n")
        vc.forget_settings(None)
        return vault, site_file

    def test_each_key_is_a_certain_fix_and_fix_clears_them_all(self):
        import json
        vault, site_file = self.moved_vault_with_site_keys(
            siteTitle="Theirs", excludeSections=["Z"], excludeCallouts=["spoiler"])
        rows = [r for r in self.rows(vault) if r.site]
        self.assertEqual(sorted(r.fault["name"] for r in rows),
                         ["excludeCallouts", "excludeSections", "siteTitle"])
        self.assertTrue(all(r.kind == "certain" for r in rows))
        by = {r.fault["name"]: r for r in rows}
        self.assertIn("already the value in use", by["siteTitle"].fix)
        self.assertIn("add its entries", by["excludeSections"].fix)
        self.assertNotIn("run the vault update", " ".join(str(r.fix) + str(r.note) for r in rows))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            vc.check_settings(vault, True, [], False)
        vc.forget_settings(None)
        got = vc.settings(vault)
        self.assertEqual(got.get("player_site.title"), "Mine")
        self.assertIn("Z", got.get("player_site.hide.sections"))
        self.assertEqual(got.get("player_site.hide.callouts"), ["spoiler"])
        text = site_file.read_text()
        self.assertIn("vaultPath", json.loads(text))
        self.assertNotIn("siteTitle", text)
        self.assertNotIn("excludeSections", text)
        self.assertIn('\n    "vaultPath"', text)     # its indentation kept
        self.assertEqual(self.rows(vault), [])

    def fix_output(self, vault):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = vc.check_settings(vault, True, [], False)
        vc.forget_settings(None)
        return code, buf.getvalue()

    def test_a_folder_key_the_vault_does_not_set_is_a_certain_move_not_a_removal(self):
        import json
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs=["gazetteer"], outputDir="site-out")
        rows = {r.fault["name"]: r for r in self.rows(vault) if r.site}
        self.assertEqual(sorted(rows), ["outputDir", "preserveDirs"])
        for row in rows.values():
            self.assertEqual(row.kind, "certain")
            self.assertEqual(row.ops, [{"op": "fold-site", "keys": [row.fault["name"]]}])
            self.assertNotIn("not read now", row.fix)
            self.assertIn("read from", row.fix)       # true until it is moved
            self.assertIn("moves", row.fix)
        code, out = self.fix_output(vault)
        self.assertEqual(code, 0, out)
        got = vc.settings(vault)
        self.assertEqual(got.get("player_site.keep"), ["gazetteer"])
        self.assertEqual(got.get("player_site.output"), "site-out")
        left = json.loads(site_file.read_text())
        self.assertNotIn("preserveDirs", left)
        self.assertNotIn("outputDir", left)
        self.assertEqual(self.rows(vault), [])

    def test_a_build_step_left_in_package_json_is_a_certain_move(self):
        import json
        import site_fixture
        vault, site_file = self.moved_vault_with_site_keys()
        site_fixture.pin_site(site_file.parent)
        pkg = site_file.parent / "package.json"
        data = json.loads(pkg.read_text())
        data["scripts"] = {"postbuild": "node scripts/glue.mjs"}
        pkg.write_text(json.dumps(data))
        rows = [r for r in self.rows(vault) if r.site]
        (row,) = rows
        self.assertEqual(row.kind, "certain")
        self.assertEqual(row.ops, [{"op": "fold-site", "keys": ["package.json postbuild"]}])
        self.assertIn("package.json", row.fault["message"])
        self.assertNotIn("not read now", row.fix)
        code, out = self.fix_output(vault)
        self.assertEqual(code, 0, out)
        self.assertEqual(vc.settings(vault).get("player_site.after_build"),
                         ["node scripts/glue.mjs"])
        self.assertNotIn("postbuild", json.loads(pkg.read_text()).get("scripts", {}))
        self.assertEqual(self.rows(vault), [])

    def test_an_unusable_folder_key_says_what_is_wrong_and_has_no_automatic_fix(self):
        vault, site_file = self.moved_vault_with_site_keys(preserveDirs="gazetteer")
        before = site_file.read_text()
        rows = [r for r in self.rows(vault) if r.site]
        (row,) = rows
        self.assertEqual(row.kind, "none")
        self.assertEqual(row.ops, [])
        self.assertIn("takes a list", row.fault["message"])
        self.assertIn("fix it in", row.note)
        code, out = self.fix_output(vault)
        self.assertNotIn("failed to start", out)
        self.assertNotIn("fix:", out)
        self.assertIn("takes a list", out)
        self.assertEqual(site_file.read_text(), before)

    def older_site(self, **keys):
        import site_fixture
        from test_migrate_move import install_as
        vault, site_file = self.moved_vault_with_site_keys(**keys)
        site = site_file.parent
        site_fixture.pin_site(site, "^1.20.0")
        install_as(site, "1.23.1")
        return vault, site_file

    def test_a_site_whose_tool_is_older_gets_one_informational_row_with_one_sentence(self):
        vault, _ = self.older_site(preserveDirs=["gazetteer"], outputDir="site-out")
        rows = [r for r in self.rows(vault) if r.site]
        (row,) = rows                                  # one row, not one per key
        self.assertEqual(row.kind, "none")
        self.assertEqual(row.ops, [])
        self.assertEqual(row.fault["level"], "info")
        self.assertIn("1.24.0", row.fault["message"])
        self.assertNotIn("next update", row.fault["message"])
        self.assertIsNone(row.note)
        self.assertTrue(vc._row_lines(row, "x")[0].startswith("NOTE\t"))

    def test_a_held_site_puts_no_warning_in_the_report(self):
        vault, _ = self.older_site(preserveDirs=["gazetteer"])
        self.assertEqual(vc.settings_fault_rows(vault), [])

    def test_an_unusable_value_on_a_key_the_vault_already_sets_has_no_fix(self):
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs="gazetteer", outputDir="../x")
        vaultlib.settings_set(vault, [("player_site.keep", ["maps"]),
                                      ("player_site.output", "out2")])
        before = site_file.read_text()
        by = {r.fault["name"]: r for r in self.rows(vault) if r.site}
        self.assertEqual(sorted(by), ["outputDir", "preserveDirs"])
        for row in by.values():
            self.assertEqual(row.kind, "none")
            self.assertEqual(row.ops, [])
            self.assertIn("fix it in", row.note)
            self.assertNotIn("differs", row.fault["message"])
        self.assertIn("takes a list", by["preserveDirs"].fault["message"])
        code, out = self.fix_output(vault)
        self.assertNotIn("failed to start", out)
        self.assertEqual(site_file.read_text(), before)

    def test_fix_beside_an_unusable_key_folds_its_own_key_and_leaves_the_unusable_one(self):
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs="gazetteer", excludeSections=["Z"])
        code, out = self.fix_output(vault)
        self.assertNotIn("failed to start", out)
        self.assertIn("preserveDirs", out)          # its STOP row still shows
        left = json.loads(site_file.read_text())
        self.assertEqual(left.get("preserveDirs"), "gazetteer")
        self.assertNotIn("excludeSections", left)
        self.assertIn("Z", vc.settings(vault).get("player_site.hide.sections"))

    def test_a_kept_folder_only_in_the_site_file_is_a_proposed_fix_that_names_it(self):
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs=["gazetteer", "maps"])
        vaultlib.settings_set(vault, [("player_site.keep", ["maps"])])
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.kind, "proposed")
        self.assertEqual(row.ops, [{"op": "fold-site", "keys": ["preserveDirs"]}])
        self.assertIn("gazetteer", row.fix)
        self.assertNotIn("maps", row.fix.split("gazetteer")[0][-5:])
        self.assertIn("cleaned at the next build", row.fix)
        self.assertIn("player_site.keep", row.fix)
        code, out = self.fix_output(vault)                  # --fix leaves it
        self.assertIn("preserveDirs", site_file.read_text())
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            vc.check_settings(vault, False, ["preserveDirs"], False)
        vc.forget_settings(None)
        self.assertNotIn("preserveDirs", site_file.read_text())

    def test_fix_folds_only_the_certain_keys_and_a_proposed_one_waits(self):
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs=["gazetteer", "maps"], siteUrl="https://theirs.example")
        vaultlib.settings_set(vault, [("player_site.keep", ["maps"]),
                                      ("player_site.url", "https://mine.example")])
        code, out = self.fix_output(vault)
        left = json.loads(site_file.read_text())
        self.assertNotIn("siteUrl", left)
        self.assertEqual(left.get("preserveDirs"), ["gazetteer", "maps"])
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.kind, "proposed")
        self.assertEqual(row.fault["name"], "preserveDirs")
        self.assertIn("waiting for the GM's yes", out)

    def test_apply_folds_only_the_named_key(self):
        vault, site_file = self.moved_vault_with_site_keys(
            preserveDirs=["gazetteer", "maps"], outputDir="site-out")
        vaultlib.settings_set(vault, [("player_site.keep", ["maps"]),
                                      ("player_site.output", "out2")])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            vc.check_settings(vault, False, ["preserveDirs"], False)
        vc.forget_settings(None)
        left = json.loads(site_file.read_text())
        self.assertNotIn("preserveDirs", left)
        self.assertEqual(left.get("outputDir"), "site-out")
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.fault["name"], "outputDir")
        self.assertEqual(row.kind, "proposed")

    def test_a_differing_output_folder_is_proposed_and_names_both_folders(self):
        vault, _ = self.moved_vault_with_site_keys(outputDir="site-out")
        vaultlib.settings_set(vault, [("player_site.output", "out2")])
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.kind, "proposed")
        self.assertIn("out2", row.fix)
        self.assertIn("site-out", row.fix)
        self.assertIn("builds into", row.fix)

    def test_a_differing_address_is_certain_and_names_both_values(self):
        vault, _ = self.moved_vault_with_site_keys(siteUrl="https://theirs.example")
        vaultlib.settings_set(vault, [("player_site.url", "https://mine.example")])
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.kind, "certain")
        self.assertIn("https://mine.example", row.fix)
        self.assertIn("https://theirs.example", row.fix)
        self.assertNotIn("not read now", row.fix)

    def test_while_one_key_blocks_the_move_the_other_site_rows_have_no_fix(self):
        vault, site_file = self.moved_vault_with_site_keys(
            outputDir="../out", siteUrl="https://theirs.example",
            preserveDirs=["gazetteer"])
        by = {r.fault["name"]: r for r in self.rows(vault) if r.site}
        self.assertEqual(sorted(by), ["outputDir", "preserveDirs", "siteUrl"])
        self.assertIn("../out", by["outputDir"].fault["message"])
        for row in by.values():
            self.assertEqual(row.kind, "none")
            self.assertEqual(row.ops, [])
            self.assertIsNone(row.fix)
        for name in ("siteUrl", "preserveDirs"):
            self.assertIn("outputDir", by[name].note)
        before = site_file.read_text()
        code, out = self.fix_output(vault)
        self.assertNotIn("not fixed", out)
        self.assertEqual(site_file.read_text(), before)

    def test_a_site_key_row_names_the_site_file_once(self):
        vault, _ = self.moved_vault_with_site_keys(siteUrl="https://theirs.example")
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.fault["message"].count("in the site folder's vault.config.json"), 1,
                         row.fault["message"])
        vaultlib.settings_set(vault, [("player_site.url", "https://mine.example")])
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.fault["message"].count("in the site folder's vault.config.json"), 1,
                         row.fault["message"])

    def test_a_package_step_that_differs_from_the_settings_has_a_row_and_no_fix(self):
        import site_fixture
        vault, site_file = self.moved_vault_with_site_keys()
        vaultlib.settings_set(vault, [("player_site.after_build", ["node mine.mjs"])])
        site_fixture.pin_site(site_file.parent)
        pkg = site_file.parent / "package.json"
        data = json.loads(pkg.read_text())
        data["scripts"] = {"postbuild": "node theirs.mjs"}
        pkg.write_text(json.dumps(data))
        (row,) = [r for r in self.rows(vault) if r.site]
        self.assertEqual(row.kind, "none")
        self.assertEqual(row.ops, [])
        self.assertEqual(row.where, "package.json")
        self.assertIn("npm run build", row.fault["message"])
        self.assertIn("make them the same", row.note)
        self.assertIn("take the script out of package.json", row.note)

    def test_a_site_hiding_key_that_is_not_a_list_says_nothing_was_carried(self):
        vault, site_file = self.moved_vault_with_site_keys(
            excludeSections="Secret", excludeFields=["motive"])
        by = {r.fault["name"]: r for r in self.rows(vault) if r.site}
        self.assertIn("nothing was carried", by["excludeSections"].done)
        self.assertIn("nothing is added", by["excludeSections"].fix)
        self.assertNotIn("nothing was carried", by["excludeFields"].done)
        self.assertIn("add its entries", by["excludeFields"].fix)

    def test_the_update_points_at_the_settings_check_and_does_not_hold_the_stamp(self):
        import migrate_site as ms
        from migrate_core import PERSON
        vault, _ = self.moved_vault_with_site_keys(siteTitle="Theirs")
        items = ms.find_settings_move(vault)
        (item,) = [i for i in items if i.group == PERSON]
        self.assertFalse(item.holds_stamp)
        self.assertIn("Settings check", item.lines[0])
        self.assertNotIn("run the vault update", item.lines[0])

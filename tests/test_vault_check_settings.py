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
from layouts import write_config  # noqa: E402

CONFIG = "_meta/vault-config.yaml"


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def make_vault(tmp_path: Path, body: str | None, name: str = "vault",
               raw: str | None = None) -> Path:
    """A vault whose settings file holds `body` after `version: 1` (the
    groups, in the new names), or `raw` as the whole file."""
    vault = tmp_path / name
    (vault / "_meta").mkdir(parents=True)
    text = raw if raw is not None else "version: 1\n" + (body or "")
    (vault / CONFIG).write_text(text, encoding="utf-8")
    return vault


def run(monkeypatch, capsys, vault: Path, *args: str):
    monkeypatch.setattr(sys, "argv", ["vault_check.py", str(vault), *args])
    vaultlib.forget_settings(None)
    code = vc.main()
    out = capsys.readouterr()
    return code, out.out, out.err


def settings_check(monkeypatch, capsys, vault, *args):
    return run(monkeypatch, capsys, vault, "settings", *args)


def text(vault: Path) -> str:
    return (vault / CONFIG).read_text(encoding="utf-8")


def fault_names(vault: Path) -> list[str]:
    vaultlib.forget_settings(vault)
    return [f["name"] for f in vaultlib.settings(vault).faults]


CLEAN = "player_site:\n  features:\n    link_previews: off\n"
SECTOINS = "player_site:\n  hide:\n    sectoins: [GM Notes, Secrets]\n"
BAD_PREVIEW = "player_site:\n  features:\n    link_preview: sideways\n"
MODE = "player_site:\n  hide:\n    mode: player\n"


def test_a_clean_vault_has_no_faults(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, CLEAN)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert (code, out.strip()) == (0, "Settings: no faults")


def test_a_misspelt_hiding_list_is_moved_and_keeps_the_built_in_headings(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, SECTOINS)
    built_in = vaultlib.settings_default("player_site.hide.sections")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert code == 0
    first, fix = out.splitlines()[:2]
    assert first.startswith("STOP\t")
    assert "player_site.hide.sectoins is not a setting" in first
    assert fix == ("fix: move this to player_site.hide.sections, "
                   "keeping the built-in headings")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0
    assert out.splitlines()[0].startswith(
        "fixed: moved player_site.hide.sectoins")
    assert out.strip().endswith("Settings: no faults")
    got = vaultlib.settings(vault).get("player_site.hide.sections")
    assert got == built_in + ["Secrets"]
    assert "sectoins" not in text(vault)


def test_a_value_the_setting_will_not_take_is_listed_not_fixed(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, BAD_PREVIEW)
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    lines = out.splitlines()
    assert lines[0].startswith("WARN\t")
    assert not any(line.startswith("fix:") for line in lines)
    assert "takes on, desktop or off" in out
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert not out.startswith("fixed:")


def test_an_old_block_child_that_turns_something_on_waits_for_a_name(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "publish:\n  backend:\n    statusBar: true\n")
    before = text(vault)
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert "proposed: move this to player_site.features.live_stats" in out
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--apply",
                               "publish.backend.statusBar")
    assert "fixed: moved publish.backend.statusBar to player_site.features.live_stats" in out
    assert vaultlib.settings(vault).get("player_site.features.live_stats") is True


def test_a_retired_setting_is_removed(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, MODE + "  features:\n    link_previews: off\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "fix: remove player_site.hide.mode" in out
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert "mode:" not in text(vault)
    assert "link_previews: off" in text(vault)
    assert fault_names(vault) == []


def test_fix_twice_changes_nothing_the_second_time(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "player_site:\n  hide:\n    sectoins: [Secrets]\n    mode: player\n"
                  "  features:\n    link_preview: sideways\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    after_first = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0 and text(vault) == after_first
    assert "fixed:" not in out
    assert "player_site.features.link_preview is not a setting" in out


def test_json_rows_carry_the_certain_flag_and_the_operations(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "player_site:\n  hide:\n    sectoins: [Secrets]\n"
                  "  features:\n    link_preview: sideways\n")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    data = json.loads(out)
    assert data["applied"] == []
    stop, warn = data["faults"]
    assert (stop["level"], stop["fault"], stop["kind"], stop["certain"]) == (
        "stop", "unknown-name", "certain", True)
    assert stop["operations"] == [
        {"op": "carry", "from": "player_site.hide.sectoins",
         "to": "player_site.hide.sections"}]
    assert stop["fix"].startswith("move this to player_site.hide.sections")
    assert (warn["certain"], warn["operations"], warn["fix"]) == (
        False, [], None)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix", "--json")
    data = json.loads(out)
    assert [a["name"] for a in data["applied"]] == ["player_site.hide.sectoins"]
    assert [f["name"] for f in data["faults"]] == [
        "player_site.features.link_preview"]


def test_a_clean_vault_in_json_is_empty(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, CLEAN)
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    assert json.loads(out)["faults"] == []


def test_a_misspelt_switch_that_hides_more_is_moved(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "player_site:\n  hide:\n    draft: true\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    assert vaultlib.settings(vault).get("player_site.hide.drafts") is True
    assert fault_names(vault) == []


def test_invalid_yaml_is_one_row_with_no_fix(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, None, raw="version: 1\nplayer_site: [unclosed")
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0
    assert out.startswith("STOP\t")
    assert "not valid YAML" in out and "fix:" not in out
    assert len(out.splitlines()) == 1


def test_without_node_the_check_gives_the_one_plain_line(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, MODE)
    monkeypatch.setattr(vaultlib.shutil, "which", lambda *_: None)
    code, out, err = settings_check(monkeypatch, capsys, vault)
    assert code == 2 and out == ""
    assert err.strip() == ("error: could not read the vault's settings: "
                           "node is not on PATH")


def test_all_shows_a_settings_row_only_when_there_is_a_fault(
        tmp_path, monkeypatch, capsys):
    clean = make_vault(tmp_path, CLEAN, "clean")
    _, out, _ = run(monkeypatch, capsys, clean, "all")
    assert "## settings" not in out
    faulty = make_vault(
        tmp_path, "player_site:\n  hide:\n    sectoins: [Secrets]\n    mode: player\n",
        "faulty")
    _, out, _ = run(monkeypatch, capsys, faulty, "all")
    rows = out.split("## settings\n# count: 1\n")[1].splitlines()
    assert len(rows) == 1
    assert rows[0].startswith("ERROR\t")
    assert "2 settings faults (1 stop, 1 warn)" in rows[0]
    assert "settings" in rows[0].split("run ")[1]


def test_wrapup_carries_the_same_row(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, SECTOINS)
    _, out, _ = run(monkeypatch, capsys, vault, "wrapup")
    assert "## settings" in out
    clean = make_vault(tmp_path, CLEAN, "clean")
    _, out, _ = run(monkeypatch, capsys, clean, "wrapup")
    assert "## settings" not in out


def test_after_fix_only_uncertain_faults_remain_and_nothing_is_shown_more(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "player_site:\n  hide:\n    sectoins: [Secrets]\n    feilds: [Cost]\n"
        "    callouts: [secret]\n    mode: player\n"
        "  features:\n    link_preview: sideways\n")
    names = ("player_site.hide.sections", "player_site.hide.fields",
             "player_site.hide.callouts", "player_site.hide.drafts")
    before = {n: vaultlib.settings(vault).get(n) for n in names}
    settings_check(monkeypatch, capsys, vault, "--fix")
    vaultlib.forget_settings(vault)
    s = vaultlib.settings(vault)
    assert sorted(f["name"] for f in s.faults) == [
        "player_site.features.link_preview"]
    for n in ("player_site.hide.sections", "player_site.hide.fields"):
        assert set(before[n]) <= set(s.get(n))
    assert "Cost" in s.get("player_site.hide.fields")
    assert "Secrets" in s.get("player_site.hide.sections")
    assert s.get("player_site.hide.callouts") == ["secret"]


def test_two_misspellings_of_one_name_both_land(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "player_site:\n  hide:\n    sectoins: [Secrets]\n    sectons: [Plans]\n")
    settings_check(monkeypatch, capsys, vault, "--fix")
    got = vaultlib.settings(vault).get("player_site.hide.sections")
    assert "Secrets" in got and "Plans" in got
    assert fault_names(vault) == []


def site_vault(tmp_path, body, site_json=None):
    site = tmp_path / "site"
    site.mkdir()
    vault = make_vault(
        tmp_path, "player_site:\n  publish: true\n"
                  f"  folder: {site}\n{body}")
    (site / "vault.config.json").write_text(
        json.dumps({"vaultPath": "../vault", **(site_json or {})}),
        encoding="utf-8")
    return vault, site


def test_the_frontmatter_row_names_the_fault_that_stopped_the_tool(
        tmp_path):
    vault, _ = site_vault(tmp_path, "  hide:\n    sectoins: [Secrets]\n")
    vc.use_publish_tool(vc.PUBLISH_TOOL)
    rows = vc.check_frontmatter(vault, None)
    row = next(r for r in rows if "could not be consulted" in r)
    assert "player_site.hide.sectoins is not a setting." in row
    assert "?." not in row and ".." not in row
    assert "Settings check" in row


def test_the_frontmatter_row_names_a_stop_that_follows_a_warning(tmp_path):
    vault, _ = site_vault(
        tmp_path, "  hide:\n    sectoins: [Secrets]\n    mode: player\n")
    vc.use_publish_tool(vc.PUBLISH_TOOL)
    row = next(r for r in vc.check_frontmatter(vault, None)
               if "could not be consulted" in r)
    assert "player_site.hide.sectoins is not a setting" in row
    assert "exited 1: Fix it" not in row


def test_a_key_left_in_the_site_folders_file_is_listed_with_no_fix(
        tmp_path, monkeypatch, capsys):
    vault, site = site_vault(
        tmp_path, "  features:\n    link_previews: off\n",
        {"siteTitle": "Old"})
    before = text(vault)
    code, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert code == 0 and text(vault) == before
    lines = out.splitlines()
    assert lines[0].startswith("STOP\t")
    assert "vault.config.json" in lines[0]
    assert not any(ln.startswith(("fix:", "proposed:")) for ln in lines)
    assert "Settings: no faults" not in out
    _, out, _ = run(monkeypatch, capsys, vault, "all")
    assert "## settings" in out


PROPOSED = [
    ("features", "inbx: true", "player_site.features.inbx",
     "player_site.features.inbox", "turns player_site.features.inbox on"),
    ("features", "live_stat: true", "player_site.features.live_stat",
     "player_site.features.live_stats", "turns player_site.features.live_stats on"),
    ("", "publis: true", "player_site.publis", "player_site.publish",
     "turns player_site.publish on"),
    ("sheets", "shows: false", "player_site.sheets.shows",
     "player_site.sheets.show", "turns player_site.sheets.show off"),
    ("sheets", "prose_section: [Backstory, Secrets]",
     "player_site.sheets.prose_section", "player_site.sheets.prose_sections",
     '["Backstory", "Secrets"]'),
]


def proposed_body(group, line):
    return ("player_site:\n" + (f"  {group}:\n    {line}\n" if group
                                else f"  {line}\n"))


@pytest.mark.parametrize("group,line,name,target,words", PROPOSED)
def test_a_fix_that_switches_or_publishes_more_waits_for_a_name(
        tmp_path, monkeypatch, capsys, group, line, name, target, words):
    vault = make_vault(tmp_path, proposed_body(group, line))
    before = text(vault)
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert f"proposed: move this to {target}" in out and words in out
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--fix")
    assert text(vault) == before
    assert not out.startswith("fixed:")
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--apply", name)
    assert out.startswith(f"fixed: moved {name} to {target}")
    assert fault_names(vault) == []


def test_apply_takes_several_names_and_refuses_a_name_with_no_fix(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "player_site:\n  features:\n    inbx: true\n    live_stat: true\n"
                  "    link_preview: sideways\n")
    before = text(vault)
    code, out, err = settings_check(
        monkeypatch, capsys, vault, "--apply", "player_site.features.inbx",
        "player_site.features.link_preview")
    assert code == 2 and out == ""
    assert "no fix to apply for player_site.features.link_preview" in err
    assert text(vault) == before
    code, out, _ = settings_check(
        monkeypatch, capsys, vault, "--apply", "player_site.features.inbx",
        "player_site.features.live_stat")
    assert out.count("fixed:") == 2
    assert fault_names(vault) == ["player_site.features.link_preview"]
    s = vaultlib.settings(vault)
    assert s.get("player_site.features.inbox") is True and s.get("player_site.features.live_stats") is True


def test_apply_with_a_certain_fix_works_too(tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, MODE)
    settings_check(monkeypatch, capsys, vault, "--apply", "player_site.hide.mode")
    assert fault_names(vault) == []


def test_json_marks_certain_proposed_and_none(tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "player_site:\n  hide:\n    mode: player\n  features:\n    inbx: true\n"
        "    link_preview: sideways\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    data = json.loads(out)
    assert [f["kind"] for f in data["faults"]] == [
        "certain", "proposed", "none"]
    assert data["waiting"] == 1
    assert data["faults"][1]["operations"][0] == {
        "op": "carry", "from": "player_site.features.inbx",
        "to": "player_site.features.inbox"}


def test_fix_alone_switches_nothing_on_and_no_allow_list_grows(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path,
        "player_site:\n  hide:\n    sectoins: [Secrets]\n    mode: player\n"
        "  features:\n    inbx: true\n    live_stat: true\n"
        "  sheets:\n    shows: false\n    prose_section: [Backstory, Secrets]\n")
    names = [n for n in vaultlib.settings(vault).values]
    before = vaultlib.settings(vault).values
    settings_check(monkeypatch, capsys, vault, "--fix")
    after = vaultlib.settings(vault).values
    # The only difference: the hiding list grew.
    changed = {n for n in names if before[n] != after[n]}
    assert changed == {"player_site.hide.sections"}
    assert set(before["player_site.hide.sections"]) <= set(
        after["player_site.hide.sections"])
    assert after["player_site.features.inbox"] is False
    assert after["player_site.sheets.prose_sections"] == before[
        "player_site.sheets.prose_sections"]


def test_a_fix_says_what_it_does_to_comments(tmp_path, monkeypatch, capsys):
    vault = make_vault(
        tmp_path, "player_site:\n  hide:\n    # who reads\n    mode: player # old\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "its comment on the same line is removed with it" in out
    assert "the comment line above it stays" in out
    _, out, _ = settings_check(monkeypatch, capsys, vault, "--json")
    assert len(json.loads(out)["faults"][0]["comments"]) == 2


def test_callouts_fix_does_not_claim_a_built_in_list(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "player_site:\n  hide:\n    callout: [secret]\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    assert "fix: move this to player_site.hide.callouts" in out
    assert "built-in" not in out


def test_a_refused_row_names_the_key_the_gm_wrote(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, "player_site:\n  hide:\n    sectoins: true\n")
    _, out, _ = settings_check(monkeypatch, capsys, vault)
    note = next(ln for ln in out.splitlines() if ln.startswith("note:"))
    assert "player_site.hide.sectoins holds true" in note
    assert "player_site.hide.sections takes a list of headings" in note


def test_wrapup_without_node_still_runs_and_says_so(
        tmp_path, monkeypatch, capsys):
    vault = make_vault(tmp_path, MODE)
    monkeypatch.setattr(vaultlib.shutil, "which", lambda *_: None)
    code, out, _ = run(monkeypatch, capsys, vault, "wrapup")
    assert code == 0
    assert "the settings could not be checked" in out


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
        return vc.plan_settings(vault)


class NewFileFixTests(NewFileBase):
    """A mis-named key in the file is fixed in place by the settings
    command's carry: certain when it can only hide more, proposed otherwise."""

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

    def test_an_empty_new_file_is_copied_under_its_own_name(self):
        vault = self.vault("")
        self.assertEqual(vc.plan_settings(vault), [])


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

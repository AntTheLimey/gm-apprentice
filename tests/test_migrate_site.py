"""migrate_site.py: the repin, config, publish.site and site-tool checks. The
publish tool is stubbed the way tests/test_vault_check_slice_a.py stubs it,
plus one end-to-end test against the real tool."""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402
import migrate_core  # noqa: E402
import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
import vault_check as vc  # noqa: E402
from migrate_core import PERSON, WILL, StepFailed  # noqa: E402

MOVES = {"applicable": True,
         "moves": [{"from": "vault.config.json siteTitle",
                    "to": "publish.site_title", "value": "T"}],
         "merges": [], "switches": [], "conflicts": [], "notes": [],
         "vaultSet": {}, "vaultRemove": [], "siteRemove": [],
         "lines": ["move vault.config.json siteTitle -> publish.site_title",
                   'skipped publish.exclude_dirs: not text, so not carried over: 2',
                   'conflict footer: kept "F" from the vault file, discarded "G"',
                   "note publish.theme is rewritten to add tagline"]}
BACKUPS = ["backup /v/_meta/vault-config.md.pre-migrate",
           "backup kept from an earlier run: /s/vault.config.json.pre-migrate"]
NOTHING = dict(MOVES, applicable=False, moves=[], lines=[],
               reason="nothing to migrate")


def tmp(case, prefix):
    d = Path(tempfile.mkdtemp(prefix=prefix))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    return d


def site_of(vault):
    return vc.configured_site(vault)[0]


def make_vault(case, publish=True, site=True, version="1.10.12", extra=""):
    vault = tmp(case, "mig-vault-")
    (vault / "_meta").mkdir()
    body = f'---\ngm_apprentice_version: "{version}"\n'
    if publish:
        body += "publish:\n  mode: player\n"
        if site:
            site_dir = tmp(case, "mig-site-")
            (site_dir / "vault.config.json").write_text("{}", encoding="utf-8")
            body += f"  site_dir: {site_dir}\n"
        body += extra
    (vault / "_meta" / "vault-config.md").write_text(body + "---\n",
                                                    encoding="utf-8")
    return vault


@contextlib.contextmanager
def stubbed(tool):
    with mock.patch.object(vc.shutil, "which", return_value="/usr/bin/node"), \
            mock.patch.object(vc.subprocess, "run", tool):
        yield


class Tool:
    """A stand-in for subprocess.run: answers `migrate-config` with the
    pending plan until it has been run for real, then with nothing."""

    def __init__(self, pending=True, fail=None, stays_pending=False,
                 no_lines=False, stdout=None, plan=None):
        self.pending, self.fail, self.stays = pending, fail, stays_pending
        self.no_lines, self.stdout, self.plan = no_lines, stdout, plan
        self.calls = []

    def __call__(self, cmd, **kwargs):
        self.calls.append(cmd)
        if self.fail:
            return subprocess.CompletedProcess(cmd, 1, "", self.fail + "\n")
        if self.stdout is not None:
            return subprocess.CompletedProcess(cmd, 0, self.stdout, "")
        plan = (self.plan or MOVES) if self.pending else NOTHING
        if "--dry-run" not in cmd:
            if self.pending:
                plan = dict(plan, lines=plan["lines"] + BACKUPS)
            if not self.stays:
                self.pending = False
        if self.no_lines:
            plan = {k: v for k, v in plan.items() if k != "lines"}
        return subprocess.CompletedProcess(cmd, 0, json.dumps(plan), "")


class Pin:
    """A stand-in for migrate_core.plugin_tool running update-pin."""

    def __init__(self, ok=False, installed="1.11.41", fails=False, out=None):
        self.ok, self.installed, self.fails, self.out = ok, installed, fails, out
        self.calls = []

    def __call__(self, args):
        self.calls.append(args)
        if "--check" in args:
            text = self.out if self.out is not None else json.dumps(
                {"ok": self.ok, "installedBefore": self.installed,
                 "desired": "1.10.26", "changed": False})
            return (0 if self.ok else 1), text, ""
        if self.fails:
            return 1, "Repointed package.json, but npm install left nothing " \
                      "in node_modules.\nnpm ERR! network\n", ""
        self.ok = True
        return 0, "Updated gm-apprentice-publish from 1.11.41 to 1.12.2\n", ""


class RepinTests(unittest.TestCase):
    def find(self, vault, pin):
        with mock.patch.object(ms, "plugin_tool", pin):
            return ms.find_site_repin(vault)

    def test_a_current_site_plans_nothing(self):
        self.assertEqual(self.find(make_vault(self), Pin(ok=True)), [])

    def test_a_stale_site_is_one_will_do_item_that_repins(self):
        vault = make_vault(self)
        pin = Pin()
        with mock.patch.object(ms, "plugin_tool", pin):
            (item,) = ms.find_site_repin(vault)
            self.assertEqual((item.id, item.group), (migrate.REPIN, WILL))
            self.assertIn("installed: 1.11.41", item.lines[0])
            self.assertEqual(item.apply(None), [
                "Updated gm-apprentice-publish from 1.11.41 to 1.12.2"])
            self.assertEqual(ms.find_site_repin(vault), [])
        self.assertEqual(pin.calls[1][:1], ["update-pin"])
        self.assertNotIn("--check", pin.calls[1])
        self.assertIn(str(site_of(vault)), pin.calls[1])

    def test_a_failed_install_raises_with_npms_last_lines(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "plugin_tool", Pin(fails=True)):
            (item,) = ms.find_site_repin(vault)
            with self.assertRaises(StepFailed) as caught:
                item.apply(None)
        self.assertIn("npm ERR! network", str(caught.exception))

    def test_no_site_never_runs_the_tool(self):
        pin = Pin()
        for vault in (make_vault(self, publish=False),
                      make_vault(self, site=False),
                      make_vault(self, extra="  site: false\n")):
            self.assertEqual(self.find(vault, pin), [])
        self.assertEqual(pin.calls, [])

    def test_a_site_that_is_on_with_no_folder_stops(self):
        vault = make_vault(self, site=False, extra="  site: true\n")
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, Pin())
        self.assertIn("publish.site is on but publish.site_dir names no "
                      "folder", str(caught.exception))

    def test_a_site_dir_with_no_site_file_stops(self):
        vault = make_vault(self)
        (site_of(vault) / "vault.config.json").unlink()
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, Pin())
        self.assertIn("no vault.config.json is there", str(caught.exception))

    def test_inline_publish_block_stops_the_repin(self):
        vault = make_vault(self, publish=False)
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ngm_apprentice_version: "1.10.12"\n'
            "publish: {mode: player, site_dir: ../site}\n---\n",
            encoding="utf-8")
        pin = Pin()
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, pin)
        self.assertIn("written on one line", str(caught.exception))
        self.assertEqual(pin.calls, [])

    def test_unreadable_check_output_stops(self):
        with self.assertRaises(StepFailed) as caught:
            self.find(make_vault(self), Pin(out="not json"))
        self.assertIn("did not return the expected JSON",
                      str(caught.exception))

    def test_a_crashed_check_says_why(self):
        vault = make_vault(self)
        crash = mock.Mock(return_value=(
            1, "", "node:internal\nError: Cannot find module 'x'\n\n"))
        with mock.patch.object(ms, "plugin_tool", crash), \
                self.assertRaises(StepFailed) as caught:
            ms.find_site_repin(vault)
        self.assertTrue(str(caught.exception).endswith(
            "expected JSON: Error: Cannot find module 'x'"))
        silent = mock.Mock(return_value=(3, "", ""))
        with mock.patch.object(ms, "plugin_tool", silent), \
                self.assertRaises(StepFailed) as caught:
            ms.find_site_repin(vault)
        self.assertTrue(str(caught.exception).endswith(
            "expected JSON: update-pin exited 3"))


class ConfigStepTests(unittest.TestCase):
    def pin_site(self, spec):
        vault = make_vault(self)
        site = site_of(vault)
        (site / "package.json").write_text(json.dumps(
            {"dependencies": {"gm-apprentice-publish": spec}}), encoding="utf-8")
        return vault, site

    def fails_with(self, vault, tool):
        tool = tool or Tool()
        with stubbed(tool), self.assertRaises(StepFailed) as caught:
            ms.find_config_to_vault(vault)
        return str(caught.exception), tool

    def test_unknown_command_names_the_site_and_the_fix(self):
        vault = make_vault(self)
        msg, _ = self.fails_with(
            vault, Tool(fail="Unknown command: migrate-config"))
        self.assertEqual(
            msg, f"the site's publish tool does not have migrate-config; it "
                 f"is older than this migration needs ({ms.NEEDS_PUBLISH}). "
                 f"Run update-pin --site {site_of(vault)}, then migrate.py "
                 f"again.")

    def test_unknown_command_without_a_site_says_to_update_the_plugin(self):
        msg, _ = self.fails_with(make_vault(self, site=False),
                                 Tool(fail="Unknown command: migrate-config"))
        self.assertNotIn("update-pin", msg)
        self.assertIn("Update the gm-apprentice plugin", msg)

    def test_old_numeric_pin_gets_one_plain_message(self):
        vault, site = self.pin_site("1.10.19")
        msg, tool = self.fails_with(vault, None)
        self.assertEqual(tool.calls, [])
        self.assertEqual(
            msg, f"the site's publish tool (1.10.19) is older than this "
                 f"migration needs ({ms.NEEDS_PUBLISH}). Run update-pin "
                 f"--site {site}, then migrate.py again.")

    def test_unreadable_pin_says_it_cannot_tell(self):
        vault, site = self.pin_site("file:../tools/publish")
        msg, tool = self.fails_with(vault, None)
        self.assertEqual(tool.calls, [])
        self.assertEqual(
            msg, f"cannot tell which publish tool the site at {site} uses "
                 f"(file:../tools/publish). Run update-pin --site {site}, "
                 f"then migrate.py again.")

    def test_an_unreadable_package_json_is_said_plainly(self):
        vault = make_vault(self)
        (site_of(vault) / "package.json").write_text("{not json",
                                                     encoding="utf-8")
        msg, _ = self.fails_with(vault, None)
        self.assertIn("the site's package.json can't be read", msg)
        self.assertTrue(msg.endswith("then run migrate.py again"))

    def test_a_missing_tool_script_points_at_update_pin(self):
        vault = make_vault(self)
        site = site_of(vault)
        pkg = site / "node_modules" / "gm-apprentice-publish"
        (pkg / "bin").mkdir(parents=True)
        (pkg / "package.json").write_text('{"version": "1.12.0"}',
                                          encoding="utf-8")
        msg, tool = self.fails_with(vault, None)
        self.assertEqual(tool.calls, [])
        self.assertEqual(
            msg, f"{pkg / 'bin' / 'gm-publish.js'} is missing. Run "
                 f"update-pin --site {site}, then migrate.py again.")

    def test_no_node_is_not_blamed_on_the_pin(self):
        vault = make_vault(self)
        with mock.patch.object(ms.shutil, "which", return_value=None), \
                mock.patch.object(vc.shutil, "which", return_value=None), \
                self.assertRaises(StepFailed) as caught:
            ms.find_config_to_vault(vault)
        self.assertEqual(str(caught.exception),
                         "node is not on PATH; install Node.js, then run "
                         "migrate.py again")

    def test_temp_dir_failure_is_not_reported_as_node_failing(self):
        vault, tool = make_vault(self, site=False), Tool()
        with mock.patch.object(vc.tempfile, "mkdtemp", side_effect=OSError):
            msg, _ = self.fails_with(vault, tool)
        self.assertIn("no temporary directory", msg)
        self.assertNotIn("node could not run", msg)
        self.assertEqual(tool.calls, [])

    def test_a_publish_block_on_one_line_stops_the_config_step(self):
        vault = make_vault(self, publish=False)
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish: {mode: player, site_dir: ../site}\n---\n",
            encoding="utf-8")
        msg, tool = self.fails_with(vault, None)
        self.assertIn("written on one line", msg)
        self.assertEqual(tool.calls, [])

    def test_a_publish_block_without_a_site_still_reaches_the_tool(self):
        tool = Tool()
        with stubbed(tool):
            (item,) = ms.find_config_to_vault(make_vault(self, site=False))
        self.assertEqual(len(tool.calls), 1)
        self.assertNotIn("--config", tool.calls[0])
        self.assertIn("--vault", tool.calls[0])
        self.assertEqual(item.id, "config-to-vault")

    def test_pending_moves_are_one_will_do_item(self):
        vault = make_vault(self)
        with stubbed(Tool()):
            (item,) = ms.find_config_to_vault(vault)
        self.assertEqual((item.id, item.group), ("config-to-vault", WILL))
        self.assertEqual(item.lines, [MOVES["lines"][0], MOVES["lines"][2]])

    def test_apply_runs_the_tool_then_verifies_with_a_dry_run(self):
        vault = make_vault(self)
        tool = Tool()
        with stubbed(tool):
            (item,) = ms.find_config_to_vault(vault)
            done = item.apply(None)
            self.assertEqual(ms.find_config_to_vault(vault), [])
        self.assertEqual(done, [MOVES["lines"][0], MOVES["lines"][2],
                                MOVES["lines"][1], MOVES["lines"][3],
                                *BACKUPS])
        self.assertNotIn("--dry-run", tool.calls[1])
        self.assertIn("--dry-run", tool.calls[2])

    def test_apply_that_leaves_changes_planned_fails(self):
        vault = make_vault(self)
        with stubbed(Tool(stays_pending=True)):
            (item,) = ms.find_config_to_vault(vault)
            with self.assertRaises(StepFailed) as caught:
                item.apply(None)
        self.assertIn("left changes planned", str(caught.exception))

    def test_nothing_to_move_plans_nothing(self):
        with stubbed(Tool(pending=False)):
            self.assertEqual(ms.find_config_to_vault(make_vault(self)), [])

    def test_a_vault_that_does_not_publish_never_runs_node(self):
        tool = Tool()
        with stubbed(tool):
            self.assertEqual(
                ms.find_config_to_vault(make_vault(self, publish=False)), [])
        self.assertEqual(tool.calls, [])

    def test_a_tool_that_cannot_answer_stops_with_its_reason(self):
        with stubbed(Tool(fail="Error: vault file is broken")):
            with self.assertRaises(StepFailed) as caught:
                ms.find_config_to_vault(make_vault(self))
        self.assertIn("vault file is broken", str(caught.exception))

    def test_a_tool_without_lines_is_too_old(self):
        with stubbed(Tool(no_lines=True)):
            with self.assertRaises(StepFailed) as caught:
                ms.find_config_to_vault(make_vault(self))
        self.assertIn(f"older than this migration needs ({ms.NEEDS_PUBLISH})",
                      str(caught.exception))

    def test_unparseable_apply_output_says_files_may_have_changed(self):
        vault = make_vault(self)
        with stubbed(Tool()):
            (item,) = ms.find_config_to_vault(vault)
        with stubbed(Tool(stdout="not json")):
            with self.assertRaises(StepFailed) as caught:
                item.apply(None)
        self.assertIn("may already have been changed", str(caught.exception))
        self.assertIn("vault-config.md.pre-migrate", str(caught.exception))

    def test_the_tools_own_note_lines_decide_what_is_a_note(self):
        plan = dict(MOVES, lines=["move a -> b", "tidy c", "left over d"],
                    noteLines=["left over d"])
        with stubbed(Tool(plan=plan)):
            (item,) = ms.find_config_to_vault(make_vault(self))
        self.assertEqual(item.lines, ["move a -> b", "tidy c"])

    def test_no_site_and_no_node_never_stops(self):
        vault = make_vault(self, site=False)
        with mock.patch.object(ms.shutil, "which", return_value=None), \
                mock.patch.object(vc.shutil, "which", return_value=None):
            self.assertEqual(ms.find_config_to_vault(vault), [])
            self.assertEqual(ms.find_site_repin(vault), [])
            out = io.StringIO()
            with contextlib.redirect_stdout(out), \
                    mock.patch.object(migrate, "plugin_version",
                                      return_value=("1.10.26", "t")), \
                    mock.patch.object(migrate, "CHECKS", ms.SITE_CHECKS[:3]):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
        self.assertIn("stamped 1.10.26", out.getvalue())

    def test_a_vault_past_1_10_24_is_still_offered_the_move(self):
        check = next(c for c in ms.SITE_CHECKS if c.name == "config-to-vault")
        self.assertIsNone(check.release)
        for version in ("1.10.24", "1.10.26"):
            vault = make_vault(self, version=version)
            tool = Tool()
            plans = []
            with stubbed(tool), \
                    mock.patch.object(migrate, "plugin_version",
                                      return_value=("1.10.26", "t")):
                for command in ("plan", "apply", "plan"):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        self.assertEqual(migrate.run_plan(vault, [check])
                                         if command == "plan" else
                                         migrate.run_apply(vault, [], [check]),
                                         0)
                    plans.append(out.getvalue())
            self.assertIn("## Will do", plans[0])
            self.assertIn("config-to-vault\tmove vault.config.json siteTitle",
                          plans[0])
            self.assertIn("config-to-vault\t", plans[1])
            self.assertEqual(plans[2], "vault 1.10.26, plugin 1.10.26\n"
                                       "up to date\n")


class PublishSiteTests(unittest.TestCase):
    def text(self, vault):
        return (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")

    def test_a_site_dir_writes_true(self):
        vault = make_vault(self)
        (item,) = ms.find_publish_site(vault)
        self.assertEqual((item.id, item.group), ("publish-site", WILL))
        self.assertEqual(item.apply(None), ["wrote publish.site: true"])
        self.assertIn("\n  site: true\n", self.text(vault))
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_no_site_dir_writes_false(self):
        vault = make_vault(self, site=False)
        (item,) = ms.find_publish_site(vault)
        item.apply(None)
        self.assertIn("\n  site: false\n", self.text(vault))

    def test_a_switch_already_written_is_left(self):
        vault = make_vault(self, extra="  site: false\n")
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_no_publish_block_gets_nothing(self):
        vault = make_vault(self, publish=False)
        before = self.text(vault)
        self.assertEqual(ms.find_publish_site(vault), [])
        self.assertEqual(self.text(vault), before)


class LeakTests(unittest.TestCase):
    # Row texts as vault_check's gm-leak words them.
    ROWS = ["INFO\t(vault)\tasked the plugin's publish tool",
            "WARNING\tHandouts/Letter.md:8\t'Context' is Keeper material "
            "outside ## GM Notes \u2014 nest it under ## GM Notes (publish "
            "1.11.41+ withholds it; to publish it, rename the heading)",
            "WOULD-FIX\tHandouts/Letter.md\tre-nested 'Context' under ## GM Notes",
            "ERROR\tNPCs/Vane.md\tre-nest refused: an open code block \u2014 "
            "nothing written",
            "WARNING\tNPCs/Crowe.md:30\tKeeper-facing heading 'Keeper "
            "Secret' publishes \u2014 nest it under ## GM Notes or fence it",
            "INFO\tNPCs/Crowe.md:31\tbold label 'Secret' looks Keeper-facing "
            "\u2014 confirm with the GM (not a heading; not auto-movable)",
            "INFO\t_meta/vault-config.md\tgm-leak assumes the default "
            "exclude list: there is no site to ask"]

    def test_would_fix_is_will_do_and_the_rest_needs_a_person(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "check_gm_leak", return_value=self.ROWS):
            items = {i.group: i for i in ms.find_gm_leak(vault)}
        self.assertEqual(items[WILL].lines, [
            "Handouts/Letter.md: re-nest 'Context' under ## GM Notes"])
        self.assertEqual(items[PERSON].lines, [
            "NPCs/Vane.md\tre-nest refused: an open code block \u2014 "
            "nothing written",
            "NPCs/Crowe.md:30\tKeeper-facing heading 'Keeper Secret' "
            "publishes \u2014 nest it under ## GM Notes or fence it"])

    def test_a_pairing_matches_file_and_heading_not_loose_text(self):
        rows = [self.ROWS[2],
                "WARNING\tNPCs/Crowe.md:3\t'Context' is Keeper material "
                "outside ## GM Notes \u2014 nest it",
                "ERROR\tHandouts/Letter.md:9\tbold-wrapped heading 'Context' "
                "defeats the exclude list and publishes \u2014 remove the ** "
                "or move it under ## GM Notes",
                "WARNING\tHandouts/Letter.md:12\tKeeper-facing heading "
                "'Clues' publishes \u2014 nest it"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            items = {i.group: i for i in ms.find_gm_leak(make_vault(self))}
        self.assertEqual([line.split("\t")[0] for line in items[PERSON].lines],
                         ["NPCs/Crowe.md:3", "Handouts/Letter.md:12"])

    def test_an_incomplete_check_is_not_clean(self):
        rows = ["WARNING\t(vault)\texplain did not return the expected JSON",
                "INFO\t(vault)\tthe publish tool could not be consulted (x), "
                "so headings the site withholds on its own, like a handout's "
                "Context, Clues and Prop Notes, were not checked",
                "INFO\t(vault)\tthe publish tool could not be consulted (x), "
                "so every session index body was scanned, including any the "
                "site withholds",
                "INFO\t(vault)\tgm-leak has no site to check: x"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            (item,) = ms.find_gm_leak(make_vault(self))
        self.assertEqual(item.group, PERSON)
        self.assertEqual(len(item.lines), 2)
        self.assertTrue(all(line.startswith("(vault)\tthe check was "
                                            "incomplete: ")
                            for line in item.lines))

    def test_apply_fixes_reports_and_checks_nothing_is_left(self):
        vault = make_vault(self)
        calls = []

        def leak(v, folder, fix=False):
            calls.append(fix)
            if fix:
                return ["FIXED\tHandouts/Letter.md\tre-nested 'Context' "
                        "under ## GM Notes"]
            return self.ROWS[:3] if len(calls) == 1 else []
        with mock.patch.object(ms, "check_gm_leak", leak):
            item = next(i for i in ms.find_gm_leak(vault) if i.group == WILL)
            done = item.apply(None)
        self.assertEqual(calls, [False, True, False])
        self.assertEqual(done[0], "Handouts/Letter.md: re-nested 'Context' "
                                  "under ## GM Notes")
        self.assertIn("no longer publish", done[-1])

    def test_a_fix_that_leaves_work_fails(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "check_gm_leak", return_value=self.ROWS):
            item = next(i for i in ms.find_gm_leak(vault) if i.group == WILL)
            with self.assertRaises(StepFailed):
                item.apply(None)

    def test_a_tool_that_dies_during_the_fix_or_the_recheck_fails(self):
        gone = "ERROR\t(vault)\tgm-leak stopped: the publish tool stopped"
        for dies_at in (1, 2):
            vault = make_vault(self)
            calls = []

            def leak(v, folder, fix=False):
                calls.append(fix)
                if len(calls) == 1:
                    return self.ROWS
                if len(calls) == dies_at + 1:
                    return [gone]
                return ["FIXED\tHandouts/Letter.md\tre-nested 'Context' "
                        "under ## GM Notes"] if fix else []
            with mock.patch.object(ms, "check_gm_leak", leak):
                item = next(i for i in ms.find_gm_leak(vault)
                            if i.group == WILL)
                with self.assertRaises(StepFailed) as caught:
                    item.apply(None)
            self.assertIn("stopped", str(caught.exception))

    def test_a_tool_that_cannot_be_asked_stops(self):
        rows = ["ERROR\t(vault)\tgm-leak cannot ask the site's publish tool"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            with self.assertRaises(StepFailed) as caught:
                ms.find_gm_leak(make_vault(self))
        self.assertIn("cannot ask", str(caught.exception))

    def test_no_site_is_nothing(self):
        rows = ["INFO\t(vault)\tgm-leak has no site to check: publish.site is not on"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            self.assertEqual(ms.find_gm_leak(make_vault(self, site=False)), [])


class PlayedTests(unittest.TestCase):
    def answer(self, published, unclear):
        return vc.ToolAnswer(data={"applicable": True, "dryRun": True,
                                   "published": published, "unclear": unclear})

    def test_reviewed_sessions_are_will_do_and_unclear_are_choices(self):
        vault = make_vault(self)
        asked = []
        state = {"left": True}

        def ask(v, args, vault_only=False):
            asked.append(args)
            if "--dry-run" in args:
                if not state["left"]:
                    return self.answer([], [])
                return self.answer(
                    ["Ch1/S01/Session 01.md"],
                    [{"path": "Ch1/S02/Session 02.md",
                      "reason": "Wrap-Up not reviewed yet",
                      "wrapUp": "Ch1/S02/Wrap.md"},
                     {"path": "Ch1/S03/Session 03.md",
                      "reason": "no Wrap-Up", "wrapUp": None}])
            state["left"] = False
            return vc.ToolAnswer(data={"applicable": True, "published": []})
        with mock.patch.object(ms, "ask_publish_tool", ask):
            items = {i.id: i for i in ms.find_publish_played(vault)}
            self.assertEqual(items["publish-played"].group, WILL)
            self.assertEqual(items["publish-played"].lines,
                             ["register Ch1/S01/Session 01.md as published"])
            items["publish-played"].apply(None)
            items["played:Ch1/S02/Session 02.md"].apply(None)
            items["played:Ch1/S03/Session 03.md"].apply(None)
        self.assertEqual(asked[1], ["manifest", "publish-played"])
        self.assertEqual(asked[3], ["manifest", "publish-played", "--session",
                                    "Ch1/S02/Session 02.md",
                                    "--include-unreviewed"])
        self.assertEqual(asked[5], ["manifest", "publish-played", "--session",
                                    "Ch1/S03/Session 03.md", "--publish-body"])
        self.assertIn("Wrap-Up not reviewed yet",
                      items["played:Ch1/S02/Session 02.md"].lines[0])

    def test_a_registration_the_tool_does_not_keep_fails(self):
        vault = make_vault(self)
        same = self.answer(["Ch1/S01/Session 01.md"],
                           [{"path": "Ch1/S02/Session 02.md",
                             "reason": "r", "wrapUp": None}])
        with mock.patch.object(ms, "ask_publish_tool", return_value=same):
            items = {i.id: i for i in ms.find_publish_played(vault)}
            for item in items.values():
                with self.assertRaises(StepFailed):
                    item.apply(None)

    def test_not_applicable_or_no_site_is_nothing(self):
        vault = make_vault(self)
        for answer in (vc.ToolAnswer(),
                       vc.ToolAnswer(data={"applicable": False})):
            with mock.patch.object(ms, "ask_publish_tool",
                                   return_value=answer):
                self.assertEqual(ms.find_publish_played(vault), [])

    def test_a_tool_that_cannot_answer_stops(self):
        with mock.patch.object(ms, "ask_publish_tool",
                               return_value=vc.ToolAnswer(why="node is not on PATH")):
            with self.assertRaises(StepFailed):
                ms.find_publish_played(make_vault(self))


class PersonRowTests(unittest.TestCase):
    def test_session_recaps_in_index_bodies(self):
        rows = ["WARNING\tCh1/S01/Session 01.md\tnot in Publishing",
                "INFO\tCh1/S02/Session 02.md:9\tsession index body has 4 "
                "line(s) outside a gm-only fence \u2014 the site withholds it"]
        with mock.patch.object(ms, "check_sessions", return_value=rows):
            (item,) = ms.find_session_recaps(make_vault(self))
        self.assertEqual(item.group, PERSON)
        self.assertEqual(len(item.lines), 1)
        self.assertTrue(item.lines[0].startswith("Ch1/S02/Session 02.md:9\t"))

    def test_notes_the_build_cannot_parse(self):
        rows = ["ERROR\tNPCs/A.md\tthe site's build cannot parse this "
                "frontmatter (duplicated mapping key) and skips the note",
                "ERROR\tNPCs/B.md\tmissing required field: name"]
        with mock.patch.object(ms, "check_frontmatter", return_value=rows):
            (item,) = ms.find_unparseable(make_vault(self))
        self.assertEqual([line.split("\t")[0] for line in item.lines],
                         ["NPCs/A.md"])

    def test_a_postbuild_script_is_named(self):
        vault = make_vault(self)
        site = site_of(vault)
        (site / "package.json").write_text(json.dumps(
            {"scripts": {"postbuild": "node add-toggle.js"}}), encoding="utf-8")
        (item,) = ms.find_postbuild(vault)
        self.assertEqual(item.group, PERSON)
        self.assertIn("node add-toggle.js", item.lines[0])
        self.assertTrue(item.lines[0].startswith(f"{site / 'package.json'}\t"))
        (site / "package.json").write_text("{}", encoding="utf-8")
        self.assertEqual(ms.find_postbuild(vault), [])
        self.assertEqual(ms.find_postbuild(make_vault(self, site=False)), [])


class SheetSourceTests(unittest.TestCase):
    PC = '---\nname: "Ada"\ntype: pc\n---\n\n## Stat Sheet\n\nTBD\n'

    def make_pc(self):
        vault = make_vault(self)
        (vault / "PCs").mkdir()
        pc = vault / "PCs" / "Ada.md"
        pc.write_text(self.PC, encoding="utf-8")
        return vault, pc

    def test_a_pc_with_no_sheet_is_a_choice_that_writes_the_answer(self):
        vault, pc = self.make_pc()
        # The shapes vault_check's pc-body emits; the retired-fields row
        # names the heading too but is not about a missing sheet.
        rows = ["WARNING\tPCs/Ada.md:6\t## Stat Sheet holds no stats; fill it "
                "in, or set sheet_source to where the sheet is kept",
                "WARNING\tPCs/Ada.md\tfrontmatter field(s) str are no longer "
                "read for the character sheet \u2014 move the values into the "
                "note's ## Stat Sheet sections",
                "WARNING\tPCs/Ada.md:9\tCurrent Status is an H3 \u2014 it must "
                "be an H2 outside the protected sections",
                "WARNING\tPCs/Bea.md\tno published ## Stat Sheet section "
                "\u2014 the PC's page has no character sheet; fill one in, or "
                "set sheet_source to where the sheet is kept"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            items = ms.find_sheet_source(vault)
        self.assertEqual([i.id for i in items],
                         ["sheet-source:PCs/Ada.md", "sheet-source:PCs/Bea.md"])
        item = items[0]
        self.assertEqual(item.wants, "where the sheet is kept")
        item.apply("paper, with the player")
        self.assertIn('sheet_source: "paper, with the player"\n',
                      pc.read_text(encoding="utf-8"))

    def test_a_tool_that_cannot_be_asked_stops(self):
        vault, _pc = self.make_pc()
        rows = ["ERROR\t(vault)\tpc-body stopped: the publish tool stopped "
                "answering (x)"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            with self.assertRaises(StepFailed):
                ms.find_sheet_source(vault)

    def test_the_check_asks_for_a_value(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "sheet-source"]
        self.assertEqual(check.choices, ("sheet-source:=",))

    @unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                         or (shutil.which("node") and (
                             vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                         "node and the publish tool's node_modules are needed")
    def test_a_real_tbd_sheet_is_found_and_written(self):
        vault, pc = self.make_pc()
        (item,) = ms.find_sheet_source(vault)
        self.assertEqual(item.id, "sheet-source:PCs/Ada.md")
        self.assertIn("holds no stats", item.lines[0])
        item.apply("on paper")
        self.assertIn('sheet_source: "on paper"', pc.read_text(encoding="utf-8"))
        self.assertEqual(ms.find_sheet_source(vault), [])


class ThemeChoiceTests(unittest.TestCase):
    def ask(self, facts, calls):
        def fake(vault, args, vault_only=False):
            calls.append(args)
            if "--set" in args:
                return vc.ToolAnswer(data={"written": [args[2].split("=")[0]]})
            return vc.ToolAnswer(data=facts)
        return fake

    def test_default_mode_is_offered_while_unset_and_writes_the_answer(self):
        vault = make_vault(self)
        calls = []
        facts = {"defaultModeSet": False, "fontSource": None, "googleFonts": []}
        with mock.patch.object(ms, "ask_publish_tool", self.ask(facts, calls)):
            (item,) = ms.find_default_mode(vault)
            self.assertEqual((item.id, item.wants),
                             ("default-mode", "dark or light"))
            self.assertEqual(item.apply("dark"),
                             ["wrote publish.theme.default_mode: dark"])
            with self.assertRaises(StepFailed):
                item.apply("purple")
        self.assertEqual(calls[1], ["vault-setting", "--set",
                                    'theme.default_mode="dark"'])

    def test_default_mode_already_set_is_not_offered(self):
        facts = {"defaultModeSet": True, "fontSource": None, "googleFonts": []}
        with mock.patch.object(ms, "ask_publish_tool", self.ask(facts, [])):
            self.assertEqual(ms.find_default_mode(make_vault(self)), [])

    def test_google_fonts_offer_self_hosting(self):
        vault = make_vault(self)
        calls = []
        facts = {"defaultModeSet": True, "fontSource": None,
                 "googleFonts": ["Cinzel", "Rajdhani"]}
        with mock.patch.object(ms, "ask_publish_tool", self.ask(facts, calls)):
            (item,) = ms.find_fonts(vault)
            self.assertEqual(item.id, "fonts-self-host")
            self.assertIn("Cinzel, Rajdhani", item.lines[0])
            item.apply(None)
        self.assertEqual(calls[1], ["vault-setting", "--set",
                                    'theme.fonts.source="self-host"'])

    def test_no_google_fonts_or_no_site_offers_nothing(self):
        facts = {"defaultModeSet": True, "fontSource": "local", "googleFonts": []}
        calls = []
        with mock.patch.object(ms, "ask_publish_tool", self.ask(facts, calls)):
            self.assertEqual(ms.find_fonts(make_vault(self)), [])
            calls.clear()
            self.assertEqual(ms.find_fonts(make_vault(self, site=False)), [])
            self.assertEqual(ms.find_default_mode(make_vault(self, site=False)), [])
        self.assertEqual(calls, [])

    def test_a_tool_too_old_to_answer_stops(self):
        with mock.patch.object(ms, "ask_publish_tool", return_value=vc.ToolAnswer(
                why="vault-setting exited 1: Error: Unknown command")):
            with self.assertRaises(StepFailed):
                ms.find_fonts(make_vault(self))

    def test_the_default_mode_choice_needs_a_value(self):
        check = next(c for c in ms.SITE_CHECKS if c.name == "default-mode")
        self.assertEqual(check.choices, ("default-mode=",))
        self.assertEqual(
            [c.name for c in ms.SITE_CHECKS[:5]],
            [ms.REPIN, "config-to-vault", "publish-site", "default-mode",
             "fonts-self-host"])


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class VaultSettingEndToEndTests(unittest.TestCase):
    def test_the_real_command_reads_sets_and_reads_again(self):
        vault = tmp(self, "vs-e2e-vault-")
        (vault / "_meta").mkdir()
        (vault / "_meta" / "vault-config.md").write_text(
            "---\ntype: meta\npublish:\n  mode: player\n---\n",
            encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        before = vc.ask_publish_tool(vault, ["vault-setting"])
        self.assertIsNone(before.why)
        self.assertIs(before.data["defaultModeSet"], False)
        done = vc.ask_publish_tool(
            vault, ["vault-setting", "--set", 'theme.default_mode="dark"'])
        self.assertEqual(done.data, {"written": ["theme.default_mode"]})
        after = vc.ask_publish_tool(vault, ["vault-setting"])
        self.assertIs(after.data["defaultModeSet"], True)


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class MigrateEndToEndTests(unittest.TestCase):
    def test_legacy_site_migrates_and_frontmatter_stays_clean(self):
        vault = tmp(self, "mig-e2e-vault-")
        site = tmp(self, "mig-e2e-site-")
        (vault / "_meta").mkdir()
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ncanon_status: AUTHORITATIVE\n---\n\n# Overview\n", encoding="utf-8")
        (vault / "_meta" / "vault-config.md").write_text(
            f'---\ntype: meta\ngm_apprentice_version: "1.10.23"\npublish:\n  mode: player\n  site_dir: {site}\n---\n',
            encoding="utf-8")
        (site / "vault.config.json").write_text(json.dumps({
            "siteTitle": "Legacy", "vaultPath": str(vault),
            "outputDir": "./docs", "excludeDirs": ["_meta"],
            "backend": {"inbox": True}}), encoding="utf-8")
        out = io.StringIO()
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)), \
                contextlib.redirect_stdout(out):
            self.assertEqual(migrate.main([str(vault), "apply"]), 0)
            self.assertIn("config-to-vault\tmove", out.getvalue())
            text = (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")
            self.assertIn("site_title", text)
            self.assertNotIn("siteTitle", (site / "vault.config.json").read_text())
            again = io.StringIO()
            with contextlib.redirect_stdout(again):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
        self.assertIn("already at", again.getvalue())
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_check.py"), str(vault),
             "frontmatter"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("# count: 0", proc.stdout)

    def vault_at(self, version, site_file):
        vault = tmp(self, "mig-e2e-vault-")
        (vault / "_meta").mkdir()
        site_dir = ""
        if site_file is not None:
            site = tmp(self, "mig-e2e-site-")
            site_file.setdefault("vaultPath", str(vault))
            (site / "vault.config.json").write_text(json.dumps(site_file),
                                                    encoding="utf-8")
            site_dir = f"  site_dir: {site}\n"
        (vault / "_meta" / "vault-config.md").write_text(
            f'---\ntype: meta\ngm_apprentice_version: "{version}"\n'
            f"publish:\n  mode: player\n{site_dir}---\n", encoding="utf-8")
        return vault

    def test_settings_left_after_1_10_24_are_still_moved(self):
        vault = self.vault_at("1.10.24", {"siteTitle": "Legacy",
                                          "outputDir": "./docs"})
        plugin = ("1.10.24", "t")
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)), \
                mock.patch.object(migrate, "plugin_version",
                                  return_value=plugin):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(migrate.main([str(vault), "plan"]), 0)
            self.assertIn("config-to-vault\tmove", out.getvalue())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
            self.assertEqual(ms.find_config_to_vault(vault), [])
        self.assertIn("site_title", (vault / "_meta" / "vault-config.md")
                      .read_text(encoding="utf-8"))

    def test_deployment_keys_only_or_no_site_offers_no_move(self):
        for site_file in ({"outputDir": "./docs"}, None):
            vault = self.vault_at("1.10.25", site_file)
            self.assertEqual(ms.find_config_to_vault(vault), [], site_file)


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class LeakEndToEndTests(unittest.TestCase):
    def test_a_handouts_context_is_planned_once_and_moved(self):
        vault = tmp(self, "mig-leak-vault-")
        # The real check asks the repo's publish tool (no mock), through a
        # site folder with it installed.
        vc.use_publish_tool(vc.PUBLISH_TOOL)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\n---\n", encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        note = vault / "Letter.md"
        note.write_text("---\ntype: document\n---\n\n# The Letter\n\n"
                        "## Content\n\n> Dear Sir.\n\n## Context\n\n"
                        "Why it was written.\n", encoding="utf-8")
        items = {i.group: i for i in ms.find_gm_leak(vault)}
        self.assertEqual(items[WILL].lines, [
            "Letter.md: re-nest 'Context' under ## GM Notes"])
        self.assertNotIn(PERSON, items)
        done = items[WILL].apply(None)
        self.assertIn("Letter.md: re-nested 'Context' under "
                      "## GM Notes", done)
        text = note.read_text(encoding="utf-8")
        self.assertIn("## GM Notes", text)
        self.assertEqual(ms.find_gm_leak(vault), [])


if __name__ == "__main__":
    unittest.main()

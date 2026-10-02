"""migrate_site.py: the repin, config-to-vault and publish.site checks. The
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

import migrate  # noqa: E402
import migrate_core  # noqa: E402
import migrate_site as ms  # noqa: E402
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


if __name__ == "__main__":
    unittest.main()

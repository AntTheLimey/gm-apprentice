"""migrate.py: the migration runner and its config-to-vault step. The
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
import vault_check as vc  # noqa: E402

MOVES = {"applicable": True,
         "moves": [{"from": "vault.config.json siteTitle",
                    "to": "publish.site_title", "value": "T"}],
         "merges": [], "switches": [], "conflicts": [], "notes": [],
         "vaultSet": {}, "vaultRemove": [], "siteRemove": []}
NOTHING = dict(MOVES, applicable=False, moves=[], reason="nothing to migrate")


def tmp(case, prefix):
    d = Path(tempfile.mkdtemp(prefix=prefix))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    return d


def make_vault(case, publish=True, site=True):
    vault = tmp(case, "mig-vault-")
    (vault / "_meta").mkdir()
    if publish:
        site_line = ""
        if site:
            site_dir = tmp(case, "mig-site-")
            (site_dir / "vault.config.json").write_text("{}", encoding="utf-8")
            site_line = f"  site_dir: {site_dir}\n"
        (vault / "_meta" / "vault-config.md").write_text(
            f"---\npublish:\n  mode: player\n{site_line}---\n", encoding="utf-8")
    return vault


class Tool:
    """A stand-in for subprocess.run: answers `migrate-config` with the
    pending plan until it has been run for real, then with nothing."""

    def __init__(self, pending=True, fail=None, stays_pending=False):
        self.pending, self.fail, self.stays = pending, fail, stays_pending
        self.calls = []

    def __call__(self, cmd, **kwargs):
        self.calls.append(cmd)
        if self.fail:
            return subprocess.CompletedProcess(cmd, 1, "", self.fail + "\n")
        plan = MOVES if self.pending else NOTHING
        if "--dry-run" not in cmd and not self.stays:
            self.pending = False
        return subprocess.CompletedProcess(cmd, 0, json.dumps(plan), "")


def run_cli(args, tool):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(vc.shutil, "which", return_value="/usr/bin/node"), \
            mock.patch.object(vc.subprocess, "run", tool), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = migrate.main(args)
    return code, out.getvalue(), err.getvalue()


class MigrateTests(unittest.TestCase):
    def test_status_reports_pending(self):
        vault = make_vault(self)
        tool = Tool()
        code, out, _ = run_cli([str(vault), "--status"], tool)
        self.assertEqual(code, 0)
        self.assertIn("## 1.10.24 config-to-vault", out)
        self.assertIn("pending", out)
        self.assertTrue(all("--dry-run" in c for c in tool.calls))

    def test_dry_run_lists_each_move_and_only_dry_runs(self):
        vault = make_vault(self)
        tool = Tool()
        code, out, _ = run_cli([str(vault), "--dry-run"], tool)
        self.assertEqual(code, 0)
        self.assertIn("# count: 1", out)
        self.assertIn("move vault.config.json siteTitle -> publish.site_title", out)
        self.assertEqual(len(tool.calls), 1)
        self.assertIn("--dry-run", tool.calls[0])

    def test_apply_runs_the_tool_then_verifies_with_a_dry_run(self):
        vault = make_vault(self)
        tool = Tool()
        code, out, _ = run_cli([str(vault)], tool)
        self.assertEqual(code, 0)
        self.assertIn("move vault.config.json siteTitle", out)
        self.assertEqual(len(tool.calls), 2)
        self.assertNotIn("--dry-run", tool.calls[0])
        self.assertIn("migrate-config", tool.calls[0])
        self.assertIn("--dry-run", tool.calls[1])

    def test_apply_that_leaves_changes_planned_fails(self):
        vault = make_vault(self)
        code, out, err = run_cli([str(vault)], Tool(stays_pending=True))
        self.assertEqual(code, 1)
        self.assertIn("left changes planned", err)

    def test_second_apply_has_nothing_to_do(self):
        vault = make_vault(self)
        tool = Tool()
        self.assertEqual(run_cli([str(vault)], tool)[0], 0)
        code, out, _ = run_cli([str(vault)], tool)
        self.assertEqual(code, 0)
        self.assertIn("nothing to do", out)

    def test_tool_failure_exits_1_with_its_reason(self):
        vault = make_vault(self)
        code, out, err = run_cli([str(vault)], Tool(fail="Error: vault file is broken"))
        self.assertEqual(code, 1)
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertIn("Error: vault file is broken", err)
        self.assertNotIn("update-pin", err)

    def test_unknown_command_points_at_update_pin(self):
        vault = make_vault(self)
        code, _, err = run_cli([str(vault)], Tool(fail="Unknown command: migrate-config"))
        self.assertEqual(code, 1)
        self.assertIn("run update-pin, then migrate.py again", err)

    def test_no_node_points_at_update_pin(self):
        vault = make_vault(self)
        err = io.StringIO()
        with mock.patch.object(vc.shutil, "which", return_value=None), \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(err):
            code = migrate.main([str(vault)])
        self.assertEqual(code, 1)
        self.assertIn("node is not on PATH", err.getvalue())
        self.assertIn("run update-pin, then migrate.py again", err.getvalue())

    def test_vault_without_a_publish_block_never_runs_node(self):
        vault = make_vault(self, publish=False)
        tool = Tool()
        code, out, _ = run_cli([str(vault)], tool)
        self.assertEqual(code, 0)
        self.assertIn("this vault does not publish", out)
        self.assertEqual(tool.calls, [])

    def test_publish_block_without_a_site_still_reaches_the_tool(self):
        vault = make_vault(self, site=False)
        tool = Tool()
        code, out, _ = run_cli([str(vault), "--dry-run"], tool)
        self.assertEqual(code, 0)
        self.assertEqual(len(tool.calls), 1)
        self.assertNotIn("--config", tool.calls[0])
        self.assertIn("--vault", tool.calls[0])

    def test_bad_arguments_exit_2(self):
        vault = make_vault(self)
        self.assertEqual(run_cli([str(vault), "--status", "--dry-run"], Tool())[0], 2)
        self.assertEqual(run_cli([str(vault / "nope")], Tool())[0], 2)

    def fake_steps(self, log, fail_at=None):
        def step(version, name):
            def go(vault):
                log.append(name)
                if name == fail_at:
                    return migrate.StepPlan(False, [], error="broke")
                return migrate.StepPlan(True, [f"did {name}"])
            return migrate.Step(version, name, go, go)
        return [step("1.10.30", "third"), step("1.10.9", "first"),
                step("1.10.24", "second")]

    def test_steps_run_in_version_order(self):
        log = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = migrate.run(Path("."), "apply", steps=self.fake_steps(log))
        self.assertEqual(code, 0)
        self.assertEqual(log, ["first", "second", "third"])

    def test_failing_step_stops_the_run(self):
        log = []
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(err):
            code = migrate.run(Path("."), "apply",
                               steps=self.fake_steps(log, fail_at="second"))
        self.assertEqual(code, 1)
        self.assertEqual(log, ["first", "second"])
        self.assertIn("1.10.24 second: broke", err.getvalue())


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
            f"---\ntype: meta\npublish:\n  mode: player\n  site_dir: {site}\n---\n",
            encoding="utf-8")
        (site / "vault.config.json").write_text(json.dumps({
            "siteTitle": "Legacy", "vaultPath": str(vault),
            "outputDir": "./docs", "excludeDirs": ["_meta"],
            "backend": {"inbox": True}}), encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(migrate.run(vault, "apply"), 0)
        self.assertIn("publish.site_title", out.getvalue())
        text = (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")
        self.assertIn("site_title", text)
        self.assertNotIn("siteTitle", (site / "vault.config.json").read_text())
        again = io.StringIO()
        with contextlib.redirect_stdout(again):
            self.assertEqual(migrate.run(vault, "apply"), 0)
        self.assertIn("nothing to do", again.getvalue())
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_check.py"), str(vault),
             "frontmatter"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("# count: 0", proc.stdout)


if __name__ == "__main__":
    unittest.main()

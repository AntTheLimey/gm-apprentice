#!/usr/bin/env python3
"""`vault_check.py relationships` asks the publish tool (`relationships
check --json`). A tool that cannot answer is one ERROR row saying why,
never an empty, clean-looking result (Review Focus 5). Scoping flags
reach the tool.

Run: python3 tests/test_vault_check_relationships_tool.py
"""

import contextlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "relationship-predicates"
HAS_NODE = shutil.which("node") is not None


class FakeNode(unittest.TestCase):
    def fake_node(self, done):
        """Node found, the tool run answered with `done`."""
        stack = contextlib.ExitStack()
        stack.enter_context(
            mock.patch.object(vc.shutil, "which", return_value="/fake/node"))
        run = stack.enter_context(
            mock.patch.object(vc.subprocess, "run", return_value=done))
        stack.enter_context(
            mock.patch.object(vc, "PUBLISH_TOOL", Path(__file__)))
        self.addCleanup(stack.close)
        return _Handle(run, stack)


class _Handle:
    def __init__(self, run, stack):
        self.run, self.stack = run, stack

    def __enter__(self):
        return self.run

    def __exit__(self, *exc):
        self.stack.close()


class ToolFailureTests(FakeNode):
    def assert_one_error(self, rows, *words):
        self.assertEqual(len(rows), 1, rows)
        level, where, why = rows[0].split("\t")
        self.assertEqual((level, where), ("ERROR", "(vault)"))
        for word in words:
            self.assertIn(word, why)

    def test_no_node_is_one_error_row(self):
        with mock.patch.object(vc.shutil, "which", return_value=None):
            rows = vc.check_relationships(FIXTURE)
        self.assert_one_error(rows, "node is not on PATH")

    def test_missing_tool_is_one_error_row(self):
        with mock.patch.object(vc, "PUBLISH_TOOL", Path("/no/such/gm-publish.js")):
            rows = vc.check_relationships(FIXTURE)
        self.assert_one_error(rows, "publish tool is not at")

    def test_non_zero_exit_is_one_error_row(self):
        done = subprocess.CompletedProcess([], 1, "", "Error: boom\n")
        with self.fake_node(done):
            rows = vc.check_relationships(FIXTURE)
        self.assert_one_error(rows, "boom")

    def test_bad_json_is_one_error_row(self):
        done = subprocess.CompletedProcess([], 0, "not json", "")
        with self.fake_node(done):
            rows = vc.check_relationships(FIXTURE)
        self.assert_one_error(rows, "JSON")

    def test_json_that_is_not_a_list_is_one_error_row(self):
        done = subprocess.CompletedProcess([], 0, '{"a": 1}', "")
        with self.fake_node(done):
            rows = vc.check_relationships(FIXTURE)
        self.assert_one_error(rows, "JSON")

    def test_cli_prints_the_error_row_under_its_count(self):
        env_path = tempfile.mkdtemp()
        try:
            proc = subprocess.run(
                [sys.executable, str(SCRIPTS / "vault_check.py"), str(FIXTURE),
                 "relationships"],
                capture_output=True, text=True,
                env={"PATH": env_path, "SYSTEMROOT": ""})
        finally:
            shutil.rmtree(env_path)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 1", proc.stdout)
        self.assertIn("ERROR\t(vault)\t", proc.stdout)
        self.assertIn("node is not on PATH", proc.stdout)


class ScopeReachesToolTests(FakeNode):
    def args_sent(self, **kw):
        done = subprocess.CompletedProcess([], 0, "[]", "")
        with self.fake_node(done) as run:
            self.assertEqual(vc.check_relationships(FIXTURE, **kw), [])
        return run.call_args.args[0]

    def test_unscoped_asks_check_json_for_the_vault(self):
        sent = self.args_sent()
        i = sent.index("relationships")
        self.assertEqual(sent[i:i + 2], ["relationships", "check"])
        self.assertIn("--json", sent)
        self.assertEqual(sent[sent.index("--vault") + 1], str(FIXTURE))
        for flag in ("--folder", "--file", "--newer-than"):
            self.assertNotIn(flag, sent)

    def test_scope_flags_are_passed_through(self):
        sent = self.args_sent(folder="NPCs", files=["A.md", "B.md"],
                              newer_than="Wrap-Up.md")
        self.assertEqual(sent[sent.index("--folder") + 1], "NPCs")
        self.assertEqual([sent[i + 1] for i, a in enumerate(sent)
                          if a == "--file"], ["A.md", "B.md"])
        self.assertEqual(sent[sent.index("--newer-than") + 1], "Wrap-Up.md")

    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node")
    def test_real_tool_scoped_to_one_file(self):
        rows = vc.check_relationships(FIXTURE, files=["Mobrpg Sync.md"])
        self.assertTrue(rows)
        self.assertTrue(all("\tMobrpg Sync.md:" in r for r in rows), rows)

    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node")
    def test_rows_are_the_tools_rows_in_tsv(self):
        rows = vc.check_relationships(FIXTURE)
        self.assertIn(
            "ERROR\tOff Vocabulary NPC.md:12\toff-vocabulary relationship "
            "type 'commands_at' — did you mean commands? "
            "(map it via shared/relationship-normalization.md)", rows)

    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node")
    def test_a_note_whose_frontmatter_does_not_read_is_one_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            (vault / "Broken.md").write_text(
                '---\ntype: npc\nrelationships:\n  - target: "[[X]]\n'
                '    type: employed_by\n---\n', encoding="utf-8")
            (vault / "Fine.md").write_text(
                '---\ntype: npc\nrelationships:\n  - target: "[[Broken]]"\n'
                '    type: employed_by\n---\n', encoding="utf-8")
            scoped = vc.check_relationships(vault, files=["Broken.md"])
            self.assertEqual(len(scoped), 1, scoped)
            self.assertTrue(scoped[0].startswith(
                "ERROR\tBroken.md:1\tits frontmatter does not read"), scoped)
            whole = vc.check_relationships(vault)
            self.assertEqual(
                len([r for r in whole if "\tBroken.md:" in r]), 1, whole)
            self.assertTrue(any("\tFine.md:" in r for r in whole), whole)
            other = vc.check_relationships(vault, files=["Fine.md"])
            self.assertFalse(any("Broken.md" in r for r in other), other)


if __name__ == "__main__":
    unittest.main()

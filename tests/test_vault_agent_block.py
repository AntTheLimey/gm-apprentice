"""agent_block.py: the plugin-managed block in a vault's CLAUDE.md and
AGENTS.md, written by the update (as bookkeeping) and by the scaffold."""

import dataclasses
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import agent_block  # noqa: E402
import migrate  # noqa: E402
import migrate_vault as mv  # noqa: E402
import update  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from migrate_core import PERSON  # noqa: E402
from test_migrate import PLUGIN, make_vault  # noqa: E402

BEGIN = ("<!-- BEGIN gm-apprentice (managed by the plugin; edits here are "
         "replaced) -->")
END = "<!-- END gm-apprentice -->"


def folder(case):
    root = Path(tempfile.mkdtemp(prefix="agent-block-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    return root


def read(path):
    return path.read_bytes().decode("utf-8")


class EnsureBlockTests(unittest.TestCase):
    def test_block_is_added_once_and_refreshed_in_place(self):
        vault = folder(self)
        (vault / "CLAUDE.md").write_text("# My vault\n", encoding="utf-8")
        lines = agent_block.ensure_block(vault)
        self.assertEqual(len(lines), 1)
        self.assertIn("CLAUDE.md", lines[0])
        text = read(vault / "CLAUDE.md")
        self.assertTrue(text.startswith("# My vault\n\n" + BEGIN + "\n"))
        self.assertTrue(text.endswith(END + "\n"))
        self.assertEqual(text.count(BEGIN), 1)
        self.assertEqual(agent_block.ensure_block(vault), [])
        self.assertEqual(read(vault / "CLAUDE.md"), text)
        # An old block (other words between the markers) is replaced in place.
        stale = text.replace("MISMATCH", "WHATEVER")
        (vault / "CLAUDE.md").write_bytes(stale.encode("utf-8"))
        self.assertEqual(len(agent_block.ensure_block(vault)), 1)
        self.assertEqual(read(vault / "CLAUDE.md"), text)

    def test_the_block_is_short_and_names_both_commands(self):
        block = agent_block.block()
        self.assertLess(len(block.encode("utf-8")), 500)
        self.assertTrue(block.startswith(BEGIN))
        self.assertTrue(block.endswith(END))
        self.assertIn('run `gma update "<this vault>"`, where `gma` is '
                      '`python3 "<shared>/scripts/gma.py"` in the '
                      "gm-apprentice skills' `shared` folder", block)
        self.assertIn("`gma workaround add`", block)
        self.assertIn("workaround add", block)
        self.assertIn("filing-plugin-issues.md", block)
        # An npx skills install has no skills/shared/ path; name the folder.
        self.assertNotIn("skills/shared/", block)
        self.assertNotIn("plugin gap", block)
        self.assertNotIn("${CLAUDE_PLUGIN_ROOT}", block)

    def test_text_outside_the_markers_is_untouched(self):
        vault = folder(self)
        before = "# Rules\r\n\r\nKeep the GM's secrets.\r\n\r\n"
        after = "\r\n## More\r\nStays.\r\n"
        old = f"{BEGIN}\r\nold words\r\n{END}"
        (vault / "CLAUDE.md").write_bytes((before + old + after).encode())
        agent_block.ensure_block(vault)
        text = read(vault / "CLAUDE.md")
        self.assertTrue(text.startswith(before + BEGIN + "\r\n"))
        self.assertTrue(text.endswith(END + after))
        self.assertNotIn("old words", text)
        middle = text[len(before):len(text) - len(after)]
        self.assertNotIn("\n", middle.replace("\r\n", ""))

    def test_creates_claude_md_when_neither_exists(self):
        vault = folder(self)
        lines = agent_block.ensure_block(vault)
        self.assertEqual(len(lines), 1)
        self.assertEqual(read(vault / "CLAUDE.md"), agent_block.block() + "\n")
        self.assertFalse((vault / "AGENTS.md").exists())

    def test_agents_md_gets_the_block_when_present(self):
        vault = folder(self)
        (vault / "AGENTS.md").write_text("agent notes\n", encoding="utf-8")
        lines = agent_block.ensure_block(vault)
        self.assertEqual(len(lines), 1)
        self.assertIn("AGENTS.md", lines[0])
        self.assertIn(BEGIN, read(vault / "AGENTS.md"))
        self.assertFalse((vault / "CLAUDE.md").exists())
        (vault / "CLAUDE.md").write_text("mine\n", encoding="utf-8")
        self.assertEqual(len(agent_block.ensure_block(vault)), 1)
        self.assertIn(BEGIN, read(vault / "CLAUDE.md"))

    def test_a_begin_with_no_end_is_left_and_said(self):
        vault = folder(self)
        text = f"# Mine\n{BEGIN}\nsomething the GM wrote after it\n"
        (vault / "CLAUDE.md").write_text(text, encoding="utf-8")
        lines = agent_block.ensure_block(vault)
        self.assertEqual(read(vault / "CLAUDE.md"), text)
        self.assertEqual(len(lines), 1)
        self.assertIn("CLAUDE.md", lines[0])
        self.assertIn(END, lines[0])
        self.assertIn("by hand", lines[0])


    def test_a_bom_before_a_leading_block_is_kept_and_the_block_not_doubled(self):
        vault = folder(self)
        text = "\ufeff" + agent_block.block().replace("MISMATCH", "OLD") + "\n"
        (vault / "CLAUDE.md").write_bytes(text.encode("utf-8"))
        agent_block.ensure_block(vault)
        got = read(vault / "CLAUDE.md")
        self.assertEqual(got, "\ufeff" + agent_block.block() + "\n")
        self.assertEqual(agent_block.ensure_block(vault), [])

    def test_a_lower_case_claude_md_is_updated_and_no_second_one_made(self):
        vault = folder(self)
        (vault / "claude.md").write_text("mine\n", encoding="utf-8")
        lines = agent_block.ensure_block(vault)
        self.assertEqual(len(lines), 1)
        self.assertIn("claude.md", lines[0])
        self.assertEqual(sorted(os.listdir(vault)), ["claude.md"])
        self.assertIn(BEGIN, read(vault / "claude.md"))

    def test_text_after_the_begin_marker_is_kept_below_the_block(self):
        vault = folder(self)
        (vault / "CLAUDE.md").write_text(
            f"# Top\n{BEGIN} my own note\nold\n{END}\nafter\n", encoding="utf-8")
        agent_block.ensure_block(vault)
        self.assertEqual(read(vault / "CLAUDE.md"),
                         f"# Top\n{agent_block.block()}\nmy own note\nafter\n")
        self.assertEqual(agent_block.ensure_block(vault), [])

    @unittest.skipIf(os.name != "posix" or os.geteuid() == 0,
                     "needs file permissions that bite")
    def test_an_unreadable_claude_md_is_said_not_raised(self):
        vault = folder(self)
        path = vault / "CLAUDE.md"
        path.write_text("mine\n", encoding="utf-8")
        path.chmod(0)
        self.addCleanup(path.chmod, 0o644)
        changes, problems = agent_block.plan(vault)
        self.assertEqual(changes, [])
        self.assertEqual(len(problems), 1)
        self.assertIn("CLAUDE.md could not be read", problems[0])


class NotANoteTests(unittest.TestCase):
    def test_the_root_agent_files_are_not_walked_as_notes(self):
        from vaultlib import vault_files
        vault = folder(self)
        for rel in ("CLAUDE.md", "AGENTS.md", "Sessions/CLAUDE.md"):
            (vault / rel).parent.mkdir(parents=True, exist_ok=True)
            (vault / rel).write_text("x\n", encoding="utf-8")
        self.assertEqual([rel for rel, _ in vault_files(vault)],
                         ["Sessions/CLAUDE.md"])

    def test_the_rule_is_root_only_and_case_blind_like_the_publish_tool(self):
        from vaultlib import is_skipped_path
        for rel in ("CLAUDE.md", "claude.md", "Agents.MD"):
            self.assertTrue(is_skipped_path(rel), rel)
        for rel in ("Notes/CLAUDE.md", "README.md", "Notes/agents.md"):
            self.assertFalse(is_skipped_path(rel), rel)


def the_check():
    (check,) = [c for c in mv.VAULT_CHECKS if c.name == "agent-block"]
    return check


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.home = folder(self)
        patcher = mock.patch.object(migrate, "plugin_version",
                                    return_value=(PLUGIN, "test"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_check_is_bookkeeping_on_every_pass(self):
        check = the_check()
        self.assertIsNone(check.release)
        self.assertEqual(check.kind, "bookkeeping")

    def test_the_update_writes_it_after_the_backup_and_reports_it(self):
        vault = make_vault(self, version=PLUGIN)
        (vault / "CLAUDE.md").write_text("# Mine\n", encoding="utf-8")
        res = update.run(vault, {}, True, checks=[the_check()],
                         home=self.home)
        self.assertEqual(res.exit, 0, res.error)
        self.assertIsNotNone(res.backup)
        self.assertTrue(any("CLAUDE.md" in line for line in res.did), res.did)
        self.assertIn(BEGIN, read(vault / "CLAUDE.md"))
        again = update.run(vault, {}, True, checks=[the_check()],
                           home=self.home)
        self.assertEqual((again.exit, again.did, again.backup), (0, [], None))

    def test_a_missing_end_marker_is_a_read_problem(self):
        vault = make_vault(self, version=PLUGIN)
        text = f"{BEGIN}\nno end\n"
        (vault / "CLAUDE.md").write_text(text, encoding="utf-8")
        items = the_check().find(vault)
        self.assertEqual([i.group for i in items], [PERSON])
        res = update.run(vault, {}, True, checks=[the_check()],
                         home=self.home)
        self.assertEqual(res.exit, 0, res.error)
        self.assertEqual(len(res.read_problems), 1)
        self.assertIn(END, res.read_problems[0])
        self.assertEqual(read(vault / "CLAUDE.md"), text)

    def test_a_block_broken_between_find_and_apply_is_said(self):
        vault = make_vault(self, version=PLUGIN)
        (vault / "CLAUDE.md").write_text("# Mine\n", encoding="utf-8")
        (vault / "AGENTS.md").write_text("# Also\n", encoding="utf-8")
        [item] = the_check().find(vault)
        (vault / "AGENTS.md").write_text(f"{BEGIN}\nno end\n", encoding="utf-8")
        lines = item.apply(None)
        self.assertTrue(any("AGENTS.md" in x and END in x for x in lines), lines)
        self.assertIn(BEGIN, read(vault / "CLAUDE.md"))

    def test_a_newly_broken_file_is_could_not_read_not_done(self):
        vault = make_vault(self, version=PLUGIN)
        (vault / "CLAUDE.md").write_text("# Mine\n", encoding="utf-8")
        (vault / "AGENTS.md").write_text("# Also\n", encoding="utf-8")
        real = the_check().find

        def find_then_break(v):
            items = real(v)
            (v / "AGENTS.md").write_text(f"{BEGIN}\nno end\n", encoding="utf-8")
            return items
        check = dataclasses.replace(the_check(), find=find_then_break)
        res = update.run(vault, {}, True, checks=[check], home=self.home)
        self.assertEqual(res.exit, 0, res.error)
        self.assertEqual(len(res.read_problems), 1, res.read_problems)
        self.assertIn("AGENTS.md", res.read_problems[0])
        self.assertFalse(any("AGENTS.md" in d and END in d for d in res.did))

    def test_a_second_begin_before_the_end_leaves_the_file_alone(self):
        vault = folder(self)
        text = f"{BEGIN}\nold\n\n# Mine\n{BEGIN}\nnew\n{END}\n"
        (vault / "CLAUDE.md").write_text(text, encoding="utf-8")
        changes, problems = agent_block.plan(vault)
        self.assertEqual(changes, [])
        self.assertEqual(len(problems), 1)
        self.assertEqual(read(vault / "CLAUDE.md"), text)

    @unittest.skipIf(os.name != "posix" or os.geteuid() == 0,
                     "needs file permissions that bite")
    def test_an_unreadable_claude_md_is_a_read_problem_in_the_update(self):
        vault = make_vault(self, version=PLUGIN)
        path = vault / "CLAUDE.md"
        path.write_text("# Mine\n", encoding="utf-8")
        path.chmod(0)
        self.addCleanup(path.chmod, 0o644)
        res = update.run(vault, {}, True, checks=[the_check()], home=self.home)
        self.assertEqual(res.exit, 0, res.error)
        self.assertEqual(len(res.read_problems), 1)
        self.assertIn("CLAUDE.md could not be read", res.read_problems[0])
        self.assertIn("Could not read:", update.report(res))


class ScaffoldTests(unittest.TestCase):
    def test_a_new_vault_records_the_sweep_as_done(self):
        vault = folder(self) / "V"
        pieces = vs.missing(vault, "coc-7e", campaign="V", version=PLUGIN)
        (piece,) = [p for p in pieces if p.rel == "_meta/update-record.json"]
        rec = json.loads(piece.text())
        self.assertIsNotNone(rec["swept"])
        self.assertEqual(rec["swept_memory"], "none (a new vault)")
        self.assertEqual(rec["workarounds"], [])

    def test_a_vault_with_notes_keeps_the_sweep_to_do(self):
        vault = folder(self) / "V"
        (vault / "PCs").mkdir(parents=True)
        (vault / "PCs" / "Six.md").write_text("# Six\n", encoding="utf-8")
        pieces = vs.missing(vault, "coc-7e", campaign="V", version=PLUGIN)
        (piece,) = [p for p in pieces if p.rel == "_meta/update-record.json"]
        rec = json.loads(piece.text())
        self.assertIsNone(rec["swept"])
        self.assertIsNone(rec["swept_memory"])

    def test_a_set_up_vault_gets_no_record_from_the_scaffold(self):
        vault = make_vault(self, version=PLUGIN)
        pieces = vs.missing(vault, "coc-7e", campaign="V", version=PLUGIN)
        self.assertFalse(any(p.rel == "_meta/update-record.json" for p in pieces))

    def test_a_new_vault_gets_claude_md_with_the_block(self):
        vault = folder(self) / "V"
        pieces = vs.missing(vault, "coc-7e", campaign="V", version=PLUGIN)
        (piece,) = [p for p in pieces if p.rel == "CLAUDE.md"]
        self.assertEqual(piece.text(), agent_block.block() + "\n")

    def test_a_new_vault_with_its_own_claude_md_has_the_block_merged_in(self):
        vault = folder(self) / "V"
        vault.mkdir()
        (vault / "CLAUDE.md").write_text("# Mine\n", encoding="utf-8")
        pieces = vs.missing(vault, "coc-7e", campaign="V", version=PLUGIN)
        (piece,) = [p for p in pieces if p.rel == "CLAUDE.md"]
        self.assertTrue(piece.merge)
        self.assertTrue(piece.text().startswith("# Mine\n\n" + BEGIN))

    def test_the_skeleton_check_leaves_the_block_to_its_own_check(self):
        vault = make_vault(self, version=PLUGIN)
        rels = [line for item in mv.find_skeleton(vault)
                for line in item.lines]
        self.assertFalse(any("CLAUDE.md" in r for r in rels), rels)


if __name__ == "__main__":
    unittest.main()

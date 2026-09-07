#!/usr/bin/env python3
"""Regression tests for session_context.py --play and --threads.

Covers the Play Brief (a Session Plan reduced to what the table needs)
and the Threads report (per-PC Open-threads age/staleness against
Wrap-Up Unresolved Threads / PC Carry-Forward bullets, plus orphaned
wrap-up bullets that never made it onto a PC sheet).

Run: python3 tests/test_session_context_play.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import session_context as sc  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "slice-b" / "play"
SCRIPT = SCRIPTS / "session_context.py"


def run_cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True, timeout=60)


def load_files(vault):
    return list(sc.vault_files(vault))


class PlayBriefCLITests(unittest.TestCase):
    """`session_context.py VAULT --play`."""

    def test_play_prints_only_brief(self):
        result = run_cli(FIXTURE, "--play")
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        self.assertNotIn("Wrap-Up", out)
        self.assertNotIn("Active PCs", out)
        self.assertNotIn("Campaign Overview", out)
        self.assertIn("===== Play Brief — Session 8 =====", out)
        self.assertIn("### Scene 1: The Dredger's Manifest", out)
        self.assertIn("**Type:** investigation", out)
        self.assertIn("**Objective:**", out)
        self.assertIn("**Setup:**", out)
        self.assertIn("### Scene 2: Bram's Reckoning", out)
        self.assertNotIn("**Behaviours:**", out)
        self.assertNotIn("**Branching:**", out)
        self.assertNotIn("**Complications:**", out)
        self.assertNotIn("Active Threads", out)

    def test_play_session_flag_picks_named_plan(self):
        result = run_cli(FIXTURE, "--play", "--session", "8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Play Brief — Session 8 =====", result.stdout)
        self.assertIn("Session_08_Plan.md", result.stdout)

    def test_play_session_flag_missing_plan(self):
        result = run_cli(FIXTURE, "--play", "--session", "99")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "(no plan for session 99)")

    def test_play_and_threads_are_mutually_exclusive(self):
        result = run_cli(FIXTURE, "--play", "--threads")
        self.assertNotEqual(result.returncode, 0)

    def test_default_mode_is_unaffected(self):
        # #162 regression: adding --play/--threads must not disturb the
        # existing bundle's header or section set.
        result = run_cli(FIXTURE, "--session", "7")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Session Context =====", result.stdout)
        self.assertIn("===== Wrap-Up — Session 7 =====", result.stdout)
        self.assertIn("===== Active PCs =====", result.stdout)
        self.assertIn("===== Campaign Overview =====", result.stdout)
        self.assertNotIn("Play Brief", result.stdout)
        self.assertNotIn("===== Threads =====", result.stdout)


class PlaySessionChapterResolutionTests(unittest.TestCase):
    """M13: `--play --session N` must resolve N's own chapter, not the
    "current" session's — session numbering restarts per chapter, so a
    plan for N filed under a different (non-current) chapter used to be
    unfindable."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp(prefix="session-context-chap-"))
        self.addCleanup(shutil.rmtree, self.vault, ignore_errors=True)
        shutil.copytree(FIXTURE, self.vault, dirs_exist_ok=True)
        # A session 20 (unique number, not present anywhere else) filed
        # under Chapter 3 - Vienna, which is NOT the fixture's "current"
        # chapter (Chapter 4 - Calcutta — see test_play_prints_only_brief,
        # whose default target of 8 resolves there).
        vienna = self.vault / "Chapters" / "Chapter 3 - Vienna" / "Sessions"
        (vienna / "Session 20.md").write_text(
            "---\ntype: session\nsession_number: 20\nstatus: reviewed\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\ndocuments: []\n"
            "---\n\n# Session 20\n", encoding="utf-8")
        (vienna / "Session_20_Plan.md").write_text(
            "---\ntype: session-plan\nsession: 20\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\n---\n\n"
            "# Session 20 Plan\n\n## Session Intent\n\n"
            "M13 regression plan.\n", encoding="utf-8")

    def test_plan_under_non_current_chapter_is_found(self):
        result = run_cli(self.vault, "--play", "--session", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Play Brief — Session 20 =====", result.stdout)
        self.assertIn("Session_20_Plan.md", result.stdout)
        self.assertNotIn("(no plan for session 20)", result.stdout)


class PlayBriefFunctionTests(unittest.TestCase):
    """`play_brief(files, plan_rel, plan_text)` directly."""

    @classmethod
    def setUpClass(cls):
        cls.files = load_files(FIXTURE)
        cls.plan = next(
            (rel, text) for rel, text, fm in cls.files
            if fm.get("type") == "session-plan"
            and sc.parse_session_number(fm.get("session")) == 8)

    def test_sections_in_order_and_reduced(self):
        rel, text = self.plan
        brief = sc.play_brief(self.files, rel, text)
        self.assertTrue(brief.startswith("===== Play Brief — Session 8 ====="))
        self.assertIn(f"(source: {rel})", brief)
        order = ["## Session Intent", "## Planned Scenes",
                 "## NPC Quick Reference", "## World State",
                 "## Contingency Scenes", "## Session End Objectives"]
        positions = [brief.index(h) for h in order]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("## Active Threads", brief)
        self.assertIn("Bram's ledger debt catches up", brief)  # Session Intent verbatim
        self.assertIn("| NPC | Role This Session |", brief)  # NPC table verbatim
        self.assertIn("monsoon season", brief)  # World State verbatim
        self.assertIn("### If the party stalls Bram twice", brief)
        self.assertIn("**Trigger:**", brief)

    def test_absent_sections_report_placeholder(self):
        text = ("---\ntype: session-plan\nsession: 3\n---\n\n"
                "## Session Intent\n\nJust a note.\n")
        brief = sc.play_brief(self.files, "fake.md", text)
        self.assertIn("(no ## Planned Scenes)", brief)
        self.assertIn("(no ## NPC Quick Reference)", brief)
        self.assertIn("(no ## World State)", brief)
        self.assertIn("(no ## Contingency Scenes)", brief)
        self.assertIn("(no ## Session End Objectives)", brief)


class FindPlanFallbackTests(unittest.TestCase):
    """M15: `_find_plan`'s `documents.plan` fallback — when no
    `type: session-plan` file directly names the session, the session
    index's own `documents.plan` wikilink resolves it by filename stem.
    Not exercised by FIXTURE (its plans all match directly by number)."""

    @staticmethod
    def _entry(rel, text):
        return (rel, text, sc.extract_frontmatter(text) or {})

    def test_resolves_via_documents_plan_link(self):
        session_text = (
            "---\ntype: session\nsession_number: 5\n"
            "chapter: \"[[Chapter Five]]\"\n"
            "documents:\n  plan: \"[[Loose Plan Doc]]\"\n---\n\n# Session 05\n")
        plan_text = "---\ntype: note\n---\n\n## Session Intent\n\nAd hoc plan.\n"
        files = [
            self._entry("Chapters/Chapter Five/Sessions/Session 05.md",
                       session_text),
            self._entry("Notes/Loose Plan Doc.md", plan_text),
        ]
        plan = sc._find_plan(files, "chapter five", 5)
        self.assertIsNotNone(plan)
        self.assertEqual(plan[0], "Notes/Loose Plan Doc.md")

    def test_no_link_and_no_direct_plan_is_none(self):
        session_text = (
            "---\ntype: session\nsession_number: 6\n"
            "chapter: \"[[Chapter Five]]\"\ndocuments: []\n---\n\n# Session 06\n")
        files = [self._entry(
            "Chapters/Chapter Five/Sessions/Session 06.md", session_text)]
        self.assertIsNone(sc._find_plan(files, "chapter five", 6))


class ThreadReportTests(unittest.TestCase):
    """`thread_report(files, current, chapter)` and `--threads`."""

    @classmethod
    def setUpClass(cls):
        cls.files = load_files(FIXTURE)

    def test_threads_ages(self):
        report = sc.thread_report(self.files, 7, "chapter 4 - calcutta")
        self.assertTrue(report.startswith("===== Threads ====="))
        self.assertIn("--- Hero ---", report)
        self.assertIn(
            "Find the missing ledger\tfirst=7\tlast=7\tage=0\t", report)
        self.assertIn(
            "Repay Bram\tfirst=?\tlast=?\tage=?\t"
            "(not in any wrap-up — check it is still live)", report)

    def test_threads_orphans(self):
        report = sc.thread_report(self.files, 7, "chapter 4 - calcutta")
        self.assertIn("--- Wrap-up threads not on any PC sheet ---", report)
        self.assertIn("session 5\tThe ledger is still missing", report)
        # "Find the missing ledger" matched a PC thread, so it must NOT
        # also show up as an orphan.
        orphan_section = report.split(
            "--- Wrap-up threads not on any PC sheet ---", 1)[1]
        self.assertNotIn("Find the missing ledger", orphan_section)

    def test_threads_stale_flag(self):
        tmp = Path(tempfile.mkdtemp(prefix="session-context-stale-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(FIXTURE, tmp, dirs_exist_ok=True)
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8").replace("session: 7", "session: 4"),
            encoding="utf-8")
        files = load_files(tmp)
        report = sc.thread_report(files, 7, "chapter 4 - calcutta")
        self.assertIn(
            "Find the missing ledger\tfirst=4\tlast=4\tage=3\tSTALE", report)

    def test_threads_cli(self):
        result = run_cli(FIXTURE, "--threads", "--session", "7")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Session Context =====", result.stdout)
        self.assertIn("===== Threads =====", result.stdout)
        self.assertNotIn("Wrap-Up —", result.stdout)
        self.assertNotIn("Active PCs", result.stdout)
        self.assertNotIn("Campaign Overview", result.stdout)


if __name__ == "__main__":
    unittest.main()

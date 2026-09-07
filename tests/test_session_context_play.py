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

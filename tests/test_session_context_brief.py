#!/usr/bin/env python3
"""Regression tests for session_context.py --brief.

Covers `brief_wrapup` (stubs the reconcile-provenance GM Notes blocks with
a one-line word-count stub, keeping everything else) and `outline` (a
fence-aware heading + word-count scan), plus the `--brief` CLI mode that
applies both to the default bundle's Wrap-Up and Campaign Overview
sections.

Run: python3 tests/test_session_context_brief.py
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

FIXTURE = ROOT / "tests" / "fixtures" / "slice-d" / "prep"
SCRIPT = SCRIPTS / "session_context.py"


def run_cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True, timeout=60)


class BriefWrapupUnitTests(unittest.TestCase):
    WRAP = (FIXTURE / "Chapters" / "Chapter 1 - Harbour" / "Sessions"
            / "Chapter_01_Session_07_Wrap_Up.md")

    def test_drops_reconcile_provenance_blocks_with_stubs(self):
        body = sc.body_of(self.WRAP.read_text())
        out = sc.brief_wrapup(body)
        for kept in ("The bay was sterile", "Keep this bullet",
                     "the Dredger's debt", "Day 12", "dawn on the quay"):
            self.assertIn(kept, out)
        for dropped in ("A moment that --brief drops", "Drop this in brief",
                        "reconcile provenance"):
            self.assertNotIn(dropped, out)
        self.assertIn("### Reconciliation Context\n(omitted in --brief: 25 words", out)
        self.assertIn("## Memorable Moments\n(omitted in --brief:", out)
        self.assertIn("### Name Conflicts (export vs. vault canon)\n(omitted", out)
        self.assertIn("<!-- /gm-only -->", out)

    def test_no_op_when_nothing_to_drop(self):
        body = "## Narrative Recap\n\nText.\n\n## GM Notes\n\n### World State\n\nDay 1.\n"
        self.assertEqual(sc.brief_wrapup(body), body)


class OutlineUnitTests(unittest.TestCase):
    def test_outline_lines_and_counts(self):
        body = ("# T\n\nfour words are here\n\n## A\n\none two\n\n"
                "### B\n\n```\n## not a heading\n```\nthree words here\n")
        out = sc.outline(body).splitlines()
        self.assertEqual(out[0], "# T  (4 words)")
        self.assertEqual(out[1], "## A  (2 words)")
        self.assertTrue(out[2].startswith("### B  ("))
        self.assertEqual(len(out), 3)


class BriefCLITests(unittest.TestCase):
    def test_brief_trims_wrapup_and_outlines_overview(self):
        r = run_cli(FIXTURE, "--brief")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("===== Wrap-Up — Session 7 =====", out)
        self.assertIn("(omitted in --brief: 25 words", out)
        self.assertNotIn("reconcile provenance", out)
        self.assertIn("===== Campaign Overview (outline) =====", out)
        self.assertIn("## Chapter 1: Harbour  (", out)
        self.assertNotIn("must NOT print in full", out)
        self.assertIn("last_session", out)
        self.assertIn("===== Active PCs =====", out)
        self.assertIn("===== World Flags — Deferred =====", out)
        self.assertIn("(brief: ", out)

    def test_default_is_unchanged(self):
        r = run_cli(FIXTURE)
        self.assertIn("reconcile provenance", r.stdout)
        self.assertIn("must NOT print in full", r.stdout)
        self.assertNotIn("(outline)", r.stdout)

    def test_brief_preserves_gm_only_markers(self):
        r = run_cli(FIXTURE, "--brief")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("<!-- gm-only -->\n\n## GM Notes", r.stdout)

    def test_brief_rejects_play_and_threads(self):
        for flag in ("--play", "--threads"):
            r = run_cli(FIXTURE, "--brief", flag)
            self.assertEqual(r.returncode, 2, r.stdout)
            self.assertIn(
                "error: --brief applies to the default bundle only",
                r.stderr)


if __name__ == "__main__":
    unittest.main()

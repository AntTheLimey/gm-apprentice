#!/usr/bin/env python3
"""Regression tests for plans_index.py.

Covers narrative-plan discovery under Chapters/*/Planning/ (arc/scene
plans with participants and locations) and midwife manifest resolution
(which in-progress adventure belongs to a chapter, or why that
resolution failed).

Run: python3 tests/test_plans_index.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import plans_index as pi  # noqa: E402
from vaultlib import vault_files, extract_frontmatter  # noqa: E402

MIDWIFE_VAULT = ROOT / "tests" / "fixtures" / "slice-b" / "midwife"
AMBIGUOUS_VAULT = ROOT / "tests" / "fixtures" / "slice-b" / "midwife-ambiguous"
SCRIPT = SCRIPTS / "plans_index.py"


def run_cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True, timeout=60)


def load_files(vault):
    for rel, text in vault_files(vault):
        yield rel, text, extract_frontmatter(text) or {}


class PlanningEntriesTests(unittest.TestCase):

    def test_planning_entries_filtered_by_chapter(self):
        entries = pi.planning_entries(MIDWIFE_VAULT, "Chapter 3")
        rels = {e["rel"] for e in entries}
        self.assertEqual(len(entries), 2)
        self.assertTrue(any(r.endswith("Arc_Shape.md") for r in rels))
        self.assertTrue(any(r.endswith("Temple_Approach.md") for r in rels))

        scene = next(e for e in entries if e["rel"].endswith("Temple_Approach.md"))
        self.assertEqual(scene["plan_type"], "scene")
        self.assertEqual(scene["participants"], ["Bram", "Ada"])
        self.assertEqual(scene["locations"], ["Docks"])

        arc = next(e for e in entries if e["rel"].endswith("Arc_Shape.md"))
        self.assertEqual(arc["plan_type"], "arc")
        self.assertEqual(arc["participants"], [])
        self.assertEqual(arc["locations"], [])

    def test_chapter_none_returns_all(self):
        entries = pi.planning_entries(MIDWIFE_VAULT, None)
        self.assertEqual(len(entries), 2)

    def test_chapter_mismatch_returns_none(self):
        entries = pi.planning_entries(MIDWIFE_VAULT, "Chapter 9")
        self.assertEqual(entries, [])


class ManifestTests(unittest.TestCase):

    def test_manifest_parse(self):
        adventures, problem = pi.manifest_adventures(MIDWIFE_VAULT)
        self.assertIsNone(problem)
        by_name = {a.name: a for a in adventures}
        self.assertEqual(set(by_name), {"vienna-nights", "old-arc"})
        self.assertEqual(by_name["vienna-nights"].status, "Active")
        self.assertEqual(by_name["vienna-nights"].dir, "_midwife/vienna-nights/")
        self.assertEqual(by_name["vienna-nights"].files, 3)
        self.assertEqual(by_name["old-arc"].status, "Ingested")
        self.assertEqual(by_name["old-arc"].files, 1)
        self.assertNotIn("seeds", by_name)

    def test_manifest_missing_yields_problem_and_unknown_status(self):
        adventures, problem = pi.manifest_adventures(AMBIGUOUS_VAULT)
        self.assertEqual(problem, "no manifest")
        self.assertEqual({a.name for a in adventures}, {"east-arc", "west-arc"})
        self.assertTrue(all(a.status is None for a in adventures))


class ResolveAdventureTests(unittest.TestCase):

    def test_resolves_single_active(self):
        adventures, _problem = pi.manifest_adventures(MIDWIFE_VAULT)
        resolved, ambiguous = pi.resolve_adventure(
            adventures, "Chapter 3 - Vienna", MIDWIFE_VAULT)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.name, "vienna-nights")
        self.assertEqual(ambiguous, [])

    def test_resolves_single_active_without_chapter(self):
        adventures, _problem = pi.manifest_adventures(MIDWIFE_VAULT)
        resolved, ambiguous = pi.resolve_adventure(adventures, None, MIDWIFE_VAULT)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.name, "vienna-nights")
        self.assertEqual(ambiguous, [])

    def test_ambiguous_without_manifest(self):
        adventures, _problem = pi.manifest_adventures(AMBIGUOUS_VAULT)
        resolved, ambiguous = pi.resolve_adventure(adventures, None, AMBIGUOUS_VAULT)
        self.assertIsNone(resolved)
        self.assertEqual({a.name for a in ambiguous}, {"east-arc", "west-arc"})

    def test_resolves_single_non_ingested_when_no_candidate_mentions_chapter(self):
        # M15: zero candidates mention the chapter at all (it isn't named
        # in any manifest line or adventure index.md), but there is only
        # one non-Ingested/Complete adventure in the whole vault — nothing
        # else to pick, so it still resolves rather than reporting
        # ambiguous.
        adventures, _problem = pi.manifest_adventures(MIDWIFE_VAULT)
        resolved, ambiguous = pi.resolve_adventure(
            adventures, "Chapter 99 - Nowhere Mentioned", MIDWIFE_VAULT)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.name, "vienna-nights")
        self.assertEqual(ambiguous, [])


class FileSummaryTests(unittest.TestCase):

    def test_timeline_first_and_summaries(self):
        adv_dir = MIDWIFE_VAULT / "_midwife" / "vienna-nights"
        timeline_summary = pi.file_summary(adv_dir / "timeline.md")
        self.assertEqual(timeline_summary, "Vienna Nights — Day 1 | Day 2 | Day 3")
        self.assertLessEqual(len(timeline_summary), 120)

        npc_summary = pi.file_summary(adv_dir / "npcs" / "bram.md")
        self.assertEqual(npc_summary, "Bram — Debts Owed")

        index_summary = pi.file_summary(adv_dir / "index.md")
        self.assertTrue(index_summary.startswith("Vienna Nights"))


class OverlapTests(unittest.TestCase):

    def test_overlap(self):
        result = run_cli(MIDWIFE_VAULT, "--against", "Bram", "--against", "Docks")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Overlap =====", result.stdout)
        self.assertIn("Temple_Approach.md\tBram, Docks", result.stdout)
        self.assertNotIn("Arc_Shape.md\t", result.stdout.split("===== Overlap =====")[1])


class JsonShapeTests(unittest.TestCase):

    def test_json_shape(self):
        result = run_cli(MIDWIFE_VAULT, "--chapter", "Chapter 3", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["chapter"], "Chapter 3")
        self.assertEqual(len(data["planning"]), 2)
        self.assertIn("manifest", data["midwife"])
        self.assertIn("adventures", data["midwife"])
        self.assertIn("resolved", data["midwife"])
        self.assertIn("ambiguous", data["midwife"])
        self.assertIn("files", data["midwife"])
        self.assertEqual(data["midwife"]["resolved"], "vienna-nights")
        self.assertEqual(data["midwife"]["ambiguous"], [])
        self.assertTrue(any(f["rel"] == "timeline.md" for f in data["midwife"]["files"]))
        self.assertIn("overlap", data)


class CLITests(unittest.TestCase):

    def test_cli_exit_zero_on_ambiguous(self):
        result = run_cli(AMBIGUOUS_VAULT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AMBIGUOUS:", result.stdout)
        self.assertIn("east-arc", result.stdout)
        self.assertIn("west-arc", result.stdout)

    def test_cli_planning_and_midwife_sections(self):
        result = run_cli(MIDWIFE_VAULT, "--chapter", "Chapter 3 - Vienna")
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        self.assertIn("===== Planning/ (Chapter 3 - Vienna) =====", out)
        self.assertIn("arc\t", out)
        self.assertIn("scene\t", out)
        self.assertIn("participants=Bram, Ada", out)
        self.assertIn("locations=Docks", out)
        self.assertIn("===== Midwife =====", out)
        self.assertIn("manifest: _midwife/index.md", out)
        self.assertIn("vienna-nights\tActive\t_midwife/vienna-nights/\t3 files", out)
        self.assertIn("old-arc\tIngested\t_midwife/old-arc/\t1 file", out)
        self.assertIn("RESOLVED: vienna-nights", out)
        self.assertIn("timeline.md\tVienna Nights", out)

    def test_cli_no_midwife_directory(self):
        result = run_cli(ROOT / "tests" / "fixtures" / "mini-vault")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("(no _midwife/ directory)", result.stdout)

    def test_cli_no_manifest_reports_dir_count(self):
        result = run_cli(AMBIGUOUS_VAULT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("(no manifest — 2 adventure dirs)", result.stdout)


if __name__ == "__main__":
    unittest.main()

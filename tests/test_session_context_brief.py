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

import subprocess
import sys
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


    def test_fenced_heading_is_not_stubbed(self):
        body = ("## GM Notes\n\n### Quick Bullets\n\n"
                "```markdown\n### Quality Notes\n\nA fenced example.\n```\n\n"
                "- Keep this bullet.\n")
        out = sc.brief_wrapup(body)
        self.assertNotIn("omitted in --brief", out)
        self.assertIn("### Quality Notes", out)
        self.assertIn("A fenced example.", out)
        self.assertIn("Keep this bullet.", out)


class RemoveEntitiesUnitTests(unittest.TestCase):
    def test_entities_removal_is_line_bounded(self):
        body = ("**Situation:** A thing.\n"
                "**Entities:** [[A]], [[B]]\n"
                "\n"
                "> Read-aloud sentence that must survive.\n"
                "\n"
                "Trailing note.\n")
        out = sc._remove_inline_label_line(body, "Entities")
        self.assertNotIn("[[A]]", out)
        self.assertIn("**Situation:** A thing.", out)
        self.assertIn("> Read-aloud sentence that must survive.", out)
        self.assertIn("Trailing note.", out)

    def test_wrapped_entities_continuation_is_removed(self):
        body = ("**Entities:** [[A]],\n"
                "[[B]], [[C]]\n"
                "\n"
                "Kept prose.\n")
        out = sc._remove_inline_label_line(body, "Entities")
        self.assertNotIn("[[B]]", out)
        self.assertIn("Kept prose.", out)


class OutlineUnitTests(unittest.TestCase):
    def test_outline_lines_and_counts(self):
        body = ("# T\n\nfour words are here\n\n## A\n\none two\n\n"
                "### B\n\n```\n## not a heading\n```\nthree words here\n")
        out = sc.outline(body).splitlines()
        self.assertEqual(out[0], "# T  (4 words)")
        self.assertEqual(out[1], "## A  (2 words)")
        self.assertTrue(out[2].startswith("### B  ("))
        self.assertEqual(len(out), 3)

    def test_outline_keeps_h4_to_h6(self):
        body = ("## A\n\none two\n\n#### D\n\nthree words here now\n\n"
                "##### E\n\nsix\n\n###### F\n\nseven\n")
        out = sc.outline(body).splitlines()
        self.assertEqual(out, ["## A  (2 words)", "#### D  (4 words)",
                               "##### E  (1 words)", "###### F  (1 words)"])


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

    def test_brief_outlines_the_existing_plan(self):
        r = run_cli(FIXTURE, "--brief")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("===== Existing Plan — Session 8 (outline) =====", out)
        self.assertIn("## Session Intent  (", out)
        self.assertIn("type: session-plan", out)
        self.assertNotIn("Find the sister.", out)

    def test_default_is_unchanged(self):
        r = run_cli(FIXTURE)
        self.assertIn("reconcile provenance", r.stdout)
        self.assertIn("must NOT print in full", r.stdout)
        self.assertNotIn("(outline)", r.stdout)
        self.assertIn("Find the sister.", r.stdout)

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


class SessionRefTests(unittest.TestCase):
    def test_session_ref_number_parses_every_form(self):
        forms = (
            'session: "[[Session 08]]"',
            'session: "[[Session_08]]"',
            'session: "[[Session 08 - Title]]"',
            "session: 8",
            'session: "8"',
        )
        for raw in forms:
            text = f"---\ntype: session-plan\n{raw}\n---\n\nbody\n"
            fm = sc.extract_frontmatter(text)
            with self.subTest(raw=raw):
                self.assertEqual(sc.session_ref_number(fm), 8)

    def test_default_bundle_finds_quoted_wikilink_plan(self):
        r = run_cli(FIXTURE)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.splitlines()
        idx = lines.index("===== Existing Plan — Session 8 =====")
        self.assertIn(
            "(source: Chapters/Chapter 1 - Harbour/Sessions/"
            "Session_08_Plan.md)",
            lines[idx + 1:idx + 3])

    def test_play_finds_quoted_wikilink_plan(self):
        r = run_cli(FIXTURE, "--play")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("===== Play Brief — Session 8 =====", r.stdout)


class SpotlightUnitTests(unittest.TestCase):
    def test_rows_parse_bold_wikilink_and_roles(self):
        body = ("## Spotlight Forecast\n\n| PC | Share | Notes |\n|---|---|---|\n"
                "| **Hero** (Alex) | ~30% | **B-plot featured.** |\n"
                "| [[Second Name]] | 15% | C-plot featured. |\n"
                "| **Third** | — | A-plot participant. |\n\n## Next\n\n| x | y |\n")
        self.assertEqual(sc.spotlight_rows(body), [
            ("Hero", "B", "30%"), ("Second Name", "C", "15%"), ("Third", "A", "?")])

    def test_rows_none_when_section_absent(self):
        self.assertIsNone(sc.spotlight_rows("## Planned Scenes\n\ntext\n"))

    def test_only_first_table_read_when_section_has_two(self):
        body = ("## Spotlight Forecast\n\n"
                "| PC | Share | Notes |\n|---|---|---|\n"
                "| **Hero** | ~30% | B-plot featured. |\n\n"
                "A prose line separating two tables in the same section.\n\n"
                "| PC | Share | Notes |\n|---|---|---|\n"
                "| **Second** | ~15% | C-plot featured. |\n")
        self.assertEqual(sc.spotlight_rows(body), [("Hero", "B", "30%")])

    def test_aliased_wikilink_first_cell_pins_current_split_behaviour(self):
        # The naive `|`-split treats the alias pipe inside
        # `[[Hero_Name|Hero Alias]]` as a cell boundary, so pc_cell ends
        # up as the link target only. Documented, not (yet) fixed.
        body = ("## Spotlight Forecast\n\n| PC | Share | Notes |\n|---|---|---|\n"
                "| [[Hero_Name|Hero Alias]] (Alex) | ~10% | A-plot. |\n")
        rows = sc.spotlight_rows(body)
        self.assertEqual(rows[0][0], "Hero_Name")

    def test_pc_matches_stem_first_token_and_alias(self):
        fm = {"aliases": ["The Hero"]}
        self.assertTrue(sc.pc_matches("hero", "Characters/PCs/Hero.md", fm))
        self.assertTrue(sc.pc_matches("The Hero", "Characters/PCs/Hero.md", fm))
        self.assertTrue(sc.pc_matches("Second Name", "Characters/PCs/Second_Name.md", {}))
        self.assertTrue(sc.pc_matches("Second", "Characters/PCs/Second_Name.md", {}))
        self.assertFalse(sc.pc_matches("Nobody", "Characters/PCs/Hero.md", fm))


class ArcsCLITests(unittest.TestCase):
    def test_arcs_report(self):
        r = run_cli(FIXTURE, "--arcs")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("===== PC Arcs", out)
        self.assertIn("--- Hero (Characters/PCs/Hero.md, player: Alex) ---", out)
        self.assertIn("Keep in --arcs", out)
        self.assertIn("Arc stage note the Keeper wrote", out)
        self.assertNotIn("STR 60", out)
        self.assertNotIn("Open threads: the Dredger's debt", out)
        self.assertIn("Session 6: B (30%)", out)
        self.assertIn("Session 7: A (20%)", out)
        self.assertIn("Sessions since last B-plot: 2 (Session 6)", out)
        self.assertIn("Sessions since last C-plot: never", out)
        self.assertIn("--- Second_Name (", out)
        self.assertIn("(no ## Background section)", out)
        self.assertIn("Session 7: (no row for this PC)", out)
        self.assertIn("Session 6: C (15%)", out)
        self.assertIn("Plans without a ## Spotlight Forecast: Session 5", out)
        self.assertNotIn("Retired", out)
        self.assertNotIn("===== Wrap-Up", out)

    def test_prose_forecast_is_its_own_bucket(self):
        r = run_cli(FIXTURE, "--arcs")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn(
            "Plans whose ## Spotlight Forecast has no table "
            "(read those sections directly): Session 4", out)
        self.assertIn("Plans without a ## Spotlight Forecast: Session 5", out)
        # No per-PC row is emitted for a prose forecast, under any PC...
        self.assertNotIn("Session 4:", out)
        # ...and Session 4 is not counted in the "plans read" denominator.
        self.assertIn("Sessions since last C-plot: never (in 2 plans read)",
                      out)

    def test_arcs_excludes_brief(self):
        r = run_cli(FIXTURE, "--arcs", "--brief")
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()

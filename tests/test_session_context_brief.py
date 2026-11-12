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
        for dropped in ("A moment that --brief drops", "Drop this in brief"):
            self.assertNotIn(dropped, out)
        # Reconciliation Context is printed in full, not stubbed.
        self.assertIn("reconcile provenance", out)
        self.assertNotIn("### Reconciliation Context\n(omitted", out)
        self.assertIn("## Memorable Moments\n(omitted in --brief:", out)
        self.assertIn("### Name Conflicts (export vs. vault canon)\n(omitted", out)
        self.assertIn("<!-- /gm-only -->", out)

    def test_a_dropped_block_ends_at_a_marker_in_any_capitals(self):
        for marker in ("<!-- /GM-ONLY -->", "<!--Gm-Only-->",
                       "<!-- / gm-only -->"):
            with self.subTest(marker=marker):
                body = ("## Memorable Moments\n\nDropped words.\n\n"
                        f"{marker}\n\nKept words.\n")
                out = sc.brief_wrapup(body)
                self.assertNotIn("Dropped words", out)
                self.assertIn(marker, out)
                self.assertIn("Kept words.", out)

    def test_resolved_threads_stubbed(self):
        body = ("## GM Notes\n\n### What Carries Forward\n\n"
                "#### Unresolved Threads\n\n- Kept thread.\n\n"
                "#### Resolved Threads\n\n- The bell — rung (Session 7)\n"
                "- The debt — paid\n\n#### Pending Consequences\n\n- Kept.\n")
        out = sc.brief_wrapup(body)
        self.assertNotIn("The bell", out)
        self.assertIn("#### Resolved Threads\n(omitted in --brief: 12 words",
                      out)
        self.assertIn("Kept thread.", out)
        self.assertIn("#### Pending Consequences\n\n- Kept.", out)

    def test_only_the_named_headings_are_stubbed(self):
        # A heading that only starts with a stubbed title is its own: kept.
        # The title with a parenthetical after it is still the section.
        for head in ("#### Resolved Threads Review", "### Quality Notes2",
                     "### Name Conflictsx (a)"):
            with self.subTest(head=head):
                body = f"# W\n\n{head}\n\n- Kept words.\n"
                self.assertEqual(sc.brief_wrapup(body), body)
        out = sc.brief_wrapup("### Name Conflicts (export vs. vault canon)"
                              "\n\n- Dropped words.\n")
        self.assertNotIn("Dropped words", out)
        out = sc.brief_wrapup("#### Resolved Threads  \n\n- Dropped.\n")
        self.assertNotIn("Dropped", out)

    def test_stubbing_keeps_every_marker_line(self):
        # The fence `append_resolved` puts round an older Wrap-Up's block,
        # a spoiler closer, and a marker after text on a line all stay.
        import threads
        old = ("# W\n\n### What Carries Forward\n\n#### Unresolved Threads"
               "\n\n- a\n\n## Next\n\nN.\n")
        out = sc.brief_wrapup(threads.append_resolved(old, "- b — closed: x"))
        self.assertIn("<!-- gm-only -->\n\n#### Resolved Threads\n(omitted",
                      out)
        self.assertIn("<!-- /gm-only -->\n\n## Next", out)
        for tail in ("<!-- /spoiler -->", "- c <!-- /gm-only -->",
                     "<!-- /SPOILER -->"):
            with self.subTest(tail=tail):
                body = ("<!-- spoiler -->\n#### Resolved Threads\n\n- b\n"
                        f"{tail}\n\nKept.\n")
                out = sc.brief_wrapup(body)
                self.assertIn(f"\n{tail}\n", out)
                self.assertNotIn("- b\n", out)

    def test_an_inline_opener_mid_block_does_not_end_the_stub(self):
        """#631: the whole block goes, up to the marker line that ends it."""
        body = ("## Memorable Moments\n\nFirst words. <!-- gm-only --> "
                "hidden bit\nmore hidden <!-- /gm-only --> tail words.\n"
                "Last words of the block.\n\n<!-- gm-only -->\n\n"
                "## Kept\n\nKept words.\n\n<!-- /gm-only -->\n")
        out = sc.brief_wrapup(body)
        for gone in ("First words", "hidden bit", "tail words",
                     "Last words of the block"):
            self.assertNotIn(gone, out)
        self.assertIn("## Memorable Moments\n(omitted in --brief:", out)
        self.assertIn("<!-- gm-only -->\n\n## Kept\n\nKept words.", out)
        self.assertEqual(out.count("gm-only -->"), 2)

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


RECON_WRAP = (
    "---\ntype: session-wrapup\nsession: \"[[Session 01 - Landfall]]\"\n"
    "session_number: 1\nchapter: \"[[Chapter 1 - Harbour]]\"\n---\n\n"
    "# Session 1\n\n## Narrative Recap\n\nThey met Ma Barker.\n\n"
    "<!-- gm-only -->\n\n## GM Notes\n\n### Quality Notes\n\n"
    "Quality line stubbed.\n\n### Reconciliation Context\n\n"
    "Reconciled on 2026-10-02.\n\n#### World Evolution\n\n"
    "- The Dredgers took the quay: BARKER RULING KEPT.\n\n"
    "<!-- /gm-only -->\n")
RECON_TOP = RECON_WRAP.replace("### Reconciliation Context",
                               "## Reconciliation Context")


class ReconciliationContextTests(unittest.TestCase):
    """Prep and --brief print the Reconciliation Context in full."""

    def vault(self, wrap: str) -> Path:
        import shutil
        import tempfile
        d = Path(tempfile.mkdtemp(prefix="sc-recon-"))
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        ch = d / "Chapters" / "Chapter 1 - Harbour" / "Sessions"
        ch.mkdir(parents=True)
        (d / "Chapters" / "Chapter 1 - Harbour"
         / "Chapter 1 - Harbour.md").write_text("---\ntype: chapter\n---\n")
        (ch / "Session 01 - Landfall.md").write_text(
            "---\ntype: session\nsession_number: 1\n"
            "chapter: \"[[Chapter 1 - Harbour]]\"\nstatus: wrap-up\n---\n\nB.\n")
        (ch / "Session 01 - Landfall - Wrap-Up.md").write_text(wrap)
        return d

    def test_prep_and_brief_print_the_block_and_stub_the_rest(self):
        for wrap in (RECON_WRAP, RECON_TOP):
            for flag in ("--prep", "--brief"):
                with self.subTest(flag=flag, top=wrap is RECON_TOP):
                    r = run_cli(self.vault(wrap), flag)
                    self.assertEqual(r.returncode, 0, r.stderr)
                    out = r.stdout
                    self.assertIn("BARKER RULING KEPT", out)
                    self.assertIn("Reconciled on 2026-10-02.", out)
                    if wrap is RECON_WRAP:
                        self.assertIn("#### World Evolution", out)
                    self.assertRegex(
                        out, r"Reconciliation Context\n\nReconciled")
                    self.assertNotIn("Quality line stubbed", out)
                    self.assertIn("### Quality Notes\n(omitted in --brief",
                                  out)

    def test_sub_headings_inside_the_block_are_not_stubbed(self):
        inner = ("#### Name Conflicts\n\nNAME LINE\n\n"
                 "#### Resolved Threads\n\nTHREAD LINE\n\n"
                 "#### World Evolution\n\nEVOLVE LINE\n\n")
        for head, outer in (("### Reconciliation Context", "### Quality Notes"),
                            ("## Reconciliation Context", "## Next")):
            with self.subTest(head=head):
                body = (f"{head}\n\nIntro.\n\n{inner}"
                        f"{outer}\n\nQuality line.\n\n"
                        "### Name Conflicts\n\nOutside conflict.\n")
                out = sc.brief_wrapup(body)
                for line in ("NAME LINE", "THREAD LINE", "EVOLVE LINE"):
                    self.assertIn(line, out)
                before = out.split(outer)[0]
                self.assertNotIn("(omitted in --brief", before)
                self.assertNotIn("Outside conflict.", out)
                self.assertIn("### Name Conflicts\n(omitted in --brief", out)
                if outer == "### Quality Notes":
                    self.assertIn("### Quality Notes\n(omitted in --brief",
                                  out)

    def test_top_level_block_prints_in_full(self):
        out = sc.brief_wrapup(sc.body_of(RECON_TOP))
        self.assertIn("## Reconciliation Context\n\nReconciled", out)
        self.assertIn("BARKER RULING KEPT", out)


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
        after = out.split("### Reconciliation Context", 1)[1]
        self.assertNotIn("(omitted in --brief", after.split("\n###", 1)[0])
        self.assertIn("reconcile provenance", out)
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
            ("Hero", "B"), ("Second Name", "C"), ("Third", "A")])

    def test_rows_none_when_section_absent(self):
        self.assertIsNone(sc.spotlight_rows("## Planned Scenes\n\ntext\n"))

    def test_only_first_table_read_when_section_has_two(self):
        body = ("## Spotlight Forecast\n\n"
                "| PC | Share | Notes |\n|---|---|---|\n"
                "| **Hero** | ~30% | B-plot featured. |\n\n"
                "A prose line separating two tables in the same section.\n\n"
                "| PC | Share | Notes |\n|---|---|---|\n"
                "| **Second** | ~15% | C-plot featured. |\n")
        self.assertEqual(sc.spotlight_rows(body), [("Hero", "B")])

    def test_aliased_wikilink_first_cell_resolves_to_its_target(self):
        # The alias pipe inside `[[Hero_Name|Hero Alias]]` is not a cell
        # boundary. Split there and the role came from a row
        # whose PC never matched, so the drought count was silently wrong.
        body = ("## Spotlight Forecast\n\n| PC | Share | Notes |\n|---|---|---|\n"
                "| [[Hero_Name|Hero Alias]] (Alex) | ~10% | A-plot. |\n")
        self.assertEqual(sc.spotlight_rows(body), [("Hero_Name", "A")])
        self.assertTrue(sc.pc_matches(
            "Hero_Name", "Characters/PCs/Hero_Name.md", {}))

    def test_unclosed_wikilink_falls_back_to_the_naive_split(self):
        # Bracket tracking must not swallow the rest of the row: a row
        # that opens `[[` and never closes it would otherwise put the
        # whole line in the PC cell and report a false drought.
        body = ("## Spotlight Forecast\n\n| PC | Share | Notes |\n|---|---|---|\n"
                "| [[Hero | ~30% | B-plot. |\n")
        self.assertEqual(sc.spotlight_rows(body), [("Hero", "B")])

    def test_row_ending_in_an_escaped_pipe_keeps_it(self):
        self.assertEqual(sc._row_cells(r"| Hero \|"), [r"Hero \|"])

    def test_escaped_pipe_in_pc_cell_is_not_a_cell_boundary(self):
        body = ("## Spotlight Forecast\n\n| PC | Share | Notes |\n|---|---|---|\n"
                "| Hero \\| Sidekick | ~20% | B-plot. |\n")
        self.assertEqual(sc.spotlight_rows(body),
                         [("Hero | Sidekick", "B")])

    def test_pc_matches_stem_first_token_and_alias(self):
        fm = {"aliases": ["The Hero"]}
        self.assertTrue(sc.pc_matches("hero", "Characters/PCs/Hero.md", fm))
        self.assertTrue(sc.pc_matches("The Hero", "Characters/PCs/Hero.md", fm))
        self.assertTrue(sc.pc_matches("Second Name", "Characters/PCs/Second_Name.md", {}))
        self.assertTrue(sc.pc_matches("Second", "Characters/PCs/Second_Name.md", {}))
        self.assertFalse(sc.pc_matches("Nobody", "Characters/PCs/Hero.md", fm))

    def test_pc_matches_gm_alias(self):
        # #212: a play-notes cell naming a PC by a GM-only alias still matches.
        fm = {"gm_aliases": ["The Masked One"]}
        self.assertTrue(sc.pc_matches("the masked one", "Characters/PCs/Hero.md", fm))


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
        self.assertIn("Session 6: B", out)
        self.assertIn("Session 7: A", out)
        self.assertIn("Sessions since last B-plot: 2 (Session 6)", out)
        self.assertIn("Sessions since last C-plot: never", out)
        self.assertIn("--- Second_Name (", out)
        self.assertIn("(no ## Background section)", out)
        self.assertIn("Session 7: (no row for this PC)", out)
        self.assertIn("Session 6: C", out)
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


class SettledItemsTests(unittest.TestCase):
    """Settled Keeper Checklist items and answered questions stay out of
    the brief (#643)."""

    def test_brief_drops_settled_checklist_items(self):
        body = (
            "### Keeper Checklist\n\n"
            "- [x] ~~Rule the bell~~ \u2014 it rings\n"
            "  - nested note on the bell\n"
            "- [ ] Name the sexton\n"
            "- ~~Which door?~~ \u2014 answered: the east\n"
            "  wrapped on without a marker\n"
            "- [x] Plain ticked item\n"
            "- [ ] Pick a port\n\n"
            "### Open Questions for next time\n\n"
            "1. ~~Who paid?~~ \u2014 answered: Barker\n"
            "2. Who sailed?\n\n"
            "### Other\n\n- [x] kept: not a settled block\n")
        out = sc.brief_wrapup(body)
        for gone in ("Rule the bell", "nested note", "Which door",
                     "wrapped on", "Plain ticked", "Who paid"):
            self.assertNotIn(gone, out)
        for kept in ("Name the sexton", "Pick a port", "Who sailed?",
                     "kept: not a settled block"):
            self.assertIn(kept, out)
        self.assertNotIn("(all settled)", out)

    def test_brief_all_settled_stub(self):
        body = ("### Keeper Checklist\n\n"
                "- [x] ~~Rule the bell~~ \u2014 it rings\n"
                "- [x] Done\n\n### Next\n\ntext\n")
        out = sc.brief_wrapup(body)
        self.assertEqual(out, "### Keeper Checklist\n(all settled)\n\n"
                              "### Next\n\ntext\n")

    def test_an_empty_checklist_is_left_alone(self):
        body = "### Keeper Checklist\n\n### Next\n\ntext\n"
        self.assertEqual(sc.brief_wrapup(body), body)

    def test_settled_items_in_a_fence_stay(self):
        body = ("### Keeper Checklist\n\n```\n- [x] example\n```\n"
                "- [ ] open\n")
        self.assertIn("- [x] example", sc.brief_wrapup(body))


if __name__ == "__main__":
    unittest.main()

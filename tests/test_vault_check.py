#!/usr/bin/env python3
"""Regression tests for the reworked vault_check assistance checks.

Covers the pieces re-derived from Slice B under the GM-in-the-loop
assistance model: table-cell pipe lint (kept), multi-day timeline cue
(reframed to INFO), and the read-aloud blockquote signal (renamed from
the dropped plan-wide agency scan).

Run: python tests/test_vault_check.py
"""

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "vault-check"


def rows_for(rows, needle):
    return [r for r in rows if needle in r]


class CheckTablesTests(unittest.TestCase):
    def setUp(self):
        self.rows = vc.check_tables(FIXTURE)
        self.note = rows_for(self.rows, "Table Note.md")

    def test_all_rows_are_errors(self):
        self.assertTrue(all(r.startswith("ERROR\t") for r in self.rows))

    def test_flags_aliased_link_and_escaped_pipe_only(self):
        self.assertEqual(len(self.note), 2)

    def test_flags_the_aliased_wikilink(self):
        self.assertTrue(rows_for(self.note, "aliased wikilink"))

    def test_flags_the_escaped_pipe(self):
        self.assertTrue(rows_for(self.note, "escaped pipe"))

    def test_clean_link_and_prose_pipe_silent(self):
        self.assertFalse(rows_for(self.note, "Clean Link"))


class CheckTimelineTests(unittest.TestCase):
    def setUp(self):
        self.rows = vc.check_timeline(FIXTURE)

    def test_all_rows_are_info(self):
        # Reframed from WARNING to INFO: an internal cue, not a scold.
        self.assertTrue(all(r.startswith("INFO\t") for r in self.rows))

    def test_multi_day_without_timeline_flagged(self):
        self.assertTrue(rows_for(self.rows, "Timeline Missing.md"))

    def test_multi_day_with_timeline_silent(self):
        self.assertFalse(rows_for(self.rows, "Timeline Present.md"))

    def test_single_day_silent(self):
        self.assertFalse(rows_for(self.rows, "Single Day.md"))

    def test_string_date_range_flagged(self):
        self.assertTrue(rows_for(self.rows, "Timeline String Range.md"))

    def test_cue_offers_a_clock(self):
        missing = rows_for(self.rows, "Timeline Missing.md")
        self.assertTrue(any("Timeline" in r and "clock" in r for r in missing))

    def test_is_multi_day_helper(self):
        self.assertTrue(vc._is_multi_day(["d1", "d2"]))
        self.assertFalse(vc._is_multi_day(["d1"]))
        self.assertTrue(vc._is_multi_day("September 17–24, 1814"))
        self.assertTrue(vc._is_multi_day("1814 to 1815"))
        self.assertFalse(vc._is_multi_day("1893-05-01"))  # ISO, not a range
        self.assertFalse(vc._is_multi_day(None))


class CheckReadAloudTests(unittest.TestCase):
    def setUp(self):
        self.rows = vc.check_read_aloud(FIXTURE)
        self.plan = rows_for(self.rows, "Read Aloud.md")

    def test_active_pc_names_collected(self):
        names = {n.casefold() for n in vc.active_pc_names(FIXTURE)}
        self.assertIn("varrio", names)
        self.assertIn("katherine", names)

    def test_all_rows_are_info(self):
        # Signal/cue, not a defect report — INFO so the GM never sees a WARNING.
        self.assertTrue(all(r.startswith("INFO\t") for r in self.rows))

    def test_no_plan_wide_action_subject_scan(self):
        # The dropped heuristic 1 must NOT fire on the prose line
        # "Varrio approaches the gate and demands entry."
        self.assertFalse(rows_for(self.rows, "as action subject"))
        self.assertFalse(rows_for(self.rows, "the gate"))

    def test_flags_third_person_blockquote(self):
        self.assertTrue(rows_for(self.plan, "3rd-person"))

    def test_flags_named_pc_blockquote(self):
        named = rows_for(self.plan, "names PC")
        self.assertTrue(any("Katherine" in r for r in named))

    def test_clean_blockquote_silent(self):
        self.assertFalse(rows_for(self.plan, "lamp gutters"))

    def test_read_aloud_scan_runs_without_active_pcs(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            plan = Path(d) / "Plan.md"
            plan.write_text(
                "---\ntype: session-plan\n---\n\n"
                "> You feel a cold dread creep up your spine.\n",
                encoding="utf-8")
            rows = vc.check_read_aloud(Path(d))
            self.assertTrue(rows_for(rows, "player feeling"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Regression tests for PC entity-sheet staleness detection.

Guards the bug where session-wrapup advanced PC Story files and the
campaign overview but never the PC's own entity sheet, leaving
`asOfSession` (and the published `## Current Status`) frozen sessions
behind the rest of the vault.

Run: python tests/test_pc_freshness.py
"""

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import validate_schema as vs  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "pc-freshness"


class ParseSessionOrdinalTests(unittest.TestCase):
    def test_chapter_and_session(self):
        self.assertEqual(vs.parse_session_ordinal("Chapter 4, Session 3"), (4, 3))

    def test_bare_session(self):
        self.assertEqual(vs.parse_session_ordinal("Session 10"), (0, 10))

    def test_bare_chapter(self):
        self.assertEqual(vs.parse_session_ordinal("Chapter 2"), (2, 0))

    def test_unparseable_returns_none(self):
        self.assertIsNone(vs.parse_session_ordinal("whenever"))
        self.assertIsNone(vs.parse_session_ordinal(None))
        self.assertIsNone(vs.parse_session_ordinal(""))

    def test_real_drift_cases_order_correctly(self):
        # Regression: the exact Canticle labels that drifted, vs the
        # campaign's true position (Chapter 4, Session 3).
        campaign = vs.parse_session_ordinal("Chapter 4, Session 3")
        self.assertLess(vs.parse_session_ordinal("Session 10"), campaign)            # Adrien/Katherine (Vienna)
        self.assertLess(vs.parse_session_ordinal("Session 12"), campaign)            # Emma
        self.assertLess(vs.parse_session_ordinal("Chapter 4, Session 2"), campaign)  # Georgiana (smoking gun)
        self.assertLess(vs.parse_session_ordinal("Chapter 4, Session 1"), campaign)  # Freddy/Holt
        # The current position is not behind itself.
        self.assertFalse(vs.parse_session_ordinal("Chapter 4, Session 3") < campaign)


class FindStalePcsTests(unittest.TestCase):
    def setUp(self):
        self.result = vs.find_stale_pcs(FIXTURE)

    def test_flags_only_the_stale_active_pc(self):
        names = sorted(s.name for s in self.result.stale)
        self.assertEqual(names, ["Stale_Veteran"])

    def test_dead_pc_is_skipped(self):
        # A dead PC is intentionally frozen — not a drift bug.
        names = [s.name for s in self.result.stale]
        self.assertNotIn("Fallen_Knight", names)

    def test_missing_pc_is_skipped(self):
        # A missing/off-screen PC's sheet legitimately freezes while
        # they're out of play — frozen like a dead PC, not a drift bug.
        names = [s.name for s in self.result.stale]
        self.assertNotIn("Vanished_Agent", names)

    def test_current_pc_not_flagged(self):
        names = [s.name for s in self.result.stale]
        self.assertNotIn("Current_Scout", names)

    def test_story_companion_not_flagged(self):
        # Only `type: pc` entity sheets are checked, never the
        # append-only `character-story` companions.
        names = [s.name for s in self.result.stale]
        self.assertNotIn("Stale_Veteran_Story", names)


class ValidateFreshnessTests(unittest.TestCase):
    def test_exit_code_nonzero_when_stale_pc_present(self):
        self.assertEqual(vs.validate_freshness(FIXTURE), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

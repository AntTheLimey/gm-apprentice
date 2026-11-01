#!/usr/bin/env python3
"""The benchmark campaign stays a vault the update tool will accept (#489),
and keeps the faults it was built to carry."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
from vaultlib import parse_version, read_stamp  # noqa: E402

BENCH = ROOT / "tests" / "benchmark-campaign"


class StampTests(unittest.TestCase):
    def test_stamp_is_at_or_above_the_update_floor(self):
        stamp = read_stamp(BENCH)
        self.assertIsNotNone(stamp, "the campaign has no recorded version")
        self.assertGreaterEqual(
            parse_version(stamp), parse_version(migrate.FLOOR),
            f"campaign is stamped {stamp}, below the update floor "
            f"{migrate.FLOOR}: run migrate.py on it (never edit the stamp)")

    def test_the_update_tool_accepts_it(self):
        self.assertIsInstance(migrate.gate(BENCH), tuple, migrate.gate(BENCH))

    def test_plan_does_not_refuse(self):
        run = subprocess.run(
            [sys.executable, str(SCRIPTS / "migrate.py"), str(BENCH), "plan"],
            capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertNotIn("below", run.stdout + run.stderr)


class PlantedFaultTests(unittest.TestCase):
    """SUMMARY.md says the campaign carries 6 deliberate problems and does
    not list them. These pin the ones that can be told apart on the page, so
    a migration or a clean-up cannot quietly repair them."""

    def read(self, rel: str) -> str:
        return (BENCH / rel).read_text(encoding="utf-8")

    def test_ashford_lectures_while_missing(self):
        self.assertIn("Professor Ashford seen giving a lecture",
                      self.read("_Campaign/Timeline.md"))
        self.assertIn('status: "missing"', self.read("NPCs/Professor Ashford.md"))

    def test_two_blackwoods_stay_apart(self):
        self.assertIn("canon_status: SUPERSEDED",
                      self.read("NPCs/Father Blackwood v1.md"))
        self.assertIn("canon_status: AUTHORITATIVE",
                      self.read("NPCs/Father Blackwood.md"))

    def test_drafts_stay_drafts(self):
        for rel in ("NPCs/The Hooded Figure.md", "Locations/The Old Mill.md"):
            self.assertIn("canon_status: DRAFT", self.read(rel), rel)

    def test_stale_session_names_stay_stale(self):
        text = self.read("Chapters/Chapter 1/chapter-overview.md")
        for name in ("Session 1 - The Missing Professor",
                     "Session 2 - The Docks at Night",
                     "Session 3 - The Inner Sanctum"):
            self.assertIn(f"[[{name}]]", text)

    def test_unknown_doctor_stays_unwritten(self):
        self.assertIn("[[Dr. Marsh]]", self.read(
            "Chapters/Chapter 1/Sessions/"
            "Session 02 - The Docks at Night - Play Notes.md"))
        self.assertFalse(list(BENCH.rglob("Dr. Marsh*")))


if __name__ == "__main__":
    unittest.main()

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

sys.path.insert(0, str(ROOT / "scripts"))
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


class TemplateSkipTests(unittest.TestCase):
    def test_a_vault_under_a_templates_folder_is_not_skipped_whole(self):
        import validate_schema as vs
        root = Path("/x/_Templates/vault")
        self.assertFalse(vs._is_template(root / "NPCs" / "Ezra.md", root))
        self.assertTrue(vs._is_template(root / "_Templates" / "a.md", root))
        self.assertTrue(vs._is_template(root / "NPCs" / "_Template_NPC.md", root))


class PlantedFaultTests(unittest.TestCase):
    """The six deliberate problems named in the message of commit 4acfb023,
    which added the campaign: a timeline contradiction, name confusion, a
    broken link, a three-clue violation, an orphaned entity and a stale
    thread. They line up with campaign-qa questions Q1 to Q5. A migration or
    a tidy-up must not quietly repair one."""

    def read(self, rel: str) -> str:
        return (BENCH / rel).read_text(encoding="utf-8")

    def test_1_timeline_contradiction(self):
        self.assertIn("Professor Ashford seen giving a lecture",
                      self.read("_Campaign/Timeline.md"))
        self.assertIn('status: "missing"', self.read("NPCs/Professor Ashford.md"))

    def test_2_name_confusion(self):
        # Rev. Silas Marsh (a PC), Dr. Eleanor Voss (a PC), and a Dr. Marsh
        # nobody can place.
        pcs = self.read("_Campaign/Player Characters.md")
        self.assertIn("## Reverend Silas Marsh", pcs)
        self.assertIn("## Dr. Eleanor Voss", pcs)
        self.assertIn("[[Dr. Marsh]]", self.read(
            "Chapters/Chapter 1/Sessions/"
            "Session 02 - The Docks at Night - Play Notes.md"))

    def test_3_broken_link(self):
        self.assertFalse(list(BENCH.rglob("Dr. Marsh*")))

    def test_4_three_clue_violation(self):
        # Only three clue notes, and one of them is the sole lead to the hideout.
        self.assertEqual(
            sorted(p.name for p in (BENCH / "Clues").glob("*.md")),
            ["Coded Letter.md", "Strange Symbol.md", "Witness Statement.md"])
        self.assertIn("This is the central clue of the campaign",
                      self.read("Clues/Coded Letter.md"))

    def test_5_orphaned_entity(self):
        self.assertTrue((BENCH / "Locations" / "St Anselms Church.md").exists())
        for note in BENCH.rglob("*.md"):
            if "_Templates" in note.relative_to(BENCH).parts:
                continue
            self.assertNotRegex(note.read_text(encoding="utf-8"),
                                r"\[\[St Anselm", str(note))

    def test_6_stale_thread(self):
        self.assertIn("He has never followed up on any of them.",
                      self.read("NPCs/Inspector Crane.md"))


class KeptStableTests(unittest.TestCase):
    """Not among the six, but state other tests and benchmarks lean on (the
    canon-status fixtures of #38, the session titles in the chapter
    overview): kept as they are."""

    def read(self, rel: str) -> str:
        return (BENCH / rel).read_text(encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()

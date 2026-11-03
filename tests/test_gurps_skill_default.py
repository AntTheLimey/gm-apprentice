#!/usr/bin/env python3
"""gurps_skill_default.py: a skill the sheet lacks is added at its default
level for 0 points (#571); one with no default is not."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import gurps_skill_default as gsd  # noqa: E402

SHEET = """---
type: pc
---

# Ann Vole

### Primary Attributes

| Attribute | Score | Modifier | Cost |
|-----------|-------|----------|------|
| ST | 11 | +1 | 10 |
| DX | 14 | +4 | 80 |
| IQ | 12 | +2 | 40 |
| HT | 11 | +1 | 10 |

### Secondary Characteristics

| Characteristic | Value |
|---------------|-------|
| Will | 13 |
| Per | 12 |

## Skills

| Name | Difficulty | Relative Level | Points | Base | Current |
|------|-----------|----------------|--------|------|---------|
| Guns (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |
| Shortsword | DX/A | DX+1 | [4] | 15 | 15 |
| Tactics | IQ/H | IQ-2 | [0] | 10 | 10 |

## Melee Weapons

| Weapon | Skill | Damage | Reach | Parry |
|--------|-------|--------|-------|-------|
| Utility knife | DX-12 (default) | 1d-3 imp | C | 8 |
"""


def run(text, skill, *extra):
    d = Path(tempfile.mkdtemp(prefix="gsd-"))
    try:
        sheet = d / "Ann_Vole.md"
        sheet.write_bytes(text.encode("utf-8"))
        got = subprocess.run(
            [sys.executable, str(SCRIPTS / "gurps_skill_default.py"),
             str(sheet), skill, *extra],
            capture_output=True, text=True, encoding="utf-8")
        return got, sheet.read_bytes().decode("utf-8")
    finally:
        shutil.rmtree(d, ignore_errors=True)


class SkillDefaultTests(unittest.TestCase):
    def test_an_attribute_default_is_added_in_order_for_0_points(self):
        got, after = run(SHEET, "Knife", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertTrue(got.stdout.startswith(
            "ADDED\t"), got.stdout)
        self.assertIn("| Knife | DX/E | DX-4 | [0] | 10 | 10 | "
                      "(default DX-4, level 10)", got.stdout)
        self.assertIn("| Guns (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |\n"
                      "| Knife | DX/E | DX-4 | [0] | 10 | 10 |\n"
                      "| Shortsword |", after)

    def test_a_preview_writes_nothing(self):
        got, after = run(SHEET, "Knife")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertTrue(got.stdout.startswith("WOULD-ADD\t"), got.stdout)
        self.assertEqual(after, SHEET)

    def test_the_best_default_wins_and_a_bought_skill_counts(self):
        # Broadsword: DX-5 = 9, Shortsword-2 = 13 (B344: the best default).
        _p, _m, new = gsd.plan(SHEET, "Broadsword")
        self.assertIn("| Broadsword | DX/A | DX-1 | [0] | 13 | 13 |\n"
                      "| Guns (Pistol) |", new)

    def test_a_skill_known_only_at_default_is_no_base_for_another(self):
        # B173: Tactics here is at default (0 points), so nothing defaults
        # from it. Strategy is not in the local tables: given by hand.
        _p, msg, _new = gsd.plan(SHEET, "Strategy", "IQ/H", "IQ-6, Tactics-6")
        self.assertIn("(default IQ-6, level 6)", msg)

    def test_a_skill_with_no_default_is_not_added(self):
        got, after = run(SHEET, "Brawling", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertTrue(got.stdout.startswith("NO-DEFAULT\t"), got.stdout)
        self.assertIn("Brawling has no default (B182): it cannot be used "
                      "unskilled, so nothing is added", got.stdout)
        self.assertEqual(after, SHEET)

    def test_a_skill_on_the_sheet_is_left(self):
        got, after = run(SHEET, "shortsword", "--write")
        self.assertEqual(got.returncode, 0)
        self.assertEqual(got.stdout.split("\t")[0], "HAVE")
        self.assertIn("at 15", got.stdout)
        self.assertEqual(after, SHEET)

    def test_a_skill_the_tables_do_not_list_asks_for_its_defaults(self):
        got, after = run(SHEET, "Underwater Basket Weaving", "--write")
        self.assertEqual(got.returncode, 1)
        self.assertTrue(got.stdout.startswith("NOT-FOUND\t"), got.stdout)
        self.assertEqual(after, SHEET)
        got, after = run(SHEET, "Underwater Basket Weaving", "--difficulty",
                         "DX/A", "--default", "DX-5", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertIn("| Underwater Basket Weaving | DX/A | DX-5 | [0] | 9 |",
                      after)

    def test_a_specialty_with_a_sibling_bought_asks_for_its_defaults(self):
        # The tables list Guns (Rifle) at DX-4 only; the sheet has Guns
        # (Pistol), which may give a better default.
        got, after = run(SHEET, "Guns (Rifle)", "--write")
        self.assertEqual(got.returncode, 1)
        self.assertTrue(got.stdout.startswith("CHECK-DEFAULT\t"), got.stdout)
        self.assertIn("guns (pistol) at 16", got.stdout)
        self.assertEqual(after, SHEET)
        got, after = run(SHEET, "Guns (Rifle)", "--difficulty", "DX/E",
                         "--default", "DX-4, Guns (Pistol)-2", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertIn("| Guns (Rifle) | DX/E | DX+0 | [0] | 14 | 14 |", after)

    def test_the_templates_empty_row_is_taken(self):
        sheet = SHEET.replace(
            "| Guns (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |\n"
            "| Shortsword | DX/A | DX+1 | [4] | 15 | 15 |\n"
            "| Tactics | IQ/H | IQ-2 | [0] | 10 | 10 |\n",
            "| | | | | | |\n")
        _p, _m, new = gsd.plan(sheet, "Knife")
        self.assertIn("|------|-----------|----------------|--------|------|"
                      "---------|\n| Knife | DX/E | DX-4 | 0 | 10 | 10 |\n\n"
                      "## Melee", new)

    def test_an_effective_column_and_a_table_at_the_end(self):
        sheet = ("### Primary Attributes\n\n| Attribute | Score |\n|---|---|\n"
                 "| ST | 10 |\n| DX | 12 |\n\n## Skills\n\n"
                 "| Name | Difficulty | Relative Level | Points | Effective |\n"
                 "|---|---|---|---|---|\n| Axe/Mace | DX/A | DX+0 | [2] | 12 |")
        _p, _m, new = gsd.plan(sheet, "Knife")
        self.assertTrue(new.endswith(
            "| Axe/Mace | DX/A | DX+0 | [2] | 12 |\n"
            "| Knife | DX/E | DX-4 | [0] | 8 |"), new)

    def test_an_encumbrance_penalised_skill_has_its_current_level(self):
        sheet = SHEET.replace("## Skills", "## Current Status\n\n"
                              "- **Enc:** Light (1)\n\n## Skills")
        _p, _m, new = gsd.plan(sheet, "Climbing")
        self.assertIn("| Climbing | DX/A | DX-5 | [0] | 9 | 8 |", new)

    def test_no_skills_table_is_refused(self):
        got, _after = run("# Ann\n\nNo sheet.\n", "Knife")
        self.assertEqual(got.returncode, 1)
        self.assertTrue(got.stdout.startswith("CANNOT\t"), got.stdout)

    def test_difficulty_and_default_go_together(self):
        got, _after = run(SHEET, "Knife", "--default", "DX-4")
        self.assertEqual(got.returncode, 2)


if __name__ == "__main__":
    unittest.main()

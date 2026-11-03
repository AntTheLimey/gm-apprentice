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
    def test_a_default_is_added_in_order_for_0_points(self):
        # Knife: DX-4 = 10, Shortsword-3 = 12 (the tables' B208 default).
        got, after = run(SHEET, "Knife", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertTrue(got.stdout.startswith(
            "ADDED\t"), got.stdout)
        self.assertIn("| Knife | DX/E | DX-2 | [0] | 12 | 12 | "
                      "(default Shortsword-3, level 12)", got.stdout)
        self.assertIn("| Guns (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |\n"
                      "| Knife | DX/E | DX-2 | [0] | 12 | 12 |\n"
                      "| Shortsword |", after)

    def test_an_attribute_default_when_no_bought_skill_gives_more(self):
        _p, msg, _new = gsd.plan(SHEET, "Axe/Mace")
        self.assertIn("| Axe/Mace | DX/A | DX-5 | [0] | 9 | 9 | "
                      "(default DX-5, level 9)", msg)

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
        self.assertIn("Brawling has no default (B173): it can't be used "
                      "until at least 1 point is spent on it", got.stdout)
        got, _after = run(SHEET, "Karate", "--write")
        self.assertIn("Karate has no default (B173): it can't be used "
                      "until at least 1 point is spent on it", got.stdout)
        self.assertEqual(after, SHEET)

    def test_an_unarmed_attack_needs_no_unarmed_skill(self):
        # B271 (the coordinator's reading; the publish tool's UNARMED rows
        # assume it too): a punch rolls against DX, a kick against DX-2,
        # without Brawling, Boxing or Karate. Nothing is added, and the row
        # never says the skill needs a point.
        for skill, attack, level in [("Karate", "Punch", 14), ("Brawling", "Kick", 12),
                                     ("Boxing", "Punch (left)", 14), ("Wrestling", "Grapple", 14),
                                     ("Karate", "Bite", 14)]:
            got, after = run(SHEET, skill, "--for", attack, "--write")
            self.assertEqual(got.returncode, 0, got.stderr)
            self.assertTrue(got.stdout.startswith("UNARMED\t"), got.stdout)
            self.assertIn(f"{attack} rolls against DX", got.stdout)
            self.assertIn(f"{level} without {skill}", got.stdout)
            self.assertNotIn("1 point", got.stdout)
            self.assertEqual(after, SHEET)

    def test_a_no_default_skill_for_a_weapon_still_needs_a_point(self):
        got, _after = run(SHEET, "Karate", "--for", "Nunchaku")
        self.assertTrue(got.stdout.startswith("NO-DEFAULT\t"), got.stdout)

    def test_an_unarmed_attack_with_a_skill_that_has_a_default_adds_it(self):
        # Only a skill with no default is skipped for an unarmed attack.
        got, _after = run(SHEET, "Knife", "--for", "Punch")
        self.assertTrue(got.stdout.startswith("WOULD-ADD\t"), got.stdout)

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

    def test_a_specialty_defaults_from_a_bought_sibling_in_the_tables(self):
        # B198: Guns specialties at -2 from each other, -4 to or from GL,
        # Gyroc and LAW; B179: Beam Weapons (Pistol) from Guns (Pistol)-4.
        cases = [("Guns (Rifle)", "| Guns (Rifle) | DX/E | DX+0 | [0] | 14 | 14 |",
                  "Guns (Pistol)-2"),
                 ("Guns (Gyroc)", "| Guns (Gyroc) | DX/E | DX-2 | [0] | 12 | 12 |",
                  "Guns (Pistol)-4"),
                 ("Beam Weapons (Pistol)", "| Beam Weapons (Pistol) | DX/E | "
                  "DX-2 | [0] | 12 | 12 |", "Guns (Pistol)-4")]
        for skill, row, source in cases:
            kind, msg, _new = gsd.plan(SHEET, skill)
            self.assertEqual(kind, "WOULD-ADD", msg)
            self.assertIn(row, msg)
            self.assertIn(f"(default {source},", msg)

    def test_a_specialty_the_tables_give_no_sibling_default_asks(self):
        # Gunner's defaults between specialties are not in the tables.
        sheet = SHEET.replace("| Guns (Pistol) |",
                              "| Gunner (Beams) | DX/E | DX+0 | [1] | 14 | 14 |\n"
                              "| Guns (Pistol) |")
        got, after = run(sheet, "Gunner (Cannon)", "--write")
        self.assertEqual(got.returncode, 1)
        self.assertTrue(got.stdout.startswith("CHECK-DEFAULT\t"), got.stdout)
        self.assertIn("gunner (beams) at 14", got.stdout)
        self.assertEqual(after, sheet)
        got, after = run(sheet, "Gunner (Cannon)", "--difficulty", "DX/E",
                         "--default", "DX-4, Gunner (Beams)-4", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertIn("| Gunner (Cannon) | DX/E | DX-4 | [0] | 10 | 10 |", after)

    def test_a_list_of_specialties_is_one_default_each(self):
        self.assertEqual(gsd._terms("DX-4, Guns (Pistol or Rifle)-2, Axe/Mace-3"),
                         ["DX-4", "Guns (Pistol)-2", "Guns (Rifle)-2", "Axe/Mace-3"])

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

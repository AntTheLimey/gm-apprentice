#!/usr/bin/env python3
"""gurps_skill_default.py: a skill the sheet lacks is added at its default
level for 0 points (#571); one with no default is not."""

import os
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
        got, after_karate = run(SHEET, "Karate", "--write")
        self.assertIn("Karate has no default (B173): it can't be used "
                      "until at least 1 point is spent on it", got.stdout)
        self.assertEqual(after, SHEET)
        self.assertEqual(after_karate, SHEET)

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

    # Review A2/B: a sheet writes tech-level skills with /TL<n>, as the
    # publish tool reads them (tohit-data.js drops it).
    def test_a_tech_level_name_is_the_same_skill(self):
        sheet = SHEET.replace("| Guns (Pistol) |", "| Guns/TL8 (Pistol) |")
        kind, msg, _new = gsd.plan(sheet, "Guns (Pistol)")
        self.assertEqual((kind, msg), ("HAVE", "Guns (Pistol) is in the Skills table already, at 16"))
        kind, msg, new = gsd.plan(sheet, "Guns (Rifle)")
        self.assertEqual(kind, "WOULD-ADD", msg)
        self.assertIn("| Guns/TL8 (Rifle) | DX/E | DX+0 | [0] | 14 | 14 | (default Guns (Pistol)-2, level 14)", msg)
        self.assertIn("| Guns/TL8 (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |\n| Guns/TL8 (Rifle) |", new)
        beams = SHEET.replace("| Guns (Pistol) | DX/E | DX+2 | [4] | 16 | 16 |",
                              "| Beam Weapons/TL11 (Pistol) | DX/E | DX+1 | [2] | 15 | 15 |")
        self.assertEqual(gsd.plan(beams, "Beam Weapons/TL11 (Pistol)")[0], "HAVE")
        kind, msg, _new = gsd.plan(beams, "Beam Weapons (Rifle)")
        self.assertIn("| Beam Weapons/TL11 (Rifle) | DX/E | DX-3 | [0] | 11 | 11 | (default Beam Weapons (Pistol)-4, level 11)", msg)

    def test_another_tech_level_is_another_skill(self):
        # B168/B513: a tech skill at another TL is a separate skill that
        # defaults to the known one at a TL penalty the tables do not hold,
        # so it is neither HAVE nor a silent default; asked for instead.
        sheet = SHEET.replace("| Guns (Pistol) |", "| Guns/TL5 (Pistol) |")
        with self.assertRaises(gsd.Refused) as caught:
            gsd.plan(sheet, "Guns/TL8 (Pistol)")
        kind, msg = caught.exception.args
        self.assertEqual(kind, "CHECK-DEFAULT", msg)
        self.assertIn("another tech level of Guns/TL5 (Pistol) at 16", msg)
        self.assertIn("B168", msg)
        # A sibling at another TL is no base: that is a default of a default.
        kind, msg, _new = gsd.plan(sheet, "Guns/TL8 (Rifle)")
        self.assertIn("(default DX-4, level 10; Guns/TL5 (Pistol) is another "
                      "tech level, so no base for this default (B168, B173))", msg)
        # Given by hand, a default from the other TL is used as written.
        kind, msg, _new = gsd.plan(sheet, "Guns/TL8 (Pistol)", "DX/E",
                                   "DX-4, Guns/TL5 (Pistol)-4")
        self.assertIn("| Guns/TL8 (Pistol) | DX/E | DX-2 | [0] | 12 | 12 | "
                      "(default Guns/TL5 (Pistol)-4, level 12)", msg)
        # The same TL, or a name with none, is the same skill.
        self.assertEqual(gsd.plan(sheet, "Guns/TL5 (Pistol)")[0], "HAVE")
        self.assertEqual(gsd.plan(sheet, "Guns (Pistol)")[0], "HAVE")

    def test_a_level_column_beside_relative_level_is_written(self):
        # The publish tool reads a Level column that is not Relative Level
        # (parse.js resolveLevelColumns), so the new row fills it.
        sheet = (SHEET.replace("| Name | Difficulty | Relative Level | Points | Base | Current |",
                               "| Name | Difficulty | Relative Level | Points | Level |")
                 .replace("|------|-----------|----------------|--------|------|---------|", "|---|---|---|---|---|")
                 .replace("| 16 | 16 |", "| 16 |").replace("| 15 | 15 |", "| 15 |")
                 .replace("| 10 | 10 |", "| 10 |"))
        _p, msg, _new = gsd.plan(sheet, "Knife")
        self.assertIn("| Knife | DX/E | DX-2 | [0] | 12 | (default Shortsword-3", msg)
        self.assertIn("at 15", gsd.plan(sheet, "Shortsword")[1])

    def test_short_names_sheets_write(self):
        # Review A9: Shield and Guns (LAW) are found; Guns (LMG) bought is
        # Guns (Light Machine Gun) to a default.
        self.assertEqual(gsd.plan(SHEET, "Shield")[0], "WOULD-ADD")
        self.assertIn("| Guns (LAW) | DX/E |", gsd.plan(SHEET, "Guns (LAW)")[1])
        sheet = SHEET.replace("| Guns (Pistol) |", "| Guns (LMG) |")
        self.assertIn("(default Guns (Light Machine Gun)-2, level 14)", gsd.plan(sheet, "Guns (Rifle)")[1])

    def test_an_unarmed_attack_takes_the_best_unarmed_skill_bought(self):
        # Review A6: B271, a punch at the best of DX, Boxing, Brawling and
        # Karate; a kick at the best of DX, Brawling and Karate, less 2. The
        # cell to write is one the to-hit calculator reads as a level (A7).
        sheet = SHEET.replace("| Guns (Pistol) |", "| Brawling | DX/E | DX+1 | [2] | 15 | 15 |\n| Guns (Pistol) |")
        kind, msg, _new = gsd.plan(sheet, "Karate", attack="Kick")
        self.assertEqual(kind, "UNARMED")
        self.assertEqual(msg, 'Kick rolls against Brawling-2 = 13 without Karate; write the Skill cell as "Brawling 13"; nothing is added')
        self.assertEqual(gsd.plan(sheet, "Karate", attack="Punch")[1],
                         'Punch rolls against Brawling 15 without Karate; write the Skill cell as "Brawling 15"; nothing is added')
        self.assertEqual(gsd.plan(SHEET, "Karate", attack="Kick")[1],
                         'Kick rolls against DX-2 = 12 without Karate; write the Skill cell as "DX 12"; nothing is added')

    def test_with_no_points_column_only_attribute_defaults_are_used(self):
        # Review B: with no Points column a default-only row cannot be told
        # from a bought one (B173), so no skill is a base, and that is said.
        sheet = (SHEET.replace("| Name | Difficulty | Relative Level | Points | Base | Current |",
                               "| Name | Difficulty | Relative Level | Base | Current |")
                 .replace("|------|-----------|----------------|--------|------|---------|", "|---|---|---|---|---|")
                 .replace(" [4] |", "").replace(" [0] |", ""))
        msg = gsd.plan(sheet, "Broadsword")[1]
        self.assertIn("(default DX-5, level 9; the Skills table has no Points column, so only attribute defaults are used)", msg)

    def test_a_stand_in_and_a_missing_attribute_are_said(self):
        sheet = SHEET.replace("| Will | 13 |\n", "").replace("| Per | 12 |\n", "").replace("| HT | 11 | +1 | 10 |\n", "")
        msg = gsd.plan(sheet, "Lookout", "Per/A", "Per-5")[1]
        self.assertIn("(default Per-5, level 7; Per taken as IQ: the sheet lists no Per)", msg)
        msg = gsd.plan(sheet, "Running", "HT/A", "DX-5")[1]
        self.assertIn("| Running | HT/A |  | [0] | 9 | 9 |", msg)
        self.assertIn("Relative Level left blank: the sheet lists no HT", msg)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0,
                     "root ignores directory permission bits")
    def test_a_sheet_that_cannot_be_written_is_a_row(self):
        d = Path(tempfile.mkdtemp(prefix="gsd-"))
        try:
            sheet = d / "Ann_Vole.md"
            sheet.write_text(SHEET, encoding="utf-8")
            d.chmod(0o500)
            got = subprocess.run([sys.executable, str(SCRIPTS / "gurps_skill_default.py"), str(sheet), "Knife", "--write"],
                                 capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(got.returncode, 1, got.stderr)
            self.assertTrue(got.stdout.startswith("CANNOT\t"), got.stdout)
            self.assertIn("could not write the sheet", got.stdout)
            self.assertNotIn("Traceback", got.stderr)
        finally:
            d.chmod(0o700)
            shutil.rmtree(d, ignore_errors=True)

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
        # Thrown Weapon's defaults between most specialties are not in the
        # tables (only Harpoon and Spear, B226).
        sheet = SHEET.replace("| Guns (Pistol) |",
                              "| Thrown Weapon (Axe/Mace) | DX/E | DX+0 | [1] | 14 | 14 |\n"
                              "| Guns (Pistol) |")
        got, after = run(sheet, "Thrown Weapon (Knife)", "--write")
        self.assertEqual(got.returncode, 1)
        self.assertTrue(got.stdout.startswith("CHECK-DEFAULT\t"), got.stdout)
        self.assertIn("thrown weapon (axe/mace) at 14", got.stdout)
        self.assertEqual(after, sheet)
        got, after = run(sheet, "Thrown Weapon (Knife)", "--difficulty", "DX/E",
                         "--default", "DX-4", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertIn("| Thrown Weapon (Knife) | DX/E | DX-4 | [0] | 10 | 10 |", after)

    def test_gunner_specialties_and_artillery(self):
        # B198: Gunner specialties at -4 from each other. B178: Artillery's
        # specialties give no default to each other, so nothing is asked.
        sheet = SHEET.replace("| Guns (Pistol) |",
                              "| Artillery (Cannon) | IQ/A | IQ+0 | [2] | 12 | 12 |\n"
                              "| Gunner (Beams) | DX/E | DX+0 | [1] | 14 | 14 |\n"
                              "| Guns (Pistol) |")
        self.assertIn("(default DX-4, level 10)", gsd.plan(sheet, "Gunner (Cannon)")[1])
        sheet = sheet.replace("| Gunner (Beams) | DX/E | DX+0 | [1] | 14 | 14 |", "| Gunner (Beams) | DX/E | DX+3 | [8] | 17 | 17 |")
        self.assertIn("(default Gunner (Beams)-4, level 13)", gsd.plan(sheet, "Gunner (Cannon)")[1])
        kind, msg, _new = gsd.plan(sheet, "Artillery (Bombs)")
        self.assertEqual(kind, "WOULD-ADD", msg)
        self.assertIn("(default IQ-5, level 7)", msg)

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

#!/usr/bin/env python3
"""Regression tests for rules_lookup.py — record-level lookup over systems/.

Most assertions run against the invented miniature corpus in
`tests/fixtures/slice-b/systems/`, which exercises every record shape the
parser knows: pipe tables, bold-lead blocks (both bullet and column-0),
and `### Title` stat blocks. Nothing in that fixture tree is copied from
a rulebook.

One class runs against the real `skills/ttrpg-expert/systems/` corpus. It
asserts only that a well-known name resolves and which file it came from
— never the text of a record — so no licensed content lands in this file.

Run: python3 tests/test_rules_lookup.py
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import rules_lookup as rl  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "slice-b" / "systems"
SCRIPT = SCRIPTS / "rules_lookup.py"


def run_cli(*args):
    """Run rules_lookup.py the way a skill does, so the exit code is real."""
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True)


def line_of(rel_path, prefix):
    """1-based line number of the first line in a fixture starting with
    `prefix` — so line assertions track the fixture instead of a magic
    number."""
    text = (FIX / rel_path).read_text(encoding="utf-8")
    for i, line in enumerate(text.splitlines(), start=1):
        if line.startswith(prefix):
            return i
    raise AssertionError(f"no line starting {prefix!r} in {rel_path}")


class TableRecords(unittest.TestCase):
    def test_table_row_exact(self):
        mode, recs = rl.lookup("Absolute Timing", system="gurps-4e",
                               systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        rec = recs[0]
        self.assertEqual(rec.name, "Absolute Timing")
        self.assertEqual(rec.file, "gurps-4e/traits-mental.md")
        self.assertEqual(rec.headers[1], "Cost")
        self.assertEqual(rec.cells[1], "2")
        self.assertIn("Cost=2", rec.summary())
        self.assertEqual(
            rec.line,
            line_of("gurps-4e/traits-mental.md", "| Absolute Timing |"))

    def test_kind_from_stem(self):
        kinds = {}
        for rec in rl.iter_records(FIX):
            kinds.setdefault(rec.file, set()).add(rec.kind)
        self.assertEqual(kinds["gurps-4e/traits-mental.md"], {"trait"})
        self.assertEqual(kinds["gurps-4e/skills-combat.md"], {"skill"})
        self.assertEqual(kinds["coc-7e/creatures.md"], {"monster"})
        self.assertEqual(kinds["dnd-5e-2024/spells-1.md"], {"spell"})

    def test_header_and_separator_rows_are_not_records(self):
        names = {r.name for r in rl.iter_records(FIX, systems=["gurps-4e"])}
        self.assertNotIn("Trait", names)
        self.assertNotIn("Skill", names)
        self.assertNotIn("-------", names)

    def test_parenthetical_strip(self):
        mode, recs = rl.lookup("fast-draw", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual({r.name for r in recs},
                         {"Fast-Draw (Sword)", "Fast-Draw (Bandage)"})


class BlockRecords(unittest.TestCase):
    def test_bold_lead_block_dnd_monster(self):
        mode, recs = rl.lookup("Commoner", system="dnd-5e-2024",
                               systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        rec = recs[0]
        lines = rec.text.split("\n")
        self.assertGreaterEqual(len(lines), 3)
        self.assertTrue(lines[0].startswith("**Commoner**"))
        self.assertEqual(rec.summary(), lines[1])
        self.assertEqual(rec.headers, [])
        self.assertEqual(rec.cells, [])

    def test_dnd_spell_bullet(self):
        mode, recs = rl.lookup("Alarm", system="dnd-5e-2024", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0].name, "Alarm")
        self.assertEqual(recs[0].kind, "spell")

    def test_pf2e_dash_lead(self):
        names = {r.name for r in rl.iter_records(FIX, systems=["pf2e"])}
        self.assertIn("Ghoul Soldier", names)
        self.assertFalse([n for n in names if n.startswith("Legend")])

    def test_h3_block_coc_creature(self):
        mode, recs = rl.lookup("Bear", system="coc-7e", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        rec = recs[0]
        self.assertEqual(rec.name, "Bear")
        self.assertEqual(rec.kind, "monster")
        self.assertTrue(rec.text.startswith("STR "), rec.text[:40])
        self.assertEqual(rec.summary(), rec.text.split("\n")[0])


class MatchTiers(unittest.TestCase):
    def test_substring_then_fuzzy(self):
        mode, recs = rl.lookup("Timing", systems_dir=FIX)
        self.assertEqual(mode, "substring")
        self.assertIn("Absolute Timing", {r.name for r in recs})

        mode, recs = rl.lookup("Absolut Timming", systems_dir=FIX)
        self.assertEqual(mode, "fuzzy")
        self.assertEqual(recs[0].name, "Absolute Timing")

        self.assertEqual(rl.lookup("zzzz", systems_dir=FIX), ("none", []))

    def test_kind_filter(self):
        mode, recs = rl.lookup("Bracketwork", kind="trait", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        mode, recs = rl.lookup("Bracketwork", kind="skill", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].kind, "skill")


class Gating(unittest.TestCase):
    def test_variant_gating(self):
        mode, recs = rl.lookup("Cartography", system="coc-7e", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        self.assertEqual([r for r in recs if r.system == "coc-7e/regency"], [])

        mode, recs = rl.lookup("Cartography", system="coc-7e",
                               variant="regency", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].system, "coc-7e/regency")
        self.assertEqual(recs[0].file, "coc-7e/variants/regency/skills.md")

    def test_personal_excluded_by_default(self):
        self.assertNotIn("Secret Trait",
                         {r.name for r in rl.iter_records(FIX)})
        self.assertIn("Secret Trait",
                      {r.name for r in rl.iter_records(FIX, personal=True)})

        mode, _ = rl.lookup("Secret Trait", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        mode, recs = rl.lookup("Secret Trait", systems_dir=FIX, personal=True)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].cells[1], "99")


class Cli(unittest.TestCase):
    def test_cli_output_and_exit(self):
        hit = run_cli("gurps-4e", "Absolute Timing", "--systems-dir", str(FIX))
        self.assertEqual(hit.returncode, 0, hit.stderr)
        self.assertEqual(hit.stderr, "")
        lines = hit.stdout.rstrip("\n").split("\n")
        self.assertEqual(lines[0], "# match: exact (1)")
        self.assertEqual(len(lines), 2)
        fields = lines[1].split("\t")
        self.assertEqual(len(fields), 5)
        self.assertEqual(fields[0], "Absolute Timing")
        self.assertEqual(fields[1], "gurps-4e")
        self.assertEqual(fields[2], "trait")
        self.assertTrue(fields[3].startswith("gurps-4e/traits-mental.md:"))
        self.assertIn("Cost=2", fields[4])

        miss = run_cli("gurps-4e", "zzzz", "--systems-dir", str(FIX))
        self.assertEqual(miss.returncode, 1)
        self.assertEqual(miss.stdout.strip(), "# match: none")

    def test_cli_all_and_json(self):
        out = run_cli("all", "Ghoul Soldier", "--systems-dir", str(FIX),
                      "--json")
        self.assertEqual(out.returncode, 0, out.stderr)
        payload = json.loads(out.stdout)
        self.assertEqual(len(payload), 1)
        self.assertEqual(sorted(payload[0]),
                         ["cells", "file", "headers", "kind", "line", "name",
                          "system", "text"])
        self.assertEqual(payload[0]["system"], "pf2e")

    def test_cli_block_text_is_indented(self):
        out = run_cli("dnd-5e-2024", "Commoner", "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 0, out.stderr)
        body = out.stdout.split("\n")[2:]
        self.assertTrue(body[0].startswith("  **Commoner**"), body[:2])


class RealCorpus(unittest.TestCase):
    """Presence-and-provenance only — never the text of a record."""

    def test_real_corpus_smoke(self):
        mode, recs = rl.lookup("Combat Reflexes", system="gurps-4e")
        self.assertEqual(mode, "exact")
        self.assertTrue([r for r in recs
                         if r.file.startswith("gurps-4e/traits-")],
                        sorted(r.file for r in recs))

        mode, _ = rl.lookup("Spot Hidden", system="coc-7e")
        self.assertEqual(mode, "exact")

        mode, recs = rl.lookup("Fireball", system="dnd-5e-2024", kind="spell")
        self.assertEqual(mode, "exact")
        self.assertTrue(all(r.kind == "spell" for r in recs))

    def test_real_corpus_record_count(self):
        self.assertGreater(len(list(rl.iter_records())), 5000)

    def test_real_corpus_skips_personal(self):
        self.assertFalse([r for r in rl.iter_records()
                          if "/personal/" in r.file])


if __name__ == "__main__":
    unittest.main(verbosity=2)

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
        mode, recs, _total = rl.lookup("Absolute Timing", system="gurps-4e",
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
        self.assertEqual(kinds["pf2e/ancestries.md"], {"ancestry"})

    def test_ancestries_stem_maps_to_ancestry_not_class(self):
        self.assertEqual(rl.kind_for_stem("ancestries"), "ancestry")
        mode, recs, _total = rl.lookup("Fixture-kin", system="pf2e",
                                       systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].kind, "ancestry")

    def test_header_and_separator_rows_are_not_records(self):
        names = {r.name for r in rl.iter_records(FIX, systems=["gurps-4e"])}
        self.assertNotIn("Trait", names)
        self.assertNotIn("Skill", names)
        self.assertNotIn("-------", names)

    def test_parenthetical_strip(self):
        mode, recs, _total = rl.lookup("fast-draw", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual({r.name for r in recs},
                         {"Fast-Draw (Sword)", "Fast-Draw (Bandage)"})


class BlockRecords(unittest.TestCase):
    def test_bold_lead_block_dnd_monster(self):
        mode, recs, _total = rl.lookup("Commoner", system="dnd-5e-2024",
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
        mode, recs, _total = rl.lookup("Alarm", system="dnd-5e-2024", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0].name, "Alarm")
        self.assertEqual(recs[0].kind, "spell")

    def test_pf2e_dash_lead(self):
        names = {r.name for r in rl.iter_records(FIX, systems=["pf2e"])}
        self.assertIn("Ghoul Soldier", names)
        self.assertFalse([n for n in names if n.startswith("Legend")])

    def test_h3_block_coc_creature(self):
        mode, recs, _total = rl.lookup("Bear", system="coc-7e", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(len(recs), 1)
        rec = recs[0]
        self.assertEqual(rec.name, "Bear")
        self.assertEqual(rec.kind, "monster")
        self.assertTrue(rec.text.startswith("STR "), rec.text[:40])
        self.assertEqual(rec.summary(), rec.text.split("\n")[0])


class MatchTiers(unittest.TestCase):
    def test_substring_then_fuzzy(self):
        mode, recs, _total = rl.lookup("Timing", systems_dir=FIX)
        self.assertEqual(mode, "substring")
        self.assertIn("Absolute Timing", {r.name for r in recs})

        mode, recs, _total = rl.lookup("Absolut Timming", systems_dir=FIX)
        self.assertEqual(mode, "fuzzy")
        self.assertEqual(recs[0].name, "Absolute Timing")

        self.assertEqual(rl.lookup("zzzz", systems_dir=FIX), ("none", [], 0))

    def test_kind_filter(self):
        mode, recs, _total = rl.lookup("Bracketwork", kind="trait", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        mode, recs, _total = rl.lookup("Bracketwork", kind="skill", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].kind, "skill")

    def test_weak_tier_matches_text_not_just_name(self):
        """A multi-word query with no record name containing the whole
        phrase still hits, via the weak "mentions" tier, before fuzzy."""
        mode, recs, total = rl.lookup("fire damage", systems_dir=FIX)
        self.assertEqual(mode, "weak")
        self.assertEqual(total, 1)
        self.assertEqual(recs[0].name, "Ember Reach")

        mode, recs, _total = rl.lookup("desperate position", systems_dir=FIX)
        self.assertEqual(mode, "weak")
        self.assertEqual(recs[0].name, "Overwatch")

    def test_weak_tier_word_order_independent(self):
        mode, recs, _total = rl.lookup("position desperate", systems_dir=FIX)
        self.assertEqual(mode, "weak")
        self.assertEqual(recs[0].name, "Overwatch")

    def test_weak_tier_reported_in_header(self):
        mode, recs, total = rl.lookup("fire damage", systems_dir=FIX)
        text = rl.render(mode, recs, total=total, term="fire damage")
        header = text.splitlines()[0]
        self.assertTrue(header.startswith("# match: weak ("))
        self.assertIn('"fire damage"', header)
        self.assertIn("not a record name", header)

    def test_weak_tier_body_text_is_not_stemmed(self):
        """A record whose text says "fires" (not "fire") must not match
        a query for "fire" — body text is matched literally, never
        stemmed, unlike the query and name tokens (#C1)."""
        mode, recs, _total = rl.lookup("fire", systems_dir=FIX)
        names = {r.name for r in recs}
        self.assertNotIn("Cannon Volley", names)

    def test_weak_tier_body_matches_unfolded_query_word(self):
        """The plural fold on query tokens ("bonus" -> "bonu") must not
        stop a body-text match on the exact word "bonus"."""
        mode, recs, _total = rl.lookup("circumstance bonus",
                                       system="pf2e")
        self.assertEqual(mode, "weak")
        # Before the fix only a record named "Circumstance" matched.
        self.assertIn("Aid", {r.name for r in recs})

    def test_exact_wins_over_word_tiers(self):
        """A query that would also satisfy a word tier still reports as
        exact, because exact is checked first and short-circuits."""
        mode, recs, _total = rl.lookup("Absolute Timing", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].name, "Absolute Timing")

    def test_no_record_named_a_bare_number(self):
        """A level-progression table's numeric first column (D&D Rogue's
        `| 1 | ... |`) must never become a record name (#C1)."""
        names = {r.name for r in rl.iter_records(FIX, systems=["dnd-5e-2024"])}
        self.assertNotIn("1", names)
        self.assertNotIn("2", names)
        self.assertNotIn("3", names)


class Gating(unittest.TestCase):
    def test_variant_gating(self):
        mode, recs, _total = rl.lookup("Cartography", system="coc-7e", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        self.assertEqual([r for r in recs if r.system == "coc-7e/regency"], [])

        mode, recs, _total = rl.lookup("Cartography", system="coc-7e",
                               variant="regency", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].system, "coc-7e/regency")
        self.assertEqual(recs[0].file, "coc-7e/variants/regency/skills.md")

    def test_personal_excluded_by_default(self):
        self.assertNotIn("Secret Trait",
                         {r.name for r in rl.iter_records(FIX)})
        self.assertIn("Secret Trait",
                      {r.name for r in rl.iter_records(FIX, personal=True)})

        mode, _, _total = rl.lookup("Secret Trait", systems_dir=FIX)
        self.assertNotEqual(mode, "exact")
        mode, recs, _total = rl.lookup("Secret Trait", systems_dir=FIX, personal=True)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].cells[1], "99")


class ParenAndDashLeads(unittest.TestCase):
    """I1: a parenthetical, or an ASCII '--' dash, after a bold lead still
    introduces a record (`**Spot Hidden** (25%) — ...`); a colon label
    still doesn't (`**Detective:** Spot Hidden 60%`)."""

    def test_parenthetical_lead_is_a_record(self):
        mode, recs, _total = rl.lookup("Spot Hidden", system="coc-7e",
                                       kind="skill", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].name, "Spot Hidden")

    def test_ascii_dash_lead_is_a_record(self):
        mode, recs, _total = rl.lookup("Mechanical Identity", system="coc-7e",
                                       kind="skill", systems_dir=FIX)
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].name, "Mechanical Identity")

    def test_colon_label_is_not_a_record(self):
        names = {r.name for r in rl.iter_records(FIX, systems=["coc-7e"])}
        self.assertNotIn("Detective:", names)


class ExactCountAndLimit(unittest.TestCase):
    """M4: the header count reflects the true exact-tier total, not the
    post-slice, substring-mixed list, and says when --limit suppressed
    some of it."""

    def test_exact_count_not_inflated_by_substring(self):
        mode, recs, total = rl.lookup("fast-draw", systems_dir=FIX, limit=1)
        self.assertEqual(mode, "exact")
        self.assertEqual(total, 2)
        self.assertEqual(len(recs), 1)
        text = rl.render(mode, recs, total=total)
        self.assertIn("# match: exact (2)", text)
        self.assertIn("showing 1", text)
        self.assertIn("1 suppressed by --limit", text)

    def test_no_suppression_note_when_everything_shown(self):
        mode, recs, total = rl.lookup("fast-draw", systems_dir=FIX)
        text = rl.render(mode, recs, total=total)
        self.assertEqual(text.splitlines()[0], "# match: exact (2)")
        self.assertNotIn("suppressed", text)


class BlankTerm(unittest.TestCase):
    """M5: a blank term must never dump the corpus."""

    def test_blank_term_matches_nothing(self):
        self.assertEqual(rl.lookup("", systems_dir=FIX), ("none", [], 0))
        self.assertEqual(rl.lookup("   ", systems_dir=FIX), ("none", [], 0))

    def test_cli_rejects_blank_term(self):
        out = run_cli("gurps-4e", "", "--limit", "400",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 2)
        self.assertIn("error: blank lookup term", out.stderr)
        self.assertEqual(out.stdout, "")


class KindFallback(unittest.TestCase):
    """I2: a --kind filter that matches nothing retries without it and
    says so, instead of reporting the rule doesn't exist at all."""

    def test_kind_miss_falls_back_and_says_so(self):
        out = run_cli("gurps-4e", "Bracketwork", "--kind", "trait",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 1)
        self.assertIn("# match: none for kind=trait", out.stdout)
        self.assertIn("Bracketwork", out.stdout)

    def test_kind_hit_has_no_fallback_note(self):
        out = run_cli("gurps-4e", "Bracketwork", "--kind", "skill",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("fallback", out.stdout)
        self.assertNotIn("closest without it", out.stdout)

    def test_kind_miss_falls_back_in_json_too(self):
        out = run_cli("gurps-4e", "Bracketwork", "--kind", "trait",
                      "--systems-dir", str(FIX), "--json")
        self.assertEqual(out.returncode, 1, out.stderr)
        payload = json.loads(out.stdout)
        self.assertEqual(payload["match"], "none")
        self.assertEqual(payload["kind_fallback"], "exact")
        records = payload["records"]
        self.assertTrue(records, "the text mode shows the fallback rows; "
                                 "--json must not print an empty array here")
        self.assertTrue(any(rec["name"] == "Bracketwork" for rec in records))


class SystemAliases(unittest.TestCase):
    """I#: an alias like `gurps` resolves to the real slug `gurps-4e`
    instead of being treated as an unknown, silently-empty system; a
    genuinely unknown slug is a reported error, not "no such rule"."""

    def test_alias_resolves_to_real_slug(self):
        self.assertEqual(rl.resolve_system("gurps", FIX), "gurps-4e")
        self.assertEqual(rl.resolve_system("gurps4e", FIX), "gurps-4e")
        self.assertEqual(rl.resolve_system("dnd", FIX), "dnd-5e-2024")
        self.assertEqual(rl.resolve_system("5e", FIX), "dnd-5e-2024")
        self.assertEqual(rl.resolve_system("d&d", FIX), "dnd-5e-2024")
        self.assertEqual(rl.resolve_system("pf2", FIX), "pf2e")
        self.assertEqual(rl.resolve_system("pathfinder", FIX), "pf2e")
        self.assertEqual(rl.resolve_system("coc", FIX), "coc-7e")
        self.assertEqual(rl.resolve_system("cthulhu", FIX), "coc-7e")
        self.assertIsNone(rl.resolve_system("nope-not-a-system", FIX))

    def test_alias_hits_via_cli(self):
        out = run_cli("gurps", "Absolute Timing", "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Absolute Timing", out.stdout)

    def test_unknown_system_exits_2_with_slug_list(self):
        out = run_cli("nope-not-a-system", "Absolute Timing",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 2)
        self.assertIn("unknown system", out.stderr)
        # every real slug under the fixture corpus is listed
        for slug in rl.list_systems(FIX):
            self.assertIn(slug, out.stderr)
        self.assertIn("all", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_list_systems_reads_the_directory(self):
        self.assertEqual(rl.list_systems(FIX),
                         ["coc-7e", "dnd-5e-2024", "gurps-4e", "pf2e"])

    def test_system_resolution_is_case_insensitive(self):
        self.assertEqual(rl.resolve_system("GURPS-4E", FIX), "gurps-4e")
        self.assertEqual(rl.resolve_system("Gurps", FIX), "gurps-4e")

    def test_variant_suffix_via_cli(self):
        """`coc-7e/regency` as the system argument implies `--variant
        regency` instead of erroring as an unknown system (#C1)."""
        out = run_cli("coc-7e/regency", "Cartography",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Cartography", out.stdout)
        self.assertIn("coc-7e/regency", out.stdout)

    def test_unknown_variant_suffix_exits_2(self):
        out = run_cli("coc-7e/not-a-real-variant", "Cartography",
                      "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 2)
        self.assertIn("unknown variant", out.stderr)


class BadSystemsDir(unittest.TestCase):
    """I4: a wrong or missing corpus path is a reported error, not an
    indistinguishable "no such rule"."""

    def test_missing_systems_dir_is_an_error(self):
        out = run_cli("all", "Combat Reflexes", "--systems-dir",
                      "/nonexistent/gm-apprentice-test-path")
        self.assertEqual(out.returncode, 2)
        self.assertIn("error: no systems directory at", out.stderr)
        self.assertEqual(out.stdout, "")


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
        self.assertEqual(payload["match"], "exact")
        self.assertEqual(payload["total"], 1)
        records = payload["records"]
        self.assertEqual(len(records), 1)
        self.assertEqual(sorted(records[0]),
                         ["cells", "file", "headers", "kind", "line", "name",
                          "system", "text"])
        self.assertEqual(records[0]["system"], "pf2e")

    def test_cli_all_case_insensitive(self):
        for spelling in ("all", "ALL", "All"):
            out = run_cli(spelling, "Ghoul Soldier", "--systems-dir", str(FIX))
            self.assertEqual(out.returncode, 0, (spelling, out.stderr))
            self.assertIn("Ghoul Soldier", out.stdout)

    def test_cli_block_text_is_indented(self):
        out = run_cli("dnd-5e-2024", "Commoner", "--systems-dir", str(FIX))
        self.assertEqual(out.returncode, 0, out.stderr)
        body = out.stdout.split("\n")[2:]
        self.assertTrue(body[0].startswith("  **Commoner**"), body[:2])


class NoticeFile(unittest.TestCase):
    """A system's NOTICE.md is licence text, never a rules record."""

    def test_notice_md_is_not_indexed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            sysdir = Path(tmp) / "gurps-4e"
            sysdir.mkdir()
            table = "| Trait | Cost | Page |\n|---|---|---|\n| Alpha | 5 | B1 |\n"
            (sysdir / "traits.md").write_text("# Traits\n\n" + table)
            (sysdir / "NOTICE.md").write_text("# Notice\n\n" + table.replace("Alpha", "Beta"))
            names = {r.name for r in rl.iter_records(Path(tmp))}
            self.assertEqual(names, {"Alpha"})
            mode, _, _total = rl.lookup("Beta", systems_dir=Path(tmp))
            self.assertNotEqual(mode, "exact")


class RealCorpus(unittest.TestCase):
    """Presence-and-provenance only — never the text of a record."""

    def test_real_corpus_smoke(self):
        mode, recs, _total = rl.lookup("Combat Reflexes", system="gurps-4e")
        self.assertEqual(mode, "exact")
        self.assertTrue([r for r in recs
                         if r.file.startswith("gurps-4e/traits-")],
                        sorted(r.file for r in recs))

        mode, _, _total = rl.lookup("Spot Hidden", system="coc-7e")
        self.assertEqual(mode, "exact")
        # The prose (ttrpg-expert/SKILL.md, session-play/SKILL.md) tells the
        # model to pass --kind, so the lookup must resolve with it too.
        mode, recs, _total = rl.lookup("Spot Hidden", system="coc-7e",
                                       kind="skill")
        self.assertEqual(mode, "exact")
        self.assertTrue(any(r.name == "Spot Hidden" for r in recs))

        mode, recs, _total = rl.lookup("Fireball", system="dnd-5e-2024", kind="spell")
        self.assertEqual(mode, "exact")
        self.assertTrue(all(r.kind == "spell" for r in recs))

    def test_real_corpus_record_count(self):
        self.assertGreater(len(list(rl.iter_records())), 5000)

    def test_real_corpus_skips_notice_files(self):
        self.assertFalse([r for r in rl.iter_records()
                          if r.file.endswith("NOTICE.md")])

    def test_real_corpus_skips_personal(self):
        self.assertFalse([r for r in rl.iter_records()
                          if "/personal/" in r.file])

    def test_real_corpus_aliases_resolve(self):
        self.assertEqual(rl.resolve_system("gurps"), "gurps-4e")
        self.assertEqual(rl.resolve_system("dnd"), "dnd-5e-2024")
        self.assertEqual(rl.resolve_system("pf2"), "pf2e")
        self.assertEqual(rl.resolve_system("coc"), "coc-7e")
        self.assertEqual(rl.resolve_system("blades"), "fitd")

    def test_real_corpus_pf2e_ancestry_kind(self):
        mode, recs, _total = rl.lookup("Goblin", system="pf2e", kind="ancestry")
        self.assertEqual(mode, "exact")
        self.assertTrue(recs)
        self.assertTrue(all(r.kind == "ancestry" for r in recs))

    def test_real_corpus_fast_draw_normalises_to_exact(self):
        """#C1: "fast draw" (space) must exact-match "Fast-Draw" (hyphen)
        via normalisation, with the undecorated name shown first, not
        the misspelled-fuzzy or noisy words-tier hit it regressed to."""
        mode, recs, _total = rl.lookup("fast draw", system="gurps-4e")
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].name, "Fast-Draw")

    def test_real_corpus_off_guard_normalises_to_exact(self):
        mode, recs, _total = rl.lookup("off guard", system="pf2e")
        self.assertEqual(mode, "exact")
        self.assertEqual(recs[0].name, "Off-Guard")

    def test_real_corpus_fire_damage_weak_tier_quality(self):
        """#C1: the weak tier must surface Breathe Fire (named for one
        of the two words, text doesn't repeat the other) and must not
        surface Force Barrage (whose text says "Fires", not "fire" —
        no stemming of body text)."""
        mode, recs, _total = rl.lookup("fire damage", system="pf2e",
                                       kind="spell")
        names = {r.name for r in recs}
        self.assertEqual(mode, "weak")
        self.assertIn("Breathe Fire", names)
        self.assertNotIn("Force Barrage", names)

    def test_real_corpus_sneak_attack_no_numeric_junk(self):
        """#C1: the D&D Rogue level table's numeric first column must
        never surface as a record named "1"."""
        mode, recs, _total = rl.lookup("sneak attack", system="dnd-5e-2024")
        self.assertNotEqual(mode, "none")
        for rec in recs:
            self.assertFalse(rec.name.strip().isdigit(), rec.name)

    def test_real_corpus_variant_slug_via_cli(self):
        out = run_cli("coc-7e/regency", "Credit Rating")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Credit Rating", out.stdout)
        self.assertIn("coc-7e/regency", out.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)

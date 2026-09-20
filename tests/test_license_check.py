#!/usr/bin/env python3
"""Regression tests for scripts/license_check.py.

The GURPS benchmark runs against a small synthetic GCS library and the shingle
scan against a tiny synthetic corpus, so the suite needs none of the local
reference material and can run in CI.

Run: python3 tests/test_license_check.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import license_check as lc  # noqa: E402

SYSTEMS = "skills/ttrpg-expert/systems"

WEAPON_TABLE = (
    "| Weapon | Skill | TL | Dmg | Reach | Parry | Cost | Wt | ST | Page |\n"
    "|---|---|---|---|---|---|---|---|---|---|\n"
    "| Sword | Broadsword | 1 | sw+1 cut | 1 | 0 | $500 | 3 | 10 | B271 |\n"
)


def fake_gcs(root: Path, eqp_note_words: int = 40) -> Path:
    """A minimal GCS library: every field our mapped columns need, one row each."""
    lib = root / "gcs" / "Library"
    lib.mkdir(parents=True, exist_ok=True)
    weapon = {
        "defaults": [], "damage": {}, "reach": "1", "parry": "0", "block": "",
        "strength": "10", "accuracy": "1", "range": "1", "rate_of_fire": "1",
        "shots": "1", "bulk": "-1", "recoil": "1", "usage_notes": "n",
    }
    files = {
        "a.eqp": {"description": "x", "tech_level": "1", "base_value": "1",
                   "base_weight": "1", "reference": "B1", "features": [],
                   "local_notes": " ".join(["w"] * eqp_note_words), "weapons": [weapon]},
        "a.skl": {"name": "x", "difficulty": "A", "reference": "B1", "defaults": [],
                   "default": {}, "limit": 1, "local_notes": "short note",
                   "specialization": "s"},
        "a.spl": {"name": "x", "difficulty": "H", "casting_cost": "1", "duration": "1",
                   "reference": "B1", "prereqs": {}, "local_notes": "short"},
        "a.adq": {"name": "x", "base_points": 1, "points_per_level": 1, "cr": 12,
                   "reference": "B1", "local_notes": "a trait note of seven words"},
        "a.adm": {"name": "x", "cost_adj": "1", "reference": "B1", "local_notes": "n"},
    }
    for name, row in files.items():
        (lib / name).write_text(json.dumps({"version": 4, "rows": [row]}))
    return root / "gcs"


class Repo:
    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.gcs_root = fake_gcs(self.root)
        self.gcs = lc.load_gcs(self.gcs_root)
        assert self.gcs is not None

    def write(self, rel: str, text: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def gurps(self, name: str, text: str) -> tuple[list[str], list[lc.RulesTable]]:
        p = self.write(f"{SYSTEMS}/gurps-4e/{name}", text)
        assert self.gcs is not None
        found, review = lc.check_gurps_file(p, f"{SYSTEMS}/gurps-4e/{name}", self.gcs)
        return [str(f) for f in found], review

    def close(self) -> None:
        self.tmp.cleanup()


class GcsBenchmarkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.r = Repo()
        self.addCleanup(self.r.close)

    def test_columns_gcs_carries_pass_at_any_row_count(self) -> None:
        rows = WEAPON_TABLE + "".join([WEAPON_TABLE.splitlines()[2] + "\n"] * 500)
        msgs, review = self.r.gurps("a.md", rows)
        self.assertEqual((msgs, review), ([], []))

    def test_column_gcs_lacks_is_flagged_with_its_line(self) -> None:
        text = (
            WEAPON_TABLE.replace("| Page |", "| Page | Full Rules Text |", 1)
            .replace("|---|\n", "|---|---|\n", 1)
            .replace("| B271 |", "| B271 | text |")
        )
        msgs, _ = self.r.gurps("a.md", "# T\n\n" + text)
        self.assertEqual(len(msgs), 1)
        self.assertIn("a.md:3:", msgs[0])
        self.assertIn('"Full Rules Text"', msgs[0])

    def test_note_over_gcs_maximum_is_flagged(self) -> None:
        note = " ".join(["w"] * 41)  # fake GCS eqp maximum is 40
        text = f"| Item | TL | Cost | Wt | Page | Notes |\n|---|---|---|---|---|---|\n| A | 1 | $1 | 1 | B1 | {note} |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn("41 words", msgs[0])
        self.assertIn("longest GCS eqp note is 40", msgs[0])

    def test_note_at_gcs_maximum_passes(self) -> None:
        note = " ".join(["w"] * 40)
        text = f"| Item | TL | Cost | Wt | Page | Notes |\n|---|---|---|---|---|---|\n| A | 1 | $1 | 1 | B1 | {note} |\n"
        self.assertEqual(self.r.gurps("a.md", text)[0], [])

    def test_note_limit_is_per_kind_of_data(self) -> None:
        # GCS skill notes max out at 2 words in the fake library.
        note = " ".join(["w"] * 5)
        text = f"| Skill | Diff | Page | Defaults | Notes |\n|---|---|---|---|---|\n| A | A | B1 | DX-5 | {note} |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn("GCS skl note", msgs[0])

    def test_own_columns_are_allowed(self) -> None:
        text = "| Skill | Diff | Page | Cost for IQ 14 Scholar | Notes |\n|---|---|---|---|---|\n| A | A | B1 | 4 | n |\n"
        self.assertEqual(self.r.gurps("a.md", text)[0], [])

    def test_each_item_kind_maps_its_own_columns(self) -> None:
        tables = [
            "| Spell | Diff | Cost | Dur | Page | Prereq | Notes |\n|---|---|---|---|---|---|---|\n| A | H | 1 | 1 | B1 | x | n |\n",
            "| Trait | Cost | Page | Notes |\n|---|---|---|---|\n| A | 5 | B1 | n |\n",
            "| Perk | Cost | Page | Notes |\n|---|---|---|---|\n| A | 1 | B1 | n |\n",
            "| Limitation | Cost | Effect |\n|---|---|---|\n| A | -10% | n |\n",
            "| Technique | Default | Max | Page | Notes |\n|---|---|---|---|---|\n| A | 1 | 2 | B1 | n |\n",
        ]
        for t in tables:
            with self.subTest(header=t.splitlines()[0]):
                self.assertEqual(self.r.gurps("a.md", t)[0], [])

    def test_mapping_to_a_field_gcs_lacks_fails_loudly(self) -> None:
        # Drop 'recoil' from the fake GCS weapons: the Rcl column now fails.
        eqp = self.r.gcs_root / "Library" / "a.eqp"
        data = json.loads(eqp.read_text())
        del data["rows"][0]["weapons"][0]["recoil"]
        eqp.write_text(json.dumps(data))
        self.r.gcs = lc.load_gcs(self.r.gcs_root)
        text = "| Weapon | TL | Dmg | Acc | Rcl | Cost | Wt |\n|---|---|---|---|---|---|---|\n| A | 8 | 1d | 1 | 2 | $1 | 1 |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn('"Rcl"', msgs[0])

    def test_rules_tables_go_to_review_never_to_findings(self) -> None:
        text = "| ST | Thrust | Swing |\n|---|---|---|\n| 10 | 1d-2 | 1d |\n| 11 | 1d-1 | 1d+1 |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(msgs, [])
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0].header, ("ST", "Thrust", "Swing"))
        self.assertEqual(review[0].rows, 2)

    def test_blank_forms_are_neither_flagged_nor_reviewed(self) -> None:
        text = "| # | Name | Cost | Notes |\n|---|---|---|---|\n| 1 | | | |\n| 2 | | | |\n| 3 | | | |\n"
        self.assertEqual(self.r.gurps("a.md", text), ([], []))

    def test_numeric_only_tables_are_data_not_blank_forms(self) -> None:
        text = "| ST | BL | Light |\n|---|---|---|\n| 10 | 20 | 40 |\n| 11 | 24 | 48 |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(msgs, [])
        self.assertEqual(len(review), 1)

    def test_table_without_outer_pipes_is_still_checked(self) -> None:
        text = "Weapon | TL | Dmg | Full Rules Text\n---|---|---|---\nSword | 1 | sw+1 | verbatim text\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn('"Full Rules Text"', msgs[0])

    def test_indented_table_is_still_checked(self) -> None:
        text = "  | Weapon | TL | Dmg | Bad |\n  |---|---|---|---|\n  | Sword | 1 | sw+1 | x |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn('"Bad"', msgs[0])

    def test_table_inside_a_blockquote_is_still_checked(self) -> None:
        text = "> | Weapon | TL | Dmg | Bad |\n> |---|---|---|---|\n> | Sword | 1 | sw+1 | x |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)

    def test_escaped_pipes_do_not_split_a_note(self) -> None:
        note = " \\| ".join([" ".join(["w"] * 30)] * 3)  # 90 words + escaped pipes, one cell
        text = f"| Item | TL | Cost | Wt | Page | Notes |\n|---|---|---|---|---|---|\n| A | 1 | $1 | 1 | B1 | {note} |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn("words; the longest GCS eqp note is 40", msgs[0])

    def test_ragged_row_is_a_finding(self) -> None:
        text = "| Item | TL | Cost | Wt | Page | Notes |\n|---|---|---|---|---|---|\n| A | 1 | $1 |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)
        self.assertIn("row has 3 cells but the header has 6", msgs[0])

    def test_every_notes_column_is_measured(self) -> None:
        long = " ".join(["w"] * 60)
        text = f"| Item | TL | Notes | Notes |\n|---|---|---|---|\n| A | 1 | ok | {long} |\n"
        msgs, _ = self.r.gurps("a.md", text)
        self.assertEqual(len(msgs), 1)

    def test_british_armour_is_an_item_table(self) -> None:
        text = "| Armour | TL | DR | Cost | Wt | Full Rules Text |\n|---|---|---|---|---|---|\n| A | 1 | 2 | $1 | 1 | x |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(review, [])
        self.assertTrue(any('"Full Rules Text"' in m for m in msgs))

    def test_unrecognised_first_column_with_item_columns_is_an_error(self) -> None:
        text = "| Gizmo | TL | Dmg | Reach | Notes |\n|---|---|---|---|---|\n| A | 1 | 2 | 1 | x |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(review, [])
        self.assertEqual(len(msgs), 1)
        self.assertIn('first column "Gizmo" is not recognised', msgs[0])

    def test_bold_column_names_are_normalised(self) -> None:
        text = "| **Weapon** | **TL** | **Dmg** | `Bad` |\n|---|---|---|---|\n| Sword | 1 | sw+1 | x |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(review, [])
        self.assertEqual(len(msgs), 1)
        self.assertIn('"`Bad`"', msgs[0])

    def test_bold_unrecognised_first_column_is_still_an_error(self) -> None:
        text = "| **Gizmo** | **Dmg** | **Reach** |\n|---|---|---|\n| A | 1 | 2 |\n"
        msgs, review = self.r.gurps("a.md", text)
        self.assertEqual(review, [])
        self.assertEqual(len(msgs), 1)

    def test_tilde_fences_are_ignored(self) -> None:
        text = "~~~\n" + WEAPON_TABLE.replace("| Page |", "| Page | Bad |") + "~~~\n"
        self.assertEqual(self.r.gurps("a.md", text), ([], []))

    def test_tables_in_code_fences_are_ignored(self) -> None:
        text = "```\n" + WEAPON_TABLE.replace("| Page |", "| Page | Bad |") + "```\n"
        self.assertEqual(self.r.gurps("a.md", text), ([], []))

    def test_load_gcs_returns_none_without_a_library(self) -> None:
        self.assertIsNone(lc.load_gcs(self.r.root / "nowhere"))


class ShingleTests(unittest.TestCase):
    PROSE = (
        "When a creature falls asleep it drops whatever it is holding and "
        "lies prone until something wakes it, and any noise or a shake "
        "will rouse it at once without a check."
    )

    def setUp(self) -> None:
        self.r = Repo()
        self.addCleanup(self.r.close)
        self.corpus_root = self.r.root / "corpus"
        self.corpus = self.r.write(
            "corpus/pf2e-orc-dataset/data/rules/sleep.md",
            f"---\ntitle: Sleep\n---\n\n# Sleep\n\n{self.PROSE}\n\nOther unrelated text follows here.\n",
        )

    def scan(self, body: str) -> list[str]:
        f = self.r.write(f"{SYSTEMS}/pf2e/conditions.md", body)
        found = lc.shingle_scan([f], [self.corpus], self.r.root, self.corpus_root)
        return [str(x) for x in found]

    def test_verbatim_copy_is_flagged_with_source_and_line(self) -> None:
        msgs = self.scan(f"# Conditions\n\nIntro line.\n\n{self.PROSE}\n")
        self.assertEqual(len(msgs), 1)
        self.assertIn("conditions.md:5:", msgs[0])
        self.assertIn("pf2e-orc-dataset/data/rules/sleep.md", msgs[0])

    # A 19-word passage has 10 windows. Halves of 14 words give 5 windows
    # each, i.e. a 14-word run apiece — under the 15-word threshold alone,
    # but 19 words if the two runs were (wrongly) merged.
    PASSAGE = [f"w{i}" for i in range(19)]

    def test_adjacent_windows_from_different_sources_do_not_join(self) -> None:
        w = self.PASSAGE
        a = self.r.write("corpus/pf2e-orc-dataset/data/a.md", " ".join(w[:14]) + "\n")
        b = self.r.write("corpus/pf2e-orc-dataset/data/b.md", " ".join(w[5:]) + "\n")
        f = self.r.write(f"{SYSTEMS}/pf2e/x.md", "# T\n\n" + " ".join(w) + "\n")
        found = lc.shingle_scan([f], [a, b], self.r.root, self.corpus_root)
        self.assertEqual([str(x) for x in found], [])

    def test_noncontiguous_offsets_in_one_source_do_not_join(self) -> None:
        w = self.PASSAGE
        corpus = self.r.write(
            "corpus/pf2e-orc-dataset/data/c.md",
            " ".join(w[:14]) + " filler filler filler " + " ".join(w[5:]) + "\n",
        )
        f = self.r.write(f"{SYSTEMS}/pf2e/x.md", "# T\n\n" + " ".join(w) + "\n")
        found = lc.shingle_scan([f], [corpus], self.r.root, self.corpus_root)
        self.assertEqual([str(x) for x in found], [])

    def test_the_same_passage_contiguous_in_one_source_is_flagged(self) -> None:
        w = self.PASSAGE
        corpus = self.r.write("corpus/pf2e-orc-dataset/data/c.md", " ".join(w) + "\n")
        f = self.r.write(f"{SYSTEMS}/pf2e/x.md", "# T\n\n" + " ".join(w) + "\n")
        found = lc.shingle_scan([f], [corpus], self.r.root, self.corpus_root)
        self.assertEqual(len(found), 1)
        self.assertIn("19 consecutive words", str(found[0]))

    def test_reported_source_is_the_one_that_holds_the_run(self) -> None:
        run = " ".join(f"r{i}" for i in range(20))
        decoy = self.r.write(
            "corpus/pf2e-orc-dataset/data/decoy.md", " ".join(f"r{i}" for i in range(10)) + "\n"
        )
        real = self.r.write("corpus/pf2e-orc-dataset/data/real.md", run + "\n")
        f = self.r.write(f"{SYSTEMS}/pf2e/x.md", "# T\n\n" + run + "\n")
        found = lc.shingle_scan([f], [decoy, real], self.r.root, self.corpus_root)
        self.assertEqual(len(found), 1)
        self.assertIn("real.md", str(found[0]))
        self.assertIn("20 consecutive words", str(found[0]))

    def test_paraphrase_is_clean(self) -> None:
        body = (
            "# Conditions\n\nA sleeping creature is helpless: it lets go of "
            "held items, falls prone, and stays down until woken by a noise "
            "or a touch.\n"
        )
        self.assertEqual(self.scan(body), [])

    def test_short_shared_phrase_is_below_the_run_threshold(self) -> None:
        # 12 words in common: one or two shingles, under MIN_RUN_WORDS.
        body = "# T\n\nIt drops whatever it is holding and lies prone until something wakes it now.\n"
        self.assertEqual(self.scan(body), [])

    def test_copied_table_rows_are_game_math_and_skipped(self) -> None:
        body = "# T\n\n| Note |\n|---|\n| " + self.PROSE + " |\n"
        self.assertEqual(self.scan(body), [])

    def test_frontmatter_in_repo_files_is_ignored(self) -> None:
        body = f"---\ndescription: {self.PROSE}\n---\n\n# T\n"
        self.assertEqual(self.scan(body), [])

    def test_case_and_punctuation_do_not_hide_a_copy(self) -> None:
        shouted = self.PROSE.upper().replace(",", ";")
        self.assertEqual(len(self.scan(f"# T\n\n{shouted}\n")), 1)


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.r = Repo()
        self.addCleanup(self.r.close)
        self.script = str(REPO / "scripts" / "license_check.py")

    def run_cli(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, self.script, "--repo", str(self.r.root), *extra],
            capture_output=True,
            text=True,
        )

    def test_exit_codes_and_files_mode(self) -> None:
        bad = self.r.write(
            f"{SYSTEMS}/gurps-4e/w.md", WEAPON_TABLE.replace("| Page |", "| Page | Bad |")
        )
        good = self.r.write(f"{SYSTEMS}/gurps-4e/ok.md", WEAPON_TABLE)
        g = ["--gcs", str(self.r.gcs_root)]
        whole = self.run_cli(*g)
        self.assertEqual(whole.returncode, 1)
        self.assertIn("w.md", whole.stdout)
        self.assertEqual(self.run_cli(*g, "--files", str(good)).returncode, 0)
        self.assertEqual(self.run_cli(*g, "--files", str(bad)).returncode, 1)

    def test_review_lists_rules_tables_and_still_exits_zero(self) -> None:
        self.r.write(
            f"{SYSTEMS}/gurps-4e/m.md",
            "| ST | Thrust | Swing |\n|---|---|---|\n| 10 | 1d-2 | 1d |\n",
        )
        out = self.run_cli("--gcs", str(self.r.gcs_root), "--review")
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn("RULES TABLES WITH NO GCS COUNTERPART: 1 tables", out.stdout)
        self.assertIn("ST | Thrust | Swing", out.stdout)

    def test_missing_gcs_is_skipped_locally_but_fails_in_ci(self) -> None:
        self.r.write(f"{SYSTEMS}/gurps-4e/ok.md", WEAPON_TABLE)
        nowhere = str(self.r.root / "nowhere")
        local = self.run_cli("--gcs", nowhere)
        self.assertEqual(local.returncode, 0)
        self.assertIn("skipped", local.stderr)
        ci = self.run_cli("--gcs", nowhere, "--require-gcs")
        self.assertEqual(ci.returncode, 1)
        self.assertIn("GCS master library not found", ci.stdout)

    def test_require_gcs_fails_even_when_no_gurps_files_are_selected(self) -> None:
        self.r.write(f"{SYSTEMS}/fitd/x.md", "# x\n")  # no gurps-4e directory at all
        out = self.run_cli("--gcs", str(self.r.root / "nowhere"), "--require-gcs")
        self.assertEqual(out.returncode, 1)
        self.assertIn("GCS master library not found", out.stdout)

    def test_personal_directory_and_sources_are_never_scanned(self) -> None:
        bad = WEAPON_TABLE.replace("| Page |", "| Page | Bad |")
        self.r.write(f"{SYSTEMS}/gurps-4e/personal/book.md", bad)
        self.r.write(f"{SYSTEMS}/gurps-4e/sources.md", bad)
        self.r.write(f"{SYSTEMS}/gurps-4e/ok.md", "# ok\n")
        out = self.run_cli("--gcs", str(self.r.gcs_root))
        self.assertEqual(out.returncode, 0, out.stdout)

    def test_missing_pf2e_corpus_is_skipped_not_failed(self) -> None:
        self.r.write(f"{SYSTEMS}/pf2e/x.md", "# x\n")
        out = self.run_cli("--shingles", "--corpus-root", str(self.r.root / "nowhere"))
        self.assertEqual(out.returncode, 0)
        self.assertIn("skipped", out.stderr)


if __name__ == "__main__":
    unittest.main()

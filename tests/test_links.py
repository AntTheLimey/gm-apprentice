#!/usr/bin/env python3
"""links.py: broken links listed by kind, retargeted, and unlinked."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock  # noqa: F401  (used from Task 3)

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import links  # noqa: E402


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="links-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "links.py"), str(vault), *args],
        capture_output=True, text=True, encoding="utf-8")


class ReportTests(unittest.TestCase):
    def one(self, files):
        rows, _ = links.report(make_vault(self, files))
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def test_same_ignores_punctuation(self):
        row = self.one({"Locations/Acheron's Rest.md": "x\n",
                        "A.md": "[[Acherons Rest]]\n"})
        self.assertEqual(row.kind, "NEAR")
        self.assertEqual(row.candidates,
                         [("Locations/Acheron's Rest.md", "same")])

    def test_same_ignores_emoji_and_accents(self):
        row = self.one({"NPCs/Doctor_Emile_Carreau.md": "x\n",
                        "A.md": "[[🩸 Doctor Émile Carreau]]\n"})
        self.assertEqual(row.candidates,
                         [("NPCs/Doctor_Emile_Carreau.md", "same")])

    def test_close_is_a_likely_typo(self):
        row = self.one({"Locations/Barabazar.md": "x\n",
                        "A.md": "[[Bara Bazaar]]\n"})
        self.assertEqual(row.candidates, [("Locations/Barabazar.md", "close")])

    def test_part_is_extra_words_before_or_after(self):
        row = self.one({"NPCs/Thomas Wyndham.md": "x\n",
                        "A.md": "[[Captain Thomas Wyndham]]\n"})
        self.assertEqual(row.candidates, [("NPCs/Thomas Wyndham.md", "part")])

    def test_a_copy_suffix_is_a_part_not_a_typo(self):
        row = self.one({"Vienna Summary.md": "x\n",
                        "A.md": "[[Vienna Summary 1]]\n"})
        self.assertEqual(row.candidates, [("Vienna Summary.md", "part")])

    def test_a_different_number_is_not_close(self):
        row = self.one({"S/Session_10_Plan.md": "x\n", "S/Session_12_Plan.md": "x\n",
                        "S/Session 2 Plan.md": "x\n",
                        "A.md": "[[Session_02_Plan]]\n"})
        self.assertEqual(row.candidates, [("S/Session 2 Plan.md", "close")])

    def test_an_archived_note_is_not_a_candidate(self):
        row = self.one({"_archive/old/the-secret.md": "x\n",
                        "_QA/Secret Report.md": "x\n",
                        "A.md": "[[Secret]]\n"})
        self.assertEqual((row.kind, row.candidates), ("UNWRITTEN", []))

    def test_a_missing_attachment_is_a_file_row_listed_last(self):
        rows, _ = links.report(make_vault(self, {
            "NPCs/Marquise.md": "![[Marquise .PNG]]\n[[Bath Abbey]]\n"}))
        self.assertEqual([(r.kind, r.spellings, r.candidates) for r in rows], [
            ("UNWRITTEN", ["Bath Abbey"], []),
            ("FILE", ["Marquise .PNG"], [])])

    def test_a_short_name_is_not_a_part(self):
        row = self.one({"NPCs/Al.md": "x\n", "A.md": "[[Al Fitr]]\n"})
        self.assertEqual((row.kind, row.candidates), ("UNWRITTEN", []))

    def test_an_alias_makes_its_note_a_candidate(self):
        row = self.one({
            "Locations/Barabazar.md": "---\naliases:\n  - Burra Bazar\n---\nx\n",
            "A.md": "[[Burra Bazaar]]\n"})
        self.assertEqual(row.candidates, [("Locations/Barabazar.md", "close")])

    def test_best_candidate_first_and_at_most_three(self):
        row = self.one({
            "NPCs/Savarin.md": "x\n", "NPCs/Mathilde Savarin.md": "x\n",
            "NPCs/Madame Savarin.md": "x\n", "Docs/Letter to Savarin.md": "x\n",
            "A.md": "[[savarin!]]\n"})
        self.assertEqual(row.candidates[0], ("NPCs/Savarin.md", "same"))
        self.assertEqual(len(row.candidates), 3)
        self.assertEqual({tag for _, tag in row.candidates[1:]}, {"part"})

    def test_spellings_of_one_unwritten_name_share_a_row(self):
        row = self.one({"A.md": "[[Eid al-Fitr]]\n", "B.md": "[[Eid al Fitr]]\n",
                        "C.md": "[[Eid al-Fitr|the feast]]\n"})
        self.assertEqual(row.kind, "UNWRITTEN")
        self.assertEqual(row.spellings, ["Eid al Fitr", "Eid al-Fitr"])
        self.assertEqual(row.sources, ["A.md", "B.md", "C.md"])

    def test_unchecked_sources_are_counted_not_listed(self):
        rows, unchecked = links.report(make_vault(self, {
            "A.md": "[[Bath Abbey]]\n",
            "_QA/R.md": "[[Bath Abbey]] [[Gone]]\n",
            "_archive/D.md": "[[Dropped]]\n"}))
        self.assertEqual([(r.spellings, r.sources) for r in rows],
                         [(["Bath Abbey"], ["A.md"])])
        self.assertEqual(unchecked, 2)

    def test_near_rows_first_then_most_linked(self):
        rows, _ = links.report(make_vault(self, {
            "Locations/Barabazar.md": "x\n",
            "A.md": "[[Zed]] [[Abbey]] [[Bara Bazaar]]\n",
            "B.md": "[[Zed]]\n"}))
        self.assertEqual([r.spellings[0] for r in rows],
                         ["Bara Bazaar", "Zed", "Abbey"])

    def test_lines(self):
        files = {"Locations/Barabazar.md": "x\n", "_QA/R.md": "[[Gone]]\n"}
        files.update({f"N{i}.md": "[[Bath Abbey]]\n" for i in range(7)})
        files["N0.md"] = "[[Bath Abbey]] [[Bara Bazaar]]\n"
        rows, unchecked = links.report(make_vault(self, files))
        self.assertEqual(links.report_lines(rows, unchecked), [
            "# broken: 2 names in 7 notes; not checked: _QA, _archive (1 name)",
            "NEAR\tBara Bazaar\t-> Locations/Barabazar.md (close)\t1 note: N0.md",
            "UNWRITTEN\tBath Abbey\t7 notes: N0.md, N1.md, N2.md, N3.md, N4.md,"
            " +2 more"])

    def test_cli_prints_the_report(self):
        vault = make_vault(self, {"A.md": "[[Bath Abbey]]\n"})
        got = cli(vault)
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines(), [
            "# broken: 1 name in 1 note; not checked: _QA, _archive (0 names)",
            "UNWRITTEN\tBath Abbey\t1 note: A.md"])

    def test_cli_prints_accents_and_emoji(self):
        vault = make_vault(self, {"A.md": "[[🩸 Émile]]\n"})
        got = cli(vault)
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines()[1],
                         "UNWRITTEN\t🩸 Émile\t1 note: A.md")

    def test_cli_refuses_a_missing_vault(self):
        got = cli(Path("/no/such/vault"))
        self.assertEqual(got.returncode, 2)
        self.assertIn("not a directory", got.stderr)


if __name__ == "__main__":
    unittest.main()

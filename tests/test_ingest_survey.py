#!/usr/bin/env python3
"""Regression tests for ingest_survey.py — the vault-ingest Phase 1 scorer.

Covers the three zero-read rows (extension/frontmatter alone), the scored
rows (indicator hit counts drive the proposal), the UNSCORED formats, and
--archive's date-stamped move-never-delete behaviour.

Run: python tests/test_ingest_survey.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "shared" / "scripts" / "ingest_survey.py"


class ScriptCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def write(self, rel: str, text: str | bytes = "") -> Path:
        path = self.tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(text, bytes):
            path.write_bytes(text)
        else:
            path.write_text(text, encoding="utf-8")
        return path

    def run_script(self, *args: str, rc: int = 0) -> str:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(
            proc.returncode, rc,
            f"args={args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
        return proc.stdout


class ZeroReadTests(ScriptCase):
    def test_image_extension_decides_with_no_read(self):
        self.write("scan.jpg", b"\xff\xd8\xff")
        out = self.run_script(str(self.tmp))
        self.assertIn("DECIDED\tscan.jpg\tImage/map\thigh\text=.jpg", out)

    def test_spreadsheet_extension_decides_with_no_read(self):
        self.write("tracker.csv", "a,b,c\n")
        out = self.run_script(str(self.tmp))
        self.assertIn("DECIDED\ttracker.csv\tSpreadsheet/data\thigh\text=.csv",
                      out)

    def test_wrapup_frontmatter_decides_with_no_scoring(self):
        self.write("old-notes.md", (
            "---\n"
            "type: session_wrap\n"
            "canon_status: AUTHORITATIVE\n"
            "---\n\n# Session 3 Wrap-Up\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("DECIDED\told-notes.md\tSession wrap-up\thigh\t"
                      "frontmatter type: session_wrap", out)

    def test_unsupported_format_is_unscored_not_guessed(self):
        self.write("handout.pdf", b"%PDF-1.4")
        out = self.run_script(str(self.tmp))
        self.assertIn("UNSCORED\thandout.pdf", out)
        self.assertIn("manual read", out)


class ScoredTests(ScriptCase):
    def test_play_indicators_propose_transcript(self):
        self.write("session-notes.md", (
            "Georgiana rolled a 47 and failed her Spot Hidden.\n"
            "The Keeper said to the group that the room was empty.\n"
            "SAN -3 for Doc after the discovery.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tsession-notes.md\tPlay transcript", out)
        self.assertIn("play_dice=", out)

    def test_prep_indicators_propose_scenario_prep(self):
        self.write("prep.md", (
            "If the investigators search the study, they find a diary.\n"
            "The GM should let them roll Library Use to notice the false "
            "drawer. At this point, describe the smell of old paper.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tprep.md\tScenario prep", out)

    def test_no_indicators_is_unclassified_not_guessed(self):
        self.write("blank.md", "Just some ordinary prose with nothing "
                               "distinctive in it at all today.\n")
        out = self.run_script(str(self.tmp))
        self.assertIn("Unclassified — read manually\tlow", out)

    def test_mixed_play_and_prep_flags_for_section_split(self):
        self.write("mixed.md", (
            "If the investigators go north, they find the crypt.\n"
            "Georgiana rolled a 12 and failed her Spot Hidden trying to "
            "find the hidden latch.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("Play fragment (mixed content", out)

    def test_character_sheet_is_not_misread_as_play_transcript(self):
        # A bare stat block (no dice rolls, no delta, no dialogue) used to
        # trip play_vitals on "SAN 65" / "HP 12" and get proposed as a
        # high-confidence Play transcript — the taxonomy's own example of
        # the most dangerous misclassification in the skill.
        self.write("investigator.md", (
            "STR 50 CON 60 SIZ 55 DEX 65 INT 70\n"
            "APP 45 POW 60 EDU 75 SAN 60 HP 12 MP 12\n"
            "Skills: Library Use 70%, Spot Hidden 55%, Psychology 40%\n"
            "Equipment: revolver, notebook, flashlight\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tinvestigator.md\tCharacter sheet", out)

    def test_play_vitals_delta_is_still_a_play_indicator(self):
        self.write("session-notes.md", (
            "Doc lost 3 SAN after reading the journal, leaving her at "
            "10/15 SAN for the rest of the session.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("play_vitals=", out)

    def test_keeper_recollection_indicators_propose_recollection(self):
        self.write("memory.md", (
            "I remember the group deciding to split up at the crossroads. "
            "I recall Doc was against it from the start.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tmemory.md\tKeeper recollection", out)

    def test_research_indicators_propose_research_brainstorm(self):
        self.write("worldbuilding.md", (
            "Q: What would happen if the cult found the second tablet "
            "first?\nA: They'd move up the ritual by a full lunar cycle.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tworldbuilding.md\tResearch/brainstorm", out)


class TrailerTests(ScriptCase):
    def test_trailer_counts_every_verdict(self):
        self.write("a.jpg", b"\xff\xd8")
        self.write("b.pdf", b"%PDF")
        self.write("c.md", "nothing special here\n")
        out = self.run_script(str(self.tmp))
        self.assertIn("# 3 files: 1 decided, 1 scored, 1 unscored, 0 errors",
                      out)

    def test_missing_directory_is_usage_error(self):
        self.run_script(str(self.tmp / "nope"), rc=2)


class ArchiveTests(ScriptCase):
    def setUp(self) -> None:
        super().setUp()
        self.vault = self.tmp
        (self.vault / "_inbox").mkdir()

    def test_dry_run_reports_would_archive_and_moves_nothing(self):
        src = self.vault / "_inbox" / "old_transcript.txt"
        src.write_text("some transcript text\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive", "old_transcript.txt")
        self.assertIn("WOULD-ARCHIVE\told_transcript.txt\t-> "
                      "_inbox/_processed/", out)
        self.assertIn("# dry-run would archive: 1 files, 0 errors", out)
        self.assertTrue(src.exists())
        self.assertFalse((self.vault / "_inbox" / "_processed").exists())

    def test_write_moves_and_date_stamps_without_deleting_original_bytes(self):
        src = self.vault / "_inbox" / "old_transcript.txt"
        src.write_text("some transcript text\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive",
                              "old_transcript.txt", "--write")
        self.assertIn("ARCHIVED\told_transcript.txt\t-> _inbox/_processed/", out)
        self.assertIn("# archived: 1 files, 0 errors", out)
        self.assertFalse(src.exists())
        processed = list((self.vault / "_inbox" / "_processed").rglob(
            "old_transcript.txt"))
        self.assertEqual(len(processed), 1)
        self.assertEqual(processed[0].read_text(encoding="utf-8"),
                         "some transcript text\n")

    def test_archive_collision_gets_a_numeric_suffix_never_overwrites(self):
        src1 = self.vault / "_inbox" / "notes.txt"
        src1.write_text("first\n", encoding="utf-8")
        self.run_script(str(self.vault), "--archive", "notes.txt", "--write")
        src2 = self.vault / "_inbox" / "notes.txt"
        src2.write_text("second\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive", "notes.txt",
                              "--write")
        self.assertIn("notes (2).txt", out)
        processed_dir = next((self.vault / "_inbox" / "_processed").iterdir())
        self.assertEqual((processed_dir / "notes.txt").read_text(
            encoding="utf-8"), "first\n")
        self.assertEqual((processed_dir / "notes (2).txt").read_text(
            encoding="utf-8"), "second\n")

    def test_archive_refuses_a_path_escaping_inbox(self):
        out = self.run_script(str(self.vault), "--archive", "../outside.txt",
                              "--write", rc=1)
        self.assertIn("ERROR\t../outside.txt\tescapes _inbox/", out)

    def test_archive_missing_file_is_reported_not_fatal_to_the_run(self):
        out = self.run_script(str(self.vault), "--archive", "ghost.txt",
                              "--write", rc=1)
        self.assertIn("ERROR\tghost.txt\tfile not found under _inbox/", out)

    def test_write_without_archive_is_a_usage_error(self):
        self.run_script(str(self.vault), "--write", rc=2)


if __name__ == "__main__":
    unittest.main()

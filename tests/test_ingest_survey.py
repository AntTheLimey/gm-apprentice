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

    def test_play_dice_matches_sentence_initial_capitals(self):
        # "Rolled a 15." / "Failed his Listen." at the start of a sentence
        # used to score zero because the verb alternatives were
        # lowercase-only, leaving a pure play transcript "Unclassified".
        self.write("notes.md", (
            "Rolled a 15 for Spot Hidden.\n"
            "Failed his Listen roll badly.\n"
            "Passed her Psychology check.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tnotes.md\tPlay transcript\thigh", out)
        self.assertIn("play_dice=3", out)

    def test_play_dice_still_requires_a_capitalised_skill_name(self):
        self.write("prose.md", "He failed his attempt to sleep that night.\n")
        out = self.run_script(str(self.tmp))
        self.assertNotIn("play_dice=", out)

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

    def test_bold_label_stats_count_as_charsheet_indicators(self):
        # A sheet that bolds its labels ("**STR:** 50") used to score zero
        # charsheet_stats hits — the regex required a label to be followed
        # directly by optional `:`/`=` then digits, and the closing `**`
        # sat in between and blocked the match.
        self.write("bold-sheet.md", (
            "**STR:** 50\n"
            "**DEX:** 60\n"
            "**Hit Points:** 12\n"
            "**Sanity:** 60\n"
            "Skills: Library Use 70%, Spot Hidden 55%, Psychology 40%\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tbold-sheet.md\tCharacter sheet", out)
        # Exactly the four bold-label lines count — the percentage-suffixed
        # "Skills: ... 70%" line (line 5) must not itself count.
        self.assertIn("charsheet_stats=4(L1,2,3)", out)

    def test_statblock_inside_prep_notes_is_not_misread_as_character_sheet(self):
        # A stat block embedded in prep notes used to outscore the play
        # indicators and win "Character sheet" outright — the mixed
        # verdict must win whenever play indicators AND at least one of
        # prep/research/keeper are both present, regardless of the
        # charsheet count.
        self.write("prep-with-statblock.md", (
            "If the investigators explore the shrine, they find the "
            "altar.\n"
            "NPC stat block: STR 60, CON 70, SIZ 65, DEX 85, HP 13\n"
            "Georgiana rolled a 12 and failed her Spot Hidden.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("Play fragment (mixed content", out)
        self.assertNotIn("Character sheet", out)


class RealInboxShapeTests(ScriptCase):
    """Shapes found in a real vault's `_inbox/_processed/` (Canticle field
    test, 2026-09-08) that the scorer got wrong or could not place."""

    def test_assistant_session_export_is_decided_by_heading_signature(self):
        # A gmassistant.app export: no frontmatter, a Date: line, and the
        # Summary / Memorable Moments / Scenes / NPCs headings. It is the
        # source a wrap-up is adopted from, and it used to come out
        # "Unclassified — read manually" because a narrative summary has
        # no dice-roll phrasing to score.
        self.write("session-Jul 2nd, 2026.md", (
            "# Alexandria's Embrace\n\nDate: Jul 2nd, 2026\n\n"
            "## Summary\nThe morning after their first night in Alexandria "
            "the party gathered for breakfast.\n\n"
            "## Memorable Moments\n- Rosa's lace.\n\n"
            "## Scenes\n- The bathhouse.\n\n"
            "## NPCs\n- Rosa, the widow from Trieste.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("DECIDED\tsession-Jul 2nd, 2026.md\t"
                      "Session export (assistant summary)\thigh\t"
                      "headings: Summary, Memorable Moments, Scenes, NPCs",
                      out)

    def test_single_play_hit_does_not_make_prep_a_mixed_document(self):
        # A published scenario with one line mentioning a roll used to be
        # flagged "Play fragment (mixed content)" on that single hit, over
        # three Keeper directives and a page of NPC stat blocks.
        self.write("scenario.md", (
            "## The Rectory\n\nKeeper Background\n\n"
            "The Keeper should read this aloud. At this point the "
            "investigators arrive.\nThe GM should note the weather.\n\n"
            "#### Rev. Ashdown\nSTR 45 CON 50 SIZ 55 DEX 60 INT 50\n\n"
            "#### Mrs. Pell\nSTR 45 CON 50 SIZ 55 DEX 60 INT 50\n\n"
            "#### The Thing in the Crypt\nSTR 80 CON 65 SIZ 60 DEX 70 INT 40\n\n"
            "#### Dunn the Ostler\nSTR 55 CON 60 SIZ 65 DEX 50 INT 55\n\n"
            "If a player rolled a 96 on the chaise, the horse bolts.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tscenario.md\tScenario prep\thigh", out)
        self.assertNotIn("mixed content", out)
        self.assertNotIn("Character sheet", out)

    def test_npc_cast_list_under_many_headings_is_prep_not_a_sheet(self):
        # Stat blocks under four different named headings are a scenario's
        # cast list — the taxonomy's own "NPC stat blocks without play
        # context" prep indicator — not one character's sheet, however
        # many stat hits they add up to.
        self.write("cast.md", (
            "## Dramatis Personae\n\n"
            "#### Captain Marlow\nSTR 70 CON 60 SIZ 65 DEX 55 INT 60\n\n"
            "#### The Veiled Lady\nSTR 40 CON 50 SIZ 45 DEX 75 INT 80\n\n"
            "#### Dr. Penrose\nSTR 50 CON 55 SIZ 60 DEX 50 INT 85\n\n"
            "#### The Engine\nSTR 90 CON 90 SIZ 90 DEX 10 INT 30\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tcast.md\tScenario prep\thigh", out)
        self.assertIn("stat_blocks=4", out)
        self.assertNotIn("Character sheet", out)

    def test_cast_list_with_real_play_hits_is_mixed_not_a_transcript(self):
        # A cast list is prep evidence. Add genuine play hits (two or more)
        # and the document is mixed — the cast-list signal must not be
        # dropped just because no "If the investigators" phrase is present.
        self.write("notes.md", (
            "#### Captain Marlow\nSTR 70 CON 60 SIZ 65 DEX 55 INT 60\n\n"
            "#### The Veiled Lady\nSTR 40 CON 50 SIZ 45 DEX 75 INT 80\n\n"
            "#### Dr. Penrose\nSTR 50 CON 55 SIZ 60 DEX 50 INT 85\n\n"
            "Georgiana rolled a 12 and failed her Spot Hidden at the "
            "door.\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("Play fragment (mixed content", out)
        self.assertNotIn("Play transcript", out)

    def test_stats_under_one_or_two_headings_are_still_a_sheet(self):
        self.write("pc.md", (
            "# Dr. Helena Voss\n\n## Characteristics\n"
            "STR 45 CON 50 SIZ 55 DEX 60 INT 70 POW 65\n\n"
            "## Derived Stats\nHP 10 MP 13 SAN 65\n\n"
            "## Skills\nLibrary Use 70%, Spot Hidden 55%\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tpc.md\tCharacter sheet\thigh", out)

    def test_one_pc_sheet_with_three_stat_sections_is_still_a_sheet(self):
        # A single sheet routinely spreads stats over three sections
        # (characteristics, combat, magic). Counting headings called that a
        # cast list. Only a characteristics row per entry — three or more
        # primary attributes on one line — marks a separate stat block.
        self.write("pc3.md", (
            "## Characteristics\nSTR 45 CON 50 SIZ 55 DEX 60 INT 70 POW 65\n\n"
            "## Combat\nHP 12 DB +1\n\n"
            "## Magic\nMP 13 SAN 65\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tpc3.md\tCharacter sheet\thigh", out)
        self.assertIn("stat_blocks=1", out)

    def test_gurps_sheet_with_attr_column_skills_table_is_still_a_sheet(self):
        # The repo's own GURPS template shape: a primary-attribute line,
        # a secondary line, and a skills table whose Attr column repeats
        # DX/IQ/HT once per row. Three sections with stat hits, one sheet.
        self.write("gurps-pc.md", (
            "### Primary Attributes\nST 11 DX 12 IQ 13 HT 12\n\n"
            "### Secondary Characteristics\nHP 11 FP 12\n\n"
            "## Skills\n| Skill | Attr | Level |\n|---|---|---|\n"
            "| Fast-Draw | DX | 12 |\n| Research | IQ | 13 |\n"
            "| Hiking | HT | 12 |\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tgurps-pc.md\tCharacter sheet\thigh", out)
        self.assertIn("stat_blocks=1", out)

    def test_export_signature_requires_a_date_line(self):
        # GM-written prep can use Summary / Scenes / NPCs as headings too.
        # Without the export's Date: line it is scored like any other
        # document, never DECIDED past review.
        self.write("prep.md", (
            "# The Rectory Job\n\n## Summary\nThe party is hired to look "
            "into the rectory.\n\n## Scenes\n- Arrival\n- The cellar\n\n"
            "## NPCs\n- The rector\n"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tprep.md\t", out)
        self.assertNotIn("Session export", out)

    def test_unterminated_script_is_reported_not_silently_dropped(self):
        self.write("broken.html", (
            "<html><body><script>var a = 1;\n"
            "<p>STR 50 CON 60 SIZ 55 DEX 65 INT 70 POW 60</p></body></html>"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tbroken.html\t", out)
        self.assertIn("unterminated <script>/<style>", out)

    def test_saved_web_page_is_scored_from_its_text(self):
        # A page saved from the browser (an NPC record from a campaign
        # site) used to be UNSCORED "unrecognized extension '.html'" — its
        # text is right there once the tags are stripped.
        self.write("npc.html", (
            "<html><head><title>Dr. Hargreaves</title>"
            "<style>.x{color:red}</style><script>var a=1;</script></head>"
            "<body><h1>Dr. Ambrose Hargreaves</h1>"
            "<p>STR 50 CON 60 SIZ 55 DEX 65 INT 70 POW 60</p>"
            "<p>HP 12 MP 12 SAN 60</p></body></html>"
        ))
        out = self.run_script(str(self.tmp))
        self.assertIn("SCORED\tnpc.html\tCharacter sheet\thigh", out)
        self.assertIn("html text extracted", out)

    def test_saved_page_companion_folder_is_one_row_not_one_per_asset(self):
        # "Webpage, Complete" saves drop a `<name>_files/` folder of
        # scripts and stylesheets beside the page. Those are not source
        # material and nobody should be told to read a stylesheet.
        self.write("npc.html", "<html><body><p>nothing</p></body></html>")
        self.write("Dr Hargreaves _ mobRPG_files/main.css", ".x{}")
        self.write("Dr Hargreaves _ mobRPG_files/main.js", "var a;")
        self.write("Dr Hargreaves _ mobRPG_files/js", "var b;")
        out = self.run_script(str(self.tmp))
        self.assertIn("DECIDED\tDr Hargreaves _ mobRPG_files/\t"
                      "Web page assets (companion folder)\thigh\t"
                      "3 files — not source material", out)
        self.assertNotIn("main.css", out)
        self.assertIn("# 2 files: 1 decided, 1 scored, 0 unscored, 0 errors",
                      out)


class BenchmarkInboxTests(unittest.TestCase):
    """Regression pins for the three real vault-ingest benchmark fixtures —
    see tests/proof-runs/mechanization/ground-truth/q5-expected.md for the
    hand-verified reading these proposals are checked against."""

    def test_benchmark_inbox_classifications(self):
        inbox = ROOT / "tests" / "benchmark-campaign" / "_inbox"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(inbox)],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0,
                          f"stdout={proc.stdout}\nstderr={proc.stderr}")
        out = proc.stdout
        self.assertIn("SCORED\tcharacter-sheet.md\tCharacter sheet", out)
        self.assertIn(
            "SCORED\tmixed-source.md\tPlay fragment (mixed content — "
            "consider a section split)", out)
        self.assertIn("SCORED\told-session-notes.md\tPlay transcript", out)


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

    def test_archive_accepts_vault_relative_spelling(self):
        # The skill hands the script vault-relative paths ("_inbox/x").
        # That spelling used to double up as _inbox/_inbox/x and fail.
        src = self.vault / "_inbox" / "notes" / "a.txt"
        src.parent.mkdir()
        src.write_text("a\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive",
                              "_inbox/notes/a.txt", "--write")
        self.assertIn("ARCHIVED\t_inbox/notes/a.txt\t-> _inbox/_processed/",
                      out)
        self.assertFalse(src.exists())
        archived = list((self.vault / "_inbox" / "_processed").rglob("a.txt"))
        self.assertEqual(len(archived), 1)
        # Preserves the _inbox-relative subpath, and only that — no
        # leaked "_inbox/" component from how the caller spelled it.
        self.assertEqual(archived[0].parent.name, "notes")
        self.assertEqual(archived[0].parent.parent.parent.name, "_processed")

    def test_archive_accepts_absolute_path_and_lands_in_processed(self):
        # An absolute path used to survive the escape check and then be
        # renamed *in place* ("a (2).txt" next to itself) instead of
        # moved under _processed/ — the one outcome Gotcha 5 forbids.
        src = self.vault / "_inbox" / "notes" / "a.txt"
        src.parent.mkdir()
        src.write_text("a\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive", str(src),
                              "--write")
        self.assertIn("-> _inbox/_processed/", out)
        self.assertFalse(src.exists())
        self.assertEqual(sorted(p.name for p in src.parent.iterdir()), [])
        archived = list((self.vault / "_inbox" / "_processed").rglob("a.txt"))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].parent.name, "notes")

    def test_archive_reserves_destination_exclusively(self):
        # Two names already taken → the reservation lands on the third and
        # leaves the existing archived bytes untouched.
        sys.path.insert(0, str(SCRIPT.parent))
        import ingest_survey as isv
        d = self.vault / "_inbox" / "_processed" / "2026-01-01"
        d.mkdir(parents=True)
        (d / "n.txt").write_text("one", encoding="utf-8")
        (d / "n (2).txt").write_text("two", encoding="utf-8")
        reserved = isv._reserve_name(d, "n.txt")
        self.assertEqual(reserved.name, "n (3).txt")
        self.assertTrue(reserved.exists())
        self.assertEqual((d / "n.txt").read_text(encoding="utf-8"), "one")
        self.assertEqual((d / "n (2).txt").read_text(encoding="utf-8"), "two")
        self.assertEqual(isv._first_free_name(d, "n.txt").name, "n (4).txt")

    def test_archive_refuses_an_already_archived_file(self):
        old = self.vault / "_inbox" / "_processed" / "2020-01-01" / "a.txt"
        old.parent.mkdir(parents=True)
        old.write_text("a\n", encoding="utf-8")
        out = self.run_script(str(self.vault), "--archive",
                              "_processed/2020-01-01/a.txt", "--write", rc=1)
        self.assertIn("already under _inbox/_processed/", out)
        self.assertTrue(old.exists())

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

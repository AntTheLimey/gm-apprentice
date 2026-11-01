#!/usr/bin/env python3
"""vault_write.py play-notes-new: an export's Play Notes beside a session
index that prep already filed (#545)."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tests"))
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import schema_rules  # noqa: E402
import vaultlib as vl  # noqa: E402
from test_vw_session_new import (EXPORT, INDEX, NOTES, SESSIONS,  # noqa: E402
                                 VAULT_FILES, make_vault, run)

PREPPED = """---
type: session
session_number: 13
chapter: "[[Chapter 1 - The Far Dark]]"
campaign: "Dead End"
play_date: null
in_game_date: null
status: prepped
documents:
  plan: "[[Session 13 - The Long Way Round - Plan]]"
  play_notes: null
  wrap_up: null
tags: [session]
---

# Session 13 - The Long Way Round
"""


class PlayNotesNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {**VAULT_FILES, INDEX: PREPPED})
        downloads = Path(tempfile.mkdtemp(prefix="vw-export-"))
        self.addCleanup(shutil.rmtree, downloads, ignore_errors=True)
        self.export = downloads / "session_2026_10_18.md"
        self.export.write_bytes(EXPORT.encode("utf-8"))

    def new(self, *extra, session="Session 13 - The Long Way Round"):
        return run(self.vault, "play-notes-new", "--session", session,
                   "--play-date", "2026-10-18", "--export",
                   str(self.export), *extra)

    def read(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_dry_run_plans_the_notes_and_the_index_edit(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{NOTES}", out)
        self.assertIn(f"WOULD-ADD\t{INDEX}", out)
        self.assertFalse((self.vault / NOTES).exists())
        self.assertEqual(self.read(INDEX), PREPPED)

    def test_notes_hold_the_export_whole_like_session_new(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        text = self.read(NOTES)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "session-play-notes")
        self.assertEqual(vl.wikilink_target(fm["session"]),
                         "Session 13 - The Long Way Round")
        self.assertEqual(fm["session_number"], "13")
        self.assertEqual(vl.wikilink_target(fm["chapter"]),
                         "Chapter 1 - The Far Dark")
        self.assertEqual(fm["campaign"], "Dead End")
        self.assertEqual(fm["canon_status"], "AUTHORITATIVE")
        self.assertEqual(fm["play_date"], "2026-10-18")
        self.assertIn("\n## Narrative Record\n", text)
        self.assertTrue(text.endswith(EXPORT), text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_index_gets_the_link_and_date_and_keeps_the_rest(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        text = self.read(INDEX)
        want = (PREPPED.replace("play_date: null", 'play_date: "2026-10-18"')
                .replace("status: prepped", "status: played")
                .replace("  play_notes: null", '  play_notes: '
                         '"[[Session 13 - The Long Way Round - Play Notes]]"'))
        self.assertEqual(text, want)

    def test_export_names_are_resolved(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("EXACT\tCharacters/NPCs/Marlo Petrak.md\t§NPCs", out)
        self.assertIn("NONE\t\t§Items\tJellyfish Plushie", out)

    def test_a_second_run_is_refused(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        code, out = self.new("--write")
        self.assertEqual(code, 1, out)
        self.assertIn("already has Play Notes", out)

    def test_notes_that_name_the_session_but_are_not_linked_are_refused(self):
        other = f"{SESSIONS}/Session 13/Table notes.md"
        (self.vault / other).write_text(
            '---\ntype: session-play-notes\n'
            'session: "[[Session 13 - The Long Way Round]]"\n---\n',
            encoding="utf-8")
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn(f"already has Play Notes: {SESSIONS}/Session 13/Table notes", out)

    def test_no_such_index_is_refused(self):
        code, out = self.new(session="Session 99")
        self.assertEqual(code, 1, out)
        self.assertFalse((self.vault / NOTES).exists())

    def test_without_an_export_the_notes_are_empty(self):
        code, out = run(self.vault, "play-notes-new", "--session",
                        INDEX, "--write")
        self.assertEqual(code, 0, out)
        self.assertNotIn("Narrative Record", self.read(NOTES))
        self.assertIn("play_date: null", self.read(INDEX))

    def test_a_plan_path_is_not_a_session_index(self):
        plan = f"{SESSIONS}/Session 13/Session 13 - The Long Way Round - Plan.md"
        (self.vault / plan).write_text(
            "---\ntype: session-plan\nsession_number: 13\n---\n", encoding="utf-8")
        code, out = self.new("--write", session=plan)
        self.assertEqual(code, 1, out)
        self.assertIn("not a session index", out)
        self.assertFalse((self.vault / NOTES).exists())

    def test_an_impossible_date_is_refused(self):
        code, out = run(self.vault, "play-notes-new", "--session", INDEX,
                        "--play-date", "2026-13-45")
        self.assertEqual(code, 1, out)
        self.assertIn("--play-date", out)
        code, out = run(self.vault, "session-new", "--number", "14", "--title",
                        "X", "--play-date", "2026-02-31")
        self.assertEqual(code, 1, out)
        self.assertIn("--play-date", out)

    def test_status_rises_to_played_and_never_falls(self):
        code, out = self.new()
        self.assertIn("status prepped -> played", out)
        for later in ("wrap-up", "reviewed"):
            (self.vault / INDEX).write_text(
                PREPPED.replace("status: prepped", f"status: {later}"),
                encoding="utf-8")
            code, out = self.new("--write")
            self.assertEqual(code, 0, out)
            self.assertIn(f"status: {later}\n", self.read(INDEX))
            (self.vault / NOTES).unlink()

    def test_old_play_date_is_shown(self):
        (self.vault / INDEX).write_text(
            PREPPED.replace("play_date: null", 'play_date: "2026-10-11"'),
            encoding="utf-8")
        code, out = self.new()
        self.assertIn("play_date 2026-10-11 -> 2026-10-18", out)

    def test_a_play_date_that_is_not_iso_is_a_warning(self):
        (self.vault / INDEX).write_text(
            PREPPED.replace("play_date: null", 'play_date: "May 21, 2026"'),
            encoding="utf-8")
        code, out = run(self.vault, "play-notes-new", "--session", INDEX)
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("May 21, 2026", out)

    def test_a_dangling_link_is_named(self):
        (self.vault / INDEX).write_text(
            PREPPED.replace("  play_notes: null", '  play_notes: "[[S13 scribbles]]"'),
            encoding="utf-8")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("replaces [[S13 scribbles]], which names no note", out)

    def test_a_link_to_a_note_that_is_not_play_notes(self):
        (self.vault / INDEX).write_text(
            PREPPED.replace("  play_notes: null",
                            '  play_notes: "[[Marlo Petrak]]"'), encoding="utf-8")
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn("not Play Notes", out)

    def test_unlinked_play_notes_elsewhere_are_refused(self):
        other = "Archive notes/Session 13 scribbles.md"
        (self.vault / other).parent.mkdir(parents=True)
        (self.vault / other).write_text(
            '---\ntype: session-play-notes\n'
            'session: "[[Session 13 - The Long Way Round]]"\n---\n',
            encoding="utf-8")
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn("already has Play Notes: Archive notes/Session 13 scribbles", out)

    def test_an_empty_export_is_a_warning(self):
        self.export.write_bytes(b"")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("the export is empty", out)

    def test_cr_only_export_is_placed_with_lf(self):
        self.export.write_bytes(EXPORT.replace("\n", "\r").encode("utf-8"))
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        self.assertNotIn("\r", self.read(NOTES))

    def test_session_new_refusal_names_play_notes_new(self):
        code, out = run(self.vault, "session-new", "--number", "13", "--title",
                        "The Long Way Round")
        self.assertEqual(code, 1, out)
        self.assertIn("play-notes-new", out)


if __name__ == "__main__":
    unittest.main()

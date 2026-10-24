#!/usr/bin/env python3
"""vault_write.py session-new: a cold session's index and Play Notes, and
the names in a table-assistant export resolved against the vault (#312)."""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import schema_rules  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402

SESSION_TEMPLATE = (REPO / "skills" / "shared" / "templates" / "session.md"
                    ).read_text(encoding="utf-8")
CHAPTER = "Chapters/Chapter 1 - The Far Dark"
SESSIONS = f"{CHAPTER}/Sessions"
PREV = f"{SESSIONS}/Session 12/Session 12 - That Would Be a Mistake.md"
INDEX = f"{SESSIONS}/Session 13/Session 13 - The Long Way Round.md"
NOTES = (f"{SESSIONS}/Session 13/"
         "Session 13 - The Long Way Round - Play Notes.md")

PREV_TEXT = """---
type: session
session_number: 12
chapter: "[[Chapter 1 - The Far Dark]]"
campaign: "Dead End"
play_date: "2026-10-11"
in_game_date: null
status: "reviewed"
# Places the crew physically went this session, in order
route: ["[[Katha V]]", "[[Chae-gul 147]]"]
documents:
  plan: null
  play_notes: "[[Session 12 - That Would Be a Mistake - Play Notes]]"
  wrap_up: "[[Chapter_01_Session_12_Wrap_Up]]"
scenes: []
world_evolved: null
tags: [session]
---

# Session 12 — *That Would Be a Mistake*
"""


def entity(etype, aliases=None):
    lines = ["---", f"type: {etype}", "canon_status: DRAFT"]
    if aliases:
        lines.append("aliases: [" + ", ".join(f'"{a}"' for a in aliases)
                     + "]")
    return "\n".join(lines + ["---", "", "Body.", ""])


VAULT_FILES = {
    "_Templates/_Template_Session.md": SESSION_TEMPLATE,
    f"{CHAPTER}/Chapter 1 - The Far Dark.md": "---\ntype: chapter\n---\n",
    PREV: PREV_TEXT,
    "Characters/NPCs/Marlo Petrak.md": entity("npc"),
    "Characters/NPCs/Blaise_Fabian.md": entity("npc", ["Blaise"]),
    "Locations/Katha V.md": entity("location"),
    "Locations/Chae-gul 147.md": entity("location"),
    "_archive/Bertha.md": entity("npc"),
}

EXPORT = """# Session 13

Date: Oct 18th, 2026

## Summary
The crew went the long way round.

## Memorable Moments
- Six bought a plushie.

## NPCs
### Marlo Petrak
A pilot.

### Blaise
The boss.

### Hasib Eberhardt
New face.

### Bertha
A cook.

## Locations
### Katha V (Furosuto Supaia)
Ice.

### Chae-Gul 147 Station
A rig.

## Items
- **Jellyfish Plushie** — a souvenir.
"""


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vw-session-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, *argv):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = vw.main([str(vault), *argv])
    return code, out.getvalue()


class SessionNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, VAULT_FILES)
        downloads = Path(tempfile.mkdtemp(prefix="vw-export-"))
        self.addCleanup(shutil.rmtree, downloads, ignore_errors=True)
        self.export = downloads / "session_2026_10_18.md"
        self.export.write_bytes(EXPORT.encode("utf-8"))

    def new(self, *extra, export=True):
        args = ["session-new", "--number", "13", "--title",
                "The Long Way Round", "--play-date", "2026-10-18", *extra]
        if export:
            args += ["--export", str(self.export)]
        return run(self.vault, *args)

    def read(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_dry_run_plans_both_files_and_writes_nothing(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{INDEX}", out)
        self.assertIn(f"WOULD-CREATE\t{NOTES}", out)
        self.assertFalse((self.vault / INDEX).exists())
        self.assertFalse((self.vault / NOTES).exists())

    def test_play_notes_carry_the_session_number(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.read(NOTES))
        self.assertEqual(fm["type"], "session-play-notes")
        self.assertEqual(fm["session_number"], "13")

    def test_index_is_the_template_filled_from_the_previous_session(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        text = self.read(INDEX)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "session")
        self.assertEqual(fm["session_number"], "13")
        self.assertEqual(vl.wikilink_target(fm["chapter"]), "Chapter 1 - The Far Dark")
        self.assertEqual(fm["campaign"], "Dead End")
        self.assertEqual(fm["play_date"], "2026-10-18")
        self.assertEqual(fm["status"], "played")
        docs = vl.nested_mapping(text, "documents")
        self.assertEqual(
            vl.wikilink_target(docs["play_notes"]),
            "Session 13 - The Long Way Round - Play Notes")
        self.assertIn(docs["plan"], ("", None, "null"))
        self.assertIn(docs["wrap_up"], ("", None, "null"))
        # The previous index's own key comes forward empty, comment and all.
        self.assertIn("# Places the crew physically went this session, "
                      "in order\nroute: []\n", text)
        self.assertNotIn("[[Scene Title]]", text)
        self.assertNotIn("{Optional", text)
        self.assertNotIn("NN", text)
        self.assertIn("\n# Session 13 - The Long Way Round\n", text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_play_notes_hold_the_export_whole(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        text = self.read(NOTES)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "session-play-notes")
        self.assertEqual(vl.wikilink_target(fm["session"]),
                         "Session 13 - The Long Way Round")
        self.assertEqual(fm["canon_status"], "AUTHORITATIVE")
        self.assertEqual(fm["campaign"], "Dead End")
        self.assertIn("\n## Narrative Record\n", text)
        self.assertTrue(text.endswith(EXPORT), text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_export_names_are_resolved_never_invented(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        rows = [r.split("\t") for r in out.splitlines()
                if r.split("\t")[0] in ("EXACT", "ALIAS", "NEAR", "NONE")]
        by_name = {r[3].split(" — ")[0]: r for r in rows}
        self.assertEqual(by_name["Marlo Petrak"][:3],
                         ["EXACT", "Characters/NPCs/Marlo Petrak.md", "§NPCs"])
        self.assertEqual(by_name["Blaise"][:2],
                         ["ALIAS", "Characters/NPCs/Blaise_Fabian.md"])
        self.assertEqual(by_name["Hasib Eberhardt"][:2], ["NONE", ""])
        # An archived note is a record, not a match.
        self.assertEqual(by_name["Bertha"][:2], ["NONE", ""])
        self.assertEqual(by_name["Katha V (Furosuto Supaia)"][:3],
                         ["EXACT", "Locations/Katha V.md", "§Locations"])
        self.assertEqual(by_name["Chae-Gul 147 Station"][:2],
                         ["NEAR", "Locations/Chae-gul 147.md"])
        self.assertEqual(by_name["Jellyfish Plushie"][:3],
                         ["NONE", "", "§Items"])
        self.assertEqual(len(rows), 7, out)

    def test_resolve_alone_reads_an_export_for_a_session_already_filed(self):
        # The usual case: session-play made the Play Notes at the table
        # and the export is pasted in afterwards.
        code, out = run(self.vault, "resolve", "--export", str(self.export))
        self.assertEqual(code, 0, out)
        self.assertIn("EXACT\tCharacters/NPCs/Marlo Petrak.md\t§NPCs", out)
        self.assertIn("NONE\t\t§Items\tJellyfish Plushie", out)
        self.assertNotIn("CREATE\t", out)
        self.assertFalse((self.vault / INDEX).exists())

    def test_without_an_export_the_notes_are_empty_and_nothing_resolved(self):
        code, out = self.new("--write", export=False)
        self.assertEqual(code, 0, out)
        self.assertNotIn("Narrative Record", self.read(NOTES))
        self.assertNotIn("NONE\t", out)

    def test_an_existing_session_is_refused(self):
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        code, out = self.new("--write")
        self.assertEqual(code, 1, out)
        self.assertIn("session 13", out)

    def test_a_title_key_the_previous_index_has_gets_the_title(self):
        (self.vault / PREV).write_text(
            PREV_TEXT.replace("session_number: 12\n",
                              'session_number: 12\ntitle: "Old"\n'),
            encoding="utf-8")
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.read(INDEX))
        self.assertEqual(fm["title"], "The Long Way Round")

    def test_a_scenes_list_never_comes_forward(self):
        block = 'scenes:\n  - "[[Ashworth Dinner]]"\n'
        self.assertIn("scenes: []\n", PREV_TEXT)
        for old in ("scenes: []\n", block):
            (self.vault / PREV).write_text(
                PREV_TEXT.replace("scenes: []\n", old), encoding="utf-8")
            idx = self.vault / INDEX
            if idx.exists():
                idx.unlink()
                (self.vault / NOTES).unlink()
            code, out = self.new("--write")
            self.assertEqual(code, 0, out)
            text = self.read(INDEX)
            self.assertNotIn("scenes", vl.extract_frontmatter(text))
            self.assertNotIn("scenes:", vl.raw_frontmatter(text))
            self.assertIn("route: []\n", text)

    def other_chapter(self, play_date):
        other = "Chapters/Chapter 2 - Out/Sessions/Session 12/Session 12 - X.md"
        path = self.vault / other
        path.parent.mkdir(parents=True)
        path.write_text(PREV_TEXT.replace("Chapter 1 - The Far Dark",
                                          "Chapter 2 - Out")
                        .replace("2026-10-11", play_date),
                        encoding="utf-8")

    def test_two_chapters_with_a_session_12_follow_the_latest_played(self):
        self.other_chapter("2025-01-04")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{INDEX}", out)
        self.assertIn("latest played", out)

    def test_a_date_that_is_not_iso_never_wins(self):
        # Canticle's Vienna Session 14 says "May 21, 2026", which sorts
        # after "2026-10-15" as text.
        self.other_chapter("May 21, 2026")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{INDEX}", out)

    def test_two_chapters_with_a_session_12_on_one_date_need_chapter(self):
        self.other_chapter("2026-10-11")
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn("--chapter", out)
        code, out = self.new("--chapter", "Chapter 2 - Out")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE\tChapters/Chapter 2 - Out/Sessions/"
                      "Session 13/Session 13 - The Long Way Round.md", out)

    def test_first_session_finds_its_chapter_like_scene_new(self):
        # Found by title; filed in the chapter folder and linked by it,
        # as the chapter's other notes are.
        rome = "Chapters/Chapter 3 - Rome"
        (self.vault / rome).mkdir(parents=True)
        (self.vault / rome / "Chapter_3_Overview.md").write_text(
            '---\ntype: chapter\ntitle: "Rome"\n---\n', encoding="utf-8")
        code, out = run(self.vault, "session-new", "--number", "1",
                        "--title", "Arrival", "--chapter", "Rome", "--write")
        self.assertEqual(code, 0, out)
        index = f"{rome}/Sessions/Session 01/Session 01 - Arrival.md"
        self.assertIn('chapter: "[[Chapter 3 - Rome]]"', self.read(index))

    def test_first_session_with_an_ambiguous_chapter_is_refused(self):
        for name in ("A", "B"):
            path = self.vault / f"Chapters/{name}/{name}.md"
            path.parent.mkdir(parents=True)
            path.write_text('---\ntype: chapter\ntitle: "Rome"\n---\n',
                            encoding="utf-8")
        code, out = run(self.vault, "session-new", "--number", "1",
                        "--title", "Arrival", "--chapter", "Rome")
        self.assertEqual(code, 1, out)
        self.assertIn("2 chapter notes match", out)

    def test_a_title_that_cannot_be_a_file_name_is_refused(self):
        code, out = run(self.vault, "session-new", "--number", "13",
                        "--title", "Who/What?")
        self.assertEqual(code, 1, out)


if __name__ == "__main__":
    unittest.main()

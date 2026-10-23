#!/usr/bin/env python3
"""`vault_check.py chapters`: a chapter with two chapter notes gets one ASK
row naming both (merging is the GM's call); one note, templates and `_meta`
notes give none; the index keeps the first note by path order.

Run: python3 tests/test_vault_check_chapters.py
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import index_build as ib  # noqa: E402
import vault_check as vc  # noqa: E402

CH = "---\ntype: chapter\nstatus: {status}\n---\n\n# {title}\n"


def make(case, notes):
    root = Path(tempfile.mkdtemp(prefix="vc-chapters-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    for rel, text in notes.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return root


class ChapterNotesTests(unittest.TestCase):
    def test_two_notes_one_ask_row(self):
        v = make(self, {
            "Chapters/Chapter 1 - Far/Chapter 1 Overview.md":
                CH.format(status="active", title="Overview"),
            "Chapters/Chapter 1 - Far/Chapter 1 - Far.md":
                CH.format(status="planned", title="Far"),
        })
        self.assertEqual(vc.check_chapters(v), [
            "ASK\tChapters/Chapter 1 - Far/Chapter 1 - Far.md, "
            "Chapters/Chapter 1 - Far/Chapter 1 Overview.md\t"
            "one chapter, 2 chapter notes: keep one and merge"])

    def test_one_note_no_row(self):
        v = make(self, {"Chapters/Chapter 1 - Far/Chapter 1 - Far.md":
                        CH.format(status="active", title="Far")})
        self.assertEqual(vc.check_chapters(v), [])

    def test_templates_and_meta_ignored(self):
        v = make(self, {
            "Chapters/Chapter 1 - Far/Chapter 1 - Far.md":
                CH.format(status="active", title="Far"),
            "_Templates/_Template_Chapter.md":
                CH.format(status="planned", title="T"),
            "_meta/entity-types.md": CH.format(status="planned", title="E"),
        })
        self.assertEqual(vc.check_chapters(v), [])

    def test_any_underscore_top_folder_ignored(self):
        # An archived or drafted copy of the chapter note, as index_build
        # skips it.
        old = ("---\ntype: chapter\nchapter: \"[[Chapter 1 - Far]]\"\n"
               "---\n\n# Old\n")
        v = make(self, {
            "Chapters/Chapter 1 - Far/Chapter 1 - Far.md":
                CH.format(status="active", title="Far"),
            "_archive/Chapter 1 - Far.md": old,
            "_midwife/Far draft.md": old,
        })
        self.assertEqual(vc.check_chapters(v), [])

    def test_cli_subcommand(self):
        v = make(self, {
            "Chapters/A/A.md": CH.format(status="active", title="A"),
            "Chapters/A/A Overview.md": CH.format(status="active", title="o"),
        })
        out = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_check.py"), str(v),
             "chapters"], capture_output=True, text=True).stdout
        self.assertIn("## chapters", out)
        self.assertIn("# count: 1", out)


class IndexStableTests(unittest.TestCase):
    def test_first_note_by_path_wins(self):
        v = make(self, {
            "Chapters/A/A Overview.md": CH.format(status="complete", title="o"),
            "Chapters/A/A.md": CH.format(status="planned", title="A"),
        })
        _entries, chapters = ib.collect(v)
        self.assertEqual(len(chapters), 1)
        # "A Overview.md" sorts before "A.md" (space < dot): first wins.
        self.assertEqual(chapters[0]["stem"], "A Overview")
        self.assertEqual(chapters[0]["status"], "complete")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""The Table Log (`session-table-log`) is a session play record, beside the
Play Notes and the Export: registry facts, the chain check, and the reveal
scan's treatment of it.

Run: python3 -m pytest tests/test_table_log_type.py
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import index_build as ib  # noqa: E402
import reveal_scan as rs  # noqa: E402
import schema_rules as sr  # noqa: E402
import vault_check as vc  # noqa: E402

INDEX = "Chapters/Chapter 1/Sessions/Session 01/Session 01 - Arrival.md"
PLAN = "Chapters/Chapter 1/Sessions/Session 01/Session 01 - Arrival - Plan.md"
LOG = "Chapters/Chapter 1/Sessions/Session 01/Session 01 - Arrival - Table Log.md"
EXPORT = "Chapters/Chapter 1/Sessions/Session 01/Session 01 - Arrival - Export.md"


def write(vault, rel, text):
    path = Path(vault) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.replace("\r\n", "\n"), encoding="utf-8", newline="\n")


def session_vault(root, documents, with_log=True, extra=()):
    docs = "".join(f"  {k}: \"[[{v}]]\"\n" for k, v in documents)
    write(root, INDEX,
          "---\ntype: session\nsession_number: 1\n"
          "chapter: \"[[Chapter 1]]\"\nstatus: played\n"
          f"documents:\n{docs}---\n\n# Session 01 - Arrival\n")
    write(root, PLAN,
          "---\ntype: session-plan\nsession: \"[[Session 01 - Arrival]]\"\n"
          "session_number: 1\nchapter: \"[[Chapter 1]]\"\n---\n\n# Plan\n")
    if with_log:
        write(root, LOG,
              "---\ntype: session-table-log\n"
              "session: \"[[Session 01 - Arrival]]\"\n"
              "session_number: 1\nchapter: \"[[Chapter 1]]\"\n"
              "canon_status: AUTHORITATIVE\npublish: false\n---\n\n"
              "# Table Log\n")
    for rel, text in extra:
        write(root, rel, text)


class RegistryTests(unittest.TestCase):
    def test_table_log_is_a_play_record(self):
        self.assertEqual(vc.SESSION_DOC_TYPES["table_log"],
                         ("table log", {"session-table-log"}))
        self.assertEqual(vc.PLAY_RECORD_KEYS[-1], "table_log")
        self.assertIn("session-table-log", vc.PLAY_RECORD_TYPES)
        self.assertEqual(sr.REQUIRED_FIELDS["session-table-log"],
                         ["type", "canon_status", "session"])


    def test_table_log_is_structural(self):
        self.assertIn("session-table-log", vc.STRUCTURAL_TYPES)


class IndexNestingTests(unittest.TestCase):
    def test_table_log_nests_under_its_session_as_an_export_does(self):
        fix = (ROOT / "tests" / "fixtures" / "slice-b" / "index")
        with tempfile.TemporaryDirectory() as d:
            shutil.copytree(fix, d, dirs_exist_ok=True)
            base = "Chapters/Chapter 1 - Arrival/Sessions/"
            write(d, base + "Session_01_Table_Log.md",
                  "---\ntype: session-table-log\nsession: 1\n"
                  'chapter: "[[Chapter 1 - Arrival]]"\n---\n\n# Table Log\n')
            write(d, base + "Session_01_Export.md",
                  "---\ntype: session-export\nsession: 1\n"
                  'chapter: "[[Chapter 1 - Arrival]]"\n---\n\n# Export\n')
            _entries, chapters = ib.collect(Path(d))
        session_01 = next(s for s in chapters[0]["all_sessions"]
                          if s["stem"] == "Session 01")
        labels = dict(session_01["chain"])
        self.assertEqual(labels.get("table log"), "Session_01_Table_Log")
        self.assertEqual(labels.get("export"), "Session_01_Export")


class ChainTests(unittest.TestCase):
    def rows(self, documents, with_log=True):
        with tempfile.TemporaryDirectory() as d:
            session_vault(d, documents, with_log)
            return vc.check_sessions(Path(d))

    def test_a_table_log_alone_puts_the_session_in_play_not_played(self):
        # #855: only wrap-up marks a session played. A played the GM set is
        # still accepted, with no warning.
        rows = self.rows([("plan", "Session 01 - Arrival - Plan"),
                          ("table_log", "Session 01 - Arrival - Table Log")])
        summary = [r for r in rows if "\tsession 1:" in r]
        self.assertEqual(len(summary), 1, rows)
        self.assertIn("derived=prepped (in play)", summary[0])
        self.assertFalse([r for r in rows if r.startswith("WARNING")
                          and "status" in r], rows)

    def test_an_ended_session_with_no_wrap_up_is_never_told_to_go_back_to_prep(self):
        with tempfile.TemporaryDirectory() as d:
            session_vault(d, [("plan", "Session 01 - Arrival - Plan"),
                              ("table_log", "Session 01 - Arrival - Table Log")])
            idx = Path(d) / INDEX
            idx.write_text(idx.read_text(encoding="utf-8").replace(
                "status: played", "status: wrap-up"), encoding="utf-8")
            rows = vc.check_sessions(Path(d))
        warned = [r for r in rows if r.startswith("WARNING") and "status" in r]
        self.assertEqual(len(warned), 1, rows)
        self.assertIn("no Wrap-Up is linked or found", warned[0])
        self.assertNotIn("--set status=", warned[0])

    def test_chain_info_shows_table_log_only_when_present(self):
        with_log = self.rows([("plan", "Session 01 - Arrival - Plan"),
                              ("table_log", "Session 01 - Arrival - Table Log")])
        without = self.rows([("plan", "Session 01 - Arrival - Plan")],
                            with_log=False)
        got = [r for r in with_log if "\tsession 1:" in r][0]
        self.assertIn("table-log=✓", got)
        got = [r for r in without if "\tsession 1:" in r][0]
        self.assertNotIn("table-log", got)


class WrapUpSourceTests(unittest.TestCase):
    WRAP = "Chapters/Chapter 1/Sessions/Session 01/Chapter_01_Session_01_Wrap_Up.md"

    def rows(self, with_notes):
        with tempfile.TemporaryDirectory() as d:
            session_vault(d, [("table_log", "Session 01 - Arrival - Table Log")])
            if with_notes:
                write(d, "Chapters/Chapter 1/Sessions/Session 01/"
                         "Session 01 - Arrival - Play Notes.md",
                      "---\ntype: session-play-notes\nsession: \"[[Session 01 - Arrival]]\"\n"
                      "session_number: 1\nchapter: \"[[Chapter 1]]\"\n---\n\nPlayed.\n")
            write(d, self.WRAP,
                  "---\ntype: session_wrap\nsession: \"[[Session 01 - Arrival]]\"\n"
                  "session_number: 1\nchapter: \"[[Chapter 1]]\"\n---\n\n"
                  "## Narrative Recap\n\nIt happened.\n")
            return [r for r in vc.check_wrapup(Path(d), None, False)
                    if r.startswith("INFO\t") and "source_document" in r]

    def test_table_log_only_needs_no_source(self):
        rows = self.rows(with_notes=False)
        self.assertEqual(len(rows), 1, rows)
        self.assertNotIn("add it by hand", rows[0])
        self.assertIn("only play record is a Table Log", rows[0])
        self.assertIn("none is needed", rows[0])

    def test_play_notes_still_backfill(self):
        rows = self.rows(with_notes=True)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("backfill", rows[0])
        self.assertIn("Play Notes", rows[0])


class RevealScanTests(unittest.TestCase):
    def test_table_log_never_a_name_candidate(self):
        self.assertIn("session-table-log", rs.NEVER_CANDIDATES)

    def test_reveal_scan_reads_table_log_last(self):
        self.assertEqual(rs.SOURCE_KEYS[-1], ("table_log", "Table Log"))
        self.assertEqual(rs.FALLBACK_TYPES["table_log"], {"session-table-log"})


if __name__ == "__main__":
    unittest.main()

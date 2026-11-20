#!/usr/bin/env python3
"""The Table Log (`session-table-log`) is a session play record, beside the
Play Notes and the Export: registry facts, the chain check, and the reveal
scan's treatment of it.

Run: python3 -m pytest tests/test_table_log_type.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

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


class ChainTests(unittest.TestCase):
    def rows(self, documents, with_log=True):
        with tempfile.TemporaryDirectory() as d:
            session_vault(d, documents, with_log)
            return vc.check_sessions(Path(d))

    def test_status_played_from_table_log_alone(self):
        rows = self.rows([("plan", "Session 01 - Arrival - Plan"),
                          ("table_log", "Session 01 - Arrival - Table Log")])
        summary = [r for r in rows if "\tsession 1:" in r]
        self.assertEqual(len(summary), 1, rows)
        self.assertIn("derived=played", summary[0])

    def test_chain_info_shows_table_log_only_when_present(self):
        with_log = self.rows([("plan", "Session 01 - Arrival - Plan"),
                              ("table_log", "Session 01 - Arrival - Table Log")])
        without = self.rows([("plan", "Session 01 - Arrival - Plan")],
                            with_log=False)
        got = [r for r in with_log if "\tsession 1:" in r][0]
        self.assertIn("table-log=✓", got)
        got = [r for r in without if "\tsession 1:" in r][0]
        self.assertNotIn("table-log", got)


class RevealScanTests(unittest.TestCase):
    def test_table_log_never_a_name_candidate(self):
        self.assertIn("session-table-log", rs.NEVER_CANDIDATES)

    def test_reveal_scan_reads_table_log_last(self):
        self.assertEqual(rs.SOURCE_KEYS[-1], ("table_log", "Table Log"))
        self.assertEqual(rs.FALLBACK_TYPES["table_log"], {"session-table-log"})


if __name__ == "__main__":
    unittest.main()

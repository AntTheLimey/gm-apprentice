#!/usr/bin/env python3
"""reconcile_promote.py (#701): the Wrap-Up, the index and exactly the
scan's two DRAFT lists, in one step, all or nothing."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import reconcile_promote as rp  # noqa: E402
from migrate_core import write_text_atomic  # noqa: E402
import reconcile_scan as rs  # noqa: E402
import vaultlib as vl  # noqa: E402
from test_reconcile_scan import FILES, INDEX, WRAP, make_vault, plain_wrap  # noqa: E402

WRAP_NAME = "Session 05 - The Ball - Wrap-Up"
# A prep note the Wrap-Up links: pre-play, played this session.
PREP = "NPCs/Porter.md"
FIXTURE = {**plain_wrap(FILES),
           PREP: "---\ntype: npc\ncanon_status: DRAFT\ncreatedSession: \"\"\n---\n"}
FIXTURE[WRAP] += "\nThe [[Porter]] let them in.\n"


def run(vault: Path, *argv: str) -> tuple[int, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            code = rp.main([str(vault), *argv])
        except SystemExit as e:
            code = int(e.code or 0)
    return code, out.getvalue() + err.getvalue()


class PromoteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.vault = make_vault(tmp.name, FIXTURE)

    def fm(self, rel):
        return vl.extract_frontmatter((self.vault / rel).read_text(encoding="utf-8"))

    def test_a_dry_run_lists_every_note_and_writes_nothing(self):
        code, out = run(self.vault, WRAP_NAME, "--reconciled", "2026-11-17")
        self.assertEqual(code, 0, out)
        stamped = {ln.split("\t")[1] for ln in out.splitlines()
                   if ln.startswith("WOULD-STAMP\t")}
        # Lady Grey: created this session. Porter: pre-play, played. Hall:
        # an older DRAFT (Session 2), never touched.
        self.assertEqual(stamped, {WRAP, INDEX, "NPCs/Lady_Grey.md", PREP})
        self.assertIn("# dry-run would stamp: 4 files, 0 errors", out)
        self.assertEqual(self.fm(WRAP)["canon_status"], "DRAFT")

    def test_write_promotes_exactly_the_scans_lists(self):
        before = rs.survey(self.vault, WRAP_NAME)
        want = {n.rel for n in [*before.new, *before.preplay]}
        code, out = run(self.vault, WRAP_NAME, "--reconciled", "2026-11-17",
                        "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm(WRAP)["canon_status"], "AUTHORITATIVE")
        self.assertEqual(self.fm(WRAP)["reconciled"], "2026-11-17")
        self.assertEqual(self.fm(INDEX)["status"], "reviewed")
        for rel in want:
            self.assertEqual(self.fm(rel)["canon_status"], "AUTHORITATIVE", rel)
        self.assertEqual(self.fm("Locations/Hall.md")["canon_status"], "DRAFT")
        # Run again: nothing left to do.
        code, out = run(self.vault, WRAP_NAME, "--reconciled", "2026-11-17")
        self.assertIn("# dry-run would stamp: 0 files, 0 errors", out)

    def test_one_note_refused_writes_nothing(self):
        # stamp-entities refuses one note: the Wrap-Up and index, planned
        # before it, are not written either.
        real = rp.stamp_entities.plan_file

        def refuse(rel, lines, args):
            if rel == PREP:
                return ["frontmatter cannot be edited"], None, True
            return real(rel, lines, args)
        with mock.patch.object(rp.stamp_entities, "plan_file", refuse):
            code, out = run(self.vault, WRAP_NAME, "--reconciled",
                            "2026-11-17", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{PREP}\tfrontmatter cannot be edited", out)
        self.assertIn("# nothing written: 1 note(s) cannot be promoted", out)
        self.assertEqual(self.fm(WRAP)["canon_status"], "DRAFT")
        self.assertEqual(self.fm(INDEX)["status"], "wrap-up")
        self.assertEqual(self.fm("NPCs/Lady_Grey.md")["canon_status"], "DRAFT")

    def test_except_leaves_a_note_draft(self):
        code, out = run(self.vault, WRAP, "--reconciled", "2026-11-17",
                        "--except", "Porter", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"KEPT\t{PREP}\tleft DRAFT (--except)", out)
        self.assertEqual(self.fm(PREP)["canon_status"], "DRAFT")
        self.assertEqual(self.fm("NPCs/Lady_Grey.md")["canon_status"],
                         "AUTHORITATIVE")

    def test_except_names_only_a_listed_note(self):
        # Hall is an older DRAFT, not on the scan's lists: refused, so a
        # typo never silently promotes what the GM meant to keep.
        code, out = run(self.vault, WRAP, "--reconciled", "2026-11-17",
                        "--except", "Hall")
        self.assertEqual(code, 2, out)
        self.assertIn("not among the notes", out)

    def test_a_bad_date_is_refused_with_this_commands_usage(self):
        code, out = run(self.vault, WRAP, "--reconciled", "2026-13-1")
        self.assertEqual(code, 2, out)
        self.assertIn("usage:", out)
        self.assertIn("'2026-13-1' is not YYYY-MM-DD", out)
        self.assertNotIn("--retag", out)

    def test_a_failed_write_puts_the_notes_back(self):
        real = rp.write_all_or_none
        calls = []

        def fail_second(vault, originals, texts, *, read, what):
            def write(path, text):
                calls.append(path)
                if len(calls) == 2:
                    raise OSError("disk full")
                write_text_atomic(path, text)
            return real(vault, originals, texts, read=read, what=what,
                        write=write)
        with mock.patch.object(rp, "write_all_or_none", fail_second):
            code, out = run(self.vault, WRAP, "--reconciled", "2026-11-17",
                            "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("the vault is as it was", out)
        self.assertEqual(self.fm(WRAP)["canon_status"], "DRAFT")
        self.assertEqual(self.fm(INDEX)["status"], "wrap-up")

    def test_no_index_is_refused(self):
        (self.vault / INDEX).unlink()
        code, out = run(self.vault, WRAP_NAME, "--reconciled", "2026-11-17")
        self.assertEqual(code, 2, out)
        self.assertIn("no session index", out)

    def test_no_such_wrap_up(self):
        code, out = run(self.vault, "Nope", "--reconciled", "2026-11-17")
        self.assertEqual(code, 2, out)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""vault_write.py threads: add, move and close shared threads.

Run: python3 -m pytest tests/test_vault_write_threads.py -q
"""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_write as vw  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "shared-threads"
OVERVIEW = "Campaign Overview.md"
INES = "PCs/Ines_Marlowe.md"
CORWIN = "PCs/Corwin_Hale.md"
WRAPUP = "Chapters/Chapter 1 - Harbour/Session 03 - Wrap-Up.md"


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(vault, *argv, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


def rows(*cols):
    return "\n".join("\t".join(c) for c in cols) + "\n"


class ThreadsTests(unittest.TestCase):
    def vault(self):
        vault = Path(tempfile.mkdtemp(prefix="vwthreads-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        shutil.copytree(FIXTURE, vault, dirs_exist_ok=True)
        return vault

    def snapshot(self, vault):
        return {p.relative_to(vault).as_posix(): p.read_bytes()
                for p in vault.rglob("*.md")}

    def test_add_shared_preview_then_write(self):
        vault = self.vault()
        before = self.snapshot(vault)
        stdin = rows(("add", "shared", "Session 4", "Ines_Marlowe, Corwin_Hale",
                      "**Bell** rings at dusk"))
        code, out = run(vault, "threads", stdin=stdin)
        self.assertEqual(code, 0)
        self.assertIn("WOULD-ADD\t" + OVERVIEW, out)
        self.assertEqual(self.snapshot(vault), before)
        code, out = run(vault, "threads", "--write", stdin=stdin)
        self.assertEqual(code, 0)
        self.assertIn("ADDED\t" + OVERVIEW, out)
        self.assertNotIn("WOULD", out)
        text = read(vault, OVERVIEW)
        self.assertIn("- **Bell** rings at dusk — since Session 4; "
                      "involves [[Ines_Marlowe]], [[Corwin_Hale]]", text)
        self.assertLess(text.index("rings at dusk"), text.index("## Key Factions"))

    def test_add_party_and_no_since(self):
        vault = self.vault()
        code, _ = run(vault, "threads", "--write", stdin=rows(
            ("add", "shared", "-", "party", "Find the lamp-oil")))
        self.assertEqual(code, 0)
        self.assertIn("- Find the lamp-oil — involves the party",
                      read(vault, OVERVIEW))

    def test_move_takes_bullet_off_each_sheet(self):
        vault = self.vault()
        # Give Corwin the same thread as Ines.
        corwin = read(vault, CORWIN).replace(
            "- **Ferrywoman's debt**",
            "- **The ledger page in her coat** — torn from the toll book, "
            "not yet shown to anyone\n- **Ferrywoman's debt**")
        (vault / CORWIN).write_bytes(corwin.encode("utf-8"))
        stdin = rows(("move", "The ledger page in her coat", "Session 3",
                      "Ines_Marlowe, Corwin_Hale"))
        code, out = run(vault, "threads", stdin=stdin)
        self.assertEqual(code, 0)
        self.assertEqual(out.count("WOULD-MOVE"), 3)
        self.assertIn("The ledger page in her coat", read(vault, INES))
        code, out = run(vault, "threads", "--write", stdin=stdin)
        self.assertEqual(code, 0)
        self.assertEqual(out.count("\nMOVED") + out.startswith("MOVED"), 3)
        self.assertNotIn("ledger page", read(vault, INES))
        self.assertIn("Find out who lit the lamp", read(vault, INES))
        self.assertNotIn("ledger page", read(vault, CORWIN))
        self.assertIn("Ferrywoman's debt", read(vault, CORWIN))
        text = read(vault, OVERVIEW)
        self.assertEqual(text.count("The ledger page in her coat"), 1)
        self.assertIn("— since Session 3; involves [[Ines_Marlowe]], "
                      "[[Corwin_Hale]]", text)

    def test_move_party_takes_it_off_every_active_pc(self):
        vault = self.vault()
        corwin = read(vault, CORWIN).replace(
            "- **Ferrywoman's debt**",
            "- **The ledger page in her coat** — torn from the toll book, "
            "not yet shown to anyone\n- **Ferrywoman's debt**")
        (vault / CORWIN).write_bytes(corwin.encode("utf-8"))
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The ledger page in her coat", "-", "party")))
        self.assertEqual(code, 0)
        self.assertNotIn("ledger page", read(vault, INES))
        self.assertNotIn("ledger page", read(vault, CORWIN))
        text = read(vault, OVERVIEW)
        self.assertEqual(text.count("The ledger page in her coat"), 1)
        self.assertIn("— involves the party\n\n## Key Factions", text)

    def test_close_shared_records_in_wrapup(self):
        vault = self.vault()
        stdin = rows(("close", "shared", "The missing ledger",
                      "Session 4 note: the ledger was returned"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=stdin)
        self.assertEqual(code, 0)
        self.assertIn("WOULD-CLOSE", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=stdin)
        self.assertEqual(code, 0)
        self.assertIn("CLOSED", out)
        self.assertNotIn("The missing ledger", read(vault, OVERVIEW).split(
            "## Key Factions")[0])
        wrap = read(vault, WRAPUP)
        self.assertIn("#### Resolved Threads", wrap)
        self.assertIn("- **The missing ledger** — Harrow Ford's toll keeper "
                      "wants it back — closed: Session 4 note: the ledger was "
                      "returned (shared)", wrap)

    def test_close_pc_thread_records_in_wrapup(self):
        vault = self.vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe",
                                    "Find out who lit the lamp on the north bank",
                                    "Session 4: it was the ferrywoman")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("who lit the lamp", read(vault, INES))
        self.assertIn("The ledger page in her coat", read(vault, INES))
        self.assertIn("closed: Session 4: it was the ferrywoman (Ines_Marlowe)",
                      read(vault, WRAPUP))

    def test_close_needs_wrapup(self):
        vault = self.vault()
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("close", "shared", "The missing ledger", "returned")))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertIn("--wrapup", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_close_ambiguous_lead_refused(self):
        vault = self.vault()
        text = read(vault, OVERVIEW).replace(
            "## Key Factions",
            "- **The missing ledger** — a second one\n\n## Key Factions", 1)
        # Put the duplicate inside the list, not after a blank line.
        text = text.replace("[[Corwin_Hale|Corwin]]\n\n- **The missing ledger**",
                            "[[Corwin_Hale|Corwin]]\n- **The missing ledger**")
        (vault / OVERVIEW).write_bytes(text.encode("utf-8"))
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "shared", "The missing ledger",
                                    "returned")))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertIn("The missing ledger", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_close_unknown_lead_refused(self):
        vault = self.vault()
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "shared", "No such thread", "x")))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertIn("No such thread", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_add_shared_without_overview_refused(self):
        vault = self.vault()
        (vault / OVERVIEW).unlink()
        code, out = run(vault, "threads", stdin=rows(
            ("add", "shared", "-", "party", "Something")))
        self.assertEqual(code, 1)
        self.assertIn("no Campaign Overview to hold shared threads", out)

    def test_add_shared_no_place_outside_fence_refused(self):
        vault = self.vault()
        before = self.snapshot(vault)
        with mock.patch.object(vw.th, "insert_shared",
                               side_effect=ValueError("no place")):
            code, out = run(vault, "threads", "--write", stdin=rows(
                ("add", "shared", "-", "party", "Something")))
        self.assertEqual(code, 1)
        self.assertIn("no place outside a GM-only fence", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_error_row_writes_nothing(self):
        vault = self.vault()
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("add", "shared", "Session 4", "party", "Fine one"),
                            ("close", "shared", "No such thread", "x")))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_crlf_kept(self):
        vault = self.vault()
        for rel in (OVERVIEW, INES, WRAPUP):
            text = read(vault, rel).replace("\r\n", "\n").replace("\n", "\r\n")
            (vault / rel).write_bytes(text.encode("utf-8"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("add", "shared", "Session 4", "party", "New one"),
                            ("move", "The ledger page in her coat", "-",
                             "Ines_Marlowe"),
                            ("close", "shared", "The missing ledger", "done")))
        self.assertEqual(code, 0, out)
        for rel in (OVERVIEW, INES, WRAPUP):
            data = (vault / rel).read_bytes()
            self.assertEqual(data.count(b"\n"), data.count(b"\r\n"), rel)

    def test_move_differing_wording_refused(self):
        vault = self.vault()
        corwin = read(vault, CORWIN).replace(
            "- **Ferrywoman's debt**",
            "- **The ledger page in her coat** — other words\n"
            "- **Ferrywoman's debt**")
        (vault / CORWIN).write_bytes(corwin.encode("utf-8"))
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The ledger page in her coat", "-", "party")))
        self.assertEqual(code, 1)
        self.assertIn("word 'The ledger page in her coat' differently", out)
        self.assertIn("other words", out)
        self.assertIn("torn from the toll book", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_totals_count_moves_and_closes(self):
        vault = self.vault()
        _, out = run(vault, "threads", stdin=rows(
            ("move", "The ledger page in her coat", "-", "Ines_Marlowe")))
        self.assertIn("moved: 2  warnings", out)
        self.assertNotIn("closed:", out)
        _, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=rows(
            ("close", "shared", "The missing ledger", "returned")))
        self.assertIn("closed: 1  warnings", out)
        self.assertNotIn("moved:", out)
        self.assertIn("WOULD-RECORD", out)

    def test_failed_row_does_not_poison_later_rows(self):
        vault = self.vault()
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("close", "shared", "No such thread", "x"),
                            ("close", "shared", "The missing ledger", "done")))
        self.assertEqual(code, 1)
        self.assertEqual(out.count("ERROR"), 1, out)
        self.assertIn("row 1", out)
        self.assertEqual(self.snapshot(vault), before)
        # A row that fails after it took a bullet off a sheet leaves no trace.
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=rows(
            ("move", "The ledger page in her coat", "-",
             "Ines_Marlowe, Corwin_Hale"),
            ("close", "Ines_Marlowe", "The ledger page in her coat", "done")))
        self.assertEqual(code, 1)
        self.assertEqual(out.count("ERROR"), 1, out)
        self.assertIn("row 1", out)

    def test_move_already_shared_refused(self):
        vault = self.vault()
        ines = read(vault, INES).replace(
            "- Find out who lit",
            "- **The missing ledger** — ines copy\n- Find out who lit")
        (vault / INES).write_bytes(ines.encode("utf-8"))
        code, out = run(vault, "threads", stdin=rows(
            ("move", "The missing ledger", "-", "Ines_Marlowe")))
        self.assertEqual(code, 1)
        self.assertIn("'The missing ledger' is already a shared thread; "
                      "close the PCs' copies instead", out)

    def test_empty_fields_refused(self):
        vault = self.vault()
        for row in (("add", "shared", "-", "party", " "),
                    ("close", "shared", "The missing ledger", " "),
                    ("close", "shared", " ", "done"),
                    ("move", " ", "-", "Ines_Marlowe")):
            code, out = run(vault, "threads", "--wrapup", WRAPUP,
                            stdin=rows(row))
            self.assertEqual(code, 1, row)
            self.assertIn("ERROR", out)

    def test_close_names_its_list(self):
        vault = self.vault()
        ines = read(vault, INES).replace(
            "- Find out who lit",
            "- **The missing ledger** — ines copy\n- Find out who lit")
        (vault / INES).write_bytes(ines.encode("utf-8"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "shared", "The missing ledger",
                                    "returned")))
        self.assertEqual(code, 0, out)
        self.assertIn("ines copy", read(vault, INES))
        self.assertNotIn("toll keeper wants it back",
                         read(vault, OVERVIEW))
        self.assertIn("(shared)", read(vault, WRAPUP))


if __name__ == "__main__":
    unittest.main()

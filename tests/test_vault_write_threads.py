#!/usr/bin/env python3
"""vault_write.py threads: add, move and close shared threads.

Run: python3 -m pytest tests/test_vault_write_threads.py -q
"""

import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ROOT / "tests"))

import vault_write as vw  # noqa: E402
from layouts import write_config  # noqa: E402

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

    def test_an_archived_overview_is_never_the_one(self):
        # An archived copy that sorts first is a record of the past: the
        # thread goes to the live Overview.
        vault = self.vault()
        live = "_campaign/Campaign Overview.md"
        (vault / "_campaign").mkdir()
        (vault / OVERVIEW).rename(vault / live)
        for rec in ("_archive", "_QA"):
            (vault / rec).mkdir()
            shutil.copy(vault / live, vault / rec / "Campaign Overview.md")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("add", "shared", "-", "party", "Find the lamp-oil")))
        self.assertEqual(code, 0, out)
        self.assertIn("ADDED\t" + live, out)
        self.assertIn("Find the lamp-oil", read(vault, live))
        for rec in ("_archive", "_QA"):
            self.assertNotIn("lamp-oil",
                             read(vault, rec + "/Campaign Overview.md"))

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

    def test_move_waits_for_a_site_tool_that_shows_it(self):
        # A site on publish tool 1.70.2 would drop a moved thread from the
        # PC's page: the move is refused and nothing changes.
        for installed, moves in (("1.70.2", False), ("1.70.3", True)):
            with self.subTest(installed=installed):
                vault = self.vault()
                site = Path(tempfile.mkdtemp(prefix="vwthreads-site-"))
                self.addCleanup(shutil.rmtree, site, ignore_errors=True)
                pkg = site / "node_modules" / "gm-apprentice-publish"
                pkg.mkdir(parents=True)
                (pkg / "package.json").write_text(json.dumps(
                    {"version": installed}), encoding="utf-8")
                write_config(vault, "---\npublish:\n  system: coc-7e\n"
                             f"  site: true\n  site_dir: {site.as_posix()}\n"
                             "---\n")
                before = self.snapshot(vault)
                code, out = run(vault, "threads", "--write", stdin=rows(
                    ("move", "The ledger page in her coat", "-",
                     "Ines_Marlowe")))
                if moves:
                    self.assertEqual(code, 0, out)
                    continue
                self.assertEqual(code, 1)
                self.assertIn("1.70.2, older than 1.70.3", out)
                self.assertEqual(self.snapshot(vault), before)

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
        corwin = read(vault, CORWIN).replace(
            "- **Ferrywoman's debt**",
            "- **The ledger page in her coat** — other words\n"
            "- **Ferrywoman's debt**")
        (vault / CORWIN).write_bytes(corwin.encode("utf-8"))
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
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The missing ledger", "-", "Ines_Marlowe")))
        self.assertEqual(code, 1)
        self.assertIn("'The missing ledger' is already a shared thread, "
                      "worded differently", out)
        self.assertIn("ines copy", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_move_from_one_holder_involves_every_named_pc(self):
        vault = self.vault()
        corwin = read(vault, CORWIN)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The ledger page in her coat", "Session 3",
             "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("ledger page", read(vault, INES))
        self.assertEqual(read(vault, CORWIN), corwin)
        self.assertIn("- **The ledger page in her coat** — torn from the toll "
                      "book, not yet shown to anyone — since Session 3; "
                      "involves [[Ines_Marlowe]], [[Corwin_Hale]]",
                      read(vault, OVERVIEW))
        # No named PC has it: refused.
        code, out = run(vault, "threads", stdin=rows(
            ("move", "Ferrywoman's debt", "-", "Ines_Marlowe")))
        self.assertEqual(code, 1)
        self.assertIn("no named PC has a thread 'Ferrywoman's debt'", out)

    def test_move_of_an_already_shared_thread_takes_the_copies_off(self):
        vault = self.vault()
        ines = read(vault, INES).replace(
            "- Find out who lit",
            "- **The missing ledger** — Harrow Ford's toll keeper wants it "
            "back\n- Find out who lit")
        (vault / INES).write_bytes(ines.encode("utf-8"))
        overview = read(vault, OVERVIEW)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The missing ledger", "Session 9", "Ines_Marlowe")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("missing ledger", read(vault, INES))
        self.assertIn("Find out who lit", read(vault, INES))
        self.assertEqual(read(vault, OVERVIEW), overview)

    def test_move_of_an_already_shared_thread_widens_its_involves(self):
        # The entry names Corwin; Ines holds a copy and WHO names both.
        vault = self.vault()
        debt = ("**Corwin's debt to the ferrywoman** — owed for the night "
                "crossing")
        ines = read(vault, INES).replace(
            "- Find out who lit", f"- {debt}\n- Find out who lit")
        (vault / INES).write_bytes(ines.encode("utf-8"))
        over = read(vault, OVERVIEW).replace(
            "involves [[Ines_Marlowe]], [[Corwin_Hale|Corwin]]",
            "involves [[Corwin_Hale|Corwin]]")
        (vault / OVERVIEW).write_bytes(over.encode("utf-8"))
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "Corwin's debt to the ferrywoman", "-",
             "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("ferrywoman", read(vault, INES))
        self.assertIn(f"- {debt} — since Session 3; involves "
                      "[[Corwin_Hale|Corwin]], [[Ines_Marlowe]]\n",
                      read(vault, OVERVIEW))
        # Named in WHO but not holding it: still added.
        over = read(vault, OVERVIEW)
        ines = read(vault, INES).replace(
            "- Find out who lit",
            "- **The missing ledger** — Harrow Ford's toll keeper wants it "
            "back\n- Find out who lit")
        (vault / INES).write_bytes(ines.encode("utf-8"))
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The missing ledger", "-", "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, OVERVIEW), over, "a party entry stays")

    def test_move_against_a_hidden_shared_copy_refused(self):
        vault = self.vault()
        over = read(vault, OVERVIEW).replace(
            "## Key Factions",
            "<!-- gm-only -->\n- **The bell debt** — owed to the sexton — "
            "involves [[Corwin_Hale]]\n<!-- /gm-only -->\n\n## Key Factions")
        (vault / OVERVIEW).write_bytes(over.encode("utf-8"))
        for rel in (INES, CORWIN):
            text = read(vault, rel).replace(
                "**Open threads:**\n",
                "**Open threads:**\n- **The bell debt** — owed to the sexton\n")
            (vault / rel).write_bytes(text.encode("utf-8"))
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "The bell debt", "-", "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 1)
        self.assertIn("'The bell debt' in the Overview's Open Threads is in "
                      "or next to hidden text; edit it by hand", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_close_with_an_empty_list_refused(self):
        vault = self.vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=rows(
            ("close", " ", "The missing ledger", "returned")))
        self.assertEqual(code, 1)
        self.assertIn("close needs a list, a lead and evidence; one is empty",
                      out)

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


    def edit(self, vault, rel, old, new):
        text = read(vault, rel)
        self.assertIn(old, text)
        (vault / rel).write_bytes(text.replace(old, new).encode("utf-8"))

    def test_gm_only_thread_refused(self):
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  "<!-- gm-only -->\n- Find out who lit the lamp on the north "
                  "bank\n<!-- /gm-only -->")
        before = self.snapshot(vault)
        for row in (("move", "Find out who lit the lamp on the north bank",
                     "-", "Ines_Marlowe"),
                    ("close", "Ines_Marlowe",
                     "Find out who lit the lamp on the north bank", "lit")):
            code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                            stdin=rows(row))
            self.assertEqual(code, 1, row)
            self.assertIn("'Find out who lit the lamp on the north bank' on "
                          "Ines_Marlowe is next to hidden text; edit it by "
                          "hand", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_close_records_continuation(self):
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  "- Find out who lit the lamp\n  on the north bank")
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe",
                                    "Find out who lit the lamp on the north bank",
                                    "it was the ferrywoman")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("north bank", read(vault, INES))
        self.assertIn("- Find out who lit the lamp on the north bank — "
                      "closed: it was the ferrywoman (Ines_Marlowe)",
                      read(vault, WRAPUP))

    def test_move_wrapped_bullets_keeps_continuation(self):
        vault = self.vault()
        wrapped = "- **Lamp** — who lit it\n  on the north bank"
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  wrapped)
        self.edit(vault, CORWIN, "- **Ferrywoman's debt**",
                  wrapped + "\n- **Ferrywoman's debt**")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "Lamp", "-", "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertIn("- **Lamp** — who lit it on the north bank — involves "
                      "[[Ines_Marlowe]], [[Corwin_Hale]]", read(vault, OVERVIEW))
        for rel in (INES, CORWIN):
            self.assertNotIn("north bank", read(vault, rel))
        # Same first line, different continuation: refused.
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  wrapped)
        self.edit(vault, CORWIN, "- **Ferrywoman's debt**",
                  "- **Lamp** — who lit it\n  on the south bank\n"
                  "- **Ferrywoman's debt**")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "Lamp", "-", "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 1)
        self.assertIn("differently", out)

    def test_nested_bullet_is_not_its_own_thread(self):
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  "- Find out who lit the lamp\n  - ask the ferrywoman")
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe",
                                    "ask the ferrywoman", "asked")))
        self.assertEqual(code, 1)
        self.assertIn("no thread 'ask the ferrywoman'", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe",
                                    "Find out who lit the lamp; ask the "
                                    "ferrywoman", "asked")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("ferrywoman", read(vault, INES))

    def test_blank_line_continuation_is_part_of_the_bullet(self):
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  "- **Lamp** — keeper\n\n  Para A about the lamp")
        self.edit(vault, CORWIN, "- **Ferrywoman's debt**",
                  "- **Lamp** — keeper\n\n  Para B different\n"
                  "- **Ferrywoman's debt**")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("move", "Lamp", "-", "Ines_Marlowe, Corwin_Hale")))
        self.assertEqual(code, 1)
        self.assertIn("differently", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe", "Lamp", "lit")))
        self.assertEqual(code, 0, out)
        self.assertNotIn("Para A", read(vault, INES))
        self.assertIn("**Knows (exclusive):**", read(vault, INES))
        self.assertIn("- **Lamp** — keeper Para A about the lamp — closed: lit",
                      read(vault, WRAPUP))

    def test_close_takes_the_lazy_line_with_its_bullet(self):
        vault = self.vault()
        self.edit(vault, INES, "- Find out who lit the lamp on the north bank",
                  "- **Lamp** — who lit it\non the north bank")
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "Ines_Marlowe", "Lamp", "lit")))
        self.assertEqual(code, 0, out)
        ines = read(vault, INES)
        self.assertNotIn("north bank", ines)
        self.assertIn("The ledger page in her coat", ines)
        self.assertIn("**Knows (exclusive):**", ines)
        self.assertIn("- **Lamp** — who lit it on the north bank — closed: "
                      "lit (Ines_Marlowe)", read(vault, WRAPUP))

    HIDING_FORMS = {
        "spoiler fence": ("<!-- spoiler -->", "<!-- /spoiler -->"),
        "%% comment": ("%%", "%%"),
        "HTML comment": ("<!--", "-->"),
    }

    def test_hidden_thread_refused(self):
        # Inside a spoiler fence, a %% comment or an HTML comment, or next
        # to a comment: refused, nothing written, no opener left alone.
        lamp = "- Find out who lit the lamp on the north bank"
        for form, (opener, closer) in self.HIDING_FORMS.items():
            shapes = {"inside": f"{opener}\n{lamp}\n{closer}"}
            if form != "spoiler fence":
                shapes["next to"] = f"{lamp}\n{opener}\naside\n{closer}"
            for where, new in shapes.items():
                with self.subTest(form=form, where=where):
                    vault = self.vault()
                    self.edit(vault, INES, lamp, new)
                    before = self.snapshot(vault)
                    key = lamp[2:]
                    for row in (("move", key, "-", "Ines_Marlowe"),
                                ("close", "Ines_Marlowe", key, "lit")):
                        code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                        "--write", stdin=rows(row))
                        self.assertEqual(code, 1, row)
                        self.assertIn("on Ines_Marlowe is next to hidden "
                                      "text; edit it by hand", out)
                    self.assertEqual(self.snapshot(vault), before)

    def test_hidden_shared_entry_refused(self):
        # A shared entry whose text opens a comment: closing or moving it
        # would leave the secret as text and an orphan closer. Refused,
        # nothing written.
        for opener, closer in (("<!--", "-->"), ("%%", "%%")):
            with self.subTest(opener):
                vault = self.vault()
                self.edit(vault, OVERVIEW, "\n\n## Key Factions",
                          "\n- **The bell rings** — involves [[Ines_Marlowe]], "
                          f"[[Corwin_Hale]] {opener}\nThe sexton rang it for "
                          f"the cult.\n{closer}\n\n## Key Factions")
                self.edit(vault, INES, "**Open threads:**\n",
                          "**Open threads:**\n- **The bell rings**\n")
                before = self.snapshot(vault)
                for row in (("close", "shared", "The bell rings", "rung"),
                            ("move", "The bell rings", "-", "Ines_Marlowe")):
                    code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                    "--write", stdin=rows(row))
                    self.assertEqual(code, 1, row)
                    self.assertIn("'The bell rings' in the Overview's Open "
                                  "Threads is in or next to hidden text; "
                                  "edit it by hand", out)
                self.assertEqual(self.snapshot(vault), before)

    def test_close_shared_takes_its_nested_lines(self):
        vault = self.vault()
        self.edit(vault, OVERVIEW, "\n\n## Key Factions",
                  "\n- The bell rings — involves the party\n"
                  "  - the sexton knows\n\n## Key Factions")
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "shared", "The bell rings; the "
                                    "sexton knows", "rung")))
        self.assertEqual(code, 0, out)
        over = read(vault, OVERVIEW)
        self.assertNotIn("sexton", over)
        self.assertIn("night crossing — since Session 3; involves "
                      "[[Ines_Marlowe]], [[Corwin_Hale|Corwin]]\n\n"
                      "## Key Factions", over)
        self.assertIn("- The bell rings; the sexton knows — closed: rung "
                      "(shared)", read(vault, WRAPUP))

    def test_close_leaves_a_lazy_spoiler_or_callout_whole(self):
        lamp = "- **Lamp** — who lit it"
        for under in ("<!-- spoiler -->\n- Reveal\n<!-- /spoiler -->",
                      "> [!note] see story"):
            with self.subTest(under):
                vault = self.vault()
                self.edit(vault, INES,
                          "- Find out who lit the lamp on the north bank",
                          f"{lamp}\n{under}")
                code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                "--write", stdin=rows(
                                    ("close", "Ines_Marlowe", "Lamp", "lit")))
                self.assertEqual(code, 0, out)
                ines = read(vault, INES)
                self.assertNotIn("who lit it", ines)
                self.assertIn(f"\n{under}\n", ines)
                self.assertIn("- **Lamp** — who lit it — closed: lit "
                              "(Ines_Marlowe)\n", read(vault, WRAPUP))

    DORMANT_ENTRY = ("- **Harbour bell** \u2014 rung twice at night \u2014 since "
                     "Session 1; dormant since Session 2 (left Wu); involves "
                     "[[Ines_Marlowe]], [[Corwin_Hale]]")

    def with_dormant(self, vault, entry=None):
        self.edit(vault, OVERVIEW, "\n\n## Key Factions",
                  "\n\n## Dormant Threads\n\n" + (entry or self.DORMANT_ENTRY)
                  + "\n\n## Key Factions")

    def test_rest_pc_thread(self):
        vault = self.vault()
        before = self.snapshot(vault)
        stdin = rows(("rest", "Ines_Marlowe",
                      "Find out who lit the lamp on the north bank",
                      "left the harbour"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-REST", out)
        self.assertEqual(self.snapshot(vault), before)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertNotIn("who lit the lamp", read(vault, INES))
        text = read(vault, OVERVIEW)
        # Its first-seen session (the threads report ages it from the
        # Wrap-Ups) stays as its `since`.
        self.assertIn("## Dormant Threads\n\n- Find out who lit the lamp on "
                      "the north bank \u2014 since Session 3; dormant since "
                      "Session 3 (left the harbour); involves [[Ines_Marlowe]]",
                      text)
        self.assertLess(text.index("## Open Threads"),
                        text.index("## Dormant Threads"))
        self.assertLess(text.index("## Dormant Threads"),
                        text.index("## Key Factions"))

    def test_rest_shared_keeps_since_and_involves(self):
        vault = self.vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("rest", "shared", "Corwin's debt to the ferrywoman",
                                    "paid off for now; maybe not")))
        self.assertEqual(code, 0, out)
        text = read(vault, OVERVIEW)
        self.assertNotIn("Corwin's debt", text.split("## Dormant")[0])
        self.assertIn("- **Corwin's debt to the ferrywoman** \u2014 owed for "
                      "the night crossing \u2014 since Session 3; dormant since "
                      "Session 3 (paid off for now, maybe not); involves "
                      "[[Ines_Marlowe]], [[Corwin_Hale]]", text)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("rest", "shared", "The missing ledger", "gone")))
        self.assertEqual(code, 0, out)
        self.assertIn("since Session 2; dormant since Session 3 (gone); "
                      "involves the party", read(vault, OVERVIEW))

    def test_rest_needs_wrapup(self):
        vault = self.vault()
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("rest", "shared", "The missing ledger", "gone")))
        self.assertEqual(code, 1)
        self.assertIn("--wrapup", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_rest_hidden_refused_writes_nothing(self):
        vault = self.vault()
        lamp = "- Find out who lit the lamp on the north bank"
        self.edit(vault, INES, lamp, f"<!--\n{lamp}\n-->")
        self.edit(vault, OVERVIEW, "\n\n## Key Factions",
                  "\n- **The bell rings** \u2014 involves the party <!--\n"
                  "secret\n-->\n\n## Key Factions")
        before = self.snapshot(vault)
        for row, said in (
                (("rest", "Ines_Marlowe", "Find out who lit the lamp on the north bank", "gone"),
                 "on Ines_Marlowe is next to hidden text; edit it by hand"),
                (("rest", "shared", "The bell rings", "gone"),
                 "'The bell rings' in the Overview's Open Threads is in or "
                 "next to hidden text; edit it by hand")):
            code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                            stdin=rows(row))
            self.assertEqual(code, 1, row)
            self.assertIn(said, out)
        self.assertEqual(self.snapshot(vault), before)

    def test_rest_beside_a_fenced_dormant_list_lands_outside_it(self):
        vault = self.vault()
        self.edit(vault, OVERVIEW, "\n\n## Key Factions",
                  "\n\n## Dormant Threads\n\n<!-- gm-only -->\n- **Old** "
                  "\u2014 involves the party\n<!-- /gm-only -->\n\n"
                  "## Key Factions")
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("rest", "shared", "The missing ledger", "x")))
        self.assertEqual(code, 0, out)
        self.assertIn("RESTED", out)
        text = read(vault, OVERVIEW)
        self.assertLess(text.index("<!-- /gm-only -->"),
                        text.index("dormant since Session 3 (x)"))

    def test_rest_crlf_overview(self):
        vault = self.vault()
        for rel in (OVERVIEW, INES, CORWIN, WRAPUP):
            text = read(vault, rel).replace("\r\n", "\n").replace("\n", "\r\n")
            (vault / rel).write_bytes(text.encode("utf-8"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("rest", "shared", "The missing ledger", "gone"),
                            ("rest", "Ines_Marlowe", "Find out who lit the lamp on the north bank", "gone"),
                            ("wake", "The missing ledger", "Corwin_Hale")))
        self.assertEqual(code, 0, out)
        for rel in (OVERVIEW, INES, CORWIN):
            data = (vault / rel).read_bytes()
            self.assertEqual(data.count(b"\n"), data.count(b"\r\n"), rel)
        self.assertIn("## Dormant Threads", read(vault, OVERVIEW))

    # -- wrapup as a list: Wrap-Up lines that sit on no thread list --------

    BELL = "**The cracked bell** \u2014 the sexton heard it ring at noon."

    def unlisted_vault(self):
        vault = self.vault()
        path = vault / WRAPUP
        text = path.read_bytes().decode("utf-8")
        text = text.replace(
            "- **The north-bank lamp**",
            f"- {self.BELL}\n- **The north-bank lamp**")
        path.write_bytes(text.encode("utf-8"))
        return vault

    def report(self, vault):
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "session_context.py"),
             str(vault), "--threads"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc.stdout.split(
            "--- Wrap-up threads not on any thread list ---")[1]

    def test_close_wrapup_line_claims_it(self):
        vault = self.unlisted_vault()
        self.assertIn("cracked bell", self.report(vault))
        stdin = rows(("close", "wrapup", "The cracked bell", "it was a gull"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-RECORD", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn(f"- {self.BELL} \u2014 closed: it was a gull "
                      "(Session 3)", read(vault, WRAPUP))
        self.assertNotIn("(shared)", read(vault, WRAPUP))
        self.assertNotIn("cracked bell", self.report(vault))

    def test_batch_threads_block_sees_an_earlier_blocks_wrapup_line(self):
        vault = self.vault()     # the bell is not on disk: a block adds it
        path = vault.parent / f"{vault.name}-batch.txt"
        path.write_text(
            f'=== section "{WRAPUP}" "Unresolved Threads" --append\n'
            f"- {self.BELL}\n"
            f'=== threads --wrapup "{WRAPUP}"\n'
            + rows(("close", "wrapup", "The cracked bell", "it was a gull")),
            encoding="utf-8")
        self.addCleanup(path.unlink)
        code, out = run(vault, "batch", str(path), "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"- {self.BELL} — closed: it was a gull "
                      "(Session 3)", read(vault, WRAPUP))

    def test_a_second_threads_block_sees_lines_added_between(self):
        vault = self.vault()
        dog = "**The black dog** \u2014 seen on the quay twice."
        path = vault.parent / f"{vault.name}-batch2.txt"
        path.write_text(
            f'=== section "{WRAPUP}" "Unresolved Threads" --append\n'
            f"- {self.BELL}\n"
            f'=== threads --wrapup "{WRAPUP}"\n'
            + rows(("close", "wrapup", "The cracked bell", "a gull"))
            + f'=== section "{WRAPUP}" "Unresolved Threads" --append\n'
            f"- {dog}\n"
            f'=== threads --wrapup "{WRAPUP}"\n'
            + rows(("close", "wrapup", "The black dog", "a stray")),
            encoding="utf-8")
        self.addCleanup(path.unlink)
        code, out = run(vault, "batch", str(path), "--write")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAPUP)
        self.assertIn("closed: a gull", text)
        self.assertIn("closed: a stray", text)

    def test_close_wrapup_repeats_across_sessions(self):
        vault = self.unlisted_vault()
        two = vault / "Chapters/Chapter 1 - Harbour/Session 02 - Wrap-Up.md"
        two.write_text(read(vault, WRAPUP).replace(
            "session_number: 3", "session_number: 2").replace(
            "Session 03 - The Night", "Session 02 - The Early").replace(
            self.BELL, "**Cracked bell** \u2014 someone heard it at dawn."
        ), encoding="utf-8")
        report = self.report(vault)
        self.assertIn("session 2\t", report)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "wrapup", "bell", "a gull")))
        self.assertEqual(code, 1)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("close", "wrapup", "Cracked bell",
                                    "a gull"),
                                   ("close", "wrapup", "The cracked bell",
                                    "a gull")))
        self.assertEqual(code, 0, out)
        text = read(vault, WRAPUP)
        self.assertIn("someone heard it at dawn. \u2014 closed: a gull "
                      "(Session 2)", text)
        self.assertIn("heard it ring at noon. \u2014 closed: a gull "
                      "(Session 3)", text)
        self.assertNotIn("bell", self.report(vault).casefold())

    def test_rest_wrapup_line_goes_dormant_and_is_claimed(self):
        vault = self.unlisted_vault()
        stdin = rows(("rest", "wrapup", "The cracked bell",
                      "nobody is chasing it"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-REST", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn(f"- {self.BELL} \u2014 since Session 3; dormant since "
                      "Session 3 (nobody is chasing it); involves the party",
                      read(vault, OVERVIEW))
        self.assertIn("cracked bell", read(vault, WRAPUP))
        self.assertNotIn("cracked bell", self.report(vault))

    def test_wrapup_lead_also_listed_refused(self):
        vault = self.unlisted_vault()
        path = vault / OVERVIEW
        path.write_text(read(vault, OVERVIEW).replace(
            "## Key Factions",
            "- **The cracked bell** \u2014 worded another way \u2014 since Session 3; "
            "involves the party\n\n## Key Factions"), encoding="utf-8")
        before = self.snapshot(vault)
        for verb in ("close", "rest"):
            code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                            stdin=rows((verb, "wrapup", "The cracked bell",
                                        "why")))
            self.assertEqual(code, 1)
            self.assertIn(f"'The cracked bell' is on the shared list: "
                          f"{verb} it there", out)
            self.assertEqual(self.snapshot(vault), before)

    def test_wrapup_lead_unknown_refused(self):
        vault = self.unlisted_vault()
        before = self.snapshot(vault)
        for verb in ("close", "rest"):
            code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                            stdin=rows((verb, "wrapup", "The red herring",
                                        "why")))
            self.assertEqual(code, 1)
            self.assertIn("no Wrap-Up line on no list matches", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_wake_to_one_pc(self):
        vault = self.vault()
        self.with_dormant(vault)
        stdin = rows(("wake", "Harbour bell", "Corwin_Hale"))
        before = self.snapshot(vault)
        code, out = run(vault, "threads", stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-WAKE", out)
        self.assertEqual(self.snapshot(vault), before)
        code, out = run(vault, "threads", "--write", stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertNotIn("Harbour bell", read(vault, OVERVIEW))
        corwin = read(vault, CORWIN)
        self.assertIn("- **Ferrywoman's debt** \u2014 owes her two silver, due "
                      "at the next full moon\n- **Harbour bell** \u2014 rung "
                      "twice at night\n", corwin)
        self.assertNotIn("dormant", corwin)

    def test_wake_to_an_empty_pc_list_drops_the_filler(self):
        vault = self.vault()
        self.with_dormant(vault)
        self.edit(vault, CORWIN, "**Open threads:**\n- **Ferrywoman's debt** "
                  "\u2014 owes her two silver, due at the next full moon",
                  "**Open threads:** \u2014")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("wake", "Harbour bell", "Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertIn("**Open threads:**\n- **Harbour bell** \u2014 rung twice "
                      "at night\n", read(vault, CORWIN))

    def test_wake_to_party_goes_shared(self):
        vault = self.vault()
        self.with_dormant(vault)
        for who, involves in (("party", "involves the party"),
                              ("Ines_Marlowe, Corwin_Hale",
                               "involves [[Ines_Marlowe]], [[Corwin_Hale]]")):
            with self.subTest(who=who):
                v = self.vault()
                self.with_dormant(v)
                code, out = run(v, "threads", "--write", stdin=rows(
                    ("wake", "Harbour bell", who)))
                self.assertEqual(code, 0, out)
                text = read(v, OVERVIEW)
                self.assertNotIn("Dormant Threads\n\n- **Harbour",
                                 text)
                open_part = text.split("## Dormant")[0]
                self.assertIn("- **Harbour bell** \u2014 rung twice at night "
                              "\u2014 since Session 1; " + involves, open_part)
                self.assertNotIn("dormant since", text)

    def test_wake_unknown_or_hidden_refused(self):
        vault = self.vault()
        self.with_dormant(vault)
        before = self.snapshot(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("wake", "No such thread", "party")))
        self.assertEqual(code, 1)
        self.assertIn("no thread 'No such thread'", out)
        self.edit(vault, OVERVIEW, "involves [[Ines_Marlowe]], "
                  "[[Corwin_Hale]]\n\n## Key Factions",
                  "involves [[Ines_Marlowe]] %%\nsecret\n%%\n\n## Key Factions")
        before = self.snapshot(vault)
        for row in (("wake", "Harbour bell", "party"),
                    ("close", "dormant", "Harbour bell", "x")):
            code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                            stdin=rows(row))
            self.assertEqual(code, 1, row)
            self.assertIn("'Harbour bell' in the Overview's Dormant Threads "
                          "is in or next to hidden text; edit it by hand", out)
        self.assertEqual(self.snapshot(vault), before)

    # -- hand: a PC's line about another PC's matter goes to that PC -----

    LAMP = "Find out who lit the lamp on the north bank"

    def test_hand_preview_then_write(self):
        vault = self.vault()
        stdin = rows(("hand", "Ines_Marlowe", self.LAMP, "Corwin_Hale"))
        before = self.snapshot(vault)
        code, out = run(vault, "threads", stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-HAND\t" + INES, out)
        self.assertIn("WOULD-HAND\t" + CORWIN, out)
        self.assertEqual(self.snapshot(vault), before)
        code, out = run(vault, "threads", "--write", stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("HANDED\t" + CORWIN, out)
        self.assertIn("handed: 1  warnings", out)
        self.assertNotIn("WOULD", out)
        self.assertNotIn(self.LAMP, read(vault, INES))
        self.assertIn("- **Ferrywoman's debt** \u2014 owes her two silver, due "
                      "at the next full moon\n- " + self.LAMP + "\n",
                      read(vault, CORWIN))

    def test_hand_crlf_kept(self):
        vault = self.vault()
        for rel in (INES, CORWIN):
            text = read(vault, rel).replace("\r\n", "\n").replace("\n", "\r\n")
            (vault / rel).write_bytes(text.encode("utf-8"))
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("hand", "Ines_Marlowe", self.LAMP, "Corwin_Hale")))
        self.assertEqual(code, 0, out)
        for rel in (INES, CORWIN):
            data = (vault / rel).read_bytes()
            self.assertEqual(data.count(b"\n"), data.count(b"\r\n"), rel)
        self.assertIn(self.LAMP + "\r\n", read(vault, CORWIN))

    def test_hand_to_an_empty_list_drops_the_filler(self):
        vault = self.vault()
        self.edit(vault, CORWIN, "**Open threads:**\n- **Ferrywoman's debt** "
                  "\u2014 owes her two silver, due at the next full moon",
                  "**Open threads:** \u2014")
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("hand", "Ines_Marlowe", self.LAMP, "Corwin_Hale")))
        self.assertEqual(code, 0, out)
        self.assertIn("**Open threads:**\n- " + self.LAMP + "\n",
                      read(vault, CORWIN))

    def test_hand_hidden_or_unknown_refused(self):
        vault = self.vault()
        before = self.snapshot(vault)
        for row, error in (
                (("hand", "Ines_Marlowe", self.LAMP, "Nobody_Here"),
                 "PC 'Nobody_Here': not found"),
                (("hand", "Nobody_Here", self.LAMP, "Corwin_Hale"),
                 "PC 'Nobody_Here': not found"),
                (("hand", "Ines_Marlowe", "No such thread", "Corwin_Hale"),
                 "no thread 'No such thread'"),
                (("hand", "Ines_Marlowe", self.LAMP, "Ines_Marlowe"),
                 "are the same PC")):
            with self.subTest(row=row):
                code, out = run(vault, "threads", "--write", stdin=rows(row))
                self.assertEqual(code, 1, out)
                self.assertIn(error, out)
        self.assertEqual(self.snapshot(vault), before)
        self.edit(vault, INES, "- " + self.LAMP,
                  "<!-- gm-only -->\n- " + self.LAMP + "\n<!-- /gm-only -->")
        before = self.snapshot(vault)
        # A good row before the refused one is not written either.
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("add", "shared", "-", "party", "New one"),
            ("hand", "Ines_Marlowe", self.LAMP, "Corwin_Hale")))
        self.assertEqual(code, 1, out)
        self.assertIn("on Ines_Marlowe is next to hidden text; edit it by "
                      "hand", out)
        self.assertEqual(self.snapshot(vault), before)

    def test_close_dormant_records_resolved(self):
        vault = self.vault()
        self.with_dormant(vault)
        stdin = rows(("close", "dormant", "Harbour bell", "the bell was melted"))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CLOSE", out)
        self.assertIn("WOULD-RECORD", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=stdin)
        self.assertEqual(code, 0, out)
        self.assertNotIn("Harbour bell", read(vault, OVERVIEW))
        self.assertIn("- **Harbour bell** \u2014 rung twice at night \u2014 "
                      "closed: the bell was melted (dormant)",
                      read(vault, WRAPUP))

    # -- final fixes ----------------------------------------------------------

    def test_a_reworded_thread_rested_or_closed_leaves_no_orphan(self):
        # The lists word both threads differently from the Wrap-Up's lines
        # (a close match and a likely one): parked or closed, the thread
        # still claims its line.
        for row in (("rest", "shared", "The missing ledger", "left the ford"),
                    ("rest", "Ines_Marlowe", self.LAMP, "left the ford"),
                    ("close", "shared", "The missing ledger", "returned"),
                    ("close", "Ines_Marlowe", self.LAMP, "the ferrywoman")):
            with self.subTest(row=row):
                vault = self.vault()
                self.assertEqual(self.report(vault).strip(), "(none)")
                code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                "--write", stdin=rows(row))
                self.assertEqual(code, 0, out)
                self.assertEqual(self.report(vault).strip(), "(none)")

    WRAP4 = "Chapters/Chapter 1 - Harbour/Session 04 - Wrap-Up.md"
    BELL4 = "**The cracked bell** \u2014 a gull nests in it now."

    def two_wordings(self):
        """The cracked bell, worded one way in session 3's Wrap-Up and
        another in session 4's."""
        vault = self.unlisted_vault()
        (vault / self.WRAP4).write_text(read(vault, WRAPUP).replace(
            "session_number: 3", "session_number: 4").replace(
            "Session 03 - The Night", "Session 04 - The Marsh").replace(
            self.BELL, self.BELL4), encoding="utf-8")
        report = self.report(vault)
        self.assertIn("session 3\t" + self.BELL, report)
        self.assertIn("session 4\t" + self.BELL4, report)
        return vault

    def test_one_lead_rests_as_one_entry(self):
        vault = self.two_wordings()
        code, out = run(vault, "threads", "--wrapup", self.WRAP4, "--write",
                        stdin=rows(("rest", "wrapup", "The cracked bell",
                                    "left the chapel")))
        self.assertEqual(code, 0, out)
        self.assertIn("rested: 1  warnings", out)
        dormant = read(vault, OVERVIEW).split("## Dormant Threads", 1)[1]
        self.assertEqual(dormant.count("cracked bell"), 1, dormant)
        self.assertIn(f"- {self.BELL4} \u2014 since Session 3; dormant since "
                      "Session 4 (left the chapel); involves the party",
                      dormant)
        self.assertNotIn("cracked bell", self.report(vault))

    def test_one_lead_closes_as_one_line(self):
        vault = self.two_wordings()
        code, out = run(vault, "threads", "--wrapup", self.WRAP4, "--write",
                        stdin=rows(("close", "wrapup", "The cracked bell",
                                    "a gull")))
        self.assertEqual(code, 0, out)
        self.assertIn("closed: 1  warnings", out)
        wrap = read(vault, self.WRAP4).split("#### Resolved Threads", 1)[1]
        self.assertEqual(wrap.count("cracked bell"), 1, wrap)
        self.assertIn(f"- {self.BELL4} \u2014 closed: a gull (Session 4)",
                      wrap)
        self.assertNotIn("cracked bell", self.report(vault))

    def test_rest_wrapup_takes_who(self):
        vault = self.unlisted_vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(("rest", "wrapup", "The cracked bell",
                                    "quiet", "Ines_Marlowe")))
        self.assertEqual(code, 0, out)
        self.assertIn(f"- {self.BELL} \u2014 since Session 3; dormant since "
                      "Session 3 (quiet); involves [[Ines_Marlowe]]",
                      read(vault, OVERVIEW))
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=rows(
            ("rest", "shared", "The missing ledger", "gone", "Ines_Marlowe")))
        self.assertEqual(code, 1)
        self.assertIn("WHO", out)

    def test_rest_waits_for_a_site_tool_that_hides_the_list(self):
        # A site on publish tool 1.70.5 would publish the dormant list:
        # rest is refused and nothing changes.
        for installed, rests in (("1.70.5", False), ("1.70.6", True)):
            with self.subTest(installed=installed):
                vault = self.vault()
                site = Path(tempfile.mkdtemp(prefix="vwthreads-site-"))
                self.addCleanup(shutil.rmtree, site, ignore_errors=True)
                pkg = site / "node_modules" / "gm-apprentice-publish"
                pkg.mkdir(parents=True)
                (pkg / "package.json").write_text(json.dumps(
                    {"version": installed}), encoding="utf-8")
                write_config(vault, "---\npublish:\n  system: coc-7e\n"
                             f"  site: true\n  site_dir: {site.as_posix()}\n"
                             "---\n")
                before = self.snapshot(vault)
                code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                "--write", stdin=rows(
                                    ("rest", "shared", "The missing ledger",
                                     "gone")))
                if rests:
                    self.assertEqual(code, 0, out)
                    continue
                self.assertEqual(code, 1)
                self.assertIn("1.70.5, older than 1.70.6", out)
                self.assertIn("Dormant Threads", out)
                self.assertEqual(self.snapshot(vault), before)

    def test_wake_with_text_rewords_it(self):
        said = "**Harbour bell** \u2014 it rang for the drowned"
        for who, rel in (("Corwin_Hale", CORWIN), ("party", OVERVIEW)):
            with self.subTest(who=who):
                vault = self.vault()
                self.with_dormant(vault)
                code, out = run(vault, "threads", "--write", stdin=rows(
                    ("wake", "Harbour bell", who, said)))
                self.assertEqual(code, 0, out)
                text = read(vault, rel)
                self.assertIn(f"- {said}", text)
                self.assertNotIn("rung twice", text)

    def test_counts_are_threads_not_rows(self):
        vault = self.vault()
        self.with_dormant(vault)
        for row, said in (
                (("rest", "shared", "The missing ledger", "gone"),
                 "rested: 1  warnings"),
                (("rest", "Ines_Marlowe", self.LAMP, "gone"),
                 "rested: 1  warnings"),
                (("wake", "Harbour bell", "Corwin_Hale"), "woken: 1  warnings"),
                (("hand", "Ines_Marlowe", self.LAMP, "Corwin_Hale"),
                 "handed: 1  warnings")):
            with self.subTest(row=row):
                code, out = run(vault, "threads", "--wrapup", WRAPUP,
                                stdin=rows(row))
                self.assertEqual(code, 0, out)
                self.assertIn(said, out)
        vault = self.unlisted_vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, stdin=rows(
            ("close", "wrapup", "The cracked bell", "a gull")))
        self.assertEqual(code, 0, out)
        self.assertIn("closed: 1  warnings", out)

    def test_wake_names_one_pc_once(self):
        vault = self.vault()
        self.with_dormant(vault)
        code, out = run(vault, "threads", "--write", stdin=rows(
            ("wake", "Harbour bell", "Ines_Marlowe, Ines_Marlowe")))
        self.assertEqual(code, 0, out)
        self.assertIn("- **Harbour bell** \u2014 rung twice at night\n",
                      read(vault, INES))
        self.assertNotIn("Harbour bell", read(vault, OVERVIEW))

    def test_the_last_one_out_takes_the_heading(self):
        vault = self.vault()
        self.with_dormant(vault)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("wake", "Harbour bell", "party"),
                            ("close", "shared", "Harbour bell", "rung"),
                            ("close", "shared", "The missing ledger", "found"),
                            ("close", "shared",
                             "Corwin's debt to the ferrywoman", "paid")))
        self.assertEqual(code, 0, out)
        text = read(vault, OVERVIEW)
        self.assertNotIn("## Open Threads", text)
        self.assertNotIn("## Dormant Threads", text)
        self.assertIn("admits to owning.\n\n## Key Factions", text)

    def test_the_unlisted_lines_are_read_once_a_batch(self):
        import session_context as sc
        vault = self.two_wordings()
        self.edit(vault, self.WRAP4, f"- {self.BELL4}",
                  f"- {self.BELL4}\n- **A stray dog** \u2014 it follows the "
                  "mules.")
        real = sc.unlisted_wrapup_threads
        with mock.patch.object(sc, "unlisted_wrapup_threads",
                               side_effect=real) as spy:
            code, out = run(vault, "threads", "--wrapup", self.WRAP4,
                            stdin=rows(
                                ("close", "wrapup", "A stray dog",
                                 "it went home"),
                                ("rest", "wrapup", "The cracked bell", "x")))
        self.assertEqual(code, 0, out)
        self.assertEqual(spy.call_count, 1)

    def test_the_wrapup_list_is_the_one_the_batch_found(self):
        # A line put on the shared list in player words, then the Wrap-Up
        # line it came from closed, in one batch.
        vault = self.unlisted_vault()
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("add", "shared", "Session 3", "party",
                             "**The cracked bell** \u2014 it rang at noon "
                             "with nobody in the tower"),
                            ("close", "wrapup", "The cracked bell",
                             "now on the shared list"),
                            ("close", "wrapup", "The cracked bell", "again")))
        self.assertEqual(code, 1, out)
        self.assertIn("row 3: close: no Wrap-Up line on no list matches", out)
        code, out = run(vault, "threads", "--wrapup", WRAPUP, "--write",
                        stdin=rows(
                            ("add", "shared", "Session 3", "party",
                             "**The cracked bell** \u2014 it rang at noon "
                             "with nobody in the tower"),
                            ("close", "wrapup", "The cracked bell",
                             "now on the shared list")))
        self.assertEqual(code, 0, out)
        self.assertIn("closed: now on the shared list (Session 3)",
                      read(vault, WRAPUP))


if __name__ == "__main__":
    unittest.main()

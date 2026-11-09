#!/usr/bin/env python3
"""vault_write.py threads: add, move and close shared threads.

Run: python3 -m pytest tests/test_vault_write_threads.py -q
"""

import io
import json
import shutil
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


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""vault_write.py export-new: a table-assistant export filed as its own
Export note beside a session index, whether or not session-play already
wrote the Play Notes (#691)."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tests"))
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import schema_rules  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib as vl  # noqa: E402
from test_vw_play_notes_new import PREPPED  # noqa: E402
from test_vw_session_new import (EXPORT, EXPORT_NOTE, INDEX, NOTES,  # noqa: E402
                                 SESSIONS, VAULT_FILES, make_vault, run)

SESSION = "Session 13 - The Long Way Round"

# What session-play leaves: its own notes, linked, the session played.
PLAYED = (PREPPED.replace("status: prepped", "status: played")
          .replace("  play_notes: null",
                   f'  play_notes: "[[{SESSION} - Play Notes]]"'))
TABLE_NOTES = f"""---
type: session-play-notes
session: "[[{SESSION}]]"
session_number: 13
canon_status: AUTHORITATIVE
created_by: session-play
tags: []
---

# {SESSION} - Play Notes

Scene 1: the airlock. NEW-NPC: Dox, a nervous mechanic.
"""


class ExportNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {**VAULT_FILES, INDEX: PREPPED})
        downloads = Path(tempfile.mkdtemp(prefix="vw-export-"))
        self.addCleanup(shutil.rmtree, downloads, ignore_errors=True)
        self.export = downloads / "session_2026_10_18.md"
        self.export.write_bytes(EXPORT.encode("utf-8"))

    def new(self, *extra):
        return run(self.vault, "export-new", "--session", SESSION,
                   "--export", str(self.export), *extra)

    def read(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def write(self, rel, text):
        (self.vault / rel).write_bytes(text.encode("utf-8"))

    def documents(self):
        return vl.nested_mapping(self.read(INDEX), "documents")

    def test_beside_play_notes_session_play_already_wrote(self):
        self.write(INDEX, PLAYED)
        self.write(NOTES, TABLE_NOTES)
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read(NOTES), TABLE_NOTES)
        text = self.read(EXPORT_NOTE)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "session-export")
        self.assertEqual(vl.wikilink_target(fm["session"]), SESSION)
        self.assertEqual(fm["source_file"], "session_2026_10_18.md")
        # A raw table record: off the player site even with no publish list.
        self.assertEqual(fm["publish"], "false")
        self.assertTrue(text.endswith(EXPORT), text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])
        docs = self.documents()
        self.assertEqual(vl.wikilink_target(docs["export"]),
                         f"{SESSION} - Export")
        self.assertEqual(vl.wikilink_target(docs["play_notes"]),
                         f"{SESSION} - Play Notes")
        self.assertIn("status: played\n", self.read(INDEX))

    def test_created_by_names_who_filed_it(self):
        # #695: vault-ingest files an export as vault-ingest.
        code, out = self.new("--write", "--created-by", "vault-ingest")
        self.assertEqual(code, 0, out)
        self.assertEqual(vl.extract_frontmatter(self.read(EXPORT_NOTE))
                         ["created_by"], "vault-ingest")

    def test_play_notes_can_follow_the_export(self):
        code, out = self.new("--write", "--play-date", "2026-10-18")
        self.assertEqual(code, 0, out)
        self.assertNotIn("-> played", out)    # #855: only wrap-up marks it played
        self.assertFalse((self.vault / NOTES).exists())
        code, out = run(self.vault, "play-notes-new", "--session", SESSION,
                        "--write")
        self.assertEqual(code, 0, out)
        self.assertTrue((self.vault / NOTES).exists())
        self.assertEqual(vl.extract_frontmatter(self.read(NOTES))["publish"],
                         "false")
        self.assertEqual(vl.wikilink_target(self.documents()["export"]),
                         f"{SESSION} - Export")
        self.assertTrue(self.read(EXPORT_NOTE).endswith(EXPORT))

    def test_a_dry_run_writes_nothing(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{EXPORT_NOTE}", out)
        self.assertIn("EXACT\tCharacters/NPCs/Marlo Petrak.md\t§NPCs", out)
        self.assertFalse((self.vault / EXPORT_NOTE).exists())
        self.assertEqual(self.read(INDEX), PREPPED)

    def test_a_second_export_is_refused(self):
        self.assertEqual(self.new("--write")[0], 0)
        code, out = self.new("--write")
        self.assertEqual(code, 1, out)
        self.assertIn("already has an Export", out)

    def test_an_unlinked_export_naming_the_session_is_refused(self):
        other = f"{SESSIONS}/Session 13/Old export.md"
        self.write(other, f'---\ntype: session-export\n'
                          f'session: "[[{SESSION}]]"\n---\n')
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn(f"already has an Export: {SESSIONS}/Session 13/Old export", out)

    def test_an_export_link_to_play_notes_is_refused(self):
        self.write(NOTES, TABLE_NOTES)
        self.write(INDEX, PREPPED.replace(
            "  wrap_up: null", f'  wrap_up: null\n  export: "[[{SESSION} - Play Notes]]"'))
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn("which is not Export", out)

    def test_the_export_is_required(self):
        with self.assertRaises(SystemExit):
            run(self.vault, "export-new", "--session", SESSION)

    def test_a_later_status_never_falls(self):
        self.write(INDEX, PREPPED.replace("status: prepped", "status: wrap-up"))
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        self.assertIn("status: wrap-up\n", self.read(INDEX))


class ExportInTheChainTests(unittest.TestCase):
    """What the rest of the vault tooling makes of an Export note."""

    def setUp(self):
        self.vault = make_vault(self, {**VAULT_FILES, INDEX: PREPPED})
        export = self.vault.parent / f"{self.vault.name}-export.md"
        export.write_bytes(EXPORT.encode("utf-8"))
        self.addCleanup(export.unlink)
        self.export = export

    def file_export(self):
        code, out = run(self.vault, "export-new", "--session", SESSION,
                        "--export", str(self.export), "--write")
        self.assertEqual(code, 0, out)

    def session_rows(self):
        return [r for r in vc.check_sessions(self.vault) if INDEX in r]

    def test_an_export_alone_puts_the_session_in_play(self):
        # #855: in play, not played; the status stays prepped and is not warned about.
        self.file_export()
        rows = self.session_rows()
        info = next(r for r in rows if "derived=" in r)
        self.assertIn("export=✓", info)
        self.assertIn("declared=prepped derived=planned (in play)", info)
        self.assertFalse([r for r in rows if r.startswith("WARNING")
                          and ("status" in r or "export" in r)], rows)

    def test_no_export_flag_on_a_session_without_one(self):
        info = next(r for r in self.session_rows() if "derived=" in r)
        self.assertNotIn("export=", info)

    def test_a_dangling_export_link_is_a_warning(self):
        (self.vault / INDEX).write_bytes(PREPPED.replace(
            "  wrap_up: null", '  wrap_up: null\n  export: "[[Gone]]"').encode("utf-8"))
        rows = self.session_rows()
        self.assertTrue(any("documents.export links '[[Gone]]'" in r for r in rows), rows)

    def test_wrapup_source_is_the_export_when_there_are_no_play_notes(self):
        self.file_export()
        code, out = run(self.vault, "wrapup-new", "--session", INDEX, "--write")
        self.assertEqual(code, 0, out)
        wrap = next(self.vault.rglob("Chapter_01_Session_13_Wrap_Up.md"))
        fm = vl.extract_frontmatter(wrap.read_text(encoding="utf-8"))
        self.assertEqual(vl.wikilink_target(fm["source_document"]),
                         f"{SESSION} - Export")

    def test_wrapup_source_is_the_export_when_both_exist(self):
        self.file_export()
        code, out = run(self.vault, "play-notes-new", "--session", SESSION,
                        "--write")
        self.assertEqual(code, 0, out)
        code, out = run(self.vault, "wrapup-new", "--session", INDEX, "--write")
        self.assertEqual(code, 0, out)
        wrap = next(self.vault.rglob("Chapter_01_Session_13_Wrap_Up.md"))
        fm = vl.extract_frontmatter(wrap.read_text(encoding="utf-8"))
        self.assertEqual(vl.wikilink_target(fm["source_document"]),
                         f"{SESSION} - Export")

    def test_the_wrapup_repair_backfills_the_export_as_source(self):
        self.file_export()
        wrap = f"{SESSIONS}/Session 13/Chapter_01_Session_13_Wrap_Up.md"
        (self.vault / wrap).write_text(
            f'---\ntype: session_wrap\nsession: "[[{SESSION}]]"\n'
            'session_number: 13\ncanon_status: DRAFT\ntags: []\n---\n\n'
            '# Wrap-Up\n', encoding="utf-8")
        fm = vl.extract_frontmatter((self.vault / wrap).read_text(encoding="utf-8"))
        entries = [(r, t, vl.extract_frontmatter(t) or {})
                   for r, t in vl.vault_files(self.vault)]
        ctx = vc._wrap_context(wrap, fm, entries)
        self.assertEqual(ctx.notes_rel, EXPORT_NOTE)

    def test_session_new_with_an_export_reports_the_index_once(self):
        (self.vault / INDEX).unlink()
        code, out = run(self.vault, "session-new", "--number", "13",
                        "--title", "The Long Way Round",
                        "--export", str(self.export))
        self.assertEqual(code, 0, out)
        self.assertNotIn(f"WOULD-ADD\t{INDEX}", out)
        self.assertIn(f"WOULD-CREATE\t{EXPORT_NOTE}", out)

    def test_the_gm_leak_check_skips_it_as_it_skips_play_notes(self):
        self.assertIn("session-export", vc.GM_LEAK_SKIP_TYPES)
        self.assertIn("session-play-notes", vc.GM_LEAK_SKIP_TYPES)

    def test_schema_show_reads_its_fields_from_the_chain_doc(self):
        shown = schema_rules.show("session-export")
        self.assertIn("session-document-chain.md", shown)
        self.assertIn("source_file", shown)



class ExportReviewFixTests(unittest.TestCase):
    """The PR #693 review: a play record that does publish is scanned, a
    dangling export link is not a source, and the Story page link."""

    def test_gm_leak_scans_a_play_record_the_tool_says_publishes(self):
        from unittest import mock
        from test_vault_check_slice_a import make_vault as vc_vault
        from test_vault_check_slice_a import stub_publish_tool
        vault = vc_vault(self)
        rel = "Sessions/Session 1 - Export.md"
        (vault / "Sessions").mkdir()
        (vault / rel).write_text(
            '---\ntype: session-export\nsession: "[[Session 1]]"\n---\n\n'
            "# Export\n\n## Keeper Notes\n\nThe butler did it.\n",
            encoding="utf-8")
        stub_publish_tool(self, vault)
        with mock.patch.object(vc, "pages_published", return_value={rel}):
            rows = [r for r in vc.check_gm_leak(vault, None) if rel in r]
        self.assertTrue(rows, "a published Export is scanned")
        with mock.patch.object(vc, "pages_published", return_value=set()):
            rows = [r for r in vc.check_gm_leak(vault, None) if rel in r]
        self.assertFalse(rows, rows)

    def test_a_dangling_export_link_is_not_the_wrapup_source(self):
        vault = make_vault(self, {**VAULT_FILES, INDEX: PREPPED.replace(
            "  wrap_up: null", '  wrap_up: null\n  export: "[[Gone]]"')})
        code, out = run(vault, "play-notes-new", "--session", SESSION, "--write")
        self.assertEqual(code, 0, out)
        code, out = run(vault, "wrapup-new", "--session", INDEX, "--write")
        self.assertEqual(code, 0, out)
        wrap = next(vault.rglob("Chapter_01_Session_13_Wrap_Up.md"))
        fm = vl.extract_frontmatter(wrap.read_text(encoding="utf-8"))
        self.assertEqual(vl.wikilink_target(fm["source_document"]),
                         f"{SESSION} - Play Notes")

    def test_reveal_scan_takes_an_unlinked_record_only_if_it_names_the_session(self):
        import reveal_scan as rs
        from reconcile_scan import Note, _index
        index = Note("S/Session 2.md", "---\ntype: session\nsession_number: 2\n---\n")
        other = Note("S/Session 1 - Export.md",
                     '---\ntype: session-export\nsession: "[[Session 1]]"\n---\n')
        own = Note("S/Session 2 - Export.md",
                   '---\ntype: session-export\nsession: "[[Session 2]]"\n---\n')
        first = Note("S/Session 1.md", "---\ntype: session\nsession_number: 1\n---\n")
        notes = [index, other, first]
        self.assertEqual(rs._sources(index, notes, _index(notes)), [])
        notes = [index, other, own, first]
        self.assertEqual([(label, n.rel) for label, n in rs._sources(index, notes, _index(notes))],
                         [("Export", own.rel)])

    def test_wrapup_repair_without_a_chapter_keeps_to_its_index_chapter(self):
        def note(rel, text):
            return (rel, text, vl.extract_frontmatter(text) or {})
        ch1, ch2 = "Chapters/Chapter 1 - A", "Chapters/Chapter 2 - B"
        entries = [
            note(f"{ch1}/Sessions/Session 01/Session 01 - Arrival.md",
                 '---\ntype: session\nsession_number: 1\nchapter: "[[Chapter 1 - A]]"\n---\n'),
            note(f"{ch1}/Sessions/Session 01/Session 01 - Arrival - Play Notes.md",
                 '---\ntype: session-play-notes\nsession: "[[Session 01 - Arrival]]"\n'
                 'session_number: 1\nchapter: "[[Chapter 1 - A]]"\n---\n'),
            note(f"{ch2}/Sessions/Session 01/Session 01 - Return - Export.md",
                 '---\ntype: session-export\nsession: "[[Session 01 - Return]]"\n'
                 'session_number: 1\nchapter: "[[Chapter 2 - B]]"\n---\n'),
        ]
        wrap = "Chapter_01_Session_01_Wrap_Up.md"
        fm = {"type": "session_wrap", "session": "[[Session 01 - Arrival]]",
              "session_number": "1"}
        ctx = vc._wrap_context(wrap, fm, entries)
        self.assertEqual(ctx.notes_rel, entries[1][0])

    def test_wrapup_repair_skips_a_record_naming_another_session(self):
        def note(rel, text):
            return (rel, text, vl.extract_frontmatter(text) or {})
        entries = [
            note("Session 01 - Arrival.md",
                 "---\ntype: session\nsession_number: 1\n---\n"),
            note("Session 01 - Arrival - Play Notes.md",
                 '---\ntype: session-play-notes\nsession: "[[Session 01 - Arrival]]"\n'
                 "session_number: 1\n---\n"),
            # No chapter, same number, but it names another session's index.
            note("Session 01 - Return - Export.md",
                 '---\ntype: session-export\nsession: "[[Session 01 - Return]]"\n'
                 "session_number: 1\n---\n"),
        ]
        fm = {"type": "session_wrap", "session": "[[Session 01 - Arrival]]",
              "session_number": "1"}
        ctx = vc._wrap_context("Chapter_01_Session_01_Wrap_Up.md", fm, entries)
        self.assertEqual(ctx.notes_rel, "Session 01 - Arrival - Play Notes.md")

if __name__ == "__main__":
    unittest.main()

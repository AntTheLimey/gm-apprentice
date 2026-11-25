#!/usr/bin/env python3
"""vault_write.py table-log-new: an empty Table Log filed beside a session
index, its sections in the contract's order, for the run sheet to fill."""

import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tests"))
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import schema_rules  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402
from test_vw_play_notes_new import PREPPED  # noqa: E402
from test_vw_session_new import (EXPORT_NOTE, INDEX, NOTES, SESSIONS,  # noqa: E402
                                 VAULT_FILES, make_vault, run)
from test_vw_batch import batch  # noqa: E402
from test_vw_export_new import TABLE_NOTES  # noqa: E402

SESSION = "Session 13 - The Long Way Round"
LOG_NOTE = f"{SESSIONS}/Session 13/{SESSION} - Table Log.md"

SECTIONS = [
    "Where everyone ended", "Stopped in", "Points landed",
    "Tried and missed", "Overtaken", "Reached but not landed",
    "Not reached", "Changed since play started",
    "Contingencies that fired", "Improvised beats", "Places the party went",
    "Unmasked this session", "Sides set", "Handouts handed over",
    "Log", "Loot",
    "Vitals at the end", "Advancement",
]


class TableLogNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {**VAULT_FILES, INDEX: PREPPED})

    def new(self, *extra):
        return run(self.vault, "table-log-new", "--session", SESSION, *extra)

    def read(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def write(self, rel, text):
        (self.vault / rel).write_bytes(text.encode("utf-8"))

    def documents(self):
        return vl.nested_mapping(self.read(INDEX), "documents")

    def test_sections_constant_is_the_contract(self):
        self.assertEqual(list(vw.TABLE_LOG_SECTIONS), SECTIONS)

    def test_files_skeleton(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{LOG_NOTE}", out)
        self.assertFalse((self.vault / LOG_NOTE).exists())
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        text = self.read(LOG_NOTE)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "session-table-log")
        self.assertEqual(fm["publish"], "false")
        self.assertEqual(fm["created_by"], "manual")
        self.assertEqual(vl.wikilink_target(fm["session"]), SESSION)
        self.assertEqual(re.findall(r"^## (.*)$", text, re.M), SECTIONS)
        body = text.split("---\n", 2)[2]
        # every section empty but the vitals table's header and separator rows
        self.assertEqual(
            [s.strip() for s in re.split(r"^## .*$", body, flags=re.M)[1:]],
            # 16 empty since the 6a Task 13 proof added "Places the party went" (Ant's ruling: a place the players
            # go to is published); 15 since run sheet 6a added "Sides set"
            [""] * 16 + ["| Who | HP | Conditions |\n| --- | --- | --- |", ""])
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_created_by_run_sheet(self):
        code, out = self.new("--write", "--created-by", "run-sheet")
        self.assertEqual(code, 0, out)
        self.assertEqual(vl.extract_frontmatter(self.read(LOG_NOTE))
                         ["created_by"], "run-sheet")

    def test_only_table_log_new_takes_run_sheet(self):
        with self.assertRaises(SystemExit):
            run(self.vault, "export-new", "--session", SESSION, "--export",
                "x.md", "--created-by", "run-sheet")
        with self.assertRaises(SystemExit):
            run(self.vault, "play-notes-new", "--session", SESSION,
                "--created-by", "run-sheet")

    def test_links_index_and_keeps_status(self):
        # #855: filing the Table Log never changes the status.
        self.write(INDEX, PREPPED.replace("status: prepped",
                                          "status: prepped  # as planned"))
        code, out = self.new("--write", "--play-date", "2026-10-18")
        self.assertEqual(code, 0, out)
        self.assertEqual(vl.wikilink_target(self.documents()["table_log"]),
                         f"{SESSION} - Table Log")
        self.assertIn("status: prepped  # as planned\n", self.read(INDEX))
        self.assertIn('play_date: "2026-10-18"', self.read(INDEX))

    def test_leaves_other_records_alone(self):
        self.write(NOTES, TABLE_NOTES)
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read(NOTES), TABLE_NOTES)

    def test_refuses_existing_linked(self):
        self.assertEqual(self.new("--write")[0], 0)
        code, out = self.new("--write")
        self.assertEqual(code, 1, out)
        self.assertIn("already has a Table Log", out)
        self.assertIn(LOG_NOTE, out)

    def test_refuses_existing_by_session(self):
        other = f"{SESSIONS}/Session 13/Old log.md"
        self.write(other, f'---\ntype: session-table-log\n'
                          f'session: "[[{SESSION}]]"\n---\n')
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn(f"already has a Table Log: {SESSIONS}/Session 13/Old log", out)

    def test_refuses_wrong_type_link(self):
        self.write(NOTES, TABLE_NOTES)
        self.write(INDEX, PREPPED.replace(
            "  wrap_up: null",
            f'  wrap_up: null\n  table_log: "[[{SESSION} - Play Notes]]"'))
        code, out = self.new()
        self.assertEqual(code, 1, out)
        self.assertIn("which is not Table Log", out)

    # Task 20: the vitals header is the vault's system's columns (the ontology's
    # game_systems run_sheet.vitals), Who first. D&D's, and a vault with no
    # system's, is the three-column header the tests above pin.
    def vitals_head(self, system):
        if system is not None:
            (self.vault / "_meta").mkdir(exist_ok=True)
            self.write("_meta/vault-config.yaml",
                       f"version: 1\nvault:\n  system: {system}\n")
        code, out = self.new("--write")
        self.assertEqual(code, 0, out)
        body = self.read(LOG_NOTE).split("## Vitals at the end\n", 1)[1]
        return body.split("\n## ", 1)[0].strip()

    def test_vitals_head_on_a_coc_vault(self):
        self.assertEqual(
            self.vitals_head("coc-7e"),
            "| Who | HP | MP | SAN | Luck | Conditions |\n"
            "| --- | --- | --- | --- | --- | --- |")

    def test_vitals_head_on_a_regency_vault_is_cocs_not_dnds(self):
        # Regency PCs carry SAN; Reputation is never a column (Ant, 2026-11-22)
        self.assertEqual(
            self.vitals_head("regency-cthulhu"),
            "| Who | HP | MP | SAN | Luck | Conditions |\n"
            "| --- | --- | --- | --- | --- | --- |")

    def test_vitals_head_on_a_gurps_vault(self):
        self.assertEqual(
            self.vitals_head("gurps"),
            "| Who | HP | FP | Conditions |\n| --- | --- | --- | --- |")

    def test_vitals_head_on_a_vault_with_no_system_is_dnds(self):
        self.assertEqual(self.vitals_head(None),
                         vw.TABLE_LOG_VITALS_HEAD.strip())

    def test_vitals_head_function_per_system(self):
        self.assertEqual(vw.table_log_vitals_head("dnd-5e-2024"),
                         vw.TABLE_LOG_VITALS_HEAD)
        # a system with no run_sheet columns (PF2e, FitD) or none known: D&D's
        for system in (None, "pf2e", "fitd", "no-such-game"):
            self.assertEqual(vw.table_log_vitals_head(system),
                             vw.TABLE_LOG_VITALS_HEAD, system)

    def test_play_notes_have_no_vitals_table(self):
        text = vw.record_text("play_notes", SESSION, 13, None, None, None,
                              system="coc-7e")
        self.assertNotIn("| Who |", text)

    def test_batch_block(self):
        code, out = batch(self.vault,
                          f'=== table-log-new --session "{SESSION}"\n',
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertTrue((self.vault / LOG_NOTE).exists())
        self.assertIn("table_log", self.read(INDEX))


class SourceDocumentIgnoresTableLogTests(unittest.TestCase):
    def wrap(self, files, extra_index=PREPPED):
        vault = make_vault(self, {**VAULT_FILES, INDEX: extra_index, **files})
        code, out = run(vault, "table-log-new", "--session", SESSION, "--write")
        self.assertEqual(code, 0, out)
        code, out = run(vault, "wrapup-new", "--session", INDEX, "--write")
        self.assertEqual(code, 0, out)
        wrap = next(vault.rglob("Chapter_01_Session_13_Wrap_Up.md"))
        return vl.extract_frontmatter(wrap.read_text(encoding="utf-8")), out

    def test_export_wins(self):
        export_note = (f'---\ntype: session-export\nsession: "[[{SESSION}]]"\n'
                       "---\n\n# Export\n")
        fm, _ = self.wrap({EXPORT_NOTE: export_note, NOTES: TABLE_NOTES})
        self.assertEqual(vl.wikilink_target(fm["source_document"]),
                         f"{SESSION} - Export")

    def test_play_notes_beside_a_table_log(self):
        fm, _ = self.wrap({NOTES: TABLE_NOTES})
        self.assertEqual(vl.wikilink_target(fm["source_document"]),
                         f"{SESSION} - Play Notes")

    def test_table_log_alone_is_no_source(self):
        fm, out = self.wrap({})
        self.assertFalse(vl.wikilink_target(fm.get("source_document") or ""),
                         fm)


if __name__ == "__main__":
    unittest.main()

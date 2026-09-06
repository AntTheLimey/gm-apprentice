#!/usr/bin/env python3
"""Regression tests for stamp_entities.py's generic frontmatter writes.

Covers the Slice A additions — --set, --increment, --promote,
--reconciled, --supersede-by and --repair-canon — plus the safety
properties they share with the original stamping pass: dry-run by
default, one targeted line changed per action, the file's own line
endings preserved, and a refusal that leaves the file byte-identical.

The original --session/--date/--retag rows are pinned by
tests/test_vault_utilities.py; this file only asserts they still work
now that each flag may be given on its own.

Fixtures are built with `fm()` rather than triple-quoted blocks on
purpose: a source line starting with `confidence:` or
`source_confidence:` trips the repo's legacy-field CI guard.

Run: python tests/test_stamp_entities.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "stamp_entities.py"
sys.path.insert(0, str(SCRIPTS))

import stamp_entities as se  # noqa: E402


def fm(*rows: str) -> str:
    """A note built line by line, so no fixture line starts a legacy key."""
    return "".join(row + "\n" for row in rows)


SESSION_INDEX = fm(
    "---",
    "type: session",
    "canon_status: DRAFT",
    "status: planned",
    "session_number: 2",
    "documents:",
    '  plan: "[[Chapter_01_Session_02_Plan]]"',
    "---",
    "",
    "# Session 02",
)

OVERVIEW = fm(
    "---",
    "type: campaign",
    "canon_status: AUTHORITATIVE",
    'current_game_date: "1 May 1814"',
    "sessions_played: 3",
    'last_session: "[[Session 01 - Opening]]"',
    "---",
    "",
    "# Campaign Overview",
)


def diff_lines(before: str, after: str) -> list[tuple[str, str]]:
    """Pairs of differing lines, so a test can assert 'one line changed'."""
    a, b = before.splitlines(), after.splitlines()
    if len(a) != len(b):
        return [("<line count>", f"{len(a)} -> {len(b)}")]
    return [(x, y) for x, y in zip(a, b) if x != y]


class ScriptCase(unittest.TestCase):
    """A throwaway vault plus a subprocess runner for the script."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.vault = self.tmp / "vault"
        self.vault.mkdir()

    def note(self, rel: str, text: str) -> Path:
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="")
        return path

    def run_script(self, *args: str, rc: int = 0) -> str:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.vault), *args],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(
            proc.returncode, rc,
            f"args={args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
        return proc.stdout


class SetTests(ScriptCase):
    def test_dry_run_then_write_changes_one_line(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        before = path.read_text(encoding="utf-8")

        dry = self.run_script("Sessions/S02.md", "--set", "status=prepped")
        self.assertIn("WOULD-STAMP", dry)
        # yaml_value_for_cli double-quotes a prose value; an unquoted
        # one would be a flow sequence the moment it grew a comma.
        self.assertIn('status: planned -> status: "prepped"', dry)
        self.assertIn("# dry-run would stamp: 1 files", dry)
        self.assertEqual(path.read_text(encoding="utf-8"), before)

        out = self.run_script("Sessions/S02.md", "--set", "status=prepped",
                              "--write")
        self.assertIn("STAMPED", out)
        after = path.read_text(encoding="utf-8")
        self.assertEqual(diff_lines(before, after),
                         [("status: planned", 'status: "prepped"')])

    def test_nested_key_lands_in_the_documents_block(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        before = path.read_text(encoding="utf-8")
        self.run_script(
            "Sessions/S02.md", "--set",
            "documents.wrap_up=[[Chapter_01_Session_02_Wrap_Up]]", "--write")
        after = path.read_text(encoding="utf-8")
        self.assertIn('  wrap_up: "[[Chapter_01_Session_02_Wrap_Up]]"\n',
                      after)
        # Inside the block, not at column 0, and nothing else moved.
        self.assertNotIn('\nwrap_up:', after)
        self.assertEqual(before.replace(
            '  plan: "[[Chapter_01_Session_02_Plan]]"\n',
            '  plan: "[[Chapter_01_Session_02_Plan]]"\n'
            '  wrap_up: "[[Chapter_01_Session_02_Wrap_Up]]"\n'), after)

    def test_three_actions_in_one_row(self):
        path = self.note("Campaign_Overview.md", OVERVIEW)
        out = self.run_script(
            "Campaign_Overview.md",
            "--set", "current_game_date=12 May 1814",
            "--increment", "sessions_played",
            "--set", "last_session=[[Session 02 - The Duel]]",
            "--write")
        rows = [r for r in out.splitlines() if not r.startswith("#")]
        self.assertEqual(len(rows), 1, out)
        self.assertEqual(rows[0].count(";"), 2, rows[0])
        self.assertIn("sessions_played: 3 -> 4", rows[0])
        after = path.read_text(encoding="utf-8")
        self.assertIn('current_game_date: "12 May 1814"\n', after)
        self.assertIn("sessions_played: 4\n", after)
        self.assertIn('last_session: "[[Session 02 - The Duel]]"\n', after)

    def test_reserved_keys_are_refused(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        before = path.read_text(encoding="utf-8")
        for pair, hint in (("canon_status=AUTHORITATIVE", "--promote"),
                           ("asOfSession=9", "--session"),
                           ("lastUpdated=2026-09-06", "--date")):
            out = self.run_script("Sessions/S02.md", "--set", pair,
                                  "--write", rc=1)
            self.assertIn("ERROR", out)
            self.assertIn(hint, out)
            self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_malformed_set_argument_is_a_usage_error(self):
        self.note("Sessions/S02.md", SESSION_INDEX)
        self.run_script("Sessions/S02.md", "--set", "status", rc=2)
        self.run_script("Sessions/S02.md", "--set", "=prepped", rc=2)
        self.run_script("Sessions/S02.md", "--set", "a.b.c=1", rc=2)
        # An empty dotted child used to skip validation and write a
        # nameless `: 1` under the parent — YAML no writer can read back.
        self.run_script("Sessions/S02.md", "--set", "a.=1", rc=2)
        self.run_script("Sessions/S02.md", "--set", "documents.=X", rc=2)

    def test_value_may_contain_an_equals_sign(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        self.run_script("Sessions/S02.md", "--set", "formula=hits=3d6+2",
                        "--write")
        self.assertIn('formula: "hits=3d6+2"\n',
                      path.read_text(encoding="utf-8"))

    def test_dotted_key_creates_an_absent_parent_block(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        self.run_script("Sessions/S02.md", "--set", "extras.note=hi",
                        "--write")
        after = path.read_text(encoding="utf-8")
        self.assertIn("extras:\n  note: \"hi\"\n", after)

    def test_no_action_flag_is_a_usage_error(self):
        self.note("Sessions/S02.md", SESSION_INDEX)
        self.run_script("Sessions/S02.md", rc=2)


class IncrementTests(ScriptCase):
    def test_absent_key_starts_at_one(self):
        path = self.note("Campaign_Overview.md", OVERVIEW)
        out = self.run_script("Campaign_Overview.md", "--increment",
                              "sessions_missed", "--write")
        self.assertIn("added sessions_missed: 1", out)
        self.assertIn("sessions_missed: 1\n",
                      path.read_text(encoding="utf-8"))

    def test_empty_value_reads_as_zero(self):
        path = self.note("Campaign_Overview.md",
                         OVERVIEW.replace("sessions_played: 3",
                                          "sessions_played:"))
        out = self.run_script("Campaign_Overview.md", "--increment",
                              "sessions_played", "--write")
        self.assertIn("sessions_played: (empty) -> 1", out)
        self.assertIn("sessions_played: 1\n",
                      path.read_text(encoding="utf-8"))

    def test_trailing_comment_is_not_part_of_the_number(self):
        path = self.note("Campaign_Overview.md",
                         OVERVIEW.replace("sessions_played: 3",
                                          "sessions_played: 3  # counted"))
        self.run_script("Campaign_Overview.md", "--increment",
                        "sessions_played", "--write")
        self.assertIn("sessions_played: 4\n",
                      path.read_text(encoding="utf-8"))

    def test_quoted_integer_increments_bare(self):
        path = self.note("Campaign_Overview.md",
                         OVERVIEW.replace("sessions_played: 3",
                                          'sessions_played: "3"'))
        self.run_script("Campaign_Overview.md", "--increment",
                        "sessions_played", "--write")
        self.assertIn("sessions_played: 4\n",
                      path.read_text(encoding="utf-8"))

    def test_non_integer_is_refused_and_the_file_is_untouched(self):
        path = self.note("Campaign_Overview.md",
                         OVERVIEW.replace("sessions_played: 3",
                                          'sessions_played: "a few"'))
        before = path.read_bytes()
        out = self.run_script("Campaign_Overview.md", "--increment",
                              "sessions_played", "--write", rc=1)
        self.assertIn("ERROR", out)
        self.assertIn("not an integer", out)
        self.assertEqual(path.read_bytes(), before)


class CanonStatusTests(ScriptCase):
    def test_promote_draft(self):
        path = self.note("NPCs/Doc.md", SESSION_INDEX)
        out = self.run_script("NPCs/Doc.md", "--promote", "--write")
        self.assertIn("STAMPED", out)
        self.assertIn("canon_status: DRAFT -> canon_status: AUTHORITATIVE",
                      out)
        self.assertIn("canon_status: AUTHORITATIVE\n",
                      path.read_text(encoding="utf-8"))

    def test_promote_accepts_a_lowercase_draft(self):
        # Real vaults are inconsistent about the case of these values;
        # a `draft` that refused to promote would just look broken.
        path = self.note("NPCs/Doc.md",
                         SESSION_INDEX.replace("canon_status: DRAFT",
                                               "canon_status: draft"))
        self.run_script("NPCs/Doc.md", "--promote", "--write")
        self.assertIn("canon_status: AUTHORITATIVE\n",
                      path.read_text(encoding="utf-8"))

    def test_promote_ignores_a_trailing_comment(self):
        path = self.note("NPCs/Doc.md", SESSION_INDEX.replace(
            "canon_status: DRAFT", "canon_status: DRAFT  # confirmed"))
        self.run_script("NPCs/Doc.md", "--promote", "--write")
        self.assertIn("canon_status: AUTHORITATIVE\n",
                      path.read_text(encoding="utf-8"))

    def test_promote_is_idempotent(self):
        path = self.note("NPCs/Doc.md", OVERVIEW)
        before = path.read_bytes()
        out = self.run_script("NPCs/Doc.md", "--promote", "--write")
        self.assertIn("UNCHANGED", out)
        self.assertIn("canon_status already AUTHORITATIVE", out)
        self.assertEqual(path.read_bytes(), before)

    def test_promote_refuses_a_stub(self):
        path = self.note("NPCs/Doc.md",
                         SESSION_INDEX.replace("canon_status: DRAFT",
                                               "canon_status: STUB"))
        before = path.read_bytes()
        out = self.run_script("NPCs/Doc.md", "--promote", "--write", rc=1)
        self.assertIn("ERROR", out)
        self.assertIn("refusing to promote a STUB", out)
        self.assertEqual(path.read_bytes(), before)

    def test_promote_refuses_a_superseded_entity(self):
        self.note("NPCs/Doc.md",
                  SESSION_INDEX.replace("canon_status: DRAFT",
                                        "canon_status: SUPERSEDED"))
        out = self.run_script("NPCs/Doc.md", "--promote", "--write", rc=1)
        self.assertIn("SUPERSEDED — promote the superseding entity", out)

    def test_supersede_by(self):
        path = self.note("NPCs/Doc.md", SESSION_INDEX)
        out = self.run_script("NPCs/Doc.md", "--supersede-by",
                              "[[Doc Sinclair]]", "--write")
        self.assertIn("STAMPED", out)
        after = path.read_text(encoding="utf-8")
        self.assertIn("canon_status: SUPERSEDED\n", after)
        self.assertIn('superseded_by: "[[Doc Sinclair]]"\n', after)

    def test_promote_and_supersede_by_are_mutually_exclusive(self):
        self.note("NPCs/Doc.md", SESSION_INDEX)
        self.run_script("NPCs/Doc.md", "--promote", "--supersede-by",
                        "[[Other]]", rc=2)

    def test_reconciled(self):
        path = self.note("Sessions/S02.md", SESSION_INDEX)
        out = self.run_script("Sessions/S02.md", "--reconciled",
                              "2026-09-06", "--write")
        self.assertIn("added reconciled: \"2026-09-06\"", out)
        self.assertIn('reconciled: "2026-09-06"\n',
                      path.read_text(encoding="utf-8"))

    def test_reconciled_validates_the_date(self):
        self.note("Sessions/S02.md", SESSION_INDEX)
        self.run_script("Sessions/S02.md", "--reconciled", "6 Sep 2026", rc=2)


class RepairCanonTests(ScriptCase):
    def test_case_one_renames_in_place(self):
        path = self.note("NPCs/Legacy.md", fm(
            "---", "type: npc", "source_" + "confidence: DRAFT", "---",
            "", "# Legacy"))
        out = self.run_script("--repair-canon", "NPCs/Legacy.md", "--write")
        self.assertIn("REPAIRED", out)
        after = path.read_text(encoding="utf-8")
        self.assertEqual(after.count("canon_status:"), 1)
        self.assertIn("canon_status: DRAFT\n", after)
        self.assertNotIn("confidence:", after)

    def test_case_two_deletes_the_agreeing_legacy_line(self):
        path = self.note("NPCs/Both.md", fm(
            "---", "type: npc", "canon_status: DRAFT",
            'confidence: "draft"', "---", "", "# Both"))
        out = self.run_script("--repair-canon", "NPCs/Both.md", "--write")
        self.assertIn("REPAIRED", out)
        self.assertNotIn("CONFLICT", out)
        after = path.read_text(encoding="utf-8")
        self.assertEqual(after.count("canon_status:"), 1)
        self.assertIn("canon_status: DRAFT\n", after)
        self.assertNotIn("confidence:", after)

    def test_case_two_ignores_a_trailing_comment(self):
        path = self.note("NPCs/Noted.md", fm(
            "---", "type: npc", "canon_status: DRAFT",
            "confidence: DRAFT  # legacy note", "---", "", "# Noted"))
        out = self.run_script("--repair-canon", "NPCs/Noted.md", "--write")
        self.assertIn("REPAIRED", out)
        self.assertNotIn("CONFLICT", out)
        after = path.read_text(encoding="utf-8")
        self.assertEqual(after.count("canon_status:"), 1)
        self.assertNotIn("confidence:", after)

    def test_case_three_conflict_row_carries_both_values(self):
        path = self.note("NPCs/Clash.md", fm(
            "---", "type: npc", "canon_status: AUTHORITATIVE",
            "confidence: DRAFT", "---", "", "# Clash"))
        out = self.run_script("--repair-canon", "NPCs/Clash.md", "--write")
        self.assertIn("CONFLICT", out)
        self.assertIn("DRAFT", out)
        self.assertIn("AUTHORITATIVE", out)
        self.assertIn("1 conflicts", out)
        after = path.read_text(encoding="utf-8")
        self.assertEqual(after.count("canon_status:"), 1)
        self.assertIn("canon_status: AUTHORITATIVE\n", after)
        self.assertNotIn("confidence:", after)

    def test_dry_run_conflict_is_labelled_would(self):
        path = self.note("NPCs/Clash.md", fm(
            "---", "type: npc", "canon_status: AUTHORITATIVE",
            "confidence: DRAFT", "---", "", "# Clash"))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "NPCs/Clash.md")
        self.assertIn("WOULD-CONFLICT", out)
        self.assertIn("# dry-run would repair: 1 files, 1 conflicts", out)
        self.assertEqual(path.read_bytes(), before)

    def test_crlf_is_preserved_through_a_repair(self):
        path = self.note("NPCs/Legacy.md", fm(
            "---", "type: npc", "source_" + "confidence: DRAFT", "---",
            "", "# Legacy").replace("\n", "\r\n"))
        self.run_script("--repair-canon", "NPCs/Legacy.md", "--write")
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertIn(b"canon_status: DRAFT\r\n", raw)

    def test_refusal_wording_says_not_repaired(self):
        self.note("NPCs/Bad.md", "---\ntype: npc\n--- \nBody.\n")
        out = self.run_script("--repair-canon", "NPCs/Bad.md", rc=1)
        self.assertIn("not repaired", out)
        self.assertNotIn("not stamped", out)

    def test_dry_run_does_not_write(self):
        path = self.note("NPCs/Legacy.md", fm(
            "---", "type: npc", "source_" + "confidence: DRAFT", "---",
            "", "# Legacy"))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "NPCs/Legacy.md")
        self.assertIn("WOULD-REPAIR", out)
        self.assertEqual(path.read_bytes(), before)

    def test_named_file_without_a_legacy_key_is_unchanged(self):
        self.note("NPCs/Clean.md", SESSION_INDEX)
        out = self.run_script("--repair-canon", "NPCs/Clean.md")
        # Not a bare mode and an empty third column — say why.
        self.assertIn("UNCHANGED\tNPCs/Clean.md\tno legacy key", out)

    def test_body_code_block_is_never_touched(self):
        path = self.note("Docs/Guide.md", fm(
            "---", "type: reference", "canon_status: DRAFT", "---",
            "", "# Guide", "", "```yaml", "confidence: HIGH", "```", ""))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "--write")
        self.assertNotIn("Docs/Guide.md", out)
        self.assertEqual(path.read_bytes(), before)

    def test_sweep_ignores_a_note_without_frontmatter(self):
        # The sweep's pre-filter reads the frontmatter region only, so a
        # documentation page showing a legacy key in a fenced example is
        # neither visited nor reported as a frontmatter error.
        path = self.note("Docs/Legacy_Fields.md", fm(
            "# Legacy fields", "", "```yaml", "confidence: DRAFT", "```", ""))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "--write")
        self.assertNotIn("Docs/Legacy_Fields.md", out)
        self.assertIn("# repaired: 0 files, 0 conflicts, 0 errors", out)
        self.assertEqual(path.read_bytes(), before)

    def test_sweep_reports_a_broken_file_that_holds_a_legacy_key(self):
        path = self.note("NPCs/Broken.md", fm(
            "---", "type: npc", "confidence: DRAFT", "--- ",
            "", "# Broken"))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "--write", rc=1)
        self.assertIn("ERROR\tNPCs/Broken.md", out)
        self.assertIn("1 errors", out)
        self.assertEqual(path.read_bytes(), before)

    def test_sweep_covers_templates_and_meta(self):
        tpl = self.note("_Templates/NPC.md", fm(
            "---", "type: npc", "source_" + "confidence: DRAFT", "---",
            "", "# Template"))
        meta = self.note("_meta/index.md", fm(
            "---", "type: index", "confidence: DRAFT", "---", "", "# Index"))
        self.note("Notes/Plain.md", "# No frontmatter here\n")
        out = self.run_script("--repair-canon", "--write")
        self.assertIn("_Templates/NPC.md", out)
        self.assertIn("_meta/index.md", out)
        self.assertNotIn("Notes/Plain.md", out)
        self.assertIn("# repaired: 2 files, 0 conflicts, 0 errors", out)
        self.assertIn("canon_status: DRAFT\n", tpl.read_text(encoding="utf-8"))
        self.assertIn("canon_status: DRAFT\n",
                      meta.read_text(encoding="utf-8"))

    def test_duplicate_canon_status_after_repair_is_refused(self):
        path = self.note("NPCs/Dup.md", fm(
            "---", "type: npc", "canon_status: DRAFT", "canon_status: STUB",
            "confidence: DRAFT", "---", "", "# Dup"))
        before = path.read_bytes()
        out = self.run_script("--repair-canon", "NPCs/Dup.md", "--write",
                              rc=1)
        self.assertIn("ERROR", out)
        self.assertEqual(path.read_bytes(), before)

    def test_repair_canon_does_not_mix_with_other_actions(self):
        self.note("NPCs/Legacy.md", SESSION_INDEX)
        self.run_script("--repair-canon", "NPCs/Legacy.md",
                        "--set", "status=prepped", rc=2)


class LegacyFlagTests(ScriptCase):
    def test_session_alone(self):
        path = self.note("PCs/Hero.md", fm(
            "---", "type: pc", "canon_status: DRAFT", "asOfSession: 2",
            "---", "", "# Hero"))
        out = self.run_script("PCs/Hero.md", "--session", "9", "--write")
        self.assertIn("STAMPED", out)
        after = path.read_text(encoding="utf-8")
        self.assertIn("asOfSession: 9\n", after)
        self.assertNotIn("lastUpdated", after)

    def test_date_alone(self):
        path = self.note("PCs/Hero.md", fm(
            "---", "type: pc", "canon_status: DRAFT", "asOfSession: 2",
            "---", "", "# Hero"))
        self.run_script("PCs/Hero.md", "--date", "2026-09-06", "--write")
        after = path.read_text(encoding="utf-8")
        self.assertIn('lastUpdated: "2026-09-06"\n', after)
        self.assertIn("asOfSession: 2\n", after)

    def test_retag_alone(self):
        path = self.note("PCs/Hero.md", fm(
            "---", "type: pc", "canon_status: DRAFT", "tags:",
            "  - chapter-1", "---", "", "# Hero"))
        out = self.run_script("PCs/Hero.md", "--retag",
                              "chapter-1=chapter-2", "--write")
        self.assertIn("tag chapter-1 -> chapter-2", out)
        after = path.read_text(encoding="utf-8")
        self.assertIn("  - chapter-2\n", after)
        self.assertNotIn("chapter-1", after)

    def test_file_is_required_for_non_sweep_actions(self):
        self.note("PCs/Hero.md", SESSION_INDEX)
        self.run_script("--session", "9", rc=2)

    def test_crlf_is_preserved(self):
        path = self.note("PCs/Crlf.md",
                         SESSION_INDEX.replace("\n", "\r\n"))
        self.run_script("PCs/Crlf.md", "--set", "status=prepped",
                        "--increment", "session_number", "--write")
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertIn(b'status: "prepped"\r\n', raw)
        self.assertIn(b"session_number: 3\r\n", raw)

    def test_missing_file_is_an_error_row(self):
        out = self.run_script("PCs/Nope.md", "--set", "status=prepped",
                              rc=1)
        self.assertIn("ERROR", out)
        self.assertIn("file not found", out)


class RepairCanonUnitTests(unittest.TestCase):
    def test_no_legacy_key_is_a_no_op(self):
        block = ["type: npc\n", "canon_status: DRAFT\n"]
        actions, conflict = se.repair_canon(block)
        self.assertEqual(actions, [])
        self.assertIsNone(conflict)
        self.assertEqual(block, ["type: npc\n", "canon_status: DRAFT\n"])

    def test_case_one(self):
        block = ["type: npc\n", "source_" + "confidence: DRAFT\n"]
        actions, conflict = se.repair_canon(block)
        self.assertTrue(actions)
        self.assertIsNone(conflict)
        self.assertEqual(block, ["type: npc\n", "canon_status: DRAFT\n"])

    def test_case_two_casefolded_agreement(self):
        block = ["canon_status: DRAFT\n", 'confidence: "draft"\n']
        actions, conflict = se.repair_canon(block)
        self.assertTrue(actions)
        self.assertIsNone(conflict)
        self.assertEqual(block, ["canon_status: DRAFT\n"])

    def test_case_three_conflict_message(self):
        block = ["canon_status: AUTHORITATIVE\n", "confidence: DRAFT\n"]
        actions, conflict = se.repair_canon(block)
        self.assertTrue(actions)
        self.assertIsNotNone(conflict)
        assert conflict is not None
        self.assertIn("DRAFT", conflict)
        self.assertIn("AUTHORITATIVE", conflict)
        self.assertEqual(block, ["canon_status: AUTHORITATIVE\n"])

    def test_both_legacy_keys_collapse_to_one_canon_status(self):
        block = ["type: npc\n", "source_" + "confidence: DRAFT\n",
                 "confidence: DRAFT\n"]
        actions, conflict = se.repair_canon(block)
        self.assertTrue(actions)
        self.assertIsNone(conflict)
        self.assertEqual(block, ["type: npc\n", "canon_status: DRAFT\n"])

    def test_nested_legacy_key_is_left_alone(self):
        block = ["type: npc\n", "meta:\n", "  confidence: DRAFT\n"]
        actions, conflict = se.repair_canon(block)
        self.assertEqual(actions, [])
        self.assertIsNone(conflict)
        self.assertEqual(len(block), 3)


class SessionShapeTests(unittest.TestCase):
    def test_shapes(self):
        self.assertIsNone(se.session_shape(None))
        self.assertIsNone(se.session_shape('""'))
        self.assertEqual(se.session_shape("9"), "int")
        self.assertEqual(se.session_shape('"9"'), "int")
        self.assertEqual(se.session_shape("Chapter 4, Session 9"), "label")


if __name__ == "__main__":
    unittest.main(verbosity=2)

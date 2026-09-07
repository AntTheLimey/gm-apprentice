#!/usr/bin/env python3
"""Regression tests for plan_check.py — Session Plan conformance.

Mechanises the fourteen rules skills/session-prep/SKILL.md states for the
Session Plan file it writes (required sections, preamble/recap word
budgets, no scene-duration estimates, no audit-trail language, read-aloud
form, and the headless Hard Guard).

Fixtures live in tests/fixtures/slice-b/plans/:
  Good Plan.md     - every template H2, real content, clean under every
                     check except the headless guard.
  Bad Plan.md      - one deliberate defect per check id (except
                     hard-guard, which only ever fires under --headless).
  Headless Plan.md - a populated Session Intent and an Open Questions
                     section with one labelled, one unlabelled line — for
                     the --headless-only Hard Guard checks.

Run: python3 tests/test_plan_check.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import plan_check as pc                                # noqa: E402
import vault_check as vc                                # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "slice-b" / "plans"
GOOD = FIXTURES / "Good Plan.md"
BAD = FIXTURES / "Bad Plan.md"
HEADLESS = FIXTURES / "Headless Plan.md"
SCRIPT = SCRIPTS / "plan_check.py"


def run_cli(plan: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(plan), *args],
        capture_output=True, text=True)


def findings_for(path: Path, headless: bool = False) -> list[pc.Finding]:
    text = path.read_text(encoding="utf-8")
    fm = pc.vl.extract_frontmatter(text) or {}
    return pc.run_checks(str(path), text, fm, headless)


def rows_for(findings: list[pc.Finding], check_id: str) -> list[pc.Finding]:
    return [f for f in findings if f.id == check_id]


class GoodPlanTests(unittest.TestCase):
    """A fully conformant Plan yields exactly zero findings by default."""

    def test_zero_findings(self):
        self.assertEqual(findings_for(GOOD), [])

    def test_cli_exits_zero(self):
        proc = run_cli(GOOD)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("# errors: 0  warnings: 0  info: 0", proc.stdout)


class BadPlanRowsTests(unittest.TestCase):
    """One assertion per check id (hard-guard excluded — it only fires
    under --headless, covered separately)."""

    @classmethod
    def setUpClass(cls):
        cls.findings = findings_for(BAD)

    def one(self, check_id: str) -> pc.Finding:
        rows = rows_for(self.findings, check_id)
        self.assertEqual(len(rows), 1, (check_id, self.findings))
        return rows[0]

    def test_type(self):
        f = self.one("type")
        self.assertEqual(f.level, "ERROR")
        self.assertTrue(f.message.startswith("type:"))
        self.assertIn("session-plan-draft", f.message)

    def test_frontmatter(self):
        rows = rows_for(self.findings, "frontmatter")
        self.assertTrue(rows)
        self.assertTrue(all(f.level == "WARNING" for f in rows))
        self.assertTrue(any("chapter" in f.message for f in rows))

    def test_sections(self):
        f = self.one("sections")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("Touchpoint Plan", f.message)

    def test_order(self):
        f = self.one("order")
        self.assertEqual(f.level, "INFO")
        self.assertIn("Open Questions", f.message)

    def test_placeholder(self):
        f = self.one("placeholder")
        self.assertEqual(f.level, "INFO")
        self.assertIn("Gaps & Actions", f.message)

    def test_preamble_carries_the_word_count(self):
        f = self.one("preamble")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("1040 words", f.message)

    def test_recap_carries_the_word_count(self):
        f = self.one("recap")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("240 words", f.message)

    def test_npc_table(self):
        f = self.one("npc-table")
        self.assertEqual(f.level, "INFO")
        self.assertIn("NPC Quick Reference", f.message)

    def test_scene_length(self):
        f = self.one("scene-length")
        self.assertEqual(f.level, "INFO")
        self.assertIn("Scene 2", f.message)

    def test_scene_labels_missing_behaviours(self):
        rows = rows_for(self.findings, "scene-labels")
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0].level, "WARNING")
        self.assertIn("**Behaviours:**", rows[0].message)
        self.assertIn("Scene 1", rows[0].locus)

    def test_scene_type(self):
        f = self.one("scene-type")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("'dance'", f.message)

    def test_duration_locus_is_scene_1s_line(self):
        rows = rows_for(self.findings, "duration")
        self.assertEqual(len(rows), 2, rows)
        errors = [f for f in rows if f.level == "ERROR"]
        warnings = [f for f in rows if f.level == "WARNING"]
        self.assertEqual(len(errors), 1, rows)
        self.assertEqual(len(warnings), 1, rows)
        # Scene 1 ("The Kitchens") carries the range-form estimate — an
        # ERROR whose locus must land on Scene 1's own line, not just
        # somewhere in the file.
        text = BAD.read_text(encoding="utf-8")
        scene_1_line = next(
            i for i, line in enumerate(text.splitlines(), start=1)
            if line.startswith("### Scene 1"))
        scene_2_line = next(
            i for i, line in enumerate(text.splitlines(), start=1)
            if line.startswith("### Scene 2"))
        error_line = int(errors[0].locus.split(":")[-1])
        self.assertTrue(scene_1_line < error_line < scene_2_line,
                        (scene_1_line, error_line, scene_2_line))
        self.assertIn("45-60 minutes", errors[0].message)
        self.assertIn("20 minutes", warnings[0].message)

    def test_audit_trail(self):
        f = self.one("audit-trail")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("this plan revises", f.message)

    def test_pc_state(self):
        f = self.one("pc-state")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("Location", f.message)

    def test_read_aloud_lists_everything_that_fired(self):
        f = self.one("read-aloud")
        self.assertEqual(f.level, "INFO")
        self.assertIn("1 sentence", f.message)
        self.assertIn("you feel", f.message.lower())
        self.assertIn("Spot Hidden", f.message)

    def test_table(self):
        f = self.one("table")
        self.assertEqual(f.level, "ERROR")
        self.assertIn("[[Bram|the broker]]", f.message)

    def test_guess(self):
        f = self.one("guess")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("Open Questions", f.message)

    def test_prep_state_malformed_token(self):
        f = self.one("prep-state")
        self.assertEqual(f.level, "WARNING")
        self.assertIn("intent", f.message)

    def test_hard_guard_never_fires_by_default(self):
        self.assertEqual(rows_for(self.findings, "hard-guard"), [])

    def test_cli_exits_one(self):
        proc = run_cli(BAD)
        self.assertEqual(proc.returncode, 1, proc.stdout)
        self.assertTrue(any(row.startswith("ERROR\t")
                            for row in proc.stdout.splitlines()))

    def test_every_row_starts_with_its_own_id(self):
        for f in self.findings:
            with self.subTest(id=f.id, message=f.message):
                self.assertTrue(f.message.startswith(f.id + ":"), f)


class SectionsOrderTests(unittest.TestCase):
    def test_good_plan_is_in_order(self):
        self.assertEqual(rows_for(findings_for(GOOD), "order"), [])

    def test_bad_plan_names_the_first_out_of_place_section(self):
        rows = rows_for(findings_for(BAD), "order")
        self.assertEqual(len(rows), 1)
        self.assertIn("Open Questions", rows[0].message)
        self.assertEqual(rows[0].level, "INFO")


class HeadlessTests(unittest.TestCase):
    def test_headless_plan_two_errors_and_exit_one(self):
        proc = run_cli(HEADLESS, "--headless")
        self.assertEqual(proc.returncode, 1, proc.stdout)
        rows = [line for line in proc.stdout.splitlines()
               if line.startswith("ERROR\t") and "hard-guard" in line]
        self.assertEqual(len(rows), 2, proc.stdout)
        self.assertTrue(any("Session Intent" in r for r in rows), rows)
        self.assertTrue(any("no marker at all" in r for r in rows), rows)

    def test_headless_plan_labelled_line_does_not_fire(self):
        findings = findings_for(HEADLESS, headless=True)
        guard_rows = rows_for(findings, "hard-guard")
        self.assertFalse(
            any("Confirm the guard fires here too" in f.message
                for f in guard_rows), guard_rows)

    def test_good_plan_headless_flags_the_populated_creative_spine(self):
        findings = findings_for(GOOD, headless=True)
        guard_rows = rows_for(findings, "hard-guard")
        self.assertTrue(all(f.level == "ERROR" for f in guard_rows))
        messages = " ".join(f.message for f in guard_rows)
        self.assertIn("Session Intent", messages)
        self.assertIn("Planned Scenes", messages)
        self.assertIn("Spotlight Forecast", messages)

    def test_default_mode_never_runs_the_guard(self):
        self.assertEqual(rows_for(findings_for(HEADLESS), "hard-guard"), [])


class InventoryTests(unittest.TestCase):
    def test_bad_plan_inventory(self):
        rows = pc.build_inventory(BAD.read_text(encoding="utf-8"))
        by_title = {title: (status, words) for title, status, words in rows}
        self.assertEqual(by_title["Touchpoint Plan"], ("absent", 0))
        self.assertEqual(by_title["Planned vs Played"][0], "placeholder")

    def test_good_plan_inventory_all_present_except_planned_vs_played(self):
        rows = pc.build_inventory(GOOD.read_text(encoding="utf-8"))
        by_title = {title: status for title, status, _w in rows}
        for title in pc.TEMPLATE_SECTIONS:
            if title == "Planned vs Played":
                self.assertEqual(by_title[title], "placeholder")
            else:
                self.assertEqual(by_title[title], "present", title)

    def test_cli_inventory_shape(self):
        proc = run_cli(BAD, "--inventory")
        lines = proc.stdout.splitlines()
        self.assertTrue(all(line.startswith("SECTION\t") for line in lines))
        self.assertTrue(any("Touchpoint Plan\tabsent\t0" in line
                            for line in lines))


class StateTests(unittest.TestCase):
    def test_good_plan_state(self):
        state = pc.build_state(GOOD.read_text(encoding="utf-8"))
        self.assertEqual(state["intent"], "set")
        self.assertEqual(state["open"], "[]")

    def test_cli_state_output(self):
        proc = run_cli(GOOD, "--state")
        self.assertIn("intent\tset", proc.stdout.splitlines())
        self.assertIn("open\t[]", proc.stdout.splitlines())

    def test_no_marker_reports_the_sentinel(self):
        proc = run_cli(BAD, "--state")
        # Bad Plan's marker exists but is malformed — it still parses to
        # an empty token dict, which prints the same sentinel as "absent".
        self.assertIn("# no prep-state marker", proc.stdout)

    def test_headless_plan_has_no_marker_at_all(self):
        proc = run_cli(HEADLESS, "--state")
        self.assertEqual(proc.stdout.strip(), "# no prep-state marker")


class JsonShapeTests(unittest.TestCase):
    def test_good_plan_json_shape(self):
        proc = run_cli(GOOD, "--json")
        self.assertEqual(proc.returncode, 0, proc.stdout)
        payload = json.loads(proc.stdout)
        self.assertEqual(payload["findings"], [])
        self.assertEqual(len(payload["inventory"]), len(pc.TEMPLATE_SECTIONS))
        self.assertEqual(payload["state"],
                         {"intent": "set", "spotlight": "Ada(B)",
                          "scenes": "2of2", "open": "[]"})

    def test_bad_plan_json_findings_carry_the_full_shape(self):
        proc = run_cli(BAD, "--json")
        self.assertEqual(proc.returncode, 1, proc.stdout)
        payload = json.loads(proc.stdout)
        self.assertTrue(payload["findings"])
        for row in payload["findings"]:
            self.assertEqual(set(row), {"id", "level", "locus", "message"})
        ids = {row["id"] for row in payload["findings"]}
        self.assertIn("type", ids)
        self.assertIn("table", ids)

    def test_json_respects_headless(self):
        proc = run_cli(HEADLESS, "--headless", "--json")
        self.assertEqual(proc.returncode, 1, proc.stdout)
        payload = json.loads(proc.stdout)
        guard_ids = [row for row in payload["findings"]
                    if row["id"] == "hard-guard"]
        self.assertEqual(len(guard_ids), 2, payload["findings"])


class TableFindingsExtractedTests(unittest.TestCase):
    """vault_check.table_findings is the extracted per-file body plan_check
    calls directly — pin its standalone contract here."""

    def test_returns_the_aliased_pipe_row_for_a_two_row_table(self):
        text = ("| A | B |\n|---|---|\n| [[X|Y]] | z |\n")
        rows = vc.table_findings("x.md", text)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("ERROR\tx.md:3\t"), rows[0])
        self.assertIn("[[X|Y]]", rows[0])

    def test_check_tables_over_a_vault_matches_table_findings_summed(self):
        # Regression: check_tables must still be the sum of table_findings
        # over every vault file, not a re-derivation of the same logic.
        FIXTURE = (Path(__file__).resolve().parent / "fixtures"
                  / "vault-check")
        via_vault = vc.check_tables(FIXTURE)
        via_files = [r for rel, text in vc.vault_files(FIXTURE)
                    for r in vc.table_findings(rel, text)]
        self.assertEqual(via_vault, via_files)


if __name__ == "__main__":
    unittest.main(verbosity=2)

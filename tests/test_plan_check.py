#!/usr/bin/env python3
"""Regression tests for plan_check.py — Session Plan conformance.

Mechanises the rules skills/session-prep/SKILL.md and
shared/session-principles.md state for the Session Plan file it writes
(required sections, preamble/recap word budgets, no scene-duration
estimates, no audit-trail language, read-aloud form, and the headless
Hard Guard).

Fixtures live in tests/fixtures/slice-b/plans/:
  Good Plan.md     - every template H2, real content, clean under every
                     check except the headless guard.
  Bad Plan.md      - one deliberate defect per check id (except
                     hard-guard, which only ever fires under --headless).
  Headless Plan.md - a populated Session Intent and an Open Questions
                     section with one labelled bullet and one unlabelled,
                     hard-wrapped bullet — for the --headless-only Hard
                     Guard checks.

Run: python3 tests/test_plan_check.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
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
    under --headless, covered separately; scene-labels excluded from the
    `self.one` shape — the enumerated skeleton (#196) makes several
    scene-labels rows fire at once, covered by its own method below and
    by NewSkeletonTests)."""

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
        self.assertIn("1100 words", f.message)

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

    def test_scene_labels_legacy_scene_is_flagged(self):
        rows = rows_for(self.findings, "scene-labels")
        legacy = [f for f in rows if "pre-1.9.12" in f.message]
        self.assertEqual(len(legacy), 1, rows)
        self.assertEqual(legacy[0].level, "ERROR")
        self.assertIn("Objective", legacy[0].message)
        self.assertIn("Scene 2", legacy[0].locus)

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


class NewSkeletonTests(unittest.TestCase):
    def _rows(self, plan: Path, check_id: str) -> list[str]:
        r = run_cli(plan)
        return [ln for ln in r.stdout.splitlines() if f"\t{check_id}:" in ln or f"{check_id}:" in ln.split("\t", 2)[-1]]

    def test_good_plan_clean_on_new_checks(self):
        r = run_cli(GOOD)
        for cid in ("scene-labels", "sections"):
            self.assertFalse([ln for ln in r.stdout.splitlines() if f"{cid}:" in ln], cid)

    def test_near_miss_is_an_error(self):
        # Missing-required-label rows are unit-tested directly in
        # MinimumSceneTests; the fixture's scene carries both required
        # labels, one of them mistyped.
        rows = self._rows(BAD, "scene-labels")
        self.assertTrue(any("has '**Situation.**' — write '**Situation:**'" in ln for ln in rows))
        self.assertTrue(all(ln.startswith("ERROR\t") for ln in rows))

    def test_optional_labels_are_not_reported_missing(self):
        # One minimum for all types: an absent optional label is a
        # finished scene, not an incomplete one.
        rows = self._rows(BAD, "scene-labels")
        for label in ("**Points to land**", "**NPCs**", "**Complications**",
                      "**Entities:**", "**If the players...**"):
            self.assertFalse(
                [ln for ln in rows if f"is missing {label}" in ln], label)

    def test_legacy_scene_is_one_row(self):
        rows = [ln for ln in self._rows(BAD, "scene-labels") if "pre-1.9.12" in ln]
        self.assertEqual(len(rows), 1)
        self.assertIn("Objective", rows[0])

    def test_contingency_then_is_not_required(self):
        rows = self._rows(BAD, "scene-labels")
        self.assertFalse([ln for ln in rows if "is missing **Then**" in ln])

    def test_missing_gm_notes_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "P.md"
            p.write_text(GOOD.read_text().replace("## GM Notes", "## Keeper Notes", 1))
            r = run_cli(p)
            self.assertEqual(r.returncode, 1)
            self.assertIn("ERROR\t", r.stdout)
            self.assertIn("sections: missing '## GM Notes'", r.stdout)



class LabelHelperUnitTests(unittest.TestCase):
    """#196 fix round 1: direct coverage of `_label_present` /
    `_label_near_miss` / `_legacy_scene`, independent of any fixture."""

    def test_block_label_accepts_bare_form(self):
        self.assertTrue(pc._label_present("**NPCs**\n- x", "NPCs"))

    def test_block_label_accepts_parenthetical(self):
        body = "**Complications (drop when the scene sags)**\n- x"
        self.assertTrue(pc._label_present(body, "Complications"))

    def test_block_label_rejects_colon_suffixed_form(self):
        # Ruling 2: the block regex must not swallow `**NPCs:**` — that
        # near-miss form has to fall through to `_label_near_miss`.
        self.assertFalse(pc._label_present("**NPCs:**\n- x", "NPCs"))

    def test_block_label_near_miss_reports_colon_suffixed_form(self):
        near = pc._label_near_miss("**NPCs:**\n- x", "NPCs")
        self.assertEqual(near, "**NPCs:**")

    def test_inline_label_near_miss_semicolon(self):
        near = pc._label_near_miss("**Setup;** foo", "Setup")
        self.assertEqual(near, "**Setup;**")

    def test_inline_label_near_miss_unbolded(self):
        near = pc._label_near_miss("Situation: foo", "Situation")
        self.assertEqual(near, "Situation:")

    def test_if_the_players_accepts_unicode_ellipsis(self):
        body = "**If the players…**\n| Do | Then |\n|---|---|"
        self.assertTrue(pc._label_present(body, "If the players..."))

    def test_if_the_players_still_accepts_ascii_dots(self):
        body = "**If the players...**\n| Do | Then |\n|---|---|"
        self.assertTrue(pc._label_present(body, "If the players..."))

    def test_if_the_players_rejects_a_short_ellipsis(self):
        # One or two dots is a typo, not the label: it must reach the
        # near-miss ERROR rather than count as the label being present.
        for body in ("**If the players.**\n| Do | Then |\n|---|---|",
                     "**If the players..**\n| Do | Then |\n|---|---|"):
            with self.subTest(body=body):
                self.assertFalse(
                    pc._label_present(body, "If the players..."))
                findings = pc._scene_findings("P.md", body, "Scene 1",
                                              ("If the players...",))
                rows = [f for f in findings if f.id == "scene-labels"]
                self.assertEqual(len(rows), 1, rows)
                self.assertIn("write '**If the players...**'",
                              rows[0].message)

    def test_legacy_scene_detected_even_with_entities_present(self):
        # Task 4 defect 2: `Entities` is common furniture to both
        # skeletons, so its presence must not defeat legacy detection.
        body = ("**Objective:** foo\n**Entities:** [[X]]\n"
                "**Setup:** bar\n**Behaviours:** baz\n"
                "**Branching:** qux")
        found = pc._legacy_scene(body, pc.SCENE_LABELS)
        self.assertEqual(found, ["Objective", "Setup", "Behaviours",
                                 "Branching"])

    def test_contingency_scene_with_stray_legacy_label_is_not_legacy(self):
        # A well-formed Contingency scene carrying a stray `**Setup:**`
        # is not legacy — the gate is the scene's own expected labels,
        # and Trigger/Then are both present, so the Setup line is
        # simply ignored.
        body = "**Trigger:** x\n**Then**\n- a\n**Setup:** b\n"
        self.assertEqual(pc._legacy_scene(body, pc.CONTINGENCY_LABELS), [])
        findings = pc._scene_findings("P.md", body, "If X",
                                      pc.CONTINGENCY_LABELS)
        self.assertEqual(findings, [], findings)

    def test_legacy_planned_scene_yields_no_per_label_rows(self):
        # B6: the legacy row replaces the per-label roll call, it does
        # not accompany it.
        body = ("**Objective:** foo\n**Setup:** bar\n"
                "**Behaviours:** baz\n**Branching:** qux")
        findings = pc._scene_findings("P.md", body, "Scene 2",
                                      pc.SCENE_LABELS)
        rows = [f for f in findings if f.id == "scene-labels"]
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("pre-1.9.12", rows[0].message)
        self.assertFalse([f for f in rows if "is missing" in f.message], rows)

    def test_legacy_message_uses_the_passed_labels(self):
        # Ruling 8: a Contingency scene's legacy message names
        # Trigger/Then, not the Planned-scene label list.
        findings = pc._scene_findings(
            "P.md", "**Objective:** foo\n**Setup:** bar",
            "If confronted", pc.CONTINGENCY_LABELS)
        legacy = [f for f in findings if "pre-1.9.12" in f.message]
        self.assertEqual(len(legacy), 1)
        self.assertIn("rewrite as Trigger", legacy[0].message)
        self.assertNotIn("Situation", legacy[0].message)

    def test_if_the_players_colon_form_is_a_near_miss(self):
        body = "**If the players:**\n| Do | Then |\n|---|---|"
        self.assertFalse(pc._label_present(body, "If the players..."))
        self.assertEqual(pc._label_near_miss(body, "If the players..."),
                         "**If the players:**")
        findings = pc._scene_findings("P.md", body, "Scene 1",
                                      ("If the players...",))
        rows = [f for f in findings if f.id == "scene-labels"]
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("has '**If the players:**' — write "
                      "'**If the players...**'", rows[0].message)


class SectionsOrderTests(unittest.TestCase):
    def test_good_plan_is_in_order(self):
        self.assertEqual(rows_for(findings_for(GOOD), "order"), [])

    def test_bad_plan_names_the_first_out_of_place_section(self):
        rows = rows_for(findings_for(BAD), "order")
        self.assertEqual(len(rows), 1)
        self.assertIn("Open Questions", rows[0].message)
        self.assertEqual(rows[0].level, "INFO")


class HeadlessTests(unittest.TestCase):
    """Regression coverage for the wrapped-bullet grouping fix: a
    hard-wrapped Open Questions bullet is one logical item, so it earns
    exactly one hard-guard row, not one per physical line."""

    def test_headless_plan_two_errors_and_exit_one(self):
        proc = run_cli(HEADLESS, "--headless")
        self.assertEqual(proc.returncode, 1, proc.stdout)
        rows = [line for line in proc.stdout.splitlines()
               if line.startswith("ERROR\t") and "hard-guard" in line]
        self.assertEqual(len(rows), 2, proc.stdout)
        self.assertTrue(any("Session Intent" in r for r in rows), rows)
        self.assertTrue(any("no marker at all" in r for r in rows), rows)

    def test_headless_plan_wrapped_unlabelled_bullet_is_one_row(self):
        # The unlabelled bullet hard-wraps across two physical lines in
        # the fixture. Before the item-grouping fix this produced one
        # ERROR per physical line.
        findings = findings_for(HEADLESS, headless=True)
        guard_rows = rows_for(findings, "hard-guard")
        open_questions_rows = [f for f in guard_rows
                               if "no marker at all" in f.message]
        self.assertEqual(len(open_questions_rows), 1, guard_rows)
        self.assertEqual(open_questions_rows[0].locus.split(":")[-1], "18")

    def test_headless_plan_labelled_line_does_not_fire(self):
        findings = findings_for(HEADLESS, headless=True)
        guard_rows = rows_for(findings, "hard-guard")
        self.assertFalse(
            any("Confirm the guard fires here too" in f.message
                for f in guard_rows), guard_rows)

    def test_gm_input_skips_the_guard_and_says_so(self):
        # #207: a scripted prep hands the agent the intent, scenes and
        # spotlight, so a settled spine is the GM's, not an invention.
        proc = run_cli(GOOD, "--headless", "--gm-input")
        rows = [line for line in proc.stdout.splitlines()
                if "hard-guard" in line]
        self.assertEqual(len(rows), 1, proc.stdout)
        self.assertTrue(rows[0].startswith("INFO\t"), rows)
        self.assertIn("--gm-input", rows[0])
        self.assertEqual(proc.returncode, 0, proc.stdout)

    def test_gm_input_does_not_touch_the_other_checks(self):
        findings = pc.run_checks(
            str(HEADLESS), HEADLESS.read_text(encoding="utf-8"),
            pc.vl.extract_frontmatter(HEADLESS.read_text(encoding="utf-8"))
            or {}, True, True)
        bad = [f for f in findings if f.level == "ERROR"]
        self.assertFalse([f for f in bad if f.id == "hard-guard"], bad)

    def test_good_plan_headless_flags_exactly_the_creative_spine(self):
        # Good Plan's own Open Questions bullet is hard-wrapped across
        # three physical lines and carries the apprentice-guess marker,
        # so it must contribute zero hard-guard rows: before the
        # item-grouping fix, three physical lines with no marker each
        # produced a duplicate ERROR (6 total instead of 3).
        findings = findings_for(GOOD, headless=True)
        guard_rows = rows_for(findings, "hard-guard")
        self.assertEqual(len(guard_rows), 3, guard_rows)
        self.assertTrue(all(f.level == "ERROR" for f in guard_rows))
        messages = " ".join(f.message for f in guard_rows)
        self.assertIn("Session Intent", messages)
        self.assertIn("Planned Scenes", messages)
        self.assertIn("Spotlight Forecast", messages)
        self.assertFalse(any("Open Questions" in f.message
                             for f in guard_rows), guard_rows)

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

    def test_inventory_and_state_together_is_a_usage_error(self):
        # main() only ever checks one mode and returns after it, so
        # --state silently never printed when both flags were accepted —
        # reject the combination instead of picking one silently.
        proc = run_cli(GOOD, "--inventory", "--state")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("not allowed with argument", proc.stderr)


# skills/session-prep/SKILL.md, Resumable prep — the exact worked example.
SKILL_MD_EXAMPLE_MARKER = (
    "<!-- prep-state: intent=set spotlight=Emma(B) scenes=1of3 "
    "open=[Freddy beat?] -->"
)


class PrepStateTokenizerTests(unittest.TestCase):
    """The tokenizer must accept SKILL.md's own worked example — a
    bracketed value (`open=[Freddy beat?]`) carries an internal space
    that a plain whitespace split misreads as two malformed tokens."""

    @staticmethod
    def _text() -> str:
        return ("---\ntype: session-plan\nsession: \"[[S]]\"\n"
                "chapter: \"[[C]]\"\n---\n\n" + SKILL_MD_EXAMPLE_MARKER
                + "\n\n## Session Intent\n\nSomething.\n")

    def test_no_prep_state_finding(self):
        self.assertEqual(pc.check_prep_state("x.md", self._text()), [])

    def test_bracketed_value_keeps_its_internal_space(self):
        state = pc.build_state(self._text())
        self.assertEqual(
            state, {"intent": "set", "spotlight": "Emma(B)",
                    "scenes": "1of3", "open": "[Freddy beat?]"})

    def test_cli_state_output(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "Example Plan.md"
            path.write_text(self._text(), encoding="utf-8")
            proc = run_cli(path, "--state")
        self.assertIn("open\t[Freddy beat?]", proc.stdout.splitlines())


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


class SessionRunningTitleNormTests(unittest.TestCase):
    """M11: `_is_session_running` must use `_norm_title` (ellipsis-
    tolerant), not a bare `.strip().casefold()` — otherwise an
    "Open Questions…" heading (spelled with the ellipsis the rest of
    the file tolerates) is wrongly treated as session-running and picks
    up `duration`/`audit-trail` findings meant only for narrative text."""

    def test_ellipsis_title_is_still_excluded(self):
        self.assertFalse(pc._is_session_running("Open Questions…"))
        self.assertFalse(pc._is_session_running("Open Questions..."))
        self.assertFalse(pc._is_session_running("Open Questions"))
        self.assertTrue(pc._is_session_running("Session Intent"))

    def test_duration_not_flagged_under_ellipsis_titled_exclusion(self):
        text = ("# Plan\n\n"
               "## Open Questions…\n\n"
               "Runtime is 20-30 minutes either way.\n")
        states, _problems = pc.vl.scan_body(text)
        self.assertEqual(pc.check_duration("plan.md", states), [])


class PcStateSceneScopingTests(unittest.TestCase):
    """M14: `pc-state` must not fire inside `## Planned Scenes` /
    `## Contingency Scenes` — a scene's own `**Location:**` field names
    where the scene happens, not a Current Status transcription, and
    session-prep/SKILL.md lists pc-state among the warnings fixed
    silently, so a false positive there would edit real content away
    without asking."""

    def test_exempt_inside_planned_and_contingency_scenes(self):
        text = (
            "# Plan\n\n"
            "## Session Intent\n\n"
            "**Location:** Vienna docks\n\n"
            "## Planned Scenes\n\n"
            "### Scene 1: Arrival\n"
            "**Location:** Vienna docks\n\n"
            "## Contingency Scenes\n\n"
            "### If stalled\n"
            "**Location:** The alley\n\n"
            "## Gaps & Actions\n\n"
            "**Location:** somewhere\n")
        states, _problems = pc.vl.scan_body(text)
        findings = pc.check_pc_state("plan.md", states)
        loci = {f.locus for f in findings}
        # Line 5 (Session Intent) and 19 (Gaps & Actions) still fire;
        # line 10 (Planned Scenes) and 15 (Contingency Scenes) don't.
        self.assertEqual(loci, {"plan.md:5", "plan.md:19"})



def scene_rows(scene_body: str, title: str = "Scene 1: T") -> list[pc.Finding]:
    """`scene-labels` rows for one Planned scene body."""
    return [f for f in pc._scene_findings("P.md", scene_body, title,
                                          pc.SCENE_LABELS) if f.id == "scene-labels"]


class MinimumSceneTests(unittest.TestCase):
    """One minimum for all types (2026-09-14, docs/scene-design-research.md):
    only `**Situation:**` and `**Starts it:**` are required. Every other
    label is available and may simply be absent — no "N/A" placeholder, no
    missing-label row. A label that IS attempted but mistyped is still an
    error, because that is a typo, not an omission."""

    MINIMUM = ("**Situation:** The tide is coming in over the causeway.\n"
               "**Starts it:** Mrs Orme waves them down from the seawall.\n")

    def test_situation_and_starts_it_alone_is_clean(self):
        self.assertEqual(scene_rows(self.MINIMUM), [])

    def test_routing_scene_needs_nothing_else(self):
        # The shape that produced 7 of 9 errors on the GM's own plan.
        body = ("**Type:** transition\n"
                "**Situation:** Midday breaks up the crowd on the Maidan.\n"
                "**Starts it:** The household's own clock; Hugh expects "
                "everyone dressed before the first carriage.\n")
        self.assertEqual(scene_rows(body), [])

    def test_missing_situation_is_an_error(self):
        body = "**Starts it:** Mrs Orme waves them down.\n"
        rows = scene_rows(body)
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0].level, "ERROR")
        self.assertIn("**Situation:**", rows[0].message)

    def test_missing_starts_it_is_an_error(self):
        body = "**Situation:** The tide is coming in.\n"
        rows = scene_rows(body)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("**Starts it:**", rows[0].message)

    def test_optional_labels_are_never_reported_missing(self):
        rows = scene_rows(self.MINIMUM)
        for label in ("Entities", "NPCs", "Points to land",
                      "If the players...", "Complications"):
            self.assertFalse([r for r in rows if label in r.message], label)

    def test_a_mistyped_optional_label_is_still_an_error(self):
        # Attempted, not omitted: the author meant `**Complications**`.
        body = self.MINIMUM + "**Complications.**\n- A curveball.\n"
        rows = scene_rows(body)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("**Complications**", rows[0].message)

    def test_a_mistyped_required_label_is_still_an_error(self):
        body = ("**Situation.** The tide is coming in.\n"
                "**Starts it:** Mrs Orme waves them down.\n")
        rows = scene_rows(body)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("**Situation:**", rows[0].message)


class MinimumContingencyTests(unittest.TestCase):
    """Contingency scenes require `**Trigger:**` only; `**Then**` is
    available but not demanded."""

    def rows(self, body: str) -> list[pc.Finding]:
        return [f for f in pc._scene_findings(
            "P.md", body, "If it goes wrong", pc.CONTINGENCY_LABELS)
            if f.id == "scene-labels"]

    def test_trigger_alone_is_clean(self):
        self.assertEqual(self.rows("**Trigger:** The note goes unread.\n"), [])

    def test_missing_trigger_is_an_error(self):
        rows = self.rows("**Then**\n- Sophia waits alone and rides home.\n")
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("**Trigger:**", rows[0].message)


if __name__ == "__main__":
    unittest.main(verbosity=2)

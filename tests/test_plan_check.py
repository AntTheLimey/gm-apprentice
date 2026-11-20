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
import shutil
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

    def test_an_old_type_line_raises_nothing(self):
        # The Plan has no **Type:** line (#759); an old Plan's, even a word
        # off the old list ("dance"), is no finding.
        self.assertEqual(rows_for(self.findings, "scene-type"), [])
        self.assertFalse(any("dance" in f.message for f in self.findings))

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
                      "**Entities:**", "**Handouts:**",
                      "**If the players...**"):
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

    def test_block_label_accepts_colon_suffixed_form(self):
        # The run sheet reads `**NPCs:**` as it reads `**NPCs**`.
        self.assertTrue(pc._label_present("**NPCs:**\n- x", "NPCs"))
        self.assertIsNone(pc._label_near_miss("**NPCs:**\n- x", "NPCs"))

    def test_block_label_near_miss_still_reports_a_period(self):
        self.assertFalse(pc._label_present("**NPCs.**\n- x", "NPCs"))
        self.assertEqual(pc._label_near_miss("**NPCs.**\n- x", "NPCs"),
                         "**NPCs.**")

    def test_inline_label_without_a_colon_is_still_a_near_miss(self):
        self.assertFalse(pc._label_present("**Place** the yard", "Place"))
        self.assertEqual(
            pc._label_near_miss("**Place** the yard", "Place"), "**Place**")

    def test_if_label_with_dots_ellipsis_or_none(self):
        for head in ("**If the players...**", "**If the players…**",
                     "**If the players**", "**If the players:**"):
            with self.subTest(head=head):
                self.assertTrue(pc._label_present(head + "\n| Do |", "If the players..."))

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

    def test_if_the_players_colon_form_is_read(self):
        body = "**If the players:**\n| Do | Then |\n|---|---|"
        self.assertTrue(pc._label_present(body, "If the players..."))
        findings = pc._scene_findings("P.md", body, "Scene 1",
                                      ("If the players...",))
        self.assertEqual([f for f in findings if f.id == "scene-labels"], [])

    def test_if_the_players_short_ellipsis_is_a_near_miss(self):
        body = "**If the players..**\n| Do | Then |\n|---|---|"
        self.assertFalse(pc._label_present(body, "If the players..."))
        self.assertEqual(pc._label_near_miss(body, "If the players..."),
                         "**If the players..**")


class SectionsOrderTests(unittest.TestCase):
    def test_good_plan_is_in_order(self):
        self.assertEqual(rows_for(findings_for(GOOD), "order"), [])

    def test_bad_plan_names_the_first_out_of_place_section(self):
        rows = rows_for(findings_for(BAD), "order")
        self.assertEqual(len(rows), 1)
        self.assertIn("Open Questions", rows[0].message)
        self.assertEqual(rows[0].level, "INFO")


class ShippedTemplateTests(unittest.TestCase):
    """#204: the Session Plan template a GM can open must be the shape
    plan_check enforces, and must not drift from the reference."""

    ROOT = Path(__file__).resolve().parent.parent / "skills"
    TEMPLATE = ROOT / "shared" / "templates" / "session-plan.md"
    REFERENCE = ROOT / "session-prep" / "SKILL.md"

    @classmethod
    def shape(cls) -> str:
        """SKILL.md's Plan shape section, the reference prep writes from."""
        return cls.REFERENCE.read_text(encoding="utf-8").split(
            "\n## Plan shape\n", 1)[1]

    @staticmethod
    def h2s(text: str) -> list[str]:
        return [t for _l, lvl, t, _b in pc.vl.sections(text) if lvl == 2]

    def test_template_sections_match_plan_check_in_order(self):
        text = self.TEMPLATE.read_text(encoding="utf-8")
        self.assertEqual(self.h2s(text), list(pc.TEMPLATE_SECTIONS))

    def test_template_sections_match_the_reference(self):
        # The skill lists each section as a `## Title` bullet, in order;
        # the ones prep leaves out are the only ones it may skip.
        listed = pc.re.findall(r"^- `## ([^`]+)`", self.shape(), pc.re.M)
        self.assertEqual(
            self.h2s(self.TEMPLATE.read_text(encoding="utf-8")), listed)

    def test_template_passes_plan_check_with_no_errors(self):
        text = self.TEMPLATE.read_text(encoding="utf-8")
        found = pc.run_checks(str(self.TEMPLATE), text,
                              pc.vl.extract_frontmatter(text) or {}, False)
        errors = [f.row for f in found if f.level == "ERROR"]
        self.assertEqual(errors, [])

    def test_template_scene_shape_matches_the_reference(self):
        # The scene skeleton is the part most likely to drift: compare
        # the inline and block labels each file carries.
        # Labels at the start of a line only: in the skill, its fenced
        # skeletons; in the template, outside its guidance comment.
        label = pc.re.compile(r"^\*\*([^*:\n]+?)(?::)?\*\*", pc.re.M)
        ref = "\n".join(pc.re.findall(r"```markdown\n(.*?)```", self.shape(),
                                      pc.re.S))
        tpl = pc.re.sub(r"<!--.*?-->", "", self.TEMPLATE.read_text(
            encoding="utf-8"), flags=pc.re.S)
        keep = set(pc.SCENE_LABELS) | set(pc.CONTINGENCY_LABELS)
        norm = lambda text: {  # noqa: E731
            m.split(" (")[0].replace("\u2026", "...")
            for m in label.findall(text)} & keep
        self.assertEqual(norm(tpl), norm(ref))
        self.assertEqual(norm(tpl), keep)

    def _handouts_body(self) -> str:
        text = self.TEMPLATE.read_text(encoding="utf-8")
        return pc._by_norm_title(text)["handouts & props"][2]

    def test_untouched_handouts_section_is_placeholder(self):
        self.assertTrue(pc._is_placeholder_body(self._handouts_body()))

    def test_spotlight_forecast_guidance_old_and_new_is_placeholder(self):
        for line in ("Per-PC hook on the table: a place, person or thread "
                     "that pulls on them; none left blank. A note.",
                     "Per-PC role and moment; none left blank. A note.",
                     "Per-PC estimated spotlight share, and any imbalance."):
            self.assertTrue(pc._is_placeholder_body(line + "\n"), line)

    def test_spotlight_guidance_kept_above_real_hooks_is_not_placeholder(self):
        # The shipped bracketed guidance left above what the GM wrote: the
        # section holds the hooks, and step 6 must read them.
        guidance = ("[Per-PC hook on the table: a place, person or thread "
                    "that pulls on them; none left blank.]\n\n")
        self.assertTrue(pc._is_placeholder_body(guidance))
        body = guidance + ("| PC | Hook |\n|---|---|\n"
                           "| [[Oswin]] | Teodor owes him the ledger |\n")
        self.assertFalse(pc._is_placeholder_body(body))

    def test_handouts_guidance_kept_with_filled_table_is_not_placeholder(self):
        guidance = self._handouts_body().split("|", 1)[0]
        body = (guidance + "| Document | Scene | Status | Notes |\n"
                "|---|---|---|---|\n"
                "| [[Ledger Page]] | Scene 2 | print | Torn at the fold |\n")
        self.assertFalse(pc._is_placeholder_body(body))

    def test_example_row_left_beside_real_rows_is_not_placeholder(self):
        body = self._handouts_body().rstrip("\n") + (
            "\n| [[Ledger Page]] | Scene 2 | print | Torn at the fold |\n")
        self.assertFalse(pc._is_placeholder_body(body))

    def test_handouts_none_is_not_placeholder(self):
        guidance = self._handouts_body().split("|", 1)[0]
        self.assertFalse(
            pc._is_placeholder_body(guidance + "No handouts or props.\n"))

    def test_template_marks_only_the_two_required_labels(self):
        text = self.TEMPLATE.read_text(encoding="utf-8")
        self.assertEqual(text.count("*(required)*"), 2)
        for label in ("**Situation:**", "**Starts it:**", "**Trigger:**"):
            self.assertIn(label, text)


class RoutingSceneTests(unittest.TestCase):
    """#205: a routing/hub scene is a menu, so it owes neither required
    label — but only when it says it is one."""

    HUB_BODY = ("**Where the party is when the session opens**\n"
                "- Gentlemen: [[The_Maidan]], brandy open.\n"
                "**Available on trigger**\n- Library, open till four.\n")

    def missing(self, title: str, body: str) -> list[str]:
        found = pc._scene_findings("p.md", body, title, pc.SCENE_LABELS)
        return [f.message for f in found if "missing" in f.message]

    def test_routing_title_needs_no_required_labels(self):
        self.assertEqual(
            self.missing("Scene 0: Monday afternoon (routing)", self.HUB_BODY),
            [])

    def test_hub_title_and_scene_zero_and_transition_type(self):
        self.assertEqual(self.missing("The Bazaar (hub)", self.HUB_BODY), [])
        self.assertEqual(self.missing("Scene 0: Monday", self.HUB_BODY), [])
        self.assertEqual(
            self.missing("Between acts",
                         "**Type:** transition\n" + self.HUB_BODY), [])

    def test_ordinary_scene_still_needs_both(self):
        # A short scene is not a routing scene; only saying so makes it one.
        self.assertEqual(len(self.missing("Scene 1: Breakfast",
                                          self.HUB_BODY)), 2)
        self.assertEqual(len(self.missing("Scene 10: Chubby hubbub",
                                          self.HUB_BODY)), 2)
        # A place or topic named "hub"/"routing" is still an ordinary scene:
        # only the documented "(routing)" / "(hub)" marker exempts it.
        for title in ("Scene 3: The Hub", "Scene 5: Hub Station airlock",
                      "Scene 4: Meeting at the hub",
                      "Scene 2: Routing the refugees", "Prologue: Scene 0"):
            self.assertEqual(len(self.missing(title, self.HUB_BODY)), 2,
                             title)
        self.assertEqual(len(self.missing("Scene 01: Monday",
                                          self.HUB_BODY)), 2)

    def test_routing_scene_still_flags_a_mistyped_label(self):
        found = pc._scene_findings(
            "p.md", "**Situation** no colon\n", "Scene 0: Monday (routing)",
            pc.SCENE_LABELS)
        self.assertTrue([f for f in found if "Situation" in f.message and "write" in f.message],
                        found)

    def test_contingency_scene_is_not_exempt(self):
        found = pc._scene_findings(
            "p.md", "**Then**\n- x\n", "Hub (routing)",
            pc.CONTINGENCY_LABELS)
        self.assertTrue([f for f in found if "Trigger" in f.message], found)


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

    def _guard_rows(self, open_questions: str) -> list[pc.Finding]:
        text = ("---\ntype: session-plan\n---\n\n## Open Questions\n\n"
                + open_questions)
        found = pc.run_checks("p.md", text, {"type": "session-plan"},
                              True, False)
        return [f for f in found if f.id == "hard-guard"]

    def test_missing_item_needs_no_guess_marker(self):
        rows = self._guard_rows(
            "- [ ] **Missing:** Georgiana's SAN after Vienna is not on "
            "her sheet\n")
        self.assertEqual(rows, [])

    def test_plot_question_still_needs_the_guess_marker(self):
        rows = self._guard_rows(
            "- [ ] Does Sophia know what her husband has become?\n")
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0].level, "ERROR")

    def test_missing_label_mid_item_is_not_the_missing_form(self):
        rows = self._guard_rows(
            "- [ ] Sophia's motive (**Missing:** from the notes)\n")
        self.assertEqual(len(rows), 1, rows)

    def test_gm_input_implies_headless(self):
        proc = run_cli(GOOD, "--gm-input", "scenes")
        rows = [line for line in proc.stdout.splitlines()
                if line.startswith("ERROR\t") and "hard-guard" in line]
        self.assertEqual(len(rows), 2, proc.stdout)

    def test_an_empty_gm_input_part_is_refused_not_all_three(self):
        # `--gm-input "$PARTS"` from an empty variable must not skip the
        # whole guard.
        for empty in ("", ",", " "):
            proc = run_cli(GOOD, "--gm-input", empty)
            self.assertEqual(proc.returncode, 2, (empty, proc.stdout))
            self.assertIn("no part given", proc.stderr)

    def test_a_wikilink_bullet_is_content_not_placeholder(self):
        self.assertFalse(pc._is_placeholder_body("- [[Nowhere Inn]]\n"))
        self.assertTrue(pc._is_placeholder_body("- [Unresolved question]\n"))

    def test_gm_input_takes_comma_separated_parts(self):
        spaced = run_cli(GOOD, "--gm-input", "intent", "scenes")
        commas = run_cli(GOOD, "--gm-input", "intent,scenes")
        self.assertEqual(spaced.stdout, commas.stdout)
        self.assertEqual(commas.returncode, spaced.returncode)

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

    def test_gm_input_scenes_settles_only_the_scenes(self):
        # The GM's request named the scenes but no intent or spotlight:
        # Planned Scenes may be settled, the other two still guard.
        proc = run_cli(GOOD, "--headless", "--gm-input", "scenes")
        rows = [line for line in proc.stdout.splitlines()
                if line.startswith("ERROR\t") and "hard-guard" in line]
        self.assertEqual(len(rows), 2, proc.stdout)
        self.assertFalse(any("Planned Scenes" in r for r in rows), rows)
        self.assertTrue(any("Session Intent" in r for r in rows), rows)
        self.assertTrue(any("Spotlight Forecast" in r for r in rows), rows)
        self.assertEqual(proc.returncode, 1, proc.stdout)

    def test_gm_input_naming_every_part_is_the_whole_spine(self):
        proc = run_cli(GOOD, "--headless", "--gm-input", "intent", "scenes",
                       "spotlight")
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertIn("INFO\t", proc.stdout)

    def test_gm_input_rejects_an_unknown_part(self):
        proc = run_cli(GOOD, "--headless", "--gm-input", "plot")
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        self.assertIn("scenes", proc.stderr)

    def test_gm_input_drops_only_the_hard_guard_errors(self):
        findings = pc.run_checks(
            str(HEADLESS), HEADLESS.read_text(encoding="utf-8"),
            pc.vl.extract_frontmatter(HEADLESS.read_text(encoding="utf-8"))
            or {}, True, True)
        bad = [f for f in findings if f.level == "ERROR"]
        self.assertFalse([f for f in bad if f.id == "hard-guard"], bad)
        # ...and it is only the guard that went quiet: the same plan
        # without --gm-input reports it, with the same other findings.
        plain = pc.run_checks(
            str(HEADLESS), HEADLESS.read_text(encoding="utf-8"),
            pc.vl.extract_frontmatter(HEADLESS.read_text(encoding="utf-8"))
            or {}, True, False)
        self.assertTrue([f for f in plain if f.id == "hard-guard"])
        rest = lambda fs: sorted(f.row for f in fs  # noqa: E731
                                 if f.id != "hard-guard")
        self.assertEqual(rest(findings), rest(plain))

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
        self.assertFalse(any("Open Questions item" in f.message
                             for f in guard_rows), guard_rows)
        # Each row says how to pass, so the guard needs no source reading.
        self.assertTrue(all("(apprentice guess — confirm)" in f.message
                            and "--gm-input" in f.message
                            for f in guard_rows), guard_rows)

    def test_default_mode_never_runs_the_guard(self):
        self.assertEqual(rows_for(findings_for(HEADLESS), "hard-guard"), [])


class InventoryTests(unittest.TestCase):
    def test_bad_plan_inventory(self):
        rows = pc.build_inventory(BAD.read_text(encoding="utf-8"))
        by_title = {title: (status, words) for title, status, words in rows}
        self.assertEqual(by_title["Touchpoint Plan"], ("absent", 0))
        self.assertNotIn("Planned vs Played", by_title)

    def test_good_plan_inventory_all_present(self):
        # Good Plan still carries an old blank Planned vs Played: not
        # reported, and no longer a template section.
        rows = pc.build_inventory(GOOD.read_text(encoding="utf-8"))
        by_title = {title: status for title, status, _w in rows}
        for title in pc.TEMPLATE_SECTIONS:
            self.assertEqual(by_title[title], "present", title)
        found = findings_for(GOOD)
        self.assertFalse([f for f in found if "Planned vs Played" in f.row])

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
    "<!-- prep-state: intent=set spotlight=hooks(3of4) scenes=1of3 "
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
            state, {"intent": "set", "spotlight": "hooks(3of4)",
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


class DurationSessionClockTests(unittest.TestCase):
    """#726: time left or gone in the session is the GM's pacing trigger,
    not a scene estimate."""

    def findings(self, line):
        text = "# Plan\n\n## Session Intent\n\n" + line + "\n"
        states, _problems = pc.vl.scan_body(text)
        return pc.check_duration("plan.md", states)

    def test_session_clock_is_left_alone(self):
        for line in ("If the party is bumbling with about 15 minutes left: "
                     "Gilt pulls them together.",
                     "With 20 minutes to go, start the fight.",
                     "About 30 minutes in, the bell rings.",
                     "Once 45 minutes are gone, cut to the tower.",
                     "Or about 15 minutes of play are left."):
            with self.subTest(line=line):
                self.assertEqual(self.findings(line), [])

    def test_scene_estimates_still_flagged(self):
        for line, level in (("Scene 3 runs 20 minutes.", "WARNING"),
                            ("The chase (20-30 minutes).", "ERROR"),
                            ("A short beat, ~10 min.", "ERROR"),
                            ("Scene 3 runs 20 minutes in total.", "WARNING"),
                            ("The chase takes 20-30 minutes in length.",
                             "ERROR")):
            with self.subTest(line=line):
                found = self.findings(line)
                self.assertEqual([f.level for f in found], [level])

    def test_an_estimate_beside_a_clock_time_is_still_flagged(self):
        found = self.findings("With 15 minutes left, run the 20 minutes fight.")
        self.assertEqual(len(found), 1)
        self.assertIn("20 minutes", found[0].message)

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


class PointerBlockTests(unittest.TestCase):
    """A Plan block whose title is one wikilink points at a scene note;
    the labels live in that note, so none are demanded here."""

    def test_pointer_block_with_no_labels_is_clean(self):
        self.assertEqual(scene_rows("", "[[Ashworth Dinner]]"), [])

    def test_aliased_pointer_is_clean(self):
        self.assertEqual(scene_rows("", "[[Ashworth Dinner|The Dinner]]"), [])

    def test_ordinary_block_without_labels_still_errors(self):
        rows = scene_rows("Some prose, no labels.", "Scene 2: The Docks")
        self.assertEqual(len(rows), 2, rows)

    def test_wikilink_inside_a_longer_title_is_not_a_pointer(self):
        rows = scene_rows("", "Scene 3: [[The Docks]]")
        self.assertEqual(len(rows), 2, rows)

    def test_pointer_block_clean_through_check_scenes(self):
        text = ("## Planned Scenes\n\n### [[Ashworth Dinner]]\n\n"
                "### Scene 2: The Docks\nNothing.\n")
        found = pc.check_scenes("P.md", pc._by_norm_title(text))
        loci = {f.locus for f in found if f.id == "scene-labels"}
        self.assertEqual(loci, {"P.md:§Scene 2: The Docks"})

    def test_pointer_prompt_lines_are_clean(self):
        # Purpose, who and how it starts: prompts, never demanded.
        text = ("## Planned Scenes\n\n### [[Ashworth Dinner]]\n"
                "**Purpose:** Emma meets the viscount.\n"
                "**Who:** [[Viscount Ashworth]], for Emma.\n"
                "**Starts it:** The invitation arrives at breakfast.\n")
        found = pc.check_scenes("P.md", pc._by_norm_title(text))
        self.assertEqual([f for f in found if f.level == "ERROR"], [])

    def test_contingency_pointer_still_needs_a_trigger(self):
        text = ("## Planned Scenes\n\n### [[Ashworth Dinner]]\n\n"
                "## Contingency Scenes\n\n### [[Fire at the Docks]]\n\n")
        found = pc.check_scenes("P.md", pc._by_norm_title(text))
        rows = [f.message for f in found if f.id == "scene-labels"]
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("[[Fire at the Docks]]", rows[0])
        self.assertIn("**Trigger:**", rows[0])


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
        for label in ("Entities", "Handouts", "NPCs", "Points to land",
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


class SkeletonTests(unittest.TestCase):
    """session-prep runs the checker on the skeleton, before the prose."""

    SKELETON = Path(__file__).resolve().parent / "fixtures" / "plan-skeleton.md"

    def test_a_valid_skeleton_has_no_error_or_warning(self):
        loud = [f for f in findings_for(self.SKELETON)
                if f.level in ("ERROR", "WARNING")]
        self.assertEqual(loud, [])

    def test_a_skeleton_with_a_misspelt_label_is_caught(self):
        # The template's intro prose also names the label; break the
        # last one, which belongs to a scene.
        head, _, tail = self.SKELETON.read_bytes().decode(
            "utf-8").rpartition("**Starts it:**")
        broken = head + "**Starts It**:" + tail
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "plan.md"
            bad.write_bytes(broken.encode("utf-8"))
            found = findings_for(bad)
        self.assertTrue(any(f.level == "ERROR" and f.id == "scene-labels"
                            for f in found), found)


class SkeletonShapeTests(unittest.TestCase):
    """The template's scene and hub skeletons are the shape the run sheet
    reads; the fixture prep checks its draft against carries them verbatim."""

    TEMPLATE = (Path(__file__).resolve().parent.parent / "skills" / "shared"
                / "templates" / "session-plan.md")
    FIXTURE = Path(__file__).resolve().parent / "fixtures" / "plan-skeleton.md"

    @staticmethod
    def skeleton(path: Path, name: str) -> str:
        m = pc.re.search(rf"<!-- {name} -->\n(.*?)\n<!-- /{name} -->",
                         path.read_text(encoding="utf-8"), pc.re.S)
        assert m, f"{path.name} has no {name} markers"
        return m.group(1).strip()

    def test_the_skeleton_is_clean(self):
        loud = [f.row for f in findings_for(self.FIXTURE)
                if f.level in ("ERROR", "WARNING")]
        self.assertEqual(loud, [])

    def test_the_fixtures_scene_and_hub_skeletons_are_the_templates(self):
        for name in ("scene-skeleton", "hub-skeleton"):
            with self.subTest(name=name):
                self.assertEqual(self.skeleton(self.FIXTURE, name),
                                 self.skeleton(self.TEMPLATE, name))

    def test_the_skeletons_carry_every_new_shape(self):
        scene = self.skeleton(self.TEMPLATE, "scene-skeleton")
        hub = self.skeleton(self.TEMPLATE, "hub-skeleton")
        for shape in ("**Place:** [[Location]]", "**Treasure**", "**NPCs**"):
            self.assertIn(shape, scene)
        self.assertIn("**Where they can go**", hub)
        self.assertIn("- **[[Location]]:**", hub)   # a place bullet, linked
        self.assertIn("- **Plain name:**", hub)     # a place bullet, words
        self.assertIn("— Scene 3", hub)             # a pointer bullet
        self.assertIn("- [[Scene note]]", hub)      # a pointer bullet

    def test_the_reference_carries_the_same_skeletons(self):
        ref = (self.TEMPLATE.parent.parent.parent / "session-prep"
               / "SKILL.md").read_text(encoding="utf-8")
        shape = ref.split("\n## Plan shape\n", 1)[1]
        for text in ("**Place:**", "**Treasure**", "**Where they can go**",
                     "— Scene"):
            self.assertIn(text, shape)


class RunSheetChecksTests(unittest.TestCase):
    """Warnings for what the run sheet reads (beats.js): each names what the
    sheet will lack. Shape only, never story."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.vault = Path(self._tmp.name)
        (self.vault / "_meta").mkdir()
        (self.vault / "Plans").mkdir()

    def note(self, name: str, type_: str, extra: str = "") -> None:
        (self.vault / f"{name}.md").write_text(
            f"---\ntype: {type_}\n{extra}---\n\nBody.\n", encoding="utf-8")

    @staticmethod
    def plan(planned: str = "", contingency: str = "") -> str:
        return ("---\ntype: session-plan\nsession: \"[[S1]]\"\n"
                "chapter: \"[[C1]]\"\n---\n\n## GM Notes\n\n"
                f"## Planned Scenes\n\n{planned}\n\n"
                f"## Contingency Scenes\n\n{contingency}\n")

    def found(self, planned: str = "", contingency: str = "",
              index: bool = True) -> list[pc.Finding]:
        text = self.plan(planned, contingency)
        return pc.run_checks(
            str(self.vault / "Plans" / "P.md"), text,
            pc.vl.extract_frontmatter(text) or {}, False,
            vault=self.vault if index else None)

    def ids(self, planned: str = "", **kw) -> list[str]:
        return [f.id for f in self.found(planned, **kw)
                if f.id in pc.RUN_SHEET_CHECKS]

    SCENE = ("### Scene 1: Supper\n**Situation:** s\n{place}"
             "**Starts it:** t\n{rest}")

    def scene(self, place: str = "**Place:** The orchard\n",
              rest: str = "") -> str:
        return self.SCENE.format(place=place, rest=rest)

    # no-place

    def test_no_place_warns(self):
        found = self.found(self.scene(place=""))
        rows = rows_for(found, "no-place")
        self.assertEqual(len(rows), 1, found)
        self.assertEqual(rows[0].level, "WARNING")
        self.assertIn("run sheet", rows[0].message)

    def test_a_place_line_with_words_is_not_no_place(self):
        self.assertEqual(self.ids(self.scene("**Place:** the cold cellar\n")), [])

    def test_a_place_link_is_not_no_place(self):
        self.assertEqual(self.ids(self.scene("**Place:** [[Orchard]]\n")), [])

    def test_a_bulleted_place_label_counts(self):
        self.assertEqual(self.ids(self.scene("- **Place:** [[Orchard]]\n")), [])

    def test_an_empty_place_line_is_no_place(self):
        self.assertEqual(self.ids(self.scene("**Place:**\n")), ["no-place"])

    def test_a_contingency_needs_no_place(self):
        self.assertEqual(
            self.ids(contingency="### If they run\n**Trigger:** t\n"
                                 "**Then**\n- x\n"), [])

    def test_a_hub_needs_no_place_or_npcs(self):
        hub = ("### Scene 0: Where they can go (hub)\n**Where they can go**\n"
               "- **The orchard:** apples\n")
        self.assertEqual(self.ids(hub), [])

    def test_a_hub_without_hub_in_its_title_is_still_a_hub(self):
        for head in ("**Where they can go**", "**Open to the party**"):
            with self.subTest(head=head):
                hub = f"### Scene 4: The yard\n{head}\n- **The orchard:** x\n"
                self.assertEqual(self.ids(hub), [])
                self.assertEqual(
                    [f.row for f in self.found(hub)
                     if f.id == "scene-labels"], [])

    def test_a_scene_note_heading_with_locations_needs_no_place_line(self):
        self.note("Orchard", "location")
        self.note("Supper", "scene", 'locations: ["[[Orchard]]"]\n')
        self.assertEqual(self.ids("### [[Supper]]\n**Starts it:** t\n"), [])

    def test_a_scene_note_heading_without_locations_warns(self):
        self.note("Supper", "scene")
        self.assertEqual(self.ids("### [[Supper]]\n**Starts it:** t\n"),
                         ["no-place"])

    def test_a_scene_note_heading_with_a_place_line_is_fine(self):
        self.note("Supper", "scene")
        self.assertEqual(
            self.ids("### [[Supper]]\n**Place:** the hall\n**Starts it:** t\n"),
            [])

    def test_a_scene_note_not_in_the_vault_is_scene_pointers_to_say(self):
        self.assertEqual(self.ids("### [[Ghost]]\n**Starts it:** t\n"), [])

    def test_the_scene_notes_own_npcs_block_is_read_too(self):
        # the run sheet reads a scene note's public text with the Plan's
        self.note("Orme", "npc")
        (self.vault / "Supper.md").write_text(
            "---\ntype: scene\nlocations: [\"[[Orchard]]\"]\n---\n\n"
            "**NPCs**\n- **[[Orme]]:** wants a word\n", encoding="utf-8")
        self.note("Orchard", "location")
        plan = "### [[Supper]]\n**Entities:** [[Orme]]\n**Starts it:** t\n"
        self.assertEqual(self.ids(plan), [])
        # a block behind a gm-only fence is not public
        (self.vault / "Supper.md").write_text(
            "---\ntype: scene\nlocations: [\"[[Orchard]]\"]\n---\n\n"
            "<!-- gm-only -->\n**NPCs**\n- **[[Orme]]:** wants a word\n"
            "<!-- /gm-only -->\n", encoding="utf-8")
        self.assertEqual(self.ids(plan), ["no-npcs-block"])

    def test_a_who_line_needs_a_person_to_clear_no_npcs_block(self):
        self.note("Orme", "npc")
        self.note("Orchard", "location")
        ent = "**Entities:** [[Orme]]\n"
        self.assertEqual(self.ids(self.scene(rest=ent + "**Who:** [[Orchard]]\n")),
                         ["no-npcs-block"])
        self.assertEqual(self.ids(self.scene(rest=ent + "**Who:** [[Orme]]\n")), [])

    def test_a_scene_notes_locations_must_include_a_location(self):
        self.note("Orme", "npc")
        self.note("Supper", "scene", 'locations: ["[[Orme]]"]\n')
        self.assertEqual(self.ids("### [[Supper]]\n**Starts it:** t\n"),
                         ["no-place"])

    # foe-no-numbers

    def stock_note(self, name: str, body: str, type_: str = "npc",
                   system: str | None = "dnd-5e-2024",
                   extra: str = "") -> None:
        (self.vault / f"{name}.md").write_text(
            f"---\ntype: {type_}\n{extra}---\n\n## Overview\n\nx\n\n"
            f"<!-- gm-only -->\n\n## GM Notes\n\n### Stats\n\n{body}\n\n"
            f"<!-- /gm-only -->\n", encoding="utf-8")
        if system:
            (self.vault / "_Campaign").mkdir(exist_ok=True)
            (self.vault / "_Campaign" / "Overview.md").write_text(
                f"---\ntype: campaign_overview\ngame_system: {system}\n---\n",
                encoding="utf-8")

    def test_a_stock_foe_warns_foe_no_numbers(self):
        self.stock_note("Tomas", "Commoner (SRD)")
        rest = "**NPCs**\n- **[[Tomas]]:** wants his cart back\n"
        found = self.found(self.scene(rest=rest))
        rows = rows_for(found, "foe-no-numbers")
        self.assertEqual(len(rows), 1, found)
        self.assertEqual(rows[0].level, "WARNING")
        self.assertIn("gma stat-fill", rows[0].message)
        self.assertIn("run sheet", rows[0].message)

    def test_a_note_type_in_another_case_still_warns_foe_no_numbers(self):
        self.stock_note("Tomas", "Commoner (SRD)", type_="NPC")
        rest = "**NPCs**\n- **[[Tomas]]:** wants his cart back\n"
        self.assertEqual(len(rows_for(
            self.found(self.scene(rest=rest)), "foe-no-numbers")), 1)

    def test_a_stock_foe_in_another_system_says_write_the_numbers(self):
        self.stock_note("Tomas", "Commoner (SRD)", system="gurps-4e")
        found = self.found(self.scene(rest="**Who:** [[Tomas]]\n"))
        rows = rows_for(found, "foe-no-numbers")
        self.assertEqual(len(rows), 1, found)
        self.assertNotIn("stat-fill", rows[0].message)
        self.assertIn("one Gaps & Actions line", rows[0].message)
        self.assertNotIn("write the numbers", rows[0].message)

    def test_a_foe_only_in_entities_is_not_in_the_room(self):
        self.stock_note("Tomas", "Commoner (SRD)")
        rest = "**Entities:** [[Tomas]]\n"
        self.assertEqual(
            rows_for(self.found(self.scene(rest=rest)), "foe-no-numbers"), [])

    def test_a_two_link_npc_lead_checks_each_person(self):
        self.note("Orme", "npc")
        self.stock_note("Tomas", "Commoner (SRD)")
        rest = ("**NPCs**\n- **[[Orme]] and [[Tomas]]:** want the cart "
                "back\n")
        found = self.found(self.scene(rest=rest))
        rows = rows_for(found, "foe-no-numbers")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("Tomas", rows[0].message)
        self.assertEqual(self.ids(self.scene(rest=rest)), ["foe-no-numbers"])

    def test_a_companion_or_key_npc_is_sent_to_the_full_workup(self):
        self.stock_note("Tomas", "Commoner (SRD)", extra="companion: true\n")
        (self.vault / "Brief.md").write_text(
            "---\ntype: adventure-brief\n---\n\n## Key NPCs\n\n"
            "- **[[Garrick]]** the smith\n", encoding="utf-8")
        self.stock_note("Garrick", "As Bandit.")
        for who in ("Tomas", "Garrick"):
            with self.subTest(who):
                found = self.found(self.scene(
                    rest=f"**Who:** [[{who}]]\n"))
                rows = rows_for(found, "foe-no-numbers")
                self.assertEqual(len(rows), 1, found)
                self.assertIn("full stat workup", rows[0].message)
                self.assertNotIn("stat-fill", rows[0].message)

    def test_a_social_npc_with_no_stats_does_not(self):
        self.note("Orme", "npc")
        rest = "**NPCs**\n- **[[Orme]]:** wants x\n"
        self.assertEqual(self.ids(self.scene(rest=rest)), [])

    def test_a_foe_with_numbers_does_not(self):
        self.stock_note(
            "Tomas", "**AC** 10 · **Initiative** +0 (10) · **HP** 4 (1d8)\n"
            "STR 10 DEX 10 CON 10 INT 10 WIS 10 CHA 10")
        rest = "**Who:** [[Tomas]] (2)\n"
        self.assertEqual(self.ids(self.scene(rest=rest)), [])

    def test_a_stock_creature_in_a_contingency_warns(self):
        self.stock_note("Hound", "Wolf (SRD)", type_="creature")
        found = self.found(contingency=(
            "### If they run\n**Trigger:** t\n**Who:** [[Hound]]\n"
            "**Then**\n- x\n"))
        self.assertEqual(len(rows_for(found, "foe-no-numbers")), 1, found)

    def test_no_vault_skips_foe_no_numbers(self):
        self.stock_note("Tomas", "Commoner (SRD)")
        self.assertEqual(
            self.ids(self.scene(rest="**Entities:** [[Tomas]]\n"),
                     index=False), [])

    def test_a_creature_in_the_room_with_no_stat_block_warns(self):
        # #827: a creature is there to be fought; with no block the sheet has no numbers.
        self.note("Gaffer", "creature")
        self.note("Innkeeper", "npc")
        rest = "**NPCs**\n- **[[Gaffer]] ×2:** hook\n- **[[Innkeeper]]:** pours\n"
        rows = rows_for(self.found(self.scene(rest=rest)), "foe-no-numbers")
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("Gaffer", rows[0].message)
        self.assertIn("### Stats", rows[0].message)

    # contingency-foes (#827)

    CONTINGENCY = "### The boat comes in early\n**Trigger:** t\n**Then**\n{then}"

    def test_a_contingencys_own_numbers_for_its_fighters_warn(self):
        for then in ("- Two cultists: Brawl 35%, Dodge 25%, HP 10, SAN 50; gaff 1D6\n",
                     "- Stat the two as [[Mickey Dunne]] without the shotgun.\n",
                     "- Use [[Mickey Dunne]] stats for both.\n",
                     "- They have [[Mickey Dunne]]'s stats.\n",
                     "- Each fisherman: HP 11, Fighting (Brawl) 50%, gaff hook 1D6.\n",
                     "- Stats: use the [[Mickey Dunne]] block without the shotgun.\n"):
            with self.subTest(then=then):
                rows = rows_for(self.found(contingency=self.CONTINGENCY.format(then=then)),
                                "contingency-foes")
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0].level, "WARNING")
                self.assertIn("**NPCs**", rows[0].message)

    def test_a_contingency_that_names_its_fighters_is_fine(self):
        self.note("Hallett Crewman", "npc")
        then = ("- Stat the two as [[Mickey Dunne]].\n**NPCs**\n"
                "- **[[Hallett Crewman]] ×2:** take the roof\n")
        self.assertEqual(rows_for(self.found(contingency=self.CONTINGENCY.format(then=then)),
                                  "contingency-foes"), [])
        who = "- HP 10, SAN 50 each.\n**Who:** [[Hallett Crewman]]\n"
        self.assertEqual(rows_for(self.found(contingency=self.CONTINGENCY.format(then=who)),
                                  "contingency-foes"), [])

    def test_a_contingency_without_numbers_or_a_planned_scene_with_them_is_not_flagged(self):
        quiet = ("- The bell rings; SAN 0/1 for anyone who hears it.\n"
                 "- Spot Hidden 40% or Listen 50% hears the boat first.\n"
                 "- Spot Hidden 40% finds the corpse; SAN 0/1 on seeing it.\n"
                 "- The thing rises: SAN 1D6/1D20, POW 70 to look away.\n")
        self.assertEqual(rows_for(self.found(contingency=self.CONTINGENCY.format(then=quiet)),
                                  "contingency-foes"), [])
        crib = self.scene(rest="- Wachter: STR 75, DEX 85, HP 13, Armor 1.\n")
        self.assertEqual(rows_for(self.found(crib), "contingency-foes"), [])

    # no-npcs-block

    def test_npc_in_entities_without_a_block_warns(self):
        self.note("Orme", "npc")
        found = self.found(self.scene(rest="**Entities:** [[Orme]]\n"))
        rows = rows_for(found, "no-npcs-block")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("nobody", rows[0].message)

    def test_creature_in_entities_without_a_block_warns(self):
        self.note("Hound", "creature")
        self.assertEqual(
            self.ids(self.scene(rest="**Entities:** [[Hound]]\n")),
            ["no-npcs-block"])

    def test_an_npcs_block_clears_it(self):
        self.note("Orme", "npc")
        rest = "**Entities:** [[Orme]]\n**NPCs**\n- **[[Orme]]:** wants x\n"
        self.assertEqual(self.ids(self.scene(rest=rest)), [])

    def test_a_block_with_no_readable_npc_line_warns(self):
        self.note("Orme", "npc")
        rest = "**Entities:** [[Orme]]\n**NPCs**\n- Mrs Orme, wary\n"
        self.assertEqual(self.ids(self.scene(rest=rest)), ["no-npcs-block"])

    def test_a_who_line_counts_only_with_a_link(self):
        self.note("Orme", "npc")
        base = "**Entities:** [[Orme]]\n"
        self.assertEqual(self.ids(self.scene(
            rest=base + "**Who:** Orme and the cook.\n")), ["no-npcs-block"])
        self.assertEqual(self.ids(self.scene(
            rest=base + "- **Who:** Orme and the cook.\n")),
            ["no-npcs-block"])
        self.assertEqual(self.ids(self.scene(
            rest=base + "**Who:** [[Orme]] and the cook.\n")), [])

    def test_a_two_link_npc_lead_is_readable(self):
        self.note("Orme", "npc")
        self.note("Tomas", "npc")
        rest = ("**Entities:** [[Orme]], [[Tomas]]\n**NPCs**\n"
                "- **[[Orme]] and [[Tomas]]:** want the cart back\n")
        self.assertEqual(self.ids(self.scene(rest=rest)), [])

    def test_a_location_in_entities_needs_no_block(self):
        self.note("Orchard", "location")
        self.assertEqual(
            self.ids(self.scene(rest="**Entities:** [[Orchard]]\n")), [])

    def test_no_index_skips_the_type_checks(self):
        self.note("Orme", "npc")
        self.assertEqual(
            self.ids(self.scene(rest="**Entities:** [[Orme]]\n"), index=False),
            [])

    def test_a_contingency_needs_no_npcs_block(self):
        self.note("Orme", "npc")
        self.assertEqual(
            self.ids(contingency="### If they run\n**Trigger:** t\n"
                                 "**Entities:** [[Orme]]\n"), [])

    # hubs

    HUB = "### Scene 0: Out and about (hub)\n**Where they can go**\n{bullets}"

    def test_a_hub_with_no_bullets_warns_hub_no_places(self):
        found = self.found(self.HUB.format(bullets=""))
        self.assertEqual(len(rows_for(found, "hub-no-places")), 1, found)

    def test_a_hub_of_pointer_bullets_is_not_hub_no_places(self):
        bullets = "- the cellar door — Scene 3\n- [[Supper]] and what follows\n"
        self.assertEqual(self.ids(self.HUB.format(bullets=bullets)), [])

    def test_a_bold_lead_ending_in_scene_n_is_a_pointer(self):
        self.note("Orme", "npc")
        for bullets in ("- **Cellar door** — Scene 3\n",
                        "- **[[Orme]]** — Scene 3\n",
                        "- **[[Orme]]** — Scene 3 (locked)\n",
                        "- **[[Orme]]** — Scene 3, locked tight\n"):
            with self.subTest(bullets=bullets):
                self.assertEqual(
                    self.ids(self.HUB.format(bullets=bullets)), [])

    def test_a_bare_link_lead_is_a_pointer_only_for_a_scene_note(self):
        self.note("Supper", "scene")
        self.note("Orchard", "location")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- [[Supper]] and what follows\n")), [])
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- [[Orchard]] at dusk\n")), [])

    def test_a_bare_link_lead_to_a_non_location_is_a_place_that_warns(self):
        self.note("Orme", "npc")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- [[Orme]] at dusk\n")), ["hub-place-not-location"])

    def test_a_bare_link_lead_with_no_vault_is_a_place(self):
        found = self.found(self.HUB.format(bullets="- [[Orchard]] at dusk\n"),
                           index=False)
        self.assertEqual(
            [f.id for f in found if f.id in pc.RUN_SHEET_CHECKS], [])

    def test_a_bold_lead_linking_a_scene_note_is_a_pointer(self):
        self.note("Supper", "scene")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **[[Supper]]:** what follows\n")), [])

    def test_a_routing_line_of_scene_links_is_a_pointer(self):
        self.note("Lucan's Call", "scene")
        bullets = ("- **The yard:** hens\n"
                   "- When the wandering winds down: [[Lucan's Call]]\n")
        self.assertEqual(self.ids(self.HUB.format(bullets=bullets)), [])
        # a link to a note that is no scene leaves it a plain bullet
        self.note("Orme", "npc")
        found = self.found(self.HUB.format(
            bullets="- **The yard:** hens\n- Down by the water: [[Orme]]\n"))
        self.assertEqual(len(rows_for(found, "hub-plain-bullet")), 1, found)

    def test_a_cue_line_is_no_readable_person(self):
        self.note("Sister Wren", "npc")
        scene = ("### Scene 1: Supper\n**Situation:** s\n"
                 "**Place:** The orchard\n**Starts it:** t\n"
                 "**Entities:** [[Sister Wren]]\n**NPCs**\n{line}\n")
        cue = scene.format(
            line="- **Arriving, start of round 3:** [[Sister Wren]] hurries in")
        person = scene.format(line="- **[[Sister Wren]]:** hurries in")
        self.assertIn("no-npcs-block", self.ids(cue))
        self.assertNotIn("no-npcs-block", self.ids(person))

    def test_a_hub_of_place_bullets_is_not_hub_no_places(self):
        bullets = "- **[[Orchard]]:** apples\n- **The yard:** hens\n"
        self.assertEqual(self.ids(self.HUB.format(bullets=bullets)), [])

    def test_a_plain_bullet_among_place_bullets_warns_hub_plain_bullet(self):
        bullets = ("- **The yard:** hens\n"
                   "- The ambush clues are marked in [[Chapter_4]]; use it.\n")
        found = self.found(self.HUB.format(bullets=bullets))
        rows = rows_for(found, "hub-plain-bullet")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("a plain line, not a bullet, after a blank line",
                      rows[0].message)
        # alone, or with only pointers, a plain bullet is hub-no-places' call
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **The yard:** hens\n- the cellar door — Scene 3\n")), [])
        self.assertIn("hub-plain-bullet", pc.RUN_SHEET_CHECKS)

    def test_a_plain_bullet_beside_only_pointers_warns_hub_plain_bullet(self):
        bullets = ("- the cellar door — Scene 3\n"
                   "- GM: keep the clock secret\n")
        found = self.found(self.HUB.format(bullets=bullets))
        self.assertEqual(len(rows_for(found, "hub-plain-bullet")), 1, found)
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- the cellar door — Scene 3\n")), [])

    def test_a_stock_foe_linked_in_a_place_bullet_warns_foe_no_numbers(self):
        self.stock_note("Hound", "Wolf (SRD)", type_="creature")
        found = self.found(self.HUB.format(
            bullets="- **The yard:** [[Hound]] guards the gate\n"))
        self.assertEqual(len(rows_for(found, "foe-no-numbers")), 1, found)
        # pointer text is left out of foe discovery
        found = self.found(self.HUB.format(
            bullets="- [[Hound]] bays — Scene 3\n"))
        self.assertEqual(rows_for(found, "foe-no-numbers"), [])

    def test_a_bold_plain_name_npc_line_is_readable(self):
        self.note("Orme", "npc")
        self.assertEqual(self.ids(self.scene(
            rest="**Entities:** [[Orme]]\n**NPCs**\n"
                 "- **The shikarri:** wants a clean drive.\n")), [])
        self.assertEqual(self.ids(self.scene(
            rest="**Entities:** [[Orme]]\n**NPCs**\n"
                 "- **Place:** the yard\n")), ["no-npcs-block"])

    def test_a_hub_title_with_no_block_warns_hub_no_places(self):
        self.assertEqual(self.ids("### Scene 5: Streets (hub)\n**Situation:** s\n"),
                         ["hub-no-places"])

    def test_a_place_bullet_linking_a_non_location_warns(self):
        self.note("Orme", "npc")
        found = self.found(self.HUB.format(bullets="- **[[Orme]]:** here\n"))
        rows = rows_for(found, "hub-place-not-location")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("npc", rows[0].message)
        self.assertNotIn("no place there", rows[0].message)
        self.assertIn("by that line's words", rows[0].message)

    def test_a_place_bullet_linking_a_location_is_fine(self):
        self.note("Orchard", "location")
        self.assertEqual(
            self.ids(self.HUB.format(bullets="- **[[Orchard]]:** apples\n")), [])

    def test_a_place_bullet_with_no_index_is_not_type_checked(self):
        self.note("Orme", "npc")
        self.assertEqual(
            self.ids(self.HUB.format(bullets="- **[[Orme]]:** here\n"),
                     index=False), [])

    def test_a_place_bullets_people_do_not_need_an_npcs_block(self):
        self.note("Orchard", "location")
        self.note("Orme", "npc")
        bullets = "- **[[Orchard]]:** [[Orme]] is picking\n"
        self.assertEqual(self.ids(self.HUB.format(bullets=bullets)), [])

    def test_a_bold_lead_linking_a_location_stays_a_place_whatever_ends_it(self):
        self.note("Orchard", "location")
        for bullets in ("- **[[Orchard]]** — Scene 3\n",
                        "- [[Orchard]], Scene 3\n"):
            with self.subTest(bullets=bullets):
                found = self.found(self.HUB.format(bullets=bullets))
                self.assertEqual(
                    [f.id for f in found if f.id in pc.RUN_SHEET_CHECKS], [])
        self.note("Orme", "npc")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **[[Orme]]** — Scene 3\n")), [])

    def test_a_scene_reference_after_a_comma_or_in_parentheses_is_a_pointer(self):
        for bullets in ("- the yard: shouting, Scene 1.\n",
                        "- the yard shouting (Scene 1)\n"):
            with self.subTest(bullets=bullets):
                self.assertEqual(
                    self.ids(self.HUB.format(bullets=bullets)), [])
        # a plain bullet with no scene reference is neither place nor lead
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- the yard shouting\n")), ["hub-no-places"])

    def test_a_bold_lead_with_a_colon_is_a_place_whatever_its_tail_says(self):
        for bullets in ("- **Great hall:** the feast, Scene 1 ended here\n",
                        "- **Great hall**: the feast — Scene 3\n",
                        "- **[[Hall]]:** the feast, Scene 1\n"):
            with self.subTest(bullets=bullets):
                found = self.found(self.HUB.format(bullets=bullets))
                self.assertEqual(
                    [f.id for f in found if f.id in pc.RUN_SHEET_CHECKS], [])
                self.assertEqual(self.ids(self.HUB.format(
                    bullets=bullets + "- **Cellar door** — Scene 3\n")), [])
        # a place, not a lead: alone it still leaves the hub with a place
        # only, and a colon-less bold lead alone is a pointer
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **Cellar door** — Scene 3\n")), [])

    def test_a_scene_typed_lead_link_is_a_pointer_even_with_a_colon(self):
        self.note("Supper", "scene")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **[[Supper]]:** the feast, Scene 1\n")), [])

    def test_a_type_in_another_case_still_counts_as_a_location(self):
        self.note("Orchard", "Location")
        self.assertEqual(self.ids(self.HUB.format(
            bullets="- **[[Orchard]]:** apples\n")), [])
        self.assertEqual(self.ids(
            "### Scene 4: Y\n**Situation:** s\n**Place:** [[Orchard]] at dusk\n"
            "**Starts it:** t\n"), [])

    def test_a_hub_of_plain_bullets_says_the_sheet_cannot_name_them(self):
        rows = rows_for(self.found(self.HUB.format(
            bullets="- the yard\n")), "hub-no-places")
        self.assertEqual(len(rows), 1)
        self.assertIn("bold lead", rows[0].message)
        self.assertNotIn("cannot name", rows[0].message)
        self.assertNotIn("nowhere to go", rows[0].message)
        bare = rows_for(self.found(self.HUB.format(bullets="")),
                        "hub-no-places")
        self.assertIn("nowhere to go", bare[0].message)

    # place-not-location

    def test_a_place_line_linking_a_non_location_warns(self):
        self.note("Orme", "npc")
        rows = rows_for(self.found(self.scene("**Place:** [[Orme]], the yard\n")),
                        "place-not-location")
        self.assertEqual(len(rows), 1)
        self.assertIn("npc", rows[0].message)

    def test_a_place_line_linking_a_location_with_words_is_clean(self):
        self.note("Cloister", "location")
        self.assertEqual(self.ids(
            self.scene("**Place:** [[Cloister]], the yard\n")), [])

    def test_a_place_line_link_with_no_vault_is_not_type_checked(self):
        self.note("Orme", "npc")
        self.assertEqual(self.ids(
            self.scene("**Place:** [[Orme]]\n"), index=False), [])

    def test_no_place_with_a_location_in_entities_says_so(self):
        self.note("Orchard", "location")
        rows = rows_for(self.found(self.scene(
            place="", rest="**Entities:** [[Orchard]]\n")), "no-place")
        self.assertEqual(len(rows), 1)
        self.assertIn("makes it explicit", rows[0].message)
        self.assertNotIn("will not say where", rows[0].message)

    # label-form

    def test_a_bulleted_block_label_with_nothing_after_it_warns(self):
        for head in ("- **Treasure:**", "- **Treasure**", "- **Points to land:**",
                     "- **NPCs:**"):
            with self.subTest(head=head):
                rows = rows_for(self.found(self.scene(
                    rest=f"{head}\n  - a gem\n")), "label-form")
                self.assertEqual(len(rows), 1, head)
                self.assertIn("will not read", rows[0].message)

    def test_a_bulleted_block_label_with_words_after_it_warns(self):
        for head in ("- **Treasure:** a gem", "- **NPCs:** [[Orme]] is here",
                     "- **Complications**: a storm"):
            with self.subTest(head=head):
                rows = rows_for(self.found(self.scene(
                    rest=f"{head}\n")), "label-form")
                self.assertEqual(len(rows), 1, head)

    def test_a_bulleted_one_line_label_is_fine(self):
        self.assertEqual(self.ids(self.scene(
            rest="- **Entities:** the orchard\n")), [])

    def test_an_inline_label_with_a_parenthesis_is_repaired_with_its_colon(self):
        for line, fix in (("- **Place (where):** the yard", "'**Place:**'"),
                          ("**NPCs (who is here)**", "'**NPCs**'")):
            with self.subTest(line=line):
                rows = rows_for(self.found(self.scene(
                    place="", rest=f"{line}\n")), "label-form")
                self.assertEqual(len(rows), 1)
                self.assertIn(f"write {fix}", rows[0].message)

    def test_npcs_in_parentheses_warns_label_form(self):
        found = self.found(self.scene(
            rest="**NPCs (who is here)**\n- **[[Orme]]:** x\n"))
        rows = rows_for(found, "label-form")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("**NPCs**", rows[0].message)

    def test_parenthesis_inside_the_bold_of_any_label_warns(self):
        for line in ("**Complications (drop when it sags)**",
                     "- **Place (where):** the yard",
                     "**If the players... (the table)**"):
            with self.subTest(line=line):
                self.assertIn("label-form", self.ids(
                    self.scene(place="", rest=line + "\n")))

    def test_a_parenthesis_outside_the_bold_is_fine(self):
        self.assertEqual(self.ids(self.scene(
            rest="**Open to the party** (any order)\n- **The yard:** x\n")), [])

    def test_a_label_in_prose_is_not_label_form(self):
        self.assertEqual(self.ids(self.scene(
            rest="- **The Note (torn):** is on the table\n")), [])

    def test_the_three_label_forms_are_all_read(self):
        for place in ("**Place:** [[Orchard]]\n", "- **Place:** [[Orchard]]\n",
                      "**Place:** [[Orchard]]  \n"):
            self.assertEqual(self.ids(self.scene(place)), [])

    # if-table-unlabelled

    TABLE = "| Do | Then |\n|---|---|\n| a | b |\n"

    def test_a_table_under_the_if_label_is_fine(self):
        self.assertEqual(self.ids(self.scene(
            rest="**If the players...**\n" + self.TABLE)), [])

    def test_a_table_with_no_label_warns(self):
        found = self.found(self.scene(rest=self.TABLE))
        rows = rows_for(found, "if-table-unlabelled")
        self.assertEqual(len(rows), 1, found)
        self.assertIn("If the players", rows[0].message)

    def test_a_table_under_another_label_warns(self):
        self.assertEqual(self.ids(self.scene(
            rest="**Points to land**\n" + self.TABLE)), ["if-table-unlabelled"])

    def test_only_a_do_or_if_table_warns(self):
        for head in ("Rumour | True?", "d10 | Encounter", "Outcome | Effect"):
            with self.subTest(head=head):
                table = f"| {head} |\n|---|---|\n| a | b |\n"
                self.assertEqual(self.ids(self.scene(rest=table)), [])
        for head in ("If | Then", "If they go to | They find", "Do | Then",
                     "If a PC… | Result"):
            with self.subTest(head=head):
                table = f"| {head} |\n|---|---|\n| a | b |\n"
                self.assertEqual(self.ids(self.scene(rest=table)),
                                 ["if-table-unlabelled"])

    def test_a_table_in_a_code_fence_is_ignored(self):
        self.assertEqual(self.ids(self.scene(
            rest="```\n" + self.TABLE + "```\n")), [])

    def test_a_mistyped_if_label_is_reported_once_not_twice(self):
        found = self.found(self.scene(rest="**If the players..**\n" + self.TABLE))
        self.assertEqual(len(rows_for(found, "scene-labels")), 1, found)
        self.assertEqual(rows_for(found, "if-table-unlabelled"), [])

    def test_the_colon_form_of_the_if_label_is_clean(self):
        found = self.found(self.scene(rest="**If the players:**\n" + self.TABLE))
        self.assertEqual(rows_for(found, "scene-labels"), [])
        self.assertEqual(rows_for(found, "if-table-unlabelled"), [])

    def test_a_table_after_a_quote_is_no_longer_under_the_if_label(self):
        # the reader ends the If block at the quote, so the second table is lost
        rest = ("**If the players...**\n" + self.TABLE
                + "\n> Read this aloud.\n\n" + self.TABLE)
        self.assertEqual(self.ids(self.scene(rest=rest)),
                         ["if-table-unlabelled"])

    def test_a_table_after_a_heading_is_no_longer_under_the_if_label(self):
        rest = ("**If the players...**\n" + self.TABLE
                + "\n#### Later\n\n" + self.TABLE)
        self.assertEqual(self.ids(self.scene(rest=rest)),
                         ["if-table-unlabelled"])


if __name__ == "__main__":
    unittest.main(verbosity=2)


class MissingScenePointerTests(unittest.TestCase):
    """A Plan pointer to a scene note the vault lacks is a WARNING (#490);
    the vault is found by walking up from the plan."""

    PLAN = ("---\ntype: session-plan\nsession: \"[[Session 04]]\"\n"
            "chapter: \"[[Ch 1]]\"\n---\n\n## Planned Scenes\n\n"
            "### [[Ashworth Dinner]]\n\n### [[Typo Scene]]\n\n"
            "### [[Chapters/Ch 1/Scenes/Gala]]\n")

    def make(self, with_meta=True):
        root = Path(tempfile.mkdtemp(prefix="plan-check-ptr-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        if with_meta:
            (root / "_meta").mkdir()
        scenes = root / "Chapters" / "Ch 1" / "Scenes"
        scenes.mkdir(parents=True)
        (scenes / "Ashworth Dinner.md").write_text(
            "---\ntype: scene\n---\n\nBody.\n", encoding="utf-8")
        (scenes / "Gala.md").write_text(
            "---\ntype: scene\n---\n\nBody.\n", encoding="utf-8")
        plan = root / "Chapters" / "Ch 1" / "Planning" / "Plan.md"
        plan.parent.mkdir(parents=True)
        plan.write_text(self.PLAN, encoding="utf-8")
        return root, plan

    def rows(self, plan):
        return [l for l in run_cli(plan).stdout.splitlines()
                if "scene-pointer" in l]

    def test_missing_scene_note_is_warned(self):
        _root, plan = self.make()
        rows = self.rows(plan)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("WARNING\t"), rows)
        self.assertIn("Typo Scene", rows[0])

    def test_existing_notes_by_name_and_path_are_clean(self):
        _root, plan = self.make()
        rows = "\n".join(self.rows(plan))
        self.assertNotIn("Ashworth Dinner", rows)
        self.assertNotIn("Gala", rows)

    def test_a_note_of_another_type_is_no_scene(self):
        root, plan = self.make()
        (root / "NPCs").mkdir()
        (root / "NPCs" / "Typo Scene.md").write_text(
            "---\ntype: npc\n---\n", encoding="utf-8")
        self.assertEqual(len(self.rows(plan)), 1)

    def test_no_vault_found_is_an_info_row_not_a_warning(self):
        _root, plan = self.make(with_meta=False)
        rows = self.rows(plan)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("INFO\t"), rows)


class ScenePointerFixRoundTests(unittest.TestCase):
    """Wording and edge cases of the scene-pointer check (#490 review)."""

    def vault(self, notes, plan_rel, plan_text, meta=True):
        root = Path(tempfile.mkdtemp(prefix="plan-check-fix-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        if meta:
            (root / "_meta").mkdir()
        for rel, text in {**notes, plan_rel: plan_text}.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return root / plan_rel

    @staticmethod
    def plan(*headings):
        body = "".join(f"### {h}\n\n" for h in headings)
        return ("---\ntype: session-plan\nchapter: \"[[Ch 1]]\"\n---\n\n"
                f"## Planned Scenes\n\n{body}")

    def rows(self, plan):
        return [l for l in run_cli(plan).stdout.splitlines()
                if "scene-pointer" in l]

    def test_a_note_of_the_wrong_type_is_named_not_rewritten(self):
        plan = self.vault(
            {"Scenes/Gala.md": "---\ntype: Scene\n---\n"},
            "Plans/P.md", self.plan("[[Gala]]"))
        rows = self.rows(plan)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("exists", rows[0])
        self.assertIn("isn't a scene note", rows[0])
        self.assertNotIn("write the note", rows[0])

    def test_a_bom_note_is_read_as_the_scene_it_is(self):
        # A byte-order mark before the frontmatter used to hide its type
        # (#593); the note is a scene, so the pointer is fine.
        plan = self.vault(
            {"Scenes/Gala.md": "\ufeff---\ntype: scene\n---\n"},
            "Plans/P.md", self.plan("[[Gala]]"))
        self.assertEqual(self.rows(plan), [])

    def test_a_truly_missing_note_still_says_write_it(self):
        plan = self.vault({}, "Plans/P.md", self.plan("[[Nope]]"))
        self.assertIn("write the note", self.rows(plan)[0])

    def test_no_vault_with_pointers_says_the_check_did_not_run(self):
        root = Path(tempfile.mkdtemp(prefix="plan-check-novault-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        plan = root / "P.md"
        plan.write_text(self.plan("[[Gala]]"), encoding="utf-8")
        rows = self.rows(plan)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("INFO\t"), rows)
        self.assertIn("not run", rows[0])

    def test_no_vault_and_no_pointers_stays_silent(self):
        root = Path(tempfile.mkdtemp(prefix="plan-check-novault-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        plan = root / "P.md"
        plan.write_text(self.plan("Scene 1: Docks"), encoding="utf-8")
        self.assertEqual(self.rows(plan), [])

    def test_a_bare_pointer_matching_two_chapters_is_flagged(self):
        scene = "---\ntype: scene\n---\n"
        plan = self.vault(
            {"Chapters/A/Scenes/Gala.md": scene,
             "Chapters/B/Scenes/Gala.md": scene},
            "Plans/P.md", self.plan("[[Gala]]"))
        rows = self.rows(plan)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("2 scene notes", rows[0])

    def test_a_path_pointer_to_one_of_two_is_clean(self):
        scene = "---\ntype: scene\n---\n"
        plan = self.vault(
            {"Chapters/A/Scenes/Gala.md": scene,
             "Chapters/B/Scenes/Gala.md": scene},
            "Plans/P.md", self.plan("[[Chapters/A/Scenes/Gala]]"))
        self.assertEqual(self.rows(plan), [])

    def test_a_template_plan_is_not_checked(self):
        plan = self.vault({}, "_Templates/_Template_Plan.md",
                          self.plan("[[Scene Note Title]]"))
        self.assertEqual(self.rows(plan), [])

    def test_the_alias_stays_in_the_location(self):
        plan = self.vault({}, "Plans/P.md", self.plan("[[Nope|The Nope]]"))
        self.assertIn("§[[Nope|The Nope]]", self.rows(plan)[0])

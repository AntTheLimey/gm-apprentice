#!/usr/bin/env python3
"""Regression tests for session_context.py --play and --threads.

Covers the Play Brief (a Session Plan reduced to what the table needs)
and the Threads report (per-PC Open-threads age/staleness against
Wrap-Up Unresolved Threads / PC Carry-Forward bullets, plus orphaned
wrap-up bullets that never made it onto a PC sheet).

Run: python3 tests/test_session_context_play.py
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
sys.path.insert(0, str(SCRIPTS))

import session_context as sc  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "slice-b" / "play"
SCRIPT = SCRIPTS / "session_context.py"


def run_cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True, timeout=60)


def load_files(vault):
    return list(sc.vault_files(vault))


class PlayBriefCLITests(unittest.TestCase):
    """`session_context.py VAULT --play`."""

    def test_play_prints_only_brief(self):
        result = run_cli(FIXTURE, "--play")
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        self.assertNotIn("Wrap-Up", out)
        self.assertNotIn("Active PCs", out)
        self.assertNotIn("Campaign Overview", out)
        self.assertIn("===== Play Brief — Session 8 =====", out)
        self.assertIn("### Scene 1: The Dredger's Manifest", out)
        self.assertIn("**Type:** investigation", out)
        self.assertIn("**Situation:**", out)
        self.assertIn("**Starts it:**", out)
        self.assertIn("**Points to land**", out)
        self.assertIn("| Do | Then |", out)
        self.assertNotIn("**Entities:**", out)
        self.assertIn("### Scene 2: Bram's Reckoning", out)
        self.assertNotIn("Active Threads", out)

    def test_play_session_flag_picks_named_plan(self):
        result = run_cli(FIXTURE, "--play", "--session", "8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Play Brief — Session 8 =====", result.stdout)
        self.assertIn("Session_08_Plan.md", result.stdout)

    def test_play_session_flag_missing_plan(self):
        result = run_cli(FIXTURE, "--play", "--session", "99")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "(no plan for session 99)")

    def test_play_and_threads_are_mutually_exclusive(self):
        result = run_cli(FIXTURE, "--play", "--threads")
        self.assertNotEqual(result.returncode, 0)

    def test_default_mode_is_unaffected(self):
        # #162 regression: adding --play/--threads must not disturb the
        # existing bundle's header or section set.
        result = run_cli(FIXTURE, "--session", "7")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Session Context =====", result.stdout)
        self.assertIn("===== Wrap-Up — Session 7 =====", result.stdout)
        self.assertIn("===== Active PCs =====", result.stdout)
        self.assertIn("===== Campaign Overview =====", result.stdout)
        self.assertNotIn("Play Brief", result.stdout)
        self.assertNotIn("===== Threads =====", result.stdout)


class PlaySessionChapterResolutionTests(unittest.TestCase):
    """M13: `--play --session N` must resolve N's own chapter, not the
    "current" session's — session numbering restarts per chapter, so a
    plan for N filed under a different (non-current) chapter used to be
    unfindable."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp(prefix="session-context-chap-"))
        self.addCleanup(shutil.rmtree, self.vault, ignore_errors=True)
        shutil.copytree(FIXTURE, self.vault, dirs_exist_ok=True)
        # A session 20 (unique number, not present anywhere else) filed
        # under Chapter 3 - Vienna, which is NOT the fixture's "current"
        # chapter (Chapter 4 - Calcutta — see test_play_prints_only_brief,
        # whose default target of 8 resolves there).
        vienna = self.vault / "Chapters" / "Chapter 3 - Vienna" / "Sessions"
        (vienna / "Session 20.md").write_text(
            "---\ntype: session\nsession_number: 20\nstatus: reviewed\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\ndocuments: []\n"
            "---\n\n# Session 20\n", encoding="utf-8")
        (vienna / "Session_20_Plan.md").write_text(
            "---\ntype: session-plan\nsession: 20\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\n---\n\n"
            "# Session 20 Plan\n\n## Session Intent\n\n"
            "M13 regression plan.\n", encoding="utf-8")

    def test_plan_under_non_current_chapter_is_found(self):
        result = run_cli(self.vault, "--play", "--session", "20")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Play Brief — Session 20 =====", result.stdout)
        self.assertIn("Session_20_Plan.md", result.stdout)
        self.assertNotIn("(no plan for session 20)", result.stdout)


class PlayBriefFunctionTests(unittest.TestCase):
    """`play_brief(files, plan_rel, plan_text)` directly."""

    @classmethod
    def setUpClass(cls):
        cls.files = load_files(FIXTURE)
        cls.plan = next(
            (rel, text) for rel, text, fm in cls.files
            if fm.get("type") == "session-plan"
            and sc.parse_session_number(fm.get("session")) == 8)

    def test_sections_in_order_and_reduced(self):
        rel, text = self.plan
        brief = sc.play_brief(self.files, rel, text)
        self.assertTrue(brief.startswith("===== Play Brief — Session 8 ====="))
        self.assertIn(f"(source: {rel})", brief)
        order = ["## Session Intent", "## Planned Scenes",
                 "## NPC Quick Reference", "## World State",
                 "## Contingency Scenes", "## Session End Objectives"]
        positions = [brief.index(h) for h in order]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("## Active Threads", brief)
        self.assertIn("Bram's ledger debt catches up", brief)  # Session Intent verbatim
        self.assertIn("| NPC | Role This Session |", brief)  # NPC table verbatim
        self.assertIn("monsoon season", brief)  # World State verbatim
        self.assertIn("### If the party stalls Bram twice", brief)
        self.assertIn("**Trigger:**", brief)

    def test_absent_sections_report_placeholder(self):
        text = ("---\ntype: session-plan\nsession: 3\n---\n\n"
                "## Session Intent\n\nJust a note.\n")
        brief = sc.play_brief(self.files, "fake.md", text)
        self.assertIn("(no ## Planned Scenes)", brief)
        self.assertIn("(no ## NPC Quick Reference)", brief)
        self.assertIn("(no ## World State)", brief)
        self.assertIn("(no ## Contingency Scenes)", brief)
        self.assertIn("(no ## Session End Objectives)", brief)


class PointerBlockBriefTests(unittest.TestCase):
    """A `### [[Scene]]` block in the Plan is followed by that scene
    note's body: Paused section first, GM-only parts kept (the brief is
    the GM's own sheet), the marker lines themselves dropped."""

    PLAN = ("---\ntype: session-plan\nsession: 4\n---\n\n"
            "## Session Intent\n\nA dinner.\n\n## Planned Scenes\n\n"
            "### [[Ashworth Dinner]]\n\n### [[Missing Scene]]\n\n"
            "### Scene 3: The Docks\n**Situation:** Rain.\n")
    SCENE = ("---\ntype: scene\nstatus: paused\n---\n\n"
             "## Paused\n\nThey left at the soup course.\n\n"
             "**Situation:** The table is laid for eleven.\n\n"
             "**Starts it:** Lady Ashworth taps her glass.\n\n"
             "<!-- gm-only -->\n\n## GM Notes\n\nThe soup is poisoned.\n\n"
             "<!-- /gm-only -->\n")

    def setUp(self):
        self.files = [
            ("Chapters/C/Scenes/Ashworth Dinner.md", self.SCENE,
             sc.extract_frontmatter(self.SCENE) or {})]
        self.brief = sc.play_brief(self.files, "P.md", self.PLAN)

    def test_scene_body_follows_its_pointer(self):
        self.assertIn("### [[Ashworth Dinner]]", self.brief)
        self.assertIn("The table is laid for eleven.", self.brief)
        self.assertIn("Lady Ashworth taps her glass.", self.brief)

    def test_paused_section_comes_first(self):
        self.assertLess(self.brief.index("They left at the soup course."),
                        self.brief.index("The table is laid for eleven."))

    def test_gm_only_notes_are_kept_without_markers(self):
        self.assertIn("## GM Notes\n\nThe soup is poisoned.", self.brief)
        self.assertNotIn("gm-only", self.brief)
        self.assertNotIn("type: scene", self.brief)

    def test_unresolved_pointer_is_named_not_dropped(self):
        self.assertIn("### [[Missing Scene]]", self.brief)
        self.assertIn("(no scene note named Missing Scene)", self.brief)

    def test_inline_scene_is_unchanged(self):
        self.assertIn("### Scene 3: The Docks\n**Situation:** Rain.",
                      self.brief)


class FencedBlankLinesTests(unittest.TestCase):
    """Blank lines inside a code fence reach the brief as written (#549)."""

    def brief(self, body):
        scene = f"---\ntype: scene\n---\n\n{body}"
        files = [("S/Dinner.md", scene, sc.extract_frontmatter(scene) or {})]
        plan = ("---\ntype: session-plan\nsession: 4\n---\n\n"
                "## Planned Scenes\n\n### [[Dinner]]\n")
        return sc.play_brief(files, "P.md", plan)

    def test_fence_keeps_its_blank_lines(self):
        out = self.brief("Intro.\n\n```\nA\n\n\n\nB\n```\n\nEnd.\n")
        self.assertIn("```\nA\n\n\n\nB\n```", out)

    def test_tilde_fence_keeps_its_blank_lines(self):
        out = self.brief("~~~\nA\n\n\n\nB\n~~~\n")
        self.assertIn("~~~\nA\n\n\n\nB\n~~~", out)

    def test_blank_runs_outside_a_fence_still_collapse(self):
        out = self.brief("One.\n\n\n\nTwo.\n\n```\nx\n```\n\n\n\nThree.\n")
        self.assertIn("One.\n\nTwo.", out)
        self.assertIn("```\n\nThree.", out)


class TopPausedSectionBriefTests(unittest.TestCase):
    """A section written by scene-paused at the top ends at its marker:
    the brief prints only the snapshot under Paused and leaves the prep
    where it was."""

    PLAN = PointerBlockBriefTests.PLAN
    SCENE = ("---\ntype: scene\nstatus: paused\n---\n\n"
             "<!-- prompt -->\n\n## Paused\n\nAfter [[S5]].\n\n"
             "They left at the soup course.\n<!-- /paused -->\n\n"
             "**Situation:** The table is laid for eleven.\n\n"
             "<!-- gm-only -->\n\n## GM Notes\n\nPoisoned.\n\n"
             "<!-- /gm-only -->\n")

    def test_only_the_snapshot_is_under_paused(self):
        files = [("Chapters/C/Scenes/Ashworth Dinner.md", self.SCENE,
                  sc.extract_frontmatter(self.SCENE) or {})]
        brief = sc.play_brief(files, "P.md", self.PLAN)
        self.assertIn("## Paused\nAfter [[S5]].\n\nThey left at the soup "
                      "course.\n\n", brief)
        self.assertNotIn("/paused", brief)
        snap = brief.index("They left at the soup course.")
        sit = brief.index("**Situation:** The table is laid")
        self.assertLess(snap, sit)
        self.assertEqual(brief.count("**Situation:** The table"), 1)
        self.assertIn("<!-- prompt -->\n\n**Situation:**", brief)
        self.assertIn("## GM Notes\n\nPoisoned.", brief)


class PausedScenesPlayTests(unittest.TestCase):
    """Paused scenes in `--play`: all of them when there is no Plan, the
    ones the Plan leaves out as a line each."""

    CH = "Chapters/Chapter 1 - Harbour"
    SCENE = ("---\ntype: scene\nstatus: paused\nplayed_in:\n"
             "  - \"[[Session 05 - Beneath the Mill]]\"\n---\n\n"
             "## Paused\n\nAfter [[Session 05 - Beneath the Mill]].\n\n"
             "Stopped at the fork in the tunnel.\n<!-- /paused -->\n")
    INDEX = ("---\ntype: session\nsession_number: 6\n"
             "chapter: \"[[Chapter 1 - Harbour]]\"\n---\n\n# S6\n")

    def vault(self, plan=None, scene=None):
        root = Path(tempfile.mkdtemp(prefix="sc-play-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        files = {f"{self.CH}/Chapter 1 - Harbour.md": "---\ntype: chapter\n---\n",
                 f"{self.CH}/Sessions/Session 05.md": self.INDEX.replace(
                     "session_number: 6", "session_number: 5")}
        if scene is not False:
            files[f"{self.CH}/Scenes/Down the Mill Cellar.md"] = (
                scene or self.SCENE)
        if plan:
            files[f"{self.CH}/Sessions/Session 06 Plan.md"] = plan
        for rel, text in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return root

    def plan(self, scenes):
        return ("---\ntype: session-plan\nsession: 6\n"
                "chapter: \"[[Chapter 1 - Harbour]]\"\n---\n\n"
                "## Session Intent\n\nA dive.\n\n## Planned Scenes\n\n"
                + scenes)

    def test_no_plan_prints_snapshots(self):
        out = run_cli(self.vault(), "--play").stdout
        self.assertIn("(no plan for session 6)\n", out)
        block = out.split("(no plan for session 6)", 1)[1]
        self.assertIn("## Paused Scenes\n### [[Down the Mill Cellar]] "
                      "(paused after [[Session 05 - Beneath the Mill]])\n"
                      "After [[Session 05 - Beneath the Mill]].\n\n"
                      "Stopped at the fork in the tunnel.", block)
        self.assertNotIn("/paused", block)

    def test_plan_pointing_at_paused_scene_prints_no_extra(self):
        out = run_cli(self.vault(self.plan(
            "### [[Down the Mill Cellar]]\n")), "--play").stdout
        self.assertEqual(out.count("Stopped at the fork"), 1)
        self.assertIn("## Paused\nAfter [[Session 05", out)
        self.assertNotIn("not in this Plan", out)

    def test_plan_without_paused_scene_names_it(self):
        out = run_cli(self.vault(self.plan(
            "### Scene 1: The Docks\n**Situation:** Rain.\n")),
            "--play").stdout
        self.assertIn("## Paused, not in this Plan\n[[Down the Mill Cellar]]"
                      " (paused after [[Session 05 - Beneath the Mill]])",
                      out)
        self.assertNotIn("fork in the tunnel", out)

    def twin_vault(self, pointer):
        root = self.vault(self.plan(f"### [[{pointer}]]\n"), scene=False)
        for ch in ("Chapter 1 - Harbour", "Chapter 2 - Other"):
            path = root / "Chapters" / ch / "Scenes" / "The Fork.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(self.SCENE, encoding="utf-8")
        return root

    def test_path_pointer_does_not_hide_a_twin_stem(self):
        for pointer in ("Chapters/Chapter 1 - Harbour/Scenes/The Fork",
                        "Chapters/Chapter 1 - Harbour/Scenes/The Fork.md"):
            out = run_cli(self.twin_vault(pointer), "--play").stdout
            tail = out.split("## Paused, not in this Plan", 1)
            self.assertEqual(len(tail), 2, out)
            self.assertIn("[[The Fork]]", tail[1])
            self.assertEqual(tail[1].count("[[The Fork]]"), 1, tail[1])

    def test_bare_pointer_still_matches_by_stem(self):
        out = run_cli(self.twin_vault("The Fork"), "--play").stdout
        self.assertNotIn("not in this Plan", out)

    def test_no_paused_prints_nothing(self):
        for plan in (None, self.plan("### Scene 1: The Docks\n")):
            out = run_cli(self.vault(plan, scene=False), "--play").stdout
            self.assertNotIn("Paused", out)


class PointerChoiceTests(unittest.TestCase):
    """Two scene notes share a name: the one in the Plan's own chapter is
    used; when that still leaves several, the brief says so."""

    PLAN = ("---\ntype: session-plan\nchapter: \"[[Chapter 2 - B]]\"\n"
            "session: 4\n---\n\n## Planned Scenes\n\n### [[Docks]]\n")

    @staticmethod
    def scene(body):
        text = f"---\ntype: scene\nstatus: planned\n---\n\n{body}\n"
        return text, sc.extract_frontmatter(text) or {}

    def entry(self, rel, body):
        return (rel, *self.scene(body))

    def test_the_plans_own_chapter_wins(self):
        files = [self.entry("Chapters/Chapter 1 - A/Scenes/Docks.md", "AAA"),
                 self.entry("Chapters/Chapter 2 - B/Scenes/Docks.md", "BBB")]
        brief = sc.play_brief(files, "Chapters/Chapter 2 - B/P.md", self.PLAN)
        self.assertIn("BBB", brief)
        self.assertNotIn("AAA", brief)

    def test_still_ambiguous_is_said_not_guessed(self):
        files = [self.entry("Chapters/Chapter 1 - A/Scenes/Docks.md", "AAA"),
                 self.entry("Chapters/Chapter 3 - C/Scenes/Docks.md", "CCC")]
        brief = sc.play_brief(files, "Chapters/Chapter 2 - B/P.md", self.PLAN)
        self.assertNotIn("AAA", brief)
        self.assertNotIn("CCC", brief)
        self.assertIn("2 scene notes named Docks", brief)
        self.assertIn("Chapters/Chapter 1 - A/Scenes/Docks.md", brief)

    def test_a_path_pointer_names_its_note(self):
        files = [self.entry("Chapters/Chapter 1 - A/Scenes/Docks.md", "AAA"),
                 self.entry("Chapters/Chapter 3 - C/Scenes/Docks.md", "CCC")]
        plan = self.PLAN.replace("[[Docks]]",
                                 "[[Chapters/Chapter 3 - C/Scenes/Docks]]")
        brief = sc.play_brief(files, "Chapters/Chapter 2 - B/P.md", plan)
        self.assertIn("CCC", brief)
        self.assertNotIn("AAA", brief)

    def test_gm_notes_section_is_kept(self):
        files = [self.entry("Chapters/Chapter 2 - B/Scenes/Docks.md",
                            "**Situation:** Rain.\n\n## GM Notes\n\n"
                            "The crate is empty.\n\n### Why\n\nA lie.\n\n"
                            "## After\n\nThey sail.")]
        brief = sc.play_brief(files, "Chapters/Chapter 2 - B/P.md", self.PLAN)
        self.assertIn("Rain.", brief)
        self.assertIn("The crate is empty.", brief)
        self.assertIn("A lie.", brief)
        self.assertIn("They sail.", brief)


class FindPlanFallbackTests(unittest.TestCase):
    """M15: `_find_plan`'s `documents.plan` fallback — when no
    `type: session-plan` file directly names the session, the session
    index's own `documents.plan` wikilink resolves it by filename stem.
    Not exercised by FIXTURE (its plans all match directly by number)."""

    @staticmethod
    def _entry(rel, text):
        return (rel, text, sc.extract_frontmatter(text) or {})

    def test_resolves_via_documents_plan_link(self):
        session_text = (
            "---\ntype: session\nsession_number: 5\n"
            "chapter: \"[[Chapter Five]]\"\n"
            "documents:\n  plan: \"[[Loose Plan Doc]]\"\n---\n\n# Session 05\n")
        plan_text = "---\ntype: note\n---\n\n## Session Intent\n\nAd hoc plan.\n"
        files = [
            self._entry("Chapters/Chapter Five/Sessions/Session 05.md",
                       session_text),
            self._entry("Notes/Loose Plan Doc.md", plan_text),
        ]
        plan = sc._find_plan(files, "chapter five", 5)
        self.assertIsNotNone(plan)
        self.assertEqual(plan[0], "Notes/Loose Plan Doc.md")

    def test_no_link_and_no_direct_plan_is_none(self):
        session_text = (
            "---\ntype: session\nsession_number: 6\n"
            "chapter: \"[[Chapter Five]]\"\ndocuments: []\n---\n\n# Session 06\n")
        files = [self._entry(
            "Chapters/Chapter Five/Sessions/Session 06.md", session_text)]
        self.assertIsNone(sc._find_plan(files, "chapter five", 6))


class ThreadSecondTierTests(unittest.TestCase):
    """A rewritten sheet thread matches its Wrap-Up bullet on shared key
    words when the ratio test misses (#537)."""

    def test_the_venn_pair_matches(self):
        self.assertTrue(sc.threads_related(
            "Dr [[Venn]] was drugged in his study; someone knows the "
            "cylinder is loose", "Venn drugged in study (by whom?)"))

    def test_link_plus_two_words_matches(self):
        self.assertTrue(sc.threads_related(
            "[[Cylinder]] taken to the Calcutta warehouse by Roy",
            "Who moved the [[Cylinder]] to the Calcutta warehouse?"))

    def test_unrelated_threads_sharing_a_common_word_do_not(self):
        self.assertFalse(sc.threads_related(
            "Find the missing ledger before the audit",
            "Repay Bram before the winter"))

    def test_same_name_alone_does_not(self):
        self.assertFalse(sc.threads_related(
            "[[Venn]] owes the party a favour",
            "[[Venn]] was seen leaving the quay at night"))

    def test_a_the_link_still_counts_as_a_shared_name(self):
        self.assertTrue(sc.threads_related(
            "[[The Cylinder]] taken to Calcutta warehouse by Roy",
            "Who moved [[Cylinder]] to Calcutta warehouse?"))

    def test_label_words_are_not_key_words(self):
        self.assertFalse(sc.threads_related(
            "Resources: knows major session intent about the lantern",
            "Knows: major session intent resources, and a lantern"))

    def test_threads_help_explains_the_tilde(self):
        done = run_cli(FIXTURE, "--help")
        self.assertIn("~", done.stdout)
        self.assertIn("likely", done.stdout)

    def reworded_vault(self):
        tmp = Path(tempfile.mkdtemp(prefix="thread-tier-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        (tmp / "Ada.md").write_text(
            "---\ntype: pc\n---\n\n## Current Status\n\n**Open threads:**\n"
            "- Dr [[Venn]] was drugged in his study; someone knows the "
            "cylinder is loose\n", encoding="utf-8")
        (tmp / "Wrap.md").write_text(
            "---\ntype: session_wrap\nsession: 3\n---\n\n## GM Notes\n\n"
            "### What Carries Forward\n\n#### Unresolved Threads\n\n"
            "- Venn drugged in study (by whom?)\n", encoding="utf-8")
        return tmp

    def test_report_marks_a_reworded_thread_tentative(self):
        tmp = self.reworded_vault()
        report = sc.thread_report(load_files(tmp), 5, None, tmp)
        self.assertIn("first~3\tlast~3\tage~2", report)
        self.assertNotIn("first=", report)
        self.assertNotIn("no match found", report)
        self.assertIn("~ means a likely match", report.splitlines()[1])

    def test_tentative_match_claims_the_bullet(self):
        # A likely match ages the thread from the line, so the line is
        # not printed again as one on no list (#642).
        tmp = self.reworded_vault()
        report = sc.thread_report(load_files(tmp), 5, None, tmp)
        orphans = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("Venn drugged in study", orphans)

    def test_no_legend_when_nothing_is_tentative(self):
        report = sc.thread_report(
            load_files(FIXTURE), 7, "chapter 4 - calcutta", FIXTURE)
        self.assertNotIn("~", report.splitlines()[1])
        self.assertNotIn("likely match", report)


class ThreadNameTierTests(unittest.TestCase):
    """A thread and a Wrap-Up line that share an entity the vault knows
    (title, alias or first name; linked or bare; possessive) match, even
    worded apart (#718). Pending Consequences count as a Wrap-Up line."""

    def make(self, pc_threads, wrap_body, extra_notes=()):
        tmp = Path(tempfile.mkdtemp(prefix="thread-names-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        (tmp / "Ilsa Marrow.md").write_text(
            "---\ntype: pc\n---\n\n## Current Status\n\n**Open threads:**\n"
            + "".join(f"- {t}\n" for t in pc_threads), encoding="utf-8")
        notes = [("Tam Rowe", "npc", ""),
                 ("Durgan Flintmere", "npc", ""),
                 ("Widow's Stair", "location", ""),
                 ("Lamp of Ash", "item", "aliases: [The Whole Lamp]"),
                 ("Cart", "item", "")] + list(extra_notes)
        for name, typ, extra in notes:
            (tmp / f"{name}.md").write_text(
                f"---\ntype: {typ}\n{extra}\n---\n\n# {name}\n",
                encoding="utf-8")
        (tmp / "Wrap.md").write_text(
            "---\ntype: session_wrap\nsession: 1\n---\n\n## GM Notes\n\n"
            "### What Carries Forward\n\n" + wrap_body, encoding="utf-8")
        return tmp

    def line(self, tmp, thread_start):
        report = sc.thread_report(load_files(tmp), 2, None, tmp)
        return next(ln for ln in report.splitlines()
                    if ln.startswith(thread_start))

    def test_linked_bold_entry_matches_a_wants_to_find_thread(self):
        tmp = self.make(
            ["Wants to find Tam Rowe before the thaw"],
            "#### Unresolved Threads\n\n"
            "- **The road south is shut.** ([[Tam Rowe]], [[Ilsa Marrow]])\n")
        self.assertIn("first~1", self.line(tmp, "Wants to find Tam"))
        self.assertNotIn("no match", self.line(tmp, "Wants to find Tam"))

    def test_possessive_first_name_matches_a_pending_consequence(self):
        tmp = self.make(
            ["Wants to find Durgan Flintmere and see the rest of the "
             "carving"],
            "#### Unresolved Threads\n\n- Nothing relevant here\n\n"
            "#### Pending Consequences\n\n- **Durgan's tower** is watched\n")
        self.assertIn("first~1", self.line(tmp, "Wants to find Durgan"))

    def test_alias_matches_in_bare_text(self):
        tmp = self.make(
            ["Who forged the lamp of ash, and why?"],
            "#### Unresolved Threads\n\n- The whole lamp is still lit\n")
        self.assertIn("first~1", self.line(tmp, "Who forged"))

    def test_shared_place_matches_across_wording(self):
        tmp = self.make(
            ["How did the cook mend the boy, and how does he know the "
             "Widow's Stair?"],
            "#### Unresolved Threads\n\n"
            "- **The cook's luck.** He named the fork on the Widow's "
            "Stair\n")
        self.assertIn("first~1", self.line(tmp, "How did the cook"))

    def test_a_pc_name_alone_does_not_match(self):
        tmp = self.make(
            ["Ilsa Marrow owes the ferryman a debt"],
            "#### Unresolved Threads\n\n"
            "- **Ilsa Marrow** slept badly\n")
        self.assertIn("no match found in a wrap-up",
                      self.line(tmp, "Ilsa Marrow owes"))

    def test_common_words_are_not_entities(self):
        tmp = self.make(
            ["Find a way to mend the broken lock"],
            "#### Unresolved Threads\n\n- The cart is a way out\n")
        self.assertIn("no match found in a wrap-up",
                      self.line(tmp, "Find a way"))

    def test_a_first_name_two_notes_share_is_not_a_match(self):
        tmp = self.make(
            ["Wants to find Tam Rowe"],
            "#### Unresolved Threads\n\n- **Tam the ferryman** waits\n",
            extra_notes=[("Tam Orrin", "npc", "")])
        self.assertIn("no match found in a wrap-up",
                      self.line(tmp, "Wants to find Tam"))

    def test_a_name_match_does_not_claim_the_bullet(self):
        # The name tier is tentative: the line still shows as on no list.
        tmp = self.make(
            ["Wants to find Tam Rowe before the thaw"],
            "#### Unresolved Threads\n\n"
            "- **The road south is shut.** ([[Tam Rowe]])\n")
        report = sc.thread_report(load_files(tmp), 2, None, tmp)
        self.assertIn("first~1", self.line(tmp, "Wants to find Tam"))
        orphans = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertIn("road south", orphans)

    def test_single_words_and_given_names_keep_their_case(self):
        tmp = self.make(
            ["Find who set the old well alight",
             "Put things in order before the thaw",
             "Ask the captain about wages"],
            "#### Unresolved Threads\n\n"
            "- The old man in the tavern knows a secret\n"
            "- Everything must be put in order, says the Mayor\n"
            "- The captain of the guard is bribed\n",
            extra_notes=[("The Old Mill", "location", ""),
                         ("Order of the Veil", "faction", ""),
                         ("Captain Reyes", "npc", "")])
        for start in ("Find who set", "Put things", "Ask the captain"):
            self.assertIn("no match found", self.line(tmp, start))

    def test_a_capitalised_given_name_still_matches(self):
        tmp = self.make(
            ["Ask Reyes about wages"],
            "#### Unresolved Threads\n\n- Reyes's pay is late\n",
            extra_notes=[("Captain Reyes", "npc", "")])
        self.assertIn("first~1", self.line(tmp, "Ask Reyes"))

    def test_a_given_name_comes_only_from_npc_titles(self):
        tmp = self.make(
            ["Search Veil country for the tower"],
            "#### Unresolved Threads\n\n- The Veil is thin tonight\n",
            extra_notes=[("Veil Ridge", "location", "")])
        self.assertIn("no match found", self.line(tmp, "Search Veil"))

    def test_an_entity_in_every_wrapup_is_no_evidence(self):
        tmp = self.make(
            ["Wants to find Tam Rowe before the thaw"],
            "#### Unresolved Threads\n\n- **Tam Rowe** is gone\n")
        for n in (2, 3):
            (tmp / f"Wrap{n}.md").write_text(
                f"---\ntype: session_wrap\nsession: {n}\n---\n\n"
                "## GM Notes\n\n### What Carries Forward\n\n"
                "#### Unresolved Threads\n\n- [[Tam Rowe]] again\n",
                encoding="utf-8")
        report = sc.thread_report(load_files(tmp), 4, None, tmp)
        line = next(ln for ln in report.splitlines()
                    if ln.startswith("Wants to find Tam"))
        self.assertIn("no match found", line)
        orphans = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertIn("Tam Rowe", orphans)

    def test_an_entity_in_two_wrapups_still_counts(self):
        tmp = self.make(
            ["Wants to find Tam Rowe before the thaw"],
            "#### Unresolved Threads\n\n- **Tam Rowe** is gone\n")
        (tmp / "Wrap2.md").write_text(
            "---\ntype: session_wrap\nsession: 2\n---\n\n## GM Notes\n\n"
            "### What Carries Forward\n\n#### Unresolved Threads\n\n"
            "- [[Tam Rowe]] again\n", encoding="utf-8")
        report = sc.thread_report(load_files(tmp), 4, None, tmp)
        self.assertIn("first~1", next(
            ln for ln in report.splitlines()
            if ln.startswith("Wants to find Tam")))

    def test_mentions_is_asked_once_per_text(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n")
        idx = sc.NameIndex(load_files(tmp))
        first = idx.mentions("Tam Rowe is here")
        self.assertIs(idx.mentions("Tam Rowe is here"), first)

    def test_a_link_written_with_md_names_its_note(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n")
        idx = sc.NameIndex(load_files(tmp))
        self.assertEqual(idx.mentions("took [[cart.md|it]] south"), {"Cart.md"})
        self.assertEqual(idx.mentions("took [[cart|it]] south"), {"Cart.md"})

    def test_a_full_name_two_notes_share_names_neither_by_its_words(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n",
                        extra_notes=[("Old Hand", "npc", "aliases: [Tam Rowe]")])
        idx = sc.NameIndex(load_files(tmp))
        self.assertEqual(idx.mentions("[[Tam Rowe]] left"), set())
        self.assertEqual(idx.mentions("Tam Rowe left"), set())

    def test_a_title_ending_in_s_matches_whole(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n",
                        extra_notes=[("St James's", "location", "")])
        idx = sc.NameIndex(load_files(tmp))
        self.assertEqual(idx.mentions("Meet at St James's tonight"), {"St James's.md"})
        # An ordinary possessive still names its note.
        self.assertEqual(idx.mentions("Durgan Flintmere's cart"), {"Durgan Flintmere.md"})

    def test_a_place_phrase_no_note_carries_matches(self):
        # #733: Snowbound's Gilt thread shares only a PC's name and a place
        # described inside another note.
        tmp = self.make(
            ["How did a cloth merchant heal Brannoc, and how does he know the Pale Road?"],
            "#### Unresolved Threads\n\n- **Gilt's \"luck\".** Gilt healed Brannoc "
            "with a murmured prayer; he named the left fork on the Pale Road.\n")
        self.assertIn("first~1", self.line(tmp, "How did a cloth merchant"))

    def test_a_pc_name_or_one_capitalised_word_is_no_phrase(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n")
        idx = sc.NameIndex(load_files(tmp))
        self.assertEqual(idx.mentions("Ilsa Marrow crossed the Bridge."), set())
        self.assertEqual(idx.mentions("The Ferry is late."), set())
        self.assertEqual(idx.mentions("Down the Pale Road's end"), {"phrase:pale road"})

    def test_a_given_name_in_someone_elses_full_name_is_not_the_npc(self):
        # #734: "Dorothea" of Miss Dorothea Bexley is not Dorothea de Courlande.
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n",
                        extra_notes=[("Miss_Dorothea_Bexley", "npc", "")])
        idx = sc.NameIndex(load_files(tmp))
        her = "Miss_Dorothea_Bexley.md"
        # (Another person's full name may still be a shared phrase, #733.)
        self.assertNotIn(her, idx.mentions("an introduction to Dorothea de Courlande"))
        self.assertNotIn(her, idx.mentions("Dorothea Courlande signed"))
        self.assertIn(her, idx.mentions("Dorothea Bexley wrote"))
        self.assertEqual(idx.mentions("Dorothea wrote back"), {her})
        self.assertEqual(idx.mentions("Dorothea's letter came"), {her})

    def test_phrases_survive_a_sentence_start_and_skip_pc_names(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n")
        idx = sc.NameIndex(load_files(tmp))
        road = "phrase:pale road"
        self.assertIn(road, idx.mentions("Visit Pale Road before dusk"))
        self.assertIn(road, idx.mentions("The Pale Road is flooded"))
        # A PC's name (whole or given) builds no phrase.
        self.assertEqual(idx.mentions("Ask Ilsa Marrow about the debt"), set())
        self.assertEqual(idx.mentions("Ask Ilsa about the debt"), set())
        # Capitals outside A-Z count.
        self.assertIn("phrase:ébène noire", idx.mentions("Meet at Ébène Noire"))

    def test_particles_and_accented_names_mark_another_person(self):
        tmp = self.make(["x"], "#### Unresolved Threads\n\n- a\n",
                        extra_notes=[("Miss_Dorothea_Bexley", "npc", "")])
        idx = sc.NameIndex(load_files(tmp))
        her = "Miss_Dorothea_Bexley.md"
        self.assertNotIn(her, idx.mentions("Dorothea van der Courlande signed"))
        self.assertNotIn(her, idx.mentions("Dorothea Évrard signed"))
        self.assertIn(her, idx.mentions("Dorothea, again"))

    def test_a_decomposed_file_name_matches_composed_text(self):
        import unicodedata
        tmp = self.make(
            ["Wants to find Éloïse about the deed"],
            "#### Unresolved Threads\n\n- Éloïse is gone\n",
            extra_notes=[(unicodedata.normalize("NFD", "Éloïse Durand"),
                          "npc", "")])
        self.assertIn("first~1", self.line(tmp, "Wants to find Élo"))


class ThreadReportTests(unittest.TestCase):
    """`thread_report(files, current, chapter, vault)` and `--threads`."""

    @classmethod
    def setUpClass(cls):
        cls.files = load_files(FIXTURE)

    def test_threads_ages(self):
        report = sc.thread_report(self.files, 7, "chapter 4 - calcutta", FIXTURE)
        self.assertTrue(report.startswith("===== Threads ====="))
        self.assertIn("--- Hero ---", report)
        self.assertIn(
            "Find the missing ledger\tfirst=7\tlast=7\tage=0\t", report)
        self.assertIn(
            "Repay Bram\tfirst=?\tlast=?\tage=?\t"
            "(no match found in a wrap-up — check it is still live)", report)

    def test_threads_orphans(self):
        report = sc.thread_report(self.files, 7, "chapter 4 - calcutta", FIXTURE)
        self.assertIn("--- Wrap-up threads not on any thread list ---", report)
        self.assertIn("session 5\tThe ledger is still missing", report)
        # "Find the missing ledger" matched a PC thread, so it must NOT
        # also show up as an orphan.
        orphan_section = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("Find the missing ledger", orphan_section)

    def test_threads_stale_flag(self):
        tmp = Path(tempfile.mkdtemp(prefix="session-context-stale-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(FIXTURE, tmp, dirs_exist_ok=True)
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8").replace("session: 7", "session: 4"),
            encoding="utf-8")
        files = load_files(tmp)
        report = sc.thread_report(files, 7, "chapter 4 - calcutta", tmp)
        self.assertIn(
            "Find the missing ledger\tfirst=4\tlast=4\tage=3\tSTALE", report)

    def aged_copy(self, settings_yaml):
        tmp = Path(tempfile.mkdtemp(prefix="session-context-setting-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(FIXTURE, tmp, dirs_exist_ok=True)
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8").replace("session: 7", "session: 4"),
            encoding="utf-8")
        (tmp / "_meta" / "vault-config.md").unlink(missing_ok=True)
        (tmp / "_meta").mkdir(exist_ok=True)
        (tmp / "_meta" / "vault-config.yaml").write_text(
            "version: 1\n" + settings_yaml, encoding="utf-8")
        return tmp

    def test_threads_stale_after_comes_from_the_setting(self):
        ledger = "Find the missing ledger\tfirst=4\tlast=4\tage=3\t"
        tmp = self.aged_copy("vault:\n  stale_after_sessions: 4\n")
        report = sc.thread_report(load_files(tmp), 7, "chapter 4 - calcutta", tmp)
        self.assertIn(ledger + "\n", report + "\n")
        tmp = self.aged_copy("vault:\n  stale_after_sessions: 2\n")
        report = sc.thread_report(load_files(tmp), 7, "chapter 4 - calcutta", tmp)
        self.assertIn(ledger + "STALE", report)

    def shared_copy(self, open_threads):
        """A copy of the fixture whose Overview carries `## Open Threads`."""
        tmp = Path(tempfile.mkdtemp(prefix="session-context-shared-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(FIXTURE, tmp, dirs_exist_ok=True)
        overview = tmp / "Overview.md"
        overview.write_text(
            overview.read_text(encoding="utf-8")
            + "\n## Open Threads\n\n" + open_threads + "\n",
            encoding="utf-8")
        return tmp

    def report(self, vault):
        return sc.thread_report(load_files(vault), 7,
                                "chapter 4 - calcutta", vault)

    def test_no_overview_section_reads_as_before(self):
        self.assertEqual(self.report(FIXTURE), (
            "===== Threads =====\n"
            "--- Hero ---\n"
            "Find the missing ledger\tfirst=7\tlast=7\tage=0\t\n"
            "Repay Bram\tfirst=?\tlast=?\tage=?\t"
            "(no match found in a wrap-up — check it is still live)\n"
            "--- Dormant (Campaign Overview) ---\n"
            "(none)\n"
            "--- Wrap-up threads not on any thread list ---\n"
            "session 5\tThe ledger is still missing"))

    def test_wrapped_thread_prints_whole_and_closes_by_that_text(self):
        import io
        from unittest import mock
        import vault_write as vw
        tmp = self.shared_copy("")
        hero = tmp / "Characters" / "PCs" / "Hero.md"
        hero.write_text(hero.read_text(encoding="utf-8").replace(
            "- Repay Bram",
            "- Repay Bram\n  the forty rupees\n  - before the monsoon\n"
            "<!-- gm-only -->\n- Secret debt\n<!-- /gm-only -->"),
            encoding="utf-8")
        report = self.report(tmp)
        whole = "Repay Bram the forty rupees; before the monsoon"
        self.assertIn(f"\n{whole}\tfirst=", report)
        self.assertIn("\nSecret debt (hidden)\tfirst=", report)
        self.assertNotIn("\nbefore the monsoon", report)
        wrap = ("Chapters/Chapter 4 - Calcutta/Sessions/"
                "Chapter_04_Session_07_Wrap_Up.md")
        out = io.StringIO()
        with mock.patch("sys.stdout", out), \
                mock.patch("sys.stderr", io.StringIO()):
            code = vw.main([str(tmp), "threads", "--wrapup", wrap, "--write"],
                           stdin=f"close\tHero\t{whole}\tpaid\n")
        self.assertEqual(code, 0, out.getvalue())
        self.assertNotIn("forty rupees", hero.read_text(encoding="utf-8"))
        self.assertIn(f"- {whole} — closed: paid (Hero)",
                      (tmp / wrap).read_text(encoding="utf-8"))

    def test_shared_list_prints_first_with_involves(self):
        tmp = self.shared_copy(
            "- Find the missing ledger — since Session 5; involves the party\n"
            "- The harbour toll — since Session 3; involves [[Hero]], [[Bram]]")
        report = self.report(tmp)
        lines = report.split("\n")
        self.assertEqual(lines[0], "===== Threads =====")
        self.assertEqual(lines[1], "--- Shared (Campaign Overview) ---")
        self.assertEqual(
            lines[2], "Find the missing ledger\tfirst=7\tlast=7\tage=0\t"
            "\tinvolves: the party")
        self.assertEqual(
            lines[3], "The harbour toll\tfirst=?\tlast=?\tage=?\t"
            "(no match found in a wrap-up — check it is still live)"
            "\tinvolves: Hero, Bram")
        self.assertLess(lines.index("--- Shared (Campaign Overview) ---"),
                        lines.index("--- Hero ---"))

    def test_pc_copy_of_shared_thread_prints_once(self):
        tmp = self.shared_copy(
            "- Repay Bram — since Session 3; involves [[Hero]]")
        report = self.report(tmp)
        self.assertEqual(report.count("Repay Bram\t"), 1)
        shared_part, pc_part = report.split("--- Hero ---")
        self.assertIn("Repay Bram\t", shared_part)
        self.assertIn("Find the missing ledger\t", pc_part)

    def test_pc_copy_of_a_shared_thread_naming_others_prints(self):
        # The shared entry names another PC: the Hero's copy is his own.
        tmp = self.shared_copy(
            "- Repay Bram — since Session 3; involves [[Bram]]")
        pc_part = self.report(tmp).split("--- Hero ---")[1]
        self.assertIn("\nRepay Bram\tfirst=", pc_part)
        for who in ("[[Hero]]", "[[hero|H]]", "[[Hero.md|H]]",
                    "[[Characters/PCs/Hero]]", "the party"):
            with self.subTest(who=who):
                tmp = self.shared_copy(f"- Repay Bram — involves {who}")
                pc_part = self.report(tmp).split("--- Hero ---")[1]
                self.assertNotIn("Repay Bram", pc_part)

    def test_orphan_on_shared_list_is_not_an_orphan(self):
        tmp = self.shared_copy(
            "- The ledger is still missing — since Session 5; "
            "involves the party")
        report = self.report(tmp)
        orphans = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("The ledger is still missing", orphans)
        self.assertIn(
            "The ledger is still missing\tfirst=5\tlast=5\tage=2\t",
            report)

    def test_a_closed_thread_is_not_an_orphan(self):
        tmp = self.shared_copy("")
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8")
            + "\n#### Resolved Threads\n\n- The ledger is still missing "
              "\u2014 closed: found in the dredger (shared)\n",
            encoding="utf-8")
        orphans = self.report(tmp).split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("The ledger is still missing", orphans)
        self.assertEqual(orphans.strip(), "(none)")

    def test_a_wrapped_closed_thread_is_not_an_orphan(self):
        # A Resolved bullet that wraps before its `— closed:` tail is read
        # whole.
        tmp = self.shared_copy("")
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8")
            + "\n#### Resolved Threads\n\n- The ledger is still\n  missing "
              "\u2014 closed: found in the dredger (shared)\n",
            encoding="utf-8")
        orphans = self.report(tmp).split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertEqual(orphans.strip(), "(none)")

    def test_a_thread_raised_after_its_close_is_open_again(self):
        # Closed in session 5, unresolved again in session 7: the closure
        # claims session 5's bullet, not the later one.
        tmp = self.shared_copy("")
        sessions = tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
        five = sessions / "Chapter_04_Session_05_Wrap_Up.md"
        five.write_text(
            five.read_text(encoding="utf-8")
            + "\n#### Resolved Threads\n\n- The ledger is still missing "
              "\u2014 closed: found (shared)\n", encoding="utf-8")
        seven = sessions / "Chapter_04_Session_07_Wrap_Up.md"
        seven.write_text(seven.read_text(encoding="utf-8").replace(
            "- Find the missing ledger\n",
            "- Find the missing ledger\n- The ledger is still missing\n"),
            encoding="utf-8")
        orphans = self.report(tmp).split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertIn("session 7\tThe ledger is still missing", orphans)
        self.assertNotIn("session 5\t", orphans)

    def test_an_archived_overview_is_not_read(self):
        tmp = self.shared_copy("- Repay Bram — involves [[Hero]]")
        (tmp / "_campaign").mkdir()
        (tmp / "Overview.md").rename(tmp / "_campaign" / "Overview.md")
        (tmp / "_archive").mkdir()
        (tmp / "_archive" / "Overview.md").write_text(
            "---\ntype: campaign_overview\n---\n\n## Open Threads\n\n"
            "- An old thread — involves the party\n", encoding="utf-8")
        report = self.report(tmp)
        self.assertIn("\nRepay Bram\tfirst=", report)
        self.assertNotIn("An old thread", report)

    def test_a_closed_thread_claims_a_close_bullet(self):
        # "found" and "still missing" match closely: the Resolved line
        # claims the earlier bullet as a live thread would (the GM closed
        # it at Reconcile, so it is not left over for them again).
        tmp = self.shared_copy("")
        wrap = (tmp / "Chapters" / "Chapter 4 - Calcutta" / "Sessions"
                / "Chapter_04_Session_07_Wrap_Up.md")
        wrap.write_text(
            wrap.read_text(encoding="utf-8")
            + "\n#### Resolved Threads\n\n- The ledger is found "
              "\u2014 closed: in the dredger (shared)\n",
            encoding="utf-8")
        orphans = self.report(tmp).split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("The ledger is still missing", orphans)

    def test_a_hidden_shared_thread_is_marked(self):
        tmp = self.shared_copy("<!-- gm-only -->\n- Repay Bram — involves "
                               "[[Hero]]\n<!-- /gm-only -->")
        report = self.report(tmp)
        self.assertIn("\nRepay Bram (hidden)\tfirst=", report)
        # It shares nothing with players: the PC's own copy still prints.
        self.assertIn("\nRepay Bram\tfirst=", report.split("--- Hero ---")[1])

    def test_shared_bullet_with_no_tail_names_nobody(self):
        tmp = self.shared_copy("- A loose end with no tail")
        self.assertIn("A loose end with no tail\tfirst=?\tlast=?\tage=?\t"
                      "(no match found in a wrap-up \u2014 check it is still live)"
                      "\tinvolves: (none named)", self.report(tmp))

    def test_only_shared_threads_say_so_under_the_pc(self):
        tmp = self.shared_copy(
            "- Find the missing ledger — involves [[Hero]]\n"
            "- Repay Bram — involves [[Hero]]")
        report = self.report(tmp)
        self.assertIn("--- Hero ---\n(only threads held in the shared list, "
                      "above)", report)

    def test_shared_threads_fixture_is_readable(self):
        vault = ROOT / "tests" / "fixtures" / "shared-threads"
        wrap_ups = sc.wrap_up_threads(load_files(vault), None)
        self.assertEqual([n for n, _u, _c in wrap_ups], [3])
        overview = (vault / "Campaign Overview.md").read_text(encoding="utf-8")
        ledger = sc.shared_threads(overview)[0].text
        hits, mark = sc.match_sessions(ledger, wrap_ups)
        self.assertEqual(hits, [3])

    def test_a_wrap_up_with_no_readable_session_is_named_not_dropped_silently(self):
        import contextlib
        import io
        from vaultlib import extract_frontmatter
        good = ("---\ntype: session-wrapup\nsession: \"[[Session 06 - A Title, "
                "With A Comma]]\"\n---\n#### Unresolved Threads\n- a\n")
        bad = ("---\ntype: session-wrapup\nsession: \"Soon\"\n---\n"
               "#### Unresolved Threads\n- b\n")
        files = [(r, t, extract_frontmatter(t)) for r, t in
                 (("Sessions/S06 Wrap-Up.md", good),
                  ("Sessions/Odd Wrap-Up.md", bad))]
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            wrap_ups = sc.wrap_up_threads(files, None)
        self.assertEqual([n for n, _u, _c in wrap_ups], [6])
        self.assertIn("Sessions/Odd Wrap-Up.md", err.getvalue())
        self.assertNotIn("S06", err.getvalue())

    def test_the_default_bundle_names_a_wrap_up_it_cannot_match(self):
        import contextlib
        import io
        from vaultlib import extract_frontmatter
        bad = ("---\ntype: session-wrapup\nsession: \"Soon\"\n---\nx\n")
        files = [("Sessions/Odd Wrap-Up.md", bad, extract_frontmatter(bad))]
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertIsNone(sc._latest_wrapup(files, 6, None))
        self.assertIn("Sessions/Odd Wrap-Up.md", err.getvalue())

    def test_match_sessions_returns_sessions_and_mark(self):
        wrap_ups = sc.wrap_up_threads(load_files(FIXTURE),
                                      "chapter 4 - calcutta")
        self.assertEqual(
            sc.match_sessions("Find the missing ledger", wrap_ups),
            ([7], "="))
        self.assertEqual(sc.match_sessions("Zzz qqq", wrap_ups), ([], ""))

    def test_a_deceased_pc_is_not_in_the_active_pcs(self):
        tmp = self.aged_copy("")
        hero = tmp / "Characters" / "PCs" / "Hero.md"
        text = hero.read_text(encoding="utf-8")
        hero.write_text(text.replace("status: active", "status: ' Deceased '"),
                        encoding="utf-8")
        active = run_cli(tmp).stdout.split("===== Active PCs =====", 1)[1]
        self.assertNotIn("--- Hero (", active.split("=====", 1)[0])

    def test_a_broken_settings_file_is_a_plain_error_not_a_traceback(self):
        tmp = self.aged_copy("vault: [unclosed\n")
        for args in ([], ["--threads"], ["--arcs"]):
            result = run_cli(tmp, *args)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertTrue(result.stderr.startswith(
                "error: could not read the vault's settings: "
                "_meta/vault-config.yaml is not valid YAML"), result.stderr)

    def test_threads_cli(self):
        result = run_cli(FIXTURE, "--threads", "--session", "7")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("===== Session Context =====", result.stdout)
        self.assertIn("===== Threads =====", result.stdout)
        self.assertNotIn("Wrap-Up —", result.stdout)
        self.assertNotIn("Active PCs", result.stdout)
        self.assertNotIn("===== Campaign Overview", result.stdout)


if __name__ == "__main__":
    unittest.main()


class PointerKeyPeriodTests(unittest.TestCase):
    """A bare pointer keeps its periods: `[[Dr. Venn's Study]]` is not `Dr`."""

    def test_bare_name_with_a_period_points_at_its_note(self):
        pointed = {sc.pointer_key("Dr. Venn's Study")}
        self.assertTrue(sc.is_pointed_at("Scenes/Dr. Venn's Study.md", pointed))
        self.assertFalse(sc.is_pointed_at("Scenes/Dr.md", pointed))

    def test_a_written_md_suffix_is_still_dropped(self):
        self.assertEqual(sc.pointer_key("The Ball.md"), sc.pointer_key("The Ball"))


class HouseRulesTests(unittest.TestCase):
    def vault(self, rules):
        tmp = Path(tempfile.mkdtemp(prefix="sc-play-hr-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        vault = tmp / "v"
        shutil.copytree(FIXTURE, vault)
        if rules is not None:
            with (vault / "Overview.md").open("a", encoding="utf-8") as f:
                f.write(rules)
        return vault

    def test_play_prints_the_section(self):
        out = run_cli(self.vault(
            "\n## House Rules\n\n- Anyone on time gets a bankable +1 token.\n"
            "- Criticals on a 5 or under.\n"), "--play").stdout
        self.assertIn("## House Rules\n- Anyone on time gets a bankable +1 "
                      "token.\n- Criticals on a 5 or under.", out)

    def test_play_prints_nothing_without_rules(self):
        self.assertNotIn("House Rules", run_cli(self.vault(None), "--play").stdout)
        self.assertNotIn("House Rules", run_cli(
            self.vault("\n## House Rules\n\n"), "--play").stdout)

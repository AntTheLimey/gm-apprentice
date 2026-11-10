#!/usr/bin/env python3
"""session_context.py --prep: a prep run's opening read in one call (#493).

Each part is the named script's own output; these tests check the parts
are there, in order, and that the plans index is checked against the
names the Wrap-Up links.
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

SCRIPT = SCRIPTS / "session_context.py"
CHAPTER = "Chapters/Chapter 1 - Harbour"
SESSIONS = f"{CHAPTER}/Sessions"

WRAP = """---
type: session-wrapup
session: "[[Session 01 - Landfall]]"
session_number: 1
chapter: "[[Chapter 1 - Harbour]]"
---

# Session 1

## Narrative Recap

They met [[Ma Barker]] on [[The_Docks]] and read the [[Ledger]].

<!-- gm-only -->

## GM Notes

### Handoff to session-prep
- Open at the docks.

<!-- /gm-only -->
"""


def note(fm: str, body: str = "Body.\n") -> str:
    return f"---\n{fm}\n---\n\n{body}"


FILES = {
    f"{CHAPTER}/Chapter 1 - Harbour.md": note("type: chapter"),
    f"{SESSIONS}/Session 01 - Landfall.md": note(
        'type: session\nsession_number: 1\n'
        'chapter: "[[Chapter 1 - Harbour]]"\nstatus: wrap-up\n'
        'play_date: "2026-10-01"'),
    f"{SESSIONS}/Session 01 - Landfall - Wrap-Up.md": WRAP,
    f"{CHAPTER}/Scenes/The Quay at Dawn.md": note(
        'type: scene\nchapter: "[[Chapter 1 - Harbour]]"\nstatus: planned'),
    f"{CHAPTER}/Planning/Barker Moves.md": note(
        'type: plan\nplan_type: adventure\n'
        'chapter: "[[Chapter 1 - Harbour]]"\n'
        'participants: ["[[Ma Barker]]"]'),
    "NPCs/Ma Barker.md": note("type: npc"),
    "Locations/The_Docks.md": note("type: location"),
    "Items/Ledger.md": note("type: item"),
}


def make_vault(case: unittest.TestCase, files: dict[str, str]) -> Path:
    vault = Path(tempfile.mkdtemp(prefix="sc-prep-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def run_cli(vault: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), str(vault), *args],
                          capture_output=True, text=True, timeout=60)


class PrepTests(unittest.TestCase):
    def setUp(self) -> None:
        self.vault = make_vault(self, FILES)

    def test_every_part_in_order(self) -> None:
        done = run_cli(self.vault, "--prep")
        self.assertEqual(done.returncode, 0, done.stderr)
        heads = ["===== Version =====", "===== Session Context =====",
                 "===== Wrap-Up — Session 1 =====", "===== Reconcile Scan",
                 "===== Threads", "===== PC Arcs", "===== Scene Queue",
                 "===== Narrative Plans"]
        at = [done.stdout.find(h) for h in heads]
        self.assertNotIn(-1, at, done.stdout)
        self.assertEqual(at, sorted(at), done.stdout)

    def test_the_bundle_is_the_brief_one(self) -> None:
        out = run_cli(self.vault, "--prep").stdout
        self.assertIn("(brief:", out)

    def test_reconcile_scan_runs_on_a_wrap_up_status(self) -> None:
        out = run_cli(self.vault, "--prep").stdout
        self.assertIn("wrap-up: " + f"{SESSIONS}/Session 01 - Landfall - "
                      "Wrap-Up.md", out)

    def test_reconcile_scan_skipped_once_reviewed(self) -> None:
        index = self.vault / SESSIONS / "Session 01 - Landfall.md"
        index.write_text(index.read_text().replace("status: wrap-up",
                                                   "status: reviewed"))
        out = run_cli(self.vault, "--prep").stdout
        self.assertIn("(not run: the session's status is reviewed", out)

    def test_scene_queue_is_the_chapter_s(self) -> None:
        out = run_cli(self.vault, "--prep").stdout
        queue = out.split("===== Scene Queue =====", 1)[1]
        self.assertIn("[[The Quay at Dawn]]", queue)

    def test_plans_checked_against_the_wrap_up_s_people_and_places(
            self) -> None:
        out = run_cli(self.vault, "--prep").stdout
        self.assertIn("against: Ma Barker, The_Docks", out)
        self.assertIn("Barker Moves", out.split("===== Overlap", 1)[1])

    def test_brief_and_prep_together_are_refused(self) -> None:
        done = run_cli(self.vault, "--prep", "--brief")
        self.assertEqual(done.returncode, 2)


class RatioMatchTests(unittest.TestCase):
    def test_shortcuts_never_change_the_answer(self):
        import random
        from difflib import SequenceMatcher
        rng = random.Random(0)
        words = ("lamp ferry ledger toll ford bridge salt caravan harbour "
                 "quay rope winch tide gull net crate barrel").split()

        def sentence() -> str:
            return " ".join(rng.choice(words)
                            for _ in range(rng.randint(1, 30)))

        pairs = []
        for _ in range(150):
            a = sentence()
            pairs.append((a, sentence()))
            b = a.split()
            for _ in range(rng.randint(0, 3)):
                if b:
                    b[rng.randrange(len(b))] = rng.choice(words)
            pairs.append((a, " ".join(b)))
        matches = 0
        for a, b in pairs:
            want = SequenceMatcher(None, a, sc._norm_thread(b)).ratio() >= 0.6
            matches += want
            self.assertEqual(sc._ratio_match(a, b), want, (a, b))
        self.assertTrue(0 < matches < len(pairs))

    def test_a_pair_that_cannot_match_skips_the_slow_ratio(self):
        from unittest import mock
        with mock.patch.object(sc.SequenceMatcher, "ratio",
                               side_effect=AssertionError("slow ratio")):
            self.assertFalse(sc._ratio_match("a", "zzzzzzzzzzzzzzzzzzzz"))
            self.assertFalse(sc._ratio_match("abcdef", "uvwxyz"))


class WrapupNamesTests(unittest.TestCase):
    def test_people_places_and_factions_only_once_each(self) -> None:
        files = [("NPCs/Ma Barker.md", "", {"type": "npc"}),
                 ("Locations/The_Docks.md", "", {"type": "location"}),
                 ("Factions/Tide Men.md", "", {"type": "faction"}),
                 ("Items/Ledger.md", "", {"type": "item"})]
        text = ("[[Ma Barker|Ma]] at [[The Docks]], [[Ledger]], "
                "[[Tide Men#Rules]], [[Ma Barker]], [[Nobody]]")
        self.assertEqual(sc.wrapup_names(files, text),
                         ["Ma Barker", "The Docks", "Tide Men"])


class UnlistedWrapupThreadsTests(unittest.TestCase):
    def wrap(self, n: int, bullet: str) -> tuple[str, str]:
        return (f"{SESSIONS}/Session 0{n} - Wrap-Up.md", note(
            f'type: session-wrapup\nsession: "[[Session 0{n} - X]]"\n'
            f'session_number: {n}\nchapter: "[[Chapter 1 - Harbour]]"',
            "## GM Notes\n\n### What Carries Forward\n\n"
            f"#### Unresolved Threads\n\n- {bullet}\n"))

    def test_dormant_entry_claims_the_same_words_at_any_session(self) -> None:
        bell = "**The cracked bell** \u2014 the sexton heard it ring."
        near = "**The cracked bell** \u2014 someone saw a gull on it."
        files = dict([self.wrap(1, bell), self.wrap(2, near),
                      self.wrap(3, bell)])
        files["Campaign Overview.md"] = note(
            "type: campaign_overview",
            "## Open Threads\n\n## Dormant Threads\n\n"
            f"- {bell} \u2014 since Session 1; dormant since Session 2 "
            "(quiet); involves the party\n\n## Key Factions\n")
        vault = make_vault(self, files)
        left = sc.unlisted_wrapup_threads(
            list(sc.vault_files(vault)), None, vault)
        # The near line has the parked lead: the same thread, reworded.
        self.assertEqual(left, [])

    LEDGER = "**The missing ledger** — the toll keeper still wants it."
    # The list's wording, not the Wrap-Up's: a close or likely match.
    LISTED = ("**The missing ledger** — Harrow Ford's toll keeper wants "
              "it back")
    CHAPTER = "chapter 1 - harbour"

    def left(self, files: dict[str, str],
             chapter: str | None = CHAPTER) -> list[tuple[int, str]]:
        vault = make_vault(self, files)
        return sc.unlisted_wrapup_threads(list(sc.vault_files(vault)),
                                          chapter, vault)

    def test_a_dormant_entry_worded_differently_claims_at_any_session(
            self) -> None:
        files = dict([self.wrap(3, self.LEDGER), self.wrap(5, self.LEDGER)])
        files["Campaign Overview.md"] = note(
            "type: campaign_overview",
            "## Dormant Threads\n\n"
            f"- {self.LISTED} — since Session 3; dormant since Session 4 "
            "(left the ford); involves the party\n")
        self.assertEqual(self.left(files), [])

    def test_a_resolved_line_worded_differently_claims_up_to_its_close(
            self) -> None:
        resolved = ("\n#### Resolved Threads\n\n"
                    f"- {self.LISTED} — closed: returned (shared)\n")
        files = dict([self.wrap(3, self.LEDGER), self.wrap(5, self.LEDGER)])
        rel, text = self.wrap(4, "**Another matter** — the gull.")
        files[rel] = text + resolved
        # Closed in session 4: the session 3 line is done; raised again in
        # session 5, it is open again.
        self.assertEqual(self.left(files), [(4, "**Another matter** — "
                                                "the gull."),
                                            (5, self.LEDGER)])
        # With no chapter in scope any closure claims it.
        self.assertEqual(self.left(files, None),
                         [(4, "**Another matter** — the gull.")])

    def test_every_wording_of_a_parked_lead_is_claimed(self) -> None:
        old = "**Bell** — the sexton heard it ring at noon."
        new = "**Bell** — a gull nests in the belfry now."
        files = dict([self.wrap(3, old), self.wrap(4, new)])
        files["Campaign Overview.md"] = note(
            "type: campaign_overview",
            "## Dormant Threads\n\n"
            f"- {new} — since Session 3; dormant since Session 4 "
            "(left it); involves the party\n")
        self.assertEqual(self.left(files), [])
        files.pop("Campaign Overview.md")
        rel, text = self.wrap(4, new)
        files[rel] = text + ("\n#### Resolved Threads\n\n"
                             f"- {new} — closed: melted (Session 4)\n")
        self.assertEqual(self.left(files), [])

    def test_a_shared_thread_in_player_words_claims_by_its_bold_lead(
            self) -> None:
        lead_words = "**Lamplighter tithe** \u2014 "
        shared = (lead_words + "a toll for the road lamps is asked of "
                  "travellers")
        s4 = lead_words + "the [[Lamplighters]] want a tithe at [[Saltmarsh]]."
        s5 = (lead_words + "the [[Lamplighters]] will collect at the "
              "[[Saltmarsh]] gate before the caravan may pass.")
        files = dict([self.wrap(4, s4), self.wrap(5, s5)])
        files["Campaign Overview.md"] = note(
            "type: campaign_overview",
            f"## Open Threads\n\n- {shared}\n\n## Key Factions\n")
        self.assertEqual(self.left(files), [])
        # The thread is aged from the bullets, not flagged as unlisted.
        vault = make_vault(self, files)
        wraps = sc.wrap_up_threads(list(sc.vault_files(vault)),
                                   self.CHAPTER)
        self.assertEqual(sc.match_sessions(shared, wraps), ([4, 5], "="))


OVERVIEW = "Campaign Overview.md"

DORMANT_LIST = (
    "## Dormant Threads\n\n"
    "- **Wu bounty** \u2014 [[Master Wu]] wants the ledger \u2014 since "
    "Session 1; dormant since Session 1 (left Wu); involves [[Hero]]\n"
    "- **Gull omen** \u2014 [[The Gull]] cried \u2014 since Session 1; "
    "dormant since Session 1 (left the quay); involves the party\n"
    "- **Secret** \u2014 [[Hidden Man]] <!-- gm --> \u2014 since Session "
    "1; dormant since Session 1 (hid); involves the party\n")

DORMANT_FILES = {
    **FILES,
    "NPCs/Master Wu.md": note("type: npc"),
    "NPCs/The Gull.md": note("type: npc"),
}


class DormantReportTests(unittest.TestCase):
    def vault(self, dormant: str = DORMANT_LIST,
              wrap: str | None = None, plan: str | None = None) -> Path:
        files = dict(DORMANT_FILES)
        files[OVERVIEW] = note(
            "type: campaign_overview",
            "## Open Threads\n\n" + dormant + "\n## Key Factions\n")
        if wrap is not None:
            files[f"{SESSIONS}/Session 01 - Landfall - Wrap-Up.md"] = wrap
        if plan is not None:
            files[f"{SESSIONS}/Session 02 - Plan.md"] = note(
                'type: session-plan\nsession: "[[Session 02 - X]]"\n'
                'chapter: "[[Chapter 1 - Harbour]]"', plan)
        return make_vault(self, files)

    def test_threads_prints_all_dormant(self) -> None:
        out = run_cli(self.vault(), "--threads").stdout
        head = "--- Dormant (Campaign Overview) ---"
        part = out.split(head, 1)[1].split("--- Wrap-up threads", 1)[0]
        self.assertIn("Wu bounty", part)
        self.assertIn("dormant since Session 1 (left Wu)", part)
        self.assertIn("involves: Hero", part)
        self.assertIn("involves: the party", part)
        self.assertIn("Gull omen", part)
        self.assertIn("(hidden)", part.split("Secret", 1)[1])
        self.assertGreater(out.find(head), out.find("===== Threads"))
        self.assertGreater(out.find("--- Wrap-up threads"), out.find(head))

    def later(self, recap: str, dormant: str = DORMANT_LIST) -> Path:
        """A vault whose latest Wrap-Up is session 2's, after the session
        1 that parked the dormant list; `recap` replaces its recap line."""
        vault = self.vault(dormant)
        (vault / SESSIONS / "Session 02 - Second.md").write_text(note(
            'type: session\nsession_number: 2\n'
            'chapter: "[[Chapter 1 - Harbour]]"\nstatus: wrap-up\n'
            'play_date: "2026-10-08"'), encoding="utf-8")
        (vault / SESSIONS / "Session 02 - Second - Wrap-Up.md").write_text(
            WRAP.replace("session_number: 1", "session_number: 2")
            .replace("Session 01 - Landfall", "Session 02 - Second")
            .replace("They met [[Ma Barker]] on [[The_Docks]] and read the "
                     "[[Ledger]].", recap), encoding="utf-8")
        (vault / "PCs").mkdir()
        (vault / "PCs" / "Hero.md").write_text(note(
            "type: pc", "## Current Status\n\n**Open threads:** —\n"),
            encoding="utf-8")
        return vault

    def may_wake(self, vault: Path) -> str:
        done = run_cli(vault, "--prep")
        self.assertEqual(done.returncode, 0, done.stderr)
        part = done.stdout.split("--- Dormant, may wake ---", 1)[1]
        return part.split("--- Wrap-up threads", 1)[0]

    def test_the_wrap_up_that_parked_it_does_not_wake_it(self) -> None:
        # Session 1's Wrap-Up names Master Wu, but it is the one that
        # parked the Wu bounty.
        wrap = WRAP.replace("They met", "They met [[Master Wu]] and ")
        part = self.may_wake(self.vault(wrap=wrap))
        self.assertTrue(part.lstrip().startswith("(none)"), part[:200])

    def test_a_pc_s_name_never_wakes_a_thread(self) -> None:
        dormant = ("## Dormant Threads\n\n- **Gull omen** — [[Hero]] saw "
                   "it — since Session 1; dormant since Session 1 (x); "
                   "involves the party\n")
        part = self.may_wake(self.later("They met [[Hero]] at the quay.",
                                        dormant))
        self.assertTrue(part.lstrip().startswith("(none)"), part[:200])

    def test_prep_prints_only_may_wake_with_match(self) -> None:
        vault = self.later("They met [[Master Wu]] at the quay.")
        wrap = vault / SESSIONS / "Session 02 - Second - Wrap-Up.md"
        wrap.write_text(wrap.read_text(encoding="utf-8").replace(
            "<!-- gm-only -->",
            "#### Resolved Threads\n\n- done with [[The Gull]]\n\n"
            "<!-- gm-only -->"), encoding="utf-8")
        done = run_cli(vault, "--prep")
        self.assertEqual(done.returncode, 0, done.stderr)
        part = done.stdout.split("--- Dormant, may wake ---", 1)[1]
        part = part.split("--- Wrap-up threads", 1)[0]
        self.assertIn("Wu bounty", part)
        self.assertIn("\tmatched: [[Master Wu]]", part)
        # The Gull is named only under Resolved Threads: not a match.
        self.assertNotIn("Gull omen", part)
        self.assertNotIn("--- Dormant (Campaign Overview) ---", done.stdout)

    def test_prep_matches_the_upcoming_plan(self) -> None:
        out = run_cli(self.vault(plan="Go see [[The Gull]] again.\n"),
                      "--prep").stdout
        part = out.split("--- Dormant, may wake ---", 1)[1]
        part = part.split("--- Wrap-up threads", 1)[0]
        self.assertIn("Gull omen", part)
        self.assertIn("matched: [[The Gull]]", part)
        self.assertNotIn("Wu bounty", part)

    def test_an_involved_name_alone_does_not_wake(self) -> None:
        wrap = WRAP.replace("They met", "They met [[Hero]] and ")
        dormant = ("## Dormant Threads\n\n- **Wu** \u2014 [[Hero]] owes "
                   "\u2014 since Session 1; dormant since Session 1 (x); "
                   "involves [[Hero]]\n")
        out = run_cli(self.vault(dormant, wrap), "--prep").stdout
        part = out.split("--- Dormant, may wake ---", 1)[1]
        self.assertTrue(part.lstrip().startswith("(none)"), part[:200])

    def test_dormant_mode_prints_whole_list(self) -> None:
        done = run_cli(self.vault(), "--dormant")
        self.assertEqual(done.returncode, 0, done.stderr)
        out = done.stdout
        self.assertIn("===== Session Context =====", out)
        self.assertIn("--- Dormant (Campaign Overview) ---", out)
        for name in ("Wu bounty", "Gull omen", "Secret"):
            self.assertIn(name, out)
        self.assertNotIn("===== Threads", out)
        self.assertNotIn("===== Wrap-Up", out)

    def test_no_dormant_section_prints_none(self) -> None:
        vault = self.vault(dormant="")
        for flag, head in (("--threads", "--- Dormant (Campaign Overview) ---"),
                           ("--prep", "--- Dormant, may wake ---"),
                           ("--dormant", "--- Dormant (Campaign Overview) ---")):
            with self.subTest(flag=flag):
                done = run_cli(vault, flag)
                self.assertEqual(done.returncode, 0, done.stderr)
                part = done.stdout.split(head, 1)[1].lstrip()
                self.assertTrue(part.startswith("(none)"), part[:200])

    def test_dormant_flag_is_exclusive(self) -> None:
        done = run_cli(self.vault(), "--dormant", "--threads")
        self.assertEqual(done.returncode, 2)


class LikelyMatchTests(unittest.TestCase):
    def test_likely_match_claims_line(self) -> None:
        pc = note("type: pc\nstatus: active",
                  "## Current Status\n\n**Open threads:**\n"
                  "- Dr [[Venn]] was drugged in his study; someone knows "
                  "the cylinder is loose\n")
        wrap = note(
            'type: session-wrapup\nsession: "[[Session 03 - X]]"\n'
            'session_number: 3\nchapter: "[[Chapter 1 - Harbour]]"',
            "## GM Notes\n\n### PC Carry-Forward\n\n#### [[Ada]]\n\n"
            "- Venn drugged in study carried by Ada\n\n"
            "### What Carries Forward\n\n#### Unresolved Threads\n\n"
            "- Venn drugged in study (by whom?)\n"
            "- A wholly different matter about the harbour tax\n")
        vault = make_vault(self, {
            "PCs/Ada.md": pc, f"{SESSIONS}/Session 03 - Wrap-Up.md": wrap})
        files = list(sc.vault_files(vault))
        report = sc.thread_report(files, 5, None, vault)
        self.assertIn("first~3", report)
        orphans = report.split(
            "--- Wrap-up threads not on any thread list ---", 1)[1]
        self.assertNotIn("Venn drugged", orphans)
        self.assertIn("harbour tax", orphans)


class EmptyPcListTests(unittest.TestCase):
    def test_a_filler_list_reads_none_and_a_missing_field_says_so(
            self) -> None:
        vault = make_vault(self, {
            "PCs/Ada.md": note("type: pc",
                               "## Current Status\n\n**Open threads:** "
                               "—\n**Knows:** x\n"),
            "PCs/Bo.md": note("type: pc", "## Current Status\n\nFine.\n")})
        report = sc.thread_report(list(sc.vault_files(vault)), 1, None, vault)
        self.assertIn("--- Ada ---\n(none)\n", report)
        self.assertIn("--- Bo ---\n(no ## Current Status Open threads)",
                      report)


class OverlapNamesTests(unittest.TestCase):
    def test_overlap_names_skip_resolved(self) -> None:
        files = [("NPCs/Ma Barker.md", "", {"type": "npc"}),
                 ("Locations/The_Docks.md", "", {"type": "location"})]
        text = ("They met [[Ma Barker]].\n\n#### Resolved Threads\n\n"
                "- the toll at [[The Docks]] \u2014 closed: paid\n\n"
                "### Next\n\nSee [[The Docks]] later.\n")
        self.assertEqual(sc.wrapup_names(files, text),
                         ["Ma Barker", "The Docks"])
        only = text.replace("See [[The Docks]] later.", "Nothing.")
        self.assertEqual(sc.wrapup_names(files, only), ["Ma Barker"])


class ChapterWarningTests(unittest.TestCase):
    def warnings(self, as_of: str) -> list[str]:
        files = dict(FILES)
        files[OVERVIEW] = note(f"type: campaign_overview\nasOfSession: "
                               f"{as_of}")
        vault = make_vault(self, files)
        got = sc.select_session(list(sc.vault_files(vault)), None)[1]
        return [w for w in got if "asOfSession" in w]

    def test_chapter_warning_only_on_named_mismatch(self) -> None:
        for as_of in ('"Session 09"', "9", '"Session 9"',
                      '"Chapter 1, Session 3"'):
            with self.subTest(as_of=as_of):
                self.assertEqual(self.warnings(as_of), [])
        got = self.warnings('"Chapter 2, Session 3"')
        self.assertEqual(len(got), 1, got)
        self.assertIn("verify before trusting", got[0])

    def chapter_warnings(self, chapter: str, as_of: str) -> list[str]:
        files = {
            "Sessions/Session 01.md": note(
                f'type: session\nsession_number: 1\nchapter: "{chapter}"\n'
                'status: wrap-up\nplay_date: "2026-10-01"'),
            OVERVIEW: note(f"type: campaign_overview\nasOfSession: {as_of}")}
        vault = make_vault(self, files)
        got = sc.select_session(list(sc.vault_files(vault)), None)[1]
        return [w for w in got if "asOfSession" in w]

    def test_a_chapter_with_no_number_is_never_warned_about(self) -> None:
        self.assertEqual(self.chapter_warnings("[[Prologue]]",
                                               '"Chapter 2, Session 3"'), [])

    def test_a_bare_chapter_number_is_read(self) -> None:
        self.assertEqual(self.chapter_warnings("2", '"Chapter 2, Session 3"'),
                         [])
        self.assertEqual(len(self.chapter_warnings(
            "2", '"Chapter 3, Session 3"')), 1)


PAUSED = ("---\ntype: scene\nchapter: \"[[Chapter 1 - Harbour]]\"\n"
          "status: paused\nplayed_in:\n  - \"[[Session 01 - Landfall]]\"\n"
          "---\n\n<!-- prompt -->\n\n## Paused\n\n"
          "After [[Session 01 - Landfall]].\n\n"
          "Stopped at the fork in the tunnel.\n<!-- /paused -->\n\n"
          "**Situation:** Prep that must not print as snapshot.\n")


class PausedPrepTests(unittest.TestCase):
    def vault(self, scene=PAUSED):
        return make_vault(self, {**FILES,
                                 f"{CHAPTER}/Scenes/Down the Cellar.md":
                                 scene})

    def test_paused_snapshot_printed(self) -> None:
        out = run_cli(self.vault(), "--prep").stdout
        self.assertLess(out.index("===== Scene Queue"),
                        out.index("===== Paused Scenes ====="))
        self.assertLess(out.index("===== Paused Scenes ====="),
                        out.index("===== Narrative Plans"))
        block = out.split("===== Paused Scenes =====", 1)[1].split(
            "===== Narrative Plans", 1)[0]
        self.assertIn("### [[Down the Cellar]] (paused after "
                      "[[Session 01 - Landfall]])\nAfter [[Session 01 - "
                      "Landfall]].\n\nStopped at the fork in the tunnel.",
                      block)
        self.assertNotIn("/paused", block)
        self.assertNotIn("must not print", block)

    def test_paused_without_snapshot(self) -> None:
        scene = PAUSED.split("<!-- prompt -->")[0] + "Body.\n"
        out = run_cli(self.vault(scene), "--prep").stdout
        self.assertIn("### [[Down the Cellar]] (paused after "
                      "[[Session 01 - Landfall]])\n(no snapshot written)",
                      out)

    def test_no_paused_prints_nothing(self) -> None:
        out = run_cli(make_vault(self, FILES), "--prep").stdout
        self.assertNotIn("Paused Scenes", out)


if __name__ == "__main__":
    unittest.main()


class ArchivedPcTests(unittest.TestCase):
    """An archived or template PC note is no active PC (#536)."""

    def test_archived_template_pc_is_in_no_section(self) -> None:
        files = dict(FILES)
        files["Characters/Ada Quill.md"] = note(
            "type: pc\nstatus: active\nasOfSession: 1",
            "## Current Status\n\nWell.\n\n## Open threads\n- Find Ma\n")
        files["_archive/templates/_Template_PC_x.md"] = note(
            "type: pc\nstatus: active\nasOfSession: 1",
            "## Current Status\n\nPLACEHOLDER\n\n## Open threads\n"
            "- {unresolved, forward-looking item}\n")
        out = run_cli(make_vault(self, files), "--prep").stdout
        self.assertIn("Ada Quill", out)
        self.assertNotIn("_Template_PC_x", out)
        self.assertNotIn("PLACEHOLDER", out)

    def test_template_named_pc_outside_archive_is_skipped(self) -> None:
        files = dict(FILES)
        files["Characters/_Template_PC_y.md"] = note(
            "type: pc\nstatus: active", "## Current Status\n\nPLACEHOLDER\n")
        out = run_cli(make_vault(self, files), "--prep").stdout
        self.assertNotIn("PLACEHOLDER", out)

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

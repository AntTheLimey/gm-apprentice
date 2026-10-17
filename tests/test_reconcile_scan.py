#!/usr/bin/env python3
"""reconcile_scan.py: the counts reconcile's quick path reads."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reconcile_scan as rs  # noqa: E402

BENCH = ROOT / "tests" / "benchmark-campaign"
SESSIONS = "Chapters/Chapter 1/Sessions"
WRAP = f"{SESSIONS}/Session 05 - The Ball - Wrap-Up.md"

FILES = {
    f"{SESSIONS}/Session 04 - Before - Wrap-Up.md":
        "---\ntype: session_wrap\nsession: \"[[Session 04 - Before]]\"\n"
        "canon_status: AUTHORITATIVE\n---\n\n# Before\n",
    f"{SESSIONS}/Session 05 - The Ball.md":
        "---\ntype: session\nsession_number: 5\nstatus: wrap-up\ndocuments:\n"
        "  plan: \"[[Session 05 - The Ball - Plan]]\"\n  play_notes: null\n"
        "  wrap_up: \"[[Session 05 - The Ball - Wrap-Up]]\"\n---\n",
    f"{SESSIONS}/Session 05 - The Ball - Plan.md":
        "---\ntype: session-plan\nsession: \"[[Session 05 - The Ball]]\"\n"
        "canon_status: DRAFT\n---\n",
    WRAP:
        "---\ntype: session_wrap\nsession: \"[[Session 05 - The Ball]]\"\n"
        "canon_status: DRAFT\n---\n\n# The Ball\n\n"
        "The party met [[Lady Grey]] and [[The Duke|the Duke]] at [[Hall]].\n\n"
        "> [!info] Reconstruction Note\n> Pieced together from memory.\n\n"
        "<!-- UNVERIFIED: the Duke was at the docks -->\n"
        "<!-- UNVERIFIED -->\n"
        "```\n<!-- UNVERIFIED: in code, not counted -->\n```\n"
        "See [[Session 05 - The Ball]].\n",
    "NPCs/Lady_Grey.md":
        "---\ntype: npc\ncanon_status: DRAFT\naliases: [\"Lady Grey\"]\n---\n\n"
        "## Overview\n\n<!-- spoiler -->\nShe is the Duke's sister and has been "
        "lying to everyone at court.\n<!-- /spoiler -->\n\n"
        "```\n<!-- spoiler -->\n```\n",
    "NPCs/The Duke.md":
        "---\ntype: npc\ncanon_status: AUTHORITATIVE\n---\n\n<!-- gm-only -->\nx\n"
        "<!-- /gm-only -->\n",
    "Locations/Hall.md": "---\ntype: location\ncanon_status: DRAFT\n---\n",
}


def make_vault(tmp: str, files: dict[str, str]) -> Path:
    vault = Path(tmp)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


class Scan(unittest.TestCase):
    def test_counts_and_lists(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = rs.scan(make_vault(tmp, FILES), WRAP)
        self.assertEqual(out, [
            f"wrap-up: {WRAP}",
            f"session: {SESSIONS}/Session 05 - The Ball.md (status: wrap-up, session_number: 5)",
            "skip: no",
            "unverified: 2",
            "  line 14: the Duke was at the docks",
            "  line 15: (bare)",
            "reconstruction notes: 1",
            "  line 11",
            f"plan: {SESSIONS}/Session 05 - The Ball - Plan.md",
            "linked entities: 3",
            "draft entities: 2",
            "  NPCs/Lady_Grey.md",
            "  Locations/Hall.md",
            "open spoilers: 1",
            "  NPCs/Lady_Grey.md:9: She is the Duke's sister and has been lying to...",
            "quick path: no (2 UNVERIFIED markers, a Plan file)",
        ])

    def test_quick_path_with_drafts_leaves_the_contradiction_to_judge(self):
        files = dict(FILES)
        files[WRAP] = files[WRAP].split("> [!info]")[0]
        del files[f"{SESSIONS}/Session 05 - The Ball - Plan.md"]
        with tempfile.TemporaryDirectory() as tmp:
            out = rs.scan(make_vault(tmp, files), WRAP)
        self.assertIn("plan: none", out)
        self.assertIn("unverified: 0", out)
        self.assertEqual(out[-1], "quick path: yes, unless one of the DRAFT entities "
                         "above contradicts AUTHORITATIVE canon on the same facts")

    def test_plan_found_by_its_session_link(self):
        files = dict(FILES)
        files[f"{SESSIONS}/Session 05 - The Ball.md"] = (
            "---\ntype: session\nsession_number: 5\nstatus: wrap-up\ndocuments:\n"
            "  plan: null\n---\n")
        with tempfile.TemporaryDirectory() as tmp:
            out = rs.scan(make_vault(tmp, files), WRAP)
        self.assertIn(f"plan: {SESSIONS}/Session 05 - The Ball - Plan.md", out)

    def test_first_session_skips(self):
        files = dict(FILES)
        del files[f"{SESSIONS}/Session 04 - Before - Wrap-Up.md"]
        with tempfile.TemporaryDirectory() as tmp:
            out = rs.scan(make_vault(tmp, files), WRAP)
        self.assertIn("skip: first session (no other Wrap-Up in the vault)", out)

    def test_benchmark_reviewed_session(self):
        out = rs.scan(BENCH, f"{SESSIONS}/Session 04 - The Reckoning - Wrap-Up.md")
        self.assertIn("skip: status is already reviewed", out)
        self.assertIn("unverified: 0", out)

    def test_not_a_wrap_up(self):
        with self.assertRaises(LookupError):
            rs.scan(BENCH, f"{SESSIONS}/Session 04 - The Reckoning.md")


class Cli(unittest.TestCase):
    def test_exit_codes(self):
        script = str(SCRIPTS / "reconcile_scan.py")
        ok = subprocess.run(
            [sys.executable, script, str(BENCH),
             f"./{SESSIONS}/Session 02 - The Docks at Night - Wrap-Up.md"],
            capture_output=True, text=True, check=False)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(ok.stdout.rstrip().endswith("quick path: yes"))
        bad = subprocess.run([sys.executable, script, str(BENCH), "nope.md"],
                             capture_output=True, text=True, check=False)
        self.assertEqual(bad.returncode, 2)
        self.assertIn("no Wrap-Up at nope.md", bad.stderr)


if __name__ == "__main__":
    unittest.main()

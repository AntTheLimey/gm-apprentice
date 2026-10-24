#!/usr/bin/env python3
"""Drift guard for wrap-up step 4d, "What came out tonight".

The step runs reveal_scan.py and reveal.py by full command line, so the
model never reads their source; the GM confirms before `--write`; the
Plan is never a source of what came out. Reconcile 3.5 no longer asks
about spoilers itself: it points at 4d, and asks as before only for a
wrap-up made before 4d existed. Structural, not behavioral: proves the
wording, not a run.

Run: python tests/test_reveal_prose.py
"""

import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"
SCRIPTS = 'python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/'


def read(rel):
    return (SKILLS / rel).read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(heading)
    rest = text[start + len(heading):]
    end = re.search(r"^#{1,3} ", rest, re.M)
    return rest[:end.start()] if end else rest


class WrapupStep4dTests(unittest.TestCase):
    def setUp(self):
        self.text = read("session-wrapup/SKILL.md")
        self.step = section(self.text, "### 4d. What came out tonight")

    def test_step_sits_after_4c_and_before_5(self):
        at = self.text.index
        self.assertLess(at("### 4c. World Fact Scan"),
                        at("### 4d. What came out tonight"))
        self.assertLess(at("### 4d. What came out tonight"),
                        at("### 5. Remaining GM Notes"))

    def test_both_scripts_by_full_command_line(self):
        for script in ("reveal_scan.py", "reveal.py"):
            self.assertRegex(self.step, re.escape(SCRIPTS + script + '"')
                             + r"\s*\\?\s*<vault>")
        for flag in ("--session", "--publish", "--released", "--write"):
            self.assertIn(flag, self.step)

    def test_no_publish_list_skips(self):
        self.assertIn("no publish list", self.step)

    def test_gm_confirms_before_write(self):
        self.assertRegex(self.step, r"all, some or none")
        confirm = self.step.index("confirm")
        self.assertLess(confirm, self.step.index("--write"))

    def test_never_from_the_plan_and_no_prep_notes(self):
        self.assertRegex(self.step, r"[Nn]ever (?:unlock|propose)[^.]*Plan")
        self.assertRegex(self.step, r"[Nn]ever publish a scene, Plan or session")


class ReconcileSpoilerPointerTests(unittest.TestCase):
    def setUp(self):
        self.step = section(read("shared/reconcile.md"),
                            "### 3.5. Spoiler reveal check")

    def test_points_at_wrapup_4d(self):
        self.assertIn("4d", self.step)

    def test_keeps_the_fallback_for_older_wrapups(self):
        self.assertIn("1.10.100", self.step)
        self.assertIn("<!-- spoiler -->", self.step)


class VaultAccessRowsTests(unittest.TestCase):
    def test_both_scripts_listed(self):
        text = read("shared/vault-access.md")
        self.assertIn("`reveal_scan.py VAULT", text)
        self.assertIn("`reveal.py VAULT", text)


if __name__ == "__main__":
    unittest.main()

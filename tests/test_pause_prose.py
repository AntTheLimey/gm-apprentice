#!/usr/bin/env python3
"""Drift guard for the pause snapshot in the skill text.

Wrap-up confirms a pause with the GM, then writes the snapshot with
`vw scene-paused` by full command line; it ends a scene for good with
`--dropped`; the paused scenes going in come from `--carry`. The reveal
step never proposes from a scene note. Play opens with the paused
snapshot; prep reads it from its bundle. These test that the facts are
present, never the snapshot's shape. Structural, not behavioral.

Run: python tests/test_pause_prose.py
"""

import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def read(rel):
    return (SKILLS / rel).read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(heading)
    rest = text[start + len(heading):]
    end = re.search(r"^#{1,3} ", rest, re.M)
    return rest[:end.start()] if end else rest


class WrapupPauseTests(unittest.TestCase):
    def setUp(self):
        self.text = read("session-wrapup/SKILL.md")

    def test_scene_paused_full_command_after_confirm(self):
        cmd = ('vw scene-paused --scene "<scene>" --session '
               '"<session index>" --write')
        self.assertIn(cmd, self.text)
        before = self.text[:self.text.index(cmd)]
        para = before[before.rfind("\n\n"):]
        self.assertRegex(para, r"confirm\s+with\s+the\s+GM\s+that\s+it"
                               r"\s+paused")
        self.assertRegex(para, r"[Ss]how\s+the\s+GM\s+the\s+snapshot")
        self.assertRegex(para, r"dry\s+run\s+\(the\s+command\s+without"
                               r"\s+`--write`\)")

    def test_new_dropped_and_carry_named(self):
        self.assertIn("--new", self.text)
        self.assertIn(
            'vw scene-played --scene "<scene>" --dropped --write', self.text)
        self.assertRegex(self.text, r"--carry[^\n]*\n?[^\n]*Paused Scenes")

    def test_reveal_step_never_proposes_from_a_scene_note(self):
        step = section(self.text, "### 4d. What came out tonight")
        self.assertRegex(step, r"[Nn]ever propose from the Plan\s+or\s+a"
                               r"\s+scene\s+note")


class PlayPrepPauseTests(unittest.TestCase):
    def test_play_first_invocation_mentions_paused_snapshot(self):
        text = read("session-play/SKILL.md")
        first = text[text.index("**On first invocation:**"):
                     text.index("## Behavior")]
        self.assertIn("## Paused", first)
        self.assertRegex(first, r"[Pp]aused scene")

    def test_prep_step_14_names_dropped(self):
        text = read("session-prep/SKILL.md")
        step = text[text.index("`--prep`'s Scene Queue"):
                    text.index("→ each scene to `## Planned Scenes`")]
        self.assertIn("Paused Scenes", step)
        self.assertIn(
            'scene-played --scene "<scene>" --dropped --write', step)


class SharedPauseTests(unittest.TestCase):
    def test_vault_access_row(self):
        self.assertRegex(read("shared/vault-access.md"),
                         r"\| A scene that stopped part-way[^\n]*"
                         r"\| `vault_write\.py scene-paused` \|")

    def test_entity_schema_scene_names_paused_section(self):
        text = read("shared/entity-schema.md")
        block = text[text.index("**Scene:**"):
                     text.index("## Type-Specific Fields")]
        self.assertIn("## Paused", block)
        self.assertIn("vault_write.py scene-paused", block)


if __name__ == "__main__":
    unittest.main()

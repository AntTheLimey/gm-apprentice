#!/usr/bin/env python3
"""Drift guard for the skill text that builds NPC stat blocks (#725).

session-prep's Gap Check says where a built block goes and what happens
with no game system; the Midwife builds blocks for majors and for NPCs the
plans put in a fight or casting, and may leave other `npc-stats` rows; a
brief's Key NPCs entries each name their NPC with a link, which is how
`npc-stats` reads who is major. Structural, not behavioral: proves the
wording, not a run.

Run: python3 -m pytest tests/test_npc_stats_prose.py -q
"""

import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def read(rel):
    return (SKILLS / rel).read_text(encoding="utf-8")


def bullet(text, starts):
    """The `- ` bullet beginning `starts`, continuation lines joined."""
    at = text.index(starts)
    rest = text[at:]
    end = re.search(r"\n(?:- |\n)", rest[1:])
    return " ".join(rest[:end.start() + 1 if end else None].split())


class SessionPrepGapCheckTests(unittest.TestCase):
    def setUp(self):
        self.line = bullet(read("session-prep/SKILL.md"),
                           "- NPCs the Plan's scenes name without a stat block")

    def test_says_where_the_block_goes_on_a_yes(self):
        self.assertIn("On the GM's yes", self.line)
        self.assertIn("`## GM Notes` as its `### Stats` section", self.line)

    def test_no_system_is_an_open_question(self):
        clause = self.line[self.line.index("`# system: none recorded`"):]
        self.assertIn("build nothing", clause.split(".", 1)[0])
        self.assertIn("Open Question", self.line)


class MidwifeTests(unittest.TestCase):
    def setUp(self):
        self.text = " ".join(read(
            "the-midwife/references/scaffold-handoff.md").split())

    def test_other_rows_may_be_left(self):
        self.assertNotIn("any row for an NPC just promoted is built",
                         self.text)
        self.assertIn("build each row for a major NPC or one the plans put "
                      "in a fight or casting; other rows may be left",
                      self.text)

    def test_key_npc_entries_name_their_npc_with_a_link(self):
        row = next(ln for ln in read(
            "the-midwife/references/scaffold-handoff.md").splitlines()
            if ln.startswith("| Key NPCs |"))
        self.assertIn("each entry starts with its NPC's `[[link]]`", row)


if __name__ == "__main__":
    unittest.main()

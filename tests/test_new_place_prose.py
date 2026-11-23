#!/usr/bin/env python3
"""Drift guard for the run sheet's New place lines in wrap-up (#840).

The run sheet writes `- New place: <name>` under the Table Log's
`Improvised beats` for a place the GM typed in play. Wrap-up's step 4
offers a location note for each; the document chain says it does.
These test that the facts are present, never the wording. Structural,
not behavioral.

Run: python tests/test_new_place_prose.py
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


class NewPlaceProseTests(unittest.TestCase):
    def test_wrapup_step_4_offers_a_note_per_new_place_line(self):
        step4 = " ".join(section(read("session-wrapup/SKILL.md"),
                                 "### 4. Update the World").split())
        self.assertIn("`- New place: <name>`", step4)
        self.assertIn("`Improvised beats`", step4)
        self.assertIn("offer a location note for each", step4)
        self.assertIn("`--type location`", step4)

    def test_document_chain_says_wrapup_offers_it(self):
        chain = " ".join(read("shared/session-document-chain.md").split())
        self.assertIn("(no note yet: wrap-up offers to make one)", chain)


if __name__ == "__main__":
    unittest.main()

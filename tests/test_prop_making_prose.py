#!/usr/bin/env python3
"""Drift guard for the skill text on making a prop and its recap links.

Wrap-up 4d links each picked prop's note from the recap and leaves
`revealed_in` to reveal.py; ttrpg-expert routes "make a prop" to
making-a-prop.md, which files the prop by full command line, reads the
hand registry, cuts GM text with gm-only fences, counts printed pages,
and never edits the publish list. Structural, not behavioral: proves
the wording, not a run.

Run: python3 -m pytest tests/test_prop_making_prose.py -q
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


class WrapupRecapLinkTests(unittest.TestCase):
    def setUp(self):
        self.step = section(read("session-wrapup/SKILL.md"),
                            "### 4d. What came out tonight")

    def test_picked_props_are_linked_from_the_recap(self):
        self.assertRegex(self.step, r"(?s)prop.{0,80}`\[\[.*?\]\]`.{0,80}recap")

    def test_reveal_writes_revealed_in_itself(self):
        self.assertIn("revealed_in", self.step)
        self.assertRegex(self.step, r"(?s)reveal\.py.{0,40}writes.{0,80}"
                                    r"revealed_in|revealed_in.{0,80}reveal\.py")


class MakingAPropTests(unittest.TestCase):
    def setUp(self):
        self.text = read("ttrpg-expert/making-a-prop.md")

    def test_prop_new_by_full_command_line(self):
        self.assertRegex(self.text, re.escape(SCRIPTS + 'vault_write.py"')
                         + r"\s*\\?\s*<vault> prop-new")
        for flag in ("--chapter", "--title", "--style", "--hand",
                     "--hand-font", "--hand-who", "--scene", "--write"):
            self.assertIn(flag, self.text)

    def test_hand_registry_named(self):
        self.assertIn("_meta/prop-hands.json", self.text)

    def test_gm_only_fence_named(self):
        self.assertIn("<!-- gm-only -->", self.text)
        self.assertIn("<!-- /gm-only -->", self.text)

    def test_page_count_by_tool(self):
        # --note counts a prop before it publishes, so the check works
        # while the prop is being made.
        self.assertRegex(self.text, r"npx gm-apprentice-publish props pages"
                                    r"\s*\\?\s*--config <site>/vault\.config\.json"
                                    r"\s*\\?\s*--note \"<")
        self.assertNotIn("not built", self.text)

    def test_new_writer_on_a_filed_prop(self):
        self.assertRegex(self.text, r"vault_write\.py <vault> prop-hand(?!s)")
        self.assertIn('stamp_entities.py <vault> "<note>" --set prop_hand=<id>',
                      self.text)

    def test_hand_only_for_a_writer(self):
        self.assertRegex(self.text, r"`--hand <id>` only when a person wrote it")

    def test_never_edits_the_publish_list(self):
        self.assertRegex(self.text, r"(?i)never edit the publish list")

    def test_print_rules(self):
        for rule in ("@page", "break-after: page", "print-color-adjust: exact",
                     ".sheet"):
            self.assertIn(rule, self.text)


class RoutingTests(unittest.TestCase):
    def test_ttrpg_expert_routes_making_a_prop(self):
        text = read("ttrpg-expert/SKILL.md")
        self.assertRegex(text, r'"Make a prop for X"[^\n]*\n?[^\n]*'
                               r'→ `making-a-prop\.md`')

    def test_handouts_points_at_making_a_prop(self):
        self.assertIn("making-a-prop.md", read("ttrpg-expert/handouts-and-props.md"))

    def test_vault_access_row(self):
        self.assertRegex(read("shared/vault-access.md"),
                         r"\| File a new prop in its chapter's `?Props/`?[^|]*"
                         r"\| `vault_write\.py prop-new`")


class HandsTests(unittest.TestCase):
    def test_prop_styles_names_hands(self):
        text = read("publish-site/references/prop-styles.md")
        for word in ("prop_hand", "_meta/prop-hands.json"):
            self.assertIn(word, text)

    def test_site_faults_offers_to_add_the_hand(self):
        step = section(read("campaign-qa/references/checks/site-faults.md"),
                       "## PROP_NOT_COPIED")
        # A filed prop's hand is added with prop-hand, with the font the
        # GM names.
        self.assertIn("prop_hand", step)
        self.assertRegex(step, r"vault_write\.py\s+\"<vault>\" prop-hand --hand <id>\s+"
                               r"--hand-font \"<family>\"")
        self.assertRegex(step, r"Ask the GM for the font;\s+never pick one")

if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""A quoted frontmatter value holding wikilinks (#604, #638): every reader
of a link-valued field gets all the targets, and session fields written as
a quoted wikilink count as session numbers."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ROOT / "scripts"))

import plans_index as pi  # noqa: E402
import reconcile_scan as rs  # noqa: E402
import schema_rules  # noqa: E402
import test_vw_scene_chapter_new as scn  # noqa: E402
import validate_schema as vs  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402


class LinkTargetsTests(unittest.TestCase):
    def test_shapes(self):
        t = vl.link_targets
        self.assertEqual(t("[[A]], [[B|b]]"), ["A", "B"])
        self.assertEqual(t(["[[A]]", "[[B#H]]"]), ["A", "B"])
        self.assertEqual(t("Plain"), ["Plain"])
        self.assertEqual(t(["[[A]], [[B]]", "C"]), ["A", "B", "C"])
        self.assertEqual(t(None), [])
        self.assertEqual(t(""), [])
        self.assertEqual(t([]), [])


class ScenePlayedQuotedLinksTests(unittest.TestCase):
    def test_played_in_string_of_two_links_is_kept_as_two(self):
        files = dict(scn.FILES)
        files["Chapters/Chapter 2 - Lyon/Scenes/Quoted.md"] = (
            '---\ntype: scene\nstatus: ready\n'
            'played_in: "[[Session 01]], [[Session 02]]"\n---\n')
        vault = scn.make_vault(self, files)
        code, out = scn.run(vault, "scene-played", "--scene", "Quoted",
                            "--session", "Session 05 - The Docks", "--write")
        self.assertEqual(code, 0, out)
        text = (vault / "Chapters/Chapter 2 - Lyon/Scenes/Quoted.md"
                ).read_text("utf-8")
        self.assertNotIn("Session 01, Session 02", text)
        self.assertEqual(vl.extract_frontmatter(text)["played_in"],
                         ["[[Session 01]]", "[[Session 02]]",
                          "[[Session 05 - The Docks]]"])

    def test_link_scene_keeps_a_quoted_single_entity(self):
        text = '---\ntype: scene\nentities: "[[Bob]]"\n---\nBody\n'
        put = {}
        batch = SimpleNamespace(
            read=lambda rel: text, row=lambda *a: None,
            put=lambda rel, new: put.update({rel: new}))
        vw.link_scene(batch, "S.md", "Carol")
        self.assertEqual(vl.extract_frontmatter(put["S.md"])["entities"],
                         ["[[Bob]]", "[[Carol]]"])


class PlansIndexQuotedLinksTests(unittest.TestCase):
    def test_participants_string_is_read(self):
        self.assertEqual(pi._list_names("[[Bob]]"), ["Bob"])
        self.assertEqual(pi._list_names('[[Bob]], [[Ada]]'), ["Bob", "Ada"])


class QuotedSessionFieldsTests(unittest.TestCase):
    FM = '---\ntype: npc\ncanon_status: DRAFT\ncreatedSession: "[[Session 02 - X]]"\n---\n'

    def test_created_session_counts_as_session_two(self):
        fm = vl.extract_frontmatter(self.FM)
        self.assertEqual(vl.parse_session_number(fm["createdSession"]), 2)
        note = rs.Note("NPCs/X.md", self.FM)
        self.assertTrue(rs._created_this_session(note, 2, None))
        self.assertFalse(rs._created_this_session(note, 3, None))

    def test_as_of_session_wikilink_has_an_ordinal(self):
        self.assertEqual(vs.parse_session_ordinal("[[Session 02 - X]]"), (0, 2))


class MessageTests(unittest.TestCase):
    def test_leads_to_single_link_says_what_to_write(self):
        found = schema_rules.frontmatter_findings(
            {"type": "plan", "plan_type": "scene", "canon_status": "DRAFT",
             "chapter": "[[Chapter 1]]", "leads_to": "[[B]]"})
        msgs = [m for _lvl, m in found if "leads_to" in m]
        self.assertTrue(msgs)
        self.assertIn('leads_to: ["[[Plan Name]]"]', msgs[0])


if __name__ == "__main__":
    unittest.main()

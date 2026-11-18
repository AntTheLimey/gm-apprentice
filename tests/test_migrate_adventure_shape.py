"""1.12.63 update step `adventure-shape` (#735): the adventure brief's
one-word `adventure_shape` field is removed; the brief's
`### Adventure Shape` section holds the shape in the GM's words."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import migrate_vault as mv  # noqa: E402
from migrate_core import CHOICE, WILL  # noqa: E402

BRIEF = "Adventures/Snowmelt/Snowmelt.md"


def brief(shape_line, shape_section):
    return ("---\ntype: adventure-brief\ncanon_status: DRAFT\n"
            "scope: few-shot\n" + shape_line + "tags: []\n---\n\n"
            "## Premise\n\nA pass, a storm.\n\n## GM Notes\n\n"
            "### Adventure Shape\n\n" + shape_section + "\n### Escalation\n\nSnow.\n")


def make_vault(case, notes):
    vault = Path(tempfile.mkdtemp(prefix="mig-shape-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


class AdventureShapeTests(unittest.TestCase):
    def test_the_check_is_declared_for_1_12_63(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "adventure-shape")
        self.assertEqual((check.release, check.band, check.kind, check.choices),
                         ("1.12.63", 3, "bookkeeping", ("adventure-shape-word",)))

    def test_a_brief_with_its_shape_written_loses_the_line(self):
        v = make_vault(self, {BRIEF: brief('adventure_shape: "linear"\n',
                                           "A fixed spine; session 2 open.\n")})
        (item,) = mv.find_adventure_shape(v)
        self.assertEqual((item.id, item.group), ("adventure-shape", WILL))
        self.assertEqual(item.apply(None),
                         [f'removed adventure_shape: "linear" from {BRIEF}'])
        self.assertEqual((v / BRIEF).read_text(encoding="utf-8"),
                         brief("", "A fixed spine; session 2 open.\n"))
        self.assertEqual(mv.find_adventure_shape(v), [])

    def test_an_empty_field_goes_whatever_the_section_holds(self):
        v = make_vault(self, {BRIEF: brief('adventure_shape: ""       # linear / branching\n',
                                           "{The structure and why.}\n")})
        (item,) = mv.find_adventure_shape(v)
        self.assertEqual(item.group, WILL)

    def test_a_word_with_no_shape_written_is_asked(self):
        v = make_vault(self, {BRIEF: brief("adventure_shape: sandbox\n",
                                           "{The structure and why.}\n"
                                           "<!-- fill in -->\n")})
        (item,) = mv.find_adventure_shape(v)
        self.assertEqual((item.id, item.group, item.kind),
                         ("adventure-shape-word", CHOICE, "removes"))
        self.assertIn("adventure_shape: sandbox", item.lines[0])
        self.assertIn("adventure_shape: sandbox", (v / BRIEF).read_text(encoding="utf-8"))
        self.assertEqual(item.apply(None),
                         [f"removed adventure_shape: sandbox from {BRIEF}"])
        self.assertNotIn("adventure_shape", (v / BRIEF).read_text(encoding="utf-8"))

    def test_other_notes_and_a_brief_without_the_field_are_left(self):
        npc = "---\ntype: npc\nadventure_shape: linear\n---\n\nHi.\n"
        v = make_vault(self, {BRIEF: brief("", "Open.\n"), "NPCs/A.md": npc})
        self.assertEqual(mv.find_adventure_shape(v), [])
        self.assertEqual((v / "NPCs/A.md").read_text(encoding="utf-8"), npc)


if __name__ == "__main__":
    unittest.main()

"""1.12.85 update step `scene-type` (#759): a scene note's `scene_type`
line is removed, value and all; nothing read it. The rest of the note is
untouched."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))

import migrate_vault as mv  # noqa: E402
from migrate_core import WILL  # noqa: E402

SCENE = "Chapters/Chapter 1/Scenes/What Sleeps Below.md"
BODY = ("\n## Situation\n\nThe abbot waits below.\n\n"
        "scene_type: combat is a line of prose, not a field.\n")


def scene(type_line, eol="\n"):
    text = ("---\ntype: scene\nchapter: \"[[Chapter 1]]\"\nstatus: planned\n"
            + type_line + "entities: []\ntags: []\n---\n" + BODY)
    return text.replace("\n", eol)


def make_vault(case, notes):
    vault = Path(tempfile.mkdtemp(prefix="mig-scene-type-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


class SceneTypeTests(unittest.TestCase):
    def test_the_check_is_declared_for_1_12_83(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "scene-type")
        self.assertEqual((check.release, check.band, check.kind),
                         ("1.12.85", 3, "bookkeeping"))

    def test_a_filled_field_goes_and_nothing_else_changes(self):
        v = make_vault(self, {SCENE: scene("scene_type: horror\n")})
        (item,) = mv.find_scene_type(v)
        self.assertEqual((item.id, item.group), ("scene-type", WILL))
        self.assertEqual(item.apply(None),
                         [f"removed scene_type: horror from {SCENE}"])
        self.assertEqual((v / SCENE).read_bytes().decode("utf-8"), scene(""))
        self.assertEqual(mv.find_scene_type(v), [])

    def test_a_blank_field_with_the_templates_comment_goes(self):
        v = make_vault(self, {SCENE: scene(
            "scene_type:              # optional: investigation | social\n")})
        (item,) = mv.find_scene_type(v)
        item.apply(None)
        self.assertEqual((v / SCENE).read_bytes().decode("utf-8"), scene(""))

    def test_line_endings_are_kept(self):
        v = make_vault(self, {SCENE: scene("scene_type: social\n", eol="\r\n")})
        (item,) = mv.find_scene_type(v)
        item.apply(None)
        self.assertEqual((v / SCENE).read_bytes().decode("utf-8"),
                         scene("", eol="\r\n"))

    def test_a_scene_without_it_and_other_types_are_left_alone(self):
        npc = ("---\ntype: npc\nstatus: alive\nscene_type: social\n---\n\n"
               "A field on a note that is not a scene is not ours.\n")
        v = make_vault(self, {SCENE: scene(""),
                              "Characters/NPCs/Hollis.md": npc,
                              "_Templates/_Template_Scene.md":
                                  scene("scene_type:\n")})
        self.assertEqual(mv.find_scene_type(v), [])

    def test_a_block_value_is_left_alone(self):
        v = make_vault(self, {SCENE: scene("scene_type:\n  - combat\n  - horror\n")})
        self.assertEqual(mv.find_scene_type(v), [])


if __name__ == "__main__":
    unittest.main()

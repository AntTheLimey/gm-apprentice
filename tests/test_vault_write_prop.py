#!/usr/bin/env python3
"""vault_write.py prop-new."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402
import vault_write as vw  # noqa: E402

LYON = "Chapters/Chapter 2 - Lyon"
SCENE = f"{LYON}/Scenes/The Docks.md"
HANDS = "_meta/prop-hands.json"
PUBLISH = "_meta/publish-list.yaml"
FILES = {
    f"{LYON}/Lyon.md": '---\ntype: chapter\ntitle: "Lyon"\n---\n',
    SCENE: "---\ntype: scene\nstatus: ready\nentities: []\n---\n\nBody.\n",
    f"{LYON}/Props/The Bookshelf.md": "---\ntype: prop\nprop_kind: container\n---\n",
    PUBLISH: "publish:\n  - Chapters/Keep.md\n",
}


def make_vault(case, files=FILES):
    vault = Path(tempfile.mkdtemp(prefix="vw-prop-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def snapshot(vault):
    return {p.relative_to(vault).as_posix(): p.read_bytes()
            for p in vault.rglob("*") if p.is_file()}


class PropNew(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self)
        patch = mock.patch.object(vc, "ask_publish_tool",
                                  return_value=vc.ToolAnswer())
        self.ask = patch.start()
        self.addCleanup(patch.stop)

    def run_cmd(self, *argv, vault=None):
        out = io.StringIO()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                       io.StringIO()):
            code = vw.main([str(vault or self.vault), "prop-new",
                            "--chapter", "Lyon", *argv])
        return code, out.getvalue()

    def read(self, rel):
        return (self.vault / rel).read_text(encoding="utf-8")

    def test_creates_in_chapter_props(self):
        code, out = self.run_cmd("--title", "Invitation", "--write")
        self.assertEqual(code, 0, out)
        rel = f"{LYON}/Props/Invitation.md"
        text = self.read(rel)
        self.assertIn('name: "Invitation"', text)
        self.assertIn("type: prop", text)
        self.assertIn("prop_kind: document", text)
        self.assertIn("CREATED", out)

    def test_folder_goes_under_chapter(self):
        code, out = self.run_cmd("--title", "Map", "--folder", "Side/Audition",
                                 "--write")
        self.assertEqual(code, 0, out)
        self.assertTrue((self.vault / LYON / "Side/Audition/Props/Map.md")
                        .is_file())

    def test_set_piece_style_and_kind(self):
        code, out = self.run_cmd("--title", "Letter", "--kind", "object",
                                 "--style", "letter", "--container",
                                 "The Bookshelf", "--write")
        self.assertEqual(code, 0, out)
        text = self.read(f"{LYON}/Props/Letter.md")
        self.assertIn("prop_kind: object", text)
        self.assertIn('prop_style: "letter"', text)
        self.assertIn('prop_container: "[[The Bookshelf]]"', text)
        self.assertNotIn("revealed_in: \"x", text)

    def test_bad_kind_and_style_refused(self):
        for argv in (("--kind", "scroll"), ("--style", "Not Valid")):
            before = snapshot(self.vault)
            code, out = self.run_cmd("--title", "X", *argv, "--write")
            self.assertEqual(code, 1, out)
            self.assertEqual(snapshot(self.vault), before)

    def test_style_and_file_refused(self):
        code, out = self.run_cmd("--title", "X", "--style", "letter",
                                 "--file", "x.html", "--write")
        self.assertEqual(code, 1)
        self.assertIn("a prop has a style or a hand-made file, not both", out)

    def test_missing_file_is_a_warning(self):
        code, out = self.run_cmd("--title", "X", "--file", "x.html", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("write the page beside the note before it is revealed",
                      out)
        self.assertIn('prop_file: "x.html"', self.read(f"{LYON}/Props/X.md"))

    def test_new_hand_needs_font(self):
        before = snapshot(self.vault)
        code, out = self.run_cmd("--title", "X", "--hand", "sophia", "--write")
        self.assertEqual(code, 1)
        self.assertIn('hand "sophia" is new: give its font with --hand-font',
                      out)
        self.assertEqual(snapshot(self.vault), before)

    def test_new_hand_added_to_registry(self):
        code, out = self.run_cmd("--title", "X", "--hand", "sophia",
                                 "--hand-font", "Caveat", "--hand-who",
                                 "Sophia", "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read(HANDS), json.dumps(
            {"hands": {"sophia": {"font": "Caveat", "who": "Sophia"}}},
            indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        self.assertIn('prop_hand: "sophia"', self.read(f"{LYON}/Props/X.md"))

    def test_hand_reused(self):
        self.run_cmd("--title", "X", "--hand", "sophia", "--hand-font",
                     "Caveat", "--write")
        before = self.read(HANDS)
        for extra in ((), ("--hand-font", "Caveat")):
            code, out = self.run_cmd("--title", f"Y{len(extra)}", "--hand",
                                     "sophia", *extra, "--write")
            self.assertEqual(code, 0, out)
            self.assertIn("SKIP\t_meta/prop-hands.json\t\thand sophia is "
                          "Caveat", out)
            self.assertEqual(self.read(HANDS), before)

    def test_hand_font_conflict_refused(self):
        self.run_cmd("--title", "X", "--hand", "sophia", "--hand-font",
                     "Caveat", "--write")
        before = snapshot(self.vault)
        code, out = self.run_cmd("--title", "Z", "--hand", "sophia",
                                 "--hand-font", "Lobster", "--write")
        self.assertEqual(code, 1)
        self.assertIn('hand "sophia" is already Caveat; use it, or choose a '
                      'new id for a new writer', out)
        self.assertEqual(snapshot(self.vault), before)

    def test_bad_registry_refused_nothing_written(self):
        for bad in ("not json", '{"other": 1}'):
            vault = make_vault(self, {**FILES, HANDS: bad})
            before = snapshot(vault)
            code, out = self.run_cmd("--title", "X", "--hand", "a",
                                     "--hand-font", "Caveat", "--write",
                                     vault=vault)
            self.assertEqual(code, 1, out)
            self.assertEqual(snapshot(vault), before)

    def test_bad_hand_id_and_font_refused(self):
        for argv in (("--hand", "Bad Id", "--hand-font", "Caveat"),
                     ("--hand", "ok", "--hand-font", "Bad;Font")):
            code, _out = self.run_cmd("--title", "X", *argv, "--write")
            self.assertEqual(code, 1)

    def test_scene_entities_gain_link_once(self):
        for _ in range(2):
            code, out = self.run_cmd("--title", "Invitation", "--scene",
                                     "The Docks", "--write")
            self.assertIn(code, (0, 1))
        text = self.read(SCENE)
        self.assertEqual(text.count("[[Invitation]]"), 1)
        self.assertIn("status: ready", text)
        self.assertTrue(text.endswith("\nBody.\n"))

    def test_scene_already_listing_it_is_skipped(self):
        files = {**FILES, SCENE: "---\ntype: scene\nentities:\n"
                 '  - "[[Invitation]]"\n---\n'}
        vault = make_vault(self, files)
        code, out = self.run_cmd("--title", "Invitation", "--scene",
                                 "The Docks", "--write", vault=vault)
        self.assertEqual(code, 0, out)
        self.assertIn("SKIP", out)
        self.assertEqual((vault / SCENE).read_text(), files[SCENE])

    def test_scene_link_is_not_duplicated_on_a_second_prop_run(self):
        self.run_cmd("--title", "A", "--scene", "The Docks", "--write")
        self.run_cmd("--title", "B", "--scene", "The Docks", "--write")
        text = self.read(SCENE)
        self.assertEqual(text.count("[[A]]"), 1)
        self.assertEqual(text.count("[[B]]"), 1)

    def test_title_clash_refused(self):
        code, out = self.run_cmd("--title", "The Docks", "--write")
        self.assertEqual(code, 1)
        self.assertIn("already exists", out)

    def test_never_touches_publish_list(self):
        before = (self.vault / PUBLISH).read_bytes()
        self.run_cmd("--title", "X", "--hand", "a", "--hand-font", "Caveat",
                     "--scene", "The Docks", "--write")
        self.assertEqual((self.vault / PUBLISH).read_bytes(), before)

    def test_unmapped_folder_warns(self):
        self.ask.return_value = vc.ToolAnswer(data={"code": "DIR_UNMAPPED"})
        code, out = self.run_cmd("--title", "X", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn(f"the site does not show notes in {LYON}/Props: add it "
                      f"to player_site.folder_map (gm-publish settings set",
                      out)
        self.ask.assert_called_with(
            self.vault, ["explain", f"{LYON}/Props/X.md"],
            site_optional=True)

    def test_mapped_or_unanswered_folder_says_nothing(self):
        for answer in (vc.ToolAnswer(data={"code": "OK"}),
                       vc.ToolAnswer(why="no node")):
            self.ask.return_value = answer
            _code, out = self.run_cmd("--title", f"T{id(answer)}", "--write")
            self.assertNotIn("does not show", out)

    def test_dry_run_writes_nothing(self):
        before = snapshot(self.vault)
        code, out = self.run_cmd("--title", "X", "--hand", "a",
                                 "--hand-font", "Caveat", "--scene",
                                 "The Docks")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE", out)
        self.assertEqual(snapshot(self.vault), before)
        self.ask.assert_not_called()


if __name__ == "__main__":
    unittest.main()

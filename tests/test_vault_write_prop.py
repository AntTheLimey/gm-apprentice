#!/usr/bin/env python3
"""vault_write.py prop-new."""

import io
import json
import shutil
import subprocess
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
        codes = []
        for _ in range(2):
            code, _out = self.run_cmd("--title", "Invitation", "--scene",
                                      "The Docks", "--write")
            codes.append(code)
        self.assertEqual(codes, [0, 1])     # the second hits the title clash
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

    def test_registry_is_not_a_target_for_other_commands(self):
        self.run_cmd("--title", "X", "--hand", "a", "--hand-font", "Caveat",
                     "--write")
        before = self.read(HANDS)
        out = io.StringIO()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                       io.StringIO()):
            code = vw.main([str(self.vault), "timeline", "--under",
                            "## Events", "--file", HANDS, "--write"],
                           stdin="- 1500: Something.\n")
        self.assertEqual(code, 1, out.getvalue())
        self.assertEqual(self.read(HANDS), before)

    def test_new_registry_is_a_create_and_added_hand_an_add(self):
        _c, out = self.run_cmd("--title", "A", "--hand", "a", "--hand-font",
                               "Caveat", "--write")
        self.assertIn("CREATED\t_meta/prop-hands.json", out)
        _c, out = self.run_cmd("--title", "B", "--hand", "b", "--hand-font",
                               "Lobster", "--write")
        self.assertIn("ADDED\t_meta/prop-hands.json", out)

    def test_malformed_entry_refused(self):
        vault = make_vault(self, {**FILES, HANDS: '{"hands": {"a": "x"}}'})
        before = snapshot(vault)
        code, out = self.run_cmd("--title", "X", "--hand", "a", "--write",
                                 vault=vault)
        self.assertEqual(code, 1)
        self.assertIn("hand 'a' is not an object", out)
        self.assertEqual(snapshot(vault), before)

    def test_hand_who_on_existing_hand_is_said_to_be_ignored(self):
        self.run_cmd("--title", "A", "--hand", "a", "--hand-font", "Caveat",
                     "--hand-who", "Ann", "--write")
        _c, out = self.run_cmd("--title", "B", "--hand", "a", "--hand-who",
                               "Bob", "--write")
        self.assertIn("--hand-who ignored", out)
        self.assertIn('"who": "Ann"', self.read(HANDS))

    def test_failing_check_after_writing_is_a_warning_not_nothing_written(
            self):
        self.ask.side_effect = RuntimeError("boom")
        code, out = self.run_cmd("--title", "X", "--write")
        self.assertEqual(code, 0, out)
        self.assertNotIn("nothing written", out)
        self.assertIn("a check after writing failed", out)
        self.assertTrue((self.vault / LYON / "Props/X.md").is_file())

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
        # The shape `explain <rel> --json` really answers with.
        self.ask.return_value = vc.ToolAnswer(data={
            "path": f"{LYON}/Props/X.md", "exists": True, "prop": False,
            "verdict": {"bucket": "decide", "code": "DIR_UNMAPPED",
                        "reason": "its folder is not in "
                                  "publish.folder_map",
                        "outputPath": None}})
        code, out = self.run_cmd("--title", "X", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn(f"the site does not show notes in {LYON}/Props: add it "
                      f"to player_site.folder_map (gm-publish settings set",
                      out)
        self.ask.assert_called_with(
            self.vault, ["explain", f"{LYON}/Props/X.md"])

    def test_mapped_folder_or_no_site_says_nothing(self):
        for answer in (vc.ToolAnswer(data={"verdict": {"code": "OK"}}),
                       vc.ToolAnswer()):
            self.ask.return_value = answer
            _code, out = self.run_cmd("--title", f"T{id(answer)}", "--write")
            self.assertNotIn("does not show", out)
            self.assertNotIn("WARNING", out)

    def test_folder_check_the_tool_cannot_answer_says_so(self):
        self.ask.return_value = vc.ToolAnswer(why="node is not on PATH")
        code, out = self.run_cmd("--title", "X", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WARNING\t{LYON}/Props/X.md\t\tcould not check whether "
                      f"the site shows notes in {LYON}/Props: node is not on "
                      f"PATH", out)

    def test_reused_hand_with_a_font_the_site_cannot_use_is_refused(self):
        for entry in ('{}', '{"font": " Caveat"}', '{"font": "Bad;Font"}'):
            vault = make_vault(self, {**FILES, HANDS: '{"hands": {"a": %s}}' % entry})
            before = snapshot(vault)
            code, out = self.run_cmd("--title", "X", "--hand", "a", "--write",
                                     vault=vault)
            self.assertEqual(code, 1, out)
            self.assertIn('hand "a" in _meta/prop-hands.json has no font the '
                          'site can use', out)
            self.assertEqual(snapshot(vault), before)

    def test_dry_run_writes_nothing(self):
        before = snapshot(self.vault)
        code, out = self.run_cmd("--title", "X", "--hand", "a",
                                 "--hand-font", "Caveat", "--scene",
                                 "The Docks")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE", out)
        self.assertEqual(snapshot(self.vault), before)
        self.ask.assert_not_called()


class PropHand(unittest.TestCase):
    """prop-hand: the registry half of prop-new, for props already filed."""

    def setUp(self):
        self.vault = make_vault(self)

    def run_cmd(self, *argv, vault=None):
        out = io.StringIO()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                       io.StringIO()):
            code = vw.main([str(vault or self.vault), "prop-hand", *argv])
        return code, out.getvalue()

    def read(self, rel):
        return (self.vault / rel).read_text(encoding="utf-8")

    def test_new_registry_is_created(self):
        code, out = self.run_cmd("--hand", "sophia", "--hand-font", "Caveat",
                                 "--hand-who", "Sophia", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("CREATED\t_meta/prop-hands.json\t\thand sophia is "
                      "Caveat", out)
        self.assertEqual(
            json.loads(self.read(HANDS)),
            {"hands": {"sophia": {"font": "Caveat", "who": "Sophia"}}})

    def test_second_hand_is_added(self):
        self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write")
        code, out = self.run_cmd("--hand", "b", "--hand-font", "Lobster",
                                 "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("ADDED\t_meta/prop-hands.json", out)
        self.assertEqual(set(json.loads(self.read(HANDS))["hands"]),
                         {"a", "b"})

    def test_same_hand_same_font_is_a_skip(self):
        self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write")
        before = snapshot(self.vault)
        code, out = self.run_cmd("--hand", "a", "--hand-font", "Caveat",
                                 "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("SKIP\t_meta/prop-hands.json\t\thand a is Caveat", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_same_hand_other_font_refused(self):
        self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write")
        before = snapshot(self.vault)
        code, out = self.run_cmd("--hand", "a", "--hand-font", "Lobster",
                                 "--write")
        self.assertEqual(code, 1)
        self.assertIn('hand "a" is already Caveat; use it, or choose a new '
                      'id for a new writer', out)
        self.assertEqual(snapshot(self.vault), before)

    def test_hand_who_on_existing_hand_is_said_to_be_ignored(self):
        self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write")
        _c, out = self.run_cmd("--hand", "a", "--hand-font", "Caveat",
                               "--hand-who", "Ann", "--write")
        self.assertIn("WARNING\t_meta/prop-hands.json\t\t--hand-who "
                      "ignored", out)

    def test_bad_registry_refused_nothing_written(self):
        for bad in ("not json", '{"other": 1}', '{"hands": {"a": "x"}}'):
            vault = make_vault(self, {**FILES, HANDS: bad})
            before = snapshot(vault)
            code, out = self.run_cmd("--hand", "b", "--hand-font", "Caveat",
                                     "--write", vault=vault)
            self.assertEqual(code, 1, out)
            self.assertEqual(snapshot(vault), before)

    def test_bad_hand_id_and_font_refused(self):
        for argv in (("--hand", "Bad Id", "--hand-font", "Caveat"),
                     ("--hand", "ok", "--hand-font", "Bad;Font"),
                     ("--hand", "ok", "--hand-font", " La Belle Aurore"),
                     ("--hand", "ok", "--hand-font", "La  Belle Aurore"),
                     ("--hand", "ok", "--hand-font", "A" * 65)):
            code, _out = self.run_cmd(*argv, "--write")
            self.assertEqual(code, 1, argv)
        self.assertFalse((self.vault / HANDS).exists())

    def test_hyphenated_and_long_font_names_the_site_reads_are_accepted(self):
        for hand, font in (("a", "Zilla-Slab Highlight"), ("b", "A" * 64)):
            code, out = self.run_cmd("--hand", hand, "--hand-font", font, "--write")
            self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(self.read(HANDS))["hands"]["a"]["font"],
                         "Zilla-Slab Highlight")

    def test_font_rule_matches_the_publish_tools(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not on PATH")
        names = ["Caveat", "La Belle Aurore", " Caveat", "Caveat ", "La  Belle",
                 "Zilla-Slab", "-Lead", "A" * 64, "A" * 65, "", "Bad;Font",
                 "Caf\u00e9", "Two\nLines", "9 Point"]
        fonts = REPO / "tools" / "publish" / "lib" / "fonts.js"
        script = ("const { isValidFamily } = require(process.argv[1]);"
                  "console.log(JSON.stringify(JSON.parse(process.argv[2])"
                  ".map(isValidFamily)));")
        run = subprocess.run([node, "-e", script, str(fonts), json.dumps(names)],
                             capture_output=True, text=True, check=True)
        self.assertEqual([vw.valid_font(n) for n in names], json.loads(run.stdout))

    def test_a_hand_with_an_unusable_font_is_mended_by_giving_one(self):
        vault = make_vault(self, {**FILES, HANDS: '{"hands": {"a": {"font": "Bad;Font", "who": "Ann"}}}'})
        code, out = self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write",
                                 vault=vault)
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads((vault / HANDS).read_text(encoding="utf-8")),
                         {"hands": {"a": {"font": "Caveat", "who": "Ann"}}})

    def test_other_top_level_keys_are_kept(self):
        vault = make_vault(self, {**FILES, HANDS: '{"_note": "kept", "hands": {}}'})
        code, out = self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write",
                                 vault=vault)
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads((vault / HANDS).read_text(encoding="utf-8")),
                         {"_note": "kept", "hands": {"a": {"font": "Caveat", "who": ""}}})

    def test_registry_not_utf8_is_refused_in_the_dry_run(self):
        vault = make_vault(self, FILES)
        (vault / HANDS).write_bytes('{"hands": {"s": {"font": "Caveat", "who": "M\u00e9nard"}}}'
                                    .encode("latin-1"))
        before = snapshot(vault)
        code, out = self.run_cmd("--hand", "roy", "--hand-font", "Caveat", vault=vault)
        self.assertEqual(code, 1, out)
        self.assertIn("_meta/prop-hands.json is not UTF-8 text; fix it by hand first", out)
        self.assertNotIn("WOULD-CREATE", out)
        self.assertEqual(snapshot(vault), before)

    def test_font_is_required(self):
        with mock.patch("sys.stderr", io.StringIO()), \
                self.assertRaises(SystemExit) as caught:
            vw.main([str(self.vault), "prop-hand", "--hand", "a"])
        self.assertEqual(caught.exception.code, 2)

    def test_dry_run_writes_nothing_and_notes_are_untouched(self):
        before = snapshot(self.vault)
        code, out = self.run_cmd("--hand", "a", "--hand-font", "Caveat")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE\t_meta/prop-hands.json", out)
        self.assertEqual(snapshot(self.vault), before)
        self.run_cmd("--hand", "a", "--hand-font", "Caveat", "--write")
        after = snapshot(self.vault)
        self.assertEqual(set(after) - set(before), {HANDS})
        self.assertEqual({k: v for k, v in after.items() if k != HANDS},
                         before)


if __name__ == "__main__":
    unittest.main()

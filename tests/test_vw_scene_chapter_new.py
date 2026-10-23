#!/usr/bin/env python3
"""vault_write.py chapter-new, scene-new and scene-played."""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import index_build as ib  # noqa: E402
import schema_rules  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402

LYON = "Chapters/Chapter 2 - Lyon"
FILES = {
    # A chapter note not named like its folder, found by its title.
    f"{LYON}/Chapter_2_Overview.md":
        '---\ntype: chapter\ntitle: "Lyon"\nsort_order: 2\n---\n',
    "Chapters/Chapter 1 - Paris/Chapter 1 - Paris.md":
        "---\ntype: chapter\ntitle: Paris\nsort_order: 1\n---\n",
    # Dead End shape: two chapter notes in one folder.
    "Chapters/Two/Alpha.md": "---\ntype: chapter\ntitle: Alpha\n---\n",
    "Chapters/Two/Beta.md": "---\ntype: chapter\ntitle: Beta\n---\n",
    f"{LYON}/Sessions/Session 05/Session 05 - The Docks.md":
        "---\ntype: session\nsession_number: 5\n---\n",
    # An old Canticle scene note, CRLF, quoted status, a comment.
    f"{LYON}/Sessions/Session 05/Scenes/Old Scene.md":
        '---\r\ntype: scene\r\nstatus: "ready"\r\nsession: "[[Plan]]"\r\n'
        'tags: [a]\r\n---\r\n\r\nBody stays.\r\n',
}


def make_vault(case, files=FILES):
    vault = Path(tempfile.mkdtemp(prefix="vw-scene-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, *argv):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = vw.main([str(vault), *argv])
    return code, out.getvalue()


def snapshot(vault):
    return {p.relative_to(vault).as_posix(): p.read_bytes()
            for p in vault.rglob("*") if p.is_file()}


class SceneNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self)

    def test_small_scene_dry_run_then_write(self):
        before = snapshot(self.vault)
        rel = f"{LYON}/Scenes/The Docks.md"
        code, out = run(self.vault, "scene-new", "--chapter", "Lyon",
                        "--title", "The Docks")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{rel}", out)
        self.assertEqual(snapshot(self.vault), before)
        code, out = run(self.vault, "scene-new", "--chapter", "Lyon",
                        "--title", "The Docks", "--write")
        self.assertEqual(code, 0, out)
        text = (self.vault / rel).read_text(encoding="utf-8")
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "scene")
        self.assertEqual(fm["status"], "planned")
        # The folder, as every other note in the chapter links it, not
        # the chapter note's own file name.
        self.assertEqual(vl.chapter_of(rel, fm), "Chapter 2 - Lyon")
        self.assertIn('chapter: "[[Chapter 2 - Lyon]]"', text)
        self.assertEqual(fm["played_in"], [])
        self.assertEqual(
            [m for lvl, m in schema_rules.frontmatter_findings(
                fm, None, vl.raw_frontmatter(text)) if lvl == "ERROR"], [])

    def test_index_build_sees_one_chapter_not_two(self):
        before = {c["stem"] for c in ib.collect(self.vault)[1]}
        run(self.vault, "scene-new", "--chapter", "Chapter_2_Overview",
            "--title", "The Docks", "--write")
        chapters = ib.collect(self.vault)[1]
        self.assertEqual({c["stem"] for c in chapters}, before)
        lyon = [c for c in chapters if c["stem"] == "Chapter_2_Overview"]
        self.assertEqual(sorted(s for s, _ in lyon[0]["all_scenes"]),
                         ["Old Scene", "The Docks"])

    def test_title_tier_comes_before_folder_tier(self):
        # "Chapter 2 - Lyon" is Lyon's folder and Rome's title: the title
        # match wins, and the link is the found note's own folder.
        vault = make_vault(self, {**FILES, "Chapters/Rome/Rome_Overview.md":
                                  '---\ntype: chapter\n'
                                  'title: "Chapter 2 - Lyon"\n---\n'})
        code, out = run(vault, "scene-new", "--chapter", "Chapter 2 - Lyon",
                        "--title", "Quay", "--write")
        self.assertEqual(code, 0, out)
        text = (vault / "Chapters/Rome/Scenes/Quay.md").read_text("utf-8")
        self.assertIn('chapter: "[[Rome]]"', text)

    def test_set_piece_gets_its_own_folder(self):
        code, out = run(self.vault, "scene-new", "--chapter",
                        "Chapter_2_Overview", "--title", "The Ball",
                        "--set-piece")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{LYON}/Scenes/The Ball/The Ball.md",
                      out)

    def test_side_adventure_folder(self):
        code, out = run(self.vault, "scene-new", "--chapter", "Lyon",
                        "--title", "Tryout", "--folder",
                        "Side_Adventures/The Audition", "--set-piece")
        self.assertEqual(code, 0, out)
        self.assertIn(f"{LYON}/Side_Adventures/The Audition/Scenes/Tryout/"
                      "Tryout.md", out)

    def test_chapter_by_folder_name(self):
        code, out = run(self.vault, "scene-new", "--chapter",
                        "Chapter 1 - Paris", "--title", "Louvre")
        self.assertEqual(code, 0, out)
        self.assertIn("Chapters/Chapter 1 - Paris/Scenes/Louvre.md", out)

    def test_unknown_or_ambiguous_chapter_refused(self):
        for name in ("Nowhere", "Two"):
            code, out = run(self.vault, "scene-new", "--chapter", name,
                            "--title", "X", "--write")
            self.assertEqual(code, 1, out)
            self.assertIn("nothing written", out)
        self.assertFalse(any("Scenes/X" in k for k in snapshot(self.vault)))

    def test_existing_scene_and_bad_folder_refused(self):
        run(self.vault, "scene-new", "--chapter", "Lyon", "--title", "A",
            "--write")
        code, out = run(self.vault, "scene-new", "--chapter", "Lyon",
                        "--title", "A", "--write")
        self.assertEqual(code, 1, out)
        code, out = run(self.vault, "scene-new", "--chapter", "Lyon",
                        "--title", "B", "--folder", "../Elsewhere")
        self.assertEqual(code, 1, out)


class ChapterNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self)

    def test_creates_chapter(self):
        rel = "Chapters/Chapter 3 - Rome/Chapter 3 - Rome.md"
        code, out = run(self.vault, "chapter-new", "--title",
                        "Chapter 3 - Rome", "--sort-order", "3")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{rel}", out)
        self.assertFalse((self.vault / rel).exists())
        code, out = run(self.vault, "chapter-new", "--title",
                        "Chapter 3 - Rome", "--sort-order", "3", "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter((self.vault / rel).read_text("utf-8"))
        self.assertEqual(fm["type"], "chapter")
        self.assertEqual(fm["title"], "Chapter 3 - Rome")
        self.assertEqual(fm["sort_order"], "3")
        self.assertEqual(fm["status"], "planned")

    def test_default_sort_order_follows_the_highest(self):
        run(self.vault, "chapter-new", "--title", "Rome", "--write")
        text = (self.vault / "Chapters/Rome/Rome.md").read_text("utf-8")
        self.assertEqual(vl.extract_frontmatter(text)["sort_order"], "3")

    def test_duplicate_title_refused(self):
        for title in ("lyon", "CHAPTER 1 - PARIS"):
            code, out = run(self.vault, "chapter-new", "--title", title,
                            "--write")
            self.assertEqual(code, 1, out)
            self.assertIn("already exists", out)
        self.assertFalse((self.vault / "Chapters/lyon").exists())


class ScenePlayedTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self)
        run(self.vault, "scene-new", "--chapter", "Lyon", "--title",
            "The Docks", "--write")
        self.rel = f"{LYON}/Scenes/The Docks.md"

    def played(self, *extra):
        return run(self.vault, "scene-played", "--scene", "The Docks",
                   "--session", "Session 05 - The Docks", *extra)

    def fm(self):
        return vl.extract_frontmatter(
            (self.vault / self.rel).read_text("utf-8"))

    def test_dry_run_changes_nothing(self):
        before = snapshot(self.vault)
        code, out = self.played()
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-ADD\t{self.rel}", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_twice_leaves_one_entry(self):
        for _ in range(2):
            code, out = self.played("--write")
            self.assertEqual(code, 0, out)
        fm = self.fm()
        self.assertEqual(fm["status"], "played")
        self.assertEqual(fm["played_in"], ["[[Session 05 - The Docks]]"])

    def test_paused(self):
        self.played("--paused", "--write")
        self.assertEqual(self.fm()["status"], "paused")

    def test_unknown_scene_or_session_writes_nothing(self):
        before = snapshot(self.vault)
        code, out = run(self.vault, "scene-played", "--scene", "Nope",
                        "--session", "Session 05 - The Docks", "--write")
        self.assertEqual(code, 1, out)
        code, out = run(self.vault, "scene-played", "--scene", "The Docks",
                        "--session", "Session 99", "--write")
        self.assertEqual(code, 1, out)
        self.assertEqual(snapshot(self.vault), before)

    def test_several_scenes_of_one_name_refused(self):
        run(self.vault, "scene-new", "--chapter", "Paris", "--title",
            "The Docks", "--write")
        before = snapshot(self.vault)
        code, out = self.played("--write")
        self.assertEqual(code, 1, out)
        self.assertEqual(snapshot(self.vault), before)

    def test_old_scene_keeps_its_other_fields_and_crlf(self):
        old = f"{LYON}/Sessions/Session 05/Scenes/Old Scene.md"
        code, out = run(self.vault, "scene-played", "--scene", "Old Scene",
                        "--session", "[[Session 05 - The Docks]]", "--write")
        self.assertEqual(code, 0, out)
        raw = (self.vault / old).read_bytes().decode("utf-8")
        self.assertEqual(
            raw, '---\r\ntype: scene\r\nstatus: played\r\n'
            'session: "[[Plan]]"\r\ntags: [a]\r\nplayed_in:\r\n'
            '  - "[[Session 05 - The Docks]]"\r\n---\r\n\r\n'
            'Body stays.\r\n')


if __name__ == "__main__":
    unittest.main()

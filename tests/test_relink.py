#!/usr/bin/env python3
"""relink.py: rename or move a note and rewrite every link to it."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import relink  # noqa: E402


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="relink-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


OLD = "Sessions/Session_4_Wrapup.md"
NEW = "Sessions/Chapter_01_Session_04_Wrap_Up.md"


class WikilinkTests(unittest.TestCase):
    def rewrite(self, line, extra=None):
        files = {OLD: "# S4\n", "NPCs/Hallam.md": f"{line}\n"}
        files.update(extra or {})
        vault = make_vault(self, files)
        p = relink.plan(vault, OLD, NEW)
        return p.texts.get("NPCs/Hallam.md", "unchanged"), p

    def test_every_wikilink_form(self):
        cases = {
            "See [[Session_4_Wrapup]].": "See [[Chapter_01_Session_04_Wrap_Up]].",
            "[[Session_4_Wrapup|S4]]": "[[Chapter_01_Session_04_Wrap_Up|S4]]",
            "[[Session_4_Wrapup#Clues]]": "[[Chapter_01_Session_04_Wrap_Up#Clues]]",
            "[[Session_4_Wrapup^b1]]": "[[Chapter_01_Session_04_Wrap_Up^b1]]",
            "![[Session_4_Wrapup]]": "![[Chapter_01_Session_04_Wrap_Up]]",
            "[[Session_4_Wrapup.md]]": "[[Chapter_01_Session_04_Wrap_Up.md]]",
            "[[Sessions/Session_4_Wrapup]]":
                "[[Sessions/Chapter_01_Session_04_Wrap_Up]]",
            "[[session 4 wrapup]]": "[[Chapter_01_Session_04_Wrap_Up]]",
            "[[Session_4_Wrapup#Clues|the clues]]":
                "[[Chapter_01_Session_04_Wrap_Up#Clues|the clues]]",
        }
        for before, after in cases.items():
            with self.subTest(before=before):
                text, _ = self.rewrite(before)
                self.assertEqual(text, f"{after}\n")

    def test_frontmatter_links(self):
        text, p = self.rewrite(
            "---\nsession: \"[[Session_4_Wrapup]]\"\nrel:\n"
            "  - \"[[Session_4_Wrapup|S4]]\"\n---\nbody")
        self.assertEqual(
            text, "---\nsession: \"[[Chapter_01_Session_04_Wrap_Up]]\"\n"
                  "rel:\n  - \"[[Chapter_01_Session_04_Wrap_Up|S4]]\"\n"
                  "---\nbody\n")
        self.assertEqual([c.lineno for c in p.changes], [2, 4])

    def test_left_alone(self):
        for line in ("```\n[[Session_4_Wrapup]]\n```",
                     "use `[[Session_4_Wrapup]]` like this",
                     "[[Session_4_Wrapups]] and [[Other]]",
                     "[[#Local heading]]"):
            with self.subTest(line=line):
                text, _ = self.rewrite(line)
                self.assertEqual(text, "unchanged")

    def test_alias_links_are_left_alone(self):
        vault = make_vault(self, {
            OLD: "---\naliases: [\"The Fourth\"]\n---\n",
            "A.md": "[[The Fourth]]\n"})
        self.assertEqual(relink.plan(vault, OLD, NEW).texts, {})

    def test_crlf_is_kept(self):
        vault = make_vault(self, {
            OLD: "x\r\n", "A.md": "one\r\n[[Session_4_Wrapup]]\r\ntwo\r\n"})
        self.assertEqual(relink.plan(vault, OLD, NEW).texts["A.md"],
                         "one\r\n[[Chapter_01_Session_04_Wrap_Up]]\r\ntwo\r\n")

    def test_self_links_in_the_moved_note(self):
        vault = make_vault(self, {OLD: "[[Session_4_Wrapup#Top]]\n"})
        self.assertEqual(relink.plan(vault, OLD, NEW).texts[OLD],
                         "[[Chapter_01_Session_04_Wrap_Up#Top]]\n")

    def test_templates_and_hidden_folders_are_not_walked(self):
        vault = make_vault(self, {
            OLD: "x\n", "_Templates/T.md": "[[Session_4_Wrapup]]\n",
            ".obsidian/x.md": "[[Session_4_Wrapup]]\n"})
        self.assertEqual(relink.plan(vault, OLD, NEW).texts, {})

    def test_escaped_pipe_in_table_rows(self):
        text, _ = self.rewrite(
            "| [[Session_4_Wrapup\\|S4]] | [[Session_4_Wrapup#H\\|x]] |")
        self.assertEqual(
            text, "| [[Chapter_01_Session_04_Wrap_Up\\|S4]] | "
                  "[[Chapter_01_Session_04_Wrap_Up#H\\|x]] |\n")

    def test_non_utf8_note_is_warned_about(self):
        vault = make_vault(self, {OLD: "x\n"})
        (vault / "Bad.md").write_bytes(b"\xff\xfe[[Session_4_Wrapup]]\n")
        p = relink.plan(vault, OLD, NEW)
        self.assertEqual(
            p.warnings,
            ["Bad.md is not UTF-8; links in it were not checked"])

    def test_plan_writes_nothing(self):
        vault = make_vault(self, {OLD: "x\n", "A.md": "[[Session_4_Wrapup]]\n"})
        before = {p: p.stat().st_mtime_ns for p in vault.rglob("*")}
        relink.plan(vault, OLD, NEW)
        self.assertEqual(before, {p: p.stat().st_mtime_ns
                                  for p in vault.rglob("*")})


class MarkdownAndCanvasTests(unittest.TestCase):
    def test_markdown_links(self):
        cases = {
            # relative to the linking note (NPCs/)
            "[s4](../Sessions/Session_4_Wrapup.md)":
                "[s4](../Sessions/Chapter_01_Session_04_Wrap_Up.md)",
            # from the vault root
            "[s4](Sessions/Session_4_Wrapup.md#Clues)":
                "[s4](Sessions/Chapter_01_Session_04_Wrap_Up.md#Clues)",
            "[s4](/Sessions/Session_4_Wrapup.md)":
                "[s4](/Sessions/Chapter_01_Session_04_Wrap_Up.md)",
            '[s4](<Sessions/Session_4_Wrapup.md> "t")':
                '[s4](<Sessions/Chapter_01_Session_04_Wrap_Up.md> "t")',
            "[x](https://e.com/Sessions/Session_4_Wrapup.md)":
                "[x](https://e.com/Sessions/Session_4_Wrapup.md)",
        }
        for before, after in cases.items():
            with self.subTest(before=before):
                vault = make_vault(self, {OLD: "x\n",
                                          "NPCs/Hallam.md": f"{before}\n"})
                p = relink.plan(vault, OLD, NEW)
                self.assertEqual(
                    p.texts.get("NPCs/Hallam.md", f"{before}\n"), f"{after}\n")

    def test_percent_encoding_is_kept(self):
        old, new = "Sessions/Old Name.md", "Sessions/New Name.md"
        vault = make_vault(self, {old: "x\n",
                                  "A.md": "[a](Sessions/Old%20Name.md)\n"})
        self.assertEqual(relink.plan(vault, old, new).texts["A.md"],
                         "[a](Sessions/New%20Name.md)\n")

    def test_canvas_file_nodes(self):
        canvas = ('{\n\t"nodes":[\n\t\t{"id":"1","type":"file",'
                  '"file":"Sessions/Session_4_Wrapup.md"}\n\t]\n}')
        vault = make_vault(self, {OLD: "x\n", "Board.canvas": canvas})
        p = relink.plan(vault, OLD, NEW)
        self.assertEqual(p.texts["Board.canvas"],
                         canvas.replace("Session_4_Wrapup",
                                        "Chapter_01_Session_04_Wrap_Up"))


if __name__ == "__main__":
    unittest.main()

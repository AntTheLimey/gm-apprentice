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


class MarkdownAndCanvasFixTests(unittest.TestCase):
    def plan(self, files, old=OLD, new=NEW):
        vault = make_vault(self, files)
        return relink.plan(vault, old, new)

    def test_non_ascii_canvas_names(self):
        old, new = "Sessions/Caf\u00e9.md", "Sessions/Caf\u00e9 2.md"
        raw = '{"nodes":[{"id":"1","type":"file","file":"Sessions/Caf\u00e9.md"}]}'
        esc = '{"nodes":[{"id":"1","type":"file","file":"Sessions/Caf\\u00e9.md"}]}'
        slash = '{"nodes":[{"id":"1","type":"file","file":"Sessions\\/Caf\u00e9.md"}]}'
        p = self.plan({old: "x\n", "R.canvas": raw, "E.canvas": esc,
                       "S.canvas": slash}, old, new)
        self.assertEqual(p.texts["R.canvas"], raw.replace("Caf\u00e9", "Caf\u00e9 2"))
        self.assertEqual(p.texts["E.canvas"],
                         esc.replace("Caf\\u00e9", "Caf\\u00e9 2"))
        self.assertEqual(p.texts["S.canvas"],
                         slash.replace("Sessions\\/Caf\u00e9.md",
                                       "Sessions\\/Caf\u00e9 2.md"))

    def test_code_span_after_length_changing_wikilink(self):
        line = ("[[Session_4_Wrapup]] " * 3
                + "`[x](Sessions/Session_4_Wrapup.md)`")
        p = self.plan({OLD: "x\n", "A.md": line + "\n"})
        self.assertEqual(
            p.texts["A.md"],
            "[[Chapter_01_Session_04_Wrap_Up]] " * 3
            + "`[x](Sessions/Session_4_Wrapup.md)`\n")

    def test_links_in_the_moved_note_are_rebased(self):
        new = "Sessions/Sub/Session_4_Wrapup.md"
        body = ("[me](Session_4_Wrapup.md#Top)\n[o](../A.md)\n"
                "![p](img/p.png)\n[[../X]]\n[[Bare]]\n[u](https://e.com/a.md)\n"
                "[r](/A.md)\n")
        p = self.plan({OLD: body, "A.md": "x\n", "X.md": "x\n"}, OLD, new)
        self.assertEqual(
            p.texts[OLD],
            "[me](Session_4_Wrapup.md#Top)\n[o](../../A.md)\n"
            "![p](../img/p.png)\n[[../../X]]\n[[Bare]]\n"
            "[u](https://e.com/a.md)\n[r](/A.md)\n")
        self.assertEqual(len(p.changes), 3)  # [me] is unchanged text

    def test_rename_in_place_does_not_rebase(self):
        p = self.plan({OLD: "[o](../A.md)\n![p](img/p.png)\n", "A.md": "x\n"})
        self.assertEqual(p.texts, {})

    def test_balanced_parentheses_in_destination(self):
        old, new = "Sessions/Session_(4).md", "Sessions/S4.md"
        p = self.plan({old: "x\n", "A.md": "[a](Sessions/Session_(4).md)\n"},
                      old, new)
        self.assertEqual(p.texts["A.md"], "[a](Sessions/S4.md)\n")

    def test_non_utf8_canvas_is_warned_about(self):
        vault = make_vault(self, {OLD: "x\n"})
        (vault / "Bad.canvas").write_bytes(b"\xff\xfe")
        self.assertEqual(
            relink.plan(vault, OLD, NEW).warnings,
            ["Bad.canvas is not UTF-8; links in it were not checked"])

    def test_wikilinks_in_canvas_text_nodes(self):
        canvas = '{"nodes":[{"id":"1","type":"text","text":"see [[Session_4_Wrapup]]"}]}'
        p = self.plan({OLD: "x\n", "B.canvas": canvas})
        self.assertEqual(
            p.texts["B.canvas"],
            canvas.replace("Session_4_Wrapup", "Chapter_01_Session_04_Wrap_Up"))

    def test_markdown_link_in_frontmatter_embed_and_table(self):
        for before, after in {
            "---\nsession: [s](Sessions/Session_4_Wrapup.md)\n---\n":
                "---\nsession: [s](Sessions/Chapter_01_Session_04_Wrap_Up.md)\n---\n",
            "![](Sessions/Session_4_Wrapup.md)\n":
                "![](Sessions/Chapter_01_Session_04_Wrap_Up.md)\n",
            "| a | [s](Sessions/Session_4_Wrapup.md) |\n":
                "| a | [s](Sessions/Chapter_01_Session_04_Wrap_Up.md) |\n",
        }.items():
            with self.subTest(before=before):
                p = self.plan({OLD: "x\n", "A.md": before})
                self.assertEqual(p.texts["A.md"], after)


if __name__ == "__main__":
    unittest.main()

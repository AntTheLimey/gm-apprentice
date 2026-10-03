#!/usr/bin/env python3
"""relink.py: rename or move a note and rewrite every link to it."""

import io
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
import vaultlib  # noqa: E402,F401


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
        (vault / "Bad.md").write_bytes(b"\xff\xfe[[Other]]\n")
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


class SharedNameTests(unittest.TestCase):
    def test_same_folder_wins_and_others_are_unsure(self):
        vault = make_vault(self, {
            "Ch1/Session_01_Wrap_Up.md": "x\n",
            "Ch2/Session_01_Wrap_Up.md": "x\n",
            "Ch1/Plan.md": "[[Session_01_Wrap_Up]]\n",
            "Ch2/Plan.md": "[[Session_01_Wrap_Up]]\n",
            "Loose.md": "[[Session_01_Wrap_Up]]\n"})
        p = relink.plan(vault, "Ch1/Session_01_Wrap_Up.md",
                        "Ch1/Chapter_01_Session_01_Wrap_Up.md")
        self.assertEqual(set(p.texts), {"Ch1/Plan.md"})
        self.assertEqual([c.rel for c in p.unsure], ["Loose.md"])

    def test_path_written_links_are_exact(self):
        vault = make_vault(self, {
            "Ch1/S.md": "x\n", "Ch2/S.md": "x\n",
            "Loose.md": "[[Ch1/S]] [[Ch2/S]]\n"})
        p = relink.plan(vault, "Ch1/S.md", "Ch1/T.md")
        self.assertEqual(p.texts["Loose.md"], "[[Ch1/T]] [[Ch2/S]]\n")
        self.assertEqual(p.unsure, [])


class RefusalTests(unittest.TestCase):
    def refused(self, files, old, new, usage=False):
        vault = make_vault(self, files)
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, relink.resolve_old(vault, old), new)
        self.assertEqual(cm.exception.usage, usage)
        return str(cm.exception)

    def test_refusals(self):
        base = {OLD: "x\n", "Other/Taken.md": "x\n"}
        self.assertIn("does not exist",
                      self.refused(base, "Sessions/Nope.md", "X"))
        self.assertIn("already",
                      self.refused(base, OLD, "Sessions/Taken.md"))
        self.assertIn("already", self.refused(
            {**base, "Sessions/Taken.md": "x\n"}, OLD, "Sessions/Taken.md"))
        self.assertIn("outside", self.refused(base, OLD, "../Out.md"))
        self.assertIn("same", self.refused(base, OLD, OLD))
        self.assertIn("cannot", self.refused(base, OLD, "Bad|Name"))
        self.assertIn("skipped", self.refused(
            {**base, "_Templates/T.md": "x\n"}, "_Templates/T.md", "U"))

    def test_bare_old_name(self):
        vault = make_vault(self, {OLD: "x\n"})
        self.assertEqual(relink.resolve_old(vault, "Session_4_Wrapup"), OLD)
        self.refused({"A/S.md": "x\n", "B/S.md": "x\n"}, "S", "T", usage=True)

    def test_alias_on_another_note_is_a_warning(self):
        vault = make_vault(self, {
            OLD: "x\n", "B.md": "---\naliases: [\"Fourth\"]\n---\n"})
        p = relink.plan(vault, OLD, "Fourth")
        self.assertTrue(any("B.md" in w for w in p.warnings), p.warnings)

    def test_case_only_rename_is_allowed(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        p = relink.plan(vault, "s4.md", "S4.md")
        self.assertEqual(p.texts["A.md"], "[[S4]]\n")

    def test_non_utf8_note_that_links_is_refused(self):
        vault = make_vault(self, {OLD: "x\n"})
        (vault / "Bad.md").write_bytes(b"\xff [[Session_4_Wrapup]]\n")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, OLD, NEW)
        self.assertIn("Bad.md", str(cm.exception))


class ReviewFixTests(unittest.TestCase):
    def test_uri_schemes_are_not_rebased_in_a_moved_note(self):
        new = "Sessions/Sub/Session_4_Wrapup.md"
        body = "[t](tel:+1555)\n[d](data:image/png;base64,AAAA)\n"
        vault = make_vault(self, {OLD: body})
        p = relink.plan(vault, OLD, new)
        self.assertEqual(p.texts, {})

    def test_canvas_text_node_new_name_is_json_escaped(self):
        import json
        canvas = ('{"nodes":[{"id":"1","type":"text",'
                  '"text":"see [[Session_4_Wrapup]]"}]}')
        vault = make_vault(self, {OLD: "x\n", "B.canvas": canvas})
        p = relink.plan(vault, OLD, 'Sessions/Say "hi".md')
        got = json.loads(p.texts["B.canvas"])
        self.assertEqual(got["nodes"][0]["text"], 'see [[Say "hi"]]')


class FixRound1Tests(unittest.TestCase):
    def refused(self, name, data, files=None, new=NEW):
        vault = make_vault(self, {OLD: "x\n", **(files or {})})
        (vault / name).write_bytes(data)
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, OLD, new)
        return str(cm.exception)

    def planned(self, name, data, new=NEW):
        vault = make_vault(self, {OLD: "x\n"})
        (vault / name).write_bytes(data)
        return relink.plan(vault, OLD, new)

    def test_canvas_alias_is_not_escaped_twice(self):
        import json
        canvas = ('{"nodes":[{"id":"1","type":"text","text":'
                  '"[[Session_4_Wrapup|Say \\"hi\\"]]"}]}')
        vault = make_vault(self, {OLD: "x\n", "B.canvas": canvas})
        p = relink.plan(vault, OLD, 'Sessions/Q "x".md')
        got = json.loads(p.texts["B.canvas"])["nodes"][0]["text"]
        self.assertEqual(got, '[[Q "x"|Say "hi"]]')

    def test_non_utf8_note_with_markdown_link_is_refused(self):
        msg = self.refused("Bad.md", b"\xff [t](Sessions/Session_4_Wrapup.md)\n")
        self.assertIn("Bad.md", msg)

    def test_non_utf8_note_with_unsure_link_only_warns(self):
        vault = make_vault(self, {
            OLD: "x\n", "Other/Session_4_Wrapup.md": "x\n"})
        (vault / "Bad.md").write_bytes(b"\xff [[Session_4_Wrapup]]\n")
        p = relink.plan(vault, OLD, NEW)
        self.assertEqual(
            p.warnings, ["Bad.md is not UTF-8; links in it were not checked"])

    def test_new_in_skipped_folder_is_refused(self):
        for new in ("_Templates/X.md", "_inbox/X.md", ".hidden/X.md"):
            vault = make_vault(self, {OLD: "x\n"})
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, OLD, new)
            self.assertIn("skip", str(cm.exception))

    def test_non_utf8_canvas_with_old_path_is_refused(self):
        msg = self.refused(
            "Bad.canvas", b'\xff{"file":"Sessions/Session_4_Wrapup.md"}')
        self.assertIn("Bad.canvas", msg)

    def test_non_utf8_canvas_without_old_path_warns(self):
        p = self.planned("Bad.canvas", b'\xff{"file":"Other.md"}')
        self.assertEqual(
            p.warnings,
            ["Bad.canvas is not UTF-8; links in it were not checked"])


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {
            OLD: "[[Session_4_Wrapup#Top]]\n",
            "A.md": "[[Session_4_Wrapup]]\r\n",
            "B.md": "see [[Session_4_Wrapup|S4]]\n"})

    def snapshot(self):
        return {p.relative_to(self.vault).as_posix(): p.read_bytes()
                for p in self.vault.rglob("*") if p.is_file()}

    def test_apply_moves_and_rewrites(self):
        rows = relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertFalse((self.vault / OLD).exists())
        self.assertEqual(read(self.vault, NEW),
                         "[[Chapter_01_Session_04_Wrap_Up#Top]]\n")
        self.assertEqual(read(self.vault, "A.md"),
                         "[[Chapter_01_Session_04_Wrap_Up]]\r\n")
        self.assertTrue(rows[0].startswith(f"RENAMED\t{OLD}\t{NEW}"), rows)

    def fail_replace_on(self, *which):
        real = os.replace
        calls = []

        def flaky(src, dst):
            calls.append(dst)
            if len(calls) in which:
                raise OSError("disk full")
            real(src, dst)
        return mock.patch.object(relink.os, "replace", flaky)

    def test_a_failed_write_puts_everything_back(self):
        before = self.snapshot()
        with self.fail_replace_on(2):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertIn("as it was", str(cm.exception))
        self.assertEqual(before, self.snapshot())

    def test_a_failed_restore_names_the_stuck_note(self):
        with self.fail_replace_on(2, 3):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertIn("A.md", str(cm.exception))
        self.assertIn("could not be put back", str(cm.exception))

    def test_interrupt_puts_everything_back_and_reraises(self):
        before = self.snapshot()
        real = os.replace
        n = []

        def interrupt(src, dst):
            n.append(1)
            if len(n) == 2:
                raise KeyboardInterrupt
            real(src, dst)
        with mock.patch.object(relink.os, "replace", interrupt):
            with self.assertRaises(KeyboardInterrupt):
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertEqual(before, self.snapshot())

    def test_a_restore_keeps_going_past_a_failed_note(self):
        with self.fail_replace_on(3, 4):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertIn("A.md", str(cm.exception))
        self.assertNotIn("B.md", str(cm.exception))
        self.assertEqual(read(self.vault, "B.md"),
                         "see [[Session_4_Wrapup|S4]]\n")

    def test_an_interrupt_inside_a_write_still_restores_that_note(self):
        before = self.snapshot()
        real = relink.write_text_atomic
        n = []

        def write_then_interrupt(path, text):
            real(path, text)
            n.append(1)
            if len(n) == 1:
                raise KeyboardInterrupt
        with mock.patch.object(relink, "write_text_atomic",
                               write_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertEqual(before, self.snapshot())

    def test_system_exit_restores_and_reraises(self):
        before = self.snapshot()
        with mock.patch.object(relink.os, "rename", side_effect=SystemExit(3)):
            with self.assertRaises(SystemExit):
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertEqual(before, self.snapshot())

    def test_any_other_failure_becomes_a_refusal_after_restore(self):
        before = self.snapshot()
        with mock.patch.object(relink.os, "rename",
                               side_effect=RuntimeError("odd")):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertIn("as it was", str(cm.exception))
        self.assertEqual(before, self.snapshot())

    def test_a_note_added_since_the_plan_is_refused(self):
        p = relink.plan(self.vault, OLD, NEW)
        (self.vault / "C.md").write_bytes(b"[[Session_4_Wrapup]]\n")
        before = self.snapshot()
        with self.assertRaises(relink.RelinkError) as cm:
            relink.apply(p)
        self.assertIn("changed since", str(cm.exception))
        self.assertEqual(before, self.snapshot())

    def test_a_note_that_stopped_being_utf8_is_named(self):
        p = relink.plan(self.vault, OLD, NEW)
        (self.vault / "B.md").write_bytes(b"\xff\xfe")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.apply(p)
        self.assertIn("B.md", str(cm.exception))
        self.assertIn("UTF-8", str(cm.exception))

    def test_new_folders_are_removed_when_the_move_fails(self):
        before = self.snapshot()
        dirs = {p for p in self.vault.rglob("*") if p.is_dir()}
        with mock.patch.object(relink.os, "rename",
                               side_effect=OSError("locked")):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(self.vault, OLD, "New/Deep/X.md"))
        self.assertEqual(before, self.snapshot())
        self.assertEqual(dirs, {p for p in self.vault.rglob("*")
                                if p.is_dir()})

    def test_a_failed_move_puts_everything_back(self):
        before = self.snapshot()
        with mock.patch.object(relink.os, "rename",
                               side_effect=OSError("locked")):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(self.vault, OLD, NEW))
        self.assertEqual(before, self.snapshot())

    def test_a_stale_plan_is_refused(self):
        p = relink.plan(self.vault, OLD, NEW)
        (self.vault / "B.md").write_bytes(b"edited [[Session_4_Wrapup]]\n")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.apply(p)
        self.assertIn("changed since", str(cm.exception))
        self.assertTrue((self.vault / OLD).exists())

    def test_case_only_rename_applies(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertIn("S4.md", os.listdir(vault))
        self.assertNotIn("s4.md", os.listdir(vault))

    def test_graph_check_agrees_afterwards(self):
        relink.apply(relink.plan(self.vault, OLD, NEW))
        out = subprocess.run(
            [sys.executable, str(SCRIPTS / "graph_check.py"),
             str(self.vault), "unresolved"],
            capture_output=True, text=True, check=True).stdout
        self.assertTrue(out.startswith("# count: 0"), out)


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPTS / "relink.py"), *map(str, args)],
            capture_output=True, text=True)

    def test_plan_then_apply(self):
        vault = make_vault(self, {OLD: "x\n", "A.md": "[[Session_4_Wrapup]]\n"})
        r = self.run_cli(vault, OLD, "Chapter_01_Session_04_Wrap_Up")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"WOULD-RENAME\t{OLD}\t{NEW}", r.stdout)
        self.assertIn("WOULD-RELINK\tA.md:1\t[[Session_4_Wrapup]] -> "
                      "[[Chapter_01_Session_04_Wrap_Up]]", r.stdout)
        self.assertTrue((vault / OLD).exists())
        r = self.run_cli(vault, OLD, "Chapter_01_Session_04_Wrap_Up", "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("RELINKED\tA.md:1", r.stdout)
        self.assertTrue((vault / NEW).exists())

    def test_exit_codes(self):
        vault = make_vault(self, {"A/S.md": "x\n", "B/S.md": "x\n"})
        self.assertEqual(self.run_cli(vault, "S", "T").returncode, 2)
        self.assertEqual(self.run_cli(vault, "A/S.md", "B/S.md").returncode, 1)
        self.assertEqual(self.run_cli(vault / "nope", "x", "y").returncode, 2)


class ApplyExtraTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {
            OLD: "x\n", "A.md": "[[Session_4_Wrapup]]\n"})

    def test_old_gone_since_plan_is_refused(self):
        p = relink.plan(self.vault, OLD, NEW)
        (self.vault / OLD).unlink()
        with self.assertRaises(relink.RelinkError) as cm:
            relink.apply(p)
        self.assertIn("changed since", str(cm.exception))
        self.assertEqual(read(self.vault, "A.md"), "[[Session_4_Wrapup]]\n")

    def test_new_appeared_since_plan_is_refused(self):
        p = relink.plan(self.vault, OLD, NEW)
        (self.vault / NEW).write_bytes(b"other\n")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.apply(p)
        self.assertIn("changed since", str(cm.exception))
        self.assertEqual(read(self.vault, "A.md"), "[[Session_4_Wrapup]]\n")
        self.assertEqual(read(self.vault, NEW), "other\n")

    def test_case_only_move_failure_puts_everything_back(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        before = {p.name: p.read_bytes() for p in vault.iterdir()}
        real = os.rename
        n = []

        def second_fails(a, b):
            n.append(1)
            if len(n) == 2:
                raise OSError("locked")
            real(a, b)
        with mock.patch.object(relink.os, "rename", second_fails):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertEqual(before, {p.name: p.read_bytes()
                                  for p in vault.iterdir()})

    def test_case_only_is_refused_when_new_is_a_different_file(self):
        vault = make_vault(self, {"s4.md": "x\n"})
        with mock.patch.object(relink.Path, "exists", return_value=True), \
                mock.patch.object(relink.os.path, "samefile",
                                  return_value=False):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, "s4.md", "S4.md")
        self.assertIn("already exists", str(cm.exception))

    def test_stranded_note_is_named_not_called_as_it_was(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        real = os.rename
        n = []

        def flaky(a, b):
            n.append(1)
            if len(n) >= 2:
                raise OSError("locked")
            real(a, b)
        with mock.patch.object(relink.os, "rename", flaky):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertIn(".s4.md.relink", str(cm.exception))
        self.assertNotIn("as it was", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[s4]]\n")

    def test_interrupt_between_the_two_case_renames_puts_note_back(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        real = os.rename
        n = []

        def flaky(a, b):
            n.append(1)
            if len(n) == 2:
                raise KeyboardInterrupt
            real(a, b)
        with mock.patch.object(relink.os, "rename", flaky):
            with self.assertRaises(KeyboardInterrupt):
                relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertEqual(sorted(os.listdir(vault)), ["A.md", "s4.md"])
        self.assertEqual(read(vault, "A.md"), "[[s4]]\n")

    def test_interrupt_that_strands_the_note_names_it(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        real = os.rename
        n = []

        def flaky(a, b):
            n.append(1)
            if len(n) == 2:
                raise KeyboardInterrupt
            if len(n) == 3:
                raise OSError("locked")
            real(a, b)
        with mock.patch.object(relink.os, "rename", flaky):
            with self.assertRaises(KeyboardInterrupt) as cm:
                relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertIn(".s4.md.relink", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[s4]]\n")

    def test_main_reports_an_interrupt_in_one_line(self):
        vault = make_vault(self, {"s4.md": "x\n"})
        err = io.StringIO()
        with mock.patch.object(relink, "apply",
                               side_effect=KeyboardInterrupt("stopped")), \
                mock.patch.object(sys, "stderr", err):
            code = relink.main([str(vault), "s4.md", "t4.md", "--apply"])
        self.assertEqual(code, 130)
        self.assertEqual(err.getvalue(), "relink.py: interrupted; stopped\n")

    def test_unreadable_note_in_the_utf8_branch_is_a_refusal(self):
        vault = make_vault(self, {"s4.md": "x\n", "Bad.md": "y\n"})
        real = Path.read_bytes
        n = []

        def flaky(self_):
            if self_.name == "Bad.md":
                n.append(1)
                if len(n) == 1:
                    return b"\xff"
                raise PermissionError("denied")
            return real(self_)
        with mock.patch.object(Path, "read_bytes", flaky):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, "s4.md", "t4.md")
        self.assertIn("Bad.md", str(cm.exception))

    def rename_then_interrupt(self, nth):
        real = os.rename
        n = []

        def flaky(a, b):
            real(a, b)
            n.append(1)
            if len(n) == nth:
                raise KeyboardInterrupt
        return mock.patch.object(relink.os, "rename", flaky)

    def test_interrupt_just_after_a_plain_move_keeps_the_links(self):
        vault = make_vault(self, {OLD: "x\n", "A.md": "[[Session_4_Wrapup]]\n"})
        with self.rename_then_interrupt(1):
            with self.assertRaises(KeyboardInterrupt) as cm:
                relink.apply(relink.plan(vault, OLD, NEW))
        self.assertIn("renamed", str(cm.exception))
        self.assertNotIn("as it was", str(cm.exception))
        self.assertTrue((vault / NEW).exists())
        self.assertFalse((vault / OLD).exists())
        self.assertEqual(read(vault, "A.md"),
                         "[[Chapter_01_Session_04_Wrap_Up]]\n")

    def test_interrupt_just_after_the_case_only_move_keeps_the_links(self):
        vault = make_vault(self, {"s4.md": "x\n", "A.md": "[[s4]]\n"})
        with self.rename_then_interrupt(2):
            with self.assertRaises(KeyboardInterrupt) as cm:
                relink.apply(relink.plan(vault, "s4.md", "S4.md"))
        self.assertIn("renamed", str(cm.exception))
        self.assertNotIn("stranded", str(cm.exception))
        self.assertEqual(sorted(os.listdir(vault)), ["A.md", "S4.md"])
        self.assertEqual(read(vault, "A.md"), "[[S4]]\n")

    def test_leftover_temp_name_is_refused_up_front(self):
        vault = make_vault(self, {"s4.md": "x\n", ".s4.md.relink": "keep\n"})
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, "s4.md", "S4.md")
        self.assertIn(".s4.md.relink", str(cm.exception))

    def test_rows_include_warnings_unsure_and_one_total(self):
        vault = make_vault(self, {
            OLD: "x\n", "A.md": "[[Session_4_Wrapup]]\n",
            "Bad.md": b"\xff".decode("latin-1")})
        (vault / "Bad.md").write_bytes(b"\xff\xfe")
        out = relink.rows(relink.plan(vault, OLD, NEW))
        self.assertTrue(any(r.startswith("WARNING\tBad.md") for r in out), out)
        self.assertEqual([r for r in out if r.startswith("#")],
                         ["# 1 rename, 1 link(s) in 1 note(s)"])
        self.assertTrue(out[-1].startswith("# "))

    def test_nfd_note_is_rewritten_from_nfc_links(self):
        import unicodedata
        nfc = unicodedata.normalize("NFC", "Tich\u00e1")
        nfd = unicodedata.normalize("NFD", nfc)
        vault = make_vault(self, {
            f"NPCs/{nfd}.md": "x\n",
            "A.md": f"[[{nfc}]] and [[NPCs/{nfc}|T]] and [x](NPCs/{nfc}.md)\n"})
        p = relink.plan(vault, f"NPCs/{nfd}.md", "Ticha.md")
        self.assertEqual(p.texts["A.md"],
                         "[[Ticha]] and [[NPCs/Ticha|T]] and [x](NPCs/Ticha.md)\n")

    def test_new_is_written_exactly_as_given(self):
        import unicodedata
        nfd = unicodedata.normalize("NFD", "Tich\u00e1")
        vault = make_vault(self, {"Old.md": "x\n", "A.md": "[[Old]]\n"})
        p = relink.plan(vault, "Old.md", f"{nfd}.md")
        self.assertEqual(p.texts["A.md"], f"[[{nfd}]]\n")

    def test_nfc_old_names_an_nfd_note_in_a_canvas(self):
        import unicodedata
        nfc = unicodedata.normalize("NFC", "Tich\u00e1")
        nfd = unicodedata.normalize("NFD", nfc)
        vault = make_vault(self, {
            f"{nfd}.md": "x\n",
            "c.canvas": '{"nodes":[{"file":"%s.md"}]}\n' % nfc})
        p = relink.plan(vault, f"{nfd}.md", "Ticha.md")
        self.assertIn('"file":"Ticha.md"', p.texts["c.canvas"])


class MovedTests(unittest.TestCase):
    def test_case_only_not_moved_while_old_exact_name_is_listed(self):
        vault = make_vault(self, {"s4.md": "x\n"})
        p = relink.Plan(vault, "s4.md", "S4.md")
        with mock.patch.object(relink.os, "listdir",
                               return_value=["S4.md", "s4.md"]):
            self.assertFalse(relink._moved(p))

    def test_case_only_moved_when_old_exact_name_is_gone(self):
        vault = make_vault(self, {"s4.md": "x\n"})
        p = relink.Plan(vault, "s4.md", "S4.md")
        with mock.patch.object(relink.os, "listdir",
                               return_value=["S4.md"]):
            self.assertTrue(relink._moved(p))

    def listing(self, vault, here, there):
        """os.listdir as a case-sensitive file system answers it: `here`
        is what OLD's folder holds, `there` what NEW's folder holds."""
        def fake(path):
            path = Path(path)
            if path == vault / "Sub":
                return here
            if path == vault / "sub":
                return there
            raise OSError(path)
        return mock.patch.object(relink.os, "listdir", fake)

    def test_folder_case_move_counts_once_the_file_is_in_new_folder(self):
        # _move never renames a folder: the file leaves Sub/ for sub/.
        vault = make_vault(self, {"Sub/a.md": "x\n"})
        p = relink.Plan(vault, "Sub/a.md", "sub/a.md")
        with self.listing(vault, [], ["a.md"]):
            self.assertTrue(relink._moved(p))

    def test_folder_case_move_not_done_while_the_file_is_still_in_old_folder(self):
        vault = make_vault(self, {"Sub/a.md": "x\n"})
        p = relink.Plan(vault, "Sub/a.md", "sub/a.md")
        with self.listing(vault, ["a.md"], ["a.md"]):
            self.assertFalse(relink._moved(p))

    def test_case_only_in_the_file_name_in_a_folder_the_other_way(self):
        vault = make_vault(self, {"Sub/a.md": "x\n"})
        p = relink.Plan(vault, "Sub/a.md", "sub/A.md")
        with self.listing(vault, [], ["A.md"]):
            self.assertTrue(relink._moved(p))


PC_OLD = "Characters/PCs/Emma_Wentworth.md"
PC_NEW = "Characters/PCs/Emma_Wentworth_Hale.md"
PUBLISH_TOOL = (Path(__file__).resolve().parent.parent
                / "tools" / "publish" / "bin" / "gm-publish.js")
MANIFEST = ("---\ngenerated: 2026-10-03\n---\n\n## Publishing (1 files)\n\n"
            f"- [x] {PC_OLD}\n\n## Excluded (0 files)\n\n")
SITE_CONFIG = "---\npublish:\n  site: true\n  mode: player\n---\n"


@unittest.skipUnless(shutil.which("node"), "needs Node")
class PublishListTests(unittest.TestCase):
    """A rename keeps the page on the site's publish list."""

    def vault(self, extra=None, pc="---\ntype: pc\n---\n# Emma\n"):
        files = {PC_OLD: pc, "_meta/publish-manifest.md": MANIFEST}
        files.update(extra or {})
        return make_vault(self, files)

    def snapshot(self, vault):
        return {p.relative_to(vault).as_posix(): p.read_bytes()
                for p in vault.rglob("*") if p.is_file()}

    def test_the_plan_shows_the_manifest_row_and_apply_rewrites_it(self):
        vault = self.vault()
        p = relink.plan(vault, PC_OLD, PC_NEW)
        self.assertIn(f"WOULD-REPUBLISH\t_meta/publish-manifest.md\t"
                      f"{PC_OLD} -> {PC_NEW}", relink.rows(p))
        self.assertEqual(read(vault, "_meta/publish-manifest.md"), MANIFEST)
        rows = relink.apply(p)
        self.assertIn(f"REPUBLISHED\t_meta/publish-manifest.md\t"
                      f"{PC_OLD} -> {PC_NEW}", rows)
        self.assertEqual(read(vault, "_meta/publish-manifest.md"),
                         MANIFEST.replace(PC_OLD, PC_NEW))

    def test_a_crlf_manifest_stays_crlf(self):
        crlf = MANIFEST.replace("\n", "\r\n")
        vault = self.vault({"_meta/publish-manifest.md": crlf})
        relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(read(vault, "_meta/publish-manifest.md"),
                         crlf.replace(PC_OLD, PC_NEW))

    def test_a_failure_after_the_manifest_write_restores_it(self):
        vault = self.vault({"A.md": "[[Emma_Wentworth]]\n"})
        before = self.snapshot(vault)
        with mock.patch.object(relink, "_move", side_effect=OSError("full")):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(before, self.snapshot(vault))

    def test_an_interrupt_after_the_manifest_write_restores_it(self):
        vault = self.vault()
        before = self.snapshot(vault)
        with mock.patch.object(relink, "_move", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(before, self.snapshot(vault))

    def test_a_tool_that_cannot_be_asked_refuses_and_writes_nothing(self):
        vault = self.vault()
        before = self.snapshot(vault)
        gone = PUBLISH_TOOL.with_name("missing.js")
        with mock.patch.object(relink.vaultlib._LINES_BY_TOOL[relink.vaultlib.PUBLISH_TOOL],
                               "tool", gone):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, PC_OLD, PC_NEW)
        self.assertEqual(
            str(cm.exception), f"{PC_OLD} is on the site's publish list and the "
            f"publish tool could not be asked to update it; nothing was changed")
        self.assertEqual(before, self.snapshot(vault))

    def test_a_vault_with_no_manifest_never_asks_the_tool(self):
        vault = make_vault(self, {PC_OLD: "---\ntype: pc\n---\n",
                                  "A.md": "[[Emma_Wentworth]]\n"})
        with mock.patch.object(relink, "publish_rename_refs") as spy, \
                mock.patch.object(relink, "vault_site") as site:
            p = relink.plan(vault, PC_OLD, PC_NEW)
        spy.assert_not_called()
        site.assert_not_called()
        self.assertEqual(set(p.texts), {"A.md"})

    def test_a_manifest_the_links_also_change_gets_both_edits(self):
        vault = self.vault({"_meta/publish-manifest.md":
                            MANIFEST + "[[Emma_Wentworth]]\n"})
        p = relink.plan(vault, PC_OLD, PC_NEW)
        self.assertEqual(p.texts["_meta/publish-manifest.md"],
                         (MANIFEST + "[[Emma_Wentworth]]\n").replace(
                             PC_OLD, PC_NEW).replace("[[Emma_Wentworth]]",
                                                     "[[Emma_Wentworth_Hale]]"))

    def test_a_file_the_tool_and_the_links_both_change_gets_both_edits(self):
        cfg = ("---\npublish:\n  site: true\n  landing:\n    featured_npcs: [Hallam]\n---\n"
               "[[Hallam]]\n")
        vault = make_vault(self, {"NPCs/Hallam.md": "---\ntype: npc\n---\n",
                                  "_meta/vault-config.md": cfg})
        p = relink.plan(vault, "NPCs/Hallam.md", "NPCs/Hallam_Reeve.md")
        self.assertEqual(p.originals["_meta/vault-config.md"], cfg)
        self.assertEqual(
            p.texts["_meta/vault-config.md"],
            "---\npublish:\n  site: true\n  landing:\n    featured_npcs: [Hallam_Reeve]\n---\n"
            "[[Hallam_Reeve]]\n")
        self.assertEqual(len([c for c in p.changes
                              if c.rel == "_meta/vault-config.md"]), 1)


@unittest.skipUnless(shutil.which("node"), "needs Node")
class LiveKeyTests(unittest.TestCase):
    """Renaming a PC pins the key its live state is stored under."""

    def vault(self, pc="---\ntype: pc\nplayer_name: Missy\n---\n# Emma\n",
              config=SITE_CONFIG):
        files = {PC_OLD: pc}
        if config:
            files["_meta/vault-config.md"] = config
        return make_vault(self, files)

    def test_the_rename_writes_live_key_in_the_same_apply(self):
        vault = self.vault()
        p = relink.plan(vault, PC_OLD, PC_NEW)
        self.assertIn(f"WOULD-PIN\t{PC_OLD}\tlive_key: emma-wentworth",
                      relink.rows(p))
        self.assertNotIn("live_key", read(vault, PC_OLD))
        rows = relink.apply(p)
        self.assertIn(f"PINNED\t{PC_OLD}\tlive_key: emma-wentworth", rows)
        self.assertEqual(
            read(vault, PC_NEW),
            "---\ntype: pc\nplayer_name: Missy\nlive_key: emma-wentworth\n---\n# Emma\n")

    def test_a_crlf_pc_note_keeps_its_line_endings(self):
        vault = self.vault(pc="---\r\ntype: pc\r\n---\r\n# Emma\r\n")
        relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(
            read(vault, PC_NEW),
            "---\r\ntype: pc\r\nlive_key: emma-wentworth\r\n---\r\n# Emma\r\n")

    def test_a_second_rename_keeps_the_first_key(self):
        vault = self.vault()
        relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        third = "Characters/PCs/Emma_Hale.md"
        p = relink.plan(vault, PC_NEW, third)
        self.assertFalse([r for r in relink.rows(p) if r.startswith("WOULD-PIN")])
        relink.apply(p)
        self.assertIn("live_key: emma-wentworth\n", read(vault, third))
        self.assertEqual(read(vault, third).count("live_key"), 1)

    def test_a_failure_puts_the_note_back_without_the_key(self):
        vault = self.vault()
        before = read(vault, PC_OLD)
        with mock.patch.object(relink, "_move", side_effect=OSError("full")):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(read(vault, PC_OLD), before)

    def test_a_note_that_holds_no_live_state_is_not_pinned(self):
        vault = make_vault(self, {"NPCs/Hallam.md": "---\ntype: npc\n---\n",
                                  "_meta/vault-config.md": SITE_CONFIG})
        p = relink.plan(vault, "NPCs/Hallam.md", "NPCs/Hallam_Reeve.md")
        self.assertFalse([r for r in relink.rows(p) if "PIN" in r])

    def test_a_vault_without_a_site_is_left_alone(self):
        vault = self.vault(config="---\npublish:\n  site: false\n---\n")
        p = relink.plan(vault, PC_OLD, PC_NEW)
        self.assertFalse([r for r in relink.rows(p) if "PIN" in r])

    def test_a_site_whose_tool_cannot_be_asked_refuses(self):
        vault = self.vault()
        gone = PUBLISH_TOOL.with_name("missing.js")
        # The site question is answered; the rename question is not.
        with mock.patch.object(relink, "vault_site", return_value=(True, True, None)), \
                mock.patch.object(relink.vaultlib._LINES_BY_TOOL[relink.vaultlib.PUBLISH_TOOL],
                                  "tool", gone):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, PC_OLD, PC_NEW)
        self.assertIn("nothing was changed", str(cm.exception))

    def test_a_site_dir_with_the_tool_gone_still_counts_as_a_site(self):
        vault = self.vault(config="---\npublish:\n  site_dir: ../site\n---\n")
        before = {p.relative_to(vault).as_posix(): p.read_bytes()
                  for p in vault.rglob("*") if p.is_file()}
        gone = PUBLISH_TOOL.with_name("missing.js")
        lines = relink.vaultlib._LINES_BY_TOOL[relink.vaultlib.PUBLISH_TOOL]
        lines.close()  # a process left open by an earlier test would answer
        with mock.patch.object(lines, "tool", gone):
            with self.assertRaises(relink.RelinkError):
                relink.plan(vault, PC_OLD, PC_NEW)
        self.assertEqual(before, {p.relative_to(vault).as_posix(): p.read_bytes()
                                  for p in vault.rglob("*") if p.is_file()})

    def test_a_pc_moved_without_a_new_name_is_not_pinned(self):
        vault = self.vault()
        p = relink.plan(vault, PC_OLD, "Characters/Retired/Emma_Wentworth.md")
        self.assertFalse([r for r in relink.rows(p) if "PIN" in r])

    def test_a_rename_then_a_build_keeps_the_key_at_the_new_address(self):
        root = Path(tempfile.mkdtemp(prefix="relink-build-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "vault"
        shutil.copytree(PUBLISH_TOOL.parent.parent / "test" / "fixtures"
                        / "with-party-roster", vault)
        cfg = vault / "_meta" / "vault-config.md"
        cfg.write_bytes(cfg.read_bytes().replace(b"publish:\n", b"publish:\n  site: true\n  live_stats: true\n"))
        old, new = "Characters/PCs/Karl Brenner.md", "Characters/PCs/Karl_Hale.md"
        relink.apply(relink.plan(vault, old, new))
        self.assertIn("live_key: karl-brenner", read(vault, new))
        (root / "wrangler.toml").write_text(
            '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n')
        script = (
            "const {build}=require(process.argv[1]);"
            "build({configPath:process.argv[2]});")
        (root / "config.json").write_text(
            '{"vaultPath": %s, "outputDir": %s, "attachmentsDir": "_attachments",'
            '"siteTitle": "Roster Test", "system": "gurps-4e",'
            '"excludeDirs": ["_meta"], "excludeSections": [],'
            '"folderMap": {"Characters/PCs": "characters/pcs"}}'
            % (__import__("json").dumps(str(vault)),
               __import__("json").dumps(str(root / "docs"))))
        r = subprocess.run(
            ["node", "-e", script, str(PUBLISH_TOOL.parent.parent / "lib" / "build.js"),
             str(root / "config.json")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        page = (root / "docs" / "characters" / "pcs" / "karl-hale.html").read_text()
        self.assertIn('"pcSlug":"karl-brenner"', page.replace(" ", ""))


STORY_OLD = "Characters/PCs/Emma_Wentworth_Story.md"
STORY_NEW = "Characters/PCs/Emma_Wentworth_Hale_Story.md"
STORY_TEXT = ('---\ntype: character-story\ncharacter: "[[Emma_Wentworth]]"\n---\n'
              "Back to [[Emma_Wentworth]].\n")


@unittest.skipUnless(shutil.which("node"), "needs Node")
class CompanionTests(unittest.TestCase):
    """A PC's story file moves with it."""

    def vault(self, extra=None):
        files = {PC_OLD: "---\ntype: pc\n---\n# Emma\n",
                 STORY_OLD: STORY_TEXT,
                 "_meta/publish-manifest.md":
                     MANIFEST.replace(f"- [x] {PC_OLD}\n",
                                      f"- [x] {PC_OLD}\n- [x] {STORY_OLD}\n"),
                 "Sessions/S1.md": "[[Emma_Wentworth]] and [[Emma_Wentworth_Story|her tale]]\n"}
        files.update(extra or {})
        return make_vault(self, files)

    def snapshot(self, vault):
        return {p.relative_to(vault).as_posix(): p.read_bytes()
                for p in vault.rglob("*") if p.is_file()}

    def test_both_files_move_and_every_link_to_both_is_rewritten(self):
        vault = self.vault()
        p = relink.plan(vault, PC_OLD, PC_NEW)
        rows = relink.rows(p)
        self.assertIn(f"WOULD-RENAME\t{PC_OLD}\t{PC_NEW}", rows)
        self.assertIn(f"WOULD-RENAME\t{STORY_OLD}\t{STORY_NEW}", rows)
        self.assertTrue(rows[-1].startswith("# 2 renames, "), rows[-1])
        relink.apply(p)
        self.assertFalse((vault / PC_OLD).exists())
        self.assertFalse((vault / STORY_OLD).exists())
        self.assertEqual(
            read(vault, "Sessions/S1.md"),
            "[[Emma_Wentworth_Hale]] and [[Emma_Wentworth_Hale_Story|her tale]]\n")
        self.assertEqual(
            read(vault, STORY_NEW),
            STORY_TEXT.replace("Emma_Wentworth", "Emma_Wentworth_Hale"))
        manifest = read(vault, "_meta/publish-manifest.md")
        self.assertIn(PC_NEW, manifest)
        self.assertIn(STORY_NEW, manifest)
        self.assertNotIn(STORY_OLD, manifest)

    def test_the_story_alone_is_refused_and_nothing_is_written(self):
        vault = self.vault()
        before = self.snapshot(vault)
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, STORY_OLD, "Characters/PCs/Emma_Tale.md")
        self.assertIn("rename Emma_Wentworth and the story moves with it",
                      str(cm.exception))
        self.assertEqual(before, self.snapshot(vault))

    def test_a_companion_target_that_exists_refuses_the_whole_rename(self):
        vault = self.vault({STORY_NEW: "x\n"})
        before = self.snapshot(vault)
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, PC_OLD, PC_NEW)
        self.assertIn(STORY_NEW, str(cm.exception))
        self.assertEqual(before, self.snapshot(vault))

    def test_a_failure_in_the_second_move_leaves_the_vault_as_it_was(self):
        vault = self.vault()
        before = self.snapshot(vault)
        real = relink._move
        calls = []

        def flaky(v, old, new):
            calls.append(old)
            if len(calls) == 2:
                raise OSError("disk full")
            real(v, old, new)
        with mock.patch.object(relink, "_move", flaky):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertIn("as it was", str(cm.exception))
        self.assertEqual(before, self.snapshot(vault))

    def test_an_interrupt_in_the_second_move_leaves_the_vault_as_it_was(self):
        vault = self.vault()
        before = self.snapshot(vault)
        real = relink._move
        calls = []

        def flaky(v, old, new):
            calls.append(old)
            if len(calls) == 2:
                raise KeyboardInterrupt
            real(v, old, new)
        with mock.patch.object(relink, "_move", flaky):
            with self.assertRaises(KeyboardInterrupt):
                relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(before, self.snapshot(vault))

    def test_a_pc_with_no_story_behaves_as_before(self):
        vault = make_vault(self, {PC_OLD: "---\ntype: pc\n---\n",
                                  "_meta/publish-manifest.md": MANIFEST})
        p = relink.plan(vault, PC_OLD, PC_NEW)
        self.assertEqual(p.companions, [])
        rows = relink.rows(p)
        self.assertEqual(len([r for r in rows if r.startswith("WOULD-RENAME")]), 1)
        self.assertTrue(rows[-1].startswith("# 1 rename, "), rows[-1])

    def test_a_relative_link_between_the_two_files_follows_them_both(self):
        vault = self.vault({STORY_OLD: STORY_TEXT + "[tale](./Emma_Wentworth.md)\n"})
        relink.apply(relink.plan(vault, PC_OLD, "Moved/Emma_Wentworth_Hale.md"))
        self.assertIn("[tale](Emma_Wentworth_Hale.md)",
                      read(vault, "Moved/Emma_Wentworth_Hale_Story.md"))

    def test_a_build_shows_the_story_on_the_pc_page_after_the_rename(self):
        root = Path(tempfile.mkdtemp(prefix="relink-story-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "vault"
        shutil.copytree(PUBLISH_TOOL.parent.parent / "test" / "fixtures"
                        / "with-story", vault)
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site: true\n  mode: full\n---\n")
        old = "Characters/PCs/Lord_Blackwood.md"
        relink.apply(relink.plan(vault, old, "Characters/PCs/Lord_Edmund_Blackwood.md"))
        self.assertTrue((vault / "Characters/PCs/Lord_Edmund_Blackwood_Story.md").is_file())
        import json
        (root / "config.json").write_text(json.dumps({
            "vaultPath": str(vault), "outputDir": str(root / "docs"),
            "attachmentsDir": "_attachments", "siteTitle": "Story Test",
            "system": "coc-7e", "excludeDirs": ["_meta"], "excludeSections": [],
            "folderMap": {"Characters/PCs": "characters/pcs"}}))
        r = subprocess.run(
            ["node", "-e", "require(process.argv[1]).build({configPath: process.argv[2]})",
             str(PUBLISH_TOOL.parent.parent / "lib" / "build.js"),
             str(root / "config.json")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        docs = root / "docs"
        self.assertTrue((docs / "story" / "characters" / "lord-edmund-blackwood.html").is_file())
        self.assertFalse((docs / "characters" / "pcs" / "lord-edmund-blackwood-story.html").exists())


SITE_FULL = ("---\npublish:\n  site: true\n  mode: full\n  folder_map:\n"
             "    Characters/NPCs: characters/npcs\n"
             "    Characters/PCs: characters/pcs\n    Sessions: sessions\n---\n")
NPC = "Characters/NPCs/Charlotte_Thorne.md"
PCN = "Characters/PCs/Charlotte_Thorne.md"
NPC_NEW = "Characters/NPCs/Charlotte_Thorne_NPC.md"


def typed(kind, extra=""):
    return f"---\ntype: {kind}\n{extra}---\n# C\n"


@unittest.skipUnless(shutil.which("node"), "needs Node")
class SharedNameTests(unittest.TestCase):
    """A bare name two notes share goes where the site's build sends it."""

    def vault(self, npc_extra="", pc_extra="", config=SITE_FULL):
        files = {NPC: typed("npc", npc_extra), PCN: typed("pc", pc_extra),
                 "Sessions/S1.md": "---\ntype: session\n---\nmet [[Charlotte_Thorne]] again\n"}
        if config:
            files["_meta/vault-config.md"] = config
        return make_vault(self, files)

    def test_names_the_build_sends_to_the_renamed_note_are_all_rewritten(self):
        vault = self.vault(pc_extra="canon_status: SUPERSEDED\n")
        p = relink.plan(vault, NPC, NPC_NEW)
        self.assertEqual(p.texts["Sessions/S1.md"],
                         "---\ntype: session\n---\nmet [[Charlotte_Thorne_NPC]] again\n")
        self.assertEqual(p.unsure, [])
        self.assertTrue([r for r in relink.rows(p) if r.startswith("RULE\t")])

    def test_names_the_build_sends_to_the_other_note_are_left_without_a_doubt(self):
        vault = self.vault(npc_extra="canon_status: SUPERSEDED\n")
        p = relink.plan(vault, NPC, NPC_NEW)
        self.assertNotIn("Sessions/S1.md", p.texts)
        self.assertEqual(p.unsure, [])

    def test_without_a_site_the_same_folder_rule_still_applies(self):
        vault = self.vault(config=None)
        p = relink.plan(vault, NPC, NPC_NEW)
        self.assertEqual(len(p.unsure), 1)
        self.assertNotIn("Sessions/S1.md", p.texts)

    def test_a_build_before_and_after_links_the_same_page(self):
        root = Path(tempfile.mkdtemp(prefix="relink-bare-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "vault"
        shutil.copytree(self.vault(pc_extra="canon_status: SUPERSEDED\n"), vault)
        import json
        (root / "config.json").write_text(json.dumps({
            "vaultPath": str(vault), "outputDir": str(root / "docs"),
            "attachmentsDir": "_attachments", "siteTitle": "T"}))

        def build():
            r = subprocess.run(
                ["node", "-e", "require(process.argv[1]).build({configPath: process.argv[2]})",
                 str(PUBLISH_TOOL.parent.parent / "lib" / "build.js"),
                 str(root / "config.json")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            html = (root / "docs" / "sessions" / "s1.html").read_text()
            import re
            return sorted(set(re.findall(
                r'href="[^"]*/(npcs|pcs)/charlotte-thorne[^"]*"', html)))
        before = build()
        relink.apply(relink.plan(vault, NPC, NPC_NEW))
        self.assertEqual(before, ["npcs"])
        self.assertEqual(build(), ["npcs"])


@unittest.skipUnless(shutil.which("node"), "needs Node")
class SpellingOwnerTests(unittest.TestCase):
    """Each spelling a note is linked by goes where the site sends it."""

    def test_an_alias_another_note_holds_keeps_its_spelling(self):
        vault = make_vault(self, {
            "Players/Charlotte_Thorne.md": typed("pc"),
            "Cast/Charlotte_Thorne.md": typed("npc", 'aliases: ["Charlotte Thorne"]\n'),
            "Sessions/S1.md": "---\ntype: session\n---\n[[Charlotte Thorne]]\n",
            "_meta/vault-config.md": SITE_FULL.replace(
                "    Characters/NPCs: characters/npcs\n    Characters/PCs: characters/pcs\n",
                "    Players: characters/pcs\n    Cast: characters/npcs\n")})
        p = relink.plan(vault, "Players/Charlotte_Thorne.md",
                        "Players/Charlotte_Thorne_PC.md")
        self.assertNotIn("Sessions/S1.md", p.texts)
        self.assertEqual(p.unsure, [])

    def test_a_unique_name_another_notes_alias_claims_is_left_too(self):
        vault = make_vault(self, {
            "Characters/NPCs/Hallam.md": typed("npc"),
            "Characters/NPCs/Other.md": typed("npc", 'aliases: ["hallam"]\n'),
            "Sessions/S1.md": "---\ntype: session\n---\n[[hallam]] [[Hallam]]\n",
            "_meta/vault-config.md": SITE_FULL})
        p = relink.plan(vault, "Characters/NPCs/Hallam.md",
                        "Characters/NPCs/Hallam_Reeve.md")
        self.assertEqual(p.texts["Sessions/S1.md"],
                         "---\ntype: session\n---\n[[hallam]] [[Hallam_Reeve]]\n")

    def test_the_site_folders_config_is_handed_to_the_tool(self):
        # The folder map lives only in the site's vault.config.json.
        site = Path(tempfile.mkdtemp(prefix="relink-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        import json
        (site / "vault.config.json").write_text(json.dumps({
            "folderMap": {"Characters/NPCs": "characters/npcs",
                          "Characters/PCs": "characters/pcs",
                          "Sessions": "sessions"}}))
        vault = make_vault(self, {
            NPC: typed("npc"), PCN: typed("pc", "canon_status: SUPERSEDED\n"),
            "Sessions/S1.md": "---\ntype: session\n---\n[[Charlotte_Thorne]]\n",
            "_meta/vault-config.md":
                f"---\npublish:\n  site: true\n  mode: full\n"
                f"  site_dir: {site.as_posix()}\n---\n"})
        p = relink.plan(vault, NPC, NPC_NEW)
        self.assertEqual(p.owners.get("Charlotte_Thorne"), NPC)
        self.assertIn("Sessions/S1.md", p.texts)
        rule = [r for r in relink.rows(p) if r.startswith("RULE\t")]
        self.assertIn("the site's link map", rule[0])

    def test_a_manifest_without_a_site_does_not_follow_the_link_map(self):
        vault = make_vault(self, {
            NPC: typed("npc"), PCN: typed("pc"),
            "Sessions/S1.md": "---\ntype: session\n---\n[[Charlotte_Thorne]]\n",
            "_meta/publish-manifest.md": "## Publishing (0 files)\n\n"})
        p = relink.plan(vault, NPC, NPC_NEW)
        self.assertEqual(len(p.unsure), 1)
        self.assertEqual(p.owners, {})

    def test_the_rule_row_says_when_the_site_gave_no_answer(self):
        vault = make_vault(self, {
            NPC: typed("npc", "publish: false\n"), PCN: typed("pc", "publish: false\n"),
            "Sessions/S1.md": "---\ntype: session\n---\n[[Charlotte_Thorne]]\n",
            "_meta/vault-config.md": SITE_FULL})
        rule = [r for r in relink.rows(relink.plan(vault, NPC, NPC_NEW))
                if r.startswith("RULE\t")]
        self.assertEqual(len(rule), 1)
        self.assertIn("no site answer", rule[0])


@unittest.skipUnless(shutil.which("node"), "needs Node")
class CompanionReviewTests(unittest.TestCase):
    def vault(self, extra=None):
        files = {PC_OLD: "---\ntype: pc\n---\n# Emma\n", STORY_OLD: STORY_TEXT,
                 "_meta/publish-manifest.md": MANIFEST}
        files.update(extra or {})
        return make_vault(self, files)

    def snapshot(self, vault):
        return sorted(p.relative_to(vault).as_posix() + ("/" if p.is_dir() else "")
                      for p in vault.rglob("*"))

    def test_a_rollback_removes_the_folder_a_completed_move_made(self):
        vault = self.vault()
        before = self.snapshot(vault)
        real = relink._move
        calls = []

        def flaky(v, old, new):
            calls.append(old)
            if len(calls) == 2:
                raise OSError("disk full")
            return real(v, old, new)
        with mock.patch.object(relink, "_move", flaky):
            with self.assertRaises(relink.RelinkError):
                relink.apply(relink.plan(vault, PC_OLD,
                                         "Retired/Emma_Wentworth_Hale.md"))
        self.assertEqual(before, self.snapshot(vault))

    def test_a_malformed_companion_answer_is_not_a_crash(self):
        lines = vaultlib._LINES_BY_TOOL[vaultlib.PUBLISH_TOOL]
        for bad in ('{"files": {}, "companions": [{"from": 1}]}',
                    '{"files": {}, "companions": "x"}',
                    '{"files": {}, "detaches": 4}',
                    '{"files": {}, "owners": {"a": 4}}',
                    '{"files": {}, "owners": []}',
                    '{"files": {}, "refusal": []}'):
            with mock.patch.object(lines, "run_once", return_value=bad):
                with self.assertRaises(vaultlib.PublishToolUnavailable):
                    vaultlib.publish_rename_refs(self.vault(), PC_OLD, PC_NEW)

    def test_relative_links_between_the_pc_and_its_story_follow_both(self):
        vault = self.vault({
            PC_OLD: "---\ntype: pc\n---\n[s](./Emma_Wentworth_Story.md) "
                    "[[./Emma_Wentworth_Story]]\n",
            STORY_OLD: STORY_TEXT + "[[./Emma_Wentworth]]\n"})
        relink.apply(relink.plan(vault, PC_OLD, "Moved/Emma_Wentworth_Hale.md"))
        self.assertEqual(
            read(vault, "Moved/Emma_Wentworth_Hale.md"),
            "---\ntype: pc\nlive_key: emma-wentworth\n---\n[s](Emma_Wentworth_Hale_Story.md) "
            "[[Moved/Emma_Wentworth_Hale_Story]]\n")
        self.assertIn("[[Moved/Emma_Wentworth_Hale]]",
                      read(vault, "Moved/Emma_Wentworth_Hale_Story.md"))

    def test_a_case_only_rename_moves_the_story_too(self):
        vault = self.vault()
        relink.apply(relink.plan(vault, PC_OLD, "Characters/PCs/emma_wentworth.md"))
        names = sorted(p.name for p in (vault / "Characters/PCs").iterdir())
        self.assertEqual(names, ["emma_wentworth.md", "emma_wentworth_Story.md"])

    def test_canvas_file_nodes_for_both_files_are_rewritten(self):
        canvas = ('{"nodes":[{"id":"a","type":"file","file":"%s"},'
                  '{"id":"b","type":"file","file":"%s"}]}')
        vault = self.vault({"Map.canvas": canvas % (PC_OLD, STORY_OLD)})
        relink.apply(relink.plan(vault, PC_OLD, PC_NEW))
        self.assertEqual(read(vault, "Map.canvas"), canvas % (PC_NEW, STORY_NEW))

    def test_a_non_utf8_note_linking_the_story_is_named_for_the_story(self):
        vault = self.vault()
        (vault / "Bad.md").write_bytes(b"\xff [[Emma_Wentworth_Story]]\n")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, PC_OLD, PC_NEW)
        self.assertIn("Emma_Wentworth_Story", str(cm.exception))

    def test_a_rename_onto_a_pcs_story_name_is_refused(self):
        # Beside the PC, the note would be swallowed as its story.
        vault = make_vault(self, {
            PC_OLD: "---\ntype: pc\n---\n", "Characters/PCs/Hallam.md": "---\ntype: npc\n---\n",
            "_meta/publish-manifest.md": MANIFEST})
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, "Characters/PCs/Hallam.md", STORY_OLD)
        self.assertIn("would attach to Emma_Wentworth as its story",
                      str(cm.exception))


class FinalFixTests(unittest.TestCase):
    def test_an_absolute_new_is_refused_not_rerooted(self):
        vault = make_vault(self, {"A/Old.md": "x\n"})
        for new in ("/tmp/x.md", str(vault / "A" / "New.md")):
            with self.assertRaises(relink.RelinkError) as cm:
                relink.plan(vault, "A/Old.md", new)
            self.assertIn("outside the vault", str(cm.exception))

    def test_a_folder_case_only_move_is_refused(self):
        vault = make_vault(self, {"npcs/Duke.md": "x\n", "A.md": "[[Duke]]\n"})
        if not (vault / "NPCs").exists():
            self.skipTest("a case-sensitive file system keeps two folders")
        with self.assertRaises(relink.RelinkError) as cm:
            relink.plan(vault, "npcs/Duke.md", "NPCs/Duke.md")
        self.assertIn("folder case", str(cm.exception))

    def test_a_partial_path_matching_two_notes_is_unsure(self):
        vault = make_vault(self, {
            "A/Ch1/Old.md": "x\n", "B/Ch1/Old.md": "y\n",
            "N.md": "[[Ch1/Old]]\n"})
        p = relink.plan(vault, "A/Ch1/Old.md", "A/Ch1/New.md")
        self.assertNotIn("N.md", p.texts)
        self.assertEqual(len(p.unsure), 1)

    def test_a_partial_path_matching_one_note_is_rewritten(self):
        vault = make_vault(self, {"A/Ch1/Old.md": "x\n", "N.md": "[[Ch1/Old]]\n"})
        p = relink.plan(vault, "A/Ch1/Old.md", "A/Ch1/New.md")
        self.assertEqual(p.texts["N.md"], "[[A/Ch1/New]]\n")

    def test_a_canvas_table_link_with_a_json_escaped_pipe_is_rewritten(self):
        canvas = '{"nodes":[{"id":"a","type":"text","text":"| [[%s\\\\|x]] |"}]}'
        vault = make_vault(self, {"NPCs/Duke.md": "x\n", "M.canvas": canvas % "Duke"})
        relink.apply(relink.plan(vault, "NPCs/Duke.md", "NPCs/Duke_Reeve.md"))
        self.assertEqual(read(vault, "M.canvas"), canvas % "Duke_Reeve")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes."""

import io
import shutil
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_write as vw  # noqa: E402


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vwrite-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(vault, *argv, stdin=""):
    """(exit code, stdout) of one vault_write call."""
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


NPC = """---
type: npc
---

# Hallam

## Campaign Log

- **[[Session 01 - Start]]** — met the party.

<!-- gm-only -->

## GM Notes

### Wants

Out.

### Behind the Scenes

- **[[Session 01 - Start]]** — lied.

<!-- /gm-only -->
"""


class PrimitiveTests(unittest.TestCase):
    def test_heads_know_which_side_of_the_fence_they_are_on(self):
        doc = vw.parse(NPC)
        sides = {h.title: h.gm for h in doc.heads}
        self.assertFalse(sides["Campaign Log"])
        self.assertTrue(sides["GM Notes"])
        self.assertTrue(sides["Behind the Scenes"])

    def test_a_public_section_ends_at_the_fence_opener(self):
        doc = vw.parse(NPC)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log)].strip(),
                         "<!-- gm-only -->")

    def test_a_keeper_section_ends_at_the_next_heading_or_the_closer(self):
        doc = vw.parse(NPC)
        wants = next(h for h in doc.heads if h.title == "Wants")
        behind = next(h for h in doc.heads if h.title == "Behind the Scenes")
        self.assertEqual(vw.section_end(doc, wants), behind.idx)
        self.assertEqual(doc.lines[vw.section_end(doc, behind)].strip(),
                         "<!-- /gm-only -->")

    def test_an_aside_inside_a_section_does_not_end_it(self):
        text = ("# T\n\n## Log\n\n- a\n\n<!-- gm-only -->\nsecret\n"
                "<!-- /gm-only -->\n\n- b\n\n## Next\n")
        doc = vw.parse(text)
        log = next(h for h in doc.heads if h.title == "Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log)], "## Next\n")

    def test_place_puts_a_block_after_the_last_content_line(self):
        doc = vw.parse(NPC)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        out = vw.place(doc, vw.section_end(doc, log), ["- new"], tight=True)
        self.assertIn("- **[[Session 01 - Start]]** — met the party.\n"
                      "- new\n\n<!-- gm-only -->", out)

    def test_place_separates_a_paragraph_with_a_blank_line(self):
        doc = vw.parse(NPC)
        wants = next(h for h in doc.heads if h.title == "Wants")
        out = vw.place(doc, vw.section_end(doc, wants), ["More."])
        self.assertIn("Out.\n\nMore.\n\n### Behind the Scenes", out)

    def test_place_keeps_crlf(self):
        crlf = NPC.replace("\n", "\r\n")
        doc = vw.parse(crlf)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        out = vw.place(doc, vw.section_end(doc, log), ["- new"], tight=True)
        self.assertNotIn("\n", out.replace("\r\n", ""))
        self.assertEqual(out.replace("- new\r\n", ""), crlf)

    def test_key_ignores_case_and_emphasis(self):
        self.assertEqual(vw.key("**World  State**"), vw.key("world state"))


class BatchTests(unittest.TestCase):
    def test_apply_writes_every_changed_file(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", batch.read("a.md") + "x\n")
        batch.create("c.md", "C\n")
        batch.read("b.md")
        self.assertEqual(sorted(vw.apply(batch)), ["a.md", "c.md"])
        self.assertEqual(read(vault, "a.md"), "A\nx\n")
        self.assertEqual(read(vault, "c.md"), "C\n")

    def test_a_failed_write_restores_everything(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        batch.create("new.md", "N\n")
        batch.put("b.md", "B2\n")
        real = vw.write_text_atomic
        calls = []

        def flaky(path, text):
            calls.append(path.name)
            if path.name == "b.md" and text == "B2\n":
                raise vw.StepFailed("b.md cannot be written (OSError)")
            real(path, text)

        with mock.patch.object(vw, "write_text_atomic", flaky):
            with self.assertRaises(vw.WriteError):
                vw.apply(batch)
        self.assertEqual(read(vault, "a.md"), "A\n")
        self.assertEqual(read(vault, "b.md"), "B\n")
        self.assertFalse((vault / "new.md").exists())

    def test_a_file_changed_since_the_plan_is_refused(self):
        vault = make_vault(self, {"a.md": "A\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        (vault / "a.md").write_bytes(b"other\n")
        with self.assertRaises(vw.WriteError):
            vw.apply(batch)
        self.assertEqual(read(vault, "a.md"), "other\n")

    def test_create_refuses_an_existing_file(self):
        vault = make_vault(self, {"a.md": "A\n"})
        with self.assertRaises(vw.WriteError):
            vw.Batch(vault).create("a.md", "x")

    def test_emit_switches_verbs_when_written(self):
        batch = vw.Batch(Path("."))
        batch.row("WOULD-ADD", "a.md", "§Log", "1 line")
        self.assertIn("WOULD-ADD\ta.md\t§Log\t1 line", vw.emit(batch, False))
        self.assertIn("ADDED\ta.md\t§Log\t1 line", vw.emit(batch, True))
        self.assertIn("# create: 0  add: 1  skip: 0  warnings: 0  errors: 0",
                      vw.emit(batch, True))


if __name__ == "__main__":
    unittest.main()

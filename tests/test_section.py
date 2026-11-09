#!/usr/bin/env python3
"""`gma section VAULT NOTE PATH`: one note section by heading path, and the
shared `find_section` behind it.

Run: python3 tests/test_section.py
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
FIXTURE = ROOT / "tests" / "fixtures" / "layered-reads"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import vaultlib as vl  # noqa: E402


def copy_vault(case) -> Path:
    root = Path(tempfile.mkdtemp(prefix="section-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "vault"
    shutil.copytree(FIXTURE, vault)
    return vault


def run(vault, note, path):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "section.py"), str(vault), note, path],
        capture_output=True, text=True)


class FindSectionTests(unittest.TestCase):
    def test_span_and_none_and_ambiguous(self):
        text = "# T\n## A\nx\n### B\ny\n## C\n### B\nz\n"
        self.assertEqual(vl.find_section(text, ["A"]), (1, 5))
        self.assertEqual(vl.find_section(text, ["a", "b"]), (3, 5))
        self.assertIsNone(vl.find_section(text, ["nope"]))
        got = vl.find_section(text, ["B"])
        self.assertIsInstance(got, list)
        self.assertEqual(len(got), 2)

    def test_slash_in_a_title(self):
        text = "## S\n### Allies/Enemies\nx\n### Other\ny\n"
        self.assertEqual(vl.find_section(text, ["S", "Allies/Enemies"]),
                         (1, 3))
        self.assertEqual(vl.find_section(text, ["s", "allies", "enemies"]),
                         (1, 3))
        self.assertIsNone(vl.find_section(text, ["S", "Allies"]))

    def test_slash_split_two_ways_is_refused(self):
        text = "## S\n### A/B\nx\n### A\n#### B\ny\n"
        got = vl.find_section(text, ["S", "A", "B"])
        self.assertIsInstance(got, list)
        self.assertEqual(len(got), 2)
        self.assertIn("line 2", got[0])
        self.assertIn("line 5", got[1])

    def test_long_path_without_matches_is_quick(self):
        import time
        text = "## S\n### A\nx\n### B\ny\n" * 3
        path = [f"p{i}" for i in range(20)]
        t = time.perf_counter()
        self.assertIsNone(vl.find_section(text, path))
        self.assertIsNone(vl.find_section(text, ["S", "A"] + path))
        self.assertLess(time.perf_counter() - t, 1.0)

    def test_lines_split_on_newline_only(self):
        # U+2028 is not a line break here: the span counts "\n" lines.
        text = "## A\nx y\n## B\nz\n"
        self.assertEqual(vl.find_section(text, ["B"]), (2, 4))


class SectionCommandTests(unittest.TestCase):
    def test_subsection_by_path(self):
        vault = copy_vault(self)
        r = run(vault, "PCs/Ada_Quill.md", "Current Status/Session Log")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines()[0], "### Session Log")
        self.assertIn("She crossed the ford at night", r.stdout)
        self.assertNotIn("Wounds", r.stdout)
        self.assertNotIn("GM-side log", r.stdout)

    def test_note_by_name_and_alias(self):
        vault = copy_vault(self)
        by_name = run(vault, "Ada_Quill", "Background")
        by_alias = run(vault, "Ada", "background")
        self.assertEqual(by_name.returncode, 0, by_name.stderr)
        self.assertEqual(by_name.stdout, by_alias.stdout)
        self.assertTrue(by_name.stdout.startswith("## Background"))

    def test_no_match_exits_1(self):
        r = run(copy_vault(self), "Ada_Quill", "Current Status/Nope")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no section", r.stderr)

    def test_section_after_an_edit(self):
        vault = copy_vault(self)
        note = vault / "PCs" / "Ada_Quill.md"
        text = note.read_text(encoding="utf-8")
        note.write_text(text.replace(
            "- Session 3: She crossed", "- Session 4: Dawn came.\n- Session 3: She crossed"),
            encoding="utf-8", newline="")
        r = run(vault, "Ada_Quill", "Current Status/Session Log")
        self.assertIn("Session 4: Dawn came.", r.stdout)

    def test_ambiguous_path_refused(self):
        r = run(copy_vault(self), "Ada_Quill", "Session Log")
        self.assertEqual(r.returncode, 1)
        self.assertIn("more than one", r.stderr)
        self.assertIn("Current Status/Session Log", r.stderr)
        self.assertIn("GM Notes/Session Log", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_heading_in_code_fence_is_not_a_subsection(self):
        vault = copy_vault(self)
        self.assertEqual(
            run(vault, "Ada_Quill", "GM Notes/Not A Heading").returncode, 1)
        r = run(vault, "Ada_Quill", "GM Notes/Secrets")
        self.assertIn("Still inside Secrets after the fence.", r.stdout)

    def test_section_keeps_whole_fence(self):
        r = run(copy_vault(self), "Ada_Quill", "GM Notes/Secrets")
        self.assertIn("```text\n### Not A Heading\nthis fenced line must not "
                      "become a subsection\n```", r.stdout)
        self.assertNotIn("### Hooks", r.stdout)

    def test_nested_heading_folds_into_parent(self):
        r = run(copy_vault(self), "Ada_Quill", "GM Notes/Hooks")
        self.assertIn("#### Hook detail", r.stdout)
        r = run(copy_vault(self), "Ada_Quill", "GM Notes/Hooks/Hook detail")
        self.assertTrue(r.stdout.startswith("#### Hook detail"))

    def test_section_crlf_and_names(self):
        vault = copy_vault(self)
        note = vault / "PCs" / "Ada_Quill.md"
        text = note.read_text(encoding="utf-8")
        note.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
        r = subprocess.run(
            [sys.executable, str(SCRIPTS / "section.py"), str(vault),
             "Ada", "current status/session log"], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith(b"### Session Log\r\n"))
        self.assertIn(b"watched the north-bank lamp.\r\n", r.stdout)
        self.assertNotIn(b"Wounds", r.stdout)

    def test_slash_title_fetches_through_the_cli(self):
        vault = copy_vault(self)
        note = vault / "PCs" / "Ada_Quill.md"
        text = note.read_text(encoding="utf-8")
        note.write_text(text.replace("### Hooks\n", "### Allies/Enemies\n"),
                        encoding="utf-8")
        r = run(vault, "Ada_Quill", "GM Notes/Allies/Enemies")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("### Allies/Enemies\n"))
        self.assertIn("#### Hook detail", r.stdout)

    def test_runs_through_gma(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPTS / "gma.py"), "section",
             str(copy_vault(self)), "Cole_Plain", "Background"],
            capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("A ferry hand", r.stdout)


if __name__ == "__main__":
    unittest.main()

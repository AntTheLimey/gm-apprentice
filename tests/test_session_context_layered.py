#!/usr/bin/env python3
"""session_context prints a PC section with `###` subsections as an outline
plus a fetch line; a section without them prints exactly as before.

Run: python3 tests/test_session_context_layered.py
"""

import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
FIXTURE = ROOT / "tests" / "fixtures" / "layered-reads"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import vaultlib as vl  # noqa: E402

NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs node")

OUTLINE_RE = re.compile(r"^#{3,} .*\((\d+) words; (\S+): (.+)\)$", re.M)

# The plain PC's blocks, as the bundle printed them before outlines existed.
COLE_STATUS = (
    "--- Cole_Plain (PCs/Cole_Plain.md, asOfSession: 3) ---\n"
    "**Location:** Harrow Ford\n"
    "**Open threads:**\n"
    "- **Cole's borrowed boat** — due back at dawn\n"
    "\n"
    "Cole is tired and wet.\n")
COLE_ARCS = (
    "--- Cole_Plain (PCs/Cole_Plain.md, player: Jo) ---\n"
    "## Background\n"
    "A ferry hand with no secrets worth the name.\n"
    "## GM Notes\n"
    "Cole will say yes to almost anything before breakfast.\n"
    "Spotlight history")


def sc(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "session_context.py"), str(FIXTURE),
         *args], capture_output=True, text=True)


def fetch(note, path):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "section.py"), str(FIXTURE), note,
         path], capture_output=True, text=True)


@NEEDS_NODE
class LayeredTests(unittest.TestCase):
    def test_no_subsections_prints_unchanged(self):
        for args in (("--brief",), (), ("--prep",)):
            with self.subTest(args=args):
                r = sc(*args)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn(COLE_STATUS, r.stdout)
        r = sc("--arcs")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(COLE_ARCS, r.stdout)

    def test_session_log_is_outlined_in_active_pcs(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("**Open threads:**\n- **The torn page**", ada)
        self.assertIn("### Session Log  (", ada)
        self.assertIn("Ada_Quill: Current Status/Session Log)", ada)
        self.assertIn("### Wounds  (", ada)
        self.assertNotIn("She crossed the ford at night", ada)
        self.assertNotIn("split lip", ada)

    def test_gm_notes_subsections_outlined_in_arcs(self):
        out = sc("--arcs").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("A lamp-trimmer's daughter", ada)   # Background whole
        self.assertIn("Ada is the one who can tell", ada)  # preamble kept
        self.assertIn("### Secrets  (", ada)
        self.assertIn("### Hooks  (", ada)
        self.assertIn("Ada_Quill: GM Notes/Hooks)", ada)
        self.assertNotIn("knows whose hand wrote it", ada)
        self.assertNotIn("#### Hook detail", ada)       # folded, no own line

    def test_outline_paths_fetch_their_subsection(self):
        out = sc("--brief").stdout + sc("--arcs").stdout
        found = OUTLINE_RE.findall(out)
        self.assertGreaterEqual(len(found), 5)
        for words, note, path in found:
            with self.subTest(path=path):
                r = fetch(note, path)
                self.assertEqual(r.returncode, 0, r.stderr)
                title = path.rsplit("/", 1)[1]
                self.assertTrue(r.stdout.startswith(f"### {title}\n"),
                                r.stdout)
                body = r.stdout.split("\n", 1)[1]
                self.assertEqual(vl.word_count(body), int(words))

    def test_open_threads_never_outlined(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("**Open threads:**\n- **The torn page**", ada)
        self.assertNotRegex(ada, r"(?i)open threads.*\(\d+ words")

    def test_fetch_line_printed_once(self):
        for args in (("--brief",), ("--arcs",), ("--prep",), ()):
            with self.subTest(args=args):
                out = sc(*args).stdout
                self.assertEqual(out.count("gma section "), 1, out)

    def test_no_fetch_line_when_nothing_outlined(self):
        out = subprocess.run(
            [sys.executable, str(SCRIPTS / "session_context.py"),
             str(FIXTURE), "--threads"], capture_output=True, text=True)
        self.assertNotIn("gma section ", out.stdout)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""session_context prints a PC section with `###` subsections as an outline
plus a fetch line; a section without them prints exactly as before.

Run: python3 tests/test_session_context_layered.py
"""

import re
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
import session_context as sctx  # noqa: E402
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


def sc(*args, vault=FIXTURE):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "session_context.py"), str(vault),
         *args], capture_output=True, text=True)


def fetch(note, path, vault=FIXTURE):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "section.py"), str(vault), note,
         path], capture_output=True, text=True)


def copy_vault(case) -> Path:
    root = Path(tempfile.mkdtemp(prefix="layered-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "vault"
    shutil.copytree(FIXTURE, vault)
    return vault


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

    def test_slash_title_outline_line_fetches_it(self):
        note = ("---\ntype: pc\nstatus: active\n---\n# Zed\n\n"
                "## Current Status\n\nTop text.\n\n"
                "### Allies/Enemies\n\nfriends and foes here\n\n"
                "### Plain\n\nother words\n")
        vault = copy_vault(self)
        (vault / "PCs" / "Zed.md").write_text(note, encoding="utf-8")
        out = sc("--brief", vault=vault).stdout
        m = [x for x in OUTLINE_RE.findall(out) if x[1] == "Zed"]
        self.assertEqual(m[0][2], "Current Status/Allies/Enemies")
        r = fetch("Zed", m[0][2], vault=vault)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("### Allies/Enemies\n"))
        self.assertIn("friends and foes", r.stdout)
        self.assertNotIn("other words", r.stdout)

    def test_crlf_outline_has_no_mixed_endings(self):
        body = ("Top text.\r\n\r\n### One\r\nalpha beta\r\n\r\n"
                "### Two\r\ngamma\r\n")
        text, outlined = sctx.layered(body, "Zed", "Current Status")
        self.assertTrue(outlined)
        self.assertEqual(
            text,
            "Top text.\r\n\r\n"
            "### One  (2 words; Zed: Current Status/One)\r\n"
            "### Two  (1 words; Zed: Current Status/Two)")
        self.assertNotRegex(text, r"(?<!\r)\n")

    def test_crlf_multi_line_preamble_keeps_single_returns(self):
        body = ("Line A.\r\nLine B.\r\n\r\n### One\r\nalpha beta\r\n\r\n"
                "### Two\r\ngamma\r\n")
        text, _ = sctx.layered(body, "Zed", "Current Status")
        self.assertTrue(text.startswith("Line A.\r\nLine B.\r\n\r\n### One"),
                        repr(text))
        self.assertNotIn("\r\r", text)
        self.assertNotRegex(text, r"(?<!\r)\n")

    def test_blank_line_before_the_outline_kept(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("others\n\n### Session Log  (", ada)

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

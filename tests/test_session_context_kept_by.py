#!/usr/bin/env python3
"""`session_context.py` on a vault kept by a player says there is no session
prep to gather and exits 0; on a vault kept by the GM it gathers as before.

Run: python3 tests/test_session_context_kept_by.py
"""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "shared" / "scripts" / "session_context.py"
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs node")

LINE = ("This vault is kept by a player (vault.kept_by: player), so there is "
        "no session prep to gather.")


def make(case, kept_by):
    root = Path(tempfile.mkdtemp(prefix="sc-keptby-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    (root / "_meta").mkdir()
    (root / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nvault:\n  kept_by: {kept_by}\n", encoding="utf-8")
    return root


def run(vault, *args):
    return subprocess.run([sys.executable, str(SCRIPT), str(vault), *args],
                          capture_output=True, text=True)


@NEEDS_NODE
class SessionContextKeptByTests(unittest.TestCase):
    def test_brief_prints_the_one_line_and_exits_zero(self):
        r = run(make(self, "player"), "--brief")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), LINE)

    def test_the_other_modes_say_the_same(self):
        # The gate sits before every mode's own work; the default and
        # `--play` are the two ends of it, `--brief` is above.
        vault = make(self, "player")
        for args in ((), ("--play",)):
            with self.subTest(args=args):
                r = run(vault, *args)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(r.stdout.strip(), LINE)

    def test_kept_by_gm_gathers_as_before(self):
        r = run(make(self, "gm"), "--brief")
        self.assertNotIn("kept by a player", r.stdout)


if __name__ == "__main__":
    unittest.main()

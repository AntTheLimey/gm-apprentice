#!/usr/bin/env python3
"""validate_filtering: every scene is prep by type, whatever its status."""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import validate_schema as vs  # noqa: E402

STATUSES = ["planned", "paused", "played", "dropped", "ready", "modified", "cut", "skipped", "oddity"]


class ValidateFilteringTests(unittest.TestCase):
    def test_every_scene_status_is_excluded_with_no_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for status in STATUSES:
                (root / f"Scene {status}.md").write_text(
                    f"---\ntype: scene\nstatus: {status}\n---\n\nBody.\n", encoding="utf-8")
            (root / "Npc.md").write_text("---\ntype: npc\nstatus: alive\n---\n", encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                errors = vs.validate_filtering(root)
        self.assertEqual(errors, 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), len(STATUSES))
        self.assertTrue(all(line.strip().startswith("EXCLUDE ") for line in lines), lines)


if __name__ == "__main__":
    unittest.main()

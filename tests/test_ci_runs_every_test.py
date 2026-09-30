#!/usr/bin/env python3
"""CI runs every Python test file, so a new one can't be left out again.

lint.yml once ran tests/*.py one by one, and four test files added on one
branch never ran in CI. It now runs the whole suite with pytest; this pins
that, and that every test file gives pytest something to collect (a
script-style file that only checks on import would pass by collecting
nothing).

Run: python3 tests/test_ci_runs_every_test.py
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINT = ROOT / ".github" / "workflows" / "lint.yml"


class CiRunsEveryTestTests(unittest.TestCase):
    def test_lint_runs_the_whole_suite_with_pytest(self):
        text = LINT.read_text(encoding="utf-8")
        self.assertRegex(text, r"python -m pytest tests\b")
        self.assertNotRegex(text, r"run: python tests/test_\w+\.py")

    def test_the_suite_step_keeps_the_node_requirement(self):
        text = LINT.read_text(encoding="utf-8")
        step = text[text.index("- name: Python test suite"):]
        step = step[:step.index("\n      - ", 1)]
        self.assertIn("VAULT_CHECK_REQUIRE_NODE: '1'", step)
        self.assertIn("actions/setup-node", text)

    def test_every_test_file_gives_pytest_a_test(self):
        bare = [p.name for p in sorted((ROOT / "tests").glob("test_*.py"))
                if not re.search(r"^\s*def test_|unittest\.TestCase",
                                 p.read_text(encoding="utf-8"), re.M)]
        self.assertEqual(bare, [])


if __name__ == "__main__":
    unittest.main()

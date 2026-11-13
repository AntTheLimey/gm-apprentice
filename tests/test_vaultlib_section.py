#!/usr/bin/env python3
"""`vaultlib.section` finds through `find_section`, the one section finder.

Run: python3 tests/test_vaultlib_section.py
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import vaultlib as vl  # noqa: E402


def old_section(text: str, heading: str):
    """The regex `section()` was before it used `find_section` (reference)."""
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)",
                  text, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else None


# (relative path, heading) -> why the old answer was wrong. Filled from the
# first run over the fixtures; an exception not listed here fails the test.
EXCEPTIONS: dict[tuple[str, str], str] = {}


class SameAnswerTests(unittest.TestCase):
    def test_same_answer_on_every_fixture(self):
        seen = set()
        checked = 0
        for base in ("tests/fixtures", "tests/benchmark-campaign"):
            for path in sorted((ROOT / base).rglob("*.md")):
                rel = str(path.relative_to(ROOT))
                text = path.read_bytes().decode("utf-8", "replace")
                for line in text.split("\n"):
                    m = re.match(r"^##[ \t]+(.+?)\s*$", line)
                    if not m:
                        continue
                    heading = m.group(1)
                    old, new = (old_section(text, heading),
                                vl.section(text, heading))
                    checked += 1
                    if old == new:
                        continue
                    key = (rel, heading)
                    seen.add(key)
                    self.assertIn(key, EXCEPTIONS,
                                  f"unlisted difference: {key}")
        self.assertGreater(checked, 100)
        self.assertEqual(seen, set(EXCEPTIONS), "stale exception entries")


class FinderTests(unittest.TestCase):
    def test_section_matches_by_case_only(self):
        self.assertEqual(vl.section("## current status\nx\n", "Current Status"),
                         "x")
        self.assertIsNone(vl.section("## Current  Status\nx\n",
                                     "Current Status"))

    def test_case_insensitive(self):
        text = "## GM notes\nbody\n\n## Other\nx\n"
        self.assertEqual(vl.section(text, "GM Notes"), "body")
        self.assertIsNone(old_section(text, "GM Notes"))

    def test_code_fence_heading_does_not_end_section(self):
        text = "## A\none\n```\n## not a heading\n```\ntwo\n## B\nx\n"
        self.assertEqual(vl.section(text, "A"),
                         "one\n```\n## not a heading\n```\ntwo")
        self.assertEqual(old_section(text, "A"), "one\n```")

    def test_level_one_heading_ends_section(self):
        text = "## A\none\n# Title\ntwo\n"
        self.assertEqual(vl.section(text, "A"), "one")
        self.assertEqual(old_section(text, "A"), "one\n# Title\ntwo")

    def test_fenced_heading_is_not_found(self):
        text = "```\n## A\n```\n## A\nreal\n"
        self.assertEqual(vl.section(text, "A"), "real")

    def test_first_of_two_wins_and_level_three_stays_inside(self):
        text = "## A\none\n### sub\nin\n## A\ntwo\n"
        self.assertEqual(vl.section(text, "A"), "one\n### sub\nin")

    def test_missing_and_level_three_not_matched(self):
        self.assertIsNone(vl.section("### A\nx\n", "A"))
        self.assertIsNone(vl.section("## B\nx\n", "A"))

    def test_empty_section_is_empty_string(self):
        self.assertEqual(vl.section("## A\n\n## B\nx\n", "A"), "")

    def test_closing_hashes_are_not_part_of_the_title(self):
        self.assertEqual(vl.section("## A ##\nx\n", "A"), "x")

    def test_section_ends_runs_to_the_next_heading_no_deeper(self):
        lines = "# T\n## A\n### a\n## B\n#### b\n".split("\n")
        heads = vl.line_headings(lines)
        self.assertEqual(vl.section_ends(heads, len(lines)), [6, 3, 3, 6, 6])

    def test_crlf(self):
        self.assertEqual(vl.section("## A\r\nx\r\n## B\r\n", "A"), "x")


if __name__ == "__main__":
    unittest.main()

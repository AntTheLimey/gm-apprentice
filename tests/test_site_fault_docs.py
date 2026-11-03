#!/usr/bin/env python3
"""The note-fault codes: the publish tool's list is the one list.

`tools/publish/lib/note-faults.js` names the codes (`CODES`). The `doctor
--site` help, the Site Faults check's reference and `vault_check.py` must
each know every one of them, so a code added there cannot be left out here.

A code with a long walk-through has its section in its own file under
`site-faults/`, read only when a row names that code (#562): site-faults.md
keeps a short `## CODE` section naming the file, and every file there is
named from site-faults.md.
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import vault_check as vc  # noqa: E402

CODES = re.findall(r"'([A-Z_]+)'", re.search(
    r"const CODES = \[(.*?)\];",
    (ROOT / "tools/publish/lib/note-faults.js").read_text(encoding="utf-8"),
    re.S).group(1))
CHECKS = ROOT / "skills/campaign-qa/references/checks"
QA = (CHECKS / "site-faults.md").read_text(encoding="utf-8")
SPLIT = CHECKS / "site-faults"
HELP = (ROOT / "tools/publish/bin/gm-publish.js").read_text(encoding="utf-8")
TROUBLE = (ROOT / "skills/publish-site/references/troubleshooting.md"
           ).read_text(encoding="utf-8")


class NoteFaultCodeTests(unittest.TestCase):
    def test_the_code_list_was_read(self):
        self.assertGreaterEqual(len(CODES), 8, CODES)

    def test_vault_check_relays_every_code(self):
        self.assertEqual(list(vc.NOTE_FAULT_CODES), CODES)

    def test_the_doctor_help_names_every_code(self):
        for code in CODES:
            with self.subTest(code=code):
                self.assertIn(code, HELP)

    def test_the_check_has_a_section_and_a_table_row_for_every_code(self):
        for code in CODES:
            with self.subTest(code=code):
                self.assertRegex(QA, rf"(?m)^## {code}$")
                self.assertRegex(QA, rf"(?m)^\| `{code}`")

    def test_a_split_section_is_in_the_file_its_section_names(self):
        # A code whose section in site-faults.md names a split file has its
        # walk-through there; the file is read only for that code.
        split_codes = set()
        for code in CODES:
            section = re.search(rf"(?ms)^## {code}\n(.*?)(?=^## |\Z)", QA)
            named = re.findall(r"`site-faults/([a-z0-9-]+\.md)`",
                               section.group(1))
            with self.subTest(code=code):
                self.assertLessEqual(len(named), 1, f"{code} names more than one file")
                for name in named:
                    path = SPLIT / name
                    self.assertTrue(path.is_file(), f"{name} is missing")
                    text = path.read_text(encoding="utf-8")
                    self.assertRegex(text, rf"(?m)^## {code}$")
                    # The walk-through is there, not just its heading.
                    body = re.search(rf"(?ms)^## {code}\n(.*)", text).group(1)
                    self.assertTrue(body.strip(), f"{name} has only its heading")
            if named:
                split_codes.add(code)
        self.assertEqual(split_codes,
                         {"NAMED_NO_PAGE", "PROP_NOT_COPIED", "TOHIT_UNREAD"})

    def test_the_list_and_the_stubs_name_the_same_files(self):
        # The list after the code table and each code's own section must
        # send the agent to the same file.
        listed = dict(re.findall(
            r"(?m)^- `([A-Z_]+)`: `site-faults/([a-z0-9-]+\.md)`$", QA))
        stubs = {}
        for code in CODES:
            section = re.search(rf"(?ms)^## {code}\n(.*?)(?=^## |\Z)", QA)
            named = re.findall(r"`site-faults/([a-z0-9-]+\.md)`",
                               section.group(1))
            if named:
                stubs[code] = named[0]
        self.assertTrue(stubs)
        self.assertEqual(listed, stubs)

    def test_every_split_file_is_named_from_site_faults(self):
        # A file nobody points at is never read.
        files = sorted(p.name for p in SPLIT.glob("*.md"))
        self.assertTrue(files)
        for name in files:
            with self.subTest(file=name):
                self.assertTrue(f"`site-faults/{name}`" in QA,
                                f"site-faults.md never names {name}")

    def test_the_error_rule_exempts_every_error_code_the_tool_raises(self):
        # The "ERROR rows ... stop this check" bullet must not catch a finding.
        bullet = QA[QA.index("- `ERROR` rows"):QA.index("- `INFO (site)")]
        for code in ("NAMED_NO_PAGE", "WITHHELD_PUBLISHED"):
            self.assertIn(code, bullet)

    def test_troubleshooting_states_no_count_of_codes(self):
        self.assertNotRegex(
            TROUBLE, r"(?i)\b(one|two|three|four|five|six|seven|eight|nine"
                     r"|\d+) of its codes")
        self.assertIn("site-faults.md", TROUBLE)


if __name__ == "__main__":
    unittest.main()

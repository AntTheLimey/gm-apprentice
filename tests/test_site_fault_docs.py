#!/usr/bin/env python3
"""The note-fault codes: the publish tool's list is the one list.

`tools/publish/lib/note-faults.js` names the codes (`CODES`). The `doctor
--site` help, the Site Faults check's reference and `vault_check.py` must
each know every one of them, so a code added there cannot be left out here.
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
QA = (ROOT / "skills/campaign-qa/references/checks/site-faults.md"
      ).read_text(encoding="utf-8")
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

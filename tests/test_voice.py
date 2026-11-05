"""The voice field: nine templates carry it."""

import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import schema_rules as rules  # noqa: E402

TEMPLATES = REPO / "skills" / "shared" / "templates"
NAMES = ["campaign-overview", "npc", "pc-generic", "pc-coc-7e",
         "pc-coc-7e-regency", "pc-gurps-4e", "pc-fitd",
         "pc-dnd-5e-2024", "pc-pf2e"]


class TemplatesCarryVoice(unittest.TestCase):
    def test_templates_carry_voice(self):
        for name in NAMES:
            text = (TEMPLATES / f"{name}.md").read_text(encoding="utf-8")
            front = text.split("---")[1]
            lines = [ln for ln in front.splitlines() if ln.startswith("voice:")]
            self.assertEqual(len(lines), 1, name)
            self.assertRegex(lines[0], r'^voice: ""\s+#', name)

    def test_show_lists_voice(self):
        for etype in ("pc", "npc"):
            self.assertIn("voice", rules.show(etype), etype)


if __name__ == "__main__":
    unittest.main()

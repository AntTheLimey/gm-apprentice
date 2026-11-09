"""A wrap-up's `> [!info] Source` callout is GM bookkeeping: the shared
template fences it, and the player site drops it once fenced (#542)."""

import os
import shutil
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from vaultlib import publisher_lines, scan_body  # noqa: E402

HAS_NODE = shutil.which("node") is not None

FM = "---\ntype: session_wrap\nsession_number: 3\n---\n\n"
HEAD = "# Chapter 01 · Session 03 — Docks — Wrap-Up\n\n"
CALLOUT = "> [!info] Source\n> play notes export, session ended mid-scene\n"
RECAP = "\n## Narrative Recap\n\nThe party reached the docks.\n"
GM = "\n<!-- gm-only -->\n\n## GM Notes\n\nSecrets.\n\n<!-- /gm-only -->\n"
OPEN, CLOSE = "<!-- gm-only -->\n", "<!-- /gm-only -->\n"

UNFENCED = FM + HEAD + CALLOUT + RECAP + GM
FENCED = FM + HEAD + OPEN + CALLOUT + CLOSE + RECAP + GM


class TemplateTests(unittest.TestCase):
    def test_the_shared_template_fences_its_source_callout(self):
        text = (SCRIPTS.parent / "templates" / "session-wrap.md").read_text(
            encoding="utf-8")
        states, problems = scan_body(text)
        self.assertEqual(problems, [])
        source = [s for s in states if s.line.startswith("> [!info] Source")]
        self.assertEqual(len(source), 1)
        self.assertGreater(source[0].gm_depth, 0)


    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node for the publish tool")
    def test_the_player_site_drops_the_fenced_callout(self):
        before = "\n".join(publisher_lines(UNFENCED, [], {}))
        self.assertIn("Source", before)
        after = "\n".join(publisher_lines(FENCED, [], {}))
        self.assertNotIn("Source", after)
        self.assertIn("The party reached the docks.", after)


if __name__ == "__main__":
    unittest.main()

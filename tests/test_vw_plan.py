#!/usr/bin/env python3
"""vault_write.py plan: a session's Plan written, the index stamped and the
Plan checked, in one call (#494)."""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402

TEMPLATES = REPO / "skills" / "shared" / "templates"
CHAPTER = "Chapters/Chapter 1 - Harbour"
SESSIONS = f"{CHAPTER}/Sessions"
PREV = f"{SESSIONS}/Session 01 - Landfall.md"
INDEX = f"{SESSIONS}/Session 02 - The Quay.md"
PLAN = f"{SESSIONS}/Session 02 - The Quay - Plan.md"

PREV_TEXT = """---
type: session
session_number: 1
chapter: "[[Chapter 1 - Harbour]]"
campaign: "Harbour Lights"
play_date: "2026-10-01"
status: reviewed
documents:
  plan: null
  play_notes: null
  wrap_up: null
tags: []
---

# Session 01 - Landfall
"""

INDEX_TEXT = """---
type: session
session_number: 2
chapter: "[[Chapter 1 - Harbour]]"
campaign: "Harbour Lights"
play_date: null
status: planned
documents:
  plan: null
  play_notes: null
  wrap_up: null
tags: []
---

# Session 02 - The Quay
"""

BODY = """## Session Intent

Ma Barker's debt comes due.

## Session Overview

The crew meets [[Ma Barker]] on the quay.

## GM Notes

## Planned Scenes

### The Quay at Dawn

**Situation:** Barker waits by the crane.
**Starts it:** A whistle from the crane cab.
"""


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vw-plan-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, *argv, stdin=BODY):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = vw.main([str(vault), "plan", *argv], stdin=stdin)
    return code, out.getvalue()


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, {
            f"{CHAPTER}/Chapter 1 - Harbour.md": "---\ntype: chapter\n---\n",
            PREV: PREV_TEXT,
            INDEX: INDEX_TEXT,
            "_Templates/_Template_Session.md":
                (TEMPLATES / "session.md").read_text(encoding="utf-8"),
        })

    def read(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_dry_run_writes_nothing_and_still_checks(self):
        code, out = run(self.vault, "--number", "2")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{PLAN}", out)
        self.assertIn("# plan_check: errors: 0", out)
        self.assertFalse((self.vault / PLAN).exists())

    def test_plan_gets_the_template_frontmatter_from_the_index(self):
        code, out = run(self.vault, "--number", "2", "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.read(PLAN))
        self.assertEqual(fm["type"], "session-plan")
        self.assertEqual(vl.wikilink_target(fm["session"]),
                         "Session 02 - The Quay")
        self.assertEqual(vl.wikilink_target(fm["chapter"]),
                         "Chapter 1 - Harbour")
        self.assertEqual(fm["campaign"], "Harbour Lights")

    def test_the_body_is_kept_and_missing_sections_added_in_order(self):
        run(self.vault, "--number", "2", "--write")
        text = self.read(PLAN)
        self.assertIn("Ma Barker's debt comes due.", text)
        self.assertIn("**Starts it:** A whistle", text)
        heads = [t for _i, lvl, t in vl.fenced_headings(text) if lvl == 2]
        template = (TEMPLATES / "session-plan.md").read_text(
            encoding="utf-8")
        want = [t for _i, lvl, t in vl.fenced_headings(template)
                if lvl == 2]
        self.assertEqual(heads, want)

    def test_index_is_stamped_prepped_with_the_plan_link(self):
        run(self.vault, "--number", "2", "--write")
        text = self.read(INDEX)
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["status"], "prepped")
        self.assertIn('documents:\n  plan: "[[Session 02 - The Quay - '
                      'Plan]]"\n  play_notes: null\n  wrap_up: null\n', text)
        self.assertIn("# Session 02 - The Quay\n", text)

    def test_a_played_index_keeps_its_status(self):
        (self.vault / INDEX).write_text(
            INDEX_TEXT.replace("status: planned", "status: played"))
        code, out = run(self.vault, "--number", "2", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertEqual(
            vl.extract_frontmatter(self.read(INDEX))["status"], "played")

    def test_no_index_files_one_as_upcoming_with_title(self):
        (self.vault / INDEX).unlink()
        code, out = run(self.vault, "--number", "2", "--title",
                        "The Quay", "--chapter", "Chapter 1 - Harbour",
                        "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.read(INDEX))
        self.assertEqual(fm["status"], "prepped")
        self.assertTrue((self.vault / PLAN).is_file())
        self.assertFalse(any("Play Notes" in p.name
                             for p in self.vault.rglob("*.md")))

    def test_no_index_and_no_title_is_refused(self):
        (self.vault / INDEX).unlink()
        code, out = run(self.vault, "--number", "2", "--write")
        self.assertEqual(code, 1)
        self.assertIn("pass --title", out)

    def test_an_existing_plan_is_never_overwritten(self):
        run(self.vault, "--number", "2", "--write")
        before = self.read(PLAN)
        code, out = run(self.vault, "--number", "2", "--write")
        self.assertEqual(code, 1)
        self.assertIn("pass --section", out)
        self.assertEqual(self.read(PLAN), before)

    def test_section_replaces_by_level_and_title(self):
        run(self.vault, "--number", "2", "--write")
        code, out = run(self.vault, "--number", "2", "--section", "--write",
                        stdin="## Session Intent\n\nThe quay, at last.\n")
        self.assertEqual(code, 0, out)
        text = self.read(PLAN)
        self.assertIn("The quay, at last.", text)
        self.assertNotIn("debt comes due", text)
        self.assertIn("**Situation:** Barker waits", text)

    def test_section_replaces_one_scene(self):
        run(self.vault, "--number", "2", "--write")
        code, out = run(
            self.vault, "--number", "2", "--section", "--write",
            stdin="### The Quay at Dawn\n\n**Situation:** Fog.\n"
                  "**Starts it:** A bell.\n")
        self.assertEqual(code, 0, out)
        text = self.read(PLAN)
        self.assertIn("**Situation:** Fog.", text)
        self.assertNotIn("crane", text)

    def test_section_a_scene_the_plan_lacks_is_refused(self):
        run(self.vault, "--number", "2", "--write")
        code, out = run(self.vault, "--number", "2", "--section",
                        stdin="### Nowhere\n\nText.\n")
        self.assertEqual(code, 1)
        self.assertIn("send it inside its ## section", out)

    def test_the_plan_the_index_links_is_the_one_used(self):
        own = f"{SESSIONS}/My Quay Notes.md"
        (self.vault / own).write_text(
            "---\ntype: session-plan\n---\n\n## Session Intent\n\nMine.\n")
        (self.vault / INDEX).write_text(INDEX_TEXT.replace(
            "plan: null", 'plan: "[[My Quay Notes]]"'))
        code, out = run(self.vault, "--number", "2", "--write")
        self.assertEqual(code, 1)
        self.assertIn(own, out)
        code, out = run(self.vault, "--number", "2", "--section", "--write",
                        stdin="## Session Overview\n\nThe quay.\n")
        self.assertEqual(code, 0, out)
        text = self.read(own)
        self.assertIn("Mine.", text)
        self.assertIn("## Session Overview\n\nThe quay.", text)
        self.assertFalse((self.vault / PLAN).exists())

    def test_section_without_a_plan_is_refused(self):
        code, out = run(self.vault, "--number", "2", "--section")
        self.assertEqual(code, 1)
        self.assertIn("no Plan yet", out)

    def test_stdin_frontmatter_is_dropped_with_a_warning(self):
        code, out = run(self.vault, "--number", "2", "--write",
                        stdin="---\ntype: wrong\n---\n" + BODY)
        self.assertEqual(code, 0, out)
        self.assertIn("frontmatter on stdin dropped", out)
        self.assertEqual(
            vl.extract_frontmatter(self.read(PLAN))["type"], "session-plan")

    def test_headless_runs_the_hard_guard(self):
        code, out = run(self.vault, "--number", "2", "--headless")
        self.assertEqual(code, 0, out)
        self.assertIn("hard-guard", out)
        _code, out = run(self.vault, "--number", "2", "--headless",
                         "--gm-input")
        self.assertNotIn("ERROR\t", out)

    def test_gm_input_without_headless_is_refused(self):
        code, out = run(self.vault, "--number", "2", "--gm-input", "scenes")
        self.assertEqual(code, 1)
        self.assertIn("pass --headless too", out)

    def test_empty_sections_are_one_line(self):
        _code, out = run(self.vault, "--number", "2")
        self.assertEqual(out.count("placeholder"), 1, out)


if __name__ == "__main__":
    unittest.main()

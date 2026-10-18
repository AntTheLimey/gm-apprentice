#!/usr/bin/env python3
"""reconcile_scan.py: the counts reconcile's quick path reads."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reconcile_scan as rs  # noqa: E402

BENCH = ROOT / "tests" / "benchmark-campaign"
SESSIONS = "Chapters/Chapter 1/Sessions"
INDEX = f"{SESSIONS}/Session 05 - The Ball.md"
PLAN = f"{SESSIONS}/Session 05 - The Ball - Plan.md"
WRAP = f"{SESSIONS}/Session 05 - The Ball - Wrap-Up.md"

FILES = {
    f"{SESSIONS}/Session 04 - Before - Wrap-Up.md":
        "---\ntype: session_wrap\nsession: \"[[Session 04 - Before]]\"\n"
        "canon_status: AUTHORITATIVE\n---\n\n# Before\n",
    INDEX:
        "---\ntype: session\nsession_number: 5\nstatus: wrap-up\ndocuments:\n"
        "  plan: \"[[Session 05 - The Ball - Plan]]\"\n  play_notes: null\n"
        "  wrap_up: \"[[Session 05 - The Ball - Wrap-Up]]\"\n---\n",
    PLAN:
        "---\ntype: session-plan\nsession: \"[[Session 05 - The Ball]]\"\n"
        "canon_status: DRAFT\n---\n",
    WRAP:
        "---\ntype: session_wrap\nsession: \"[[Session 05 - The Ball]]\"\n"
        "canon_status: DRAFT\n---\n\n# The Ball\n\n"
        "The party met [[Lady Grey]] and [[The Duke|the Duke]] at [[Hall]].\n\n"
        "> [!info] Reconstruction Note\n> Pieced together from memory.\n\n"
        "<!-- UNVERIFIED: the Duke was at the docks -->\n"
        "<!-- UNVERIFIED -->\n"
        "```\n<!-- UNVERIFIED: in code, not counted -->\n```\n"
        "See [[Session 05 - The Ball]].\n",
    "NPCs/Lady_Grey.md":
        "---\ntype: npc\ncanon_status: DRAFT\ncreatedSession: \"Session 5\"\n"
        "aliases: [\"Lady Grey\"]\n---\n\n"
        "## Overview\n\n<!-- spoiler -->\nShe is the Duke's sister and has been "
        "lying to everyone at court.\n<!-- /spoiler -->\n\n"
        "```\n<!-- spoiler -->\n```\n",
    "NPCs/The Duke.md":
        "---\ntype: npc\ncanon_status: AUTHORITATIVE\n---\n\n<!-- gm-only -->\nx\n"
        "<!-- /gm-only -->\n",
    "Locations/Hall.md":
        "---\ntype: location\ncanon_status: DRAFT\ncreatedSession: \"Session 2\"\n---\n",
}


def make_vault(tmp: str, files: dict[str, str]) -> Path:
    vault = Path(tmp)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def scan(files: dict[str, str], wrap: str = WRAP) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        return rs.scan(make_vault(tmp, files), wrap)


def plain_wrap(files: dict[str, str]) -> dict[str, str]:
    """No markers, no reconstruction note, no Plan."""
    files = dict(files)
    files[WRAP] = files[WRAP].split("> [!info]")[0]
    files.pop(PLAN, None)
    return files


class Scan(unittest.TestCase):
    def test_counts_and_lists(self):
        self.assertEqual(scan(FILES), [
            f"wrap-up: {WRAP}",
            f"session: {INDEX} (status: wrap-up, session_number: 5)",
            "skip: no",
            "unverified: 2",
            "  line 14: the Duke was at the docks",
            "  line 15: (bare)",
            "reconstruction notes: 1",
            "  line 11",
            f"plan: {PLAN}",
            "linked entities: 3",
            "draft entities created this session: 1",
            "  NPCs/Lady_Grey.md",
            "older draft entities linked (the quick path leaves them): 1",
            "  Locations/Hall.md (createdSession: Session 2)",
            "unverified in linked notes: 0",
            "open spoilers: 1",
            "  NPCs/Lady_Grey.md:10: She is the Duke's sister and has been lying to...",
            "quick path: no (2 UNVERIFIED markers, a Plan file)",
        ])

    def test_quick_path_with_new_drafts_leaves_the_contradiction_to_judge(self):
        out = scan(plain_wrap(FILES))
        self.assertIn("plan: none", out)
        self.assertIn("unverified: 0", out)
        self.assertEqual(out[-1], "quick path: yes, unless a DRAFT entity created "
                         "this session contradicts AUTHORITATIVE canon on the same facts")

    def test_a_same_numbered_draft_from_another_chapter_is_older(self):
        # #440: session numbers restart each chapter.
        files = plain_wrap(FILES)
        files["NPCs/Lady_Grey.md"] = files["NPCs/Lady_Grey.md"].replace(
            '"Session 5"', '"Chapter 2, Session 5"')
        files[INDEX] = files[INDEX].replace(
            "status: wrap-up", 'status: wrap-up\nchapter: "[[Chapter 1 - Start]]"')
        out = scan(files)
        self.assertIn("draft entities created this session: 0", out)
        self.assertIn("  NPCs/Lady_Grey.md (createdSession: Chapter 2, Session 5)", out)
        files["NPCs/Lady_Grey.md"] = files["NPCs/Lady_Grey.md"].replace(
            "Chapter 2,", "Chapter 1,")
        self.assertIn("draft entities created this session: 1", scan(files))
        # Chapters compare as numbers: "01" is chapter 1.
        files["NPCs/Lady_Grey.md"] = files["NPCs/Lady_Grey.md"].replace(
            "Chapter 1,", "Chapter 01,")
        self.assertIn("draft entities created this session: 1", scan(files))

    def test_the_chapter_comes_from_the_indexs_folder_too(self):
        files = plain_wrap(FILES)
        files["NPCs/Lady_Grey.md"] = files["NPCs/Lady_Grey.md"].replace(
            '"Session 5"', '"Chapter 2, Session 5"')
        self.assertIn("draft entities created this session: 0", scan(files))

    def test_unverified_on_a_linked_entity_file_is_not_the_quick_path(self):
        # #434: a held claim may sit on the entity file, not the Wrap-Up.
        files = plain_wrap(FILES)
        files["NPCs/The Duke.md"] += "\nHe fled.\n<!-- UNVERIFIED: he fled -->\n"
        out = scan(files)
        self.assertIn("unverified: 0", out)
        self.assertIn("unverified in linked notes: 1", out)
        self.assertIn("  NPCs/The Duke.md:11: he fled", out)
        self.assertEqual(out[-1], "quick path: no (1 UNVERIFIED marker on a linked note)")

    def test_a_marker_tagged_with_another_session_does_not_block(self):
        # #434: markers name the session that wrote them; only this
        # session's, and untagged ones, rule out the quick path.
        files = plain_wrap(FILES)
        files[INDEX] = files[INDEX].replace(
            "status: wrap-up", 'status: wrap-up\nchapter: "[[Chapter 1 - Start]]"')
        files["NPCs/The Duke.md"] += ("<!-- UNVERIFIED (S4): he fled -->\n"
                                      "<!-- UNVERIFIED (Ch2 S5): he hid -->\n")
        out = scan(files)
        self.assertIn("unverified in linked notes: 2", out)
        self.assertIn("  NPCs/The Duke.md:9: (S4) he fled [another session]", out)
        self.assertIn("  NPCs/The Duke.md:10: (Ch2 S5) he hid [another session]", out)
        self.assertTrue(out[-1].startswith("quick path: yes"), out[-1])
        for tag in ("S5", "Ch1 S5"):
            files["NPCs/The Duke.md"] += f"<!-- UNVERIFIED ({tag}): now -->\n"
            out = scan(files)
            self.assertIn(f"  NPCs/The Duke.md:11: ({tag}) now", out)
            self.assertEqual(out[-1], "quick path: no (1 UNVERIFIED marker on a linked note)")
            files["NPCs/The Duke.md"] = files["NPCs/The Duke.md"].replace(
                f"<!-- UNVERIFIED ({tag}): now -->\n", "")

    def test_only_older_drafts_is_a_plain_yes(self):
        files = plain_wrap(FILES)
        files["NPCs/Lady_Grey.md"] = files["NPCs/Lady_Grey.md"].replace(
            "Session 5", "Session 3")
        out = scan(files)
        self.assertIn("draft entities created this session: 0", out)
        self.assertIn("older draft entities linked (the quick path leaves them): 2", out)
        self.assertEqual(out[-1], "quick path: yes")

    # Ruling 1: first session means session_number 1, and never with markers.
    def test_first_session_is_session_number_one(self):
        files = plain_wrap(FILES)
        files[INDEX] = files[INDEX].replace("session_number: 5", "session_number: 1")
        self.assertIn("skip: first session (session_number 1)", scan(files))

    def test_session_one_with_markers_is_not_skipped(self):
        files = dict(FILES)
        files[INDEX] = files[INDEX].replace("session_number: 5", "session_number: 1")
        self.assertIn("skip: no", scan(files))
        files[WRAP] = files[WRAP].replace("<!-- UNVERIFIED", "<!-- X")
        self.assertIn("skip: no", scan(files))  # the reconstruction note alone

    def test_only_wrap_up_in_the_vault_is_not_a_first_session(self):
        files = plain_wrap(FILES)
        del files[f"{SESSIONS}/Session 04 - Before - Wrap-Up.md"]
        self.assertIn("skip: no", scan(files))

    # Ruling 3: fallbacks resolve by identity, never a bare name.
    def test_fallbacks_stay_in_their_chapter(self):
        files = plain_wrap(FILES)
        other = "Chapters/Chapter 2/Sessions"
        files[WRAP] = files[WRAP].replace('session: "[[Session 05 - The Ball]]"', "session: 5")
        files[INDEX] = files[INDEX].replace(
            '  plan: "[[Session 05 - The Ball - Plan]]"\n', "  plan: null\n")
        # Chapter 2 holds same-named notes: its index and Plan must not be taken.
        files[f"{other}/Session 05 - The Ball.md"] = (
            "---\ntype: session\nsession_number: 5\nstatus: reviewed\ndocuments:\n"
            "  wrap_up: \"[[Session 05 - The Ball - Wrap-Up]]\"\n---\n")
        files[f"{other}/Session 05 - The Ball - Wrap-Up.md"] = (
            "---\ntype: session_wrap\nsession: \"[[Session 05 - The Ball]]\"\n---\n")
        files[f"{other}/Session 05 - The Ball - Plan.md"] = (
            "---\ntype: session-plan\nsession: \"[[Session 05 - The Ball]]\"\n---\n")
        out = scan(files)
        self.assertIn(f"session: {INDEX} (status: wrap-up, session_number: 5)", out)
        self.assertIn("plan: none", out)
        self.assertEqual(out[-1], "quick path: yes, unless a DRAFT entity created "
                         "this session contradicts AUTHORITATIVE canon on the same facts")

    def test_plan_found_by_its_session_link(self):
        files = dict(FILES)
        files[INDEX] = files[INDEX].replace(
            '  plan: "[[Session 05 - The Ball - Plan]]"\n', "  plan: null\n")
        self.assertIn(f"plan: {PLAN}", scan(files))

    def test_documents_plan_must_be_a_session_plan(self):
        files = plain_wrap(FILES)
        files[INDEX] = files[INDEX].replace("[[Session 05 - The Ball - Plan]]", "[[Hall]]")
        self.assertIn("plan: none", scan(files))

    # Ruling 4: no index, no quick path.
    def test_no_index_is_no_quick_path(self):
        files = plain_wrap(FILES)
        del files[INDEX]
        out = scan(files)
        self.assertIn("session: not found (no session index links this Wrap-Up)", out)
        self.assertEqual(out[-1], "quick path: no (session index not found)")

    # Ruling 6: any case, and across lines.
    def test_unverified_any_case_and_across_lines(self):
        files = plain_wrap(FILES)
        files[WRAP] += "<!-- unverified: lower -->\n<!-- UNVERIFIED: the claim\nruns on -->\n"
        out = scan(files)
        self.assertIn("unverified: 2", out)
        self.assertIn("  line 11: lower", out)
        self.assertIn("  line 12: the claim runs on", out)

    def test_benchmark_reviewed_session(self):
        out = rs.scan(BENCH, f"{SESSIONS}/Session 04 - The Reckoning - Wrap-Up.md")
        self.assertIn("skip: status is already reviewed", out)
        self.assertIn("draft entities created this session: 0", out)

    # Ruling 5: absolute paths, and two different errors.
    def test_absolute_path_inside_the_vault(self):
        wrap = BENCH / SESSIONS / "Session 04 - The Reckoning - Wrap-Up.md"
        self.assertEqual(rs.scan(BENCH, str(wrap))[0],
                         f"wrap-up: {SESSIONS}/Session 04 - The Reckoning - Wrap-Up.md")

    def test_errors(self):
        with self.assertRaisesRegex(LookupError, "is not a Wrap-Up \\(type: session\\)"):
            rs.scan(BENCH, f"{SESSIONS}/Session 04 - The Reckoning.md")
        with self.assertRaisesRegex(LookupError, "^no note at nope.md$"):
            rs.scan(BENCH, "nope.md")
        with self.assertRaisesRegex(LookupError, "is not inside the vault"):
            rs.scan(BENCH, str(ROOT / "README.md"))


class Cli(unittest.TestCase):
    def test_exit_codes(self):
        script = str(SCRIPTS / "reconcile_scan.py")
        ok = subprocess.run(
            [sys.executable, "-I", script, str(BENCH),
             f"./{SESSIONS}/Session 02 - The Docks at Night - Wrap-Up.md"],
            capture_output=True, text=True, check=False)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(ok.stdout.rstrip().endswith("quick path: yes"))
        bad = subprocess.run([sys.executable, script, str(BENCH), "nope.md"],
                             capture_output=True, text=True, check=False)
        self.assertEqual(bad.returncode, 2)
        self.assertIn("no note at nope.md", bad.stderr)


if __name__ == "__main__":
    unittest.main()

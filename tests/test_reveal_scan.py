#!/usr/bin/env python3
"""reveal_scan.py: what is still hidden in what a session touched.

Run: python3 tests/test_reveal_scan.py
"""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reveal_scan as rv  # noqa: E402
from vault_check import ToolAnswer  # noqa: E402

SESS = "Chapters/Chapter 1/Sessions"
INDEX = f"{SESS}/Session 12 - Mill.md"
NOTES = f"{SESS}/Session 12 - Mill - Play Notes.md"
WRAP = f"{SESS}/Session 12 - Mill - Wrap-Up.md"
PLAN = f"{SESS}/Session 12 - Mill - Plan.md"


def base(play: str = "The party met [[Vex]].\n", wrap: str = "Nothing.\n",
         plan: str = "Plan: [[Mill]].\n") -> dict[str, str]:
    return {
        INDEX: "---\ntype: session\nsession_number: 12\ndocuments:\n"
               "  plan: \"[[Session 12 - Mill - Plan]]\"\n"
               "  play_notes: \"[[Session 12 - Mill - Play Notes]]\"\n"
               "  wrap_up: \"[[Session 12 - Mill - Wrap-Up]]\"\n---\n",
        NOTES: f"---\ntype: session-play-notes\n---\n\n{play}",
        WRAP: f"---\ntype: session_wrap\n---\n\n{wrap}",
        PLAN: f"---\ntype: session-plan\n---\n\n{plan}",
    }


def make_vault(tmp: str, files: dict[str, str]) -> Path:
    vault = Path(tmp)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def tool(listed: bool = True, publishing: list[str] | None = None,
         stripped: dict[str, list[str]] | None = None) -> Any:
    def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
        if args[:2] == ["manifest", "list"]:
            if not listed:
                return ToolAnswer(data={"listed": False, "publishing": []})
            return ToolAnswer(data={"listed": True, "publishing": publishing or [],
                                    "excluded": [], "needs_decision": []})
        pages = [{"path": p, "strippedSections": s} for p, s in (stripped or {}).items()]
        return ToolAnswer(data={"pages": pages})
    return ask


def run_scan(files: dict[str, str], **kw: Any) -> rv.ScanResult:
    with tempfile.TemporaryDirectory() as tmp, \
            mock.patch.object(rv, "ask_publish_tool", tool(**kw)):
        return rv.scan(make_vault(tmp, files), INDEX)


VEX = "---\ntype: npc\nwithheld: true\n---\n\n# Vex\n"


class RevealScan(unittest.TestCase):
    def test_lists_unpublished_and_withheld(self) -> None:
        res = run_scan({**base(), "NPCs/Vex.md": VEX})
        self.assertEqual([(r.path, r.published, r.withheld) for r in res.rows],
                         [("NPCs/Vex.md", False, True)])
        self.assertEqual(res.sources, ["Play Notes", "Wrap-Up"])

    def test_lists_hidden_parts_of_published_note(self) -> None:
        mill = ("---\ntype: location\ngm_aliases: [The Widow]\n---\n\n# Mill\n\n"
                "## GM Notes\n\nSecret.\n\n<!-- gm-only -->\nx\n<!-- /gm-only -->\n\n"
                "<!-- spoiler -->\nthe wheel hides a body\n<!-- /spoiler -->\n")
        res = run_scan({**base(play="At [[Mill]].\n"), "Places/Mill.md": mill},
                       publishing=["Places/Mill.md"],
                       stripped={"Places/Mill.md": ["GM Notes"]})
        self.assertEqual(len(res.rows), 1)
        row = res.rows[0]
        self.assertTrue(row.published)
        self.assertFalse(row.withheld)
        self.assertEqual(row.hidden, ["GM Notes", "gm-only x1",
                                      "spoiler: the wheel hides a body",
                                      "gm_aliases: The Widow"])

    def test_fully_public_note_not_listed(self) -> None:
        res = run_scan({**base(play="At [[Mill]].\n"),
                        "Places/Mill.md": "---\ntype: location\n---\n\n# Mill\n"},
                       publishing=["Places/Mill.md"])
        self.assertEqual(res.rows, [])

    def test_prep_types_never_candidates(self) -> None:
        files = {**base(play="[[Hall Scene]] [[Session 12 - Mill - Plan]] [[Session 11]]\n"),
                 f"{SESS}/Hall Scene.md": "---\ntype: scene\n---\n",
                 f"{SESS}/Session 11.md": "---\ntype: session\n---\n"}
        self.assertEqual(run_scan(files).rows, [])

    def test_no_publish_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool(listed=False)):
            vault = make_vault(tmp, {**base(), "NPCs/Vex.md": VEX})
            self.assertFalse(rv.scan(vault, INDEX).listed)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = rv.main([str(vault), INDEX])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), "reveals: no publish list; nothing to unlock\n")

    def test_plan_only_link_not_evidence(self) -> None:
        files = {**base(play="Nothing here.\n", plan="Plan: [[Vex]].\n"),
                 "NPCs/Vex.md": VEX}
        self.assertEqual(run_scan(files).rows, [])

    def test_no_play_notes_or_wrap_up(self) -> None:
        files = {INDEX: "---\ntype: session\ndocuments:\n  plan: null\n---\n"}
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool()):
            res = rv.scan(make_vault(tmp, files), INDEX)
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: none)", "# notes: 0"])

    def test_render_rows(self) -> None:
        res = run_scan({**base(), "NPCs/Vex.md": VEX})
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: Play Notes, Wrap-Up)",
            "NPCs/Vex.md\tunpublished withheld\t", "# notes: 1"])


if __name__ == "__main__":
    unittest.main()

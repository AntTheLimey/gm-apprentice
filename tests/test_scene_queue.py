#!/usr/bin/env python3
"""Tests for scene_queue.py, the prep queue of unplayed chapter scenes.

Run: python3 tests/test_scene_queue.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import scene_queue as sq  # noqa: E402

CH = "Chapters/Chapter 1 - Vienna"


def scene(status: str, chapter: str = "Chapter 1 - Vienna") -> str:
    return (f"---\ntype: scene\nchapter: \"[[{chapter}]]\"\n"
            f"status: {status}\n---\n\n**Situation:** x\n")


class QueueTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.vault = Path(self._tmp.name)
        self.put(f"{CH}/Chapter 1 - Vienna.md",
                 "---\ntype: chapter\nstatus: active\n---\n")
        self.put(f"{CH}/Scenes/Opera.md", scene("planned"))
        self.put(f"{CH}/Scenes/Waltz/Waltz.md", scene("ready"))
        self.put(f"{CH}/Side Adventure/Scenes/Cellar.md", scene("planned"))
        self.put(f"{CH}/Scenes/Done.md", scene("played"))
        self.put(f"{CH}/Scenes/Gone.md", scene("cut"))
        self.put(f"{CH}/Sessions/Session 08/Scenes/Old.md", scene("ready"))
        self.put(f"{CH}/Session 09/Scenes/Older.md", scene("planned"))
        self.put(f"{CH}/Sessions/Session 08/Scenes/Stalled.md",
                 scene("paused"))

    def put(self, rel: str, text: str) -> None:
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def titles(self, **kw) -> list[str]:
        return [r.title for r in sq.queue(self.vault, **kw)]

    def test_queue_order_and_members(self):
        self.assertEqual(self.titles(),
                         ["Stalled", "Opera", "Waltz", "Cellar"])

    def test_session_folder_scenes_are_history(self):
        titles = self.titles()
        self.assertNotIn("Old", titles)
        self.assertNotIn("Older", titles)

    def test_played_and_dropped_excluded(self):
        titles = self.titles()
        self.assertNotIn("Done", titles)
        self.assertNotIn("Gone", titles)

    def test_row_fields(self):
        rows = {r.title: r for r in sq.queue(self.vault)}
        self.assertEqual(rows["Cellar"].folder, "Side Adventure")
        self.assertEqual(rows["Opera"].folder, "")
        self.assertEqual(rows["Waltz"].status, "planned")
        self.assertEqual(rows["Opera"].chapter, "Chapter 1 - Vienna")

    def test_chapter_filter(self):
        self.assertEqual(self.titles(chapter="Chapter 1 - Vienna"),
                         ["Stalled", "Opera", "Waltz", "Cellar"])
        self.assertEqual(self.titles(chapter="Nowhere"), [])

    def test_cli_rows(self):
        out = subprocess.run(
            [sys.executable, str(SCRIPTS / "scene_queue.py"),
             str(self.vault)], capture_output=True, text=True, check=True
        ).stdout.splitlines()
        self.assertEqual(out[0], "paused\tSessions/Session 08\t[[Stalled]]")
        self.assertIn("planned\tSide Adventure\t[[Cellar]]", out)
        self.assertIn("planned\t\t[[Opera]]", out)


if __name__ == "__main__":
    unittest.main()

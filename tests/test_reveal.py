#!/usr/bin/env python3
"""reveal.py: publish what the GM says came out, lift withheld, log it.

Run: python3 tests/test_reveal.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reveal  # noqa: E402

VEX = "NPCs/Vex.md"
SESSION = "Chapters/Chapter 1/Sessions/Session 12 - Mill.md"


def make(root: Path, extra: dict[str, str] | None = None) -> None:
    files = {
        VEX: "---\ntype: npc\nwithheld: true\n---\n\nVex.\n",
        "Places/Mill.md": "---\ntype: location\n---\n\nMill.\n",
        SESSION: "---\ntype: session\n---\n\nIndex.\n",
        "Scenes/Hook.md": "---\ntype: scene\n---\n\nHook.\n",
        **(extra or {}),
    }
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def run(root: Path, *args: str, applied: tuple[list[str], str | None] | None = None,
        site: bool = True) -> tuple[int, str, mock.Mock]:
    buf = io.StringIO()
    config = (Path("/site/vault.config.json"), None) if site else (None, None)

    def fake(_vault: Path, paths: list[str]) -> tuple[list[str], str | None]:
        return (list(paths), None) if applied is None else applied

    with mock.patch.object(reveal, "_site_config", return_value=config), \
            mock.patch.object(reveal, "apply_publish", side_effect=fake) as ap, \
            contextlib.redirect_stdout(buf):
        code = reveal.main([str(root), "--session", "Session 12", *args])
    return code, buf.getvalue(), ap


def log_of(root: Path) -> dict:
    return json.loads((root / "_meta" / "reveals.json").read_text(encoding="utf-8"))


class RevealTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        make(self.root)

    def test_dry_run_writes_nothing(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released", "Places/Mill.md=the wheel")
        self.assertEqual(code, 0)
        for verb in ("WOULD-PUBLISH", "WOULD-CLEAR", "WOULD-LOG"):
            self.assertIn(verb, out)
        ap.assert_not_called()
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_write_publishes_clears_and_logs(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released",
                            "Places/Mill.md=the wheel", "--write")
        self.assertEqual(code, 0, out)
        ap.assert_called_once()
        self.assertEqual(ap.call_args.args[1], [VEX])
        self.assertIn("withheld: false", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertIn("# publish: 1 clear: 1 log: 1 errors: 0", out)
        entries = log_of(self.root)["entries"]
        self.assertTrue(entries[0]["before_tracking"])
        self.assertEqual(entries[1]["session"], "Session 12")
        self.assertEqual(entries[1]["published"], [VEX])
        self.assertEqual(entries[1]["released"],
                         [{"page": "Places/Mill.md", "what": "the wheel"}])

    def test_absent_withheld_key_is_left_alone(self) -> None:
        code, _, _ = run(self.root, "--publish", "Places/Mill.md", "--write")
        self.assertEqual(code, 0)
        self.assertNotIn("withheld", (self.root / "Places/Mill.md").read_text(encoding="utf-8"))

    def test_apply_failure_leaves_withheld(self) -> None:
        code, out, _ = run(self.root, "--publish", VEX, "--write",
                           applied=([], "settings fault"))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertIn("settings fault", out)
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_same_session_merges(self) -> None:
        run(self.root, "--publish", VEX, "--released", "Places/Mill.md=the wheel", "--write")
        run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
            "--released", "Places/Mill.md=the wheel", "--write")
        entries = log_of(self.root)["entries"]
        self.assertEqual(sum(1 for e in entries if e.get("before_tracking")), 1)
        mine = [e for e in entries if e.get("session") == "Session 12"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["published"], ["NPCs/Vex.md", "Places/Mill.md"])
        self.assertEqual(len(mine[0]["released"]), 1)

    def test_no_site_config_refuses_publish(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released",
                            "Places/Mill.md=the wheel", "--write", site=False)
        self.assertEqual(code, 1)
        self.assertIn("no site to publish through", out)
        ap.assert_not_called()
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        entry = log_of(self.root)["entries"][-1]
        self.assertEqual(entry["published"], [])
        self.assertEqual(len(entry["released"]), 1)

    def test_released_only_logs(self) -> None:
        code, out, ap = run(self.root, "--released", "Places/Mill.md=the wheel", "--write")
        self.assertEqual(code, 0)
        ap.assert_not_called()
        self.assertIn("LOGGED", out)

    def test_refuses_meta_and_prep_paths(self) -> None:
        (self.root / "_meta").mkdir()
        (self.root / "_meta" / "x.md").write_text("---\n---\n", encoding="utf-8")
        for rel in ("_meta/x.md", "Scenes/Hook.md", SESSION):
            code, out, ap = run(self.root, "--publish", rel, "--write")
            self.assertEqual(code, 1, rel)
            self.assertIn("ERROR", out)
            ap.assert_not_called()

    def test_bad_args_exit_2(self) -> None:
        code, _, _ = run(self.root, "--released", "no equals sign")
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()

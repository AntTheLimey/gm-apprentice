#!/usr/bin/env python3
"""Regression tests for index_build.py — deriving `_meta/index.md` from a
vault scan.

Covers `collect()`'s counting rules (entities vs. narrative, skips), the
shape of `render()`'s output against the index template, Recent Changes
carry-over, the round trip against `vault_check.check_index` (the drift
detector this generator must agree with), and the CLI's dry-run/--write/
EOL-preservation behaviour.

Run: python3 tests/test_index_build.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import index_build as ib  # noqa: E402
import vault_check as vc  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "slice-b" / "index"
SCRIPT = SCRIPTS / "index_build.py"
TODAY = "2026-09-07"


def run_cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True)


def copy_fixture(case) -> Path:
    d = Path(tempfile.mkdtemp(prefix="index-build-"))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    shutil.copytree(FIX, d, dirs_exist_ok=True)
    return d


class CollectTests(unittest.TestCase):
    def test_counts(self):
        entries, chapters = ib.collect(FIX)
        typed = [e for e in entries if e.type]
        stems = sorted(e.stem for e in typed)
        self.assertEqual(
            stems, ["Ada", "Bram", "Docks", "Key", "Stub Guy", "The Guild"])

        narrative = (len(chapters)
                     + sum(c["sessions"] for c in chapters)
                     + sum(c["scenes"] for c in chapters))
        self.assertEqual(narrative, 4)

        all_stems = {e.stem for e in entries}
        self.assertNotIn("Ada_Story", all_stems)
        self.assertNotIn("_Template_NPC", all_stems)

        untyped = [e for e in entries if not e.type]
        self.assertEqual([e.stem for e in untyped], ["Untyped Note"])


class RenderShapeTests(unittest.TestCase):
    def setUp(self):
        self.text = ib.render(FIX, today=TODAY, previous=None)

    def test_frontmatter(self):
        self.assertTrue(self.text.startswith(
            "---\n"
            "type: meta\n"
            "purpose: vault-index\n"
            f"last_updated: {TODAY}\n"
            "entity_count: 6\n"
            "narrative_count: 4\n"
            "stub_count: 2\n"
            "---\n"))

    def test_chapters_section(self):
        self.assertIn("### Chapters", self.text)
        self.assertIn(
            "- [[Chapter 1 - Arrival]] "
            "(sessions: 2, scenes: 1, status: in_progress)",
            self.text)

    def test_active_session_section(self):
        self.assertIn("### Active Session", self.text)
        self.assertIn("[[Session 02]]", self.text.split("### Active Session", 1)[1]
                       .split("## Entities by Type", 1)[0])
        self.assertIn("status: prepped", self.text)

    def test_pcs(self):
        self.assertIn("**PCs (1):**", self.text)
        self.assertIn(
            "- [[Ada]] — Dockworker searching for her missing brother.",
            self.text)

    def test_locations(self):
        self.assertIn("### Locations (1)", self.text)

    def test_stubs(self):
        self.assertIn("## Stubs (Needs Attention)", self.text)
        self.assertIn("- [[Stub Guy]] — type: npc, needs: a portrait",
                       self.text)
        self.assertIn(
            "- [[Untyped Note]] — type: (none), needs: type field",
            self.text)


class RecentChangesTests(unittest.TestCase):
    def test_carry_over(self):
        previous = (FIX / "_meta" / "index.md").read_text(encoding="utf-8")
        text = ib.render(FIX, today=TODAY, previous=previous)
        rebuilt = text.split("## Recent Changes", 1)[1]
        lines = [ln for ln in rebuilt.splitlines() if ln.strip().startswith("- ")]
        self.assertTrue(lines[0].startswith(f"- {TODAY}: index rebuilt"))
        self.assertIn("- 2026-08-20: Initial vault scaffold created", lines)
        self.assertIn("- 2026-08-25: Added Chapter 1 sessions", lines)
        # Both previous lines follow the new rebuilt line, in order.
        idx_scaffold = lines.index("- 2026-08-20: Initial vault scaffold created")
        idx_sessions = lines.index("- 2026-08-25: Added Chapter 1 sessions")
        self.assertGreater(idx_scaffold, 0)
        self.assertGreater(idx_sessions, idx_scaffold)


class RoundTripTests(unittest.TestCase):
    def test_roundtrip_with_vault_check(self):
        copy = copy_fixture(self)
        result = run_cli(copy, "--write", "--date", TODAY)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = vc.check_index(copy)
        self.assertEqual(rows, [])


class DryRunTests(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        before = (FIX / "_meta" / "index.md").read_bytes()
        result = run_cli(FIX, "--date", TODAY)
        after = (FIX / "_meta" / "index.md").read_bytes()
        self.assertEqual(before, after)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("+- [[Bram]]", result.stdout)
        self.assertIn("\n-", result.stdout)
        self.assertIn("# entities: 6  narrative: 4  stubs: 2", result.stdout)


class CrlfTests(unittest.TestCase):
    def test_crlf_preserved(self):
        d = Path(tempfile.mkdtemp(prefix="index-build-crlf-"))
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        shutil.copytree(FIX, d, dirs_exist_ok=True)
        index_path = d / "_meta" / "index.md"
        original = index_path.read_text(encoding="utf-8")
        index_path.write_bytes(original.replace("\n", "\r\n").encode("utf-8"))

        result = run_cli(d, "--write", "--date", TODAY)
        self.assertEqual(result.returncode, 0, result.stderr)

        written = index_path.read_bytes()
        self.assertIn(b"\r\n", written)
        self.assertNotIn(b"\n\n", written.replace(b"\r\n", b""))
        # Every line ending is CRLF, not bare LF.
        stripped = written.replace(b"\r\n", b"")
        self.assertNotIn(b"\n", stripped)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Regression tests for index_build.py — deriving `_meta/index.md` from a
vault scan.

Covers `collect()`'s counting rules (entities vs. narrative, skips), the
shape of `render()`'s output against the index template — including the
nested session-chain documents and Story companions the round trip
against `vault_check.check_index` requires — Recent Changes carry-over,
and the CLI's dry-run/--write/EOL-preservation behaviour.

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


def write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class CollectTests(unittest.TestCase):
    def test_counts(self):
        entries, chapters = ib.collect(FIX)
        typed = [e for e in entries
                 if e.type and e.type not in ib.NARRATIVE_ADJACENT_TYPES]
        stems = sorted(e.stem for e in typed)
        self.assertEqual(
            stems, ["Ada", "Bram", "Docks", "Key", "Stub Guy", "The Guild"])

        chain_matched = sum(len(sess["chain"]) for c in chapters
                            for sess in c["all_sessions"])
        chain_orphan = sum(1 for e in entries if e.type in ib.CHAIN_TYPES)
        plans = sum(1 for e in entries if e.type == "plan")
        self.assertEqual(chain_orphan, 0)  # both chain docs match session 1
        self.assertEqual(chain_matched, 2)  # Session_01_Plan + Wrap_Up
        self.assertEqual(plans, 1)  # Arc_Shape

        narrative = (len(chapters)
                     + sum(c["sessions"] for c in chapters)
                     + sum(c["scenes"] for c in chapters)
                     + chain_matched + chain_orphan + plans)
        self.assertEqual(narrative, 7)

        all_stems = {e.stem for e in entries}
        self.assertNotIn("_Template_NPC", all_stems)
        # Ada_Story is matched to Ada, not a free-standing entry.
        self.assertNotIn("Ada_Story", all_stems)

        untyped = [e for e in entries if not e.type]
        self.assertEqual([e.stem for e in untyped], ["Untyped Note"])

    def test_ada_story_matched_to_pc(self):
        entries, _chapters = ib.collect(FIX)
        ada = next(e for e in entries if e.stem == "Ada")
        self.assertEqual(ada.story_stem, "Ada_Story")

    def test_chain_docs_attached_to_session_01(self):
        _entries, chapters = ib.collect(FIX)
        chapter = chapters[0]
        session_01 = next(s for s in chapter["all_sessions"]
                          if s["stem"] == "Session 01")
        labels = dict(session_01["chain"])
        self.assertEqual(labels.get("plan"), "Session_01_Plan")
        self.assertEqual(labels.get("wrap-up"),
                         "Chapter_01_Session_01_Wrap_Up")
        session_02 = next(s for s in chapter["all_sessions"]
                          if s["stem"] == "Session 02")
        self.assertEqual(session_02["chain"], [])


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
            "narrative_count: 7\n"
            "stub_count: 2\n"
            "---\n"))

    def test_chapters_section(self):
        self.assertIn("### Chapters", self.text)
        self.assertIn(
            "- [[Chapter 1 - Arrival]] "
            "(sessions: 2, scenes: 1, status: in_progress)",
            self.text)

    def test_session_chain_nested(self):
        self.assertIn("  - [[Session 01]] (status: played)", self.text)
        self.assertIn("    - plan: [[Session_01_Plan]]", self.text)
        self.assertIn(
            "    - wrap-up: [[Chapter_01_Session_01_Wrap_Up]]", self.text)
        self.assertIn("  - [[Session 02]] (status: prepped)", self.text)

    def test_active_session_section(self):
        self.assertIn("### Active Session", self.text)
        active_block = (self.text.split("### Active Session", 1)[1]
                        .split("### Plans", 1)[0])
        self.assertIn("[[Session 02]]", active_block)
        self.assertIn("status: prepped", active_block)

    def test_plans_section(self):
        self.assertIn("### Plans (1)", self.text)
        self.assertIn("- [[Arc_Shape]] — arc", self.text)

    def test_pcs_with_story_nested(self):
        self.assertIn("**PCs (1):**", self.text)
        pc_block = self.text.split("**PCs (1):**", 1)[1].split("\n\n", 1)[0]
        self.assertIn(
            "- [[Ada]] — Dockworker searching for her missing brother.",
            pc_block)
        self.assertIn("  - story: [[Ada_Story]]", pc_block)

    def test_locations(self):
        self.assertIn("### Locations (1)", self.text)

    def test_stubs(self):
        self.assertIn("## Stubs (Needs Attention)", self.text)
        self.assertIn("- [[Stub Guy]] — type: npc, needs: a portrait",
                       self.text)
        self.assertIn(
            "- [[Untyped Note]] — type: (none), needs: type field",
            self.text)


class OrphanHandlingTests(unittest.TestCase):
    """A session-chain doc that matches no session, and a Story file
    that matches no PC, must still end up referenced somewhere — the
    round-trip contract requires it. Neither is exercised by the main
    fixture (everything there matches), so this proves the fallback
    path independently with a minimal synthetic vault."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp(prefix="index-build-orphan-"))
        self.addCleanup(shutil.rmtree, self.vault, ignore_errors=True)
        write(self.vault, "Characters/PCs/Zoe.md",
              "---\ntype: pc\n---\n\n# Zoe\n")
        write(self.vault, "Characters/PCs/Orphan_Story.md",
              "---\ntype: character-story\ncharacter: \"[[Nobody]]\"\n"
              "---\n\n# Orphan Story\n")
        write(self.vault, "Notes/Loose_Plan.md",
              "---\ntype: session-plan\nsession: 99\n---\n\n# Loose Plan\n")

    def test_orphans_surface_in_stubs(self):
        entries, _chapters = ib.collect(self.vault)
        loose_plan = next(e for e in entries if e.stem == "Loose_Plan")
        self.assertEqual(loose_plan.type, "session-plan")
        self.assertEqual(loose_plan.stub_needs, "session link")

        orphan_story = next(e for e in entries if e.stem == "Orphan_Story")
        self.assertEqual(orphan_story.type, "character-story")
        self.assertEqual(orphan_story.stub_needs, "PC page")

        zoe = next(e for e in entries if e.stem == "Zoe")
        self.assertIsNone(zoe.story_stem)

        text = ib.render(self.vault, today=TODAY, previous=None)
        self.assertIn(
            "- [[Loose_Plan]] — type: session-plan, needs: session link",
            text)
        self.assertIn(
            "- [[Orphan_Story]] — type: character-story, needs: PC page",
            text)


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


class FlatVaultTests(unittest.TestCase):
    """C2: a flat vault — no `Chapters/` folder, no `chapter:` link on
    its sessions/scenes — must not silently drop them. They surface in
    Stubs instead, and the round trip against `check_index` must hold."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp(prefix="index-build-flat-"))
        self.addCleanup(shutil.rmtree, self.vault, ignore_errors=True)
        write(self.vault, "Sessions/Session_01.md",
              "---\ntype: session\nsession_number: 1\nstatus: played\n"
              "---\n\n# Session 01\n\nThe party met at the tavern.\n")
        write(self.vault, "Sessions/Scene_01.md",
              "---\ntype: scene\nstatus: ready\n---\n\n# Scene 01\n\n"
              "The tavern is crowded.\n")

    def test_flat_sessions_surface_in_stubs(self):
        entries, chapters = ib.collect(self.vault)
        self.assertEqual(chapters, [])
        session = next(e for e in entries if e.stem == "Session_01")
        self.assertEqual(session.type, "session")
        self.assertEqual(session.stub_needs, "chapter link")
        scene = next(e for e in entries if e.stem == "Scene_01")
        self.assertEqual(scene.type, "scene")
        self.assertEqual(scene.stub_needs, "chapter link")

    def test_flat_vault_roundtrips_with_vault_check(self):
        result = run_cli(self.vault, "--write", "--date", TODAY)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = vc.check_index(self.vault)
        self.assertEqual(rows, [])


class MatchedStubTests(unittest.TestCase):
    """M12: a plan, chain doc, or Story companion that is otherwise
    placed (a Plans entry, nested under its session, or nested under
    its PC) but still carries `canon_status: STUB` must surface in
    Stubs too, without being double-counted as an orphan."""

    def setUp(self):
        self.vault = copy_fixture(self)
        plan = self.vault / "Chapters/Chapter 1 - Arrival/Planning/Arc_Shape.md"
        plan.write_text(
            plan.read_text(encoding="utf-8")
                .replace("type: plan\n", "type: plan\ncanon_status: STUB\n"),
            encoding="utf-8")
        chain = (self.vault / "Chapters/Chapter 1 - Arrival/Sessions"
                / "Session_01_Plan.md")
        chain.write_text(
            chain.read_text(encoding="utf-8").replace(
                "type: session-plan\n",
                "type: session-plan\ncanon_status: STUB\n"
            ) + "\n## Needs\n- a scene list\n",
            encoding="utf-8")
        story = self.vault / "Characters/PCs/Ada_Story.md"
        story.write_text(
            story.read_text(encoding="utf-8")
                .replace("canon_status: DRAFT", "canon_status: STUB"),
            encoding="utf-8")

    def test_stub_plan_reaches_stubs(self):
        entries, _chapters = ib.collect(self.vault)
        plan = next(e for e in entries if e.stem == "Arc_Shape")
        self.assertEqual(plan.stub_needs, "unspecified")

    def test_stub_chain_doc_still_nested_and_stubbed(self):
        entries, chapters = ib.collect(self.vault)
        session_01 = next(s for c in chapters for s in c["all_sessions"]
                          if s["stem"] == "Session 01")
        self.assertIn(("plan", "Session_01_Plan"), session_01["chain"])
        stub = next(e for e in entries if e.stem == "Session_01_Plan")
        self.assertTrue(stub.already_placed)
        self.assertEqual(stub.stub_needs, "a scene list")
        chain_orphan = sum(1 for e in entries if e.type in ib.CHAIN_TYPES
                           and not e.already_placed)
        self.assertEqual(chain_orphan, 0)  # still matched, not an orphan

    def test_stub_story_still_nested_and_stubbed(self):
        entries, _chapters = ib.collect(self.vault)
        ada = next(e for e in entries if e.stem == "Ada")
        self.assertEqual(ada.story_stem, "Ada_Story")
        stub = next(e for e in entries if e.stem == "Ada_Story")
        self.assertTrue(stub.already_placed)
        self.assertEqual(stub.stub_needs, "unspecified")

    def test_rendered_stubs_section_includes_all_three(self):
        text = ib.render(self.vault, today=TODAY, previous=None)
        block = text.split("## Stubs (Needs Attention)", 1)[1]
        self.assertIn(
            "- [[Arc_Shape]] — type: plan, needs: unspecified", block)
        self.assertIn(
            "- [[Session_01_Plan]] — type: session-plan, "
            "needs: a scene list", block)
        self.assertIn(
            "- [[Ada_Story]] — type: character-story, needs: unspecified",
            block)


class DocumentsTargetsFallbackTests(unittest.TestCase):
    """M15: a chain doc with no parseable `session:` field matches its
    session via the session's own `documents:` block (`_documents_targets`)
    instead — not exercised by the main fixture, where every chain doc
    matches by session number."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp(prefix="index-build-docs-"))
        self.addCleanup(shutil.rmtree, self.vault, ignore_errors=True)
        write(self.vault, "Chapters/Chapter 1/Chapter 1.md",
              "---\ntype: chapter\n---\n\n# Chapter 1\n")
        write(self.vault, "Chapters/Chapter 1/Sessions/Session 01.md",
              "---\ntype: session\nsession_number: 1\n"
              "chapter: \"[[Chapter 1]]\"\n"
              "documents:\n  plan: \"[[Session One Notes]]\"\n"
              "---\n\n# Session 01\n")
        write(self.vault, "Chapters/Chapter 1/Sessions/Session One Notes.md",
              "---\ntype: session-plan\nchapter: \"[[Chapter 1]]\"\n"
              "---\n\n# Session One Notes\n")

    def test_matched_by_documents_target_not_orphaned(self):
        entries, chapters = ib.collect(self.vault)
        session_01 = next(s for c in chapters for s in c["all_sessions"]
                          if s["stem"] == "Session 01")
        self.assertEqual(session_01["chain"], [("plan", "Session One Notes")])

        all_stems = {e.stem for e in entries}
        self.assertNotIn("Session One Notes", all_stems)  # nested, not orphaned
        chain_orphan = sum(1 for e in entries if e.type in ib.CHAIN_TYPES
                           and not e.already_placed)
        self.assertEqual(chain_orphan, 0)


class DryRunTests(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        before = (FIX / "_meta" / "index.md").read_bytes()
        result = run_cli(FIX, "--date", TODAY)
        after = (FIX / "_meta" / "index.md").read_bytes()
        self.assertEqual(before, after)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("+- [[Bram]]", result.stdout)
        self.assertIn("\n-", result.stdout)
        self.assertIn("# entities: 6  narrative: 7  stubs: 2", result.stdout)


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

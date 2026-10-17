"""scripts/publish_release_notes.py: a publish-tool release copies the
CHANGELOG entries of the plugin releases its commits shipped in."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import publish_release_notes as prn  # noqa: E402

CHANGELOG = """# Changelog

---

## [1.2.0] — 2026-10-02

The second.

### Added

- Two.

---

## [1.1.0] — 2026-10-01

The first.

### Added

- One.

---

## [1.0.0] — 2026-09-30

Before.
"""


@unittest.skipUnless(shutil.which("git"), "needs git")
class NotesTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "t")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.dir, check=True,
                              capture_output=True, text=True).stdout

    def commit(self, plugin, message, tool_change=True):
        (self.dir / ".claude-plugin").mkdir(exist_ok=True)
        (self.dir / ".claude-plugin" / "plugin.json").write_text(
            json.dumps({"version": plugin}))
        if tool_change:
            (self.dir / "tools" / "publish").mkdir(parents=True, exist_ok=True)
            (self.dir / "tools" / "publish" / "x.js").write_text(message)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def test_entries_of_the_shipped_plugin_releases_newest_first(self):
        (self.dir / "CHANGELOG.md").write_text(CHANGELOG)
        self.commit("1.0.0", "Before")
        self.git("tag", "publish-v1.0.0")
        self.commit("1.1.0", "First change")
        self.commit("1.1.5", "Docs only", tool_change=False)
        self.commit("1.2.0", "Second change")
        notes = prn.notes("1.2.0", "publish-v1.0.0", self.dir)
        self.assertIn("- Second change (", notes)
        self.assertIn("- First change (", notes)
        self.assertNotIn("Docs only", notes)
        self.assertLess(notes.index("### [1.2.0]"), notes.index("### [1.1.0]"))
        self.assertIn("#### Added\n\n- One.", notes)
        self.assertNotIn("[1.0.0]", notes)
        self.assertNotIn("---", notes)

    def test_a_tool_change_ships_in_the_next_version_bump(self):
        (self.dir / "CHANGELOG.md").write_text(CHANGELOG)
        self.commit("1.0.0", "Before")
        self.git("tag", "publish-v1.0.0")
        self.commit("1.0.0", "Tool change, no bump")
        self.commit("1.2.0", "The bump", tool_change=False)
        notes = prn.notes("1.2.0", "publish-v1.0.0", self.dir)
        self.assertIn("- Tool change, no bump (", notes)
        self.assertIn("### [1.2.0]", notes)
        self.assertNotIn("[1.0.0]", notes)

    def test_a_tool_change_no_bump_follows_yet_copies_no_entry(self):
        (self.dir / "CHANGELOG.md").write_text(CHANGELOG)
        self.commit("1.1.0", "Before")
        self.git("tag", "publish-v1.0.0")
        self.commit("1.1.0", "Not yet shipped")
        notes = prn.notes("1.0.1", "publish-v1.0.0", self.dir)
        self.assertIn("- Not yet shipped (", notes)
        self.assertNotIn("## What changed", notes)

    def test_a_version_with_no_changelog_entry_is_left_out(self):
        (self.dir / "CHANGELOG.md").write_text(CHANGELOG)
        self.commit("1.0.0", "Before")
        self.git("tag", "publish-v1.0.0")
        self.commit("1.3.0", "Unlogged")
        notes = prn.notes("1.3.0", "publish-v1.0.0", self.dir)
        self.assertIn("- Unlogged (", notes)
        self.assertNotIn("## What changed", notes)

    def test_first_release(self):
        self.assertIn("Initial tagged release.", prn.notes("1.0.0", None, self.dir))


class EntriesTests(unittest.TestCase):
    def test_the_real_changelog_parses(self):
        entries = prn.changelog_entries(
            (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
        version = json.loads((ROOT / ".claude-plugin" / "plugin.json")
                             .read_text(encoding="utf-8"))["version"]
        self.assertIn(version, entries)
        self.assertTrue(entries[version].startswith(f"## [{version}]"))
        self.assertFalse(entries[version].rstrip().endswith("---"))


if __name__ == "__main__":
    unittest.main()

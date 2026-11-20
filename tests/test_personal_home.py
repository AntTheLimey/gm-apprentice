"""#806: the GM's personal reference files live in ~/gm-apprentice/personal, and files left in
the plugin's own folders (stranded by an update) are copied there, never moved or overwritten."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import install_layout  # noqa: E402
import personal_home as ph  # noqa: E402
import update  # noqa: E402


def _write(path: Path, text: str, mtime: float | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def _install(root: Path) -> Path:
    """An install at `root` (its skills/ folder holding shared/ and the ttrpg-expert corpus); -> shared/."""
    shared = root / "skills" / "shared"
    shared.mkdir(parents=True, exist_ok=True)
    (root / "skills" / "ttrpg-expert" / "systems" / "fitd").mkdir(parents=True, exist_ok=True)
    (root / "skills" / "ttrpg-expert" / "systems" / "coc-7e").mkdir(parents=True, exist_ok=True)
    return shared


def _personal(root: Path, system: str, rel: str) -> Path:
    return root / "skills" / "ttrpg-expert" / "systems" / system / "personal" / rel


class PersonalHomeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.user = Path(tmp.name) / "user"
        self.cache = self.user / ".claude" / "plugins" / "cache" / "gm-apprentice" / "gm-apprentice"
        self.home = self.user / "gm-apprentice" / "personal"

    def adopt(self, shared: Path, **kw):
        return ph.adopt(shared, user_home=self.user, **kw)

    def test_the_home_is_a_visible_folder_in_the_users_home(self):
        self.assertEqual(ph.home(self.user), self.user / "gm-apprentice" / "personal")
        self.assertEqual(ph.shown(self.home / "fitd", self.user), "~/gm-apprentice/personal/fitd")

    def test_an_update_strands_files_in_the_old_version_and_they_are_copied_home(self):
        old = self.cache / "1.12.95"
        _install(old)
        _write(_personal(old, "fitd", "factions.md"), "factions")
        _write(_personal(old, "fitd", "districts/docks.md"), "docks")
        _write(_personal(old, "fitd", ".DS_Store"), "junk")
        new = _install(self.cache / "1.12.105")
        result = self.adopt(new)
        self.assertEqual(result.copied, {"1.12.95": 2})
        self.assertEqual((self.home / "fitd" / "factions.md").read_text(), "factions")
        self.assertEqual((self.home / "fitd" / "districts" / "docks.md").read_text(), "docks")
        self.assertFalse((self.home / "fitd" / ".DS_Store").exists())
        self.assertTrue(_personal(old, "fitd", "factions.md").exists(), "copied, never moved")
        self.assertEqual(ph.adoption_lines(result, user_home=self.user),
                         ["personal files: copied 2 from 1.12.95 into ~/gm-apprentice/personal"])
        again = self.adopt(new)
        self.assertEqual((again.copied, again.clashes), ({}, []), "a second run has nothing to do")
        self.assertEqual(ph.adoption_lines(again, user_home=self.user), [])

    def test_files_in_the_running_install_are_copied_too(self):
        shared = _install(self.cache / "1.12.105")
        _write(_personal(self.cache / "1.12.105", "coc-7e", "arkham.md"), "arkham")
        self.assertEqual(self.adopt(shared).copied, {"this install": 1})
        self.assertTrue((self.home / "coc-7e" / "arkham.md").is_file())

    def test_a_file_already_home_is_never_overwritten(self):
        old = self.cache / "1.12.95"
        _install(old)
        _write(_personal(old, "fitd", "same.md"), "same")
        _write(_personal(old, "fitd", "edited-since.md"), "old text", mtime=1_000)
        _write(_personal(old, "fitd", "newer-left-behind.md"), "newer text", mtime=3_000)
        _write(self.home / "fitd" / "same.md", "same")
        _write(self.home / "fitd" / "edited-since.md", "the GM's edit", mtime=2_000)
        _write(self.home / "fitd" / "newer-left-behind.md", "older text", mtime=2_000)
        result = self.adopt(_install(self.cache / "1.12.105"))
        self.assertEqual(result.copied, {})
        self.assertEqual((self.home / "fitd" / "edited-since.md").read_text(), "the GM's edit")
        self.assertEqual((self.home / "fitd" / "newer-left-behind.md").read_text(), "older text")
        # Only the newer file left behind may hold edits the home lacks: it alone is reported.
        self.assertEqual([left.name for left, _ in result.clashes], ["newer-left-behind.md"])
        line = ph.adoption_lines(result, user_home=self.user)[0]
        self.assertIn("newer-left-behind.md differs from ~/gm-apprentice/personal/fitd/newer-left-behind.md", line)

    def test_the_newest_version_wins_when_two_old_ones_hold_the_same_file(self):
        for version, text in (("1.12.9", "older"), ("1.12.10", "newer")):
            _install(self.cache / version)
            _write(_personal(self.cache / version, "fitd", "notes.md"), text, mtime=1_000)
        self.adopt(_install(self.cache / "1.12.105"))
        self.assertEqual((self.home / "fitd" / "notes.md").read_text(), "newer", "1.12.10 sorts after 1.12.9")

    def test_a_dry_run_counts_and_copies_nothing(self):
        old = self.cache / "1.12.95"
        _install(old)
        _write(_personal(old, "fitd", "factions.md"), "factions")
        self.assertEqual(self.adopt(_install(self.cache / "1.12.105"), dry_run=True).total, 1)
        self.assertFalse(self.home.exists())

    def test_test_fixtures_shipped_in_a_plugin_are_not_personal_files(self):
        old = self.cache / "1.12.95"
        _install(old)
        _write(old / "tests" / "fixtures" / "slice-b" / "systems" / "gurps-4e" / "personal" / "secret.md", "x")
        self.assertEqual(self.adopt(_install(self.cache / "1.12.105")).total, 0)

    def test_the_codex_plugin_cache_is_searched_the_same_way(self):
        codex = self.user / ".codex" / "plugins" / "cache" / "gm-apprentice" / "gm-apprentice"
        _install(codex / "1.0.0")
        _write(_personal(codex / "1.0.0", "fitd", "a.md"), "a")
        self.assertEqual(self.adopt(_install(codex / "1.1.0")).copied, {"1.0.0": 1})

    def test_a_checkouts_neighbours_are_other_projects_and_never_searched(self):
        projects = self.user / "PROJECTS"
        other = projects / "someone-elses-fork"
        _install(other)
        _write(_personal(other, "fitd", "theirs.md"), "theirs")
        mine = projects / "gm-apprentice"
        _write(_personal(mine, "fitd", "mine.md"), "mine")
        result = self.adopt(_install(mine))
        self.assertEqual(result.copied, {"this install": 1})
        self.assertFalse((self.home / "fitd" / "theirs.md").exists())

    def test_an_npx_skills_install_reads_its_own_folder_only(self):
        skills = self.user / ".agents" / "skills"
        shared = skills / "shared"
        shared.mkdir(parents=True)
        _write(skills / "ttrpg-expert" / "systems" / "fitd" / "personal" / "a.md", "a")
        self.assertEqual(self.adopt(shared).copied, {"this install": 1})

    def test_the_listing_puts_each_systems_readme_first(self):
        for rel in ("factions.md", "README.md", "districts/docks.md", ".hidden.md"):
            _write(self.home / "fitd" / rel, rel)
        self.assertEqual(ph.listing(user_home=self.user), {"fitd": ["README.md", "districts/docks.md", "factions.md"]})
        self.assertEqual(ph.listing(user_home=self.user / "nobody"), {})

    def test_update_copies_stranded_files_home_and_says_so(self):
        old = self.cache / "1.12.95"
        _install(old)
        _write(_personal(old, "fitd", "factions.md"), "factions")
        shared = _install(self.cache / "1.12.105")
        layout = install_layout.Layout(shared, shared.parent.parent, None)
        with mock.patch.object(update, "HOME", self.user), mock.patch.object(install_layout, "LAYOUT", layout):
            lines = update._adopt_personal()
        self.assertEqual(lines, ["personal files: copied 1 from 1.12.95 into ~/gm-apprentice/personal"])
        self.assertTrue((self.home / "fitd" / "factions.md").is_file())


class PersonalCommandTests(unittest.TestCase):
    """`gma personal` run for real, with HOME pointed at an empty folder."""

    def setUp(self):
        with tempfile.TemporaryDirectory() as user:
            if ph.adopt(install_layout.LAYOUT.shared, user_home=Path(user), dry_run=True).total:
                self.skipTest("this checkout holds personal files of its own; they would be copied")

    def run_gma(self, *args):
        with tempfile.TemporaryDirectory() as user:
            env = {**os.environ, "HOME": user, "USERPROFILE": user}
            done = subprocess.run([sys.executable, str(SCRIPTS / "gma.py"), "personal", *args],
                                  capture_output=True, text=True, env=env)
            made = sorted(p.relative_to(user).as_posix() for p in Path(user).rglob("*"))
        return done, made

    def test_with_nothing_there_it_says_where_the_files_go_and_makes_nothing(self):
        done, made = self.run_gma("--system", "fitd")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Personal reference files: ~/gm-apprentice/personal", done.stdout)
        self.assertIn("fitd: none yet. The GM's notes for it go in ~/gm-apprentice/personal/fitd/", done.stdout)
        self.assertEqual(made, [])

    def test_an_unknown_system_is_refused_with_the_known_ones(self):
        done, _ = self.run_gma("--system", "nope")
        self.assertEqual(done.returncode, 2)
        self.assertIn("one of:", done.stderr)
        self.assertIn("fitd", done.stderr)

    def test_json_names_the_folder(self):
        done, _ = self.run_gma("--json")
        self.assertEqual(done.returncode, 0, done.stderr)
        data = json.loads(done.stdout)
        self.assertTrue(data["folder"].endswith(os.path.join("gm-apprentice", "personal")))
        self.assertEqual((data["copied"], data["clashes"], data["systems"]), ({}, [], {}))


if __name__ == "__main__":
    unittest.main()

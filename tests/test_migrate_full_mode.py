"""The update retires `publish.mode` (the `full-mode` check), end to end against
the real publish tool: a vault that wrote `player` only loses the line; a vault
that wrote `full` has its site become its GM site; a vault with nowhere to put
it asks for the folder; and a stop part way leaves the vault as it was."""

import json
import subprocess
import sys
import tempfile
import unittest
import shutil
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
from migrate_core import PERSON, WILL, StepFailed  # noqa: E402
from test_migrate_move import (NEEDS_NODE, PLUGIN, hashes, make_vault,  # noqa: E402
                               update, with_site)
from vaultlib import (SettingsUnavailable, read_stamp, settings,  # noqa: E402
                      settings_written)

CHOOSE = ("apply", "--choose", "default-mode=leave")
MODE = "player_site.hide.mode"


def new_layout_vault(case, mode="full", extra=""):
    """A vault already on the new settings file, with a site folder beside it."""
    root = Path(tempfile.mkdtemp(prefix="mig-fullmode-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault, site = root / "Vault", root / "site"
    (vault / "_meta").mkdir(parents=True)
    site.mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nplayer_site:\n  folder: {site.as_posix()}\n"
        f"  hide:\n    mode: {mode}\n{extra}", encoding="utf-8")
    return vault, site


@NEEDS_NODE
class FullModeTests(unittest.TestCase):
    def test_player_is_only_removed_and_a_second_pass_finds_nothing(self):
        vault = make_vault(self, "publish:\n  mode: player\n  system: coc-7e\n")
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        self.assertIn("full-mode\tremoved player_site.hide.mode (no longer used)", did)
        self.assertEqual(settings_written(vault, MODE), (None, "default"))
        self.assertEqual(read_stamp(vault), PLUGIN)
        self.assertEqual(settings(vault).get("vault.system"), "coc-7e")
        before = hashes(vault.parent)
        self.assertEqual(update(vault, "plan")[1].splitlines()[1], "up to date")
        self.assertEqual(hashes(vault.parent), before)

    def test_not_written_gives_nothing(self):
        self.assertEqual(ms.find_full_mode(make_vault(self, "publish:\n  system: coc-7e\n")), [])

    def test_full_moves_the_site_to_a_gm_site_and_keeps_every_other_setting(self):
        vault = make_vault(self, "publish:\n  mode: full\n  system: coc-7e\n"
                                 "  site_title: Hollow\n")
        site = with_site(self, vault)
        old = site
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        s = settings(vault)
        gm_folder = Path(s.get("gm_site.folder"))
        self.assertTrue(s.get("gm_site.publish"))
        self.assertFalse(s.get("player_site.publish"))
        self.assertEqual(gm_folder.name, old.name + "-gm")
        self.assertEqual(gm_folder.parent, old.parent)
        self.assertTrue(gm_folder.is_dir())
        self.assertEqual(s.get("vault.system"), "coc-7e")
        self.assertEqual(s.get("player_site.title"), "Hollow")
        self.assertEqual(settings_written(vault, MODE), (None, "default"))
        self.assertIn("This vault's site published everything (`full`), so it "
                      "is now your GM site, built in " + str(gm_folder), did)
        self.assertIn("it never goes online. The old site folder", did)
        self.assertEqual(read_stamp(vault), PLUGIN)
        before = hashes(vault.parent)
        self.assertEqual(update(vault, "plan")[1].splitlines()[1], "up to date")
        self.assertEqual(hashes(vault.parent), before)

    def test_the_next_build_writes_the_gm_folder_only(self):
        vault = make_vault(self, "publish:\n  mode: full\n  system: coc-7e\n")
        site = with_site(self, vault)
        update(vault, *CHOOSE)
        gm_folder = Path(settings(vault).get("gm_site.folder"))
        tool = site_fixture.TOOL_DIR / "bin" / "gm-publish.js"
        done = subprocess.run(
            ["node", str(tool), "build", "--config", str(site / "vault.config.json")],
            capture_output=True, text=True, cwd=site)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertTrue((gm_folder / "gm-build.json").is_file())
        self.assertFalse((site / "docs" / "index.html").exists())

    def test_full_with_no_site_folder_asks_for_it_and_holds_the_stamp(self):
        vault = make_vault(self, "publish:\n  mode: full\n  system: coc-7e\n")
        code, did, err = update(vault, *CHOOSE)
        self.assertIn("not settled: full-mode", did)
        self.assertIn("no site folder is named", update(vault, "plan")[1])
        self.assertEqual(read_stamp(vault), "1.10.12")
        self.assertEqual(settings_written(vault, MODE)[0], "full")   # kept

    def test_the_item_kinds(self):
        vault, _site = new_layout_vault(self, "player")
        self.assertEqual([i.group for i in ms.find_full_mode(vault)], [WILL])
        vault, _site = new_layout_vault(self, "full")
        self.assertEqual([i.group for i in ms.find_full_mode(vault)], [WILL])
        vault, _site = new_layout_vault(self, "full", "vault:\n  kept_by: player\n")
        item = ms.find_full_mode(vault)[0]
        self.assertIn("no GM site", item.lines[0])

    def test_the_full_line_says_the_old_folder_still_holds_the_last_site(self):
        vault, site = new_layout_vault(self, "full")
        said = " ".join(ms.find_full_mode(vault)[0].apply(None))
        self.assertIn("still holds the last site that published everything", said)
        self.assertIn("stays online until you remove it", said)

    def test_a_written_off_switch_only_loses_the_mode_line(self):
        for extra, why in (("  publish: false\n", "player site is off"),
                           ("gm_site:\n  publish: false\n", "GM site is off")):
            with self.subTest(extra=extra):
                vault, _site = new_layout_vault(self, "full", extra)
                item = ms.find_full_mode(vault)[0]
                self.assertEqual(item.group, WILL)
                self.assertIn("does not turn the GM site on", item.lines[0])
                done = item.apply(None)
                self.assertIn("did not turn the GM site on", " ".join(done))
                self.assertEqual(settings_written(vault, MODE), (None, "default"))
                self.assertIsNot(settings_written(vault, "gm_site.publish")[0], True)
                self.assertFalse((vault.parent / "site-gm").exists())

    def test_a_gm_written_gm_folder_is_kept(self):
        vault, site = new_layout_vault(
            self, "full", f"gm_site:\n  folder: {(site_gm := Path(tempfile.mkdtemp(prefix='gmf-'))).as_posix()}\n")
        self.addCleanup(shutil.rmtree, site_gm, ignore_errors=True)
        ms.find_full_mode(vault)[0].apply(None)
        self.assertEqual(Path(settings(vault).get("gm_site.folder")), site_gm)
        self.assertTrue(settings(vault).get("gm_site.publish"))

    def test_a_tool_that_cannot_answer_is_said_and_does_not_hold_the_stamp(self):
        vault, _site = new_layout_vault(self, "full")
        with mock.patch.object(ms, "settings_written",
                               side_effect=SettingsUnavailable("the tool is gone")):
            items = ms.find_full_mode(vault)
        self.assertEqual([i.group for i in items], [PERSON])
        self.assertIn("could not read player_site.hide.mode", items[0].lines[0])
        self.assertIn("the tool is gone", items[0].lines[0])
        self.assertFalse(items[0].holds_stamp)

    def test_the_gm_leak_step_skips_a_vault_kept_by_a_player(self):
        vault, _site = new_layout_vault(self, "player", "vault:\n  kept_by: player\n")
        with mock.patch.object(ms, "check_gm_leak") as leak:
            self.assertEqual(ms.find_gm_leak(vault), [])
        leak.assert_not_called()

    def test_a_stop_after_the_first_write_puts_everything_back(self):
        vault, site = new_layout_vault(self, "full", "  publish: true\n")
        before = hashes(vault.parent)
        real = ms.settings_unset

        def unset(v, names):
            if names == [MODE]:
                raise SettingsUnavailable("the disk said no", refused=True)
            return real(v, names)

        item = ms.find_full_mode(vault)[0]
        with mock.patch.object(ms, "settings_unset", unset):
            with self.assertRaises(StepFailed) as stopped:
                item.apply(None)
        self.assertIn("Nothing was changed: the vault is as it was", str(stopped.exception))
        self.assertEqual(hashes(vault.parent), before)
        self.assertFalse((site.parent / "site-gm").exists())

    def test_a_stop_that_cannot_be_put_back_says_exactly_what_was_done(self):
        vault, site = new_layout_vault(self, "full")
        item = ms.find_full_mode(vault)[0]

        def unset(_v, _names):
            raise SettingsUnavailable("the disk said no", refused=True)

        with mock.patch.object(ms, "settings_unset", unset):
            with self.assertRaises(StepFailed) as stopped:
                item.apply(None)
        said = str(stopped.exception)
        self.assertIn("could not be fully undone", said)
        self.assertIn("may be part way between", said)
        self.assertIn("still has mode: full", said)
        # What it says is what is there, and the next pass finishes the job.
        s = settings(vault)
        self.assertTrue(s.get("gm_site.publish"))
        self.assertFalse(s.get("player_site.publish"))
        self.assertEqual(settings_written(vault, MODE)[0], "full")
        again = ms.find_full_mode(vault)[0]
        again.apply(None)
        self.assertEqual(settings_written(vault, MODE), (None, "default"))
        self.assertTrue(settings(vault).get("gm_site.publish"))

    def test_a_refused_first_write_changes_nothing(self):
        vault, site = new_layout_vault(self, "full")
        before = hashes(vault.parent)
        item = ms.find_full_mode(vault)[0]
        refuse = SettingsUnavailable("no", refused=True)
        with mock.patch.object(ms, "settings_set", side_effect=refuse):
            with self.assertRaises(StepFailed):
                item.apply(None)
        self.assertEqual(hashes(vault.parent), before)

    def test_a_written_gm_site_switch_is_put_back_as_it_was(self):
        vault, site = new_layout_vault(self, "full", "gm_site:\n  publish: false\n")
        real = ms.settings_unset

        def unset(v, names):
            if names == [MODE]:
                raise SettingsUnavailable("no", refused=True)
            return real(v, names)

        with mock.patch.object(ms, "settings_unset", unset):
            with self.assertRaises(StepFailed):
                ms.find_full_mode(vault)[0].apply(None)
        s = settings(vault)
        self.assertFalse(s.get("gm_site.publish"))
        self.assertTrue(s.get("player_site.publish"))
        self.assertEqual(settings_written(vault, MODE)[0], "full")
        self.assertFalse((site.parent / "site-gm").exists())

if __name__ == "__main__":
    unittest.main()

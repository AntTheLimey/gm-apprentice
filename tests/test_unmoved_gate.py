"""One answer to "is this vault moved?": every leftover the build stops on
refuses the update (`gma update` exit 2), is a REFUSED row from
`vault_check.py version`, and a STOP row from the Settings check naming the
file it is in. The publish tool names the leftovers; Python asks it."""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402
import update  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib  # noqa: E402

PLUGIN = "1.11.0"
CHILD_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def moved_vault(case, stamp="1.10.134"):
    """A moved vault stamped `stamp`, naming a site folder of its own with a
    vault.config.json holding only vaultPath. (vault, site)."""
    root = Path(tempfile.mkdtemp(prefix="unmoved-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault, site = root / "vault", root / "site"
    (vault / "_meta").mkdir(parents=True)
    site.mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nplayer_site:\n  folder: {site.as_posix()}\n",
        encoding="utf-8")
    if stamp is not None:
        (vault / "_meta" / "vault-state.json").write_text(
            json.dumps({"gm_apprentice_version": stamp}) + "\n",
            encoding="utf-8")
    (site / "vault.config.json").write_text(
        json.dumps({"vaultPath": vault.as_posix()}), encoding="utf-8")
    vaultlib.forget_settings(vault)
    return vault, site


def both_files(vault, site):
    (vault / "_meta" / "vault-config.md").write_text(
        "---\npublish:\n  site_title: Old\n---\n", encoding="utf-8")


def site_key(vault, site):
    (site / "vault.config.json").write_text(json.dumps(
        {"vaultPath": vault.as_posix(), "siteTitle": "Old"}), encoding="utf-8")


def package_hook(vault, site):
    (site / "package.json").write_text(json.dumps(
        {"scripts": {"prebuild": "echo hi"}}), encoding="utf-8")


def package_broken(vault, site):
    (site / "package.json").write_text('{ "scripts": ', encoding="utf-8")


def old_list(vault, site):
    (vault / "_meta" / "publish-manifest.md").write_text(
        "# Publish Manifest\n", encoding="utf-8")


def old_file_only(vault, site):
    (vault / "_meta" / "vault-config.yaml").rename(
        vault / "_meta" / "vault-config.md")


def site_file_broken(vault, site):
    (site / "vault.config.json").write_text(
        '{ "vaultPath": "x", }', encoding="utf-8")


def tool_version_unreadable(vault, site):
    tool = site / "node_modules" / "gm-apprentice-publish"
    tool.mkdir(parents=True)
    (tool / "package.json").write_text("{}", encoding="utf-8")


def settings_broken(vault, site):
    (vault / "_meta" / "vault-config.yaml").write_text(
        "player_site: [unclosed\n", encoding="utf-8")


# (case, what the refusal says, the file the row names, a Settings-check STOP row's file or None)
CASES = [
    ("both settings files", both_files,
     "_meta/vault-config.md is still beside _meta/vault-config.yaml",
     "_meta/vault-config.md", "_meta/vault-config.md"),
    ("a site-folder key", site_key,
     "siteTitle (now player_site.title)", "vault.config.json",
     "vault.config.json"),
    ("a package.json build hook", package_hook,
     "prebuild (now player_site.before_build)", "package.json",
     "package.json"),
    ("an unreadable package.json", package_broken,
     "package.json is not valid JSON", "package.json", "package.json"),
    ("the old publish list", old_list,
     "_meta/publish-manifest.md is the old publish list",
     "_meta/publish-manifest.md", "_meta/publish-manifest.md"),
    ("the old settings file alone", old_file_only,
     "_meta/vault-config.md is the old settings file",
     "_meta/vault-config.md", None),
    ("an unreadable site vault.config.json", site_file_broken,
     "vault.config.json could not be read as JSON", "vault.config.json",
     "vault.config.json"),
    ("a site tool with no readable version", tool_version_unreadable,
     "The site's publish tool version could not be checked", None, None),
    ("settings that cannot be read", settings_broken,
     "_meta/vault-config.yaml is not valid YAML", "_meta/vault-config.yaml", None),
]


class RefusedEverywhereTests(unittest.TestCase):
    def gate(self, vault):
        with mock.patch.object(migrate, "plugin_version",
                               return_value=(PLUGIN, "test")):
            return migrate.gate(vault)

    def version_row(self, vault):
        with mock.patch.object(vc, "plugin_version",
                               return_value=(PLUGIN, "test")):
            rows, code = vc.check_version(vault)
        self.assertEqual(len(rows), 1, rows)
        return rows[0].split("\t"), code

    def test_a_moved_vault_passes(self):
        vault, site = moved_vault(self)
        (site / "package.json").write_text(json.dumps(
            {"scripts": {"build": "gm-apprentice-publish build"}}),
            encoding="utf-8")
        self.assertEqual(self.gate(vault), ("1.10.134", PLUGIN))
        (token, _, _), code = self.version_row(vault)
        self.assertEqual((token, code), ("MISMATCH", 1))

    def test_each_leftover_refuses_the_update_and_the_version_gate(self):
        for label, make, says, row_file, _ in CASES:
            with self.subTest(label):
                vault, site = moved_vault(self)
                make(vault, site)
                vaultlib.forget_settings(vault)
                said = self.gate(vault)
                self.assertIsInstance(said, str, said)
                self.assertIn(says, said)
                self.assertTrue(said.startswith(
                    f"Plugin {PLUGIN} cannot update this vault yet."), said)
                (token, where, message), code = self.version_row(vault)
                self.assertEqual((token, code), ("REFUSED", 1), message)
                self.assertIn(says, message)
                if row_file is not None:
                    self.assertEqual(where, row_file)

    def test_update_main_exits_2_for_each(self):
        home = Path(tempfile.mkdtemp(prefix="unmoved-home-"))
        self.addCleanup(shutil.rmtree, home, ignore_errors=True)
        for label, make, says, _, _ in CASES:
            with self.subTest(label):
                vault, site = moved_vault(self)
                make(vault, site)
                vaultlib.forget_settings(vault)
                err = io.StringIO()
                with mock.patch.object(migrate, "plugin_version",
                                       return_value=(PLUGIN, "test")), \
                        mock.patch.object(update, "HOME", home), \
                        contextlib.redirect_stdout(io.StringIO()), \
                        contextlib.redirect_stderr(err):
                    code = update.main([str(vault)])
                self.assertEqual(code, 2, err.getvalue())
                self.assertIn(says, err.getvalue())
                self.assertEqual(list(home.rglob("*.tar.gz")), [])

    def test_gma_update_exits_2_on_a_package_hook(self):
        vault, site = moved_vault(self)
        package_hook(vault, site)
        done = subprocess.run(
            [sys.executable, str(SCRIPTS / "gma.py"), "update", str(vault)],
            capture_output=True, text=True, encoding="utf-8", env=CHILD_ENV)
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("prebuild (now player_site.before_build)",
                      done.stdout + done.stderr)

    def test_the_settings_check_shows_each_stop_against_its_file(self):
        for label, make, says, _, settings_file in CASES:
            if settings_file is None:
                continue
            with self.subTest(label):
                vault, site = moved_vault(self)
                make(vault, site)
                vaultlib.forget_settings(vault)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    vc.main([str(vault), "settings"])
                rows = [ln for ln in out.getvalue().splitlines()
                        if ln.startswith("STOP\t") and says in ln]
                self.assertEqual(len(rows), 1, out.getvalue())
                self.assertEqual(rows[0].split("\t")[1], settings_file)


class RefusalWordsTests(unittest.TestCase):
    def test_no_stamp_says_so_and_names_the_bridge_range(self):
        vault, _ = moved_vault(self, stamp=None)
        said = vc.refusal(vc.unmoved(vault, None), PLUGIN)
        self.assertIn("It has no update stamp (_meta/vault-state.json):", said)
        self.assertNotIn("older than", said)
        self.assertIn("a 1.10 release, 1.10.134 or later", said)
        self.assertIn("releases/tag/v1.10.137", said)
        self.assertNotIn("last release that can", said)

    def test_the_running_plugin_version_is_named(self):
        vault, _ = moved_vault(self, stamp="1.10.10")
        said = vc.refusal(vc.unmoved(vault, "1.10.10"), "1.11.4")
        self.assertTrue(said.startswith("Plugin 1.11.4 cannot"), said)
        self.assertNotIn("1.11.0", said)

    def test_bridge_items_are_joined_with_and(self):
        left = [vc.Left("a", "no update stamp (x)", True),
                vc.Left("b", "a site publish tool older than 1.27.0", True)]
        said = vc.refusal(left, PLUGIN)
        self.assertIn("It has no update stamp (x) and a site publish tool "
                      "older than 1.27.0:", said)


if __name__ == "__main__":
    unittest.main()


class WithoutNodeTests(unittest.TestCase):
    """The gate must not need node: with no tool to ask it checks only what
    Python sees, and a vault with no site is never refused for site reasons."""

    def no_tool(self):
        return mock.patch.object(vc, "settings", side_effect=vaultlib.SettingsUnavailable(
            "could not read the vault's settings: node is not on PATH"))

    def test_without_the_tool_a_moved_vault_passes_and_says_what_was_skipped(self):
        vault, site = moved_vault(self)
        package_hook(vault, site)   # the build stops on it; the gate cannot see it
        notes = []
        with self.no_tool():
            self.assertEqual(vc.unmoved(vault, "1.10.134", notes), [])
        self.assertEqual(notes, [vc.SITE_CHECKS_SKIPPED])

    def test_without_the_tool_python_still_sees_the_old_files_and_the_stamp(self):
        vault, _ = moved_vault(self, stamp="1.10.10")
        self.assertLess(vc.parse_version("1.10.10"), vc.parse_version(vc.MOVED_FLOOR))
        old_list(vault, None)
        both_files(vault, None)
        with self.no_tool():
            said = [x.text for x in vc.unmoved(vault, "1.10.10")]
        self.assertEqual(said, [
            vc.below_floor("1.10.10"),
            "_meta/vault-config.md is still beside _meta/vault-config.yaml: remove "
            "or rename `_meta/vault-config.md` once you have checked its settings "
            "are in `_meta/vault-config.yaml`; plugin 1.11.0 no longer reads it",
            "the old publish list _meta/publish-manifest.md"])
        self.assertNotIn("node", vc.refusal(vc.unmoved(vault, "1.10.10"), PLUGIN))

    def test_update_reports_the_skipped_checks_in_worth_knowing(self):
        vault, _ = moved_vault(self)
        with self.no_tool(), mock.patch.object(migrate, "plugin_version",
                                               return_value=(PLUGIN, "test")):
            notes = []
            self.assertEqual(migrate.gate(vault, notes), ("1.10.134", PLUGIN))
        self.assertIn(vc.SITE_CHECKS_SKIPPED, notes)

    def test_a_vault_with_no_site_is_never_refused_for_site_reasons(self):
        root = Path(tempfile.mkdtemp(prefix="nosite-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault = root / "vault"
        (vault / "_meta").mkdir(parents=True)
        (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n", encoding="utf-8")
        # A stray package.json and site file beside the vault name no site of it.
        (root / "package.json").write_text('{ "scripts": ', encoding="utf-8")
        (vault / "package.json").write_text('{"scripts": {"prebuild": "x"}}', encoding="utf-8")
        vaultlib.forget_settings(vault)
        self.assertEqual(vc.unmoved(vault, "1.10.134"), [])
        with self.no_tool():
            self.assertEqual(vc.unmoved(vault, "1.10.134"), [])


class ReReviewTests(unittest.TestCase):
    def no_tool(self):
        return mock.patch.object(vc, "settings", side_effect=vaultlib.SettingsUnavailable(
            "could not read the vault's settings: node is not on PATH"))

    def test_without_node_both_files_is_a_hand_fix_not_the_bridge(self):
        # The 1.10 update leaves an old file beside the new one: sending the GM
        # back to it would loop.
        vault, _ = moved_vault(self)
        both_files(vault, None)
        with self.no_tool():
            left = vc.unmoved(vault, "1.10.134")
            said = vc.refusal(left, PLUGIN)
        self.assertEqual([x.bridge for x in left], [False])
        self.assertEqual(left[0].file, "_meta/vault-config.md")
        self.assertIn("remove or rename `_meta/vault-config.md` once you have "
                      "checked its settings are in `_meta/vault-config.yaml`", said)
        self.assertNotIn("update it first with a 1.10 release", said)

    def test_without_node_a_vault_with_no_site_gets_no_skipped_note(self):
        vault, _ = moved_vault(self)
        (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n", encoding="utf-8")
        notes = []
        with self.no_tool():
            self.assertEqual(vc.unmoved(vault, "1.10.134", notes), [])
        self.assertEqual(notes, [])

    def test_a_site_folder_leftover_says_it_can_clear_the_folder(self):
        vault, site = moved_vault(self)
        site_key(vault, site)
        text = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
        (vault / "_meta" / "vault-config.yaml").write_text(
            text + "  publish: false\n", encoding="utf-8")
        vaultlib.forget_settings(vault)
        said = vc.refusal(vc.unmoved(vault, "1.10.134"), PLUGIN)
        self.assertIn("siteTitle (now player_site.title)", said)
        self.assertIn("or, if the site is no longer published, clear "
                      "player_site.folder", said)

#!/usr/bin/env python3
"""The site folder test vaults share stays as it was made.

`site_fixture` hands every test vault one site folder, and fixtures built at
import time (`LEAK` in test_vault_check_slice_a.py) rely on it. A test that
migrates its vault moves the folderMap out of it; one that deletes a site
takes the publish tool with it. Under `pytest -n auto` that decided which
tests failed, by which neighbours a worker happened to run. tests/conftest.py
fails the test that leaves it changed; this pins the pieces it uses.

Run: python3 -m pytest tests/test_site_fixture.py
"""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "skills" / "shared" / "scripts"))

import site_fixture as sf  # noqa: E402
import vaultlib  # noqa: E402


def shared():
    sf.new_site(HERE, lambda p: None)
    site = sf.shared_site()
    assert site is not None
    return site


class SharedSiteGuardTests(unittest.TestCase):
    def tearDown(self):
        sf.restore_shared_site()

    def test_a_fresh_shared_site_has_no_problem(self):
        shared()
        self.assertIsNone(sf.shared_site_problem())

    def test_a_missing_tool_link_is_a_problem_and_new_site_mends_it(self):
        site = shared()
        (site / "node_modules" / "gm-apprentice-publish").unlink()
        self.assertIn("publish tool is gone", sf.shared_site_problem())
        self.assertEqual(sf.new_site(HERE, lambda p: None), site)
        self.assertIsNone(sf.shared_site_problem())

    def test_a_deleted_folder_is_a_problem_and_new_site_mends_it(self):
        site = shared()
        shutil.rmtree(site)
        self.assertIsNotNone(sf.shared_site_problem())
        sf.new_site(HERE, lambda p: None)
        self.assertIsNone(sf.shared_site_problem())
        self.assertTrue((site / "node_modules" / "gm-apprentice-publish"
                         / "bin" / "gm-publish.js").is_file())

    def test_a_folderMap_moved_out_is_a_problem(self):
        site = shared()
        (site / "vault.config.json").write_text(
            json.dumps({"vaultPath": "."}), encoding="utf-8")
        self.assertIn("folderMap", sf.shared_site_problem())
        sf.restore_shared_site()
        self.assertIsNone(sf.shared_site_problem())

    def test_a_private_site_is_not_the_shared_one(self):
        site = shared()
        mine = sf.private_site()
        self.assertNotEqual(mine, site)
        (mine / "vault.config.json").write_text("{}", encoding="utf-8")
        shutil.rmtree(mine / "node_modules")
        self.assertIsNone(sf.shared_site_problem())

    def test_give_site_private_names_a_folder_of_its_own(self):
        vault = Path(tempfile.mkdtemp(prefix="sf-vault-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        (vault / "_meta").mkdir()
        sf.give_site(vault, lambda p: None, private=True)
        text = (vault / "_meta" / "vault-config.md").read_text(
            encoding="utf-8")
        self.assertNotIn(shared().as_posix(), text)
        self.assertIn("site_dir:", text)


class PublishToolStartsFromThePluginsTests(unittest.TestCase):
    """conftest.py points the checks at the plugin's own tool before each
    test. The two run in this order (unittest sorts by name): the first
    leaves the tool pointing at a folder that is then deleted, the second
    must not find it so."""

    def test_1_leave_the_tool_pointing_at_a_deleted_site(self):
        gone = HERE / "no-such-site" / "bin" / "gm-publish.js"
        vaultlib.use_publish_tool(gone)
        self.assertEqual(vaultlib.PUBLISH_LINES.tool, gone)

    def test_2_the_next_test_starts_from_the_plugins_tool(self):
        self.assertEqual(vaultlib.PUBLISH_LINES.tool, vaultlib.PUBLISH_TOOL)


if __name__ == "__main__":
    unittest.main()

"""The `site-credit` check (#849): a vault with a site is told once that its
pages now credit GM-Apprentice, and how to take that out.
Every case reads a real vault's settings with the publish tool."""

import sys
import unittest
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_site as ms  # noqa: E402
from migrate_core import PERSON  # noqa: E402
from migrate_helpers import NEEDS_NODE  # noqa: E402


def vault_with(tmp_path: Path, player: str, more: str = "") -> Path:
    vault = tmp_path / "Vault"
    (vault / "_meta").mkdir(parents=True)
    site = tmp_path / "site"
    site.mkdir()
    (site / "vault.config.json").write_text(
        '{"vaultPath": "../Vault"}', encoding="utf-8")
    lines = "".join(f"  {x}\n" for x in player.split("; ") if x)
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nplayer_site:\n{lines}{more}", encoding="utf-8")
    return vault


@NEEDS_NODE
class SiteCreditTests(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _tmp(self, tmp_path):
        self.tmp = tmp_path

    def line(self, player: str, more: str = "") -> str:
        (item,) = ms.find_site_credit(vault_with(self.tmp, player, more))
        self.assertEqual(item.group, PERSON)
        self.assertTrue(item.notice)
        (line,) = item.lines
        return line

    def test_a_site_that_says_nothing_is_told(self):
        line = self.line("publish: true; folder: ../site")
        self.assertIn("your site's pages now credit GM-Apprentice", line)
        self.assertIn("Powered by GM-Apprentice", line)
        self.assertIn("player_site.credit", line)

    def test_a_site_switched_off_is_told_what_turning_it_on_would_do(self):
        line = self.line("publish: false; folder: ../site",
                         "gm_site:\n  publish: true\n  folder: ../gm\n")
        self.assertIn("your player site is off", line)
        self.assertNotIn("now credit", line)

    def test_no_site_is_nothing(self):
        self.assertEqual(
            ms.find_site_credit(vault_with(self.tmp, "publish: false")), [])

    def test_a_vault_that_already_chose_is_not_told(self):
        self.assertEqual(ms.find_site_credit(vault_with(
            self.tmp, "publish: true; folder: ../site; credit: false")), [])

    def test_registered_as_bookkeeping(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "site-credit"]
        self.assertEqual(check.kind, "bookkeeping")

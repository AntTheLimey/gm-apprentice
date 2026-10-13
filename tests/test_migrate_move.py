"""The update moves a vault to the new settings file (the `settings-move`
check), end to end against the real publish tool: a notes-only vault, a vault
whose site's tool is the plugin's own, a site pinned by something else, a
blocked vault, and a second pass that finds nothing."""

import contextlib
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402
import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
import vault_check as vc  # noqa: E402
from vaultlib import (read_stamp, settings, vault_layout,  # noqa: E402
                      write_stamp)

PLUGIN = "1.10.53"
NEEDS_NODE = unittest.skipUnless(
    os.environ.get("VAULT_CHECK_REQUIRE_NODE")
    or (shutil.which("node") and (
        vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
    "node and the publish tool's node_modules are needed")


def tmp(case):
    d = Path(tempfile.mkdtemp(prefix="mig-move-"))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    return d


def make_vault(case, front="publish:\n  mode: player\n", version="1.10.12",
               notes="My own notes.\n"):
    vault = tmp(case) / "Vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.md").write_text(
        f'---\ntype: meta\ngm_apprentice_version: "{version}"\n{front}---\n'
        f"{notes}", encoding="utf-8")
    return vault


def with_site(case, vault, spec=None, **site_keys):
    """A private site for `vault`, pinned to the repo's tool (or `spec`)."""
    site_fixture.give_site(vault, lambda p: None, private=True)
    site = site_fixture.point_site_at(vault, **site_keys)
    site_fixture.pin_site(site, spec)
    return site


def hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(
        p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*")) if p.is_file()}


def update(vault, *args):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(migrate, "plugin_version",
                           return_value=(PLUGIN, "test")), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = migrate.main([str(vault), *args])
    return code, out.getvalue(), err.getvalue()


@NEEDS_NODE
class MoveEndToEndTests(unittest.TestCase):
    def test_a_notes_only_vault_moves_and_is_stamped_in_the_state_file(self):
        vault = make_vault(self, "campaign: Hollow\npublish:\n  mode: player\n"
                                 "  system: coc-7e\n")
        code, did, err = update(vault, "apply", "--choose", "default-mode=leave")
        self.assertEqual(code, 0, err + did)
        self.assertIn("settings-move\tWrote _meta/vault-config.yaml.", did)
        self.assertEqual(vault_layout(vault), "new")
        self.assertFalse((vault / "_meta" / "vault-config.md").exists())
        self.assertEqual(read_stamp(vault), PLUGIN)
        state = json.loads((vault / "_meta" / "vault-state.json").read_text())
        self.assertEqual(state["gm_apprentice_version"], PLUGIN)
        self.assertIn("My own notes.",
                      (vault / "_meta" / "vault-notes.md").read_text())
        s = settings(vault)
        self.assertEqual(s.get("vault.campaign"), "Hollow")
        self.assertEqual(s.get("vault.system"), "coc-7e")

    def test_a_second_pass_after_a_move_finds_nothing_and_changes_nothing(self):
        vault = make_vault(self)
        self.assertEqual(update(vault, "apply")[0], 0)
        before = hashes(vault)
        code, plan, _ = update(vault, "plan")
        self.assertEqual(plan.splitlines()[1], "up to date", plan)
        code, did, _ = update(vault, "apply")
        self.assertIn(f"already at {PLUGIN}", did)
        self.assertEqual(hashes(vault), before)

    def test_the_system_in_the_campaign_overview_goes_into_the_new_file(self):
        vault = make_vault(self)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        self.assertEqual(update(vault, "apply")[0], 0)
        self.assertEqual(settings(vault).get("vault.system"), "gurps-4e")
        self.assertEqual(settings(vault).origins["vault.system"], "file")

    def test_a_site_whose_tool_is_the_plugins_own_moves_with_its_settings(self):
        vault = make_vault(self)
        site = with_site(self, vault, siteTitle="Hollow Site",
                         excludeSections=["Rumours"])
        code, plan, err = update(vault, "plan")
        self.assertEqual(code, 0, err)
        self.assertIn("settings-move\tWill write _meta/vault-config.yaml.", plan)
        self.assertEqual(vault_layout(vault), "legacy")   # a plan writes nothing
        code, did, err = update(vault, "apply", "--choose", "default-mode=leave")
        self.assertEqual(code, 0, err + did)
        self.assertEqual(vault_layout(vault), "new")
        self.assertEqual(read_stamp(vault), PLUGIN)
        s = settings(vault)
        self.assertEqual(s.get("player_site.title"), "Hollow Site")
        self.assertIn("Rumours", s.get("player_site.hide.sections"))
        left = json.loads((site / "vault.config.json").read_text())
        self.assertNotIn("siteTitle", left)
        self.assertNotIn("excludeSections", left)
        self.assertEqual(update(vault, "plan")[1].splitlines()[1], "up to date")

    def test_a_site_pinned_by_something_else_stays_behind_and_the_stamp_advances(self):
        vault = make_vault(self)
        site = with_site(self, vault, spec="^1.20.0", siteTitle="Theirs")
        code, plan, err = update(vault, "plan")
        self.assertIn("stays on the old settings file because its site's "
                      "publish tool is pinned by something else (^1.20.0)",
                      plan)
        self.assertIn("1.23.0 or later, run the update again", plan)
        code, did, err = update(vault, "apply", "--choose", "default-mode=leave")
        self.assertEqual(code, 0, err + did)
        self.assertEqual(vault_layout(vault), "legacy")
        self.assertEqual(read_stamp(vault), PLUGIN)   # not held
        self.assertEqual(json.loads((site / "vault.config.json").read_text())
                         ["siteTitle"], "Theirs")
        # The second pass says the same, and changes nothing.
        before = hashes(vault.parent)
        code, plan, _ = update(vault, "plan")
        self.assertIn("pinned by something else (^1.20.0)", plan)
        code, again, _ = update(vault, "apply")
        self.assertIn("# 1 row already shown in the plan", again)
        self.assertIn(f"already at {PLUGIN}", again)
        self.assertEqual(hashes(vault.parent), before)

    def test_a_blocked_vault_holds_the_stamp_and_nothing_is_written(self):
        vault = make_vault(self, "publish:\n  mode: player\n"
                                 "  exclude_sections: not-a-list\n")
        before = hashes(vault)
        code, plan, _ = update(vault, "plan")
        self.assertIn("the settings cannot move to the new file yet", plan)
        code, did, err = update(vault, "apply", "--choose", "default-mode=leave")
        self.assertEqual(vault_layout(vault), "legacy")
        self.assertEqual(read_stamp(vault), "1.10.12")
        self.assertIn("not stamped", did)
        self.assertIn("not settled: settings-move", did)
        self.assertFalse((vault / "_meta" / "vault-config.yaml").exists())
        self.assertEqual({k: v for k, v in hashes(vault).items()
                          if not k.startswith(("_Templates", "_meta/"))
                          and not k.startswith("_")},
                         {k: v for k, v in before.items()
                          if not k.startswith("_")})
        self.assertIn("(not until settings-move is settled)", plan)

    def test_a_vault_with_no_settings_file_is_not_this_checks_to_move(self):
        vault = tmp(self) / "Vault"
        (vault / "_meta").mkdir(parents=True)
        self.assertEqual(ms.find_settings_move(vault), [])

    def test_a_moved_vault_with_a_left_over_old_file_is_tidied_by_the_update(self):
        vault = make_vault(self)
        self.assertEqual(update(vault, "apply")[0], 0)
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ntype: meta\ngm_apprentice_version: "1.10.12"\n'
            "publish:\n  mode: player\n---\nMy own notes.\n", encoding="utf-8")
        write_stamp(vault, "1.10.12")
        code, did, err = update(vault, "apply")
        self.assertEqual(code, 0, err + did)
        self.assertFalse((vault / "_meta" / "vault-config.md").exists())
        self.assertEqual(read_stamp(vault), PLUGIN)

    def test_a_moved_vault_stays_moved_across_a_killed_move_mended_by_the_update(self):
        # The state a move killed after the new file was written leaves: the
        # new file, the old file and the site file with its settings.
        vault = make_vault(self)
        site = with_site(self, vault, siteTitle="Hollow Site")
        keep_md = (vault / "_meta" / "vault-config.md").read_text()
        keep_site = (site / "vault.config.json").read_text()
        self.assertEqual(update(vault, "apply")[0], 0)
        (vault / "_meta" / "vault-config.md").write_text(keep_md)
        (site / "vault.config.json").write_text(keep_site)
        write_stamp(vault, "1.10.12")
        code, did, err = update(vault, "apply")
        self.assertEqual(code, 0, err + did)
        self.assertFalse((vault / "_meta" / "vault-config.md").exists())
        self.assertNotIn("siteTitle", json.loads(
            (site / "vault.config.json").read_text()))
        self.assertEqual(settings(vault).get("player_site.title"),
                         "Hollow Site")


class RuleTests(unittest.TestCase):
    def test_the_check_replaces_config_to_vault(self):
        names = [c.name for c in ms.SITE_CHECKS]
        self.assertIn("settings-move", names)
        check = next(c for c in ms.SITE_CHECKS if c.name == "settings-move")
        self.assertEqual((check.release, check.band, check.asks_site),
                         (None, 2, False))
        self.assertGreater(names.index("settings-move"),
                           names.index(ms.REPIN))

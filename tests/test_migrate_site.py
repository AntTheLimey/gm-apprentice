"""migrate_site.py: the repin, config, publish.site and site-tool checks. The
publish tool is stubbed the way tests/test_vault_check_slice_a.py stubs it,
plus one end-to-end test against the real tool."""

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
import migrate_core  # noqa: E402
import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib  # noqa: E402
from migrate_core import PERSON, WILL, StepFailed  # noqa: E402
from layouts import write_config  # noqa: E402

REAL_PLUGIN_TOOL = migrate_core.plugin_tool


def tmp(case, prefix):
    d = Path(tempfile.mkdtemp(prefix=prefix))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    return d


def site_of(vault):
    return vc.configured_site(vault)[0]


def make_vault(case, publish=True, site=True, version="1.10.12", extra=""):
    vault = tmp(case, "mig-vault-")
    (vault / "_meta").mkdir()
    body = f'---\ngm_apprentice_version: "{version}"\n'
    if publish:
        body += "publish:\n  mode: player\n"
        if site:
            site_dir = tmp(case, "mig-site-")
            (site_dir / "vault.config.json").write_text("{}", encoding="utf-8")
            body += f"  site_dir: {site_dir}\n"
        body += extra
    write_config(vault, body + "---\n")
    return vault


class Pin:
    """A stand-in for migrate_core.plugin_tool running update-pin."""

    def __init__(self, ok=False, installed="1.11.41", fails=False, out=None,
                 ours=True, spec="file:/plugin/1.10.26/tools/publish"):
        self.ok, self.installed, self.fails, self.out = ok, installed, fails, out
        self.ours, self.spec = ours, spec
        self.calls = []

    def __call__(self, args):
        if args[0] != "update-pin":   # the settings move is the real tool's
            return REAL_PLUGIN_TOOL(args)
        self.calls.append(args)
        if "--check" in args:
            text = self.out if self.out is not None else json.dumps(
                {"ok": self.ok, "installedBefore": self.installed,
                 "desired": "1.10.26", "changed": False,
                 "ours": self.ours, "spec": self.spec})
            return (0 if self.ok else 1), text, ""
        if self.fails:
            return 1, "Repointed package.json, but npm install left nothing " \
                      "in node_modules.\nnpm ERR! network\n", ""
        self.ok = True
        return 0, "Updated gm-apprentice-publish from 1.11.41 to 1.12.2\n", ""


class RepinTests(unittest.TestCase):
    def find(self, vault, pin):
        with mock.patch.object(ms, "plugin_tool", pin):
            return ms.find_site_repin(vault)

    def test_a_current_site_plans_nothing(self):
        self.assertEqual(self.find(make_vault(self), Pin(ok=True)), [])

    def test_a_stale_site_is_one_will_do_item_that_repins(self):
        vault = make_vault(self)
        pin = Pin()
        with mock.patch.object(ms, "plugin_tool", pin):
            (item,) = ms.find_site_repin(vault)
            self.assertEqual((item.id, item.group), (migrate.REPIN, WILL))
            self.assertIn("installed: 1.11.41", item.lines[0])
            self.assertEqual(item.apply(None), [
                "Updated gm-apprentice-publish from 1.11.41 to 1.12.2"])
            self.assertEqual(ms.find_site_repin(vault), [])
        self.assertEqual(pin.calls[1][:1], ["update-pin"])
        self.assertNotIn("--check", pin.calls[1])
        self.assertIn(str(site_of(vault)), pin.calls[1])

    def test_the_repin_forgets_the_settings_it_may_have_changed(self):
        vault = make_vault(self)
        pin = Pin()
        with mock.patch.object(ms, "plugin_tool", pin), \
                mock.patch.object(ms, "forget_settings") as forget:
            (item,) = ms.find_site_repin(vault)
            forget.reset_mock()
            item.apply(None)
        forget.assert_called_with(vault)

    def test_a_failed_install_raises_with_npms_last_lines(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "plugin_tool", Pin(fails=True)):
            (item,) = ms.find_site_repin(vault)
            with self.assertRaises(StepFailed) as caught:
                item.apply(None)
        self.assertIn("npm ERR! network", str(caught.exception))

    def test_a_site_still_out_of_date_after_the_repin_stops(self):
        vault = make_vault(self)

        class Stuck(Pin):
            def __call__(self, args):
                code, text, err = super().__call__(args)
                if "--check" not in args:
                    self.ok = False   # update-pin said fine; the site is not
                return code, text, err
        with mock.patch.object(ms, "plugin_tool", Stuck()):
            (item,) = ms.find_site_repin(vault)
            with self.assertRaises(StepFailed) as caught:
                item.apply(None)
        self.assertIn("still out of date", str(caught.exception))

    def test_no_site_never_runs_the_tool(self):
        pin = Pin()
        for vault in (make_vault(self, publish=False),
                      make_vault(self, site=False),
                      make_vault(self, extra="  site: false\n")):
            self.assertEqual(self.find(vault, pin), [])
        self.assertEqual(pin.calls, [])

    def test_a_site_that_is_on_with_no_folder_stops(self):
        vault = make_vault(self, site=False, extra="  site: true\n")
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, Pin())
        self.assertIn("player_site.publish is on but player_site.folder names "
                      "no folder", str(caught.exception))

    def test_a_site_dir_with_no_site_file_stops(self):
        vault = make_vault(self)
        (site_of(vault) / "vault.config.json").unlink()
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, Pin())
        self.assertIn("no vault.config.json is there", str(caught.exception))

    def test_unreadable_check_output_stops(self):
        with self.assertRaises(StepFailed) as caught:
            self.find(make_vault(self), Pin(out="not json"))
        self.assertIn("did not return the expected JSON",
                      str(caught.exception))

    def test_a_crashed_check_says_why(self):
        vault = make_vault(self)
        crash = mock.Mock(return_value=(
            1, "", "node:internal\nError: Cannot find module 'x'\n\n"))
        with mock.patch.object(ms, "plugin_tool", crash), \
                self.assertRaises(StepFailed) as caught:
            ms.find_site_repin(vault)
        self.assertTrue(str(caught.exception).endswith(
            "expected JSON: Error: Cannot find module 'x'"))
        silent = mock.Mock(return_value=(3, "", ""))
        with mock.patch.object(ms, "plugin_tool", silent), \
                self.assertRaises(StepFailed) as caught:
            ms.find_site_repin(vault)
        self.assertTrue(str(caught.exception).endswith(
            "expected JSON: update-pin exited 3"))


class DoorPin(Pin):
    """update-pin as each door sees it. The plain check answers as the
    plugin's tool does (a tarball pin is "leave it alone", ok); the --tag
    check answers whether the site holds that release."""

    def __init__(self, tag_ok=False, **kw):
        super().__init__(**kw)
        self.tag_ok = tag_ok

    def __call__(self, args):
        if args[0] == "update-pin" and "--tag" in args:
            self.calls.append(args)
            if "--check" in args:
                return (0 if self.tag_ok else 1), json.dumps(
                    {"ok": self.tag_ok, "installedBefore": self.installed,
                     "desired": args[args.index("--tag") + 1][len("publish-v"):],
                     "changed": False, "tag": args[args.index("--tag") + 1]}), ""
            self.tag_ok = True
            return 0, "Updated gm-apprentice-publish (checksum verified)\n", ""
        return super().__call__(args)


TARBALL = "file:vendor/gm-apprentice-publish-1.60.0.tgz"
STAMP = (SCRIPTS.parent / "PUBLISH_VERSION").read_text().strip()


class DoorPinTests(unittest.TestCase):
    def door(self, owns):
        return mock.patch.object(
            ms.install_layout, "LAYOUT",
            ms.install_layout.LAYOUT._replace(door_owns_tool=owns))

    def run_repin(self, vault, pin, owns):
        with self.door(owns), mock.patch.object(ms, "plugin_tool", pin):
            items = ms.find_site_repin(vault)
            for item in items:
                item.apply(None)
            return items

    def test_plugin_door_cache_pin_unchanged(self):
        pin = DoorPin()
        (item,) = self.run_repin(make_vault(self), pin, owns=True)
        self.assertTrue(pin.calls)
        self.assertFalse([c for c in pin.calls if "--tag" in c])

    def test_cache_door_uses_the_stamped_release(self):
        pin = DoorPin()
        (item,) = self.run_repin(make_vault(self), pin, owns=False)
        self.assertTrue(all("--tag" in c for c in pin.calls), pin.calls)
        self.assertIn(f"publish-v{STAMP}", pin.calls[-1])
        self.assertNotIn("--check", pin.calls[1])

    def test_cache_door_current_site_plans_nothing(self):
        self.assertEqual(
            self.run_repin(make_vault(self), DoorPin(tag_ok=True), owns=False), [])

    def test_tarball_pin_on_plugin_door_follows_the_stamp(self):
        pin = DoorPin(ok=True, spec=TARBALL)
        (item,) = self.run_repin(make_vault(self), pin, owns=True)
        self.assertNotIn("--tag", pin.calls[0])
        self.assertIn(f"publish-v{STAMP}", pin.calls[1])
        self.assertIn("--check", pin.calls[1])
        self.assertIn("--tag", pin.calls[2])
        self.assertNotIn("--check", pin.calls[2])

    def test_a_repin_on_too_old_a_node_says_upgrade(self):
        pin = DoorPin()
        with mock.patch.object(ms.tool_cache, "node_too_old", lambda node: "v22.5.0"):
            with self.assertRaisesRegex(ms.StepFailed, r"Node 22\.21 or newer"):
                self.run_repin(make_vault(self), pin, owns=False)
        self.assertFalse([c for c in pin.calls if "--check" not in c])

    def test_tarball_pin_at_the_stamp_on_plugin_door_plans_nothing(self):
        pin = DoorPin(ok=True, spec=TARBALL, tag_ok=True)
        self.assertEqual(self.run_repin(make_vault(self), pin, owns=True), [])

    def test_cache_path_pin_from_init_moves_to_tarball(self):
        # A site made on this door pins file:<cache>/…; the plain check
        # cannot see it from the cache, so the tag check decides.
        pin = DoorPin(ok=True, spec="file:/home/x/.cache/gm-apprentice/"
                                    "publish/1.70.1/package")
        (item,) = self.run_repin(make_vault(self), pin, owns=False)
        self.assertIn("--tag", pin.calls[-1])


class PublishSiteTests(unittest.TestCase):
    def text(self, vault):
        return (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")

    def test_a_site_dir_writes_true(self):
        vault = make_vault(self)
        (item,) = ms.find_publish_site(vault)
        self.assertEqual((item.id, item.group), ("publish-site", WILL))
        self.assertEqual(item.apply(None), ["wrote player_site.publish: true"])
        self.assertIn("\n  publish: true\n", self.text(vault))
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_no_site_dir_writes_false(self):
        vault = make_vault(self, site=False)
        (item,) = ms.find_publish_site(vault)
        self.assertIn("no site folder is named; if this vault has a site, "
                      "set player_site.folder to its folder instead",
                      item.lines[0])
        item.apply(None)
        self.assertIn("\n  publish: false\n", self.text(vault))

    def test_a_site_dir_row_has_no_caveat(self):
        (item,) = ms.find_publish_site(make_vault(self))
        self.assertEqual(
            item.lines, ["write player_site.publish: true in _meta/vault-config.yaml"])

    def test_a_switch_already_written_is_left(self):
        vault = make_vault(self, extra="  site: false\n")
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_no_publish_block_gets_nothing(self):
        vault = make_vault(self, publish=False)
        before = self.text(vault)
        self.assertEqual(ms.find_publish_site(vault), [])
        self.assertEqual(self.text(vault), before)

    def test_a_publish_line_with_nothing_under_it_still_gets_the_switch(self):
        # `settings().has_site_block` is false for it; the line is there, and
        # the switch is written under it, as it always was.
        vault = make_vault(self, publish=False)
        (vault / "_meta" / "vault-config.yaml").write_text(
            "version: 1\nplayer_site:\n", encoding="utf-8")
        vc.forget_settings(vault)
        self.assertFalse(vc.settings(vault).has_site_block)
        (item,) = ms.find_publish_site(vault)
        item.apply(None)
        self.assertIn("player_site:\n  publish: false\n", self.text(vault))
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_a_switch_that_is_not_a_switch_word_is_still_a_written_switch(self):
        vault = make_vault(self, extra="  site: maybe\n")
        self.assertEqual(ms.find_publish_site(vault), [])


class LeakTests(unittest.TestCase):
    # Row texts as vault_check's gm-leak words them.
    ROWS = ["INFO\t(vault)\tasked the plugin's publish tool",
            "WARNING\tHandouts/Letter.md:8\t'Context' is Keeper material "
            "outside ## GM Notes \u2014 nest it under ## GM Notes (publish "
            "1.11.41+ withholds it; to publish it, rename the heading)",
            "WOULD-FIX\tHandouts/Letter.md\tre-nested 'Context' under ## GM Notes",
            "ERROR\tNPCs/Vane.md\tre-nest refused: an open code block \u2014 "
            "nothing written",
            "WARNING\tNPCs/Crowe.md:30\tKeeper-facing heading 'Keeper "
            "Secret' publishes \u2014 nest it under ## GM Notes or fence it",
            "INFO\tNPCs/Crowe.md:31\tbold label 'Secret' looks Keeper-facing "
            "\u2014 confirm with the GM (not a heading; not auto-movable)",
            "INFO\t_meta/vault-config.md\tgm-leak assumes the default "
            "exclude list: there is no site to ask"]

    def test_would_fix_is_will_do_and_the_rest_needs_a_person(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "check_gm_leak", return_value=self.ROWS):
            items = {i.group: i for i in ms.find_gm_leak(vault)}
        self.assertEqual(items[WILL].lines, [
            "Handouts/Letter.md: re-nest 'Context' under ## GM Notes"])
        self.assertEqual(items[PERSON].lines, [
            "NPCs/Vane.md\tre-nest refused: an open code block \u2014 "
            "nothing written",
            "NPCs/Crowe.md:30\tKeeper-facing heading 'Keeper Secret' "
            "publishes \u2014 nest it under ## GM Notes or fence it"])

    def test_a_pairing_matches_file_and_heading_not_loose_text(self):
        rows = [self.ROWS[2],
                "WARNING\tNPCs/Crowe.md:3\t'Context' is Keeper material "
                "outside ## GM Notes \u2014 nest it",
                "ERROR\tHandouts/Letter.md:9\tbold-wrapped heading 'Context' "
                "defeats the exclude list and publishes \u2014 remove the ** "
                "or move it under ## GM Notes",
                "WARNING\tHandouts/Letter.md:12\tKeeper-facing heading "
                "'Clues' publishes \u2014 nest it"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            items = {i.group: i for i in ms.find_gm_leak(make_vault(self))}
        self.assertEqual([line.split("\t")[0] for line in items[PERSON].lines],
                         ["NPCs/Crowe.md:3", "Handouts/Letter.md:12"])

    def test_an_incomplete_check_is_not_clean(self):
        rows = ["WARNING\t(vault)\texplain did not return the expected JSON",
                "INFO\t(vault)\tthe publish tool could not be consulted (x), "
                "so headings the site withholds on its own, like a handout's "
                "Context, Clues and Prop Notes, were not checked",
                "INFO\t(vault)\tthe publish tool could not be consulted (x), "
                "so every session index body was scanned, including any the "
                "site withholds",
                "INFO\t(vault)\tgm-leak has no site to check: x"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            (item,) = ms.find_gm_leak(make_vault(self))
        self.assertEqual(item.group, PERSON)
        self.assertEqual(len(item.lines), 2)
        self.assertTrue(all(line.startswith("(vault)\tthe check was "
                                            "incomplete: ")
                            for line in item.lines))

    def test_apply_fixes_reports_and_checks_nothing_is_left(self):
        vault = make_vault(self)
        calls = []

        def leak(v, folder, fix=False):
            calls.append(fix)
            if fix:
                return ["FIXED\tHandouts/Letter.md\tre-nested 'Context' "
                        "under ## GM Notes"]
            return self.ROWS[:3] if len(calls) == 1 else []
        with mock.patch.object(ms, "check_gm_leak", leak):
            item = next(i for i in ms.find_gm_leak(vault) if i.group == WILL)
            done = item.apply(None)
        self.assertEqual(calls, [False, True, False])
        self.assertEqual(done[0], "Handouts/Letter.md: re-nested 'Context' "
                                  "under ## GM Notes")
        self.assertIn("no longer publish", done[-1])

    def test_a_fix_that_leaves_work_fails(self):
        vault = make_vault(self)
        with mock.patch.object(ms, "check_gm_leak", return_value=self.ROWS):
            item = next(i for i in ms.find_gm_leak(vault) if i.group == WILL)
            with self.assertRaises(StepFailed):
                item.apply(None)

    def test_a_tool_that_dies_during_the_fix_or_the_recheck_fails(self):
        gone = "ERROR\t(vault)\tgm-leak stopped: the publish tool stopped"
        for dies_at in (1, 2):
            vault = make_vault(self)
            calls = []

            def leak(v, folder, fix=False):
                calls.append(fix)
                if len(calls) == 1:
                    return self.ROWS
                if len(calls) == dies_at + 1:
                    return [gone]
                return ["FIXED\tHandouts/Letter.md\tre-nested 'Context' "
                        "under ## GM Notes"] if fix else []
            with mock.patch.object(ms, "check_gm_leak", leak):
                item = next(i for i in ms.find_gm_leak(vault)
                            if i.group == WILL)
                with self.assertRaises(StepFailed) as caught:
                    item.apply(None)
            self.assertIn("stopped", str(caught.exception))

    def test_no_site_is_nothing(self):
        rows = ["INFO\t(vault)\tgm-leak has no site to check: player_site.publish is not on"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            self.assertEqual(ms.find_gm_leak(make_vault(self, site=False)), [])

    def test_the_skipped_notes_summary_is_routine(self):
        rows = ["INFO\t(vault)\t12 notes skipped: the site does not publish "
                "them"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            self.assertEqual(ms.find_gm_leak(make_vault(self)), [])


class SiteCheckOrderTests(unittest.TestCase):
    def test_the_repin_and_the_settings_checks_come_first(self):
        self.assertEqual(
            [c.name for c in ms.SITE_CHECKS[:3]],
            [ms.REPIN, ms.FULL_MODE, "publish-site"])


class HideAdditionTests(unittest.TestCase):
    """1.11.2 (#460): an entry added to a built-in hide list after vaults
    began owning their lists is offered to a list the vault owns, so the
    voice field never reaches a player site. The settings are the real
    tool's."""

    FIELDS = "player_site.hide.fields"

    def old_fields(self):
        # The list a vault wrote before voice joined the default; read from
        # the tool, never written out here.
        return [f for f in vaultlib.settings_default(self.FIELDS) if f != "voice"]

    def owning(self, fields):
        vault = make_vault(self)
        vaultlib.settings_set(vault, [(self.FIELDS, fields)])
        return vault

    def test_hide_additions_owned_list(self):
        old = self.old_fields()
        vault = self.owning(old)
        (item,) = ms.find_hide_additions(vault, "1.11.2")
        self.assertEqual(item.id, "hide-add:voice")
        self.assertEqual(len(item.lines), 1)
        self.assertIn("voice", item.lines[0])
        self.assertIn(self.FIELDS, item.lines[0])
        self.assertIn("for the GM only", item.lines[0])
        item.apply(None)
        s = vc.settings(vault)
        self.assertEqual(s.origins[self.FIELDS], "file")
        self.assertEqual(s.get(self.FIELDS), [*old, "voice"])
        self.assertEqual(ms.find_hide_additions(vault, "1.11.2"), [])

    def test_hide_additions_keep_the_gms_own_entries(self):
        vault = self.owning(["mine"])
        (item,) = ms.find_hide_additions(vault, "1.11.2")
        item.apply(None)
        self.assertEqual(vc.settings(vault).get(self.FIELDS), ["mine", "voice"])

    def test_hide_additions_already_listed(self):
        vault = self.owning([*self.old_fields(), "voice"])
        self.assertEqual(ms.find_hide_additions(vault, "1.11.2"), [])

    def test_hide_additions_no_own_list(self):
        # The built-in list stands, and it already holds voice.
        vault = make_vault(self)
        self.assertEqual(ms.find_hide_additions(vault, "1.11.2"), [])
        self.assertIn("voice", vc.settings(vault).get(self.FIELDS))

    def test_hide_additions_no_site_no_own_list(self):
        vault = make_vault(self, site=False)
        self.assertEqual(ms.find_hide_additions(vault, "1.11.2"), [])

    def test_hide_additions_owned_list_without_a_site(self):
        # A site turned on later would publish voice if this were skipped.
        vault = make_vault(self, site=False)
        vaultlib.settings_set(vault, [(self.FIELDS, self.old_fields())])
        (item,) = ms.find_hide_additions(vault, "1.11.2")
        self.assertEqual(item.id, "hide-add:voice")
        item.apply(None)
        self.assertIn("voice", vc.settings(vault).get(self.FIELDS))

    def test_hide_additions_other_release_offers_nothing(self):
        vault = self.owning(self.old_fields())
        self.assertEqual(ms.find_hide_additions(vault, "1.10.47"), [])

    def test_the_check_asks_at_1_11_2(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "hide-fields-voice"]
        self.assertEqual((check.release, check.band, check.asks_site,
                          check.choices, check.kind),
                         ("1.11.2", 2, True, ("hide-add:",), "asks"))
        self.assertTrue(check.plain and check.ask and check.left)

    def test_the_question_leads_with_plain_words(self):
        (item,) = ms.find_hide_additions(self.owning(self.old_fields()), "1.11.2")
        self.assertTrue(item.lines[0].startswith("add voice to the details "
                                                 "your site hides"),
                        item.lines[0])

    def test_settings_added_skips_a_malformed_entry(self):
        answer = {"added": [{"entry": "voice", "since": "1.11.2", "why": "w"},
                            {"entry": "x"}, "junk", {"entry": 3, "since": "1",
                                                     "why": None}]}
        with mock.patch.object(vaultlib, "settings_describe",
                               return_value=answer):
            self.assertEqual(vaultlib.settings_added(self.FIELDS),
                             [{"entry": "voice", "since": "1.11.2",
                               "why": "w"}])

    def test_the_item_holds_the_stamp(self):
        (item,) = ms.find_hide_additions(self.owning(self.old_fields()), "1.11.2")
        self.assertTrue(item.holds_stamp)


class DormantThreadsHideTests(unittest.TestCase):
    """1.12.8: the GM-only dormant list joins the built-in hidden headings,
    and a vault that owns its list of headings is offered it."""

    SECTIONS = "player_site.hide.sections"

    def old_sections(self):
        return [h for h in vaultlib.settings_default(self.SECTIONS)
                if h != "Dormant Threads"]

    def owning(self, sections):
        vault = make_vault(self)
        vaultlib.settings_set(vault, [(self.SECTIONS, sections)])
        return vault

    def test_an_owned_list_without_it_is_offered_it(self):
        old = self.old_sections()
        vault = self.owning(old)
        (item,) = ms.find_hide_additions(vault, "1.12.8")
        self.assertEqual(item.id, "hide-add:Dormant Threads")
        self.assertEqual(item.lines, [
            f"add Dormant Threads to the details your site hides "
            f"({self.SECTIONS}), so the site never shows it: Dormant Threads "
            f"is threads parked when the party left a place or arc, kept "
            f"for the GM"])
        self.assertTrue(item.holds_stamp)
        item.apply(None)
        self.assertEqual(vc.settings(vault).get(self.SECTIONS),
                         [*old, "Dormant Threads"])
        self.assertEqual(ms.find_hide_additions(vault, "1.12.8"), [])

    def test_an_owned_list_that_has_it_is_offered_nothing(self):
        vault = self.owning([*self.old_sections(), "Dormant Threads"])
        self.assertEqual(ms.find_hide_additions(vault, "1.12.8"), [])

    def test_a_vault_with_no_list_of_its_own_is_offered_nothing(self):
        vault = make_vault(self)
        self.assertEqual(ms.find_hide_additions(vault, "1.12.8"), [])
        self.assertIn("Dormant Threads", vc.settings(vault).get(self.SECTIONS))

    def test_the_check_asks_at_1_12_7(self):
        (check,) = [c for c in ms.SITE_CHECKS
                    if c.name == "hide-sections-dormant"]
        self.assertEqual((check.release, check.band, check.asks_site,
                          check.choices, check.kind),
                         ("1.12.8", 2, True, ("hide-add:",), "asks"))
        self.assertTrue(check.plain and check.ask and check.left)


class HideAdditionStampTests(unittest.TestCase):
    """The 1.11.2 hide-add question holds the stamp until it is answered,
    through the low-level apply and `gma update` alike: past the stamp the
    release gate would never offer it again, and voice would publish."""

    FIELDS = "player_site.hide.fields"

    def setUp(self):
        (self.check,) = [c for c in ms.SITE_CHECKS
                         if c.name == "hide-fields-voice"]
        for target, value in ((migrate, ("1.11.2", "test")),):
            p = mock.patch.object(target, "plugin_version", return_value=value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(migrate, "CHECKS", [self.check])
        p.start()
        self.addCleanup(p.stop)
        self.home = tmp(self, "mig-home-")

    def owned(self):
        vault = make_vault(self, version="1.11.1")
        old = [f for f in vaultlib.settings_default(self.FIELDS) if f != "voice"]
        vaultlib.settings_set(vault, [(self.FIELDS, old)])
        return vault, old

    def apply(self, vault, *choose):
        out = io.StringIO()
        args = [str(vault), "apply"]
        for c in choose:
            args += ["--choose", c]
        with contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            code = migrate.main(args)
        return code, out.getvalue()

    def stamp(self, vault):
        return vaultlib.read_stamp(vault)

    def test_offered_from_1_11_1_and_not_once_stamped(self):
        self.assertEqual(migrate.offered([self.check], "1.11.1", "1.11.2"),
                         [self.check])
        self.assertEqual(migrate.offered([self.check], "1.11.2", "1.11.2"), [])

    def test_bare_apply_holds_the_stamp_and_asks_again(self):
        vault, old = self.owned()
        code, out = self.apply(vault)
        self.assertEqual(code, 0, out)
        self.assertIn("not answered: hide-add:voice", out)
        self.assertNotIn("<None>", out)
        self.assertIn("not stamped", out)
        self.assertEqual(self.stamp(vault), "1.11.1")
        self.assertEqual(vc.settings(vault).get(self.FIELDS), old)
        code, out = self.apply(vault)
        self.assertIn("not answered: hide-add:voice", out)

    def test_apply_yes_adds_voice_and_stamps(self):
        vault, old = self.owned()
        code, out = self.apply(vault, "hide-add:voice")
        self.assertEqual(code, 0, out)
        self.assertIn("stamped 1.11.2", out)
        vaultlib.forget_settings(vault)
        self.assertEqual(vc.settings(vault).get(self.FIELDS), [*old, "voice"])

    def test_apply_leave_stamps_without_adding(self):
        vault, old = self.owned()
        code, out = self.apply(vault, "hide-add:voice=leave")
        self.assertEqual(code, 0, out)
        self.assertIn("left as it is", out)
        self.assertIn("stamped 1.11.2", out)
        self.assertEqual(self.stamp(vault), "1.11.2")
        vaultlib.forget_settings(vault)
        self.assertEqual(vc.settings(vault).get(self.FIELDS), old)

    def update(self, vault, answers=None, headless=False):
        import update
        return update.run(vault, answers or {}, headless, home=self.home)

    def test_update_headless_holds_then_yes_adds_voice(self):
        import update_record
        vault, old = self.owned()
        res = self.update(vault, headless=True)
        self.assertEqual(res.left_open, ["hide-add:voice"])
        self.assertEqual(self.stamp(vault), "1.11.1")
        (item,) = ms.find_hide_additions(vault, "1.11.2")
        asked = f"hide-add:voice@{update_record.lines_sha(item.lines)[:8]}"
        res = self.update(vault, {asked: "yes"})
        self.assertEqual(res.left_open, [])
        self.assertEqual(self.stamp(vault), "1.11.2")
        vaultlib.forget_settings(vault)
        self.assertEqual(vc.settings(vault).get(self.FIELDS), [*old, "voice"])

    def test_update_leave_lets_the_stamp_move(self):
        import update_record
        vault, old = self.owned()
        (item,) = ms.find_hide_additions(vault, "1.11.2")
        asked = f"hide-add:voice@{update_record.lines_sha(item.lines)[:8]}"
        res = self.update(vault, {asked: "leave"})
        self.assertEqual(res.left_open, [])
        self.assertEqual(self.stamp(vault), "1.11.2")
        vaultlib.forget_settings(vault)
        self.assertEqual(vc.settings(vault).get(self.FIELDS), old)


class VoicesSwitchTests(unittest.TestCase):
    def test_on_by_default_and_off_when_written_off(self):
        vault = make_vault(self)
        self.assertIs(vaultlib.setting_or_builtin(vault, "vault.voices"), True)
        vaultlib.settings_set(vault, [("vault.voices", False)])
        self.assertIs(vaultlib.setting_or_builtin(vault, "vault.voices"), False)


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class VaultSettingEndToEndTests(unittest.TestCase):
    def test_the_real_tool_reads_sets_and_reads_again(self):
        vault = tmp(self, "vs-e2e-vault-")
        (vault / "_meta").mkdir()
        write_config(vault, "---\ntype: meta\npublish:\n  mode: player\n---\n")
        site_fixture.give_site(vault, lambda p: None)
        self.assertFalse(vc.written_in_vault_file(
            vc.settings(vault), "player_site.theme.default_mode"))
        done = vc.settings_set(vault, [("player_site.theme.default_mode", "dark")])
        self.assertEqual(done, ["player_site.theme.default_mode"])
        after = vc.settings(vault)
        self.assertTrue(vc.written_in_vault_file(
            after, "player_site.theme.default_mode"))
        self.assertEqual(after.get("player_site.theme.default_mode"), "dark")

    def vault_with(self, site_lines):
        vault = tmp(self, "vs-excl-vault-")
        (vault / "_meta").mkdir()
        config = vault / "_meta" / "vault-config.yaml"
        config.write_text("version: 1\nplayer_site:\n" + site_lines, encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        return vault, config


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class MigrateEndToEndTests(unittest.TestCase):
    def test_a_vault_on_the_settings_file_migrates_and_frontmatter_stays_clean(self):
        vault = tmp(self, "mig-e2e-vault-")
        site = tmp(self, "mig-e2e-site-")
        (vault / "_meta").mkdir()
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ncanon_status: AUTHORITATIVE\n---\n\n# Overview\n", encoding="utf-8")
        (vault / "_meta" / "vault-config.yaml").write_text(
            f"version: 1\nplayer_site:\n  publish: true\n  folder: {site.as_posix()}\n"
            "  title: Legacy\n", encoding="utf-8")
        (vault / "_meta" / "vault-state.json").write_text(
            '{"gm_apprentice_version": "1.10.60"}\n', encoding="utf-8")
        (site / "vault.config.json").write_text(json.dumps({"vaultPath": str(vault)}),
                                                encoding="utf-8")
        out = io.StringIO()
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)), \
                contextlib.redirect_stdout(out):
            self.assertEqual(migrate.main([str(vault), "apply"]), 0)
            self.assertIn("title: Legacy", (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8"))
            again = io.StringIO()
            with contextlib.redirect_stdout(again):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
        self.assertIn("already at", again.getvalue())
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_check.py"), str(vault),
             "frontmatter"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("# count: 0", proc.stdout)


class LeakEndToEndTests(unittest.TestCase):
    def test_a_handouts_context_is_planned_once_and_moved(self):
        vault = tmp(self, "mig-leak-vault-")
        # The real check asks the repo's publish tool (no mock), through a
        # site folder with it installed.
        vc.use_publish_tool(vc.PUBLISH_TOOL)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\n---\n", encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        note = vault / "Letter.md"
        note.write_text("---\ntype: document\n---\n\n# The Letter\n\n"
                        "## Content\n\n> Dear Sir.\n\n## Context\n\n"
                        "Why it was written.\n", encoding="utf-8")
        items = {i.group: i for i in ms.find_gm_leak(vault)}
        self.assertEqual(items[WILL].lines, [
            "Letter.md: re-nest 'Context' under ## GM Notes"])
        self.assertNotIn(PERSON, items)
        done = items[WILL].apply(None)
        self.assertIn("Letter.md: re-nested 'Context' under "
                      "## GM Notes", done)
        text = note.read_text(encoding="utf-8")
        self.assertIn("## GM Notes", text)
        self.assertEqual(ms.find_gm_leak(vault), [])


if __name__ == "__main__":
    unittest.main()

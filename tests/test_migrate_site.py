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


class PlayedTests(unittest.TestCase):
    def answer(self, published, unclear):
        return vc.ToolAnswer(data={"applicable": True, "dryRun": True,
                                   "published": published, "unclear": unclear})

    def test_reviewed_sessions_are_will_do_and_unclear_are_choices(self):
        vault = make_vault(self)
        asked = []
        state = {"left": True}

        def ask(v, args):
            asked.append(args)
            if "--dry-run" in args:
                if not state["left"]:
                    return self.answer([], [])
                return self.answer(
                    ["Ch1/S01/Session 01.md"],
                    [{"path": "Ch1/S02/Session 02.md",
                      "reason": "Wrap-Up not reviewed yet",
                      "wrapUp": "Ch1/S02/Wrap.md"},
                     {"path": "Ch1/S03/Session 03.md",
                      "reason": "no Wrap-Up", "wrapUp": None}])
            state["left"] = False
            return vc.ToolAnswer(data={"applicable": True, "published": []})
        with mock.patch.object(ms, "ask_publish_tool", ask):
            items = {i.id: i for i in ms.find_publish_played(vault)}
            self.assertEqual(items["publish-played"].group, WILL)
            self.assertEqual(items["publish-played"].lines,
                             ["register Ch1/S01/Session 01.md as published"])
            items["publish-played"].apply(None)
            items["played:Ch1/S02/Session 02.md"].apply(None)
            items["played:Ch1/S03/Session 03.md"].apply(None)
        self.assertEqual(asked[1], ["manifest", "publish-played"])
        self.assertEqual(asked[3], ["manifest", "publish-played", "--session",
                                    "Ch1/S02/Session 02.md",
                                    "--include-unreviewed"])
        self.assertEqual(asked[5], ["manifest", "publish-played", "--session",
                                    "Ch1/S03/Session 03.md", "--publish-body"])
        self.assertIn("Wrap-Up not reviewed yet",
                      items["played:Ch1/S02/Session 02.md"].lines[0])

    def test_a_registration_the_tool_does_not_keep_fails(self):
        vault = make_vault(self)
        same = self.answer(["Ch1/S01/Session 01.md"],
                           [{"path": "Ch1/S02/Session 02.md",
                             "reason": "r", "wrapUp": None}])
        with mock.patch.object(ms, "ask_publish_tool", return_value=same):
            items = {i.id: i for i in ms.find_publish_played(vault)}
            for item in items.values():
                with self.assertRaises(StepFailed):
                    item.apply(None)

    def test_not_applicable_or_no_site_is_nothing(self):
        vault = make_vault(self)
        for answer in (vc.ToolAnswer(),
                       vc.ToolAnswer(data={"applicable": False})):
            with mock.patch.object(ms, "ask_publish_tool",
                                   return_value=answer):
                self.assertEqual(ms.find_publish_played(vault), [])



class PersonRowTests(unittest.TestCase):
    def test_session_recaps_in_index_bodies(self):
        rows = ["WARNING\tCh1/S01/Session 01.md\tnot in Publishing",
                "INFO\tCh1/S02/Session 02.md:9\tsession index body has 4 "
                "line(s) outside a gm-only fence \u2014 the site withholds it"]
        with mock.patch.object(ms, "check_sessions", return_value=rows):
            (item,) = ms.find_session_recaps(make_vault(self))
        self.assertEqual(item.group, PERSON)
        self.assertEqual(len(item.lines), 1)
        self.assertTrue(item.lines[0].startswith("Ch1/S02/Session 02.md:9\t"))

    def test_recap_rows_keep_the_variable_part_by_the_path(self):
        homes = ("document links go in frontmatter `documents:`; anything "
                 "the Keeper keeps on the hub goes under a fenced ## GM Notes "
                 "(see _Templates/_Template_Session.md)")
        rows = [f"INFO\tCh1/S0{n}/Session 0{n}.md:9\tsession index body has "
                f"{n} line(s) outside a gm-only fence \u2014 the site "
                f"withholds it now the session has a Wrap-Up, and the hub is "
                f"metadata only: {homes}" for n in (2, 3)]
        with mock.patch.object(ms, "check_sessions", return_value=rows):
            (item,) = ms.find_session_recaps(make_vault(self))
        head, _, message = item.lines[0].partition("\t")
        self.assertEqual(head, "Ch1/S02/Session 02.md:9 (2 lines; document "
                               "links go in frontmatter `documents:`)")
        self.assertTrue(message.endswith("anything the Keeper keeps there "
                                         "goes under a fenced ## GM Notes "
                                         "(see _Templates/_Template_Session.md)"))
        self.assertEqual(message, item.lines[1].partition("\t")[2])

    def test_notes_the_build_cannot_parse(self):
        rows = ["ERROR\tNPCs/A.md\tthe site's build cannot parse this "
                "frontmatter (duplicated mapping key) and skips the note",
                "ERROR\tNPCs/B.md\tmissing required field: name"]
        with mock.patch.object(ms, "check_frontmatter", return_value=rows):
            (item,) = ms.find_unparseable(make_vault(self))
        self.assertEqual([line.split("\t")[0] for line in item.lines],
                         ["NPCs/A.md"])

    def test_a_check_that_could_not_ask_the_tool_stops_a_site_vault(self):
        row = ("INFO\t(vault)\tthe publish tool could not be consulted (node "
               "is not on PATH), so no hub-bookkeeping rows are shown")
        for name, find, check in (
                ("session-recaps", ms.find_session_recaps, "check_sessions"),
                ("unparseable-notes", ms.find_unparseable, "check_frontmatter")):
            with mock.patch.object(ms, check, return_value=[row]):
                with self.assertRaises(StepFailed, msg=name) as caught:
                    find(make_vault(self))
                self.assertIn("could not be consulted", str(caught.exception))
                # No site: nothing publishes, so nothing waits on the tool.
                self.assertEqual(find(make_vault(self, site=False)), [], name)


class ToneShownNoticeTests(unittest.TestCase):
    NOTE = ("---\ntype: npc\nrelationships:\n"
            '  - target: "[[A]]"\n    type: knows\n    tone: hostile\n---\n')

    def vault_with(self, note=NOTE, **kw):
        vault = make_vault(self, **kw)
        (vault / "NPCs").mkdir()
        (vault / "NPCs" / "B.md").write_text(note, encoding="utf-8")
        return vault

    def setUp(self):
        import tones
        from unittest import mock
        # Which notes publish is the site tool's answer; here, the one note.
        patch = mock.patch.object(tones, "published_notes",
                                  return_value={"NPCs/B.md"})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_site_vault_with_a_tone_is_told_once_what_the_site_now_shows(self):
        (item,) = ms.find_tone_shown(self.vault_with())
        self.assertEqual(item.id, "tone-shown")
        self.assertEqual(item.group, PERSON)
        text = " ".join(item.lines)
        for word in ("warm", "hostile", "neutral", "Tone Words"):
            self.assertIn(word, text)
        self.assertTrue(all("\t" in line for line in item.lines))

    def test_nothing_to_say_without_a_site_or_without_a_tone(self):
        self.assertEqual(ms.find_tone_shown(self.vault_with(site=False)), [])
        quiet = self.NOTE.replace("    tone: hostile\n", "")
        self.assertEqual(ms.find_tone_shown(self.vault_with(note=quiet)), [])

    def test_nothing_to_say_when_the_site_shows_no_tone(self):
        import tones
        from unittest import mock
        shown = {"NPCs/B.md"}
        with mock.patch.object(tones, "published_notes", return_value=shown):
            self.assertEqual(len(ms.find_tone_shown(self.vault_with())), 1)
            hidden = self.NOTE.replace("    tone: hostile\n",
                                       "    tone: hostile\n    gm_only: true\n")
            self.assertEqual(ms.find_tone_shown(self.vault_with(note=hidden)), [])
            excluded = self.NOTE.replace(
                "relationships:", "publish_exclude_fields: [relationships]\nrelationships:")
            self.assertEqual(ms.find_tone_shown(self.vault_with(note=excluded)), [])
        with mock.patch.object(tones, "published_notes", return_value=set()):
            self.assertEqual(ms.find_tone_shown(self.vault_with()), [])
        # The site's tool cannot be asked: told, the safe side.
        with mock.patch.object(tones, "published_notes", return_value=None):
            self.assertEqual(len(ms.find_tone_shown(self.vault_with())), 1)

    def test_it_is_offered_once_by_the_release_that_shows_tone(self):
        check = {c.name: c for c in ms.SITE_CHECKS}["tone-shown"]
        self.assertEqual(check.release, "1.10.46")
        # Release-gated: a vault at or past 1.10.46 is not offered it again.
        names = lambda v: [c.name for c in migrate.offered(ms.SITE_CHECKS, v, "1.10.46")]
        self.assertIn("tone-shown", names("1.10.45"))
        self.assertNotIn("tone-shown", names("1.10.46"))


class SheetSourceTests(unittest.TestCase):
    PC = '---\nname: "Ada"\ntype: pc\n---\n\n## Stat Sheet\n\nTBD\n'

    def make_pc(self):
        vault = make_vault(self)
        (vault / "PCs").mkdir()
        pc = vault / "PCs" / "Ada.md"
        pc.write_text(self.PC, encoding="utf-8")
        return vault, pc

    def test_a_pc_with_no_sheet_is_a_choice_that_writes_the_answer(self):
        vault, pc = self.make_pc()
        # The shapes vault_check's pc-body emits; the retired-fields row
        # names the heading too but is not about a missing sheet.
        rows = ["WARNING\tPCs/Ada.md:6\t## Stat Sheet holds no stats; fill it "
                "in, or set sheet_source to where the sheet is kept",
                "WARNING\tPCs/Ada.md\tfrontmatter field(s) str are no longer "
                "read for the character sheet \u2014 move the values into the "
                "note's ## Stat Sheet sections",
                "WARNING\tPCs/Ada.md:9\tCurrent Status is an H3 \u2014 it must "
                "be an H2 outside the protected sections",
                "WARNING\tPCs/Bea.md\tno published ## Stat Sheet section "
                "\u2014 the PC's page has no character sheet; fill one in, or "
                "set sheet_source to where the sheet is kept"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            items = ms.find_sheet_source(vault)
        self.assertEqual([i.id for i in items],
                         ["sheet-source:PCs/Ada.md", "sheet-source:PCs/Bea.md"])
        item = items[0]
        self.assertEqual(item.wants, "where the sheet is kept, or leave")
        self.assertTrue(item.holds_stamp)   # #339: silence is not "leave"
        before = pc.read_text(encoding="utf-8")
        self.assertEqual(item.apply("leave"),
                         ["left sheet_source as it is in PCs/Ada.md"])
        self.assertEqual(pc.read_text(encoding="utf-8"), before)
        item.apply("paper, with the player")
        self.assertIn('sheet_source: "paper, with the player"\n',
                      pc.read_text(encoding="utf-8"))

    def pc_written(self, written):
        vault, pc = self.make_pc()
        pc.write_text(f'---\nname: "Ada"\ntype: pc\n{written}\n---\n\n'
                      f'## Stat Sheet\n\nTBD\n', encoding="utf-8")
        rows = ["WARNING\tPCs/Ada.md:6\t## Stat Sheet holds no stats; fill it "
                "in, or set sheet_source to where the sheet is kept"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            (item,) = ms.find_sheet_source(vault)
        return item, pc

    def test_a_spaced_or_quoted_sheet_source_key_stops_and_adds_no_second_key(self):
        # The line editor refuses these forms (they are not plain `key:`), so
        # the choice fails with the line named instead of adding a duplicate.
        for written in ('sheet_source : ""', '"sheet_source": ""',
                        "'sheet_source':  ''"):
            item, pc = self.pc_written(written)
            before = pc.read_bytes()
            with self.assertRaises(StepFailed) as caught:
                item.apply("on paper")
            self.assertIn("sheet_source", str(caught.exception))
            self.assertEqual(pc.read_bytes(), before, written)

    @unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                         or (shutil.which("node") and (
                             vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                         "node and the publish tool's node_modules are needed")
    def test_a_real_tbd_sheet_is_found_and_written(self):
        vault, pc = self.make_pc()
        (item,) = ms.find_sheet_source(vault)
        self.assertEqual(item.id, "sheet-source:PCs/Ada.md")
        self.assertIn("holds no stats", item.lines[0])
        item.apply("on paper")
        self.assertIn('sheet_source: "on paper"', pc.read_text(encoding="utf-8"))
        self.assertEqual(ms.find_sheet_source(vault), [])


class ThemeChoiceTests(unittest.TestCase):
    """The settings are the real tool's: vaults here are real files."""

    def written(self, vault):
        return vc.settings(vault)

    def test_default_mode_is_offered_while_unset_and_writes_the_answer(self):
        vault = make_vault(self)
        (item,) = ms.find_default_mode(vault)
        self.assertEqual((item.id, item.wants),
                         ("default-mode", "dark, light or leave"))
        self.assertTrue(item.holds_stamp)
        self.assertEqual(item.apply("dark"),
                         ["wrote player_site.theme.default_mode: dark"])
        self.assertEqual(self.written(vault).get("player_site.theme.default_mode"),
                         "dark")
        self.assertEqual(item.apply("leave"),
                         ["left the default palette to the reader's "
                          "device"])
        with self.assertRaises(StepFailed):
            item.apply("purple")
        # Written, so no longer offered; the file shows the one line added.
        self.assertEqual(ms.find_default_mode(vault), [])
        self.assertIn("    default_mode: dark\n",
                      (vault / "_meta" / "vault-config.yaml").read_text(
                          encoding="utf-8"))

    def test_default_mode_already_set_is_not_offered(self):
        vault = make_vault(self, extra="  theme:\n    default_mode: light\n")
        self.assertEqual(ms.find_default_mode(vault), [])

    def test_a_default_mode_only_the_site_file_holds_is_still_offered(self):
        # The old question was whether the vault file sets it.
        vault = make_vault(self)
        site_of(vault).joinpath("vault.config.json").write_text(
            json.dumps({"theme": {"default_mode": "dark"}}), encoding="utf-8")
        self.assertEqual([i.id for i in ms.find_default_mode(vault)],
                         ["default-mode"])

    def google_vault(self, fonts="      heading: Cinzel\n      body: Lora\n"):
        return make_vault(self, extra="  theme:\n    fonts:\n" + fonts)

    def test_google_fonts_offer_self_hosting(self):
        vault = self.google_vault()
        (item,) = ms.find_fonts(vault)
        self.assertEqual(item.id, "fonts-self-host")
        self.assertIn("Cinzel, Lora", item.lines[0])
        item.apply(None)
        self.assertEqual(self.written(vault).get("player_site.theme.fonts.source"),
                         "self-host")
        self.assertEqual(ms.find_fonts(vault), [])

    def test_the_families_are_the_plugin_tools_not_the_sites_pinned_copy(self):
        vault = self.google_vault()
        site = site_of(vault)
        pkg = site / "node_modules" / "gm-apprentice-publish"
        (pkg / "bin").mkdir(parents=True)
        (pkg / "bin" / "gm-publish.js").write_text("process.exit(1);\n",
                                                   encoding="utf-8")
        self.assertEqual(ms._google_fonts(vault), ["Cinzel", "Lora"])

    def test_self_hosted_or_no_theme_or_no_site_offers_nothing(self):
        self.assertEqual(ms.find_fonts(make_vault(self)), [])
        self.assertEqual(ms.find_fonts(self.google_vault(
            "      source: self-host\n      heading: Cinzel\n")), [])
        self.assertEqual(ms.find_fonts(make_vault(self, site=False)), [])
        self.assertEqual(ms.find_default_mode(make_vault(self, site=False)), [])

    def test_the_default_mode_choice_needs_a_value(self):
        check = next(c for c in ms.SITE_CHECKS if c.name == "default-mode")
        self.assertEqual(check.choices, ("default-mode=",))
        self.assertEqual(
            [c.name for c in ms.SITE_CHECKS[:5]],
            [ms.REPIN, ms.FULL_MODE, "publish-site",
             "default-mode", "fonts-self-host"])


class ExcludeListTests(unittest.TestCase):
    """1.10.47 (#294): a vault with a site and no list of its own is given
    the built-in lists; a list it owns is never touched. The settings are
    the real tool's."""

    def test_a_vault_with_no_lists_gets_both_built_in_lists(self):
        vault = make_vault(self)
        (item,) = ms.find_exclude_lists(vault)
        self.assertEqual((item.id, item.group), ("exclude-lists", WILL))
        item.apply(None)
        s = vc.settings(vault)
        for name in ("player_site.hide.sections", "player_site.hide.fields"):
            self.assertEqual(s.origins[name], "file")
            self.assertEqual(s.get(name), ms.settings_default(name))
        # Written once: asking again offers nothing.
        self.assertEqual(ms.find_exclude_lists(vault), [])

    def test_the_two_lists_are_one_edit(self):
        vault = make_vault(self)
        (item,) = ms.find_exclude_lists(vault)
        writes = []
        real = ms.settings_set
        with mock.patch.object(ms, "settings_set",
                               lambda v, pairs: writes.append(pairs) or real(v, pairs)):
            item.apply(None)
        self.assertEqual(len(writes), 1)
        self.assertEqual([n for n, _ in writes[0]],
                         ["player_site.hide.sections", "player_site.hide.fields"])

    def test_only_the_missing_list_is_written(self):
        vault = make_vault(self, extra="  exclude_sections: [Mine]\n")
        (item,) = ms.find_exclude_lists(vault)
        item.apply(None)
        s = vc.settings(vault)
        self.assertEqual(s.get("player_site.hide.sections"), ["Mine"])
        self.assertEqual(s.get("player_site.hide.fields"),
                         ms.settings_default("player_site.hide.fields"))

    def test_a_vault_with_its_own_lists_is_left_alone(self):
        vault = make_vault(self, extra="  exclude_sections: [Mine]\n"
                                       "  exclude_fields: [mine]\n")
        before = (vault / "_meta" / "vault-config.yaml").read_bytes()
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual((vault / "_meta" / "vault-config.yaml").read_bytes(), before)

    def test_the_plan_names_the_settings_file(self):
        vault = make_vault(self)
        (item,) = ms.find_exclude_lists(vault)
        for line in item.lines:
            self.assertNotIn("vault-config.md", line)
            self.assertIn("into _meta/vault-config.yaml", line)

    def test_a_list_the_tool_could_not_read_is_replaced(self):
        vault = make_vault(self, extra="  exclude_sections: Mine\n"
                                       "  exclude_fields: [mine]\n")
        (item,) = ms.find_exclude_lists(vault)
        self.assertEqual(len(item.lines), 1)
        self.assertIn("player_site.hide.sections", item.lines[0])

    def test_the_line_quotes_what_the_replaced_value_said(self):
        # The build already ignored the scalar, so nothing published changes; but the
        # GM typed it, so the report says what it was before it goes.
        vault = make_vault(self, extra="  exclude_sections: Mine\n"
                                       "  exclude_fields: [mine]\n")
        (item,) = ms.find_exclude_lists(vault)
        self.assertIn('"Mine"', item.lines[0])
        self.assertIn("replace", item.lines[0])

    def test_no_site_offers_nothing(self):
        self.assertEqual(ms.find_exclude_lists(make_vault(self, site=False)), [])

    def test_the_check_is_gated_at_1_10_47_in_the_config_band(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "exclude-lists"]
        self.assertEqual((check.release, check.band, check.asks_site),
                         ("1.10.47", 2, True))


class HideAdditionTests(unittest.TestCase):
    """1.11.2 (#460): an entry added to a built-in hide list after vaults
    began owning their lists is offered to a list the vault owns, so the
    voice field never reaches a player site. The settings are the real
    tool's."""

    FIELDS = "player_site.hide.fields"

    def old_fields(self):
        # The list a vault wrote before voice joined the default; read from
        # the tool, never written out here.
        return [f for f in ms.settings_default(self.FIELDS) if f != "voice"]

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

    def test_hide_additions_no_site(self):
        vault = make_vault(self, site=False)
        self.assertEqual(ms.find_hide_additions(vault, "1.11.2"), [])

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
        old = [f for f in ms.settings_default(self.FIELDS) if f != "voice"]
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


class PropsMoveTests(unittest.TestCase):
    """15's move offered as a per-vault choice; nothing moves unanswered."""

    def props_vault(self):
        root = tmp(self, "mig-props-")
        vault, site = root / "Vault", root / "site"
        (vault / "_meta").mkdir(parents=True)
        site.mkdir()
        (site / "vault.config.json").write_text("{}", encoding="utf-8")
        (vault / "_meta" / "vault-config.yaml").write_text(
            f"version: 1\nplayer_site:\n  folder: {site.as_posix()}\n"
            "  keep:\n    - props\n  after_build:\n"
            "    - node scripts/add-props.mjs\n", encoding="utf-8")
        props = vault / "Chapters" / "Ch1" / "Props"
        props.mkdir(parents=True)
        (props / "letter.html").write_text("<p>a</p>", encoding="utf-8")
        (props / "index.html").write_text("<p>i</p>", encoding="utf-8")
        live = site_of(vault) / "docs" / "props"
        live.mkdir(parents=True)
        (live / "letter.html").write_text("<p>a</p>", encoding="utf-8")
        (vault / "Chapters" / "built.md").write_text(
            "---\nprop: built.html\nprop_look: paper\n---\nbody\n", encoding="utf-8")
        return vault

    def test_props_move_offered_once_per_vault(self):
        vault = self.props_vault()
        (item,) = ms.find_props_move(vault)
        self.assertEqual((item.id, item.group, item.wants, item.holds_stamp),
                         ("props-move", migrate_core.CHOICE, "move or leave", True))
        text = "\n".join(item.lines)
        for part in ("1 build_props note", "1 hand-made page in Props folders, 1 of them live",
                     "kept folder props with 1 page", "build step add-props",
                     "run prop_move.py VAULT plan to see every page compared before choosing"):
            self.assertIn(part, text)
        self.assertEqual(item.lines[-1].split()[-1], "choosing")
        check = next(c for c in ms.SITE_CHECKS if c.name == "props-move")
        self.assertEqual((check.release, check.band, check.asks_site, check.choices),
                         ("1.10.105", 4, True, ("props-move=",)))

    def test_nothing_to_move_no_item(self):
        self.assertEqual(ms.find_props_move(make_vault(self)), [])
        self.assertEqual(ms.find_props_move(make_vault(self, site=False)), [])
        # Props on disk but no site: apply could not check the move.
        vault = make_vault(self, site=False)
        (vault / "built.md").write_text(
            "---\nprop: b.html\nprop_look: paper\n---\n", encoding="utf-8")
        self.assertEqual(ms.find_props_move(vault), [])

    def test_leave_keeps_everything(self):
        vault = self.props_vault()
        (item,) = ms.find_props_move(vault)
        before = sorted(p.relative_to(vault).as_posix() for p in vault.rglob("*"))
        with mock.patch.object(ms, "_run_prop_move") as run:
            out = item.apply("leave")
        run.assert_not_called()
        self.assertIn("nothing moved", out[0])
        self.assertEqual(before, sorted(p.relative_to(vault).as_posix() for p in vault.rglob("*")))
        with self.assertRaises(StepFailed):
            item.apply("maybe")

    def test_move_runs_apply_with_the_decisions_file_when_there_is_one(self):
        vault = self.props_vault()
        (item,) = ms.find_props_move(vault)
        with mock.patch.object(ms, "_run_prop_move",
                               return_value=(0, "# notes: 2\n", "")) as run:
            item.apply("move")
        run.assert_called_once_with(vault, ["apply"])
        (vault / "_meta" / "prop-move.json").write_text("{}", encoding="utf-8")
        with mock.patch.object(ms, "_run_prop_move", return_value=(0, "# x\n", "")) as run:
            item.apply("move")
        run.assert_called_once_with(vault, ["apply", "--decisions", "_meta/prop-move.json"])

    def test_move_failure_is_step_failed(self):
        vault = self.props_vault()
        (item,) = ms.find_props_move(vault)
        said = "ERROR\t-\tmove-check found 1 blocker; the vault is as it was\n"
        with mock.patch.object(ms, "_run_prop_move", return_value=(1, said, "")):
            with self.assertRaises(StepFailed) as cm:
                item.apply("move")
        self.assertIn("move-check found 1 blocker", str(cm.exception))
        self.assertIn("the vault is as it was", str(cm.exception))

    def test_move_failure_names_the_files_it_could_not_put_back(self):
        vault = self.props_vault()
        (item,) = ms.find_props_move(vault)
        said = ("ERROR\t-\tthe settings could not be written: disk full; "
                "these could not be put back: _meta/vault-config.yaml, Props/a.html\n")
        with mock.patch.object(ms, "_run_prop_move", return_value=(1, said, "")):
            with self.assertRaises(StepFailed) as cm:
                item.apply("move")
        text = str(cm.exception)
        self.assertIn("these could not be put back: _meta/vault-config.yaml, Props/a.html", text)
        self.assertNotIn("as it was", text)

    def test_apply_runs_with_no_outer_timeout(self):
        # Ruling 35: the move bounds each tool call itself; an outer limit would kill it between steps.
        vault = self.props_vault()
        done = subprocess.CompletedProcess([], 0, "# notes: 1\n", "")
        with mock.patch.object(ms.subprocess, "run", return_value=done) as run:
            self.assertEqual(ms._run_prop_move(vault, ["apply"]), (0, "# notes: 1\n", ""))
        self.assertIsNone(run.call_args.kwargs.get("timeout"))

    def test_prop_steps_are_not_in_retired_steps(self):
        for name in ("add-props", "inject-gazetteer"):
            self.assertNotIn(name, ms.RETIRED_STEPS)
            self.assertNotIn(name, ms.RETIRED_FROM)


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

    def test_the_exclude_lists_are_written_once_and_a_second_run_changes_nothing(self):
        vault, config = self.vault_with(
            "  # who reads\n  title: X  # keep\n")
        (item,) = ms.find_exclude_lists(vault)
        item.apply(None)
        text = config.read_text(encoding="utf-8")
        self.assertIn("  # who reads\n  title: X  # keep\n", text)
        self.assertIn("GM Notes", text)
        self.assertIn("secrets", text)
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual(config.read_text(encoding="utf-8"), text)

    def test_a_vault_with_its_own_lists_is_not_changed(self):
        vault, config = self.vault_with(
            "  hide:\n    sections: [Rumours]\n    fields: [mine]\n")
        before = config.read_text(encoding="utf-8")
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual(config.read_text(encoding="utf-8"), before)


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


class ToolCannotAnswerTests(unittest.TestCase):
    """A step that needs the site's publish tool stops, and says so, when
    the tool cannot be asked or cannot answer; it never plans on a guess."""

    def gm_leak(self):
        rows = ["ERROR\t(vault)\tgm-leak cannot ask the site's publish tool"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            ms.find_gm_leak(make_vault(self))

    def publish_played(self):
        answer = vc.ToolAnswer(why="node is not on PATH")
        with mock.patch.object(ms, "ask_publish_tool", return_value=answer):
            ms.find_publish_played(make_vault(self))

    def sheet_source(self):
        vault = make_vault(self)
        (vault / "PCs").mkdir()
        (vault / "PCs" / "Ada.md").write_text(SheetSourceTests.PC,
                                              encoding="utf-8")
        rows = ["ERROR\t(vault)\tpc-body stopped: the publish tool stopped "
                "answering (x)"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            ms.find_sheet_source(vault)

    def fonts(self):
        gone = vc.PublishToolUnavailable("the publish tool exited without answering")
        vault = make_vault(
            self, extra="  theme:\n    fonts:\n      heading: Cinzel\n"
                        "      body: Lora\n")
        with mock.patch.object(ms, "google_fonts", side_effect=gone):
            ms.find_fonts(vault)

    def test_each_step_stops(self):
        for step, said in ((self.gm_leak, "cannot ask"),
                           (self.publish_played, "node is not on PATH"),
                           (self.sheet_source, "stopped answering"),
                           (self.fonts, "exited without answering")):
            with self.subTest(step.__name__):
                with self.assertRaises(StepFailed) as caught:
                    step()
                self.assertIn(said, str(caught.exception))


if __name__ == "__main__":
    unittest.main()

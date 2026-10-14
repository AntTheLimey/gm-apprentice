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
from migrate_core import PERSON, WILL, StepFailed  # noqa: E402

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
    (vault / "_meta" / "vault-config.md").write_text(body + "---\n",
                                                    encoding="utf-8")
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
        self.assertIn("publish.site is on but publish.site_dir names no "
                      "folder", str(caught.exception))

    def test_a_site_dir_with_no_site_file_stops(self):
        vault = make_vault(self)
        (site_of(vault) / "vault.config.json").unlink()
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, Pin())
        self.assertIn("no vault.config.json is there", str(caught.exception))

    def test_inline_publish_block_stops_the_repin(self):
        vault = make_vault(self, publish=False)
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ngm_apprentice_version: "1.10.12"\n'
            "publish: {mode: player, site_dir: ../site}\n---\n",
            encoding="utf-8")
        pin = Pin()
        with self.assertRaises(StepFailed) as caught:
            self.find(vault, pin)
        self.assertIn("written on one line", str(caught.exception))
        self.assertEqual(pin.calls, [])

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
        return (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")

    def test_a_site_dir_writes_true(self):
        vault = make_vault(self)
        (item,) = ms.find_publish_site(vault)
        self.assertEqual((item.id, item.group), ("publish-site", WILL))
        self.assertEqual(item.apply(None), ["wrote publish.site: true"])
        self.assertIn("\n  site: true\n", self.text(vault))
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_no_site_dir_writes_false(self):
        vault = make_vault(self, site=False)
        (item,) = ms.find_publish_site(vault)
        self.assertIn("no site folder is named; if this vault has a site, "
                      "set publish.site_dir to its folder instead",
                      item.lines[0])
        item.apply(None)
        self.assertIn("\n  site: false\n", self.text(vault))

    def test_a_site_dir_row_has_no_caveat(self):
        (item,) = ms.find_publish_site(make_vault(self))
        self.assertEqual(
            item.lines, ["write publish.site: true in _meta/vault-config.md"])

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
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ngm_apprentice_version: "1.10.12"\npublish:\n---\n',
            encoding="utf-8")
        self.assertFalse(vc.settings(vault).has_site_block)
        (item,) = ms.find_publish_site(vault)
        item.apply(None)
        self.assertIn("publish:\n  site: false\n", self.text(vault))
        self.assertEqual(ms.find_publish_site(vault), [])

    def test_a_publish_block_on_one_line_gets_nothing(self):
        vault = make_vault(self, publish=False)
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish: {mode: player}\n---\n", encoding="utf-8")
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

    def test_a_tool_that_cannot_be_asked_stops(self):
        rows = ["ERROR\t(vault)\tgm-leak cannot ask the site's publish tool"]
        with mock.patch.object(ms, "check_gm_leak", return_value=rows):
            with self.assertRaises(StepFailed) as caught:
                ms.find_gm_leak(make_vault(self))
        self.assertIn("cannot ask", str(caught.exception))

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

    def test_a_tool_that_cannot_answer_stops(self):
        with mock.patch.object(ms, "ask_publish_tool",
                               return_value=vc.ToolAnswer(why="node is not on PATH")):
            with self.assertRaises(StepFailed):
                ms.find_publish_played(make_vault(self))


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

    def test_a_postbuild_script_is_named(self):
        vault = make_vault(self)
        site = site_of(vault)
        (site / "package.json").write_text(json.dumps(
            {"scripts": {"postbuild": "node add-toggle.js"}}), encoding="utf-8")
        (item,) = ms.find_postbuild(vault)
        self.assertEqual(item.group, PERSON)
        self.assertIn("node add-toggle.js", item.lines[0])
        self.assertTrue(item.lines[0].startswith("package.json (site)\t"))
        self.assertIn("build step", item.lines[0])
        (site / "package.json").write_text("{}", encoding="utf-8")
        self.assertEqual(ms.find_postbuild(vault), [])
        self.assertEqual(ms.find_postbuild(make_vault(self, site=False)), [])


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

    def test_a_tool_that_cannot_be_asked_stops(self):
        vault, _pc = self.make_pc()
        rows = ["ERROR\t(vault)\tpc-body stopped: the publish tool stopped "
                "answering (x)"]
        with mock.patch.object(ms, "check_pc_body", return_value=rows):
            with self.assertRaises(StepFailed):
                ms.find_sheet_source(vault)

    def test_the_check_asks_for_a_value(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "sheet-source"]
        self.assertEqual(check.choices, ("sheet-source:=",))

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
                         ["wrote publish.theme.default_mode: dark"])
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
                      (vault / "_meta" / "vault-config.md").read_text(
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

    def test_a_tool_that_cannot_answer_stops(self):
        gone = vc.PublishToolUnavailable("the publish tool exited without answering")
        with mock.patch.object(ms, "google_fonts", side_effect=gone):
            with self.assertRaises(StepFailed):
                ms.find_fonts(self.google_vault())

    def test_the_default_mode_choice_needs_a_value(self):
        check = next(c for c in ms.SITE_CHECKS if c.name == "default-mode")
        self.assertEqual(check.choices, ("default-mode=",))
        self.assertEqual(
            [c.name for c in ms.SITE_CHECKS[:5]],
            [ms.REPIN, ms.MOVE, "publish-site", "default-mode",
             "fonts-self-host"])


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
        before = (vault / "_meta" / "vault-config.md").read_bytes()
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual((vault / "_meta" / "vault-config.md").read_bytes(), before)

    def test_a_list_only_the_site_file_holds_is_the_vaults_own_for_now(self):
        vault = make_vault(self)
        site_of(vault).joinpath("vault.config.json").write_text(
            json.dumps({"excludeSections": ["Old"]}), encoding="utf-8")
        (item,) = ms.find_exclude_lists(vault)
        self.assertEqual(len(item.lines), 1)
        self.assertIn("publish.exclude_fields", item.lines[0])

    def test_a_list_the_tool_could_not_read_is_replaced(self):
        vault = make_vault(self, extra="  exclude_sections: Mine\n"
                                       "  exclude_fields: [mine]\n")
        (item,) = ms.find_exclude_lists(vault)
        self.assertEqual(len(item.lines), 1)
        self.assertIn("publish.exclude_sections", item.lines[0])

    def test_no_site_offers_nothing(self):
        self.assertEqual(ms.find_exclude_lists(make_vault(self, site=False)), [])

    def test_the_check_is_gated_at_1_10_47_in_the_config_band(self):
        (check,) = [c for c in ms.SITE_CHECKS if c.name == "exclude-lists"]
        self.assertEqual((check.release, check.band, check.asks_site),
                         ("1.10.47", 2, True))

    def test_the_migrations_table_has_its_row(self):
        text = (Path(ms.__file__).parent.parent / "migrations.md").read_text(encoding="utf-8")
        self.assertRegex(text, r"(?m)^\| 1\.10\.47 \|.*`exclude-lists`")


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class VaultSettingEndToEndTests(unittest.TestCase):
    def test_the_real_tool_reads_sets_and_reads_again(self):
        vault = tmp(self, "vs-e2e-vault-")
        (vault / "_meta").mkdir()
        (vault / "_meta" / "vault-config.md").write_text(
            "---\ntype: meta\npublish:\n  mode: player\n---\n",
            encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        self.assertFalse(vc.written_in_vault_file(
            vc.settings(vault), "player_site.theme.default_mode"))
        done = vc.settings_set(vault, [("player_site.theme.default_mode", "dark")])
        self.assertEqual(done, ["player_site.theme.default_mode"])
        after = vc.settings(vault)
        self.assertTrue(vc.written_in_vault_file(
            after, "player_site.theme.default_mode"))
        self.assertEqual(after.get("player_site.theme.default_mode"), "dark")

    def vault_with(self, publish_lines):
        vault = tmp(self, "vs-excl-vault-")
        (vault / "_meta").mkdir()
        (vault / "_meta" / "vault-config.md").write_text(
            "---\ntype: meta\npublish:\n" + publish_lines + "---\nBody\n",
            encoding="utf-8")
        site_fixture.give_site(vault, lambda p: None)
        return vault, vault / "_meta" / "vault-config.md"

    def test_the_exclude_lists_are_written_once_and_a_second_run_changes_nothing(self):
        vault, config = self.vault_with(
            "  # who reads\n  mode: player  # keep\n  site_title: X\n")
        (item,) = ms.find_exclude_lists(vault)
        item.apply(None)
        text = config.read_text(encoding="utf-8")
        self.assertIn("  # who reads\n  mode: player  # keep\n  site_title: X\n", text)
        self.assertTrue(text.endswith("---\nBody\n"))
        self.assertIn("GM Notes", text)
        self.assertIn("secrets", text)
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual(config.read_text(encoding="utf-8"), text)

    def test_a_vault_with_its_own_lists_is_not_changed(self):
        vault, config = self.vault_with(
            "  exclude_sections: [Rumours]\n  exclude_fields: [mine]\n")
        before = config.read_text(encoding="utf-8")
        self.assertEqual(ms.find_exclude_lists(vault), [])
        self.assertEqual(config.read_text(encoding="utf-8"), before)


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class MigrateEndToEndTests(unittest.TestCase):
    def test_legacy_site_migrates_and_frontmatter_stays_clean(self):
        vault = tmp(self, "mig-e2e-vault-")
        site = tmp(self, "mig-e2e-site-")
        (vault / "_meta").mkdir()
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ncanon_status: AUTHORITATIVE\n---\n\n# Overview\n", encoding="utf-8")
        (vault / "_meta" / "vault-config.md").write_text(
            f'---\ntype: meta\ngm_apprentice_version: "1.10.23"\npublish:\n  mode: player\n  site_dir: {site}\n---\n',
            encoding="utf-8")
        (site / "vault.config.json").write_text(json.dumps({
            "siteTitle": "Legacy", "vaultPath": str(vault),
            "outputDir": "./docs", "excludeDirs": ["_meta"],
            "backend": {"inbox": True}}), encoding="utf-8")
        out = io.StringIO()
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)), \
                contextlib.redirect_stdout(out):
            self.assertEqual(migrate.main([str(vault), "apply"]), 0)
            self.assertIn("settings-move\tWrote _meta/vault-config.yaml.",
                          out.getvalue())
            text = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
            self.assertIn("title: Legacy", text)
            self.assertFalse((vault / "_meta" / "vault-config.md").exists())
            self.assertNotIn("siteTitle", (site / "vault.config.json").read_text())
            again = io.StringIO()
            with contextlib.redirect_stdout(again):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
        self.assertIn("already at", again.getvalue())
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_check.py"), str(vault),
             "frontmatter"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("# count: 0", proc.stdout)

    def vault_at(self, version, site_file, lists=False):
        vault = tmp(self, "mig-e2e-vault-")
        (vault / "_meta").mkdir()
        site_dir = ""
        if site_file is not None:
            site = tmp(self, "mig-e2e-site-")
            site_file.setdefault("vaultPath", str(vault))
            (site / "vault.config.json").write_text(json.dumps(site_file),
                                                    encoding="utf-8")
            site_dir = f"  site_dir: {site}\n"
        (vault / "_meta" / "vault-config.md").write_text(
            f'---\ntype: meta\ngm_apprentice_version: "{version}"\n'
            f"publish:\n  mode: player\n{site_dir}"
            + ("  exclude_sections: [GM Notes]\n  exclude_fields: [secrets]\n"
               if lists else "") + "---\n", encoding="utf-8")
        return vault

    def test_settings_left_after_1_10_24_are_still_moved(self):
        vault = self.vault_at("1.10.24", {"siteTitle": "Legacy",
                                          "outputDir": "./docs"})
        plugin = ("1.10.24", "t")
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)), \
                mock.patch.object(migrate, "plugin_version",
                                  return_value=plugin):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(migrate.main([str(vault), "plan"]), 0)
            self.assertIn("settings-move\tWill write _meta/vault-config.yaml.",
                          out.getvalue())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
            self.assertEqual(ms.find_settings_move(vault), [])
        self.assertIn("title: Legacy", (vault / "_meta" / "vault-config.yaml")
                      .read_text(encoding="utf-8"))

    def test_a_vault_with_deployment_keys_only_or_no_site_still_moves_its_own_file(self):
        for site_file in ({"outputDir": "./docs"}, None):
            vault = self.vault_at("1.10.25", site_file, lists=True)
            with mock.patch.object(ms, "plugin_tool", Pin(ok=True)):
                (item,) = ms.find_settings_move(vault)
                text = "\n".join(item.lines)
                if site_file is None:
                    self.assertNotIn("Will remove the settings from", text)
                else:
                    # The site folder's outputDir is a setting of the vault
                    # now: the move carries it and takes it out of the site
                    # file, and says so.
                    self.assertIn("Will remove the settings from", text)
                    self.assertIn("outputDir", text)
                    self.assertIn("`outputDir` moves to `player_site.output`.",
                                  text)
                item.apply(None)
                self.assertEqual(ms.find_settings_move(vault), [])
            moved = (vault / "_meta" / "vault-config.yaml")
            self.assertTrue(moved.is_file())
            if site_file is not None:
                self.assertIn("output: ./docs", moved.read_text(encoding="utf-8"))
                site_json = site_of(vault) / "vault.config.json"
                self.assertEqual(
                    json.loads(site_json.read_text(encoding="utf-8")),
                    {"vaultPath": str(vault)})

    def test_a_site_file_with_no_list_moves_and_the_built_in_lists_are_written(self):
        vault = self.vault_at("1.10.25", {"outputDir": "./docs"})
        with mock.patch.object(ms, "plugin_tool", Pin(ok=True)):
            (item,) = ms.find_settings_move(vault)
            item.apply(None)
        self.assertEqual(ms.find_settings_move(vault), [])
        (lists,) = ms.find_exclude_lists(vault)
        lists.apply(None)
        text = (vault / "_meta" / "vault-config.yaml").read_text(encoding="utf-8")
        self.assertIn("sections:", text)
        self.assertIn("fields:", text)


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
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

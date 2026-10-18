"""migrate.py: the gate, plan, apply and the stamp, with made-up checks."""

import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
import migrate_site  # noqa: E402
import vault_check as vc  # noqa: E402
from vaultlib import extract_frontmatter, read_stamp  # noqa: E402
from migrate_core import (CHOICE, PERSON, WILL, Check, Item,  # noqa: E402
                          StepFailed, edit_frontmatter, write_all_or_none,
                          write_text_atomic)
from site_fixture import give_site, point_site_at  # noqa: E402

PLUGIN = "1.10.33"
REAL_PLUGIN_TOOL = migrate_site.plugin_tool


def make_vault(case, version="1.10.12", eol="\n"):
    vault = Path(tempfile.mkdtemp(prefix="mig-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    lines = ["---", "type: meta"]
    if version is not None:
        lines.append(f'gm_apprentice_version: "{version}"')
    lines += ["---", "", "# Config", ""]
    with (vault / "_meta" / "vault-config.md").open(
            "w", encoding="utf-8", newline="") as f:
        f.write(eol.join(lines))
    return vault


def stamp_of(vault):
    return read_stamp(vault)


def will(name, release=None, band=3, log=None, fail=False, pending=None,
         asks_site=False):
    """A check with one Will-do item that is pending until applied."""
    state = {"pending": True} if pending is None else pending

    def find(vault):
        if not state["pending"]:
            return []

        def apply(_value):
            if log is not None:
                log.append(name)
            if fail:
                raise StepFailed("broke")
            state["pending"] = False
            return [f"did {name}"]
        return [Item(name, WILL, [f"do {name}"], apply)]
    return Check(name, release, band, f"title of {name}", find,
                 asks_site=asks_site)


def call(args, checks):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(migrate, "plugin_version",
                           return_value=(PLUGIN, "test")), \
            mock.patch.object(migrate, "CHECKS", checks), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = migrate.main(args)
    return code, out.getvalue(), err.getvalue()


class GateTests(unittest.TestCase):
    def test_below_the_floor_is_one_line_and_exit_2(self):
        vault = make_vault(self, "1.9.14")
        code, out, err = call([str(vault), "plan"], [])
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertIn("this vault is at 1.9.14, below 1.10.12", err)

    def test_no_recorded_version_is_refused(self):
        vault = make_vault(self, None)
        code, _, err = call([str(vault), "apply"], [])
        self.assertEqual(code, 2)
        self.assertIn("no recorded version", err)

    def test_a_vault_ahead_of_the_plugin_is_refused(self):
        vault = make_vault(self, "1.11.0")
        code, _, err = call([str(vault), "plan"], [])
        self.assertEqual(code, 2)
        self.assertIn("ahead of plugin", err)

    def test_no_meta_folder_is_setup_not_migration(self):
        vault = Path(tempfile.mkdtemp(prefix="mig-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        code, _, err = call([str(vault), "plan"], [])
        self.assertEqual(code, 2)
        self.assertIn("first-time setup", err)

    def test_bad_arguments_exit_2(self):
        vault = make_vault(self)
        self.assertEqual(call([str(vault / "nope"), "plan"], [])[0], 2)
        self.assertEqual(call([str(vault), "plan", "--choose", "x"], [])[0], 2)
        self.assertEqual(call([str(vault), "sideways"], [])[0], 2)


class PlanTests(unittest.TestCase):
    def test_up_to_date(self):
        vault = make_vault(self, PLUGIN)
        code, out, _ = call([str(vault), "plan"], [will("a", "1.10.20")])
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(),
                         [f"vault {PLUGIN}, plugin {PLUGIN}", "up to date"])

    def test_bare_invocation_is_plan(self):
        vault = make_vault(self)
        log = []
        code, out, _ = call([str(vault)], [will("a", "1.10.20", log=log)])
        self.assertEqual(code, 0)
        self.assertIn("## Will do", out)
        self.assertEqual(log, [])

    def test_three_lists_in_order_and_nothing_written(self):
        vault = make_vault(self)
        before = (vault / "_meta" / "vault-config.md").read_bytes()
        checks = [
            Check("ask", "1.10.20", 3, "t", lambda v: [
                Item("fonts", CHOICE, ["self-host the fonts"], lambda x: []),
                Item("mode", CHOICE, ["set the default palette"],
                     lambda x: [], wants="dark or light"),
                Item("p", PERSON, ["Notes/A.md:4\tbroken YAML"])]),
            will("copy", None),
        ]
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), [
            f"vault 1.10.12, plugin {PLUGIN}",
            "## Will do", "# count: 2", "copy\tdo copy",
            f"stamp\tgm_apprentice_version 1.10.12 -> {PLUGIN}",
            "## Your choice", "# count: 2", "fonts\tself-host the fonts",
            "mode=<dark or light>\tset the default palette",
            "## Needs a person", "# count: 1", "Notes/A.md:4\tbroken YAML"])
        self.assertEqual((vault / "_meta" / "vault-config.md").read_bytes(),
                         before)

    def test_a_release_step_is_offered_only_below_its_release(self):
        vault = make_vault(self, "1.10.20")
        code, out, _ = call([str(vault), "plan"],
                            [will("old", "1.10.20"), will("new", "1.10.21")])
        self.assertNotIn("old\t", out)
        self.assertIn("new\tdo new", out)

    def test_every_pass_checks_run_on_a_current_vault(self):
        vault = make_vault(self, PLUGIN)
        _, out, _ = call([str(vault), "plan"], [will("copy", None)])
        self.assertIn("copy\tdo copy", out)
        self.assertNotIn("stamp\t", out)

    def test_plan_defers_site_steps_while_a_repin_waits(self):
        vault = make_vault(self)
        asked = []

        def find(v):
            asked.append("site step")
            return []
        checks = [will(migrate.REPIN, None, band=1),
                  Check("leak", None, 4, "handout sections", find,
                        asks_site=True)]
        code, out, err = call([str(vault), "plan"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertEqual(asked, [])
        self.assertIn("## Checked once the site's tool is updated\n"
                      "# count: 1\nleak\thandout sections\n", out)

    def test_a_check_that_cannot_look_is_shown_not_raised(self):
        vault = make_vault(self)

        def find(v):
            raise StepFailed("node is not on PATH")
        code, out, _ = call([str(vault), "plan"],
                            [Check("x", None, 2, "t", find)])
        self.assertEqual(code, 0)
        self.assertIn("x\tnode is not on PATH (apply stops here until this "
                      "is fixed)", out)


class VaultRenameWaitsForTheRepinTests(unittest.TestCase):
    """The wrap-up rename asks the site's tool, so it waits for the repin."""

    def vault_with_a_wrapup(self):
        vault = make_vault(self)
        note = vault / "Chapters" / "Chapter 1" / "Session 03 - Ball - Wrap-Up.md"
        note.parent.mkdir(parents=True)
        note.write_text("---\ntype: session_wrap\nsession_number: 3\n---\n",
                        encoding="utf-8")
        return vault, note

    def checks(self):
        import migrate_vault
        (wrap,) = [c for c in migrate_vault.VAULT_CHECKS
                   if c.name == "wrapup-filenames"]
        return [will(migrate.REPIN, None, band=1), wrap]

    def test_plan_lists_it_as_waiting_not_as_a_refusal(self):
        vault, _ = self.vault_with_a_wrapup()
        code, out, _ = call([str(vault), "plan"], self.checks())
        self.assertEqual(code, 0)
        self.assertIn("## Checked once the site's tool is updated\n"
                      "# count: 1\nwrapup-filenames\tWrap-Up filenames\n", out)
        self.assertNotIn("older than this", out)

    def test_apply_holds_the_stamp_when_the_choice_was_not_seen(self):
        vault, note = self.vault_with_a_wrapup()
        code, out, _ = call([str(vault), "apply"], self.checks())
        self.assertIn("run plan again", out)
        self.assertTrue(note.exists())
        self.assertNotEqual(stamp_of(vault), PLUGIN)


class ApplyTests(unittest.TestCase):
    def test_runs_in_band_then_release_order_and_stamps(self):
        vault = make_vault(self)
        log = []
        checks = [will("tool", "1.10.18", 4, log), will("files", None, 3, log),
                  will("late", "1.10.24", 2, log),
                  will("early", "1.10.16", 2, log),
                  will(migrate.REPIN, None, 1, log)]
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, [migrate.REPIN, "early", "late", "files", "tool"])
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertIn("## Did\n# count: 5\n", out)
        self.assertIn("early\tdid early", out)
        self.assertTrue(out.rstrip().endswith(f"stamped {PLUGIN}"))

    def test_second_apply_plans_nothing(self):
        vault = make_vault(self)
        checks = [will("a", "1.10.20")]
        self.assertEqual(call([str(vault), "apply"], checks)[0], 0)
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertEqual(out.splitlines()[1], "up to date")

    def test_failure_stamps_the_release_before_the_first_outstanding(self):
        vault = make_vault(self)
        log = []
        checks = [will("a", "1.10.16", 2, log), will("b", "1.10.24", 2, log),
                  will("c", "1.10.18", 4, log, fail=True),
                  will("d", "1.10.19", 4, log)]
        code, out, err = call([str(vault), "apply"], checks)
        self.assertEqual(code, 1)
        self.assertEqual(log, ["a", "b", "c"])
        self.assertIn("migrate.py: c: broke", err)
        # b (1.10.24) ran, but c (1.10.18) did not: the stamp stops at 1.10.16.
        self.assertEqual(stamp_of(vault), "1.10.16")
        self.assertIn("stamped 1.10.16", out)

    def test_stamp_never_goes_down(self):
        vault = make_vault(self, "1.10.17")
        checks = [will("c", "1.10.18", 4, fail=True)]
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 1)
        self.assertEqual(stamp_of(vault), "1.10.17")
        self.assertIn("not stamped", out)

    def test_a_failed_repin_stamps_nothing(self):
        vault = make_vault(self, "1.10.25")
        log = []
        checks = [will(migrate.REPIN, None, 1, log, fail=True),
                  will("files", None, 3, log)]
        code, _, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 1)
        self.assertEqual(log, [migrate.REPIN])
        self.assertEqual(stamp_of(vault), "1.10.25")

    def site_choice_checks(self, log, repin=True):
        """An out-of-date site (a pending repin) and a site check that
        offers one choice and logs when it looks."""
        def find(v):
            log.append("looked")
            return [Item("fonts", CHOICE, ["self-host"],
                         lambda x: log.append("fonts") or ["fonts done"])]
        return [will(migrate.REPIN, None, 1, log,
                     pending={"pending": repin}),
                Check("fonts-check", None, 4, "fonts", find, asks_site=True,
                      choices=("fonts",))]

    def test_waited_choice_the_gm_never_saw_holds_the_stamp(self):
        vault = make_vault(self)
        log = []
        checks = self.site_choice_checks(log)
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, [migrate.REPIN, "looked"])
        self.assertNotIn("not offered", out)
        self.assertEqual(stamp_of(vault), "1.10.12")
        self.assertIn("site-repin\tdid site-repin", out)
        self.assertTrue(out.rstrip().endswith(
            "the site's publish tool is updated; run plan again for the "
            "choices it now offers\nnot stamped"))
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("## Your choice\n# count: 1\nfonts\tself-host", plan)
        self.assertNotIn("Checked once", plan)
        code, out, _ = call([str(vault), "apply", "--choose", "fonts"], checks)
        self.assertEqual(code, 0)
        self.assertIn("fonts\tfonts done", out)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertTrue(out.rstrip().endswith(f"stamped {PLUGIN}"))

    def value_choice_checks(self, log, release="1.10.30"):
        """A Will-do and a release-gated value choice (`wants`), whose
        answer is a word, so leaving it alone is `leave`, never silence."""
        def find(v):
            return [Item("tone-words", CHOICE, ["tidy or leave"],
                         lambda x: log.append(f"tone-words={x}") or ["done"],
                         wants="tidy or leave", holds_stamp=True)]
        return [will("files", "1.10.20", 3, log),
                Check("tone-words", release, 3, "tone words", find,
                      choices=("tone-words=",))]

    def test_an_unanswered_value_choice_holds_the_stamp_but_not_the_rest(self):
        # #339: apply with no --choose for a value choice stamped the vault,
        # and the release gate then never offered the choice again.
        vault = make_vault(self)
        log = []
        checks = self.value_choice_checks(log)
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, ["files"])
        self.assertEqual(stamp_of(vault), "1.10.12")
        self.assertIn("files\tdid files", out)
        self.assertTrue(out.rstrip().endswith(
            "not answered: tone-words=<tidy or leave>\nnot stamped"), out)
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("## Your choice\n# count: 1\ntone-words=<tidy or "
                      "leave>\ttidy or leave", plan)
        self.assertIn("stamp\tgm_apprentice_version 1.10.12 -> " + PLUGIN
                      + " (only once tone-words is answered)", plan)
        code, out, _ = call([str(vault), "apply", "--choose",
                             "tone-words=leave"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, ["files", "tone-words=leave"])
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertTrue(out.rstrip().endswith(f"stamped {PLUGIN}"), out)

    def two_holders(self, log):
        def find_for(name):
            return lambda v: [Item(name, CHOICE, ["a or b"],
                                   lambda x: ["done"], wants="a or b",
                                   holds_stamp=True)]
        return [Check("one", "1.10.30", 3, "one", find_for("one"),
                      choices=("one=",)),
                Check("two", "1.10.31", 3, "two", find_for("two"),
                      choices=("two=",))]

    def test_the_stamp_row_names_every_choice_it_waits_for(self):
        vault = make_vault(self)
        _, plan, _ = call([str(vault), "plan"], self.two_holders([]))
        self.assertIn("-> " + PLUGIN + " (only once one, two are answered)",
                      plan)

    def test_the_stamp_row_says_so_when_a_choice_waits_for_the_repin(self):
        # The check behind the repin is not looked at yet, so its choices
        # are not known; its value choices are, from the check.
        vault = make_vault(self)
        log = []
        waiting = Check("later", "1.10.30", 4, "later", lambda v: [],
                        asks_site=True, choices=("later=",))
        checks = [will(migrate.REPIN, None, 1, log), waiting]
        _, plan, _ = call([str(vault), "plan"], checks)
        # It only knows the check has a value choice, not that it will ask.
        self.assertIn("-> " + PLUGIN + " (later may ask a choice once the "
                      "site's tool is updated)", plan)
        self.assertNotIn("is answered", plan)

    def test_the_stamp_row_keeps_known_and_possible_choices_apart(self):
        vault = make_vault(self)
        checks = [will(migrate.REPIN, None, 1, []),
                  *self.two_holders([])[:1],
                  Check("later", "1.10.30", 4, "later", lambda v: [],
                        asks_site=True, choices=("later=",))]
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("(only once one is answered; later may ask a choice "
                      "once the site's tool is updated)", plan)

    def new_layout(self, vault):
        """The vault on the new settings file, stamp in the state file."""
        version = stamp_of(vault)
        (vault / "_meta" / "vault-config.yaml").write_text(
            "vault:\n  name: T\n", encoding="utf-8")
        (vault / "_meta" / "vault-state.json").write_text(
            json.dumps({"gm_apprentice_version": version}), encoding="utf-8")
        return vault

    def held(self, vault):
        state = json.loads((vault / "_meta" / "vault-state.json").read_text())
        return state.get("update_held")

    def test_a_leave_is_remembered_while_the_stamp_is_held(self):
        # #355: `one=leave` with `two` unanswered held the stamp, and the
        # next plan asked about `one` again.
        vault = self.new_layout(make_vault(self))
        checks = self.two_holders([])
        code, out, _ = call([str(vault), "apply", "--choose", "one=leave"],
                            checks)
        self.assertEqual(code, 0)
        self.assertEqual(stamp_of(vault), "1.10.12")
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertNotIn("one=<", plan)
        self.assertIn("two=<a or b>", plan)
        self.assertIn("(only once two is answered)", plan)
        code, out, _ = call([str(vault), "apply", "--choose", "two=a"], checks)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertIsNone(self.held(vault))

    def test_a_remembered_leave_can_still_be_changed_by_naming_it(self):
        vault = self.new_layout(make_vault(self))
        log = []

        def find(v):
            return [Item("one", CHOICE, ["a or b"],
                         lambda x: log.append(x) or ["done"],
                         wants="a or b", holds_stamp=True)]
        checks = [Check("one", "1.10.30", 3, "one", find, choices=("one=",)),
                  *self.two_holders([])[1:]]
        call([str(vault), "apply", "--choose", "one=leave"], checks)
        call([str(vault), "apply", "--choose", "one=b"], checks)
        self.assertEqual(log, ["leave", "b"])

    def notice_checks(self, log):
        def find(v):
            return [Item("heads-up", PERSON, ["somewhere\tread this"],
                         notice=True)]
        return [Check("heads-up", "1.10.30", 3, "heads-up", find),
                *self.two_holders(log)[1:]]

    def test_a_notice_is_said_once_even_while_the_stamp_is_held(self):
        vault = self.new_layout(make_vault(self))
        checks = self.notice_checks([])
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("somewhere\tread this", plan)
        call([str(vault), "apply"], checks)
        self.assertEqual(stamp_of(vault), "1.10.12")
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertNotIn("read this", plan)
        self.assertIn("two=<a or b>", plan)
        call([str(vault), "apply", "--choose", "two=a"], checks)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertIsNone(self.held(vault))

    def test_a_yes_no_choice_can_be_declined_by_name(self):
        # #355: `--choose id=leave` on a choice with no value ran it.
        vault = make_vault(self)
        log = []

        def find(v):
            return [Item("fonts", CHOICE, ["self-host"],
                         lambda x: log.append(x) or ["done"])]
        checks = [Check("fonts", "1.10.30", 3, "fonts", find,
                        choices=("fonts",))]
        code, out, _ = call([str(vault), "apply", "--choose", "fonts=leave"],
                            checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, [])
        self.assertIn("fonts\tleft as it is", out)
        self.assertEqual(stamp_of(vault), PLUGIN)

    def yes_no_checks(self, log):
        def find(v):
            return [Item("fonts", CHOICE, ["self-host"],
                         lambda x: log.append(x) or ["done"])]
        return [Check("fonts", "1.10.30", 3, "fonts", find,
                      choices=("fonts",)),
                *self.two_holders([])[1:]]

    def test_a_yes_no_choice_refuses_any_value_but_leave(self):
        # Review B L1: `fonts=no` ran the change.
        vault = make_vault(self)
        log = []
        for raw in ("fonts=no", "fonts=yes", "fonts="):
            code, out, err = call([str(vault), "apply", "--choose", raw],
                                  self.yes_no_checks(log))
            self.assertEqual(code, 2, raw)
            self.assertIn("fonts=leave", err)
            self.assertEqual(out, "")
        self.assertEqual(log, [])
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_yes_no_leave_is_remembered_while_the_stamp_is_held(self):
        # Review B L2: it was asked again on every pass.
        vault = self.new_layout(make_vault(self))
        log = []
        checks = self.yes_no_checks(log)
        call([str(vault), "apply", "--choose", "fonts=leave"], checks)
        self.assertEqual(stamp_of(vault), "1.10.12")
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertNotIn("fonts\t", plan)
        self.assertIn("two=<a or b>", plan)
        call([str(vault), "apply", "--choose", "fonts"], checks)
        self.assertEqual(log, [None])   # naming it alone still runs it

    def test_a_leave_that_failed_is_not_remembered(self):
        # Review B L3: the leave was recorded before it was applied.
        vault = self.new_layout(make_vault(self))

        def boom(x):
            raise StepFailed("could not")

        def find(v):
            return [Item("one", CHOICE, ["a or b"], boom, wants="a or b",
                         holds_stamp=True)]
        checks = [Check("one", "1.10.30", 3, "one", find, choices=("one=",)),
                  *self.two_holders([])[1:]]
        code, _, _ = call([str(vault), "apply", "--choose", "one=leave"],
                          checks)
        self.assertNotIn("one", (self.held(vault) or {}).get("left", []))
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("one=<a or b>", plan)

    def test_a_person_row_that_is_not_a_notice_comes_back_every_time(self):
        vault = self.new_layout(make_vault(self))

        def find(v):
            return [Item("fix-me", PERSON, ["N.md:3\tbroken"])]
        checks = [Check("fix-me", "1.10.30", 3, "fix-me", find),
                  *self.two_holders([])[1:]]
        call([str(vault), "apply"], checks)
        _, plan, _ = call([str(vault), "plan"], checks)
        self.assertIn("N.md:3\tbroken", plan)

    def test_waited_choice_already_named_is_taken_and_stamped(self):
        vault = make_vault(self)
        log = []
        checks = self.site_choice_checks(log)
        code, out, _ = call([str(vault), "apply", "--choose", "fonts"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, [migrate.REPIN, "looked", "fonts"])
        self.assertIn("fonts\tfonts done", out)
        self.assertNotIn("run plan again", out)
        self.assertEqual(stamp_of(vault), PLUGIN)

    def test_waited_will_do_and_person_rows_run_in_the_same_apply(self):
        vault = make_vault(self)
        log = []
        waited_will = will("leak", None, 4, log, asks_site=True)

        def person(v):
            return [Item("review", PERSON, ["N.md:3\tlook at this"])]
        checks = [will(migrate.REPIN, None, 1, log), waited_will,
                  Check("review", None, 4, "review", person, asks_site=True)]
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, [migrate.REPIN, "leak"])
        self.assertIn("leak\tdid leak", out)
        self.assertIn("N.md:3\tlook at this", out)
        self.assertNotIn("run plan again", out)
        self.assertEqual(stamp_of(vault), PLUGIN)

    def test_a_pending_repin_with_no_site_check_stamps_in_one_run(self):
        vault = make_vault(self)
        log = []
        code, out, _ = call([str(vault), "apply"],
                            [will(migrate.REPIN, None, 1, log)])
        self.assertEqual(code, 0)
        self.assertEqual(log, [migrate.REPIN])
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertNotIn("run plan again", out)

    def test_apply_with_a_current_site_stamps_in_one_run(self):
        vault = make_vault(self)
        log = []
        checks = self.site_choice_checks(log, repin=False)
        code, out, _ = call([str(vault), "apply", "--choose", "fonts"], checks)
        self.assertEqual(code, 0)
        self.assertEqual(log, ["looked", "fonts"])
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertNotIn("run plan again", out)

    def choice_checks(self, log):
        def find(v):
            return [
                Item("fonts", CHOICE, ["self-host"],
                     lambda x: log.append(("fonts", x)) or ["fonts done"]),
                Item("mode", CHOICE, ["palette"],
                     lambda x: log.append(("mode", x)) or [f"mode {x}"],
                     wants="dark or light"),
                Item("p", PERSON, ["A.md:1\tlook at this"])]
        return [Check("ask", "1.10.20", 2, "t", find,
                      choices=("fonts", "mode=", "template:"))]

    def test_choices_taken_and_declined(self):
        vault = make_vault(self)
        log = []
        code, out, _ = call([str(vault), "apply", "--choose", "mode=dark"],
                            self.choice_checks(log))
        self.assertEqual(code, 0)
        self.assertEqual(log, [("mode", "dark")])
        self.assertIn("mode\tmode dark", out)
        self.assertIn("## Needs a person\n# count: 1\n# 1 row already shown in the plan\n",
                      out)
        self.assertEqual(stamp_of(vault), PLUGIN)

    def test_wrapup_choice_and_person_row_share_an_id_end_to_end(self):
        import migrate_vault as mv
        vault = make_vault(self)
        for rel, fm in (("Chapters/Chapter 2/Old.md", "session_number: 3\n"),
                        ("Session_09_Wrap_Up.md", "session_number: 9\n")):
            path = vault / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"---\ntype: session_wrap\n{fm}---\n",
                            encoding="utf-8")
        (vault / "Index.md").write_text("[[Old]]\n", encoding="utf-8")
        checks = [c for c in mv.VAULT_CHECKS if c.name == "wrapup-filenames"]
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertEqual(code, 0)
        self.assertIn("Chapter_02_Session_03_Wrap_Up.md", out)
        self.assertIn("Session_09_Wrap_Up.md\t", out)
        code, out, _ = call([str(vault), "apply", "--choose",
                             "wrapup-filenames"], checks)
        self.assertEqual(code, 0, out)
        self.assertTrue((vault / "Chapters/Chapter 2/"
                         "Chapter_02_Session_03_Wrap_Up.md").is_file())
        self.assertEqual((vault / "Index.md").read_text(encoding="utf-8"),
                         "[[Chapter_02_Session_03_Wrap_Up]]\n")
        self.assertTrue((vault / "Session_09_Wrap_Up.md").is_file())

    def test_unknown_choice_exits_2_and_writes_nothing(self):
        vault = make_vault(self)
        log = []
        checks = [will("a", "1.10.20", log=log), *self.choice_checks(log)]
        code, _, err = call([str(vault), "apply", "--choose", "nope"], checks)
        self.assertEqual(code, 2)
        self.assertIn("--choose nope", err)
        self.assertEqual(log, [])
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_choice_that_needs_a_value_and_has_none_is_refused_up_front(self):
        vault = make_vault(self)
        log = []
        checks = [will("a", "1.10.20", log=log), *self.choice_checks(log)]
        for raw in ("mode", "mode="):
            code, out, err = call([str(vault), "apply", "--choose", raw],
                                  checks)
            self.assertEqual(code, 2)
            self.assertIn("mode=<value>", err)
            self.assertEqual(out, "")
        self.assertEqual(log, [])
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_prefixed_value_choice_needs_its_value(self):
        vault = make_vault(self)
        checks = [Check("x", None, 2, "t", lambda v: [],
                        choices=("sheet-source:=",))]
        self.assertEqual(
            call([str(vault), "apply", "--choose", "sheet-source:a"],
                 checks)[0], 2)
        self.assertEqual(
            call([str(vault), "apply", "--choose", "sheet-source:a=b"],
                 checks)[0], 0)

    def test_a_release_above_the_plugin_is_not_offered(self):
        vault = make_vault(self)
        log = []
        code, out, _ = call([str(vault), "apply"],
                            [will("future", "99.0.0", log=log)])
        self.assertEqual(code, 0)
        self.assertEqual(log, [])

    def test_an_unwritable_config_fails_cleanly(self):
        vault = make_vault(self)
        cfg = vault / "_meta" / "vault-config.md"
        cfg.chmod(0o444)
        vault.joinpath("_meta").chmod(0o555)
        self.addCleanup(vault.joinpath("_meta").chmod, 0o755)
        code, out, err = call([str(vault), "apply"],
                              [will("a", "1.10.20")])
        self.assertEqual(code, 1)
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertNotIn("Traceback", err)
        self.assertIn("## Did", out)
        self.assertEqual(stamp_of(vault), "1.10.12")


    def test_a_prefixed_choice_the_vault_does_not_have_is_said(self):
        vault = make_vault(self)
        code, out, _ = call(
            [str(vault), "apply", "--choose", "template:npc.md"],
            self.choice_checks([]))
        self.assertEqual(code, 0)
        self.assertIn("not offered: template:npc.md", out)

    def test_stamp_keeps_crlf(self):
        vault = make_vault(self, eol="\r\n")
        self.assertEqual(call([str(vault), "apply"], [])[0], 0)
        raw = (vault / "_meta" / "vault-config.md").read_bytes()
        self.assertIn(f'gm_apprentice_version: "{PLUGIN}"\r\n'.encode(), raw)
        self.assertNotIn(b"\n\n", raw.replace(b"\r\n", b""))
        self.assertEqual(raw.count(b"\r\n"), raw.count(b"\n"))


class ShortOutputTests(unittest.TestCase):
    def person_check(self, name, rows, asks_site=False, release="1.10.20"):
        return Check(name, release, 3 if not asks_site else 4, "t",
                     lambda v: [Item(name, PERSON, rows)], asks_site=asks_site)

    def test_rows_of_one_check_with_one_message_print_it_once(self):
        vault = make_vault(self)
        rows = ["A.md\told name; rename it", "B.md\told name; rename it",
                "C.md:4\tsomething else"]
        _, out, _ = call([str(vault), "plan"],
                         [self.person_check("names", rows)])
        self.assertIn("## Needs a person\n# count: 3\n"
                      "names (2): old name; rename it\n  A.md\n  B.md\n"
                      "C.md:4\tsomething else\n", out)

    def test_differing_messages_stay_one_per_line(self):
        vault = make_vault(self)
        rows = ["A.md\tone", "B.md\ttwo"]
        _, out, _ = call([str(vault), "plan"],
                         [self.person_check("names", rows)])
        self.assertIn("A.md\tone\nB.md\ttwo\n", out)
        self.assertNotIn("names (", out)

    def test_the_same_message_from_two_checks_is_not_merged(self):
        vault = make_vault(self)
        _, out, _ = call([str(vault), "plan"], [
            self.person_check("x", ["A.md\tsame"]),
            self.person_check("y", ["B.md\tsame"])])
        self.assertIn("A.md\tsame\nB.md\tsame\n", out)

    def test_apply_counts_the_plans_rows_and_prints_only_new_ones(self):
        vault = make_vault(self)
        checks = [will(migrate.REPIN, None, 1),
                  self.person_check("old", ["A.md\tseen", "B.md\tseen"]),
                  self.person_check("later", ["C.md\tnew", "D.md\tnew"],
                                    asks_site=True)]
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0)
        self.assertIn("## Needs a person\n# count: 4\n"
                      "# 2 rows already shown in the plan\n"
                      "later (2): new\n  C.md\n  D.md\n", out)
        self.assertNotIn("A.md", out)

    def test_apply_with_no_repin_prints_no_person_rows(self):
        vault = make_vault(self)
        checks = [self.person_check("old", ["A.md\tseen", "B.md\tseen"])]
        _, out, _ = call([str(vault), "apply"], checks)
        self.assertIn("# count: 2\n# 2 rows already shown in the plan\n"
                      "stamped", out)


class ApplyGuardTests(unittest.TestCase):
    def test_a_frontmatter_the_stamp_cannot_edit_stops_before_anything_runs(self):
        vault = make_vault(self)
        path = vault / "_meta" / "vault-config.md"
        path.write_text('---\ntype: meta\ngm_apprentice_version: "1.10.12"\n'
                        'description: >\n  folded text\n---\n',
                        encoding="utf-8")
        before = path.read_bytes()
        log = []
        code, out, err = call([str(vault), "apply"],
                              [will("files", None, 3, log)])
        self.assertEqual(code, 1)
        self.assertEqual(log, [])
        self.assertEqual(path.read_bytes(), before)
        self.assertIn("vault-config.md", err)
        self.assertIn("nothing was changed", err)

    def test_a_current_vault_with_an_uneditable_config_still_applies(self):
        vault = make_vault(self, PLUGIN)
        path = vault / "_meta" / "vault-config.md"
        path.write_text(f'---\ngm_apprentice_version: "{PLUGIN}"\n'
                        'description: >\n  folded text\n---\n',
                        encoding="utf-8")
        code, out, err = call([str(vault), "apply"], [will("copy", None)])
        self.assertEqual(code, 0, err)
        self.assertIn("copy\tdid copy", out)

    def test_a_byte_order_mark_is_read_and_kept(self):
        vault = make_vault(self)
        path = vault / "_meta" / "vault-config.md"
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        code, out, _ = call([str(vault), "plan"], [])
        self.assertEqual(code, 0)
        self.assertIn("vault 1.10.12", out)
        self.assertEqual(call([str(vault), "apply"], [])[0], 0)
        raw = path.read_bytes()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf---"))
        self.assertEqual(stamp_of(vault).lstrip("\ufeff"), PLUGIN)


class WrapupSectionsEngineTests(unittest.TestCase):
    def test_choice_stamp_then_key_removal_end_to_end(self):
        import migrate_vault as mv
        vault = make_vault(self, "1.10.27")
        cfg = vault / "_meta" / "vault-config.md"
        cfg.write_text(
            '---\ngm_apprentice_version: "1.10.27"\npublish:\n'
            '  wrap_up:\n    player_sections: [What the Party Learned]\n'
            '---\n', encoding="utf-8")
        note = vault / "Sessions" / "Chapter_01_Session_01_Wrap_Up.md"
        note.parent.mkdir()
        note.write_text(
            '---\ntype: session_wrap\nsession_number: 1\n---\n\n'
            '# W\n\n## Narrative Recap\n\nr\n\n'
            '## What the Party Learned\n\na\n\n## Secret\n\nb\n\n'
            '<!-- gm-only -->\n\n## GM Notes\n\n### S\n\n- x\n\n'
            '<!-- /gm-only -->\n', encoding="utf-8")
        checks = [c for c in mv.VAULT_CHECKS
                  if c.name in ("wrapup-sections", "wrapup-sections-key")]
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertEqual(code, 0)
        self.assertIn("wrapup-sections=<move or leave>", out)
        self.assertNotIn("wrapup-sections-key\tremove", out)
        code, out, _ = call([str(vault), "apply", "--choose",
                             "wrapup-sections=move"], checks)
        self.assertEqual(code, 0, out)
        text = note.read_text(encoding="utf-8")
        self.assertIn("### Secret", text)
        self.assertIn("\n## What the Party Learned\n", text)
        self.assertEqual(stamp_of(vault), PLUGIN)
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertEqual(code, 0)
        self.assertIn("wrapup-sections-key\tremove", out)
        code, out, _ = call([str(vault), "apply"], checks)
        self.assertEqual(code, 0, out)
        self.assertNotIn("player_sections", cfg.read_text(encoding="utf-8"))
        code, out, _ = call([str(vault), "plan"], checks)
        self.assertIn("up to date", out)


class ToneListEngineTests(unittest.TestCase):
    def test_a_plain_apply_refreshes_the_list_with_no_choice(self):
        import migrate_vault as mv
        vault = make_vault(self, "1.10.43")
        path = vault / "_meta" / "relationship-types.md"
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write("**tone** \u2208 friendly | romantic | respectful | "
                    "professional | hostile |\r\nfearful | neutral. "
                    "**strength** 1\u201310.\r\n")
        checks = [c for c in mv.VAULT_CHECKS if c.name == "tone-list"]
        with mock.patch.object(migrate, "plugin_version",
                               return_value=("1.10.44", "test")):
            out = io.StringIO()
            with mock.patch.object(migrate, "CHECKS", checks), \
                    contextlib.redirect_stdout(out):
                self.assertEqual(migrate.main([str(vault), "plan"]), 0)
                self.assertEqual(migrate.main([str(vault), "apply"]), 0)
                self.assertEqual(migrate.main([str(vault), "plan"]), 0)
        shown = out.getvalue()
        self.assertIn("## Will do", shown)
        self.assertNotIn("## Your choice", shown)
        self.assertIn("tone-list\t_meta/relationship-types.md: the tone list "
                      "is now the 27 listed words", shown)
        self.assertTrue(shown.rstrip().endswith("up to date"))
        self.assertEqual(stamp_of(vault), "1.10.44")
        with path.open("r", encoding="utf-8", newline="") as f:
            self.assertEqual(
                f.read(), "**tone** \u2208 "
                + " | ".join(mv.tone_families())
                + ". **strength** 1\u201310.\r\n")


class EditFrontmatterTests(unittest.TestCase):
    def test_failure_leaves_the_note_and_no_temp_file(self):
        vault = make_vault(self)
        cfg = vault / "_meta" / "vault-config.md"
        before = cfg.read_bytes()
        with mock.patch("migrate_core.os.replace",
                        side_effect=OSError("boom")):
            with self.assertRaises(StepFailed):
                edit_frontmatter(cfg, lambda fm, eol: fm.append("a: b" + eol))
        self.assertEqual(cfg.read_bytes(), before)
        self.assertEqual([p.name for p in cfg.parent.iterdir()],
                         ["vault-config.md"])

    def test_symlink_and_mode_survive(self):
        vault = make_vault(self)
        real = vault / "real.md"
        (vault / "_meta" / "vault-config.md").replace(real)
        link = vault / "_meta" / "vault-config.md"
        link.symlink_to(real)
        real.chmod(0o640)
        edit_frontmatter(link, lambda fm, eol: fm.append("a: b" + eol))
        self.assertTrue(link.is_symlink())
        self.assertIn("a: b", real.read_text())
        self.assertEqual(real.stat().st_mode & 0o777, 0o640)


class WriteTextAtomicTests(unittest.TestCase):
    def test_writes_a_new_file_and_makes_its_folder(self):
        vault = make_vault(self)
        path = vault / "_Templates" / "a.md"
        write_text_atomic(path, "one\r\ntwo\n")
        self.assertEqual(path.read_bytes(), b"one\r\ntwo\n")
        self.assertEqual([p.name for p in path.parent.iterdir()], ["a.md"])

    def test_failure_leaves_the_file_and_no_temp_file(self):
        vault = make_vault(self)
        path = vault / "_meta" / "vault-config.md"
        before = path.read_bytes()
        with mock.patch("migrate_core.os.replace",
                        side_effect=OSError("boom")):
            with self.assertRaises(StepFailed):
                write_text_atomic(path, "x")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([p.name for p in path.parent.iterdir()],
                         ["vault-config.md"])


def map_folder(vault, folder, key):
    """Add `folder: key` to the vault's `publish.folder_map`, so the
    publish tool takes notes from that folder."""
    file = vault / "_meta" / "vault-config.md"
    lines = file.read_text(encoding="utf-8").split("\n")
    at = lines.index("publish:")
    lines[at + 1:at + 1] = ["  folder_map:", f"    {folder}: {key}"]
    file.write_text("\n".join(lines), encoding="utf-8")


@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class RealToolTests(unittest.TestCase):
    def run_real(self, vault, *args):
        out, err = io.StringIO(), io.StringIO()
        def tool(args):   # the site is current and the plugin's; the rest is real
            if args[0] == "update-pin":
                return 0, '{"ok": true, "ours": true, "spec": "file:/p"}', ""
            return REAL_PLUGIN_TOOL(args)

        with mock.patch.object(migrate, "plugin_version",
                               return_value=(PLUGIN, "test")), \
                mock.patch.object(migrate_site, "plugin_tool", tool), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = migrate.main([str(vault), *args])
        return code, out.getvalue(), err.getvalue()

    def test_plan_apply_plan_on_a_vault_with_a_site(self):
        vault = make_vault(self, "1.10.12")
        (vault / "Documents").mkdir()
        (vault / "Documents" / "Letter.md").write_text(
            '---\nname: "Letter"\ntype: document\ncanon_status: AUTHORITATIVE\n'
            "---\n\n## The Text\n\nDear sir.\n\n## Context\n\nThe forger is "
            "Vane.\n", encoding="utf-8")
        # Apply moves the site's settings into the vault: a site of its own.
        give_site(vault, lambda p: None, private=True)
        point_site_at(vault)
        map_folder(vault, "Documents", "documents")
        code, plan, err = self.run_real(vault, "plan")
        self.assertEqual(code, 0, err)
        self.assertIn("## Will do", plan)
        self.assertIn("template:_Template_NPC.md\t", plan)
        self.assertIn("gm-leak\tDocuments/Letter.md: re-nest 'Context'", plan)
        code, did, err = self.run_real(vault, "apply")
        self.assertEqual(code, 0, err + did)
        self.assertEqual(stamp_of(vault), "1.10.12")   # default-mode unanswered
        self.assertIn("not answered: default-mode=<dark, light or leave>", did)
        code, did, err = self.run_real(vault, "apply", "--choose",
                                       "default-mode=leave")
        self.assertEqual(code, 0, err + did)
        self.assertEqual(stamp_of(vault), PLUGIN)
        text = (vault / "Documents" / "Letter.md").read_text(encoding="utf-8")
        self.assertLess(text.index("## GM Notes"), text.index("Context"))
        code, again, _ = self.run_real(vault, "plan")
        self.assertEqual(again.splitlines()[1], "up to date", again)

    def test_a_multi_line_footer_moves_and_the_vault_still_stamps(self):
        vault = make_vault(self, "1.10.12")
        # Apply moves the site's settings into the vault: a site of its own.
        give_site(vault, lambda p: None, private=True)
        text = (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")
        site = Path(re.search(r"^\s*site_dir:\s*(.+)$", text, re.M)
                    .group(1).strip().strip("\"'"))
        footer = 'Line one\n"quoted" \\ slash\nlast line'
        config = json.loads((site / "vault.config.json").read_text(
            encoding="utf-8"))
        config["footer"] = footer
        (site / "vault.config.json").write_text(json.dumps(config),
                                                encoding="utf-8")
        point_site_at(vault, site)
        code, did, err = self.run_real(vault, "apply", "--choose",
                                       "default-mode=leave")
        self.assertEqual(code, 0, err + did)
        self.assertIn("settings-move\tWrote _meta/vault-config.yaml.", did)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertEqual(vc.settings(vault).get("player_site.footer"), footer)
        self.assertFalse((vault / "_meta" / "vault-config.md").exists())
        self.assertEqual(self.run_real(vault, "plan")[1].splitlines()[1],
                         "up to date")
        self.assertEqual(self.run_real(vault, "apply")[0], 0)

    def test_a_vault_with_no_site_migrates_without_a_site_step(self):
        vault = make_vault(self, "1.10.12")
        code, did, err = self.run_real(vault, "apply")
        self.assertEqual(code, 0, err)
        self.assertNotIn("site-repin", did)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertEqual(self.run_real(vault, "plan")[1].splitlines()[1],
                         "up to date")


class WriteAllOrNoneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        for name in ("a.md", "b.md"):
            (self.vault / name).write_text(f"old {name}\n", encoding="utf-8",
                                           newline="")
        self.originals = {"a.md": "old a.md\n", "b.md": "old b.md\n"}
        self.texts = {"a.md": "new a\n", "b.md": "new b\n"}

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def read(vault, rel):
        return (vault / rel).read_text(encoding="utf-8")

    def test_writes_every_note(self):
        write_all_or_none(self.vault, self.originals, self.texts,
                          read=self.read)
        self.assertEqual(self.read(self.vault, "a.md"), "new a\n")
        self.assertEqual(self.read(self.vault, "b.md"), "new b\n")

    def test_a_note_changed_meanwhile_stops_it_and_nothing_is_written(self):
        (self.vault / "b.md").write_text("someone else\n", encoding="utf-8")
        with self.assertRaises(StepFailed) as raised:
            write_all_or_none(self.vault, self.originals, self.texts,
                              read=self.read, what="the tidy")
        self.assertIn("b.md changed while the tidy was being made",
                      str(raised.exception))
        self.assertIn("the vault is as it was", str(raised.exception))
        self.assertEqual(self.read(self.vault, "a.md"), "old a.md\n")

    def test_a_write_that_fails_on_the_second_note_puts_the_first_back(self):
        done = []

        def write(path, text):
            if path.name == "b.md" and text == "new b\n":
                raise StepFailed("b.md cannot be written (PermissionError)")
            done.append((path.name, text))
            path.write_text(text, encoding="utf-8", newline="")

        with self.assertRaises(StepFailed) as raised:
            write_all_or_none(self.vault, self.originals, self.texts,
                              read=self.read, write=write)
        self.assertEqual(str(raised.exception),
                         "b.md cannot be written (PermissionError); "
                         "the vault is as it was")
        self.assertEqual(done, [("a.md", "new a\n"), ("a.md", "old a.md\n")])
        self.assertEqual(self.read(self.vault, "a.md"), "old a.md\n")
        self.assertEqual(self.read(self.vault, "b.md"), "old b.md\n")


if __name__ == "__main__":
    unittest.main()

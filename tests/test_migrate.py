"""migrate.py: the gate, plan, apply and the stamp, with made-up checks."""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
from migrate_core import (CHOICE, PERSON, WILL, Check, Item,  # noqa: E402
                          StepFailed)

PLUGIN = "1.10.30"


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
    text = (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("gm_apprentice_version:"):
            return line.split(":", 1)[1].strip().strip('"')
    return None


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
                      choices=("fonts", "mode", "template:"))]

    def test_choices_taken_and_declined(self):
        vault = make_vault(self)
        log = []
        code, out, _ = call([str(vault), "apply", "--choose", "mode=dark"],
                            self.choice_checks(log))
        self.assertEqual(code, 0)
        self.assertEqual(log, [("mode", "dark")])
        self.assertIn("mode\tmode dark", out)
        self.assertIn("## Needs a person\n# count: 1\nA.md:1\tlook at this",
                      out)
        self.assertEqual(stamp_of(vault), PLUGIN)

    def test_unknown_choice_exits_2_and_writes_nothing(self):
        vault = make_vault(self)
        log = []
        checks = [will("a", "1.10.20", log=log), *self.choice_checks(log)]
        code, _, err = call([str(vault), "apply", "--choose", "nope"], checks)
        self.assertEqual(code, 2)
        self.assertIn("--choose nope", err)
        self.assertEqual(log, [])
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_choice_that_needs_a_value_and_has_none_fails(self):
        vault = make_vault(self)
        code, _, err = call([str(vault), "apply", "--choose", "mode"],
                            self.choice_checks([]))
        self.assertEqual(code, 1)
        self.assertIn("mode=<dark or light>", err)

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


if __name__ == "__main__":
    unittest.main()

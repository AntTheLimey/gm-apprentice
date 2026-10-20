"""1.10.63: the update offers to retire the site build steps the publish tool
now does itself (optimize-images, add-tohit-calc, add-theme-toggle,
apply-overrides), one choice per step the vault has. Against the real tool."""

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
from migrate_core import CHOICE, StepFailed  # noqa: E402
from test_migrate_move import NEEDS_NODE, moved_vault_with_site  # noqa: E402
from vaultlib import read_stamp, settings, write_stamp  # noqa: E402

STEPS = "player_site.after_build"
OPTIMIZE = "player_site.images.optimize"
FOUR = ["apply-overrides", "add-tohit-calc", "add-theme-toggle", "optimize-images"]
DEAD_END = ["node scripts/apply-overrides.mjs", "node scripts/add-star-map.mjs",
            "node scripts/add-props.mjs", "node scripts/add-tohit-calc.mjs",
            "node scripts/add-theme-toggle.mjs", "node scripts/optimize-images.mjs"]


def vault_with_steps(case, steps):
    root = Path(tempfile.mkdtemp(prefix="mig-retire-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault, site = root / "Vault", root / "site"
    (vault / "_meta").mkdir(parents=True)
    site.mkdir()
    listed = "".join(f"    - {s}\n" for s in steps)
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nplayer_site:\n  folder: {site.as_posix()}\n"
        f"  after_build:\n{listed}", encoding="utf-8")
    return vault


def steps_of(vault):
    return settings(vault).get(STEPS)


@NEEDS_NODE
class RetireStepsTests(unittest.TestCase):
    def test_one_choice_per_step_the_vault_has_in_its_order(self):
        items = ms.find_retire_steps(vault_with_steps(self, DEAD_END))
        self.assertEqual([i.id for i in items], [f"retire-step:{n}" for n in FOUR])
        for item in items:
            self.assertEqual((item.group, item.wants, item.holds_stamp),
                             (CHOICE, "retire or leave", True))
            self.assertEqual(len(item.lines), 1)
        text = {i.id.split(":")[1]: i.lines[0] for i in items}
        self.assertIn("node scripts/optimize-images.mjs", text["optimize-images"])
        self.assertIn("turns on player_site.images.optimize first",
                      text["optimize-images"])
        self.assertIn("the site comes out the same", text["optimize-images"])
        self.assertIn("to-hit calculator", text["add-tohit-calc"])
        self.assertIn("second button goes", text["add-theme-toggle"])
        self.assertIn("css/overrides.css", text["apply-overrides"])
        for line in text.values():
            self.assertIn("leave: keep the step", line)

    def test_add_crew_stories_is_offered_and_the_text_names_the_new_heading(self):
        vault = vault_with_steps(self, [
            "node scripts/add-star-map.mjs", "node scripts/add-crew-stories.mjs",
            "node scripts/add-temporary-alert.mjs"])
        (item,) = ms.find_retire_steps(vault)
        self.assertEqual(item.id, "retire-step:add-crew-stories")
        self.assertIn("1.46.0", item.lines[0])
        self.assertIn('"Crew" to "NPC stories"', item.lines[0])
        item.apply("retire")
        self.assertEqual(steps_of(vault), ["node scripts/add-star-map.mjs",
                                           "node scripts/add-temporary-alert.mjs"])

    def test_path_spellings_the_step_runner_accepts_are_recognised(self):
        vault = vault_with_steps(self, [
            "node ./scripts/add-theme-toggle.mjs", "node scripts\\add-tohit-calc.mjs",
            'node "scripts/apply-overrides.mjs"', "node  scripts/optimize-images.mjs "])
        self.assertEqual([i.id for i in ms.find_retire_steps(vault)],
                         ["retire-step:add-theme-toggle", "retire-step:add-tohit-calc",
                          "retire-step:apply-overrides", "retire-step:optimize-images"])

    def test_other_steps_and_other_commands_are_not_offered(self):
        vault = vault_with_steps(self, [
            "node scripts/add-props.mjs", "node scripts/optimize-images.mjs --fast",
            "node scripts/my-optimize-images.mjs", "npm run optimize-images"])
        self.assertEqual(ms.find_retire_steps(vault), [])

    def test_no_steps_offers_nothing(self):
        self.assertEqual(ms.find_retire_steps(vault_with_steps(self, [])), [])

    def test_retire_removes_only_that_step(self):
        vault = vault_with_steps(self, DEAD_END)
        item = next(i for i in ms.find_retire_steps(vault)
                    if i.id == "retire-step:add-theme-toggle")
        lines = item.apply("retire")
        self.assertEqual(steps_of(vault), [s for s in DEAD_END if "theme-toggle" not in s])
        self.assertEqual(len(lines), 1)
        self.assertIn("removed", lines[0])

    def test_optimize_images_turns_the_setting_on_first(self):
        vault = vault_with_steps(self, DEAD_END)
        item = next(i for i in ms.find_retire_steps(vault)
                    if i.id == "retire-step:optimize-images")
        lines = item.apply("retire")
        self.assertTrue(settings(vault).get(OPTIMIZE))
        self.assertNotIn("node scripts/optimize-images.mjs", steps_of(vault))
        self.assertIn(OPTIMIZE, lines[0])
        self.assertIn("removed", lines[1])

    def test_optimize_images_is_never_removed_without_the_setting(self):
        vault = vault_with_steps(self, DEAD_END)
        item = next(i for i in ms.find_retire_steps(vault)
                    if i.id == "retire-step:optimize-images")
        with mock.patch.object(ms, "_set_settings", side_effect=StepFailed("refused")):
            with self.assertRaises(StepFailed):
                item.apply("retire")
        self.assertIn("node scripts/optimize-images.mjs", steps_of(vault))
        self.assertFalse(settings(vault).get(OPTIMIZE))

    def test_retire_removes_every_spelling_of_the_step(self):
        vault = vault_with_steps(self, ["node scripts/add-theme-toggle.mjs",
                                        "node scripts/add-props.mjs",
                                        "node ./scripts/add-theme-toggle.mjs"])
        items = ms.find_retire_steps(vault)
        self.assertEqual([i.id for i in items], ["retire-step:add-theme-toggle"])
        items[0].apply("retire")
        self.assertEqual(steps_of(vault), ["node scripts/add-props.mjs"])

    def test_optimize_images_setting_goes_back_when_the_step_cannot_be_removed(self):
        vault = vault_with_steps(self, DEAD_END)
        item = next(i for i in ms.find_retire_steps(vault)
                    if i.id == "retire-step:optimize-images")
        with mock.patch.object(ms, "settings_remove", return_value=[]):
            with self.assertRaises(StepFailed):
                item.apply("retire")
        self.assertIn("node scripts/optimize-images.mjs", steps_of(vault))
        self.assertFalse(settings(vault).get(OPTIMIZE))
        self.assertNotEqual(settings(vault).origins.get(OPTIMIZE), "file")

    def test_leave_keeps_the_step(self):
        vault = vault_with_steps(self, DEAD_END)
        for item in ms.find_retire_steps(vault):
            self.assertEqual(len(item.apply("leave")), 1)
        self.assertEqual(steps_of(vault), DEAD_END)
        self.assertFalse(settings(vault).get(OPTIMIZE))

    def test_any_other_answer_stops(self):
        item = ms.find_retire_steps(vault_with_steps(self, DEAD_END))[0]
        with self.assertRaises(StepFailed):
            item.apply("yes please")



@NEEDS_NODE
class RetireStepsUpdateTests(unittest.TestCase):
    """Through the update itself: the stamp waits for the answers, and a second pass asks nothing."""

    def update(self, vault, *args):
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(migrate, "plugin_version", return_value=("1.10.63", "test")), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = migrate.main([str(vault), *args])
        return code, out.getvalue(), err.getvalue()

    def vault(self):
        vault, _site = moved_vault_with_site(self)
        file = vault / "_meta" / "vault-config.yaml"
        file.write_text(file.read_text(encoding="utf-8") + "  after_build:\n"
                        + "".join(f"    - {s}\n" for s in DEAD_END), encoding="utf-8")
        write_stamp(vault, "1.10.62")
        return vault

    def choose(self, value):
        args = ["apply"]
        for n in FOUR:
            args += ["--choose", f"retire-step:{n}={value}"]
        return args

    def test_the_plan_lists_the_four_and_the_stamp_waits_for_them(self):
        vault = self.vault()
        code, plan, err = self.update(vault, "plan")
        self.assertEqual(code, 0, err)
        for n in FOUR:
            self.assertIn(f"retire-step:{n}=<retire or leave>\t", plan)
        self.assertIn("only once retire-step:", plan)
        code, did, err = self.update(vault, "apply")
        self.assertEqual(read_stamp(vault), "1.10.62", did + err)

    def test_retire_all_then_a_second_pass_asks_nothing(self):
        vault = self.vault()
        code, did, err = self.update(vault, *self.choose("retire"))
        self.assertEqual(code, 0, err + did)
        self.assertEqual(steps_of(vault), ["node scripts/add-star-map.mjs",
                                           "node scripts/add-props.mjs"])
        self.assertTrue(settings(vault).get(OPTIMIZE))
        self.assertEqual(read_stamp(vault), "1.10.63")
        self.assertIn("up to date", self.update(vault, "plan")[1])

    def test_leave_all_then_a_second_pass_asks_nothing(self):
        vault = self.vault()
        code, did, err = self.update(vault, *self.choose("leave"))
        self.assertEqual(code, 0, err + did)
        self.assertEqual(steps_of(vault), DEAD_END)
        self.assertEqual(read_stamp(vault), "1.10.63")
        self.assertIn("up to date", self.update(vault, "plan")[1])


if __name__ == "__main__":
    unittest.main()

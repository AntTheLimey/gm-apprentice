"""The update moves the publish list (the `publish-list` check), end to end
against the real publish tool: a notes-only vault, a site whose tool is too
old, a site whose build step reads the old file, a list the tool cannot move,
and a vault a stopped move left with both files."""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_site as ms  # noqa: E402
import site_fixture  # noqa: E402
import vault_check as vc  # noqa: E402
from test_migrate_move import (NEEDS_NODE, PLUGIN, hashes, make_vault,  # noqa: E402
                               update, with_site)
from vaultlib import read_stamp  # noqa: E402

OLD_NAME = "publish-manifest.md"
OLD_LIST = ("---\ngenerated: 2026-10-13\n---\n\n## Publishing (1 files)\n\n"
            "- [x] NPCs/Vex.md\n\n## Excluded (1 files)\n\n"
            "- [x] Sessions/Next.md — prep\n\n"
            "## Needs Decision (1 files)\n\n- [ ] Drafts/Idea.md\n")
# A site pinned to the plugin's own tool and already at the version that reads
# the list.
PLUGINS_OWN = f"file:{site_fixture.TOOL_DIR.as_posix()}"
CHOOSE = ("apply", "--choose", "default-mode=leave")


def put_old_list(vault, text=OLD_LIST):
    (vault / "_meta" / OLD_NAME).write_text(text, encoding="utf-8")


def listed(vault):
    """The list as the tool reads it: Python reads no YAML."""
    proc = subprocess.run(
        ["node", str(vc.PUBLISH_TOOL), "manifest", "list", "--json",
         "--vault", str(vault)], capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def has_old(vault):
    return (vault / "_meta" / OLD_NAME).exists()


def has_new(vault):
    return (vault / "_meta" / "publish-list.yaml").exists()


@NEEDS_NODE
class PublishListMoveTests(unittest.TestCase):
    def test_a_vault_moves_in_one_pass_and_a_second_pass_finds_nothing(self):
        vault = make_vault(self)
        put_old_list(vault)
        code, plan, err = update(vault, "plan")
        self.assertEqual(code, 0, err)
        self.assertIn("publish-list\tWould move the publish list to "
                      "_meta/publish-list.yaml: 1 publishing, 1 excluded, "
                      "1 needing a decision.", plan)
        self.assertTrue(has_old(vault) and not has_new(vault))  # a plan writes nothing
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        self.assertTrue(has_new(vault) and not has_old(vault), did)
        kept = vault / "_meta" / (OLD_NAME + ".converted")
        self.assertEqual(kept.read_text(encoding="utf-8"), OLD_LIST)
        self.assertEqual(read_stamp(vault), PLUGIN)
        data = listed(vault)
        self.assertEqual(data["publishing"], ["NPCs/Vex.md"])
        self.assertEqual(data["excluded"],
                         [{"path": "Sessions/Next.md", "reason": "prep"}])
        self.assertEqual(data["needs_decision"], ["Drafts/Idea.md"])
        before = hashes(vault)
        code, plan, _ = update(vault, "plan")
        self.assertEqual(plan.splitlines()[1], "up to date", plan)
        self.assertEqual(hashes(vault), before)

    def test_a_vault_with_no_old_list_has_nothing_to_move(self):
        vault = make_vault(self)
        self.assertEqual(ms.find_publish_list(vault), [])

    def test_a_site_tool_older_than_1_27_0_keeps_the_old_list_and_says_why(self):
        vault = make_vault(self)
        put_old_list(vault)
        with_site(self, vault, spec="^1.26.0", installed="1.26.0")
        line = ("publish list\tstays in _meta/publish-manifest.md until the "
                "site's publish tool is 1.27.0 or later")
        code, plan, err = update(vault, "plan")
        self.assertIn(line, plan)
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        self.assertTrue(has_old(vault) and not has_new(vault))
        self.assertEqual(read_stamp(vault), PLUGIN)   # told, not held
        before = hashes(vault.parent)
        self.assertIn(line, update(vault, "plan")[1])   # told every pass
        self.assertEqual(hashes(vault.parent), before)

    def test_a_site_step_that_reads_the_old_file_keeps_it_and_names_the_script(self):
        vault = make_vault(self)
        put_old_list(vault)
        site = with_site(self, vault, spec=PLUGINS_OWN, installed="1.27.0")
        (site / "scripts").mkdir()
        (site / "scripts" / "add-props.mjs").write_text(
            "const list = read('../vault/_meta/publish-manifest.md');\n",
            encoding="utf-8")
        pkg = site / "package.json"
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data.setdefault("scripts", {})["postbuild"] = "node scripts/add-props.mjs"
        pkg.write_text(json.dumps(data), encoding="utf-8")
        code, plan, err = update(vault, "plan")
        self.assertIn("publish list\tstays in _meta/publish-manifest.md: your "
                      "build step scripts/add-props.mjs reads it. Change the "
                      "script to ask `gm-apprentice-publish manifest list "
                      "--json`, then run the update again.", plan)
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        self.assertTrue(has_old(vault) and not has_new(vault))
        self.assertEqual(read_stamp(vault), PLUGIN)
        # The step is in the vault's settings now; the second pass still sees it.
        self.assertIn("scripts/add-props.mjs reads it", update(vault, "plan")[1])

    def test_after_the_script_is_fixed_the_next_pass_moves_the_list(self):
        vault = make_vault(self)
        put_old_list(vault)
        site = with_site(self, vault, spec=PLUGINS_OWN, installed="1.27.0")
        (site / "scripts").mkdir()
        script = site / "scripts" / "add-props.mjs"
        script.write_text(
            "const list = read('../vault/_meta/publish-manifest.md');\n",
            encoding="utf-8")
        pkg = site / "package.json"
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data.setdefault("scripts", {})["postbuild"] = "node scripts/add-props.mjs"
        pkg.write_text(json.dumps(data), encoding="utf-8")
        update(vault, *CHOOSE)
        self.assertTrue(has_old(vault) and not has_new(vault))
        script.write_text(
            "const list = JSON.parse(run('gm-apprentice-publish manifest "
            "list --json'));\n", encoding="utf-8")
        code, did, err = update(vault, "apply")
        self.assertEqual(code, 0, err + did)
        self.assertTrue(has_new(vault) and not has_old(vault), did)
        self.assertEqual(listed(vault)["publishing"], ["NPCs/Vex.md"])
        self.assertEqual(read_stamp(vault), PLUGIN)

    def _refusing(self):
        real = ms.plugin_tool

        def tool(args):
            if args[:2] == ["manifest", "convert"]:
                return 1, json.dumps({
                    "ok": False, "converted": False, "held": False,
                    "lines": [], "sets": None,
                    "blockers": ["NPCs/Vex.md: expected under publishing, "
                                 "not there"]}), ""
            return real(args)
        return mock.patch.object(ms, "plugin_tool", tool)

    def test_a_list_the_tool_cannot_move_holds_the_stamp_and_changes_nothing(self):
        vault = make_vault(self)
        put_old_list(vault)
        before = (vault / "_meta" / OLD_NAME).read_bytes()
        with self._refusing():
            code, plan, _ = update(vault, "plan")
            self.assertIn("publish list\tthe publish list cannot move to its "
                          "new file yet: NPCs/Vex.md: expected under "
                          "publishing, not there", plan)
            code, did, err = update(vault, *CHOOSE)
        self.assertIn("not settled: publish-list", did)
        self.assertEqual(read_stamp(vault), "1.10.12")
        self.assertEqual((vault / "_meta" / OLD_NAME).read_bytes(), before)
        self.assertFalse(has_new(vault))

    def test_a_stop_between_the_new_file_and_the_old_removal_is_finished(self):
        vault = make_vault(self)
        put_old_list(vault)
        # Both files, the new one equal to the old: what a stopped move leaves.
        subprocess.run(
            ["node", "-e",
             "const {convertPublishList}=require(process.argv[1]);"
             "try{convertPublishList(process.argv[2],{deps:{moveOld:()=>"
             "{throw new Error('stop')}}})}catch(e){}",
             str(site_fixture.TOOL_DIR / "lib" / "publish-list-convert.js"),
             str(vault)], check=True)
        self.assertTrue(has_old(vault) and has_new(vault))
        code, did, err = update(vault, *CHOOSE)
        self.assertEqual(code, 0, err + did)
        self.assertTrue(has_new(vault) and not has_old(vault), did)
        self.assertEqual(listed(vault)["publishing"], ["NPCs/Vex.md"])

    def test_two_files_that_disagree_keep_both_and_hold_the_stamp(self):
        vault = make_vault(self)
        put_old_list(vault)
        (vault / "_meta" / "publish-list.yaml").write_text(
            "publishing:\n  - NPCs/Someone Else.md\nexcluded: []\n"
            "needs_decision: []\n", encoding="utf-8")
        old = (vault / "_meta" / OLD_NAME).read_bytes()
        new = (vault / "_meta" / "publish-list.yaml").read_bytes()
        code, did, err = update(vault, *CHOOSE)
        self.assertIn("not settled: publish-list", did)
        self.assertEqual(read_stamp(vault), "1.10.12")
        self.assertEqual((vault / "_meta" / OLD_NAME).read_bytes(), old)
        self.assertEqual((vault / "_meta" / "publish-list.yaml").read_bytes(), new)

    def test_no_apply_ever_leaves_a_vault_with_neither_file(self):
        vault = make_vault(self)
        put_old_list(vault)

        def tool_fails_on_the_real_run(args):
            if args[:2] == ["manifest", "convert"] and "--check" not in args:
                raise ms.StepFailed("the tool died")
            return real(args)
        real = ms.plugin_tool
        with mock.patch.object(ms, "plugin_tool", tool_fails_on_the_real_run):
            update(vault, *CHOOSE)
        self.assertTrue(has_old(vault) or has_new(vault))
        self.assertTrue(has_old(vault) and not has_new(vault))


if __name__ == "__main__":
    unittest.main()

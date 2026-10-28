"""The update's `publish-hidden` check (#500), against the real publish tool:
a vault converted before publish tool 1.48.2 may still publish a page whose
line in the old list was hidden by `%%` or `<!-- -->`. The old text is kept
as `_meta/publish-manifest.md.converted`; the tool (`manifest hidden`) names
each such path the list still publishes, and the GM chooses to move them to
needs_decision or leave them. Python reads no list: the tool decides."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_core  # noqa: E402
import migrate_site as ms  # noqa: E402
import vault_check as vc  # noqa: E402
from test_migrate_move import NEEDS_NODE  # noqa: E402

CONVERTED = """---
type: meta
---

## Publishing (5 files)

- [x] NPCs/Mara.md
%%
- [x] NPCs/Secret One.md
%%
<!--
- [x] NPCs/Secret Two.md — the twist
-->
- [x] Locations/Harbour.md
%%
- [x] NPCs/Again.md
%%
- [x] NPCs/Again.md

## Excluded (0 files)

## Needs Decision (0 files)
"""

# What a convert before 1.48.2 wrote: the hidden lines published. The GM's own
# comment, added since, must survive the move.
LIST = """# kept by hand since the move
publishing:
  - Locations/Harbour.md
  - NPCs/Again.md
  - NPCs/Mara.md
  - NPCs/Secret One.md
  - path: NPCs/Secret Two.md
    reason: the twist
excluded: []
needs_decision: []
"""


def make(tmp: Path, converted: str | None = CONVERTED, listed: str = LIST) -> Path:
    vault = tmp / "vault"
    (vault / "_meta").mkdir(parents=True)
    if converted is not None:
        (vault / "_meta" / "publish-manifest.md.converted").write_text(converted, encoding="utf-8")
    (vault / "_meta" / "publish-list.yaml").write_text(listed, encoding="utf-8")
    return vault


def lists(vault: Path) -> dict:
    """The list as the tool reads it."""
    proc = subprocess.run(
        ["node", str(vc.PUBLISH_TOOL), "manifest", "list", "--json", "--vault", str(vault)],
        capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


@NEEDS_NODE
class PublishHiddenTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_both_hidden_entries_are_offered_by_name_and_move_on_the_gms_answer(self):
        vault = make(self.tmp)
        (item,) = ms.find_publish_hidden(vault)
        self.assertEqual((item.id, item.group, item.wants, item.holds_stamp),
                         ("publish-hidden", ms.CHOICE, "move or leave", True))
        named = [ln.split("\t")[0] for ln in item.lines[1:]]
        self.assertEqual(named, ["NPCs/Secret One.md", "NPCs/Secret Two.md"])
        self.assertIn("2 pages", item.lines[0])
        # Finding them writes nothing.
        self.assertEqual((vault / "_meta" / "publish-list.yaml").read_text(encoding="utf-8"), LIST)
        done = item.apply("move")
        self.assertEqual(done, ["NPCs/Secret One.md: moved to needs_decision",
                                "NPCs/Secret Two.md: moved to needs_decision"])
        data = lists(vault)
        self.assertEqual(data["publishing"], ["Locations/Harbour.md", "NPCs/Again.md", "NPCs/Mara.md"])
        self.assertEqual(data["needs_decision"], ["NPCs/Secret One.md", "NPCs/Secret Two.md"])
        text = (vault / "_meta" / "publish-list.yaml").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# kept by hand since the move\n"), text)
        self.assertIn("reason: the twist", text)
        # Once moved, nothing is offered.
        self.assertEqual(ms.find_publish_hidden(vault), [])

    def test_a_page_also_under_excluded_leaves_publishing_and_is_named(self):
        listed = LIST.replace("excluded: []\n", "excluded:\n  - NPCs/Secret Two.md\n")
        vault = make(self.tmp, listed=listed)
        (item,) = ms.find_publish_hidden(vault)
        self.assertEqual(item.apply("move"), [
            "NPCs/Secret One.md: moved to needs_decision",
            "NPCs/Secret Two.md: off publishing; it stays under excluded, as the list already had it"])
        data = lists(vault)
        self.assertEqual(data["needs_decision"], ["NPCs/Secret One.md"])
        self.assertEqual([e["path"] for e in data["excluded"]], ["NPCs/Secret Two.md"])
        self.assertNotIn("NPCs/Secret Two.md", data["publishing"])

    def test_the_item_speaks_plainly_and_its_rows_split_on_a_tab(self):
        vault = make(self.tmp)
        (item,) = ms.find_publish_hidden(vault)
        self.assertNotIn("1.48.2", item.lines[0])
        self.assertIn("missed the comments that hid", item.lines[0])
        self.assertEqual(item.lines[1].split("\t"), ["NPCs/Secret One.md", "published; hidden by a comment in the old list"])
        src = (SCRIPTS / "migrate_site.py").read_text(encoding="utf-8")
        body = src[src.index("def find_publish_hidden"):src.index("FULL_MODE = ")]
        self.assertNotIn("\t", body, "a literal tab in the item's text")

    def test_leave_changes_nothing(self):
        vault = make(self.tmp)
        (item,) = ms.find_publish_hidden(vault)
        self.assertEqual(item.apply("leave"), ["left the 2 pages published"])
        self.assertEqual((vault / "_meta" / "publish-list.yaml").read_text(encoding="utf-8"), LIST)
        with self.assertRaises(migrate_core.StepFailed):
            item.apply("maybe")

    def test_a_vault_without_the_converted_file_is_offered_nothing(self):
        self.assertEqual(ms.find_publish_hidden(make(self.tmp, converted=None)), [])

    def test_a_vault_whose_hidden_entries_no_longer_publish_is_offered_nothing(self):
        vault = make(self.tmp, listed="publishing:\n  - NPCs/Mara.md\n  - NPCs/Again.md\n")
        self.assertEqual(ms.find_publish_hidden(vault), [])

    def test_the_update_offers_it_and_moves_the_pages_on_the_gms_choice(self):
        import contextlib
        import io
        from unittest import mock
        import migrate
        vault = make(self.tmp)
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ntype: meta\ngm_apprentice_version: "1.10.106"\npublish:\n  mode: player\n---\n', encoding="utf-8")

        def update(*args):
            out, err = io.StringIO(), io.StringIO()
            with mock.patch.object(migrate, "plugin_version", return_value=("1.10.107", "test")), \
                    contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = migrate.main([str(vault), *args])
            return code, out.getvalue(), err.getvalue()

        code, plan, err = update("plan")
        self.assertEqual(code, 0, err)
        self.assertIn("publish-hidden", plan)
        self.assertIn("NPCs/Secret One.md", plan)
        self.assertIn("NPCs/Secret Two.md", plan)
        code, did, err = update("apply", "--choose", "publish-hidden=move")
        self.assertEqual(code, 0, err + did)
        self.assertEqual(lists(vault)["needs_decision"], ["NPCs/Secret One.md", "NPCs/Secret Two.md"])

    def test_the_check_is_registered_for_this_release(self):
        check = next(c for c in ms.SITE_CHECKS if c.name == "publish-hidden")
        self.assertEqual((check.release, check.band, check.asks_site, check.choices),
                         ("1.10.107", 2, False, ("publish-hidden=",)))


if __name__ == "__main__":
    unittest.main()

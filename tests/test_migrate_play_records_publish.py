"""1.12.39 update step `play-records-publish` (#692): on a vault with no
publish list, a Play Notes or Export note without a `publish:` key gets
`publish: false`, so the player site keeps the raw table record off. A
vault with a list is left alone. The list question is the real publish
tool's answer (the vault has no site, so the plugin's tool is asked)."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
from migrate_core import PERSON, WILL  # noqa: E402
from vault_check import ToolAnswer  # noqa: E402

PLAY = ('---\ntype: session-play-notes\nsession: "[[Session 03]]"\n---\n\n'
        '# Session 03 Play Notes\n\nThe bridge fell.\n')
EXPORT = '---\ntype: session_export\nsession: "[[Session 03]]"\n---\n\nRaw log.\n'
MARKED = PLAY.replace("type: session-play-notes\n",
                      "type: session-play-notes\npublish: false\n")
LISTED_ON = PLAY.replace("type: session-play-notes\n",
                         "type: session-play-notes\npublish: true\n")
WRAP = '---\ntype: session-wrap-up\n---\n\n# Wrap-Up\n'
TEMPLATE = "---\ntype: session-play-notes\n---\n"
NESTED = PLAY.replace('session: "[[Session 03]]"\n',
                      'session: "[[Session 03]]"\nsite:\n  publish: true\n')

node_missing = shutil.which("node") is None


def make_vault(case, notes):
    vault = Path(tempfile.mkdtemp(prefix="mig-playpub-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n",
                                                       encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def raw(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


@unittest.skipIf(node_missing, "the publish tool needs node")
class RealToolTests(unittest.TestCase):
    def test_no_list_marks_unmarked_play_records(self):
        v = make_vault(self, {
            "Sessions/Session 03 - Play Notes.md": PLAY,
            "Sessions/Session 03 - Export.md": EXPORT,
            "Sessions/Session 02 - Play Notes.md": MARKED,
            "Sessions/Session 01 - Play Notes.md": LISTED_ON,
            "Sessions/Session 03 - Wrap-Up.md": WRAP,
            "Sessions/Session 04 - Play Notes.md": NESTED,
            "_Templates/_Template_Play_Notes.md": TEMPLATE})
        (item,) = mv.find_play_records_publish(v)
        self.assertEqual((item.id, item.group), ("play-records-publish", WILL))
        self.assertEqual(len(item.lines), 3, item.lines)
        item.apply(None)
        self.assertEqual(raw(v, "Sessions/Session 03 - Play Notes.md"),
                         PLAY.replace('---\n\n#', 'publish: false\n---\n\n#'))
        self.assertIn("publish: false\n---\n",
                      raw(v, "Sessions/Session 03 - Export.md"))
        # A nested `publish:` is not the note's own answer.
        self.assertIn("  publish: true\npublish: false\n---\n",
                      raw(v, "Sessions/Session 04 - Play Notes.md"))
        for rel, text in (("Sessions/Session 02 - Play Notes.md", MARKED),
                          ("Sessions/Session 01 - Play Notes.md", LISTED_ON),
                          ("Sessions/Session 03 - Wrap-Up.md", WRAP),
                          ("_Templates/_Template_Play_Notes.md", TEMPLATE)):
            self.assertEqual(raw(v, rel), text, rel)
        self.assertEqual(mv.find_play_records_publish(v), [])

    def test_a_vault_with_a_publish_list_is_left_alone(self):
        rel = "Sessions/Session 03 - Play Notes.md"
        v = make_vault(self, {rel: PLAY, "_meta/publish-list.yaml":
                              f"publishing:\n  - {rel}\nexcluded: []\n"
                              f"needs_decision: []\n"})
        self.assertEqual(mv.find_play_records_publish(v), [])
        self.assertEqual(raw(v, rel), PLAY)


class FindTests(unittest.TestCase):
    def test_nothing_to_mark_never_asks_the_tool(self):
        v = make_vault(self, {"Sessions/S2.md": MARKED, "Sessions/W.md": WRAP})
        with mock.patch.object(mv, "publish_list_sets") as ask:
            self.assertEqual(mv.find_play_records_publish(v), [])
        ask.assert_not_called()

    def test_tool_unanswered_holds_the_stamp(self):
        v = make_vault(self, {"Sessions/S3.md": PLAY})
        with mock.patch.object(mv, "publish_list_sets",
                               return_value=(None, ToolAnswer(
                                   why="node is not on PATH"))):
            (item,) = mv.find_play_records_publish(v)
        self.assertEqual((item.id, item.group, item.holds_stamp),
                         ("play-records-publish-wait", PERSON, True))
        self.assertIn("node is not on PATH", item.lines[0])
        self.assertEqual(raw(v, "Sessions/S3.md"), PLAY)

    def test_a_quoted_publish_key_counts(self):
        for key in ('"publish"', "'publish'"):
            v = make_vault(self, {"Sessions/S3.md": PLAY.replace(
                "---\n\n#", f"{key}: true\n---\n\n#")})
            with mock.patch.object(mv, "publish_list_sets") as ask:
                self.assertEqual(mv.find_play_records_publish(v), [], key)
            ask.assert_not_called()

    def test_a_tool_answer_of_the_wrong_shape_is_not_no_list(self):
        # Through the real parser: a successful `[]` must not read as "no list".
        import vault_check
        v = make_vault(self, {"Sessions/S3.md": PLAY})
        with mock.patch.object(vault_check, "ask_publish_tool",
                               return_value=ToolAnswer(data=[])):
            (item,) = mv.find_play_records_publish(v)
        self.assertEqual(item.id, "play-records-publish-wait")
        self.assertIn("expected JSON", item.lines[0])
        self.assertEqual(raw(v, "Sessions/S3.md"), PLAY)

    def test_crlf_kept(self):
        v = make_vault(self, {"Sessions/S3.md": PLAY.replace("\n", "\r\n")})
        with mock.patch.object(mv, "publish_list_sets",
                               return_value=(None, ToolAnswer())):
            (item,) = mv.find_play_records_publish(v)
        item.apply(None)
        self.assertIn("publish: false\r\n---\r\n", raw(v, "Sessions/S3.md"))

    def test_the_check_is_registered(self):
        (check,) = [c for c in mv.VAULT_CHECKS
                    if c.name == "play-records-publish"]
        self.assertEqual((check.release, check.band, check.kind,
                          check.asks_site),
                         ("1.12.39", 4, "bookkeeping", True))


if __name__ == "__main__":
    unittest.main()

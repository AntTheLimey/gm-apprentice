#!/usr/bin/env python3
"""moments.py: a wrap-up's Memorable Moments read as the Story page reads
them, the `#moment/<kind>` tag written at a moment's end, and the one
back-fill offer recorded (#557, #567)."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import moments  # noqa: E402
import vaultlib as vl  # noqa: E402

NODE = shutil.which("node") is not None

ON = "version: 1\nvault:\n  system: coc-7e\nplayer_site:\n  publish: true\n"
OFF = ON + "  story:\n    moments: false\n"
NO_SITE = "version: 1\nvault:\n  system: coc-7e\n"

S1 = "Sessions/Session 01 - Wrap-Up.md"
S2 = "Sessions/Session 02 - Wrap-Up.md"
S3 = "Sessions/Session 03 - Wrap-Up.md"
FM = "---\ntype: session-wrap-up\ntitle: {t}\n---\n"
WRAP1 = (FM.format(t="One") + "\n## Narrative Recap\n\nThey went.\n\n"
         "## Memorable Moments\n\n**Six crawled through the sewer.**\n\n"
         "*Nobody planned it.*\n\n> \"Mission incomplete.\"\n> — Six\n\n"
         "**Mara laughed.** #moment/sad\n\n<!-- gm-only -->\n\n## GM Notes\n\n"
         "**Hidden.**\n\n<!-- /gm-only -->\n")
WRAP2 = (FM.format(t="Two") + "\n## Narrative Recap\n\nNothing.\n\n"
         "<!-- gm-only -->\n\n## GM Notes\n\nx\n\n<!-- /gm-only -->\n")
WRAP3 = (FM.format(t="Three") + "\n## Memorable Moments\n\n**Done.**\n"
         "*All tagged.* #moment/epic\n")


def make_vault(case, config=ON, files=None):
    vault = Path(tempfile.mkdtemp(prefix="moments-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    case.addCleanup(vl.forget_settings)
    for rel, text in {"_meta/vault-config.yaml": config,
                      "_meta/vault-state.json": '{\n  "gm_apprentice_version": "1.10.129"\n}\n',
                      S1: WRAP1, S2: WRAP2, S3: WRAP3,
                      **(files or {})}.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, *argv, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = moments.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


@unittest.skipUnless(NODE, "needs node: the publish tool reads the cards")
class StatusTests(unittest.TestCase):
    def test_on_lists_the_tools_kinds_and_what_a_back_fill_would_cover(self):
        code, out = run(make_vault(self), "status")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines(), [
            "moments\ton",
            "kinds\tdramatic, intriguing, funny, epic, tragic",
            "backfill\tnot offered: 1 wrap-up without moments, 1 with "
            "untagged ones (moments.py list)"])

    def test_off_by_the_setting_or_with_no_site_says_off_and_nothing_more(self):
        for config in (OFF, NO_SITE):
            code, out = run(make_vault(self, config), "status")
            self.assertEqual(code, 0, out)
            self.assertEqual(out.splitlines()[0], "moments\toff")
            self.assertNotIn("backfill", out)

    def test_offered_is_recorded_once_and_status_says_so(self):
        vault = make_vault(self)
        code, out = run(vault, "offered")
        self.assertEqual(code, 0, out)
        self.assertTrue(out.startswith("ADDED\t_meta/vault-state.json"))
        state = json.loads((vault / "_meta/vault-state.json").read_text())
        self.assertEqual(state["gm_apprentice_version"], "1.10.129")
        day = state["moments_backfill_offered"]
        _c, out = run(vault, "offered")
        self.assertTrue(out.startswith("SKIP"), out)
        _c, out = run(vault, "status")
        self.assertIn(f"backfill\toffered {day}", out)

    def test_list_names_the_wrap_ups_with_something_to_do(self):
        code, out = run(make_vault(self), "list")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines(), [
            "# 1 wrap-up without moments, 1 with untagged ones",
            f"{S1}\t3 moments\t3 untagged",
            f"{S2}\tno moments"])


@unittest.skipUnless(NODE, "needs node: the publish tool reads the cards")
class ShowAndTagTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self)

    def text(self, rel=S1):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_show_numbers_the_cards_with_their_text_and_kind(self):
        code, out = run(self.vault, "show", S1)
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines(), [
            f"# {S1} §Memorable Moments: 3 moments, 3 untagged",
            "1\t-\t**Six crawled through the sewer.** / *Nobody planned it.*",
            "2\t-\t> \"Mission incomplete.\" / > — Six",
            "3\t-\t**Mara laughed.** #moment/sad"])
        _c, out = run(self.vault, "show", S2)
        self.assertEqual(out.strip(), f"# {S2}: no Memorable Moments section")

    def test_tag_dry_run_writes_nothing_then_write_puts_each_tag_at_the_end(self):
        before = self.text()
        rows = "1\tfunny\n2\tDramatic\n3\tfunny\n"
        code, out = run(self.vault, "tag", S1, stdin=rows)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.text(), before)
        self.assertIn("WOULD-ADD", out)
        code, out = run(self.vault, "tag", S1, "--write", stdin=rows)
        self.assertEqual(code, 0, out)
        self.assertIn("# create: 0  add: 3", out)
        after = self.text()
        self.assertIn("*Nobody planned it.* #moment/funny\n", after)
        self.assertIn("> — Six #moment/dramatic\n", after)
        # The word that is no kind is replaced, not left beside the tag.
        self.assertIn("**Mara laughed.** #moment/funny\n", after)
        self.assertNotIn("sad", after)
        self.assertEqual(after.replace(" #moment/funny", "").replace(
            " #moment/dramatic", ""), before.replace(" #moment/sad", ""))
        _c, out = run(self.vault, "show", S1)
        self.assertIn("3 moments, 0 untagged", out)
        _c, out = run(self.vault, "tag", S1, "--write", stdin="1\tfunny\n")
        self.assertIn("SKIP", out)

    def test_crlf_note_keeps_its_line_ends(self):
        crlf = make_vault(self, files={S1: WRAP1.replace("\n", "\r\n")})
        code, out = run(crlf, "tag", S1, "--write", stdin="1\tepic\n")
        self.assertEqual(code, 0, out)
        text = (crlf / S1).read_bytes().decode("utf-8")
        self.assertIn("*Nobody planned it.* #moment/epic\r\n", text)
        self.assertNotIn("\n", text.replace("\r\n", ""))

    def test_refusals_write_nothing(self):
        before = self.text()
        for rows, why in (("1\tsad\n", "is not a kind"),
                          ("9\tepic\n", "has no moment 9"),
                          ("1 epic\n", "not a row"),
                          ("1\tepic\n1\tfunny\n", "two kinds"),
                          ("", "nothing on stdin")):
            code, out = run(self.vault, "tag", S1, "--write", stdin=rows)
            self.assertEqual(code, 1, out)
            self.assertIn(why, out)
        code, out = run(self.vault, "tag", S2, "--write", stdin="1\tepic\n")
        self.assertEqual(code, 1, out)
        self.assertIn("no Memorable Moments section", out)
        self.assertEqual(self.text(), before)

    def test_check_names_untagged_cards_and_fails_on_a_word_that_is_no_kind(self):
        code, out = run(self.vault, "check", S1)
        self.assertEqual(code, 1, out)
        self.assertEqual(out.splitlines(), [
            "UNTAGGED\t1\t**Six crawled through the sewer.** / *Nobody planned it.*",
            "UNTAGGED\t2\t> \"Mission incomplete.\" / > \u2014 Six",
            "UNTAGGED\t3\t**Mara laughed.** #moment/sad",
            "UNKNOWN\t#moment/sad\tnot a kind (dramatic, intriguing, funny, epic, tragic)",
            "# 3 moments: 3 untagged, 1 unknown kind"])
        run(self.vault, "tag", S1, "--write", stdin="1\tfunny\n3\tepic\n")
        code, out = run(self.vault, "check", S1)
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines()[-1], "# 3 moments: 1 untagged, 0 unknown kinds")
        code, out = run(self.vault, "check", S3)
        self.assertEqual((code, out.strip()), (0, "# 1 moment: 0 untagged, 0 unknown kinds"))
        code, out = run(self.vault, "check", S2)
        self.assertEqual((code, out.strip()), (0, f"# {S2}: no Memorable Moments section"))


S4 = "Sessions/Session 04 - Wrap-Up.md"
S5 = "Sessions/Session 05 - Wrap-Up.md"
WRAP4 = (FM.format(t="Four") + "\n## Memorable Moments\n\n### The Docks\n\n"
         "| who | what |\n|---|---|\n| Mal | ran |\n\n**Beat.** #moment/funny\n\n"
         "*Ctx.*\n\n#moment/funny\n\n**Two.** #moment/sad %%note%%\n\n"
         "**Three.**\n\n#moment/sad\n")
WRAP5 = (FM.format(t="Five") + "\n## Narrative Recap\n\nx\n\n<!-- gm-only -->\n\n"
         "## Memorable Moments\n\n**Kept back.**\n\n## GM Notes\n\ny\n\n"
         "<!-- /gm-only -->\n")


@unittest.skipUnless(NODE, "needs node: the publish tool reads the cards")
class FixRoundTwoTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, files={S4: WRAP4, S5: WRAP5})

    def text(self, rel=S4):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_headings_and_tables_are_never_listed_or_tagged(self):
        _c, out = run(self.vault, "check", S4)
        self.assertNotIn("The Docks", out)
        self.assertNotIn("| who", out)
        code, out = run(self.vault, "tag", S4, "--write", stdin="1\tepic\n")
        self.assertEqual(code, 1, out)
        self.assertIn("a heading or a table", out)
        self.assertIn("### The Docks\n", self.text())

    def test_a_section_hidden_from_players_is_said_hidden_and_never_offered(self):
        _c, out = run(self.vault, "list")
        self.assertNotIn(S5, out)
        _c, out = run(self.vault, "show", S5)
        self.assertIn("hidden from players", out)
        code, out = run(self.vault, "check", S5)
        self.assertEqual(code, 0, out)
        self.assertIn("hidden from players", out)
        code, out = run(self.vault, "tag", S5, stdin="1\tepic\n")
        self.assertEqual(code, 1, out)
        self.assertIn("hidden from players", out)

    def test_retagging_says_what_it_replaces_and_takes_out_the_lone_tag(self):
        code, out = run(self.vault, "tag", S4, "--write", stdin="3\tepic\n")
        self.assertEqual(code, 0, out)
        self.assertIn("#moment/epic (replaces #moment/funny)", out)
        text = self.text()
        self.assertIn("**Beat.**\n\n*Ctx.* #moment/epic\n\n**Two.**", text)
        self.assertNotIn("#moment/funny", text)

    def test_a_lone_unknown_tag_is_cleared_so_check_can_pass(self):
        code, out = run(self.vault, "tag", S4, "--write", stdin="5\ttragic\n")
        self.assertEqual(code, 0, out)
        self.assertIn("**Three.** #moment/tragic\n", self.text())
        self.assertNotIn("\n#moment/sad\n", self.text())

    def test_a_tag_that_would_change_what_a_card_shows_is_refused(self):
        before = self.text()
        code, out = run(self.vault, "tag", S4, "--write", stdin="4\tepic\n")
        self.assertEqual(code, 1, out)
        self.assertIn("tag it by hand", out)
        self.assertEqual(self.text(), before)

    def test_the_sites_own_tool_is_asked(self):
        site = Path(tempfile.mkdtemp(prefix="moments-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        tool = site / "gm-publish.js"
        with mock.patch.object(moments.vl, "vault_site",
                               return_value=(True, True, site)), \
                mock.patch.object(moments.vc, "_lines_tool",
                                  return_value=(tool, None, None, True)), \
                mock.patch.object(moments.vl, "use_publish_tool") as use:
            moments.site_tool(self.vault)
        use.assert_called_once_with(tool)
        with mock.patch.object(moments.vl, "vault_site",
                               return_value=(True, True, site)), \
                mock.patch.object(moments.vc, "_lines_tool",
                                  return_value=(None, "not installed", "fix", True)):
            with self.assertRaises(moments.Refused):
                moments.site_tool(self.vault)


if __name__ == "__main__":
    unittest.main()

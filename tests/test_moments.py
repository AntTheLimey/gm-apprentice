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
            f"{S2}\t0 moments\t0 untagged"])


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


if __name__ == "__main__":
    unittest.main()

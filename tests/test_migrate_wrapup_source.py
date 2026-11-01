"""`wrapup-source-fence` (1.10.114, #542): a wrap-up's `> [!info] Source`
callout is GM bookkeeping, so it goes inside a gm-only fence. One already
hidden is left alone, and the step is idempotent."""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
from migrate_core import WILL  # noqa: E402
from vaultlib import publisher_lines, scan_body  # noqa: E402

HAS_NODE = shutil.which("node") is not None

FM = "---\ntype: session_wrap\nsession_number: 3\n---\n\n"
HEAD = "# Chapter 01 · Session 03 — Docks — Wrap-Up\n\n"
CALLOUT = "> [!info] Source\n> play notes export, session ended mid-scene\n"
RECAP = "\n## Narrative Recap\n\nThe party reached the docks.\n"
GM = "\n<!-- gm-only -->\n\n## GM Notes\n\nSecrets.\n\n<!-- /gm-only -->\n"
OPEN, CLOSE = "<!-- gm-only -->\n", "<!-- /gm-only -->\n"

UNFENCED = FM + HEAD + CALLOUT + RECAP + GM
FENCED = FM + HEAD + OPEN + CALLOUT + CLOSE + RECAP + GM
WRAP = "Chapters/Chapter 1/Sessions/Session 03/Chapter_01_Session_03_Wrap_Up.md"


def make_vault(case, notes):
    root = Path(tempfile.mkdtemp(prefix="mig-source-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "Vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.yaml").write_text(
        "version: 1\n", encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def raw(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(items):
    return [line for item in items for line in item.apply(None)]


class SourceFenceTests(unittest.TestCase):
    def test_unfenced_callout_is_fenced(self):
        v = make_vault(self, {WRAP: UNFENCED})
        (item,) = mv.find_wrapup_source_fence(v)
        self.assertEqual((item.id, item.group), ("wrapup-source-fence", WILL))
        self.assertEqual(len(item.lines), 1)
        self.assertIn(WRAP, item.lines[0])
        run([item])
        self.assertEqual(raw(v, WRAP), FENCED)

    def test_already_fenced_is_left_alone(self):
        v = make_vault(self, {WRAP: FENCED})
        self.assertEqual(mv.find_wrapup_source_fence(v), [])
        self.assertEqual(raw(v, WRAP), FENCED)

    def test_fenced_with_blank_lines_or_inside_a_spoiler_is_left_alone(self):
        for note in (FM + HEAD + OPEN + "\n" + CALLOUT + "\n" + CLOSE + RECAP,
                     FM + HEAD + "<!-- spoiler -->\n" + CALLOUT
                     + "<!-- /spoiler -->\n" + RECAP):
            v = make_vault(self, {WRAP: note})
            self.assertEqual(mv.find_wrapup_source_fence(v), [], note)

    def test_idempotent(self):
        v = make_vault(self, {WRAP: UNFENCED})
        run(mv.find_wrapup_source_fence(v))
        self.assertEqual(mv.find_wrapup_source_fence(v), [])
        self.assertEqual(raw(v, WRAP), FENCED)

    def test_crlf_kept(self):
        v = make_vault(self, {WRAP: UNFENCED.replace("\n", "\r\n")})
        run(mv.find_wrapup_source_fence(v))
        self.assertEqual(raw(v, WRAP), FENCED.replace("\n", "\r\n"))

    def test_a_callout_inside_the_recap_is_fenced_too(self):
        # Canticle's Chapter 2 wrap-up keeps its Source note mid-recap.
        note = (FM + HEAD + "## Narrative Recap\n\nThey fought.\n\n"
                + CALLOUT + "\n---\n\nMore.\n")
        v = make_vault(self, {WRAP: note})
        run(mv.find_wrapup_source_fence(v))
        self.assertEqual(raw(v, WRAP), note.replace(
            CALLOUT, OPEN + CALLOUT + CLOSE))

    def test_last_line_of_the_file(self):
        note = FM + HEAD + CALLOUT.rstrip("\n")
        v = make_vault(self, {WRAP: note})
        run(mv.find_wrapup_source_fence(v))
        self.assertEqual(raw(v, WRAP),
                         FM + HEAD + OPEN + CALLOUT + CLOSE.rstrip("\n"))

    def test_left_alone_where_players_never_see_it(self):
        under_gm = (FM + HEAD + RECAP + "\n<!-- gm-only -->\n\n## GM Notes\n\n"
                    + CALLOUT + "\n<!-- /gm-only -->\n")
        unfenced_gm = FM + HEAD + RECAP + "\n## GM Notes\n\n" + CALLOUT
        in_code = FM + HEAD + "```\n" + CALLOUT + "```\n" + RECAP
        for note in (under_gm, unfenced_gm, in_code):
            v = make_vault(self, {WRAP: note})
            self.assertEqual(mv.find_wrapup_source_fence(v), [], note)

    def test_a_heading_after_gm_notes_ends_it(self):
        # `# Public` after `## GM Notes` is out of that section; the site shows what follows.
        for heading in ("# Public", "## Public"):
            note = FM + HEAD + "## GM Notes\n\nx\n\n" + heading + "\n\n" + CALLOUT
            v = make_vault(self, {WRAP: note})
            run(mv.find_wrapup_source_fence(v))
            self.assertEqual(raw(v, WRAP), note.replace(CALLOUT, OPEN + CALLOUT + CLOSE), heading)

    def test_lazy_continuation_lines_go_inside_the_fence(self):
        lazy = CALLOUT + "and this lazy line\nand another\n"
        note = FM + HEAD + lazy + "\nAfter.\n" + RECAP
        v = make_vault(self, {WRAP: note})
        run(mv.find_wrapup_source_fence(v))
        self.assertEqual(raw(v, WRAP), note.replace(lazy, OPEN + lazy + CLOSE))

    def test_a_heading_or_list_right_after_is_not_swallowed(self):
        for after in ("## Narrative Recap\n", "- a list\n", "---\n", "```\ncode\n```\n",
                      "<!-- gm-only -->\nx\n<!-- /gm-only -->\n"):
            note = FM + HEAD + CALLOUT + after + "\nMore.\n"
            v = make_vault(self, {WRAP: note})
            run(mv.find_wrapup_source_fence(v))
            self.assertEqual(raw(v, WRAP), note.replace(CALLOUT, OPEN + CALLOUT + CLOSE, 1), after)

    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node for the publish tool")
    def test_the_player_site_drops_lazy_lines_too(self):
        note = FM + HEAD + CALLOUT + "lazy SECRET2\n" + RECAP
        v = make_vault(self, {WRAP: note})
        run(mv.find_wrapup_source_fence(v))
        shown = "\n".join(publisher_lines(raw(v, WRAP), [], {}))
        self.assertNotIn("SECRET2", shown)
        self.assertIn("The party reached the docks.", shown)

    def test_other_notes_and_other_callouts_untouched(self):
        npc = "---\ntype: npc\n---\n\n# Bob\n\n" + CALLOUT
        ref = ("---\ntype: reference\n---\n\n# Ref\n\n"
               "> [!info] Source note\n> period accounts\n")
        other = FM + HEAD + "> [!info] Sources of the feud\n> x\n" + RECAP
        tmpl = FM + HEAD + CALLOUT + RECAP
        v = make_vault(self, {"N/Bob.md": npc, "R/Ref.md": ref, WRAP: other,
                              "_Templates/_Template_Session_WrapUp.md": tmpl})
        self.assertEqual(mv.find_wrapup_source_fence(v), [])

    def test_any_callout_kind_and_fold_mark(self):
        note = FM + HEAD + "> [!NOTE]- source  \n> x\n" + RECAP
        v = make_vault(self, {WRAP: note})
        run(mv.find_wrapup_source_fence(v))
        self.assertIn(OPEN + "> [!NOTE]- source  \n> x\n" + CLOSE, raw(v, WRAP))

    def test_registered(self):
        by = {c.name: c for c in mv.VAULT_CHECKS}
        c = by["wrapup-source-fence"]
        self.assertEqual((c.release, c.band, c.asks_site), ("1.10.114", 3, False))


class TemplateTests(unittest.TestCase):
    def test_the_shared_template_fences_its_source_callout(self):
        text = (SCRIPTS.parent / "templates" / "session-wrap.md").read_text(
            encoding="utf-8")
        states, problems = scan_body(text)
        self.assertEqual(problems, [])
        source = [s for s in states if s.line.startswith("> [!info] Source")]
        self.assertEqual(len(source), 1)
        self.assertGreater(source[0].gm_depth, 0)


    @unittest.skipUnless(HAS_NODE or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
                         "needs node for the publish tool")
    def test_the_player_site_drops_the_fenced_callout(self):
        before = "\n".join(publisher_lines(UNFENCED, [], {}))
        self.assertIn("Source", before)
        after = "\n".join(publisher_lines(FENCED, [], {}))
        self.assertNotIn("Source", after)
        self.assertIn("The party reached the docks.", after)


if __name__ == "__main__":
    unittest.main()

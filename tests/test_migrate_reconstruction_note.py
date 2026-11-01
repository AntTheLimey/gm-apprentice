"""`reconstruction-note-fence` (1.10.119): a `> [!info] Reconstruction Note`
callout in a note already in a vault goes inside a gm-only fence, so it stops
publishing. One already hidden is left alone, and the step is idempotent.
Span rules match `wrapup-source-fence`."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
from migrate_core import WILL  # noqa: E402

FM = "---\ntype: session\n---\n\n"
HEAD = "# Session 03 — Docks\n\n"
CALLOUT = "> [!info] Reconstruction Note\n> Rebuilt from two transcripts; session 3 is missing.\n"
RECAP = "\n## Narrative Recap\n\nThe party reached the docks.\n"
GM = "\n<!-- gm-only -->\n\n## GM Notes\n\nSecrets.\n\n<!-- /gm-only -->\n"
OPEN, CLOSE = "<!-- gm-only -->\n", "<!-- /gm-only -->\n"

UNFENCED = FM + HEAD + CALLOUT + RECAP + GM
FENCED = FM + HEAD + OPEN + CALLOUT + CLOSE + RECAP + GM
NOTE = "Chapters/Chapter 1/Sessions/Session 03/Session 03 - Docks.md"
FIND = mv.find_reconstruction_note_fence


def make_vault(case, notes):
    root = Path(tempfile.mkdtemp(prefix="mig-recon-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "Vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n", encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def raw(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(items):
    return [line for item in items for line in item.apply(None)]


class ReconstructionFenceTests(unittest.TestCase):
    def test_unfenced_callout_is_fenced(self):
        v = make_vault(self, {NOTE: UNFENCED})
        (item,) = FIND(v)
        self.assertEqual((item.id, item.group), ("reconstruction-note-fence", WILL))
        self.assertEqual(len(item.lines), 1)
        self.assertIn(NOTE, item.lines[0])
        run([item])
        self.assertEqual(raw(v, NOTE), FENCED)

    def test_any_note_type_is_fenced(self):
        npc = "---\ntype: npc\n---\n\n# Bob\n\n" + CALLOUT
        v = make_vault(self, {"NPCs/Bob.md": npc})
        run(FIND(v))
        self.assertEqual(raw(v, "NPCs/Bob.md"), npc.replace(CALLOUT, OPEN + CALLOUT + CLOSE))

    def test_already_fenced_is_left_alone(self):
        v = make_vault(self, {NOTE: FENCED})
        self.assertEqual(FIND(v), [])
        self.assertEqual(raw(v, NOTE), FENCED)

    def test_inside_a_spoiler_is_left_alone(self):
        note = FM + HEAD + "<!-- spoiler -->\n" + CALLOUT + "<!-- /spoiler -->\n" + RECAP
        v = make_vault(self, {NOTE: note})
        self.assertEqual(FIND(v), [])

    def test_under_gm_notes_or_in_code_is_left_alone(self):
        under_gm = FM + HEAD + RECAP + "\n## GM Notes\n\n" + CALLOUT
        in_code = FM + HEAD + "```\n" + CALLOUT + "```\n" + RECAP
        for note in (under_gm, in_code):
            v = make_vault(self, {NOTE: note})
            self.assertEqual(FIND(v), [], note)

    def test_idempotent(self):
        v = make_vault(self, {NOTE: UNFENCED})
        run(FIND(v))
        self.assertEqual(FIND(v), [])
        self.assertEqual(raw(v, NOTE), FENCED)

    def test_crlf_kept(self):
        v = make_vault(self, {NOTE: UNFENCED.replace("\n", "\r\n")})
        run(FIND(v))
        self.assertEqual(raw(v, NOTE), FENCED.replace("\n", "\r\n"))

    def test_lazy_continuation_lines_go_inside_the_fence(self):
        lazy = CALLOUT + "and this lazy line\nand another\n"
        note = FM + HEAD + lazy + "\nAfter.\n" + RECAP
        v = make_vault(self, {NOTE: note})
        run(FIND(v))
        self.assertEqual(raw(v, NOTE), note.replace(lazy, OPEN + lazy + CLOSE))

    def test_a_paragraph_after_a_blank_quoted_line_is_not_swallowed(self):
        quoted = CALLOUT + ">\n"
        note = FM + HEAD + quoted + "Player paragraph.\n" + RECAP
        v = make_vault(self, {NOTE: note})
        run(FIND(v))
        self.assertEqual(raw(v, NOTE), note.replace(quoted, OPEN + quoted + CLOSE))

    def test_a_heading_or_list_right_after_is_not_swallowed(self):
        for after in ("## Narrative Recap\n", "- a list\n", "---\n", "```\ncode\n```\n",
                      "<!-- gm-only -->\nx\n<!-- /gm-only -->\n"):
            note = FM + HEAD + CALLOUT + after + "\nMore.\n"
            v = make_vault(self, {NOTE: note})
            run(FIND(v))
            self.assertEqual(raw(v, NOTE), note.replace(CALLOUT, OPEN + CALLOUT + CLOSE, 1), after)

    def test_templates_and_meta_are_skipped(self):
        v = make_vault(self, {"_Templates/_Template_Session.md": FM + HEAD + CALLOUT,
                              "_meta/notes.md": FM + HEAD + CALLOUT})
        self.assertEqual(FIND(v), [])

    def test_other_callouts_untouched(self):
        note = FM + HEAD + "> [!info] Source\n> x\n\n> [!note] Reconstructions\n> y\n" + RECAP
        v = make_vault(self, {NOTE: note})
        self.assertEqual(FIND(v), [])

    def test_registered(self):
        by = {c.name: c for c in mv.VAULT_CHECKS}
        c = by["reconstruction-note-fence"]
        s = by["wrapup-source-fence"]
        self.assertEqual((c.release, c.band, c.asks_site), ("1.10.119", 3, False))
        self.assertEqual((c.band, c.asks_site), (s.band, s.asks_site))


if __name__ == "__main__":
    unittest.main()

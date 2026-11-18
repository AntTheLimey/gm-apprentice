#!/usr/bin/env python3
"""vault-write batch: many writes, one plan, one commit."""

import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_vault_write import (  # noqa: E402
    INDEX, INDEX_REL, NPC, NPC_REL, S2, WRAP_REL, make_vault, read, run)


def batch(vault, text, *flags):
    path = vault.parent / f"{vault.name}-batch.txt"
    path.write_text(text, encoding="utf-8")
    try:
        return run(vault, "batch", str(path), *flags)
    finally:
        path.unlink()       # beside the vault, so its cleanup misses it


NEW_NPC = """---
type: npc
name: "Bola"
canon_status: DRAFT
---

# Bola

## Campaign Log

"""

BOLA = "Characters/NPCs/Bola.md"
SECTION = (Path(__file__).resolve().parent.parent / "skills" / "shared"
           / "scripts" / "section.py")

SCENE_REL = "Chapters/Chapter 1/Scenes/The Second Night.md"
SCENE_FM = """---
type: scene
chapter: "[[Chapter 1]]"
status: planned
---
"""
SCENE_GM = """<!-- gm-only -->

## GM Notes

- Night 2 is Marda's.

<!-- /gm-only -->
"""
SCENE = SCENE_FM + """
**Situation:** The house goes to bed.

**Starts it:** Hollis brings round warm cups.

**If the players...**

| Do | Then |
|---|---|
| Refuse the cups | The draught fails |

""" + SCENE_GM

# A paused scene as scene-paused leaves it (#758): the snapshot on top, the
# real lead below its end line.
PAUSED_LEAD = """**Situation:** Night 2. The lamps are out.

**Starts it:** Hollis brings round warm cups.

**NPCs**
- Hollis

**If the players...**

| Do | Then |
|---|---|
| Run | Caught |

"""
PAUSED = SCENE_FM.replace("planned", "paused") + """
## Paused

After [[Session 02 - The Docks]].

Paused on "Roll initiative." The cups are poured.

- **Where:** the kitchen
- **The PCs:** Ada at the door
<!-- /paused -->

""" + PAUSED_LEAD + SCENE_GM
PAUSED_PROMPT = PAUSED.replace("---\n\n## Paused", "---\n\n<!-- A scene is "
                               "prep.\n     Keep what helps. -->\n\n## Paused")
PAUSED_REPLACE = (f'=== section "{SCENE_REL}" --lead --replace\n'
                  "**Situation:** Night 3.\n\n**Starts it:** The well bell.\n")

WHOLE = f"""=== stamp "{INDEX_REL}" --set status=wrap-up
=== wrapup-new --session "{INDEX_REL}"
=== wrapup-add "{WRAP_REL}"
## Narrative Recap

They went to the docks.
=== note-new {BOLA}
{NEW_NPC}=== log
{BOLA}\tCampaign Log\t{S2}sold a calf.
{NPC_REL}\tCampaign Log\t{S2}sold a map.
=== section {NPC_REL} "Campaign Log" --append
{S2}and a second thing.
"""


class BatchTests(unittest.TestCase):
    def vault(self):
        return make_vault(self, {INDEX_REL: INDEX, NPC_REL: NPC})

    def test_plan_writes_nothing(self):
        vault = self.vault()
        code, out = batch(vault, WHOLE)
        self.assertEqual(code, 0, out)
        for line in ("## 1 stamp", "## 2 wrapup-new", "## 3 wrapup-add",
                     "## 4 note-new", "## 5 log", "## 6 section",
                     "WOULD-STAMP\t", "WOULD-CREATE\t" + BOLA,
                     "# plan only"):
            self.assertIn(line, out)
        self.assertFalse((vault / WRAP_REL).exists())
        self.assertFalse((vault / BOLA).exists())
        self.assertEqual(read(vault, NPC_REL), NPC)

    def test_write_lands_every_block_in_order(self):
        vault = self.vault()
        code, out = batch(vault, WHOLE, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn('status: "wrap-up"', read(vault, INDEX_REL))
        self.assertIn("They went to the docks.", read(vault, WRAP_REL))
        self.assertIn(S2 + "sold a calf.", read(vault, BOLA))
        npc = read(vault, NPC_REL)
        self.assertIn("met the party.\n" + S2 + "sold a map.\n" + S2
                      + "and a second thing.\n\n<!-- gm-only", npc)
        self.assertIn("# written: 4 files", out)
        self.assertIn("STAMPED\t", out)

    def test_a_refusal_anywhere_writes_nothing_and_lists_them_all(self):
        vault = self.vault()
        bad = WHOLE.replace('"Campaign Log" --append', '"No Such" --append')
        bad = bad.replace("=== note-new " + BOLA, "=== note-new " + NPC_REL)
        code, out = batch(vault, bad, "--write")
        self.assertEqual(code, 1)
        self.assertIn("ERROR\t\t\t" + NPC_REL + ": already exists", out)
        self.assertIn("has no section 'No Such'", out)
        self.assertIn("# nothing written: fix blocks 4, 5, 6", out)
        self.assertFalse((vault / WRAP_REL).exists())
        self.assertEqual(read(vault, NPC_REL), NPC)
        self.assertEqual(read(vault, INDEX_REL), INDEX)

    def test_a_refused_block_leaves_no_trace_for_later_blocks(self):
        vault = self.vault()
        text = (f"=== note-new {BOLA}\nno frontmatter\n"
                f"=== log\n{BOLA}\tCampaign Log\t{S2}x\n")
        code, out = batch(vault, text)
        self.assertEqual(code, 1)
        self.assertIn("frontmatter", out)
        self.assertIn("## 2 log\nERROR", out)

    def test_skip_writes_the_rest_and_leaves_the_file(self):
        vault = self.vault()
        code, out = batch(vault, WHOLE, "--write", "--skip", "4,5")
        self.assertEqual(code, 0, out)
        self.assertIn("## 4 note-new " + BOLA + "\t(left out)", out)
        self.assertFalse((vault / BOLA).exists())
        self.assertIn("and a second thing.", read(vault, NPC_REL))
        code, out = batch(vault, WHOLE, "--write", "--only", "4,5")
        self.assertEqual(code, 0, out)
        self.assertIn(S2 + "sold a calf.", read(vault, BOLA))

    def test_skipping_a_needed_block_says_so(self):
        vault = self.vault()
        code, out = batch(vault, WHOLE, "--skip", "2")
        self.assertEqual(code, 1)
        self.assertIn("block 2 is left out: does this block need it?", out)

    def test_escaped_separator_in_a_body(self):
        vault = self.vault()
        text = (f'=== section {NPC_REL} "Campaign Log"\n'
                f"\\=== not a block\n")
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("\n=== not a block\n", read(vault, NPC_REL))

    def test_section_refuses_a_heading_that_would_end_it(self):
        vault = self.vault()
        text = f'=== section {NPC_REL} "Campaign Log"\n## Oops\n'
        code, out = batch(vault, text)
        self.assertEqual(code, 1)
        self.assertIn("would end the section", out)

    def test_section_replace_refuses_to_drop_a_hidden_block(self):
        vault = make_vault(self, {NPC_REL: NPC.replace(
            "- **[[Session 01 - Start]]** — met the party.\n",
            "- met.\n\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n", 1)})
        text = f'=== section {NPC_REL} "Campaign Log" --replace\n- new\n'
        code, out = batch(vault, text)
        self.assertEqual(code, 1)
        self.assertIn("--replace would drop it", out)

    def test_section_append_list_joins_the_list_above_a_closed_block(self):
        """#655: `section --append` places a list item as `log` does."""
        note = NPC.replace(
            "- **[[Session 01 - Start]]** — met the party.\n",
            "- met.\n\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n", 1)
        want = "- met.\n- new.\n\n<!-- gm-only -->\nsecret\n"
        for text in (f'=== section {NPC_REL} "Campaign Log" --append\n'
                     f"- new.\n",
                     f"=== log\n{NPC_REL}\tCampaign Log\t- new.\n"):
            vault = make_vault(self, {NPC_REL: note})
            code, out = batch(vault, text, "--write")
            self.assertEqual(code, 0, out)
            self.assertIn(want, read(vault, NPC_REL), text)

    def test_lead_replace_rewrites_a_scenes_text_above_its_fence(self):
        """#738: a scene's Situation, Starts it and If-table have no heading;
        `--lead` names them, and nothing above or below them moves."""
        vault = make_vault(self, {SCENE_REL: SCENE})
        text = (f"=== section \"{SCENE_REL}\" --lead --replace\n"
                "**Situation:** Night 2.\n\n"
                "| Do | Then |\n|---|---|\n| Refuse the cups | Teodor finds "
                "them awake |\n")
        code, out = batch(vault, text)
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-REPLACE\t{SCENE_REL}\t§(lead)\t", out)
        self.assertEqual(read(vault, SCENE_REL), SCENE)
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, SCENE_REL), SCENE_FM + (
            "\n**Situation:** Night 2.\n\n| Do | Then |\n|---|---|\n"
            "| Refuse the cups | Teodor finds them awake |\n\n") + SCENE_GM)

    def test_lead_append_joins_the_if_table(self):
        vault = make_vault(self, {SCENE_REL: SCENE})
        text = (f"=== section \"{SCENE_REL}\" --lead --append\n"
                "| Sleep through | A Long Rest |\n")
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("| Refuse the cups | The draught fails |\n"
                      "| Sleep through | A Long Rest |\n\n<!-- gm-only -->",
                      read(vault, SCENE_REL))

    def test_lead_replace_keeps_the_templates_comment_at_the_top(self):
        note = SCENE.replace("---\n\n**Situation", "---\n\n<!-- A scene is "
                             "prep.\n     Keep what helps. -->\n\n**Situation")
        vault = make_vault(self, {SCENE_REL: note})
        code, out = batch(vault, f"=== section \"{SCENE_REL}\" --lead --replace\n"
                          "**Situation:** New.\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("---\n\n<!-- A scene is prep.\n     Keep what helps. -->"
                      "\n\n**Situation:** New.\n\n<!-- gm-only -->",
                      read(vault, SCENE_REL))

    def test_lead_read_then_written_back_changes_nothing(self):
        """What `gma section --lead` prints, written back, leaves the note
        byte for byte: its top comment is not doubled, and its own blank
        lines and a last line with no line end stay."""
        script = (Path(__file__).resolve().parent.parent / "skills" / "shared"
                  / "scripts" / "section.py")
        notes = {
            "a.md": SCENE.replace("---\n\n**Situation", "---\n\n<!-- A scene"
                                  " is prep. -->\n\n**Situation"),
            "b.md": "\nNo frontmatter.\n\n\n\n## Notes\n\nx\n",
            "c.md": "---\ntype: npc\n---\nTight under the frontmatter.",
            "d.md": "---\ntype: scene\n---\n   \n**S:** a\n\n## H\n",
        }
        for rel, note in notes.items():
            vault = make_vault(self, {rel: note})
            got = subprocess.run([sys.executable, str(script), str(vault), rel,
                                  "--lead"], capture_output=True)
            self.assertEqual(got.returncode, 0, got.stderr)
            lead = got.stdout.decode("utf-8")
            code, out = batch(vault, f'=== section "{rel}" --lead --replace\n'
                              + lead, "--write")
            self.assertEqual(code, 0, out)
            self.assertEqual(read(vault, rel), note, rel)

    def test_lead_replace_refuses_to_drop_a_comment_inside_it(self):
        note = SCENE.replace("**Starts it:**", "%% check the map %%\n\n"
                             "**Starts it:**")
        vault = make_vault(self, {SCENE_REL: note})
        code, out = batch(vault, f"=== section \"{SCENE_REL}\" --lead --replace\n"
                          "**Situation:** New.\n")
        self.assertEqual(code, 1)
        self.assertIn("--replace would drop it", out)

    def test_lead_refuses_a_heading_or_a_fence_in_its_text(self):
        vault = make_vault(self, {SCENE_REL: SCENE})
        for body, why in (("## Oops\n", "would end the lead"),
                          ("<!-- gm-only -->\nx\n<!-- /gm-only -->\n",
                           "gm-only or spoiler marker")):
            code, out = batch(vault, f"=== section \"{SCENE_REL}\" --lead "
                              f"--replace\n{body}")
            self.assertEqual(code, 1, body)
            self.assertIn(why, out)

    def test_lead_and_a_heading_are_one_or_the_other(self):
        vault = make_vault(self, {SCENE_REL: SCENE})
        code, out = batch(vault, f'=== section \"{SCENE_REL}\" "GM Notes" --lead\n'
                          "x\n")
        self.assertEqual(code, 1)
        self.assertIn("a HEADING or --lead, not both", out)
        code, out = batch(vault, f"=== section \"{SCENE_REL}\"\nx\n")
        self.assertEqual(code, 1)
        self.assertIn("a HEADING or --lead", out)

    # --- #738 review: nothing a lead write does may hide or publish other text

    def lead_refused(self, note, body, why, *mode):
        vault = make_vault(self, {"n.md": note})
        mode = mode or ("--replace",)
        code, out = batch(vault, f'=== section "n.md" --lead {mode[0]}\n'
                          + body, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(why, out)
        self.assertEqual(read(vault, "n.md"), note)

    def test_lead_text_may_not_leave_a_fence_or_comment_open(self):
        """An open fence above the GM Notes fence switched it off: the
        secret published (reviewers, #738)."""
        for body, why in (("New\n```\nunclosed\n", "a code fence open"),
                          ("New <!-- note\nmore\n", "an HTML comment open"),
                          ("New %% note\nmore\n", "a %% comment open")):
            for mode in ("--replace", "--append"):
                self.lead_refused(SCENE, body, why, mode)

    def test_heading_section_text_may_not_leave_a_fence_open(self):
        vault = self.vault()
        code, out = batch(vault, f'=== section {NPC_REL} "Campaign Log" '
                          "--append\n```\nunclosed\n")
        self.assertEqual(code, 1, out)
        self.assertIn("a code fence open", out)

    def test_lead_text_may_not_hold_a_marker_anywhere(self):
        self.lead_refused(SCENE, "Public <!-- gm-only --> hidden\n",
                          "gm-only or spoiler marker")

    def test_lead_text_may_not_make_a_setext_heading_or_frontmatter(self):
        self.lead_refused(SCENE, "New\n---\n", "into a heading")
        self.lead_refused("Old.\n\n## H\n\nx\n", "---\ntitle: x\n---\n",
                          "read as frontmatter")

    def test_a_multi_line_percent_comment_at_the_top_is_kept_whole(self):
        note = SCENE.replace("---\n\n**Situation", "---\n\n%% prompt one\n"
                             "prompt two %%\n\n**Situation")
        vault = make_vault(self, {SCENE_REL: note})
        code, out = batch(vault, f'=== section "{SCENE_REL}" --lead '
                          "--replace\n**Situation:** New.\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("---\n\n%% prompt one\nprompt two %%\n\n**Situation:** "
                      "New.\n\n<!-- gm-only -->", read(vault, SCENE_REL))

    def test_a_comment_opened_mid_line_or_inline_refuses_replace(self):
        for lead in ("**S:** a <!-- aside\nstill aside -->\n\nmore\n",
                     "x <!-- note -->\n", "x %% note %%\n"):
            self.lead_refused(SCENE_FM + "\n" + lead + "\n" + SCENE_GM,
                              "**S:** new\n", "would drop it")

    def test_comment_syntax_inside_a_fence_is_not_a_comment(self):
        note = SCENE_FM + "\n**S:** a\n\n```\n%% x\n<!-- y\n```\n\n" + SCENE_GM
        vault = make_vault(self, {SCENE_REL: note})
        code, out = batch(vault, f'=== section "{SCENE_REL}" --lead '
                          "--replace\n**S:** b\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, SCENE_REL),
                         SCENE_FM + "\n**S:** b\n\n" + SCENE_GM)

    def test_a_heading_inside_a_comment_does_not_end_the_lead(self):
        note = (SCENE_FM + "\n<!-- prompt\n## Example\n-->\n\nOld text.\n\n"
                + SCENE_GM)
        vault = make_vault(self, {SCENE_REL: note})
        code, out = batch(vault, f'=== section "{SCENE_REL}" --lead '
                          "--replace\nNew text.\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, SCENE_REL), note.replace(
            "Old text.", "New text."))

    def test_a_lead_ending_inside_a_comment_is_refused(self):
        self.lead_refused("Old.\n%% aside\n<!-- gm-only -->\nx\n"
                          "<!-- /gm-only -->\n%%\n", "New.\n",
                          "ends inside a comment", "--append")

    def test_a_mid_line_marker_in_the_lead_is_refused(self):
        self.lead_refused("Public <!-- gm-only -->\nsecret\n<!-- /gm-only -->"
                          "\n\n## H\n", "Appended.\n", "mid-line", "--append")

    def test_unclosed_frontmatter_is_refused(self):
        for opener in ("---", "--- "):
            self.lead_refused(f"{opener}\ntype: npc\n\nOld text.\n\n## H\n",
                              "New.\n", "frontmatter is not closed")

    def test_the_publish_tool_has_the_last_word_on_the_rest_of_the_note(self):
        """Second review pass: text the Python reading passed still hid or
        published lines below it as the site reads them. The tool is asked."""
        fence = "`" * 3
        note = ("---\ntype: npc\n---\n\nOld.\n\n## Public\n\nPublic text.\n\n"
                "<!-- private note: UNVERIFIED -->\n\n<!-- gm-only -->\n\n"
                "## GM Notes\n\nSecret.\n\n<!-- /gm-only -->\n")
        # Each passes the Python reading of the text and reaches the tool:
        # the refusal must be the tool's (CodeRabbit, #743).
        for body in (f"{fence}\nx\n{fence} not-a-close\n<!-- c -->\n{fence}\n",
                     f"Text\n    {fence}\nmore\n",
                     f"{'`' * 4}\n{fence}\n{'`' * 4}\n",
                     "Text ``a %% ``` x\n",
                     "%% a <!-- b %%\nVisible c -->\nVisible d\n"):
            vault = make_vault(self, {"n.md": note})
            code, out = batch(vault, '=== section "n.md" --lead --replace\n'
                              + body, "--write")
            self.assertEqual(code, 1, body + out)
            self.assertIn("would change what the rest of the note shows", out,
                          body)
            self.assertEqual(read(vault, "n.md"), note, body)
        note = note.replace("Public text.\n\n", "Public text.\n\n## Later\n\n", 1)
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" "Public" --replace\n'
                          f"{fence}\nx\n{fence} not-a-close\n<!-- c -->\n"
                          f"{fence}\n", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("would change what the rest of the note shows", out)

    def test_text_appended_in_the_last_section_is_checked_below_it(self):
        """Third review pass: an append inside the note's last section had
        nothing below the section to compare, and was never checked."""
        note = ("---\ntype: npc\n---\n\nLead.\n\n## Notes\n\n- one\n\n"
                "Closing para.\n\n<!-- private note -->\n")
        for body in ("- two ``a %% ``` x\n",
                     "- two\n\n````\n```\n````\n"):
            vault = make_vault(self, {"n.md": note})
            code, out = batch(vault, '=== section "n.md" "Notes" --append\n'
                              + body, "--write")
            self.assertEqual(code, 1, body + out)
            self.assertIn("would change what the rest of the note shows", out,
                          body)
            self.assertEqual(read(vault, "n.md"), note, body)

    def test_the_check_splits_lines_as_the_build_does(self):
        """A U+2028 inside a line is no line break to the build."""
        fence = "`" * 3
        note = ("---\ntype: npc\n---\n\nOld.\n\n## Public\n\n"
                "<!-- private note: UNVERIFIED -->\n")
        body = f"````\n{fence} info\nx {fence}\n````\n"
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" --lead --replace\n'
                          + body, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("would change what the rest of the note shows", out)
        self.assertEqual(read(vault, "n.md"), note)

    def test_a_fence_opened_inside_a_comment_cannot_swallow_sections(self):
        """A read and an append are refused too (CodeRabbit, #743): the read
        printed the Public section as the lead."""
        fence = "`" * 3
        note = (f"---\ntype: npc\n---\n\n<!--\n{fence}\n-->\nOld.\n\n"
                "## Public\n\nPublic text.\n")
        for mode in ("--replace", "--append"):
            self.lead_refused(note, "New.\n", "run past a heading", mode)
        self.assertIn("run past a heading", self.lead_read(note))

    def lead_read(self, note):
        """What `gma section --lead` says of the note: its output, or its
        error."""
        vault = make_vault(self, {"n.md": note})
        got = subprocess.run([sys.executable, str(SECTION), str(vault), "n.md",
                              "--lead"], capture_output=True, text=True)
        return got.stdout if got.returncode == 0 else got.stderr

    def test_a_setext_heading_ends_no_lead_silently(self):
        """`Public` over `======` is a heading on the site; the body reader
        missed it, and --replace deleted it and its text (CodeRabbit, #743).
        A table's `|---|` row and a `---` after a blank line are no heading."""
        note = "Old.\n\nPublic\n======\n\nDetails.\n"
        self.lead_refused(note, "New.\n", "run past a heading")
        self.assertIn("run past a heading", self.lead_read(note))
        fine = "| Do | Then |\n|---|---|\n| a | b |\n\n---\n\nMore.\n\n## H\n"
        self.assertEqual(self.lead_read(fine), fine.split("\n\n## H")[0] + "\n")

    def test_a_heading_in_a_real_fence_in_the_lead_is_no_heading(self):
        fence = "`" * 3
        note = f"Old.\n\n{fence}\n## Example\n{fence}\n\n## H\n\nx\n"
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" --lead --replace\nNew.\n',
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, "n.md"), "New.\n\n## H\n\nx\n")

    def test_a_lead_ending_inside_a_comment_or_fence_at_the_end_of_the_note(self):
        """With no final newline the old check never looked: the append went
        inside the comment, or into the code block (CodeRabbit, #743)."""
        fence = "`" * 3
        for note, why in (("Old.\n<!-- unfinished", "inside a comment"),
                          ("Old.\n%% unfinished\n", "inside a comment"),
                          (f"Old.\n\n{fence}\nexample", "inside a code fence")):
            self.lead_refused(note, "New.\n", why, "--append")
            self.assertIn(why, self.lead_read(note))
        note = f"Old.\n\n{fence}\nexample\n{fence}"
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" --lead --append\nNew.\n',
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, "n.md"), note + "\n\nNew.\n")

    # --- #758: a paused scene's lead is below its ## Paused section

    def paused_vault(self, note=None):
        return make_vault(self, {SCENE_REL: note or PAUSED})

    def test_paused_lead_replace_leaves_the_snapshot_alone(self):
        """The write went above `## Paused`, where the lead was empty, and
        left the real Situation below the snapshot: two Situation lines."""
        for note in (PAUSED, PAUSED_PROMPT):
            vault = self.paused_vault(note)
            code, out = batch(vault, PAUSED_REPLACE)
            self.assertEqual(code, 0, out)
            self.assertIn(f"WOULD-REPLACE\t{SCENE_REL}\t§(lead)\t3 lines", out)
            code, out = batch(vault, PAUSED_REPLACE, "--write")
            self.assertEqual(code, 0, out)
            got = read(vault, SCENE_REL)
            head = note.split(PAUSED_LEAD)[0]
            self.assertEqual(got, head + "**Situation:** Night 3.\n\n"
                             "**Starts it:** The well bell.\n\n" + SCENE_GM)
            self.assertEqual(got.count("**Situation:**"), 1)

    def test_paused_lead_append_lands_at_the_end_of_the_real_lead(self):
        vault = self.paused_vault()
        code, out = batch(vault, f'=== section "{SCENE_REL}" --lead --append\n'
                          "| Hide | Found by dawn |\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, SCENE_REL), PAUSED.replace(
            "| Run | Caught |\n", "| Run | Caught |\n| Hide | Found by dawn |\n"))

    def test_paused_lead_read_then_written_back_changes_nothing(self):
        for note in (PAUSED, PAUSED_PROMPT):
            vault = self.paused_vault(note)
            got = subprocess.run([sys.executable, str(SECTION), str(vault),
                                  SCENE_REL, "--lead"], capture_output=True)
            self.assertEqual(got.returncode, 0, got.stderr)
            self.assertEqual(got.stdout.decode("utf-8"), PAUSED_LEAD.strip()
                             + "\n")
            code, out = batch(vault, f'=== section "{SCENE_REL}" --lead '
                              "--replace\n" + got.stdout.decode("utf-8"),
                              "--write")
            self.assertEqual(code, 0, out)
            self.assertEqual(read(vault, SCENE_REL), note)

    def test_an_empty_paused_lead_is_written_below_the_end_line(self):
        note = PAUSED.replace(PAUSED_LEAD, "")
        for mode in ("--replace", "--append"):
            vault = self.paused_vault(note)
            code, out = batch(vault, f'=== section "{SCENE_REL}" --lead {mode}'
                              "\n**Situation:** Night 3.\n", "--write")
            self.assertEqual(code, 0, out)
            self.assertEqual(read(vault, SCENE_REL), note.replace(
                "<!-- /paused -->\n\n", "<!-- /paused -->\n\n**Situation:** "
                "Night 3.\n\n"), mode)
        self.assertIn("no text below its ## Paused section",
                      self.lead_read(note))

    def test_a_scene_paused_by_the_writer_takes_a_lead_write(self):
        """End to end: scene-paused puts its section under the template's
        prompt; the lead written next goes below it, the snapshot stays."""
        note = SCENE.replace("---\n\n**Situation", "---\n\n<!-- A scene is "
                             "prep. -->\n\n**Situation")
        vault = make_vault(self, {SCENE_REL: note, INDEX_REL: INDEX})
        code, out = run(vault, "scene-paused", "--scene", "The Second Night",
                        "--session", "Session 02 - The Docks", "--write",
                        stdin="Paused on \"Roll initiative.\"\n\n- **Where:** "
                        "the kitchen\n")
        self.assertEqual(code, 0, out)
        paused = read(vault, SCENE_REL)
        snap = paused.split("<!-- /paused -->\n")[0]
        code, out = batch(vault, f'=== section "{SCENE_REL}" --lead --replace'
                          "\n**Situation:** Night 3.\n", "--write")
        self.assertEqual(code, 0, out)
        got = read(vault, SCENE_REL)
        self.assertEqual(got, snap + "<!-- /paused -->\n\n**Situation:** "
                         "Night 3.\n\n" + SCENE_GM)

    def test_a_paused_section_with_no_end_line_is_refused(self):
        note = PAUSED.replace("<!-- /paused -->\n", "")
        for mode in ("--replace", "--append"):
            self.lead_refused(note, "**Situation:** New.\n",
                              "has no <!-- /paused --> line", mode)
        self.assertIn("has no <!-- /paused --> line", self.lead_read(note))

    def test_text_above_a_paused_section_is_refused(self):
        note = PAUSED.replace("\n## Paused", "\nStray text.\n\n## Paused")
        for mode in ("--replace", "--append"):
            self.lead_refused(note, "**Situation:** New.\n",
                              "text above its ## Paused section", mode)

    def test_an_empty_lead_with_a_situation_further_down_is_refused(self):
        """The misread-lead guard (#758): any heading the lead was not
        expected under."""
        note = SCENE_FM + "\n## Setup\n\n" + SCENE.split("---\n\n", 1)[1]
        for mode in ("--replace", "--append"):
            self.lead_refused(note, "**Situation:** New.\n",
                              "reads like one", mode)
        self.assertIn("reads like a lead", self.lead_read(note))

    def test_section_text_may_not_land_inside_a_fence_left_open(self):
        """Appended to a last section that ends inside an unclosed fence, a
        gm-only block was code: its markers did nothing and the secret
        published (found checking CodeRabbit's #743 lead case)."""
        fence = "`" * 3
        note = f"---\ntype: npc\n---\n\n## Notes\n\nx\n\n{fence}\nexample\n"
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" "Notes" --append\n'
                          "<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n",
                          "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("a code fence or comment left open above it", out)
        self.assertEqual(read(vault, "n.md"), note)

    def test_section_text_with_a_hidden_sections_heading_is_checked(self):
        """A `### GM Notes` written over `## Public`'s text hid the
        `#### Details` below it on the site (CodeRabbit, #743); an ordinary
        `###` does not, and an append into a hidden section is fine."""
        note = ("---\ntype: npc\n---\n\nLead.\n\n## Public\n\nOld.\n\n"
                "#### Details\n\nShown.\n\n## GM Notes\n\n- a\n")
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" "Public" --replace\n'
                          "New.\n\n### GM Notes\n\nhidden\n", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("a hidden section's heading", out)
        self.assertEqual(read(vault, "n.md"), note)
        code, out = batch(vault, '=== section "n.md" "Public" --replace\n'
                          "New.\n\n### Aside\n\nshown\n"
                          '=== section "n.md" "GM Notes" --append\n- b\n',
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("### Aside\n\nshown\n\n#### Details", read(vault, "n.md"))
        self.assertIn("- a\n- b\n", read(vault, "n.md"))

    def test_percent_signs_in_a_code_span_open_no_comment(self):
        """`%%` in an inline code span is literal to the publish tool; the
        writer refused it as an open comment (CodeRabbit, #743). A real one
        is still refused."""
        note = "---\ntype: npc\n---\n\nLead.\n\n## Notes\n\nOld.\n\n## Other\n\nx\n"
        vault = make_vault(self, {"n.md": note})
        code, out = batch(vault, '=== section "n.md" "Notes" --replace\n'
                          "The token is `%%`.\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("## Notes\n\nThe token is `%%`.\n\n## Other", read(vault, "n.md"))
        code, out = batch(vault, '=== section "n.md" "Notes" --replace\n'
                          "The token is %%.\n", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("a %% comment open", out)
        self.lead_refused(SCENE, "Text `%%` x %% y\n", "a %% comment open")

    def test_a_prompt_sharing_a_line_with_lead_text_refuses_replace(self):
        """`<!-- prompt --> Old.` was kept whole: Old. stayed, New. went
        below it (CodeRabbit, #743)."""
        for top in ("<!-- prompt --> Old.\n", "<!-- a\nb --> Old.\n",
                    "%% p %% Old.\n"):
            self.lead_refused(SCENE_FM + "\n" + top + "\n" + SCENE_GM,
                              "New.\n", "shares a line with text")

    def test_a_bom_frontmatter_opener_in_lead_text_is_refused(self):
        self.lead_refused("Old.\n\n## H\n\nx\n", "\ufeff---\ntitle: x\n---\n",
                          "read as frontmatter")

    def test_lead_on_a_crlf_note_and_an_empty_lead(self):
        crlf = SCENE.replace("\n", "\r\n")
        vault = make_vault(self, {"c.md": crlf, "e.md": "---\ntype: npc\n"
                                  "---\n\n## H\n\nx\n"})
        code, out = batch(vault, '=== section "c.md" --lead --append\n'
                          "| Sleep | Rest |\n"
                          '=== section "e.md" --lead --append\nLead.\n',
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("| Refuse the cups | The draught fails |\r\n"
                      "| Sleep | Rest |\r\n\r\n<!-- gm-only -->",
                      read(vault, "c.md"))
        self.assertEqual(read(vault, "e.md"),
                         "---\ntype: npc\n---\n\nLead.\n\n## H\n\nx\n")

    def test_section_append_with_a_heading_stays_out_of_an_open_block(self):
        """#655: text holding a sub-heading now takes the hiding check too
        (#655 point 1 is not reachable: `section_end` already stops at the
        opener of a block holding a heading, so this passes on main too
        and is kept as a pin)."""
        note = NPC.replace(
            "- **[[Session 01 - Start]]** — met the party.\n",
            "- met.\n\n<!-- gm-only -->\nsecret\n\n## Hidden\n\nmore\n"
            "\n<!-- /gm-only -->\n", 1)
        vault = make_vault(self, {NPC_REL: note})
        text = (f'=== section {NPC_REL} "Campaign Log" --append\n'
                f"### Visit\n\nPublic text.\n")
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        got = read(vault, NPC_REL)
        self.assertLess(got.index("Public text."), got.index("<!-- gm-only"))

    def test_section_replace(self):
        vault = self.vault()
        text = f'=== section {NPC_REL} "GM Notes/Wants" --replace\nIn.\n'
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("### Wants\n\nIn.\n\n### Behind", read(vault, NPC_REL))

    def test_write_flag_inside_a_block_is_refused(self):
        vault = self.vault()
        code, out = batch(vault, "=== log --write\n"
                          f"{NPC_REL}\tCampaign Log\t{S2}x\n")
        self.assertEqual(code, 1)
        self.assertIn("--write goes on the batch", out)

    def test_unknown_command_and_text_before_first_block(self):
        vault = self.vault()
        code, out = batch(vault, "=== frobnicate\n")
        self.assertEqual(code, 1)
        self.assertIn("unknown command 'frobnicate'", out)
        code, out = batch(vault, "stray\n=== log\n")
        self.assertEqual(code, 1)
        self.assertIn("text before the first", out)

    def test_an_unquoted_apostrophe_refuses_only_its_block(self):
        vault = self.vault()
        code, out = batch(vault, f"=== section Ashworth's_Tent.md Log\n"
                                 f"x\n=== section {NPC_REL} \"Campaign Log\" "
                                 f"--append\n{S2}more.\n")
        self.assertEqual(code, 1, out)
        self.assertIn("## 1 section", out)
        self.assertIn("double quotes", out)
        self.assertIn("WOULD-ADD\t" + NPC_REL, out)    # block 2 still planned
        self.assertIn("fix block 1 ", out)

    def test_names_put_vault_spellings_everywhere_and_fill_the_table(self):
        vault = self.vault()
        text = (f"=== names --wrapup \"{WRAP_REL}\"\n"
                "Gosh\tGhosh\nBaijnath Mallik\tBaijnath Mullick\n"
                "Mallik\tMullick\nNobody\tSomebody\n"
                + WHOLE.replace("They went to the docks.",
                                "Baijnath Mallik dined at Gosh's house; "
                                "Mallik paid. Goshawks circled.")
                .replace("sold a calf.", "fed Mallik.")
                .replace('name: "Bola"', 'name: "Bola"\naliases: [Mallik]'))
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        wrap = read(vault, WRAP_REL)
        self.assertIn("Baijnath Mullick dined at Ghosh's house; Mullick "
                      "paid. Goshawks circled.", wrap)
        self.assertIn(S2 + "fed Mullick.", read(vault, BOLA))
        self.assertIn("aliases: [Mallik]", read(vault, BOLA))  # frontmatter
        self.assertIn("RENAMED\t\t\tMallik -> Mullick: 2 places", out)
        self.assertIn("names: 'Nobody' is in no block", out)
        self.assertIn("### Name Conflicts (export vs. vault canon)", wrap)
        self.assertIn("| Gosh | Ghosh | 1 place |", wrap)
        self.assertIn("| Baijnath Mallik | Baijnath Mullick | 1 place |",
                      wrap)
        self.assertNotIn("Nobody", wrap)
        # GM Notes, not the players' part.
        self.assertLess(wrap.index("## GM Notes"),
                        wrap.index("### Name Conflicts"))

    def test_names_apply_to_blocks_written_later_with_only(self):
        # --skip now, --only later: the later part, without the names
        # block, still gets the vault's spelling, and no second table.
        vault = self.vault()
        text = (f"=== names --wrapup \"{WRAP_REL}\"\nMallik\tMullick\n"
                + WHOLE.replace("sold a calf.", "fed Mallik."))
        code, out = batch(vault, text, "--write", "--skip", "5,6")
        self.assertEqual(code, 0, out)
        code, out = batch(vault, text, "--write", "--only", "5,6")
        self.assertEqual(code, 0, out)
        self.assertIn(S2 + "fed Mullick.", read(vault, BOLA))
        self.assertEqual(read(vault, WRAP_REL).count("Name Conflicts"), 1)

    def test_names_leave_a_log_rows_path_alone(self):
        vault = self.vault()
        (vault / "Characters/NPCs/Mallik_House.md").write_text(
            "---\ntype: location\n---\n\n# Mallik House\n\n## Campaign Log\n\n",
            encoding="utf-8")
        code, out = batch(vault, "=== names\nMallik\tMullick\n=== log\n"
                          "Characters/NPCs/Mallik_House.md\tCampaign Log\t"
                          + S2 + "Mallik dined.\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(S2 + "Mullick dined.",
                      read(vault, "Characters/NPCs/Mallik_House.md"))

    def test_a_name_both_a_new_and_an_old_note_answer_to_is_refused(self):
        vault = self.vault()
        hallam = NEW_NPC.replace('name: "Bola"',
                                 'name: "Bola"\naliases: [Hallam]')
        code, out = batch(vault, f"=== note-new {BOLA}\n{hallam}"
                          f"=== section Hallam \"Campaign Log\" --append\n"
                          f"{S2}x.\n")
        self.assertEqual(code, 1, out)
        self.assertIn("use the note's path", out)
        code, out = batch(vault, f"=== note-new {BOLA}\n{hallam}"
                          f"=== section {NPC_REL} \"Campaign Log\" --append\n"
                          f"{S2}x.\n")
        self.assertEqual(code, 0, out)

    def test_names_rows_must_be_pairs(self):
        vault = self.vault()
        code, out = batch(vault, "=== names\nGosh\n" + WHOLE)
        self.assertEqual(code, 1, out)
        self.assertIn("names row 1", out)

    def test_bad_arguments_are_a_refusal_not_an_exit(self):
        vault = self.vault()
        code, out = batch(vault, "=== stamp\n")
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)

    def test_several_files_are_one_batch(self):
        vault = self.vault()
        first, second = WHOLE.split("=== note-new")
        one = vault.parent / f"{vault.name}-1.txt"
        two = vault.parent / f"{vault.name}-2.txt"
        one.write_text(first, encoding="utf-8")
        two.write_text("=== note-new" + second, encoding="utf-8")
        self.addCleanup(one.unlink)
        self.addCleanup(two.unlink)
        code, out = run(vault, "batch", str(one), str(two), "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("## 4 note-new " + BOLA, out)
        self.assertIn(S2 + "sold a calf.", read(vault, BOLA))


if __name__ == "__main__":
    unittest.main()

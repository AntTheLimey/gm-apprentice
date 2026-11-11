#!/usr/bin/env python3
"""vault-write batch: many writes, one plan, one commit."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_vault_write import (  # noqa: E402
    INDEX, INDEX_REL, NPC, NPC_REL, S2, WRAP_REL, make_vault, read, run)


def batch(vault, text, *flags):
    path = vault.parent / f"{vault.name}-batch.txt"
    path.write_text(text, encoding="utf-8")
    return run(vault, "batch", str(path), *flags)


NEW_NPC = """---
type: npc
name: "Bola"
canon_status: DRAFT
---

# Bola

## Campaign Log

"""

BOLA = "Characters/NPCs/Bola.md"

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
        self.assertIn("blocks 2 are left out: does this block need one", out)

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
        self.assertIn("WOULD-RENAME\t\t\tMallik -> Mullick: 2 places", out
                      .replace("RENAMED", "WOULD-RENAME"))
        self.assertIn("names: 'Nobody' is in no block", out)
        self.assertIn("### Name Conflicts (export vs. vault canon)", wrap)
        self.assertIn("| Gosh | Ghosh | 1 place |", wrap)
        self.assertIn("| Baijnath Mallik | Baijnath Mullick | 1 place |",
                      wrap)
        self.assertNotIn("Nobody", wrap)
        # GM Notes, not the players' part.
        self.assertLess(wrap.index("## GM Notes"),
                        wrap.index("### Name Conflicts"))

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
        code, out = run(vault, "batch", str(one), str(two), "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("## 4 note-new " + BOLA, out)
        self.assertIn(S2 + "sold a calf.", read(vault, BOLA))


if __name__ == "__main__":
    unittest.main()

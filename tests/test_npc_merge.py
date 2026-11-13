#!/usr/bin/env python3
"""`vault_write.py npc-merge`: an NPC note merged into its PC note, one note
per character (#445). Frontmatter union and fill, every body mapping word
for word, fences kept, placeholders left behind, the archive move, links
rewritten by path only, refusals, dry run, and all-or-nothing writes.

Run: python3 -m pytest tests/test_npc_merge.py
"""

import io
import re
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import npc_merge  # noqa: E402
import vault_write  # noqa: E402

NPC_REL = "Characters/NPCs/Mira Vale.md"
PC_REL = "Characters/PCs/Mira Vale.md"
ARCHIVE_REL = "_archive/Characters/NPCs/Mira Vale (NPC).md"
PC_TEMPLATE = (ROOT / "skills" / "shared" / "templates" /
               "pc-generic.md").read_text(encoding="utf-8")

SECRETS = """### Secrets

<!-- spoiler -->
She is the Grey Hand.
<!-- /spoiler -->
"""

NPC = """---
type: npc
canon_status: DRAFT
aliases: [Mira]
gm_aliases: ["The Grey Hand"]
withheld: false
tags: [chapter-1, smuggler]
occupation: "Smuggler"
location: "[[The Docks]]"
portrait: "mira.png"
voice: "Low and quick."
relationships:
  - target: "[[Captain Rhee]]"
    type: works_for
    tone: wary
    strength: 6
    bidirectional: false
    description: "runs cargo"
  - target: "[[Old Tom]]"
    type: knows
  - target: "[[]]"
    type: knows
---

<!-- {braces} = replace with content. Everything above the gm-only
fence is what players see on the site: write it as the PCs know this
person. Omit a section rather than leave its heading empty. -->

## Overview

A smuggler who knows every tide. See [[Characters/NPCs/Mira Vale|her]].

## Appearance & Manner

{What the PCs notice first: one physical detail, one habit. Enough to
picture them, not a portrait.}

## History

Grew up on the [[The Docks|docks]].

### Early years

Ran with the gulls.

## Related

- **People:** [[Captain Rhee]] — her employer
- **Places:** [[{Name}]] — {…}

## Campaign Log

- **[[Session 01 - Arrival]]** — sold the party passage.
- **[[Session 02 - Storm]]** — fished them out of the bay.

<!-- gm-only -->

## GM Notes

STR 50 DEX 70

### Playing Them

- **Speech:** {accent, pace, a verbal tic}
- **Tell:** {the gesture you do at the table}
- **Line:** "{something they'd say the first time the PCs meet them}"

### Wants

Out of debt to Rhee.

""" + SECRETS + """
<!-- /gm-only -->
"""


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="npc-merge-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def snapshot(vault):
    return {p.relative_to(vault).as_posix(): p.read_bytes()
            for p in sorted(vault.rglob("*")) if p.is_file()}


def run(vault, *args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = vault_write.main([str(vault), "npc-merge", *args])
    return code, out.getvalue(), err.getvalue()


def base(extra=None, pc=PC_TEMPLATE):
    files = {NPC_REL: NPC, PC_REL: pc,
             "Sessions/Session 01 - Arrival.md":
                 "---\ntype: session\n---\n\nMet [[Mira Vale]] and "
                 "[[Characters/NPCs/Mira Vale|the smuggler]]; see "
                 "[her](../Characters/NPCs/Mira%20Vale.md).\n",
             "Characters/NPCs/Captain Rhee.md":
                 "---\ntype: npc\nrelationships:\n  - target: "
                 "\"[[Characters/NPCs/Mira Vale]]\"\n    type: employs\n---\n\n"
                 "## Overview\n\nEmploys [[Mira Vale]].\n",
             "Board.canvas":
                 '{"nodes":[{"id":"1","type":"file","file":'
                 '"Characters/NPCs/Mira Vale.md"}],"edges":[]}\n'}
    files.update(extra or {})
    return files


class MergeTests(unittest.TestCase):
    def merged(self, files=None):
        vault = make_vault(self, files or base())
        code, out, err = run(vault, "Mira Vale", PC_REL, "--write")
        self.assertEqual(code, 0, err)
        return vault, out

    def test_frontmatter_union_and_fill(self):
        vault, out = self.merged()
        pc = read(vault, PC_REL)
        fm = vault_write.vl.extract_frontmatter(pc)
        self.assertEqual(fm["aliases"], ["Mira"])
        self.assertEqual(fm["gm_aliases"], ["The Grey Hand"])
        self.assertEqual(fm["tags"], ["chapter-1", "smuggler"])
        self.assertEqual(fm["occupation"], "Smuggler")
        self.assertEqual(fm["portrait"], "mira.png")
        self.assertIn('voice: "Low and quick."', pc)
        self.assertEqual(fm["type"], "pc")
        # Relationships: the real ties, the template placeholder gone.
        self.assertIn('target: "[[Captain Rhee]]"', pc)
        self.assertIn('target: "[[Old Tom]]"', pc)
        self.assertNotIn('target: "[[]]"', pc)
        self.assertIn("NOT-CARRIED\tCharacters/NPCs/Mira Vale.md\tlocation",
                      out)
        self.assertNotIn("NOT-CARRIED\tCharacters/NPCs/Mira Vale.md\twithheld",
                         out)

    def test_pc_values_win_and_lists_dedupe(self):
        pc = PC_TEMPLATE.replace('portrait: ""', 'portrait: "pc.png"').replace(
            "aliases: []", "aliases:\n  - mira\n  - Captain Vale").replace(
            '  - target: "[[]]"\n    type: located_at',
            '  - target: "[[Captain Rhee]]"\n    type: works_for')
        vault, _ = self.merged(base(pc=pc))
        text = read(vault, PC_REL)
        fm = vault_write.vl.extract_frontmatter(text)
        self.assertEqual(fm["portrait"], "pc.png")
        self.assertEqual(fm["aliases"], ["mira", "Captain Vale"])
        self.assertEqual(text.count("[[Captain Rhee]]\"\n    type: works_for"), 1)
        self.assertIn('target: "[[Old Tom]]"', text)

    def test_npc_name_joins_aliases_when_names_differ(self):
        files = base()
        files["Characters/PCs/Mira Thorne.md"] = files.pop(PC_REL)
        vault = make_vault(self, files)
        code, out, err = run(vault, NPC_REL, "Characters/PCs/Mira Thorne.md",
                             "--write")
        self.assertEqual(code, 0, err)
        fm = vault_write.vl.extract_frontmatter(
            read(vault, "Characters/PCs/Mira Thorne.md"))
        self.assertEqual(fm["aliases"], ["Mira Vale", "Mira"])
        # A bare link to the old name names only the NPC: it follows.
        # with its words kept as the display text.
        self.assertIn("Met [[Mira Thorne|Mira Vale]]", read(
            vault, "Sessions/Session 01 - Arrival.md"))

    def test_body_mappings_word_for_word(self):
        vault, _ = self.merged()
        pc = read(vault, PC_REL)
        bg = pc.index("## Background")
        before = pc.index("### Before They Were a PC", bg)
        self.assertLess(before, pc.index("## Equipment"))
        self.assertIn("#### Overview\n\nA smuggler who knows every tide.", pc)
        self.assertIn("#### History\n\nGrew up on the [[The Docks|docks]].\n\n"
                      "##### Early years\n\nRan with the gulls.", pc)
        self.assertIn("## Relationships\n\n- **People:** [[Captain Rhee]] — "
                      "her employer\n", pc)
        self.assertIn("## Appearances\n\n- **[[Session 01 - Arrival]]** — sold "
                      "the party passage.\n- **[[Session 02 - Storm]]** — "
                      "fished them out of the bay.\n", pc)
        self.assertLess(pc.index("## Appearances"), pc.index("## Notes"))
        self.assertLess(pc.index("## Relationships"), pc.index("## Notes"))
        gm = pc.index("## GM Notes")
        self.assertIn("### Wants\n\nOut of debt to Rhee.", pc[gm:])
        self.assertIn("### Before They Were a PC\n\nSTR 50 DEX 70", pc[gm:])

    def test_fences_kept_byte_for_byte(self):
        vault, _ = self.merged()
        pc = read(vault, PC_REL)
        gm = pc[pc.index("## GM Notes"):]
        self.assertIn(SECRETS, gm)
        # The NPC's GM Notes sat in a gm-only fence: so do they here.
        self.assertIn("<!-- gm-only -->\n\n### Before They Were a PC", gm)
        self.assertTrue(gm.rstrip().endswith("<!-- /gm-only -->"))
        self.assertEqual(vault_write.parse(pc).problems, [])

    def test_placeholders_not_carried(self):
        vault, out = self.merged()
        pc = read(vault, PC_REL)
        self.assertNotIn("Appearance & Manner", pc)
        self.assertNotIn("Playing Them", pc)
        self.assertNotIn("{…}", pc)
        self.assertIn("SKIP\tCharacters/NPCs/Mira Vale.md\t§Appearance "
                      "& Manner\ttemplate placeholder", out)

    def test_existing_sections_receive_lines(self):
        pc = PC_TEMPLATE.replace(
            "## Notes\n",
            "## Appearances\n\n- **[[Session 03 - Joins]]** — joins the "
            "party.\n\n## Relationships\n\n- **People:** [[Captain Rhee]] — "
            "her employer\n- **People:** [[Ana]] — friend\n\n## Notes\n")
        vault, out = self.merged(base(pc=pc))
        text = read(vault, PC_REL)
        self.assertIn("- **[[Session 01 - Arrival]]** — sold the party "
                      "passage.\n- **[[Session 02 - Storm]]** — fished them "
                      "out of the bay.\n- **[[Session 03 - Joins]]**", text)
        self.assertEqual(text.count("[[Captain Rhee]] — her employer"), 1)
        self.assertEqual(text.count("## Appearances"), 1)
        self.assertIn("SKIP\tCharacters/PCs/Mira Vale.md\t§Relationships"
                      "\talready there", out)

    def test_missing_background_and_gm_notes_are_made(self):
        pc = "---\ntype: pc\naliases: []\n---\n\n## Stat Sheet\n\nST 10\n"
        vault, _ = self.merged(base(pc=pc))
        text = read(vault, PC_REL)
        self.assertLess(text.index("## Stat Sheet"), text.index("## Background"))
        self.assertIn("## Background\n\n### Before They Were a PC", text)
        self.assertIn("## GM Notes\n\n<!-- gm-only -->", text)
        self.assertEqual(vault_write.parse(text).problems, [])

    def test_archive_move_with_merged_into(self):
        vault, _ = self.merged()
        self.assertFalse((vault / NPC_REL).exists())
        arch = read(vault, ARCHIVE_REL)
        self.assertIn('merged_into: "[[Mira Vale]]"', arch)
        # Otherwise the note as it was.
        self.assertEqual(arch.replace('merged_into: "[[Mira Vale]]"\n', ""), NPC)

    def test_no_second_note_of_the_name(self):
        import graph_check
        vault, _ = self.merged()
        out = io.StringIO()
        with redirect_stdout(out):
            graph_check.main([str(vault), "ambiguous"])
        self.assertIn("# count: 0", out.getvalue())

    def test_path_links_rewritten_bare_links_untouched(self):
        vault, _ = self.merged()
        sess = read(vault, "Sessions/Session 01 - Arrival.md")
        self.assertIn("Met [[Mira Vale]] and "
                      "[[Characters/PCs/Mira Vale|the smuggler]]", sess)
        self.assertIn("[her](../Characters/PCs/Mira%20Vale.md)", sess)
        rhee = read(vault, "Characters/NPCs/Captain Rhee.md")
        self.assertIn('target: "[[Characters/PCs/Mira Vale]]"', rhee)
        self.assertIn("Employs [[Mira Vale]].", rhee)
        self.assertIn('"file":"Characters/PCs/Mira Vale.md"',
                      read(vault, "Board.canvas"))
        # The NPC's link to itself now names the PC.
        self.assertIn("See [[Characters/PCs/Mira Vale|her]].",
                      read(vault, PC_REL))

    def test_dry_run_writes_nothing(self):
        vault = make_vault(self, base())
        before = snapshot(vault)
        code, out, err = run(vault, "Mira Vale", "Mira Vale")
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(vault), before)
        self.assertIn("WOULD-MERGE\tCharacters/NPCs/Mira Vale.md\t-> "
                      "Characters/PCs/Mira Vale.md", out)
        self.assertIn("WOULD-ARCHIVE", out)
        self.assertIn("WOULD-RELINK", out)
        self.assertTrue(out.rstrip().splitlines()[-1].startswith("# 1 merge"))

    def test_refusals(self):
        vault = make_vault(self, base({"Places/Inn.md": "---\ntype: location\n---\n"}))
        before = snapshot(vault)
        for args in (["Characters/PCs/Mira Vale.md", PC_REL],   # not npc
                     [NPC_REL, "Places/Inn.md"],                 # not pc
                     ["Nobody", PC_REL],                          # missing
                     [NPC_REL, "Characters/PCs/Nobody.md"]):      # missing
            code, out, err = run(vault, *args, "--write")
            self.assertEqual(code, 1, (args, out, err))
            self.assertTrue(err.strip(), args)
        self.assertEqual(snapshot(vault), before)

    def test_refuses_when_archive_is_taken(self):
        vault = make_vault(self, base({ARCHIVE_REL: NPC}))
        code, _out, err = run(vault, NPC_REL, PC_REL)
        self.assertEqual(code, 1)
        self.assertIn("already exists", err)

    def test_usage_error(self):
        vault = make_vault(self, base())
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as e:
            vault_write.main([str(vault), "npc-merge", NPC_REL])
        self.assertEqual(e.exception.code, 2)

    def test_failure_mid_write_restores_everything(self):
        vault = make_vault(self, base())
        before = snapshot(vault)
        real = npc_merge.write_text_atomic
        calls = []

        def flaky(path, text):
            calls.append(path)
            if len(calls) == 3:
                raise npc_merge.StepFailed("disk full")
            real(path, text)
        with mock.patch.object(npc_merge, "write_text_atomic", flaky):
            code, _out, err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 1)
        self.assertIn("the vault is as it was", err)
        self.assertEqual(snapshot(vault), before)

    def test_failure_after_the_move_restores_everything(self):
        vault = make_vault(self, base())
        before = snapshot(vault)
        real = npc_merge.write_text_atomic

        def flaky(path, text):
            if "_archive" in str(path) and "merged_into" in text:
                raise npc_merge.StepFailed("disk full")
            real(path, text)
        with mock.patch.object(npc_merge, "write_text_atomic", flaky):
            code, _out, _err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 1)
        self.assertEqual(snapshot(vault), before)
        self.assertFalse((vault / "_archive").exists())

    def test_a_disk_that_stays_full_still_moves_the_note_back(self):
        vault = make_vault(self, base())
        before = snapshot(vault)
        real = npc_merge.write_text_atomic

        def flaky(path, text):
            if "_archive" in str(path):
                raise npc_merge.StepFailed("disk full")
            real(path, text)
        with mock.patch.object(npc_merge, "write_text_atomic", flaky):
            code, _out, err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 1)
        self.assertIn("the vault is as it was", err)
        self.assertEqual(snapshot(vault), before)

    def test_retired_pc_logs_to_further_appearances(self):
        pc = PC_TEMPLATE.replace("## Notes\n",
                                 "## Appearances\n\n- old\n\n"
                                 "## Further Appearances\n\n- later\n\n"
                                 "## Notes\n")
        vault = make_vault(self, {PC_REL: pc})
        out = io.StringIO()
        with redirect_stdout(out):
            code = vault_write.main(
                [str(vault), "log", "--write"],
                stdin=f"{PC_REL}\tCampaign Log\t- **[[Session 09]]** — back\n")
        self.assertEqual(code, 0, out.getvalue())
        text = read(vault, PC_REL)
        self.assertIn("## Further Appearances\n\n- later\n- **[[Session 09]]**"
                      " — back\n", text)


# Shaped like a real NPC note that never followed the template: its own
# sections, per-session update sections with H3s, an H1 title.
REAL = """---
type: npc
aliases: []
---

# Mira Vale

Lead line under the title.

## Overview

A fixer.

## Physical Description

Tall, scarred.

## Statistics

| STR | DEX |
|-----|-----|
| 50  | 70  |

## Skills

Persuade 60

## Personality

Wry.

## Agenda

Pay off Rhee.

## The Masquerade Beat

She dances with the Duke.

## Combat Notes

Fights dirty.

## Session Appearances

- **[[Session 01]]** — met the party.

## Session 3 Update — The Fire

### What changed

The warehouse burned.

## Session 11 Plan — The Ball

### Beats

Masks.

## DM Notes

Her real debt is to the Duke.

<!-- gm-only -->

## GM Notes

### Final Notes

She dies in act three.

<!-- /gm-only -->
"""

ORDER = ["Overview", "Physical Description", "Statistics", "Skills",
         "Personality", "Agenda", "The Masquerade Beat", "Combat Notes",
         "Session Appearances", "Session 3 Update — The Fire",
         "Session 11 Plan — The Ball"]


class NothingLeftBehindTests(unittest.TestCase):
    def merge(self, npc, pc=PC_TEMPLATE, extra=None):
        files = {NPC_REL: npc, PC_REL: pc}
        files.update(extra or {})
        vault = make_vault(self, files)
        code, out, err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 0, err)
        return read(vault, PC_REL), out

    def test_a_real_shaped_note_carries_every_section_in_order(self):
        pc, out = self.merge(REAL)
        bg = pc[pc.index("### Before They Were a PC"):pc.index("## Equipment")]
        self.assertTrue(bg.index("Lead line under the title.")
                        < bg.index("#### Overview"))
        at = [bg.index(f"#### {t}\n") for t in ORDER]
        self.assertEqual(at, sorted(at))
        for t in ORDER:     # one row names each section carried
            self.assertIn(f"ADDED\t{PC_REL}\t\u00a7Background/Before They "
                          f"Were a PC\t{t}\n", out)
        self.assertIn("##### What changed\n\nThe warehouse burned.", bg)
        self.assertIn("| STR | DEX |\n|-----|-----|\n| 50  | 70  |", bg)
        self.assertNotIn("# Mira Vale\n", pc)
        # Hidden on the NPC's page (player_site.hide.sections): GM Notes here.
        gm = pc[pc.index("## GM Notes"):]
        self.assertIn("### DM Notes\n\nHer real debt is to the Duke.", gm)
        self.assertIn("### Final Notes\n\nShe dies in act three.", gm)
        self.assertNotIn("Her real debt", pc[:pc.index("## GM Notes")])

    def test_fence_around_a_mapped_section_is_kept(self):
        for title, where in (("History", "## Background"),
                             ("Campaign Log", "## Appearances"),
                             ("Related", "## Relationships"),
                             ("Sworn Enemies", "## Background")):
            with self.subTest(title):
                npc = (f"---\ntype: npc\n---\n\n## Overview\n\nShown.\n\n"
                       f"<!-- gm-only -->\n\n## {title}\n\n- Secret line\n\n"
                       f"<!-- /gm-only -->\n")
                pc, _ = self.merge(npc)
                part = pc[pc.index(where):]
                self.assertRegex(part, r"<!-- gm-only -->\n\n(#### "
                                 + re.escape(title) + r"\n\n)?- Secret line"
                                 r"\n\n<!-- /gm-only -->")
                self.assertEqual(vault_write.parse(pc).problems, [])
                states, _ = vault_write.vl.scan_body(pc, ())
                shown = [st.line for st in states if st.published]
                self.assertFalse(any("Secret line" in ln for ln in shown))

    def test_dedupe_never_unfences_a_line(self):
        npc = ("---\ntype: npc\n---\n\n## Campaign Log\n\n- shared\n"
               "<!-- spoiler -->\n- shared secret\n<!-- /spoiler -->\n")
        pc = PC_TEMPLATE.replace("## Notes\n", "## Appearances\n\n- shared\n"
                                 "<!-- spoiler -->\n- shared secret\n"
                                 "<!-- /spoiler -->\n\n## Notes\n")
        text, _ = self.merge(npc, pc)
        states, _ = vault_write.vl.scan_body(text, ())
        shown = [st.line for st in states if st.published]
        self.assertFalse(any("shared secret" in ln for ln in shown))
        self.assertEqual(text.count("- shared\n"), 1)
        self.assertEqual(vault_write.parse(text).problems, [])

    def test_a_marker_only_lead_is_not_a_placeholder(self):
        npc = ("---\ntype: npc\n---\n\n## GM Notes\n<!-- gm-only -->\n\n"
               "### Secrets\n\nThe truth.\n\n<!-- /gm-only -->\n")
        pc, _ = self.merge(npc)
        gm = pc[pc.index("## GM Notes"):]
        self.assertIn("<!-- gm-only -->\n\n### Secrets\n\nThe truth.\n\n"
                      "<!-- /gm-only -->", gm)

    def test_withheld_npc_names_stay_secret(self):
        npc = NPC.replace("withheld: false", "withheld: true")
        files = base({NPC_REL: npc})
        files["Characters/PCs/Mira Thorne.md"] = files.pop(PC_REL)
        vault = make_vault(self, files)
        code, _out, err = run(vault, NPC_REL, "Characters/PCs/Mira Thorne.md",
                              "--write")
        self.assertEqual(code, 0, err)
        fm = vault_write.vl.extract_frontmatter(
            read(vault, "Characters/PCs/Mira Thorne.md"))
        self.assertEqual(fm["aliases"], [])
        self.assertEqual(fm["gm_aliases"], ["Mira Vale", "Mira",
                                            "The Grey Hand"])

    def test_a_table_cell_gets_a_bare_link(self):
        import vault_check
        files = base({"Notes/Table.md": "---\ntype: note\n---\n\n| who |\n"
                      "|---|\n| [[Mira Vale]] |\n"})
        files["Characters/PCs/Mira Thorne.md"] = files.pop(PC_REL)
        vault = make_vault(self, files)
        code, _out, err = run(vault, NPC_REL, "Characters/PCs/Mira Thorne.md",
                              "--write")
        self.assertEqual(code, 0, err)
        text = read(vault, "Notes/Table.md")
        self.assertIn("| [[Mira Thorne]] |", text)
        self.assertEqual(vault_check.table_findings("Notes/Table.md", text), [])
        # Outside a table the words stay as display text.
        self.assertIn("Met [[Mira Thorne|Mira Vale]]",
                      read(vault, "Sessions/Session 01 - Arrival.md"))

    def test_scalar_aliases_are_kept(self):
        pc = PC_TEMPLATE.replace("aliases: []", "aliases: Captain Vale")
        text, _ = self.merge(NPC, pc)
        fm = vault_write.vl.extract_frontmatter(text)
        self.assertEqual(fm["aliases"], ["Captain Vale", "Mira"])

    def test_flow_style_pc_relationships_are_refused(self):
        pc = PC_TEMPLATE.replace(
            'relationships:\n  - target: "[[]]"\n    type: located_at\n'
            '    tone: neutral\n    strength: 5\n    bidirectional: false\n'
            '    description: ""\n',
            'relationships: [{target: "[[Old Tom]]", type: knows}]\n')
        self.assertIn("relationships: [{", pc)
        vault = make_vault(self, {NPC_REL: NPC, PC_REL: pc})
        before = snapshot(vault)
        code, _out, err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 1)
        self.assertIn("flow list", err)
        self.assertEqual(snapshot(vault), before)

    def test_flow_style_npc_relationships_are_listed_not_carried(self):
        npc = ("---\ntype: npc\nrelationships: [{target: \"[[A]]\", "
               "type: knows}]\n---\n\n## Overview\n\nHi.\n")
        text, out = self.merge(npc)
        self.assertIn("NOT-CARRIED\tCharacters/NPCs/Mira Vale.md\t"
                      "relationships", out)
        self.assertNotIn("[[A]]", text)

    def test_a_custom_comment_is_carried(self):
        npc = ("---\ntype: npc\n---\n\n## GM Notes\n\n"
               "<!-- Owes the Duke three favours. -->\n")
        text, _ = self.merge(npc)
        self.assertIn("<!-- Owes the Duke three favours. -->", text)

    def test_loose_prose_keeps_each_fence(self):
        npc = ("---\ntype: npc\n---\n\nPublic introduction.\n"
               "<!-- gm-only -->\nSecret introduction.\n\n## History\n\n"
               "Secret history.\n<!-- /gm-only -->\n")
        text, _ = self.merge(npc)
        states, _ = vault_write.vl.scan_body(text, ())
        shown = "".join(st.line for st in states if st.published)
        self.assertIn("Public introduction.", shown)
        self.assertNotIn("Secret introduction", shown)
        self.assertNotIn("Secret history", shown)
        self.assertIn("Secret introduction.", text)
        self.assertIn("Secret history.", text)
        self.assertEqual(vault_write.parse(text).problems, [])

    def test_repeated_mapped_sections_accumulate(self):
        npc = ("---\ntype: npc\n---\n\n## Campaign Log\n\n- one\n\n"
               "## Related\n\n- r1\n\n## Campaign Log\n\n- two\n\n"
               "## Related\n\n- r2\n")
        text, _ = self.merge(npc)
        app = text[text.index("## Appearances"):text.index("## Notes")]
        self.assertIn("- one", app)
        self.assertIn("- two", app)
        rel = text[text.index("## Relationships"):text.index("## Appearances")]
        self.assertIn("- r1", rel)
        self.assertIn("- r2", rel)

    def test_never_inserted_into_a_code_block(self):
        pc = PC_TEMPLATE.replace("## Notes\n", "## Appearances\n\n```\n"
                                 "- example\n```\n\n- real\n\n## Notes\n")
        npc = ("---\ntype: npc\n---\n\n<!-- gm-only -->\n\n## Campaign Log"
               "\n\n- secret visit\n\n<!-- /gm-only -->\n")
        text, _ = self.merge(npc, pc)
        self.assertIn("```\n- example\n```", text)
        states, _ = vault_write.vl.scan_body(text, ())
        self.assertFalse(any("secret visit" in st.line for st in states
                             if st.in_code or st.published))
        self.assertLess(text.index("secret visit"), text.index("- real"))

    def test_a_retired_pc_gets_further_appearances(self):
        pc = PC_TEMPLATE.replace("status: alive", "status: retired").replace(
            "## Notes\n", "## Appearances\n\n- old\n\n## Notes\n")
        vault = make_vault(self, {PC_REL: pc})
        out = io.StringIO()
        with redirect_stdout(out):
            code = vault_write.main(
                [str(vault), "log", "--write"],
                stdin=f"{PC_REL}\tCampaign Log\t- **[[Session 09]]** — back\n")
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("new section (retired PC)", out.getvalue())
        text = read(vault, PC_REL)
        self.assertIn("## Appearances\n\n- old\n\n## Further Appearances\n\n"
                      "- **[[Session 09]]** — back\n\n## Notes", text)

    def test_a_retired_pc_with_a_campaign_log_logs_later(self):
        pc = PC_TEMPLATE.replace("status: alive", "status: retired").replace(
            "## Notes\n", "## Campaign Log\n\n- old\n\n## Notes\n")
        vault = make_vault(self, {PC_REL: pc})
        with redirect_stdout(io.StringIO()):
            vault_write.main([str(vault), "log", "--write"],
                             stdin=f"{PC_REL}\tCampaign Log\t- new\n")
        text = read(vault, PC_REL)
        self.assertIn("## Further Appearances\n\n- new\n", text)
        self.assertNotIn("- old\n- new", text)

    def test_further_appearances_is_made_outside_a_spoiler(self):
        pc = PC_TEMPLATE.replace("status: alive", "status: retired").replace(
            "## Notes\n", "<!-- spoiler -->\n\n## Notes\n").replace(
            "## GM Notes\n", "<!-- /spoiler -->\n\n## GM Notes\n")
        self.assertEqual(vault_write.parse(pc).problems, [])
        vault = make_vault(self, {PC_REL: pc})
        with redirect_stdout(io.StringIO()):
            vault_write.main([str(vault), "log", "--write"],
                             stdin=f"{PC_REL}\tCampaign Log\t- seen again\n")
        text = read(vault, PC_REL)
        states, _ = vault_write.vl.scan_body(text, ())
        shown = [st.line for st in states if st.published]
        self.assertIn("## Further Appearances", shown)
        self.assertTrue(any("seen again" in ln for ln in shown))

    def test_a_living_pc_keeps_appearances(self):
        pc = PC_TEMPLATE.replace("## Notes\n", "## Appearances\n\n- old\n\n"
                                 "## Notes\n")
        vault = make_vault(self, {PC_REL: pc})
        with redirect_stdout(io.StringIO()):
            vault_write.main([str(vault), "log", "--write"],
                             stdin=f"{PC_REL}\tCampaign Log\t- new\n")
        text = read(vault, PC_REL)
        self.assertNotIn("Further Appearances", text)
        self.assertIn("- old\n- new\n", text)


SITE_CONFIG = "---\npublish:\n  site: true\n  mode: player\n---\n"


@unittest.skipUnless(shutil.which("node"), "needs Node")
class SiteTests(unittest.TestCase):
    """A vault with a site: the publish list follows, as for a rename."""

    def test_bare_links_follow_the_site_link_map(self):
        from layouts import write_config
        files = {"Characters/NPCs/Bo.md": "---\ntype: npc\n---\n\n## Overview"
                 "\n\nA boatman.\n",
                 "Characters/PCs/Bo Hale.md": PC_TEMPLATE,
                 "Places/Bo.md": "---\ntype: location\n---\n\nA town.\n",
                 "Sessions/S1.md": "---\ntype: session\n---\n\nWent to "
                 "[[Bo]].\n"}
        vault = make_vault(self, files)
        code, out, err = run(vault, "Characters/NPCs/Bo.md",
                             "Characters/PCs/Bo Hale.md")
        self.assertEqual(code, 0, err)
        self.assertIn("UNSURE\tSessions/S1.md", out)   # no site: unsure
        write_config(vault, SITE_CONFIG)
        asked = []
        real = npc_merge.relink._ask_publish

        def spy(*a, **k):
            asked.append(a[5] if len(a) > 5 else ())
            return real(*a, **k)
        with mock.patch.object(npc_merge.relink, "_ask_publish", spy):
            code, out, err = run(vault, "Characters/NPCs/Bo.md",
                                 "Characters/PCs/Bo Hale.md")
        self.assertEqual(code, 0, err)
        # The link map is asked for every bare spelling, as relink asks it.
        self.assertIn(("Bo",), asked)
        made = []
        real_res = npc_merge.relink._Resolver

        def resolver(*a, **k):
            made.append(a)
            return real_res(*a, **k)
        with mock.patch.object(npc_merge.relink, "_Resolver", resolver):
            run(vault, "Characters/NPCs/Bo.md", "Characters/PCs/Bo Hale.md")
        self.assertIn("Bo", made[0][2])          # its owners
        self.assertIsNotNone(made[0][3])         # what the site publishes

    def test_publish_list_entry_follows_the_merge(self):
        from layouts import write_config
        files = base({"_meta/publish-list.yaml":
                      f"publishing:\n  - {NPC_REL}\nexcluded: []\n"
                      f"needs_decision: []\n"})
        vault = make_vault(self, files)
        write_config(vault, SITE_CONFIG)
        code, out, err = run(vault, NPC_REL, PC_REL)
        self.assertEqual(code, 0, err)
        self.assertIn(f"WOULD-REPUBLISH\t_meta/publish-list.yaml\t"
                      f"{NPC_REL} -> {PC_REL}", out)
        code, out, err = run(vault, NPC_REL, PC_REL, "--write")
        self.assertEqual(code, 0, err)
        self.assertIn(f"  - {PC_REL}\n", read(vault, "_meta/publish-list.yaml"))
        self.assertNotIn(NPC_REL, read(vault, "_meta/publish-list.yaml"))


if __name__ == "__main__":
    unittest.main()

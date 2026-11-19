#!/usr/bin/env python3
"""`vault_check.py npc-stats`: NPC notes whose stat block is missing or a
placeholder (#725). Every shape of a block left unbuilt gives its row; a
block of the NPC's own gives none; a stock block is enough for any NPC but
a major one (`companion: true`, or in a brief's Key NPCs). `--plan` keeps
the NPCs a Plan's scenes name, `--played` those play has shown. All the
NPCs here are invented.

Run: python3 -m pytest tests/test_vault_check_npc_stats.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import npc_stats  # noqa: E402
import vault_check as vc  # noqa: E402

STATS = ROOT / "skills" / "shared" / "templates" / "npc-stats"
SLOT = ("{STAT BLOCK: vault setup replaces this paragraph with the block for\n"
        "the vault's system (campaign-organizer references/vault-setup.md).}")


def npc(gm: str = "", extra: str = "", body: str = "") -> str:
    return (f"---\ntype: npc\nstatus: alive\n{extra}---\n\n## Overview\n\n"
            f"A lamplighter on the canal.\n{body}\n<!-- gm-only -->\n\n"
            f"## GM Notes\n\n{gm}\n\n### Playing Them\n\n- **Speech:** slow\n"
            f"\n<!-- /gm-only -->\n")


DND_FILLED = """### Stats

**Wenna Brisk**
*Medium Humanoid, Neutral*

**AC** 13 · **Initiative** +2 (12) · **HP** 27 (6d8) · **Speed** 30 ft.

|     | Score | Mod | Save |
|-----|-------|-----|------|
| STR | 10 | +0 | +0 |
| DEX | 14 | +2 | +2 |
| CON | 12 | +1 | +1 |
| INT | 11 | +0 | +0 |
| WIS | 16 | +3 | +5 |
| CHA | 13 | +1 | +1 |

**Tactics:** stays behind the party and heals; flees when bloodied."""

FITD_FILLED = """### Stats

**Orrin Tallow** — ink-stained, never sits

**Drives:** coin, quiet, revenge
**Traits:** patient, petty, exact
**Tier** II · **Quality** fine tools · **Scale** alone
**Good at:** forging seals, passing as Gentry, waiting
**Harm / threat:** a clock, "Owes the Lampblacks" (4); pays later or bleeds"""


def make(case, notes: dict[str, str], system: str | None = "dnd-5e") -> Path:
    root = Path(tempfile.mkdtemp(prefix="vc-npc-stats-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    if system:
        notes = {"_Campaign/Overview.md":
                 f"---\ntype: campaign_overview\ngame_system: {system}\n---\n",
                 **notes}
    for rel, text in notes.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return root


def rows(vault: Path, plan=None, played=False) -> list[str]:
    found, error = npc_stats.check_npc_stats(vault, plan, played)
    assert error is None, error
    return found


def run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = vc.main(argv)
    return code, out.getvalue(), err.getvalue()


class ShapeTests(unittest.TestCase):
    """What `classify` makes of a block, note by note."""

    def why(self, text: str, system: str | None = "dnd-5e-2024"):
        found = npc_stats.classify(text, system)
        return found[0] if found else None

    def test_no_block_is_missing(self):
        self.assertEqual(self.why(npc()), "missing")

    def test_the_templates_slot_is_a_placeholder(self):
        self.assertEqual(self.why(npc(SLOT)), "placeholder")

    def test_every_systems_unfilled_block_is_a_placeholder(self):
        paths = sorted(STATS.glob("*.md"))
        self.assertTrue(paths)
        for path in paths:
            with self.subTest(path.name):
                block = path.read_text(encoding="utf-8")
                self.assertEqual(self.why(npc(block)), "placeholder")

    def test_a_short_block_with_a_field_left_is_a_placeholder(self):
        verdict = npc_stats.classify(npc("### Stats\n\n**AC** {12} · HP 9"),
                                     "dnd-5e-2024")
        self.assertEqual(verdict[0], "placeholder")
        self.assertIn("{12}", verdict[1])

    def test_a_full_block_with_an_optional_field_left_is_its_own(self):
        # Review finding 2: the numbers decide before any `{…}` left over.
        for name, block in (
                ("dnd", DND_FILLED + "\n\n**Bonus Actions / Reactions**\n"
                        "- ***{Name}.*** {what it does}"),
                ("gurps", "### Stats\n\nST 12 · DX 12 · IQ 10 · HT 11\n"
                          "HP 12 · Will 10 · Per 10 · FP 11\n"
                          "Dodge 8 · Parry 10 (Broadsword) · Block {—} · DR 2"),
                ("coc", "### Stats\n\n| STR | CON | SIZ | DEX |\n"
                        "|-----|-----|-----|-----|\n| 45 | 50 | 60 | 40 |\n\n"
                        "**HP** 11 · **MP** 14 · **SAN** 60 · "
                        "**Luck** {n or —}")):
            with self.subTest(name):
                self.assertIsNone(self.why(npc(block)))

    def test_a_full_block_with_a_table_group_row_is_its_own(self):
        # Review finding 3: a weapons table's `| **Melee** | | |` row.
        block = ("### Stats\n\n**HP** 13 · **MP** 10 · **SAN** 55\n\n"
                 "| Weapon | Skill | Damage |\n|---|---|---|\n"
                 "| **Melee** | | |\n| Brawl | 55% | 1D3+DB |\n"
                 "| Club | 40% | 1D6+DB |\n")
        self.assertIsNone(self.why(npc(block)))

    def test_an_empty_stat_heading_is_blank(self):
        self.assertEqual(self.why(npc("### Stats\n")), "blank")

    def test_an_empty_score_table_is_blank(self):
        # Review: six numbers elsewhere do not fill the scores.
        table = ("| STR | CON | SIZ | DEX |\n|-----|-----|-----|-----|\n"
                 "|     |     |     |     |\n")
        for line in ("**HP** 22 · **AC** 12 · **Speed** 30 ft.",
                     "**HP** 22 · **AC** 12 · **Speed** 30 ft. · "
                     "Initiative +2 · Passive Perception 13 · Proficiency +2"):
            with self.subTest(line):
                block = f"### Stats\n\n{line}\n\n{table}"
                self.assertEqual(self.why(npc(block)), "blank")
        dnd = DND_FILLED.replace("| CHA | 13 | +1 | +1 |", "| CHA | | | |")
        self.assertEqual(self.why(npc(dnd)), "blank")

    def test_a_short_block_with_an_empty_score_row_is_blank(self):
        block = ("### Stats\n\n| STR | DEX |\n|---|---|\n| 10 | |\n"
                 "| WIS |  |\n")
        self.assertEqual(self.why(npc(block)), "blank")

    def test_later_words_in_the_slot_are_a_placeholder(self):
        for said in ("Stat blocks built when session 3 is prepped.",
                     "Stats TBD.", "Stat block to follow.",
                     "Stats later, once we know the party's level."):
            with self.subTest(said):
                self.assertEqual(self.why(npc(said)), "placeholder")
                self.assertEqual(self.why(npc(f"### Stats\n\n{said}")),
                                 "placeholder")

    def test_later_words_name_the_line(self):
        verdict = npc_stats.classify(
            npc("Stat blocks built when session 3 is prepped."))
        self.assertIn("built when session 3 is prepped", verdict[1])

    def test_a_stock_name_is_stock(self):
        for said in ("### Stats\n\nAs Priest.",
                     "### Stats\n\nAs a Priest, with a mace.",
                     "Use the Acolyte stat block.",
                     "### Stats\n\nPriest (SRD), with 30 HP.",
                     "### Stat Block\n\nStat block: Veteran"):
            with self.subTest(said):
                self.assertEqual(self.why(npc(said)), "stock")

    def test_a_block_of_its_own_gives_no_verdict(self):
        self.assertIsNone(self.why(npc(DND_FILLED)))

    def test_a_stock_base_with_its_own_numbers_is_its_own(self):
        block = ("### Stats\n\nAs Priest (SRD), with these changes:\n"
                 "- AC 15, HP 45, Speed 30 ft.\n- WIS 18, CHA 14\n"
                 "- *Mace.* +4 to hit, 1d6 + 2 bludgeoning")
        self.assertIsNone(self.why(npc(block)))

    def test_a_filled_fitd_block_is_its_own(self):
        # Few numbers, a "later" and an "as Gentry": still a block.
        self.assertIsNone(self.why(npc(FITD_FILLED), "fitd"))

    def test_a_stock_line_in_a_long_block_is_stock(self):
        # Review: a stock name on a line of its own, with prose after it.
        block = ("### Stats\n\nAs Priest.\n\nCarries a heavy mace.\n"
                 "Flees when the candles go out.\nKnows every crypt door.")
        self.assertEqual(self.why(npc(block)), "stock")

    def test_a_todo_line_in_a_long_fitd_block_is_a_placeholder(self):
        # Review: a deferral on a line of its own, with planning after it.
        block = ("### Stats\n\nTODO\n\n- wants the ledger back\n"
                 "- carries a sword-cane\n- knows the canal gangs")
        self.assertEqual(self.why(npc(block), "fitd"), "placeholder")

    def test_a_long_fitd_block_opening_with_as_is_not_stock(self):
        # Review finding 8: in a long block only stat-word lines are read
        # for a stock name, not the first line.
        block = FITD_FILLED.replace("ink-stained, never sits",
                                    "poses as a Bluecoat Sergeant")
        self.assertIsNone(self.why(npc(block), "fitd"))

    def test_words_with_no_numbers_under_a_stat_heading(self):
        # Review finding 1: no numbers, no stock name: not a block, in
        # every system but FitD.
        for said in ("To be determined at session prep.", "TODO",
                     "Will be statted for session 3.", "Not statted yet.",
                     "(placeholder)", "A tough old soldier, slow but strong."):
            with self.subTest(said):
                block = npc(f"### Stats\n\n{said}")
                self.assertEqual(self.why(block), "placeholder")
                self.assertEqual(self.why(block, None), "placeholder")
        self.assertIsNone(self.why(
            npc("### Stats\n\nA tough old soldier, slow but strong."),
            "fitd"))

    def test_a_stock_name_beats_later_words_on_its_line(self):
        # Review finding 4: a stock block is enough for an "other" NPC.
        for said in ("Use the Veteran stat block; she may gain a level later.",
                     "Bandit Captain (SRD). Loyalty pending."):
            with self.subTest(said):
                self.assertEqual(self.why(npc(f"### Stats\n\n{said}")),
                                 "stock")
                self.assertEqual(self.why(npc(said)), "stock")

    def test_an_embedded_block_counts(self):
        self.assertIsNone(self.why(npc("### Stats\n\n![[Monk Stats]]")))

    def test_an_old_top_level_stats_heading_counts(self):
        block = ("## Stats (CoC 7e)\n- **STR:** 60 | **CON:** 55 | "
                 "**SIZ:** 75 | **DEX:** 40\n- **HP:** 13 | **SAN:** 50")
        self.assertIsNone(self.why(npc(body=block)))

    def test_a_block_with_no_heading_counts(self):
        self.assertIsNone(self.why(npc("ST 11 · DX 12 · IQ 10 · HT 11")))

    def test_status_is_not_a_stat_heading(self):
        self.assertEqual(self.why(npc(body="## Status\n\nIn hiding.")),
                         "missing")


class RowTests(unittest.TestCase):
    def test_rows_say_why_and_who(self):
        v = make(self, {
            "NPCs/Brother Hale.md": npc(
                "Stat blocks built when session 3 is prepped.",
                extra="companion: true\n"),
            "NPCs/Abbot Corwin.md": npc("### Stats\n\nAs Priest."),
            "NPCs/Brother Tam.md": npc(),
            "Adventures/Lantern Abbey/Lantern Abbey.md":
                "---\ntype: adventure-brief\n---\n\n## Key NPCs\n\n"
                "### [[Abbot Corwin]]\n\n- **Role:** the abbot\n\n"
                "## Locations\n\n[[Brother Tam]] keeps the gate.\n",
        })
        self.assertEqual(rows(v), [
            "STOCK\tNPCs/Abbot Corwin.md\tmajor (key-npc): names a stock "
            "block (\"As Priest.\") — needs a full workup",
            "PLACEHOLDER\tNPCs/Brother Hale.md\tmajor (companion): says it "
            "comes later (\"Stat blocks built when session 3 is prepped.\") "
            "— needs a full workup",
            "MISSING\tNPCs/Brother Tam.md\tother: no stat block — a stock "
            "block will do",
        ])

    def test_a_stock_block_is_enough_for_another_npc(self):
        v = make(self, {"NPCs/Brother Tam.md": npc("Use the Acolyte stat block.")})
        self.assertEqual(rows(v), [])

    def test_companion_and_key_npc_both_named(self):
        v = make(self, {
            "NPCs/Sela.md": npc(extra="companion: true\n"),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n---\n\n"
                                 "## Key NPCs\n\n- [[Sela]], the guide\n",
        })
        self.assertEqual(len(rows(v)), 1)
        self.assertIn("\tmajor (companion, key-npc): ", rows(v)[0])

    def test_a_key_npc_is_found_by_alias(self):
        v = make(self, {
            "NPCs/Sela Marrow.md": npc(extra="aliases: [Sela]\n"),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n---\n\n"
                                 "## Key NPCs\n\n- [[Sela|the guide]]\n",
        })
        self.assertIn("major (key-npc)", rows(v)[0])

    def test_links_inside_a_key_npc_entry_are_not_major(self):
        # Review finding 5: only the entry's own NPC is major.
        v = make(self, {
            "NPCs/Martha Hale.md": npc(),
            "NPCs/Tom Hale.md": npc(),
            "NPCs/Silas Marsh.md": npc(),
            "NPCs/Ida Crane.md": npc(),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n---\n\n"
                "## Key NPCs\n\n### [[Martha Hale]]\n\n- **Connection:** "
                "Her husband [[Tom Hale]] vanished.\n\n### Silas Marsh "
                "(the harbourmaster)\n\n- Owes [[Ida Crane]] money.\n",
        })
        found = {r.split("\t")[1]: r.split("\t")[2].split(":")[0]
                 for r in rows(v)}
        self.assertEqual(found, {"NPCs/Martha Hale.md": "major (key-npc)",
                                 "NPCs/Silas Marsh.md": "major (key-npc)",
                                 "NPCs/Tom Hale.md": "other",
                                 "NPCs/Ida Crane.md": "other"})

    def test_an_unlinked_bold_key_npc_is_major(self):
        # Review finding 5: a list item or paragraph led by a bold name.
        v = make(self, {
            "NPCs/Abbot Gerrit.md": npc(),
            "NPCs/Sela Marrow.md": npc(extra="aliases: [Sela]\n"),
            "NPCs/Prior Wend.md": npc(),
            "NPCs/Old Tobin.md": npc(),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n---\n\n"
                "## Key NPCs\n\n- **Abbot Gerrit** — head of the priory, "
                "rival of [[Prior Wend]]\n  and friend of [[Old Tobin]].\n"
                "- **Sela:** the guide\n",
        })
        found = {r.split("\t")[1]: r.split("\t")[2].split(":")[0]
                 for r in rows(v)}
        self.assertEqual(found["NPCs/Abbot Gerrit.md"], "major (key-npc)")
        self.assertEqual(found["NPCs/Sela Marrow.md"], "major (key-npc)")
        self.assertEqual(found["NPCs/Prior Wend.md"], "other")
        self.assertEqual(found["NPCs/Old Tobin.md"], "other")

    def test_a_key_npc_paragraph_is_named_by_its_first_link(self):
        v = make(self, {
            "NPCs/Wren.md": npc(), "NPCs/Cole.md": npc(),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n---\n\n"
                "## Key NPCs\n\n[[Wren]] runs the ferry; she hates\n"
                "[[Cole]].\n",
        })
        found = {r.split("\t")[1]: r.split("\t")[2].split(":")[0]
                 for r in rows(v)}
        self.assertEqual(found, {"NPCs/Wren.md": "major (key-npc)",
                                 "NPCs/Cole.md": "other"})

    def test_an_embed_of_a_missing_note_is_missing(self):
        # Review: embed syntax alone is not a block; its note must exist.
        v = make(self, {
            "NPCs/Brother Tam.md": npc("### Stats\n\n![[Monk Stats]]"),
            "NPCs/Brother Hale.md": npc("### Stats\n\n![[Monk Stats#Stats]]"),
            "NPCs/Sister Ilse.md": npc("### Stats\n\n![[Abbess Card.png]]"),
            "NPCs/Old Vessel.md": npc("### Stats\n\n![[Vessel Stats]]"),
            "NPCs/Dr. Pell.md": npc("### Stats\n\n![[Dr. Pell Stats]]"),
            "Stats/Monk Stats.md": "---\ntype: note\n---\n\nST 10 · DX 11\n",
            "Stats/Dr. Pell Stats.md": "---\ntype: note\n---\n\nST 9\n",
            "Images/Abbess Card.png": "png",
        })
        self.assertEqual(rows(v), [
            "MISSING\tNPCs/Old Vessel.md\tother: embeds a note that is not "
            "in the vault (\"![[Vessel Stats]]\") — a stock block will do"])

    def test_a_built_npc_gives_no_row(self):
        v = make(self, {"NPCs/Wenna.md": npc(DND_FILLED,
                                             extra="companion: true\n")})
        self.assertEqual(rows(v), [])

    def test_copies_merged_notes_and_other_types_give_no_row(self):
        v = make(self, {
            "_archive/NPCs/Old.md": npc(),
            "_QA/NPCs/Report Copy.md": npc(),
            "_midwife/abbey/npcs/Draft.md": npc(),
            "_Templates/_Template_NPC.md": npc(SLOT),
            "NPCs/Merged.md": npc(extra='merged_into: "[[Someone]]"\n'),
            "Locations/Abbey.md": "---\ntype: location\n---\n",
        })
        self.assertEqual(rows(v), [])

    def test_the_dead_are_left_out_even_when_a_plan_names_them(self):
        # #776: prep runs --plan, and a Plan names the dead too (a body
        # found, a grave visited).
        dead = npc().replace("status: alive", "status: dead")
        plan = ("---\ntype: session-plan\n---\n\n## Planned Scenes\n\n"
                "### The Crevasse\n\nThey find [[Tam Rowe]]'s body.\n")
        v = make(self, {"NPCs/Tam Rowe.md": dead, "Plans/S3 Plan.md": plan})
        self.assertEqual(rows(v), [])
        self.assertEqual(rows(v, plan="Plans/S3 Plan.md"), [])
        fated = npc("### Behind the Scenes\n\n- **Dead.** Fell in the "
                    "crevasse.")
        v = make(self, {"NPCs/Tam Rowe.md": fated, "Plans/S3 Plan.md": plan})
        self.assertEqual(rows(v, plan="Plans/S3 Plan.md"), [])

    def test_a_plan_may_be_given_by_its_full_path(self):
        plan = ("---\ntype: session-plan\n---\n\n## Planned Scenes\n\n"
                "### The Crypt\n\n[[Old Vessel]] waits.\n")
        v = make(self, {"NPCs/Old Vessel.md": npc(), "Plans/S3 Plan.md": plan})
        self.assertEqual(rows(v, plan=str(v / "Plans" / "S3 Plan.md")),
                         rows(v, plan="Plans/S3 Plan.md"))
        self.assertEqual(len(rows(v, plan="Plans/S3 Plan.md")), 1)

    def test_a_dead_npc_who_rises_takes_a_later_fate_and_is_kept(self):
        # A fate beats status: the players buried him; he walks the crypt.
        risen = npc("### Behind the Scenes\n\n- **Dead.** Buried at the "
                    "pass.\n- **Risen; walks the crypt.** The Lodge raised "
                    "him.").replace("status: alive", "status: dead")
        plan = ("---\ntype: session-plan\n---\n\n## Planned Scenes\n\n"
                "### The Crypt\n\n[[Old Vessel]] rises.\n")
        v = make(self, {"NPCs/Old Vessel.md": risen, "Plans/S3 Plan.md": plan})
        self.assertEqual(len(rows(v)), 1)
        self.assertEqual(len(rows(v, plan="Plans/S3 Plan.md")), 1)

    def fate(self, *bullets: str) -> list[str]:
        """The rows for one NPC, `status: alive`, whose GM Notes Behind
        the Scenes holds `bullets`."""
        scenes = "\n".join(bullets)
        v = make(self, {"NPCs/Tam Rowe.md":
                        npc(f"### Behind the Scenes\n\n{scenes}")})
        return rows(v)

    def test_a_hidden_dead_fate_is_left_out(self):
        self.assertEqual(self.fate(
            "- **[[Session 01 - The Pass]]** — **Dead.** Fell in the "
            "crevasse; the party think he went for help."), [])
        self.assertEqual(self.fate(
            "- **Dead, under the ice.** Nobody saw it."), [])

    def test_a_struck_dead_fate_and_a_later_one_is_kept(self):
        self.assertEqual(len(self.fate(
            "- ~~**[[Session 01 - The Pass]]** — **Dead.** Fell in the "
            "crevasse.~~",
            "- **[[Session 02 - The Thaw]]** — **Alive, freed by the "
            "party.** He was in the ice crypt all along.")), 1)

    def test_a_later_unstruck_fate_beats_an_earlier_dead(self):
        self.assertEqual(len(self.fate(
            "- **[[Session 01 - The Pass]]** — **Dead.** So it seemed.",
            "- **[[Session 02 - The Thaw]]** — **Alive, freed by the "
            "party.**")), 1)

    def test_a_later_bullet_with_no_fate_keeps_the_dead_fate(self):
        self.assertEqual(self.fate(
            "- **[[Session 01 - The Pass]]** — **Dead.** Fell in the "
            "crevasse.",
            "- **[[Session 02 - The Thaw]]** — his dog came home alone.",
            "- **Motive:** he owed the Lodge."), [])

    def test_a_bold_lead_that_is_no_sentence_keeps_the_dead_fate(self):
        self.assertEqual(self.fate(
            "- **Dead.** Fell through the ice.",
            "- **The Lodge** recovered his coat."), [])

    def test_a_struck_fate_inside_the_bold_is_no_fate(self):
        self.assertEqual(self.fate(
            "- **Dead.** Fell through the ice.",
            "- **~~Alive.~~** The report was wrong."), [])

    def test_only_death_leaves_an_npc_out(self):
        for fate in ("**Captive, in the ice crypt.**", "**Missing.**",
                     "**Turned; serves the Lodge now.**"):
            with self.subTest(fate=fate):
                self.assertEqual(len(self.fate(
                    f"- **[[Session 01 - The Pass]]** — {fate}")), 1)

    def test_death_in_passing_is_no_fate(self):
        for line in (
                "- **[[Session 01 - The Pass]]** — he told the party his "
                "brother was dead. **Dead** men tell no tales, he said.",
                "- **[[Session 01 - The Pass]]** — the dead dog was his.",
                "- He fears the **Dead.**"):
            with self.subTest(line=line):
                self.assertEqual(len(self.fate(line)), 1)

    def test_a_dead_fate_elsewhere_in_the_note_is_no_fate(self):
        v = make(self, {"NPCs/Tam Rowe.md": npc(
            "### Secrets\n\n- **[[Session 01 - The Pass]]** — **Dead.**")})
        self.assertEqual(len(rows(v)), 1)


PLAN = """---
type: session-plan
---

## NPC Quick Reference

[[Quiet Ned]] is in the table only.

## Planned Scenes

### The Gate

[[Brother Tam]] bars the way.

### [[Chapel Fight]]

## Contingency Scenes

### If they run

[[Abbot Corwin]] sends the hounds.

## Open Questions

[[Lost Pilgrim]]?
"""


class PlanTests(unittest.TestCase):
    def vault(self):
        return make(self, {
            "NPCs/Brother Tam.md": npc(),
            "NPCs/Abbot Corwin.md": npc(),
            "NPCs/Sister Ilse.md": npc(),
            "NPCs/Quiet Ned.md": npc(),
            "NPCs/Lost Pilgrim.md": npc(),
            "NPCs/Nobody.md": npc(),
            "Chapters/C1/Scenes/Chapel Fight.md":
                "---\ntype: scene\nstatus: planned\nentities: "
                "[\"[[Sister Ilse]]\"]\n---\n\nThe monks fight.\n",
            "Chapters/C1/Sessions/Session 03 - Plan.md": PLAN,
        })

    def test_the_plans_scenes_and_scene_notes(self):
        names = {r.split("\t")[1] for r in rows(
            self.vault(), plan="Chapters/C1/Sessions/Session 03 - Plan.md")}
        self.assertEqual(names, {"NPCs/Brother Tam.md", "NPCs/Abbot Corwin.md",
                                 "NPCs/Sister Ilse.md"})

    def test_the_plan_by_name_or_link(self):
        v = self.vault()
        for given in ("Session 03 - Plan", "[[Session 03 - Plan]]"):
            self.assertEqual(len(rows(v, plan=given)), 3)

    def test_an_unknown_plan_is_an_error(self):
        found, error = npc_stats.check_npc_stats(self.vault(), "No Such Plan")
        self.assertEqual(found, [])
        self.assertIn("no note of that name", error)

    def test_two_notes_of_the_name_ask_for_a_path(self):
        v = make(self, {"A/Plan.md": PLAN, "B/Plan.md": PLAN})
        _found, error = npc_stats.check_npc_stats(v, "Plan")
        self.assertIn("2 Plans of that name", error)

    def test_a_note_that_is_not_a_plan_is_an_error(self):
        # Review: an NPC or session note is not read as a Plan with no gaps.
        v = make(self, {
            "NPCs/Brother Tam.md": npc(),
            "Chapters/C1/Sessions/Session 04.md":
                "---\ntype: session\n---\n\n[[Brother Tam]]\n"})
        for given in ("NPCs/Brother Tam.md", "Session 04"):
            with self.subTest(given):
                found, error = npc_stats.check_npc_stats(v, given)
                self.assertEqual(found, [])
                self.assertIn("is not a Session Plan", error)


class PlayedTests(unittest.TestCase):
    def test_wrapups_and_played_scenes(self):
        v = make(self, {
            "NPCs/Met At Inn.md": npc(),
            "NPCs/In The Fight.md": npc(),
            "NPCs/In A Paused Scene.md": npc(),
            "NPCs/In Planned Scene.md": npc(),
            "NPCs/Never Seen.md": npc(),
            "Chapters/C1/Sessions/S1 Wrap-Up.md":
                "---\ntype: session-wrap-up\n---\n\nThey met [[Met At Inn]].\n",
            "Chapters/C1/Scenes/Fight.md":
                "---\ntype: scene\nstatus: played\n---\n\n[[In The Fight]]\n",
            "Chapters/C1/Scenes/Paused.md":
                "---\ntype: scene\nstatus: paused\nplayed_in: "
                "[\"[[Session 01]]\"]\n---\n\n[[In A Paused Scene]]\n",
            "Chapters/C1/Scenes/Later.md":
                "---\ntype: scene\nstatus: planned\n---\n\n"
                "[[In Planned Scene]]\n",
        })
        names = {r.split("\t")[1] for r in rows(v, played=True)}
        self.assertEqual(names, {"NPCs/Met At Inn.md", "NPCs/In The Fight.md",
                                 "NPCs/In A Paused Scene.md"})


class CommandTests(unittest.TestCase):
    def test_the_command_prints_rows_and_the_system(self):
        v = make(self, {"NPCs/Brother Tam.md": npc()})
        code, out, _err = run([str(v), "npc-stats"])
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), [
            "## npc-stats", "# count: 1",
            "MISSING\tNPCs/Brother Tam.md\tother: no stat block — a stock "
            "block will do",
            "# system: dnd-5e-2024 (block: "
            "shared/templates/npc-stats/dnd-5e-2024.md)"])

    def test_regency_reads_the_coc_block(self):
        v = make(self, {}, system="regency-cthulhu")
        _code, out, _err = run([str(v), "npc-stats"])
        self.assertIn("# system: coc-7e-regency (block: "
                      "shared/templates/npc-stats/coc-7e.md)", out)

    def test_no_system_says_so(self):
        v = make(self, {"NPCs/Brother Tam.md": npc()}, system=None)
        _code, out, _err = run([str(v), "npc-stats"])
        self.assertIn("# system: none recorded", out)
        self.assertIn("# count: 1", out)

    def test_an_undecided_brief_is_no_system(self):
        # Review: the Midwife's `system: undecided` is not a system id.
        v = make(self, {
            "NPCs/Brother Tam.md": npc(),
            "Adventures/A/A.md": "---\ntype: adventure-brief\n"
                                 "system: undecided\n---\n"}, system=None)
        _code, out, _err = run([str(v), "npc-stats"])
        self.assertIn("# system: none recorded", out)

    def test_a_bad_plan_exits_2(self):
        v = make(self, {})
        code, out, err = run([str(v), "npc-stats", "--plan", "Nope"])
        self.assertEqual(code, 2)
        self.assertIn("no note of that name", err)
        self.assertEqual(out, "")

    def test_the_options_need_the_command(self):
        v = make(self, {})
        for extra in (["--played"], ["--plan", "X"]):
            code, _out, err = run([str(v), "names", *extra])
            self.assertEqual(code, 2)
            self.assertIn("need the npc-stats command", err)

    def test_not_part_of_all(self):
        v = make(self, {"NPCs/Brother Tam.md": npc()})
        self.assertNotIn("## npc-stats", run([str(v), "all"])[1])


if __name__ == "__main__":
    unittest.main()

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

    def why(self, text: str):
        found = npc_stats.classify(text)
        return found[0] if found else None

    def test_no_block_is_missing(self):
        self.assertEqual(self.why(npc()), "missing")

    def test_the_templates_slot_is_a_placeholder(self):
        self.assertEqual(self.why(npc(SLOT)), "placeholder")

    def test_every_systems_unfilled_block_is_a_placeholder(self):
        for path in sorted(STATS.glob("*.md")):
            with self.subTest(path.name):
                block = path.read_text(encoding="utf-8")
                self.assertEqual(self.why(npc(block)), "placeholder")

    def test_one_field_left_is_a_placeholder(self):
        block = DND_FILLED.replace("13 · **Initiative**", "{12} · **Initiative**")
        verdict = npc_stats.classify(npc(block))
        self.assertEqual(verdict[0], "placeholder")
        self.assertIn("{12}", verdict[1])

    def test_an_empty_stat_heading_is_blank(self):
        self.assertEqual(self.why(npc("### Stats\n")), "blank")

    def test_an_empty_score_table_is_blank(self):
        block = ("### Stats\n\n**HP** 22 · **AC** 12 · **Speed** 30 ft.\n\n"
                 "| STR | CON | SIZ | DEX |\n|-----|-----|-----|-----|\n"
                 "|     |     |     |     |\n")
        self.assertEqual(self.why(npc(block)), "blank")

    def test_a_score_row_left_empty_is_blank(self):
        block = DND_FILLED.replace("| WIS | 16 | +3 | +5 |", "| WIS |  |  |  |")
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
        self.assertIsNone(self.why(npc(FITD_FILLED)))

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

    def test_the_dead_are_left_out_unless_a_plan_names_them(self):
        dead = npc().replace("status: alive", "status: dead")
        plan = ("---\ntype: session-plan\n---\n\n## Planned Scenes\n\n"
                "### The Crypt\n\n[[Old Vessel]] rises.\n")
        v = make(self, {"NPCs/Old Vessel.md": dead, "Plans/S3 Plan.md": plan})
        self.assertEqual(rows(v), [])
        self.assertEqual(len(rows(v, plan="Plans/S3 Plan.md")), 1)


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
        self.assertIn("2 notes of that name", error)


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

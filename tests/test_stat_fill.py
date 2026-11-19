"""`gma stat-fill`: a stock D&D creature's SRD numbers, written into the note
that names it. All the NPCs here are invented.

Run: python3 -m pytest tests/test_stat_fill.py
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

import stat_fill  # noqa: E402

OLD_CREDIT = ("*Stats condensed from the SRD 5.2 by Wizards of the Coast LLC "
              "(dndbeyond.com/srd), CC-BY 4.0 "
              "(creativecommons.org/licenses/by/4.0/legalcode).*")


def npc(stats: str, extra: str = "", type_: str = "npc") -> str:
    body = f"### Stats\n\n{stats}\n\n" if stats else ""
    return (f"---\ntype: {type_}\nstatus: alive\n{extra}---\n\n## Overview\n\n"
            f"A lamplighter on the canal.\n\n<!-- gm-only -->\n\n"
            f"## GM Notes\n\n{body}### Playing Them\n\n- **Speech:** slow\n\n"
            f"<!-- /gm-only -->\n")


class FillCase(unittest.TestCase):
    system = "dnd-5e-2024"

    def vault(self, notes: dict[str, str], system: str | None = None) -> Path:
        root = Path(tempfile.mkdtemp(prefix="stat-fill-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        notes = {"_Campaign/Overview.md":
                 f"---\ntype: campaign_overview\n"
                 f"game_system: {system or self.system}\n---\n", **notes}
        for rel, text in notes.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        return root

    def run_cli(self, vault: Path, *args: str) -> tuple[int, list[str]]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            code = stat_fill.main([str(vault), *args])
        return code, out.getvalue().splitlines()

    def read(self, vault: Path, rel: str) -> str:
        return (vault / rel).read_text(encoding="utf-8")


class LookupPickTests(FillCase):
    def filled(self, stats: str) -> str:
        v = self.vault({"Tomas.md": npc(stats)})
        _code, rows = self.run_cli(v, "Tomas.md")
        return rows[0].split("\t")[-1]

    def test_the_noun_at_the_end_wins_over_a_leading_word(self):
        self.assertEqual(self.filled("A tough Commoner (SRD)."), "Commoner")

    def test_a_leading_adjective_run_does_not_win(self):
        self.assertEqual(
            self.filled("A tough old Guard (SRD), half blind."), "Guard")

    def test_the_last_word_of_a_long_name_wins(self):
        self.assertEqual(self.filled("Old Cat Burglar Spy (SRD)."), "Spy")

    def test_the_docstring_example(self):
        srd = stat_fill.load_srd(stat_fill.SYSTEMS_DIR) \
            if hasattr(stat_fill, "SYSTEMS_DIR") else None
        if not srd:
            self.skipTest("no SRD creature files")
        self.assertEqual(
            stat_fill.lookup(srd, "A tough Commoner", False).name, "Commoner")

    def test_as_stays_exact(self):
        srd = stat_fill.load_srd(stat_fill.SYSTEMS_DIR) \
            if hasattr(stat_fill, "SYSTEMS_DIR") else None
        if not srd:
            self.skipTest("no SRD creature files")
        self.assertIsNone(stat_fill.lookup(srd, "A tough Commoner", True))


class FillTests(FillCase):
    def test_fills_ice_mephit_in_the_vault_stats_form(self):
        v = self.vault({"Tomas.md": npc("Ice Mephit (SRD).")})
        code, rows = self.run_cli(v, "Tomas.md", "--write")
        self.assertEqual((code, rows[0]), (0, "FILLED\tTomas.md\tIce Mephit"))
        text = self.read(v, "Tomas.md")
        for want in ("### Stats\n\n**Ice Mephit**\n\n**AC** 11",
                     "**AC** 11 · **Initiative** +1 (11) · **HP** 21 (6d6)",
                     "| DEX | 13 | +1 | +1 |",
                     "***Frost Breath (Recharge 6).***",
                     "### Playing Them"):
            self.assertIn(want, text)
        self.assertNotIn("Ice Mephit (SRD)", text)
        self.assertNotIn("Stats condensed", text)
        self.assertNotIn("creativecommons", text)

    def test_fills_young_white_dragon_with_the_srd_initiative_not_dex(self):
        v = self.vault({"Wyrmling.md": npc("As Young White Dragon.")})
        self.run_cli(v, "Wyrmling.md", "--write")
        text = self.read(v, "Wyrmling.md")
        self.assertIn("**Initiative** +3 (13)", text)
        self.assertIn("| DEX | 10 | +0 | +3 |", text)

    def test_a_legendary_creature_writes_legendary_actions_and_resistance(self):
        v = self.vault({"Wyrm.md": npc("As Adult Red Dragon.")})
        self.run_cli(v, "Wyrm.md", "--write")
        text = self.read(v, "Wyrm.md")
        self.assertIn("**Legendary Actions (3)**", text)
        self.assertIn("Legendary Resistance (3/Day)", text)
        self.assertIn("***Fire Breath (Recharge 5–6).***", text)

    def test_refuses_a_major_npc(self):
        v = self.vault({"Tomas.md": npc("As Bandit.", "companion: true\n")})
        before = self.read(v, "Tomas.md")
        code, rows = self.run_cli(v, "Tomas.md", "--write")
        self.assertTrue(rows[0].startswith("REFUSED-MAJOR\tTomas.md\t"), rows)
        self.assertIn("companion", rows[0])
        self.assertEqual(self.read(v, "Tomas.md"), before)

    def test_refuses_a_key_npc_of_the_brief(self):
        v = self.vault({
            "Tomas.md": npc("As Bandit."),
            "Brief.md": "---\ntype: adventure-brief\n---\n\n## Key NPCs\n\n"
                        "- **[[Tomas]]** — the lamplighter\n"})
        _code, rows = self.run_cli(v, "Tomas.md")
        self.assertTrue(rows[0].startswith("REFUSED-MAJOR"), rows)
        self.assertIn("key-npc", rows[0])

    def test_leaves_numbers_alone(self):
        own = ("**AC** 13 · **Initiative** +2 (12) · **HP** 27 (6d8)\n\n"
               "| STR | 10 | +0 | +0 |\n| DEX | 14 | +2 | +2 |\n"
               "| CON | 12 | +1 | +1 |\n| INT | 11 | +0 | +0 |\n"
               "| WIS | 16 | +3 | +5 |\n| CHA | 13 | +1 | +1 |")
        v = self.vault({"Wenna.md": npc(own)})
        before = self.read(v, "Wenna.md")
        _code, rows = self.run_cli(v, "Wenna.md", "--write")
        self.assertTrue(rows[0].startswith("UNCHANGED\tWenna.md"), rows)
        self.assertEqual(self.read(v, "Wenna.md"), before)

    def test_unknown_creature(self):
        v = self.vault({"Tomas.md": npc("As Gloomwraith.")})
        before = self.read(v, "Tomas.md")
        _code, rows = self.run_cli(v, "Tomas.md", "--write")
        self.assertTrue(rows[0].startswith("NOT-FOUND\tTomas.md"), rows)
        self.assertIn("Gloomwraith", rows[0])
        self.assertEqual(self.read(v, "Tomas.md"), before)

    def test_as_matches_srd_names_only(self):
        v = self.vault({"Tomas.md": npc("As Bandit.")})
        _c, rows = self.run_cli(v, "Tomas.md", "--as", "Bandi")
        self.assertTrue(rows[0].startswith("NOT-FOUND"), rows)
        _c, rows = self.run_cli(v, "Tomas.md", "--as", "Guard")
        self.assertEqual(rows[0], "FILLED\tTomas.md\tGuard")

    def test_fills_a_wolf(self):
        v = self.vault({"Pup.md": npc("As Wolf.", type_="creature")})
        _c, rows = self.run_cli(v, "Pup.md", "--write")
        self.assertEqual(rows[0], "FILLED\tPup.md\tWolf")
        text = self.read(v, "Pup.md")
        self.assertIn("**AC** 12 · **Initiative** +2 (12) · **HP** 11 (2d8+2)",
                      text)

    def test_the_note_name_is_the_last_resort(self):
        v = self.vault({"Ghoul.md": npc("", type_="creature")})
        _c, rows = self.run_cli(v, "Ghoul.md", "--write")
        self.assertEqual(rows[0], "FILLED\tGhoul.md\tGhoul")
        self.assertIn("**AC** 12", self.read(v, "Ghoul.md"))

    def test_keeps_the_gms_words_from_the_stock_line(self):
        v = self.vault({
            "A.md": npc("Commoner (SRD). Blinded."),
            "B.md": npc("As a Bandit, with a knife")})
        self.run_cli(v, "A.md", "B.md", "--write")
        self.assertIn("**As written:** Commoner (SRD). Blinded.",
                      self.read(v, "A.md"))
        self.assertIn("**As written:** As a Bandit, with a knife",
                      self.read(v, "B.md"))

    def test_the_templates_stock_line_keeps_its_words_without_its_label(self):
        v = self.vault({
            "A.md": npc("**Stat block:** Commoner (SRD), with a knife."),
            "B.md": npc("**Stat block:** Commoner (SRD).")})
        self.run_cli(v, "A.md", "B.md", "--write")
        a, b = self.read(v, "A.md"), self.read(v, "B.md")
        self.assertIn("**As written:** Commoner (SRD), with a knife.", a)
        self.assertNotIn("Stat block:**", a)
        self.assertNotIn("As written", b)
        self.assertNotIn("Stat block", b)

    def test_the_stock_quote_has_no_stray_label_marks(self):
        stock = stat_fill.npc_stats._stock("**Stat block:** Commoner (SRD).")
        self.assertEqual((stock.line, stock.name, stock.words),
                         ("Commoner (SRD).", "Commoner", ""))

    def test_a_sentence_that_wraps_the_name_is_kept_whole(self):
        v = self.vault({"A.md": npc(
            "No stats needed: he poses as a Priest and never fights.")})
        self.run_cli(v, "A.md", "--write")
        self.assertIn("**As written:** No stats needed: he poses as a Priest "
                      "and never fights.", self.read(v, "A.md"))

    def test_a_placeholder_line_with_words_keeps_them_under_as_written(self):
        v = self.vault({"A.md": npc(
            "Stats to come; he fights with a boat hook and never alone.")})
        _c, rows = self.run_cli(v, "A.md", "--as", "Commoner", "--write")
        self.assertEqual(rows[0], "FILLED\tA.md\tCommoner")
        self.assertIn("**As written:** Stats to come; he fights with a boat "
                      "hook and never alone.", self.read(v, "A.md"))

    def test_a_sentence_with_later_in_it_is_not_a_deferral(self):
        line = ("Later, if it comes to blows, he uses the cellar stairs to "
                "his advantage.")
        self.assertEqual(stat_fill.kept_beside_placeholder([line]), [line])
        v = self.vault({"A.md": npc(line)})
        self.run_cli(v, "A.md", "--as", "Commoner", "--write")
        text = self.read(v, "A.md")
        self.assertIn(f"\n{line}\n", text)
        self.assertNotIn("As written", text)

    def test_the_block_leaves_off_a_size_line(self):
        v = self.vault({"A.md": npc("As Commoner.")})
        self.run_cli(v, "A.md", "--write")
        text = self.read(v, "A.md")
        self.assertIn("**Commoner**", text)
        self.assertNotRegex(text, r"\*(?:Tiny|Small|Medium|Large) ")

    def test_keeps_the_gms_words_beside_a_placeholder(self):
        v = self.vault({"Wolf.md": npc(
            "Stats to come.\n\nHunts in packs; flees at half HP.",
            type_="creature")})
        _c, rows = self.run_cli(v, "Wolf.md", "--write")
        self.assertEqual(rows[0], "FILLED\tWolf.md\tWolf")
        text = self.read(v, "Wolf.md")
        self.assertIn("Hunts in packs; flees at half HP.", text)
        self.assertNotIn("Stats to come", text)
        self.assertIn("**AC** 12", text)

    def test_a_deferral_word_in_the_gms_sentence_is_not_the_deferral_line(self):
        old = ["Ambushes travellers later at dusk.", "", "Stats to come.", "",
               "Flees at half HP."]
        self.assertEqual(stat_fill.kept_beside_placeholder(old),
                         ["Ambushes travellers later at dusk.", "",
                          "Flees at half HP."])

    def test_a_gm_table_beside_a_placeholder_is_kept(self):
        old = ["Stats to come.", "", "| Roll | Loot |", "|---|---|",
               "| 1 | a rusty knife |"]
        out = stat_fill.kept_beside_placeholder(old)
        self.assertEqual(out, old[2:])

    def test_a_pasted_template_beside_a_stock_name_leaves_nothing_of_itself(self):
        tpl = (stat_fill.Path(stat_fill.__file__).parent.parent / "templates"
               / "npc-stats" / "dnd-5e-2024.md").read_text()
        body = tpl.split("### Stats\n", 1)[1]
        v = self.vault({"Tomas.md": npc(body, type_="npc")})
        self.run_cli(v, "Tomas.md", "--as", "Bandit", "--write")
        text = self.read(v, "Tomas.md")
        self.assertIn("**AC** 12", text)
        for gone in ("{", "| STR |       |", "**Bonus Actions / Reactions**"):
            self.assertNotIn(gone, text)

    def test_a_gm_bare_bold_line_beside_a_placeholder_survives(self):
        old = ["Stats to come.", "", "**Boss fight**", "", "**Phase two**",
               "", "**Traits**", "", "**Actions**"]
        self.assertEqual(stat_fill.kept_beside_placeholder(old),
                         ["**Boss fight**", "", "**Phase two**"])

    def test_a_blank_score_table_is_dropped_and_a_gm_table_kept(self):
        old = ["|     | Score |", "|-----|-------|", "| STR |       |", "",
               "| Roll | Loot |", "|---|---|", "| 1 | a knife |"]
        self.assertEqual(stat_fill.kept_beside_placeholder(old), old[4:])

    def test_a_gm_table_with_an_empty_row_is_kept_whole(self):
        old = ["| Roll | Loot |", "|---|---|", "| 1 | a knife |", "| | |",
               "| 3 | a rope |"]
        self.assertEqual(stat_fill.kept_beside_placeholder(old), old)

    def test_the_coc_empty_score_table_is_dropped(self):
        old = ["| STR | CON |", "|-----|-----|", "|     |     |", "", "Kept."]
        self.assertEqual(stat_fill.kept_beside_placeholder(old), ["Kept."])

    def test_a_gm_weapon_table_with_a_group_row_is_kept(self):
        old = ["Stats to come.", "", "| Weapon | Dmg |", "|---|---|",
               "| **Melee** | |", "| Knife | 1d4 |"]
        self.assertEqual(stat_fill.kept_beside_placeholder(old), old[2:])

    def test_the_stock_lines_own_qualifier_is_kept(self):
        v = self.vault({"A.md": npc("A canal Commoner (SRD).")})
        self.run_cli(v, "A.md", "--write")
        text = self.read(v, "A.md")
        self.assertIn("**As written:** A canal Commoner (SRD).", text)
        self.assertIn("**Commoner**", text)

    def test_a_slot_with_no_closing_brace_is_refused_not_eaten(self):
        text = npc("").replace(
            "## GM Notes\n\n", "## GM Notes\n\n{STAT BLOCK: forgot to close\n\n")
        v = self.vault({"A.md": text})
        code, rows = self.run_cli(v, "A.md", "--as", "Commoner", "--write")
        self.assertEqual(code, 1, rows)
        self.assertEqual(self.read(v, "A.md"), text)

    def test_a_stock_heading_beside_a_missing_embed_fills_as_discovery_says(self):
        text = npc("As Bandit.").replace(
            "### Playing Them", "### Statistics\n\n![[Missing Stats]]\n\n"
            "### Playing Them")
        v = self.vault({"A.md": text})
        found = stat_fill.npc_stats.stock_rows(v)
        self.assertEqual(len(found), 1, found)
        code, rows = self.run_cli(v, "A.md", "--write")
        self.assertTrue(rows[0].startswith("FILLED\tA.md"), rows)

    def test_a_note_that_only_embeds_a_missing_note_says_so(self):
        v = self.vault({"A.md": npc("![[Missing Stats]]")})
        code, rows = self.run_cli(v, "A.md", "--write")
        self.assertIn("embeds a note that is not in the vault", rows[0])
        self.assertNotIn("already has numbers", rows[0])

    def test_keeps_a_tuned_hp_line(self):
        v = self.vault({"Tomas.md": npc("Bandit (SRD)\n\nHP 5 after the fall.")})
        self.run_cli(v, "Tomas.md", "--write")
        text = self.read(v, "Tomas.md")
        self.assertIn("**HP** 11 (2d8+2)", text)
        self.assertLess(text.index("**HP** 11"), text.index("HP 5 after"))

    def test_an_old_credit_line_is_left_alone(self):
        own = ("**AC** 13 · **Initiative** +2 (12) · **HP** 27 (6d8)\n\n"
               "| STR | 10 | +0 | +0 |\n| DEX | 14 | +2 | +2 |\n"
               "| CON | 12 | +1 | +1 |\n| INT | 11 | +0 | +0 |\n"
               "| WIS | 16 | +3 | +5 |\n| CHA | 13 | +1 | +1 |\n\n"
               + OLD_CREDIT)
        v = self.vault({"Wenna.md": npc(own)})
        before = self.read(v, "Wenna.md")
        self.run_cli(v, "Wenna.md", "--write")
        self.assertEqual(self.read(v, "Wenna.md"), before)

    def test_a_note_with_no_stats_section_gets_one_first_in_gm_notes(self):
        v = self.vault({"Tomas.md": npc("")})
        self.run_cli(v, "Tomas.md", "--as", "Commoner", "--write")
        text = self.read(v, "Tomas.md")
        self.assertLess(text.index("## GM Notes"), text.index("### Stats"))
        self.assertLess(text.index("### Stats"), text.index("### Playing"))
        self.assertIn("<!-- /gm-only -->", text)

    def test_the_templates_slot_paragraph_is_replaced(self):
        slot = ("{STAT BLOCK: vault setup replaces this paragraph with the "
                "block for\nthe vault's system (campaign-organizer "
                "references/vault-setup.md).}")
        text = npc("").replace("## GM Notes\n\n",
                               f"## GM Notes\n\n{slot}\n\n")
        v = self.vault({"Tomas.md": text})
        self.run_cli(v, "Tomas.md", "--as", "Commoner", "--write")
        out = self.read(v, "Tomas.md")
        self.assertNotIn("STAT BLOCK", out)
        self.assertIn("### Stats", out)

    def test_dry_run_writes_nothing(self):
        v = self.vault({"Tomas.md": npc("As Bandit.")})
        before = self.read(v, "Tomas.md")
        _c, rows = self.run_cli(v, "Tomas.md")
        self.assertEqual(rows[0], "FILLED\tTomas.md\tBandit")
        self.assertIn("dry run", rows[-1])
        self.assertEqual(self.read(v, "Tomas.md"), before)

    def test_a_second_run_changes_nothing(self):
        v = self.vault({"Tomas.md": npc("As Bandit.")})
        self.run_cli(v, "Tomas.md", "--write")
        done = self.read(v, "Tomas.md")
        _c, rows = self.run_cli(v, "Tomas.md", "--write")
        self.assertTrue(rows[0].startswith("UNCHANGED"), rows)
        self.assertEqual(self.read(v, "Tomas.md"), done)

    def test_a_note_without_gm_notes_is_an_error_and_nothing_is_written(self):
        v = self.vault({"A.md": npc("As Bandit."),
                        "B.md": "---\ntype: npc\n---\n\nStats: as Bandit.\n"})
        before = self.read(v, "A.md")
        code, rows = self.run_cli(v, "A.md", "B.md", "--write")
        self.assertEqual(code, 1)
        self.assertTrue(any(r.startswith("ERROR\tB.md") for r in rows), rows)
        self.assertEqual(self.read(v, "A.md"), before)


class SourceTests(FillCase):
    def test_reads_only_the_top_level_monster_files(self):
        systems = Path(tempfile.mkdtemp(prefix="stat-fill-sys-"))
        self.addCleanup(shutil.rmtree, systems, ignore_errors=True)
        folder = systems / "dnd-5e-2024"
        shutil.copytree(stat_fill.SYSTEMS_DIR / "dnd-5e-2024", folder,
                        ignore=shutil.ignore_patterns("personal"))
        (folder / "personal").mkdir()
        for name in ("monsters-cr0-1.md", "animals.md"):
            (folder / "personal" / name).write_text(
                "**Gloomwraith** | Undead | M | CR 0 (0 XP)\n"
                "AC 99 | HP 99 (9d8) | Init +0 (10) | Speed 30 ft.\n"
                "STR 10 DEX 10 CON 10 INT 10 WIS 10 CHA 10\n\n",
                encoding="utf-8")
        self.assertEqual(
            [p.name for p in stat_fill.srd_files(systems)],
            sorted(p.name for p in folder.glob("monsters-cr*.md"))
            + ["animals.md"])
        self.assertNotIn("gloomwraith", stat_fill.load_srd(systems))
        v = self.vault({"Tomas.md": npc("As Gloomwraith.")})
        _c, rows = self.run_cli(v, "Tomas.md", "--systems-dir", str(systems))
        self.assertTrue(rows[0].startswith("NOT-FOUND"), rows)

    def test_no_srd_files_says_so(self):
        empty = Path(tempfile.mkdtemp(prefix="stat-fill-none-"))
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        v = self.vault({"Tomas.md": npc("As Bandit.")})
        _c, rows = self.run_cli(v, "Tomas.md", "--write",
                                "--systems-dir", str(empty))
        self.assertTrue(rows[0].startswith("NO-SRD\tTomas.md\t"), rows)
        self.assertIn("not installed", rows[0])
        self.assertIn("As Bandit.", self.read(v, "Tomas.md"))

    def test_refuses_a_non_dnd_vault(self):
        v = self.vault({"Tomas.md": npc("As Bandit.")}, system="gurps-4e")
        before = self.read(v, "Tomas.md")
        _c, rows = self.run_cli(v, "Tomas.md", "--write")
        self.assertTrue(rows[0].startswith("NOT-DND\tTomas.md"), rows)
        self.assertEqual(self.read(v, "Tomas.md"), before)

    def test_every_shipped_creature_writes_a_block_the_reader_can_use(self):
        srd = stat_fill.load_srd(stat_fill.SYSTEMS_DIR)
        self.assertEqual(len(srd), 329)
        self.assertEqual(srd["bandit"].size, "M/S")
        self.assertEqual(srd["imp"].size, "T")
        for c in srd.values():
            with self.subTest(c.name):
                block = "\n".join(stat_fill.stats_block(c))
                self.assertIn(f"**AC** {c.ac}", block)
                self.assertIn(f"**HP** {c.hp}", block)
                self.assertRegex(block, r"Initiative\*\* [+-]\d+ \(\d+\)")
                self.assertEqual(len(c.scores), 6)
                self.assertNotIn("?", c.speed)

    def test_a_fixed_damage_attack_keeps_its_damage(self):
        srd = stat_fill.load_srd(stat_fill.SYSTEMS_DIR)
        bat = "\n".join(stat_fill.stats_block(srd["bat"]))
        self.assertIn("Bite.*** +4, 1 piercing", bat)


if __name__ == "__main__":
    unittest.main()

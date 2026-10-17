"""migrate_vault.py: the checks that read and write vault files alone."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
from layouts import on_layout  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from schema_rules import without_generated_markers  # noqa: E402
from migrate_core import CHOICE, PERSON, WILL, StepFailed  # noqa: E402

sys.path.insert(0, str(SCRIPTS.parent.parent.parent / "scripts"))
import template_history as th  # noqa: E402

SHARED = SCRIPTS.parent


def make_vault(case, system="coc-7e"):
    vault = Path(tempfile.mkdtemp(prefix="migv-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    publish = f"publish:\n  system: {system}\n" if system else ""
    (vault / "_meta" / "vault-config.md").write_text(
        f'---\ngm_apprentice_version: "1.10.12"\n{publish}---\n',
        encoding="utf-8")
    return vault


def by_id(items):
    return {item.id: item for item in items}


def whole_vault(case, system="coc-7e"):
    """A vault with its full skeleton, at the plugin's version."""
    vault = Path(tempfile.mkdtemp(prefix="migv-")) / "V"
    case.addCleanup(shutil.rmtree, vault.parent, ignore_errors=True)
    vs.build(vault, vs.missing(vault, system, campaign="V",
                               version=vs.plugin_version()[0]))
    return vault


class TimelinePageTests(unittest.TestCase):
    def test_a_vault_with_no_timeline_is_given_one(self):
        vault = whole_vault(self)
        (vault / "_Campaign" / "Timeline.md").unlink()
        self.assertEqual(mv.find_skeleton(vault), [])
        items = mv.find_timeline_page(vault)
        self.assertEqual([i.id for i in items], ["timeline-page"])
        self.assertEqual(items[0].group, WILL)
        items[0].apply(None)
        text = (vault / "_Campaign" / "Timeline.md").read_text(encoding="utf-8")
        self.assertIn("type: timeline", text)
        self.assertEqual(mv.find_timeline_page(vault), [])

    def test_a_timeline_under_another_name_counts(self):
        vault = whole_vault(self)
        (vault / "_Campaign" / "Timeline.md").rename(vault / "When.md")
        self.assertEqual(mv.find_timeline_page(vault), [])

    def test_no_other_page_is_added(self):
        vault = whole_vault(self)
        for rel in ("_Campaign/Timeline.md", "_Campaign/Player Characters.md",
                    "_World/world-index.md", "_World/_flags.md"):
            (vault / rel).unlink()
        self.assertEqual(mv.find_skeleton(vault), [])
        items = mv.find_timeline_page(vault)
        self.assertEqual(items[0].lines,
                         ["create _Campaign/Timeline.md (empty, for session "
                          "timeline entries)"])

    def test_it_waits_for_the_site_tool(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "timeline-page")
        self.assertIsNone(check.release)
        self.assertTrue(check.asks_site)
        self.assertEqual(check.band, 4)


class SkeletonTests(unittest.TestCase):
    def test_a_whole_vault_is_offered_nothing(self):
        self.assertEqual(mv.find_skeleton(whole_vault(self)), [])

    def test_gaps_are_offered_as_one_automatic_step(self):
        vault = whole_vault(self)
        (vault / "Heritages").rmdir()
        (vault / "_Campaign" / "Timeline.md").unlink()
        items = mv.find_skeleton(vault)
        self.assertEqual([i.id for i in items], ["skeleton"])
        self.assertEqual(items[0].group, WILL)
        self.assertEqual(items[0].lines, ["create Heritages/"])
        self.assertEqual(items[0].apply(None), ["created Heritages/"])
        self.assertTrue((vault / "Heritages").is_dir())
        self.assertFalse((vault / "_Campaign" / "Timeline.md").exists())
        self.assertEqual(mv.find_skeleton(vault), [])

    def test_a_page_that_can_publish_is_never_added(self):
        vault = whole_vault(self)
        for rel in ("_World/world-index.md", "_World/_flags.md",
                    "_Campaign/Timeline.md", "_Campaign/Player Characters.md"):
            (vault / rel).unlink()
        self.assertEqual(mv.find_skeleton(vault), [])

    def test_a_failed_build_stops_the_run(self):
        vault = whole_vault(self)
        (vault / "_meta" / "entity-types.md").unlink()
        (vault / "Heritages").rmdir()
        items = mv.find_skeleton(vault)
        with mock.patch.object(vs, "write_text_atomic",
                               side_effect=OSError("disk full")):
            with self.assertRaisesRegex(StepFailed, "disk full"):
                items[0].apply(None)
        self.assertFalse((vault / "Heritages").exists())
        self.assertFalse((vault / "_meta" / "entity-types.md").exists())

    def test_templates_are_left_to_the_templates_check(self):
        vault = whole_vault(self)
        (vault / "_Templates" / "_Template_NPC.md").unlink()
        self.assertEqual(mv.find_skeleton(vault), [])
        self.assertIn("template:_Template_NPC.md",
                      by_id(mv.find_templates(vault)))

    def test_an_existing_schema_file_is_never_touched(self):
        vault = whole_vault(self)
        path = vault / "_meta" / "relationship-types.md"
        path.write_text("my subset\n", encoding="utf-8")
        self.assertEqual(mv.find_skeleton(vault), [])
        self.assertEqual(path.read_text(encoding="utf-8"), "my subset\n")

    def test_a_missing_schema_file_is_recreated_from_the_seed(self):
        vault = whole_vault(self)
        (vault / "_meta" / "entity-types.md").unlink()
        (vault / "_meta" / "relationship-types.md").unlink()
        items = mv.find_skeleton(vault)
        self.assertEqual(sorted(items[0].lines),
                         ["create _meta/entity-types.md",
                          "create _meta/relationship-types.md"])
        items[0].apply(None)
        self.assertIn("## Type-Specific Fields",
                      (vault / "_meta" / "entity-types.md").read_text(
                          encoding="utf-8"))
        rel = (vault / "_meta" / "relationship-types.md").read_text(
            encoding="utf-8")
        self.assertIn("cloned_from", rel)
        self.assertEqual(mv.find_skeleton(vault), [])

    def test_a_renamed_folder_is_not_offered(self):
        vault = whole_vault(self)
        (vault / "Characters" / "NPCs").rmdir()
        (vault / "NPCs").mkdir()
        (vault / "NPCs" / "Ada.md").write_text("---\ntype: npc\n---\n",
                                               encoding="utf-8")
        self.assertEqual(mv.find_skeleton(vault), [])

    def test_something_in_the_way_stops_the_run(self):
        vault = whole_vault(self)
        (vault / "Clues").rmdir()
        (vault / "Clues").write_text("x", encoding="utf-8")
        with self.assertRaises(StepFailed):
            mv.find_skeleton(vault)

    def test_the_check_is_looked_at_on_every_pass(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "skeleton")
        self.assertIsNone(check.release)
        self.assertEqual(mv.VAULT_CHECKS[0].name, "skeleton")


class SystemTests(unittest.TestCase):
    def test_aliases_map_to_file_ids(self):
        for written, wanted in (("CoC", "coc-7e"), ("gurps", "gurps-4e"),
                                ("dnd-5e", "dnd-5e-2024"), ("Blades", "fitd"),
                                ("pathfinder", "pf2e"),
                                ("regency-cthulhu", "coc-7e-regency")):
            self.assertEqual(mv.vault_system(make_vault(self, written)), wanted)

    def test_only_the_settings_answer_for_a_vault_on_the_new_file(self):
        vault = make_vault(self, None)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        on_layout(vault, "new")
        self.assertIsNone(mv.vault_system(vault))
        (vault / "Brief.md").write_text(
            "---\ntype: adventure-brief\nsystem: gurps\n---\n",
            encoding="utf-8")
        self.assertIsNone(mv.vault_system(vault))

    def test_a_vault_with_no_settings_file_reads_the_notes(self):
        vault = Path(tempfile.mkdtemp(prefix="sys-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        self.assertEqual(mv.vault_system(vault), "gurps-4e")

    def test_a_vault_on_the_old_file_falls_back_to_the_campaign_overview(self):
        vault = make_vault(self, None)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        self.assertEqual(mv.vault_system(vault), "gurps-4e")
        self.assertIsNone(mv.vault_system(make_vault(self, None)))

    def test_a_vault_on_the_old_file_falls_back_to_the_brief_under_either_spelling(self):
        for kind in ("adventure-brief", "adventure_brief"):
            vault = make_vault(self, None)
            (vault / "Brief.md").write_text(
                f"---\ntype: {kind}\nsystem: gurps\n---\n",
                encoding="utf-8")
            self.assertEqual(mv.vault_system(vault), "gurps-4e", kind)

    def test_the_settings_beat_the_notes(self):
        vault = make_vault(self, "dnd-5e")
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        self.assertEqual(mv.vault_system(vault), "dnd-5e-2024")


class TemplateTests(unittest.TestCase):
    def test_expected_set_for_a_coc_vault(self):
        expected = mv.expected_templates(make_vault(self))
        self.assertIn("_Template_NPC.md", expected)
        self.assertIn("_Template_Session_WrapUp.md", expected)
        self.assertIn("pc-coc-7e.md", expected)
        self.assertIn("character-story.md", expected)
        self.assertNotIn("crew-fitd.md", expected)
        self.assertNotIn("pc-generic.md", expected)
        npc = expected["_Template_NPC.md"]
        self.assertNotIn("{STAT BLOCK", npc)
        self.assertNotIn("Reputation", npc)
        self.assertIn("**Damage Bonus**", npc)

    def test_regency_keeps_reputation_without_the_comment(self):
        npc = mv.expected_templates(
            make_vault(self, "coc-7e-regency"))["_Template_NPC.md"]
        self.assertIn("**Reputation** {n}", npc)
        self.assertNotIn("Regency Cthulhu only", npc)

    def test_no_system_gets_the_generic_block_and_pc(self):
        expected = mv.expected_templates(make_vault(self, None))
        self.assertIn("### Stats\n\n{System stat block.}",
                      expected["_Template_NPC.md"])
        self.assertIn("pc-generic.md", expected)

    def test_fitd_gets_the_crew_sheet(self):
        self.assertIn("crew-fitd.md",
                      mv.expected_templates(make_vault(self, "fitd")))

    def test_missing_is_will_do_and_changed_is_a_choice(self):
        vault = make_vault(self)
        expected = mv.expected_templates(vault)
        (vault / "_Templates").mkdir()
        for name, text in expected.items():
            (vault / "_Templates" / name).write_text(text, encoding="utf-8")
        self.assertEqual(mv.find_templates(vault), [])
        (vault / "_Templates" / "_Template_Item.md").unlink()
        (vault / "_Templates" / "_Template_NPC.md").write_text(
            expected["_Template_NPC.md"] + "\n## My Section\n",
            encoding="utf-8")
        # Trailing blanks and blank-line runs are not a change.
        (vault / "_Templates" / "_Template_Clue.md").write_text(
            expected["_Template_Clue.md"].replace("\n\n", "\n\n\n") + "  \n",
            encoding="utf-8")
        items = by_id(mv.find_templates(vault))
        self.assertEqual(sorted(items), ["template:_Template_Item.md",
                                         "template:_Template_NPC.md"])
        self.assertEqual(items["template:_Template_Item.md"].group, WILL)
        self.assertEqual(items["template:_Template_NPC.md"].group, CHOICE)
        self.assertIn("local changes are lost",
                      items["template:_Template_NPC.md"].lines[0])
        for item in items.values():
            item.apply(None)
        self.assertEqual(mv.find_templates(vault), [])

    def npc_vault(self, text):
        """A coc-7e vault whose NPC template is `text`; the other
        templates are as the plugin writes them."""
        vault = make_vault(self)
        (vault / "_Templates").mkdir()
        for name, body in mv.expected_templates(vault).items():
            (vault / "_Templates" / name).write_text(body, encoding="utf-8")
        (vault / "_Templates" / "_Template_NPC.md").write_text(
            text, encoding="utf-8")
        return vault

    def test_a_regency_stat_line_is_not_offered_for_overwrite(self):
        # #311: a Regency vault stamped plain coc-7e kept the Reputation
        # line, and the overwrite choice would have dropped it.
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        regency = mv.expected_templates(
            make_vault(self, "coc-7e-regency"))["_Template_NPC.md"]
        raw = regency.replace(
            "**Reputation** {n}",
            "**Reputation** {n}  <!-- Regency Cthulhu only: vault setup "
            "drops this line otherwise -->")
        self.assertNotEqual(plain, regency)
        self.assertNotEqual(regency, raw)
        for label, text in (("without the comment", regency),
                            ("with the setup comment", raw)):
            with self.subTest(label):
                # No overwrite and no stray copy; only the note that it
                # looks Regency.
                vault = self.npc_vault(text)
                self.assertEqual(mv.find_templates(vault), [])
                self.assertEqual([i.id for i in mv.find_regency_looks(vault)],
                                 ["regency-looks"])

    def test_a_regency_template_still_gets_a_missing_reputation_line(self):
        vault = make_vault(self, "coc-7e-regency")
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "_Template_NPC.md").write_text(
            plain, encoding="utf-8")
        item = by_id(mv.find_templates(vault))["template:_Template_NPC.md"]
        self.assertEqual(item.group, CHOICE)
        self.assertIn("+ **Reputation** {n}", item.lines[0])

    def test_the_choice_row_names_what_differs(self):
        # #311: "local changes are lost" gave the GM nothing to decide on.
        vault = make_vault(self)
        expected = mv.expected_templates(vault)["_Template_NPC.md"]
        text = expected.replace("**Armour** {none}", "**Armour** {leather}")
        self.assertNotEqual(text, expected)
        text += "\n## My Section\n"
        item = by_id(mv.find_templates(self.npc_vault(text))
                     )["template:_Template_NPC.md"]
        row = item.lines[0]
        self.assertIn("local changes are lost", row)
        self.assertIn("2 lines differ", row)
        self.assertIn("- **Damage Bonus** {+0} · **Build** {0} · **Move** "
                      "{8} · **Armour** {leather}", row)
        self.assertIn("+ **Damage Bonus** {+0} · **Build** {0} · **Move** "
                      "{8} · **Armour** {none}", row)
        self.assertIn("- ## My Section", row)
        self.assertNotIn("\n", row)

    def row_for(self, text):
        return by_id(mv.find_templates(self.npc_vault(text))
                     )["template:_Template_NPC.md"].lines[0]

    def test_the_count_is_changed_lines_as_a_person_counts_them(self):
        expected = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        one = expected.replace("**Armour** {none}", "**Armour** {leather}")
        self.assertIn("1 line differs (", self.row_for(one))
        self.assertIn("1 line differs (", self.row_for(expected + "\nExtra\n"))
        lines = expected.split("\n")
        body = [i for i, line in enumerate(lines)
                if i > lines.index("---", 1) and line.strip()]
        for i in body[:5]:   # five edited lines (a blank frontmatter value is the vault's own)
            lines[i] = lines[i] + " EDIT"
        row = self.row_for("\n".join(lines))
        self.assertIn("5 lines differ (", row)
        self.assertTrue(row.endswith("and 1 more"), row)

    def regency_build(self, comment=False):
        text = mv.expected_templates(
            make_vault(self, "coc-7e-regency"))["_Template_NPC.md"]
        if comment:
            text = text.replace(
                "**Reputation** {n}", "**Reputation** {n}  <!-- Regency "
                "Cthulhu only: vault setup drops this line otherwise -->")
        return text

    def test_a_stale_regency_template_is_overwritten_with_the_regency_build(self):
        # #311: the Reputation line marks it; it is never the line that goes.
        stale = self.regency_build(comment=True).replace(
            "**Armour** {none}", "**Armour** {leather}")
        self.assertNotEqual(stale, self.regency_build(comment=True))
        vault = self.npc_vault(stale)
        item = by_id(mv.find_templates(vault))["template:_Template_NPC.md"]
        self.assertEqual(item.group, CHOICE)
        self.assertIn("1 line differs", item.lines[0])
        self.assertNotIn("Reputation", item.lines[0])
        item.apply(None)
        self.assertEqual((vault / "_Templates" / "_Template_NPC.md"
                          ).read_text(encoding="utf-8"), self.regency_build())

    def test_a_note_with_regency_in_its_name_is_not_a_regency_pc_template(self):
        vault = self.npc_vault(mv.expected_templates(
            make_vault(self))["_Template_NPC.md"])
        (vault / "_Templates" / "_Template_Regency_Notes.md").write_text(
            "x", encoding="utf-8")
        self.assertEqual(mv.find_regency_looks(vault), [])

    def test_a_vault_that_looks_regency_but_is_coc_7e_is_told_so(self):
        for label, setup in (
                ("npc template", lambda v: (v / "_Templates" /
                 "_Template_NPC.md").write_text(self.regency_build(True),
                                                encoding="utf-8")),
                ("regency pc template", lambda v: (v / "_Templates" /
                 "_Template_PC_CoC_7e_Regency.md").write_text(
                     "x", encoding="utf-8"))):
            with self.subTest(label):
                vault = self.npc_vault(mv.expected_templates(
                    make_vault(self))["_Template_NPC.md"])
                setup(vault)
                (row,) = mv.find_regency_looks(vault)
                self.assertEqual(row.group, PERSON)
                self.assertEqual(row.lines, [
                    "_meta/vault-config.md\tthe templates look like Regency "
                    "Cthulhu, but vault.system is coc-7e; if this is a "
                    "Regency Cthulhu campaign, set vault.system to "
                    "coc-7e-regency in _meta/vault-config.md (the site "
                    "builds differently). Nothing else changes, and this "
                    "is said once"])

    def test_a_plain_coc_vault_is_not_told_it_looks_regency(self):
        vault = self.npc_vault(mv.expected_templates(
            make_vault(self))["_Template_NPC.md"])
        self.assertEqual(mv.find_regency_looks(vault), [])

    def test_a_regency_pc_template_means_no_plain_pc_template_is_copied(self):
        vault = self.npc_vault(mv.expected_templates(
            make_vault(self))["_Template_NPC.md"])
        (vault / "_Templates" / "pc-coc-7e.md").unlink()
        self.assertIn("template:pc-coc-7e.md",
                      by_id(mv.find_templates(vault)))
        (vault / "_Templates" / "_Template_PC_CoC_7e_Regency.md").write_text(
            "x", encoding="utf-8")
        self.assertNotIn("template:pc-coc-7e.md",
                         by_id(mv.find_templates(vault)))

    def test_the_regency_note_is_said_once_by_a_release_gated_check(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "regency-looks")
        self.assertEqual((check.release, check.band), ("1.10.49", 3))

    def test_a_regency_stamped_vault_is_not_offered_the_setup_comment_away(self):
        # #311: only the comment differs, and the vault is stamped Regency.
        vault = make_vault(self, "coc-7e-regency")
        (vault / "_Templates").mkdir()
        for name, body in mv.expected_templates(vault).items():
            (vault / "_Templates" / name).write_text(body, encoding="utf-8")
        (vault / "_Templates" / "_Template_NPC.md").write_text(
            self.regency_build(True), encoding="utf-8")
        self.assertEqual(mv.find_templates(vault), [])
        self.assertEqual(mv.find_regency_looks(vault), [])

    def test_only_the_templates_own_reputation_line_marks_it_regency(self):
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        text = plain.replace("**Armour** {none}",
                             "**Armour** {none}\n**Reputation** in town: {x}")
        self.assertNotEqual(text, plain)
        vault = self.npc_vault(text)
        item = by_id(mv.find_templates(vault))["template:_Template_NPC.md"]
        self.assertIn("- **Reputation** in town: {x}", item.lines[0])
        self.assertNotIn("+ **Reputation** {n}", item.lines[0])
        self.assertEqual(mv.find_regency_looks(vault), [])

    def test_a_blank_line_or_spacing_difference_is_said_in_words(self):
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        blank = plain.replace("\n\n## ", "\n## ", 1)
        self.assertNotEqual(blank, plain)
        self.assertIn("only blank lines differ", self.row_for(blank))
        self.assertNotIn("0 line", self.row_for(blank))
        spaced = plain.replace("**Armour** {none}", "**Armour**  {none}", 1)
        row = self.row_for(spaced)
        self.assertIn("1 line differs", row)
        self.assertIn("spacing differs: **Damage Bonus**", row)
        self.assertNotIn("- **Armour**", row)

    def older(self, history):
        """A vault whose Document template is an old text; HISTORY points at
        a file holding `history(old_text)`."""
        vault = make_vault(self)
        old = mv.expected_templates(vault)["_Template_Document.md"] \
            + "\n## Handout Notes\n"
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "_Template_Document.md").write_text(
            old.replace("\n", "\r\n"), encoding="utf-8", newline="")
        file = Path(tempfile.mkdtemp(prefix="migh-")) / "template-history.json"
        self.addCleanup(shutil.rmtree, file.parent, ignore_errors=True)
        file.write_text(json.dumps(history(old)), encoding="utf-8")
        patch = mock.patch.object(mv, "HISTORY", file)
        patch.start()
        self.addCleanup(patch.stop)
        return vault

    def doc(self, vault):
        """The one Document-template item (the rest are missing: copies)."""
        return by_id(mv.find_templates(vault))["template:_Template_Document.md"]

    def test_an_untouched_older_template_is_upgraded_without_asking(self):
        vault = self.older(lambda old: {"coc-7e": {
            "_Template_Document.md": [mv.text_hash(old)]}})
        item = self.doc(vault)
        self.assertEqual(item.group, WILL)
        self.assertEqual(
            item.lines,
            ["update _Templates/_Template_Document.md from an earlier "
             "release's text"])
        item.apply(None)
        self.assertNotIn("template:_Template_Document.md",
                         by_id(mv.find_templates(vault)))

    def test_an_edited_template_is_still_a_choice(self):
        vault = self.older(lambda old: {"coc-7e": {
            "_Template_Document.md": [mv.text_hash(old)]}})
        path = vault / "_Templates" / "_Template_Document.md"
        path.write_text(path.read_text(encoding="utf-8") + "\nMy edit\n",
                        encoding="utf-8")
        self.assertEqual(self.doc(vault).group, CHOICE)

    # #366: a frontmatter value the template leaves blank (campaign, tags, ...) is the vault's to fill in.
    def pc_template(self, vault):
        (vault / "_Templates").mkdir(exist_ok=True)
        path = vault / "_Templates" / "pc-coc-7e.md"
        path.write_text(mv.expected_templates(vault)["pc-coc-7e.md"], encoding="utf-8")
        return path

    def test_a_filled_in_blank_value_is_not_a_difference(self):
        vault = make_vault(self)
        path = self.pc_template(vault)
        text = path.read_text(encoding="utf-8")
        filled = text.replace('campaign: ""', 'campaign: "Canticle of the End"', 1) \
            .replace("tags: []", "tags:\n  - investigator", 1)
        self.assertNotEqual(filled, text)
        path.write_text(filled, encoding="utf-8")
        self.assertNotIn("template:pc-coc-7e.md", by_id(mv.find_templates(vault)))

    def test_an_overwrite_keeps_the_values_the_vault_filled_in(self):
        vault = make_vault(self)
        path = self.pc_template(vault)
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace('campaign: ""', 'campaign: "Canticle"', 1)
                        .replace("| Dodge | DEX/2 |", "| Dodge | DEX/2 | 40 |", 1), encoding="utf-8")
        item = by_id(mv.find_templates(vault))["template:pc-coc-7e.md"]
        self.assertEqual(item.group, CHOICE)
        self.assertNotIn("campaign", item.lines[0])
        item.apply("y")
        after = path.read_text(encoding="utf-8")
        self.assertIn('campaign: "Canticle"', after)
        self.assertIn("| Dodge | DEX/2 |", after)
        self.assertEqual(after, text.replace('campaign: ""', 'campaign: "Canticle"', 1))

    def test_an_untouched_older_template_with_values_filled_in_is_upgraded_without_asking(self):
        vault = self.older(lambda old: {"coc-7e": {
            "_Template_Document.md": [mv.text_hash(old)]}})
        path = vault / "_Templates" / "_Template_Document.md"
        path.write_text(path.read_text(encoding="utf-8").replace(
            "tags: []", "tags:\r\n  - letter", 1), encoding="utf-8", newline="")
        item = self.doc(vault)
        self.assertEqual(item.group, WILL)
        item.apply(None)
        self.assertIn("  - letter", path.read_text(encoding="utf-8"))
        self.assertNotIn("template:_Template_Document.md", by_id(mv.find_templates(vault)))

    def write_template(self, vault, name, edit):
        (vault / "_Templates").mkdir(exist_ok=True)
        path = vault / "_Templates" / name
        text = mv.expected_templates(vault)[name]
        path.write_text(edit(text), encoding="utf-8")
        return path, text

    def test_a_placeholder_campaign_and_a_commented_blank_list_are_the_vaults_to_fill(self):
        vault = make_vault(self)
        self.write_template(vault, "_Template_Plan.md", lambda t: t
                            .replace('campaign: "[[Campaign_Overview_Updated]]"', 'campaign: "[[Canticle]]"', 1)
                            .replace("leads_to: []", 'leads_to: ["[[Next]]"]', 1))
        self.write_template(vault, "_Template_Session_WrapUp.md",
                            lambda t: t.replace("play_date: null", "play_date: 2026-10-01", 1))
        found = by_id(mv.find_templates(vault))
        self.assertNotIn("template:_Template_Plan.md", found)
        self.assertNotIn("template:_Template_Session_WrapUp.md", found)

    def test_a_multi_line_value_is_kept_whole_by_an_overwrite(self):
        vault = make_vault(self)
        path, text = self.write_template(vault, "pc-coc-7e.md", lambda t: t
                                         .replace('source_document: ""', "source_document: |\n  line one\n  line two", 1)
                                         + "\nMy edit\n")
        item = by_id(mv.find_templates(vault))["template:pc-coc-7e.md"]
        self.assertEqual(item.group, CHOICE)
        item.apply("y")
        self.assertEqual(path.read_text(encoding="utf-8"),
                         text.replace('source_document: ""', "source_document: |\n  line one\n  line two", 1))

    def test_a_blank_key_the_vault_deleted_is_a_difference_and_comes_back(self):
        vault = make_vault(self)
        path, text = self.write_template(vault, "pc-coc-7e.md", lambda t: t.replace('portrait: ""\n', "", 1))
        item = by_id(mv.find_templates(vault))["template:pc-coc-7e.md"]
        item.apply("y")
        self.assertEqual(path.read_text(encoding="utf-8"), text)

    def test_a_frontmatter_it_cannot_split_safely_is_compared_whole(self):
        lines, blocks = mv._frontmatter_blocks('---\ncampaign: ""\n"odd": 1\n---\n')
        self.assertEqual(blocks, {})
        self.assertEqual(mv._frontmatter_blocks('---\ntags: []\ntags: [x]\n---\n')[1], {})
        self.assertEqual(mv._frontmatter_blocks('---\ntags: []\n')[1], {})
        self.assertEqual(mv._frontmatter_blocks('--- \ntags: []\n---\n')[1], {})
        self.assertEqual(mv._frontmatter_blocks("no frontmatter\n")[1], {})

    def test_a_template_in_no_release_is_a_choice(self):
        for history in (lambda old: {},
                        lambda old: {"coc-7e": {"_Template_Document.md": ["0" * 64]}},
                        lambda old: {"coc-7e": {
                            "_Template_Item.md": [mv.text_hash(old)]}},
                        lambda old: {"gurps-4e": {
                            "_Template_Document.md": [mv.text_hash(old)]}}):
            self.assertEqual(self.doc(self.older(history)).group, CHOICE)

    def test_a_missing_history_file_leaves_every_difference_a_choice(self):
        vault = self.older(lambda old: {})
        with mock.patch.object(mv, "HISTORY", vault / "nope.json"):
            self.assertEqual(self.doc(vault).group, CHOICE)

    def test_another_systems_template_is_not_upgraded_as_untouched(self):
        # A free-text game_system the aliases do not know reads as generic;
        # a GURPS stat block there is the GM's, not an old generic text.
        vault = make_vault(self, "GURPS 4th Edition")
        self.assertEqual(mv.vault_system(vault), "gurps 4th edition")
        (vault / "_Templates").mkdir()
        gurps = mv.templates_for("gurps-4e")
        for name in ("_Template_NPC.md", "_Template_Creature.md"):
            (vault / "_Templates" / name).write_text(
                gurps[name], encoding="utf-8")
        items = by_id(mv.find_templates(vault))
        for name in ("_Template_NPC.md", "_Template_Creature.md"):
            self.assertEqual(items[f"template:{name}"].group, CHOICE)

    def test_the_history_holds_every_current_template(self):
        history = json.loads(mv.HISTORY.read_text(encoding="utf-8"))
        source = SHARED / "templates"
        for system in th.systems_in(source):
            for name, text in mv.templates_for(system).items():
                self.assertIn(
                    mv.text_hash(text),
                    history.get(system or "generic", {}).get(name, []),
                    f"{name} ({system}) is not in template-history.json; "
                    f"regenerate it: python3 scripts/template_history.py")

    def test_the_history_only_grows(self):
        # A hash once recorded is kept: one from a working tree that no tag
        # holds (a draft of a template, recorded when the script ran) is not
        # fatal and is not dropped, and a new hash is added.
        old = {"generic": {"a.md": ["h1", "h2"]}, "gurps-4e": {"b.md": ["g1"]}}
        new = {"generic": {"a.md": ["h1", "h3"]}}
        self.assertEqual(th.merge(old, new), {
            "generic": {"a.md": ["h1", "h2", "h3"]},
            "gurps-4e": {"b.md": ["g1"]}})
        self.assertEqual(th.merge({}, new), new)
        # Merging again changes nothing: the file is something the script
        # can regenerate.
        self.assertEqual(th.merge(th.merge(old, new), new), th.merge(old, new))
        self.assertIsNone(th.refusal(["v1"]))
        self.assertIn("no release tags", th.refusal([]))

    def test_the_checked_in_history_is_what_the_script_would_write(self):
        history = json.loads(mv.HISTORY.read_text(encoding="utf-8"))
        tags = th.release_tags()
        if not tags:
            self.skipTest("no release tags in this checkout")
        self.assertEqual(th.merge(history, th.build(tags)), history)

    def test_an_unreadable_template_is_a_failed_step(self):
        vault = make_vault(self)
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "_Template_NPC.md").write_bytes(b"\xff\xfe\x00bad")
        with self.assertRaises(StepFailed):
            mv.find_templates(vault)

    def test_a_vault_with_no_templates_folder_gets_one(self):
        vault = make_vault(self)
        for item in mv.find_templates(vault):
            self.assertEqual(item.group, WILL)
            item.apply(None)
        self.assertTrue((vault / "_Templates" / "_Template_Session.md").is_file())

    def test_sheet_source_is_added_under_portrait(self):
        vault = make_vault(self)
        (vault / "_Templates").mkdir()
        old = '---\nname: ""\ntype: pc\nportrait: ""\ntags: []\n---\n\n## Stat Sheet\n'
        (vault / "_Templates" / "pc-coc-7e.md").write_text(old, encoding="utf-8")
        (item,) = mv.find_pc_template_field(vault)
        self.assertEqual(item.group, WILL)
        item.apply(None)
        text = (vault / "_Templates" / "pc-coc-7e.md").read_text(encoding="utf-8")
        self.assertIn('portrait: ""\nsheet_source: ""\ntags: []\n', text)
        self.assertEqual(mv.find_pc_template_field(vault), [])

    def test_an_unreadable_pc_template_is_a_failed_step(self):
        vault = make_vault(self)
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "pc-x.md").write_bytes(b"\xff\xfe\x00bad")
        with self.assertRaises(StepFailed):
            mv.find_pc_template_field(vault)
        self.assertEqual(mv.find_pc_template_field(make_vault(self)), [])


class SchemaMirrorTests(unittest.TestCase):
    def mirror(self, vault, text):
        (vault / "_meta" / "entity-types.md").write_text(text, encoding="utf-8")

    def canonical(self):
        return mv.type_entries(
            (SHARED / "entity-schema.md").read_text(encoding="utf-8"))

    def test_a_matching_mirror_plans_nothing(self):
        vault = make_vault(self)
        body = "\n\n".join(self.canonical().values())
        self.mirror(vault, f"# Types\n\n## Type-Specific Fields\n\n{body}\n")
        self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_stale_and_missing_entries_are_one_choice(self):
        vault = make_vault(self)
        entries = self.canonical()
        kept = dict(entries)
        del kept["Creature"]
        kept["Event"] = "**Event:** `event_type`, `date` (in-game)"
        kept["Starship"] = "**Starship:** `tonnage`, `crew`"
        body = "\n\n".join(kept.values())
        self.mirror(vault, f"## Type-Specific Fields\n\n{body}\n\n## Notes\n\nmine\n")
        (item,) = mv.find_schema_mirror(vault)
        self.assertEqual((item.id, item.group), ("schema-mirror", CHOICE))
        self.assertEqual(sorted(item.lines), [
            "add the Creature entry to _meta/entity-types.md",
            "update the Event entry in _meta/entity-types.md (your edits inside "
            "that entry are replaced)"])
        item.apply(None)
        text = (vault / "_meta" / "entity-types.md").read_text(encoding="utf-8")
        self.assertIn(entries["Event"], text)
        self.assertIn(entries["Creature"], text)
        self.assertIn("**Starship:** `tonnage`, `crew`", text)
        self.assertTrue(text.endswith("## Notes\n\nmine\n"))
        self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_a_copy_of_the_entry_above_the_heading_is_left_alone(self):
        vault = make_vault(self)
        entries = self.canonical()
        kept = dict(entries)
        old = "**Event:** `event_type`, `date` (in-game)"
        kept["Event"] = old
        body = "\n\n".join(kept.values())
        self.mirror(vault, f"# Types\n\n{old}\n\n## Type-Specific Fields\n\n{body}\n")
        (item,) = mv.find_schema_mirror(vault)
        item.apply(None)
        text = (vault / "_meta" / "entity-types.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith(f"# Types\n\n{old}\n\n## Type"))
        self.assertIn(entries["Event"], text)
        self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_text_after_the_last_entry_survives_an_update(self):
        for trailer in ("<!-- keep -->", "---", "# Heading"):
            vault = make_vault(self)
            entries = self.canonical()
            last = list(entries)[-1]
            kept = dict(entries)
            kept[last] = f"**{last}:** `old`"
            body = "\n\n".join(kept.values())
            self.mirror(vault, f"## Type-Specific Fields\n\n{body}\n"
                               f"{trailer}\n## Notes\n")
            (item,) = mv.find_schema_mirror(vault)
            item.apply(None)
            text = (vault / "_meta" / "entity-types.md").read_text(
                encoding="utf-8")
            self.assertTrue(text.endswith(f"{entries[last]}\n{trailer}\n## Notes\n"),
                            trailer)
            self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_crlf_file_stays_crlf(self):
        vault = make_vault(self)
        entries = self.canonical()
        kept = dict(entries)
        del kept["Creature"]
        kept["Event"] = "**Event:** `event_type`"
        body = "\n\n".join(kept.values())
        path = vault / "_meta" / "entity-types.md"
        path.write_bytes(
            f"# T\n\n## Type-Specific Fields\n\n{body}\n\n## Notes\n"
            .replace("\n", "\r\n").encode())
        (item,) = mv.find_schema_mirror(vault)
        item.apply(None)
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_unreadable_mirror_is_a_failed_step(self):
        vault = make_vault(self)
        (vault / "_meta" / "entity-types.md").write_bytes(b"\xff\xfe\x00bad")
        with self.assertRaises(StepFailed):
            mv.find_schema_mirror(vault)

    def test_no_mirror_file_plans_nothing(self):
        self.assertEqual(mv.find_schema_mirror(make_vault(self)), [])


class SmallCheckTests(unittest.TestCase):
    def wrap(self, vault, rel, fm):
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\ntype: session_wrap\n{fm}---\n", encoding="utf-8")

    def test_wrapup_filename_lives_in_vaultlib(self):
        import vaultlib
        fm = {"session_number": 7, "chapter": "[[Chapter 3 - Vienna]]"}
        self.assertEqual(
            vaultlib.wrapup_filename("Chapters/Chapter 3 - Vienna/x.md", fm),
            "Chapter_03_Session_07_Wrap_Up.md")
        self.assertIsNone(vaultlib.wrapup_filename("x.md", {}))

    def test_old_wrap_up_filenames_are_a_choice_that_renames(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/Chapter 1/Session 03 - Ball - Wrap-Up.md",
                  "session_number: 3\n")
        self.wrap(vault, "Chapter_01_Session_04_Wrap_Up.md",
                  "session_number: 4\n")
        (vault / "Index.md").write_text(
            "[[Session 03 - Ball - Wrap-Up]]\n", encoding="utf-8")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual((item.id, item.group), ("wrapup-filenames", CHOICE))
        self.assertEqual(item.lines, [
            "rename Chapters/Chapter 1/Session 03 - Ball - Wrap-Up.md to "
            "Chapters/Chapter 1/Chapter_01_Session_03_Wrap_Up.md and update "
            "1 link(s) to it"])
        item.apply(None)
        self.assertTrue((vault / "Chapters/Chapter 1/"
                         "Chapter_01_Session_03_Wrap_Up.md").is_file())
        self.assertEqual((vault / "Index.md").read_text(encoding="utf-8"),
                         "[[Chapter_01_Session_03_Wrap_Up]]\n")

    def test_a_wrap_up_whose_name_cannot_be_worked_out_needs_a_person(self):
        vault = make_vault(self)
        self.wrap(vault, "Session_03_Wrap_Up.md", "session_number: 3\n")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, PERSON)
        self.assertTrue(item.lines[0].startswith("Session_03_Wrap_Up.md\t"))
        self.assertIn("chapter", item.lines[0])

    def test_two_wrap_ups_that_would_share_a_name(self):
        vault = make_vault(self)
        for name in ("S3 a.md", "S3 b.md"):
            self.wrap(vault, f"Chapters/Chapter 2/{name}",
                      "session_number: 3\n")
        items = mv.find_wrapup_filenames(vault)
        (choice,) = [i for i in items if i.group == CHOICE]
        (person,) = [i for i in items if i.group == PERSON]
        self.assertEqual(len(choice.lines), 1)
        self.assertIn("another note would also become", person.lines[0])

    def test_same_new_name_in_different_folders_is_one_choice(self):
        vault = make_vault(self)
        for rel in ("Chapters/Chapter 2/Wrap A.md", "Archive/Wrap B.md"):
            self.wrap(vault, rel,
                      'session_number: 3\nchapter: "Chapter 2"\n')
        items = mv.find_wrapup_filenames(vault)
        (choice,) = [i for i in items if i.group == CHOICE]
        (person,) = [i for i in items if i.group == PERSON]
        self.assertEqual(len(choice.lines), 1)
        self.assertEqual(len(person.lines), 1)
        choice.apply(None)

    def test_session_number_zero_is_used(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/Chapter 1/Zero.md",
                  'session_number: 0\nsession: "[[Session 05]]"\n')
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertIn("Chapter_01_Session_00_Wrap_Up.md", item.lines[0])

    def test_chapter_number_follows_the_word_chapter(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/Act 2 - Chapter 4/Old.md",
                  "session_number: 3\n")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, CHOICE)
        self.assertIn("Chapter_04_Session_03_Wrap_Up.md", item.lines[0])

    def test_a_bare_digit_chapter_counts(self):
        vault = make_vault(self)
        self.wrap(vault, "Flat/One.md", "session_number: 3\nchapter: 2\n")
        self.wrap(vault, "Flat/Two.md", 'session_number: 4\nchapter: "04"\n')
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, CHOICE)
        self.assertIn("Flat/Chapter_02_Session_03_Wrap_Up.md", item.lines[0])
        self.assertIn("Flat/Chapter_04_Session_04_Wrap_Up.md", item.lines[1])

    def test_decimal_chapter_wrap_ups_are_left_alone(self):
        vault = make_vault(self)
        for n in ("0.1", "0.5", "0.6"):
            self.wrap(vault, f"Chapters/Chapter {n} - X/Chapter_{n}_Wrap_Up.md",
                      f'chapter: "Chapter {n} \u2014 X"\nsession_number: 1\n')
        self.assertEqual(mv.find_wrapup_filenames(vault), [])

    def test_a_decimal_chapter_cannot_be_named_so_needs_a_person(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/Chapter 0.1 - X/Old Name.md",
                  "session_number: 1\n")
        self.wrap(vault, "Flat/Old2.md",
                  'session_number: 1\nchapter: "0.1"\n')
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, PERSON)
        self.assertEqual(len(item.lines), 2)

    def test_a_chapter_with_no_chapter_word_needs_a_person(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/The 7 Sisters/Old.md",
                  "session_number: 3\n")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, PERSON)

    def test_nested_layout_wikilink_chapter_and_session(self):
        vault = make_vault(self)
        self.wrap(vault, "Chapters/Chapter 4 - Calcutta/Sessions/Session 05/"
                  "Old Name.md", "session_number: 5\n")
        self.wrap(vault, "Elsewhere/Link.md",
                  'chapter: "[[Chapters/Chapter 7 - Fog]]"\n'
                  'session: "[[Session 05]]"\n')
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, CHOICE)
        self.assertIn("Chapters/Chapter 4 - Calcutta/Sessions/Session 05/"
                      "Chapter_04_Session_05_Wrap_Up.md", item.lines[0])
        self.assertIn("Elsewhere/Chapter_07_Session_05_Wrap_Up.md",
                      item.lines[1])

    def test_heritages_folder_case_is_ignored(self):
        vault = make_vault(self)
        (vault / "_meta" / "mobrpg-map.json").write_text("{}", encoding="utf-8")
        (vault / "heritages").mkdir()
        (vault / "heritages" / "Elves.md").write_text(
            "---\ntype: culture\n---\n", encoding="utf-8")
        self.assertEqual(mv.find_heritage_notes(vault), [])

    def test_mobrpg_sections_choice_adds_the_two_titles(self):
        vault = make_vault(self)
        path = vault / "_meta" / "mobrpg-map.json"
        path.write_text(json.dumps(
            {"world": "w", "vaultOnlySections": ["GM Notes", "Encounters"]}),
            encoding="utf-8")
        (item,) = mv.find_mobrpg_sections(vault)
        self.assertEqual((item.id, item.group), ("mobrpg-sections", CHOICE))
        item.apply(None)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["vaultOnlySections"],
                         ["GM Notes", "Encounters", "Campaign Log"])
        self.assertEqual(data["world"], "w")
        self.assertEqual(mv.find_mobrpg_sections(vault), [])

    def test_no_map_or_no_list_plans_nothing(self):
        vault = make_vault(self)
        self.assertEqual(mv.find_mobrpg_sections(vault), [])
        (vault / "_meta" / "mobrpg-map.json").write_text('{"world": "w"}',
                                                         encoding="utf-8")
        self.assertEqual(mv.find_mobrpg_sections(vault), [])

    def test_a_heritage_note_goes_to_the_folder_in_its_real_case(self):
        vault = make_vault(self)
        (vault / "_meta" / "mobrpg-map.json").write_text("{}", encoding="utf-8")
        (vault / "heritages").mkdir()
        (vault / "heritages" / "Humans.md").write_text(
            "---\ntype: culture\n---\n", encoding="utf-8")
        (vault / "Cultures").mkdir()
        (vault / "Cultures" / "Elves.md").write_text(
            "---\ntype: culture\n---\n", encoding="utf-8")
        (item,) = mv.find_heritage_notes(vault)
        self.assertIn("heritages/Elves.md", item.lines[0])

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_a_heritage_move_that_would_unpublish_the_page_is_a_person_row(self):
        vault = make_vault(self)
        (vault / "_meta" / "mobrpg-map.json").write_text("{}", encoding="utf-8")
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site: true\n  mode: full\n  folder_map:\n"
            "    Cultures: cultures\n---\n", encoding="utf-8")
        (vault / "Cultures").mkdir()
        (vault / "Cultures" / "Elves.md").write_text(
            "---\ntype: culture\n---\n", encoding="utf-8")
        items = mv.find_heritage_notes(vault)
        self.assertEqual([i.group for i in items], [PERSON])
        self.assertIn("folder_map", items[0].lines[0])

    def test_two_wrapups_with_one_name_and_a_link_to_it_are_for_a_person(self):
        vault = make_vault(self)
        for n in (1, 2):
            self.wrap(vault, f"Chapter {n}/Session_04_Wrap_Up.md",
                      f'session_number: 4\nchapter: "Chapter {n}"\n')
        (vault / "Note.md").write_text("[[Session_04_Wrap_Up]]\n", encoding="utf-8")
        items = mv.find_wrapup_filenames(vault)
        self.assertEqual([i.group for i in items], [PERSON])
        self.assertTrue(all("could mean either note" in l for l in items[0].lines))

    def test_a_later_move_that_would_now_claim_a_link_stops_the_batch(self):
        vault = make_vault(self)
        (vault / "A").mkdir()
        (vault / "B").mkdir()
        (vault / "A" / "Old.md").write_text("x\n", encoding="utf-8")
        (vault / "B" / "Old.md").write_text("y\n", encoding="utf-8")
        (vault / "B" / "Keep.md").write_text("[[Old]]\n", encoding="utf-8")
        # The plan the GM saw: B/Old has one certain link (same folder).
        items = mv._relink_items(vault, "x", "rename",
                                 [("B/Old.md", "B/New.md", "")])
        (item,) = items
        # Before it is applied, A/Old.md leaves: a stranger now claims nothing,
        # but a new unsure link appears in another note.
        (vault / "A" / "Old.md").unlink()
        (vault / "C.md").write_text("[[Old]]\n", encoding="utf-8")
        (vault / "A" / "Old.md").write_text("x\n", encoding="utf-8")
        with self.assertRaises(StepFailed):
            item.apply(None)

    @unittest.skipUnless(shutil.which("node"), "needs Node")
    def test_an_old_site_tool_is_worded_for_the_migration(self):
        site = Path(tempfile.mkdtemp(prefix="mig-oldtool-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        (site / "vault.config.json").write_text("{}")
        tool = site / "node_modules" / "gm-apprentice-publish" / "bin"
        tool.mkdir(parents=True)
        (tool / "gm-publish.js").write_text(
            "console.error('Error: Unknown manifest command: rename');"
            "process.exit(1);")
        vault = make_vault(self)
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site: true\n  mode: full\n"
            f"  site_dir: {site.as_posix()}\n---\n", encoding="utf-8")
        (vault / "Chapters" / "Chapter 1").mkdir(parents=True)
        (vault / "Chapters" / "Chapter 1" / "Session 03 - Ball - Wrap-Up.md"
         ).write_text("---\ntype: session_wrap\nsession_number: 3\n---\n",
                      encoding="utf-8")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, PERSON)
        self.assertIn("older than this needs", item.lines[0])
        self.assertNotIn("run the migration", item.lines[0])

    def test_heritage_notes_are_a_choice_that_moves_them(self):
        vault = make_vault(self)
        (vault / "_meta" / "mobrpg-map.json").write_text("{}", encoding="utf-8")
        (vault / "Cultures").mkdir()
        (vault / "Cultures" / "Elves.md").write_text(
            "---\ntype: culture\n---\n", encoding="utf-8")
        (vault / "A.md").write_text("[[Cultures/Elves]]\n", encoding="utf-8")
        (item,) = mv.find_heritage_notes(vault)
        self.assertEqual((item.id, item.group), ("heritage-notes", CHOICE))
        item.apply(None)
        self.assertTrue((vault / "Heritages" / "Elves.md").is_file())
        self.assertEqual((vault / "A.md").read_text(encoding="utf-8"),
                         "[[Heritages/Elves]]\n")


WS_REL = "Sessions/Chapter_01_Session_01_Wrap_Up.md"
WS_WRAP = (
    '---\ntype: session_wrap\nsession: "[[Session 01 - Start]]"\n'
    'session_number: 1\ncanon_status: DRAFT\nreconciled: null\n---\n\n'
    '# Chapter 01 · Session 01 — Start — Wrap-Up\n\n'
    '## Narrative Recap\n\nThe party arrived.\n\n'
    '## What the Party Learned\n\nA name.\n\n'
    '## Secret Plans\n\nThe Bishop moves.\n\n'
    '<!-- gm-only -->\n\n## GM Notes\n\n### World State\n\n- a\n\n'
    '<!-- /gm-only -->\n')
WS_CONFIG = ('---\ngm_apprentice_version: "1.10.27"\npublish:\n'
             '  system: coc-7e\n  wrap_up:\n'
             '    player_sections: ["What the Party Learned"]\n---\n')


class WrapupFixture(unittest.TestCase):
    def vault(self, wrap=WS_WRAP, config=WS_CONFIG):
        vault = make_vault(self)
        (vault / "_meta" / "vault-config.md").write_text(config,
                                                         encoding="utf-8")
        path = vault / WS_REL
        path.parent.mkdir(parents=True)
        path.write_text(wrap, encoding="utf-8")
        return vault

    def config(self, vault):
        return (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")


class WrapupSectionsTests(WrapupFixture):
    def choice(self, vault):
        return by_id(mv.find_wrapup_sections(vault))["wrapup-sections"]

    def test_an_unlisted_h2_is_one_choice_naming_file_and_heading(self):
        choice = self.choice(self.vault())
        self.assertEqual(choice.group, CHOICE)
        self.assertEqual(choice.wants, "move or leave")
        shown = "\n".join(choice.lines)
        self.assertIn(WS_REL, shown)
        self.assertIn("Secret Plans", shown)
        self.assertNotIn("What the Party Learned", shown)

    def test_move_renests_exactly_the_unlisted_and_keeps_the_key(self):
        vault = self.vault()
        self.choice(vault).apply("move")
        text = (vault / WS_REL).read_text(encoding="utf-8")
        self.assertIn("### Secret Plans", text)
        self.assertIn("\n## What the Party Learned\n", text)
        self.assertLess(text.index("## What the Party Learned"),
                        text.index("<!-- gm-only -->"))
        self.assertEqual(self.config(vault), WS_CONFIG)

    def test_after_move_the_listed_section_is_never_offered(self):
        vault = self.vault()
        self.choice(vault).apply("move")
        self.assertEqual(mv.find_wrapup_sections(vault), [])

    def test_leave_changes_nothing_and_says_so(self):
        vault = self.vault()
        lines = self.choice(vault).apply("leave")
        self.assertEqual((vault / WS_REL).read_text(encoding="utf-8"), WS_WRAP)
        self.assertEqual(self.config(vault), WS_CONFIG)
        self.assertEqual(lines, ["left the Wrap-Up headings where they are"])
        self.assertIn("wrapup-sections", by_id(mv.find_wrapup_sections(vault)))
        item = by_id(mv.find_wrapup_sections(vault))["wrapup-sections"]
        self.assertIn("leave: keep them where they are", " ".join(item.lines))
        self.assertTrue(item.holds_stamp)   # #339: silence is not "leave"

    def test_any_other_value_is_a_failed_step(self):
        with self.assertRaises(StepFailed):
            self.choice(self.vault()).apply("maybe")

    def test_nothing_to_move_plans_nothing_from_this_check(self):
        vault = self.vault(wrap=WS_WRAP.replace(
            "## Secret Plans\n\nThe Bishop moves.\n\n", ""))
        self.assertEqual(mv.find_wrapup_sections(vault), [])

    def test_asking_twice_without_applying_finds_the_same_choice(self):
        vault = self.vault()
        first = mv.find_wrapup_sections(vault)
        second = mv.find_wrapup_sections(vault)
        self.assertEqual([(i.id, i.group, i.lines) for i in first],
                         [(i.id, i.group, i.lines) for i in second])
        self.assertEqual(self.config(vault), WS_CONFIG)

    def test_a_fence_the_re_nest_cannot_handle_needs_a_person(self):
        vault = self.vault(wrap=WS_WRAP.replace("<!-- /gm-only -->\n", ""))
        groups = {i.group for i in mv.find_wrapup_sections(vault)}
        self.assertIn(PERSON, groups)

    def test_a_recap_rename_is_listed_in_the_choice(self):
        vault = self.vault(wrap=WS_WRAP.replace("## Narrative Recap",
                                                "## Session Recap"))
        shown = "\n".join(self.choice(vault).lines)
        self.assertIn("Session Recap", shown)
        self.assertIn("Narrative Recap", shown)
        self.choice(vault).apply("move")
        text = (vault / WS_REL).read_text(encoding="utf-8")
        self.assertIn("## Narrative Recap", text)

    def test_it_is_a_1_10_28_check_that_waits_for_the_sites_tool(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "wrapup-sections")
        self.assertEqual((check.release, check.band, check.asks_site),
                         ("1.10.28", 4, True))

    def test_move_adds_no_frontmatter_and_leaves_other_wrap_ups_alone(self):
        vault = self.vault()
        other = vault / "Sessions" / "Chapter_01_Session_02_Wrap_Up.md"
        body = WS_WRAP.replace("## Secret Plans\n\nThe Bishop moves.\n\n", "")
        other.write_text(body, encoding="utf-8")
        self.choice(vault).apply("move")
        self.assertEqual(other.read_text(encoding="utf-8"), body)
        head = (vault / WS_REL).read_text(encoding="utf-8").split("\n---\n")[0]
        self.assertEqual(head, WS_WRAP.split("\n---\n")[0])

    def test_a_blocked_wrap_up_is_untouched_by_move(self):
        broken = WS_WRAP.replace("<!-- /gm-only -->\n", "")
        vault = self.vault(wrap=broken)
        other = vault / "Sessions" / "Chapter_01_Session_02_Wrap_Up.md"
        other.write_text(WS_WRAP, encoding="utf-8")
        items = by_id(mv.find_wrapup_sections(vault))
        shown = "\n".join(items["wrapup-sections"].lines)
        self.assertNotIn("Session_01", shown)
        self.assertIn("Session_02", shown)
        self.assertIn("wrapup-sections-review", items)
        items["wrapup-sections"].apply("move")
        self.assertEqual((vault / WS_REL).read_text(encoding="utf-8"), broken)


def stamped(config, version):
    return config.replace('gm_apprentice_version: "1.10.27"',
                          f'gm_apprentice_version: "{version}"')


class WrapupSectionsKeyTests(WrapupFixture):
    """The every-pass removal of the retired list."""

    def run_key(self, vault):
        items = mv.find_wrapup_sections_key(vault)
        self.assertEqual([(i.id, i.group) for i in items],
                         [("wrapup-sections-key", WILL)])
        items[0].apply(None)

    def test_at_1_10_27_it_waits(self):
        self.assertEqual(
            mv.find_wrapup_sections_key(self.vault()), [])

    def test_at_1_10_28_and_later_it_removes_the_key(self):
        for version in ("1.10.28", "1.11.0"):
            vault = self.vault(config=stamped(WS_CONFIG, version))
            self.run_key(vault)
            self.assertNotIn("player_sections", self.config(vault))
            self.assertNotIn("wrap_up", self.config(vault))
            self.assertIn("system: coc-7e", self.config(vault))
            self.assertEqual(mv.find_wrapup_sections_key(vault), [])

    def test_no_key_plans_nothing(self):
        vault = self.vault(config='---\ngm_apprentice_version: "1.10.28"\n---\n')
        self.assertEqual(mv.find_wrapup_sections_key(vault), [])

    def test_a_missing_version_plans_nothing(self):
        vault = self.vault(config=WS_CONFIG.replace(
            'gm_apprentice_version: "1.10.27"\n', ""))
        self.assertEqual(mv.find_wrapup_sections_key(vault), [])

    def test_a_sibling_key_under_wrap_up_survives(self):
        vault = self.vault(config=stamped(WS_CONFIG, "1.10.28").replace(
            '    player_sections: ["What the Party Learned"]\n',
            '    player_sections:\n      - What the Party Learned\n'
            '    other: 1\n'))
        self.run_key(vault)
        self.assertIn("  wrap_up:\n    other: 1\n", self.config(vault))
        self.assertNotIn("player_sections", self.config(vault))

    def test_flow_list_and_crlf_config_keep_every_other_byte(self):
        config = stamped(WS_CONFIG, "1.10.28").replace("\n", "\r\n").replace(
            "  system: coc-7e\r\n", "  system: coc-7e\r\n  note: keep\r\n")
        vault = self.vault(config=config)
        self.run_key(vault)
        raw = (vault / "_meta" / "vault-config.md").read_bytes().decode()
        self.assertEqual(raw, config.replace(
            '  wrap_up:\r\n    player_sections: ["What the Party Learned"]\r\n',
            ""))

    def test_block_list_with_blank_and_following_top_level_key(self):
        config = ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                  '  wrap_up:\n    player_sections:\n'
                  '      - What the Party Learned\n\n  system: coc-7e\n'
                  'other: 1\n---\n')
        vault = self.vault(config=config)
        self.run_key(vault)
        self.assertEqual(self.config(vault),
                         '---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                         '\n  system: coc-7e\nother: 1\n---\n')

    def test_the_only_key_under_wrap_up_and_publish_leaves_publish(self):
        config = ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                  '  wrap_up:\n    player_sections: [What the Party Learned]\n'
                  '---\n')
        vault = self.vault(config=config)
        self.run_key(vault)
        self.assertEqual(self.config(vault),
                         '---\ngm_apprentice_version: "1.10.28"\npublish:\n---\n')

    def test_it_runs_every_pass_without_the_site(self):
        check = next(c for c in mv.VAULT_CHECKS
                     if c.name == "wrapup-sections-key")
        self.assertEqual((check.release, check.asks_site), (None, False))


NO_RECAP = WS_WRAP.replace("## Narrative Recap", "## Summary")
OTHER_REL = "Sessions/Chapter_01_Session_02_Wrap_Up.md"


class WrapupSectionsReviewTests(WrapupFixture):
    def test_a_wrap_up_with_no_recap_is_not_moved_and_is_for_a_person(self):
        vault = self.vault(wrap=NO_RECAP)
        other = vault / OTHER_REL
        other.write_text(WS_WRAP, encoding="utf-8")
        items = by_id(mv.find_wrapup_sections(vault))
        shown = "\n".join(items["wrapup-sections"].lines)
        self.assertIn(OTHER_REL, shown)
        self.assertNotIn(WS_REL, shown)
        person = "\n".join(items["wrapup-sections-review"].lines)
        self.assertIn(WS_REL, person)
        self.assertIn("Secret Plans", person)
        self.assertIn("no recap heading the tool recognises", person)
        self.assertIn("## Narrative Recap", person)
        self.assertIn("leaves those headings where they are", person)
        self.assertIn("by hand", person)
        items["wrapup-sections"].apply("move")
        self.assertEqual((vault / WS_REL).read_text(encoding="utf-8"),
                         NO_RECAP)
        self.assertIn("### Secret Plans",
                      other.read_text(encoding="utf-8"))

    def test_only_a_no_recap_wrap_up_offers_no_choice(self):
        items = by_id(mv.find_wrapup_sections(self.vault(wrap=NO_RECAP)))
        self.assertNotIn("wrapup-sections", items)
        self.assertIn("wrapup-sections-review", items)

    def test_choice_lines_are_plain_words(self):
        wrap = WS_WRAP.replace("## Narrative Recap", "## Session Recap").replace(
            "<!-- gm-only -->\n\n## GM Notes", "## GM Notes").replace(
            "<!-- /gm-only -->\n", "")
        shown = self.vault(wrap=wrap)
        lines = by_id(mv.find_wrapup_sections(shown))["wrapup-sections"].lines
        self.assertIn(f"{WS_REL}: '## Secret Plans' \u2014 not published", lines)
        self.assertIn(f"{WS_REL}: GM Notes gets its hidden-markers "
                      f"(it has none today)", lines)
        self.assertIn(f"{WS_REL}: '## Session Recap' is renamed "
                      f"'## Narrative Recap'", lines)
        joined = "\n".join(lines)
        self.assertNotIn("re-nest", joined)
        self.assertNotIn("Keeper-facing H2", joined)

    def test_published_and_hidden_headings_are_told_apart(self):
        import vault_check as vc
        keeper = lambda lvl, t: vc.Finding(  # noqa: E731
            lvl, f"{WS_REL}:9", "x", "keeper-h2", (t,))

        def fake(vault, file, fix, explain=None, player=None, **kw):
            kw["detail"].extend([
                vc.WrapDetail(WS_REL, keeper("ERROR", "Seen"), True),
                vc.WrapDetail(WS_REL, keeper("WARNING", "Fenced"), True)])
            return []
        with mock.patch.object(mv, "check_wrapup", side_effect=fake):
            lines = mv.find_wrapup_sections(self.vault())[0].lines
        self.assertIn(f"{WS_REL}: '## Seen' \u2014 players can see it today", lines)
        self.assertIn(f"{WS_REL}: '## Fenced' \u2014 already hidden", lines)

    def test_a_blocked_note_row_names_the_headings_and_the_fix_gap(self):
        vault = self.vault(wrap=WS_WRAP.replace("<!-- /gm-only -->\n", ""))
        rows = by_id(mv.find_wrapup_sections(vault))[
            "wrapup-sections-review"].lines
        self.assertTrue(all(r.startswith(WS_REL + "\t") for r in rows))
        text = "\n".join(rows)
        self.assertIn("'## Secret Plans'", text)
        self.assertIn("will not move them", text)

    def test_a_site_tool_that_cannot_answer_stops_the_finder(self):
        row = "ERROR\t(vault)\twrapup could not ask the publish tool"
        with mock.patch.object(mv, "check_wrapup", return_value=[row]):
            with self.assertRaises(StepFailed):
                mv.find_wrapup_sections(self.vault())

    def test_a_tool_that_stops_during_move_fails_the_step(self):
        vault = self.vault()
        choice = by_id(mv.find_wrapup_sections(vault))["wrapup-sections"]
        row = "ERROR\t(vault)\tthe publish tool stopped answering"
        with mock.patch.object(mv, "check_wrapup", return_value=[row]):
            with self.assertRaises(StepFailed):
                choice.apply("move")


class WrapupKeyDetectionTests(WrapupFixture):
    def test_a_key_of_the_same_name_under_another_parent_is_not_offered(self):
        config = ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                  '  other:\n    player_sections: [A]\n---\n')
        self.assertEqual(mv.find_wrapup_sections_key(self.vault(config=config)), [])

    def test_key_text_in_the_body_is_not_offered(self):
        config = ('---\ngm_apprentice_version: "1.10.28"\n---\n\n'
                  '  player_sections: [A]\n')
        self.assertEqual(mv.find_wrapup_sections_key(self.vault(config=config)), [])

    def test_a_quoted_key_is_removed(self):
        config = ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                  '  wrap_up:\n    "player_sections": [A]\n    other: 1\n---\n')
        vault = self.vault(config=config)
        mv.find_wrapup_sections_key(vault)[0].apply(None)
        self.assertEqual(self.config(vault),
                         '---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                         '  wrap_up:\n    other: 1\n---\n')

    def test_1_10_9_is_below_1_10_28(self):
        self.assertEqual(mv.find_wrapup_sections_key(
            self.vault(config=stamped(WS_CONFIG, "1.10.9"))), [])

    def test_a_block_list_at_the_keys_own_indent_goes_whole(self):
        for tail, want in (("    other: 1\n", "  wrap_up:\n    other: 1\n"),
                           ("", "")):
            config = ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                      '  wrap_up:\n    player_sections:\n    - A\n'
                      '    - B\n' + tail + '---\n')
            vault = self.vault(config=config)
            mv.find_wrapup_sections_key(vault)[0].apply(None)
            self.assertEqual(self.config(vault),
                             '---\ngm_apprentice_version: "1.10.28"\n'
                             'publish:\n' + want + '---\n')

    def key_config(self, body):
        return ('---\ngm_apprentice_version: "1.10.28"\npublish:\n'
                '  wrap_up:\n' + body + '---\n')

    def test_comments_and_blanks_between_list_items_go_with_the_list(self):
        for between in ("    # c\n", "\n", "    # c\n\n"):
            vault = self.vault(config=self.key_config(
                '    player_sections:\n    - A\n' + between
                + '    - B\n    other: 1\n'))
            mv.find_wrapup_sections_key(vault)[0].apply(None)
            self.assertEqual(self.config(vault),
                             self.key_config('    other: 1\n'), repr(between))

    def test_a_comment_after_the_last_item_stays(self):
        vault = self.vault(config=self.key_config(
            '    player_sections:\n    - A\n    - B\n'
            '    # about other\n    other: 1\n'))
        mv.find_wrapup_sections_key(vault)[0].apply(None)
        self.assertEqual(self.config(vault), self.key_config(
            '    # about other\n    other: 1\n'))


class SharedHelperTests(unittest.TestCase):
    def test_the_row_helpers_live_in_migrate_core(self):
        import migrate_core as core
        import migrate_site as ms
        self.assertEqual(core.cells("ERROR\tw\tm\tx"), ("ERROR", "w", "m\tx"))
        with self.assertRaises(core.StepFailed):
            core.stopped([("ERROR", "(vault)", "no tool")])
        self.assertFalse(hasattr(mv, "_cells") or hasattr(ms, "_stopped"))


class TwoHiddenBlocksTests(WrapupFixture):
    def test_a_second_hidden_block_is_listed_in_plain_words(self):
        wrap = WS_WRAP.replace(
            "## Secret Plans\n\nThe Bishop moves.\n\n",
            "<!-- gm-only -->\n\n## Secret Plans\n\nThe Bishop moves.\n\n"
            "<!-- /gm-only -->\n\n")
        lines = by_id(mv.find_wrapup_sections(self.vault(wrap=wrap))
                      )["wrapup-sections"].lines
        self.assertIn(f"{WS_REL}: its two hidden blocks become one, "
                      f"round GM Notes", lines)


class ToneWordsTests(unittest.TestCase):
    NOTE = ("---\ntype: npc\nrelationships:\n"
            '  - target: "[[A]]"\n    type: knows\n    tone: {tone}\n---\n')

    def setUp(self):
        self.vault = make_vault(self)

    def put(self, rel, text, eol="\n"):
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.replace("\n", eol).encode("utf-8"))

    def get(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")

    def test_nothing_is_offered_to_a_tidy_vault(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="warm"))
        self.assertEqual(mv.find_tone_words(self.vault), [])

    def test_only_ask_words_means_no_choice_but_a_notice(self):
        # #339: nothing for the script to tidy, but the GM is told once.
        self.put("NPCs/A.md", self.NOTE.format(tone="central"))
        self.put("NPCs/B.md", self.NOTE.format(tone="central"))
        self.put("NPCs/C.md", self.NOTE.format(tone="odd"))
        (item,) = mv.find_tone_words(self.vault)
        self.assertEqual((item.id, item.group), ("tone-words-ask", PERSON))
        self.assertEqual(item.lines, [
            "relationship tones\t2 tone words are not on the standard list "
            "and have no rule to tidy them; campaign-qa's Tone Words check "
            "asks which word to use for each"])

    def test_one_ask_word_reads_in_the_singular(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="central"))
        (item,) = mv.find_tone_words(self.vault)
        self.assertEqual(item.lines, [
            "relationship tones\t1 tone word is not on the standard list "
            "and has no rule to tidy it; campaign-qa's Tone Words check "
            "asks which word to use for each"])

    def test_tidy_rewrites_the_near_words_only(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="dread"))
        self.put("NPCs/B.md", self.NOTE.format(tone="central"))
        (item,) = mv.find_tone_words(self.vault)
        self.assertTrue(item.holds_stamp)   # #339: silence is not "leave"
        self.assertEqual(item.id, "tone-words")
        self.assertEqual(item.group, CHOICE)
        self.assertEqual(item.wants, "tidy or leave")
        self.assertIn("1 tone word tidied to the standard list by rule",
                      item.lines[0])
        self.assertIn("1 for you to pick later in campaign-qa",
                      item.lines[0])
        self.assertIn("dread -> ominous (1)", item.lines)
        done = item.apply("tidy")
        self.assertEqual(done, ["NPCs/A.md:6: dread -> ominous"])
        self.assertIn("tone: ominous", self.get("NPCs/A.md"))
        self.assertIn("tone: central", self.get("NPCs/B.md"))

    def test_tidy_keeps_crlf(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="dread"), eol="\r\n")
        (item,) = mv.find_tone_words(self.vault)
        item.apply("tidy")
        self.assertEqual(self.get("NPCs/A.md"),
                         self.NOTE.format(tone="ominous").replace("\n", "\r\n"))

    def test_tidy_says_which_strays_it_kept(self):
        # An all-CR note is read as tones but is not a line the fix takes.
        self.put("NPCs/A.md", self.NOTE.format(tone="dread"), eol="\r")
        self.put("NPCs/B.md", self.NOTE.format(tone="dread"))
        (item,) = mv.find_tone_words(self.vault)
        before = self.get("NPCs/A.md")
        done = item.apply("tidy")
        self.assertEqual(done, [
            "NPCs/B.md:6: dread -> ominous",
            "NPCs/A.md:6: dread left as written (not a plain tone line)"])
        self.assertEqual(self.get("NPCs/A.md"), before)

    def test_leave_writes_nothing(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="dread"))
        (item,) = mv.find_tone_words(self.vault)
        self.assertEqual(item.apply("leave"),
                         ["left the tone words as they are"])
        self.assertIn("tone: dread", self.get("NPCs/A.md"))

    def test_any_other_answer_is_refused(self):
        self.put("NPCs/A.md", self.NOTE.format(tone="dread"))
        (item,) = mv.find_tone_words(self.vault)
        with self.assertRaises(StepFailed):
            item.apply("yes")

    def test_the_check_is_registered_for_this_release(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "tone-words")
        self.assertEqual((check.release, check.band, check.choices),
                         ("1.10.44", 3, ("tone-words=",)))


OLD_LIST = ("friendly, romantic, respectful, professional, hostile, fearful, "
            "distrustful, contemptuous, neutral, unknown, complicated")


class ToneListTests(unittest.TestCase):
    """`_meta` files name the tone words; the update makes that the 27."""

    ENTITY = "_meta/entity-types.md"
    RELS = "_meta/relationship-types.md"
    # The two shapes real vaults hold, the lines around the list only.
    CANTICLE = ("```\n\nTone values: " + OLD_LIST + "\n\n"
                "Strength: 1–10 (1–2 weak, 9–10 defining)\n")
    DEAD = ("**Genre filter for this campaign:** `universal` + `scifi`.\n\n"
            "**tone** ∈ friendly | romantic | respectful | professional "
            "| hostile | fearful | distrustful |\n"
            "contemptuous | neutral | unknown | complicated. "
            "**strength** 1–10.\n\n")

    def setUp(self):
        self.vault = make_vault(self)
        self.words = list(mv.tone_families())

    def put(self, rel, text):
        with (self.vault / rel).open("w", encoding="utf-8", newline="") as f:
            f.write(text)

    def get(self, rel):
        with (self.vault / rel).open("r", encoding="utf-8", newline="") as f:
            return f.read()

    def applied(self):
        (item,) = mv.find_tone_list(self.vault)
        return item, item.apply(None)

    def test_the_entity_types_line_becomes_the_listed_words(self):
        self.put(self.ENTITY, self.CANTICLE)
        (item,) = mv.find_tone_list(self.vault)
        self.assertEqual((item.id, item.group, item.wants),
                         ("tone-list", WILL, None))
        self.assertEqual(item.lines, [
            "_meta/entity-types.md: the tone list becomes the 27 listed "
            "words"])
        self.assertEqual(item.apply(None), [
            "_meta/entity-types.md: the tone list is now the 27 listed "
            "words"])
        self.assertEqual(
            self.get(self.ENTITY),
            self.CANTICLE.replace(OLD_LIST, ", ".join(self.words)))

    def test_the_relationship_types_line_keeps_the_text_around_the_list(self):
        self.put(self.RELS, self.DEAD)
        item, _done = self.applied()
        self.assertEqual(item.lines, [
            "_meta/relationship-types.md: the tone list becomes the 27 "
            "listed words"])
        self.assertEqual(
            self.get(self.RELS),
            "**Genre filter for this campaign:** `universal` + `scifi`.\n\n"
            "**tone** ∈ " + " | ".join(self.words)
            + ". **strength** 1–10.\n\n")

    def test_both_files_are_one_item(self):
        self.put(self.ENTITY, self.CANTICLE)
        self.put(self.RELS, self.DEAD)
        item, done = self.applied()
        self.assertEqual(len(item.lines), 2)
        self.assertEqual(len(done), 2)
        self.assertIn(", ".join(self.words), self.get(self.ENTITY))
        self.assertIn(" | ".join(self.words), self.get(self.RELS))

    def test_crlf_line_endings_are_kept(self):
        self.put(self.ENTITY, self.CANTICLE.replace("\n", "\r\n"))
        self.put(self.RELS, self.DEAD.replace("\n", "\r\n"))
        self.applied()
        self.assertEqual(
            self.get(self.ENTITY),
            self.CANTICLE.replace(OLD_LIST, ", ".join(self.words))
            .replace("\n", "\r\n"))
        self.assertEqual(
            self.get(self.RELS),
            ("**Genre filter for this campaign:** `universal` + `scifi`.\n\n"
             "**tone** ∈ " + " | ".join(self.words)
             + ". **strength** 1–10.\n\n").replace("\n", "\r\n"))

    def test_a_second_pass_offers_nothing(self):
        self.put(self.ENTITY, self.CANTICLE)
        self.put(self.RELS, self.DEAD)
        self.applied()
        self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_a_current_list_is_left_alone(self):
        for text in ("Tone values: " + ", ".join(self.words) + "\n",
                     "Tones: " + ",\n".join(reversed(self.words)) + ".\n"):
            self.put(self.ENTITY, text)
            self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_no_list_and_no_file_offer_nothing(self):
        self.assertEqual(mv.find_tone_list(self.vault), [])
        self.put(self.ENTITY, "# Entity Types\n\n    tone: respectful\n\n"
                 "Extraction defaults: `tone: neutral`, `strength: 5`\n")
        self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_a_new_vaults_files_offer_nothing(self):
        self.assertEqual(mv.find_tone_list(whole_vault(self)), [])

    def test_text_after_the_list_on_its_line_survives(self):
        self.put(self.ENTITY, "Tone: " + OLD_LIST + ". Strength 1-10.\n")
        self.applied()
        self.assertEqual(self.get(self.ENTITY),
                         "Tone: " + ", ".join(self.words)
                         + ". Strength 1-10.\n")

    def test_a_wrapped_list_becomes_one_line(self):
        self.put(self.ENTITY,
                 "Intro.\n\nTone values: friendly, romantic, respectful,\n"
                 "professional, hostile, fearful, distrustful,\n"
                 "  contemptuous, neutral, unknown, complicated\n\nNext.\n")
        self.applied()
        self.assertEqual(self.get(self.ENTITY),
                         "Intro.\n\nTone values: " + ", ".join(self.words)
                         + "\n\nNext.\n")

    def test_two_lists_in_one_file_are_both_replaced(self):
        self.put(self.ENTITY, "Tone values: " + OLD_LIST + "\n\nMiddle.\n\n"
                 "**tone** ∈ friendly|hostile|neutral|unknown|fearful."
                 " End.\n")
        item, done = self.applied()
        self.assertEqual(item.lines, [
            "_meta/entity-types.md: the 2 tone lists become the 27 listed "
            "words"])
        self.assertEqual(done, [
            "_meta/entity-types.md: the 2 tone lists are now the 27 listed "
            "words"])
        self.assertEqual(self.get(self.ENTITY),
                         "Tone values: " + ", ".join(self.words)
                         + "\n\nMiddle.\n\n**tone** ∈ "
                         + "|".join(self.words) + ". End.\n")

    def test_only_the_stale_list_of_two_is_replaced(self):
        self.put(self.ENTITY, "Tone values: " + ", ".join(self.words)
                 + "\n\nTones: " + OLD_LIST + "\n")
        item, _done = self.applied()
        self.assertEqual(item.lines, [
            "_meta/entity-types.md: the tone list becomes the 27 listed "
            "words"])
        self.assertEqual(self.get(self.ENTITY),
                         "Tone values: " + ", ".join(self.words)
                         + "\n\nTones: " + ", ".join(self.words) + "\n")

    def test_a_list_this_step_cannot_delimit_is_left_alone(self):
        for text in (
                # a word outside both lists
                "Tone values: " + OLD_LIST + ", smitten\n",
                "Tone values: wary, " + OLD_LIST + "\n",
                "Tone values: " + OLD_LIST.replace("neutral", "Neutral")
                + "\n",
                # fewer than five words
                "Tone values: friendly, hostile, neutral, unknown\n",
                # no label on the list's first line
                "Tone values:\n" + OLD_LIST + "\n",
                "Values: " + OLD_LIST + "\n",
                "Milestone values: " + OLD_LIST + "\n",
                # two separators in one list
                "Tone values: friendly, hostile | neutral, unknown, cold\n",
                # ends in neither a full stop nor a blank line
                "Tone values: " + OLD_LIST + " (pick one)\n",
                "Tone values: " + OLD_LIST + "\nand whatever fits.\n",
                "Tone values: " + OLD_LIST + ",\n",
                "| tone | " + OLD_LIST + " |\n",
                "Tone values: `friendly`, `hostile`, `neutral`, `unknown`, "
                "`cold`\n"):
            with self.subTest(text=text):
                self.put(self.ENTITY, text)
                self.assertEqual(mv.find_tone_list(self.vault), [])
                self.assertEqual(self.get(self.ENTITY), text)

    def test_a_half_list_is_never_taken_for_the_whole(self):
        by_family = "; ".join(
            ", ".join(w for w, f in mv.tone_families().items() if f == fam)
            for fam in ("positive", "negative", "neutral"))
        for text in (
                "Tone values: friendly; romantic, respectful, professional, "
                "hostile, fearful.\n",
                "Tone values: " + by_family + ".\n",
                "Tone values: friendly, romantic, naïve, respectful, "
                "professional, hostile, fearful, distrustful.\n",
                "Tone values: friendly, romantic or respectful, "
                "professional, hostile, fearful, distrustful.\n",
                # "tone" earlier on the line is not a label for the list
                "Tones used in this campaign: hostile, fearful, cold, tense, "
                "ominous.\n",
                "The tone of the house is cold, formal, professional, "
                "cautious, transactional.\n",
                "- **tone** (optional): friendly, hostile, neutral, unknown, "
                "complicated\n",
                "In tone she was friendly, warm, loyal, devoted, "
                "protective.\n",
                "Tones of voice: friendly, formal, cold, warm, hostile.\n",
                "Use tone-neutral words: friendly, formal, cold, warm, "
                "hostile.\n",
                "Tone values (the only ones this table uses): friendly, "
                "hostile, neutral, unknown, complicated.\n",
                # a full stop that is not the end of a sentence
                "Tone values: " + OLD_LIST + ".md\n",
                "Tone values: " + OLD_LIST + ".5\n",
                "Tone values: " + OLD_LIST + "...\n",
                # bare carriage returns: the label is on its own line
                "Tone values:\r" + OLD_LIST + "\r",
                "tone\rMilestone values: " + OLD_LIST + "\r"):
            with self.subTest(text=text):
                self.put(self.ENTITY, text)
                self.assertEqual(mv.find_tone_list(self.vault), [])
                self.assertEqual(self.get(self.ENTITY), text)

    def test_labels_it_knows(self):
        for label in ("Tone values: ", "**tone** ∈ ", "Tones: ",
                      "**Tone:** ", "- `tone` = ", "tone — ",
                      "Strength 1-10. **tone** ∈ ", "Tone values:\t"):
            with self.subTest(label=label):
                self.put(self.ENTITY, label + OLD_LIST + ". After.\n")
                self.applied()
                self.assertEqual(
                    self.get(self.ENTITY),
                    label + ", ".join(self.words) + ". After.\n")

    # What vault_scaffold wrote into _meta/entity-types.md from 1.10.29 to
    # 1.10.43: entity-schema.md's relationships example as it was then.
    SCAFFOLDED = (
        "relationships:\n"
        '  - target: "[[Target Entity Name]]"\n'
        "    type: member_of       # From _meta/relationship-types.md\n"
        "    tone: respectful      # friendly | romantic | respectful\n"
        "                          # professional | hostile | fearful\n"
        "                          # distrustful | contemptuous | neutral\n"
        "                          # unknown | complicated\n"
        "    strength: 7           # 1-10 (1-2 weak, 9-10 defining)\n")
    DEFAULTS = (
        "Extraction defaults: `tone: neutral` and `strength: 5` when the\n"
        "source is ambiguous; `bidirectional: false` unless inherently\n"
        "symmetric; a `description` traceable to source text; `gm_only`\n"
        "omitted unless the edge's *existence* is the secret.\n")
    NOW = SCAFFOLDED.replace(
        "# friendly | romantic | respectful\n"
        "                          # professional | hostile | fearful\n"
        "                          # distrustful | contemptuous | neutral\n"
        "                          # unknown | complicated\n",
        "# one listed word; see Tones below\n")

    def tones_paragraph(self):
        schema = without_generated_markers(
            (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
        at = schema.index("**Tones.**")
        return schema[at:schema.index("\n\n", at)] + "\n"

    def test_the_old_text_is_what_main_scaffolded(self):
        schema = without_generated_markers(
            (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
        self.assertIn(self.NOW, schema)
        self.assertIn(self.DEFAULTS + "\n" + self.tones_paragraph(), schema)

    def test_the_scaffolded_comment_becomes_the_plugins_text(self):
        old = ("```yaml\n" + self.SCAFFOLDED + "```\n\n" + self.DEFAULTS
               + "\n### Publish control fields\n")
        new = ("```yaml\n" + self.NOW + "```\n\n" + self.DEFAULTS + "\n"
               + self.tones_paragraph() + "\n### Publish control fields\n")
        for eol in ("\n", "\r\n"):
            with self.subTest(eol=eol):
                self.put(self.ENTITY, old.replace("\n", eol))
                (item,) = mv.find_tone_list(self.vault)
                self.assertEqual(item.group, WILL)
                self.assertEqual(item.lines, [
                    "_meta/entity-types.md: the old tone words leave the "
                    "relationships example, and the Tones paragraph (the 27 "
                    "listed words) is added"])
                self.assertEqual(item.apply(None), [
                    "_meta/entity-types.md: the relationships example and "
                    "the Tones paragraph now match the plugin's"])
                self.assertEqual(self.get(self.ENTITY),
                                 new.replace("\n", eol))
                self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_the_comment_alone_when_the_paragraph_has_no_exact_place(self):
        for rest in ("",                                    # no defaults
                     self.DEFAULTS.replace("5", "6"),       # edited
                     self.DEFAULTS + "\n" + self.DEFAULTS,  # twice
                     self.DEFAULTS + "\n**Tones.** Mine.\n"):
            with self.subTest(rest=rest):
                self.put(self.ENTITY, self.SCAFFOLDED + "\n" + rest)
                (item,) = mv.find_tone_list(self.vault)
                self.assertEqual(item.lines, [
                    "_meta/entity-types.md: the old tone words leave the "
                    "relationships example"])
                item.apply(None)
                self.assertEqual(self.get(self.ENTITY),
                                 self.NOW + "\n" + rest)
                self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_a_comment_that_is_not_exactly_the_old_one_is_left_alone(self):
        for text in (
                self.SCAFFOLDED.replace("# unknown | complicated",
                                        "# unknown | complicated | wary"),
                self.SCAFFOLDED.replace("# professional | hostile | fearful\n"
                                        "                          ", ""),
                self.SCAFFOLDED.replace("| neutral\n", "| neutral\n\n"),
                self.SCAFFOLDED.replace("# unknown", "unknown")):
            with self.subTest(text=text):
                self.put(self.ENTITY, text)
                self.assertEqual(mv.find_tone_list(self.vault), [])
                self.assertEqual(self.get(self.ENTITY), text)

    def test_the_comment_and_a_list_in_one_file(self):
        self.put(self.ENTITY, self.SCAFFOLDED + "\nTone values: " + OLD_LIST
                 + "\n")
        (item,) = mv.find_tone_list(self.vault)
        self.assertEqual(len(item.lines), 2)
        item.apply(None)
        self.assertEqual(self.get(self.ENTITY), self.NOW + "\nTone values: "
                         + ", ".join(self.words) + "\n")
        self.assertEqual(mv.find_tone_list(self.vault), [])

    def test_a_file_that_is_not_utf8_is_left_alone(self):
        raw = ("Tone values: " + OLD_LIST + "\n\ncafé\n").encode("latin-1")
        (self.vault / self.ENTITY).write_bytes(raw)
        self.put(self.RELS, self.DEAD)
        (item,) = mv.find_tone_list(self.vault)
        self.assertEqual(len(item.lines), 1)
        item.apply(None)
        self.assertEqual((self.vault / self.ENTITY).read_bytes(), raw)

    def test_the_old_words_are_the_only_ones_named_here(self):
        self.assertEqual(", ".join(mv.OLD_TONES), OLD_LIST)

    def test_the_check_is_registered_for_this_release(self):
        check = next(c for c in mv.VAULT_CHECKS if c.name == "tone-list")
        self.assertEqual((check.release, check.band, check.choices,
                          check.asks_site),
                         ("1.10.44", 3, (), False))


if __name__ == "__main__":
    unittest.main()

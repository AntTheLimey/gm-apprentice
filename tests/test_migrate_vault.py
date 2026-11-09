"""migrate_vault.py: the checks that read and write vault files alone."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
import schema_rules  # noqa: E402
from layouts import on_layout  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from migrate_core import CHOICE, PERSON, WILL, StepFailed  # noqa: E402

sys.path.insert(0, str(SCRIPTS.parent.parent.parent / "scripts"))
import template_history as th  # noqa: E402
from migrate import FLOOR  # noqa: E402
from vaultlib import parse_version  # noqa: E402
from layouts import write_config  # noqa: E402

SHARED = SCRIPTS.parent


def make_vault(case, system="coc-7e"):
    vault = Path(tempfile.mkdtemp(prefix="migv-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    publish = f"publish:\n  system: {system}\n" if system else ""
    write_config(vault, f'---\ngm_apprentice_version: "1.10.12"\n{publish}---\n')
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
        self.assertNotIn("lost", items["template:_Template_NPC.md"].lines[0])
        items["template:_Template_Item.md"].apply(None)
        items["template:_Template_NPC.md"].apply("take")
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


    def test_a_regency_template_still_gets_a_missing_reputation_line(self):
        vault = make_vault(self, "coc-7e-regency")
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "_Template_NPC.md").write_text(
            plain, encoding="utf-8")
        item = by_id(mv.find_templates(vault))["template:_Template_NPC.md"]
        self.assertEqual(item.group, CHOICE)
        self.assertEqual(item.detail["comparison"]["sections_changed"],
                         [["Stats", 0, 1]])

    def test_the_choice_names_what_differs_without_a_raw_diff(self):
        # #311: "local changes are lost" gave the GM nothing to decide on;
        # the comparison does, and the row says it in counts.
        vault = make_vault(self)
        expected = mv.expected_templates(vault)["_Template_NPC.md"]
        text = expected.replace("**Armour** {none}", "**Armour** {leather}")
        self.assertNotEqual(text, expected)
        text += "\n## My Section\n"
        item = by_id(mv.find_templates(self.npc_vault(text))
                     )["template:_Template_NPC.md"]
        comparison = item.detail["comparison"]
        self.assertEqual(comparison["headings_only_vault"], ["My Section"])
        self.assertEqual(comparison["sections_changed"], [["Stats", 1, 1]])
        self.assertIn("only yours has 1 heading", item.detail["summary"])
        self.assertNotIn("Armour", item.detail["summary"])
        self.assertNotIn("\n", item.lines[0])

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
        self.assertEqual(item.detail["comparison"]["sections_changed"],
                         [["Stats", 1, 1]])
        item.apply("take")
        self.assertEqual((vault / "_Templates" / "_Template_NPC.md"
                          ).read_text(encoding="utf-8"), self.regency_build())


    def test_a_regency_template_is_updated_from_the_regency_history(self):
        # #355: a stale Regency build in a vault stamped coc-7e matches the
        # coc-7e-regency released hashes, not the coc-7e ones.
        stale = self.regency_build(comment=True).replace(
            "**Armour** {none}", "**Armour** {leather}")
        vault = self.npc_vault(stale)
        file = Path(tempfile.mkdtemp(prefix="migh-")) / "template-history.json"
        self.addCleanup(shutil.rmtree, file.parent, ignore_errors=True)
        file.write_text(json.dumps({"coc-7e-regency": {
            "_Template_NPC.md": [mv.text_hash(stale)]}}), encoding="utf-8")
        with mock.patch.object(mv, "HISTORY", file):
            item = by_id(mv.find_templates(vault))["template:_Template_NPC.md"]
        self.assertEqual(item.group, WILL)


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

    def test_a_blank_line_or_spacing_difference_is_said_in_words(self):
        plain = mv.expected_templates(make_vault(self))["_Template_NPC.md"]
        blank = plain.replace("\n\n## ", "\n## ", 1)
        spaced = plain.replace("**Armour** {none}", "**Armour**  {none}", 1)
        for text in (blank, spaced):
            self.assertNotEqual(text, plain)
            item = by_id(mv.find_templates(self.npc_vault(text))
                         )["template:_Template_NPC.md"]
            self.assertEqual(item.detail["summary"],
                             "they differ only in spacing or blank lines")

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
            [f"update the Document template to {mv.plugin_version()[0]} "
             "(it is an earlier release's text, unedited)"])
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
        item.apply("take")
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
        item.apply("take")
        self.assertEqual(path.read_text(encoding="utf-8"),
                         text.replace('source_document: ""', "source_document: |\n  line one\n  line two", 1))

    def test_a_blank_key_the_vault_deleted_is_a_difference_and_comes_back(self):
        vault = make_vault(self)
        path, text = self.write_template(vault, "pc-coc-7e.md", lambda t: t.replace('portrait: ""\n', "", 1))
        item = by_id(mv.find_templates(vault))["template:pc-coc-7e.md"]
        item.apply("take")
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

    def test_hashes_expire_by_the_release_that_last_wrote_them(self):
        # #455: a hash whose last release is older than the floor is dropped;
        # one the working tree still writes (None) and one at the floor stay.
        history = {
            "generic": {"a.md": {"h1": None, "h2": "1.10.11", "h3": "1.10.12",
                                 "h4": "1.9.30"}},
            "gurps-4e": {"b.md": {"g1": "1.9.0"}}}
        self.assertEqual(th.expire(history, "1.10.12"), {
            "generic": {"a.md": {"h1": None, "h3": "1.10.12"}},
            # emptied, not removed: a system the file does not name reads as
            # generic
            "gurps-4e": {"b.md": {}}})
        self.assertEqual(th.expire(th.expire(history, "1.10.12"), "1.10.12"),
                         th.expire(history, "1.10.12"))
        self.assertIsNone(th.refusal(["v1"]))
        self.assertIn("no release tags", th.refusal([]))

    def test_a_released_hash_is_matched_whether_the_history_lists_or_maps_it(self):
        vault = self.older(lambda old: {"coc-7e": {
            "_Template_Document.md": {mv.text_hash(old): "1.10.20"}}})
        self.assertEqual(self.doc(vault).group, WILL)

    def require_tags(self, tags):
        # In CI a missing tag set is a broken checkout, not a reason to skip:
        # a skip there would hide these checks for good.
        if tags:
            return
        if os.environ.get("CI"):
            self.fail("no release tags in this checkout; the CI checkout "
                      "needs fetch-depth: 0 so the tags come with it")
        self.skipTest("no release tags in this checkout")

    # Rebuilding the history from every release tag takes ~10 s. CI sets CI
    # and its checkout fetches tags (fetch-depth: 0), so it runs there on
    # every change; locally it runs when asked for:
    # GM_FULL_HISTORY_CHECK=1 python -m pytest tests/test_migrate_vault.py
    @unittest.skipUnless(
        os.environ.get("CI") or os.environ.get("GM_FULL_HISTORY_CHECK"),
        "slow: runs in CI, or locally with GM_FULL_HISTORY_CHECK=1")
    def test_the_checked_in_history_is_what_the_script_would_write(self):
        history = json.loads(mv.HISTORY.read_text(encoding="utf-8"))
        tags = th.release_tags()
        self.require_tags(tags)
        self.assertEqual(th.expire(th.build(tags), FLOOR), history)

    def test_every_recorded_release_is_a_tag_at_or_above_the_floor(self):
        history = json.loads(mv.HISTORY.read_text(encoding="utf-8"))
        tags = {t.removeprefix("v") for t in th.release_tags()}
        self.require_tags(tags)
        for system, names in history.items():
            for name, hashes in names.items():
                self.assertIsInstance(hashes, dict, f"{system}/{name}")
                for h, last in hashes.items():
                    if last is not None:
                        self.assertIn(last, tags, f"{system}/{name} {h}")
                        self.assertGreaterEqual(parse_version(last),
                                                parse_version(FLOOR))

    def test_an_unreadable_template_is_a_read_problem_not_a_failed_step(self):
        vault = make_vault(self)
        (vault / "_Templates").mkdir()
        (vault / "_Templates" / "_Template_NPC.md").write_bytes(b"\xff\xfe\x00bad")
        items = by_id(mv.find_templates(vault))
        self.assertEqual(items["template-unreadable:_Template_NPC.md"].group, PERSON)
        self.assertNotIn("template:_Template_NPC.md", items)

    def test_a_vault_with_no_templates_folder_gets_one(self):
        vault = make_vault(self)
        for item in mv.find_templates(vault):
            self.assertEqual(item.group, WILL)
            item.apply(None)
        self.assertTrue((vault / "_Templates" / "_Template_Session.md").is_file())


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

    def test_an_entry_that_differs_only_in_wrapping_is_not_offered(self):
        vault = make_vault(self)
        entries = self.canonical()
        kept = dict(entries)
        kept["Plan"] = entries["Plan"].replace("\n", " ")
        kept["Event"] = entries["Event"].replace(", ", ",\n", 1)
        self.assertNotEqual(kept["Plan"], entries["Plan"])
        self.mirror(vault, "## Type-Specific Fields\n\n" + "\n\n".join(kept.values()) + "\n")
        self.assertEqual(mv.find_schema_mirror(vault), [])
        kept["Plan"] = kept["Plan"].replace("plan_type", "plan_kind")
        self.mirror(vault, "## Type-Specific Fields\n\n" + "\n\n".join(kept.values()) + "\n")
        (item,) = mv.find_schema_mirror(vault)
        self.assertEqual(len(item.lines), 1)

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
        write_config(vault, "---\npublish:\n  site: true\n  mode: full\n"
            f"  site_dir: {site.as_posix()}\n---\n")
        (vault / "Chapters" / "Chapter 1").mkdir(parents=True)
        (vault / "Chapters" / "Chapter 1" / "Session 03 - Ball - Wrap-Up.md"
         ).write_text("---\ntype: session_wrap\nsession_number: 3\n---\n",
                      encoding="utf-8")
        (item,) = mv.find_wrapup_filenames(vault)
        self.assertEqual(item.group, PERSON)
        self.assertIn("older than this needs", item.lines[0])
        self.assertNotIn("run the migration", item.lines[0])



ST_OVERVIEW = """---
type: campaign_overview
---

# The Lantern Road

## Current Arc

The caravan is at Harrow Ford.

## GM Notes

Secret.
"""


def st_pc(*threads):
    lines = "".join(f"- {t}\n" for t in threads)
    return ("---\ntype: pc\n---\n\n# PC\n\n## Current Status\n\n"
            f"**Location:** Harrow Ford\n**Open threads:**\n{lines}"
            "\n## Notes\n\nNothing.\n")


def st_wrap(n, carries=True, ch="Chapter 1 - Harbour"):
    body = ("### What Carries Forward\n\n#### Unresolved Threads\n\n"
            "- **The missing ledger** — the toll keeper wants it back\n\n"
            if carries else "### Other\n\n- nothing\n\n")
    return (f"---\ntype: session_wrap\nsession_number: {n}\n"
            f'session: "[[Session {n:02d}]]"\n'
            f'chapter: "[[{ch}]]"\n---\n\n# Wrap-Up\n\n'
            f"## GM Notes\n\n{body}")


def st_session(n, ch="Chapter 1 - Harbour"):
    return (f"---\ntype: session\nsession_number: {n}\nstatus: played\n"
            f'play_date: "2026-01-{n:02d}"\nchapter: "[[{ch}]]"\n---\n\n'
            f"# Session {n}\n")


def st_raw_pc(block):
    return ("---\ntype: pc\n---\n\n# PC\n\n## Current Status\n\n"
            f"**Open threads:**\n{block}\n## Notes\n\nNothing.\n")


LEDGER = "**The missing ledger** — the toll keeper wants it back"
WRAPS = "Chapters/Chapter 1 - Harbour/"


class SharedThreadsTests(unittest.TestCase):
    def vault(self, notes):
        vault = make_vault(self)
        for rel, text in notes.items():
            path = vault / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))
        return vault

    def raw(self, vault, rel):
        return (vault / rel).read_bytes().decode("utf-8")

    def test_the_check_is_registered(self):
        (check,) = [c for c in mv.VAULT_CHECKS if c.name == "shared-threads"]
        self.assertEqual((check.release, check.band, check.kind),
                         ("1.12.3", 3, "bookkeeping"))

    def test_identical_bullets_move_once_with_holders(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/Corwin_Hale.md": st_pc(LEDGER, "Corwin's own"),
            "PCs/Ines_Marlowe.md": st_pc("Ines's own", LEDGER + "  "),
            "PCs/Odo_Vane.md": st_pc("Odo's own"),
            WRAPS + "Chapter_01_Session_02_Wrap_Up.md": st_wrap(2),
            WRAPS + "Session 02.md": st_session(2),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertEqual((item.id, item.group), ("shared-threads", WILL))
        self.assertEqual(len(item.lines), 1)
        self.assertIn("The missing ledger", item.lines[0])
        item.apply(None)
        overview = self.raw(v, "Campaign Overview.md")
        self.assertEqual(overview.count("The missing ledger"), 1)
        self.assertIn(f"- {LEDGER} — since Session 2; involves "
                      "[[Corwin_Hale]], [[Ines_Marlowe]]", overview)
        self.assertLess(overview.index("## Open Threads"),
                        overview.index("## GM Notes"))
        for rel, own in (("PCs/Corwin_Hale.md", "Corwin's own"),
                         ("PCs/Ines_Marlowe.md", "Ines's own")):
            text = self.raw(v, rel)
            self.assertNotIn("missing ledger", text)
            self.assertIn(f"- {own}\n", text)
        self.assertEqual(mv.find_shared_threads(v), [])

    def test_no_since_without_a_close_match(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc("Find the lamp-lighter"),
            "PCs/B.md": st_pc("Find the lamp-lighter"),
        })
        (item,) = mv.find_shared_threads(v)
        item.apply(None)
        self.assertIn("- Find the lamp-lighter — involves [[A]], [[B]]",
                      self.raw(v, "Campaign Overview.md"))

    def test_single_sheet_bullet_stays(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": st_pc("**The missing ledger** — someone wants it"),
        })
        self.assertEqual(mv.find_shared_threads(v), [])

    def test_struck_bullet_closed_into_latest_wrapup(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc("~~Pay the ferrywoman~~", "Still open"),
            WRAPS + "Chapter_01_Session_02_Wrap_Up.md": st_wrap(2),
            WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertIn("Pay the ferrywoman", item.lines[0])
        item.apply(None)
        latest = self.raw(v, WRAPS + "Chapter_01_Session_03_Wrap_Up.md")
        self.assertIn("#### Resolved Threads\n\n- Pay the ferrywoman — "
                      "closed: struck through before the update (A)\n",
                      latest)
        self.assertNotIn("Resolved", self.raw(
            v, WRAPS + "Chapter_01_Session_02_Wrap_Up.md"))
        pc = self.raw(v, "PCs/A.md")
        self.assertNotIn("ferrywoman", pc)
        self.assertIn("- Still open\n", pc)

    def test_struck_bullet_with_no_wrapup_stays_with_a_notice(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc("~~Pay the ferrywoman~~"),
            WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3, False),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertEqual(item.group, PERSON)
        self.assertTrue(item.notice)
        self.assertIn("What Carries Forward", item.lines[0])
        bare = self.vault({"PCs/A.md": st_pc("~~Paid~~")})
        (item,) = mv.find_shared_threads(bare)
        self.assertEqual(item.group, PERSON)
        self.assertIn("no Wrap-Up", item.lines[0])

    def test_no_overview_leaves_duplicates(self):
        v = self.vault({
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": st_pc(LEDGER),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertEqual(item.group, PERSON)
        self.assertTrue(item.notice)
        self.assertIn("no Campaign Overview to hold shared threads",
                      item.lines[0])
        self.assertIn(LEDGER, self.raw(v, "PCs/A.md"))

    def test_out_of_play_pc_does_not_count(self):
        gone = st_pc(LEDGER).replace("type: pc\n",
                                     "type: pc\nstatus: dead\n")
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": gone,
        })
        self.assertEqual(mv.find_shared_threads(v), [])

    def test_nothing_to_do_returns_no_items(self):
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc("One"),
            "PCs/B.md": st_pc("Two"),
            WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3),
        })
        self.assertEqual(mv.find_shared_threads(v), [])
        self.assertEqual(mv.find_shared_threads(make_vault(self)), [])

    def test_gm_only_bullets_never_move(self):
        fenced = st_raw_pc(f"<!-- gm-only -->\n- {LEDGER}\n<!-- /gm-only -->\n")
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": fenced,
            "PCs/B.md": fenced,
        })
        self.assertEqual(mv.find_shared_threads(v), [])
        struck = st_raw_pc("<!-- gm-only -->\n- ~~Secret done~~\n"
                           "<!-- /gm-only -->\n")
        v = self.vault({"PCs/A.md": struck,
                        WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3)})
        self.assertEqual(mv.find_shared_threads(v), [])

    def test_wrapped_bullets_compare_and_move_whole(self):
        one = st_raw_pc("- **Ledger** — the keeper\n  wants it back\n")
        other = st_raw_pc("- **Ledger** — the keeper\n  burned it\n")
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": one,
            "PCs/B.md": other,
        })
        self.assertEqual(mv.find_shared_threads(v), [])
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": one,
            "PCs/B.md": one,
        })
        (item,) = mv.find_shared_threads(v)
        item.apply(None)
        self.assertIn("- **Ledger** — the keeper wants it back — involves "
                      "[[A]], [[B]]", self.raw(v, "Campaign Overview.md"))
        for rel in ("PCs/A.md", "PCs/B.md"):
            self.assertNotIn("wants it back", self.raw(v, rel))
            self.assertNotIn("Ledger", self.raw(v, rel))

    def test_struck_wrapped_bullet_closes_whole(self):
        v = self.vault({
            "PCs/A.md": st_raw_pc("- ~~Pay the\n  ferrywoman~~\n- Open\n"),
            WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3),
        })
        (item,) = mv.find_shared_threads(v)
        item.apply(None)
        self.assertIn("- Pay the ferrywoman — closed: struck through",
                      self.raw(v, WRAPS + "Chapter_01_Session_03_Wrap_Up.md"))
        pc = self.raw(v, "PCs/A.md")
        self.assertNotIn("ferrywoman", pc)
        self.assertIn("- Open\n", pc)

    def test_template_placeholder_is_not_a_thread(self):
        holder = st_pc("{unresolved, forward-looking item}")
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": holder,
            "PCs/B.md": holder,
        })
        self.assertEqual(mv.find_shared_threads(v), [])

    def test_since_reads_the_current_chapter_only(self):
        fog = "Chapters/Chapter 2 - Fog/"
        notes = {
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": st_pc(LEDGER),
            WRAPS + "Chapter_01_Session_01_Wrap_Up.md": st_wrap(1),
            WRAPS + "Session 01.md": st_session(1),
            fog + "Chapter_02_Session_03_Wrap_Up.md":
                st_wrap(3, ch="Chapter 2 - Fog"),
            fog + "Session 03.md": st_session(3, ch="Chapter 2 - Fog"),
        }
        v = self.vault(notes)
        (item,) = mv.find_shared_threads(v)
        self.assertIn("(since Session 3)", item.lines[0])
        # No session note: no current chapter, so no since.
        v = self.vault({k: t for k, t in notes.items()
                        if not k.endswith(("Session 01.md", "Session 03.md"))})
        (item,) = mv.find_shared_threads(v)
        self.assertNotIn("since", item.lines[0])

    def test_nested_bullets_belong_to_their_parent(self):
        nested = st_raw_pc("- Find the lamp-lighter\n  - ask the ferrywoman\n")
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": nested,
            "PCs/B.md": st_pc("ask the ferrywoman"),
        })
        self.assertEqual(mv.find_shared_threads(v), [])
        v = self.vault({
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": nested,
            "PCs/B.md": nested,
        })
        (item,) = mv.find_shared_threads(v)
        item.apply(None)
        self.assertIn("- Find the lamp-lighter - ask the ferrywoman — "
                      "involves [[A]], [[B]]",
                      self.raw(v, "Campaign Overview.md"))
        self.assertNotIn("ferrywoman", self.raw(v, "PCs/A.md"))

    def test_overview_fenced_end_to_end_leaves_duplicates(self):
        fenced = ("---\ntype: campaign_overview\n---\n<!-- gm-only -->\n"
                  "# Secret\n\n## Current Arc\n\nHidden.\n")
        v = self.vault({
            "Campaign Overview.md": fenced,
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": st_pc(LEDGER),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertEqual(item.group, PERSON)
        self.assertIn("no place outside a GM-only fence", item.lines[0])
        self.assertIn(LEDGER, self.raw(v, "PCs/A.md"))

    def test_already_shared_is_a_notice(self):
        overview = ST_OVERVIEW.replace(
            "## GM Notes", f"## Open Threads\n\n- {LEDGER} — involves the "
            "party\n\n## GM Notes")
        v = self.vault({
            "Campaign Overview.md": overview,
            "PCs/A.md": st_pc(LEDGER),
            "PCs/B.md": st_pc(LEDGER),
        })
        (item,) = mv.find_shared_threads(v)
        self.assertEqual(item.group, PERSON)
        self.assertIn("already in the Campaign Overview's Open Threads",
                      item.lines[0])

    def test_crlf_kept(self):
        notes = {
            "Campaign Overview.md": ST_OVERVIEW,
            "PCs/A.md": st_pc(LEDGER, "~~Done~~"),
            "PCs/B.md": st_pc(LEDGER),
            WRAPS + "Chapter_01_Session_03_Wrap_Up.md": st_wrap(3),
        }
        v = self.vault({k: t.replace("\n", "\r\n") for k, t in notes.items()})
        (item,) = mv.find_shared_threads(v)
        self.assertEqual(len(item.lines), 2)
        item.apply(None)
        for rel in notes:
            text = self.raw(v, rel)
            self.assertNotIn("\n", text.replace("\r\n", ""), rel)
        self.assertIn("## Open Threads\r\n",
                      self.raw(v, "Campaign Overview.md"))
        self.assertIn("closed: struck through before the update (A)\r\n",
                      self.raw(v, WRAPS + "Chapter_01_Session_03_Wrap_Up.md"))


if __name__ == "__main__":
    unittest.main()

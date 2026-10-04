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


class SystemTests(unittest.TestCase):
    def test_aliases_map_to_file_ids(self):
        for written, wanted in (("CoC", "coc-7e"), ("gurps", "gurps-4e"),
                                ("dnd-5e", "dnd-5e-2024"), ("Blades", "fitd"),
                                ("pathfinder", "pf2e"),
                                ("regency-cthulhu", "coc-7e-regency")):
            self.assertEqual(mv.vault_system(make_vault(self, written)), wanted)

    def test_campaign_overview_answers_when_the_config_does_not(self):
        vault = make_vault(self, None)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\ngame_system: gurps-4e\n---\n",
            encoding="utf-8")
        self.assertEqual(mv.vault_system(vault), "gurps-4e")
        self.assertIsNone(mv.vault_system(make_vault(self, None)))


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
        vault = make_vault(self, None)
        (vault / "Overview.md").write_text(
            "---\ntype: campaign_overview\n"
            "game_system: GURPS 4th Edition\n---\n", encoding="utf-8")
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

    def test_the_history_script_will_not_drop_released_hashes(self):
        old = {"generic": {"a.md": ["h1", "h2"]}}
        self.assertIsNone(th.refusal(
            old, {"generic": {"a.md": ["h1", "h2", "h3"]}}, ["v1"]))
        self.assertIn("would be dropped", th.refusal(
            old, {"generic": {"a.md": ["h1"]}}, ["v1"]))
        self.assertIn("would be dropped", th.refusal(
            old, {"gurps-4e": {"a.md": ["h1", "h2"]}}, ["v1"]))
        self.assertIn("would be dropped", th.refusal(old, {}, ["v1"]))
        self.assertIn("no release tags", th.refusal(
            {}, {"generic": {"a.md": ["h1"]}}, []))

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


if __name__ == "__main__":
    unittest.main()

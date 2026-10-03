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


if __name__ == "__main__":
    unittest.main()

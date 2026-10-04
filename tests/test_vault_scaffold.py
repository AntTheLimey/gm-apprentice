"""vault_scaffold.py: a new vault's skeleton, whole or not at all."""

import contextlib
import io
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from vaultlib import extract_frontmatter  # noqa: E402

SHARED = SCRIPTS.parent


def scratch(case):
    """An empty temporary folder; the vault goes at scratch/'V'."""
    root = Path(tempfile.mkdtemp(prefix="scaf-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    return root


class TextTests(unittest.TestCase):
    def test_entity_types_holds_every_plugin_type_entry(self):
        text = vs.entity_types_text()
        canonical = mv.type_entries(
            (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
        self.assertTrue(canonical)
        self.assertEqual(mv.type_entries(text), canonical)
        self.assertEqual(extract_frontmatter(text)["type"], "meta")
        for title in vs.ENTITY_SECTIONS:
            self.assertIn(f"\n## {title}\n", text)
        self.assertNotIn("## Relationship Types", text)

    def test_relationship_types_holds_the_full_vocabulary(self):
        text = vs.relationship_types_text()
        data = json.loads((SHARED / "gm-apprentice-ontology.json")
                          .read_text(encoding="utf-8"))
        for p in data["predicates"]:
            self.assertIn(p["type"], text)
        self.assertIn("| Sci-Fi |", text)
        self.assertIn("| Kinship |", text)
        self.assertIn("- `parent_of` / `child_of`", text)
        self.assertEqual(extract_frontmatter(text)["type"], "meta")

    def test_the_tree_comes_from_vault_structure(self):
        tree = vs.structure_tree()
        self.assertTrue(tree.startswith("{Campaign Name}/"))
        self.assertIn("Factions & Organizations/", tree)
        self.assertNotIn("```", tree)

    def test_config_text_with_and_without_a_system(self):
        text = vs.config_text("coc-7e", "Ashford", "1.10.29")
        fm = extract_frontmatter(text)
        self.assertEqual(fm["type"], "meta")
        self.assertEqual(fm["gm_apprentice_version"], "1.10.29")
        self.assertIn('  system: "coc-7e"\n', text)
        self.assertIn("  site: false\n", text)
        self.assertIn("Campaign: Ashford", text)
        self.assertIn("├── _meta/", text)
        bare = vs.config_text(None, "Ashford", "1.10.29")
        self.assertNotIn("system:", bare)
        self.assertIn("  site: false\n", bare)

    def test_a_missing_seed_is_a_refusal(self):
        with mock.patch.object(vs, "SEEDS", SHARED / "no-such-folder"):
            with self.assertRaises(vs.ScaffoldError):
                vs.seed("timeline.md", "X")


def plan(vault, system="coc-7e", **kw):
    kw.setdefault("campaign", "Ashford")
    kw.setdefault("version", "1.10.29")
    return vs.missing(vault, system, **kw)


def paths(pieces):
    return [vs.shown(p) for p in pieces]


def note(vault, rel, text):
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class PlanTests(unittest.TestCase):
    def test_a_new_vault_gets_the_whole_skeleton(self):
        got = paths(plan(scratch(self) / "V"))
        for wanted in ("_meta/", "_Campaign/", "_Templates/", "_World/",
                       "Chapters/", "Adventures/", "_attachments/",
                       "_attachments/characters/", "_attachments/documents/",
                       "Characters/PCs/", "Characters/NPCs/", "Locations/",
                       "Factions & Organizations/", "Items & Artifacts/",
                       "Creatures/", "Heritages/", "Events/", "Documents/",
                       "Clues/", "_Templates/_Template_NPC.md",
                       "_Templates/pc-coc-7e.md", "_World/world-index.md",
                       "_World/_flags.md", "_Campaign/Timeline.md",
                       "_Campaign/Player Characters.md",
                       "_meta/entity-types.md", "_meta/relationship-types.md",
                       "_meta/index.md", "_meta/vault-config.md"):
            self.assertIn(wanted, got)
        self.assertEqual(got[-2:], ["_meta/index.md", "_meta/vault-config.md"])
        self.assertEqual(len(got), len(set(got)))
        for unwanted in ("_inbox/", "_midwife/"):
            self.assertNotIn(unwanted, got)

    def test_templates_match_the_update_tools_set(self):
        for system in (*vs.SYSTEMS, None):
            pieces = plan(scratch(self) / "V", system)
            got = {p.rel[len("_Templates/"):]: p.text() for p in pieces
                   if p.rel.startswith("_Templates/") and p.text}
            self.assertEqual(got, mv.templates_for(system), system)

    def test_inbox_only_when_asked(self):
        got = paths(plan(scratch(self) / "V", inbox=True))
        self.assertIn("_inbox/", got)
        self.assertIn("_inbox/_processed/", got)

    def test_what_exists_is_not_planned(self):
        vault = scratch(self) / "V"
        note(vault, "_Campaign/Timeline.md", "mine")
        (vault / "Locations").mkdir()
        got = paths(plan(vault))
        self.assertNotIn("_Campaign/", got)
        self.assertNotIn("_Campaign/Timeline.md", got)
        self.assertNotIn("Locations/", got)
        self.assertIn("Clues/", got)

    def test_a_renamed_type_folder_counts_as_present(self):
        vault = scratch(self) / "V"
        note(vault, "NPCs/Ada.md", "---\ntype: npc\n---\n")
        note(vault, "Gear/Sword.md", "---\ntype: weapon\n---\n")
        got = paths(plan(vault))
        self.assertNotIn("Characters/NPCs/", got)
        self.assertNotIn("Items & Artifacts/", got)
        self.assertIn("Characters/PCs/", got)

    def test_a_timeline_under_another_name_counts(self):
        vault = scratch(self) / "V"
        note(vault, "Lore/When.md", "---\ntype: timeline\n---\n")
        note(vault, "Lore/Party.md", "---\ntype: player-characters\n---\n")
        got = paths(plan(vault))
        self.assertNotIn("_Campaign/Timeline.md", got)
        self.assertNotIn("_Campaign/Player Characters.md", got)

    def test_templates_do_not_count_as_notes(self):
        vault = scratch(self) / "V"
        note(vault, "_Templates/_Template_NPC.md", "---\ntype: npc\n---\n")
        self.assertIn("Characters/NPCs/", paths(plan(vault)))

    def test_the_vaults_own_attachments_folder_is_used(self):
        vault = scratch(self) / "V"
        note(vault, "_meta/vault-config.md",
             '---\ngm_apprentice_version: "1.10.29"\npublish:\n'
             '  attachments_dir: "_resources/images"\n---\n')
        got = paths(plan(vault))
        self.assertIn("_resources/images/characters/", got)
        self.assertNotIn("_attachments/", got)

    def test_templates_can_be_left_to_the_update_tool(self):
        got = paths(plan(scratch(self) / "V", templates=False))
        self.assertIn("_Templates/", got)
        self.assertFalse([p for p in got if p.startswith("_Templates/_")])

    def test_the_wrong_kind_in_the_way_is_a_refusal(self):
        vault = scratch(self) / "V"
        note(vault, "Locations", "a file")
        with self.assertRaisesRegex(vs.ScaffoldError, "Locations"):
            plan(vault)
        vault = scratch(self) / "V"
        (vault / "_Campaign" / "Timeline.md").mkdir(parents=True)
        with self.assertRaisesRegex(vs.ScaffoldError, "Timeline.md"):
            plan(vault)

    def test_an_awkward_campaign_name_stays_out_of_frontmatter(self):
        name = 'The "Last": Stand'
        pieces = {p.rel: p for p in plan(scratch(self) / "V", campaign=name)}
        for rel in ("_Campaign/Timeline.md", "_meta/vault-config.md"):
            text = pieces[rel].text()
            self.assertIn(name, text)
            front = text.split("\n---\n", 1)[0]
            self.assertNotIn("Last", front)
            self.assertIsNotNone(extract_frontmatter(text))

    def test_the_structure_doc_and_the_skeleton_agree(self):
        tops = set(re.findall(r"^[├└]── ([^/\n]+)/", vs.structure_tree(),
                              re.M))
        made = {rel.split("/")[0] for rel in
                (*vs.PLAIN_FOLDERS, *vs.TYPE_FOLDERS, "_attachments")}
        self.assertEqual(tops, made | set(vs.NOT_CREATED))


if __name__ == "__main__":
    unittest.main()

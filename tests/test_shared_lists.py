#!/usr/bin/env python3
"""Every copy of a shared short list agrees with its one source.

The session statuses and stages, the wrap-up type spellings, the game
systems and the type folders live in the ontology file
(skills/shared/gm-apprentice-ontology.json); the other status words live
in schema_rules.py. Code derives its copies from those. What is left
typed out is prose a reader sees (a YAML comment listing the values, a
line in a reference file) and the mobRPG tool's folder maps; this test
holds each of those to the source, so a copy that drifts fails here.
"""

from __future__ import annotations

import ast
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import index_build  # noqa: E402
import schema_rules as sr  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from vaultlib import ontology  # noqa: E402

SKILLS = ROOT / "skills"
ONT = ontology()


def _words(text: str) -> set[str]:
    """The values a prose list names: split on `|`, `/`, commas, `or`,
    `and`, backticks and the `#` of a continued YAML comment."""
    cleaned = re.sub(r"[`#()]", " ", text)
    parts = re.split(r"[|/,\s]+", cleaned)
    return {p for p in parts if p and p not in ("or", "and")}


# (file under skills/, a pattern whose group 1 is the list, the values it must name)
PROSE: list[tuple[str, str, frozenset[str] | set[str]]] = [
    # Session status
    ("publish-site/references/content-filtering.md",
     r"`status: (planned[^`]+)`", sr.SESSION_NOT_YET_RUN),
    ("publish-site/references/content-filtering.md",
     r"`status: (played \|[^`]+)`", sr.SESSION_PLAYED),
    ("publish-site/references/setup-wizard.md",
     r"`status: ([^`]+)`", sr.SESSION_NOT_YET_RUN),
    # canon_status
    ("shared/entity-schema.md", r"Canon status: ([A-Z /]+) \|", sr.CANON_STATUS_VALUES),
    ("shared/canon-status.md", r"^canon_status: (DRAFT +# .+)$", sr.CANON_STATUS_VALUES),
    ("publish-site/references/schema-reference.md",
     r"\| `canon_status` \| ([A-Z /]+) —", sr.CANON_STATUS_VALUES),
    # Scenes
    ("shared/entity-schema.md",
     r"^scene_type: +# optional: (.+\n +# .+)$", sr.SCENE_TYPES),
    ("shared/templates/session-plan.md", r"^\*\*Type:\*\* (.+)$", sr.SCENE_TYPES),
    ("session-prep/references/session-templates.md",
     r"^\*\*Type:\*\* (.+)$", sr.SCENE_TYPES),
    ("shared/entity-schema.md",
     r"^status: planned {12}# (.+\n +# .+)$", sr.SCENE_STATUS),
    ("shared/session-principles.md", r"Scene status:\n`([^`]+)`", sr.SCENE_STATUS),
    # NPC and PC status
    ("shared/entity-schema.md", r"^\(([a-z/]+)\), `location`", sr.NPC_STATUS),
    ("shared/entity-schema.md", r"^\*\*PC:\*\* [^\n]*\n`status` \((alive[a-z/]+)\)",
     sr.PC_STATUS),
    ("publish-site/references/schema-reference.md",
     r"^\| `status` \| Optional \| (alive[^|]+), or a word in", sr.PC_STATUS),
    ("shared/templates/npc.md", r"^status: alive +# (.+)$", sr.NPC_STATUS),
    ("publish-site/references/schema-reference.md",
     r"^\| `status` \| Optional \| (alive, [a-z, ]+) \|$", sr.NPC_STATUS),
    # Campaign overview status (its alias is checked in test_schema_checks_agree)
    ("publish-site/references/schema-reference.md",
     r"^`status`: (not_started[^;]+);\n`active` is read as `in_progress`$",
     sr.CAMPAIGN_OVERVIEW_STATUS),
    # Faction and organization status
    ("shared/entity-schema.md", r"^`status` \((active[a-z/]+)\)", sr.FACTION_STATUS),
    ("shared/templates/organization.md", r"^status: active +# (.+)$", sr.FACTION_STATUS),
    # Plan types
    ("shared/entity-schema.md", r"`plan_type` \(([a-z/]+)\)", sr.PLAN_TYPES),
    ("shared/templates/plan.md", r'^plan_type: "" +# (.+)$', sr.PLAN_TYPES),
    ("vault-ingest/SKILL.md", r"`plan_type` (`arc`[^.]+)\.", sr.PLAN_TYPES),
]


class ProseListsTest(unittest.TestCase):
    def test_each_prose_list_names_exactly_the_values(self):
        for rel, pattern, expected in PROSE:
            with self.subTest(file=rel, pattern=pattern):
                text = (SKILLS / rel).read_text(encoding="utf-8")
                found = re.findall(pattern, text, re.M)
                self.assertTrue(found, f"{rel}: no line matches {pattern!r}")
                for listed in found:
                    self.assertEqual(_words(listed), set(expected), f"{rel}: {listed!r}")

    def test_scene_note_template_uses_listed_values(self):
        text = (SKILLS / "shared" / "templates" / "scene.md").read_text(encoding="utf-8")
        self.assertIn(re.search(r"^status: (\S+)", text, re.M).group(1), sr.SCENE_STATUS)
        self.assertEqual(_words(re.search(r"^status: planned +# (.+)$", text, re.M).group(1)),
                         set(sr.SCENE_STATUS))
        self.assertEqual(_words(re.search(r"^scene_type: +# optional: (.+)$", text,
                                          re.M).group(1)), set(sr.SCENE_TYPES))


class OntologyListsTest(unittest.TestCase):
    def test_session_statuses_are_split_in_two(self):
        self.assertFalse(sr.SESSION_PLAYED & sr.SESSION_NOT_YET_RUN)
        self.assertEqual(sr.SESSION_STATUS, sr.SESSION_PLAYED | sr.SESSION_NOT_YET_RUN)
        self.assertIn("wrap-up", sr.SESSION_PLAYED)

    def test_the_templates_write_the_first_wrap_up_spelling(self):
        text = (SKILLS / "shared" / "templates" / "session-wrap.md").read_text(encoding="utf-8")
        self.assertEqual(re.search(r"^type: (\S+)", text, re.M).group(1),
                         ONT["wrap_up_types"][0])

    def test_wrap_up_spellings_are_not_edge_targets(self):
        # The relationship check compares a type with its hyphens read as underscores.
        not_edge = set(ONT["not_edge_target_types"])
        for spelling in ONT["wrap_up_types"]:
            self.assertIn(spelling.replace("-", "_"), not_edge, spelling)

    def test_wrap_up_spellings_all_require_the_same_fields(self):
        for spelling in ONT["wrap_up_types"]:
            self.assertEqual(sr.REQUIRED_FIELDS[spelling], ["type", "canon_status", "session"])
            self.assertIn(spelling, sr.DEPRECATED_FIELDS)

    def test_no_alias_names_two_systems(self):
        seen: dict[str, str] = {}
        for system in ONT["game_systems"]:
            for word in [system["id"], *system["aliases"]]:
                self.assertEqual(word, word.lower(), word)
                self.assertNotIn(word, seen, f"{word} names {seen.get(word)} and {system['id']}")
                seen[word] = system["id"]

    def test_system_id_reads_any_case_and_aliases(self):
        self.assertEqual(sr.system_id(" Pathfinder-2E "), "pf2e")
        self.assertEqual(sr.system_id("bitd"), "fitd")
        self.assertEqual(sr.system_id("coc-7e"), "coc-7e")
        self.assertIsNone(sr.system_id(""))
        self.assertEqual(vs.SYSTEMS, sr.SYSTEMS)

    def test_type_folders_hold_types_of_the_hierarchy(self):
        hierarchy = ONT["entity_types"]["hierarchy"]
        known = {t for kids in hierarchy.values() for t in kids}
        for folder in ONT["vault_folders"]:
            for t in folder["types"]:
                self.assertIn(t, known, folder["folder"])
        self.assertIs(vs.TYPE_FOLDERS, sr.TYPE_FOLDERS)

    def test_index_sections_are_the_type_folders(self):
        # vault index sections are titled as the type folders are named (the
        # two character folders share one "Characters" section).
        by_type = {t: f["folder"] for f in ONT["vault_folders"] for t in f["types"]}
        for etype, (section, sub) in index_build.SECTION_FOR_TYPE.items():
            if etype not in by_type:
                continue
            folder = by_type[etype]
            if folder.startswith("Characters/"):
                self.assertEqual((section, sub), ("Characters", folder.split("/")[1]), etype)
            else:
                self.assertEqual(section, folder, etype)
                self.assertIn(section, index_build.SECTION_ORDER)


def _module_dict(path: Path, name: str) -> dict:
    """A literal dict assigned at the top of a module, read without
    importing it (the mobRPG tool is a separate package)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{path.name} has no {name}")


class MobrpgFoldersTest(unittest.TestCase):
    """mobRPG keeps its own folder maps (it reads the ontology lazily and
    these are import-time constants); they must name the type folders as
    the ontology does."""

    COMMANDS = ROOT / "tools" / "mobrpg" / "mobrpg" / "commands"

    def setUp(self):
        self.types_of = {f["folder"]: f["types"] for f in ONT["vault_folders"]}

    def test_push_folders(self):
        folders = _module_dict(self.COMMANDS / "map_cmd.py", "FOLDERS")
        for folder, kind in folders.items():
            self.assertIn(folder, self.types_of, folder)
            self.assertIn(kind, self.types_of[folder], folder)

    def test_write_kinds(self):
        kinds = _module_dict(self.COMMANDS / "write_cmd.py", "KIND_MAP")
        for kind, (folder, etype) in kinds.items():
            self.assertIn(folder, self.types_of, kind)
            self.assertIn(etype, self.types_of[folder], kind)


if __name__ == "__main__":
    unittest.main(verbosity=2)

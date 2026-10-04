"""vault_scaffold.py: a new vault's skeleton, whole or not at all."""

import contextlib
import io
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


if __name__ == "__main__":
    unittest.main()

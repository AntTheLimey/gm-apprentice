#!/usr/bin/env python3
"""Regression tests for relationship predicate-vocabulary validation (#130).

A single session's entity generation invented eleven predicates
(`works_for`, `captured_by`, …) that nothing validated, so they landed in
the vault and silently degraded the graph: no query, inverse-inference or
publish step knows an off-vocabulary edge. These tests pin the two places
that now catch them — `vault_check.py relationships` at authoring/QA time
and `validate_schema.py` in CI — against the authoritative vocabulary in
`skills/shared/gm-apprentice-ontology.json`.

Run: python tests/test_relationship_predicates.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHARED_SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SHARED_SCRIPTS))
sys.path.insert(0, str(REPO / "scripts"))

import schema_rules as sr  # noqa: E402
import validate_schema as vs  # noqa: E402
import vault_check as vc  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "relationship-predicates"

# The exact predicates issue #130 found in one session's output.
SESSION_03_PREDICATES = [
    "works_for", "captured_by", "commands_at", "controlled_by", "controls",
    "deceives", "equipped_with", "led_by", "occupied_by", "piloted_by",
    "taken_from",
]


def rows_for(rows, needle):
    return [r for r in rows if needle in r]


class PredicateVocabularyTests(unittest.TestCase):
    def test_vocabulary_matches_the_ontology_export(self):
        ontology = json.loads(
            (REPO / "skills" / "shared" / "gm-apprentice-ontology.json")
            .read_text(encoding="utf-8"))
        self.assertEqual(sr.predicate_vocabulary(),
                         frozenset(p["type"] for p in ontology["predicates"]))

    def test_sanctioned_predicates_are_in_the_vocabulary(self):
        for predicate in ("employs", "located_at", "member_of", "imprisons"):
            self.assertIn(predicate, sr.predicate_vocabulary())

    def test_invented_predicates_are_not_in_the_vocabulary(self):
        for predicate in SESSION_03_PREDICATES:
            self.assertNotIn(predicate, sr.predicate_vocabulary())

    def test_inverses_are_not_stored_predicates(self):
        # Storage is single-direction; the inverse name is implied, so it
        # is not part of the vocabulary an edge may carry.
        self.assertNotIn("imprisoned_by", sr.predicate_vocabulary())

    def test_suggestions_are_capped_at_three_real_predicates(self):
        for predicate in SESSION_03_PREDICATES:
            suggestions = sr.suggest_predicates(predicate)
            self.assertLessEqual(len(suggestions), 3)
            for s in suggestions:
                self.assertIn(s, sr.predicate_vocabulary())

    def test_near_miss_suggests_the_predicate_it_meant(self):
        self.assertIn("commands", sr.suggest_predicates("commands_at"))
        self.assertIn("deceived", sr.suggest_predicates("deceives"))

    def test_no_suggestion_when_nothing_is_close(self):
        self.assertEqual(sr.suggest_predicates("works_for"), [])

    def test_inverse_names_map_back_to_their_base_predicate(self):
        # Storage is single-direction, so an inverse name is off-vocabulary
        # — but the export knows exactly which predicate it inverts.
        self.assertEqual(sr.inverse_predicates()["led_by"], "leads")
        self.assertEqual(sr.inverse_predicates()["imprisoned_by"], "imprisons")
        self.assertNotIn("leads", sr.inverse_predicates())


class IterRelationshipPredicatesTests(unittest.TestCase):
    def predicates(self, name):
        text = (FIXTURE / name).read_text(encoding="utf-8")
        return list(sr.iter_relationship_predicates(text))

    def test_reads_every_edge_in_a_block(self):
        found = [p for _, _, p in self.predicates("Off Vocabulary NPC.md")]
        self.assertEqual(found, SESSION_03_PREDICATES)

    def test_reports_the_file_line_of_each_edge(self):
        first_line, _, first_pred = self.predicates("Off Vocabulary NPC.md")[0]
        self.assertEqual(first_pred, "works_for")
        self.assertEqual(first_line, 6)  # `    type: works_for`

    def test_ignores_frontmatter_type_outside_the_block(self):
        # `type: npc` sits *below* the relationships block in this fixture.
        found = [p for _, _, p in self.predicates("Clean NPC.md")]
        self.assertEqual(found, ["member_of", "located_at"])

    def test_empty_block_yields_nothing(self):
        self.assertEqual(self.predicates("Empty Edges.md"), [])

    def test_reads_the_mobrpg_node_predicate_key(self):
        found = self.predicates("Mobrpg Sync.md")
        self.assertEqual([(k, p) for _, k, p in found],
                         [("type", "imprisons"), ("predicate", "imprisoned_by")])

    def test_reads_crlf_notes(self):
        # Windows-authored vaults; the line number must still be the file's.
        text = ("---\r\ntype: npc\r\nrelationships:\r\n"
                "  - target: \"[[X]]\"\r\n    type: bogus_thing\r\n---\r\n")
        self.assertEqual(list(sr.iter_relationship_predicates(text)),
                         [(5, "type", "bogus_thing")])

    def test_reads_list_items_flush_with_their_key(self):
        # YAML allows the dash at the key's own indent; still one block.
        text = ("---\ntype: npc\nrelationships:\n"
                "- target: \"[[X]]\"\n  type: works_for\ntags: []\n---\n")
        self.assertEqual(list(sr.iter_relationship_predicates(text)),
                         [(5, "type", "works_for")])

    def test_no_frontmatter_yields_nothing(self):
        self.assertEqual(list(sr.iter_relationship_predicates("# Just a body\n")), [])


class CheckRelationshipsTests(unittest.TestCase):
    def setUp(self):
        self.rows = vc.check_relationships(FIXTURE)
        self.bad = rows_for(self.rows, "Off Vocabulary NPC.md")

    def test_all_rows_are_errors(self):
        self.assertTrue(all(r.startswith("ERROR\t") for r in self.rows))

    def test_every_invented_predicate_is_flagged_once(self):
        self.assertEqual(len(self.bad), len(SESSION_03_PREDICATES))
        for predicate in SESSION_03_PREDICATES:
            self.assertEqual(len(rows_for(self.bad, f"'{predicate}'")), 1,
                             f"expected exactly one row for {predicate}")

    def test_rows_carry_the_note_path_and_line(self):
        self.assertTrue(any("Off Vocabulary NPC.md:6\t" in r for r in self.bad))

    def test_rows_carry_suggestions_when_something_is_close(self):
        row = rows_for(self.bad, "'commands_at'")[0]
        self.assertIn("commands", row)

    def test_inverse_edges_are_told_which_way_to_store(self):
        # `led_by` is the inverse of `leads`; the nearest *string* match
        # (`cursed_by`) would be a wrong answer.
        row = rows_for(self.bad, "'led_by'")[0]
        self.assertIn("'leads'", row)
        self.assertIn("single-direction", row)
        self.assertNotIn("cursed_by", row)

    def test_rows_say_so_when_nothing_is_close(self):
        row = rows_for(self.bad, "'works_for'")[0]
        self.assertIn("no close match", row)
        self.assertIn("relationship-normalization.md", row)

    def test_sanctioned_edges_are_silent(self):
        self.assertFalse(rows_for(self.rows, "Clean NPC.md"))
        self.assertFalse(rows_for(self.rows, "Empty Edges.md"))

    def test_mobrpg_node_predicate_is_validated_too(self):
        mobrpg = rows_for(self.rows, "Mobrpg Sync.md")
        self.assertEqual(len(mobrpg), 1)
        self.assertIn("imprisoned_by", mobrpg[0])

    def test_blank_predicate_is_named_as_blank_not_as_a_bad_word(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "Blank.md").write_text(
                "---\ntype: npc\ncanon_status: DRAFT\n"
                "relationships:\n  - target: \"[[Somewhere]]\"\n"
                "    type: \"\"\n---\n\nbody\n",
                encoding="utf-8")
            rows = vc.check_relationships(Path(d))
        self.assertEqual(len(rows), 1)
        self.assertIn("blank", rows[0])
        self.assertNotIn("no close match", rows[0])

    def test_missing_ontology_reports_instead_of_crashing(self):
        original = sr.ONTOLOGY_PATH
        sr.ONTOLOGY_PATH = original.with_name("no-such-ontology.json")
        sr.predicate_vocabulary.cache_clear()
        try:
            rows = vc.check_relationships(FIXTURE)
        finally:
            sr.ONTOLOGY_PATH = original
            sr.predicate_vocabulary.cache_clear()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0].startswith("ERROR\t"))
        self.assertIn("predicate vocabulary", rows[0])


class VaultCheckCommandTests(unittest.TestCase):
    def run_vault_check(self, command):
        result = subprocess.run(
            [sys.executable, str(SHARED_SCRIPTS / "vault_check.py"),
             str(FIXTURE), command],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_relationships_command_reports_a_labelled_section(self):
        out = self.run_vault_check("relationships")
        self.assertIn("## relationships\n", out)
        self.assertIn("# count: 12\n", out)
        self.assertIn("works_for", out)

    def test_all_includes_the_relationships_section(self):
        self.assertIn("## relationships\n", self.run_vault_check("all"))


class ValidateSchemaRelationshipTests(unittest.TestCase):
    def test_off_vocabulary_edges_are_schema_errors(self):
        errors = vs.validate_relationships(FIXTURE / "Off Vocabulary NPC.md")
        self.assertEqual(len(errors), len(SESSION_03_PREDICATES))
        self.assertTrue(any("works_for" in e for e in errors))

    def test_sanctioned_edges_pass(self):
        self.assertEqual(vs.validate_relationships(FIXTURE / "Clean NPC.md"), [])

    def test_mobrpg_node_predicate_is_validated_too(self):
        errors = vs.validate_relationships(FIXTURE / "Mobrpg Sync.md")
        self.assertEqual(len(errors), 1)
        self.assertIn("imprisoned_by", errors[0])
        self.assertIn("'imprisons'", errors[0])

    def test_blank_predicate_is_named_as_blank(self):
        with tempfile.TemporaryDirectory() as d:
            note = Path(d) / "Blank.md"
            note.write_text(
                "---\ntype: npc\ncanon_status: DRAFT\n"
                "relationships:\n  - target: \"[[Somewhere]]\"\n"
                "    type: \"\"\n---\n\nbody\n",
                encoding="utf-8")
            errors = vs.validate_relationships(note)
        self.assertEqual(len(errors), 1)
        self.assertIn("blank", errors[0])

    def test_campaign_validation_fails_on_off_vocabulary_edges(self):
        # The fixture vault is schema-clean apart from its predicates, so a
        # non-zero exit here can only come from the new check.
        result = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "validate_schema.py"),
             str(FIXTURE)],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("works_for", result.stdout)
        self.assertIn("Off Vocabulary NPC.md", result.stdout)

    def test_benchmark_campaign_has_no_off_vocabulary_edges(self):
        for path in sorted((REPO / "tests" / "benchmark-campaign").rglob("*.md")):
            self.assertEqual(vs.validate_relationships(path), [], path.name)


if __name__ == "__main__":
    unittest.main(verbosity=2)

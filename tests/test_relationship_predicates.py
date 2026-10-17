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

import io
import re
import json
import subprocess
import sys
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SHARED_SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SHARED_SCRIPTS))
sys.path.insert(0, str(REPO / "scripts"))

import validate_schema as vs  # noqa: E402
import vault_check as vc  # noqa: E402

NEEDS_NODE = unittest.skipUnless(
    shutil.which("node") or os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
    "needs node")

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "relationship-predicates"

# The exact predicates issue #130 found in one session's output.
SESSION_03_PREDICATES = [
    "works_for", "captured_by", "commands_at", "controlled_by", "controls",
    "deceives", "equipped_with", "led_by", "occupied_by", "piloted_by",
    "taken_from",
]


_ONTOLOGY = json.loads(
    (REPO / "skills" / "shared" / "gm-apprentice-ontology.json")
    .read_text(encoding="utf-8"))
VOCABULARY = frozenset(p["type"] for p in _ONTOLOGY["predicates"])
INVERSE_NAMES = frozenset(p["inverse"] for p in _ONTOLOGY["predicates"]
                          if p.get("inverse"))


def rows_for(rows, needle):
    return [r for r in rows if needle in r]


class PredicateVocabularyTests(unittest.TestCase):
    def test_sanctioned_predicates_are_in_the_vocabulary(self):
        for predicate in ("employs", "located_at", "member_of", "imprisons"):
            self.assertIn(predicate, VOCABULARY)

    def test_invented_predicates_are_not_in_the_vocabulary(self):
        for predicate in SESSION_03_PREDICATES:
            self.assertNotIn(predicate, VOCABULARY)

    def test_inverses_are_not_stored_predicates(self):
        # Storage is single-direction; the inverse name is implied, so it
        # is not part of the vocabulary an edge may carry.
        self.assertNotIn("imprisoned_by", VOCABULARY)
        self.assertIn("imprisoned_by", INVERSE_NAMES)


class RelationshipPatternsDocTests(unittest.TestCase):
    """`ttrpg-expert/relationship-patterns.md` is what two skills route to
    for relationship modelling. Its first version taught a vocabulary that
    did not exist (`friend`, `married`, `reports_to`, …) and everything
    authored from it failed `vault_check.py relationships`. The document no
    longer lists the vocabulary (`relationships words` prints it); pin every
    predicate it names to the ontology so it cannot drift again."""

    DOC = REPO / "skills" / "ttrpg-expert" / "relationship-patterns.md"
    # Code spans that are edge/frontmatter keys or tone values, not predicates.
    NON_PREDICATE_SPANS = {
        "target", "source", "type", "tone", "strength", "bidirectional",
        "description", "relationships", "parent_location", "territory",
        "current_holder", "leads_to",
        "friendly", "romantic", "respectful", "professional", "hostile",
        "fearful", "distrustful", "contemptuous", "neutral", "unknown",
        "complicated",
        "positive", "negative", "warm", "loving", "loyal", "devoted",
        "protective", "trusting", "tense", "cold", "resentful", "predatory",
        "ominous", "cautious", "transactional", "formal",
    }
    # A line that names a predicate in order to warn against it.
    NEGATIVE_LINE_MARKERS = ("not in the vocabulary", "never as", "never ",
                             "off-vocabulary", "there is no", "not a ",
                             "not first-class", "do not")

    @classmethod
    def setUpClass(cls):
        cls.ontology = json.loads(
            (REPO / "skills" / "shared" / "gm-apprentice-ontology.json")
            .read_text(encoding="utf-8"))
        cls.text = cls.DOC.read_text(encoding="utf-8")
        taught = set()
        for line in cls.text.splitlines():
            if any(marker in line for marker in cls.NEGATIVE_LINE_MARKERS):
                continue
            taught.update(re.findall(r"`([a-z]+(?:_[a-z]+)*)`", line))
        cls.taught = taught - cls.NON_PREDICATE_SPANS

    def test_the_document_names_no_symmetric_list(self):
        # The symmetric predicates are marked `=` in `relationships words`; a
        # named list here would be a second copy of the ontology.
        section = self.text[self.text.index("**Symmetric predicates**"):
                            self.text.index("**Asymmetric predicates**")]
        listed = set(re.findall(r"`([a-z_]+)`", section))
        symmetric = {p["type"] for p in self.ontology["predicates"] if p["symmetric"]}
        self.assertEqual(listed & symmetric, set())

    def test_no_off_vocabulary_predicate_is_taught(self):
        # Every code span on a line that is not a warning must be a sanctioned
        # predicate or a documented inverse name — single words included, so
        # `friend` / `married` cannot come back.
        allowed = VOCABULARY | INVERSE_NAMES
        self.assertEqual(self.taught - allowed, set())

    def test_the_old_invented_vocabulary_is_really_gone(self):
        for bad in ("friend", "married", "family", "employer", "colleague",
                    "member", "leader", "lives_in", "reports_to"):
            self.assertNotIn(bad, self.taught)


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
        # `works_for` is a named verb now (the row says what it means); a
        # name with no verb and nothing near gets the old words.
        row = rows_for(self.bad, "'taken_from'")[0]
        self.assertIn("no close match", row)
        self.assertIn("relationship-normalization.md", row)

    def test_sanctioned_edges_are_silent(self):
        self.assertFalse(rows_for(self.rows, "Clean NPC.md"))
        self.assertFalse(rows_for(self.rows, "Empty Edges.md"))
        self.assertFalse(rows_for(self.rows, "Block Scalar Description.md"))

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
    """`validate_schema.py` asks the publish tool, as vault_check does."""

    def run_campaign(self, directory: Path) -> tuple[int, str]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = vs.validate_campaign(directory)
        return code, out.getvalue()

    def test_unreadable_note_is_reported_by_the_caller(self):
        # A directory named *.md is not readable as text: validate_campaign
        # must say so itself, not lean on another checker having said it.
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "Broken.md").mkdir()
            code, out = self.run_campaign(Path(d))
        self.assertEqual(code, 1, out)
        self.assertIn("Could not read file", out)

    def test_a_tool_that_cannot_answer_fails_the_run(self):
        row = ["ERROR\t(vault)\tcould not check the relationships: node is not on PATH"]
        with mock.patch.object(vs.vault_check, "check_relationships",
                               return_value=row):
            code, out = self.run_campaign(FIXTURE)
        self.assertEqual(code, 1)
        self.assertIn("node is not on PATH", out)

    @NEEDS_NODE
    def test_campaign_validation_fails_on_off_vocabulary_edges(self):
        # The fixture vault is schema-clean apart from its predicates, so a
        # non-zero exit here can only come from the relationship check.
        result = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "validate_schema.py"),
             str(FIXTURE)],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("works_for", result.stdout)
        self.assertIn("Off Vocabulary NPC.md", result.stdout)
        self.assertIn("Line 6:", result.stdout)

    @NEEDS_NODE
    def test_benchmark_campaign_has_no_relationship_findings(self):
        # Every kind of finding counts here: the benchmark vault is clean.
        self.assertEqual(
            vs.relationship_rows(REPO / "tests" / "benchmark-campaign"), {})

    @NEEDS_NODE
    def test_shipped_templates_have_no_off_vocabulary_edges(self):
        # Scaffolded notes inherit these placeholders, so a bad predicate in a
        # template lands in the GM's vault as a finding the plugin authored.
        rows = vc.check_relationships(
            REPO / "skills" / "shared" / "templates")
        bad = [r for r in rows if "off-vocabulary" in r or "blank" in r]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)

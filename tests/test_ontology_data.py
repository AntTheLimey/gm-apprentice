import json, re, sys, unittest
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent

ONT = json.loads((REPO / "skills/shared/gm-apprentice-ontology.json").read_text(encoding="utf-8"))

VOCAB = frozenset(p["type"] for p in ONT["predicates"])
INVERSES = frozenset(p["inverse"] for p in ONT["predicates"] if p.get("inverse"))


def type_key(raw):
    return re.sub(r"[\s-]+", "_", str(raw).strip().lower())


class OntologyData(unittest.TestCase):
    def test_required_relationships_is_gone(self):
        self.assertNotIn("required_relationships", ONT)

    def test_the_file_is_its_own_source(self):
        self.assertEqual(ONT["source_of_truth"], "skills/shared/gm-apprentice-ontology.json")
        self.assertEqual(ONT["version"], "1.4")

    def test_every_verb_choice_is_a_real_predicate(self):
        vocab = VOCAB
        for verb, choices in ONT["verbs"].items():
            self.assertEqual(verb, type_key(verb), verb)
            self.assertNotIn(verb, vocab, f"{verb} is already a predicate")
            for c in choices:
                self.assertIn(c["use"], vocab, verb)
                self.assertIsInstance(c["flip"], bool)

    def test_no_verb_repeats_an_inverse_name(self):
        # Inverse names are already exact fixes as inverse names.
        self.assertFalse(set(ONT["verbs"]) & INVERSES)

    def test_same_fact_pairs_are_predicates(self):
        self.assertIn(["serves", "employs"], [list(p) for p in ONT["same_fact"]])
        for a, b in ONT["same_fact"]:
            self.assertIn(a, VOCAB)
            self.assertIn(b, VOCAB)

    def test_place_fields(self):
        self.assertEqual({p["field"] for p in ONT["place_fields"]}, {"parent_location", "current_holder"})

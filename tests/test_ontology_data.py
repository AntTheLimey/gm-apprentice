import json, sys, unittest
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
import schema_rules as sr  # noqa: E402

ONT = json.loads((REPO / "skills/shared/gm-apprentice-ontology.json").read_text(encoding="utf-8"))

class OntologyData(unittest.TestCase):
    def test_required_relationships_is_gone(self):
        self.assertNotIn("required_relationships", ONT)

    def test_the_file_is_its_own_source(self):
        self.assertEqual(ONT["source_of_truth"], "skills/shared/gm-apprentice-ontology.json")
        self.assertEqual(ONT["version"], "1.4")

    def test_every_verb_choice_is_a_real_predicate(self):
        vocab = sr.predicate_vocabulary()
        for verb, choices in ONT["verbs"].items():
            self.assertEqual(verb, sr.type_key(verb), verb)
            self.assertNotIn(verb, vocab, f"{verb} is already a predicate")
            for c in choices:
                self.assertIn(c["use"], vocab, verb)
                self.assertIsInstance(c["flip"], bool)

    def test_no_verb_repeats_an_inverse_name(self):
        # Inverse names are already exact fixes via inverse_predicates().
        self.assertFalse(set(ONT["verbs"]) & set(sr.inverse_predicates()))

    def test_lookups(self):
        self.assertEqual(sr.verb_choices("Works For"), [{"use": "employs", "flip": True}])
        self.assertEqual(sr.verb_choices("investigated_by"), [])
        self.assertIsNone(sr.verb_choices("frobnicates"))
        self.assertIn(("serves", "employs"), sr.same_fact_pairs())
        self.assertEqual({p["field"] for p in sr.place_fields()}, {"parent_location", "current_holder"})

    def test_same_fact_pairs_are_predicates(self):
        for a, b in sr.same_fact_pairs():
            self.assertIn(a, sr.predicate_vocabulary()); self.assertIn(b, sr.predicate_vocabulary())

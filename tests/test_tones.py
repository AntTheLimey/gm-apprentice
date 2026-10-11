#!/usr/bin/env python3
"""Tone words: the fixed list, the near-miss table, and the tools on them."""

import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import schema_rules as sr  # noqa: E402

ONTOLOGY = json.loads((REPO / "skills" / "shared" /
                       "gm-apprentice-ontology.json").read_text(encoding="utf-8"))

LISTED = {
    "positive": ["positive", "friendly", "warm", "loving", "romantic",
                 "loyal", "devoted", "protective", "trusting", "respectful"],
    "negative": ["negative", "hostile", "fearful", "distrustful",
                 "contemptuous", "tense", "cold", "resentful", "predatory",
                 "ominous"],
    "neutral": ["neutral", "unknown", "complicated", "cautious",
                "transactional", "formal", "professional"],
}

NOTE = """---
type: npc
tone: grim
relationships:
  - target: "[[A]]"
    type: knows
    tone: "Cordial"  # per S3
    description: |
      tone: dread
      a line of prose
  - target: "[[B]]"
    type: serves
    tone: warm
  - target: "[[C]]"
    type: knows
    tone:
mobrpg:
  relationships:
    - predicate: knows
      tone: zealous
---
Body. tone: ominous
"""


class ListTests(unittest.TestCase):
    def test_the_list_is_the_27_words_ant_agreed(self):
        self.assertEqual(ONTOLOGY["tones"], LISTED)
        self.assertEqual(len(sr.tone_families()), 27)

    def test_professional_is_neutral(self):
        self.assertEqual(sr.tone_family("professional"), "neutral")

    def test_family_is_exact(self):
        self.assertEqual(sr.tone_family("warm"), "positive")
        self.assertIsNone(sr.tone_family("Warm"))
        self.assertIsNone(sr.tone_family("dread"))
        self.assertIsNone(sr.tone_family(["warm"]))

    def test_every_near_target_is_listed_and_no_key_is(self):
        listed = set(sr.tone_families())
        for stray, word in ONTOLOGY["tone_near"].items():
            self.assertIn(word, listed, stray)
            self.assertNotIn(stray, listed)
            self.assertEqual(stray, sr.tone_key(stray))

    def test_proposals(self):
        self.assertEqual(sr.tone_proposal("dread"), "ominous")
        self.assertEqual(sr.tone_proposal("Cordial"), "friendly")
        self.assertEqual(sr.tone_proposal("  WARM "), "warm")
        self.assertEqual(sr.tone_proposal("Warm"), "warm")
        self.assertIsNone(sr.tone_proposal("warm"))
        self.assertIsNone(sr.tone_proposal("central"))
        self.assertIsNone(sr.tone_proposal("[a, b]"))


class IterTests(unittest.TestCase):
    def test_only_edge_tones_of_the_top_level_block(self):
        self.assertEqual(list(sr.iter_relationship_tones(NOTE)),
                         [(7, "Cordial"), (13, "warm")])

    def test_predicates_are_unchanged(self):
        self.assertEqual(
            [(n, k, v) for n, k, v in sr.iter_relationship_predicates(NOTE)],
            [(6, "type", "knows"), (12, "type", "serves"),
             (15, "type", "knows"), (19, "predicate", "knows")])

    def test_crlf(self):
        crlf = NOTE.replace("\n", "\r\n")
        self.assertEqual(list(sr.iter_relationship_tones(crlf)),
                         [(7, "Cordial"), (13, "warm")])


class DocTests(unittest.TestCase):
    def test_both_documents_name_every_listed_word(self):
        for rel in ("skills/ttrpg-expert/relationship-patterns.md",
                    "skills/shared/entity-schema.md"):
            text = (REPO / rel).read_text(encoding="utf-8")
            start = text.index("Tones")
            for word in sr.tone_families():
                self.assertIn(word, text[start:], f"{rel}: {word}")


import tempfile  # noqa: E402

import tones  # noqa: E402


def note(*tone_lines):
    edges = "".join(f'  - target: "[[T{i}]]"\n    type: knows\n{line}\n'
                    for i, line in enumerate(tone_lines))
    return f"---\ntype: npc\nrelationships:\n{edges}---\nBody\n"


class VaultCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, rel, text, newline=""):
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline=newline)

    def get(self, rel):
        return (self.vault / rel).read_bytes().decode("utf-8")


class ReportTests(VaultCase):
    def test_report(self):
        self.put("NPCs/A.md", note("    tone: warm", "    tone: Cordial",
                                   "    tone: cordial"))
        self.put("NPCs/B.md", note("    tone: Warm", "    tone: hostile",
                                   "    tone: neutral", "    tone: friendly",
                                   "    tone: ominous"))
        self.put("NPCs/C.md", note("    tone: central"))
        self.assertEqual(tones.report_lines(tones.survey(self.vault)), [
            "# tones: 9  listed: 5  near: 3  ask: 1",
            "NEAR\tcordial\tfriendly\t2",
            "NEAR\twarm\twarm\t1",
            "ASK\tcentral\t1\tNPCs/C.md",
        ])

    def test_old_records_and_templates_are_not_read(self):
        for folder in ("_QA", "_archive", "_Templates", "_inbox"):
            self.put(f"{folder}/X.md", note("    tone: dread"))
        self.assertEqual(tones.report_lines(tones.survey(self.vault)),
                         ["# tones: 0  listed: 0  near: 0  ask: 0"])

    def test_ask_row_names_at_most_three_notes(self):
        for name in "DCBA":
            self.put(f"NPCs/{name}.md", note("    tone: tragic"))
        self.assertEqual(tones.report_lines(tones.survey(self.vault))[1],
                         "ASK\ttragic\t4\tNPCs/A.md; NPCs/B.md; NPCs/C.md")

    def test_main_prints_the_report(self):
        import contextlib
        import io
        self.put("NPCs/A.md", note("    tone: dread"))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = tones.main([str(self.vault)])
        self.assertEqual(code, 0)
        self.assertIn("NEAR\tdread\tominous\t1", out.getvalue())


if __name__ == "__main__":
    unittest.main()

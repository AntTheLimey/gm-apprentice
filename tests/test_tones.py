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


class FixTests(VaultCase):
    def test_near_rewrites_and_keeps_the_rest_of_the_line(self):
        self.put("NPCs/A.md", note('    tone: "Cordial"  # per S3',
                                   "    tone: 'dread'", "    tone: Warm",
                                   "    tone: central", "    tone: hostile"))
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        text = self.get("NPCs/A.md")
        self.assertIn('    tone: "friendly"  # per S3\n', text)
        self.assertIn("    tone: 'ominous'\n", text)
        self.assertIn("    tone: warm\n", text)
        self.assertIn("    tone: central\n", text)
        self.assertEqual(tones.rows(p, done=True), [
            "CHANGED\tNPCs/A.md:6\tCordial -> friendly",
            "CHANGED\tNPCs/A.md:9\tdread -> ominous",
            "CHANGED\tNPCs/A.md:12\tWarm -> warm",
            "# 3 tone(s) in 1 note(s)",
        ])

    def test_preview_writes_nothing_and_matches_the_write(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        before = self.get("NPCs/A.md")
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(self.get("NPCs/A.md"), before)
        self.assertEqual(tones.rows(p)[0],
                         "WOULD-CHANGE\tNPCs/A.md:6\tdread -> ominous")
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"), p.texts["NPCs/A.md"])

    def test_crlf_note_changes_only_the_word(self):
        self.put("NPCs/A.md", note("    tone: dread").replace("\n", "\r\n"))
        before = self.get("NPCs/A.md")
        tones.apply(tones.plan_fix(self.vault, near=True, sets={}))
        self.assertEqual(self.get("NPCs/A.md"),
                         before.replace("tone: dread", "tone: ominous"))

    def test_set_wins_over_near_and_works_without_it(self):
        self.put("NPCs/A.md", note("    tone: cordial", "    tone: central",
                                   "    tone: dread"))
        tones.apply(tones.plan_fix(
            self.vault, near=False,
            sets={"cordial": "professional", "Central": "neutral"}))
        text = self.get("NPCs/A.md")
        self.assertIn("tone: professional\n", text)
        self.assertIn("tone: neutral\n", text)
        self.assertIn("tone: dread\n", text)

    def test_refusals(self):
        self.put("NPCs/A.md", note("    tone: central", "    tone: warm"))
        for sets, said in (({"central": "ominouss"}, "not a listed tone"),
                           ({"warm": "friendly"}, "already a listed tone"),
                           ({"sibling": "neutral"}, "no relationship has")):
            with self.assertRaises(tones.TonesError) as raised:
                tones.plan_fix(self.vault, near=False, sets=sets)
            self.assertIn(said, str(raised.exception))

    def test_other_tone_text_is_never_touched(self):
        text = ("---\ntype: npc\ntone: dread\nrelationships:\n"
                '  - target: "[[A]]"\n    type: knows\n'
                "    description: |\n      tone: dread\n"
                "mobrpg:\n  relationships:\n    - predicate: knows\n"
                "      tone: dread\n---\ntone: dread\n")
        self.put("NPCs/A.md", text)
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(p.texts, {})
        self.assertEqual(tones.rows(p), ["# 0 tone(s) in 0 note(s)"])

    def test_a_line_it_cannot_rewrite_is_kept_and_listed(self):
        # A word holding a quote mark is read as a tone but is not a line
        # the fix's pattern takes, so it is listed and left.
        self.put("NPCs/A.md", note("    tone: rock'n", "    tone: dread"))
        p = tones.plan_fix(self.vault, near=True, sets={"rock'n": "neutral"})
        self.assertEqual(len(p.changes), 1)
        self.assertEqual(p.kept, [("NPCs/A.md", 6, "rock'n")])
        self.assertIn("tone: rock'n", p.texts["NPCs/A.md"])
        self.assertEqual(tones.rows(p)[-1],
                         "# 1 tone(s) in 1 note(s), 1 left as written")

    def test_a_note_that_is_not_utf8_stops_the_run(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        (self.vault / "NPCs" / "B.md").write_bytes(
            note("    tone: dread").encode("utf-8") + b"\xff\xfe")
        with self.assertRaises(tones.TonesError) as raised:
            tones.plan_fix(self.vault, near=True, sets={})
        self.assertIn("NPCs/B.md is not UTF-8 text", str(raised.exception))
        self.assertIn("tone: dread", self.get("NPCs/A.md"))

    def test_a_bare_cr_line_ending_never_rewrites_a_wrong_line(self):
        # The survey reads "\r" as a line break; the fix splits on "\n"
        # only, so the line numbers differ. The word guard must keep the
        # tone, never touch another line.
        text = note("    tone: dread", "    tone: dread").replace("\n", "\r")
        self.put("NPCs/A.md", text)
        before = self.get("NPCs/A.md")
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(p.changes, [])
        self.assertEqual(len(p.kept), 2)
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"), before)

    def test_a_note_with_a_byte_order_mark_is_left_alone(self):
        self.put("NPCs/A.md", "﻿" + note("    tone: dread"))
        before = self.get("NPCs/A.md")
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"), before)

    def test_command_line(self):
        import contextlib
        import io
        self.put("NPCs/A.md", note("    tone: dread", "    tone: central"))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tones.main([str(self.vault), "fix"]), 2)
            self.assertEqual(tones.main([str(self.vault), "--near"]), 2)
            self.assertEqual(tones.main(
                [str(self.vault), "fix", "--set", "central"]), 2)
            self.assertEqual(tones.main(
                [str(self.vault), "fix", "--set", "central=nope"]), 1)
            self.assertEqual(tones.main(
                [str(self.vault), "fix", "--near", "--set",
                 "central=neutral", "--write"]), 0)
        text = self.get("NPCs/A.md")
        self.assertIn("tone: ominous\n", text)
        self.assertIn("tone: neutral\n", text)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Tone words: the fixed list, the near-miss table, and the tools on them."""

import json
import re
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


    def test_an_empty_frontmatter_has_no_relationships(self):
        # `---` straight after `---` closes the frontmatter: a later `---`
        # in the body does not, and the body is never read as YAML.
        for eol in ("\n", "\r\n"):
            text = ("---\n---\nText.\n\nrelationships:\n"
                    '  - target: "[[X]]"\n    type: bogus\n    tone: wary\n'
                    "\n---\n\nMore.\n").replace("\n", eol)
            self.assertEqual(list(sr.iter_relationship_tones(text)), [])
            self.assertEqual(list(sr.iter_relationship_predicates(text)), [])
        self.assertEqual(list(sr.iter_relationship_tones("---\n---")), [])

    def test_a_null_tone_is_no_tone(self):
        text = note("    tone: null", "    tone: ~", "    tone: Null",
                    "    tone: dread")
        self.assertEqual(list(sr.iter_relationship_tones(text)),
                         [(15, "dread")])


def doc_families(text):
    """The words a document lists under each family, from its table row
    (relationship-patterns.md) or its `**Tones.**` sentence
    (entity-schema.md)."""
    start = text.index("## Tones") if "## Tones" in text \
        else text.index("**Tones.**")
    part = text[start:]
    row = re.search(r"^\| (positive,[^|]*)\|([^|]*)\|([^|]*)\|$", part, re.M)
    if row:
        cells = row.groups()
    else:
        cells = re.search(r"one of:(.*?)\(positive\);(.*?)\(negative\);"
                          r"(.*?)\(neutral\)", part, re.S).groups()
    return {family: [w.strip() for w in cell.split(",")]
            for family, cell in zip(("positive", "negative", "neutral"),
                                    cells)}


class DocTests(unittest.TestCase):
    def test_both_documents_list_exactly_the_words_by_family(self):
        for rel in ("skills/ttrpg-expert/relationship-patterns.md",
                    "skills/shared/entity-schema.md"):
            text = (REPO / rel).read_text(encoding="utf-8")
            self.assertEqual(doc_families(text), LISTED, rel)

    def test_every_template_tone_is_listed(self):
        seen = 0
        for path in sorted((REPO / "skills" / "shared" /
                            "templates").glob("*.md")):
            for line in path.read_text(encoding="utf-8").splitlines():
                m = re.match(r"\s+tone:\s*([^#\s]+)", line)
                if m:
                    seen += 1
                    self.assertIn(m.group(1), sr.tone_families(), path.name)
        self.assertGreater(seen, 10)


import contextlib  # noqa: E402
import io  # noqa: E402
import tempfile  # noqa: E402
from unittest import mock  # noqa: E402

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

    def run_main(self, *args):
        """(exit code, stdout, stderr) of `tones.py VAULT args`."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tones.main([str(self.vault), *args])
        return code, out.getvalue(), err.getvalue()


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
            "# positive: positive, friendly, warm, loving, romantic, loyal, "
            "devoted, protective, trusting, respectful",
            "# negative: negative, hostile, fearful, distrustful, "
            "contemptuous, tense, cold, resentful, predatory, ominous",
            "# neutral: neutral, unknown, complicated, cautious, "
            "transactional, formal, professional",
        ])

    def test_the_list_is_printed_only_when_the_gm_has_words_to_pick(self):
        self.put("NPCs/A.md", note("    tone: Cordial"))
        self.assertEqual(tones.report_lines(tones.survey(self.vault)), [
            "# tones: 1  listed: 0  near: 1  ask: 0",
            "NEAR\tcordial\tfriendly\t1"])

    def test_report_over_a_crlf_note(self):
        self.put("NPCs/A.md", note("    tone: Cordial", "    tone: warm")
                 .replace("\n", "\r\n"))
        self.assertEqual(tones.report_lines(tones.survey(self.vault)), [
            "# tones: 2  listed: 1  near: 1  ask: 0",
            "NEAR\tcordial\tfriendly\t1"])

    def test_a_vault_that_is_not_a_directory_is_a_usage_error(self):
        import contextlib
        import io
        self.put("file.md", "x")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = tones.main([str(self.vault / "file.md")])
            gone = tones.main([str(self.vault / "NOT_A_DIRECTORY")])
        self.assertEqual((code, gone), (2, 2))
        self.assertIn("tones.py: not a directory: ", err.getvalue())
        self.assertEqual(len(err.getvalue().splitlines()), 2)

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
        bad = note("    tone: dread").encode("utf-8") + b"\xff\xfe"
        (self.vault / "NPCs" / "B.md").write_bytes(bad)
        with self.assertRaises(tones.TonesError) as raised:
            tones.plan_fix(self.vault, near=True, sets={})
        self.assertIn("NPCs/B.md is not UTF-8 text", str(raised.exception))
        self.assertIn("tone: dread", self.get("NPCs/A.md"))
        self.assertEqual((self.vault / "NPCs" / "B.md").read_bytes(), bad)

    def test_a_bare_cr_inside_a_line_still_hits_the_right_lines(self):
        text = ("---\ntype: npc\nnote: a\rb\nrelationships:\n"
                '  - target: "[[A]]"\n    type: knows\n    tone: dread\n'
                '  - target: "[[B]]"\n    type: knows\n    tone: dread\n'
                '  - target: "[[C]]"\n    type: knows\n    tone: dread\n'
                "---\nBody\n")
        self.put("NPCs/A.md", text)
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"),
                         text.replace("tone: dread", "tone: ominous"))
        self.assertEqual([c.lineno for c in p.changes], [7, 10, 13])
        self.assertEqual(p.kept, [])

    def test_an_all_cr_note_is_listed_and_left_byte_for_byte(self):
        text = note("    tone: dread", "    tone: dread").replace("\n", "\r")
        self.put("NPCs/A.md", text)
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(p.changes, [])
        self.assertEqual(len(p.kept), 2)
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"), text)

    def test_untouched_lines_keep_their_bytes(self):
        for eol in ("\n", "\r\n"):
            text = note('    tone: "Cordial"  # c', "    tone: warm",
                        "    tone: dread").replace("\n", eol)
            self.put("NPCs/A.md", text)
            tones.apply(tones.plan_fix(self.vault, near=True, sets={}))
            old, new = text.split("\n"), self.get("NPCs/A.md").split("\n")
            self.assertEqual(len(old), len(new))
            self.assertEqual([i for i in range(len(old)) if old[i] != new[i]],
                             [5, 11])

    def test_two_set_keys_for_one_word_are_refused(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        with self.assertRaises(tones.TonesError) as raised:
            tones.plan_fix(self.vault, near=False,
                           sets={"Dread": "ominous", "dread": "tense"})
        self.assertIn("dread is set to both", str(raised.exception))
        p = tones.plan_fix(self.vault, near=False,
                           sets={"Dread": "ominous", "dread": "ominous"})
        self.assertEqual(len(p.changes), 1)

    def test_the_same_word_set_twice_is_refused(self):
        # A list of pairs, as main gives them: nothing collapses first.
        self.put("NPCs/A.md", note("    tone: dread"))
        with self.assertRaises(tones.TonesError) as raised:
            tones.plan_fix(self.vault, near=False,
                           sets=[("dread", "ominous"), ("dread", "tense")])
        self.assertEqual(str(raised.exception),
                         "dread is set to both ominous and tense")
        p = tones.plan_fix(self.vault, near=False,
                           sets=[("dread", "ominous"), ("dread", "ominous")])
        self.assertEqual(len(p.changes), 1)

    def test_the_same_word_set_twice_on_the_command_line(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        before = self.get("NPCs/A.md")
        code, _out, err = self.run_main(
            "fix", "--set", "dread=ominous", "--set", "dread=tense",
            "--write")
        self.assertEqual(code, 1)
        self.assertEqual(err, "tones.py: dread is set to both ominous and "
                              "tense\n")
        self.assertEqual(self.get("NPCs/A.md"), before)
        code, out, _err = self.run_main(
            "fix", "--set", "dread=ominous", "--set", "dread=ominous")
        self.assertEqual(code, 0)
        self.assertIn("WOULD-CHANGE\tNPCs/A.md:6\tdread -> ominous", out)

    def test_except_leaves_a_near_word_alone(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: Dread",
                                   "    tone: cordial", "    tone: Warm"))
        p = tones.plan_fix(self.vault, near=True, sets={},
                           excepts=[" DREAD ", "warm"])
        self.assertEqual([(c.before, c.after) for c in p.changes],
                         [("cordial", "friendly")])
        self.assertEqual(p.kept, [])

    def test_a_set_wins_over_an_except_for_the_same_word(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: cordial"))
        p = tones.plan_fix(self.vault, near=True, sets={"dread": "tense"},
                           excepts=["dread"])
        self.assertEqual([(c.before, c.after) for c in p.changes],
                         [("dread", "tense"), ("cordial", "friendly")])

    def test_an_except_no_near_row_has_is_refused(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: central",
                                   "    tone: warm"))
        for word in ("cordial", "central", "warm"):
            with self.assertRaises(tones.TonesError) as raised:
                tones.plan_fix(self.vault, near=True, sets={},
                               excepts=[word])
            self.assertEqual(str(raised.exception),
                             f"no NEAR row has the tone {word}")

    def test_except_on_the_command_line(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: cordial",
                                   "    tone: grim"))
        before = self.get("NPCs/A.md")
        for args in (("fix", "--set", "dread=tense", "--except", "cordial"),
                     ("--except", "cordial"),
                     ("fix", "--except", "cordial")):
            code, _out, err = self.run_main(*args)
            self.assertEqual(code, 2, args)
            self.assertEqual(len(err.splitlines()), 1, args)
        code, _out, err = self.run_main("fix", "--near", "--except", "wary",
                                        "--write")
        self.assertEqual((code, err),
                         (1, "tones.py: no NEAR row has the tone wary\n"))
        self.assertEqual(self.get("NPCs/A.md"), before)
        code, out, _err = self.run_main(
            "fix", "--near", "--except", "dread", "--except", "grim",
            "--write")
        self.assertEqual(code, 0)
        self.assertEqual(out, "CHANGED\tNPCs/A.md:9\tcordial -> friendly\n"
                              "# 1 tone(s) in 1 note(s)\n")
        self.assertEqual(self.get("NPCs/A.md"),
                         before.replace("cordial", "friendly"))

    def test_a_note_that_vanishes_after_the_survey_is_one_line(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        self.put("NPCs/B.md", note("    tone: dread"))
        before = self.get("NPCs/A.md")
        real = tones.survey

        def survey_then_lose(vault):
            uses = real(vault)
            (self.vault / "NPCs" / "B.md").unlink()
            return uses

        with mock.patch.object(tones, "survey", survey_then_lose):
            code, out, err = self.run_main("fix", "--near", "--write")
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertEqual(err, "tones.py: NPCs/B.md cannot be read "
                              "(FileNotFoundError); run it again\n")
        self.assertEqual(self.get("NPCs/A.md"), before)

    def test_an_empty_frontmatter_note_is_never_rewritten(self):
        text = ("---\n---\nSome text.\n\n```yaml\nrelationships:\n"
                '  - target: "[[X]]"\n    tone: wary\n```\n\n---\n\nMore.\n')
        self.put("Chapters/A.md", text)
        self.assertEqual(tones.report_lines(tones.survey(self.vault)),
                         ["# tones: 0  listed: 0  near: 0  ask: 0"])
        self.put("NPCs/B.md", note("    tone: wary"))
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual(list(p.texts), ["NPCs/B.md"])
        self.assertEqual(self.get("Chapters/A.md"), text)

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


import vault_check as vc  # noqa: E402


class CheckTests(VaultCase):
    def test_stray_tones_are_warnings_beside_the_predicate_errors(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: central",
                                   "    tone: warm"))
        self.assertEqual(vc.check_relationships(self.vault), [
            "WARNING\tNPCs/A.md:6\ttone 'dread' is off the list; "
            "use 'ominous'",
            "WARNING\tNPCs/A.md:9\ttone 'central' is off the list; "
            "pick a listed tone (shared/entity-schema.md, Tones)",
        ])

    def test_error_rows_come_before_a_notes_tone_warnings(self):
        self.put("NPCs/A.md", (
            "---\ntype: npc\nrelationships:\n"
            '  - target: "[[A]]"\n    type: knows\n    tone: dread\n'
            '  - target: "[[B]]"\n    type: frenemy_of\n    tone: warm\n'
            "---\n"))
        rows = vc.check_relationships(self.vault)
        self.assertEqual([r.split("\t")[:2] for r in rows],
                         [["ERROR", "NPCs/A.md:8"], ["WARNING", "NPCs/A.md:6"]])

    def test_file_scope_applies(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        self.put("NPCs/B.md", note("    tone: dread"))
        rows = vc.check_relationships(self.vault, files=["NPCs/B.md"])
        self.assertEqual(len(rows), 1)
        self.assertIn("NPCs/B.md:6", rows[0])


if __name__ == "__main__":
    unittest.main()

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


class ListTests(unittest.TestCase):
    def test_the_list_is_the_27_words_ant_agreed(self):
        self.assertEqual(ONTOLOGY["tones"], LISTED)
        self.assertEqual(len(sr.tone_families()), 27)

    def test_family_lookup(self):
        self.assertEqual(sr.tone_family("professional"), "neutral")
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


def doc_families(text):
    """The words a document lists under each family, from its
    `**Tones.**` sentence (entity-schema.md)."""
    part = text[text.index("**Tones.**"):]
    cells = re.search(r"one of:(.*?)\(positive\);(.*?)\(negative\);"
                      r"(.*?)\(neutral\)", part, re.S).groups()
    return {family: [w.strip() for w in cell.split(",")]
            for family, cell in zip(("positive", "negative", "neutral"),
                                    cells)}


class DocTests(unittest.TestCase):
    def test_the_schema_document_lists_exactly_the_words_by_family(self):
        text = (REPO / "skills/shared/entity-schema.md").read_text(encoding="utf-8")
        self.assertEqual(doc_families(text), LISTED)

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
    edges = "".join(f'  - target: "[[T{i}]]"\n    type: leads\n{line}\n'
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
    def test_a_note_whose_frontmatter_does_not_read_is_named(self):
        self.put("NPCs/A.md", note("    tone: Cordial"))
        self.put("NPCs/B.md", "---\ntype: npc\nrelationships: [unclosed\n"
                 "    tone: grumpy\n---\n")
        code, out, _err = self.run_main()
        self.assertEqual(code, 0)
        self.assertNotIn("grumpy", out)
        self.assertTrue(out.rstrip("\n").endswith(
            "# 1 note not read (the frontmatter does not read; "
            "campaign-qa's Graph Health names the fault): NPCs/B.md"), out)

    def test_a_tool_that_cannot_answer_is_a_step_failure_for_the_update(self):
        import migrate_core
        self.assertTrue(issubclass(tones.TonesError, migrate_core.StepFailed))

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
        self.assertEqual(self.get("NPCs/A.md"),
                         before.replace("tone: dread", "tone: ominous"))
        self.assertEqual(p.notes, ["NPCs/A.md"])

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
        self.put("NPCs/A.md", note("    tone: dread", "    tone: central",
                                   "    tone: warm"))
        before = self.get("NPCs/A.md")

        def refused(why, **plan):
            with self.assertRaises(tones.TonesError) as raised:
                tones.plan_fix(self.vault, **plan)
            self.assertIn(why, str(raised.exception))
            return str(raised.exception)

        with self.subTest("a set that is no listed tone, or already one, or unused"):
            refused("not a listed tone", near=False, sets={"central": "ominouss"})
            refused("already a listed tone", near=False, sets={"warm": "friendly"})
            refused("no relationship has", near=False, sets={"sibling": "neutral"})

        with self.subTest("two set keys for one word"):
            refused("dread is set to both", near=False,
                    sets={"Dread": "ominous", "dread": "tense"})
            p = tones.plan_fix(self.vault, near=False,
                               sets={"Dread": "ominous", "dread": "ominous"})
            self.assertEqual(len(p.changes), 1)

        with self.subTest("the same word set twice, as main gives the pairs"):
            # A list of pairs: nothing collapses first.
            self.assertEqual(
                refused("dread is set to both", near=False,
                        sets=[("dread", "ominous"), ("dread", "tense")]),
                "dread is set to both ominous and tense")
            p = tones.plan_fix(self.vault, near=False,
                               sets=[("dread", "ominous"), ("dread", "ominous")])
            self.assertEqual(len(p.changes), 1)

        with self.subTest("the same word set twice on the command line"):
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

        with self.subTest("an except no near row has"):
            for word in ("cordial", "central", "warm"):
                self.assertEqual(
                    refused("no NEAR row has the tone", near=True, sets={},
                            excepts=[word]),
                    f"no NEAR row has the tone {word}")

        with self.subTest("an empty except is a usage error"):
            for empty in ("", "  "):
                code, _out, err = self.run_main("fix", "--near", "--except",
                                                empty)
                self.assertEqual((code, err),
                                 (2, "tones.py: --except takes a word\n"))

    def test_other_tone_text_is_never_touched(self):
        text = ("---\ntype: npc\ntone: dread\nrelationships:\n"
                '  - target: "[[A]]"\n    type: knows\n'
                "    description: |\n      tone: dread\n"
                "mobrpg:\n  relationships:\n    - predicate: knows\n"
                "      tone: dread\n---\ntone: dread\n")
        self.put("NPCs/A.md", text)
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(p.notes, [])
        self.assertEqual(tones.rows(p), ["# 0 tone(s) in 0 note(s)"])

    def test_a_line_it_cannot_rewrite_is_kept_and_listed(self):
        # A block scalar is read as a tone but is not a value the fix
        # splices in place, so it is listed and left.
        self.put("NPCs/A.md", note("    tone: >-\n      dread", "    tone: dread"))
        before = self.get("NPCs/A.md")
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual([(c.lineno, c.before, c.after) for c in p.changes],
                         [(10, "dread", "ominous")])
        self.assertEqual(p.kept, [("NPCs/A.md", 6, "dread",
                                   "not a plain tone line")])
        self.assertIn("KEPT\tNPCs/A.md:6\tdread\tnot a plain tone line; "
                      "edit the note", tones.rows(p))
        tones.apply(p)
        self.assertEqual(self.get("NPCs/A.md"), before.replace(
            "    tone: dread\n---", "    tone: ominous\n---"))
        self.assertEqual(tones.rows(p, done=True)[-1],
                         "# 1 tone(s) in 1 note(s), 1 left as written")

    def test_a_word_holding_a_quote_mark_is_rewritten_like_any_other(self):
        self.put("NPCs/A.md", note("    tone: rock'n"))
        p = tones.plan_fix(self.vault, near=False, sets={"rock'n": "neutral"})
        tones.apply(p)
        self.assertEqual(p.kept, [])
        self.assertIn("    tone: neutral\n", self.get("NPCs/A.md"))

    def test_a_note_that_is_not_utf8_stops_the_run(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        bad = note("    tone: dread").encode("utf-8") + b"\xff\xfe"
        (self.vault / "NPCs" / "B.md").write_bytes(bad)
        with self.assertRaises(tones.TonesError) as raised:
            tones.plan_fix(self.vault, near=True, sets={})
        self.assertIn("NPCs/B.md is not UTF-8 text", str(raised.exception))
        self.assertIn("tone: dread", self.get("NPCs/A.md"))
        self.assertEqual((self.vault / "NPCs" / "B.md").read_bytes(), bad)

    def test_a_note_whose_yaml_does_not_read_is_left_alone(self):
        # A bare carriage return inside a plain key makes the frontmatter
        # unreadable to the YAML reader (the build skips the note too, and
        # `relationships check` reports it), so no tone of it is read.
        text = ("---\ntype: npc\nnote: a\rb\nrelationships:\n"
                '  - target: "[[A]]"\n    type: knows\n    tone: dread\n'
                "---\nBody\n")
        self.put("NPCs/A.md", text)
        self.assertEqual(tones.survey(self.vault), [])
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual((p.changes, p.kept), ([], []))
        self.assertEqual(self.get("NPCs/A.md"), text)

    def test_an_all_cr_note_has_no_frontmatter_to_read_and_stays_as_it_is(self):
        text = note("    tone: dread", "    tone: dread").replace("\n", "\r")
        self.put("NPCs/A.md", text)
        self.assertEqual(tones.survey(self.vault), [])
        tones.apply(tones.plan_fix(self.vault, near=True, sets={}))
        self.assertEqual(self.get("NPCs/A.md"), text)

    def test_several_notes_are_rewritten_with_their_own_line_numbers(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: dread",
                                   "    tone: dread"))
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual([c.lineno for c in p.changes], [6, 9, 12])
        self.assertEqual(p.kept, [])

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

    def test_hand_written_shapes_are_read_by_the_tool_not_by_line(self):
        # Flow-style ties, a `>-` tone, a quoted "tone" key, a quoted
        # "null", a byte-order mark: all surveyed. A tone in a map nested
        # inside a tie is not the tie's tone and is never rewritten; a `>-`
        # tone is counted but kept (it cannot be edited in place).
        edge = '  - target: "[[A]]"\n    type: knows\n'
        files = {
            "A": f"---\ntype: npc\nrelationships:\n{edge}    tone: >-\n"
                 "      Cordial\n---\n",
            "B": f'---\ntype: npc\nrelationships:\n{edge}    "tone": '
                 "Cordial\n---\n",
            "C": f"---\ntype: npc\nrelationships:\n{edge}    meta:\n"
                 "      tone: Cordial\n    tone: warm\n---\n",
            "D": f"﻿---\ntype: npc\nrelationships:\n{edge}    tone: "
                 "Cordial\n---\n",
            "E": f'---\ntype: npc\nrelationships:\n{edge}    tone: '
                 '"null"\n---\n',
            "F": "---\ntype: npc\nrelationships: [{target: '[[A]]', "
                 "type: knows, tone: Cordial}]\n---\n",
        }
        for name, text in files.items():
            self.put(f"NPCs/{name}.md", text)
        words = sorted(u.raw for u in tones.survey(self.vault))
        self.assertEqual(words, ["Cordial"] * 4 + ["null", "warm"])
        p = tones.plan_fix(self.vault, near=True, sets={})
        self.assertEqual(sorted((c.rel, c.before) for c in p.changes),
                         [("NPCs/B.md", "Cordial"), ("NPCs/D.md", "Cordial"),
                          ("NPCs/F.md", "Cordial")])
        self.assertEqual([k[0] for k in p.kept], ["NPCs/A.md"])
        tones.apply(p)
        self.assertIn("meta:\n      tone: Cordial\n    tone: warm",
                      self.get("NPCs/C.md"))

    def test_a_bare_cr_note_is_unread_by_the_report_and_left_by_fix(self):
        self.put("NPCs/A.md", note("    tone: Cordial")
                 .replace("tone: Cordial", "tone: Cordial\rx: y"))
        uses, unread = tones.survey_and_unread(self.vault)
        self.assertEqual((uses, unread), ([], ["NPCs/A.md"]))
        self.assertEqual(tones.plan_fix(self.vault, near=True, sets={})
                         .changes, [])

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

    def test_an_empty_frontmatter_note_is_never_rewritten(self):
        text = ("---\n---\nSome text.\n\n```yaml\nrelationships:\n"
                '  - target: "[[X]]"\n    tone: wary\n```\n\n---\n\nMore.\n')
        self.put("Chapters/A.md", text)
        self.assertEqual(tones.report_lines(tones.survey(self.vault)),
                         ["# tones: 0  listed: 0  near: 0  ask: 0"])
        self.put("NPCs/B.md", note("    tone: wary"))
        p = tones.plan_fix(self.vault, near=True, sets={})
        tones.apply(p)
        self.assertEqual(p.notes, ["NPCs/B.md"])
        self.assertEqual(self.get("Chapters/A.md"), text)

    def test_a_note_with_a_byte_order_mark_is_read_and_keeps_it(self):
        # The YAML reader (and the build) read past a byte order mark.
        self.put("NPCs/A.md", "\ufeff" + note("    tone: dread"))
        before = self.get("NPCs/A.md")
        tones.apply(tones.plan_fix(self.vault, near=True, sets={}))
        self.assertEqual(self.get("NPCs/A.md"),
                         before.replace("tone: dread", "tone: ominous"))

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


class UsesTests(VaultCase):
    def fill(self):
        self.put("NPCs/B.md", note("    tone: tragic", "    tone: warm",
                                   "    tone: Central"))
        self.put("NPCs/A.md", note("    tone: dread", '    tone: "tragic"'))
        self.put("Locations/C.md", note("    tone: tragic")
                 .replace("\n", "\r\n"))

    def test_with_no_word_it_lists_every_use_of_the_words_no_rule_places(self):
        self.fill()
        self.assertEqual(tones.use_lines(tones.survey(self.vault), []), [
            "Locations/C.md:6\ttragic\t[[T0]]\t",
            "NPCs/A.md:9\ttragic\t[[T1]]\t",
            "NPCs/B.md:6\ttragic\t[[T0]]\t",
            "NPCs/B.md:12\tcentral\t[[T2]]\t",
            "# 4 use(s) of 2 word(s)"])

    def test_a_quoted_description_shows_unescaped(self):
        # The tool gives the YAML value, so `\"` in a quoted description
        # is a quote mark (#338).
        self.put("NPCs/Q.md", '---\ntype: npc\nrelationships:\n'
                 '  - target: "[[A]]"\n    type: knows\n    tone: tragic\n'
                 '    description: "He said \\"no\\" twice"\n---\n')
        self.assertEqual(tones.use_lines(tones.survey(self.vault), []), [
            'NPCs/Q.md:6\ttragic\t[[A]]\tHe said "no" twice',
            "# 1 use(s) of 1 word(s)"])

    def test_named_words_are_listed_in_the_order_given(self):
        self.fill()
        self.assertEqual(
            tones.use_lines(tones.survey(self.vault),
                            [" CENTRAL ", "dread", "central"]),
            ["NPCs/B.md:12\tcentral\t[[T2]]\t",
             "NPCs/A.md:6\tdread\t[[T0]]\t",
             "# 2 use(s) of 2 word(s)"])

    def test_a_vault_with_nothing_to_ask_about(self):
        self.put("NPCs/A.md", note("    tone: dread", "    tone: warm"))
        self.assertEqual(tones.use_lines(tones.survey(self.vault), []),
                         ["# 0 use(s) of 0 word(s)"])

    EDGES = (
        "---\ntype: npc\nrelationships:\n"
        '  - target: "[[Ana Ruiz|Ana]]"\n'
        "    type: knows\n"
        '    description: "Owes her a debt: a large one"  # s3\n'
        "    tone: tragic\n"
        "  - tone: tragic\n"
        "    target: '[[Bo]]'\n"
        "    description: |\n"
        "      First line,\twith a tab.\n"
        "\n"
        "      tone: second line\n"
        "    strength: 4\n"
        "  - target: \"[[Cy]]\"\n"
        "    tone: tragic\n"
        "    type: knows\n"
        "  - target: Dee\n"
        "    tone: tragic\n"
        "    description: plain text that runs\n"
        "      on to a second line\n"
        "    strength: 2\n"
        "  - target: \"[[Eve]]\"\n"
        "    tone: tragic\n"
        "    description: >-\n"
        "      " + "word " * 80 + "\n"
        "  - target: \"[[Fay]]\"\n"
        "    tone: warm\n"
        "    description: \"not a stray\"\n"
        "mobrpg:\n  relationships:\n    - predicate: knows\n"
        "      tone: tragic\n      description: \"machine\"\n"
        "---\nBody\n")

    def test_each_row_carries_the_edges_target_and_description(self):
        long = ("word " * 80).strip()
        want = [
            "NPCs/A.md:7\ttragic\t[[Ana Ruiz|Ana]]\t"
            "Owes her a debt: a large one",
            "NPCs/A.md:8\ttragic\t[[Bo]]\t"
            "First line, with a tab. tone: second line",
            "NPCs/A.md:16\ttragic\t[[Cy]]\t",
            "NPCs/A.md:19\ttragic\tDee\t"
            "plain text that runs on to a second line",
            "NPCs/A.md:24\ttragic\t[[Eve]]\t" + long[:300].rstrip() + "\u2026",
            "# 5 use(s) of 1 word(s)"]
        for eol in ("\n", "\r\n"):
            with self.subTest(eol=eol):
                self.put("NPCs/A.md", self.EDGES.replace("\n", eol))
                self.assertEqual(
                    tones.use_lines(tones.survey(self.vault), []), want)

    QUOTED = (
        "---\ntype: npc\nrelationships:\n"
        '  - target: "[[Ana]]"\n'
        '    description: "He spoke in a \\"flat\\"\n'
        "      tone: dread, mostly\n"
        "\n"
        '      tone: cordial at the end"  # s3\n'
        "    tone: dread\n"
        "  - target: '[[Bo]]'\n"
        "    tone: tragic\n"
        "    description: 'It''s\n"
        "      tone: dread'\n"
        "  - target: \"[[Cy]]\"\n"
        "    description: the captain's man\n"
        "    tone: Cordial\n"
        "  - tone: cordial\n"
        '    target: "[[Ed]]"\n'
        "---\nBody\n")

    def test_a_multi_line_quoted_description_is_not_a_tone(self):
        for eol in ("\n", "\r\n"):
            with self.subTest(eol=eol):
                text = self.QUOTED.replace("\n", eol)
                self.put("NPCs/A.md", text)
                self.assertEqual(
                    tones.use_lines(tones.survey(self.vault), []),
                    ["NPCs/A.md:11\ttragic\t[[Bo]]\tIt's tone: dread",
                     "# 1 use(s) of 1 word(s)"])
                self.assertEqual(
                    tones.use_lines(tones.survey(self.vault), ["dread"]),
                    ["NPCs/A.md:9\tdread\t[[Ana]]\t"
                     'He spoke in a "flat" tone: dread, mostly '
                     "tone: cordial at the end",
                     "# 1 use(s) of 1 word(s)"])

    def test_a_note_whose_quote_never_closes_is_skipped_whole(self):
        # Real YAML refuses the note, so the build skips it and
        # `relationships check` reports it; its tones are not read.
        self.put("NPCs/A.md", note('    description: "never closed',
                                   "    tone: dread"))
        self.assertEqual(tones.survey(self.vault), [])

    def test_a_fix_leaves_a_quoted_descriptions_text_alone(self):
        for eol in ("\n", "\r\n"):
            with self.subTest(eol=eol):
                self.put("NPCs/A.md", self.QUOTED.replace("\n", eol))
                code, out, err = self.run_main("fix", "--near", "--write")
                self.assertEqual((code, err), (0, ""))
                self.assertEqual(out.splitlines(), [
                    "CHANGED\tNPCs/A.md:9\tdread -> ominous",
                    "CHANGED\tNPCs/A.md:16\tCordial -> friendly",
                    "CHANGED\tNPCs/A.md:17\tcordial -> friendly",
                    "# 3 tone(s) in 1 note(s)"])
                want = (self.QUOTED
                        .replace("# s3\n    tone: dread\n",
                                 "# s3\n    tone: ominous\n")
                        .replace("    tone: Cordial\n", "    tone: friendly\n")
                        .replace("  - tone: cordial\n",
                                 "  - tone: friendly\n"))
                self.assertEqual(self.get("NPCs/A.md"),
                                 want.replace("\n", eol))

    def test_a_word_names_every_stray_that_compares_equal_to_it(self):
        self.put("NPCs/A.md", note("    tone: Friendly", "    tone: friendly",
                                   "    tone: ' FRIENDLY'"))
        for word in ("friendly", "Friendly"):
            self.assertEqual(
                tones.use_lines(tones.survey(self.vault), [word]),
                ["NPCs/A.md:6\tfriendly\t[[T0]]\t",
                 "NPCs/A.md:12\tfriendly\t[[T2]]\t",
                 "# 2 use(s) of 1 word(s)"])

    def test_a_word_that_is_not_a_stray_is_refused(self):
        self.fill()
        for word, why in (("warm", "warm is a listed tone"),
                          ("bleak", "no relationship has the tone bleak")):
            with self.assertRaises(tones.TonesError) as caught:
                tones.use_lines(tones.survey(self.vault), ["tragic", word])
            self.assertEqual(str(caught.exception), why)

    def test_command_line(self):
        self.fill()
        before = {rel: self.get(rel) for rel in
                  ("NPCs/A.md", "NPCs/B.md", "Locations/C.md")}
        self.assertEqual(self.run_main("uses", "central"),
                         (0, "NPCs/B.md:12\tcentral\t[[T2]]\t\n"
                             "# 1 use(s) of 1 word(s)\n", ""))
        code, out, err = self.run_main("uses")
        self.assertEqual((code, len(out.splitlines()), err), (0, 5, ""))
        self.assertEqual(self.run_main("uses", "warm"),
                         (1, "", "tones.py: warm is a listed tone\n"))
        self.assertEqual(
            self.run_main("uses", "central", "--write"),
            (2, "", "tones.py: --near, --except, --set and --write go "
                    "with fix\n"))
        self.assertEqual(
            self.run_main("fix", "central", "--near"),
            (2, "", "tones.py: only uses takes words; fix takes --set "
                    "OLD=NEW\n"))
        self.assertEqual({rel: self.get(rel) for rel in before}, before)


class ShownTests(VaultCase):
    def run_shown(self, files, published, eol=""):
        for rel, text in files.items():
            self.put(rel, text, newline=eol)
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(tones, "published_notes",
                               return_value=published), \
                contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(err):
            code = tones.main([str(self.vault), "shown"])
        return code, out.getvalue().splitlines(), err.getvalue()

    NOTE = ("---\ntype: npc\nrelationships:\n"
            "  - target: \"[[Hallam]]\"\n    type: rival_of\n"
            "    tone: hostile\n    description: Wants his chair.\n"
            "  - target: \"[[Mara]]\"\n    type: knows\n    tone: warm\n"
            "  - target: \"[[Cult]]\"\n    type: serves\n"
            "    tone: fearful\n    gm_only: true\n"
            "  - target: \"[[Tom]]\"\n    type: knows\n    tone: Cold\n"
            "---\nBody.\n")

    def test_lists_negative_tones_that_are_not_gm_only(self):
        code, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE},
                                       {"NPCs/Emma.md"})
        self.assertEqual(code, 0)
        self.assertEqual(rows[0].split("\t"), [
            "NPCs/Emma.md:6", "hostile", "[[Hallam]]", "Wants his chair."])
        # `Cold` is a stray, but the site reads it as cold: hostile.
        self.assertEqual(rows[1].split("\t")[:3],
                         ["NPCs/Emma.md:17", "Cold", "[[Tom]]"])
        self.assertEqual(rows[-1], "# 2 hostile ties shown on 1 note")
        self.assertFalse(any("Cult" in r or "Mara" in r for r in rows))

    def test_a_tie_marked_gm_only_in_any_spelling_of_yes_is_not_shown(self):
        for written in ("yes", "on", "1", "Yes", '"true"', '" True "'):
            with self.subTest(written=written):
                note = ("---\ntype: npc\nrelationships:\n"
                        '  - target: "[[A]]"\n    type: rival_of\n'
                        f"    tone: hostile\n    gm_only: {written}\n---\nB\n")
                _, rows, _ = self.run_shown({"NPCs/E.md": note}, {"NPCs/E.md"})
                self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_tones_are_read_the_way_the_site_reads_them(self):
        # The rule toneFamily (tools/publish/lib/ontology.js) applies: trim,
        # lower-case, look up. A change to either side must change both.
        for written in ("HOSTILE", '" hostile"', '"hostile "', "Cold"):
            with self.subTest(written=written):
                note = ("---\ntype: npc\nrelationships:\n"
                        '  - target: "[[A]]"\n    type: knows\n'
                        f"    tone: {written}\n---\nB\n")
                _, rows, _ = self.run_shown({"NPCs/E.md": note}, {"NPCs/E.md"})
                self.assertEqual(rows[-1], "# 1 hostile tie shown on 1 note")
                self.assertEqual(rows[0].split("\t")[1],
                                 written.strip('"'))

    def test_a_note_that_hides_its_relationships_lists_nothing(self):
        for hide in ("publish_exclude_fields: [relationships]\n",
                     "publish_exclude_fields:\n  - relationships\n"):
            with self.subTest(hide=hide):
                note = self.NOTE.replace("type: npc\n", "type: npc\n" + hide)
                _, rows, _ = self.run_shown({"NPCs/Emma.md": note},
                                            {"NPCs/Emma.md"})
                self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_a_tone_is_trimmed_the_way_the_site_trims_it(self):
        # JS trim() does not trim \x1c-\x1f or NEL; Python's split() does.
        # The tool's own toneFamily decides, so neither is read as hostile.
        for written in (r'"hostile\x1c"', r'"hostile\N"', r'"\x1fhostile"'):
            with self.subTest(written=written):
                note = ("---\ntype: npc\nrelationships:\n"
                        '  - target: "[[A]]"\n    type: knows\n'
                        f"    tone: {written}\n---\nB\n")
                _, rows, _ = self.run_shown({"NPCs/E.md": note}, {"NPCs/E.md"})
                self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_gm_only_is_the_sites_reading_whatever_the_spelling(self):
        # `0x1` is a number to YAML; the site's rule drops the edge, and so
        # does `shown` (it asks the tool, which uses the site's function).
        note = ("---\ntype: npc\nrelationships:\n"
                '  - target: "[[A]]"\n    type: knows\n    tone: hostile\n'
                "    gm_only: 0x1\n---\nB\n")
        _, rows, _ = self.run_shown({"NPCs/E.md": note}, {"NPCs/E.md"})
        self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_the_hide_list_is_read_as_yaml_not_by_line(self):
        # A comment after an item, a flow list over two lines and a quoted
        # item are all lists to the site's YAML reader (#337).
        for hide in ("publish_exclude_fields:\n  - relationships  # secret\n",
                     "publish_exclude_fields: [secrets,\n  relationships]\n",
                     "publish_exclude_fields:\n  - 'relationships' # x\n"):
            with self.subTest(hide=hide):
                note = self.NOTE.replace("type: npc\n", "type: npc\n" + hide)
                _, rows, _ = self.run_shown({"NPCs/Emma.md": note},
                                            {"NPCs/Emma.md"})
                self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_flow_style_relationships_are_counted_as_the_site_reads_them(self):
        flow = ("---\ntype: npc\nrelationships: [{target: '[[A]]', "
                "type: knows, tone: hostile}, {target: '[[B]]', type: knows,"
                " tone: warm}]\n---\nB\n")
        item = ("---\ntype: npc\nrelationships:\n"
                "  - {target: '[[A]]', type: knows, tone: Cold}\n"
                "  - {target: '[[B]]', type: knows, tone: hostile, "
                "gm_only: true}\n---\nB\n")
        _, rows, _ = self.run_shown({"NPCs/F.md": flow, "NPCs/G.md": item},
                                    {"NPCs/F.md", "NPCs/G.md"})
        self.assertEqual(rows[-1], "# 2 hostile ties shown on 2 notes")
        self.assertEqual(
            [r.split("\t")[:3] for r in rows[:-1]],
            [["NPCs/F.md:3", "hostile", "[[A]]"],
             ["NPCs/G.md:4", "Cold", "[[A]]"]])

    def test_only_a_real_list_hides_a_notes_relationships(self):
        # The site reads publish_exclude_fields only as a list, and matches
        # an item exactly (processor.js publishedFrontmatter).
        for hide in ("publish_exclude_fields: relationships\n",
                     'publish_exclude_fields: "relationships"\n',
                     "publish_exclude_fields: relationships, secrets\n",
                     "publish_exclude_fields: [Relationships]\n",
                     'publish_exclude_fields: ["relationships "]\n',
                     "publish_exclude_fields:\n  - Relationships\n"):
            with self.subTest(hide=hide):
                note = self.NOTE.replace("type: npc\n", "type: npc\n" + hide)
                _, rows, _ = self.run_shown({"NPCs/Emma.md": note},
                                            {"NPCs/Emma.md"})
                self.assertEqual(rows[-1], "# 2 hostile ties shown on 1 note")

    CAMPAIGN = ("---\npublish:\n  exclude_fields:\n    - secrets\n"
                "    - relationships\n%s---\n")

    def test_a_campaign_that_excludes_relationships_lists_nothing(self):
        _, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE,
                                     "_meta/vault-config.md":
                                     self.CAMPAIGN % ""}, {"NPCs/Emma.md"})
        self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_campaign_exclude_only_counts_as_a_list_spelled_exactly(self):
        for cfg in ("---\npublish:\n  exclude_fields: relationships\n---\n",
                    "---\npublish:\n  exclude_fields: [Relationships]\n---\n"):
            with self.subTest(cfg=cfg):
                _, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE,
                                             "_meta/vault-config.md": cfg},
                                            {"NPCs/Emma.md"})
                self.assertEqual(rows[-1], "# 2 hostile ties shown on 1 note")

    def test_an_override_naming_relationships_lifts_the_campaign_skip(self):
        cfg = self.CAMPAIGN % ("  overrides:\n    fields:\n"
                               '      "NPCs/Emma.md":\n'
                               "        include: [relationships]\n")
        _, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE,
                                     "_meta/vault-config.md": cfg},
                                    {"NPCs/Emma.md"})
        self.assertEqual(rows[-1], "# 2 hostile ties shown on 1 note")

    def test_an_override_for_another_field_keeps_the_campaign_skip(self):
        cfg = self.CAMPAIGN % ("  overrides:\n    fields:\n"
                               '      "NPCs/Emma.md":\n'
                               "        include: [secrets]\n")
        _, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE,
                                     "_meta/vault-config.md": cfg},
                                    {"NPCs/Emma.md"})
        self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes"])

    def test_a_note_the_site_does_not_publish_is_left_out(self):
        code, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE}, set())
        self.assertEqual((code, rows),
                         (0, ["# 0 hostile ties shown on 0 notes"]))

    def test_refuses_when_the_site_cannot_be_asked(self):
        code, rows, err = self.run_shown({"NPCs/Emma.md": self.NOTE}, None)
        self.assertEqual((code, rows), (1, []))
        self.assertIn("publish", err)

    def test_crlf_notes_give_the_same_line_numbers(self):
        code, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE},
                                       {"NPCs/Emma.md"}, eol="\r\n")
        self.assertEqual((code, rows[0].split("\t")[:3]), (
            0, ["NPCs/Emma.md:6", "hostile", "[[Hallam]]"]))

    def test_an_accented_note_name_matches_the_nfc_published_path(self):
        import unicodedata
        nfd = unicodedata.normalize("NFD", "NPCs/Zo\u00eb.md")
        nfc = unicodedata.normalize("NFC", nfd)
        code, rows, _ = self.run_shown({nfd: self.NOTE}, {nfc})
        self.assertEqual(code, 0)
        self.assertEqual(rows[-1], "# 2 hostile ties shown on 1 note")

    def test_a_note_that_is_not_utf8_does_not_crash(self):
        (self.vault / "NPCs").mkdir()
        (self.vault / "NPCs/Bad.md").write_bytes(
            self.NOTE.encode("utf-8") + b"\xff\xfe")
        code, rows, _ = self.run_shown({"NPCs/Emma.md": self.NOTE},
                                       {"NPCs/Emma.md", "NPCs/Bad.md"})
        self.assertEqual(code, 0)
        self.assertEqual(rows[-1], "# 4 hostile ties shown on 2 notes")

    def test_a_map_form_relationships_block_has_no_tones_so_lists_nothing(self):
        code, rows, _ = self.run_shown(
            {"NPCs/Map.md": "---\ntype: npc\nrelationships:\n"
             "  Hallam: hostile\n  tone: hostile\n---\nBody\n"},
            {"NPCs/Map.md"})
        self.assertEqual((code, rows), (0, ["# 0 hostile ties shown on 0 notes"]))


class AcceptTests(VaultCase):
    """A hostile tie the GM reviewed and left (#367): `shown --accept` records
    it in the publish list, `shown` stops listing it, and it counts again if
    the tie changes."""

    NOTE = ShownTests.NOTE
    HALLAM = "NPCs/Emma.md:6"
    TOM = "NPCs/Emma.md:17"

    def tones(self, *args, published=("NPCs/Emma.md",)):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(tones, "published_notes",
                               return_value=set(published)), \
                contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(err):
            code = tones.main([str(self.vault), *args])
        return code, out.getvalue().splitlines(), err.getvalue()

    def setUp(self):
        super().setUp()
        self.put("NPCs/Emma.md", self.NOTE)

    def publish_list(self):
        return (self.vault / "_meta" / "publish-list.yaml")

    def test_a_preview_names_the_ties_and_writes_nothing(self):
        code, rows, _ = self.tones("shown", "--accept")
        self.assertEqual(code, 0)
        self.assertEqual([r.split("\t")[:2] for r in rows[:-1]],
                         [["WOULD-ACCEPT", self.HALLAM],
                          ["WOULD-ACCEPT", self.TOM]])
        self.assertEqual(rows[-1], "# 2 hostile tie(s) would be accepted")
        self.assertFalse(self.publish_list().exists())

    def test_accepting_all_empties_the_list_and_counts_what_was_accepted(self):
        code, rows, _ = self.tones("shown", "--accept", "--write")
        self.assertEqual(code, 0)
        self.assertEqual(rows[0].split("\t")[0], "ACCEPTED")
        self.assertEqual(rows[-1], "# 2 hostile tie(s) accepted")
        code, rows, _ = self.tones("shown")
        self.assertEqual((code, rows),
                         (0, ["# 0 hostile ties shown on 0 notes "
                              "(2 accepted)"]))

    def test_one_tie_can_be_accepted_by_its_place(self):
        code, rows, _ = self.tones("shown", "--accept", self.HALLAM,
                                   "--write")
        self.assertEqual((code, rows[-1]),
                         (0, "# 1 hostile tie(s) accepted"))
        _, rows, _ = self.tones("shown")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].split("\t")[:2], [self.TOM, "Cold"])
        self.assertEqual(rows[-1],
                         "# 1 hostile tie shown on 1 note (1 accepted)")

    def test_an_edited_tie_is_raised_again(self):
        self.tones("shown", "--accept", "--write")
        self.put("NPCs/Emma.md", self.NOTE.replace(
            "Wants his chair.", "Wants his chair and his name."))
        _, rows, _ = self.tones("shown")
        self.assertEqual(rows[0].split("\t")[:2], [self.HALLAM, "hostile"])
        self.assertEqual(rows[-1],
                         "# 1 hostile tie shown on 1 note (1 accepted)")

    def test_a_tie_that_moved_down_the_note_stays_accepted(self):
        self.tones("shown", "--accept", "--write")
        self.put("NPCs/Emma.md", self.NOTE.replace(
            "type: npc\n", "type: npc\naliases: [Em]\n"))
        _, rows, _ = self.tones("shown")
        self.assertEqual(rows, ["# 0 hostile ties shown on 0 notes "
                                "(2 accepted)"])

    def test_a_place_that_is_not_a_shown_hostile_tie_is_refused(self):
        for place in ("NPCs/Emma.md:10", "NPCs/Emma.md:13", "NPCs/Emma.md:99",
                      "NPCs/Nobody.md:6", "nonsense"):
            with self.subTest(place=place):
                code, rows, err = self.tones("shown", "--accept", place,
                                             "--write")
                self.assertEqual((code, rows), (1, []))
                self.assertIn(place, err)
        self.assertFalse(self.publish_list().exists())

    def test_nothing_to_accept_is_a_clean_zero(self):
        code, rows, _ = self.tones("shown", "--accept", published=())
        self.assertEqual((code, rows),
                         (0, ["# 0 hostile tie(s) would be accepted"]))

    def test_the_flags_go_with_shown(self):
        for args in (["--accept"], ["uses", "--accept"],
                     ["shown", "--write"]):
            with self.subTest(args=args):
                code, _, err = self.tones(*args)
                self.assertEqual(code, 2, err)
        code, _, err = self.tones("fix", "--near", "--accept")
        self.assertEqual(code, 2, err)

    def test_a_published_list_and_its_other_records_are_kept(self):
        self.put("_meta/publish-list.yaml",
                 "publishing:\n  - NPCs/Emma.md\nexcluded: []\n"
                 "needs_decision: []\naccepted:\n  - page: x.html\n"
                 "    text: a sentence\n    note: Secret\n")
        self.tones("shown", "--accept", "--write")
        text = self.get("_meta/publish-list.yaml")
        self.assertIn("a sentence", text)
        self.assertIn("NPCs/Emma.md", text)
        self.assertEqual(text.count("note: tone.tie"), 2)


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

    def test_rows_come_in_note_then_line_order(self):
        self.put("NPCs/A.md", (
            "---\ntype: npc\nrelationships:\n"
            '  - target: "[[A]]"\n    type: leads\n    tone: dread\n'
            '  - target: "[[B]]"\n    type: frenemy_of\n    tone: warm\n'
            "---\n"))
        rows = vc.check_relationships(self.vault)
        self.assertEqual([r.split("\t")[:2] for r in rows],
                         [["WARNING", "NPCs/A.md:6"], ["ERROR", "NPCs/A.md:8"]])

    def test_file_scope_applies(self):
        self.put("NPCs/A.md", note("    tone: dread"))
        self.put("NPCs/B.md", note("    tone: dread"))
        rows = vc.check_relationships(self.vault, files=["NPCs/B.md"])
        self.assertEqual(len(rows), 1)
        self.assertIn("NPCs/B.md:6", rows[0])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes."""

import io
import shutil
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_write as vw  # noqa: E402


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vwrite-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(vault, *argv, stdin=""):
    """(exit code, stdout) of one vault_write call."""
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


NPC = """---
type: npc
---

# Hallam

## Campaign Log

- **[[Session 01 - Start]]** — met the party.

<!-- gm-only -->

## GM Notes

### Wants

Out.

### Behind the Scenes

- **[[Session 01 - Start]]** — lied.

<!-- /gm-only -->
"""


class PrimitiveTests(unittest.TestCase):
    def test_heads_know_which_side_of_the_fence_they_are_on(self):
        doc = vw.parse(NPC)
        sides = {h.title: h.gm for h in doc.heads}
        self.assertFalse(sides["Campaign Log"])
        self.assertTrue(sides["GM Notes"])
        self.assertTrue(sides["Behind the Scenes"])

    def test_a_public_section_ends_at_the_fence_opener(self):
        doc = vw.parse(NPC)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log)].strip(),
                         "<!-- gm-only -->")

    def test_a_keeper_section_ends_at_the_next_heading_or_the_closer(self):
        doc = vw.parse(NPC)
        wants = next(h for h in doc.heads if h.title == "Wants")
        behind = next(h for h in doc.heads if h.title == "Behind the Scenes")
        self.assertEqual(vw.section_end(doc, wants), behind.idx)
        self.assertEqual(doc.lines[vw.section_end(doc, behind)].strip(),
                         "<!-- /gm-only -->")

    def test_an_aside_inside_a_section_does_not_end_it(self):
        text = ("# T\n\n## Log\n\n- a\n\n<!-- gm-only -->\nsecret\n"
                "<!-- /gm-only -->\n\n- b\n\n## Next\n")
        doc = vw.parse(text)
        log = next(h for h in doc.heads if h.title == "Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log)], "## Next\n")

    def test_place_puts_a_block_after_the_last_content_line(self):
        doc = vw.parse(NPC)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        out = vw.place(doc, vw.section_end(doc, log), ["- new"], tight=True)
        self.assertIn("- **[[Session 01 - Start]]** — met the party.\n"
                      "- new\n\n<!-- gm-only -->", out)

    def test_place_separates_a_paragraph_with_a_blank_line(self):
        doc = vw.parse(NPC)
        wants = next(h for h in doc.heads if h.title == "Wants")
        out = vw.place(doc, vw.section_end(doc, wants), ["More."])
        self.assertIn("Out.\n\nMore.\n\n### Behind the Scenes", out)

    def test_place_keeps_crlf(self):
        crlf = NPC.replace("\n", "\r\n")
        doc = vw.parse(crlf)
        log = next(h for h in doc.heads if h.title == "Campaign Log")
        out = vw.place(doc, vw.section_end(doc, log), ["- new"], tight=True)
        self.assertNotIn("\n", out.replace("\r\n", ""))
        self.assertEqual(out.replace("- new\r\n", ""), crlf)

    def test_key_ignores_case_and_emphasis(self):
        self.assertEqual(vw.key("**World  State**"), vw.key("world state"))


class BatchTests(unittest.TestCase):
    def test_apply_writes_every_changed_file(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", batch.read("a.md") + "x\n")
        batch.create("c.md", "C\n")
        batch.read("b.md")
        self.assertEqual(sorted(vw.apply(batch)), ["a.md", "c.md"])
        self.assertEqual(read(vault, "a.md"), "A\nx\n")
        self.assertEqual(read(vault, "c.md"), "C\n")

    def test_a_failed_write_restores_everything(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        batch.create("new.md", "N\n")
        batch.put("b.md", "B2\n")
        real = vw.write_text_atomic

        def flaky(path, text):
            if path.name == "b.md" and text == "B2\n":
                raise vw.StepFailed("b.md cannot be written (OSError)")
            real(path, text)

        with mock.patch.object(vw, "write_text_atomic", flaky):
            with self.assertRaises(vw.WriteError):
                vw.apply(batch)
        self.assertEqual(read(vault, "a.md"), "A\n")
        self.assertEqual(read(vault, "b.md"), "B\n")
        self.assertFalse((vault / "new.md").exists())

    def test_a_failed_undo_names_the_files_left_changed(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        batch.put("b.md", "B2\n")
        real = vw.write_text_atomic

        def flaky(path, text):
            if path.name == "b.md" and text == "B2\n":
                raise vw.StepFailed("b.md cannot be written (OSError)")
            if path.name == "a.md" and text == "A\n":
                raise vw.StepFailed("a.md cannot be written (OSError)")
            real(path, text)

        with mock.patch.object(vw, "write_text_atomic", flaky):
            with self.assertRaises(vw.RestoreFailed) as ctx:
                vw.apply(batch)
        self.assertIn("could not restore: a.md", str(ctx.exception))

    def test_an_interrupt_restores_and_reraises(self):
        vault = make_vault(self, {"a.md": "A\n", "b.md": "B\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        batch.put("b.md", "B2\n")
        real = vw.write_text_atomic

        def interrupt(path, text):
            if path.name == "b.md" and text == "B2\n":
                raise KeyboardInterrupt
            real(path, text)

        with mock.patch.object(vw, "write_text_atomic", interrupt):
            with self.assertRaises(KeyboardInterrupt):
                vw.apply(batch)
        self.assertEqual(read(vault, "a.md"), "A\n")
        self.assertEqual(read(vault, "b.md"), "B\n")

    def test_a_created_file_that_appeared_is_refused(self):
        vault = make_vault(self, {"a.md": "A\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        batch.create("new.md", "N\n")
        (vault / "new.md").write_bytes(b"theirs\n")
        with self.assertRaises(vw.WriteError):
            vw.apply(batch)
        self.assertEqual(read(vault, "new.md"), "theirs\n")
        self.assertEqual(read(vault, "a.md"), "A\n")

    def test_a_file_changed_since_the_plan_is_refused(self):
        vault = make_vault(self, {"a.md": "A\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")
        (vault / "a.md").write_bytes(b"other\n")
        with self.assertRaises(vw.WriteError):
            vw.apply(batch)
        self.assertEqual(read(vault, "a.md"), "other\n")

    def test_create_refuses_an_existing_file(self):
        vault = make_vault(self, {"a.md": "A\n"})
        with self.assertRaises(vw.WriteError):
            vw.Batch(vault).create("a.md", "x")

    def test_emit_switches_verbs_when_written(self):
        batch = vw.Batch(Path("."))
        batch.row("WOULD-ADD", "a.md", "§Log", "1 line")
        self.assertIn("WOULD-ADD\ta.md\t§Log\t1 line", vw.emit(batch, False))
        self.assertIn("ADDED\ta.md\t§Log\t1 line", vw.emit(batch, True))
        self.assertIn("# create: 0  add: 1  skip: 0  warnings: 0  errors: 0",
                      vw.emit(batch, True))


INDEX_REL = ("Chapters/Chapter 1 - Arrival/Sessions/Session 02/"
             "Session 02 - The Docks.md")
WRAP_REL = ("Chapters/Chapter 1 - Arrival/Sessions/Session 02/"
            "Chapter_01_Session_02_Wrap_Up.md")
INDEX = """---
type: session
session_number: 2
chapter: "[[Chapter 1 - Arrival]]"
campaign: "The Ashford Case"
play_date: "2026-09-30"
in_game_date: "17 October 1923"
status: played
documents:
  plan: "[[Session 02 - The Docks - Plan]]"
  play_notes: "[[Session 02 - The Docks - Play Notes]]"
  wrap_up: "[[Chapter_01_Session_02_Wrap_Up]]"
---

# Session 02 - The Docks
"""


class WrapupNewTests(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        vault = make_vault(self, {INDEX_REL: INDEX})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL)
        self.assertEqual(code, 0)
        self.assertIn(f"WOULD-CREATE\t{WRAP_REL}", out)
        self.assertFalse((vault / WRAP_REL).exists())

    def test_creates_the_wrap_up_beside_the_index(self):
        vault = make_vault(self, {INDEX_REL: INDEX})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL,
                        "--source", "Play notes, session ended mid-scene.",
                        "--write")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAP_REL)
        for line in ('type: session_wrap',
                     'session: "[[Session 02 - The Docks]]"',
                     'session_number: 2',
                     'chapter: "[[Chapter 1 - Arrival]]"',
                     'campaign: "The Ashford Case"',
                     'play_date: "2026-09-30"',
                     'in_game_date: "17 October 1923"',
                     'source_document: "[[Session 02 - The Docks - Play Notes]]"',
                     'canon_status: DRAFT',
                     'created_by: session-wrapup'):
            self.assertIn(line + "\n", text)
        body = text.split("---\n", 2)[2]
        self.assertEqual(body, (
            "\n# Chapter 01 \u00b7 Session 02 \u2014 The Docks \u2014 Wrap-Up\n\n"
            "> [!info] Source\n"
            "> Play notes, session ended mid-scene.\n\n"
            "<!-- gm-only -->\n\n## GM Notes\n\n<!-- /gm-only -->\n"))

    def test_frontmatter_carries_no_template_comments(self):
        vault = make_vault(self, {INDEX_REL: INDEX})
        run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        fm = read(vault, WRAP_REL).split("---\n")[1]
        self.assertNotIn("#", fm)
        self.assertNotIn("Placeholders:", read(vault, WRAP_REL))

    def test_no_source_means_no_callout(self):
        vault = make_vault(self, {INDEX_REL: INDEX})
        run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertNotIn("[!info]", read(vault, WRAP_REL))

    def test_the_vault_template_is_preferred(self):
        tmpl = ("---\ntype: session_wrap\nsession: \"[[]]\"\n"
                "session_number: null\nhouse_rule: yes\n---\n\n# x\n")
        vault = make_vault(self, {
            INDEX_REL: INDEX,
            "_Templates/_Template_Session_WrapUp.md": tmpl})
        run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertIn("house_rule: yes\n", read(vault, WRAP_REL))

    def test_a_hash_inside_a_quoted_value_survives(self):
        for q, value in (('"', 'Case #5 - the end'), ("'", "Day #3 here")):
            with self.subTest(q):
                src = INDEX.replace(
                    'campaign: "The Ashford Case"',
                    f"campaign: {q}{value}{q}  # note")
                vault = make_vault(self, {INDEX_REL: src})
                run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
                self.assertIn(f"campaign: {q}{value}{q}\n",
                              read(vault, WRAP_REL))

    def test_chapter_comes_from_the_folder_when_the_index_has_none(self):
        src = INDEX.replace('chapter: "[[Chapter 1 - Arrival]]"\n', "")
        vault = make_vault(self, {INDEX_REL: src})
        run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertIn('chapter: "[[Chapter 1 - Arrival]]"\n',
                      read(vault, WRAP_REL))

    def test_a_multi_line_source_stays_in_the_callout(self):
        vault = make_vault(self, {INDEX_REL: INDEX})
        run(vault, "wrapup-new", "--session", INDEX_REL, "--source",
            "one\n\ntwo", "--write")
        self.assertIn("> [!info] Source\n> one\n>\n> two\n\n",
                      read(vault, WRAP_REL))

    def test_refusals(self):
        cases = {
            "exists": {INDEX_REL: INDEX, WRAP_REL: "x\n"},
            "not an index": {INDEX_REL: INDEX.replace("type: session\n",
                                                      "type: npc\n")},
            "no session number": {INDEX_REL: INDEX.replace(
                "session_number: 2\n", "")},
            "no chapter": {"Loose/Session 02 - The Docks.md": INDEX.replace(
                'chapter: "[[Chapter 1 - Arrival]]"\n', "")},
        }
        for name, files in cases.items():
            with self.subTest(name):
                vault = make_vault(self, files)
                index = next(r for r in files if "Wrap_Up" not in r)
                code, out = run(vault, "wrapup-new", "--session", index,
                                "--write")
                self.assertEqual(code, 1, out)
                self.assertIn("ERROR\t", out)

    def test_missing_index_is_refused(self):
        vault = make_vault(self, {"x.md": "x\n"})
        code, _ = run(vault, "wrapup-new", "--session", "nope.md")
        self.assertEqual(code, 1)

    def test_the_name_passes_the_checkers_pattern(self):
        import vault_check as vc
        self.assertRegex(Path(WRAP_REL).stem, vc.WRAP_FILENAME_RE)


WRAP = """---
type: session_wrap
session: "[[Session 02 - The Docks]]"
session_number: 2
canon_status: DRAFT
---

# Chapter 01 · Session 02 — The Docks — Wrap-Up

<!-- gm-only -->

## GM Notes

<!-- /gm-only -->
"""


def wrap_vault(case, text=WRAP):
    return make_vault(case, {WRAP_REL: text})


def add(vault, stdin, *flags):
    return run(vault, "wrapup-add", WRAP_REL, *flags, "--write", stdin=stdin)


def heading_lines(text):
    return [line for line in text.splitlines()
            if line.startswith("#") or line.startswith("<!--")]


class WrapupAddTests(unittest.TestCase):
    def test_sections_land_in_template_order_whatever_order_they_arrive(self):
        vault = wrap_vault(self)
        for chunk in ("### Handoff to session-prep\n\nOpens at dawn.\n",
                      "### World State\n\n- **Location:** docks\n",
                      "## Memorable Moments\n\n**The chase.**\n",
                      "### Quick Bullets\n\n- one\n",
                      "## Narrative Recap\n\nThey ran.\n"):
            code, out = add(vault, chunk)
            self.assertEqual(code, 0, out)
        self.assertEqual(heading_lines(read(vault, WRAP_REL)), [
            "# Chapter 01 · Session 02 — The Docks — Wrap-Up",
            "## Narrative Recap", "## Memorable Moments",
            "<!-- gm-only -->", "## GM Notes", "### Quick Bullets",
            "### World State", "### Handoff to session-prep",
            "<!-- /gm-only -->"])

    def test_several_sections_in_one_call(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## Narrative Recap\n\nThey ran.\n\n"
                               "### World State\n\n- x\n\n"
                               "### Quick Bullets\n\n- one\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("ADDED\t"), 3)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("### Quick Bullets"),
                        text.index("### World State"))
        self.assertLess(text.index("They ran."), text.index("<!-- gm-only"))

    def test_a_subsection_creates_its_parent(self):
        vault = wrap_vault(self)
        add(vault, "#### Skipped Prep\n\n- **The warehouse** never fired.\n")
        add(vault, "#### Unresolved Threads\n\n- **Ezra** got away.\n")
        text = read(vault, WRAP_REL)
        self.assertEqual(text.count("### What Carries Forward"), 1)
        self.assertLess(text.index("#### Unresolved Threads"),
                        text.index("#### Skipped Prep"))

    def test_a_new_keeper_section_lands_at_the_end_of_gm_notes(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- x\n")
        code, out = add(vault, "### Dream Omens\n\nThe tide spoke.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("### World State"),
                        text.index("### Dream Omens"))
        self.assertLess(text.index("### Dream Omens"),
                        text.index("<!-- /gm-only -->"))

    def test_a_new_player_section_lands_before_the_fence_and_says_so(self):
        vault = wrap_vault(self)
        add(vault, "## Narrative Recap\n\nThey ran.\n")
        code, out = add(vault, "## Letters Home\n\nDear all.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("players will see this", out)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("## Narrative Recap"),
                        text.index("## Letters Home"))
        self.assertLess(text.index("## Letters Home"),
                        text.index("<!-- gm-only -->"))

    def test_after_puts_a_new_section_where_the_gm_wants_it(self):
        vault = wrap_vault(self)
        add(vault, "## Narrative Recap\n\nThey ran.\n\n"
                   "## Memorable Moments\n\n**The chase.**\n\n"
                   "### Quick Bullets\n\n- one\n\n### World State\n\n- x\n")
        code, out = add(vault, "## Letters Home\n\nDear all.\n",
                        "--after", "## Narrative Recap")
        self.assertEqual(code, 0, out)
        code, out = add(vault, "### Dream Omens\n\nThe tide spoke.\n",
                        "--after", "### Quick Bullets")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("## Narrative Recap"),
                        text.index("## Letters Home"))
        self.assertLess(text.index("## Letters Home"),
                        text.index("## Memorable Moments"))
        self.assertLess(text.index("### Quick Bullets"),
                        text.index("### Dream Omens"))
        self.assertLess(text.index("### Dream Omens"),
                        text.index("### World State"))
        code, _ = add(vault, "### Tides\n\nx\n", "--after", "### Nope")
        self.assertEqual(code, 1)

    def test_a_template_keeper_heading_at_h2_is_a_slip(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## World State\n\n- x\n")
        self.assertEqual(code, 1)
        self.assertIn("### World State", out)
        self.assertEqual(read(vault, WRAP_REL), WRAP)

    def test_an_existing_section_needs_replace(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- old\n\n### Quality Notes\n\nFine.\n")
        code, out = add(vault, "### World State\n\n- new\n")
        self.assertEqual(code, 1)
        self.assertIn("--replace", out)
        code, out = add(vault, "### World State\n\n- new\n", "--replace")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAP_REL)
        self.assertNotIn("- old", text)
        self.assertIn("### World State\n\n- new\n\n### Quality Notes", text)

    def test_a_decorated_heading_is_the_same_section(self):
        vault = wrap_vault(self, WRAP.replace(
            "## GM Notes\n", "## GM Notes\n\n### **world state**\n\n- old\n"))
        code, out = add(vault, "### World State\n\n- new\n")
        self.assertEqual(code, 1)
        self.assertIn("--replace", out)

    def test_a_heading_in_a_code_fence_is_not_a_section(self):
        vault = wrap_vault(self)
        code, out = add(vault, "### Quality Notes\n\n```md\n## Narrative "
                               "Recap\n```\n\nDone.\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("ADDED\t"), 1)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("<!-- gm-only -->"),
                        text.index("## Narrative Recap"))

    def test_deeper_headings_travel_with_their_section(self):
        vault = wrap_vault(self)
        add(vault, "### PC Carry-Forward\n\n#### [[Vint]] (Sam)\n\n"
                   "- **Intent:** find Ezra\n")
        text = read(vault, WRAP_REL)
        self.assertIn("### PC Carry-Forward\n\n#### [[Vint]] (Sam)", text)

    def test_one_bad_section_stops_the_whole_call(self):
        vault = wrap_vault(self)
        code, _ = add(vault, "### Quick Bullets\n\n- a\n\n"
                             "## World State\n\n- x\n")
        self.assertEqual(code, 1)
        self.assertEqual(read(vault, WRAP_REL), WRAP)

    def test_refusals(self):
        cases = {
            "empty": (WRAP, ""),
            "no heading first": (WRAP, "Just prose.\n"),
            "not a wrap-up": (WRAP.replace("session_wrap", "npc"),
                              "### World State\n\n- x\n"),
            "no fence": (WRAP.replace("<!-- gm-only -->\n\n", "")
                         .replace("\n<!-- /gm-only -->\n", ""),
                         "### World State\n\n- x\n"),
            "unbalanced": (WRAP.replace("<!-- /gm-only -->\n", ""),
                           "### World State\n\n- x\n"),
        }
        for name, (text, stdin) in cases.items():
            with self.subTest(name):
                vault = wrap_vault(self, text)
                code, out = add(vault, stdin)
                self.assertEqual(code, 1, out)
                self.assertEqual(read(vault, WRAP_REL), text)
        vault = wrap_vault(self, cases["no fence"][0])
        _, out = add(vault, "### World State\n\n- x\n")
        self.assertIn("wrapup --fix", out)

    def test_the_result_passes_the_checker(self):
        import vault_check as vc
        vault = wrap_vault(self)
        add(vault, "## Narrative Recap\n\nThey ran.\n\n"
                   "### World State\n\n- x\n\n"
                   "### Handoff to session-prep\n\nDawn.\n")
        findings = vc.wrapup_structure_findings(
            WRAP_REL, read(vault, WRAP_REL), [])
        self.assertEqual([f.row for f in findings if f.level == "ERROR"], [])


class StripCommentTests(unittest.TestCase):
    def test_an_empty_value_with_a_trailing_comment_is_stripped(self):
        text = "---\ntags: # note\nk: \"a # b\" # c\nj: x # y\n---\n"
        self.assertEqual(vw.template_frontmatter(text),
                         ["tags:", 'k: "a # b"', "j: x"])


if __name__ == "__main__":
    unittest.main()

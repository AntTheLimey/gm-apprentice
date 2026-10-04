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

    def _no_notes_index(self):
        return INDEX.replace(
            '  play_notes: "[[Session 02 - The Docks - Play Notes]]"\n', "")

    def _notes(self, name, link="[[Session 02 - The Docks]]", kind="session-play-notes"):
        return (f"Chapters/Chapter 1 - Arrival/Sessions/Session 02/{name}.md",
                f'---\ntype: {kind}\nsession: "{link}"\n---\n\n# n\n')

    def test_play_notes_found_beside_the_index_when_the_index_lists_none(self):
        rel, text = self._notes("Session 02 - The Docks - Play Notes")
        other_rel, other = self._notes("Other", "[[Session 03 - Else]]")
        vault = make_vault(self, {INDEX_REL: self._no_notes_index(),
                                  rel: text, other_rel: other})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn('source_document: "[[Session 02 - The Docks - Play Notes]]"\n',
                      read(vault, WRAP_REL))
        self.assertNotIn("WARNING", out)

    def test_no_play_notes_found_warns_and_leaves_source_blank(self):
        vault = make_vault(self, {INDEX_REL: self._no_notes_index()})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("no Play Notes found for this session: "
                      "source_document left blank", out)
        self.assertIn('source_document: "[[]]"\n', read(vault, WRAP_REL))

    def test_several_play_notes_found_warns_and_leaves_source_blank(self):
        a = self._notes("A - Play Notes")
        b = self._notes("B - Play Notes")
        vault = make_vault(self, {INDEX_REL: self._no_notes_index(),
                                  a[0]: a[1], b[0]: b[1]})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("several Play Notes notes link this session: "
                      "source_document left blank", out)
        self.assertIn('source_document: "[[]]"\n', read(vault, WRAP_REL))

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
        code, out = add(
            vault, "#### Skipped Prep\n\n- **The warehouse** never fired.\n")
        self.assertLess(out.index("§What Carries Forward\tcreated for "
                                  "Skipped Prep"), out.index("§Skipped Prep"))
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

    def test_a_subheading_inside_a_player_section_is_reported(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## Letters Home\n\nDear all.\n\n"
                               "### Ritual Clock\n\nThree nights.\n")
        self.assertEqual(code, 0, out)
        rows = [r for r in out.splitlines() if r.startswith("ADDED")]
        self.assertEqual(len(rows), 2, out)
        self.assertIn("Ritual Clock", rows[1])
        self.assertIn("\u00a7Letters Home \u203a Ritual Clock", rows[1])
        self.assertIn("inside a player section \u2014 players will see this",
                      rows[1])
        self.assertIn("create: 0  add: 2", out)
        text = read(vault, WRAP_REL)
        self.assertLess(text.index("### Ritual Clock"),
                        text.index("<!-- gm-only -->"))
        # A heading of any depth inside a player section is reported.
        code, out = run(vault, "wrapup-add", WRAP_REL,
                        stdin="## Narrative Recap\n\nx\n\n#### Deep\n\ny\n")
        self.assertIn("\u00a7Narrative Recap \u203a Deep\t"
                      "inside a player section \u2014 players will see this",
                      out)
        self.assertEqual(out.count("WOULD-ADD"), 2, out)

    def test_a_lone_unknown_subheading_goes_to_gm_notes_without_a_row(self):
        vault = wrap_vault(self)
        code, out = add(vault, "### Ritual Clock\n\nThree nights.\n")
        self.assertEqual(code, 0, out)
        self.assertNotIn("players will see this", out)
        text = read(vault, WRAP_REL)
        self.assertGreater(text.index("### Ritual Clock"),
                           text.index("## GM Notes"))

    def test_a_template_known_player_section_reports_its_subheading_too(self):
        vault = wrap_vault(self)
        code, out = run(vault, "wrapup-add", WRAP_REL,
                        stdin="## Narrative Recap\n\nx\n\n### Aside\n\ny\n")
        self.assertIn("\u00a7Narrative Recap \u203a Aside", out)

    def test_no_gm_notes_at_all_one_is_created(self):
        bare = WRAP.split("<!-- gm-only -->")[0].rstrip("\n") + "\n"
        vault = wrap_vault(self, bare)
        code, out = add(vault, "## Narrative Recap\n\nThey ran.\n\n"
                               "### World State\n\n- x\n")
        self.assertEqual(code, 0, out)
        self.assertIn("ADDED\t" + WRAP_REL + "\t\u00a7GM Notes\t"
                      "created (the Wrap-Up had none)", out)
        text = read(vault, WRAP_REL)
        self.assertTrue(text.endswith(
            "<!-- gm-only -->\n\n## GM Notes\n\n### World State\n\n- x\n\n"
            "<!-- /gm-only -->\n"), text)
        self.assertLess(text.index("They ran."), text.index("<!-- gm-only"))

    def test_gm_notes_outside_a_fence_or_a_broken_fence_is_still_refused(self):
        loose = WRAP.replace("<!-- gm-only -->\n\n", "").replace(
            "\n<!-- /gm-only -->\n", "")
        broken = WRAP.replace("<!-- /gm-only -->\n", "")
        for text in (loose, broken):
            vault = wrap_vault(self, text)
            code, out = run(vault, "wrapup-add", WRAP_REL, "--write",
                            stdin="## Narrative Recap\n\nx\n")
            self.assertEqual(code, 1, out)
            self.assertEqual(read(vault, WRAP_REL), text)

    def test_a_known_player_section_goes_before_the_authors_own(self):
        for calls in ((("## Letters Home\n\nDear all.\n",),
                       ("## Narrative Recap\n\nThey ran.\n",)),
                      (("## Letters Home\n\nDear all.\n\n"
                        "## Narrative Recap\n\nThey ran.\n",),)):
            vault = wrap_vault(self)
            for (chunk,) in calls:
                code, out = add(vault, chunk)
                self.assertEqual(code, 0, out)
            text = read(vault, WRAP_REL)
            self.assertLess(text.index("## Narrative Recap"),
                            text.index("## Letters Home"))
            self.assertLess(text.index("## Letters Home"),
                            text.index("<!-- gm-only -->"))

    def test_a_known_section_follows_the_earlier_template_section(self):
        vault = wrap_vault(self)
        add(vault, "## Narrative Recap\n\nThey ran.\n")
        add(vault, "## Letters Home\n\nDear all.\n", "--after",
            "## Narrative Recap")
        code, out = add(vault, "## Memorable Moments\n\n**The chase.**\n")
        self.assertEqual(code, 0, out)
        self.assertEqual([h for h in heading_lines(read(vault, WRAP_REL))
                          if h.startswith("## ")],
                         ["## Narrative Recap", "## Memorable Moments",
                          "## Letters Home", "## GM Notes"])

    def test_help_states_each_commands_stdin(self):
        for cmd, phrase in (("wrapup-add", "player-facing"),
                            ("story", "# [[PC Name]]"),
                            ("log", "PATH<TAB>SECTION<TAB>LINE"),
                            ("timeline", "indented")):
            out = io.StringIO()
            with mock.patch("sys.stdout", out), self.assertRaises(SystemExit) as cm:
                vw.build_parser().parse_args(["v", cmd, "--help"])
            self.assertEqual(cm.exception.code, 0)
            self.assertIn(phrase, out.getvalue(), cmd)

    def test_a_template_keeper_heading_at_h2_is_a_slip(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## World State\n\n- x\n")
        self.assertEqual(code, 1)
        self.assertIn("### World State", out)
        self.assertEqual(read(vault, WRAP_REL), WRAP)

    def test_a_decorated_or_unknown_keeper_name_at_h2_is_a_slip(self):
        vault = wrap_vault(self)
        for title in ("World State:", "Name Conflicts"):
            with self.subTest(title=title):
                code, out = add(vault, f"## {title}\n\n- x\n")
                self.assertEqual(code, 1)
                self.assertIn("GM Notes section", out)
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

    def test_a_duplicate_unknown_h4_needs_replace(self):
        vault = wrap_vault(self)
        _, out = add(vault, "#### Foo\n\nold\n")
        self.assertIn("at the end of GM Notes", out)
        before = read(vault, WRAP_REL)
        code, out = add(vault, "#### Foo\n\nnew\n")
        self.assertEqual(code, 1)
        self.assertIn("--replace", out)
        self.assertIn("--append", out)
        self.assertEqual(read(vault, WRAP_REL), before)
        code, out = add(vault, "#### Foo\n\nnew\n", "--replace")
        self.assertEqual(code, 0, out)
        text = read(vault, WRAP_REL)
        self.assertEqual(text.count("#### Foo"), 1)
        self.assertNotIn("old", text)

    def test_gm_notes_itself_gets_its_own_refusal(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## GM Notes\n\nx\n")
        self.assertEqual(code, 1)
        self.assertIn("container", out)
        self.assertNotIn("### GM Notes", out)

    def test_crlf_stays_crlf(self):
        crlf = WRAP.replace("\n", "\r\n")
        vault = wrap_vault(self, crlf)
        add(vault, "### World State\n\n- old\n")
        added = (vault / WRAP_REL).read_bytes().decode()
        self.assertEqual(added.replace(
            "\r\n### World State\r\n\r\n- old\r\n", "", 1)
            .replace("\r\n\r\n<!-- /gm-only", "\r\n<!-- /gm-only"),
            crlf.replace("\r\n\r\n<!-- /gm-only", "\r\n<!-- /gm-only"))
        add(vault, "### World State\n\n- new\n", "--replace")
        raw = (vault / WRAP_REL).read_bytes().decode()
        self.assertNotIn("\n", raw.replace("\r\n", ""))
        self.assertIn("- new", raw)

    def test_replacing_the_last_section_keeps_the_blank_before_the_marker(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- old\n")
        add(vault, "### World State\n\n- new\n", "--replace")
        self.assertIn("- new\n\n<!-- /gm-only -->", read(vault, WRAP_REL))

    def test_an_h4_lands_in_template_order_among_existing_children(self):
        vault = wrap_vault(self)
        add(vault, "#### Unresolved Threads\n\n- a\n")
        add(vault, "#### Skipped Prep\n\n- c\n")
        add(vault, "#### Pending Consequences\n\n- b\n")
        text = read(vault, WRAP_REL)
        order = [text.index(f"#### {t}") for t in
                 ("Unresolved Threads", "Pending Consequences",
                  "Skipped Prep")]
        self.assertEqual(order, sorted(order))


class StripCommentTests(unittest.TestCase):
    def test_an_empty_value_with_a_trailing_comment_is_stripped(self):
        text = "---\ntags: # note\nk: \"a # b\" # c\nj: x # y\n---\n"
        self.assertEqual(vw.template_frontmatter(text),
                         ["tags:", 'k: "a # b"', "j: x"])


PC_REL = "Characters/PCs/Rock Lavey.md"
STORY_REL = "Characters/PCs/Rock Lavey_Story.md"
PC = "---\ntype: pc\naliases: [Rock]\n---\n\n# Rock Lavey\n"
STORY = """---
type: character-story
character: "[[Rock Lavey]]"
campaign: "Dead End"
canon_status: AUTHORITATIVE
lastUpdated: "2026-09-21"
asOfSession: "Session 1"
createdSession: "Session 1"
---

## Session 1 — The Ragged Edge

He ran.
"""
STORY_WRAP = WRAP.replace(
    "canon_status: DRAFT\n",
    'canon_status: DRAFT\ncampaign: "Dead End"\nplay_date: "2026-09-30"\n')


def story_vault(case, extra=None):
    files = {WRAP_REL: STORY_WRAP, INDEX_REL: INDEX, PC_REL: PC,
             STORY_REL: STORY}
    files.update(extra or {})
    return make_vault(case, {k: v for k, v in files.items() if v is not None})


def tell(vault, stdin, *flags):
    return run(vault, "story", "--wrapup", WRAP_REL, *flags, "--write",
               stdin=stdin)


class StoryTests(unittest.TestCase):
    def test_append_leaves_earlier_bytes_identical(self):
        vault = story_vault(self)
        code, out = tell(vault, "# [[Rock Lavey]]\n\nHe fought.\n\nHe won.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, STORY_REL)
        body_before = STORY.split("---\n", 2)[2]
        self.assertTrue(text.split("---\n", 2)[2].startswith(body_before))
        self.assertTrue(text.endswith(
            "He ran.\n\n## Session 2 — The Docks\n\nHe fought.\n\nHe won.\n"))

    def test_frontmatter_is_stamped(self):
        vault = story_vault(self)
        tell(vault, "# [[Rock Lavey]]\n\nHe fought.\n")
        text = read(vault, STORY_REL)
        self.assertIn('asOfSession: "Session 2"\n', text)
        self.assertIn('lastUpdated: "2026-09-30"\n', text)
        self.assertIn("canon_status: DRAFT\n", text)
        self.assertIn('createdSession: "Session 1"\n', text)

    def test_as_of_and_date_can_be_given(self):
        vault = story_vault(self)
        tell(vault, "# [[Rock Lavey]]\n\nHe fought.\n",
             "--as-of", "Chapter 1, Session 2", "--date", "2026-10-01")
        text = read(vault, STORY_REL)
        self.assertIn('asOfSession: "Chapter 1, Session 2"\n', text)
        self.assertIn('lastUpdated: "2026-10-01"\n', text)

    def test_the_label_follows_the_last_entry(self):
        for last, want in (("## Session 01 — A", "## Session 02 — The Docks"),
                           ("## Chapter 1, Session 1 — A",
                            "## Chapter 1, Session 2 — The Docks")):
            with self.subTest(last):
                vault = story_vault(self, {STORY_REL: STORY.replace(
                    "## Session 1 — The Ragged Edge", last)})
                tell(vault, "# Rock Lavey\n\nHe fought.\n")
                self.assertIn(want + "\n", read(vault, STORY_REL))

    def test_label_flag_wins(self):
        vault = story_vault(self)
        tell(vault, "# Rock\n\nHe fought.\n", "--label", "Interlude")
        self.assertIn("## Interlude — The Docks\n", read(vault, STORY_REL))

    def test_a_missing_story_is_created_from_the_template(self):
        vault = story_vault(self, {STORY_REL: None})
        code, out = tell(vault, "# [[Rock Lavey]]\n\nHe fought.\n")
        self.assertEqual(code, 0, out)
        self.assertIn(f"CREATED\t{STORY_REL}", out)
        text = read(vault, STORY_REL)
        self.assertIn('character: "[[Rock Lavey]]"\n', text)
        self.assertIn('campaign: "Dead End"\n', text)
        self.assertIn('createdSession: "Session 2"\n', text)
        self.assertNotIn("{", text)
        self.assertTrue(text.endswith(
            "---\n\n## Session 2 — The Docks\n\nHe fought.\n"))

    def test_an_entry_can_carry_its_own_heading(self):
        vault = story_vault(self)
        code, out = tell(vault, "# Rock\n\n## Interlude — The Long Night\n\n"
                                "He waited.\n")
        self.assertEqual(code, 0, out)
        self.assertTrue(read(vault, STORY_REL).endswith(
            "He ran.\n\n## Interlude — The Long Night\n\nHe waited.\n"))

    def test_an_entry_may_hold_lists_and_subheadings(self):
        vault = story_vault(self)
        code, out = tell(vault, "# Rock\n\n### The letter\n\n- one\n- two\n")
        self.assertEqual(code, 0, out)
        self.assertIn("### The letter\n\n- one\n- two\n",
                      read(vault, STORY_REL))

    def test_append_to_a_file_with_no_final_newline(self):
        vault = story_vault(self, {STORY_REL: STORY.rstrip("\n")})
        tell(vault, "# Rock\n\nHe fought.\n")
        self.assertIn("He ran.\n\n## Session 2 — The Docks\n",
                      read(vault, STORY_REL))

    def test_a_second_run_is_refused(self):
        vault = story_vault(self)
        tell(vault, "# Rock\n\nHe fought.\n")
        once = read(vault, STORY_REL)
        code, out = tell(vault, "# Rock\n\nHe fought again.\n")
        self.assertEqual(code, 1)
        self.assertIn("already has", out)
        self.assertEqual(read(vault, STORY_REL), once)

    def test_one_wrong_pc_writes_none(self):
        vault = story_vault(self)
        code, _ = tell(vault, "# Rock\n\nHe fought.\n\n# Nobody\n\nGone.\n")
        self.assertEqual(code, 1)
        self.assertEqual(read(vault, STORY_REL), STORY)

    def test_refusals(self):
        for name, stdin in (("empty entry", "# Rock\n\n# Rock\n\nx\n"),
                            ("h2 inside", "# Rock\n\nA.\n\n## Session 9 — x\n\ny\n"),
                            ("no pc line", "He fought.\n"),
                            ("empty", "")):
            with self.subTest(name):
                vault = story_vault(self)
                code, _ = tell(vault, stdin)
                self.assertEqual(code, 1)
                self.assertEqual(read(vault, STORY_REL), STORY)

    def test_several_pcs_in_one_call(self):
        other = "Characters/PCs/Six.md"
        vault = story_vault(self, {other: "---\ntype: pc\n---\n"})
        code, out = tell(vault, "# [[Rock Lavey]]\n\nA.\n\n# [[Six]]\n\nB.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("\nA.\n", read(vault, STORY_REL))
        self.assertIn("\nB.\n", read(vault, "Characters/PCs/Six_Story.md"))

    def test_append_keeps_a_bom_and_the_closing_line_as_written(self):
        bom = "\ufeff" + STORY
        vault = story_vault(self, {STORY_REL: bom})
        code, out = tell(vault, "# Rock\n\nHe fought.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, STORY_REL)
        self.assertTrue(text.startswith("\ufeff---\n"))
        self.assertIn("He ran.\n\n## Session 2 \u2014 The Docks\n", text)

    def test_crlf_story_stays_crlf(self):
        crlf = STORY.replace("\n", "\r\n")
        vault = story_vault(self, {STORY_REL: crlf})
        code, out = tell(vault, "# Rock\n\nHe fought.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, STORY_REL)
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertTrue(text.endswith(
            "He ran.\r\n\r\n## Session 2 \u2014 The Docks\r\n\r\n"
            "He fought.\r\n"))

    def test_a_hash_line_in_an_entry_is_named_as_the_likely_cause(self):
        vault = story_vault(self)
        code, out = tell(vault, "# Rock\n\nHe fought.\n\n# Notes\n\nmore\n")
        self.assertEqual(code, 1)
        self.assertIn("PC 'Notes': not found (a line starting with '# ' "
                      "opens a new PC's entry", out)
        self.assertEqual(read(vault, STORY_REL), STORY)

    def test_a_bare_integer_as_of_stays_bare_and_a_repeat_is_refused(self):
        bare = STORY.replace('asOfSession: "Session 1"', "asOfSession: 1")
        vault = story_vault(self, {STORY_REL: bare})
        code, out = tell(vault, "# Rock\n\nHe fought.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("asOfSession: 2\n", read(vault, STORY_REL))
        once = read(vault, STORY_REL)
        code, _ = tell(vault, "# Rock\n\nHe fought again.\n")
        self.assertEqual(code, 1)
        self.assertEqual(read(vault, STORY_REL), once)

    def test_a_custom_heading_run_twice_is_refused(self):
        vault = story_vault(self)
        entry = "# Rock\n\n## Interlude — The Long Night\n\nHe waited.\n"
        tell(vault, entry)
        once = read(vault, STORY_REL)
        code, out = tell(vault, entry)
        self.assertEqual(code, 1)
        self.assertIn("already has", out)
        self.assertEqual(read(vault, STORY_REL), once)


NPC_REL = "Characters/NPCs/Hallam.md"
S2 = "- **[[Session 02 - The Docks]]** — "


def log(vault, rows, *flags):
    return run(vault, "log", *flags, "--write", stdin=rows)


class LogTests(unittest.TestCase):
    def test_public_and_keeper_lines(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault,
                        f"{NPC_REL}\tCampaign Log\t{S2}sold a map.\n"
                        f"{NPC_REL}\tGM Notes/Behind the Scenes\t{S2}it was fake.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, NPC_REL)
        self.assertIn("met the party.\n" + S2 + "sold a map.\n\n<!-- gm-only",
                      text)
        self.assertIn("lied.\n" + S2 + "it was fake.\n\n<!-- /gm-only", text)

    def test_dry_run_writes_nothing(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = run(vault, "log",
                        stdin=f"{NPC_REL}\tCampaign Log\t{S2}x\n")
        self.assertEqual(code, 0)
        self.assertIn("WOULD-ADD\t", out)
        self.assertEqual(read(vault, NPC_REL), NPC)

    def test_a_repeat_is_a_skip(self):
        vault = make_vault(self, {NPC_REL: NPC})
        row = f"{NPC_REL}\tCampaign Log\t{S2}sold a map.\n"
        log(vault, row)
        once = read(vault, NPC_REL)
        code, out = log(vault, row)
        self.assertEqual(code, 0)
        self.assertIn("SKIP\t", out)
        self.assertEqual(read(vault, NPC_REL), once)

    def test_a_missing_keeper_section_is_created_inside_the_fence(self):
        vault = make_vault(self, {NPC_REL: NPC})
        log(vault, f"{NPC_REL}\tGM Notes/Under Pressure\t- folds fast\n")
        text = read(vault, NPC_REL)
        self.assertLess(text.index("### Wants"),
                        text.index("### Under Pressure"))
        self.assertLess(text.index("### Under Pressure"),
                        text.index("### Behind the Scenes"))
        self.assertIn("### Under Pressure\n\n- folds fast\n", text)

    def test_a_note_with_no_gm_notes_gets_a_fenced_one(self):
        bare = "---\ntype: npc\n---\n\n# Hallam\n\nA clerk.\n"
        vault = make_vault(self, {NPC_REL: bare})
        log(vault, f"{NPC_REL}\tGM Notes/Behind the Scenes\t{S2}lied.\n")
        self.assertEqual(read(vault, NPC_REL), bare + (
            "\n<!-- gm-only -->\n\n## GM Notes\n\n### Behind the Scenes\n\n"
            + S2 + "lied.\n\n<!-- /gm-only -->\n"))

    def test_an_unfenced_gm_notes_is_used_as_it_is(self):
        unfenced = ("---\ntype: faction\n---\n\n# Order\n\n## GM Notes\n\n"
                    "Plans.\n")
        rel = "Factions/Order.md"
        vault = make_vault(self, {rel: unfenced})
        log(vault, f"{rel}\tGM Notes/Behind the Scenes\t{S2}moved.\n")
        text = read(vault, rel)
        self.assertNotIn("gm-only", text)
        self.assertTrue(text.endswith(
            "Plans.\n\n### Behind the Scenes\n\n" + S2 + "moved.\n"))

    def test_a_missing_public_section_goes_in_template_order(self):
        no_log = NPC.replace(
            "## Campaign Log\n\n- **[[Session 01 - Start]]** — met the "
            "party.\n\n", "")
        vault = make_vault(self, {NPC_REL: no_log})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t{S2}x\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(rows_of(out)[0][3], "created")
        self.assertNotIn("players will see this", out)
        text = read(vault, NPC_REL)
        self.assertIn("## Campaign Log\n\n" + S2 + "x\n\n<!-- gm-only -->",
                      text)

    def test_any_section_name_is_accepted(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault,
                        f"{NPC_REL}\tRumours\t- Said to be a spy.\n"
                        f"{NPC_REL}\tGM Notes/Debts\t- Owes the Bishop.\n")
        self.assertEqual(code, 0, out)
        text = read(vault, NPC_REL)
        self.assertLess(text.index("## Rumours"), text.index("<!-- gm-only"))
        self.assertLess(text.index("### Debts"), text.index("<!-- /gm-only"))
        self.assertLess(text.index("<!-- gm-only"), text.index("### Debts"))

    def test_a_pc_takes_log_lines(self):
        vault = make_vault(self, {PC_REL: PC})
        code, _ = log(vault, f"{PC_REL}\tCampaign Log\t{S2}x\n")
        self.assertEqual(code, 0)

    def test_crlf_note_stays_crlf(self):
        crlf = NPC.replace("\n", "\r\n")
        vault = make_vault(self, {NPC_REL: crlf})
        log(vault, f"{NPC_REL}\tCampaign Log\t{S2}x\n")
        text = read(vault, NPC_REL)
        self.assertEqual(text.replace(S2 + "x\r\n", ""), crlf)

    def test_decomposed_filename_is_found(self):
        stored = unicodedata.normalize("NFD", "Characters/NPCs/Société.md")
        asked = unicodedata.normalize("NFC", "Characters/NPCs/Société.md")
        vault = make_vault(self, {stored: NPC})
        code, out = log(vault, f"{asked}\tCampaign Log\t{S2}x\n")
        self.assertEqual(code, 0, out)

    def test_one_bad_row_writes_nothing(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t{S2}x\n"
                               f"Nope.md\tCampaign Log\t{S2}y\n")
        self.assertEqual(code, 1)
        self.assertEqual(read(vault, NPC_REL), NPC)

    def test_refusals(self):
        vault = make_vault(self, {
            NPC_REL: NPC.replace("<!-- /gm-only -->\n", "")})
        for name, rows in (("unbalanced", f"{NPC_REL}\tCampaign Log\t- x\n"),
                           ("two fields", f"{NPC_REL}\tCampaign Log\n"),
                           ("empty line", f"{NPC_REL}\tCampaign Log\t \n"),
                           ("empty", "")):
            with self.subTest(name):
                code, _ = log(vault, rows)
                self.assertEqual(code, 1)

    def test_many_notes_in_one_call(self):
        loc = "Locations/Docks.md"
        vault = make_vault(self, {NPC_REL: NPC, loc: NPC.replace("npc",
                                                                "location")})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t{S2}a\n"
                               f"{loc}\tCampaign Log\t{S2}b\n"
                               f"{NPC_REL}\tGM Notes/Behind the Scenes\t{S2}c\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("ADDED\t"), 3)


class GuardTests(unittest.TestCase):
    def test_a_path_that_is_not_a_note_is_refused(self):
        vault = make_vault(self, {NPC_REL: NPC, "pic.png": "x",
                                  "Folder.md/inner.md": NPC})
        evil = vault.parent / "evil.md"
        evil.write_bytes(NPC.encode("utf-8"))
        self.addCleanup(evil.unlink)
        for path in ("pic.png", "Folder.md", "../evil.md"):
            with self.subTest(path):
                code, out = log(vault, f"{path}\tCampaign Log\t- x\n")
                self.assertEqual(code, 1, out)
        self.assertEqual(evil.read_bytes().decode("utf-8"), NPC)
        self.assertEqual(read(vault, "pic.png"), "x")

    def test_messages(self):
        vault = make_vault(self, {"pic.png": "x"})
        self.assertIn("pic.png: not a note (.md)",
                      log(vault, "pic.png\tCampaign Log\t- x\n")[1])
        self.assertIn("../evil.md: outside the vault",
                      log(vault, "../evil.md\tCampaign Log\t- x\n")[1])

    def test_another_command_refuses_a_txt_path(self):
        vault = make_vault(self, {"Wrap.txt": "x"})
        code, out = run(vault, "wrapup-add", "Wrap.txt", "--write",
                        stdin="## A\n\nx\n")
        self.assertEqual(code, 1)
        self.assertIn("not a note", out)


class FenceAndLineTests(unittest.TestCase):
    def test_a_line_that_would_unbalance_a_fence_is_refused(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t<!-- /gm-only -->\n")
        self.assertEqual(code, 1, out)
        self.assertIn("unbalanced", out)
        self.assertEqual(read(vault, NPC_REL), NPC)

    def test_wrapup_add_fences(self):
        vault = wrap_vault(self)
        before = read(vault, WRAP_REL)
        code, out = add(vault, "## Aside\n\nx\n<!-- gm-only -->\n")
        self.assertEqual(code, 1, out)
        self.assertEqual(read(vault, WRAP_REL), before)
        code, out = add(vault, "## Aside\n\nx\n<!-- gm-only -->\nsecret\n"
                               "<!-- /gm-only -->\n")
        self.assertEqual(code, 0, out)

    def test_a_tab_inside_the_line_is_kept(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t- a\tb\n")
        self.assertEqual(code, 0, out)
        self.assertIn("- a\tb\n", read(vault, NPC_REL))

    def test_a_type_with_a_path_gets_no_template(self):
        for bad in ("../../README", "a/b", "a\\b"):
            self.assertEqual(vw.type_template(bad), (None, True))
        bare = "---\ntype: ../../README\n---\n\n# H\n"
        vault = make_vault(self, {NPC_REL: bare})
        code, out = log(vault, f"{NPC_REL}\tCampaign Log\t- x\n")
        self.assertEqual(code, 0, out)

    def test_untyped_note_public_section_goes_before_gm_notes(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## One\n\nx\n\n"
                "<!-- gm-only -->\n\n## GM Notes\n\nsecret\n\n"
                "<!-- /gm-only -->\n")
        vault = make_vault(self, {NPC_REL: note})
        log(vault, f"{NPC_REL}\tRumours\t- r\n")
        text = read(vault, NPC_REL)
        self.assertLess(text.index("## One"), text.index("## Rumours"))
        self.assertLess(text.index("## Rumours"), text.index("<!-- gm-only"))
        bare = "---\ntype: zzz\n---\n\n# H\n\n## One\n\nx\n"
        vault = make_vault(self, {NPC_REL: bare})
        log(vault, f"{NPC_REL}\tRumours\t- r\n")
        self.assertTrue(read(vault, NPC_REL).endswith("x\n\n## Rumours\n\n- r\n"))

    def test_two_same_named_headings_use_the_first(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n\n"
                "## Log\n\n- b\n")
        vault = make_vault(self, {NPC_REL: note})
        log(vault, f"{NPC_REL}\tLog\t- new\n")
        self.assertIn("- a\n- new\n\n## Log\n\n- b\n", read(vault, NPC_REL))


TL_REL = "_Campaign/Timeline.md"
TL = """---
type: timeline
---

# Timeline

## Chapter 1

### Session 1 — Arrival (3 August)

- **3 August 1814** — [[The Arrival]] — They came.

<!-- gm-only -->

## Future Events

- **12 August 1814** — the ritual.

<!-- /gm-only -->
"""


def tl(vault, rows, *flags):
    return run(vault, "timeline", *flags, "--write", stdin=rows)


class TimelineTests(unittest.TestCase):
    def test_lines_under_an_existing_heading(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **4 August 1814** — [[The Duel]] — Blood.\n"
                              "- **4 August 1814** — They slept.\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertIn(
            "They came.\n"
            "- **4 August 1814** — [[The Duel]] — Blood.\n"
            "- **4 August 1814** — They slept.\n\n<!-- gm-only -->",
            read(vault, TL_REL))

    def test_an_entry_keeps_its_own_shape_and_sub_lines(self):
        vault = make_vault(self, {TL_REL: TL})
        entry = ("- **Session 2** — [[The Duel]] — Blood on the grass.\n"
                 "  - A glove left behind.\n"
                 "  - The Bishop watched.\n")
        code, out = tl(vault, entry,
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        self.assertIn("They came.\n" + entry + "\n<!-- gm-only -->",
                      read(vault, TL_REL))

    def test_a_new_heading_goes_before_a_trailing_gm_block(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **5 August 1814** — Dawn.\n",
                       "--under", "### Session 2 — The Duel")
        self.assertEqual(code, 0, out)
        self.assertIn("between 'Session 1 — Arrival (3 August)' and "
                      "'Future Events'", out)
        text = read(vault, TL_REL)
        self.assertIn("They came.\n\n### Session 2 — The Duel\n\n"
                      "- **5 August 1814** — Dawn.\n\n<!-- gm-only -->", text)

    def test_after_names_where_a_new_heading_goes(self):
        two = TL.replace("<!-- gm-only -->", "## Chapter 2\n\n- **1815** — "
                         "Later.\n\n<!-- gm-only -->")
        vault = make_vault(self, {TL_REL: two})
        tl(vault, "- **5 August 1814** — Dawn.\n",
           "--under", "### Session 2 — The Duel",
           "--after", "### Session 1 — Arrival (3 August)")
        text = read(vault, TL_REL)
        self.assertLess(text.index("### Session 2"), text.index("## Chapter 2"))

    def test_date_warnings_do_not_block(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **Evening, 4 August 1814** — A.\n"
                              "- **4 August** — B.\n"
                              "- **3rd of Harvestmoon** — C.\n"
                              "- An undated line is the author's choice.\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("WARNING\t"), 3)
        self.assertIn("a published timeline cannot sort it", out)
        self.assertIn("- **3rd of Harvestmoon** — C.\n", read(vault, TL_REL))

    def test_a_repeat_is_a_skip(self):
        vault = make_vault(self, {TL_REL: TL})
        row = "- **3 August 1814** — [[The Arrival]] — They came.\n"
        code, out = tl(vault, row,
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0)
        self.assertIn("SKIP\t", out)
        self.assertEqual(read(vault, TL_REL), TL)

    def test_refusals(self):
        vault = make_vault(self, {TL_REL: TL})
        for name, rows, flags in (
                ("no after", "- **1814** — x\n",
                 ("--under", "### New", "--after", "### Nope")),
                ("no hashes", "- **1814** — x\n", ("--under", "Session 9")),
                ("empty", "", ("--under", "### New"))):
            with self.subTest(name):
                code, _ = tl(vault, rows, *flags)
                self.assertEqual(code, 1)
                self.assertEqual(read(vault, TL_REL), TL)

    def test_a_missing_timeline_says_who_creates_it(self):
        vault = make_vault(self, {"x.md": "x\n"})
        code, out = tl(vault, "- **1814** — x\n", "--under", "### New")
        self.assertEqual(code, 1)
        self.assertIn("no timeline — vault_scaffold.py creates it", out)

    def test_file_flag_names_another_timeline(self):
        vault = make_vault(self, {"Lore/When.md": TL})
        code, _ = tl(vault, "- **1814** — x\n", "--under",
                     "### Session 1 — Arrival (3 August)",
                     "--file", "Lore/When.md")
        self.assertEqual(code, 0)

    def test_text_before_the_first_margin_line_is_refused(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "\n  - indented first\n- **1814** — x\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 1, out)
        self.assertIn("must start with an entry at the margin", out)
        self.assertEqual(read(vault, TL_REL), TL)
        code, out = tl(vault, "\n\n- **1814** — x\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)

    def test_paragraph_entry_is_kept_apart_from_a_bullet(self):
        vault = make_vault(self, {TL_REL: TL})
        tl(vault, "Plain paragraph.\n",
           "--under", "### Session 1 — Arrival (3 August)")
        self.assertIn("They came.\n\nPlain paragraph.\n\n<!-- gm-only -->",
                      read(vault, TL_REL))
        tl(vault, "- **1814** — b\n",
           "--under", "### Session 1 — Arrival (3 August)")
        # 2.8: a bullet joins the list, ahead of the paragraph after it.
        self.assertIn("They came.\n- **1814** — b\n\nPlain paragraph.\n",
                      read(vault, TL_REL))
        vault = make_vault(self, {TL_REL: TL})
        tl(vault, "- **1814** — a\n- **1814** — b\n",
           "--under", "### Session 1 — Arrival (3 August)")
        self.assertIn("They came.\n- **1814** — a\n- **1814** — b\n",
                      read(vault, TL_REL))

    def test_row_says_when_entries_land_in_a_child_section(self):
        note = TL.replace(
            "<!-- gm-only -->", "#### Scene A\n\n- x\n\n<!-- gm-only -->", 1)
        vault = make_vault(self, {TL_REL: note})
        code, out = tl(vault, "- **1814** — y\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertIn("under '#### Scene A': - **1814** — y", out)
        self.assertIn("- x\n- **1814** — y\n", read(vault, TL_REL))

    def test_an_unbalanced_fence_is_refused_once(self):
        bad = TL.replace("<!-- /gm-only -->\n", "")
        vault = make_vault(self, {TL_REL: bad})
        code, out = tl(vault, "- **1814** — x\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 1)
        self.assertEqual(out.count("ERROR\t"), 1, out)
        self.assertEqual(read(vault, TL_REL), bad)

    def test_crlf_timeline_stays_crlf(self):
        crlf = TL.replace("\n", "\r\n")
        vault = make_vault(self, {TL_REL: crlf})
        code, out = tl(vault, "- **1814** — x\n  - sub\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        text = read(vault, TL_REL)
        self.assertIn("They came.\r\n- **1814** — x\r\n  - sub\r\n\r\n"
                      "<!-- gm-only -->", text)
        self.assertEqual(text.replace("\r\n", "").count("\n"), 0)

    def test_the_same_entry_twice_is_one_add_and_one_skip(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **1814** — x\n- **1814** — x\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("ADDED\t"), 1, out)
        self.assertEqual(out.count("SKIP\t"), 1, out)
        self.assertEqual(read(vault, TL_REL).count("- **1814** — x"), 1)


class Group1Tests(unittest.TestCase):
    def _subprocess_log(self, rel):
        import os
        import subprocess
        vault = make_vault(self, {rel: NPC})
        env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        line = "- **[[Session 02 - The Docks]]** \u2014 caf\u00e9 \u201cquoted\u201d"
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_write.py"), str(vault),
             "log", "--write"],
            input=f"{rel}\tCampaign Log\t{line}\n".encode("utf-8"),
            capture_output=True, env=env)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn(line.encode("utf-8") + b"\n",
                      (vault / rel).read_bytes())

    def test_utf8_stdin_survives_a_legacy_code_page(self):
        self._subprocess_log(NPC_REL)

    def test_a_path_the_code_page_cannot_encode_does_not_crash(self):
        self._subprocess_log("NPCs/\u014ckami.md")

    def test_a_failed_write_whose_restore_also_fails_changes_nothing(self):
        vault = make_vault(self, {"a.md": "A\n"})
        batch = vw.Batch(vault)
        batch.put("a.md", "A2\n")

        def always(path, text):
            raise vw.StepFailed("a.md cannot be written (OSError)")

        with mock.patch.object(vw, "write_text_atomic", always):
            with self.assertRaises(vw.WriteError) as ctx:
                vw.apply(batch)
        self.assertNotIsInstance(ctx.exception, vw.RestoreFailed)
        self.assertEqual(read(vault, "a.md"), "A\n")

    def test_main_says_nothing_written_for_that_failure(self):
        vault = make_vault(self, {NPC_REL: NPC})

        def always(path, text):
            raise vw.StepFailed("cannot be written (OSError)")

        with mock.patch.object(vw, "write_text_atomic", always):
            code, out = log(vault, f"{NPC_REL}\tCampaign Log\t- x\n")
        self.assertEqual(code, 1)
        self.assertIn("# nothing written", out)
        self.assertNotIn("left changed", out)

    def test_an_opener_on_a_text_line_is_a_refusal_not_a_traceback(self):
        text = WRAP.replace("<!-- gm-only -->\n\n## GM Notes",
                            "r <!-- gm-only -->\n\n## GM Notes")
        vault = wrap_vault(self, text)
        code, out = add(vault, "### World State\n\n- x\n")
        self.assertEqual(code, 1, out)
        self.assertIn("ERROR\t", out)
        self.assertIn("# nothing written", out)
        self.assertEqual(read(vault, WRAP_REL), text)

    def test_an_unexpected_exception_is_an_error_row(self):
        vault = make_vault(self, {NPC_REL: NPC})
        with mock.patch.object(vw, "add_line", side_effect=ValueError("boom")):
            code, out = log(vault, f"{NPC_REL}\tCampaign Log\t- x\n")
        self.assertEqual(code, 1)
        self.assertIn("ERROR\tValueError: boom", out)
        self.assertIn("# nothing written", out)
        self.assertEqual(read(vault, NPC_REL), NPC)

    def test_bad_utf8_on_stdin_is_a_refusal(self):
        import subprocess
        vault = make_vault(self, {NPC_REL: NPC})
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "vault_write.py"), str(vault),
             "log"], input=b"\xff\xfe\x00bad\n", capture_output=True)
        self.assertEqual(proc.returncode, 1)
        self.assertIn(b"stdin is not UTF-8", proc.stdout)

    def test_the_module_docstring_names_the_reserved_sections_and_help(self):
        self.assertIn("GM Notes section names", vw.__doc__)
        self.assertIn("<command> --help", vw.__doc__)


def rows_of(out, verb="ADDED"):
    return [r.split("\t") for r in out.splitlines()
            if r.startswith(verb + "\t")]


class Group2Tests(unittest.TestCase):
    # 2.1
    def test_every_heading_inside_a_player_section_gets_a_row(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## Narrative Recap\n\nThey ran.\n\n"
                               "#### [[Eleanor Voss]] (Sarah)\n\n- a\n")
        self.assertEqual(code, 0, out)
        self.assertTrue(any("› [[Eleanor Voss]] (Sarah)" in r[2]
                            and "players will see this" in r[3]
                            for r in rows_of(out)), out)

    # 2.2
    def test_an_unknown_h4_after_a_known_one_joins_its_parent(self):
        vault = wrap_vault(self)
        code, out = add(vault, "### What Carries Forward\n\n"
                               "#### Skipped Prep\n\n- a\n\n"
                               "#### The Dynamite Question\n\n- b\n")
        self.assertEqual(code, 0, out)
        add(vault, "### World State\n\n- w\n")
        heads = heading_lines(read(vault, WRAP_REL))
        self.assertEqual(heads[heads.index("### What Carries Forward"):][:4], [
            "### What Carries Forward", "#### Skipped Prep",
            "#### The Dynamite Question", "### World State"])

    def test_a_lone_pc_block_goes_under_pc_carry_forward(self):
        vault = wrap_vault(self)
        code, out = add(vault, "#### [[Rock Lavey]] (Sam)\n\n- go\n")
        self.assertEqual(code, 0, out)
        self.assertIn("§PC Carry-Forward\tcreated for [[Rock Lavey]] "
                      "(Sam)", out)
        code, out = add(vault, "#### [[Vint]] (Kim)\n\n- go\n")
        self.assertEqual(code, 0, out)
        self.assertNotIn("created for", out)
        add(vault, "### World State\n\n- w\n")
        heads = heading_lines(read(vault, WRAP_REL))
        self.assertEqual(heads[heads.index("### PC Carry-Forward"):][:3], [
            "### PC Carry-Forward", "#### [[Rock Lavey]] (Sam)",
            "#### [[Vint]] (Kim)", "### World State"][:3])
        self.assertEqual(heads[-2], "### World State")

    def test_a_lone_odd_h4_row_says_where_it_landed(self):
        vault = wrap_vault(self)
        _, out = add(vault, "#### Odd\n\nx\n")
        self.assertIn("at the end of GM Notes", out)
        add(vault, "### World State\n\n- w\n")
        _, out = add(vault, "#### Odder\n\nx\n")
        self.assertIn("under '### World State'", out)

    # 2.3
    def test_known_keeper_sections_keep_their_place_among_the_authors(self):
        vault = wrap_vault(self)
        for chunk in ("### Table Chatter\n\nx\n", "### World State\n\n- w\n",
                      "### Quick Bullets\n\n- q\n",
                      "### Handoff to session-prep\n\nDawn.\n"):
            code, out = add(vault, chunk)
            self.assertEqual(code, 0, out)
        self.assertEqual(
            [h for h in heading_lines(read(vault, WRAP_REL))
             if h.startswith("###")],
            ["### Quick Bullets", "### World State",
             "### Handoff to session-prep", "### Table Chatter"])

    def test_known_h4_keeps_its_place_among_the_authors(self):
        vault = wrap_vault(self)
        add(vault, "### What Carries Forward\n\n#### Mine\n\nx\n")
        add(vault, "#### Skipped Prep\n\n- s\n")
        add(vault, "#### Unresolved Threads\n\n- u\n")
        self.assertEqual(
            [h for h in heading_lines(read(vault, WRAP_REL))
             if h.startswith("####")],
            ["#### Unresolved Threads", "#### Skipped Prep", "#### Mine"])

    # 2.4
    def test_a_section_only_the_vault_template_knows_is_flagged(self):
        tmpl = ("---\ntype: session_wrap\n---\n\n## Narrative Recap\n\n"
                "## Cast List\n\n<!-- gm-only -->\n\n## GM Notes\n\n"
                "### World State\n\n<!-- /gm-only -->\n")
        vault = make_vault(self, {
            WRAP_REL: WRAP, "_Templates/_Template_Session_WrapUp.md": tmpl})
        _, out = add(vault, "## Cast List\n\n- x\n")
        self.assertIn("players will see this", rows_of(out)[0][3])
        _, out = add(vault, "## Narrative Recap\n\nx\n")
        self.assertEqual(rows_of(out)[0][3], "")

    # 2.5
    def test_a_reversed_marker_pair_is_refused(self):
        vault = wrap_vault(self)
        code, out = add(vault, "### Quality Notes\n\nsafe\n"
                               "<!-- /gm-only -->\npublic?\n"
                               "<!-- gm-only -->\nmore\n")
        self.assertEqual(code, 1, out)
        self.assertIn("outside the hidden block", out)
        self.assertIn("### Quality Notes", out)
        self.assertEqual(read(vault, WRAP_REL), WRAP)
        code, out = add(vault, "## Aside\n\nx\n<!-- gm-only -->\nsecret\n"
                               "<!-- /gm-only -->\n")
        self.assertEqual(code, 0, out)

    # 2.6
    def _log_gm(self, note, rel, section="GM Notes/Behind the Scenes"):
        vault = make_vault(self, {rel: note})
        code, out = log(vault, f"{rel}\t{section}\t- x\n")
        self.assertEqual(code, 0, out)
        return out

    def test_log_into_a_gm_notes_that_is_not_hidden_warns(self):
        warn = "GM Notes has no hidden-markers here"
        unfenced = ("---\ntype: npc\n---\n\n# H\n\n## GM Notes\n\n"
                    "### Behind the Scenes\n\n- a\n")
        late = ("---\ntype: npc\n---\n\n# H\n\n## GM Notes\n\n"
                "### Behind the Scenes\n\n- a\n\n<!-- gm-only -->\n\n"
                "### Wants\n\nw\n\n<!-- /gm-only -->\n")
        faction = "---\ntype: faction\n---\n\n# H\n\ntext\n"
        for name, note in (("unfenced", unfenced), ("late", late),
                           ("faction", faction)):
            with self.subTest(name):
                out = self._log_gm(note, NPC_REL)
                self.assertIn("WARNING\t" + NPC_REL, out)
                self.assertIn(warn, out)
        self.assertNotIn("WARNING\t", self._log_gm(NPC, NPC_REL))

    # 2.7
    def test_a_public_name_the_template_keeps_hidden_is_refused(self):
        vault = make_vault(self, {NPC_REL: NPC})
        for name in ("Behind the Scenes", "Secrets", "Wants"):
            with self.subTest(name):
                code, out = log(vault, f"{NPC_REL}\t{name}\t- x\n")
                self.assertEqual(code, 1, out)
                self.assertIn(f"'{name}' is a GM Notes section of a npc "
                              f"note: write the section as "
                              f"'GM Notes/{name}'", out)
        self.assertEqual(read(vault, NPC_REL), NPC)
        code, out = log(vault, f"{NPC_REL}\tRumours\t- r\n")
        self.assertEqual(code, 0, out)

    def test_leading_hashes_on_a_section_are_dropped(self):
        vault = make_vault(self, {NPC_REL: NPC})
        code, out = log(vault,
                        f"{NPC_REL}\t## Campaign Log\t- a\n"
                        f"{NPC_REL}\tGM Notes/### Behind the Scenes\t- b\n")
        self.assertEqual(code, 0, out)
        text = read(vault, NPC_REL)
        self.assertEqual(text.count("Campaign Log"), 1)
        self.assertEqual(text.count("Behind the Scenes"), 1)
        self.assertIn("- a\n", text)
        self.assertIn("- b\n", text)

    # 2.8
    def test_a_log_line_goes_after_the_list_not_after_the_block(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n- b\n\n"
                "```dataview\nTABLE x\n```\n\n## Next\n")
        callout = note.replace("```dataview\nTABLE x\n```", "> [!note]\n> hi")
        for text in (note, callout):
            vault = make_vault(self, {NPC_REL: text})
            code, out = log(vault, f"{NPC_REL}\tLog\t- new\n")
            self.assertEqual(code, 0, out)
            self.assertIn("- a\n- b\n- new\n\n", read(vault, NPC_REL))

    def test_a_log_line_keeps_a_nested_continuation_with_its_item(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n  - sub\n"
                "  more\n\n> [!note]\n> hi\n")
        vault = make_vault(self, {NPC_REL: note})
        log(vault, f"{NPC_REL}\tLog\t- new\n")
        self.assertIn("  - sub\n  more\n- new\n\n> [!note]",
                      read(vault, NPC_REL))

    def test_a_table_line_joins_the_table(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n| d | e |\n"
                "|---|---|\n| 1 | a |\n\nafter\n")
        vault = make_vault(self, {NPC_REL: note})
        log(vault, f"{NPC_REL}\tLog\t| 2 | b |\n")
        self.assertIn("| 1 | a |\n| 2 | b |\n\nafter\n", read(vault, NPC_REL))

    def test_a_section_without_a_list_takes_the_line_at_its_end(self):
        note = "---\ntype: zzz\n---\n\n# H\n\n## Log\n\ntext\n\n## Next\n"
        vault = make_vault(self, {NPC_REL: note})
        log(vault, f"{NPC_REL}\tLog\t- new\n")
        self.assertIn("text\n\n- new\n\n## Next", read(vault, NPC_REL))

    def test_a_timeline_entry_goes_after_the_list(self):
        tlt = TL.replace("They came.\n", "They came.\n\n```dataview\nx\n```\n")
        vault = make_vault(self, {TL_REL: tlt})
        tl(vault, "- **4 August 1814** — Next.\n",
           "--under", "### Session 1 — Arrival (3 August)")
        self.assertIn("They came.\n- **4 August 1814** — Next.\n\n```",
                      read(vault, TL_REL))

    # 2.9
    def test_under_a_title_at_another_level_is_refused(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **1814** — x\n",
                       "--under", "## Session 1 — Arrival (3 August)")
        self.assertEqual(code, 1, out)
        self.assertIn("'### Session 1 — Arrival (3 August)'", out)
        self.assertEqual(read(vault, TL_REL), TL)

    def test_a_new_timeline_heading_says_who_will_see_it(self):
        vault = make_vault(self, {TL_REL: TL})
        _, out = tl(vault, "- **5 August 1814** — D.\n",
                    "--under", "### Session 2")
        self.assertIn("'Future Events' — players will see this", out)
        both = TL.replace("<!-- gm-only -->", "<!-- gm-only -->\n\n"
                          "## Hidden Chapter\n\n<!-- /gm-only -->\n\n"
                          "<!-- gm-only -->")
        vault = make_vault(self, {TL_REL: both})
        _, out = tl(vault, "- **5 August 1814** — D.\n",
                    "--under", "### Secret Plot",
                    "--after", "## Hidden Chapter")
        self.assertIn("— hidden", out)

    def test_timeline_entries_keep_trailing_spaces(self):
        vault = make_vault(self, {TL_REL: TL})
        tl(vault, "- **4 August 1814** — a  \n  - sub \t\n",
           "--under", "### Session 1 — Arrival (3 August)")
        self.assertIn("- **4 August 1814** — a  \n  - sub \t\n",
                      read(vault, TL_REL))

    def test_timeline_entries_land_as_one_block_in_stdin_order(self):
        vault = make_vault(self, {TL_REL: TL})
        code, out = tl(vault, "- **4 August 1814** — one\n"
                              "- **3 August 1814** — [[The Arrival]] — "
                              "They came.\n"
                              "- **5 August 1814** — three\n",
                       "--under", "### Session 1 — Arrival (3 August)")
        self.assertEqual(code, 0, out)
        text = read(vault, TL_REL)
        self.assertLess(text.index("— one"), text.index("— three"))
        self.assertEqual(text.count("They came."), 1)
        self.assertIn("They came.\n- **4 August 1814** — one\n"
                      "- **5 August 1814** — three\n\n<!-- gm-only",
                      text)

    def test_a_log_line_keeps_its_leading_spaces(self):
        vault = make_vault(self, {NPC_REL: NPC})
        log(vault, f"{NPC_REL}\tCampaign Log\t  - indented \n")
        self.assertIn("party.\n  - indented \n", read(vault, NPC_REL))

    # 2.10
    def test_section_end_ignores_spoiler_markers_like_gm_markers(self):
        text = ("# T\n\n## Log\n\n- a\n\n<!-- spoiler -->\n\n## Secret\n\n"
                "x\n\n<!-- /spoiler -->\n")
        doc = vw.parse(text)
        log_head = next(h for h in doc.heads if h.title == "Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log_head)].strip(),
                         "<!-- spoiler -->")
        wrapped = ("# T\n\n<!-- spoiler -->\n\n## Log\n\n- a\n\n"
                   "<!-- /spoiler -->\n\n## Next\n")
        doc = vw.parse(wrapped)
        log_head = next(h for h in doc.heads if h.title == "Log")
        self.assertEqual(doc.lines[vw.section_end(doc, log_head)].strip(),
                         "<!-- /spoiler -->")

    # 2.11
    def test_append_adds_to_an_existing_section(self):
        vault = wrap_vault(self)
        add(vault, "## Narrative Recap\n\nThey ran.\n\n## Memorable "
                   "Moments\n\nx\n")
        code, out = add(vault, "## Narrative Recap\n\nThen they hid.\n",
                        "--append")
        self.assertEqual(code, 0, out)
        self.assertIn("\tappended", out)
        text = read(vault, WRAP_REL)
        self.assertEqual(text.count("## Narrative Recap"), 1)
        self.assertIn("They ran.\n\nThen they hid.\n\n## Memorable", text)
        add(vault, "### World State\n\n- a\n")
        add(vault, "### World State\n\n- b\n", "--append")
        self.assertIn("- a\n- b\n\n<!-- /gm-only -->",
                      read(vault, WRAP_REL))

    def test_append_and_replace_exclude_each_other(self):
        vault = wrap_vault(self)
        with self.assertRaises(SystemExit):
            run(vault, "wrapup-add", WRAP_REL, "--append", "--replace",
                stdin="### World State\n\nx\n")

    def test_replace_says_how_many_lines_it_replaced(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- a\n- b\n")
        code, out = add(vault, "### World State\n\n- c\n", "--replace")
        self.assertIn("replaced (4 lines)", out)

    def test_a_marker_in_the_text_given_is_named_as_such(self):
        vault = wrap_vault(self)
        code, out = add(vault, "## Aside\n\nx\n<!-- gm-only -->\n")
        self.assertEqual(code, 1)
        self.assertIn("in the text given, not in the note", out)

    # 2.12
    def test_a_null_play_notes_is_absent(self):
        for value in ("null", "~", '""', '"[[]]"'):
            with self.subTest(value):
                src = INDEX.replace(
                    'play_notes: "[[Session 02 - The Docks - Play Notes]]"',
                    f"play_notes: {value}")
                notes, body = WrapupNewTests._notes(
                    None, "Session 02 - The Docks - Play Notes")
                vault = make_vault(self, {INDEX_REL: src, notes: body})
                code, out = run(vault, "wrapup-new", "--session", INDEX_REL,
                                "--write")
                self.assertEqual(code, 0, out)
                self.assertIn('source_document: "[[Session 02 - The Docks '
                              '- Play Notes]]"\n', read(vault, WRAP_REL))

    def test_an_existing_wrap_up_under_another_name_is_refused(self):
        other = "Chapters/Chapter 1 - Arrival/Sessions/Session 02/Recap.md"
        src = INDEX.replace("[[Chapter_01_Session_02_Wrap_Up]]", "[[Recap]]")
        vault = make_vault(self, {INDEX_REL: src, other: "x\n"})
        code, out = run(vault, "wrapup-new", "--session", INDEX_REL, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"already has a Wrap-Up: {other}", out)
        self.assertFalse((vault / WRAP_REL).exists())

    # 2.13
    def test_story_dash_forms_are_one_heading(self):
        vault = story_vault(self, {})
        code, out = tell(vault, "# [[Rock Lavey]]\n\n## Session 2 - The "
                                "Docks\n\nText.\n")
        self.assertEqual(code, 0, out)
        code, out = tell(vault, "# [[Rock Lavey]]\n\n## Session 2 — The "
                                "Docks\n\nAgain.\n", "--as-of", "x")
        self.assertEqual(code, 1, out)
        self.assertIn("already has", out)


class FollowUpTests(unittest.TestCase):
    # 1
    def _one(self, note, section="Log", line="- pub"):
        vault = make_vault(self, {NPC_REL: note})
        code, out = log(vault, f"{NPC_REL}\t{section}\t{line}\n")
        self.assertEqual(code, 0, out)
        return read(vault, NPC_REL)

    def test_a_log_line_stays_out_of_a_gm_only_aside(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n\n"
                "<!-- gm-only -->\n- keeper aside\n<!-- /gm-only -->\n\n"
                "## Next\n")
        self.assertIn("- a\n- pub\n\n<!-- gm-only -->", self._one(note))

    def test_a_log_line_stays_out_of_a_spoiler_aside(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n\n"
                "<!-- spoiler -->\n- hidden\n<!-- /spoiler -->\n\n"
                "## Next\n")
        self.assertIn("- a\n- pub\n\n<!-- spoiler -->", self._one(note))

    def test_a_timeline_entry_stays_out_of_a_fenced_bullet(self):
        tlt = TL.replace("They came.\n", "They came.\n\n<!-- gm-only -->\n"
                         "- **1 August 1814** \u2014 keeper\n"
                         "<!-- /gm-only -->\n")
        vault = make_vault(self, {TL_REL: tlt})
        tl(vault, "- **4 August 1814** \u2014 Next.\n",
           "--under", "### Session 1 \u2014 Arrival (3 August)")
        self.assertIn("They came.\n- **4 August 1814** \u2014 Next.\n\n"
                      "<!-- gm-only -->\n- **1 August", read(vault, TL_REL))

    def test_a_section_inside_the_fence_gets_its_line_inside(self):
        text = self._one(NPC, "GM Notes/Behind the Scenes", "- new")
        self.assertIn("lied.\n- new\n\n<!-- /gm-only -->", text)

    # 2
    def test_an_already_public_section_takes_a_line_without_refusal(self):
        note = NPC.replace("## Campaign Log", "## Wants\n\n- public\n\n"
                           "## Campaign Log")
        vault = make_vault(self, {NPC_REL: note})
        code, out = log(vault, f"{NPC_REL}\tWants\t- more\n")
        self.assertEqual(code, 0, out)
        self.assertIn("- public\n- more\n", read(vault, NPC_REL))
        vault = make_vault(self, {NPC_REL: NPC})
        code, _ = log(vault, f"{NPC_REL}\tWants\t- more\n")
        self.assertEqual(code, 1)

    # 3
    def test_a_section_the_template_does_not_know_keeps_the_warning(self):
        vault = make_vault(self, {NPC_REL: NPC})
        _, out = log(vault, f"{NPC_REL}\tRumours\t- r\n")
        self.assertIn("new section \u2014 players will see this", out)

    # 4
    def test_append_goes_before_the_sections_child_headings(self):
        vault = wrap_vault(self)
        add(vault, "### What Carries Forward\n\n- own\n\n"
                   "#### Skipped Prep\n\n- s\n")
        add(vault, "### What Carries Forward\n\n- stray note\n", "--append")
        text = read(vault, WRAP_REL)
        self.assertIn("- own\n- stray note\n\n#### Skipped Prep", text)
        add(vault, "### What Carries Forward\n\n#### Mine\n\nm\n",
            "--append")
        self.assertLess(text.index("#### Skipped Prep"),
                        read(vault, WRAP_REL).index("#### Mine"))

    def test_append_with_nothing_to_append_is_refused(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- a\n")
        before = read(vault, WRAP_REL)
        code, out = add(vault, "### World State\n", "--append")
        self.assertEqual(code, 1, out)
        self.assertIn("nothing to add", out)  # bare-heading rule
        self.assertEqual(read(vault, WRAP_REL), before)

    # 5
    def test_a_wrap_up_link_with_a_path_or_alias_is_resolved(self):
        other = "Chapters/Chapter 1 - Arrival/Sessions/Session 02/Recap.md"
        for link in ("[[Sessions/Recap]]", "[[Sessions/Recap|the wrap]]",
                     "[[Recap|the wrap]]"):
            with self.subTest(link):
                src = INDEX.replace("[[Chapter_01_Session_02_Wrap_Up]]", link)
                vault = make_vault(self, {INDEX_REL: src, other: "x\n"})
                code, out = run(vault, "wrapup-new", "--session", INDEX_REL)
                self.assertEqual(code, 1, out)
                self.assertIn("already has a Wrap-Up", out)

    # 7
    def test_log_help_names_the_gm_notes_rule(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out), self.assertRaises(SystemExit):
            vw.build_parser().parse_args(["v", "log", "--help"])
        self.assertIn("GM Notes/<Name>", out.getvalue())


class FollowUp2Tests(unittest.TestCase):
    def test_a_known_child_under_an_existing_parent_needs_no_flag(self):
        for flags in ((), ("--append",), ("--replace",)):
            with self.subTest(flags):
                vault = wrap_vault(self)
                add(vault, "### What Carries Forward\n\n#### Skipped Prep\n\n"
                           "- s\n")
                code, out = add(vault, "### What Carries Forward\n\n"
                                       "#### NPCs Needing Follow-Up\n\n- n\n",
                                *flags)
                self.assertEqual(code, 0, out)
                self.assertEqual(out.count("ADDED\t"), 1, out)
                text = read(vault, WRAP_REL)
                self.assertEqual(text.count("### What Carries Forward"), 1)
                self.assertLess(text.index("#### NPCs Needing Follow-Up"),
                                text.index("#### Skipped Prep"))

    def test_a_lone_bare_heading_for_an_existing_section_adds_nothing(self):
        vault = wrap_vault(self)
        add(vault, "### World State\n\n- a\n")
        before = read(vault, WRAP_REL)
        for flags in ((), ("--append",)):
            code, out = add(vault, "### World State\n", *flags)
            self.assertEqual(code, 1, out)
            self.assertIn("nothing to add", out)
            self.assertEqual(read(vault, WRAP_REL), before)

    def test_a_bare_heading_for_a_missing_parent_is_still_created(self):
        vault = wrap_vault(self)
        code, out = add(vault, "### What Carries Forward\n\n"
                               "#### Skipped Prep\n\n- s\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("ADDED\t"), 2, out)
        self.assertIn("### What Carries Forward\n\n#### Skipped Prep",
                      read(vault, WRAP_REL))

    def test_the_duplicate_check_ignores_a_hidden_aside(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n\n"
                "<!-- gm-only -->\n- pub\n<!-- /gm-only -->\n\n## Next\n")
        vault = make_vault(self, {NPC_REL: note})
        code, out = log(vault, f"{NPC_REL}\tLog\t- pub\n")
        self.assertEqual(code, 0, out)
        self.assertNotIn("SKIP", out)
        self.assertIn("- a\n- pub\n\n<!-- gm-only -->", read(vault, NPC_REL))

    def test_the_timeline_duplicate_check_ignores_a_hidden_aside(self):
        entry = "- **4 August 1814** \u2014 Next."
        tlt = TL.replace("They came.\n", "They came.\n\n<!-- gm-only -->\n"
                         f"{entry}\n<!-- /gm-only -->\n")
        vault = make_vault(self, {TL_REL: tlt})
        code, out = tl(vault, entry + "\n",
                       "--under", "### Session 1 \u2014 Arrival (3 August)")
        self.assertEqual(code, 0, out)
        self.assertNotIn("SKIP", out)
        self.assertIn(f"They came.\n{entry}\n\n<!-- gm-only -->",
                      read(vault, TL_REL))

    def test_the_duplicate_check_ignores_a_code_fence(self):
        note = ("---\ntype: zzz\n---\n\n# H\n\n## Log\n\n- a\n\n"
                "```\n- pub\n```\n\n## Next\n")
        vault = make_vault(self, {NPC_REL: note})
        code, out = log(vault, f"{NPC_REL}\tLog\t- pub\n")
        self.assertEqual(code, 0, out)
        self.assertNotIn("SKIP", out)


if __name__ == "__main__":
    unittest.main()

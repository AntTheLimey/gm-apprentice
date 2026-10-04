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
        code, out = run(vault, "wrapup-add", WRAP_REL,
                        stdin="## Narrative Recap\n\nx\n\n#### Deep\n\ny\n")
        self.assertNotIn("Deep\t", out)
        self.assertEqual(out.count("WOULD-ADD"), 1, out)

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
        add(vault, "#### Foo\n\nold\n")
        before = read(vault, WRAP_REL)
        code, out = add(vault, "#### Foo\n\nnew\n")
        self.assertEqual(code, 1)
        self.assertIn("--replace", out)
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
        self.assertIn("players will see this", out)
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
        self.assertIn("will not sort", out)
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
        self.assertIn("vault setup", out)

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
        self.assertIn("Plain paragraph.\n\n- **1814** — b\n",
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


if __name__ == "__main__":
    unittest.main()

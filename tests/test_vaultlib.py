#!/usr/bin/env python3
"""Regression tests for vaultlib — the shared vault model module.

vaultlib owns the frontmatter reader, the wikilink/normalization
helpers, the fenced-block scanner, and the small vault queries that
every bundled script used to keep a private copy of. These tests pin
the pieces the other scripts (and later mechanization slices) depend
on, especially the ones with no other coverage: the nested-mapping
reader, the frontmatter line editors, and `scan_body`.

Run: python tests/test_vaultlib.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vaultlib as vl  # noqa: E402


def write(directory: Path, rel: str, text: str) -> Path:
    path = directory / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class ExtractFrontmatterTests(unittest.TestCase):
    def test_crlf_file(self):
        text = "---\r\ntype: npc\r\ncanon_status: DRAFT\r\n---\r\n\r\n# Body\r\n"
        self.assertEqual(vl.extract_frontmatter(text),
                         {"type": "npc", "canon_status": "DRAFT"})

    def test_inline_array(self):
        text = '---\naliases: [Doc, "The Colonel"]\n---\n'
        self.assertEqual(vl.extract_frontmatter(text),
                         {"aliases": ["Doc", "The Colonel"]})

    def test_block_list(self):
        text = "---\naliases:\n  - Doc\n  - The Colonel\n---\n"
        self.assertEqual(vl.extract_frontmatter(text),
                         {"aliases": ["Doc", "The Colonel"]})

    def test_quoted_scalar_keeps_inner_hash(self):
        text = '---\nname: "Room #3"  # a comment\n---\n'
        self.assertEqual(vl.extract_frontmatter(text), {"name": "Room #3"})

    def test_no_frontmatter(self):
        self.assertIsNone(vl.extract_frontmatter("# Just a heading\n"))

    def test_matches_schema_rules_reexport(self):
        import schema_rules
        self.assertIs(schema_rules.extract_frontmatter, vl.extract_frontmatter)
        self.assertIs(schema_rules.scalar_value, vl.scalar_value)
        self.assertIs(schema_rules.wikilink_target, vl.wikilink_target)
        self.assertIs(schema_rules.chapter_of, vl.chapter_of)
        self.assertIs(schema_rules.chapter_key, vl.chapter_key)
        self.assertIs(schema_rules.parse_session_number,
                      vl.parse_session_number)
        self.assertIs(schema_rules.QUOTED_SCALAR_RE, vl.QUOTED_SCALAR_RE)
        self.assertEqual(schema_rules.MAX_PLAUSIBLE_SESSION,
                         vl.MAX_PLAUSIBLE_SESSION)


SESSION_INDEX = """---
type: session
session_number: 1
status: played
documents:
  plan: "[[Session 01 - The Bay - Plan]]"
  notes: "[[Session 01 - The Bay - Play Notes]]"
  wrap_up: "[[Session 01 - The Bay - Wrap-Up]]"
tags:
  - chapter-01
---

# Session 01
"""


class NestedMappingTests(unittest.TestCase):
    def test_returns_child_links(self):
        self.assertEqual(
            vl.nested_mapping(SESSION_INDEX, "documents"),
            {"plan": "[[Session 01 - The Bay - Plan]]",
             "notes": "[[Session 01 - The Bay - Play Notes]]",
             "wrap_up": "[[Session 01 - The Bay - Wrap-Up]]"})

    def test_absent_key(self):
        self.assertEqual(vl.nested_mapping(SESSION_INDEX, "publish"), {})

    def test_scalar_key(self):
        self.assertEqual(vl.nested_mapping(SESSION_INDEX, "status"), {})

    def test_block_list_is_not_a_mapping(self):
        self.assertEqual(vl.nested_mapping(SESSION_INDEX, "tags"), {})

    def test_inline_list_value_returned_raw(self):
        text = '---\npublish:\n  exclude_sections: ["GM Notes", "Keeper"]\n---\n'
        self.assertEqual(vl.nested_mapping(text, "publish"),
                         {"exclude_sections": '["GM Notes", "Keeper"]'})


class FrontmatterEditorTests(unittest.TestCase):
    @staticmethod
    def fm(text: str) -> list[str]:
        lines = text.splitlines(keepends=True)
        close, err = vl.frontmatter_span(lines)
        assert err is None, err
        return lines[1:close]

    def test_frontmatter_span(self):
        lines = "---\ntype: npc\n---\n\nbody\n".splitlines(keepends=True)
        self.assertEqual(vl.frontmatter_span(lines), (2, None))

    def test_frontmatter_span_rejects_malformed_delimiter(self):
        lines = "---\ntype: npc\n--- \n".splitlines(keepends=True)
        idx, err = vl.frontmatter_span(lines)
        self.assertEqual(idx, -1)
        self.assertIn("malformed", err)

    def test_get_and_set_key(self):
        fm = self.fm("---\ntype: npc\nasOfSession: 7\n---\n")
        self.assertEqual(vl.get_key(fm, "asOfSession"), "7")
        vl.set_key(fm, "asOfSession", "9", "\n")
        self.assertEqual(vl.get_key(fm, "asOfSession"), "9")
        vl.set_key(fm, "lastUpdated", '"2026-09-06"', "\n")
        self.assertEqual(vl.get_key(fm, "lastUpdated"), '"2026-09-06"')

    def test_set_key_writes_the_value_literally(self):
        # The value must never be interpreted as an re.sub replacement
        # template: a template eats one level of backslash escaping and
        # expands \g<0> to the whole matched line.
        for value in (r'"C:\\Users\\ant"', r'"\g<0>"', r'"a\1b"',
                      r'"back\\slash"'):
            with self.subTest(value=value):
                fm = self.fm("---\ntype: npc\npath: old\n---\n")
                vl.set_key(fm, "path", value, "\n")
                self.assertIn(f"path: {value}\n", fm)
                self.assertEqual(vl.get_key(fm, "path"), value)

    def test_set_key_appends_literally_too(self):
        fm = self.fm("---\ntype: npc\n---\n")
        value = r'"C:\\Users\\ant"'
        vl.set_key(fm, "path", value, "\n")
        self.assertEqual(fm[-1], f"path: {value}\n")

    def test_set_key_keeps_the_lines_own_eol(self):
        fm = "---\r\ntype: npc\r\nx: 1\r\n---\r\n".splitlines(keepends=True)[1:3]
        vl.set_key(fm, "x", "2", "\n")
        self.assertEqual(fm[1], "x: 2\r\n")

    def test_set_nested_key_replaces_in_place(self):
        fm = self.fm(SESSION_INDEX)
        before = len(fm)
        vl.set_nested_key(fm, "documents", "plan", '"[[New Plan]]"', "\n")
        self.assertEqual(len(fm), before)
        self.assertIn('  plan: "[[New Plan]]"\n', fm)
        self.assertEqual(vl.nested_mapping("---\n" + "".join(fm) + "---\n",
                                           "documents")["plan"],
                         "[[New Plan]]")

    def test_set_nested_key_appends_at_block_end(self):
        fm = self.fm(SESSION_INDEX)
        vl.set_nested_key(fm, "documents", "handouts", '"[[Handouts]]"', "\n")
        joined = "".join(fm)
        self.assertIn('  handouts: "[[Handouts]]"\n', joined)
        # appended inside the block, before the next top-level key
        self.assertLess(joined.index("handouts:"), joined.index("tags:"))
        self.assertEqual(len(vl.nested_mapping("---\n" + joined + "---\n",
                                               "documents")), 4)

    def test_set_nested_key_creates_absent_block(self):
        fm = self.fm("---\ntype: session\n---\n")
        vl.set_nested_key(fm, "documents", "plan", '"[[P]]"', "\n")
        joined = "".join(fm)
        self.assertIn("documents:\n", joined)
        self.assertIn('  plan: "[[P]]"\n', joined)
        self.assertEqual(vl.nested_mapping("---\n" + joined + "---\n",
                                           "documents"), {"plan": "[[P]]"})

    def test_set_nested_key_uses_the_blocks_own_indent(self):
        fm = self.fm("---\ndocuments:\n    plan: \"[[P]]\"\n---\n")
        vl.set_nested_key(fm, "documents", "notes", '"[[N]]"', "\n")
        self.assertIn('    notes: "[[N]]"\n', "".join(fm))

    def test_set_nested_key_refuses_an_inline_parent_map(self):
        # Appending a second `documents:` block here would leave a
        # duplicate top-level key: every YAML reader resolves it
        # last-wins, so the inline plan and play_notes would vanish from
        # the whole toolchain while the writer reported success.
        inline = 'documents: {plan: "[[P]]", play_notes: "[[N]]"}\n'
        fm = self.fm(f"---\n{inline}---\n")
        with self.assertRaises(ValueError) as caught:
            vl.set_nested_key(fm, "documents", "wrap_up", '"[[W]]"', "\n")
        self.assertIn("inline value", str(caught.exception))
        self.assertEqual("".join(fm), inline)

    def test_set_nested_key_refuses_an_inline_empty_parent(self):
        for value in ("{}", "[]"):
            with self.subTest(value=value):
                fm = self.fm(f"---\ndocuments: {value}\n---\n")
                with self.assertRaises(ValueError):
                    vl.set_nested_key(fm, "documents", "plan", '"[[P]]"',
                                      "\n")
                self.assertEqual("".join(fm), f"documents: {value}\n")

    def test_set_nested_key_ignores_a_trailing_comment_on_the_parent(self):
        fm = self.fm("---\ndocuments:  # the chain\n  plan: \"[[P]]\"\n---\n")
        vl.set_nested_key(fm, "documents", "notes", '"[[N]]"', "\n")
        self.assertIn('  notes: "[[N]]"\n', "".join(fm))

    def test_opens_a_block(self):
        fm = self.fm("---\nconfidence:\n  - one\n  - two\nstatus: DRAFT\n---\n")
        self.assertTrue(vl.opens_a_block(fm, "confidence"))
        self.assertFalse(vl.opens_a_block(fm, "status"))
        self.assertFalse(vl.opens_a_block(fm, "absent"))

    def test_delete_key_first_top_level_only(self):
        fm = self.fm("---\ntype: npc\ndocuments:\n  type: nested\n"
                     "type: duplicate\n---\n")
        removed = vl.delete_key(fm, "type")
        self.assertEqual(removed, "type: npc")  # returned without its EOL
        joined = "".join(fm)
        self.assertIn("  type: nested\n", joined)
        self.assertIn("type: duplicate\n", joined)

    def test_delete_key_never_matches_a_nested_key(self):
        fm = self.fm("---\ndocuments:\n  plan: \"[[P]]\"\n---\n")
        self.assertIsNone(vl.delete_key(fm, "plan"))
        self.assertIn('  plan: "[[P]]"\n', "".join(fm))


class YamlValueForCliTests(unittest.TestCase):
    def test_values(self):
        cases = {
            "7": "7",
            "null": "null",
            "~": "null",
            "": "null",
            "true": "true",
            "false": "false",
            "[[Session 07 - X]]": '"[[Session 07 - X]]"',
            '"already"': '"already"',
            "Chapter 4, Session 9": '"Chapter 4, Session 9"',
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(vl.yaml_value_for_cli(raw), want)


SCAN_DOC = """---
type: scene
---
line 4 published
```
<!-- gm-only -->
line 7 fenced marker is inert
```
<!-- gm-only -->
line 10 hidden
<!-- gm-only -->
line 12 hidden inner
<!-- /gm-only -->
line 14 still hidden (outer block survives)
<!-- /gm-only -->
line 16 published again
<!-- /gm-only -->
line 18 published (orphan closer did not go negative)
## GM Notes
line 20 excluded
### Sub
line 22 excluded
## Public
line 24 published
~~~
```
line 27 fenced by tildes
~~~
<!-- gm-only -->
line 30 hidden to EOF
"""


class ScanBodyTests(unittest.TestCase):
    def setUp(self):
        self.states, self.problems = vl.scan_body(
            SCAN_DOC, exclude_sections=["gm notes"])
        self.by_line = {s.lineno: s for s in self.states}

    def published_lines(self):
        return {n for n, s in self.by_line.items() if s.published}

    def test_body_starts_after_frontmatter(self):
        self.assertEqual(min(self.by_line), 4)

    def test_marker_inside_code_fence_is_inert(self):
        self.assertTrue(self.by_line[6].in_code)
        self.assertIsNone(self.by_line[6].marker)
        self.assertEqual(self.by_line[7].gm_depth, 0)
        self.assertTrue(self.by_line[7].published)

    def test_nested_pair_keeps_outer_block_open(self):
        self.assertEqual(self.by_line[10].gm_depth, 1)
        self.assertEqual(self.by_line[12].gm_depth, 2)
        self.assertEqual(self.by_line[14].gm_depth, 1)
        self.assertFalse(self.by_line[14].published)
        self.assertTrue(self.by_line[16].published)

    def test_orphan_closer_recorded_and_depth_stays_zero(self):
        self.assertEqual(self.by_line[17].marker, "close-gm")
        self.assertEqual(self.by_line[17].gm_depth, 0)
        self.assertTrue(self.by_line[18].published)
        self.assertIn("line 17: <!-- /gm-only --> with no opener",
                      self.problems)

    def test_unclosed_opener_recorded(self):
        self.assertIn("line 29: <!-- gm-only --> never closed", self.problems)
        self.assertFalse(self.by_line[30].published)

    def test_excluded_section_covers_subheadings_only(self):
        self.assertEqual(self.by_line[19].excluded_by, "GM Notes")
        self.assertEqual(self.by_line[20].excluded_by, "GM Notes")
        self.assertEqual(self.by_line[21].excluded_by, "GM Notes")
        self.assertEqual(self.by_line[22].excluded_by, "GM Notes")
        self.assertIsNone(self.by_line[23].excluded_by)
        self.assertTrue(self.by_line[24].published)

    def test_headings_reported(self):
        self.assertEqual(self.by_line[19].heading, (2, "GM Notes"))
        self.assertEqual(self.by_line[21].heading, (3, "Sub"))
        self.assertEqual(self.by_line[23].heading, (2, "Public"))

    def test_tilde_fence_makes_backticks_inert(self):
        self.assertTrue(self.by_line[26].in_code)
        self.assertTrue(self.by_line[27].in_code)
        self.assertTrue(self.by_line[28].in_code)
        # the tilde fence closes on line 28, so line 29 is a real marker
        self.assertEqual(self.by_line[29].marker, "open-gm")

    def test_published_set(self):
        self.assertEqual(
            self.published_lines(),
            {4, 5, 6, 7, 8, 16, 18, 23, 24, 25, 26, 27, 28})

    def test_a_heading_inside_a_gm_block_starts_no_exclusion(self):
        # The publish pipeline runs stripGmOnly BEFORE filterSections, so
        # this `## GM Notes` is already gone when the section filter runs:
        # it never starts an exclusion, and the bold label below the
        # closer publishes. `<!-- gm-only -->` around `## GM Notes` is
        # exactly the shape `wrapup --fix` writes, so treating it as an
        # exclusion blinded gm-leak to everything appended after it.
        text = ("# Bob\n\n<!-- gm-only -->\n## GM Notes\nhidden\n"
                "<!-- /gm-only -->\n\n**Secret:** he runs the cult.\n")
        states, problems = vl.scan_body(text, exclude_sections=["GM Notes"])
        by_line = {s.lineno: s for s in states}
        self.assertEqual(problems, [])
        self.assertEqual(by_line[4].heading, (2, "GM Notes"))
        self.assertIsNone(by_line[4].excluded_by)
        self.assertFalse(by_line[4].published)   # hidden by the fence
        self.assertIsNone(by_line[8].excluded_by)
        self.assertTrue(by_line[8].published)

    def test_a_heading_inside_a_gm_block_ends_no_exclusion(self):
        # The mirror case: an exclusion opened outside the block is not
        # closed by a shallower heading the publish tool has stripped.
        text = ("## GM Notes\nhidden\n<!-- gm-only -->\n# Top\n"
                "<!-- /gm-only -->\nstill under GM Notes\n")
        states, _ = vl.scan_body(text, exclude_sections=["GM Notes"])
        by_line = {s.lineno: s for s in states}
        self.assertEqual(by_line[6].excluded_by, "GM Notes")
        self.assertFalse(by_line[6].published)

    def test_spoiler_markers_tracked_separately(self):
        states, problems = vl.scan_body(
            "<!-- spoiler -->\nhidden\n<!-- /spoiler -->\nshown\n")
        self.assertEqual(problems, [])
        self.assertEqual([s.published for s in states],
                         [False, False, False, True])


class ExcludeSectionsTests(unittest.TestCase):
    def test_defaults_are_the_publish_defaults(self):
        self.assertEqual(
            vl.DEFAULT_EXCLUDE_SECTIONS,
            ("GM Notes", "DM Notes", "Player Notes", "Source References",
             "Reconciliation Context", "Handoff to Reconcile"))

    def test_union_with_vault_config_inline_list(self):
        with tempfile.TemporaryDirectory() as d:
            vault = Path(d)
            write(vault, "_meta/vault-config.md",
                  '---\npublish:\n  mode: full\n'
                  '  exclude_sections: ["GM Notes", "Keeper Notes"]\n---\n')
            got = vl.effective_exclude_sections(vault)
        self.assertEqual(got, list(vl.DEFAULT_EXCLUDE_SECTIONS)
                         + ["Keeper Notes"])

    def test_union_with_vault_config_block_list(self):
        with tempfile.TemporaryDirectory() as d:
            vault = Path(d)
            write(vault, "_meta/vault-config.md",
                  "---\npublish:\n  exclude_sections:\n"
                  '    - "Keeper Notes"\n    - "gm notes"\n---\n')
            got = vl.effective_exclude_sections(vault)
        # 'gm notes' de-duplicates case-insensitively against the default
        self.assertEqual(got, list(vl.DEFAULT_EXCLUDE_SECTIONS)
                         + ["Keeper Notes"])

    def test_no_config_returns_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(vl.effective_exclude_sections(Path(d)),
                             list(vl.DEFAULT_EXCLUDE_SECTIONS))


class VersionTests(unittest.TestCase):
    def test_ordering_is_numeric_not_lexical(self):
        self.assertLess(vl.parse_version("1.8.9"), vl.parse_version("1.8.15"))

    def test_prerelease_suffix_ignored(self):
        self.assertEqual(vl.parse_version("1.9.7-rc1"), (1, 9, 7))
        self.assertEqual(vl.parse_version("1.9.7+build2"), (1, 9, 7))

    def test_empty(self):
        self.assertEqual(vl.parse_version(""), ())

    def test_plugin_version_reads_plugin_json(self):
        expected = json.loads(
            (ROOT / ".claude-plugin" / "plugin.json").read_text(
                encoding="utf-8"))["version"]
        got = vl.plugin_version()
        self.assertIsNotNone(got)
        self.assertEqual(got[0], expected)


class VaultQueryTests(unittest.TestCase):
    def build(self, d: str) -> Path:
        vault = Path(d)
        write(vault, "Characters/Katherine Winslow.md",
              "---\ntype: pc\nstatus: alive\naliases:\n  - Kate\n---\n")
        write(vault, "Characters/Katherine Winslow_Story.md",
              "---\ntype: pc\nstatus: alive\n---\n")
        write(vault, "Characters/Edward Blake.md",
              "---\ntype: pc\nstatus: dead\n---\n")
        write(vault, "Characters/Mara Voss.md",
              "---\ntype: pc\n---\n")
        write(vault, "_Templates/PC.md", "---\ntype: pc\n---\n")
        return vault

    def test_active_pcs_excludes_story_and_dead(self):
        with tempfile.TemporaryDirectory() as d:
            rels = [rel for rel, _fm in vl.active_pcs(self.build(d))]
        self.assertEqual(rels, ["Characters/Katherine Winslow.md",
                                "Characters/Mara Voss.md"])

    def test_active_pc_names(self):
        with tempfile.TemporaryDirectory() as d:
            names = vl.active_pc_names(self.build(d))
        self.assertEqual(names, {"Katherine Winslow", "Katherine", "Winslow",
                                 "Kate", "Mara Voss", "Mara", "Voss"})

    def test_vault_files_skips_templates_and_hidden(self):
        with tempfile.TemporaryDirectory() as d:
            vault = self.build(d)
            write(vault, ".obsidian/plugins/x.md", "hidden\n")
            rels = [rel for rel, _text in vl.vault_files(vault)]
        self.assertNotIn("_Templates/PC.md", rels)
        self.assertFalse(any(r.startswith(".obsidian") for r in rels))

    def test_vault_files_folder_filter(self):
        with tempfile.TemporaryDirectory() as d:
            vault = self.build(d)
            write(vault, "Locations/Bay.md", "---\ntype: location\n---\n")
            rels = [rel for rel, _t in vl.vault_files(vault, "Locations")]
        self.assertEqual(rels, ["Locations/Bay.md"])


class TextHelperTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(vl.normalize("E_Note"), "e note")
        self.assertEqual(vl.normalize("  A   B "), "a b")

    def test_link_target(self):
        self.assertEqual(vl.link_target("Chapters/Session 07|the bay"),
                         "session 07")
        self.assertEqual(vl.link_target("Note#heading"), "note")
        self.assertEqual(vl.link_target("Folder/Note.md"), "note")

    def test_wikilink_target(self):
        self.assertEqual(vl.wikilink_target("[[Session 07|the bay]]"),
                         "Session 07")
        self.assertEqual(vl.wikilink_target(["[Session 07]"]), "Session 07")
        self.assertEqual(vl.wikilink_target(None), "")

    def test_frontmatter_aliases(self):
        self.assertEqual(
            vl.frontmatter_aliases("---\naliases:\n  - Bee\n---\n"), ["Bee"])
        self.assertEqual(
            vl.frontmatter_aliases('---\naliases: [Doc, "The Colonel"]\n---\n'),
            ["Doc", "The Colonel"])
        self.assertEqual(vl.frontmatter_aliases("# no frontmatter\n"), [])

    def test_raw_frontmatter_and_body_of(self):
        text = "---\ntype: npc\n---\n\n# Body\n\ntext\n"
        self.assertEqual(vl.raw_frontmatter(text), "type: npc")
        self.assertEqual(vl.body_of(text), "# Body\n\ntext")
        self.assertEqual(vl.body_of("no frontmatter\n"), "no frontmatter")

    def test_section(self):
        text = "# T\n\n## Current Status\n\nAlive.\n\n## Other\n\nx\n"
        self.assertEqual(vl.section(text, "Current Status"), "Alive.")
        self.assertIsNone(vl.section(text, "Missing"))

    def test_iter_body_lines_skips_frontmatter(self):
        text = "---\ntype: npc\n---\nbody one\nbody two\n"
        self.assertEqual(list(vl.iter_body_lines(text)),
                         [(4, "body one"), (5, "body two")])

    def test_parse_session_number(self):
        self.assertEqual(vl.parse_session_number("Chapter 3, Session 7"), 7)
        self.assertEqual(vl.parse_session_number("session-03"), 3)
        self.assertIsNone(vl.parse_session_number("Reconstructed 2026-07-04"))
        self.assertIsNone(vl.parse_session_number(None))

    def test_chapter_of_and_key(self):
        self.assertEqual(
            vl.chapter_of("x.md", {"chapter": "[[Chapters/Chapter 4 - X]]"}),
            "Chapter 4 - X")
        self.assertEqual(
            vl.chapter_of("Chapters/Chapter 4 - X/Session.md", {}),
            "Chapter 4 - X")
        self.assertIsNone(vl.chapter_of("flat.md", {}))
        self.assertEqual(vl.chapter_key("x.md", {"chapter": "[[Ch 4]]"}),
                         "ch 4")


class PublishModeTests(unittest.TestCase):
    """`publish_mode` mirrors processor.js `publishMode` — the gate the
    publish-safety checks consult before calling anything published."""

    def test_absent_publishes_everything(self):
        self.assertEqual(vl.publish_mode({}), "all")
        self.assertEqual(vl.publish_mode(None), "all")

    def test_the_explicit_opt_outs(self):
        for raw in (False, "false", "none"):
            with self.subTest(raw=raw):
                self.assertEqual(vl.publish_mode({"publish": raw}), "none")

    def test_stub(self):
        self.assertEqual(vl.publish_mode({"publish": "stub"}), "stub")

    def test_anything_unrecognised_still_publishes(self):
        # A typo must not silently unpublish a page, and must not silently
        # convince a leak check that a page is safe.
        for raw in ("true", True, "yes", "publish", "", [], "NONE", "False"):
            with self.subTest(raw=raw):
                self.assertEqual(vl.publish_mode({"publish": raw}), "all")

    def test_it_reads_what_the_frontmatter_parser_actually_yields(self):
        # `publish: false` reaches us as the string "false", not a bool.
        fm = vl.extract_frontmatter(
            "---\ntype: npc\npublish: false\n---\n\nbody\n")
        self.assertEqual(vl.publish_mode(fm), "none")
        fm = vl.extract_frontmatter(
            "---\ntype: npc\npublish: stub\n"
            'publish_include_sections: ["Background"]\n---\n\nbody\n')
        self.assertEqual(vl.publish_mode(fm), "stub")
        self.assertEqual(fm["publish_include_sections"], ["Background"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

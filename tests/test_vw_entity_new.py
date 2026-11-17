#!/usr/bin/env python3
"""vault_write.py entity-new: an entity note filled from its template (#676).

The writer sends the fields to set, the ties and the body's sections; the
command writes the template's frontmatter, puts the sections in the
template's order with the GM's under the fence, and writes `## Related` and
`### Hidden Ties` from the ties, so the two cannot drift."""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import schema_rules  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402

TEMPLATES = REPO / "skills" / "shared" / "templates"


def make_vault(case, files=None):
    vault = Path(tempfile.mkdtemp(prefix="vw-entity-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    files = dict(files or {})
    for shared, name in schema_rules.TEMPLATE_NAMES.items():
        if (TEMPLATES / shared).is_file():
            files.setdefault(f"_Templates/{name}",
                             (TEMPLATES / shared).read_text(encoding="utf-8"))
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def note(etype, aliases=()):
    return ("---\ntype: " + etype + "\ncanon_status: DRAFT\naliases: ["
            + ", ".join(f'"{a}"' for a in aliases) + "]\n---\n\nBody.\n")


def run(vault, *argv, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", out):
        try:
            code = vw.main([str(vault), *argv], stdin=stdin)
        except SystemExit as e:
            code = e.code
    return code, out.getvalue()


def new(vault, etype, name, stdin, *extra):
    return run(vault, "entity-new", "--type", etype, "--name", name, *extra,
               stdin=stdin)


VOSS = """---
aliases: ["Voss"]
occupation: "Packet captain"   # as he tells it
relationships:
  - target: "[[Marrow Light]]"
    type: visited
    tone: tense
    strength: 6
    description: "Carries the mail out to it each week"
  - target: "[[The Reefwardens]]"
    type: defected_from
    tone: resentful
    strength: 9
    description: "Was struck from its rolls: ten years ago"
    gm_only: true
  - target: "[[Pilot Hale]]"
    type: knows
    description: "His old pilot"
    gm_only: true
  - target: "[[Nan Tolliver]]"
    type: knows
---

## Appearance & Manner

Lean, weathered and never without a pipe.

## Rumours

They say he never sleeps ashore.

## Overview

Master of the mail packet.

### Wants

To see the light go dark.

### A Private Heading

Mine.

### Secrets

He wrecked the Arden.
"""

WORLD = {
    "Locations/Marrow Light.md": note("location"),
    "Factions & Organizations/The Reefwardens.md": note("faction"),
    "Characters/NPCs/Pilot Hale.md": note("npc"),
    "Characters/NPCs/Nan Tolliver.md": note("npc"),
}


class EntityNewTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, WORLD)

    def read(self, rel):
        return (self.vault / rel).read_text(encoding="utf-8")

    def test_dry_run_writes_nothing(self):
        code, out = new(self.vault, "npc", "Captain Imre Voss", VOSS)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE\tCharacters/NPCs/Captain Imre Voss.md", out)
        self.assertFalse(
            (self.vault / "Characters/NPCs/Captain Imre Voss.md").exists())

    def test_the_frontmatter_is_the_template_with_the_given_fields_set(self):
        code, out = new(self.vault, "npc", "Captain Imre Voss", VOSS,
                        "--date", "2026-11-16", "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Captain Imre Voss.md")
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["name"], "Captain Imre Voss")
        self.assertEqual(fm["type"], "npc")
        self.assertEqual(fm["canon_status"], "DRAFT")
        self.assertEqual(fm["aliases"], ["Voss"])
        self.assertEqual(fm["occupation"], "Packet captain")
        self.assertEqual(fm["status"], "alive")          # the template's own
        self.assertEqual(fm["lastUpdated"], "2026-11-16")
        # The template's order is kept, and its example tie is gone.
        keys = [ln.split(":")[0] for ln in vl.raw_frontmatter(text).splitlines()
                if ln[:1].isalpha()]
        template = [ln.split(":")[0] for ln in vw.template_frontmatter(
            (TEMPLATES / "npc.md").read_text(encoding="utf-8"))
            if ln[:1].isalpha()]
        self.assertEqual(keys, template)
        self.assertNotIn('target: "[[]]"', text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_ties_are_written_whole_and_a_two_way_type_is_marked(self):
        code, out = new(self.vault, "npc", "Captain Imre Voss", VOSS, "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Captain Imre Voss.md")
        self.assertIn('''  - target: "[[The Reefwardens]]"
    type: defected_from
    tone: resentful
    strength: 9
    bidirectional: false
    description: "Was struck from its rolls: ten years ago"
    gm_only: true
''', text)
        # `knows` runs both ways: written so, and the row says it was set.
        self.assertIn('''  - target: "[[Nan Tolliver]]"
    type: knows
    tone: neutral
    strength: 5
    bidirectional: true
    description: ""
''', text)
        self.assertIn("knows [[Nan Tolliver]] runs both ways", out)
        self.assertIn("4 ties (2 under Hidden Ties)", out)

    def test_the_body_is_in_template_order_with_related_from_the_ties(self):
        code, out = new(self.vault, "npc", "Captain Imre Voss", VOSS, "--write")
        self.assertEqual(code, 0, out)
        body = self.read("Characters/NPCs/Captain Imre Voss.md").split(
            "\n---\n", 1)[1]
        self.assertEqual(body, """
## Overview

Master of the mail packet.

## Appearance & Manner

Lean, weathered and never without a pipe.

## Rumours

They say he never sleeps ashore.

## Related

- **People:** [[Nan Tolliver]]
- **Places:** [[Marrow Light]] — Carries the mail out to it each week

<!-- gm-only -->

## GM Notes

### Wants

To see the light go dark.

### A Private Heading

Mine.

### Hidden Ties

- [[The Reefwardens]] — Was struck from its rolls: ten years ago
- [[Pilot Hale]] — His old pilot

### Secrets

He wrecked the Arden.

<!-- /gm-only -->
""")

    def test_no_prompt_text_or_empty_heading_from_the_template(self):
        code, out = new(self.vault, "npc", "Tom Garrow",
                        "## Overview\n\nKeeps the quay.\n", "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Tom Garrow.md")
        self.assertNotIn("{", text.split("\n---\n", 1)[1])
        self.assertNotIn("## History", text)
        self.assertNotIn("## Related", text)
        self.assertNotIn("### Hidden Ties", text)
        self.assertIn("relationships: []", text)
        self.assertTrue(text.endswith(
            "<!-- gm-only -->\n\n## GM Notes\n\n<!-- /gm-only -->\n"))

    def test_a_note_with_no_body_is_a_stub_of_the_template(self):
        code, out = new(self.vault, "location", "The Causeway",
                        "---\ncanon_status: STUB\n---\n", "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Locations/The Causeway.md")
        self.assertEqual(vl.extract_frontmatter(text)["canon_status"], "STUB")
        self.assertEqual(text.split("\n---\n", 1)[1],
                         "\n<!-- gm-only -->\n\n## GM Notes\n\n"
                         "<!-- /gm-only -->\n")

    def test_gm_notes_text_and_sections_written_under_its_heading(self):
        code, out = new(self.vault, "npc", "Widow Ames", (
            "## Overview\n\nKeeps the inn.\n\n## GM Notes\n\n"
            "She knows who lit the false light.\n\n### Guilt\n\nIf pushed.\n\n"
            "### Wants\n\nAbsolution.\n"), "--write")
        self.assertEqual(code, 0, out)
        self.assertTrue(self.read("Characters/NPCs/Widow Ames.md").endswith(
            "<!-- gm-only -->\n\n## GM Notes\n\n"
            "She knows who lit the false light.\n\n### Guilt\n\nIf pushed.\n\n"
            "### Wants\n\nAbsolution.\n\n<!-- /gm-only -->\n"))

    def test_a_template_without_a_fence_or_related_still_gets_both_lists(self):
        code, out = new(self.vault, "faction", "The Lamp Guild", (
            "---\nrelationships:\n"
            '  - target: "[[Marrow Light]]"\n    type: headquartered_at\n'
            '    description: "Its house"\n'
            '  - target: "[[Pilot Hale]]"\n    type: serves\n'
            "    gm_only: yes\n---\n\n## Overview\n\nLamp makers.\n"), "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read("Factions & Organizations/The Lamp Guild.md").split(
                "\n---\n", 1)[1],
            "\n## Overview\n\nLamp makers.\n\n## Related\n\n"
            "- **Places:** [[Marrow Light]] — Its house\n\n"
            "## GM Notes\n\n### Hidden Ties\n\n- [[Pilot Hale]]\n")

    def test_a_place_s_parent_and_its_part_of_tie_are_kept_as_a_pair(self):
        code, out = new(self.vault, "location", "The Lamp Room", (
            '---\nparent_location: "[[Marrow Light]]"\n---\n\n'
            "## Description\n\nBright.\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Locations/The Lamp Room.md")
        self.assertIn('  - target: "[[Marrow Light]]"\n    type: part_of\n',
                      text)
        self.assertIn("- **Places:** [[Marrow Light]]\n", text)
        self.assertIn("its part_of tie added", out)
        # The other half: a part_of tie sets the field.
        code, out = new(self.vault, "location", "The Oil Store", (
            "---\nrelationships:\n"
            '  - target: "[[Marrow Light]]"\n    type: part_of\n---\n'),
            "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.read("Locations/The Oil Store.md"))
        self.assertEqual(vl.wikilink_target(fm["parent_location"]),
                         "Marrow Light")
        self.assertIn("parent_location set", out)
        # The two disagreeing is the writer's to settle: said, not guessed.
        code, out = new(self.vault, "location", "The Stair", (
            '---\nparent_location: "[[The Causeway]]"\nrelationships:\n'
            '  - target: "[[Marrow Light]]"\n    type: part_of\n---\n'),
            "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("one of the two is wrong", out)
        text = self.read("Locations/The Stair.md")
        self.assertEqual(vl.wikilink_target(
            vl.extract_frontmatter(text)["parent_location"]), "The Causeway")
        self.assertEqual(text.count("type: part_of"), 1)
        self.assertIn('  - target: "[[Marrow Light]]"\n    type: part_of', text)

    def test_a_tie_to_a_note_not_yet_made_needs_its_type(self):
        tie = ('---\nrelationships:\n  - target: "[[Kelder]]"\n'
               "    type: visited\n{extra}---\n\n## Overview\n\nA boy.\n")
        code, out = new(self.vault, "npc", "Jem Pike", tie.format(extra=""),
                        "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("target_type", out)
        self.assertFalse((self.vault / "Characters/NPCs/Jem Pike.md").exists())
        code, out = new(self.vault, "npc", "Jem Pike",
                        tie.format(extra="    target_type: location\n"),
                        "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Jem Pike.md")
        self.assertIn("- **Places:** [[Kelder]]\n", text)
        self.assertNotIn("target_type", text)
        # A hidden tie has no group, so it needs none.
        code, out = new(self.vault, "npc", "Bess Ward", tie.format(
            extra="    gm_only: true\n"), "--write")
        self.assertEqual(code, 0, out)

    def test_an_alias_names_the_target_and_a_file_name_beats_an_alias(self):
        (self.vault / "Locations/The Rest.md").write_text(
            note("location"), encoding="utf-8")
        (self.vault / "Characters/NPCs/Old Hand.md").write_text(
            note("npc", ["The Rest"]), encoding="utf-8")
        (self.vault / "Items & Artifacts").mkdir()
        (self.vault / "Items & Artifacts/The Glass.md").write_text(
            note("item", ["Brass Spyglass"]), encoding="utf-8")
        code, out = new(self.vault, "npc", "Orrick", (
            '---\nrelationships:\n  - target: "[[The Rest]]"\n'
            '    type: visited\n  - target: "[[Brass Spyglass]]"\n'
            "    type: wields\n---\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Orrick.md")
        self.assertIn("- **Places:** [[The Rest]]\n", text)
        self.assertIn("- **Things:** [[Brass Spyglass]]\n", text)

    # ---- nothing the GM hid may be published by where it was written ----

    def gm_side(self, rel):
        """(what the players' side of the note holds, the GM's side)."""
        body = self.read(rel).split("\n---\n", 1)[1]
        at = body.index("## GM Notes")
        return body[:at], body[at:]

    def test_every_h3_section_goes_under_gm_notes_wherever_it_is_written(self):
        # A ### the template does not know, written after a players'
        # section, must not ride along inside it onto the site.
        for etype, folder, first in (
                ("npc", "Characters/NPCs", "## Overview"),
                ("faction", "Factions & Organizations", "## Overview"),
                ("heritage", "Heritages", "## Biology")):
            with self.subTest(etype=etype):
                name = f"Subject {etype}"
                code, out = new(self.vault, etype, name, (
                    f"{first}\n\nPlain to see.\n\n### The Truth\n\n"
                    "QUOKKA-ONE.\n\n#### Detail\n\nQUOKKA-TWO.\n\n"
                    "### Secrets\n\nQUOKKA-THREE.\n\n## Campaign Log\n\n"
                    "- seen once\n\n### After The Log\n\nQUOKKA-FOUR.\n"),
                    "--write")
                self.assertEqual(code, 0, out)
                shown, kept = self.gm_side(f"{folder}/{name}.md")
                self.assertNotIn("QUOKKA", shown)
                for word in ("ONE", "TWO", "THREE", "FOUR"):
                    self.assertIn(f"QUOKKA-{word}", kept)
                self.assertIn("Plain to see.", shown)
                self.assertIn("- seen once", shown)

    def test_a_gm_section_written_as_h2_is_refused(self):
        for title in ("Secrets", "Wants", "secrets"):
            with self.subTest(title=title):
                code, out = new(self.vault, "npc", "Jem", (
                    f"## Overview\n\nA boy.\n\n## {title}\n\nHe did it.\n"),
                    "--write")
                self.assertEqual(code, 1, out)
                self.assertIn("would be published", out)
                self.assertFalse((self.vault / "Characters/NPCs/Jem.md").exists())

    def test_a_h2_the_vault_s_template_keeps_inside_its_fence_stays_there(self):
        path = self.vault / "_Templates" / "_Template_NPC.md"
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace(
            "<!-- /gm-only -->", "## Dossier\n\n{the file}\n\n"
            "<!-- /gm-only -->", 1), encoding="utf-8")
        code, out = new(self.vault, "npc", "Jem", (
            "## Dossier\n\nQUOKKA-FILE.\n\n## Overview\n\nA boy.\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Jem.md")
        self.assertLess(text.index("<!-- gm-only -->"), text.index("## Dossier"))
        self.assertLess(text.index("QUOKKA-FILE"), text.index("<!-- /gm-only -->"))
        self.assertLess(text.index("## Overview"), text.index("<!-- gm-only -->"))

    def test_a_vault_template_that_renames_gm_notes_still_hides_its_h3s(self):
        # Who sees a section is read from the template's fence, not from
        # the words "GM Notes".
        path = self.vault / "_Templates" / "_Template_NPC.md"
        path.write_text(path.read_text(encoding="utf-8").replace(
            "## GM Notes", "## Keeper Notes", 1), encoding="utf-8")
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n### Secrets\n\nQUOKKA-ONE.\n\n"
            "### Wants\n\nQUOKKA-TWO.\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Jem.md")
        fence = text.index("<!-- gm-only -->")
        self.assertLess(fence, text.index("QUOKKA-ONE"))
        self.assertLess(fence, text.index("QUOKKA-TWO"))
        self.assertLess(text.index("A boy."), fence)

    def test_an_h3_under_a_h2_the_template_fences_is_the_gm_s(self):
        path = self.vault / "_Templates" / "_Template_Creature.md"
        path.write_text(path.read_text(encoding="utf-8").replace(
            "<!-- /gm-only -->", "## Keeper Stats\n\n### Weak Points\n\n"
            "{what hurts it}\n\n<!-- /gm-only -->", 1), encoding="utf-8")
        code, out = new(self.vault, "creature", "The Drowned Bell", (
            "## What the PCs Know\n\nA beast.\n\n### Weak Points\n\n"
            "QUOKKA silver.\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Creatures/The Drowned Bell.md")
        self.assertLess(text.index("<!-- gm-only -->"), text.index("QUOKKA"))

    def test_a_section_the_site_could_cut_differently_is_refused(self):
        cases = {
            "an open code fence": ("## Overview\n\nA boy.\n\n```\nhis ledger\n\n"
                                   "### Secrets\n\nQUOKKA.\n",
                                   "a code fence opened in it is never closed"),
            "an open tilde fence": ("## Overview\n\n~~~\nledger\n\n### Secrets\n\nQ.\n",
                                    "a code fence opened in it is never closed"),
            "an indented heading": ("## Overview\n\nA boy.\n\n ### Secrets\n\nQ.\n",
                                    "at the start of its line"),
            "a quoted heading": ("## Overview\n\nA boy.\n\n> ### Secrets\n> Q.\n",
                                 "at the start of its line"),
            "an underlined heading": ("## Overview\n\nA boy.\n\nSecrets\n-------\n\nQ.\n",
                                      "underlined into a heading"),
            "a GM name with closing hashes": ("## Overview\n\nA.\n\n## Secrets ##\n\nQ.\n",
                                              "would be published"),
            "a GM name with a colon": ("## Overview\n\nA.\n\n## Secrets:\n\nQ.\n",
                                       "would be published"),
            "a GM name with a note": ("## Overview\n\nA.\n\n## Secrets (the truth)\n\nQ.\n",
                                      "would be published"),
            "Related with closing hashes": ("## Related ##\n\n- mine\n",
                                            "written from relationships"),
        }
        for what, (stdin, said) in cases.items():
            with self.subTest(what=what):
                code, out = new(self.vault, "npc", "Jem", stdin, "--write")
                self.assertEqual(code, 1, out)
                self.assertIn(said, out)
                self.assertFalse((self.vault / "Characters/NPCs/Jem.md").exists())
        # A closed fence, a rule after a blank line and a table are text.
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n```\n### not a heading\n```\n\n---\n\n"
            "| a | b |\n|---|---|\n| 1 | 2 |\n\n### Secrets\n\nQUOKKA.\n"),
            "--write")
        self.assertEqual(code, 0, out)
        shown, kept = self.gm_side("Characters/NPCs/Jem.md")
        self.assertIn("### not a heading", shown)
        self.assertIn("QUOKKA", kept)
        self.assertNotIn("QUOKKA", shown)

    def test_gm_notes_written_with_closing_hashes_is_still_gm_notes(self):
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n## GM Notes ##\n\nQUOKKA.\n"), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Jem.md")
        self.assertEqual(text.count("## GM Notes"), 1)
        self.assertLess(text.index("<!-- gm-only -->"), text.index("QUOKKA"))

    def test_what_the_players_will_see_beyond_the_template_is_said(self):
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n#### Aside\n\nSeen.\n\n"
            "## Rumours\n\nHeard.\n\n### Wants\n\n#### Deeper\n\nKept.\n"),
            "--write")
        self.assertEqual(code, 0, out)
        warned = [ln for ln in out.splitlines() if ln.startswith("WARNING")]
        self.assertEqual(len(warned), 2, out)
        self.assertIn("'#### Aside' stays inside '## Overview': players will "
                      "see it", warned[0])
        self.assertIn("'## Rumours': new section", warned[1])
        shown, kept = self.gm_side("Characters/NPCs/Jem.md")
        self.assertIn("#### Aside", shown)
        self.assertIn("#### Deeper", kept)

    def test_a_hidden_part_of_tie_never_fills_the_published_field(self):
        hidden = ("---\n{field}relationships:\n"
                  '  - target: "[[Marrow Light]]"\n    type: part_of\n'
                  "    gm_only: true\n---\n")
        code, out = new(self.vault, "location", "The Old Mill",
                        hidden.format(field=""), "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Locations/The Old Mill.md")
        self.assertEqual(vl.extract_frontmatter(text)["parent_location"], "")
        self.assertNotIn("parent_location set", out)
        self.assertNotIn("## Related", text)
        self.assertIn("### Hidden Ties\n\n- [[Marrow Light]]", text)
        # Given both, the field would publish what the tie hides: said so,
        # and no second, public tie is added.
        code, out = new(self.vault, "location", "The Old Kiln", hidden.format(
            field='parent_location: "[[Marrow Light]]"\n'), "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("drop the field to keep it hidden", out)
        text = self.read("Locations/The Old Kiln.md")
        self.assertEqual(text.count("type: part_of"), 1)
        self.assertNotIn("## Related", text)

    def test_a_template_s_own_parent_is_paired_like_a_given_one(self):
        # A vault whose location template names a parent for every place.
        shared = (TEMPLATES / "location.md").read_text(encoding="utf-8")
        own = shared.replace('parent_location: ""',
                             'parent_location: "[[Marrow Light]]"', 1)
        self.assertNotEqual(own, shared)
        (self.vault / "_Templates" / schema_rules.TEMPLATE_NAMES[
            "location.md"]).write_text(own, encoding="utf-8")
        code, out = new(self.vault, "location", "The Lamp Room",
                        "## Description\n\nBright.\n", "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Locations/The Lamp Room.md")
        self.assertIn('  - target: "[[Marrow Light]]"\n    type: part_of\n',
                      text)
        self.assertIn("its part_of tie added", out)
        # The template's field is published too: a hidden tie to the same
        # place is said, not passed over.
        code, out = new(self.vault, "location", "The Old Kiln", (
            "---\nrelationships:\n"
            '  - target: "[[Marrow Light]]"\n    type: part_of\n'
            "    gm_only: true\n---\n"), "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("drop the field to keep it hidden", out)
        self.assertEqual(self.read("Locations/The Old Kiln.md").count(
            "type: part_of"), 1)

    def test_a_tie_that_would_close_the_fence_is_refused(self):
        tie = ("---\nrelationships:\n"
               '  - target: "[[Pilot Hale]]"\n    type: knows\n'
               '    description: "{said}"\n    gm_only: {hidden}\n---\n\n'
               "### Secrets\n\nQUOKKA.\n")
        for said, hidden in (("Old friends <!-- /gm-only --> no more", "true"),
                             ("Old friends --> no more", "true"),
                             ("Old friends <!-- gm-only --> no more", "false"),
                             ("Old friends <!-- aside", "false")):
            with self.subTest(said=said):
                code, out = new(self.vault, "npc", "Jem",
                                tie.format(said=said, hidden=hidden), "--write")
                self.assertEqual(code, 1, out)
                self.assertIn("relationships[1]", out)
                self.assertIn("<!--", out)
                self.assertFalse((self.vault / "Characters/NPCs/Jem.md"
                                  ).exists())
        code, out = new(self.vault, "npc", "Jem", (
            "---\nrelationships:\n"
            '  - target: "[[Pilot <!-- /gm-only --> Hale]]"\n'
            "    type: knows\n    target_type: npc\n    gm_only: true\n---\n"),
            "--write")
        self.assertEqual(code, 1, out)
        # A plain arrow is no marker.
        code, out = new(self.vault, "npc", "Jem", tie.format(
            said="Hale -> Jem, a debt", hidden="true"), "--write")
        self.assertEqual(code, 0, out)

    def test_a_hidden_flag_that_is_not_yes_or_no_is_refused(self):
        tie = ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
               "    type: knows\n    gm_only: {value}\n---\n")
        for value in ("+1", "1.0", "secret", "Y", '"yes."', "tru"):
            with self.subTest(value=value):
                code, out = new(self.vault, "npc", "Jem",
                                tie.format(value=value), "--write")
                self.assertEqual(code, 1, out)
                self.assertIn("gm_only must be true or false", out)
                self.assertFalse((self.vault / "Characters/NPCs/Jem.md").exists())
        for n, value in enumerate(("true", "True", "yes", "on", "1", '"true"')):
            with self.subTest(value=value):
                name = f"Hidden {n}"
                code, out = new(self.vault, "npc", name,
                                tie.format(value=value), "--write")
                self.assertEqual(code, 0, out)
                text = self.read(f"Characters/NPCs/{name}.md")
                self.assertIn("    gm_only: true\n", text)
                self.assertNotIn("## Related", text)
        for n, value in enumerate(("false", "no", "off", "0")):
            with self.subTest(value=value):
                name = f"Shown {n}"
                code, out = new(self.vault, "npc", name,
                                tie.format(value=value), "--write")
                self.assertEqual(code, 0, out)
                text = self.read(f"Characters/NPCs/{name}.md")
                self.assertNotIn("gm_only", text)
                self.assertIn("- **People:** [[Nan Tolliver]]", text)

    def test_a_name_another_note_already_answers_to_is_refused(self):
        (self.vault / "Characters/NPCs/Old Salt.md").write_text(
            "---\ntype: npc\naliases: [\"Salt\"]\ngm_aliases: [\"The Wrecker\"]\n"
            "---\n", encoding="utf-8")
        for name in ("Salt", "salt", "The Wrecker", "Old_Salt", "Pilot_Hale"):
            with self.subTest(name=name):
                code, out = new(self.vault, "npc", name,
                                "## Overview\n\nX.\n", "--write")
                self.assertEqual(code, 1, out)
                self.assertIn("alias", out)
                self.assertFalse(
                    (self.vault / f"Characters/NPCs/{name}.md").exists())

    def test_a_marker_that_would_hide_later_sections_is_refused(self):
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n<!-- gm-only -->\n\n## GM Notes\n\n"
            "X.\n\n<!-- /gm-only -->\n\n## History\n\nBorn poor.\n"), "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("must open and close inside one section", out)
        # An aside whole inside one section is the writer's own, and kept.
        code, out = new(self.vault, "npc", "Jem", (
            "## Overview\n\nA boy.\n\n<!-- gm-only -->\nQUOKKA.\n"
            "<!-- /gm-only -->\n\nStill a boy.\n\n## History\n\nBorn poor.\n"),
            "--write")
        self.assertEqual(code, 0, out)
        text = self.read("Characters/NPCs/Jem.md")
        self.assertIn("<!-- gm-only -->\nQUOKKA.\n<!-- /gm-only -->\n\n"
                      "Still a boy.\n\n## History\n\nBorn poor.", text)

    def test_what_cannot_be_written_is_refused_and_nothing_written(self):
        cases = {
            "a Related section": ("## Related\n\n- mine\n",
                                  "written from relationships"),
            "a Hidden Ties section": ("## Overview\n\nX.\n\n### Hidden Ties\n\n- x\n",
                                      "written from relationships"),
            "a title": ("# Jem\n\n## Overview\n\nX.\n", "takes no # title"),
            "a section twice": ("## Overview\n\nA.\n\n## Overview\n\nB.\n",
                                "twice"),
            "text before a heading": ("Loose text.\n\n## Overview\n\nX.\n",
                                      "must start with a heading"),
            "another type": ("---\ntype: location\n---\n", "--type says"),
            "another name": ('---\nname: "James"\n---\n', "--name says"),
            "a tie with no type": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n---\n',
                                   "needs a target and a type"),
            "a tie to itself": ('---\nrelationships:\n  - target: "[[Jem]]"\n    type: knows\n---\n',
                                "no tie to itself"),
            "an unknown tie key": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
                                   "    type: knows\n    colour: red\n---\n",
                                   "no part of a tie"),
            "a flow-style list": ('---\nrelationships: [{target: "[[Nan Tolliver]]"}]\n---\n',
                                  "`- target:` block"),
            "a word for a strength": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
                                      "    type: knows\n    strength: strong\n---\n",
                                      "strength must be a number"),
            "a strength off the scale": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
                                         "    type: knows\n    strength: 42\n---\n",
                                         "strength must be a number, 1 to 10"),
            "a target type that is no type": ('---\nrelationships:\n  - target: "[[Kelder]]"\n'
                                              "    type: visited\n    target_type: place\n---\n",
                                              "is no note type"),
            "a description YAML would cut": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
                                             "    type: knows\n    description: owes him #3 debts: all paid\n---\n",
                                             "put the description in quotes"),
            "a half-quoted description": ('---\nrelationships:\n  - target: "[[Nan Tolliver]]"\n'
                                          '    type: knows\n    description: "Joined" in spring\n---\n',
                                          "is not one quoted value"),
            "a field value YAML would not read": ("---\noccupation: Packet captain: retired\n---\n",
                                                  "put the value in quotes"),
        }
        for what, (stdin, said) in cases.items():
            with self.subTest(what=what):
                code, out = new(self.vault, "npc", "Jem", stdin, "--write")
                self.assertEqual(code, 1, out)
                self.assertIn(said, out)
                self.assertFalse((self.vault / "Characters/NPCs/Jem.md").exists())

    def test_arguments_that_cannot_stand_are_refused(self):
        for argv, said in (
                (("pc", "Jem"), "--type"),
                (("monster", "Jem"), "--type"),
                (("npc", "Jem/Pike"), "cannot be a file name"),
                (("npc", "Pilot Hale"), "exists"),
                (("npc", "pilot hale"), "exists")):
            with self.subTest(argv=argv):
                code, out = new(self.vault, *argv, "## Overview\n\nX.\n",
                                "--write")
                self.assertEqual(code, 1, out)
                self.assertIn(said, out)
        code, out = new(self.vault, "npc", "Jem", "## Overview\n\nX.\n",
                        "--date", "16 Nov", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("--date", out)

    def test_a_field_the_template_lacks_is_kept_with_a_warning(self):
        code, out = new(self.vault, "npc", "Jem", (
            '---\nhome_town: "Kelder"\ntags:\n  - deckhand\n  - boy\n---\n'),
            "--folder", "Crew", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("home_town is not a field of the npc template", out)
        fm = vl.extract_frontmatter(
            self.read("Characters/NPCs/Crew/Jem.md"))
        self.assertEqual(fm["home_town"], "Kelder")
        self.assertEqual(fm["tags"], ["deckhand", "boy"])

    def test_the_vault_s_own_template_is_the_one_used(self):
        path = self.vault / "_Templates" / "_Template_NPC.md"
        text = path.read_text(encoding="utf-8")
        text = text.replace('nationality: ""', 'nationality: ""\nhouse: ""', 1)
        text = text.replace("### Playing Them", "### Stats\n\n{block}\n\n"
                            "### Playing Them", 1)
        path.write_text(text, encoding="utf-8")
        code, out = new(self.vault, "npc", "Jem", (
            '---\nhouse: "Pike"\n---\n\n## Overview\n\nX.\n\n'
            "### Wants\n\nA.\n\n### Stats\n\nB.\n"), "--write")
        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        text = self.read("Characters/NPCs/Jem.md")
        self.assertEqual(vl.extract_frontmatter(text)["house"], "Pike")
        self.assertLess(text.index("### Stats"), text.index("### Wants"))


BATCH = """=== entity-new --type npc --name "Captain Imre Voss"
---
relationships:
  - target: "[[The Sea Stair]]"
    type: visited
  - target: "[[The Lamp Guild]]"
    type: member_of
---

## Overview

A captain.
=== entity-new --type location --name "The Sea Stair"
## Description

Wet.
=== entity-new --type faction --name "The Lamp Guild"
---
relationships:
  - target: "[[Captain Imre Voss]]"
    type: employs
---
"""


class EntityNewBatchTests(unittest.TestCase):
    def test_a_tie_may_point_at_a_note_a_later_block_makes(self):
        vault = make_vault(self)
        (vault / "batch.txt").write_text(BATCH, encoding="utf-8")
        code, out = run(vault, "batch", str(vault / "batch.txt"), "--write")
        self.assertEqual(code, 0, out)
        gilt = (vault / "Characters/NPCs/Captain Imre Voss.md").read_text(
            encoding="utf-8")
        self.assertIn("- **Places:** [[The Sea Stair]]\n"
                      "- **Groups:** [[The Lamp Guild]]\n", gilt)
        guild = (vault / "Factions & Organizations/The Lamp Guild.md"
                 ).read_text(encoding="utf-8")
        self.assertIn("- **People:** [[Captain Imre Voss]]\n", guild)

    def test_a_later_block_s_type_is_read_however_its_flags_are_written(self):
        vault = make_vault(self)
        (vault / "batch.txt").write_text(
            BATCH.replace('--type location --name "The Sea Stair"',
                          '--name="The Sea Stair" --type=location')
            .replace('--type faction --name "The Lamp Guild"',
                     '--folder Guilds --type faction --name "The Lamp Guild"'),
            encoding="utf-8")
        code, out = run(vault, "batch", str(vault / "batch.txt"), "--write")
        self.assertEqual(code, 0, out)
        voss = (vault / "Characters/NPCs/Captain Imre Voss.md").read_text(
            encoding="utf-8")
        self.assertIn("- **Places:** [[The Sea Stair]]\n"
                      "- **Groups:** [[The Lamp Guild]]\n", voss)

    def test_a_block_whose_flags_cannot_be_read_is_said_once(self):
        vault = make_vault(self)
        (vault / "batch.txt").write_text(
            BATCH.replace('--type location --name "The Sea Stair"',
                          '--type location'), encoding="utf-8")
        code, out = run(vault, "batch", str(vault / "batch.txt"))
        self.assertEqual(code, 1, out)
        self.assertIn("--name", out)
        self.assertNotIn("Traceback", out)

    def test_a_block_left_out_does_not_count_as_coming(self):
        vault = make_vault(self)
        (vault / "batch.txt").write_text(BATCH, encoding="utf-8")
        code, out = run(vault, "batch", str(vault / "batch.txt"), "--only", "1")
        self.assertEqual(code, 1, out)
        self.assertIn("target_type", out)


if __name__ == "__main__":
    unittest.main()

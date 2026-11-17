#!/usr/bin/env python3
"""vault_write.py promote-plan: a Midwife draft filed as a vault plan (#464).

The plan's text is never changed: only the frontmatter is written. Who is in
the plan (participants, locations) is what the caller names and what the body
links to, never a name matched in its prose; the campaign link is the vault's
own Campaign Overview (#677)."""

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

PLAN_TEMPLATE = (REPO / "skills" / "shared" / "templates" / "plan.md"
                 ).read_text(encoding="utf-8")
CHAPTER = "Chapters/Chapter 4 - Calcutta"
DRAFT = "_midwife/calcutta/temple-approach.md"
TARGET = f"{CHAPTER}/Planning/Chapter_4_Temple_Approach.md"

# Odd on purpose: CRLF lines, trailing spaces, a tab, no final newline, a
# heading the template does not have. Every byte must survive.
BODY = ("# The Temple Approach\r\n\r\n"
        "Charles Ashworth  rides out at dawn; the Magistrate distrusts \t"
        "the [[Baranagar]] boatmen.\r\n\r\n"
        "## Beats\r\n\r\n"
        "- The Thuggee watch the Temple of Mahakali.\r\n"
        "- The Colonel arrives late. The Kali Idol is gone.\r\n"
        "- A Ghost Sketch lingers by the Megaliths.\r\n"
        "- meg, lower-case, is not a name.")


def entity(etype, aliases=None):
    lines = ["---", f"type: {etype}", "canon_status: DRAFT"]
    if aliases is not None:
        lines.append("aliases: [" + ", ".join(f'"{a}"' for a in aliases)
                     + "]")
    return "\n".join(lines + ["---", "", "Body.", ""])


VAULT_FILES = {
    "_Templates/_Template_Plan.md": PLAN_TEMPLATE,
    f"{CHAPTER}/Chapter 4 - Calcutta.md": "---\ntype: chapter\n---\n",
    "Characters/NPCs/Charles_Ashworth.md": entity("npc", ["The Magistrate"]),
    "Characters/NPCs/Margaret_Cavendish.md": entity("npc", ["Meg"]),
    "Characters/NPCs/Colonel Hart.md": entity("npc", ["The Colonel"]),
    "Characters/NPCs/Colonel Pyke.md": entity("npc", ["The Colonel"]),
    "Factions & Organizations/Thuggee.md": entity("faction"),
    "Locations/Mandir_Mahakali.md": (
        "---\ntype: location\ncanon_status: DRAFT\naliases:\n"
        "  - Temple of Mahakali\n---\n"),
    "Locations/Baranagar.md": entity("location"),
    "Items & Artifacts/Kali Idol.md": entity("item"),
    "_midwife/calcutta/entity-sketches/Ghost Sketch.md": entity("npc"),
    "_archive/Thuggee Old.md": entity("faction", ["Thuggee"]),
    DRAFT: BODY,
}


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vw-plan-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, *argv):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = vw.main([str(vault), *argv])
    return code, out.getvalue()


def promote(vault, *extra, draft=DRAFT, target=TARGET, plan_type="scene"):
    return run(vault, "promote-plan", draft, "--to", target,
               "--plan-type", plan_type, *extra)


class PromotePlanTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, VAULT_FILES)

    def written(self):
        return (self.vault / TARGET).read_bytes().decode("utf-8")

    def test_a_quote_or_line_break_in_a_link_is_refused_and_nothing_written(self):
        for flag, value in (("--chapter", 'Chapter 1 - "X"'),
                            ("--chapter", "Chapter 1\nplan_type: x"),
                            ("--leads-to", 'A" \nkey: v'),
                            ("--leads-to", "")):
            with self.subTest(flag=flag, value=value):
                code, out = promote(self.vault, "--write", flag, value)
                self.assertEqual(code, 1, out)
                self.assertIn(flag, out)
                self.assertFalse((self.vault / TARGET).exists())

    def test_dry_run_writes_nothing(self):
        code, out = promote(self.vault)
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-CREATE\t{TARGET}", out)
        self.assertFalse((self.vault / TARGET).exists())

    def test_body_is_byte_identical(self):
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        raw = (self.vault / TARGET).read_bytes()
        self.assertTrue(raw.endswith(BODY.encode("utf-8")))
        lines = raw.decode("utf-8").splitlines(keepends=True)
        end, error = vl.frontmatter_span(lines)
        self.assertIsNone(error)
        self.assertEqual("".join(lines[end + 1:]).encode("utf-8"),
                         BODY.encode("utf-8"))
        # The draft stays where it was, as the creative archive.
        self.assertEqual((self.vault / DRAFT).read_bytes(),
                         BODY.encode("utf-8"))

    def test_draft_frontmatter_is_dropped_and_its_body_kept_exactly(self):
        body = "\n# Arc\n\nCharles Ashworth waits.\n\n\n"
        (self.vault / DRAFT).write_bytes(
            ("---\ntopic: arc\ntags: [draft]\n---\n" + body).encode("utf-8"))
        code, out = promote(self.vault, "--write", plan_type="arc")
        self.assertEqual(code, 0, out)
        text = self.written()
        self.assertTrue(text.endswith("---\n" + body), text)
        self.assertNotIn("topic: arc", text)

    def test_a_name_in_the_prose_is_never_matched(self):
        # Who is in a plan is the caller's judgment, not a name match:
        # "Dean", "King" and "Crow" are English words as well as surnames.
        (self.vault / "Characters/NPCs/Captain_King.md").write_text(
            entity("npc"), encoding="utf-8")
        (self.vault / DRAFT).write_text(
            "Charles Ashworth meets the King's German Legion at the "
            "Temple of Mahakali.\n", encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.written())
        self.assertEqual((fm["participants"], fm["locations"]), ([], []))
        self.assertNotIn("PARTICIPANT", out)
        self.assertNotIn("LOCATION", out)
        self.assertNotIn("WARNING", out)

    def fm(self, rel=TARGET):
        return vl.extract_frontmatter(
            (self.vault / rel).read_bytes().decode("utf-8"))

    def test_the_body_s_links_fill_participants_and_locations(self):
        (self.vault / DRAFT).write_text(
            "[[The Magistrate]] and [[Thuggee|the stranglers]] meet at "
            "[[Mandir_Mahakali#The Steps]], then [[Baranagar]].\n"
            "[[The Colonel]] is two men; [[Kali Idol]] is a thing; "
            "[[Ghost Sketch]] is a draft; [[Nobody]] has no note.\n"
            "`[[Colonel Hart]]` is quoted.\n\n"
            "```\n[[Colonel Pyke]]\n```\n", encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        fm = self.fm()
        self.assertEqual(fm["participants"],
                         ["[[Charles_Ashworth]]", "[[Thuggee]]"])
        self.assertEqual(fm["locations"],
                         ["[[Mandir_Mahakali]]", "[[Baranagar]]"])
        self.assertIn("participants 2, locations 2", out)
        # A link two notes share is never guessed and never dropped in
        # silence; a link to no note, or to a thing, says nothing.
        warned = [ln for ln in out.splitlines() if ln.startswith("WARNING")]
        self.assertEqual(len(warned), 1, out)
        self.assertIn("[[The Colonel]]", warned[0])
        self.assertIn("Colonel Hart.md", warned[0])
        self.assertIn("Colonel Pyke.md", warned[0])

    def test_a_shared_body_link_the_caller_settles_is_not_warned_about(self):
        (self.vault / DRAFT).write_text("[[The Colonel]] arrives.\n",
                                        encoding="utf-8")
        code, out = promote(self.vault, "--write", "--participant",
                            "Characters/NPCs/Colonel Pyke")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["participants"], ["[[Colonel Pyke]]"])
        self.assertNotIn("WARNING", out)

    def test_a_file_name_beats_another_note_s_alias_as_a_link_does(self):
        # Obsidian and the site send [[Meg]] to Meg.md, whatever aliases
        # other notes carry.
        (self.vault / "Characters/NPCs/Meg.md").write_text(
            entity("npc"), encoding="utf-8")
        (self.vault / DRAFT).write_text("[[Meg]] and [[meg|her]].\n",
                                        encoding="utf-8")
        code, out = promote(self.vault, "--write", "--participant", "Meg")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["participants"], ["[[Meg]]"])
        self.assertNotIn("WARNING", out)

    def test_a_vault_path_names_one_of_two_notes_that_share_a_name(self):
        (self.vault / "Locations/Old Town/Baranagar.md").parent.mkdir()
        (self.vault / "Locations/Old Town/Baranagar.md").write_text(
            entity("location"), encoding="utf-8")
        (self.vault / "Locations/Old Town/Ghat.md").write_text(
            entity("location"), encoding="utf-8")
        (self.vault / DRAFT).write_text(
            "[[Characters/NPCs/Colonel Hart|Hart]] at "
            "[[Locations/Old Town/Baranagar.md#The Steps]], then "
            "[[Old Town/Ghat]] and [[Charles_Ashworth.md]].\n",
            encoding="utf-8")
        code, out = promote(self.vault, "--write", "--location",
                            "Locations/Baranagar")
        self.assertEqual(code, 0, out)
        fm = self.fm()
        self.assertEqual(fm["participants"],
                         ["[[Colonel Hart]]", "[[Charles_Ashworth]]"])
        # Two notes named Baranagar: each link says which, by its path.
        self.assertEqual(fm["locations"],
                         ["[[Locations/Baranagar]]",
                          "[[Locations/Old Town/Baranagar]]", "[[Ghat]]"])
        self.assertNotIn("WARNING", out)

    def test_the_caller_names_who_and_where_by_name_or_alias(self):
        code, out = promote(self.vault, "--write",
                            "--participant", "The Magistrate",
                            "--participant", "[[Thuggee]]",
                            "--participant", "Charles Ashworth",
                            "--location", "temple of mahakali")
        self.assertEqual(code, 0, out)
        fm = self.fm()
        self.assertEqual(fm["participants"],
                         ["[[Charles_Ashworth]]", "[[Thuggee]]"])
        # The caller's first, then the body's own link, once each.
        self.assertEqual(fm["locations"],
                         ["[[Mandir_Mahakali]]", "[[Baranagar]]"])
        self.assertNotIn("WARNING", out)

    def test_a_name_two_notes_share_is_refused_and_nothing_written(self):
        code, out = promote(self.vault, "--write",
                            "--participant", "The Colonel")
        self.assertEqual(code, 1, out)
        self.assertIn("Colonel Hart.md", out)
        self.assertIn("Colonel Pyke.md", out)
        # The way out it names is one that works.
        self.assertIn('--participant "Characters/NPCs/Colonel Hart"', out)
        self.assertFalse((self.vault / TARGET).exists())
        code, out = promote(self.vault, "--write", "--participant",
                            "Characters/NPCs/Colonel Hart")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["participants"], ["[[Colonel Hart]]"])

    def test_a_name_with_no_note_or_the_wrong_kind_is_kept_with_a_warning(self):
        code, out = promote(self.vault, "--write",
                            "--participant", "Sister Unwritten",
                            "--location", "Thuggee",
                            "--participant", "Ghost Sketch")
        self.assertEqual(code, 0, out)
        fm = self.fm()
        # A Midwife sketch is not a note yet: linked as written, with a warning.
        self.assertEqual(fm["participants"],
                         ["[[Sister Unwritten]]", "[[Ghost Sketch]]"])
        self.assertEqual(fm["locations"], ["[[Thuggee]]", "[[Baranagar]]"])
        warned = [ln for ln in out.splitlines() if ln.startswith("WARNING")]
        self.assertEqual(len(warned), 3, out)
        self.assertIn("Sister Unwritten", warned[0])
        self.assertIn("Ghost Sketch", warned[1])
        self.assertIn("type faction", warned[2])

    def test_a_quote_in_a_participant_or_location_is_refused(self):
        for flag in ("--participant", "--location"):
            with self.subTest(flag=flag):
                code, out = promote(self.vault, "--write", flag, 'A" \nkey: v')
                self.assertEqual(code, 1, out)
                self.assertIn(flag, out)
                self.assertFalse((self.vault / TARGET).exists())

    def test_a_path_that_names_no_note_is_not_answered_by_another_folder_s(self):
        # Locations/Baranagar.md exists; Locations/New Town/Baranagar does not.
        (self.vault / DRAFT).write_text(
            "Then [[Locations/New Town/Baranagar]].\n", encoding="utf-8")
        code, out = promote(self.vault, "--write", "--location",
                            "Locations/New Town/Baranagar.md")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["locations"],
                         ["[[Locations/New Town/Baranagar]]"])
        warned = [ln for ln in out.splitlines() if ln.startswith("WARNING")]
        self.assertEqual(len(warned), 1, out)
        self.assertIn("no note of that name yet", warned[0])

    def test_a_note_an_earlier_block_of_the_batch_made_is_found(self):
        (self.vault / DRAFT).write_text(
            "[[The Lascar]] waits at [[Baranagar]].\n", encoding="utf-8")
        blocks = ('=== note-new "Characters/NPCs/Ibrahim Sarang.md"\n'
                  + entity("npc", ["The Lascar"])
                  + f'=== promote-plan "{DRAFT}" --to "{TARGET}" '
                    "--plan-type scene\n")
        (self.vault / "batch.txt").write_text(blocks, encoding="utf-8")
        code, out = run(self.vault, "batch", str(self.vault / "batch.txt"),
                        "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["participants"], ["[[Ibrahim Sarang]]"])

    def test_section_keeps_all_of_a_section_that_holds_a_marker_pair(self):
        section = ("## Timeline\n\nA.\n\n<!-- gm-only -->\nHidden.\n"
                   "<!-- /gm-only -->\n\nB, after the block.\n\n")
        (self.vault / DRAFT).write_text(
            section + "## Investigation\n\nC.\n", encoding="utf-8")
        code, out = promote(self.vault, "--write", "--section", "Timeline")
        self.assertEqual(code, 0, out)
        self.assertTrue(self.written().endswith("---\n" + section))

    def test_section_refuses_half_a_marker_block_and_drops_nothing(self):
        # The opener is above the heading and the closer inside the section:
        # copying to the closer would lose B without a word.
        (self.vault / DRAFT).write_text(
            "<!-- gm-only -->\n## Timeline\n\nA.\n\n<!-- /gm-only -->\n\n"
            "B.\n\n## Investigation\n\nC.\n", encoding="utf-8")
        code, out = promote(self.vault, "--write", "--section", "Timeline")
        self.assertEqual(code, 1, out)
        self.assertIn("half of a gm-only or spoiler block", out)
        self.assertFalse((self.vault / TARGET).exists())

    def test_campaign_is_the_vault_s_own_overview(self):
        # No Overview: the template's link stands, and it names the note
        # the scaffold makes (#677), not a note of one old vault.
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["campaign"], "[[Campaign Overview]]")
        (self.vault / TARGET).unlink()
        overview = "---\ntype: campaign_overview\n---\n"
        for rel in ("_Campaign/The Long Winter.md",
                    "_archive/An Older Overview.md",
                    "_midwife/calcutta/A Draft Overview.md"):
            path = self.vault / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(overview, encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["campaign"], "[[The Long Winter]]")
        # Another note of the Overview's name: the link says which, by path.
        (self.vault / TARGET).unlink()
        (self.vault / "Locations/The Long Winter.md").write_text(
            entity("location"), encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["campaign"], "[[_Campaign/The Long Winter]]")

    def test_date_stamps_last_updated_and_no_date_leaves_it_empty(self):
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["lastUpdated"], "")
        self.assertIn("no --date: lastUpdated left empty", out)
        (self.vault / TARGET).unlink()
        code, out = promote(self.vault, "--write", "--date", "2026-11-16")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm()["lastUpdated"], "2026-11-16")
        self.assertNotIn("no --date", out)
        (self.vault / TARGET).unlink()
        for bad in ("16/11/2026", "2026-02-30", "today"):
            with self.subTest(date=bad):
                code, out = promote(self.vault, "--write", "--date", bad)
                self.assertEqual(code, 1, out)
                self.assertIn("--date", out)
                self.assertFalse((self.vault / TARGET).exists())

    def test_section_promotes_one_heading_s_section_byte_for_byte(self):
        timeline = ("## Timeline\r\n\r\n| When | What |\r\n|---|---|\r\n"
                    "| Night 1 | [[Thuggee]] move.  |\r\n\r\n"
                    "### Day 2\r\n\r\nThe Colonel wakes.\r\n\r\n")
        draft = ("# Structure\r\n\r\nIntro, at [[Baranagar]].\r\n\r\n"
                 + timeline
                 + "## Investigation\r\n\r\nNo clue is required.\r\n\r\n"
                 "### Day 2\r\n\r\nAnother day two.\r\n")
        (self.vault / DRAFT).write_bytes(draft.encode("utf-8"))
        code, out = promote(self.vault, "--write", "--section", "timeline",
                            plan_type="timeline")
        self.assertEqual(code, 0, out)
        self.assertIn("section 'Timeline'", out)
        self.assertTrue(self.written().endswith("---\r\n" + timeline))
        fm = self.fm()
        # Only what that section links to: Baranagar is in the intro.
        self.assertEqual((fm["participants"], fm["locations"]),
                         (["[[Thuggee]]"], []))
        # The draft is untouched, and the other plan comes from the same file.
        self.assertEqual((self.vault / DRAFT).read_bytes(),
                         draft.encode("utf-8"))
        other = f"{CHAPTER}/Planning/Chapter_4_Investigation.md"
        code, out = promote(self.vault, "--write", "--section",
                            "## Investigation", target=other,
                            plan_type="investigation")
        self.assertEqual(code, 0, out)
        self.assertTrue((self.vault / other).read_bytes().decode("utf-8")
                        .endswith("---\r\n## Investigation\r\n\r\nNo clue is "
                                  "required.\r\n\r\n### Day 2\r\n\r\n"
                                  "Another day two.\r\n"))

    def test_a_section_that_is_missing_or_named_twice_is_refused(self):
        (self.vault / DRAFT).write_text(
            "## Timeline\n\nA.\n\n### Day 2\n\nB.\n\n## Investigation\n\n"
            "C.\n\n### Day 2\n\nD.\n", encoding="utf-8")
        for section, said in (("Beats", "no such heading"),
                              ("Day 2", "2 '### Day 2' headings: promote "
                                        "the heading above"),
                              ("### Day 2", "2 '### Day 2' headings"),
                              ("# Timeline", "no such heading")):
            with self.subTest(section=section):
                code, out = promote(self.vault, "--write", "--section",
                                    section)
                self.assertEqual(code, 1, out)
                self.assertIn(said, out)
                self.assertFalse((self.vault / TARGET).exists())

    def test_frontmatter_is_the_template_filled_and_passes_the_schema(self):
        code, out = promote(self.vault, "--write", "--leads-to",
                            "Chapter_4_Ashworth_Confrontation",
                            "--leads-to", "[[Chapter_4_Timeline]]")
        self.assertEqual(code, 0, out)
        text = self.written()
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "plan")
        self.assertEqual(fm["canon_status"], "DRAFT")
        self.assertEqual(fm["name"], "Chapter 4 Temple Approach")
        self.assertEqual(fm["plan_type"], "scene")
        self.assertEqual(vl.wikilink_target(fm["chapter"]), "Chapter 4 - Calcutta")
        self.assertEqual(fm["leads_to"],
                         ["[[Chapter_4_Ashworth_Confrontation]]",
                          "[[Chapter_4_Timeline]]"])
        # The template's example relationship is not a real edge.
        self.assertNotIn('target: "[[]]"', text)
        self.assertNotIn("# arc | scene", text)
        errors = [m for level, m in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)) if level == "ERROR"]
        self.assertEqual(errors, [])

    def test_a_bad_plan_type_is_refused_and_nothing_written(self):
        code, out = promote(self.vault, "--write", plan_type="chase")
        self.assertEqual(code, 1, out)
        self.assertIn("plan_type", out)
        self.assertFalse((self.vault / TARGET).exists())

    def test_an_existing_plan_is_never_overwritten(self):
        (self.vault / TARGET).parent.mkdir(parents=True)
        (self.vault / TARGET).write_text("keep\n", encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 1, out)
        self.assertEqual((self.vault / TARGET).read_text(encoding="utf-8"),
                         "keep\n")

    def test_a_plan_outside_a_chapter_needs_chapter(self):
        code, out = promote(self.vault, target="Planning/Loose.md")
        self.assertEqual(code, 1, out)
        self.assertIn("--chapter", out)
        code, out = promote(self.vault, "--chapter", "Chapter 4 - Calcutta",
                            "--write", target="Planning/Loose.md")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(
            (self.vault / "Planning/Loose.md").read_text(encoding="utf-8"))
        self.assertEqual(vl.wikilink_target(fm["chapter"]), "Chapter 4 - Calcutta")


if __name__ == "__main__":
    unittest.main()

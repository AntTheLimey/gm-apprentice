#!/usr/bin/env python3
"""vault_write.py promote-plan: a Midwife draft filed as a vault plan (#464).

The plan's text is never changed: only the frontmatter is written, and the
people and places in it come from the entity names and aliases the body
mentions."""

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

    def test_participants_and_locations_from_names_and_aliases(self):
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.written())
        # First mention order; "the Magistrate" is Ashworth again, "meg" in
        # lower case is not Margaret, an item is neither list, a Midwife
        # sketch and an archived note are not vault entities.
        self.assertEqual(fm["participants"],
                         ["[[Charles_Ashworth]]", "[[Thuggee]]"])
        self.assertEqual(fm["locations"],
                         ["[[Baranagar]]", "[[Mandir_Mahakali]]"])
        self.assertIn("PARTICIPANT\tCharacters/NPCs/Charles_Ashworth.md",
                      out)
        self.assertIn("LOCATION\tLocations/Mandir_Mahakali.md", out)

    def test_a_name_two_notes_share_is_a_warning_and_left_out(self):
        code, out = promote(self.vault)
        self.assertEqual(code, 0, out)
        warning = [r for r in out.splitlines()
                   if r.startswith("WARNING") and "The Colonel" in r]
        self.assertEqual(len(warning), 1, out)
        self.assertIn("Colonel Hart", warning[0])
        self.assertIn("Colonel Pyke", warning[0])
        self.assertNotIn("Colonel Hart.md\t", out.replace("WARNING", ""))

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

    def test_an_npc_named_by_surname_alone_is_found(self):
        # Canticle's Ashworth Confrontation says "Ashworth" 39 times and
        # never "Charles Ashworth"; Ghosh is "Ghosh" throughout.
        (self.vault / DRAFT).write_text(
            "Ashworth waits. Cavendish is out. Renwick hums.\n",
            encoding="utf-8")
        (self.vault / "Characters/NPCs/Hugh_Cavendish.md").write_text(
            entity("npc"), encoding="utf-8")
        (self.vault / "Locations/Old Renwick.md").write_text(
            entity("location"), encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        fm = vl.extract_frontmatter(self.written())
        self.assertEqual(fm["participants"], ["[[Charles_Ashworth]]"])
        # A surname two NPCs share is a warning, never a guess; a
        # location's last word is not a surname.
        self.assertIn('"Cavendish" names 2 notes', out)
        self.assertEqual(fm["locations"], [])

    def test_a_shared_surname_is_quiet_once_one_of_them_is_named(self):
        (self.vault / DRAFT).write_text(
            "Hugh Cavendish rides. Later Cavendish sleeps.\n",
            encoding="utf-8")
        (self.vault / "Characters/NPCs/Hugh_Cavendish.md").write_text(
            entity("npc"), encoding="utf-8")
        code, out = promote(self.vault, "--write")
        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        fm = vl.extract_frontmatter(self.written())
        self.assertEqual(fm["participants"], ["[[Hugh_Cavendish]]"])

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

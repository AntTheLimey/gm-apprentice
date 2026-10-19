#!/usr/bin/env python3
"""vault_write.py status (#315): rewrite a PC's `## Current Status`
labelled fields in place, leaving the rest of the section alone.

Run: python3 tests/test_vault_write_status.py
"""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_write as vw  # noqa: E402

PC = "Characters/PCs/Emma.md"
BULLETED = "Characters/PCs/Six.md"

# The spec shape: unbulleted labels, Open threads as a list under its label.
# One thread item is itself a bold label with a colon.
SPEC = """---
type: pc
---

# Emma

## Background

Born in Bath.

## Current Status

She found the cylinder dead.

**Location:** The Hooghly.
**Condition:** Uninjured.
**Carrying:** Tiger claws.
**Open threads:**
- **The cylinder** is still aboard.
- **Surlish's floor, under the godowns:** a cordon.
**Knows (exclusive):** The creatures' name.

<!-- gm-only -->
Keeper aside: **Location:** not this one.
<!-- /gm-only -->

## Notes

Player notes.

<!-- gm-only -->

## GM Notes

Secret.

<!-- /gm-only -->
"""

# The shape Dead End drifted into: vitals lines, a lede, bulleted labels
# with nested threads, then a subsection holding per-session journal bullets.
DRIFTED = """---
type: pc
---

# Six

## Current Status

**HP:** 12/12
**FP:** 12/12
He has seen the jellyfish.

- **Location:** aboard the Albatross.
- **Condition:** Alive.
- **Open threads:** Hunted by the Republic.
  - **Session 5:** fled the system.
  - the batch-brand is a tell.
- **Knows (exclusive):** the Law Machine.

### God Tokens

| Token | Status |
|-------|--------|
| Chameleon | Unused |

- **Session 6 — The Albatross:** took a blaster hit.
- **New open threads (Session 6):** two destinations.

## Notes

Mine.
"""


# Shackleton's shape: unbulleted labels, then after a blank line a run of
# bulleted per-session journal and open-thread bullets in the same section.
JOURNAL = """---
type: pc
---

# Shack

## Current Status

**Location:** aboard.
**Open threads:**
- The Corvid debt.
**Knows (exclusive):** the cover-ups.
  - **Session 5:** fled the system.

- **Session 6 — The Albatross:** took the helm.
  He shot the drone.
- **New open threads (Session 6):** the cube's two destinations;
  Gary Johnson unfound.

- **Session 7 — Goodwin:** dug through logs.
- **New open threads (Session 7):** the Goodwin Contract.

## GM Notes

Hidden.
"""


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="vwstatus-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(vault, *argv, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


class StatusWriteTests(unittest.TestCase):
    def vault(self):
        return make_vault(self, {PC: SPEC, BULLETED: DRIFTED})

    def test_replaces_only_the_fields_sent(self):
        vault = self.vault()
        code, out = run(vault, "status", PC, "--write", stdin=(
            "**Location:** Calcutta, the compound.\n"
            "**Open threads:**\n- **The cylinder** is still aboard.\n"
            "- **Lady Anne** wants an answer.\n"))
        self.assertEqual(code, 0, out)
        want = SPEC.replace("**Location:** The Hooghly.",
                            "**Location:** Calcutta, the compound.").replace(
            "- **Surlish's floor, under the godowns:** a cordon.",
            "- **Lady Anne** wants an answer.")
        self.assertEqual(read(vault, PC), want)

    def test_a_dry_run_writes_nothing_and_names_each_field(self):
        vault = self.vault()
        code, out = run(vault, "status", PC, stdin=(
            "**Location:** Calcutta.\n**Condition:** Uninjured.\n"))
        self.assertEqual(code, 0, out)
        self.assertEqual(read(vault, PC), SPEC)
        self.assertIn(f"WOULD-ADD\t{PC}\t§Current Status/Location\t"
                      f"replaced (1 lines)", out)
        self.assertIn(f"SKIP\t{PC}\t§Current Status/Condition\t"
                      f"unchanged", out)

    def test_the_lede_the_aside_and_other_sections_stay(self):
        vault = self.vault()
        run(vault, "status", PC, "--write", stdin="**Location:** Elsewhere.\n")
        text = read(vault, PC)
        for kept in ("She found the cylinder dead.",
                     "Keeper aside: **Location:** not this one.",
                     "Player notes.", "Secret.", "Born in Bath."):
            self.assertIn(kept, text)

    def test_a_new_field_goes_after_the_last_one(self):
        vault = self.vault()
        run(vault, "status", PC, "--write", stdin="**Enc:** Light (1)\n")
        self.assertIn("**Knows (exclusive):** The creatures' name.\n"
                      "**Enc:** Light (1)\n\n<!-- gm-only -->",
                      read(vault, PC))

    def test_bulleted_fields_keep_their_shape(self):
        vault = self.vault()
        code, out = run(vault, "status", BULLETED, "--write", stdin=(
            "**Location:** arriving at Dinon I.\n"
            "**Open threads:** Hunted by the Republic.\n"
            "- the batch-brand is a tell.\n"
            "- the ships at the gate.\n"))
        self.assertEqual(code, 0, out)
        want = DRIFTED.replace("- **Location:** aboard the Albatross.",
                               "- **Location:** arriving at Dinon I.").replace(
            "  - **Session 5:** fled the system.\n"
            "  - the batch-brand is a tell.\n",
            "  - the batch-brand is a tell.\n"
            "  - the ships at the gate.\n")
        self.assertEqual(read(vault, BULLETED), want)

    def test_vitals_and_subsections_are_left_alone(self):
        vault = self.vault()
        run(vault, "status", BULLETED, "--write",
            stdin="**Condition:** Wounded.\n")
        text = read(vault, BULLETED)
        self.assertIn("**HP:** 12/12\n**FP:** 12/12\nHe has seen", text)
        self.assertIn("- **Session 6 — The Albatross:** took a blaster hit.",
                      text)
        self.assertIn("- **Condition:** Wounded.\n- **Open threads:**", text)

    def test_a_field_in_a_subsection_is_not_matched(self):
        vault = self.vault()
        code, out = run(vault, "status", BULLETED, stdin=(
            "**New open threads (Session 6):** none.\n"))
        self.assertEqual(code, 0, out)
        self.assertIn("new field", out)

    def test_a_pc_is_found_by_name(self):
        vault = self.vault()
        code, out = run(vault, "status", "Emma", "--write",
                        stdin="**Location:** Bath.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("**Location:** Bath.", read(vault, PC))

    def test_a_missing_section_is_created_before_notes(self):
        vault = make_vault(self, {PC: SPEC.replace(
            SPEC[SPEC.index("## Current Status"):SPEC.index("## Notes")], "")})
        code, out = run(vault, "status", PC, "--write",
                        stdin="**Location:** Bath.\n**Condition:** Fine.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("Born in Bath.\n\n## Current Status\n\n"
                      "**Location:** Bath.\n**Condition:** Fine.\n\n## Notes",
                      read(vault, PC))

    def test_refusals(self):
        vault = make_vault(self, {PC: SPEC, BULLETED: DRIFTED,
                                  "NPCs/Hallam.md": "---\ntype: npc\n---\n"})
        for args, stdin, why in (
                (("NPCs/Hallam.md",), "**Location:** x\n", "not a PC"),
                ((PC,), "She is fine.\n", "labelled field"),
                ((PC,), "**Location:** a\n**Location:** b\n", "twice"),
                ((PC,), "**Location:** a\n### Sub\n", "heading"),
                ((PC,), "", "nothing on stdin")):
            with self.subTest(why=why):
                code, out = run(vault, "status", *args, "--write",
                                stdin=stdin)
                self.assertEqual(code, 1, out)
                self.assertIn(why, out)
        self.assertEqual(read(vault, PC), SPEC)

    def test_a_label_twice_in_the_note_is_refused(self):
        twice = SPEC.replace("**Carrying:** Tiger claws.",
                             "**Location:** Again.")
        vault = make_vault(self, {PC: twice})
        code, out = run(vault, "status", PC, stdin="**Location:** x\n")
        self.assertEqual(code, 1, out)
        self.assertIn("twice", out)

    def test_a_blank_line_ends_an_unbulleted_fields_list(self):
        vault = make_vault(self, {PC: JOURNAL})
        code, out = run(vault, "status", PC, "--write",
                        stdin="**Knows (exclusive):** less.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("replaced (2 lines)", out)
        self.assertEqual(read(vault, PC), JOURNAL.replace(
            "**Knows (exclusive):** the cover-ups.\n"
            "  - **Session 5:** fled the system.\n",
            "**Knows (exclusive):** less.\n"))

    def test_a_label_twice_blocks_only_a_write_to_that_label(self):
        twice = SPEC.replace("**Carrying:** Tiger claws.",
                             "**Knows (exclusive):** Again.")
        vault = make_vault(self, {PC: twice})
        code, out = run(vault, "status", PC, "--write",
                        stdin="**Location:** Bath.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("**Location:** Bath.", read(vault, PC))

    def test_crlf_stays_crlf(self):
        vault = make_vault(self, {PC: SPEC.replace("\n", "\r\n")})
        run(vault, "status", PC, "--write", stdin="**Location:** Bath.\n")
        text = read(vault, PC)
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertIn("**Location:** Bath.\r\n", text)


class StatusShowTests(unittest.TestCase):
    def test_show_prints_the_fields_and_names_what_it_leaves(self):
        vault = make_vault(self, {BULLETED: DRIFTED})
        code, out = run(vault, "status", BULLETED, "--show")
        self.assertEqual(code, 0, out)
        self.assertIn("- **Open threads:** Hunted by the Republic.\n"
                      "  - **Session 5:** fled the system.\n", out)
        self.assertNotIn("He has seen the jellyfish", out)
        self.assertNotIn("took a blaster hit", out)
        self.assertIn("### God Tokens", out)
        self.assertEqual(read(vault, BULLETED), DRIFTED)

    def test_show_without_a_section_says_so(self):
        vault = make_vault(self, {PC: "---\ntype: pc\n---\n\n# Emma\n"})
        code, out = run(vault, "status", PC, "--show")
        self.assertEqual(code, 0, out)
        self.assertIn("no ## Current Status", out)


if __name__ == "__main__":
    unittest.main()

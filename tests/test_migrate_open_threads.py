#!/usr/bin/env python3
"""The open-threads fold (#315 item 3): an update choice that folds a PC's
per-session `**New open threads (Session N):**` bullets into its one
Current Status Open threads list, through `vault_write.py status`.

Run: python3 tests/test_migrate_open_threads.py
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate  # noqa: E402
import migrate_vault as mv  # noqa: E402
import vault_write as vw  # noqa: E402
from migrate_core import CHOICE, StepFailed  # noqa: E402

SHACK = "Characters/PCs/Shack.md"
SIX = "Characters/PCs/Six.md"

# Unbulleted fields; the per-session bullets follow a blank line.
UNBULLETED = """---
type: pc
---

# Shack

## Current Status

**Location:** aboard.
**Open threads:**
- The Corvid debt.
**Knows (exclusive):** the cover-ups.

- **Session 6 — The Albatross:** took the helm.
  He shot the drone.
- **New open threads (Session 6):** the cube's two destinations;
  Gary Johnson unfound.

- **Session 7 — Goodwin:** dug through logs.
- **New open threads (Session 7):** the Goodwin Contract.

## GM Notes

Hidden.
"""

UNBULLETED_FOLDED = """---
type: pc
---

# Shack

## Current Status

**Location:** aboard.
**Open threads:**
- The Corvid debt.
- **Session 6:** the cube's two destinations;
  Gary Johnson unfound.
- **Session 7:** the Goodwin Contract.
**Knows (exclusive):** the cover-ups.

- **Session 6 — The Albatross:** took the helm.
  He shot the drone.

- **Session 7 — Goodwin:** dug through logs.

## GM Notes

Hidden.
"""

# Bulleted fields, and the per-session bullets under a subsection.
BULLETED = """---
type: pc
---

# Six

## Current Status

- **Location:** aboard.
- **Open threads:** Hunted by the Republic.
  - **Session 5:** fled the system.
- **Knows (exclusive):** the Law Machine.

### God Tokens

| Token | Status |
|-------|--------|
| Chameleon | Unused |

- **Session 6 — The Albatross:** took a blaster hit.
- **New open threads (Session 6):** two destinations —
  [[Phoenix III]] and the [[Sargasso Void]].

## Notes

Mine.
"""

BULLETED_FOLDED = BULLETED.replace(
    "  - **Session 5:** fled the system.\n",
    "  - **Session 5:** fled the system.\n"
    "  - **Session 6:** two destinations —\n"
    "    [[Phoenix III]] and the [[Sargasso Void]].\n").replace(
    "- **New open threads (Session 6):** two destinations —\n"
    "  [[Phoenix III]] and the [[Sargasso Void]].\n", "")

NO_LIST = """---
type: pc
---

# Rook

## Current Status

**Location:** aboard.

- **New open threads (Session 3):** the debt.

## Notes
"""

CLEAN = """---
type: pc
---

# Emma

## Current Status

**Location:** the Hooghly.
**Open threads:**
- **Surlish's floor:** a cordon.
"""


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="mig-threads-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.md").write_text(
        '---\ntype: meta\ngm_apprentice_version: "1.10.81"\n---\n',
        encoding="utf-8")
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def fold(case, text, rel=SHACK):
    vault = make_vault(case, {rel: text})
    batch = vw.Batch(vault)
    sessions = vw.fold_session_threads(batch, rel)
    return sessions, batch.texts[rel]


class FoldTests(unittest.TestCase):
    def test_unbulleted_fields_fold_into_the_list(self):
        sessions, text = fold(self, UNBULLETED)
        self.assertEqual(sessions, [6, 7])
        self.assertEqual(text, UNBULLETED_FOLDED)

    def test_bulleted_fields_and_a_subsection_fold_in_shape(self):
        sessions, text = fold(self, BULLETED, SIX)
        self.assertEqual(sessions, [6])
        self.assertEqual(text, BULLETED_FOLDED)

    def test_a_pc_with_no_open_threads_gets_one(self):
        _s, text = fold(self, NO_LIST)
        self.assertIn("**Location:** aboard.\n**Open threads:**\n"
                      "- **Session 3:** the debt.\n", text)
        self.assertNotIn("New open threads", text)

    def test_a_new_open_threads_field_does_not_land_among_journal_bullets(self):
        note = NO_LIST.replace(
            "- **New open threads (Session 3):**",
            "- **Session 3 — The Dock:** fought.\n"
            "- **New open threads (Session 3):**")
        _s, text = fold(self, note)
        self.assertIn("**Location:** aboard.\n**Open threads:**\n"
                      "- **Session 3:** the debt.\n", text)
        self.assertNotIn("- **Open threads:**", text)

    def test_a_clean_pc_is_untouched(self):
        sessions, text = fold(self, CLEAN)
        self.assertEqual(sessions, [])
        self.assertEqual(text, CLEAN)

    def test_the_folded_text_is_word_for_word(self):
        _s, text = fold(self, UNBULLETED)
        for words in ("the cube's two destinations;", "Gary Johnson unfound.",
                      "the Goodwin Contract."):
            self.assertIn(words, text)


class MigrationTests(unittest.TestCase):
    def vault(self):
        return make_vault(self, {
            SHACK: UNBULLETED, SIX: BULLETED,
            "Characters/PCs/Emma.md": CLEAN,
            "Characters/PCs/Shack_Story.md": UNBULLETED,
            "_Templates/_Template_PC.md": UNBULLETED})

    def test_one_choice_names_each_pc_and_its_sessions(self):
        items = mv.find_open_threads_fold(self.vault())
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual((item.id, item.group, item.wants, item.holds_stamp),
                         ("open-threads-fold", CHOICE, "fold or leave", True))
        self.assertIn("leave", item.lines[0])
        self.assertEqual(item.lines[1:], [
            f"{SHACK}: Sessions 6, 7",
            f"{SIX}: Session 6"])

    def test_archived_pc_copies_are_not_offered_or_rewritten(self):
        copy = "_archive/Characters/PCs/Shack.md"
        vault = make_vault(self, {copy: UNBULLETED})
        self.assertEqual(mv.find_open_threads_fold(vault), [])
        self.assertEqual(read(vault, copy), UNBULLETED)

    def test_nothing_to_fold_offers_nothing(self):
        vault = make_vault(self, {"Characters/PCs/Emma.md": CLEAN})
        self.assertEqual(mv.find_open_threads_fold(vault), [])

    def test_leave_writes_nothing(self):
        vault = self.vault()
        said = mv.find_open_threads_fold(vault)[0].apply("leave")
        self.assertEqual(read(vault, SHACK), UNBULLETED)
        self.assertEqual(read(vault, SIX), BULLETED)
        self.assertIn("left", said[0])

    def test_fold_writes_every_pc_and_only_pcs(self):
        vault = self.vault()
        said = mv.find_open_threads_fold(vault)[0].apply("fold")
        self.assertEqual(read(vault, SHACK), UNBULLETED_FOLDED)
        self.assertEqual(read(vault, SIX), BULLETED_FOLDED)
        self.assertEqual(read(vault, "Characters/PCs/Shack_Story.md"),
                         UNBULLETED)
        self.assertEqual(read(vault, "_Templates/_Template_PC.md"),
                         UNBULLETED)
        self.assertEqual(said, [f"{SHACK}: folded Sessions 6, 7",
                                f"{SIX}: folded Session 6"])
        self.assertEqual(mv.find_open_threads_fold(vault), [])

    def test_another_answer_is_refused(self):
        with self.assertRaises(StepFailed):
            mv.find_open_threads_fold(self.vault())[0].apply("yes")

    def test_it_is_a_registered_choice(self):
        check = next(c for c in mv.VAULT_CHECKS
                     if c.name == "open-threads-fold")
        self.assertEqual(check.choices, ("open-threads-fold=",))
        self.assertIsNotNone(check.release)

    def test_plan_lists_it_and_apply_without_an_answer_holds_the_stamp(self):
        vault = self.vault()
        check = next(c for c in mv.VAULT_CHECKS
                     if c.name == "open-threads-fold")
        out = io.StringIO()
        with mock.patch.object(migrate, "plugin_version",
                               return_value=(check.release, "test")), \
                mock.patch.object(migrate, "CHECKS", [check]), \
                contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            migrate.main([str(vault), "plan"])
            migrate.main([str(vault), "apply"])
        self.assertIn("open-threads-fold=<fold or leave>", out.getvalue())
        self.assertIn("not answered: open-threads-fold", out.getvalue())
        self.assertEqual(read(vault, SHACK), UNBULLETED)


if __name__ == "__main__":
    unittest.main()

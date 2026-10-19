#!/usr/bin/env python3
"""`session_context.py VAULT --carry [--before INDEX]` (#313): what the last
Wrap-Up carries into this one, without reading that Wrap-Up whole.

Run: python3 tests/test_session_context_carry.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "shared" / "scripts" / "session_context.py"

CH1 = "Chapters/Chapter 1 - Lyon"
CH2 = "Chapters/Chapter 2 - Vienna"


def wrap(chapter, n, body, canon="AUTHORITATIVE"):
    return (f"---\ntype: session_wrap\nsession: \"[[Session {n:02d}]]\"\n"
            f"session_number: {n}\nchapter: \"[[{chapter.split('/')[-1]}]]\"\n"
            f"canon_status: {canon}\n---\n\n# Wrap-Up\n\n{body}")


def index(chapter, n):
    return (f"---\ntype: session\nsession_number: {n}\n"
            f"chapter: \"[[{chapter.split('/')[-1]}]]\"\nstatus: wrap-up\n"
            f"---\n\n# Session {n:02d}\n")


FULL = """## Narrative Recap

The party left the inn.

<!-- gm-only -->

## GM Notes

### What Carries Forward

#### Unresolved Threads

- **The ledger.** Still in the vault at the bank.
- **Carried, unresolved:** the duel; the letter.

#### Player-Stated Intentions

- **Visit the bank** at dawn.

#### Pending Consequences

- **The watch** will hear of the fire.

#### NPCs Needing Follow-Up

- **Hallam** sulks.

### World State

- **In-game date:** 3 May

### Keeper Checklist

- [ ] Decide what the clerk saw.
  He was at the window.
- [x] ~~Write the ledger handout.~~ — done
  It is in Handouts.
- [ ] Record the SAN loss.

### Quality Notes

They liked the chase.

### Handoff to session-prep

Dawn, outside the bank, the ledger still inside.

### Reconciliation Context

#### Consequences

- **Old reconcile text** not to carry.

<!-- /gm-only -->
"""

OLD_SHAPE = """<!-- gm-only -->

## GM Notes

### What Carries Forward

#### Unresolved Cliffhanger

- **The theatre door** is locked.

#### Unrealised Consequences

- **Ferrante** owes them.

### Keeper Checklist

- [ ] **Theatre door.** Liesel has the key.

<!-- /gm-only -->
"""


def make(case, files, kept_by=None):
    root = Path(tempfile.mkdtemp(prefix="sc-carry-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    if kept_by:
        (root / "_meta").mkdir(exist_ok=True)
        (root / "_meta" / "vault-config.yaml").write_text(
            f"version: 1\nvault:\n  kept_by: {kept_by}\n", encoding="utf-8")
    return root


def run(vault, *args):
    return subprocess.run([sys.executable, str(SCRIPT), str(vault), *args],
                          capture_output=True, text=True, timeout=60)


def campaign(case, **kw):
    return make(case, {
        f"{CH1}/Session 02/Ch1_S02_Wrap_Up.md": wrap(CH1, 2, OLD_SHAPE),
        f"{CH2}/Session 01/Ch2_S01_Wrap_Up.md": wrap(CH2, 1, FULL),
        f"{CH2}/Session 02/Session 02.md": index(CH2, 2),
        f"{CH2}/Session 02/Ch2_S02_Wrap_Up.md": wrap(
            CH2, 2, "## Narrative Recap\n\nDraft.\n", canon="DRAFT"),
    }, **kw)


class CarryTests(unittest.TestCase):
    def test_before_picks_the_wrap_up_ahead_of_the_session(self):
        r = run(campaign(self), "--carry", "--before",
                f"{CH2}/Session 02/Session 02.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Ch2_S01_Wrap_Up.md", r.stdout)
        self.assertNotIn("Ch2_S02_Wrap_Up.md", r.stdout)

    def test_prints_the_carried_parts_and_nothing_else(self):
        out = run(campaign(self), "--carry", "--before",
                  f"{CH2}/Session 02/Session 02.md").stdout
        for want in ("- **The ledger.** Still in the vault at the bank.",
                     "- **Carried, unresolved:** the duel; the letter.",
                     "- **Visit the bank** at dawn.",
                     "- **The watch** will hear of the fire.",
                     "Dawn, outside the bank, the ledger still inside.",
                     "- [ ] Decide what the clerk saw.\n  He was at the window.",
                     "- [ ] Record the SAN loss."):
            self.assertIn(want, out)
        for unwanted in ("The party left the inn", "Hallam", "3 May",
                         "Write the ledger handout", "It is in Handouts",
                         "They liked the chase", "Old reconcile text",
                         "gm-only"):
            self.assertNotIn(unwanted, out)

    def test_the_parts_come_in_a_fixed_order(self):
        out = run(campaign(self), "--carry", "--before",
                  f"{CH2}/Session 02/Session 02.md").stdout
        order = [out.index(s) for s in (
            "Dawn, outside", "The ledger.", "Visit the bank", "The watch",
            "Decide what the clerk saw")]
        self.assertEqual(order, sorted(order))

    def test_older_heading_names_are_read(self):
        vault = make(self, {
            f"{CH1}/Session 02/Ch1_S02_Wrap_Up.md": wrap(CH1, 2, OLD_SHAPE),
            f"{CH1}/Session 03/Session 03.md": index(CH1, 3)})
        r = run(vault, "--carry", "--before", f"{CH1}/Session 03/Session 03.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("**The theatre door** is locked.", r.stdout)
        self.assertIn("**Ferrante** owes them.", r.stdout)
        self.assertIn("- [ ] **Theatre door.** Liesel has the key.", r.stdout)
        self.assertIn("Unresolved Cliffhanger", r.stdout)
        self.assertIn("(none found)", r.stdout)     # no Handoff, no Intentions

    def test_a_chapters_first_session_reads_the_last_chapter(self):
        vault = make(self, {
            f"{CH1}/Session 02/Ch1_S02_Wrap_Up.md": wrap(CH1, 2, OLD_SHAPE),
            f"{CH1}/Session 01/Ch1_S01_Wrap_Up.md": wrap(CH1, 1, FULL),
            f"{CH2}/Session 01/Session 01.md": index(CH2, 1)})
        out = run(vault, "--carry", "--before",
                  f"{CH2}/Session 01/Session 01.md").stdout
        self.assertIn("Ch1_S02_Wrap_Up.md", out)

    def test_without_before_the_latest_wrap_up_is_read(self):
        out = run(campaign(self), "--carry").stdout
        self.assertIn("Ch2_S02_Wrap_Up.md", out)

    def test_an_unreviewed_wrap_up_says_so(self):
        out = run(campaign(self), "--carry").stdout
        self.assertIn("Note: this Wrap-Up is not reviewed yet "
                      "(canon_status: DRAFT)", out)

    def test_a_reviewed_one_has_no_note(self):
        out = run(campaign(self), "--carry", "--before",
                  f"{CH2}/Session 02/Session 02.md").stdout
        self.assertNotIn("Note:", out)

    def test_the_index_may_be_named_without_md_or_by_name(self):
        vault = campaign(self)
        for ref in (f"{CH2}/Session 02/Session 02", "Session 02"):
            with self.subTest(ref=ref):
                out = run(vault, "--carry", "--before", ref).stdout
                self.assertIn("Ch2_S01_Wrap_Up.md", out)

    def test_an_unknown_index_is_an_error(self):
        r = run(campaign(self), "--carry", "--before", "Nope/Session 99.md")
        self.assertEqual(r.returncode, 2)
        self.assertIn("Nope/Session 99.md", r.stderr)

    def test_no_earlier_wrap_up_is_said_plainly(self):
        vault = make(self, {f"{CH1}/Session 01/Session 01.md": index(CH1, 1)})
        r = run(vault, "--carry", "--before", f"{CH1}/Session 01/Session 01.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no earlier Wrap-Up", r.stdout)

    def test_a_vault_kept_by_a_player_still_carries(self):
        out = run(campaign(self, kept_by="player"), "--carry").stdout
        self.assertNotIn("kept by a player", out)
        self.assertIn("Ch2_S02_Wrap_Up.md", out)

    def test_before_needs_carry_and_carry_takes_no_other_mode(self):
        vault = campaign(self)
        for args in (("--before", "Session 02"), ("--carry", "--brief"),
                     ("--carry", "--session", "2"), ("--carry", "--play")):
            with self.subTest(args=args):
                self.assertEqual(run(vault, *args).returncode, 2)


if __name__ == "__main__":
    unittest.main()

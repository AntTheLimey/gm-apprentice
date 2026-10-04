#!/usr/bin/env python3
"""The reading before 1.10.28, which the migration's wrapup-sections step
runs once: only the recap, Memorable Moments and the titles a vault listed
in publish.wrap_up.player_sections are player-facing.

Covers the config reader and how `vault_check wrapup` (and `--fix`), given
an explicit `player` set, treat a listed H2: never flagged, never moved
under `## GM Notes`, hoisted in original order after Memorable Moments,
and left inside a gm-only fence when the GM fenced it. An empty set means
every other H2 is Keeper-facing.

Run: python3 tests/test_wrapup_player_sections.py
"""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import vault_check as vc  # noqa: E402
from vaultlib import read_wrap_up_player_sections  # noqa: E402

REL = "Sessions/Chapter_01_Session_01_Wrap_Up.md"

WRAP = """---
type: session_wrap
session: "[[Session 01 - Start]]"
session_number: 1
canon_status: DRAFT
reconciled: null
---

# Chapter 01 · Session 01 — Start — Wrap-Up

## Narrative Recap

The party arrived.

## Secret Plans

The villain plots.

## What the Party Learned

- The door is trapped.

## Memorable Moments

**A beat.**

## where we left off

The party stands at the gate.

## The Party

- Ann
"""

FENCED = """---
type: session_wrap
session: "[[Session 01 - Start]]"
session_number: 1
canon_status: DRAFT
reconciled: null
---

# Wrap-Up

## Narrative Recap

Prose.

## Secret Plans

Plots.

<!-- gm-only -->

## What the Party Learned

Fenced on purpose.

<!-- /gm-only -->
"""


def config(block):
    return f"---\ntype: vault_config\npublish:\n{block}---\n"


def make_vault(tmp, body):
    vault = Path(tmp)
    (vault / "_meta").mkdir()
    (vault / "Sessions").mkdir()
    (vault / REL).write_text(body)
    return vault


LISTED = config("  wrap_up:\n    player_sections:\n"
                "      - What the Party Learned\n"
                "      - \"Where We Left Off\"\n"
                "      - '**The Party**'\n")


LISTED_TITLES = ["What the Party Learned", "Where We Left Off",
                 "**The Party**"]


def keeper_rows(rows):
    return [r for r in rows if "Keeper-facing H2" in r]


class ReaderTests(unittest.TestCase):
    def read(self, cfg):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            (vault / "_meta").mkdir()
            if cfg is not None:
                (vault / "_meta" / "vault-config.md").write_text(cfg)
            return read_wrap_up_player_sections(vault)

    def test_absent_config_or_key_is_empty(self):
        self.assertEqual(self.read(None), [])
        self.assertEqual(self.read(config("  mode: player\n")), [])
        self.assertEqual(self.read(config("  wrap_up:\n    other: 1\n")), [])

    def test_block_and_flow_lists(self):
        self.assertEqual(
            self.read(LISTED),
            ["What the Party Learned", "Where We Left Off", "**The Party**"])
        flow = config("  wrap_up:\n    player_sections: [A, \"B c\"]\n"
                      "  mode: player\n")
        self.assertEqual(self.read(flow), ["A", "B c"])

    def test_empty_null_and_malformed_read_as_none(self):
        self.assertEqual(
            self.read(config("  wrap_up:\n    player_sections:\n")), [])
        self.assertEqual(
            self.read(config("  wrap_up:\n    player_sections: null\n")), [])
        self.assertEqual(
            self.read(config("  wrap_up:\n    player_sections: [A\n")), [])


class WrapupPlayerSectionTests(unittest.TestCase):
    def run_check(self, body, titles, fix):
        """`titles`: the listed H2 titles, passed in as the `player` set
        (None or [] is the reading with nothing listed)."""
        player = frozenset(vc.player_section_key(t) for t in titles or [])
        with tempfile.TemporaryDirectory() as tmp:
            vault = make_vault(tmp, body)
            rows = vc.check_wrapup(vault, None, fix, player=player)
            return rows, (vault / REL).read_text()

    def test_no_setting_flags_and_renests_everything(self):
        rows, _ = self.run_check(WRAP, None, False)
        titles = " ".join(keeper_rows(rows))
        for name in ("Secret Plans", "What the Party Learned",
                     "where we left off", "The Party"):
            self.assertIn(name, titles)
        _rows, fixed = self.run_check(WRAP, None, True)
        self.assertIn("## GM Notes", fixed)
        self.assertIn("### What the Party Learned", fixed)

    def test_empty_list_matches_no_setting(self):
        self.assertEqual(self.run_check(WRAP, [], False)[0],
                         self.run_check(WRAP, None, False)[0])

    def test_listed_sections_are_not_flagged(self):
        rows, _ = self.run_check(WRAP, LISTED_TITLES, False)
        joined = " ".join(keeper_rows(rows))
        self.assertIn("Secret Plans", joined)
        for name in ("What the Party Learned", "where we left off",
                     "The Party"):
            self.assertNotIn(name, joined)

    def test_fix_hoists_listed_in_order_and_renests_only_unlisted(self):
        _rows, fixed = self.run_check(WRAP, LISTED_TITLES, True)
        order = [fixed.index(h) for h in (
            "## Narrative Recap", "## Memorable Moments",
            "## What the Party Learned", "## where we left off",
            "## The Party")]
        self.assertEqual(order, sorted(order))
        gm = fixed.index("<!-- gm-only -->")
        self.assertLess(fixed.index("## The Party"), gm)
        self.assertGreater(fixed.index("### Secret Plans"), gm)
        self.assertNotIn("### What the Party Learned", fixed)

    def test_fix_is_idempotent_with_the_setting(self):
        _rows, once = self.run_check(WRAP, LISTED_TITLES, True)
        rows, twice = self.run_check(once, LISTED_TITLES, True)
        self.assertEqual(once, twice)
        self.assertEqual(keeper_rows(rows), [])

    def test_all_listed_leaves_a_conformant_file_alone(self):
        body = WRAP.replace("## Secret Plans\n\nThe villain plots.\n\n", "")
        rows, fixed = self.run_check(body, LISTED_TITLES, True)
        self.assertEqual(fixed.split("\n---\n", 1)[1],
                         body.split("\n---\n", 1)[1])
        self.assertFalse(any("re-nested" in r for r in rows), rows)

    def test_case_and_emphasis_are_normalised(self):
        body = WRAP.replace("## What the Party Learned",
                            "## **WHAT  the party learned**")
        rows, _ = self.run_check(body, LISTED_TITLES, False)
        self.assertNotIn("party learned", " ".join(keeper_rows(rows)).lower())

    def test_listed_section_inside_the_fence_stays_fenced(self):
        rows, fixed = self.run_check(FENCED, LISTED_TITLES, True)
        self.assertEqual(
            [r for r in keeper_rows(rows) if "Learned" in r], [])
        gm = fixed.index("<!-- gm-only -->")
        self.assertGreater(fixed.index("## What the Party Learned"), gm)
        self.assertNotIn("### What the Party Learned", fixed)
        self.assertIn("### Secret Plans", fixed)


    # Review of #278: findings and the re-nest read a listed section the
    # same way, so a pair inside it is judged by one rule.

    CROSSING = WRAP.split("## Narrative Recap")[0] + """## Narrative Recap

Prose.

## What the Party Learned

Known.

<!-- gm-only -->

Secret aside.

## Secret Plans

Plots.

<!-- /gm-only -->
"""

    ASIDE = WRAP.split("## Narrative Recap")[0] + """## Narrative Recap

Prose.

## What the Party Learned

Known.

<!-- gm-only -->
An aside the GM fenced.
<!-- /gm-only -->

More known.

<!-- gm-only -->

## GM Notes

Stuff.

<!-- /gm-only -->
"""

    def test_a_fence_crossing_out_of_a_listed_section_is_reported(self):
        rows, fixed = self.run_check(self.CROSSING, LISTED_TITLES, True)
        self.assertTrue(any("crosses a player-facing section boundary" in r
                            for r in rows), rows)
        self.assertEqual(fixed.split("\n---\n", 1)[1],
                         self.CROSSING.split("\n---\n", 1)[1])
        self.assertFalse(any("re-nested" in r for r in rows), rows)

    def test_an_aside_in_a_listed_section_is_not_counted_as_a_second_opener(
            self):
        rows, fixed = self.run_check(self.ASIDE, LISTED_TITLES, False)
        self.assertFalse(any("openers outside code" in r for r in rows), rows)
        _rows, fixed = self.run_check(self.ASIDE, LISTED_TITLES, True)
        rows, _ = self.run_check(fixed, LISTED_TITLES, False)
        self.assertFalse(any("openers outside code" in r for r in rows), rows)
        self.assertIn("<!-- gm-only -->\nAn aside the GM fenced.", fixed)


if __name__ == "__main__":
    unittest.main()

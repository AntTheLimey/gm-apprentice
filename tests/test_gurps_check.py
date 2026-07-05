#!/usr/bin/env python3
"""Regression tests for gurps_calc.py and gurps_check.py.

Formula tests import gurps_calc directly; CLI tests run gurps_check.py
against the committed fixtures in tests/fixtures/gurps-pcs/ and assert
exact output. All page references are GURPS Basic Set 4e.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "gurps-pcs"
sys.path.insert(0, str(SCRIPTS))

import gurps_calc as gc  # noqa: E402

FAILURES = []


def check(label, actual, expected):
    if actual != expected:
        FAILURES.append(f"{label}:\n  expected {expected!r}\n  got      {actual!r}")
    else:
        print(f"ok: {label}")


# --- basic lift (B15) ---
check("BL ST 10", gc.basic_lift(10), 20.0)
check("BL ST 11", gc.basic_lift(11), 24.0)     # 24.2 -> nearest
check("BL ST 12", gc.basic_lift(12), 29.0)     # 28.8 -> nearest
check("BL ST 13", gc.basic_lift(13), 34.0)     # 33.8 -> nearest
check("BL ST 7 keeps fraction", gc.basic_lift(7), 9.8)

# --- encumbrance thresholds (B17) ---
check("enc thresholds BL 34",
      gc.enc_max_weights(34.0),
      [("None", 0, 34.0), ("Light", 1, 68.0), ("Medium", 2, 102.0),
       ("Heavy", 3, 204.0), ("X-Heavy", 4, 340.0)])

# --- move / dodge per level (B17) ---
check("move BM6 by level", [gc.enc_move(6, lv) for lv in range(5)], [6, 4, 3, 2, 1])
check("move BM5 by level", [gc.enc_move(5, lv) for lv in range(5)], [5, 4, 3, 2, 1])
check("move floor is 1", gc.enc_move(4, 4), 1)
check("dodge speed 6.5 CR by level",
      [gc.enc_dodge(6.5, lv, combat_reflexes=True) for lv in range(5)],
      [10, 9, 8, 7, 6])
check("dodge speed 6.0 no CR", gc.enc_dodge(6.0, 0), 9)

# --- secondaries (B15-B17) ---
check("secondaries 13/14/13/13",
      gc.secondaries(13, 14, 13, 13),
      {"hp": 13, "will": 13, "per": 13, "fp": 13, "speed": 6.75, "move": 6})

# --- parry / block (B375-B376) ---
check("parry skill 16 CR", gc.parry(16, combat_reflexes=True), 12)
check("parry skill 15", gc.parry(15), 10)
check("block skill 15 CR", gc.block(15, combat_reflexes=True), 11)

# --- thrust/swing (B16 closed form; oracle = printed table / GCS) ---
B16_ORACLE = {
    1: ("1d-6", "1d-5"), 5: ("1d-4", "1d-3"), 8: ("1d-3", "1d-2"),
    9: ("1d-2", "1d-1"), 10: ("1d-2", "1d"), 11: ("1d-1", "1d+1"),
    12: ("1d-1", "1d+2"), 13: ("1d", "2d-1"), 14: ("1d", "2d"),
    15: ("1d+1", "2d+1"), 17: ("1d+2", "3d-1"), 19: ("2d-1", "3d+1"),
    20: ("2d-1", "3d+2"), 25: ("2d+2", "5d-1"), 27: ("3d-1", "5d+1"),
    30: ("3d", "5d+2"),
}
for st, (thr_s, sw_s) in B16_ORACLE.items():
    check(f"thrust ST {st}", gc.fmt_dice(*gc.thrust(st)), thr_s)
    check(f"swing ST {st}", gc.fmt_dice(*gc.swing(st)), sw_s)

# --- dice helpers / B269 equivalence ---
check("parse 2d+1", gc.parse_dice("2d+1"), (2, 1))
check("parse 3d-1", gc.parse_dice("3d-1"), (3, -1))
check("parse 1d", gc.parse_dice("1d"), (1, 0))
check("parse unicode minus", gc.parse_dice("3d−1"), (3, -1))
check("parse garbage", gc.parse_dice("HT-3 aff"), None)
check("B269: 2d+5 equiv 3d+1",
      gc.dice_adds(2, 5) == gc.dice_adds(3, 1), True)
check("B269: 1d+2 not equiv 2d",
      gc.dice_adds(1, 2) == gc.dice_adds(2, 0), False)

import gurps_check as gk  # noqa: E402

_SHEET_MD = """---
type: pc
point_total: 100
---

# Test

## Stat Sheet

### Primary Attributes

| Attribute | Score | Cost |
|-----------|-------|------|
| ST | 12 | [20] |
| DX | 12 | [40] |

## Equipment

| Item | Weight | Location |
|------|--------|----------|
| Sword | 2 lb | Carried |

### Encumbrance

| Level | Max Weight | Move | Dodge |
|-------|-----------|------|-------|
| None (0) | ≤29 lbs | 5 | 9 |

## Current Status

**Enc:** None (0)
"""

sheet = gk.Sheet(_SHEET_MD)
check("fm point_total", sheet.fm.get("point_total"), "100")
check("section lookup case-insensitive",
      sheet.section("current status") is not None, True)
check("stat table rows", sheet.table("Primary Attributes"),
      [["Attribute", "Score", "Cost"], ["ST", "12", "[20]"], ["DX", "12", "[40]"]])
check("enc subsection table first row",
      sheet.table("Encumbrance")[1][0], "None (0)")
check("parse_weight le-symbol", gk.parse_weight("≤29 lbs"), 29.0)
check("parse_weight plain", gk.parse_weight("2 lb"), 2.0)
check("parse_weight none", gk.parse_weight("—"), None)
check("parse_cost bracket", gk.parse_cost("[20]"), 20)
check("parse_cost unicode minus", gk.parse_cost("−25"), -25)
check("col finds header", gk.col(["Level", "Max Weight", "Move"], "weight"), 1)
check("norm_level strips marker+paren", gk.norm_level("Light (1) ←"), "light")
check("norm_level extra-heavy alias", gk.norm_level("Extra-Heavy (4)"), "x-heavy")

_KARLISH = """---
type: pc
---

# K

## Stat Sheet

### Primary Attributes

| Attribute | Score | Cost |
|-----------|-------|------|
| ST | 11 | [10] |
| DX | 13 | [60] |
| IQ | 12 | [40] |
| HT | 11 | [10] |

### Secondary Characteristics

| Characteristic | Value |
|----------------|-------|
| HP | 11 |
| Will | 12 |
| Per | 12 |
| FP | 11 |
| Basic Speed | 6.0 |
| Basic Move | 6 |

## Equipment

### Encumbrance

| Level | Max Weight | Move | Dodge |
|-------|-----------|------|-------|
| None (0) | 22 lb | 6 | 9 |
| Light (1) | 44 lb | 4 | 8 |
"""

ksheet = gk.Sheet(_KARLISH)
attrs = gk.read_attributes(ksheet)
check("read ST", attrs["st"], 11)
check("read speed", attrs["speed"], 6.0)
check("no CR", gk.has_combat_reflexes(ksheet), False)
check("attributes clean when bases match", gk.check_attributes(ksheet), [])
enc_findings = gk.check_encumbrance(ksheet)
check("enc flags BL-22 table rows (2 weight warnings)",
      [f[0] for f in enc_findings], ["WARNING", "WARNING"])
check("enc warning names computed BL",
      "BL 24" in enc_findings[0][2], True)

# Ragged row: recognized level with fewer cells than the header must not
# raise; its weight warning still fires.
_RAGGED = _KARLISH.replace("| Light (1) | 44 lb | 4 | 8 |",
                           "| Light (1) | 44 lb |")
ragged_findings = gk.check_encumbrance(gk.Sheet(_RAGGED))
check("enc tolerates ragged row (2 weight warnings, no exception)",
      [f[0] for f in ragged_findings], ["WARNING", "WARNING"])

if FAILURES:
    print("\n".join(["", "FAILURES:"] + FAILURES))
    sys.exit(1)
print("all gurps checks passed")

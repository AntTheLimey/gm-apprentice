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

_LOADED = _KARLISH.replace(
    "## Equipment\n",
    "## Equipment\n\n"
    "| Item | Weight | Cost | Location |\n"
    "|------|--------|------|----------|\n"
    "| Sword | 3 lb | $600 | Carried |\n"
    "| Shield | 15 lb | $90 | Carried |\n"
    "| Mail | 25 lb | $230 | Worn |\n"
    "| Mule pack | 90 lb | $30 | Mule |\n",
).replace(
    "## Stat Sheet",
    "## Current Status\n\n**Enc:** Medium (2)\n\n## Stat Sheet",
)

lsheet = gk.Sheet(_LOADED)
load = gk.check_load(lsheet)
check("load flags declared vs computed",
      [f[0] for f in load], ["WARNING"])
check("load message shows both levels and lbs",
      "43" in load[0][2] and "Light" in load[0][2] and "Medium" in load[0][2],
      True)

nl = gk.check_load(gk.Sheet(_LOADED.replace("**Enc:** Medium (2)\n", "")))
check("load INFO when no declared level",
      (nl[0][0], "Light" in nl[0][2]), ("INFO", True))

_MELEE = _KARLISH + """
## Melee Weapons

| Weapon | Skill | Damage | Reach | Parry |
|--------|-------|--------|-------|-------|
| Broadsword | Broadsword 15 | 2d cut | 1 | 11 |
| Punch | DX 13 | 1d-2 cr | C | 8 |
"""

msheet = gk.Sheet(_MELEE)
dfd = gk.check_defenses(msheet)
check("both parry mismatches flagged",
      [f[0] for f in dfd], ["WARNING", "WARNING"])
check("broadsword computed 10", "10" in dfd[0][2], True)
check("punch computed 9", "9" in dfd[1][2], True)

# Active Defenses table: dodge mismatch is INFO (sheets often list the
# encumbered value), block mismatch is WARNING, non-numeric rows skipped.
# Hand-computed: Speed 6.0, no CR -> unencumbered Dodge 9; Shield 15 ->
# Block 3 + 15//2 = 10.
_ACTIVE = _KARLISH + """
## Skills

| Name | Difficulty | Points | Effective |
|------|-----------|--------|-----------|
| Shield | DX/E | [4] | 15 |

## Active Defenses

| Defense | Score | Notes |
|---------|-------|-------|
| Dodge | 8 | current |
| Block | 11 | with medium shield |
| Parry (sword) | — | see melee |
"""

adf = gk.check_defenses(gk.Sheet(_ACTIVE))
check("active defenses: one dodge INFO + one block WARNING, nothing else",
      [(f[0], f[1]) for f in adf],
      [("INFO", "defenses/dodge"), ("WARNING", "defenses/block")])
check("dodge message shows computed 9", "9" in adf[0][2], True)
check("block message shows computed 10", "10" in adf[1][2], True)

blk_ok = gk.check_defenses(gk.Sheet(_ACTIVE.replace(
    "| Block | 11 |", "| Block | 10 |")))
check("matching block produces no block finding",
      [f[1] for f in blk_ok], ["defenses/dodge"])

_POINTS = _KARLISH + """
## Advantages & Perks

| Name | Cost | Notes |
|------|------|-------|
| Combat Reflexes | 15 | |

## Skills

| Name | Difficulty | Points | Effective |
|------|-----------|--------|-----------|
| Broadsword | DX/A | [8] | 15 |
| Shield | DX/E | [4] | 15 |

## Points Summary

| Category | Points |
|----------|--------|
| Attributes | 120 |
| Advantages & Perks | 15 |
| Skills | 14 |
| **Total** | **149** |
"""

psheet = gk.Sheet(_POINTS)
pts = gk.check_points(psheet)
check("skills category mismatch flagged (12 summed vs 14 declared)",
      any(f[0] == "WARNING" and "Skills" in f[1] and "12" in f[2]
          for f in pts), True)
check("attributes category matches (120), not flagged",
      any("Attributes" in f[1] and f[0] == "WARNING" for f in pts), False)

_DMG = _KARLISH + """
## Melee Weapons

| Weapon | Skill | Damage | Reach | Parry |
|--------|-------|--------|-------|-------|
| Broadsword | Broadsword 15 | sw+1 cut (2d cut) | 1 | 10 |
| Knife | Knife 13 | thr-1 imp (1d-2 imp) | C | 9 |
| Zapper | Beam 14 | HT-3 aff | 8 | No |
"""

dsheet = gk.Sheet(_DMG)
dmg = gk.check_damage(dsheet)
check("damage INFO announces thr/sw for ST 11",
      ("1d-1" in dmg[0][2] and "1d+1" in dmg[0][2], dmg[0][0]),
      (True, "INFO"))
check("sw+1 vs 2d flagged (1d+2 != 2d in adds-space)",
      any(f[0] == "WARNING" and "Broadsword" in f[1] for f in dmg), True)
check("thr-1 vs 1d-2 passes (both 2 adds)",
      any("Knife" in f[1] and f[0] == "WARNING" for f in dmg), False)
check("affliction line skipped",
      any("Zapper" in f[1] for f in dmg), False)

# Word-boundary guard: "Thrown"/"Sword" must not match as thr/sw, while
# bare "sw" (formula, no adds, no dice) still resolves as an INFO.
_DMG2 = _KARLISH + """
## Melee Weapons

| Weapon | Skill | Damage | Reach | Parry |
|--------|-------|--------|-------|-------|
| Broadsword | Broadsword 15 | sw+1 cut (2d cut) | 1 | 10 |
| Javelin | Spear 13 | Thrown weapon, 1d cut | 1 | 9 |
| Gladius | Shortsword 14 | Special, see Short Sword skill | 1 | 10 |
| Whip | Whip 12 | sw cut | 1,2 | 8 |
"""

dmg2 = gk.check_damage(gk.Sheet(_DMG2))
check("Thrown weapon row produces no finding",
      any("Javelin" in f[1] for f in dmg2), False)
check("Short Sword prose row produces no finding",
      any("Gladius" in f[1] for f in dmg2), False)
check("sw+1 vs 2d still flagged after boundary fix",
      any(f[0] == "WARNING" and "Broadsword" in f[1] for f in dmg2), True)
check("bare sw resolves as formula-only INFO at ST 11",
      any(f[0] == "INFO" and "Whip" in f[1] and "1d+1" in f[2]
          for f in dmg2), True)

# Parenthetical label qualifiers: the reference sheet template writes
# "ST (Strength)", "HP (Hit Points)" etc. — these must resolve to the
# bare attribute keys.
_PAREN = """---
type: pc
---

# P

## Stat Sheet

### Primary Attributes

| Attribute | Score | Cost |
|-----------|-------|------|
| ST (Strength) | 12 | [20] |
| DX (Dexterity) | 13 | [60] |
| IQ (Intelligence) | 11 | [20] |
| HT (Health) | 12 | [20] |

### Secondary Characteristics

| Characteristic | Score |
|----------------|-------|
| HP (Hit Points) | 12 |
| Basic Speed | 6.25 |
"""

pattrs = gk.read_attributes(gk.Sheet(_PAREN))
check("parenthetical labels parse", pattrs is not None, True)
if pattrs is not None:
    check("paren ST", pattrs["st"], 12)
    check("paren DX", pattrs["dx"], 13)
    check("paren IQ", pattrs["iq"], 11)
    check("paren HT", pattrs["ht"], 12)
    check("paren HP", pattrs["hp"], 12)
    check("paren speed", pattrs["speed"], 6.25)

# --- CLI against committed fixtures ---
def run_check(fixture, *args):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "gurps_check.py"),
         str(FIXTURES / fixture), *args],
        capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        FAILURES.append(f"gurps_check {fixture}: rc={result.returncode} "
                        f"stderr={result.stderr.strip()}")
        return []
    return result.stdout.strip().splitlines()


clean_out = run_check("clean.md")
clean_counts = [l for l in clean_out if l.startswith("# count:")]
check("clean sheet: six sections emitted", len(clean_counts), 6)
check("clean sheet: no WARNING or ERROR",
      [l for l in clean_out if l.startswith(("WARNING", "ERROR"))], [])

flawed_out = run_check("flawed.md")
check("flawed: encumbrance weight warnings fire",
      sum(1 for l in flawed_out
          if l.startswith("WARNING\tencumbrance/")) >= 5, True)
check("flawed: parry warnings fire",
      sum(1 for l in flawed_out
          if l.startswith("WARNING\tdefenses/parry/")), 2)
check("flawed: load computes Light with no declared Enc",
      any(l.startswith("INFO\tload") and "Light" in l for l in flawed_out),
      True)
check("single-section run emits one section",
      [l for l in run_check("clean.md", "load") if l.startswith("[")],
      ["[load]"])

# Blank Location cells count as carried (CodeRabbit PR #74 finding)
_BLANKLOC = _KARLISH.replace(
    "## Equipment\n",
    "## Equipment\n\n"
    "| Item | Weight | Cost | Location |\n"
    "|------|--------|------|----------|\n"
    "| Sword | 3 lb | $600 | Carried |\n"
    "| Pack | 20 lb | $10 | |\n"
    "| Mule pack | 90 lb | $30 | Mule |\n",
)
blf = gk.check_load(gk.Sheet(_BLANKLOC))
check("blank Location counts toward load (3+20=23, mule excluded)",
      (blf[0][0], "23" in blf[0][2]), ("INFO", True))

# --- skill relative level (B170 closed form) ---
B170_ORACLE = [
    (1, "E", 0), (2, "E", 1), (4, "E", 2), (8, "E", 3), (12, "E", 4),
    (16, "E", 5), (20, "E", 6),
    (1, "A", -1), (2, "A", 0), (4, "A", 1), (8, "A", 2), (12, "A", 3),
    (1, "H", -2), (2, "H", -1), (4, "H", 0), (8, "H", 1),
    (1, "VH", -3), (2, "VH", -2), (4, "VH", -1), (8, "VH", 0),
    (12, "VH", 1),
]
for pts, diff, rl in B170_ORACLE:
    check(f"B170 {diff} {pts}pt", gc.skill_relative_level(pts, diff), rl)
check("B170 intermediate 3pt A holds lower level",
      gc.skill_relative_level(3, "A"), 0)
check("B170 intermediate 6pt E holds lower level",
      gc.skill_relative_level(6, "E"), 2)
check("B170 zero points", gc.skill_relative_level(0, "E"), None)
check("B170 unknown difficulty", gc.skill_relative_level(4, "X"), None)
check("B170 lowercase vh accepted", gc.skill_relative_level(1, "vh"), -3)
check("enc-penalized list",
      gc.ENC_PENALIZED_SKILLS,
      ("climbing", "stealth", "swimming", "judo", "karate"))

if FAILURES:
    print("\n".join(["", "FAILURES:"] + FAILURES))
    sys.exit(1)
print("all gurps checks passed")

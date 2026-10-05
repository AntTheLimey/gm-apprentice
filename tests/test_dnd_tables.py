#!/usr/bin/env python3
"""Tests for dnd_tables.py: SRD 5.2 class numbers, held against classes.md."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import dnd_tables as dt  # noqa: E402

CLASSES_MD = ROOT / "skills" / "ttrpg-expert" / "systems" / "dnd-5e-2024" / "classes.md"


def sections():
    out, name = {}, None
    for line in CLASSES_MD.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            name = line[3:].strip()
            out[name] = []
        elif name:
            out[name].append(line)
    return out


def table_rows(lines):
    """[(header cells, row cells)] for every table row in a section."""
    header, rows = None, []
    for line in lines:
        if not line.startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells
        elif set("".join(cells)) <= set("-: "):
            continue
        else:
            rows.append((header, cells))
    return rows


def test_twelve_classes_each_with_twenty_levels():
    assert sorted(dt.CLASSES) == ["barbarian", "bard", "cleric", "druid", "fighter", "monk",
                                  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]
    for info in dt.CLASSES.values():
        assert len(info.cantrips) == 20 and len(info.prepared) == 20
        assert info.die in (6, 8, 10, 12)
    assert len(dt.SLOTS) == 20 and all(len(row) == 9 for row in dt.SLOTS)
    assert len(dt.PACT_SLOTS) == 20


def test_numbers_never_shrink_as_level_rises():
    for a, b in zip(dt.SLOTS, dt.SLOTS[1:]):
        assert all(x <= y for x, y in zip(a, b))
    for info in dt.CLASSES.values():
        assert list(info.cantrips) == sorted(info.cantrips)
        assert list(info.prepared) == sorted(info.prepared)


def test_reference_agrees_on_hit_die_and_saves():
    secs = sections()
    for key, info in dt.CLASSES.items():
        text = "\n".join(secs[info.name])
        assert re.search(r"\*\*HD:\*\*\s*d(\d+)", text).group(1) == str(info.die), key
        saves = re.search(r"\*\*Saves:\*\*\s*(\w+),\s*(\w+)", text).groups()
        assert saves == info.saves, key


def test_reference_agrees_on_cantrips_and_prepared():
    secs, compared = sections(), 0
    for key, info in dt.CLASSES.items():
        for header, cells in table_rows(secs[info.name]):
            if not cells[0].isdigit():
                continue
            level = int(cells[0])
            for title, values in (("Cantrips", info.cantrips), ("Prepared", info.prepared)):
                if title in header and cells[header.index(title)].isdigit():
                    assert int(cells[header.index(title)]) == values[level - 1], (key, level, title)
                    compared += 1
    assert compared > 100


def test_reference_agrees_on_slots():
    rows = table_rows(sections()["Full Caster Spell Slot Progression"])
    assert len(rows) == 20
    for _header, cells in rows:
        want = tuple(int(c) if c.isdigit() else 0 for c in cells[1:])
        assert dt.SLOTS[int(cells[0]) - 1] == want, cells[0]


def test_reference_agrees_on_pact_slots():
    compared = 0
    for header, cells in table_rows(sections()["Warlock"]):
        if cells[0].isdigit() and "Slots" in header and "Slot Lv" in header:
            got = (int(cells[header.index("Slots")]), int(cells[header.index("Slot Lv")]))
            assert dt.PACT_SLOTS[int(cells[0]) - 1] == got, cells[0]
            compared += 1
    assert compared > 5


def test_caster_level_adds_full_levels_and_half_rounded_up():
    assert dt.caster_level({"wizard": 5}) == 5
    assert dt.caster_level({"paladin": 5}) == 3
    assert dt.caster_level({"ranger": 4, "sorcerer": 3}) == 5
    assert dt.caster_level({"fighter": 5, "warlock": 3}) == 0


def test_slots_for():
    assert dt.slots_for({"wizard": 5}) == [4, 3, 2, 0, 0, 0, 0, 0, 0]
    assert dt.slots_for({"paladin": 1}) == [2, 0, 0, 0, 0, 0, 0, 0, 0]
    assert dt.slots_for({"paladin": 5}) == [4, 2, 0, 0, 0, 0, 0, 0, 0]
    assert dt.slots_for({"ranger": 4, "sorcerer": 3}) == [4, 3, 2, 0, 0, 0, 0, 0, 0]
    assert dt.slots_for({"fighter": 5}) == [0] * 9
    assert dt.slots_for({"warlock": 5}) == [0, 0, 2, 0, 0, 0, 0, 0, 0]
    assert dt.slots_for({"warlock": 2, "bard": 3}) == [6, 2, 0, 0, 0, 0, 0, 0, 0]


def test_max_spell_level():
    assert dt.max_spell_level("wizard", 5) == 3
    assert dt.max_spell_level("wizard", 17) == 9
    assert dt.max_spell_level("paladin", 4) == 1
    assert dt.max_spell_level("paladin", 5) == 2
    assert dt.max_spell_level("warlock", 9) == 5
    assert dt.max_spell_level("warlock", 11) == 6
    assert dt.max_spell_level("warlock", 17) == 9
    assert dt.max_spell_level("fighter", 20) == 0


def test_allowances():
    assert dt.cantrips_allowed("wizard", 5) == 4
    assert dt.cantrips_allowed("paladin", 5) == 0
    assert dt.prepared_allowed("wizard", 5) == 9
    assert dt.prepared_allowed("sorcerer", 1) == 2
    assert dt.prepared_allowed("warlock", 10) == 10
    assert dt.prepared_allowed("warlock", 11) == 12
    assert dt.prepared_allowed("warlock", 17) == 18
    assert dt.prepared_allowed("fighter", 5) == 0


def test_known_ignores_case_and_spaces():
    assert dt.known(" Bard ").name == "Bard"
    assert dt.known("Artificer") is None

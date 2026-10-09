#!/usr/bin/env python3
"""The last small leftovers of the final review. No network."""

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_ddb  # noqa: E402
import dnd_ddb_calc  # noqa: E402
from ddb_builder import area, armour, character  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
FIREBALL = ("Fireball", 3, True, False, False, False, (1, 2), "Wizard")
LEATHER = ("Leather Armor", 1, 10, False, False, "armor")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def fireball(size):
    return character(spells=(FIREBALL,), spell_details={"Fireball": area("Sphere", size, "Ranged", 150)})


def wearing(armor_class, *more):
    return character(hit_points={"base": 25}, inventory=(LEATHER,), item_details={"Leather Armor": armour(armor_class)},
                     modifiers=more)


def line_of(text):
    return next(ln for ln in text.splitlines() if ln.startswith("**Armour Class:**"))


# --- A-N1: a bracketed value in a row sync adds is remembered at once -------------------------

def test_a_bracketed_cell_of_an_added_row_is_followed_on_the_very_next_sync():
    first = sync_text(TEMPLATE, fireball(20))                 # the row is ADDed here, and synced only once
    assert "150 ft (20-ft sphere)" in first.text
    second = sync_text(first.text, fireball(40), first.seen)
    assert ("WRITE", "Spells / Fireball / Range", "150 ft (20-ft sphere) -> 150 ft (40-ft sphere)") in second.rows
    assert not [r for r in second.rows if r[0] == "KEPT"]


def test_a_bracketed_source_of_an_added_row_is_followed_too():
    feat = dict(feats=(("Magic Initiate (Wizard)",),))
    spell = ("Light", 0, True, False, False, False, (1,), "Feat: Magic Initiate (Wizard)")
    first = sync_text(TEMPLATE, character(spells=(spell,), **feat))
    other = character(spells=(("Light", 0, True, False, False, False, (1,), "Wizard"),), **feat)
    second = sync_text(first.text, other, first.seen)
    assert any(r[0] == "WRITE" and r[1] == "Spells / Light / Source" for r in second.rows)


# --- A-N2: the Armour Class CHECK is true -------------------------------------------------------

@pytest.mark.parametrize("hand", [
    "Chain mail 16, shield +2, Defense fighting style +1, Ring of Protection +1",
    "Leather 11, Dex +2", "Leather 11", "Studded leather and a shield"])
def test_a_hand_written_line_that_cannot_be_added_up_is_silent(hand):
    note = TEMPLATE.replace("**Armour Class:** {what it is made of}", f"**Armour Class:** {hand}")
    report = sync_text(note, wearing(11))
    assert [r for r in report.rows if r[1] == dnd_ddb.AC_LINE] == []
    assert line_of(report.text) == f"**Armour Class:** {hand}"


def test_the_paladin_fixture_is_silent_about_its_armour_class_line():
    fixture = (ROOT / "tools/publish/test/fixtures/with-dnd-pc/Characters/PCs/Brannoch_Vale.md").read_text(encoding="utf-8")
    note = fixture.replace("---\n", '---\ndndbeyond: "4242"\n', 1)
    assert "**Armour Class:** Chain mail 16, shield +2" in note
    data = character(classes=(("Paladin", 5, "Oath of Devotion", 6),), stats=(17, 10, 14, 8, 12, 15),
                     hit_points={"base": 34}, inventory=(LEATHER,), item_details={"Leather Armor": armour(11)})
    first = sync_text(note, data)
    assert not [r for r in first.rows if r[1] == dnd_ddb.AC_LINE]
    assert not [r for r in sync_text(first.text, data, first.seen).rows if r[1] == dnd_ddb.AC_LINE]


def test_a_line_that_adds_up_wrongly_is_still_said():
    note = TEMPLATE.replace("**Armour Class:** {what it is made of}", "**Armour Class:** Leather 11 + Dex 2 + Ring 1")
    said = [r for r in sync_text(note, wearing(11)).rows if r[1] == dnd_ddb.AC_LINE]
    assert len(said) == 1 and "adds up to 14" in said[0][2]


# --- A-N4: an unpicked choice is not an entry ---------------------------------------------------

def test_a_spell_choice_not_yet_made_is_skipped_without_a_row_and_a_real_empty_name_is_not():
    data = character(spells=(("Fire Bolt", 0, True, False, False, False, (1,), "Wizard"),))
    data["spells"]["race"].append({"definition": None, "prepared": True})
    data["classSpells"][0]["spells"].append({"definition": None})
    assert not [r for r in sync_text(TEMPLATE, data).rows if r[1] == "Spells"]
    data["spells"]["race"].append({"definition": {"name": "★", "level": 1}, "prepared": True})
    assert len([r for r in sync_text(TEMPLATE, data).rows if r[0] == "CHECK" and r[1] == "Spells"]) == 1


# --- A-N3: a cell not judged in one sync keeps its entry; a matching line is adopted ----------------

UNSURE = ("class", "set", "minimum-base-armor", None)


def test_the_armour_class_line_stays_sync_s_through_a_sync_where_the_armour_class_is_unsure():
    first = sync_text(TEMPLATE, wearing(11))
    unsure = sync_text(first.text, wearing(11, UNSURE), first.seen)
    assert unsure.text == first.text or line_of(unsure.text) == line_of(first.text)
    later = sync_text(unsure.text, wearing(12), unsure.seen)
    assert line_of(later.text) == "**Armour Class:** Leather Armor 12 + Dex 2"


def test_a_line_equal_to_what_sync_would_write_is_adopted_when_the_memory_is_lost():
    first = sync_text(TEMPLATE, wearing(11))
    adopted = sync_text(first.text, wearing(11))                  # no memory
    assert adopted.seen[dnd_ddb.CELLS] and any(e.startswith(dnd_ddb.AC_LINE) for e in adopted.seen[dnd_ddb.CELLS])
    later = sync_text(adopted.text, wearing(12), adopted.seen)
    assert line_of(later.text) == "**Armour Class:** Leather Armor 12 + Dex 2"


# --- B-N2: none of the five names reaches a report row ------------------------------------------

def test_none_of_the_five_names_appears_in_a_check_row():
    """A trait the player owns is listed under its own name; the calculator's CHECK rows never say the key."""
    five = [n for held in dnd_ddb_calc.BY_NAME.values() for n in held]
    cases = [character(racial_traits=((n.title(), None, None),)) for n in five]
    cases += [character(modifiers=(("class", n, "longsword", None),), hit_points={"base": 25}) for n in five]
    cases += [character(modifiers=(("class", "enable-feature", n, None),), hit_points={"base": 25}) for n in five]
    for data in cases:
        for row in (r for r in sync_text(TEMPLATE, data).rows if r[0] == "CHECK"):
            assert not any(n in " ".join(row).lower() for n in five), row

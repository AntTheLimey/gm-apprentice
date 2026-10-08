#!/usr/bin/env python3
"""Tests for dnd_ddb.py: hit point maximum, armour class and attack lines written into the note."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_rules  # noqa: E402
from ddb_builder import HEAVY, MARTIAL, SHIELD, armour, character, weapon  # noqa: E402
from dnd_ddb import plan_attacks, plan_cells, plan_rows, plan_slots, plan_worked, write_edits, write_rows  # noqa: E402
from dnd_ddb_read import Attack, Character, Worked, read  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
FIGHTER = (("Fighter", 5, "", None),)
STRONG = (16, 14, 14, 10, 12, 8)
HP_LOCUS, AC_LOCUS = "Stat Sheet / Combat / HP (Max)", "Stat Sheet / Combat / AC"
LINE_LOCUS = "Stat Sheet / Defences / Armour Class"
ATTACKS = "Equipment / Weapons & Damage Cantrips"
HEAD = "## Equipment\n\n### Weapons & Damage Cantrips\n\n| Name | Atk Bonus / DC | Damage & Type | Notes |\n|---|---|---|---|\n"


def got(**kw):
    return read(character(**kw))


def swap(text, old, new):
    assert old in text
    return text.replace(old, new, 1)


def fake(hp=None, ac=None, parts="", attacks=None, unsure="not sure"):
    """A Character with the three Worked set by hand."""
    c = got()
    c.hp_max = Worked(hp, "", "" if hp is not None else unsure)
    c.ac = Worked(ac, parts, "" if ac is not None else unsure)
    c.attacks = Worked(attacks, "", "" if attacks is not None else unsure)
    return c


def rows(edits):
    return [(e.status, e.locus, e.message) for e in edits]


def sync(text, c):
    text = write_edits(text, plan_cells(text, c))
    text = write_edits(text, plan_slots(text, c))
    text = write_edits(text, plan_worked(text, c))
    text = write_rows(text, plan_rows(text, c))
    return write_rows(text, plan_attacks(text, c))


def cell(text, label):
    return dnd_rules.Note(text).attr("stat sheet", "combat", label).text.strip()


# --- HP (Max) and AC ---------------------------------------------------------------------

def test_a_blank_hp_max_and_a_bare_ac_are_written():
    c = fake(hp=38, ac=15)
    edits = plan_worked(TEMPLATE, c)
    assert rows(edits) == [("WRITE", HP_LOCUS, "(blank) -> 38"), ("WRITE", AC_LOCUS, "10 -> 15")]
    out = write_edits(TEMPLATE, edits)
    assert cell(out, "hp (max)") == "38" and cell(out, "ac") == "15"


def test_an_equal_number_is_same_and_a_placeholder_is_written():
    text = swap(swap(TEMPLATE, "| AC | 10 |", "| AC | 15 |"), "| HP (Max) | |", "| HP (Max) | {max} |")
    assert rows(plan_worked(text, fake(hp=38, ac=15))) == [("WRITE", HP_LOCUS, "(blank) -> 38"), ("SAME", AC_LOCUS, "15")]


def test_a_reasoned_number_is_kept_and_a_different_one_adds_a_check():
    text = swap(swap(TEMPLATE, "| AC | 10 |", "| AC | 17 (ring) |"), "| HP (Max) | |", "| HP (Max) | 40 (toughness) |")
    out = rows(plan_worked(text, fake(hp=38, ac=17)))
    assert out == [("KEPT", HP_LOCUS, "40 (toughness); D&D Beyond gives 38"),
                   ("CHECK", HP_LOCUS, "the sheet says 40 (toughness); D&D Beyond's numbers give 38"),
                   ("KEPT", AC_LOCUS, "17 (ring); D&D Beyond gives 17")]
    assert write_edits(text, plan_worked(text, fake(hp=38, ac=17))) == text


def test_an_unsure_calculator_writes_nothing_and_says_why():
    text = swap(TEMPLATE, "| HP (Max) | |", "| HP (Max) | 40 (toughness) |")
    edits = plan_worked(text, fake(hp=None, ac=None, parts="", unsure="a class has no hit die in the data"))
    assert rows(edits) == [("CHECK", HP_LOCUS, "not worked out: a class has no hit die in the data; check it"),
                           ("CHECK", AC_LOCUS, "not worked out: a class has no hit die in the data; check it")]
    assert all(e.line == -1 for e in edits)
    assert write_edits(text, edits) == text


def test_hp_current_is_byte_identical_whatever_happens_to_hp_max():
    text = swap(TEMPLATE, "| HP (Current) | |", "| HP (Current) | 12 |")
    out = write_edits(text, plan_worked(text, fake(hp=38, ac=15)))
    assert [ln for ln in out.splitlines() if ln.startswith("| HP (Current)")] == ["| HP (Current) | 12 |"]
    again = write_edits(out, plan_worked(out, fake(hp=50, ac=15)))
    assert [ln for ln in again.splitlines() if ln.startswith("| HP (Current)")] == ["| HP (Current) | 12 |"]
    assert "| HP (Max) | 50 |" in again


# --- the Armour Class line ---------------------------------------------------------------

def test_the_armour_class_line_takes_the_parts_only_when_blank_or_a_placeholder():
    c = fake(hp=1, ac=15, parts="Chain Mail 16 + shield 2")
    edits = [e for e in plan_worked(TEMPLATE, c) if e.locus == LINE_LOCUS]
    assert rows(edits) == [("WRITE", LINE_LOCUS, "(blank) -> Chain Mail 16 + shield 2")]
    assert edits[0].new == "**Armour Class:** Chain Mail 16 + shield 2"
    out = write_edits(TEMPLATE, plan_worked(TEMPLATE, c))
    assert "\n**Armour Class:** Chain Mail 16 + shield 2\n" in out
    assert [e for e in plan_worked(out, c) if e.locus == LINE_LOCUS] == []
    hand = swap(TEMPLATE, "**Armour Class:** {what it is made of}", "**Armour Class:** Mage Armor")
    assert [e for e in plan_worked(hand, c) if e.locus == LINE_LOCUS] == []
    empty = swap(TEMPLATE, "**Armour Class:** {what it is made of}", "**Armour Class:**")
    assert [e.status for e in plan_worked(empty, c) if e.locus == LINE_LOCUS] == ["WRITE"]
    none = fake(hp=1, ac=15, parts="")
    assert [e for e in plan_worked(TEMPLATE, none) if e.locus == LINE_LOCUS] == []


def test_nothing_with_a_pipe_or_a_break_is_written():
    c = fake(hp=1, ac=15, parts="Odd | Mail\n16")
    out = write_edits(TEMPLATE, plan_worked(TEMPLATE, c))
    assert "**Armour Class:** Odd   Mail 16\n" in out
    out = write_rows(HEAD, plan_attacks(HEAD, fake(attacks=[Attack("Bad | Name", "+5", "1d6\nfire")])))
    assert out.splitlines()[-1] == "| Bad Name | +5 | 1d6 fire | |"


def test_a_second_pass_writes_nothing_more():
    c = fake(hp=38, ac=15, parts="Chain Mail 16", attacks=[Attack("Longsword", "+6", "1d8+3 slashing")])
    once = sync(TEMPLATE, c)
    assert [e.status for e in plan_worked(once, c)] == ["SAME", "SAME"]
    assert [e for e in plan_attacks(once, c) if e.status in ("ADD", "REMOVE", "WRITE")] == []
    assert sync(once, c) == once


# --- the attacks table -------------------------------------------------------------------

SWORD = Attack("Longsword", "+6", "1d8+3 slashing")
BOW = Attack("Longbow", "+5", "1d8+2 piercing")


def test_the_template_blank_row_gives_way_to_the_first_attack():
    out = write_rows(TEMPLATE, plan_attacks(TEMPLATE, fake(attacks=[SWORD, BOW])))
    assert "| Longsword | +6 | 1d8+3 slashing | |\n| Longbow | +5 | 1d8+2 piercing | |\n" in out
    assert "| | | | |" not in out.split("### Weapons & Damage Cantrips")[1].split("### Gear")[0]
    assert rows([e for e in plan_attacks(TEMPLATE, fake(attacks=[SWORD])) if not e.silent]) == [
        ("ADD", f"{ATTACKS} / Longsword", "not in the note; added")]


def test_a_changed_cell_is_written_notes_is_never_and_a_missing_attack_goes():
    text = HEAD + "| Longsword | +4 | 1d8+1 slashing | my favourite |\n| Dagger | +2 | 1d4 piercing | |\n"
    edits = plan_attacks(text, fake(attacks=[SWORD]), {"attacks": ["dagger"]})
    assert [e.status for e in edits] == ["WRITE", "WRITE", "REMOVE"]
    assert edits[2].locus == f"{ATTACKS} / Dagger"
    assert write_rows(text, edits) == HEAD + "| Longsword | +6 | 1d8+3 slashing | my favourite |\n"


def test_an_attack_with_no_damage_leaves_that_cell_alone():
    text = HEAD + "| Net | +3 | special | |\n"
    assert write_rows(text, plan_attacks(text, fake(attacks=[Attack("Net", "+5", "")]))) == \
        HEAD + "| Net | +5 | special | |\n"
    out = write_rows(HEAD, plan_attacks(HEAD, fake(attacks=[Attack("Net", "+5", "")])))
    assert out == HEAD + "| Net | +5 | | |\n"


def test_a_hand_added_row_stays_unreported_unless_its_whole_name_matches():
    text = HEAD + "| Whip | +4 | 1d4 | |\n| Longsword (silvered) | +1 | 1d8 | |\n| Longsword | +1 | 1d8 | |\n"
    for seen in (None, {"attacks": ["longsword"]}):
        edits = plan_attacks(text, fake(attacks=[SWORD]), seen)
        assert [(e.status, e.locus) for e in edits] == [("WRITE", f"{ATTACKS} / Longsword / Atk Bonus / DC"),
                                                        ("WRITE", f"{ATTACKS} / Longsword / Damage & Type")]
        out = write_rows(text, edits)
        assert "| Whip | +4 | 1d4 | |" in out and "| Longsword (silvered) | +1 | 1d8 | |" in out
        assert "| Longsword | +6 | 1d8+3 slashing | |" in out


def test_unsure_attacks_change_nothing_and_say_why():
    text = HEAD + "| Dagger | +2 | 1d4 piercing | |\n"
    edits = plan_attacks(text, fake(attacks=None, unsure="a weapon has no damage in the data"))
    assert rows(edits) == [("CHECK", ATTACKS, "not worked out: a weapon has no damage in the data; check the attack lines")]
    assert write_rows(text, edits) == text


def test_a_note_without_the_table_keeps_the_attacks_out_and_says_so():
    edits = plan_attacks("# x\n", fake(attacks=[SWORD]))
    assert [e.status for e in edits] == ["KEPT"] and "not written" in edits[0].message


# --- the rules check agrees --------------------------------------------------------------

def hp_findings(text):
    return [f for f in dnd_rules.check(text) if f.locus.endswith("HP (Max)")]


def test_rules_check_agrees_with_what_sync_writes():
    chain = {"Chain Mail": armour(16, HEAVY), "Shield": armour(2, SHIELD), "Longsword": weapon("1d8", category=MARTIAL)}
    held = (("Chain Mail", 1, 55, False, False, "armor", True), ("Shield", 1, 6, False, False, "shield", True),
            ("Longsword", 1, 3, False, False, "weapon", True))
    barb = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),)
    cases = {
        "fighter": dict(classes=FIGHTER, stats=STRONG, hit_points={"base": 30}, inventory=held, item_details=chain),
        "wizard": dict(classes=(("Wizard", 5, "Evoker", 4),), hit_points={"base": 20}),
        "barbarian": dict(classes=(("Barbarian", 5, "", None),), stats=STRONG, hit_points={"base": 40}, modifiers=barb),
        "level one": dict(classes=(("Fighter", 1, "", None),), stats=STRONG, xp=0, hit_points={"base": 0, "type": 1},
                          hit_dice={"Fighter": 10}),
    }
    for name, kw in cases.items():
        c = got(**kw)
        assert isinstance(c.hp_max.value, int), (name, c.hp_max)
        out = sync(TEMPLATE, c)
        assert cell(out, "hp (max)") == str(c.hp_max.value), name
        assert hp_findings(out) == [], (name, hp_findings(out))
        assert cell(out, "ac") == str(c.ac.value), name


# --- the three headings, an empty list, the defaults, the armour line without an armour class ---

def test_the_attacks_table_is_found_under_each_heading_the_page_accepts():
    for heading in ("Weapons & Damage Cantrips", "Weapons and Damage Cantrips", "Attacks", "attacks"):
        text = HEAD.replace("Weapons & Damage Cantrips", heading) + "| Dagger | +2 | 1d4 piercing | |\n"
        edits = plan_attacks(text, fake(attacks=[SWORD]), {"attacks": ["dagger"]})
        assert [e.status for e in edits] == ["REMOVE", "ADD"], heading
        assert edits[1].locus == f"{ATTACKS} / Longsword", heading
        assert write_rows(text, edits).splitlines()[-1] == "| Longsword | +6 | 1d8+3 slashing | |", heading


def test_a_note_with_two_of_the_headings_reads_the_first_in_the_page_order():
    text = HEAD + "| Dagger | +2 | 1d4 piercing | |\n\n### Attacks\n\n| Name | Atk Bonus / DC | Damage & Type | Notes |\n|---|---|---|---|\n| Mace | +1 | 1d6 | |\n"
    out = write_rows(text, plan_attacks(text, fake(attacks=[SWORD]), {"attacks": ["dagger", "mace"]}))
    assert "| Mace | +1 | 1d6 | |" in out and "| Dagger |" not in out


def test_an_empty_attacks_list_removes_a_remembered_row_and_keeps_the_gms_own():
    text = HEAD + "| Dagger | +2 | 1d4 piercing | |\n| Whip | +4 | 1d4 | |\n"
    edits = plan_attacks(text, fake(attacks=[]), {"attacks": ["dagger"]})
    assert rows(edits) == [("REMOVE", f"{ATTACKS} / Dagger", "D&D Beyond no longer has it")]
    assert write_rows(text, edits) == HEAD + "| Whip | +4 | 1d4 | |\n"
    assert plan_attacks(text, fake(attacks=[])) == []
    assert plan_attacks(HEAD, fake(attacks=[])) == []


def test_a_character_never_worked_out_writes_and_removes_nothing_and_says_so_three_times():
    c = got()
    for name in ("hp_max", "ac", "attacks"):
        setattr(c, name, Character.__dataclass_fields__[name].default_factory())
    assert c.ac == Worked(None, "", "it has not been worked out")
    text = TEMPLATE + "\n"
    wrote = plan_worked(text, c) + plan_attacks(text, c)
    assert [e.status for e in wrote] == ["CHECK", "CHECK", "CHECK"]
    assert {e.locus for e in wrote} == {HP_LOCUS, AC_LOCUS, ATTACKS}
    assert write_edits(text, plan_worked(text, c)) == text
    assert write_rows(text, plan_attacks(text, c)) == text
    hand = swap(text, "| | | | |\n\n### Gear", "| Dagger | +2 | 1d4 | |\n\n### Gear")
    assert write_rows(hand, plan_attacks(hand, c)) == hand


def test_the_armour_class_line_needs_an_armour_class_as_well_as_parts():
    c = fake(hp=1, ac=None, parts="Chain Mail 16")
    assert [e for e in plan_worked(TEMPLATE, c) if e.locus == LINE_LOCUS] == []
    assert [(e.status, e.locus) for e in plan_worked(TEMPLATE, c)] == [("WRITE", HP_LOCUS), ("CHECK", AC_LOCUS)]


def test_a_second_attack_row_of_the_same_name_is_the_gms_and_the_first_alone_goes():
    text = HEAD + "| Dagger | +2 | 1d4 | |\n| Dagger | +9 | 1d4 | mine |\n"
    seen = {"attacks": ["dagger", "longsword"]}
    kept = write_rows(text, plan_attacks(text, fake(attacks=[Attack("Dagger", "+2", "1d4")]), seen))
    assert kept == text
    edits = plan_attacks(text, fake(attacks=[]), seen)
    assert rows(edits) == [("REMOVE", f"{ATTACKS} / Dagger", "D&D Beyond no longer has it")]
    assert write_rows(text, edits) == HEAD + "| Dagger | +9 | 1d4 | mine |\n"

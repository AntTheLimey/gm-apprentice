#!/usr/bin/env python3
"""Tests for dnd_ddb.py: the `### Bonuses` rows sync writes from what D&D Beyond's data gives, and
what the fill then makes of them. Invented characters; no network."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_rules  # noqa: E402
import dnd_sheet  # noqa: E402
from ddb_builder import character  # noqa: E402
from dnd_ddb import plan_bonuses, sync_text, write_rows  # noqa: E402
from dnd_ddb_read import SKILLS as SKILL_LIST  # noqa: E402
from dnd_ddb_read import read  # noqa: E402
from dnd_note import Note, clean, to_int  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
BLANK = "| Applies To | Bonus | Source |\n|------------|-------|--------|\n| | | |\n"
HEAD = "| Applies To | Bonus | Source |\n|------------|-------|--------|\n"
AT = "Stat Sheet / Bonuses"
RING = ("Ring of Protection", 1, 0, True, True, "gear")
STONE = ("Stone of Good Luck", 1, 0, True, True, "gear")
SAVES_1 = ("item", "bonus", "saving-throws", 1, {"requiresAttunement": True})
LUCK = (("item", "bonus", "ability-checks", 1, {"item": "Stone of Good Luck"}),
        ("item", "bonus", "initiative", 1, {"item": "Stone of Good Luck"}),
        ("item", "bonus", "saving-throws", 1, {"item": "Stone of Good Luck"}))
NOT_WRITTEN = ("WRITE", "ADD", "REMOVE", "FILL")


def wizard(inventory=(), modifiers=(), **more):
    return character(hit_points={"base": 25}, inventory=tuple(inventory), modifiers=tuple(modifiers), **more)


def ringed(amount=1):
    return wizard([RING], [("item", "bonus", "saving-throws", amount, {"requiresAttunement": True})])


def swap(text, old, new):
    assert old in text
    return text.replace(old, new, 1)


def bonus_rows(text):
    """The data rows of the note's Bonuses table, as written."""
    lines = text.splitlines()
    start = lines.index("### Bonuses") + 4
    end = next(i for i in range(start, len(lines)) if not lines[i].startswith("|"))
    return lines[start:end]


def numbers(text):
    """Every finished number the fill owns that a bonus can move."""
    note = Note(text)
    out = {}
    for _i, header, cells in note.table("stat sheet", "ability scores"):
        out[f"{clean(cells[0])} save"] = to_int(cells[header.index("Save")])
    for _i, header, cells in note.table("skills"):
        out[clean(cells[0])] = to_int(cells[header.index("Modifier")])
    for label in ("passive perception", "passive investigation", "passive insight"):
        out[label] = to_int(note.attr("stat sheet", "senses", label).text)
    out["initiative"] = to_int(note.attr("stat sheet", "combat", "initiative").text)
    for _i, _h, cells in note.table("spellcasting"):
        if clean(cells[0]) in ("Spell Attack Modifier", "Spell Save DC"):
            out[clean(cells[0])] = to_int(cells[1])
    return out


def moved(data, base=None):
    """{cell: how far it moved} between the synced note of `base` (the plain wizard) and of `data`."""
    plain, with_it = numbers(sync_text(TEMPLATE, base or wizard()).text), numbers(sync_text(TEMPLATE, data).text)
    assert set(plain) == set(with_it) and len(plain) == 6 + 18 + 3 + 1 + 2
    return {k: with_it[k] - plain[k] for k in plain if with_it[k] != plain[k]}


SKILLS = [name for _id, name, _stat in SKILL_LIST]
PASSIVES = ["passive perception", "passive investigation", "passive insight"]
SIX_SAVES = [f"{a} save" for a in ("STR", "DEX", "CON", "INT", "WIS", "CHA")]


# --- the rows ---------------------------------------------------------------------------

def test_a_bonus_is_a_row_with_a_signed_number_and_the_templates_blank_row_goes():
    report = sync_text(TEMPLATE, ringed())
    assert bonus_rows(report.text) == ["| Saves | +1 | Ring of Protection |"]
    assert ("ADD", f"{AT} / Saves (Ring of Protection)", "not in the note; added") in report.rows
    assert report.seen["bonuses"] == ["saves | ring of protection"]
    minus = sync_text(TEMPLATE, ringed(-2))
    assert bonus_rows(minus.text) == ["| Saves | -2 | Ring of Protection |"]


def test_a_character_with_no_bonus_leaves_the_table_as_it_is_and_remembers_an_empty_list():
    report = sync_text(TEMPLATE, wizard())
    assert BLANK in report.text and report.seen["bonuses"] == []
    assert not [r for r in report.rows if r[1].startswith(AT)]


def test_the_bonus_rows_are_written_before_the_fill_so_one_sync_gives_the_finished_numbers():
    report = sync_text(TEMPLATE, ringed())
    order = [r[0] for r in report.rows]
    at = next(i for i, r in enumerate(report.rows) if r[1].startswith(AT))
    assert at < order.index("FILL")
    assert ("FILL", "Stat Sheet / Ability Scores / CON / Save", "+0 -> +3 (incl. +1 Ring of Protection)") in report.rows
    assert [r for r in dnd_sheet.plan(report.text) if r.status == "FILL"] == []
    assert [f for f in dnd_rules.check(report.text) if f.status == "WRONG"] == []


def test_a_second_and_a_third_sync_have_nothing_to_do():
    data = wizard([RING, STONE], [SAVES_1, *LUCK])
    first = sync_text(TEMPLATE, data)
    assert bonus_rows(first.text) == ["| Saves | +1 | Ring of Protection |", "| Skills | +1 | Stone of Good Luck |",
                                      "| Initiative | +1 | Stone of Good Luck |", "| Saves | +1 | Stone of Good Luck |"]
    second = sync_text(first.text, data, first.seen)
    third = sync_text(second.text, data, second.seen)
    assert second.rows == [] and third.rows == [] and third.text == first.text
    assert sync_text(first.text, data).rows == []                      # and with the memory lost


# --- nothing counted twice -----------------------------------------------------------------

def test_an_item_adding_one_to_ability_checks_and_initiative_moves_each_by_exactly_one():
    data = wizard([STONE], LUCK[:2])
    assert moved(data) == {k: 1 for k in SKILLS + PASSIVES + ["initiative"]}


def test_a_bonus_to_ability_checks_alone_is_not_added_to_initiative_as_the_site_does_not():
    assert moved(wizard([STONE], LUCK[:1])) == {k: 1 for k in SKILLS + PASSIVES}


def test_a_bonus_to_saves_moves_the_six_saves_and_nothing_else():
    assert moved(ringed(2)) == {k: 2 for k in SIX_SAVES}
    one = wizard([RING], [("item", "bonus", "wisdom-saving-throws", 3)])
    assert moved(one) == {"WIS save": 3}


def test_half_proficiency_is_counted_once_in_each_skill_and_once_in_initiative():
    jack = dict(class_features=(("Jack of All Trades", None, None),),
                modifiers=(("class", "half-proficiency", "ability-checks", None, {"feature": "Jack of All Trades"}),
                           ("class", "half-proficiency", "initiative", None, {"feature": "Jack of All Trades"})))
    report = sync_text(TEMPLATE, wizard(**jack))
    assert bonus_rows(report.text) == ["| Initiative | +1 | Jack of All Trades |"]
    plain = wizard(class_features=(("Jack of All Trades", None, None),))
    assert moved(wizard(**jack), plain) == {k: 1 for k in SKILLS + PASSIVES + ["initiative"]}     # half of +3, rounded down


def test_a_bonus_to_one_skill_carries_into_its_passive_score_and_a_passive_bonus_stays_there():
    data = wizard([RING], [("item", "bonus", "perception", 2), ("item", "bonus", "passive-insight", 5)])
    assert moved(data) == {"Perception": 2, "passive perception": 2, "passive insight": 5}


def test_spell_bonuses_move_the_spell_attack_and_the_save_dc():
    data = wizard([("Wand of the War Mage", 1, 0, True, True, "gear")],
                  [("item", "bonus", "spell-attacks", 1), ("item", "bonus", "spell-save-dc", 2)])
    assert moved(data) == {"Spell Attack Modifier": 1, "Spell Save DC": 2}


def test_a_conditional_bonus_and_an_unequipped_items_bonus_write_no_row():
    conditional = wizard([RING], [("item", "bonus", "saving-throws", 1, {"restriction": "against spells"})])
    put_away = wizard([RING[:6] + (False,)], [SAVES_1])
    unattuned = wizard([("Ring of Protection", 1, 0, True, False, "gear")], [SAVES_1])
    for data in (conditional, put_away, unattuned):
        report = sync_text(TEMPLATE, data)
        assert BLANK in report.text and moved(data) == {}


# --- whose row it is ----------------------------------------------------------------------

GM_ROWS = ("| Saves | +1 | Blessing of the abbot |", "| Stealth, Perception | -2 | Cursed boots |",
           "| Initiative | Half PB | |", "| Saves | +1 (while it glows) | Ring of Protection |")


def with_gm_rows(text=TEMPLATE, rows=GM_ROWS[:3]):
    return swap(text, BLANK, HEAD + "\n".join(rows) + "\n")


def test_a_gms_own_rows_are_never_touched_removed_or_reported_across_three_syncs():
    text, seen = with_gm_rows(), None
    for data in (ringed(), ringed(2), wizard()):
        report = sync_text(text, data, seen)
        assert bonus_rows(report.text)[:3] == list(GM_ROWS[:3])
        assert not [r for r in report.rows if r[1].startswith(AT) and "Ring of Protection" not in r[1]]
        text, seen = report.text, report.seen
    assert bonus_rows(text) == list(GM_ROWS[:3])                       # the ring's row came and went


def test_a_synced_row_is_updated_when_the_amount_changes():
    first = sync_text(with_gm_rows(), ringed())
    assert bonus_rows(first.text)[3] == "| Saves | +1 | Ring of Protection |"
    second = sync_text(first.text, ringed(2), first.seen)
    assert ("WRITE", f"{AT} / Saves (Ring of Protection) / Bonus", "+1 -> +2") in second.rows
    assert bonus_rows(second.text) == list(GM_ROWS[:3]) + ["| Saves | +2 | Ring of Protection |"]
    assert ("FILL", "Stat Sheet / Ability Scores / CON / Save", "+4 -> +5 (incl. +1 Blessing of the abbot, +2 Ring of Protection)") \
        in second.rows


def test_a_synced_row_is_removed_once_the_item_is_dropped_and_only_with_the_memory():
    first = sync_text(TEMPLATE, ringed())
    kept = sync_text(first.text, wizard())                              # no memory: it may be the GM's
    assert bonus_rows(kept.text) == ["| Saves | +1 | Ring of Protection |"] and not [r for r in kept.rows if r[0] == "REMOVE"]
    gone = sync_text(first.text, wizard(), first.seen)
    assert ("REMOVE", f"{AT} / Saves (Ring of Protection)", "D&D Beyond no longer has it") in gone.rows
    assert bonus_rows(gone.text) == [] and gone.seen["bonuses"] == []
    assert ("FILL", "Stat Sheet / Ability Scores / CON / Save", "+3 -> +2") in gone.rows
    assert sync_text(gone.text, wizard(), gone.seen).rows == []


def test_a_row_is_the_same_bonus_only_when_both_what_it_applies_to_and_its_source_match():
    other_source = swap(TEMPLATE, BLANK, HEAD + "| Saves | +1 | Cloak of Protection |\n| Wisdom Save | +1 | Ring of Protection |\n")
    report = sync_text(other_source, ringed(), {"bonuses": ["saves | cloak of protection", "wisdom save | ring of protection"]})
    assert sorted(r[1] for r in report.rows if r[0] == "REMOVE") == [f"{AT} / Saves (Cloak of Protection)",
                                                                    f"{AT} / Wisdom Save (Ring of Protection)"]
    assert bonus_rows(report.text) == ["| Saves | +1 | Ring of Protection |"]


def test_a_hand_written_row_d_and_d_beyond_also_gives_is_matched_whatever_its_case_and_then_remembered():
    hand = swap(TEMPLATE, BLANK, HEAD + "| saves | 3 | ring  of protection |\n")
    report = sync_text(hand, ringed())
    assert bonus_rows(report.text) == ["| saves | +1 | ring  of protection |"]
    assert report.seen["bonuses"] == ["saves | ring of protection"]
    assert sync_text(report.text, ringed(), report.seen).rows == []
    plain = swap(TEMPLATE, BLANK, HEAD + "| Saves | 1 | Ring of Protection |\n")
    assert not [r for r in sync_text(plain, ringed()).rows if r[1].startswith(AT)]     # 1 and +1 are the same number


def test_a_synced_row_given_a_reason_in_brackets_is_kept():
    first = sync_text(TEMPLATE, ringed())
    hand = swap(first.text, "| Saves | +1 | Ring of Protection |", GM_ROWS[3])
    report = sync_text(hand, ringed(2), first.seen)
    assert bonus_rows(report.text) == [GM_ROWS[3]]
    assert ("KEPT", f"{AT} / Saves (Ring of Protection) / Bonus", "+1 (while it glows); D&D Beyond gives +2") in report.rows
    assert not [r for r in report.rows if r[1].startswith(AT) and r[0] in ("WRITE", "ADD", "REMOVE")]


def test_a_second_row_of_the_same_bonus_is_the_gms_and_is_left_alone():
    first = sync_text(TEMPLATE, ringed())
    twice = swap(first.text, "| Saves | +1 | Ring of Protection |", "| Saves | +1 | Ring of Protection |\n| Saves | +4 | Ring of Protection |")
    gone = sync_text(twice, wizard(), first.seen)
    assert bonus_rows(gone.text) == ["| Saves | +4 | Ring of Protection |"]


def test_a_deleted_synced_row_comes_back():
    first = sync_text(TEMPLATE, ringed())
    hand = swap(first.text, "| Saves | +1 | Ring of Protection |\n", "")
    again = sync_text(hand, ringed(), first.seen)
    assert bonus_rows(again.text) == ["| Saves | +1 | Ring of Protection |"]


# --- the note's shape ---------------------------------------------------------------------

def test_a_note_with_no_bonuses_table_gets_one_kept_row_saying_how_many_were_not_written():
    bare = swap(TEMPLATE, "### Bonuses\n\n" + BLANK + "\n", "")
    one = sync_text(bare, ringed())
    assert ("KEPT", AT, "the note has no Bonuses table; 1 bonus was not written") in one.rows
    two = sync_text(bare, wizard([RING, STONE], [SAVES_1, *LUCK]))
    assert ("KEPT", AT, "the note has no Bonuses table; 4 bonuses were not written") in two.rows
    assert "### Bonuses" not in two.text
    assert not [r for r in sync_text(bare, wizard()).rows if r[1].startswith(AT)]


def test_a_bonuses_table_without_a_source_column_is_not_written_to():
    old = swap(TEMPLATE, BLANK, "| Applies To | Bonus |\n|---|---|\n| Saves | +1 |\n")
    report = sync_text(old, ringed())
    assert "| Saves | +1 |\n" in report.text and "Ring of Protection |" not in report.text.split("### Defences")[0]
    assert ("KEPT", AT, "the note has no Bonuses table; 1 bonus was not written") in report.rows


def test_crlf_rows_keep_crlf():
    report = sync_text(TEMPLATE.replace("\n", "\r\n"), ringed())
    assert "| Saves | +1 | Ring of Protection |\r\n" in report.text
    assert "\n" not in report.text.replace("\r\n", "")


def test_plan_bonuses_plans_against_the_text_it_is_given():
    c = read(ringed())
    edits = plan_bonuses(TEMPLATE, c)
    assert [(e.status, e.silent) for e in edits] == [("REMOVE", True), ("ADD", False)]
    text = write_rows(TEMPLATE, edits)
    assert [e.status for e in plan_bonuses(text, c)] == ["SAME"]


# --- a hand-written bonus that shares a source with one sync writes -------------------------

TWICE = "the note already has a bonus from {0}; if it is the same one, it is counted twice"
STONED = [STONE], LUCK


def checks(report):
    return [r for r in report.rows if r[0] == "CHECK" and r[1].startswith(AT)]


def test_a_gms_row_for_the_same_item_in_other_words_gets_one_check_and_is_not_touched():
    mine = "| Ability Checks, Saves | +1 | stone of  good luck |"
    text = swap(TEMPLATE, BLANK, HEAD + mine + "\n| Initiative | +1 | Stone of Good Luck (again) |\n")
    first = sync_text(text, wizard(*STONED))
    assert checks(first) == [("CHECK", f"{AT} / stone of  good luck", TWICE.format("stone of  good luck"))]
    assert bonus_rows(first.text)[:2] == [mine, "| Initiative | +1 | Stone of Good Luck (again) |"]
    assert len(bonus_rows(first.text)) == 5                           # sync's three rows went in beside them
    second = sync_text(first.text, wizard(*STONED), first.seen)
    assert second.rows == checks(first) and second.text == first.text  # said again, nothing written
    gone = swap(first.text, mine + "\n", "")
    after = sync_text(gone, wizard(*STONED), second.seen)
    assert {r[0] for r in after.rows} == {"FILL"}                      # the numbers lose what was counted twice
    assert ("FILL", "Stat Sheet / Ability Scores / STR / Save", "+1 -> +0 (incl. +1 Stone of Good Luck)") in after.rows


def test_two_rows_of_the_gms_from_one_source_are_one_check():
    text = swap(TEMPLATE, BLANK, HEAD + "| Ability Checks | +1 | Stone of Good Luck |\n| Stealth | +1 | Stone of Good Luck |\n")
    assert len(checks(sync_text(text, wizard(*STONED)))) == 1


def test_a_gms_row_from_another_source_gets_no_check():
    assert checks(sync_text(with_gm_rows(), wizard(*STONED))) == []
    assert checks(sync_text(with_gm_rows(), wizard())) == []


def test_a_row_sync_matched_and_took_over_gets_no_check():
    hand = swap(TEMPLATE, BLANK, HEAD + "| saves | 3 | ring  of protection |\n")
    assert checks(sync_text(hand, ringed())) == []


def test_a_row_sync_removes_gets_no_check_and_a_source_d_and_d_beyond_no_longer_gives_gets_none():
    first = sync_text(TEMPLATE, wizard([RING, STONE], [SAVES_1, *LUCK]))
    hand = swap(first.text, "| Saves | +1 | Ring of Protection |", "| Saves | +1 | Ring of Protection |\n| Wisdom Save | +1 | Ring of Protection |")
    assert len(checks(sync_text(hand, wizard([RING, STONE], [SAVES_1, *LUCK]), first.seen))) == 1
    dropped = sync_text(hand, wizard([STONE], LUCK), first.seen)
    assert checks(dropped) == [] and "| Wisdom Save | +1 | Ring of Protection |" in dropped.text


# --- the player's own adjustments ------------------------------------------------------------

def test_a_players_own_skill_adjustment_is_a_row_and_moves_that_skill_and_its_passive():
    data = wizard(character_values=((24, 2, "14", 1958004211),))      # skill id 14 is Perception
    report = sync_text(TEMPLATE, data)
    assert bonus_rows(report.text) == ["| Perception | +2 | Player's adjustment |"]
    assert moved(data) == {"Perception": 2, "passive perception": 2}
    assert sync_text(report.text, data, report.seen).rows == []

#!/usr/bin/env python3
"""Names that come to nothing: skipped with a row, never added again and again. No network."""

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_ddb  # noqa: E402
from ddb_builder import character, weapon  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402
from dnd_ddb_read import Character  # noqa: E402,F401

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
SYMBOLS = "★★"
BLADE = ((SYMBOLS, 1, 2, False, False, "weapon"),)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def quiet(report):
    return [r for r in report.rows if r[0] in ("WRITE", "ADD", "REMOVE", "FILL", "KEPT")]


def test_an_attack_with_no_name_is_skipped_with_a_row_and_never_added():
    data = character(inventory=BLADE, item_details={SYMBOLS: weapon("1d6", "Slashing")})
    first = sync_text(TEMPLATE, data)
    skipped = [r for r in first.rows if r[0] == "CHECK" and r[1] == dnd_ddb.ATTACK_LOCUS]
    assert len(skipped) == 1 and "no usable name" in skipped[0][2]
    assert not [r for r in first.rows if r[0] == "ADD" and r[1].endswith(" / ")]
    second = sync_text(first.text, data, first.seen)
    third = sync_text(second.text, data, second.seen)
    assert quiet(second) == [] and quiet(third) == [] and third.text == first.text
    assert [r for r in third.rows if r[0] == "CHECK" and r[1] == dnd_ddb.ATTACK_LOCUS]    # a standing true statement


def test_a_gear_item_a_feat_and_a_spell_with_no_name_each_print_one_row():
    data = character(inventory=((SYMBOLS, 1, 1, False, False, "gear"),), feats=((SYMBOLS,),),
                     spells=((SYMBOLS, 1, True, False, False, False, (1,), "Wizard"),))
    rows = sync_text(TEMPLATE, data).rows
    for locus in ("Equipment / Gear", "Feats", "Spells"):
        assert len([r for r in rows if r[0] == "CHECK" and r[1] == locus]) == 1


def test_a_feat_named_with_dashes_is_a_row_and_not_a_divider():
    data = character(feats=(("Alert",), ("---",)))
    first = sync_text(TEMPLATE, data)
    assert "| --- |" in first.text
    second = sync_text(first.text, data, first.seen)
    assert quiet(second) == [] and second.text == first.text
    assert second.text.count("| --- |") == 1


@pytest.mark.parametrize("name", ["Gloomwright (archived)", "Gloom, Wright", "Gloom/Wright", "Gloomwright 2"])
def test_a_class_line_the_fill_cannot_read_back_is_silent_on_the_second_sync(name):
    data = character(classes=((name, 5, "", None),), hit_points={"base": 20})
    first = sync_text(TEMPLATE, data)
    second = sync_text(first.text, data, first.seen)
    assert [r for r in second.rows if r[1] == "Background / Class/Subclass"] == []
    assert second.text == first.text


def test_a_class_name_in_brackets_follows_a_change_through_the_memory():
    first = sync_text(TEMPLATE, character(classes=(("Gloomwright (archived)", 5, "", None),), hit_points={"base": 20}))
    third = sync_text(first.text, character(classes=(("Gloomwright (archived)", 6, "", None),), hit_points={"base": 20}), first.seen)
    assert any(r[0] == "WRITE" and r[1] == "Background / Class/Subclass" for r in third.rows)


def test_a_spell_level_outside_zero_to_nine_is_skipped_with_a_row():
    for level in (10, -1, 400):
        data = character(spells=(("Zzyx Bolt", level, True, False, False, False, (1,), "Wizard"),
                                 ("Fire Bolt", 0, True, False, False, False, (1,), "Wizard")))
        first = sync_text(TEMPLATE, data)
        assert not [r for r in first.rows if r[0] == "ERROR"]
        assert [r for r in first.rows if r[0] == "CHECK" and r[1] == "Spells" and "level outside 0 to 9" in r[2]]
        assert "Zzyx Bolt" not in first.text and "Fire Bolt" in first.text
        assert [r for r in sync_text(first.text, data, first.seen).rows if r[0] != "CHECK"] == []


@pytest.mark.parametrize("weight", [float("inf"), float("-inf"), float("nan"), 1e999])
def test_a_weight_that_is_not_finite_reads_as_no_weight(weight):
    data = character(inventory=(("Zzyx Sack", 1, weight, False, False, "gear"),))
    report = sync_text(TEMPLATE, data)
    assert not [r for r in report.rows if r[0] == "ERROR"]
    assert "| Zzyx Sack | 1 | — |" in report.text


def test_nothing_but_a_row_leaves_sync_text(monkeypatch):
    def boom(*args, **kwargs):
        raise ZeroDivisionError("boom")
    monkeypatch.setattr(dnd_ddb, "plan_cells", boom)
    report = sync_text(TEMPLATE, character())
    assert report.rows == [("ERROR", "sync", "could not be synced (ZeroDivisionError); nothing was written")]
    assert report.text == TEMPLATE

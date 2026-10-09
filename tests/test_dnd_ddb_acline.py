#!/usr/bin/env python3
"""The `**Armour Class:**` line follows the armour class while it is the line sync wrote. No network."""

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_ddb  # noqa: E402
from ddb_builder import armour, character  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
LEATHER = ("Leather Armor", 1, 10, False, False, "armor")
BASE = dict(hit_points={"base": 25}, inventory=(LEATHER,))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def wearing(armor_class):
    return character(**BASE, item_details={"Leather Armor": armour(armor_class)})


def line_of(text):
    return next(ln for ln in text.splitlines() if ln.startswith("**Armour Class:**"))


def ac_rows(report):
    return [r for r in report.rows if "Armour Class" in r[1] and r[1].startswith("Stat Sheet / Defences")]


def test_the_line_follows_the_armour_class_while_it_is_the_one_sync_wrote():
    first = sync_text(TEMPLATE, wearing(11))
    assert line_of(first.text) == "**Armour Class:** Leather Armor 11 + Dex 2"
    second = sync_text(first.text, wearing(11), first.seen)
    assert second.text == first.text and ac_rows(second) == []
    better = sync_text(second.text, wearing(12), second.seen)
    assert ("WRITE", dnd_ddb.AC_LINE, "Leather Armor 11 + Dex 2 -> Leather Armor 12 + Dex 2") in better.rows
    assert line_of(better.text) == "**Armour Class:** Leather Armor 12 + Dex 2"
    assert "| AC | 14 |" in better.text
    assert [r for r in sync_text(better.text, wearing(12), better.seen).rows if r[0] != "CHECK"] == []


def test_a_line_the_gm_changed_is_left_and_said_only_when_it_no_longer_adds_up():
    first = sync_text(TEMPLATE, wearing(11))
    mine = first.text.replace("Leather Armor 11 + Dex 2", "Leather 11 + Dex 2")
    same_sum = sync_text(mine, wearing(11), first.seen)
    assert line_of(same_sum.text) == "**Armour Class:** Leather 11 + Dex 2" and [r for r in same_sum.rows if r[1] == dnd_ddb.AC_LINE] == []
    stale = sync_text(mine, wearing(12), first.seen)
    assert line_of(stale.text) == "**Armour Class:** Leather 11 + Dex 2"
    said = [r for r in stale.rows if r[1] == dnd_ddb.AC_LINE]
    assert len(said) == 1 and said[0][0] == "CHECK" and "adds up to 13" in said[0][2] and "says 14" in said[0][2]


def test_a_note_with_no_memory_treats_a_filled_line_as_the_gms():
    first = sync_text(TEMPLATE, wearing(11))
    later = sync_text(first.text, wearing(12))
    assert line_of(later.text) == "**Armour Class:** Leather Armor 11 + Dex 2"
    assert len([r for r in later.rows if r[1] == dnd_ddb.AC_LINE]) == 1


def test_an_older_memory_with_no_line_entry_still_loads():
    first = sync_text(TEMPLATE, wearing(11))
    older = {k: v for k, v in first.seen.items() if k != "cells"}
    again = sync_text(first.text, wearing(11), older)
    assert again.text == first.text

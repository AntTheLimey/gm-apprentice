#!/usr/bin/env python3
"""A value D&D Beyond itself gives that ends in a bracket group is sync's, not a GM's reason. No network."""

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from ddb_builder import area, character  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
HANDS = ("Burning Hands", 1, True, False, False, False, (1, 2), "Wizard")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def silent(report):
    """Nothing written, added, removed, filled or kept (a standing CHECK may stay)."""
    return [r for r in report.rows if r[0] != "CHECK"] == []


def synced_twice(**kwargs):
    first = sync_text(TEMPLATE, character(**kwargs))
    second = sync_text(first.text, character(**kwargs), first.seen)
    return first, second


def test_an_area_spell_range_is_silent_on_the_second_sync_and_follows_a_change():
    kwargs = dict(spells=(HANDS,), spell_details={"Burning Hands": area("Cone", 15)})
    first, second = synced_twice(**kwargs)
    assert "Self (15-ft cone)" in first.text
    assert silent(second) and second.text == first.text
    wider = character(spells=(HANDS,), spell_details={"Burning Hands": area("Cone", 30)})
    third = sync_text(second.text, wider, second.seen)
    assert ("WRITE", "Spells / Burning Hands / Range", "Self (15-ft cone) -> Self (30-ft cone)") in third.rows
    assert "Self (30-ft cone)" in third.text
    assert silent(sync_text(third.text, wider, third.seen))


def test_a_bracketed_feat_source_is_silent_and_follows_a_change():
    feat = dict(feats=(("Magic Initiate (Wizard)",),))
    spell = ("Burning Hands", 1, True, False, False, False, (1, 2), "Feat: Magic Initiate (Wizard)")
    first, second = synced_twice(spells=(spell,), **feat)
    assert "Feat: Magic Initiate (Wizard)" in first.text
    assert silent(second)
    other = character(spells=(HANDS,), **feat)
    third = sync_text(second.text, other, second.seen)
    assert any(r[0] == "WRITE" and r[1] == "Spells / Burning Hands / Source" for r in third.rows)
    assert silent(sync_text(third.text, other, third.seen))


def test_a_bracketed_species_is_silent_and_follows_a_change():
    first, second = synced_twice(species="Elf (Wood)")
    assert "**Species:** Elf (Wood)" in first.text
    assert silent(second)
    human = character(species="Human")
    third = sync_text(second.text, human, second.seen)
    assert ("WRITE", "Background / Species", "Elf (Wood) -> Human") in third.rows
    assert silent(sync_text(third.text, human, third.seen))


def test_a_bracketed_background_follows_a_change():
    first, second = synced_twice(background="Sage (Variant)")
    assert silent(second)
    third = sync_text(second.text, character(background="Sage"), second.seen)
    assert ("WRITE", "Background / Background", "Sage (Variant) -> Sage") in third.rows


def test_a_reason_the_gm_wrote_is_still_kept():
    first = sync_text(TEMPLATE, character(species="Elf (Wood)"))
    hand = first.text.replace("**Species:** Elf (Wood)", "**Species:** Elf (Wood) (changeling)")
    second = sync_text(hand, character(species="Human"), first.seen)
    assert any(r[0] == "KEPT" and r[1] == "Background / Species" for r in second.rows)
    assert "Elf (Wood) (changeling)" in second.text


def test_a_bracketed_cell_with_no_memory_is_the_gms():
    first = sync_text(TEMPLATE, character(species="Elf (Wood)"))
    second = sync_text(first.text, character(species="Human"))
    assert any(r[0] == "KEPT" and r[1] == "Background / Species" for r in second.rows)

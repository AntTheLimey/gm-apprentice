#!/usr/bin/env python3
"""Hostile names from D&D Beyond stay in their cell. Each string goes through the real path
(ddb_builder -> dnd_ddb_read.read inside sync_text -> note); no network."""

import difflib
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from ddb_builder import character, weapon  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402
from dnd_note import split_cells  # noqa: E402
from test_dnd_ddb_page import INVENTORY, SPELLS, TEMPLATE, build_site, needs_node, warnings  # noqa: E402

HARMLESS = "Zed"
WIDE = "Ｗ" * 80                       # 80 full-width letters
STRINGS = [
    "a|b", "|", "||", "| x |", "a\nb", "a\r\nb", "a\rb", "a\u2028b", "a\u2029b", "a\vb", "a\fb", "a\x85b",
    "## GM Notes", "\n## GM Notes\n", "# Heading", "<!-- gm-only -->", "<!-- /gm-only -->",
    "<!-- gm-only -->LEAK<!-- /gm-only -->", "%%", "%% hidden %%", "[[Secret]]", "![[Secret.png]]",
    "[x](http://e)", "`", "```", "**", "__bold__", "</td>", "</td></tr></table>", "<script>alert(1)</script>",
    "{{", "{{x}}", "{list}", "> quote", "- item", "1. item", "---", "***", "\\", "\\|", "&amp;", "&", "'", '"',
    "A" * 5000, "", "   ", "\t", "\u202eevil", "a\u202eb", "a\u200bb", "a\x00b", "\x00", "\ufeff",
    "(x)", "Thing (gift)", "HP (Current)", "AC", "HP (Max)", "Level", WIDE, "界" * 80, "Zed" + "\u0301" * 200,
    "x\n| fake | row |", "x\r\n## Heading",
    "x: y", "Name (", ") (", "[[", "]]", "[", "]",
]
assert len(STRINGS) >= 40


def field_kwargs(field, value):
    """The builder arguments that put `value` into one name field."""
    known = dict(hit_points={"base": 25}, spells=SPELLS, inventory=INVENTORY, feats=(("Alert",),),
                 item_details={"Dagger": weapon("1d4", "Piercing", properties=("Finesse", "Light"))})
    if field == "name":
        return {**known, "name": value}
    if field == "class":
        spells = tuple(s[:7] + (value,) for s in SPELLS)
        return {**known, "classes": ((value, 5, "Evoker", 4),), "spells": spells}
    if field == "subclass":
        return {**known, "classes": (("Wizard", 5, value, 4),)}
    if field == "species":
        return {**known, "species": value}
    if field == "background":
        return {**known, "background": value}
    if field == "feature":
        return {**known, "class_features": ((value, 1, 2),)}
    if field == "feat":
        return {**known, "feats": ((value,),)}
    if field == "spell":
        return {**known, "spells": ((value, 0, True, False, False, False, (1, 2), "Wizard"),) + SPELLS[1:]}
    if field == "item":
        return {**known, "inventory": INVENTORY + ((value, 1, 1, False, False, "gear"),)}
    if field == "magic item":
        return {**known, "inventory": INVENTORY + ((value, 1, 0, True, True, "gear"),)}
    if field == "language":
        return {**known, "modifiers": (("background", "language", "common", None, {"friendlySubtypeName": value}),)}
    if field == "resistance":
        return {**known, "modifiers": (("race", "resistance", "fire", None, {"friendlySubtypeName": value}),)}
    if field == "bonus source":      # the Source cell of a `### Bonuses` row is the name of the feat that gives the bonus
        return {**known, "feats": (("Alert",), (value,)),
                "modifiers": (("feat", "bonus", "saving-throws", 1, {"feat": value}),)}
    if field == "bonus item":        # and the commoner source: the name of the item that gives it
        return {**known, "inventory": INVENTORY + ((value, 1, 0, True, True, "gear"),),
                "modifiers": (("item", "bonus", "saving-throws", 1, {"item": value}),)}
    raise AssertionError(field)


# Cells worked out from the gear: a name that drops an item moves the weight carried.
WORKED_FROM_GEAR = ("| Carried Weight |", "| Encumbrance |")
FIELDS = ["name", "class", "subclass", "species", "background", "feature", "feat", "spell", "item",
          "magic item", "language", "resistance", "bonus source", "bonus item"]


def synced(field, value, text=TEMPLATE):
    return sync_text(text, character(**field_kwargs(field, value)))


def lines_of(text):
    return text.split("\n")          # not splitlines: U+2028 and friends are not line ends here


def flatten(value):
    """What a name must come to before it is written: letters, digits, spaces and ' - , . / + ( ) : &,
    at most 80 characters. Written out here so a weakened safe_name cannot weaken the expectation."""
    s = value.replace("\u2019", "'").replace("\u2018", "'")
    s = "".join(ch if ch.isalnum() or ch in "'-,./+():&" else " " for ch in s)
    return " ".join(s.split())[:80].rstrip()


def squash(line):
    return " ".join(line.split())


def header_cells(lines, at):
    """The cell count of the header of the table the row at `at` is in."""
    top = at
    while top > 0 and lines[top - 1].startswith("|"):
        top -= 1
    return len(split_cells(lines[top]))


def special(lines):
    return sorted(ln for ln in lines if ln.startswith(("#", "<!--", "%%")))


def blocks(harmless, hostile):
    """(lines of the harmless run, lines of the hostile run) for every stretch where they differ."""
    a, b = lines_of(harmless), lines_of(hostile)
    return [(a[i1:i2], b[j1:j2], j1) for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
            if tag != "equal"]


@pytest.fixture(scope="module")
def harmless_runs():
    runs = {f: synced(f, HARMLESS) for f in FIELDS}
    for f, run in runs.items():
        assert not [r for r in run.rows if r[0] == "ERROR"], f
    return runs


@pytest.mark.parametrize("field", FIELDS)
@pytest.mark.parametrize("value", STRINGS, ids=lambda v: repr(v)[:24])
def test_a_hostile_name_stays_in_its_own_cell(field, value, harmless_runs):
    base = harmless_runs[field]
    run = synced(field, value)                                       # must not raise
    assert not [r for r in run.rows if r[0] == "ERROR"], run.rows
    a, b = lines_of(base.text), lines_of(run.text)
    assert abs(len(a) - len(b)) <= 1, (len(a), len(b))
    # Every line outside the cell or row the field feeds is byte-identical to the harmless run.
    span = 4 if field == "class" else 2           # a class also feeds the Source cell of each spell row
    flat = flatten(value)
    renamed = {squash(ln.replace(HARMLESS, flat)) for ln in a}
    if not flat:        # nothing left of the name: the line falls back to its template text, a dash, the data's own default, or the source's kind
        template = set(map(squash, lines_of(TEMPLATE)))
        renamed |= template | {squash(ln.replace(f" ({HARMLESS})", "").replace(HARMLESS, word)) for ln in a for word in ("", "Fire", "Common", "Feat", "Item")}
        renamed |= {squash(ln) for ln in b if ln.endswith(" —")}
    for old, new, at in blocks(base.text, run.text):
        assert len(old) <= span and len(new) <= span, (old, new)
        for ln in old + new:
            assert ln.startswith(("|", "**")), ln                    # a table row or a labelled line
        assert all(HARMLESS in ln or ln.startswith(WORKED_FROM_GEAR) for ln in old), old   # only lines the name fed
        for n, ln in enumerate(new):
            # A new line is the harmless run's line with the name flattened in (the paired rewrite, or the one
            # added row of the affected table), or a figure worked out from the gear. Nothing else rides in.
            assert squash(ln) in renamed or ln.startswith(WORKED_FROM_GEAR), ln
            if ln.startswith("|"):                                   # same number of cells as the table's header
                assert len(split_cells(ln)) == header_cells(b, at + n), ln
    assert special(b) == special(a)
    assert not any(ln.startswith("#") and ln not in a for ln in b)
    assert "\r" not in run.text and "\x00" not in run.text and "\u2028" not in run.text
    assert "<!--" not in run.text and "%%" not in run.text


@pytest.mark.parametrize("field", ["item", "magic item", "spell", "feat", "feature"])
def test_eighty_wide_letters_make_one_row_of_at_most_eighty_characters(field):
    run = synced(field, WIDE)
    row = next(ln for ln in lines_of(run.text) if WIDE[:10] in ln)
    first = row.split("|")[1].strip()
    assert first == WIDE and len(first) == 80
    assert len(lines_of(run.text)) - len(lines_of(synced(field, HARMLESS).text)) == 0


@pytest.mark.parametrize("name", ["HP (Current)", "AC", "HP (Max)", "Temp HP", "Level", "Initiative"])
@pytest.mark.parametrize("field", ["item", "magic item", "spell", "feat", "feature"])
def test_a_name_equal_to_a_stat_sheet_label_changes_no_stat_cell(field, name):
    plain = synced(field, HARMLESS).text
    run = synced(field, name).text
    stat = lambda t: t[t.index("## Stat Sheet"):t.index("## Background")]  # noqa: E731
    assert stat(run) == stat(plain)
    assert "| HP (Current) | |" in stat(run)


def test_a_name_that_is_only_brackets_is_a_row_and_a_second_sync_is_quiet():
    data = character(**field_kwargs("item", "(x)"))
    first = sync_text(TEMPLATE, data)
    assert "| (x) | 1 |" in first.text
    second = sync_text(first.text, data)
    assert second.rows == [] and second.text == first.text


def test_a_data_name_with_a_bracket_reason_is_synced_and_removed_like_any_other():
    """Sync writes `Thing (gift)` from D&D Beyond's data; dropped from the data later, the row is
    sync's own and goes."""
    with_item = character(**field_kwargs("item", "Thing (gift)"))
    first = sync_text(TEMPLATE, with_item)
    assert "| Thing (gift) | 1 |" in first.text
    assert sync_text(first.text, with_item, first.seen).rows == []     # the row is stable across syncs
    dropped = sync_text(first.text, character(**field_kwargs("item", HARMLESS)), first.seen)
    assert "Thing (gift)" not in dropped.text
    assert ("REMOVE", "Equipment / Gear / Thing (gift)", "D&D Beyond no longer has it") in dropped.rows


def test_a_bracketed_row_is_kept_when_the_memory_is_lost():
    first = sync_text(TEMPLATE, character(**field_kwargs("item", "Thing (gift)")))
    kept = sync_text(first.text, character(**field_kwargs("item", HARMLESS)))
    assert "Thing (gift)" in kept.text and not [r for r in kept.rows if "Thing (gift)" in r[1]]


WORST = ["x | y\n## GM Notes\n<!-- gm-only -->LEAKWORD<!-- /gm-only --> %% [[Secret]] </td>{{ `**`",
         "a\u2028## GM Notes\u2028<!-- gm-only -->LEAKWORD"]


@needs_node
def test_the_page_build_of_every_field_with_the_worst_strings_is_clean(tmp_path):
    """One build for all of it: a PC note per field and per worst string."""
    notes = {}
    for field in FIELDS:
        for n, value in enumerate(WORST):
            text = synced(field, value).text
            text = text.replace("{Keeper-only notes. Protected — skills never modify.}", "GMSECRETMARK")
            assert "GMSECRETMARK" in text
            notes[f"Pc_{field.replace(' ', '_')}_{n}.md"] = text
    output, pages = build_site(tmp_path, notes)
    assert warnings(output) == []
    assert len(pages) == len(notes)
    for slug, html in pages.items():
        assert "GMSECRETMARK" not in html, slug                       # the GM Notes section stayed fenced off
        assert "<!-- gm-only" not in html and "<!-- /gm-only" not in html, slug
        assert "feat" in slug or 'class="dnd5e-entry-name">Alert<' in html, slug   # what follows the hostile cell still shows

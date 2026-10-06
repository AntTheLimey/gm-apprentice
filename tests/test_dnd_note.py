#!/usr/bin/env python3
"""Tests for dnd_note.py: reading a D&D PC note."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import dnd_note as dn  # noqa: E402

NOTE = """---
type: pc
---

## Stat Sheet

### Core

| Attribute | Value |
|---|---|
| Level | 5 |

## Background

**Species:** [[Dwarf]]

**Class/Subclass:** Wizard 5 (Evoker)

```text
**Class/Subclass:** Rogue 9 (Thief)
```
"""


def test_number_reads_bare_and_reasoned():
    assert dn.number("5") == (5, False)
    assert dn.number(" +5 ") == (5, False)
    assert dn.number("5 (ring of spell storing)") == (5, True)
    assert dn.number("") == (None, False)
    assert dn.number("2d4") == (None, False)
    assert dn.number("—") == (None, False)


def test_note_table_and_attr():
    note = dn.Note(NOTE)
    assert note.attr("stat sheet", "core", "level").text == "5"
    assert note.attr("stat sheet", "core", "xp") is None
    assert note.table("skills") == []


def test_bold_reads_the_line_and_skips_fenced_code():
    note = dn.Note(NOTE)
    assert note.bold("class/subclass") == "Wizard 5 (Evoker)"
    assert note.bold("species") == "[[Dwarf]]"
    assert note.bold("background") is None


def test_bold_survives_crlf():
    assert dn.Note(NOTE.replace("\n", "\r\n")).bold("class/subclass") == "Wizard 5 (Evoker)"

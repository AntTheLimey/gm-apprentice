"""prop_move.py: a vault's own props become prop notes, the site is checked
against what is live, and the old way is retired, or the vault is put back.

Every vault and site here is made up for the test (original text, shaped
like the two layouts the move reads)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import prop_move  # noqa: E402

# --- the build_props layout (15a) ----------------------------------------------

STYLESHEET = """/* The looks.
   .gull-hand   a sailor's hand
*/
.terminal { font-family: 'VT323', monospace; }
.gull-hand { position: absolute;
  font-family: 'Gochi Hand', cursive; font-size: 3cqw; }
.wren-hand, .spare { font-family: "Nanum Pen Script", cursive; }
.wren-hand .hard { font-family: 'Not This One', cursive; }
"""

LETTER = """---
type: reference
doc_kind: handout
campaign: "Test"
prop: gull-letter.html
prop_look: hand
prop_title: "A Note from Gull"
prop_plate: "Left under the hatch"
prop_blurb: "The note that was waiting in the hold."
prop_frank: "PAID|3 CR"
prop_hand: gull-hand
prop_hand_shift: "~~~~"
prop_group: "Gull: background"
prop_breaks: ["PS"]
for_player: "Ana"
offered_to: "Ana"
---

# Handout: A Note from Gull

> A note in an old friend's hand.

## The document (in-world)

Torn from a logbook, the ink run where it got wet.

```
Ana, the pumps are fixed.
Do not trust the harbourmaster.
~~~~
PS burn this
```

---

## GM Notes

Gull wrote it the night before he left.
"""


def vault_with(tmp_path: Path, notes: dict[str, str], css: str | None = STYLESHEET) -> Path:
    vault = tmp_path / "vault"
    for rel, text in notes.items():
        p = vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
    if css is not None:
        p = vault / "Chapters" / "Chapter 1 - The Run" / "Props" / "props.css"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(css, encoding="utf-8")
    return vault


def test_build_props_note_converted() -> None:
    crlf = LETTER.replace("\n", "\r\n")
    new, hand, why = prop_move.convert_build_props_note(crlf)
    assert why is None and hand == "gull-hand"
    assert new is not None
    # Line endings kept: no bare \n left.
    assert "\n" not in new.replace("\r\n", "")
    fm = new.split("\r\n---\r\n", 1)[0].split("\r\n")[1:]
    assert fm == [
        "type: prop",
        "doc_kind: handout",
        'campaign: "Test"',
        'prop_title: "A Note from Gull"',
        'prop_plate: "Left under the hatch"',
        'prop_line: "The note that was waiting in the hold."',
        'prop_frank: "PAID"',
        'prop_frank_amount: "3 CR"',
        "prop_hand: gull",
        'prop_shift: "~~~~"',
        'prop_group: "Gull: background"',
        'prop_breaks: ["PS"]',
        'for_player: "Ana"',
        'offered_to: "Ana"',
        "prop_style: hand",
        "prop_address: props/gull-letter.html",
    ]
    # A quoted hand keeps its quotes.
    quoted, _, _ = prop_move.convert_build_props_note(
        LETTER.replace("prop_hand: gull-hand", 'prop_hand: "gull-hand"'))
    assert quoted is not None and 'prop_hand: "gull"\n' in quoted


def test_description_moves_above_the_text() -> None:
    new, _, _ = prop_move.convert_build_props_note(LETTER)
    assert new is not None
    body = new.split("\n---\n", 1)[1]
    assert "## The document (in-world)" not in body
    assert ("> A note in an old friend's hand.\n\n"
            "Torn from a logbook, the ink run where it got wet.\n\n"
            "## The Text\n\n```\nAna, the pumps are fixed.\n") in body
    # The fence's lines are exactly as they were.
    assert "Do not trust the harbourmaster.\n~~~~\nPS burn this\n```\n" in body


def test_rule_after_fence_dropped() -> None:
    new, _, _ = prop_move.convert_build_props_note(LETTER)
    assert new is not None
    assert new.endswith("PS burn this\n```\n\n## GM Notes\n\n"
                        "Gull wrote it the night before he left.\n")
    # A rule that is not right after the fence stays.
    later = LETTER.replace("```\n\n---\n\n## GM Notes", "```\n\nSome words.\n\n---\n\n## GM Notes")
    kept, _, _ = prop_move.convert_build_props_note(later)
    assert kept is not None and "```\n\nSome words.\n\n---\n\n## GM Notes" in kept


def test_hands_read_from_stylesheet(tmp_path: Path) -> None:
    wren = LETTER.replace("gull-letter.html", "wren-card.html").replace("gull-hand", "wren-hand")
    vault = vault_with(tmp_path, {"Documents/Gull.md": LETTER, "Documents/Wren.md": wren})
    c = prop_move.convert(vault)
    assert sorted(c.build_props) == ["Documents/Gull.md", "Documents/Wren.md"]
    hands = json.loads(c.batch.texts["_meta/prop-hands.json"])
    assert hands == {"hands": {"gull": {"font": "Gochi Hand", "who": ""},
                               "wren": {"font": "Nanum Pen Script", "who": ""}}}
    assert not [r for r in c.rows if r.startswith(prop_move.PERSON)]
    # Nothing is written: the conversion is held in memory.
    assert not (vault / "_meta" / "prop-hands.json").exists()
    assert (vault / "Documents" / "Gull.md").read_text(encoding="utf-8") == LETTER


def test_unreadable_hand_needs_a_person(tmp_path: Path) -> None:
    ghost = LETTER.replace("gull-hand", "ghost-hand")
    odd = LETTER.replace("gull-letter.html", "odd.html").replace("gull-hand", "Odd_One-hand")
    vault = vault_with(tmp_path, {"Documents/Ghost.md": ghost, "Documents/Odd.md": odd})
    c = prop_move.convert(vault)
    person = [r for r in c.rows if r.startswith(prop_move.PERSON)]
    assert any("Documents/Ghost.md" in r and "hand ghost" in r and "font-family" in r for r in person)
    assert any("Documents/Odd.md" in r and "Odd_One-hand" in r for r in person)
    # No hand is registered for either, but both notes still convert.
    assert "_meta/prop-hands.json" not in c.batch.texts
    assert sorted(c.build_props) == ["Documents/Ghost.md", "Documents/Odd.md"]

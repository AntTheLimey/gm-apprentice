#!/usr/bin/env python3
"""A D&D PC note for tests: a correct Wizard 5 with one thing changed.

SRD 5.2 names and numbers only. Not a test file.
"""

ABILITIES = ("STR", "DEX", "CON", "INT", "WIS", "CHA")
ORDINALS = ("1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th")
WIZARD_5_SLOTS = {1: ("4", "0"), 2: ("3", "0"), 3: ("2", "0")}


def sheet(level=5, classes="Wizard 5 (Evoker)", species="Human", scores=None,
          saves=("INT", "WIS"), hp_now="22", hp_max="22", hit_dice=(("d6", "0/5"),),
          death="0/0", slots=WIZARD_5_SLOTS, spells=(), features=(), feats=(),
          items=(), old_items=None, skills=(("Arcana", "INT", "Yes", "No"),),
          source_column=True, save_column=True):
    """spells: (name, level, tags, source). features and feats: (name, uses, used).
    items: (name, attuned, charges, used). old_items: item names for the earlier
    `### Magic Item Attunement` table, used instead of `items`.
    skills: (name, ability, proficient, expertise)."""
    s = {"STR": "8", "DEX": "14", "CON": "14", "INT": "16", "WIS": "12", "CHA": "10"}
    s.update(scores or {})
    out = ["---", "type: pc", "---", "", "## Stat Sheet", "", "### Core", "",
           "| Attribute | Value |", "|---|---|", f"| Level | {level} |",
           "| Proficiency Bonus | |", "", "### Ability Scores", ""]
    if save_column:
        out += ["| Ability | Score | Modifier | Save Proficiency | Save |", "|---|---|---|---|---|"]
        out += [f"| {a} | {s[a]} | | {'Yes' if a in saves else 'No'} | |" for a in ABILITIES]
    else:
        out += ["| Ability | Score | Modifier |", "|---|---|---|"]
        out += [f"| {a} | {s[a]} | |" for a in ABILITIES]
    out += ["", "### Combat", "", "| Attribute | Value |", "|---|---|", "| AC | 12 |",
            f"| HP (Current) | {hp_now} |", f"| HP (Max) | {hp_max} |"]
    out += [f"| Hit Dice{' ' + die if die else ''} (Spent/Max) | {value} |" for die, value in hit_dice]
    out += [f"| Death Saves (S/F) | {death} |", "", "## Background", "",
            f"**Species:** {species}", "", f"**Class/Subclass:** {classes}", "",
            "## Skills", "", "| Skill | Ability | Proficient | Expertise | Modifier |",
            "|---|---|---|---|---|"]
    out += [f"| {n} | {a} | {p} | {e} | |" for n, a, p, e in skills]
    for title, rows in (("Class Features", features), ("Feats", feats)):
        out += ["", f"## {title}", "", "| Name | Action | Uses | Used | Recovers | Summary |",
                "|---|---|---|---|---|---|"]
        out += [f"| {n} | — | {uses} | {used} | Long Rest | |" for n, uses, used in rows]
    out += ["", "## Spellcasting", "", "| Attribute | Value |", "|---|---|",
            "| Spellcasting Ability | INT |", "", "### Spell Slots", "",
            "| Level | Total | Expended |", "|---|---|---|"]
    out += [f"| {o} | {slots.get(i, ('', ''))[0]} | {slots.get(i, ('', ''))[1]} |"
            for i, o in enumerate(ORDINALS, 1)]
    out += ["", "### Spells", ""]
    if source_column:
        out += ["| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Source | Summary |",
                "|" + "---|" * 10]
        out += [f"| {n} | {lv} | A | 60 ft | V, S | Inst | | {tags} | {src} | |" for n, lv, tags, src in spells]
    else:
        out += ["| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Summary |",
                "|" + "---|" * 9]
        out += [f"| {n} | {lv} | A | 60 ft | V, S | Inst | | {tags} | |" for n, lv, tags, _src in spells]
    out += ["", "## Equipment", ""]
    if old_items is None:
        out += ["### Magic Items", "", "| Item | Attuned | Charges | Used | Recovers | Notes |",
                "|---|---|---|---|---|---|"]
        out += [f"| {n} | {att} | {ch} | {used} | Dawn | |" for n, att, ch, used in items]
    else:
        out += ["### Magic Item Attunement", "", "| Slot | Item |", "|---|---|"]
        out += [f"| {i} | {n} |" for i, n in enumerate(old_items, 1)]
    return "\n".join(out) + "\n"

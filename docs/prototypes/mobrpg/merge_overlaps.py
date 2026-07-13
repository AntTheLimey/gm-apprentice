#!/usr/bin/env python3
"""
Merge the 8 mobRPG↔vault overlap entities NON-destructively.

Policy (GM-confirmed): keep the richer existing vault file; APPEND mobRPG's
content in a clearly-marked '## mobRPG (canon import)' section; add the
'mobrpg-import' tag; note mobRPG-wins factual conflicts inline. Never delete
existing prose.

Usage:
    python3 merge_overlaps.py space_extract.json /path/to/vault
"""
from __future__ import annotations
import json, re, sys, os

# vault file (relative) → mobRPG entity name in the extract, + optional conflict notes
OVERLAPS = {
    "Locations/Thides System.md": ("Thides System", []),
    "Locations/Thides I.md": ("Thides I", []),
    "Locations/Thides II.md": ("Thides II", []),
    "Locations/Thides III.md": ("Thides III", []),
    "Locations/Thides IV.md": ("Thides IV", []),
    "Locations/Thides V.md": ("Thides V", []),
    "Locations/Thides VI.md": ("Thides VI", []),
    "Factions & Organizations/MacMillian Mining and Extraction Corporation.md":
        ("MacMillian Mining and Extraction Corporation",
         ["mobRPG names the company's last station **MacMillian Station IV** "
          "(canon on conflict); the vault HQs it at [[Thides Station]]."]),
}

MARKER = "## mobRPG (canon import)"


def add_tag(text: str, tag: str) -> str:
    """Add `tag` to an inline `tags: [...]` array if not already present."""
    m = re.search(r"^tags:\s*\[(.*?)\]\s*$", text, flags=re.M)
    if not m or tag in m.group(1):
        return text
    inner = m.group(1).strip()
    new = f"tags: [{inner}, {tag}]" if inner else f"tags: [{tag}]"
    return text[:m.start()] + new + text[m.end():]


def main() -> int:
    extract = json.load(open(sys.argv[1]))
    vault = sys.argv[2]
    by_name = {e["name"]: e for e in extract["entities"]}

    for rel, (mob_name, notes) in OVERLAPS.items():
        path = os.path.join(vault, rel)
        if not os.path.exists(path):
            print(f"  SKIP (no vault file): {rel}")
            continue
        rec = by_name.get(mob_name)
        if not rec:
            print(f"  SKIP (no mobRPG record): {mob_name}")
            continue
        text = open(path).read()
        if MARKER in text:
            print(f"  already merged: {rel}")
            continue

        text = add_tag(text, "mobrpg-import")

        rels = rec.get("relationships", [])
        rel_lines = "".join(
            f"\n- **{r['predicate']}** → [[{r['target']}]]"
            + (f" — *{r['role']}*" if r.get("role") else "")
            for r in rels)
        body = rec.get("body_md") or "*(no description in mobRPG)*"
        notes_block = ("".join(f"\n> [!warning] Conflict — mobRPG canon\n> {n}\n" for n in notes)
                       if notes else "")

        section = (
            f"\n\n{MARKER}\n\n"
            f"<!-- Imported from Tim's mobRPG 'Space' world. mobRPG is canon on factual "
            f"conflicts; vault prose above is preserved for its richer campaign detail. -->\n"
            f"{notes_block}\n"
            f"{body}\n"
            + (f"\n**mobRPG relationships:**{rel_lines}\n" if rels else "")
        )

        # insert BEFORE a trailing '## GM Notes' if present, else append
        gm = re.search(r"\n##\s+GM Notes", text)
        if gm:
            text = text[:gm.start()] + section + text[gm.start():]
        else:
            text = text.rstrip() + section + "\n"

        with open(path, "w") as f:
            f.write(text)
        print(f"  merged: {rel}" + (f"  (+{len(notes)} conflict note)" if notes else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

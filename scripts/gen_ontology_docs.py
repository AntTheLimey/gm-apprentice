#!/usr/bin/env python3
"""Write every copy of the relationship ontology from the one source.

    gen_ontology_docs.py           write them
    gen_ontology_docs.py --check   exit 1 and name each stale file

Source: skills/shared/gm-apprentice-ontology.json. Copies: generated
blocks in entity-schema.md and relationship-normalization.md, the publish
tool's export (export_publish_ontology.py), and the mobRPG tool's copy.
"""

from __future__ import annotations

import json
import re
import sys
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_publish_ontology as publish_export  # noqa: E402

SOURCE = REPO / "skills" / "shared" / "gm-apprentice-ontology.json"
SCHEMA = REPO / "skills" / "shared" / "entity-schema.md"
NORMAL = REPO / "skills" / "shared" / "relationship-normalization.md"
MOBRPG = REPO / "tools" / "mobrpg" / "mobrpg" / "gm-apprentice-ontology.json"

MARKERS = {
    SCHEMA.name: ("categories", "symmetric", "tones"),
    NORMAL.name: ("synonyms", "verbs"),
}

CATEGORY_NAMES = {"scifi": "Sci-Fi"}  # same as vault_scaffold.CATEGORY_NAMES
WRAP = 70

# Presentation only: which verbs sit in the inverse/synonym table (the rest go
# in the verb table), and which inverse names that table shows.
SYNONYM_ROWS = ("works_for", "located_in", "hosted_by", "member")
INVERSE_ROWS = ("owned_by", "employed_by", "led_by", "ruled_by", "commanded_by")
ROW_NOTES = {"member": " (of a group)"}
VERB_WORDS = {"hqd_at": "HQ'd at"}


def ontology() -> dict:
    return json.loads(SOURCE.read_text(encoding="utf-8"))


def _wrap(text: str) -> str:
    return "\n".join(textwrap.wrap(text, WRAP, break_long_words=False, break_on_hyphens=False))


def _category_name(key: str) -> str:
    return CATEGORY_NAMES.get(key, key.capitalize())


def _categories(o: dict) -> str:
    groups: dict[str, list[str]] = {}
    for p in o["predicates"]:
        groups.setdefault(p["category"], []).append(p["type"])
    rows = ["| Category | Types |", "|----------|-------|"]
    rows += [f"| {_category_name(c)} | {', '.join(t)} |" for c, t in groups.items()]
    return "\n".join(rows)


def _symmetric(o: dict) -> str:
    names = [p["type"] for p in o["predicates"] if p.get("symmetric")]
    return "**Symmetric types** (stored once, no direction):\n" + _wrap(", ".join(names))


def _tones(o: dict) -> str:
    parts = [f"{', '.join(o['tones'][f])} ({f})" for f in ("positive", "negative", "neutral")]
    return _wrap("**Tones.** `tone` is always one of: " + "; ".join(parts) + ".")


def _synonyms(o: dict) -> str:
    inverse_of = {p["inverse"]: p["type"] for p in o["predicates"] if p.get("inverse")}
    rows: dict[tuple[str, bool], list[str]] = {}
    for name in INVERSE_ROWS:
        rows.setdefault((inverse_of[name], True), []).append(name)
    for name in SYNONYM_ROWS:
        (choice,) = o["verbs"][name]
        rows.setdefault((choice["use"], choice["flip"]), []).append(name)
    lines = ["| Written as (inverse/synonym) | Store as |",
             "|------------------------------|----------|"]
    for (use, flip), names in rows.items():
        written = " / ".join(f"`{n}`" for n in names[:-1])
        written += (" / " if written else "") + f"`{names[-1]} A → B`"
        written += ROW_NOTES.get(names[-1], "")
        stored = f"`{use} B → A`" if flip else f"`{use} A → B`"
        lines.append(f"| {written} | {stored} |")
    return "\n".join(lines)


def _verb_cell(choices: list[dict]) -> str:
    if not choices:
        return "*not an edge, see below*"
    return " / ".join(
        f"`{c['use']}`" + (" *(on the other note)*" if c["flip"] else "") for c in choices)


def _verbs(o: dict) -> str:
    groups: dict[str, list[str]] = {}
    cells: dict[str, str] = {}
    for verb, choices in o["verbs"].items():
        if verb in SYNONYM_ROWS:
            continue
        key = json.dumps(choices)
        groups.setdefault(key, []).append(VERB_WORDS.get(verb, verb.replace("_", " ")))
        cells[key] = _verb_cell(choices)
    lines = ["| Narrative verb(s) | Sanctioned predicate |",
             "|-------------------|----------------------|"]
    lines += [f"| {', '.join(words)} | {cells[k]} |" for k, words in groups.items()]
    return "\n".join(lines)


def blocks(o: dict) -> dict[str, str]:
    return {"categories": _categories(o), "symmetric": _symmetric(o),
            "tones": _tones(o), "synonyms": _synonyms(o), "verbs": _verbs(o)}


def render(text: str, b: dict[str, str]) -> str:
    """Replace the inside of each marker pair this file holds with its block."""
    for name, body in b.items():
        opener = re.compile(rf"<!-- generated:{name} \(scripts/gen_ontology_docs\.py\) -->\n")
        closer = f"\n<!-- /generated:{name} -->"
        found = opener.findall(text)
        if not found:
            continue
        if len(found) > 1:
            raise ValueError(f"marker generated:{name} appears {len(found)} times")
        start = opener.search(text)
        end = text.find(closer, start.end())
        if end < 0:
            raise ValueError(f"marker generated:{name} has no closing marker")
        text = text[:start.end()] + body + text[end:]
    return text


def _missing(name: str, text: str) -> list[str]:
    return [m for m in MARKERS[name]
            if f"<!-- generated:{m} " not in text or f"<!-- /generated:{m} -->" not in text]


def outputs() -> dict[Path, str]:
    o = ontology()
    b = blocks(o)
    result: dict[Path, str] = {}
    for path in (SCHEMA, NORMAL):
        current = path.read_text(encoding="utf-8")
        gone = _missing(path.name, current)
        if gone:
            raise ValueError(f"{path.name} lacks the markers for: {', '.join(gone)}")
        result[path] = render(current, b)
    result[MOBRPG] = SOURCE.read_text(encoding="utf-8")
    result[publish_export.COPY] = publish_export.export(o)
    return result


def main(argv: list[str]) -> int:
    try:
        wanted = outputs()
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    stale = [p for p, t in wanted.items()
             if not p.exists() or p.read_text(encoding="utf-8") != t]
    if "--check" in argv:
        for p in stale:
            print(f"stale: {p.relative_to(REPO).as_posix()}")
        if stale:
            print("run: python3 scripts/gen_ontology_docs.py")
        return 1 if stale else 0
    for p in stale:
        p.write_text(wanted[p], encoding="utf-8", newline="\n")
        print(f"wrote {p.relative_to(REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

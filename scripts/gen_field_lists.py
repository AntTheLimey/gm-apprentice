#!/usr/bin/env python3
"""Write the per-type field lists from the note templates.

    gen_field_lists.py           write them
    gen_field_lists.py --check   exit 1 and name each stale region

Source: skills/shared/templates/ (read through schema_rules.template_fields,
the one reader). Copies: the generated regions in entity-schema.md
(Type-Specific Fields) and publish-site's schema-reference.md.

A field the templates carry is listed with its template comment (or the
words the schema checks for it). A field only the site reads, and a
sentence the templates cannot say, are set down below as presentation, and
the test pins that none of them names a field the template already has.
"""

from __future__ import annotations

import re
import sys
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_rules as rules  # noqa: E402
import gen_ontology_docs as markers  # noqa: E402

SCRIPT = "gen_field_lists.py"
SCHEMA = REPO / "skills" / "shared" / "entity-schema.md"
REFERENCE = REPO / "skills" / "publish-site" / "references" / "schema-reference.md"
WRAP = 70

# Every note has these; a type's list is what comes beside them.
NOT_LISTED = (rules.COMMON_FIELDS | {"name", "type", "canon_status", "relationships"})


class Entry:
    """One line of a list: a label, the types whose templates feed it, and
    what the templates cannot say."""

    def __init__(self, key, label, types, keep=(), also=(), notes=None, tail=""):
        self.key, self.label, self.types = key, label, tuple(types)
        self.keep = tuple(keep)      # fields of NOT_LISTED this type does take
        self.also = tuple(also)      # (field, note) the site reads, no template has
        self.notes = notes or {}     # field -> note, where no template comment says it
        self.tail = tail


NPC = Entry("npc", "NPC", ["npc"])
PC = Entry("pc", "PC", ["pc"], notes={
    "hook": "optional string, any system: one line under the name and on cards; "
            "blank means the backstory's first sentence",
    "display_meta": "optional array: ordered field names for the site meta row; when "
                    "omitted, the setting `player_site.sheets.header_facts` decides",
    "sheet_source": "optional string: where the sheet is kept when not in this file, "
                    "e.g. `\"D&D Beyond\"` or `\"paper, with the player\"`; not shown by "
                    "default; see `shared/pc-body-structure.md`",
    "dndbeyond": "optional string, D&D only: a D&D Beyond character link or id; "
                 "`dnd_ddb.py` syncs the note from it",
})
STORY = Entry("character-story", "Character Story", ["character-story"], notes={
    "character": "wiki-link to the PC"},
    tail=", plus universal fields only. Body is append-only session sections; "
         "see the Story Companion Convention in `shared/pc-body-structure.md`.")
LOCATION = Entry("location", "Location", ["location"], notes={
    "parent_location": "wiki-link; groups the published Locations listing, "
                       "fallback `location_type`"})
FACTION = Entry("faction", "Faction/Organization", ["faction", "organization"], notes={
    "faction_type": "cult, guild, military, etc.; groups the Factions listing",
    "goals": "a list",
    "leadership": "wiki-link",
    "territory": "wiki-link",
    "part_of": "wiki-link to the parent body, optional"})
ITEM = Entry("item", "Item", ["item"])
EVENT = Entry("event", "Event", ["event"], notes={"participants": "wiki-links"})
CLUE = Entry("clue", "Clue", ["clue"], notes={
    "leads_to": "wiki-links to what it points at", "discoveryState": "per PC"})
DOCUMENT = Entry("document", "Document", ["document"], notes={
    "date": "when written"},
    tail=" The text goes in the body under `## The Text`; an older `content` "
         "field moves there.")
PROP = Entry("prop", "Prop", ["prop"], notes={
    "prop_kind": "document, object, diagram, supplied, container",
    "prop_file": "a hand-made page, PDF or picture beside the note",
    "prop_address": "its address on the site; empty means `props/<note name>`, or "
                    "`props/<note name>-prop.html` when a page the site builds has "
                    "that address",
    "prop_style": "the look of the page the site makes from `## The Text`; not with "
                  "a `prop_file`",
    "prop_hand": "a hand id from the vault's `_meta/prop-hands.json`, so one writer "
                 "always has one hand; `prop_font` on the note wins",
    "prop_line": "one line for the props page",
    "prop_group": "its heading there; empty uses its chapter",
    "prop_container": "wiki-link to the container prop it sits in",
    "show_sealed": "containers: `titles` or `none`",
    "revealed_in": "the session it reached the players; wrap-up's reveal step writes "
                   "it, first arrival only"},
    also=(("prop_state", "containers: a `.js` file filled with what the page lists, "
                         "for its script"),
          ("prop_state_global", "the global it sets; default `PROP_ITEMS`")),
    tail=" Style fields (`prop_title`, `prop_breaks`, `prop_shift`, `prop_font`, and "
         "each style's own) are listed in publish-site's prop-styles reference. "
         "It publishes when the note does.")
PLAN = Entry("plan", "Plan", ["plan"], notes={
    "chapter": "wiki-link", "participants": "wiki-links", "locations": "wiki-links",
    "leads_to": "wiki-links"})
BRIEF = Entry("adventure-brief", "Adventure Brief", ["adventure-brief"])
OVERVIEW = Entry("campaign_overview", "Campaign Overview", ["campaign_overview"],
                 keep=("campaign",))
CREATURE = Entry("creature", "Creature", ["creature"], also=(
    ("abilities", "optional, publishes"), ("weaknesses", "optional, publishes")),
    tail=" Keep `abilities` and `weaknesses` in the body's GM Notes to hide them.")
HERITAGE = Entry("heritage", "Heritage", ["heritage"], notes={
    "lifespan_range": "min/max age array"})
DOMAIN = Entry("world_domain", "World Domain", ["world_domain"], notes={
    "rules": "array of world rules, a sentence each"})
FLAGS = Entry("world_flags", "World Flags", ["world_flags"])

# entity-schema.md: one entry per type, in this order.
SCHEMA_ENTRIES = (NPC, PC, STORY, LOCATION, FACTION, ITEM, EVENT, CLUE, DOCUMENT,
                  PROP, PLAN, BRIEF, OVERVIEW, CREATURE, HERITAGE, DOMAIN, FLAGS)


def template_comments(etype: str) -> dict[str, str]:
    """Field -> the comment its first template carries, for a type."""
    found: dict[str, str] = {}
    for name in rules.template_sources(etype):
        text = (rules.TEMPLATES_DIR / name).read_text(encoding="utf-8")
        head = re.match(r"---\n(.*?)\n---", text, re.S)
        for line in (head.group(1) if head else "").splitlines():
            m = re.match(r"([A-Za-z_]\w*):[^#\n]*?\s+#\s+(.+?)\s*$", line)
            if m and m.group(1) not in found:
                found[m.group(1)] = m.group(2)
    return found


def _plain(comment: str) -> str:
    """A template comment as prose: a wiki-link written as the word, never
    a link (a vault would make a red link of it)."""
    text = re.sub(r'"?\[\[(.+?)\]\]"?', lambda m: "wiki-link: " + m.group(1)[:1].lower()
                  + m.group(1)[1:], comment)
    return re.sub(r" [/|] ", "/", text).rstrip(".…").strip()


def entry_fields(entry: Entry) -> list[str]:
    """The template fields a type's list names, in template order."""
    fields: list[str] = []
    for t in entry.types:
        fields += [f for f in rules.template_fields(t)
                   if f not in fields and (f not in NOT_LISTED or f in entry.keep)]
    return fields


def _hint(entry: Entry, field: str) -> str:
    for t in entry.types:
        vals = (rules.checked_values(t).get(field)
                or rules.LISTED_VALUES.get(t, {}).get(field))
        if vals:
            return "/".join(sorted(vals))
    return ""


def _note(entry: Entry, field: str, comments: dict[str, str]) -> str:
    if field in entry.notes:
        return entry.notes[field]
    if field in comments:
        return _plain(comments[field])
    return _hint(entry, field)


def entry_line(entry: Entry) -> str:
    comments: dict[str, str] = {}
    for t in entry.types:
        for f, c in template_comments(t).items():
            comments.setdefault(f, c)
    parts = []
    for f in entry_fields(entry):
        note = _note(entry, f, comments)
        parts.append(f"`{f}`" + (f" ({note})" if note else ""))
    parts += [f"`{f}` ({note})" for f, note in entry.also]
    body = ", ".join(parts) + ("." if entry.tail and entry.tail[0] != "," else "")
    line = f"**{entry.label}:** " + body + entry.tail
    return "\n".join(textwrap.wrap(line, WRAP, break_long_words=False,
                                   break_on_hyphens=False))


def schema_block() -> str:
    return "\n\n".join(entry_line(e) for e in SCHEMA_ENTRIES)


# schema-reference.md: a line of names under each type's heading.
REFERENCE_ENTRIES = {
    "pc": PC, "npc": NPC, "location": LOCATION, "creature": CREATURE, "item": ITEM,
    "faction": FACTION, "event": EVENT, "heritage": HERITAGE,
    "world_domain": DOMAIN, "clue": CLUE, "document": DOCUMENT,
    "chapter": Entry("chapter", "Chapter", ["chapter"]),
    "session": Entry("session", "Session", ["session"]),
}


def reference_line(entry: Entry) -> str:
    names = [f"`{f}`" + (f" ({_hint(entry, f)})" if _hint(entry, f) else "")
             for f in entry_fields(entry)]
    line = "Template fields: " + ", ".join(names) + "."
    return "\n".join(textwrap.wrap(line, 72, break_long_words=False, break_on_hyphens=False))


def blocks_for(path: Path) -> dict[str, str]:
    if path == SCHEMA:
        return {"fields": schema_block()}
    return {f"fields-{k}": reference_line(e) for k, e in REFERENCE_ENTRIES.items()}


def outputs() -> dict[Path, str]:
    result: dict[Path, str] = {}
    for path in (SCHEMA, REFERENCE):
        text = path.read_text(encoding="utf-8")
        wanted = blocks_for(path)
        gone = [n for n in wanted if not markers._opener(n, SCRIPT).search(text)
                or f"<!-- /generated:{n} -->" not in text]
        if gone:
            raise ValueError(f"{path.name} lacks the markers for: {', '.join(gone)}")
        result[path] = markers.render(text, wanted, SCRIPT)
    return result


def stale_regions(path: Path, current: str, wanted: str) -> list[str]:
    """The name of each region whose text differs."""
    names = []
    for name in blocks_for(path):
        pat = re.compile(rf"<!-- generated:{re.escape(name)} \(scripts/{re.escape(SCRIPT)}\) -->\n"
                         rf"(.*?)\n<!-- /generated:{re.escape(name)} -->", re.S)
        a, b = pat.search(current), pat.search(wanted)
        if not a or not b or a.group(1) != b.group(1):
            names.append(name)
    return names


def main(argv: list[str]) -> int:
    try:
        wanted = outputs()
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    stale = {p: t for p, t in wanted.items() if p.read_text(encoding="utf-8") != t}
    if "--check" in argv:
        for p, t in stale.items():
            regions = stale_regions(p, p.read_text(encoding="utf-8"), t)
            print(f"stale: {p.relative_to(REPO).as_posix()} ({', '.join(regions)})")
        if stale:
            print("run: python3 scripts/gen_field_lists.py")
        return 1 if stale else 0
    for p, t in stale.items():
        p.write_text(t, encoding="utf-8", newline="\n")
        print(f"wrote {p.relative_to(REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

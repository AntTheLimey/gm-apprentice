#!/usr/bin/env python3
"""entity_new.py: a new entity note, filled from its template (#676).

    vault_write.py VAULT entity-new --type TYPE --name NAME [--folder SUB]
                                    [--date YYYY-MM-DD] [--session S]
                                    [--write]                       < note

Stdin is the note as its writer has it: an optional frontmatter block
holding only the fields to set (and `relationships:`), then the body's
sections. The command does the rest, the same way every time:

- The frontmatter is the vault's template for TYPE with NAME and the given
  fields set; a field the template lacks is kept, with a warning.
- The body's sections go in the template's order. A `##` section is the
  players'; every `###` section goes under `## GM Notes`, inside the
  template's gm-only fence, wherever the writer put it, so none is
  published by riding inside a players' section. A `####` heading stays
  with its section, so inside a `##` one it is published: a warning says
  so, as one does for a `##` the template lacks. A section the writer
  leaves out is left out: no empty headings, no `{prompt}` text.
- `## Related` and `### Hidden Ties` are written from `relationships:`, one
  line a tie, so the two can never drift: a `gm_only` tie under Hidden
  Ties, the rest under Related, grouped People, Places, Groups, Things by
  what the tie points at.
- Two rules the ontology states are applied: a tie whose type runs both
  ways (`borders`, `allied_with`, ...) is written `bidirectional: true`,
  and a field that pairs with a tie on the same note (`parent_location`
  with `part_of`) gets whichever half is missing, never from a `gm_only`
  tie: the field is printed on the page. Every other
  relationship rule stays with `gma vault-check <vault> relationships`,
  which a batch runs on what it wrote.

In a batch (`vault-write batch`) a block is `=== entity-new --type npc
--name "Abbot Severin"` and its body is the stdin above; a tie may point
at a note a later block makes.

An adventure brief (`--type adventure-brief`, #681) is filed in a folder
of its own, `Adventures/NAME/NAME.md`, and is named by `title` (stdin may
give a longer one). A `##` its template keeps in a spoiler block (Open
Questions) is written in one.

Rows: WOULD-CREATE / CREATED and WARNING. Exit and --write as every
vault-write command.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import schema_rules
import vault_write as vw
import vaultlib as vl

# What a tie may hold on stdin. `target_type` is for a target with no note
# yet (it picks the Related group) and is never written.
TIE_KEYS = ("target", "type", "tone", "strength", "bidirectional",
            "description", "gm_only", "target_type")
YES_WORDS = frozenset({"true", "yes", "on", "1"})
NO_WORDS = frozenset({"false", "no", "off", "0"})
GROUPS = ("People", "Places", "Groups", "Things")
GROUP_OF = {"pc": "People", "npc": "People", "location": "Places",
            "faction": "Groups", "organization": "Groups"}
RELATED, HIDDEN_TIES = "related", "hidden ties"
PLAIN_WORD_RE = re.compile(r"[A-Za-z_][\w-]*")


def entity_types() -> dict[str, str]:
    """type -> its vault folder, for every type this command makes: one
    with a folder of its own and a shared template, never a PC (a PC's
    sheet is its system's own). A type in OWN_FOLDER_TYPES (the adventure
    brief) has a folder for each note, under the one given here."""
    out = {}
    for row in vl.ontology()["vault_folders"]:
        for etype in row["types"]:
            if etype != "pc" and f"{etype}.md" in schema_rules.TEMPLATE_NAMES:
                out[etype] = row["folder"]
    for etype, folder in schema_rules.OWN_FOLDER_TYPES.items():
        if f"{etype}.md" in schema_rules.TEMPLATE_NAMES:
            out[etype] = folder
    return out


def known_types() -> frozenset[str]:
    """Every note type the schema names."""
    return frozenset(schema_rules.REQUIRED_FIELDS).union(
        *schema_rules.TYPE_FOLDERS.values())


def symmetric_types() -> frozenset[str]:
    return frozenset(p["type"] for p in vl.ontology()["predicates"]
                     if p["symmetric"])


def self_pairs() -> list[tuple[str, str]]:
    """(field, tie type) for each field that pairs with a tie on the same
    note."""
    return [(p["field"], p["predicate"]) for p in vl.ontology()["place_fields"]
            if p["stored_on"] == "self"]


def raw_blocks(lines: list[str]) -> dict[str, list[str]]:
    """Each top-level key of a frontmatter block (lines without endings)
    with its own lines, as written."""
    out: dict[str, list[str]] = {}
    key: str | None = None
    for line in lines:
        m = vw.TOP_KEY_RE.match(line)
        if m:
            key = m.group(1)
            out[key] = [line]
        elif key is not None and (not line.strip() or line[:1].isspace()):
            out[key].append(line)
        elif line.strip() and not line.lstrip().startswith("#"):
            raise vw.WriteError(f"frontmatter line not understood: {line!r}")
    for block in out.values():
        while len(block) > 1 and not block[-1].strip():
            block.pop()
    return out


def replace_block(fm: list[str], key: str, block: list[str]) -> bool:
    """Put `block` where the template has `key`; False when it has none."""
    for i, line in enumerate(fm):
        if line.startswith(f"{key}:"):
            j = i + 1
            while j < len(fm) and (not fm[j].strip() or fm[j][:1].isspace()):
                j += 1
            fm[i:j] = block
            return True
    return False


TIE_LINE_RE = re.compile(r"^(\s+)(-\s+)?([A-Za-z_]\w*):(?:\s+(.*))?$")


def parse_ties(block: list[str]) -> list[dict[str, Any]]:
    """The ties of a `relationships:` block as written on stdin, in the
    one shape the schema shows: a `- target:` line opens a tie and each
    indented `key: value` line below adds to it. The scripts read
    frontmatter with their own flat reader, which keeps no tie's fields."""
    first = vw.strip_comment(block[0].partition(":")[2].strip())
    rest = [ln for ln in block[1:]
            if ln.strip() and not ln.lstrip().startswith("#")]
    if first:
        if first == "[]" and not rest:
            return []
        raise vw.WriteError("relationships: write each tie as a `- target:` "
                            "block under the key")
    ties: list[dict[str, Any]] = []
    for line in rest:
        m = TIE_LINE_RE.match(line)
        if not m or (not m.group(2) and not ties):
            raise vw.WriteError(f"relationships: line not understood: "
                                f"{line.strip()!r} (a tie is `- target: ...` "
                                f"then indented `key: value` lines)")
        if m.group(2):
            ties.append({})
        raw = (m.group(4) or "").strip()
        value: Any
        if vl.QUOTED_SCALAR_RE.match(raw):
            value = vl.scalar_value(raw)
        else:
            if raw[:1] in ('"', "'"):
                raise vw.WriteError(f"relationships: {m.group(3)}: {raw!r} "
                                    f"is not one quoted value")
            if m.group(3) == "description" and (" #" in raw or ": " in raw
                                                or raw.endswith(":")):
                raise vw.WriteError(f"relationships: put the description "
                                    f"in quotes: {raw!r} (a ' #' or ': ' "
                                    f"in it would be read as YAML)")
            raw = vw.strip_comment(raw)
            if raw[:1] in ("|", ">", "{", "[") and not raw.startswith("[["):
                raise vw.WriteError(f"relationships: {m.group(3)} must be a "
                                    f"one-line value")
            value = (raw.casefold() == "true" if raw.casefold()
                     in ("true", "false") else int(raw)
                     if re.fullmatch(r"-?\d+", raw) else raw)
        if m.group(3) in ties[-1]:
            raise vw.WriteError(f"relationships[{len(ties)}]: "
                                f"{m.group(3)} is there twice")
        ties[-1][m.group(3)] = value
    return ties


def flag(value: Any, where: str, name: str) -> bool:
    """A yes-or-no value of a tie. A word that is neither is refused: a
    mistyped `gm_only` must never be read as "show it"."""
    word = (("true" if value else "false") if isinstance(value, bool)
            else str(value).strip().casefold())
    if word in YES_WORDS:
        return True
    if word in NO_WORDS:
        return False
    raise vw.WriteError(f"{where}: {name} must be true or false, not "
                        f"{value!r}")


def link_of(value: Any) -> str:
    """The note a field's value links to, or "" for none."""
    return vl.wikilink_target(value) if value not in (None, "") else ""


class Types:
    """What kind of note a name is: among the notes on disk and the ones
    this batch has made or is about to."""

    def __init__(self, batch: vw.Batch) -> None:
        self.batch = batch
        self._by_name: dict[str, set[str]] | None = None
        self._holders: dict[str, list[str]] = {}

    def _index(self) -> dict[str, set[str]]:
        if self._by_name is None:
            by_stem: dict[str, set[str]] = {}
            by_alias: dict[str, set[str]] = {}
            for rel in self.batch._files().values():
                if vw.is_record(rel) or vl.is_skipped_path(rel, vl.SKIP_DIRS):
                    continue
                fm = vl.extract_frontmatter(self.batch.read(rel)) or {}
                kind = vl.entity_type(fm)
                stem = vl.normalize(Path(rel).stem)
                by_stem.setdefault(stem, set()).add(kind)
                self._holders.setdefault(stem, []).append(rel)
                for alias in vl.link_aliases(fm):
                    by_alias.setdefault(vl.normalize(alias), set()).add(kind)
                    self._holders.setdefault(vl.normalize(alias), []).append(rel)
            # A file name beats another note's alias, as a link resolves.
            self._by_name = {**by_alias, **by_stem}
        return self._by_name

    def holders(self, name: str) -> list[str]:
        """The live notes already called `name`: by file name (`_` and
        capitals aside), by alias or by secret alias. A new note of that
        name would take their links."""
        self._index()
        return sorted(set(self._holders.get(vl.normalize(name), ())))

    def of(self, name: str) -> str | None:
        """The one type of the note called `name`; None when no note has
        the name, or notes of different types share it."""
        want = vl.link_target(name)
        kinds = self._index().get(want)
        if kinds is None:
            coming = self.batch.coming.get(want)
            return coming
        return next(iter(kinds)) if len(kinds) == 1 else None


def read_ties(raw: list[dict[str, Any]], types: Types,
              own_name: str) -> tuple[list[dict[str, Any]], list[str]]:
    """(the ties as they will be written, notes on what was set for the
    writer). Each tie holds target, type, tone, strength, bidirectional,
    description, gm_only and group."""
    two_way = symmetric_types()
    ties, notes = [], []
    for n, item in enumerate(raw, 1):
        where = f"relationships[{n}]"
        odd = sorted(k for k in item if k not in TIE_KEYS)
        if odd:
            raise vw.WriteError(f"{where}: {', '.join(odd)} is no part of a "
                                f"tie; a tie takes {', '.join(TIE_KEYS[:-1])}")
        target = link_of(item.get("target"))
        kind = str(item.get("type") or "").strip()
        if not target or not kind:
            raise vw.WriteError(f"{where}: needs a target and a type")
        if re.search(r'["\r\n]', target) or not PLAIN_WORD_RE.fullmatch(kind):
            raise vw.WriteError(f"{where}: target or type cannot be written")
        if vl.normalize(target) == vl.normalize(own_name):
            raise vw.WriteError(f"{where}: a note has no tie to itself")
        strength = item.get("strength", 5)
        if (isinstance(strength, bool) or not isinstance(strength, int)
                or not 1 <= strength <= 10):
            raise vw.WriteError(f"{where}: strength must be a number, 1 to 10")
        tone = str(item.get("tone") or "neutral").strip()
        if not PLAIN_WORD_RE.fullmatch(tone):
            raise vw.WriteError(f"{where}: tone must be one word")
        both = flag(item.get("bidirectional", False), where, "bidirectional")
        if kind in two_way and not both:
            both = True
            notes.append(f"{kind} [[{target}]] runs both ways: "
                         f"bidirectional set")
        hidden = flag(item.get("gm_only", False), where, "gm_only")
        hint = str(item.get("target_type") or "").strip().casefold()
        if hint and hint not in known_types():
            raise vw.WriteError(f"{where}: target_type {hint!r} is no note "
                                f"type (npc, location, faction, item, ...)")
        target_type = types.of(target) or hint
        if not target_type and not hidden:
            raise vw.WriteError(
                f"{where}: [[{target}]] has no note yet, so its Related "
                f"group is unknown: create that note first, or add "
                f"`target_type: <its type>` to the tie (it is not written)")
        description = " ".join(str(item.get("description") or "").split())
        if any(mark in said for said in (target, description)
               for mark in ("<!--", "-->")):
            # Both are written into the body, a hidden tie's inside the
            # fence: a comment mark there would open or close a block.
            raise vw.WriteError(f"{where}: a target or description takes no "
                                f"'<!--' or '-->': it would open or close a "
                                f"hidden block in the note's body")
        ties.append({
            "target": target, "type": kind, "tone": tone,
            "strength": strength, "bidirectional": both,
            "description": description,
            "gm_only": hidden,
            "group": GROUP_OF.get(target_type, "Things")})
    return ties, notes


def tie_lines(ties: list[dict[str, Any]]) -> tuple[str, list[str]]:
    """(value, children) of the `relationships:` key for set_block."""
    if not ties:
        return "[]", []
    out = []
    for tie in ties:
        out += [f"  - target: {vl.yaml_scalar('[[' + tie['target'] + ']]')}",
                f"    type: {tie['type']}",
                f"    tone: {tie['tone']}",
                f"    strength: {tie['strength']}",
                f"    bidirectional: {'true' if tie['bidirectional'] else 'false'}",
                f"    description: {vl.yaml_scalar(tie['description'])}"]
        if tie["gm_only"]:
            out.append("    gm_only: true")
    return "", out


def tie_text(tie: dict[str, Any]) -> str:
    return f"[[{tie['target']}]]" + (f" — {tie['description']}"
                                     if tie["description"] else "")


def related_unit(ties: list[dict[str, Any]], title: str) -> list[str]:
    lines = [f"## {title}", ""]
    for group in GROUPS:
        lines += [f"- **{group}:** {tie_text(t)}" for t in ties
                  if not t["gm_only"] and t["group"] == group]
    return lines


def hidden_unit(ties: list[dict[str, Any]], title: str) -> list[str]:
    return [f"### {title}", ""] + [f"- {tie_text(t)}" for t in ties
                                   if t["gm_only"]]


def ordered(units: list[tuple[str, bool, list[str]]], order: list[str]
            ) -> list[list[str]]:
    """The units (key, known to the template, lines) in the template's
    order; one the template lacks stays after the known one it followed."""
    rank = {k: i for i, k in enumerate(order)}
    keyed = []
    anchor = -1
    for pos, (k, known, lines) in enumerate(units):
        if known:
            anchor = rank[k]
        keyed.append(((rank[k], 0, pos) if known else (anchor, 1, pos), lines))
    return [lines for _key, lines in sorted(keyed, key=lambda x: x[0])]


INDENTED_HEADING_RE = re.compile(r"^(?: {1,3}|\s*>\s*)#{1,6}(?:\s|$)")
SETEXT_RE = re.compile(r"^ {0,3}(?:=+|-+)\s*$")


def hkey(title: str) -> str:
    """A heading's title reduced the way the site and the reserved-name
    check read it: closing hashes, emphasis, case, trailing punctuation
    and a trailing parenthetical all ignored, so `## Secrets ##` and
    `## Secrets:` are `Secrets`."""
    return vw.vc._keeper_key(vl.atx_title(title))


@dataclass
class Shape:
    """Which of a template's sections are the players' and which the
    GM's, read from its fence and its `## GM Notes`, whatever a vault has
    renamed."""
    public_h2: list[str]
    gm_h2: list[str]            # a `##` the template keeps inside its fence
    spoiler_h2: list[str]       # a `##` the template keeps in a spoiler block
    gm_h3: list[str]
    public_h3: set[str]         # a `###` the template has in a players' section
    titles: dict[str, str]
    fenced: bool


def template_shape(template: str) -> Shape:
    shape = Shape([], [], [], [], set(), {}, any(
        not m.group(1) for m in vl.GM_MARKER_RE.finditer(template)))
    parent_gm = False
    for state in vw.parse(template).states:
        if state.heading is None:
            continue
        level, title = state.heading
        gm = state.gm_depth > 0
        k = hkey(title)
        if level == 2:
            parent_gm = gm or k == vw.GM_NOTES
            if k != vw.GM_NOTES:
                (shape.gm_h2 if gm else shape.spoiler_h2
                 if state.spoiler_depth > 0 else shape.public_h2).append(k)
        elif level == 3:
            # One the template hides in a spoiler block is hidden here too:
            # under GM Notes, never left with the players' section above it.
            if parent_gm or gm or state.spoiler_depth > 0:
                shape.gm_h3.append(k)
            else:
                shape.public_h3.add(k)
        else:
            continue
        shape.titles.setdefault(k, vl.atx_title(title))
    # A name that is the GM's anywhere in the template is never the
    # players' on stdin.
    shape.public_h3 -= set(shape.gm_h3)
    return shape


def body_units(body: str, keep_with_parent: set[str]
               ) -> list[tuple[int, str, list[str]]]:
    """The sections on stdin as (level, title, lines). Every `##` and
    every `###` outside a code fence opens one, so no `###` rides along
    inside the section above it (where it would be published with it);
    a deeper heading stays with its section, and so does a `###` the
    template itself keeps inside a players' section. A section the
    readers here and the site could cut differently is refused: an open
    code fence, half a gm-only block, a heading that is indented, quoted
    or underlined."""
    lines = body.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return []
    heads = [(i, level, vl.atx_title(title))
             for i, level, title in vl.line_headings(lines)
             if level <= 2 or (level == 3
                               and hkey(title) not in keep_with_parent)]
    if not heads or any(line.strip() for line in lines[:heads[0][0]]):
        raise vw.WriteError("the body must start with a heading")
    units = []
    for n, (i, level, title) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        unit = lines[i:end]
        while unit and not unit[-1].strip():
            unit.pop()
        head = f"'{'#' * level} {title}'"
        fence: str | None = None
        for at, line in enumerate(unit):
            fence, is_fence_line = vl.fence_step(line, fence)
            if is_fence_line or fence is not None or at == 0:
                continue
            if INDENTED_HEADING_RE.match(line):
                raise vw.WriteError(f"{head}: write a heading at the start "
                                    f"of its line, not indented or quoted: "
                                    f"{line.strip()!r}")
            if (SETEXT_RE.match(line) and unit[at - 1].strip()
                    and at - 1 > 0 and not unit[at - 1].lstrip().startswith(
                        ("#", "|", ">"))):
                raise vw.WriteError(f"{head}: {unit[at - 1].strip()!r} is "
                                    f"underlined into a heading: write it "
                                    f"as '### ...', or put a blank line "
                                    f"above the rule")
        if fence is not None:
            raise vw.WriteError(f"{head}: a code fence opened in it is never "
                                f"closed, so the sections after it would be "
                                f"read as code")
        _states, problems = vl.scan_body("\n".join(unit))
        if problems:
            raise vw.WriteError(
                f"{head}: a gm-only or spoiler block must open and close "
                f"inside one section ({problems[0]}); the note's own fence "
                f"is written for you")
        units.append((level, title, unit))
    return units


def build_body(template: str, body: str, ties: list[dict[str, Any]],
               warn: Callable[[str], None]) -> str:
    shape = template_shape(template)
    public_order, gm_order = list(shape.public_h2), list(shape.gm_h3)

    public: list[tuple[str, bool, list[str]]] = []
    hidden: list[tuple[str, bool, list[str]]] = []
    hidden_h2: list[tuple[str, bool, list[str]]] = []
    spoiled: list[tuple[str, bool, list[str]]] = []
    lead: list[str] = []
    seen: set[tuple[int, str]] = set()
    for level, title, lines in body_units(body, shape.public_h3):
        k = hkey(title)
        head = f"'{'#' * level} {title}'"
        if level == 1:
            raise vw.WriteError(f"{head}: a note takes no # title; its name "
                                f"is its file's")
        if k in (RELATED, HIDDEN_TIES):
            raise vw.WriteError(f"{head} is written from relationships: "
                                f"leave it out")
        if (level, k) in seen:
            raise vw.WriteError(f"{head} is on stdin twice")
        seen.add((level, k))
        if level == 3:
            # Always the GM's, wherever it was written.
            hidden.append((k, k in gm_order, lines))
            if k in shape.spoiler_h2:
                warn(f"{head} goes under GM Notes for good: write it as "
                     f"'## {title}' for the spoiler block it is lifted from")
        elif k == vw.GM_NOTES:
            lead = lines[1:]
        elif k in shape.gm_h2:
            hidden_h2.append((k, True, lines))
        elif k in shape.spoiler_h2:
            spoiled.append((k, True, lines))
        elif k in gm_order:
            raise vw.WriteError(f"{head} is a GM Notes section of this "
                                f"template: write it as '### {title}', or "
                                f"it would be published")
        else:
            public.append((k, k in public_order, lines))
            if k not in public_order:
                warn(f"{head}: {vw.PLAYERS_SEE}")
            for _i, deep, sub in vl.line_headings(lines[1:]):
                if deep >= 4:
                    warn(f"'{'#' * deep} {vl.atx_title(sub)}' stays inside "
                         f"{head}: players will see it (a ### section "
                         f"goes under GM Notes)")

    if any(not t["gm_only"] for t in ties):
        if RELATED not in public_order:
            public_order.append(RELATED)
        public.append((RELATED, True, related_unit(
            ties, shape.titles.get(RELATED, "Related"))))
    if any(t["gm_only"] for t in ties):
        if HIDDEN_TIES not in gm_order:
            gm_order.append(HIDDEN_TIES)
        hidden.append((HIDDEN_TIES, True, hidden_unit(
            ties, shape.titles.get(HIDDEN_TIES, "Hidden Ties"))))

    blocks = ordered(public, public_order)
    while lead and not lead[0].strip():
        lead.pop(0)
    gm = [["## GM Notes"] + ([""] + lead if lead else [])]
    gm += ordered(hidden, gm_order)
    gm += ordered(hidden_h2, shape.gm_h2)
    if shape.fenced:
        gm = [["<!-- gm-only -->"], *gm, ["<!-- /gm-only -->"]]
    # Each in a spoiler block of its own, as the template has it: hidden
    # until the GM lifts the block, not for good as GM Notes is.
    for lines in ordered(spoiled, shape.spoiler_h2):
        gm += [["<!-- spoiler -->"], lines, ["<!-- /spoiler -->"]]
    return "\n" + "\n\n".join("\n".join(b) for b in blocks + gm) + "\n"


def run(batch: vw.Batch, args: argparse.Namespace, text: str) -> None:
    kinds = entity_types()
    etype = args.type.strip().casefold()
    if etype not in kinds:
        raise vw.WriteError(f"--type {args.type!r}: one of "
                            f"{', '.join(sorted(kinds))}")
    name = vw.clean_name(args.name, "--name")
    if etype in schema_rules.OWN_FOLDER_TYPES:
        if args.folder:
            raise vw.WriteError(f"--folder: each {etype} note has a folder "
                                f"of its own, here {kinds[etype]}/{name}")
        if name.startswith(".") or name.endswith("."):
            raise vw.WriteError(f"--name {args.name!r} cannot be a folder's "
                                f"name (no dot first or last)")
        folder = f"{kinds[etype]}/{name}"
    else:
        folder = kinds[etype] + vw.chapter_subfolder(args.folder)
    rel = f"{folder}/{name}.md"
    types = Types(batch)
    clash = sorted(set(vw.live_stem_clash(batch, name)) | set(
        types.holders(name)))
    if clash:
        raise vw.WriteError(f"a note named {name!r} exists, or has that "
                            f"name as an alias: {', '.join(clash)}")
    vw.check_date(args.date, "--date")

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    end, error = vl.frontmatter_span([ln + "\n" for ln in lines])
    if error is None:
        head, body = lines[1:end], "\n".join(lines[end + 1:])
        given = vl.extract_frontmatter(text) or {}
    elif error == "no frontmatter":
        head, body, given = [], text, {}
    else:
        raise vw.WriteError(f"stdin: {error}")
    blocks = raw_blocks(head)
    if str(given.get("type") or etype).strip().casefold() != etype:
        raise vw.WriteError(f"stdin says type {given['type']!r}, --type "
                            f"says {etype!r}")
    if given.get("name") not in (None, "", name):
        raise vw.WriteError(f"stdin says name {given['name']!r}, --name "
                            f"says {name!r}")

    template = vw.template_text(
        batch.vault, (schema_rules.TEMPLATE_NAMES[f"{etype}.md"],),
        f"{etype}.md")
    fm = vw.template_frontmatter(template)

    def has(field: str) -> bool:
        return any(line.startswith(f"{field}:") for line in fm)

    # A template with no `name` (the adventure brief) is named by `title`,
    # which stdin may set to something longer than the file's name.
    name_field = "title" if has("title") and not has("name") else "name"
    vw.set_block(fm, name_field, vl.yaml_scalar(name))
    takes_date = has("lastUpdated")
    for key, block in blocks.items():
        if key in ("type", "name", "relationships"):
            continue
        value = block[0].partition(":")[2].strip()
        if len(block) == 1 and vl.is_escaped_empty(vw.strip_comment(value)):
            # `voice: \"\"` is a four-character string, not an empty one
            # (#715): written as the empty value it was meant to be.
            block = [f'{key}: ""']
            value = '""'
            batch.row("INFO", rel, "", f'{key}: escaped quotes (\\"\\") '
                      f'written as ""')
        if key == name_field and len(block) == 1 \
                and not vw.strip_comment(value).strip("\"' "):
            continue        # an empty title leaves the note its name
        if (len(block) == 1 and value[:1] not in ('"', "'", "[", "{")
                and re.search(r":(\s|$)", vw.strip_comment(value))):
            raise vw.WriteError(f"{key}: put the value in quotes: {value!r} "
                                f"(a ': ' in it is not valid YAML)")
        if not replace_block(fm, key, block):
            fm.extend(block)
            batch.row("WARNING", rel, "", f"{key} is not a field of the "
                      f"{etype} template: kept as written")
    if args.date and "lastUpdated" not in blocks:
        vw.set_block(fm, "lastUpdated", f'"{args.date}"')
    born = born_in_play(fm, args.session)

    ties, notes = read_ties(parse_ties(blocks.get("relationships",
                                                  ["relationships: []"])),
                            types, name)
    # As the note will hold them: a field stdin leaves alone keeps the
    # template's value, and is published like one that was sent.
    set_now = vl.extract_frontmatter("---\n" + "\n".join(fm) + "\n---\n") or {}
    for field, kind in self_pairs():
        if not has(field):
            continue
        want = link_of(set_now.get(field))
        same = [t for t in ties if t["type"] == kind]
        shown = [t["target"] for t in same if not t["gm_only"]]
        secret = [t["target"] for t in same if t["gm_only"]]
        if want and any(vl.normalize(t) == vl.normalize(want) for t in secret):
            # The field is printed on the page; the tie says it is a secret.
            batch.row("WARNING", rel, "", f"{field} [[{want}]] is published, "
                      f"and its {kind} tie is gm_only: drop the field to "
                      f"keep it hidden")
        elif want and not any(vl.normalize(t) == vl.normalize(want)
                              for t in shown):
            if shown:
                batch.row("WARNING", rel, "", f"{field} is [[{want}]] and "
                          f"its {kind} tie is to [[{shown[0]}]]: one of the "
                          f"two is wrong")
                continue
            ties.append({"target": want, "type": kind, "tone": "neutral",
                         "strength": 5, "bidirectional": False,
                         "description": "", "gm_only": False,
                         "group": GROUP_OF.get(types.of(want) or etype,
                                               "Things")})
            notes.append(f"{field} [[{want}]]: its {kind} tie added")
        elif not want and len(shown) == 1:
            # Only from a tie the players may see: the field is published.
            vw.set_block(fm, field, vl.yaml_scalar(f"[[{shown[0]}]]"))
            notes.append(f"{kind} [[{shown[0]}]]: {field} set")
    if ties or has("relationships"):
        vw.set_block(fm, "relationships", *tie_lines(ties))

    new = "---\n" + "\n".join(fm) + "\n---\n" + build_body(
        template, body, ties, lambda said: batch.row("WARNING", rel, "", said))
    batch.create(rel, new)
    vw.schema_check(batch, rel, new)
    hidden = sum(1 for t in ties if t["gm_only"])
    batch.row("WOULD-CREATE", rel, "",
              f"{etype} template; {len(ties)} "
              f"{'tie' if len(ties) == 1 else 'ties'}"
              + (f" ({hidden} under Hidden Ties)" if hidden else "")
              + "".join(f"; {note}" for note in [*born, *notes])
              + ("" if args.date or "lastUpdated" in blocks or not takes_date
                 else "; no --date: lastUpdated left empty"))


def born_in_play(fm: list[str], session: str | None) -> list[str]:
    """With --session, a note born at the table (#698): `createdSession`
    and `asOfSession` name the session, written as `stamp-entities
    --session` writes them (a bare number stays bare), and an empty
    `source` is `play`. A field the template lacks, or that already holds
    a value (stdin's), is left alone; one stdin sent empty is filled.
    Without it the note is prep: reconcile reads a blank `createdSession`
    as made before play. Returns what it set."""
    if session is None:
        return []
    session = session.strip()
    if not session:
        raise vw.WriteError("--session: empty (a session number or label)")
    value = vl.yaml_scalar(session)
    done = []
    for field, want in (("createdSession", value), ("asOfSession", value),
                        ("source", "play")):
        now = next((line for line in fm if line.startswith(f"{field}:")),
                   None)
        if now is None or vw.strip_comment(now.partition(":")[2]).strip(
                "\"' ") not in ("", "null", "~"):
            continue
        vw.set_block(fm, field, want)
        done.append(f"{field} {want}")
    return [", ".join(done)] if done else []


def coming_types(blocks: list[Any]) -> dict[str, str]:
    """name -> type of every note the batch's entity-new blocks will make,
    so a tie may point at a note a later block creates."""
    out: dict[str, str] = {}
    parser = None
    for b in blocks:
        if b.command != "entity-new":
            continue
        # The parser the block itself is run with, so `--type=npc` and
        # every other way of writing a flag is read the same here.
        parser = parser or vw.build_parser()
        try:
            with contextlib.redirect_stderr(io.StringIO()), \
                    contextlib.redirect_stdout(io.StringIO()):
                ns = parser.parse_args([".", "entity-new", *b.args])
        except SystemExit:
            continue        # the block says what is wrong when it runs
        out[vl.normalize(ns.name)] = ns.type.strip().casefold()
    return out


def add_parser(sub: Any) -> None:
    """The `entity-new` subcommand of vault_write.py."""
    ap = sub.add_parser(
        "entity-new", help="create an entity note from its template (stdin)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "stdin: the note as you have it. An optional frontmatter block\n"
            "with only the fields to set and `relationships:`, then the\n"
            "body's sections. A ## section is the players'; every ###\n"
            "section goes under ## GM Notes, inside the template's gm-only\n"
            "fence, wherever it is written. A #### heading stays with its\n"
            "section: inside a ## section the players see it, and a warning\n"
            "says so, as it does for a ## the template lacks. Sections go\n"
            "in the template's order and one left\n"
            "out is left out. ## Related and ### Hidden Ties are written\n"
            "from relationships (a gm_only tie is hidden): never send\n"
            "them. gm_only is true or false; any other word is refused.\n"
            "A tie whose type runs both ways is written bidirectional, and\n"
            "parent_location and its part_of tie are kept as a pair (never\n"
            "from a gm_only tie: the field is published). A tie\n"
            "to a note that does not exist yet takes `target_type: <type>`\n"
            "(not written) unless a later block of the same batch makes\n"
            "that note. Every other relationship rule: gma vault-check\n"
            "<vault> relationships --file <note>.\n"
            "--type adventure-brief files the brief at\n"
            "Adventures/NAME/NAME.md, named by `title`, with ## Open\n"
            "Questions kept in the template's spoiler block."))
    ap.add_argument("--type", required=True,
                    help="the note's type: " + ", ".join(sorted(entity_types())))
    ap.add_argument("--name", required=True, help="the note's name: its file name")
    ap.add_argument("--folder", help="a sub-folder of the type's folder")
    ap.add_argument("--date", help="lastUpdated value, YYYY-MM-DD")
    ap.add_argument("--session", help="a note born at the table: the "
                    "session, in the vault's asOfSession shape (9 or "
                    "\"Session 9\"), for createdSession and asOfSession; "
                    "an empty source becomes play")
    ap.add_argument("--write", action="store_true",
                    help="write it (default: preview)")

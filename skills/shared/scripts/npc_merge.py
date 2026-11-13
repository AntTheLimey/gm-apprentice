#!/usr/bin/env python3
"""npc_merge.py: merge an NPC note into the PC note of the same character.

    vault_write.py VAULT npc-merge NPC PC [--write]

NPC is a `type: npc` note and PC a `type: pc` note, each a vault-relative
path or a name. Both must exist: a skill creates the PC from its template
first. Without --write it prints the plan and writes nothing; with --write
it carries the whole plan out or, on any failure, leaves the vault as it
was.

What moves into the PC note, word for word:

- Frontmatter: `aliases`, `gm_aliases` and `tags` are unioned (the NPC's
  name joins `aliases` when the two names differ; a `withheld` NPC's
  names all go to `gm_aliases`); `relationships` are
  unioned, one per (target, type), never a tie to the character itself;
  any other field the PC has but leaves empty (`portrait`, `voice`, ...)
  takes the NPC's value. An NPC field the PC has no counterpart for is
  listed as NOT-CARRIED: it stays in the archived copy.
- Body: nothing is left behind but the H1 title and template
  placeholders. Campaign Log lines go into `## Appearances`, ahead of the
  PC's own; Related lines into `## Relationships` (a list item already
  shown there, outside any fence, once); GM Notes (its lead under
  `### Before They Were a PC`, then each subsection) at the end of the
  PC's `## GM Notes`, as does any section `player_site.hide.sections`
  hides. Every other section, and the text above the first one, goes in
  its own order under `### Before They Were a PC` at the end of the PC's
  `## Background`, its headings demoted to stay under it. A gm-only or
  spoiler fence around a section goes with it. A missing section is
  made before `## Notes` (GM Notes: at the end). An unfilled prompt
  line is dropped; a marker line never is.
- The NPC note moves to `_archive/<its folder>/<name> (NPC).md` with
  `merged_into` set: kept, and never a second note of the PC's name.
  Links that name it by path (wikilinks, markdown links, frontmatter,
  canvas nodes) are rewritten to the PC, by relink.py's own rewriter; a
  bare `[[Name]]` the two notes share is left as written and reaches the
  PC once the NPC is archived, and one to a differently named NPC keeps
  its words as display text (`[[PC|Name]]`; a bare `[[PC]]` in a table
  cell, which takes no display text). A vault with a site has the publish tool
  rewrite its publish list and settings as for a rename (relink's
  REPUBLISH); a vault without one needs no Node.

Rows: MERGE, ADD, SET, FILL, NOT-CARRIED, SKIP, ARCHIVE, RELINK,
REPUBLISH (WOULD-... in a plan), UNSURE and WARNING, then a `#` total.

Exit: 0 done or a clean plan; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import relink
import vault_write as vw
import vaultlib as vl
from migrate_core import StepFailed, write_text_atomic
from vaultlib import cli_name

ARCHIVE_DIR = vl.ARCHIVE_DIR
BEFORE = "Before They Were a PC"
ARCHIVE_SUFFIX = " (NPC)"
SHARED_TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "npc.md"
KEY_LINE_RE = re.compile(r"^([A-Za-z_][\w-]*):")
UNIONED = ("aliases", "gm_aliases", "tags")
# Never copied: the PC's own identity.
NEVER = frozenset({"type", "merged_into"})
EMPTY_VALUES = frozenset({"", "[]", "{}", "null", "~"})


class MergeError(relink.RelinkError):
    """A merge refused or failed; one line."""


@dataclass
class Merge:
    vault: Path
    npc: str
    pc: str
    archive: str
    npc_text: str = ""
    archived_text: str = ""
    rows: list[tuple[str, str, str, str]] = field(default_factory=list)
    # The link rewrite and the publish files, as relink plans a rename.
    links: relink.Plan | None = None

    def row(self, verb: str, rel: str, where: str = "",
            detail: str = "") -> None:
        self.rows.append((verb, rel, where, detail))


# --- frontmatter --------------------------------------------------------------

@dataclass
class Block:
    """One top-level frontmatter key and the lines that belong to it."""
    key: str | None
    lines: list[str]

    @property
    def rest(self) -> str:
        return self.lines[0].split(":", 1)[1] if self.key else ""

    @property
    def children(self) -> list[str]:
        return [ln for ln in self.lines[1:]
                if ln.strip() and not ln.lstrip().startswith("#")]

    def empty(self) -> bool:
        if self.children:
            return False
        return vl.scalar_value(self.rest).casefold() in EMPTY_VALUES


def split_frontmatter(text: str, rel: str) -> tuple[list[Block], int, str]:
    """(the frontmatter as key blocks, the closing line's index, the EOL)."""
    lines = text.splitlines(keepends=True)
    close, err = vl.frontmatter_span(lines)
    if err:
        raise MergeError(f"{rel}: its frontmatter cannot be edited ({err})")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    blocks: list[Block] = []
    for line in lines[1:close]:
        m = KEY_LINE_RE.match(line)
        if m:
            blocks.append(Block(m.group(1), [line]))
        elif blocks:
            blocks[-1].lines.append(line)
        else:
            blocks.append(Block(None, [line]))
    return blocks, close, eol


def join_frontmatter(text: str, blocks: list[Block], close: int) -> str:
    lines = text.splitlines(keepends=True)
    return "".join([lines[0], *[ln for b in blocks for ln in b.lines],
                    *lines[close:]])


def _find(blocks: list[Block], key: str) -> Block | None:
    return next((b for b in blocks if b.key == key), None)


def _eol(line: str, eol: str) -> str:
    return line if line.endswith(("\n", "\r")) else line + eol


def _flow_items(rest: str) -> list[str]:
    """The raw items of a `[a, "b"]` value, as written."""
    text = rest.strip()
    end = text.rfind("]")
    if not text.startswith("[") or end < 0:
        return []
    return [v.strip() for v in vl.FLOW_ITEM_RE.findall(text[1:end])
            if v.strip()]


def _add_list_items(block: Block, items: list[str], eol: str) -> None:
    """Append `items` (YAML-quoted) to a list block, in its own style."""
    if block.children:
        first = next(ln for ln in block.lines[1:] if ln.lstrip().startswith("- "))
        pad = first[:len(first) - len(first.lstrip())]
        last = max(i for i, ln in enumerate(block.lines)
                   if ln.strip() and not ln.lstrip().startswith("#"))
        block.lines[last] = _eol(block.lines[last], eol)
        block.lines[last + 1:last + 1] = [f"{pad}- {v}{eol}" for v in items]
        return
    have = _flow_items(block.rest)
    value = vl.scalar_value(block.rest)
    if not have and value.casefold() not in EMPTY_VALUES:
        # A single name written as a scalar (`aliases: Captain Vale`) stays.
        have = [vl.yaml_scalar(value)]
    tail = block.lines[0][len(block.lines[0].rstrip("\r\n")):] or eol
    block.lines[0] = f"{block.key}: [{', '.join(have + items)}]{tail}"


def _names(fm: dict[str, Any], key: str) -> list[str]:
    value = fm.get(key)
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(v).strip() for v in value or [] if str(v).strip()]


def _flow_style(block: Block) -> bool:
    """A field written on its key's line (`relationships: [{...}]`), not
    as a block list: not empty, and no item lines under it."""
    return not block.children and not block.empty()


def _rel_items(block: Block | None) -> list[list[str]]:
    """The items of a `relationships:` block, each its lines."""
    if block is None:
        return []
    items: list[list[str]] = []
    pad: int | None = None
    for line in block.lines[1:]:
        stripped = line.lstrip()
        depth = len(line) - len(stripped)
        if stripped.startswith("- ") and (pad is None or depth <= pad):
            pad = depth
            items.append([line])
        elif items:
            items[-1].append(line)
    return items


REL_FIELD_RE = r"(?:^|[\s{{,]){0}:\s*(\"(?:\\.|[^\"\\])*\"|'(?:''|[^'])*'|[^,}}\n#]*)"


def _rel_key(item: list[str]) -> tuple[str, str]:
    text = "".join(item)
    target = re.search(REL_FIELD_RE.format("target"), text)
    rtype = re.search(REL_FIELD_RE.format("type"), text)
    name = vl.link_target(vl.wikilink_target(
        vl.scalar_value(target.group(1)) if target else ""))
    return name, (vl.scalar_value(rtype.group(1)).casefold() if rtype else "")


def _rel_label(item: list[str]) -> str:
    """`type [[Target]]`, as a plan row shows a tie."""
    text = "".join(item)
    target = re.search(REL_FIELD_RE.format("target"), text)
    shown = vl.wikilink_target(vl.scalar_value(target.group(1))) if target else ""
    return f"{_rel_key(item)[1] or '?'} [[{shown}]]"


def _reindent(item: list[str], to: int, eol: str) -> list[str]:
    first = item[0]
    have = len(first) - len(first.lstrip())
    out = []
    for line in item:
        if to >= have:
            line = " " * (to - have) + line
        else:
            cut = min(have - to, len(line) - len(line.lstrip(" ")))
            line = line[cut:]
        out.append(_eol(line, eol))
    return out


def _withheld(text: str) -> bool:
    """Whether the note's own name is a secret (`withheld: true`), read by
    the publish tool where it can be, else as YAML writes true."""
    try:
        return vl.note_withheld(text)[0]
    except vl.PublishToolUnavailable:
        raw = vl.get_key(vl.raw_frontmatter(text).splitlines(), "withheld") or ""
        return vl.scalar_value(raw).casefold() in ("true", "yes", "on")


def merge_frontmatter(m: Merge, npc_text: str, pc_text: str) -> str:
    npc_blocks, _c, _e = split_frontmatter(npc_text, m.npc)
    pc_blocks, close, eol = split_frontmatter(pc_text, m.pc)
    npc_fm = vl.extract_frontmatter(npc_text) or {}
    pc_fm = vl.extract_frontmatter(pc_text) or {}
    npc_name, pc_name = relink._stem(m.npc), relink._stem(m.pc)
    selves = {vl.normalize(npc_name), vl.normalize(pc_name)}

    # Names: every name either note goes by, once; a secret stays secret.
    # A withheld NPC's own names are all secrets: they join gm_aliases.
    hidden = _withheld(npc_text)
    secret = {vl.normalize(a) for a in _names(pc_fm, "gm_aliases")}
    public = {vl.normalize(a) for a in _names(pc_fm, "aliases")}
    own = ([npc_name] if vl.normalize(npc_name) != vl.normalize(pc_name)
           else [])
    for key in UNIONED:
        wanted = _names(npc_fm, key)
        if key == "aliases":
            wanted = [] if hidden else [*own, *wanted]
        elif key == "gm_aliases" and hidden:
            wanted = [*own, *_names(npc_fm, "aliases"), *wanted]
        norm: Callable[[str], str] = (
            str.casefold if key == "tags" else vl.normalize)
        have = ({norm(t) for t in _names(pc_fm, key)} if key == "tags"
                else {vl.normalize(pc_name)} | public | secret)
        new: list[str] = []
        for value in wanted:
            if norm(value) in have:
                continue
            have.add(norm(value))
            new.append(value)
        if not new:
            continue
        block = _find(pc_blocks, key)
        if block is None:
            block = Block(key, [f"{key}: []{eol}"])
            at = next((i + 1 for i, b in enumerate(pc_blocks)
                       if b.key in ("aliases", "gm_aliases")), len(pc_blocks))
            pc_blocks.insert(at, block)
        _add_list_items(block, [vl.yaml_scalar(v) for v in new], eol)
        if key != "tags":
            (public if key == "aliases" else secret).update(
                vl.normalize(v) for v in new)
        m.row("SET", m.pc, key, "+ " + ", ".join(new))

    # Relationships: one per (target, type), never to the character. The
    # scripts read YAML line by line, so a flow-style list is not one they
    # can extend: refused on the PC, listed as not carried from the NPC.
    pc_rel = _find(pc_blocks, "relationships")
    npc_rel = _find(npc_blocks, "relationships")
    if npc_rel is not None and _flow_style(npc_rel):
        m.row("NOT-CARRIED", m.npc, "relationships",
              "written as a flow list (kept in the archived copy)")
        npc_rel = None
    if (pc_rel is not None and _flow_style(pc_rel) and npc_rel is not None
            and _rel_items(npc_rel)):
        raise MergeError(f"{m.pc}: its relationships are written as a flow "
                         f"list ([{{...}}]); write them one per line first; "
                         f"nothing was changed")
    pc_items = _rel_items(pc_rel)
    real = [it for it in pc_items if _rel_key(it)[0]]
    seen = {_rel_key(it) for it in real}
    added: list[list[str]] = []
    for item in _rel_items(npc_rel):
        k = _rel_key(item)
        if not k[0] or k[0] in selves or k in seen:
            continue
        seen.add(k)
        added.append(item)
    if added:
        if pc_rel is None:
            pc_rel = Block("relationships", [f"relationships:{eol}"])
            pc_blocks.append(pc_rel)
        else:
            tail = pc_rel.lines[0][len(pc_rel.lines[0].rstrip("\r\n")):] or eol
            pc_rel.lines[0] = f"relationships:{tail}"
        pad = (len(real[0][0]) - len(real[0][0].lstrip())) if real else 2
        kept = [ln for it in real for ln in it]
        # Comment lines above the first item stay; the template's empty
        # tie goes.
        head = pc_rel.lines[1:len(pc_rel.lines) - sum(map(len, pc_items))]
        pc_rel.lines[1:] = head + [_eol(ln, eol) for ln in kept] + [
            ln for it in added for ln in _reindent(it, pad, eol)]
        m.row("SET", m.pc, "relationships",
              "+ " + ", ".join(_rel_label(it) for it in added))

    # Every other field: filled where the PC leaves it empty.
    for nb in npc_blocks:
        if nb.key is None or nb.key in NEVER or nb.key in UNIONED \
                or nb.key == "relationships" or nb.empty():
            continue
        pb = _find(pc_blocks, nb.key)
        shown = " ".join(ln.strip() for ln in nb.lines)[len(nb.key) + 1:].strip()
        if pb is None:
            if vl.scalar_value(nb.rest).casefold() != "false" or nb.children:
                m.row("NOT-CARRIED", m.npc, nb.key,
                      f"{shown} (kept in the archived copy)")
            continue
        if not pb.empty():
            continue
        pb.lines[:] = [_eol(ln, eol) for ln in nb.lines]
        m.row("FILL", m.pc, nb.key, shown)
    if pc_blocks:
        pc_blocks[-1].lines[-1] = _eol(pc_blocks[-1].lines[-1], eol)
    return join_frontmatter(pc_text, pc_blocks, close)


# --- body ---------------------------------------------------------------------

def _template_lines(vault: Path) -> set[str]:
    """Every line of the NPC templates (the vault's and the plugin's),
    stripped: a line still reading as one is an unfilled prompt."""
    out: set[str] = set()
    for path in (vault / "_Templates" / "_Template_NPC.md", SHARED_TEMPLATE):
        try:
            text = path.read_text(encoding="utf-8-sig")
        except OSError:
            continue
        out |= {ln.strip() for ln in text.splitlines() if ln.strip()}
    return out


COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def _is_placeholder(lines: list[str], template: set[str]) -> bool:
    """Only the template's prompts, its own comments and fence markers. A
    comment the GM wrote is content."""
    def drop(c: re.Match[str]) -> str:
        own = [ln.strip() for ln in c.group(0).splitlines() if ln.strip()]
        return ("" if vl.markers_in(c.group(0))
                or all(ln in template for ln in own) else c.group(0))
    text = COMMENT_RE.sub(drop, "".join(lines))
    rest = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return all(ln in template or re.fullmatch(r"\{.*\}", ln) or
               ln.startswith("#") for ln in rest)


def _prompt_line(line: str, template: set[str]) -> bool:
    s = line.strip()
    return bool(s) and s in template and ("{" in s or (
        s.startswith("<!--") and s.endswith("-->")
        and not vl.markers_in(s)))


def _trim(lines: list[str]) -> list[str]:
    while lines and not lines[0].strip():
        lines = lines[1:]
    while lines and not lines[-1].strip():
        lines = lines[:-1]
    return lines


def _demote(doc: vw.Doc, lo: int, hi: int, by: int) -> dict[int, str]:
    """Heading lines in [lo, hi) pushed down `by` levels (at most ######)."""
    out: dict[int, str] = {}
    for h in doc.heads:
        if lo <= h.idx < hi:
            line = doc.lines[h.idx]
            hashes = len(line) - len(line.lstrip("#"))
            out[h.idx] = "#" * min(6, hashes + by) + line[hashes:]
    return out


def _dropped(doc: vw.Doc, i: int, template: set[str]) -> bool:
    """An unfilled prompt, or a line of the template's own comments."""
    line = doc.lines[i]
    if _prompt_line(line, template):
        return True
    state = next((s for s in doc.states if s.lineno - 1 == i), None)
    return bool(state and state.comment and line.strip() in template
                and not vl.markers_in(line))


def _content(doc: vw.Doc, start: int, end: int, template: set[str],
             demote: int = 0) -> list[str]:
    """Lines start..end of the doc, unfilled prompts dropped, headings
    demoted, without line endings."""
    swap = _demote(doc, start, end, demote) if demote else {}
    out = [swap.get(i, doc.lines[i]).rstrip("\r\n") for i in range(start, end)
           if not _dropped(doc, i, template)]
    return _trim(out)


def _h2(doc: vw.Doc, title: str) -> vw.Head | None:
    return next((h for h in doc.heads
                 if h.level == 2 and vw.key(h.title) == vw.key(title)), None)


def _before_head(doc: vw.Doc, head: vw.Head) -> int:
    """Where a new section goes in front of `head`: before the gm-only or
    spoiler opener that wraps it, if one does."""
    if not head.gm:
        return head.idx
    openers = [s.lineno - 1 for s in doc.states
               if s.marker in vw.OPENERS and s.lineno - 1 < head.idx]
    return max(openers) if openers else head.idx


GM_OPEN, GM_CLOSE = "<!-- gm-only -->", "<!-- /gm-only -->"
SP_OPEN, SP_CLOSE = "<!-- spoiler -->", "<!-- /spoiler -->"


@dataclass
class Parts:
    """What the NPC's body gives the PC note, each as lines (no endings)."""
    story: list[tuple[str, list[str]]] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    related: list[str] = field(default_factory=list)
    gm: list[tuple[str, list[str]]] = field(default_factory=list)


def _depths(doc: vw.Doc, idx: int) -> tuple[int, int]:
    """(gm-only, spoiler) fences open at line `idx`."""
    state = next((s for s in doc.states if s.lineno - 1 == idx), None)
    return (state.gm_depth, state.spoiler_depth) if state else (0, 0)


def _wrap(lines: list[str], depths: tuple[int, int]) -> list[str]:
    """`lines` inside the fences that were open around them in the NPC."""
    gm, spoiler = depths
    if not (gm or spoiler) or not lines:
        return lines
    opens = [GM_OPEN] * gm + [SP_OPEN] * spoiler
    closes = [SP_CLOSE] * spoiler + [GM_CLOSE] * gm
    return [*opens, "", *lines, "", *closes]


def _has_marker(line: str) -> bool:
    return bool(vl.markers_in(line))


def _unbalanced(lines: list[str]) -> list[int]:
    """Indexes of the marker lines in `lines` that open or close a fence
    outside them."""
    stacks: dict[str, list[int]] = {"gm-only": [], "spoiler": []}
    loose: list[int] = []
    for i, line in enumerate(lines):
        for _pos, name, closer in vl.markers_in(line):
            if not closer:
                stacks[name].append(i)
            elif stacks[name]:
                stacks[name].pop()
            else:
                loose.append(i)
    return sorted(set(loose + stacks["gm-only"] + stacks["spoiler"]))


def _piece(doc: vw.Doc, start: int, end: int, template: set[str],
           demote: int = 0) -> tuple[list[str], bool]:
    """(lines start..end as carried, whether they hold anything): unfilled
    prompts dropped, headings demoted. A placeholder keeps only the
    marker lines a fence outside it needs."""
    raw = doc.lines[start:end]
    if _is_placeholder(raw, template):
        keep = _unbalanced([ln.rstrip("\r\n") for ln in raw])
        return [raw[i].rstrip("\r\n") for i in keep], False
    return _content(doc, start, end, template, demote), True


def _npc_parts(m: Merge, text: str, template: set[str]) -> Parts:
    """Every part of the NPC's body and where it goes in the PC note.
    Nothing is left behind but the H1 title and template placeholders."""
    doc = vw.parse(text)
    if doc.problems:
        raise MergeError(f"{m.npc}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    hidden = {vw.key(h) for h in vw.hidden_sections(m.vault)}
    out = Parts()
    body = doc.states[0].lineno - 1 if doc.states else len(doc.lines)
    covered = [False] * len(doc.lines)
    h2s = [h for h in doc.heads if h.level == 2]
    for head in h2s:
        end = vw.section_end(doc, head)
        for i in range(head.idx, end):
            covered[i] = True
    # Text outside every ## section (under the title, between sections):
    # carried first, without a heading. A fence marker splits it, so each
    # stretch keeps the fences that were open around it.
    loose: list[str] = []
    run: list[int] = []
    titles = {h.idx for h in doc.heads if h.level == 1}

    def flush() -> None:
        lines = [doc.lines[i].rstrip("\r\n") for i in run]
        if lines and not _is_placeholder([ln + "\n" for ln in lines],
                                         template):
            if loose:
                loose.append("")
            loose.extend(_wrap(_trim(lines), _depths(doc, run[0])))
        run.clear()
    for i in range(body, len(doc.lines)):
        if covered[i] or i in titles or _dropped(doc, i, template):
            flush()
            continue
        if vl.markers_in(doc.lines[i]):
            flush()
            if vl.marker_re().sub("", doc.lines[i]).strip():
                # Text beside a marker: its own stretch, markers and all.
                run.append(i)
                flush()
            continue
        run.append(i)
    flush()
    if any(ln.strip() for ln in loose):
        out.story.append(("", loose))
        m.row("ADD", m.pc, f"\u00a7Background/{BEFORE}",
              "the text above the NPC's first section")

    for head in h2s:
        end = vw.section_end(doc, head)
        depths = _depths(doc, head.idx)
        k = vw.key(head.title)
        if k == vw.GM_NOTES:
            subs = [h for h in doc.heads
                    if h.level == 3 and head.idx < h.idx < end]
            lead_end = subs[0].idx if subs else end
            lines, real = _piece(doc, head.idx + 1, lead_end, template, 1)
            block = ([f"### {BEFORE}", "", *lines] if real else lines)
            names = [BEFORE] if real else []
            for n, sub in enumerate(subs):
                stop = subs[n + 1].idx if n + 1 < len(subs) else end
                lines, real = _piece(doc, sub.idx + 1, stop, template)
                if not real:
                    m.row("SKIP", m.npc, f"\u00a7GM Notes/{sub.title}",
                          "template placeholder")
                    block += ["", *lines]
                    continue
                names.append(sub.title)
                block += ["", doc.lines[sub.idx].rstrip("\r\n"), "", *lines]
            if names:
                out.gm.append((", ".join(names), _wrap(_trim(block),
                                                       depths)))
            elif any(ln.strip() for ln in block):
                out.gm.append(("", _wrap(_trim(block), depths)))
            continue
        lines, real = _piece(doc, head.idx + 1, end, template,
                             1 if k in hidden else 2)
        if not real:
            m.row("SKIP", m.npc, f"\u00a7{head.title}", "template placeholder")
            if lines:
                out.story.append(("", _wrap(lines, depths)))
            continue
        if k in hidden:
            # Hidden from players on the NPC's page: kept from them here.
            out.gm.append((head.title, _wrap(
                [f"### {head.title}", "", *lines], depths)))
        elif k == vw.key("Campaign Log"):
            out.log += ([""] if out.log else []) + _wrap(lines, depths)
        elif k == vw.key("Related"):
            out.related += ([""] if out.related else []) + _wrap(lines, depths)
        else:
            out.story.append((head.title, _wrap(
                [f"#### {head.title}", "", *lines], depths)))
    return out


def _place(text: str, at: int, block: list[str]) -> str:
    return vw.place(vw.parse(text), at, block)


def _new_section_at(doc: vw.Doc) -> int:
    """A new player-facing section goes before Notes, else GM Notes, else
    at the end."""
    for title in ("Notes", "GM Notes"):
        head = _h2(doc, title)
        if head is not None:
            return _before_head(doc, head)
    return len(doc.lines)


def _dedupe(lines: list[str], doc: vw.Doc, head: vw.Head,
            end: int) -> list[str]:
    """`lines` less the list items the PC section already shows. Only an
    item outside every fence, on both sides, counts: a marker line, or a
    line a fence hides, is never taken out."""
    shown = {s.lineno - 1 for s in doc.states
             if s.gm_depth == 0 and s.spoiler_depth == 0}
    have = {doc.lines[i].strip() for i in vw.own_lines(doc, head, end)
            if i in shown and vw.LIST_RE.match(doc.lines[i])}
    out, gm, spoiler = [], 0, 0
    for line in lines:
        for _pos, name, closer in vl.markers_in(line):
            step = -1 if closer else 1
            if name == "gm-only":
                gm += step
            else:
                spoiler += step
        if (not gm and not spoiler and not _has_marker(line)
                and vw.LIST_RE.match(line) and line.strip() in have):
            continue
        out.append(line)
    return _trim(out)


def merge_body(m: Merge, npc_text: str, pc_text: str) -> str:
    template = _template_lines(m.vault)
    parts = _npc_parts(m, npc_text, template)
    first_row = len(m.rows)
    text = pc_text
    if vw.parse(text).problems:
        raise MergeError(f"{m.pc}: gm-only fence is unbalanced "
                         f"({vw.parse(text).problems[0]})")

    gm_block = [ln for _name, lines in parts.gm for ln in ["", *lines]]
    if any(ln.strip() for ln in gm_block):
        gm_block = _trim(gm_block)
        doc = vw.parse(text)
        head = _h2(doc, "GM Notes")
        if head is None:
            text = _place(text, len(doc.lines), ["## GM Notes", "", *gm_block])
            how = "new section: "
        else:
            text = _place(text, vw.section_end(doc, head), gm_block)
            how = ""
        for name, _lines in parts.gm:
            if name:
                m.row("ADD", m.pc, "\u00a7GM Notes", how + name)
                how = ""

    for title, lines, first in (("Relationships", parts.related, False),
                                ("Appearances", parts.log, True)):
        if not lines:
            continue
        doc = vw.parse(text)
        head = _h2(doc, title)
        if head is None:
            text = _place(text, _new_section_at(doc), [f"## {title}", "",
                                                       *lines])
            m.row("ADD", m.pc, f"\u00a7{title}",
                  f"new section, {len(lines)} line(s)")
            continue
        end = vw.section_end(doc, head)
        lines = _dedupe(lines, doc, head, end)
        if not any(ln.strip() for ln in lines):
            m.row("SKIP", m.pc, f"\u00a7{title}", "already there")
            continue
        at = end
        if first:
            # The NPC's appearances came first: ahead of the PC's own list.
            # Its own lines only: never into a code block or an aside.
            at = next((i for i in vw.own_lines(doc, head, end)
                       if vw.LIST_RE.match(doc.lines[i])), end)
        if at < end:
            new = list(doc.lines)
            new[at:at] = [ln + doc.eol for ln in lines]
            text = "".join(new)
        else:
            text = _place(text, at, lines)
        m.row("ADD", m.pc, f"\u00a7{title}", f"{len(lines)} line(s)")

    if parts.story:
        doc = vw.parse(text)
        head = _h2(doc, "Background")
        block = [f"### {BEFORE}"]
        for _name, lines in parts.story:
            block += ["", *lines]
        if head is None:
            sheet = _h2(doc, "Stat Sheet")
            nxt = (next((h for h in doc.heads if h.level <= 2
                         and h.idx > sheet.idx), None) if sheet else
                   next((h for h in doc.heads if h.level <= 2), None))
            at = _before_head(doc, nxt) if nxt else len(doc.lines)
            text = _place(text, at, ["## Background", "", *block])
            how = "new section: "
        else:
            text = _place(text, vw.section_end(doc, head), block)
            how = ""
        for name, _lines in parts.story:
            if name:
                m.row("ADD", m.pc, f"\u00a7Background/{BEFORE}", how + name)
                how = ""
    # Rows in the note's own order, not the order the writes were made.
    order = ("\u00a7Background", "\u00a7Relationships", "\u00a7Appearances",
             "\u00a7GM Notes")
    m.rows[first_row:] = sorted(m.rows[first_row:], key=lambda r: next(
        (n for n, w in enumerate(order) if r[2].startswith(w)), len(order)))
    problems = vw.parse(text).problems
    if problems:
        raise MergeError(f"{m.pc}: the merge would leave a gm-only fence "
                         f"unbalanced ({problems[0]}); nothing was changed")
    return text


# --- the plan -----------------------------------------------------------------

def _resolve(vault: Path, raw: str, want: str, what: str) -> str:
    batch = vw.Batch(vault)
    try:
        rel = batch.note_named(raw, {want}, what)
    except vw.WriteError as e:
        raise MergeError(str(e)) from None
    if not (vault / rel).is_file():
        raise MergeError(f"{rel} does not exist")
    text = relink._read(vault, rel)
    if text is None:
        raise MergeError(f"{rel} is not valid UTF-8")
    got = vl.entity_type(vl.extract_frontmatter(text) or {})
    if got != want:
        raise MergeError(f"{rel} is type {got or '(none)'}, not {want}; "
                         f"nothing was changed")
    return rel


def archive_path(npc: str) -> str:
    """Where the merged NPC note is kept: under `_archive/`, its name
    marked, so no bare link or name lookup finds two notes called the
    character's name."""
    folder, name = posixpath.split(npc)
    return posixpath.join(ARCHIVE_DIR, folder,
                          f"{name[:-3]}{ARCHIVE_SUFFIX}.md")


def plan(vault: Path, npc_raw: str, pc_raw: str) -> tuple[Merge, dict[str, str], dict[str, str]]:
    """(the merge, every changed file's text before, after). Writes nothing."""
    npc = _resolve(vault, npc_raw, "npc", "NPC")
    pc = _resolve(vault, pc_raw, "pc", "PC")
    if vl.is_record_copy(npc):
        raise MergeError(f"{npc} is an archived or QA copy, not a live note")
    archive = archive_path(npc)
    if (vault / archive).exists():
        raise MergeError(f"{archive} already exists; nothing was changed")
    npc_text = relink._read(vault, npc) or ""
    m = Merge(vault, npc, pc, archive, npc_text)
    pc_text = relink._read(vault, pc) or ""
    if "merged_into" in (vl.extract_frontmatter(npc_text) or {}):
        raise MergeError(f"{npc} is already merged (merged_into)")

    # The site, asked as relink asks it: what the merge changes in its own
    # files, and where its link map sends each bare spelling of the NPC's
    # name. A vault with no site is not asked and needs no Node.
    notes = relink._walk(vault, ".md")
    moves = [(npc, pc)]
    p = relink.Plan(vault, npc, pc)
    site = relink._has_site(vault)
    listed = (vault / relink.MANIFEST_REL).is_file()
    try:
        answer = relink._ask_publish(vault, npc, pc, listed, site)
        if site and answer is not None:
            sources = [t for t in (relink._read(vault, r) for r in notes)
                       if t is not None]
            sources += [t for t in (relink._read(vault, c) for c in
                                    relink._walk(vault, ".canvas"))
                        if t is not None]
            names = relink._spellings(sources, moves)
            if names:
                asked = relink._ask_publish(vault, npc, pc, listed, site,
                                            names)
                if asked is not None and asked.get("owners"):
                    p.owners = dict(asked["owners"])
                    p.published = {relink._nfc(x)
                                   for x in asked.get("published", [])}
    except relink.RelinkError as e:
        raise MergeError(str(e).replace("a rename", "the merge")) from None

    # Links: relink's rewriter, as if the NPC note were renamed to the PC's.
    res = relink._Resolver(notes, moves, p.owners, p.published,
                           keep_name=True)
    # The NPC's own text, read as if it sat where the PC does: links to
    # itself name the PC, relative links keep their targets.
    moved_npc = relink._rewrite_note(npc, npc_text, res,
                                     relink.Plan(vault, npc, pc))
    merged = merge_body(m, moved_npc, merge_frontmatter(m, moved_npc, pc_text))
    texts: dict[str, str | None] = {}
    for rel in notes:
        if rel == npc:
            continue
        text = merged if rel == pc else relink._read(vault, rel)
        texts[rel] = text
        if text is None:
            hit = res.linked(rel, relink._raw(vault, rel))
            if hit:
                raise MergeError(f"{rel} is not valid UTF-8 and links to "
                                 f"{relink._stem(hit)}; fix its encoding first")
            p.warnings.append(f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = relink._rewrite_note(rel, text, res, p)
        if rel == pc or changed != text:
            p.originals[rel] = pc_text if rel == pc else text
            p.texts[rel] = changed
    for rel in relink._walk(vault, ".canvas"):
        text = relink._read(vault, rel)
        if text is None:
            if res.linked(rel, relink._raw(vault, rel), canvas=True):
                raise MergeError(f"{rel} is not valid UTF-8 and links to "
                                 f"{relink._stem(npc)}; fix its encoding first")
            continue
        changed = relink._rewrite_canvas(rel, text, moves, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    if vl.normalize(relink._stem(npc)) == vl.normalize(relink._stem(pc)):
        # A bare link the two notes share reads the same either way.
        p.unsure = []

    # The site's own files that name the note, as for a rename.
    if answer:
        for why in ("detaches", "refusal"):
            if answer.get(why):
                raise MergeError(f"{answer[why]}; nothing was changed")
        if answer.get("unpublishes"):
            p.warnings.append(f"{answer['unpublishes']}: the merged note "
                              f"is not on the site")
        before = relink._read(vault, relink.MANIFEST_REL) if listed else None
        relink._publish_updates(p, answer, {npc: npc_text}, res)
        if before and relink.MANIFEST_REL in p.texts and pc in before:
            p.warnings.append(f"{relink.MANIFEST_REL} now names {pc} twice "
                              f"(the NPC's entry became the PC's); if the "
                              f"two sit in different lists, keep the one "
                              f"that is meant")

    # The archived copy: the NPC note as it was, marked merged.
    lines = npc_text.splitlines(keepends=True)
    close, err = vl.frontmatter_span(lines)
    if err:
        raise MergeError(f"{npc}: its frontmatter cannot be edited ({err})")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = lines[1:close]
    if fm and not fm[-1].endswith(("\n", "\r")):
        fm[-1] += eol
    vl.set_key(fm, "merged_into", vl.yaml_scalar(f"[[{relink._stem(pc)}]]"),
               eol)
    lines[1:close] = fm
    m.archived_text = "".join(lines)
    m.links = p
    originals = {rel: p.originals[rel] for rel in p.texts}
    return m, originals, dict(p.texts)


def rows(m: Merge, done: bool = False) -> list[str]:
    def verb(v: str) -> str:
        if v in ("SKIP", "NOT-CARRIED"):
            return v
        if done:
            return {"MERGE": "MERGED", "ADD": "ADDED", "SET": "SET",
                    "FILL": "FILLED"}.get(v, v)
        return f"WOULD-{v}"
    p = m.links
    assert p is not None
    out = [f"{verb('MERGE')}\t{m.npc}\t-> {m.pc}"]
    out += ["\t".join((verb(v), rel, where, detail)).rstrip("\t")
            for v, rel, where, detail in m.rows]
    arch = "ARCHIVED" if done else "WOULD-ARCHIVE"
    out.append(f"{arch}\t{m.npc}\t-> {m.archive}\tmerged_into: "
               f"\"[[{relink._stem(m.pc)}]]\"")
    rel_verb = "RELINKED" if done else "WOULD-RELINK"
    out += [f"{rel_verb}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
            for c in p.changes]
    rep = "REPUBLISHED" if done else "WOULD-REPUBLISH"
    out += [f"{rep}\t{r}\t{m.npc} -> {m.pc}" for r in p.republished]
    out += [f"UNSURE\t{c.rel}:{c.lineno}\t{c.before} — two notes have "
            f"this name; left as written" for c in p.unsure]
    out += [f"WARNING\t{w}" for w in p.warnings]
    files = len({c.rel for c in p.changes})
    out.append(f"# 1 merge, {len(p.changes)} link(s) in {files} note(s)"
               + (f", {len(p.republished)} publish file(s) updated"
                  if p.republished else "")
               + (f", {len(p.unsure)} left as written" if p.unsure else ""))
    return out


# --- applying it ----------------------------------------------------------------

def _check_fresh(m: Merge, originals: dict[str, str]) -> None:
    stale = "changed since the plan; nothing was changed, run it again"
    for rel, text in originals.items():
        if relink._read(m.vault, rel) != text:
            raise MergeError(f"{rel} {stale}")
    if relink._read(m.vault, m.npc) != m.npc_text:
        raise MergeError(f"{m.npc} {stale}")
    if (m.vault / m.archive).exists():
        raise MergeError(f"{m.archive} {stale}")


def apply(m: Merge, originals: dict[str, str], texts: dict[str, str]) -> list[str]:
    """Carry the merge out, or leave the vault exactly as it was."""
    _check_fresh(m, originals)
    written: list[str] = []
    made: list[Path] | None = None
    try:
        for rel in sorted(texts):
            written.append(rel)
            write_text_atomic(m.vault / rel, texts[rel])
        made = relink._move(m.vault, m.npc, m.archive)
        write_text_atomic(m.vault / m.archive, m.archived_text)
    except BaseException as e:
        stuck: list[str] = []
        if made is not None:
            try:
                if vw._on_disk(m.vault / m.archive) != m.npc_text:
                    write_text_atomic(m.vault / m.archive, m.npc_text)
                relink._move(m.vault, m.archive, m.npc)
                for d in reversed(made):
                    try:
                        d.rmdir()
                    except OSError:
                        pass
            except BaseException:
                stuck.append(f"{m.npc} (still at {m.archive})")
        for rel in written:
            try:
                write_text_atomic(m.vault / rel, originals[rel])
            except BaseException:
                stuck.append(rel)
        said = str(e) or type(e).__name__
        said += (f"; could not put back: {', '.join(stuck)}" if stuck
                 else "; the vault is as it was")
        if isinstance(e, KeyboardInterrupt):
            raise KeyboardInterrupt(said) from None
        raise MergeError(said) from e
    return rows(m, done=True)


def add_parser(sub: Any) -> None:
    """The `npc-merge` subcommand of vault_write.py."""
    ap = sub.add_parser(
        "npc-merge", help="merge an NPC note into its PC note",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Merges the NPC note into the PC note of the same character:\n"
            "frontmatter unioned or filled, the NPC's sections placed\n"
            "word for word in the PC's, the NPC note moved to _archive/\n"
            "with merged_into, path-written links rewritten to the PC.\n"
            "Both notes must exist. Not a batch command.\n"
            "Exit: 0 done or a clean plan, 1 refused, 2 usage."))
    ap.add_argument("npc", help="the NPC note: vault-relative, or its name")
    ap.add_argument("pc", help="the PC note: vault-relative, or its name")
    ap.add_argument("--write", action="store_true",
                    help="write it (default: preview)")


def run(args: argparse.Namespace) -> int:
    vault: Path = args.vault
    try:
        m, originals, texts = plan(vault, args.npc, args.pc)
        out = apply(m, originals, texts) if args.write else rows(m)
    except relink.RelinkError as e:
        print(f"{cli_name()}: {e}", file=sys.stderr)
        return 2 if e.usage else 1
    except (vl.SettingsUnavailable, StepFailed) as e:
        print(f"{cli_name()}: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt as e:
        print(f"{cli_name()}: interrupted; {e}" if str(e)
              else f"{cli_name()}: interrupted", file=sys.stderr)
        return 130
    print("\n".join(out))
    return 0

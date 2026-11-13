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
  name joins `aliases` when the two names differ); `relationships` are
  unioned, one per (target, type), never a tie to the character itself;
  any other field the PC has but leaves empty (`portrait`, `voice`, ...)
  takes the NPC's value. An NPC field the PC has no counterpart for is
  listed as NOT-CARRIED: it stays in the archived copy.
- Body: the NPC's Overview, Appearance & Manner and History go under
  `### Before They Were a PC` at the end of the PC's `## Background`;
  Campaign Log lines go into `## Appearances`, ahead of the PC's own;
  Related lines into `## Relationships` (identical lines once); GM Notes
  (its lead under `### Before They Were a PC`, then each subsection) at
  the end of the PC's `## GM Notes`, inside a gm-only fence when the
  NPC's was fenced. A missing section is made before `## Notes` (GM
  Notes: at the end). A section still holding only the template's
  prompts is not carried, and an unfilled prompt line is dropped.
- The NPC note moves to `_archive/<its folder>/<name> (NPC).md` with
  `merged_into` set: kept, and never a second note of the PC's name.
  Links that name it by path (wikilinks, markdown links, frontmatter,
  canvas nodes) are rewritten to the PC, by relink.py's own rewriter; a
  bare `[[Name]]` the two notes share is left as written and reaches the
  PC once the NPC is archived. A vault with a site has the publish tool
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
# The NPC's player-facing sections that go under BEFORE in Background.
CARRIED_STORY = ("Overview", "Appearance & Manner", "History")
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
    tail = block.lines[0][len(block.lines[0].rstrip("\r\n")):] or eol
    block.lines[0] = f"{block.key}: [{', '.join(have + items)}]{tail}"


def _names(fm: dict[str, Any], key: str) -> list[str]:
    value = fm.get(key)
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(v).strip() for v in value or [] if str(v).strip()]


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


def merge_frontmatter(m: Merge, npc_text: str, pc_text: str) -> str:
    npc_blocks, _c, _e = split_frontmatter(npc_text, m.npc)
    pc_blocks, close, eol = split_frontmatter(pc_text, m.pc)
    npc_fm = vl.extract_frontmatter(npc_text) or {}
    pc_fm = vl.extract_frontmatter(pc_text) or {}
    npc_name, pc_name = relink._stem(m.npc), relink._stem(m.pc)
    selves = {vl.normalize(npc_name), vl.normalize(pc_name)}

    # Names: every name either note goes by, once; a secret stays secret.
    secret = {vl.normalize(a) for a in _names(pc_fm, "gm_aliases")}
    public = {vl.normalize(a) for a in _names(pc_fm, "aliases")}
    for key in UNIONED:
        wanted = _names(npc_fm, key)
        if key == "aliases" and vl.normalize(npc_name) != vl.normalize(pc_name):
            wanted = [npc_name, *wanted]
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

    # Relationships: one per (target, type), never to the character.
    pc_rel = _find(pc_blocks, "relationships")
    pc_items = _rel_items(pc_rel)
    real = [it for it in pc_items if _rel_key(it)[0]]
    seen = {_rel_key(it) for it in real}
    added: list[list[str]] = []
    for item in _rel_items(_find(npc_blocks, "relationships")):
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
    text = COMMENT_RE.sub("", "".join(lines))
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


def _content(doc: vw.Doc, start: int, end: int, template: set[str],
             demote: int = 0) -> list[str]:
    """Lines start..end of the doc, unfilled prompts dropped, headings
    demoted, without line endings."""
    swap = _demote(doc, start, end, demote) if demote else {}
    out = [swap.get(i, doc.lines[i]).rstrip("\r\n") for i in range(start, end)
           if not _prompt_line(doc.lines[i], template)]
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


def _npc_parts(m: Merge, text: str, template: set[str]
               ) -> tuple[list[str], list[str], list[str], list[str], bool]:
    """(the story block for Background, Campaign Log lines, Related lines,
    the GM Notes block, whether GM Notes sat in a gm-only fence)."""
    doc = vw.parse(text)
    if doc.problems:
        raise MergeError(f"{m.npc}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    story: list[str] = []
    for title in CARRIED_STORY:
        head = _h2(doc, title)
        if head is None:
            continue
        end = vw.section_end(doc, head)
        if _is_placeholder(doc.lines[head.idx + 1:end], template):
            m.row("SKIP", m.npc, f"\u00a7{title}", "template placeholder")
            continue
        body = _content(doc, head.idx + 1, end, template, demote=2)
        if body:
            story += ["", f"#### {head.title}", "", *body]

    def section(title: str) -> list[str]:
        head = _h2(doc, title)
        if head is None:
            return []
        end = vw.section_end(doc, head)
        if _is_placeholder(doc.lines[head.idx + 1:end], template):
            m.row("SKIP", m.npc, f"\u00a7{title}", "template placeholder")
            return []
        return _content(doc, head.idx + 1, end, template)

    log = section("Campaign Log")
    related = section("Related")
    gm_block: list[str] = []
    fenced = False
    gm = _h2(doc, "GM Notes")
    if gm is not None:
        fenced = gm.gm
        end = vw.section_end(doc, gm)
        subs = [h for h in doc.heads if h.level == 3 and gm.idx < h.idx < end]
        lead_end = subs[0].idx if subs else end
        lead = doc.lines[gm.idx + 1:lead_end]
        if lead and not _is_placeholder(lead, template):
            body = _content(doc, gm.idx + 1, lead_end, template, demote=1)
            if body:
                gm_block += ["", f"### {BEFORE}", "", *body]
        for n, sub in enumerate(subs):
            stop = subs[n + 1].idx if n + 1 < len(subs) else end
            if _is_placeholder(doc.lines[sub.idx + 1:stop], template):
                m.row("SKIP", m.npc, f"\u00a7GM Notes/{sub.title}",
                      "template placeholder")
                continue
            gm_block += ["", doc.lines[sub.idx].rstrip("\r\n"), "",
                         *_content(doc, sub.idx + 1, stop, template)]
    return story, log, related, _trim(gm_block), fenced


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


def merge_body(m: Merge, npc_text: str, pc_text: str) -> str:
    template = _template_lines(m.vault)
    story, log, related, gm_block, fenced = _npc_parts(m, npc_text, template)
    text = pc_text
    if vw.parse(text).problems:
        raise MergeError(f"{m.pc}: gm-only fence is unbalanced "
                         f"({vw.parse(text).problems[0]})")

    if gm_block:
        doc = vw.parse(text)
        head = _h2(doc, "GM Notes")
        wrap = fenced and (head is None or not head.gm)
        block = (["<!-- gm-only -->", "", *gm_block, "", "<!-- /gm-only -->"]
                 if wrap else gm_block)
        if head is None:
            text = _place(text, len(doc.lines), ["## GM Notes", "", *block])
            how = "new section"
        else:
            text = _place(text, vw.section_end(doc, head), block)
            how = ""
        subs = [ln[4:] for ln in gm_block if ln.startswith("### ")]
        m.row("ADD", m.pc, "\u00a7GM Notes", ", ".join(
            x for x in [how, ", ".join(subs), "gm-only fence" if wrap else ""]
            if x))

    for title, lines, first in (("Relationships", related, False),
                                ("Appearances", log, True)):
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
        have = {doc.lines[i].strip() for i in range(head.idx + 1, end)}
        lines = [ln for ln in lines if not ln.strip() or ln.strip() not in have]
        lines = _trim(lines)
        if not any(ln.strip() for ln in lines):
            m.row("SKIP", m.pc, f"\u00a7{title}", "already there")
            continue
        at = end
        if first:
            # The NPC's appearances came first: ahead of the PC's own list.
            at = next((i for i in range(head.idx + 1, end)
                       if vw.LIST_RE.match(doc.lines[i])), end)
        if at < end:
            new = list(doc.lines)
            new[at:at] = [ln + doc.eol for ln in lines]
            text = "".join(new)
        else:
            text = _place(text, at, lines)
        m.row("ADD", m.pc, f"\u00a7{title}", f"{len(lines)} line(s)")

    if story:
        doc = vw.parse(text)
        head = _h2(doc, "Background")
        block = [f"### {BEFORE}", *story]
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
        titles = [ln[5:] for ln in story if ln.startswith("#### ")]
        m.row("ADD", m.pc, f"\u00a7Background/{BEFORE}",
              how + ", ".join(titles))
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

    # Links: relink's rewriter, as if the NPC note were renamed to the PC's.
    notes = relink._walk(vault, ".md")
    moves = [(npc, pc)]
    res = relink._Resolver(notes, moves)
    p = relink.Plan(vault, npc, pc)
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
    site = relink._has_site(vault)
    listed = (vault / relink.MANIFEST_REL).is_file()
    try:
        answer = relink._ask_publish(vault, npc, pc, listed, site)
    except relink.RelinkError as e:
        raise MergeError(str(e).replace("a rename", "the merge")) from None
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

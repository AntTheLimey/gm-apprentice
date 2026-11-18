#!/usr/bin/env python3
"""npc_stats.py: `vault_check.py VAULT npc-stats`, the NPC notes whose stat
block is missing or a placeholder (#725).

A row a note, `WHY<TAB>path<TAB>who: what is there`, where WHY is

  MISSING      no stat block at all
  PLACEHOLDER  the NPC template's `{STAT BLOCK: …}` paragraph, a system
               block (`shared/templates/npc-stats/<system>.md`) with its
               `{…}` fields unfilled, or words saying the block comes later
               ("built when", "TBD", "to follow", "later")
  BLANK        a stat heading with nothing under it, or a score table left
               empty
  STOCK        a major NPC whose block only names a stock creature ("as
               Priest", "use the Acolyte stat block", "Priest (SRD)") and
               has none of its own; for any other NPC a stock block is enough
               and gives no row

and `who` is `major (companion, key-npc)` or `other`. Major is read from the
vault, never judged: the note has `companion: true`, or an adventure brief's
`## Key NPCs` section links it. Majors sort first.

`--plan PLAN` keeps the NPCs that Plan's scenes name: links in its Planned
and Contingency Scenes, and in the scene notes they point at (`### [[Scene]]`).
`--played` keeps the NPCs play has shown: linked from a Wrap-Up, or from a
scene note marked played (`status: played` or a `played_in` session). Without
`--plan`, an NPC whose `status` is dead is left out. Archived, QA and Midwife
copies are never read as NPCs. Writes nothing.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable

import session_context as sc
from migrate_vault import vault_system
from vaultlib import (WRAP_UP_TYPES, body_of, entity_type, extract_frontmatter,
                      fenced_headings, is_record_copy, link_aliases,
                      link_lines, link_target, live_wikilinks, normalize,
                      normalize_file_arg, section, section_ends, vault_files)

BRIEF_TYPES = ("adventure-brief", "adventure_brief")
PLAN_SECTIONS = ("Planned Scenes", "Contingency Scenes")
TRUE_WORDS = ("true", "yes", "on", "1")

# A heading that holds a stat block: `### Stats`, `## Stats (CoC 7e)`,
# `#### Stat Block`, `## Statistics`. Not `Status`.
STAT_TITLE_RE = re.compile(r"\b(stats|statistics|stat ?blocks?|stat ?sheet)\b",
                           re.I)
# The NPC template's slot, before vault setup put the system's block there.
TEMPLATE_SLOT_RE = re.compile(r"^\{STAT BLOCK:", re.M)
# A `{…}` field of a system block (`{12}`, `{Name}`, `{n or —}`).
BRACE_RE = re.compile(r"\{[^{}\n]+\}")
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
# Words that put the block off to some other time.
DEFER_RE = re.compile(
    r"\b(?:built when|to be built|to be written|build (?:it|them|one|these)"
    r" (?:when|later|at)|TBD|TBC|to follow|to come|later|not yet (?:built|"
    r"written|statted)|pending)\b", re.I)
# A line about stat blocks, where a deferral or a stock name outside a stat
# heading counts.
STAT_WORD_RE = re.compile(r"\b(?:stats?|stat ?blocks?|statted|SRD)\b", re.I)
# Naming a stock creature in place of a block of one's own.
_NAME = r"[A-Z][\w'’-]*(?: [A-Z][\w'’-]*){0,3}"
STOCK_RES = (
    re.compile(rf"\buse (?:the |an? )?(?P<n>{_NAME}) (?:stat ?block|stats)\b",
               re.I),
    re.compile(rf"(?:^|[\s(*_])(?i:as (?:the |an? )?)(?P<n>{_NAME})\b"),
    re.compile(rf"(?P<n>{_NAME}) \((?:SRD|stock|stat block)\)", re.I),
    re.compile(rf"\bSRD (?P<n>{_NAME})"),
    re.compile(rf"\b(?:stat ?block|stats)\s*[:—–-]\s*(?:the |an? )?"
               rf"(?P<n>{_NAME})\s*$", re.I),
)
# A stat and its number, as a block writes them: `STR 50`, `**DEX:** 85`,
# `| WIS | 14 |`, `HP 22`, `ST 10 · DX 12`, `Str +1`.
STAT_PAIR_RE = re.compile(
    r"\b(STR|CON|SIZ|DEX|APP|POW|EDU|INT|WIS|CHA|ST|DX|IQ|HT|HP|AC|MP|SAN|"
    r"FP|Will|Per|Str|Dex|Con|Int|Wis|Cha)\b[^\w\n]{0,8}[+-]?\d+")
NUMBER_RE = re.compile(r"(?<![\w.])[+-]?\d+(?:\.\d+)?%?")
# A block with this many numbers of its own is more than a stock name.
OWN_NUMBERS = 6
TABLE_ROW_RE = re.compile(r"^\s*\|(.*)\|\s*$")
TABLE_RULE_RE = re.compile(r"^[\s|:]*-[\s|:-]*$")


def _short(text: str, width: int = 70) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[:width - 1].rstrip() + "…"


def _is_true(value: Any) -> bool:
    return value is True or str(value).strip().lower() in TRUE_WORDS


def _blank_table(text: str) -> bool:
    """A table in `text` with a row whose cells after the first are all
    empty: a score table nobody filled."""
    for line in text.splitlines():
        m = TABLE_ROW_RE.match(line)
        if not m or TABLE_RULE_RE.match(line):
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) > 1 and not any(cells[1:]):
            return True
    return False


def _stock(text: str) -> str | None:
    """The stock creature `text` names in place of a block, else None."""
    for line in text.splitlines():
        for rx in STOCK_RES:
            m = rx.search(line.strip())
            if m:
                return _short(line.strip(" -*"))
    return None


def _stat_sections(body: str) -> list[str]:
    """The text under each stat heading, to the next heading of its level
    or higher, comments dropped."""
    lines = body.split("\n")
    heads = fenced_headings(body)
    ends = section_ends(heads, len(lines))
    return [COMMENT_RE.sub("", "\n".join(lines[at + 1:end])).strip()
            for (at, _lvl, title), end in zip(heads, ends)
            if STAT_TITLE_RE.search(title)]


def classify(text: str) -> tuple[str, str] | None:
    """(why, what is there) for a note's stat block; None when it has a
    block of its own. `why` is `missing`, `placeholder`, `blank` or
    `stock` (a stock name with no block of its own: a row only for a
    major NPC)."""
    body = body_of(text)
    found = _stat_sections(body)
    if found:
        block = found[0]
        if not block:
            return "blank", "a stat heading with nothing under it"
        brace = BRACE_RE.search(block)
        if brace:
            return ("placeholder", f"the system block's fields are still "
                    f"placeholders ({_short(brace.group(0), 30)})")
        if _blank_table(block):
            return "blank", "the score table is empty"
        if len(NUMBER_RE.findall(block)) >= OWN_NUMBERS:
            return None
        # A short block is read whole; in a longer one (a FitD block has
        # few numbers) only its first line and lines about stat blocks.
        said = [ln for ln in block.splitlines() if ln.strip()]
        if len(said) > 3:
            said = [said[0], *(ln for ln in said[1:]
                               if STAT_WORD_RE.search(ln))]
        defer = next((ln for ln in said if DEFER_RE.search(ln)), None)
        if defer is not None:
            return "placeholder", f"says it comes later (\"{_short(defer)}\")"
        stock = _stock("\n".join(said))
        if stock is not None:
            return "stock", f"names a stock block (\"{stock}\")"
        return None
    plain = COMMENT_RE.sub("", body)
    if TEMPLATE_SLOT_RE.search(plain):
        return "placeholder", "the template's {STAT BLOCK: …} paragraph"
    if len({m.group(1).upper() for m in STAT_PAIR_RE.finditer(plain)}) >= 3:
        return None
    stat_lines = [ln for ln in plain.splitlines() if STAT_WORD_RE.search(ln)]
    defer = next((ln for ln in stat_lines if DEFER_RE.search(ln)), None)
    if defer is not None:
        return "placeholder", f"says it comes later (\"{_short(defer)}\")"
    stock = _stock("\n".join(stat_lines))
    if stock is not None:
        return "stock", f"names a stock block (\"{stock}\")"
    return "missing", "no stat block"


def _links(text: str) -> set[str]:
    """Every live link target in a note, frontmatter included, normalised."""
    return {link_target(m.group(1)) for ln in link_lines(text)
            if not ln.in_code for m in live_wikilinks(ln.line, ln.spans)}


class Notes:
    """The vault's notes, read once: (path, text, frontmatter)."""

    def __init__(self, vault: Path):
        self.all = [(rel, text, extract_frontmatter(text) or {})
                    for rel, text in vault_files(vault)
                    if not is_record_copy(rel)]
        self.npcs = [n for n in self.all if entity_type(n[2]) == "npc"
                     and "merged_into" not in n[2]
                     and not n[0].endswith("_Story.md")]
        self.by_name: dict[str, set[str]] = {}
        for rel, _t, fm in self.npcs:
            for name in (Path(rel).stem, *link_aliases(fm)):
                self.by_name.setdefault(normalize(name), set()).add(rel)

    def npcs_named(self, targets: Iterable[str]) -> set[str]:
        out: set[str] = set()
        for t in targets:
            out |= self.by_name.get(t, set())
        return out


def key_npcs(notes: Notes) -> set[str]:
    """The NPCs an adventure brief's `## Key NPCs` section links."""
    found: set[str] = set()
    for _rel, text, fm in notes.all:
        if entity_type(fm) in BRIEF_TYPES:
            part = section(body_of(text), "Key NPCs")
            if part:
                found |= notes.npcs_named(_links(part))
    return found


def find_plan(notes: Notes, given: str) -> tuple[str, str] | str:
    """(path, text) of the Plan `given` names, by vault path or by note
    name (`[[Name]]` too); otherwise the error to print."""
    want = normalize_file_arg(given.strip().strip("[]"))
    exact = [(r, t) for r, t, _f in notes.all if r == want]
    if exact:
        return exact[0]
    key = normalize(want.removesuffix(".md"))
    hits = [(r, t) for r, t, _f in notes.all if normalize(Path(r).stem) == key]
    if len(hits) == 1:
        return hits[0]
    if hits:
        return (f"--plan {given}: {len(hits)} notes of that name ("
                + ", ".join(r for r, _t in hits) + "); give its path")
    return f"--plan {given}: no note of that name or path in the vault"


def plan_npcs(notes: Notes, plan_text: str) -> set[str]:
    """The NPCs a Plan's scenes name: links in Planned and Contingency
    Scenes, and in the scene notes their `### [[Scene]]` headings point at."""
    names: set[str] = set()
    for title in PLAN_SECTIONS:
        part = section(body_of(plan_text), title)
        if part:
            names |= _links(part)
    pointed = sc.plan_pointers(plan_text)
    for rel, text, fm in notes.all:
        if entity_type(fm) == "scene" and sc.is_pointed_at(rel, pointed):
            names |= _links(text)
    return notes.npcs_named(names)


def played_npcs(notes: Notes) -> set[str]:
    """The NPCs play has shown: linked from a Wrap-Up, or from a scene note
    marked played."""
    names: set[str] = set()
    for _rel, text, fm in notes.all:
        kind = entity_type(fm)
        if kind in WRAP_UP_TYPES or (kind == "scene" and (
                str(fm.get("status", "")).strip().lower() == "played"
                or fm.get("played_in") not in (None, "", []))):
            names |= _links(text)
    return notes.npcs_named(names)


def system_line(vault: Path) -> str:
    """The `# system:` line printed under the rows."""
    system = vault_system(vault)
    if not system:
        return ("# system: none recorded — a block cannot be built until "
                "the game system is chosen")
    base = "coc-7e" if system == "coc-7e-regency" else system
    return f"# system: {system} (block: shared/templates/npc-stats/{base}.md)"


def check_npc_stats(vault: Path, plan: str | None = None,
                    played: bool = False) -> tuple[list[str], str | None]:
    """(rows, error): the rows for `npc-stats`, or the error that stopped it
    (a `--plan` that names no single note)."""
    notes = Notes(vault)
    keep: set[str] | None = None
    if plan is not None:
        found = find_plan(notes, plan)
        if isinstance(found, str):
            return [], found
        keep = plan_npcs(notes, found[1])
    if played:
        shown = played_npcs(notes)
        keep = shown if keep is None else keep & shown
    companions = {rel for rel, _t, fm in notes.npcs
                  if _is_true(fm.get("companion"))}
    keyed = key_npcs(notes)
    rows: list[tuple[bool, str, str]] = []
    for rel, text, fm in notes.npcs:
        if keep is not None and rel not in keep:
            continue
        if plan is None and str(fm.get("status", "")).strip().lower() == "dead":
            continue
        verdict = classify(text)
        if verdict is None:
            continue
        why, what = verdict
        major = [w for w, s in (("companion", companions), ("key-npc", keyed))
                 if rel in s]
        if why == "stock" and not major:
            continue
        who = f"major ({', '.join(major)})" if major else "other"
        need = ("needs a full workup" if major
                else "a stock block will do")
        rows.append((not major, rel,
                     f"{why.upper()}\t{rel}\t{who}: {what} — {need}"))
    return [r for _m, _rel, r in sorted(rows)], None

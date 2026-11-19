#!/usr/bin/env python3
"""npc_stats.py: `vault_check.py VAULT npc-stats`, the NPC notes whose stat
block is missing or a placeholder (#725).

A row a note, `WHY<TAB>path<TAB>who: what is there`, where WHY is

  MISSING      no stat block at all, or only an embed of a note the vault
               does not have
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
`## Key NPCs` section names it in an entry of its own (a `###` heading, or a
list item or paragraph led by its link or bold name). Majors sort first.

`--plan PLAN` keeps the NPCs that Plan's scenes name: links in its Planned
and Contingency Scenes, and in the scene notes they point at (`### [[Scene]]`).
`--played` keeps the NPCs play has shown: linked from a Wrap-Up, or from a
scene note marked played (`status: played` or a `played_in` session). A dead
NPC is always left out: its current hidden fate is death (the last bullet of
GM Notes `### Behind the Scenes` not struck through that opens with a bold
fate, `**Dead.**`), or it has no fate and its `status` is dead. A fate beats
`status`: one who rises again takes a later fate (`**Risen.**`). Archived, QA
and Midwife copies are never read as NPCs. Writes nothing.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Iterable, NamedTuple

import session_context as sc
from migrate_vault import vault_system
from vaultlib import (LINK_RE, WRAP_UP_TYPES, body_of, entity_type,
                      extract_frontmatter, fenced_headings, find_section,
                      h3_blocks,
                      is_record_copy, link_aliases, link_lines, link_name,
                      link_target,
                      live_wikilinks, normalize, normalize_file_arg, section,
                      section_ends, vault_files)

BRIEF_TYPES = ("adventure-brief", "adventure_brief")
PLAN_TYPES = ("session-plan", "session_plan")
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
    r"\b(?:built when|to be built|to be written|to be determined|build "
    r"(?:it|them|one|these) (?:when|later|at)|TBD|TBC|TBA|TODO|to follow|"
    r"to come|later|not yet (?:built|written|statted)|not statted|will be "
    r"statted|placeholder|pending)\b", re.I)
# A line that is itself a deferral marker (`TODO`, `- TBD: stats`).
LEAD_DEFER_RE = re.compile(r"(?:TODO|TBD|TBC|TBA|to follow|to come|"
                           r"placeholder)\b", re.I)
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
EMBED_RE = re.compile(r"!\[\[([^\[\]]+)\]\]")
# The score rows a block must fill: a row of empty cells (CoC's) or one
# that names a score and leaves the rest empty (`| STR | | | |`).
SCORE_NAMES = frozenset(("STR", "CON", "SIZ", "DEX", "APP", "POW", "EDU",
                         "INT", "WIS", "CHA", "ST", "DX", "IQ", "HT"))
TABLE_ROW_RE = re.compile(r"^\s*\|(.*)\|\s*$")
TABLE_RULE_RE = re.compile(r"^[\s|:]*-[\s|:-]*$")


def _short(text: str, width: int = 70) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[:width - 1].rstrip() + "…"


def _is_true(value: Any) -> bool:
    return value is True or str(value).strip().lower() in TRUE_WORDS


def _blank_table(text: str, scores_only: bool = False) -> bool:
    """A table in `text` with a row whose cells after the first are all
    empty: a score table nobody filled. `scores_only` counts only score
    rows, not a weapons table's `| **Melee** | | |` group row."""
    for line in text.splitlines():
        m = TABLE_ROW_RE.match(line)
        if not m or TABLE_RULE_RE.match(line):
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) > 1 and not any(cells[1:]) and (
                not scores_only or not cells[0]
                or cells[0].strip("*_ ").upper() in SCORE_NAMES):
            return True
    return False


class Stock(NamedTuple):
    """A stock creature a line names in place of a block."""
    line: str    # the line, shortened, as a row quotes it
    name: str    # the creature it names (`Priest`)
    words: str   # what else the line says (`with a mace`), or ""


_EDGE_LEAD_RE = re.compile(r"^[\s,;:.)(*_—–-]+")
_SRD_MARK_RE = re.compile(r"\((?:SRD|stock|stat block)\)", re.I)
_EDGE_TAIL_RE = re.compile(r"[\s,;:(*_—–-]+$")
# The label a stock line may open with: `**Stat block:**`, `Stats —`.
_LABEL_RE = re.compile(
    r"^(?:[-*+]\s+)?(?:\*\*|__|\*|_)?(?:stat ?blocks?|stats?|statistics)\s*"
    r"(?:\*\*|__|\*|_)?\s*[:—–-]\s*(?:\*\*|__|\*|_)?\s*", re.I)
_BULLET_RE = re.compile(r"^[-*+]\s+")


def _unlabelled(raw: str) -> str:
    """The line without its list mark and a leading `**Stat block:**`."""
    return _LABEL_RE.sub("", _BULLET_RE.sub("", raw, count=1), count=1).strip()


def _stock(text: str) -> Stock | None:
    """The stock creature `text` names in place of a block, else None.
    `words` is the GM's line whole (minus a leading label), or "" when the
    line holds nothing but the creature's name and the `(SRD)` mark."""
    for line in text.splitlines():
        raw = line.strip()
        for rx in STOCK_RES:
            m = rx.search(raw)
            if m:
                rest = _SRD_MARK_RE.sub(
                    "", raw[:m.start()] + " " + raw[m.end():])
                rest = _LABEL_RE.sub("", _BULLET_RE.sub("", rest.strip(), 1), 1)
                rest = _EDGE_TAIL_RE.sub("", _EDGE_LEAD_RE.sub("", rest))
                whole = _unlabelled(raw)
                return Stock(_short(whole.strip(" -*")), m.group("n"),
                             " ".join(whole.split()) if re.search(r"\w", rest)
                             else "")
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


def _standalone(line: str) -> bool:
    """A line that is itself a stock name or a deferral (`As Priest.`,
    `TODO`), read even in a long block; `poses as a Bluecoat` is not."""
    core = line.strip().lstrip("-*+>_#([ ")
    return (any(rx.match(core) for rx in STOCK_RES)
            or bool(LEAD_DEFER_RE.match(core)))


def _said(lines: list[str]) -> tuple[str, str] | None:
    """A stock name (it wins: a stock block is enough for most NPCs) or,
    on a line with none, words putting the block off."""
    stock = _stock("\n".join(lines))
    if stock is not None:
        return "stock", f"names a stock block (\"{stock.line}\")"
    defer = next((ln for ln in lines if DEFER_RE.search(ln)), None)
    if defer is not None:
        return "placeholder", f"says it comes later (\"{_short(defer)}\")"
    return None


def _section_verdict(block: str, system: str | None,
                     exists: Callable[[str], bool] | None = None
                     ) -> tuple[str, str] | None:
    """`classify`'s verdict on the text under one stat heading."""
    if not block:
        return "blank", "a stat heading with nothing under it"
    # Enough numbers of its own make it the NPC's block, whatever optional
    # field or group row was left; not with its scores unfilled.
    if len(NUMBER_RE.findall(BRACE_RE.sub("", block))) >= OWN_NUMBERS:
        if _blank_table(block, scores_only=True):
            return "blank", "the score table is empty"
        return None
    lines = [ln for ln in block.splitlines() if ln.strip()]
    # A short block is read whole; in a longer one (a FitD block has few
    # numbers) only the lines about stat blocks, or a stock name or
    # deferral standing as a line of its own.
    if len(lines) > 3:
        lines = [ln for ln in lines
                 if STAT_WORD_RE.search(ln) or _standalone(ln)]
    verdict = _said(lines)
    if verdict is not None:
        return verdict
    brace = BRACE_RE.search(block)
    if brace:
        return ("placeholder", f"the system block's fields are still "
                f"placeholders ({_short(brace.group(0), 30)})")
    if _blank_table(block):
        return "blank", "the score table is empty"
    embeds = EMBED_RE.findall(block)
    if (embeds and exists is not None and not EMBED_RE.sub("", block).strip()
            and not any(exists(e) for e in embeds)):
        return ("missing", f"embeds a note that is not in the vault "
                f"(\"![[{_short(embeds[0], 40)}]]\")")
    if system == "fitd" or embeds:
        return None  # an embedded note is a block kept elsewhere
    first = next(ln for ln in block.splitlines() if ln.strip())
    return ("placeholder", f"no block under the stat heading, only words "
            f"(\"{_short(first)}\")")


def classify(text: str, system: str | None = None,
             exists: Callable[[str], bool] | None = None
             ) -> tuple[str, str] | None:
    """(why, what is there) for a note's stat block; None when it has a
    block of its own. `why` is `missing`, `placeholder`, `blank` or
    `stock` (a stock name with no block of its own: a row only for a
    major NPC). `system` is the vault's: in every one but `fitd` a block
    has numbers. `exists` says whether an embed's target is in the vault
    (unchecked without it). Of several stat headings, one block of its own
    is enough."""
    body = body_of(text)
    found = _stat_sections(body)
    if found:
        verdicts = [_section_verdict(block, system, exists)
                    for block in found]
        return None if None in verdicts else verdicts[0]
    plain = COMMENT_RE.sub("", body)
    if TEMPLATE_SLOT_RE.search(plain):
        return "placeholder", "the template's {STAT BLOCK: …} paragraph"
    if len({m.group(1).upper() for m in STAT_PAIR_RE.finditer(plain)}) >= 3:
        return None
    return (_said([ln for ln in plain.splitlines() if STAT_WORD_RE.search(ln)])
            or ("missing", "no stat block"))


def _links(text: str) -> set[str]:
    """Every live link target in a note, frontmatter included, normalised."""
    return {link_target(m.group(1)) for ln in link_lines(text)
            if not ln.in_code for m in live_wikilinks(ln.line, ln.spans)}


class Notes:
    """The vault's notes, read once: (path, text, frontmatter)."""

    def __init__(self, vault: Path):
        self.vault = vault
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

    def exists(self, embed: str) -> bool:
        """Whether an embed's target (`Monk Stats#Stats`, `card.png|200`)
        is in the vault: a note by name, any other file by its name."""
        name = link_name(embed)
        key = normalize(name)
        if any(normalize(Path(rel).stem) == key for rel, _t, _f in self.all):
            return True
        return (bool(re.search(r"\.\w{1,5}$", name))
                and any(p.name == name for p in self.vault.rglob("*.*")))

    def npcs_named(self, targets: Iterable[str]) -> set[str]:
        out: set[str] = set()
        for t in targets:
            out |= self.by_name.get(t, set())
        return out


_LEAD_BOLD_RE = re.compile(r"^\*\*([^*]+?)\*\*")
_NAME_CUT_RE = re.compile(r"\s+[—–-]\s+|\s*\(|,|:")
_ENTRY_RE = re.compile(r"^[-*+]\s+")


def _entry_npcs(notes: Notes, entry: str) -> set[str]:
    """The NPC one Key NPCs entry names: its first link, else its leading
    bold name (or a heading's text), matched against NPC names and aliases.
    Links further inside the entry are other people."""
    m = LINK_RE.search(entry)
    first = entry.split("\n", 1)[0]
    bold = _LEAD_BOLD_RE.match(first)
    if m and (bold is None or m.start() < bold.end()):
        return notes.npcs_named([link_target(m.group(1))])
    name = bold.group(1) if bold else first
    name = name.strip(" *_#").rstrip(":")
    for candidate in (name, _NAME_CUT_RE.split(name, 1)[0]):
        found = notes.npcs_named([normalize(candidate)])
        if found:
            return found
    return set()


def _entries(part: str) -> list[str]:
    """A Key NPCs section's entries: its `###` headings when it has them,
    else each top-level list item or paragraph."""
    heads = h3_blocks(part)
    if heads:
        return [title for title, _body in heads]
    entries: list[str] = []
    current: list[str] = []
    for line in part.splitlines():
        starts = (bool(_ENTRY_RE.match(line))
                  or (not line.startswith((" ", "\t")) and not current))
        if not line.strip() or starts:
            if current:
                entries.append("\n".join(current))
            current = [_ENTRY_RE.sub("", line)] if line.strip() else []
        else:
            current.append(line)
    if current:
        entries.append("\n".join(current))
    return entries


def key_npcs(notes: Notes) -> set[str]:
    """The NPCs an adventure brief's `## Key NPCs` section names, one an
    entry (`_entries`, `_entry_npcs`)."""
    found: set[str] = set()
    for _rel, text, fm in notes.all:
        if entity_type(fm) in BRIEF_TYPES:
            part = section(body_of(text), "Key NPCs")
            for entry in _entries(part or ""):
                found |= _entry_npcs(notes, entry)
    return found


def find_plan(notes: Notes, given: str) -> tuple[str, str] | str:
    """(path, text) of the Plan `given` names, by path (in the vault, or
    a full path to a note inside it) or by note name (`[[Name]]` too);
    otherwise the error to print."""
    raw = given.strip().strip("[]")
    full = Path(raw).expanduser()
    if full.is_absolute():
        try:
            raw = full.resolve().relative_to(notes.vault.resolve()).as_posix()
        except ValueError:
            pass        # outside the vault: matched, and refused, as given
    want = normalize_file_arg(raw)
    exact = [n for n in notes.all if n[0] == want]
    key = normalize(want.removesuffix(".md"))
    hits = exact or [n for n in notes.all if normalize(Path(n[0]).stem) == key]
    plans = [(r, t) for r, t, fm in hits if entity_type(fm) in PLAN_TYPES]
    if len(plans) == 1:
        return plans[0]
    if plans:
        return (f"--plan {given}: {len(plans)} Plans of that name ("
                + ", ".join(r for r, _t in plans) + "); give its path")
    if hits:
        return (f"--plan {given}: {hits[0][0]} is not a Session Plan "
                f"(type: {entity_type(hits[0][2]) or 'none'})")
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


# A Behind the Scenes bullet that opens with a fate: an optional bold
# session link and dash, then the fate in bold (`- **[[Session 01 - …]]**
# — **Dead.** …`). A `~~` before either part strikes it through.
_FATE_RE = re.compile(
    r"^[-*+]\s+(?P<s1>~~)?\s*(?:(?:\*\*)?\[\[[^\]\n]+\]\](?:\*\*)?"
    r"\s*[—–-]+\s*)?(?P<s2>~~)?\*\*(?P<fate>(?!\[\[)[^*\n]+?)\*\*")
_DEAD_RE = re.compile(r"dead\b", re.I)


def hidden_fate(text: str) -> str | None:
    """An NPC's current hidden fate, or None when it has none: the last
    bullet of its GM Notes `### Behind the Scenes` that is not struck
    through and opens with a bold fate, a bold sentence ending in a full
    stop (a `**Label:**` or a bold name is no fate). A later fate beats an
    earlier one."""
    body = body_of(text)
    found = find_section(body, ["GM Notes", "Behind the Scenes"], first=True)
    if not isinstance(found, tuple):
        return None
    fate = None
    for line in body.split("\n")[found[0] + 1:found[1]]:
        m = _FATE_RE.match(line)
        # A fate is a bold sentence (`**Dead.**`, `**Alive, freed.**`): a
        # bold lead with no full stop (`**The Lodge**`, `**Motive:**`) is
        # not one, and neither is a struck one, tildes inside the bold too.
        if m and not (m["s1"] or m["s2"]) \
                and m["fate"].rstrip().endswith(".") \
                and not m["fate"].lstrip().startswith("~~"):
            fate = m["fate"].strip()
    return fate


def is_dead(text: str, fm: dict[str, Any]) -> bool:
    """Is the NPC dead? Its hidden fate says so when it has one (the truth,
    which beats `status`, what the players know); else its `status` does.
    A later fate that is not death (**Alive, freed.**, **Risen.**) beats an
    earlier one; death named anywhere else in a bullet is not a fate."""
    fate = hidden_fate(text)
    if fate is not None:
        return bool(_DEAD_RE.match(fate))
    return str(fm.get("status", "")).strip().lower() == "dead"


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
    system = vault_system(vault)
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
        # Dead in every mode: a Plan names the dead too (a body found, a
        # grave visited). One who acts again has a later fate (**Risen.**).
        if is_dead(text, fm):
            continue
        verdict = classify(text, system, notes.exists)
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


def note_stock(text: str) -> Stock | None:
    """The stock creature a note's stat block names, read as `classify`
    reads it: the lines under its stat heading, else its lines about stat
    blocks (in a block of more than three lines, those and the lines that
    are a stock name on their own)."""
    body = body_of(text)
    found = _stat_sections(body)
    if not found:
        plain = COMMENT_RE.sub("", body)
        return _stock("\n".join(
            ln for ln in plain.splitlines() if STAT_WORD_RE.search(ln)))
    for block in found:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if len(lines) > 3:
            lines = [ln for ln in lines
                     if STAT_WORD_RE.search(ln) or _standalone(ln)]
        stock = _stock("\n".join(lines))
        if stock is not None:
            return stock
    return None


def stock_rows(vault: Path) -> list[str]:
    """`STOCK<TAB>path<TAB>other: <creature>` for each NPC that is not major
    and each creature note whose block only names a stock creature: the
    notes `gma stat-fill` can fill. The dead are left out."""
    notes = Notes(vault)
    system = vault_system(vault)
    major = ({rel for rel, _t, fm in notes.npcs
              if _is_true(fm.get("companion"))} | key_npcs(notes))
    npcs = {rel for rel, _t, _fm in notes.npcs}
    rows = []
    for rel, text, fm in notes.all:
        kind = entity_type(fm)
        if rel in major or not (rel in npcs or kind == "creature") \
                or is_dead(text, fm):
            continue
        verdict = classify(text, system, notes.exists)
        if verdict is None or verdict[0] != "stock":
            continue
        found = note_stock(text)
        rows.append(f"STOCK\t{rel}\tother: "
                    f"{found.name if found else verdict[1]}")
    return sorted(rows)

#!/usr/bin/env python3
"""A D&D 5e (2024) PC's story text: backstory, appearance, facts and personality.

Owns every free-text part of the note that comes from a player. Three jobs, all pure
(text in, text out, nothing read or written on disk):

  safe text   `from_plain` turns a player's plain text into markdown that prints as typed:
              nothing in it can open a heading, make a link, a table row, an embed or a
              comment, or hide text from the player site.
  the parts   `note_parts` finds where each part lives in the note (the sub-sections of
              `## Background`), `source_parts` says what sync would write there.
  ownership   `plan_story` writes a part only when the source changed since the last sync
              and the note's copy did not; when both changed it says CHECK once for that player
              version and writes nothing (later, the GM's text is never overwritten).
              Text a first sync (or one with no memory) finds there that differs from the source
              is the GM's too, until it matches the source. Matching compares what a reader
              sees (`reading`), so a hand copy of the player's text counts; a fingerprint of
              each side, remembered per part, tells what changed.

Where the parts live:

  ## Background
  ### Backstory         -> backstory
  ### Appearance        -> appearance (the prose) and facts (the `**Age:** …` line)
  ### Personality       -> traits, ideals, bonds, flaws (one `- **Traits:** …` bullet each)

A sub-section ends at the next heading of level 1 to 3. A part whose heading or bullet is
missing is None: the note has nowhere for it. A part whose body is only a `{placeholder}`
or `—` (per item for the facts line and each bullet) is empty. Stdlib only.
"""

import hashlib
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dnd_note import PLACEHOLDER  # noqa: E402
from vaultlib import fence_step, frontmatter_span, get_key, set_key, yaml_scalar  # noqa: E402

PARTS = ("backstory", "appearance", "facts", "traits", "ideals", "bonds", "flaws")
FACTS = ("Age", "Height", "Weight", "Eyes", "Hair", "Skin", "Faith")
BULLETS = ("traits", "ideals", "bonds", "flaws")
MEMORY = "story"        # the list id in sync's memory: entries are `part<TAB>source_fp<TAB>note_fp`
DASH = "—"

LOCUS = {
    "backstory": "Background / Backstory",
    "appearance": "Background / Appearance",
    "facts": "Background / Appearance / Facts",
    "traits": "Background / Personality / Traits",
    "ideals": "Background / Personality / Ideals",
    "bonds": "Background / Personality / Bonds",
    "flaws": "Background / Personality / Flaws",
}
SECTION = {"backstory": "Backstory", "appearance": "Appearance", "facts": "Appearance"}
SECTION.update({p: "Personality" for p in BULLETS})

TITLE = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
FACTS_LINE = re.compile(r"^\*\*(" + "|".join(FACTS) + r"):\*\*", re.I)
FACT_ITEM = re.compile(r"\*\*(" + "|".join(FACTS) + r"):\*\*\s*(.*?)\s*(?=\s·\s+\*\*(?:" + "|".join(FACTS)
                       + r"):\*\*|$)", re.I)
BULLET = re.compile(r"^\s*[-*+]\s+\*\*(Traits|Ideals|Bonds|Flaws):\*\*\s*(.*?)\s*$", re.I)
LIST_ITEM = re.compile(r"^\s*[-*]\s+(\S.*)$")
SYNTAX = re.compile(r"([\\`*_\[\]#|!~{}&%=$^])")
ANGLES = {"<": "&lt;", ">": "&gt;"}      # an entity, not a backslash: `\<` would still spell `<`
LEAD_MARK = re.compile(r"^([+\-])")
LEAD_NUMBER = re.compile(r"^(\d+)([.)])")
EOL = re.compile(r"\r\n|\n|\r")
UNESCAPE = re.compile(r"\\([!-/:-@\[-`{-~\n])|&(lt|gt|amp);")     # CommonMark's escapes, the 3 entities
ENTITIES = {"lt": "<", "gt": ">", "amp": "&"}
READ_ITEM = re.compile(r"^[-*+] ")
BLANK_VALUES = ("", '""', "''", "null", "~")


@dataclass
class Story:
    """What the player wrote at the source, unconverted."""
    backstory: str = ""
    appearance: str = ""
    facts: dict[str, str] = field(default_factory=dict)
    gender: str = ""
    traits: str = ""
    ideals: str = ""
    bonds: str = ""
    flaws: str = ""


@dataclass
class Span:
    start: int      # index into text.splitlines(keepends=True)
    end: int        # exclusive
    body: str       # the part without its heading or label


@dataclass
class StoryPlan:
    text: str
    rows: list[tuple[str, str, str]]            # (STATUS, locus, message)
    remember: dict[str, tuple[str, str]]        # part -> (source_fp, note_fp) after this run
    said: dict[str, str] = field(default_factory=dict)  # a part's CHECK locus -> source_raw's text for it


# --- safe text -----------------------------------------------------------------------------

def clean_text(text: str) -> str:
    """Line endings as `\\n`, tabs as spaces, every other control character dropped."""
    text = EOL.sub("\n", text).replace(" ", "\n").replace(" ", "\n").replace("\t", " ")
    return "".join(c for c in text if c == "\n" or unicodedata.category(c) != "Cc")


def escape(text: str) -> str:
    """Backslash-escape what markdown reads as syntax anywhere, and what it reads at a line's start."""
    text = SYNTAX.sub(r"\\\1", text)
    text = "".join(ANGLES.get(c, c) for c in text)
    text = LEAD_MARK.sub(r"\\\1", text)
    return LEAD_NUMBER.sub(r"\1\\\2", text)


def from_plain(text: str) -> str:
    """Plain source text as markdown that prints as typed.

    Blank lines split paragraphs; a line starting `-` or `*` and a space is a list item;
    a line break inside a paragraph stays a line break."""
    blocks: list[tuple[str, list[str]]] = []        # ("p" or "li", lines)
    for raw in clean_text(text).split("\n"):
        line = raw.strip()
        if not line:
            blocks.append(("", []))
            continue
        item = LIST_ITEM.match(line)
        kind, shown = ("li", item.group(1).strip()) if item else ("p", line)
        if not blocks or blocks[-1][0] != kind:
            blocks.append((kind, []))
        blocks[-1][1].append(escape(shown))
    out: list[str] = []
    for kind, lines in blocks:
        if kind == "li":
            out.append("\n".join("- " + line for line in lines))
        elif kind == "p":
            out.append("\\\n".join(lines))
    return "\n\n".join(out)


def one_line(text: str) -> str:
    """Player text on a single line (for a bullet, a fact or a frontmatter value), escaped."""
    return escape(" ".join(clean_text(text).split()))


def fingerprint(text: str) -> str:
    """16 hex characters of SHA-256 over the text with line endings normalised, trailing
    spaces dropped from each line and outer blank lines stripped."""
    lines = [line.rstrip(" ") for line in EOL.sub("\n", text).split("\n")]
    body = "\n".join(lines).strip("\n")
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def reading(text: str) -> str:
    """The words a reader sees: from_plain's escapes and the `&lt;` `&gt;` `&amp;` entities undone,
    a `\\`+newline hard break a newline, list markers as `- `, each whitespace run one space,
    blank lines dropped. A GM's hand copy of the player's text reads the same as sync's copy."""
    text = UNESCAPE.sub(lambda m: m.group(1) if m.group(1) is not None else ENTITIES[m.group(2)],
                        EOL.sub("\n", text))
    lines = (READ_ITEM.sub("- ", " ".join(raw.split())) for raw in text.split("\n"))
    return "\n".join(line for line in lines if line)


# --- where the parts live in the note ------------------------------------------------------

def _subsections(lines: list[str]) -> dict[str, tuple[int, int]]:
    """`backstory`/`appearance`/`personality` -> (index of its heading line, end exclusive),
    for the first of each under `## Background`. Frontmatter and fenced code are skipped."""
    heads: list[tuple[int, int, str]] = []
    in_fm = bool(lines) and lines[0].strip() == "---"
    fence: str | None = None
    for i, raw in enumerate(lines):
        s = raw.strip()
        if in_fm:
            if i > 0 and s == "---":
                in_fm = False
            continue
        fence, is_fence_line = fence_step(raw, fence)
        if is_fence_line or fence is not None:
            continue
        m = TITLE.match(s)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip().lower()))
    found: dict[str, tuple[int, int]] = {}
    inside = False
    for n, (i, level, name) in enumerate(heads):
        if level <= 2:
            inside = level == 2 and name == "background"
        elif inside and name in ("backstory", "appearance", "personality") and name not in found:
            found[name] = (i, heads[n + 1][0] if n + 1 < len(heads) else len(lines))
    return found


def subsections(text: str) -> set[str]:
    """Which of `backstory`, `appearance`, `personality` the note has under `## Background`."""
    return set(_subsections(text.splitlines(keepends=True)))


def _facts_line(lines: list[str], start: int, end: int) -> int:
    """Index of the facts line within lines[start:end], -1 when there is none."""
    fence: str | None = None
    for i in range(start, end):
        fence, is_fence_line = fence_step(lines[i], fence)
        if not is_fence_line and fence is None and FACTS_LINE.match(lines[i].strip()):
            return i
    return -1


def _body(lines: list[str], start: int, end: int) -> str:
    return "".join(lines[start:end]).strip()


def note_parts(text: str) -> dict[str, Span | None]:
    """Where each part lives in the note; None when the note has nowhere for it."""
    lines = text.splitlines(keepends=True)
    subs = _subsections(lines)
    parts: dict[str, Span | None] = {p: None for p in PARTS}
    if "backstory" in subs:
        head, end = subs["backstory"]
        parts["backstory"] = Span(head + 1, end, _body(lines, head + 1, end))
    if "appearance" in subs:
        head, end = subs["appearance"]
        facts = _facts_line(lines, head + 1, end)
        stop = end if facts < 0 else facts
        parts["appearance"] = Span(head + 1, stop, _body(lines, head + 1, stop))
        if facts >= 0:
            parts["facts"] = Span(facts, facts + 1, lines[facts].strip())
    if "personality" in subs:
        head, end = subs["personality"]
        fence: str | None = None
        for i in range(head + 1, end):
            fence, is_fence_line = fence_step(lines[i], fence)
            m = BULLET.match(lines[i].rstrip("\r\n")) if not is_fence_line and fence is None else None
            if m and parts[m.group(1).lower()] is None:
                parts[m.group(1).lower()] = Span(i, i + 1, m.group(2))
    return parts


def _facts_items(line: str) -> dict[str, str]:
    return {m.group(1).title(): m.group(2) for m in FACT_ITEM.finditer(line)}


def _is_empty_item(value: str) -> bool:
    v = value.strip()
    return v in ("", DASH) or bool(PLACEHOLDER.match(v))


def held(part: str, span: Span | None) -> str:
    """The text the note holds for a part; "" when it is empty (blank, a `{placeholder}` or `—`)."""
    if span is None:
        return ""
    body = span.body.strip()
    if part == "facts":
        return "" if all(_is_empty_item(v) for v in _facts_items(body).values()) else body
    return "" if _is_empty_item(body) else body


# --- what sync would write -----------------------------------------------------------------

def source_parts(story: Story) -> dict[str, str]:
    """Each part as the markdown sync would write it; "" for a part the source leaves empty."""
    shown = {k.title(): one_line(v) for k, v in story.facts.items()}
    facts = ""
    if any(shown.get(label) for label in FACTS):
        facts = " · ".join(f"**{label}:** {shown.get(label) or DASH}" for label in FACTS)
    out = {"backstory": from_plain(story.backstory), "appearance": from_plain(story.appearance), "facts": facts}
    for p in BULLETS:
        out[p] = one_line(getattr(story, p))
    return out


def source_raw(story: Story) -> dict[str, str]:
    """Each part as the player wrote it, unescaped, in the note's own form: the prose as written,
    the facts as the whole facts line and each bullet as its whole line, so a paste of it settles."""
    def flat(text: str) -> str:
        return " ".join(clean_text(text).split())

    given = {k.title(): flat(v) for k, v in story.facts.items()}
    facts = " · ".join(f"**{label}:** {given.get(label) or DASH}" for label in FACTS)
    out = {"backstory": story.backstory, "appearance": story.appearance, "facts": facts}
    out.update({p: f"- **{p.title()}:** {flat(getattr(story, p)) or DASH}" for p in BULLETS})
    return out


def _paragraphs(markdown: str) -> int:
    return len([b for b in re.split(r"\n\s*\n", markdown) if b.strip()])


def _wrote(part: str, markdown: str) -> str:
    """The WRITE row's message: a paragraph count for prose, nothing more for a one-line part."""
    if part in ("facts",) + BULLETS:
        return "from D&D Beyond"
    n = _paragraphs(markdown)
    return f"from D&D Beyond ({n} paragraph{'' if n == 1 else 's'})"


def _cleared(part: str) -> str:
    """What an emptied part is written as."""
    if part == "facts":
        return " · ".join(f"**{label}:** {DASH}" for label in FACTS)
    return DASH if part in BULLETS else ""


# --- ownership -----------------------------------------------------------------------------

def _eol(lines: list[str]) -> str:
    for raw in lines:
        m = EOL.search(raw)
        if m:
            return m.group(0)
    return "\n"


def _replacement(part: str, span: Span, new: str, lines: list[str], eol: str) -> list[str]:
    """The note's lines for a span once it holds `new`."""
    if part == "facts":
        return [new + eol]
    if part in BULLETS:
        return [f"- **{part.title()}:** {new}{eol}"]
    gap = [eol] if span.end < len(lines) else []      # a blank line before whatever follows
    if not new:
        return gap
    return [eol] + [line + eol for line in new.split("\n")] + gap


# Remembered as a part's "note as last synced" when sync found text there it never wrote. No
# fingerprint can equal it, so the part counts as edited by the GM until it matches the source.
GM_TEXT = "gm-text"


def plan_story(text: str, story: Story, last: dict[str, tuple[str, str]] | None) -> StoryPlan:
    """Bring the note's story parts up to date; see the module doc for who owns what.

    `last` is the memory from the last sync (None when there is none, as on a first sync or
    after the file was lost; either way the note's own text is never overwritten)."""
    lines = text.splitlines(keepends=True)
    eol = _eol(lines)
    parts = note_parts(text)
    subs = _subsections(lines)
    source = source_parts(story)
    rows: list[tuple[str, str, str]] = []
    edits: list[tuple[int, int, list[str]]] = []
    fresh: dict[str, str] = {}                      # part -> the source fingerprint to record
    keep: dict[str, tuple[str, str]] = {}           # part -> memory carried over unchanged
    memory = last or {}

    for part in PARTS:
        want, span, locus = source[part], parts[part], LOCUS[part]
        if span is None:
            if part in memory:
                keep[part] = memory[part]
            if want:
                if SECTION[part].lower() in subs:
                    label = {"facts": "facts line"}.get(part, f"**{part.title()}:** bullet")
                    gap = f"the note has no {label} under {SECTION[part]}"
                else:
                    gap = f"the note has no ### {SECTION[part]} under Background"
                rows.append(("CHECK", locus, f"{gap}; run the vault upgrade (migrate.py), nothing was written"))
            continue
        now, source_fp, note_fp = held(part, span), fingerprint(want), fingerprint(held(part, span))
        same = reading(now) == reading(want)        # the note says what the player wrote, escaped or not
        entry = memory.get(part)
        if entry is None:
            # First sync of this part: an empty place is ours to fill, text there is not.
            if want and not now:
                rows.append(("WRITE", locus, _wrote(part, want)))
                edits.append((span.start, span.end, _replacement(part, span, want, lines, eol)))
            elif want and not same:
                rows.append(("CHECK", locus, "the note already has text here; nothing was written. "
                                             "It stays the GM's until it matches the D&D Beyond text"))
            if now and not same:
                keep[part] = (source_fp, GM_TEXT)   # the GM's own text: no later player change overwrites it
            else:
                fresh[part] = source_fp
        elif same:
            fresh[part] = source_fp                 # the note already says what the source says: settled
        elif entry[0] == source_fp:
            keep[part] = entry                      # nothing new at the source; the note is the GM's
        elif entry[1] == note_fp:
            if want:
                rows.append(("WRITE", locus, _wrote(part, want)))
            else:
                rows.append(("WRITE", locus, "cleared; it is empty on D&D Beyond"))
            edits.append((span.start, span.end, _replacement(part, span, want or _cleared(part), lines, eol)))
            fresh[part] = source_fp
        else:
            told = ("the note keeps its own text here and the player changed theirs on D&D Beyond"
                    if entry[1] == GM_TEXT else
                    "the player changed this on D&D Beyond and it was also edited in the vault")
            rows.append(("CHECK", locus, f"{told}; compare them, nothing was written"))
            keep[part] = (source_fp, entry[1])      # this player version is seen; the note stays "as last synced"

    for start, end, new in sorted(edits, key=lambda e: e[0], reverse=True):
        lines[start:end] = new

    gender = story.gender
    if gender.strip():
        close, err = frontmatter_span(lines)
        if err is None:
            fm = lines[1:close]
            if get_key(fm, "gender") in BLANK_VALUES:
                set_key(fm, "gender", yaml_scalar(" ".join(clean_text(gender).split())), eol)
                lines[1:close] = fm
                rows.append(("WRITE", "Frontmatter / gender", "from D&D Beyond"))
        else:
            rows.append(("CHECK", "Frontmatter / gender", "the frontmatter could not be read; gender was not written"))

    raw = source_raw(story)
    said = {LOCUS[p]: raw[p] for p in PARTS if any(r[0] == "CHECK" and r[1] == LOCUS[p] for r in rows)}
    new_text = "".join(lines)
    after = note_parts(new_text)
    remember = dict(keep)
    for part, source_fp in fresh.items():
        remember[part] = (source_fp, fingerprint(held(part, after[part])))
    return StoryPlan(new_text, rows, remember, said)


# --- sync's memory -------------------------------------------------------------------------

def memory_entries(remember: dict[str, tuple[str, str]]) -> list[str]:
    """The memory list `MEMORY` as saved: `part<TAB>source_fp<TAB>note_fp`."""
    return [f"{p}\t{remember[p][0]}\t{remember[p][1]}" for p in PARTS if p in remember]


def memory_from(seen: dict[str, list[str]] | None) -> dict[str, tuple[str, str]] | None:
    """The memory as `plan_story` takes it; None when there is none (or it lacks this list)."""
    if seen is None or MEMORY not in seen:
        return None
    out: dict[str, tuple[str, str]] = {}
    for entry in seen[MEMORY]:
        bits = entry.split("\t")
        if len(bits) == 3 and bits[0] in PARTS:
            out[bits[0]] = (bits[1], bits[2])
    return out

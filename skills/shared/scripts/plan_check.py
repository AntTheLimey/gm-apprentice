#!/usr/bin/env python3
"""Session Plan conformance: the rules session-prep/SKILL.md and
shared/session-principles.md state for the file it writes, made
checkable instead of by-eye.

Read-only companion to vault_check.py for a single Session Plan
markdown file. Stdlib only.

Usage:
  plan_check.py PLAN.md [--headless] [--inventory] [--state] [--json]

Default output: finding rows as `LEVEL<TAB>locus<TAB>message`, then a
`# errors: N  warnings: N  info: N` summary line. `--inventory` prints
`SECTION<TAB>title<TAB>present|absent|placeholder<TAB>words` for each
template H2 in template order instead. `--state` prints the prep-state
comment's tokens as `key<TAB>value`, or `# no prep-state marker`.
`--json` emits `{"findings": [...], "inventory": [...], "state": {...}}`.
Exit 1 if any ERROR finding, else 0 — in every output mode.

Every message starts with its check id. Locus is `<file>:<line>` for a
finding tied to one line, or `<file>:§<Section>` for one tied to a whole
section (a template H2, or a scene's own `### ` title).

Checks, by id, level, and the rule they mechanise:
  type          ERROR    frontmatter `type` must be `session-plan`
                         (session-templates.md, Session Plan)
  frontmatter   WARNING  `session`/`chapter` present and a wikilink
                         (session-templates.md, Session Plan)
  sections      ERROR/   ERROR for a missing '## GM Notes', WARNING for
                WARNING  any other template H2
                         (session-templates.md, Session Plan)
  order         INFO     present template H2s stay in template order
                         (session-templates.md, Session Plan)
  placeholder   INFO     a template H2's body is still the template's own
                         (session-templates.md, Session Plan)
  preamble      WARNING  Previously On + Active Threads + NPC Quick
                         Reference + World State <= ~1000 words
                         (SKILL.md preamble discipline comment)
  recap         WARNING  Previously On <= 150 words
                         (SKILL.md preamble discipline comment)
  npc-table     INFO     NPC Quick Reference is a table, one line per NPC
                         (SKILL.md preamble discipline comment)
  scene-length  INFO     a scene over ~1200 words — sanity-check it
                         (SKILL.md preamble discipline comment)
  scene-labels  ERROR    every Planned scene carries Situation/Starts it/
                         Entities (inline, colon) and NPCs/Points to
                         land/If the players.../Complications (block);
                         Contingency scenes carry Trigger/Then; a legacy
                         Objective/Setup/Behaviours/Branching scene is
                         one row
                         (session-templates.md, Planned/Contingency Scenes)
  scene-type    WARNING  **Type:** is one of schema_rules.SCENE_TYPES
                         (session-templates.md, Planned Scenes)
  shape         WARNING  a bullet, label line, or plain paragraph over
                         SHAPE_MAX_WORDS, judged item by item, in every
                         session-running section except Session Intent,
                         Session Overview, and Previously On... (prose
                         by design — the GM's stated purpose, a
                         synopsis, and the recap, already bounded by
                         the `recap` word budget)
                         (session-templates.md, enumerated Plan skeleton)
  clarity       INFO     a vague referent ("the letter") names no
                         document or person — the plan is read cold
                         (#195)
  question-weight
                WARNING  an Open Questions item is craft or bookkeeping,
                         not a plot question (#197)
  duration      ERROR/   never estimate scene durations
                WARNING  (shared/session-principles.md, Absolute Rules)
  audit-trail   WARNING  the Plan is an instrument, not an audit trail
                         (shared/session-principles.md, Absolute Rules)
  pc-state      WARNING  Current Status is not transcribed into the Plan
                         (shared/pc-body-structure.md)
  read-aloud    INFO     read-aloud addresses the table, 2-4 sentences,
                         no hedges, no mechanics
                         (shared/session-principles.md; SKILL.md Phase 2)
  table         ERROR    no aliased-link/escaped-pipe table cells
                         (shared/session-principles.md, wiki-link rule;
                         vault_check.table_findings)
  guess         WARNING  "(apprentice guess" only appears in Open Questions
                         (SKILL.md, Hard Guard)
  hard-guard    ERROR    --headless only: no settled creative spine, every
                         Open Questions line carries the guess marker
                         (SKILL.md, Hard Guard)
  prep-state    INFO/    a resumable prep-state marker exists and parses
                WARNING  (SKILL.md, Resumable prep)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vaultlib as vl                                  # noqa: E402
import vault_check as vc                                # noqa: E402
from schema_rules import SCENE_TYPES                    # noqa: E402


@dataclass
class Finding:
    id: str
    level: str
    locus: str
    message: str

    @property
    def row(self) -> str:
        return f"{self.level}\t{self.locus}\t{self.message}"


# --------------------------------------------------------------------------
# Template shape
# --------------------------------------------------------------------------

# skills/session-prep/references/session-templates.md, Session Plan, in
# template order. Title match is casefold with a trailing "..."/"…"
# tolerated (see `_norm_title`).
TEMPLATE_SECTIONS: tuple[str, ...] = (
    "Session Intent",
    "Session Overview",
    "GM Notes",
    "Prior Prep Review",
    "Previously On...",
    "Active Threads",
    "NPC Quick Reference",
    "World State",
    "Planned Scenes",
    "Contingency Scenes",
    "Session End Objectives",
    "PC Roster & Arcs",
    "Touchpoint Plan",
    "Spotlight Forecast",
    "Open Questions",
    "Gaps & Actions",
    "Planned vs Played",
)

PREAMBLE_TITLES: tuple[str, ...] = (
    "Previously On...", "Active Threads", "NPC Quick Reference",
    "World State",
)
RECAP_TITLE = "Previously On..."
NPC_TABLE_TITLE = "NPC Quick Reference"
PLANNED_SCENES_TITLE = "Planned Scenes"
CONTINGENCY_SCENES_TITLE = "Contingency Scenes"
OPEN_QUESTIONS_TITLE = "Open Questions"

# "Session-running sections" = every H2 except these five (SKILL.md /
# session-principles.md). A section not in TEMPLATE_SECTIONS at all (a
# GM's own heading) still counts as session-running.
SESSION_RUNNING_EXCLUDE = {
    "gm notes", "prior prep review", "open questions", "gaps & actions",
    "planned vs played",
}

# `placeholder`: a template H2's body is placeholder when it is empty, or
# consists only of bracketed `[...]` lines / HTML comments, or contains one
# of the template's own descriptive sentences verbatim. `Planned vs Played`
# is exempt from *reporting* (it is legitimately blank until wrap-up) but
# still detected for `--inventory`.
PLACEHOLDER_PHRASES: tuple[str, ...] = (
    "Narrative recap from session-wrapup",
    "Carry-forward, stale threads",
    "In-game date, location, active threats",
    "Per-PC: arc stage",
    "Per-PC touchpoint assignments",
    "Per-PC estimated spotlight share",
    "Missing entities, stale files",
    "Left blank during prep",
    "Same structure",
)
PLACEHOLDER_EXEMPT_FROM_REPORTING = {"planned vs played"}

# The enumerated Plan skeleton (#196): inline labels are `**Label:**` on
# their own line; block labels are `**Label**` (optional trailing text
# before the closing `**`) followed by bullets, a checklist, or a table.
# `Type` is optional and lives outside SCENE_LABELS — checked only when
# present, by the existing scene-type/placeholder logic.
SCENE_LABELS_INLINE: tuple[str, ...] = ("Situation", "Starts it", "Entities")
SCENE_LABELS_BLOCK: tuple[str, ...] = (
    "NPCs", "Points to land", "If the players...", "Complications")
SCENE_LABELS: tuple[str, ...] = SCENE_LABELS_INLINE + SCENE_LABELS_BLOCK
CONTINGENCY_LABELS: tuple[str, ...] = ("Trigger", "Then")
# `Trigger` is inline (colon); `Then` is block (bullets, no colon).
_INLINE_LABELS: frozenset[str] = frozenset(SCENE_LABELS_INLINE) | {"Trigger"}

# A scene written in the pre-1.9.12 prose skeleton — detected only when
# none of SCENE_LABELS_INLINE is present, so a modern scene that happens
# to mention one of these words in passing is never misidentified.
LEGACY_SCENE_LABELS: frozenset[str] = frozenset(
    {"Objective", "Setup", "Behaviours", "Behaviors", "Branching"})

SECTION_ERROR_TITLES: frozenset[str] = frozenset({"GM Notes"})

# `shape`: a paragraph (bullet, label-line, or plain prose) longer than
# this many words is dense prose the enumerated skeleton is meant to
# prevent — see `check_shape`.
SHAPE_MAX_WORDS = 40

# `shape` is exempt in these sections — they are prose by design: the
# GM's stated purpose, a one-paragraph synopsis, and the narrative recap
# (already bounded by the `recap` word budget). Compared via
# `_norm_title`, same as `SESSION_RUNNING_EXCLUDE`.
SHAPE_EXEMPT_TITLES: tuple[str, ...] = (
    "Session Intent", "Session Overview", "Previously On...")

# `clarity`: a generic noun that names no document or person by the time
# the sentence ends — the plan is read cold days later, and "the letter"
# means nothing without a link or a name (#195).
VAGUE_REFERENTS: tuple[str, ...] = (
    "letter", "letters", "note", "notes", "paper", "papers", "card",
    "message", "package", "parcel", "ledger", "book", "document", "detail",
    "ladder", "debt", "deal", "regrets", "warning", "arrangement")
_VAGUE_REFERENT_RE = re.compile(
    rf"\bthe ({'|'.join(VAGUE_REFERENTS)})\b", re.IGNORECASE)

# `question-weight`: an Open Questions item that is craft or bookkeeping,
# not a plot question that needs a Keeper decision (#197).
COSMETIC_QUESTION_RE = re.compile(
    r"\b(font|typeface|filename|file name|layout|formatting|colou?r "
    r"scheme|rolled|die result|dice result|what (?:did|does) \w+ roll)\b",
    re.I)

DURATION_RANGE_RE = re.compile(
    r"\b\d+\s*[-–—]\s*\d+\s*(?:min|mins|minutes|hours?|hrs?)\b",
    re.IGNORECASE)
DURATION_TILDE_RE = re.compile(
    r"~\s*\d+\s*(?:min|mins|minutes|hours?|hrs?)\b", re.IGNORECASE)
DURATION_BARE_RE = re.compile(r"\b\d+\s*(?:minutes|mins)\b", re.IGNORECASE)

AUDIT_TRAIL_PHRASES: tuple[str, ...] = (
    "formally dropped", "this plan revises", "this plan supersedes",
    "noted here only", "deliberate silence", "that is now wrong",
    "as previously noted", "changelog",
)

PC_STATE_RE = re.compile(
    r"^\*\*(Location|Condition|Carrying|Open threads|"
    r"Knows \(exclusive\)):\*\*")

HEDGE_RE = re.compile(
    r"\b(perhaps|seems? to|might|possibly|you feel|you notice|"
    r"you realise|you realize)\b", re.IGNORECASE)
MECHANICAL_RE = re.compile(
    r"\broll\b|\bcheck\b|\bDC\s?\d|\bSAN\b|\bd\d+\b|\bmodifier\b|"
    r"\bskill\b|Spot Hidden|Perception", re.IGNORECASE)

GUESS_RE = re.compile(r"\(apprentice guess", re.IGNORECASE)
GUARD_MARKER_RE = re.compile(
    r"\(apprentice guess\s*[-–—]\s*confirm\)", re.IGNORECASE)
GUARD_SECTIONS: tuple[str, ...] = (
    "Session Intent", PLANNED_SCENES_TITLE, "Spotlight Forecast",
)
# A list item opener: `- `, `* `, or `1. `. A hard-wrapped continuation
# line carries none of these and belongs to the item above it.
LIST_MARKER_RE = re.compile(r"^(?:[-*]|\d+\.)\s+")

PREP_STATE_RE = re.compile(r"<!--\s*prep-state:\s*(.*?)-->", re.DOTALL)
# key=value, where a value may be a `[...]`/`(...)` group carrying
# internal spaces (SKILL.md's own worked example:
# `open=[Freddy beat?]`) or a plain whitespace-delimited token.
PREP_STATE_TOKEN_RE = re.compile(
    r"(\w[\w-]*)=(\[[^\]]*\]|\([^)]*\)|\S+)")


# --------------------------------------------------------------------------
# Small helpers shared by several checks
# --------------------------------------------------------------------------


def _norm_title(title: str) -> str:
    """Casefold, trailing '...'/'…' tolerated."""
    return re.sub(r"(\.\.\.|…)\s*$", "", title.strip()).strip().casefold()


def _bracket_only_line(line: str) -> bool:
    s = re.sub(r"^[-*]\s+", "", line.strip())
    return bool(re.fullmatch(r"\[.*\]\.?", s))


def _is_placeholder_body(body: str) -> bool:
    stripped = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL).strip()
    if not stripped:
        return True
    lines = [ln for ln in stripped.splitlines() if ln.strip()]
    if lines and all(_bracket_only_line(ln) for ln in lines):
        return True
    low = stripped.casefold()
    return any(phrase.casefold() in low for phrase in PLACEHOLDER_PHRASES)


def _by_norm_title(text: str) -> dict[str, tuple[int, str, str]]:
    """norm(title) -> (lineno, raw title, body), first occurrence wins."""
    out: dict[str, tuple[int, str, str]] = {}
    for lineno, _level, title, body in vl.sections(text):
        norm = _norm_title(title)
        if norm not in out:
            out[norm] = (lineno, title, body)
    return out


def _walk_body(states: list[vl.LineState]
              ) -> Iterator[tuple[int, str, str | None, bool, bool]]:
    """(lineno, line, current-H2-title, in_code, is_heading) for every body
    line — the current H2 is the nearest preceding level-2 heading outside
    a code fence, None before the first one. Takes `scan_body`'s own
    output (computed once in `run_checks` and shared by every
    line-oriented check) rather than re-scanning the file per check."""
    current: str | None = None
    for state in states:
        is_heading = state.heading is not None
        if is_heading and state.heading is not None and state.heading[0] == 2:
            current = state.heading[1]
        yield state.lineno, state.line, current, state.in_code, is_heading


def _is_session_running(section_title: str | None) -> bool:
    if section_title is None:
        return True
    return _norm_title(section_title) not in SESSION_RUNNING_EXCLUDE


def find_prep_state(text: str) -> tuple[int, str] | None:
    """(lineno of the comment, raw token text inside it), or None."""
    m = PREP_STATE_RE.search(text)
    if not m:
        return None
    lineno = text[:m.start()].count("\n") + 1
    return lineno, m.group(1).strip()


def _tokenize_prep_state(raw: str) -> tuple[dict[str, str], list[str]]:
    """(key -> value pairs, malformed leftover fragments).

    A value is either a `[...]`/`(...)` group — which may carry internal
    spaces, as in SKILL.md's own worked example `open=[Freddy beat?]` —
    or a plain whitespace-delimited token. Anything sitting between or
    after the recognised `key=value` tokens that isn't pure whitespace
    is malformed and reported as such.
    """
    tokens: dict[str, str] = {}
    bad: list[str] = []
    pos = 0
    for m in PREP_STATE_TOKEN_RE.finditer(raw):
        bad.extend(raw[pos:m.start()].split())
        tokens[m.group(1)] = m.group(2)
        pos = m.end()
    bad.extend(raw[pos:].split())
    return tokens, bad


def parse_prep_state_tokens(raw: str) -> dict[str, str]:
    """Well-formed `key=value` tokens only — malformed ones are the
    `prep-state` WARNING's job, not this parser's."""
    tokens, _bad = _tokenize_prep_state(raw)
    return tokens


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------


def check_type(rel: str, fm: dict[str, Any]) -> list[Finding]:
    value = fm.get("type")
    if value != "session-plan":
        shown = value if isinstance(value, str) and value else "(missing)"
        return [Finding("type", "ERROR", f"{rel}:1",
                        f"type: frontmatter type is '{shown}', not "
                        f"'session-plan'")]
    return []


def check_frontmatter_links(rel: str, fm: dict[str, Any]) -> list[Finding]:
    findings = []
    for field in ("session", "chapter"):
        if not vl.wikilink_target(fm.get(field)):
            findings.append(Finding(
                "frontmatter", "WARNING", f"{rel}:1",
                f"frontmatter: '{field}' is missing or not a wikilink"))
    return findings


def check_sections(rel: str, by_norm: dict[str, tuple[int, str, str]]
                   ) -> list[Finding]:
    findings = []
    for title in TEMPLATE_SECTIONS:
        if _norm_title(title) in by_norm:
            continue
        if title in SECTION_ERROR_TITLES:
            findings.append(Finding(
                "sections", "ERROR", f"{rel}:§{title}",
                f"sections: missing '## {title}' — required; every "
                "Keeper-facing section lives under it"))
        else:
            findings.append(Finding(
                "sections", "WARNING", f"{rel}:§{title}",
                f"sections: missing '## {title}'"))
    return findings


def check_order(rel: str, by_norm: dict[str, tuple[int, str, str]]
               ) -> list[Finding]:
    template_norms = [_norm_title(t) for t in TEMPLATE_SECTIONS]
    template_set = set(template_norms)
    present_in_doc = sorted(
        ((lineno, norm) for norm, (lineno, _t, _b) in by_norm.items()
         if norm in template_set),
        key=lambda pair: pair[0])
    actual = [norm for _lineno, norm in present_in_doc]
    expected = [n for n in template_norms if n in by_norm]
    if actual == expected:
        return []
    # actual and expected are always the same permutation of the same
    # set (every present template section, once each), so a mismatch
    # guarantees a differing pair at some zipped position.
    bad_norm = next(a for a, e in zip(actual, expected) if a != e)
    _lineno, title, _body = by_norm[bad_norm]
    return [Finding(
        "order", "INFO", f"{rel}:§{title}",
        f"order: '## {title}' appears out of template order")]


def check_placeholder(rel: str, by_norm: dict[str, tuple[int, str, str]]
                      ) -> list[Finding]:
    findings = []
    for title in TEMPLATE_SECTIONS:
        norm = _norm_title(title)
        if norm in PLACEHOLDER_EXEMPT_FROM_REPORTING or norm not in by_norm:
            continue
        _lineno, raw_title, body = by_norm[norm]
        if _is_placeholder_body(body):
            findings.append(Finding(
                "placeholder", "INFO", f"{rel}:§{raw_title}",
                f"placeholder: '## {raw_title}' still holds template "
                f"placeholder content"))
    return findings


def check_preamble(rel: str, by_norm: dict[str, tuple[int, str, str]]
                   ) -> list[Finding]:
    total = 0
    for title in PREAMBLE_TITLES:
        norm = _norm_title(title)
        if norm in by_norm:
            total += vl.word_count(by_norm[norm][2])
    if total > 1000:
        return [Finding(
            "preamble", "WARNING", f"{rel}:§{PREAMBLE_TITLES[0]}",
            f"preamble: Previously On... + Active Threads + NPC Quick "
            f"Reference + World State = {total} words (budget ~1000)")]
    return []


def check_recap(rel: str, by_norm: dict[str, tuple[int, str, str]]
               ) -> list[Finding]:
    norm = _norm_title(RECAP_TITLE)
    if norm not in by_norm:
        return []
    wc = vl.word_count(by_norm[norm][2])
    if wc > 150:
        return [Finding(
            "recap", "WARNING", f"{rel}:§{RECAP_TITLE}",
            f"recap: Previously On... is {wc} words (budget <=150)")]
    return []


def check_npc_table(rel: str, by_norm: dict[str, tuple[int, str, str]]
                    ) -> list[Finding]:
    norm = _norm_title(NPC_TABLE_TITLE)
    if norm not in by_norm:
        return []
    _lineno, _title, body = by_norm[norm]
    non_table = [ln for ln in body.splitlines()
                if ln.strip() and not ln.strip().startswith("|")]
    if len(non_table) > 2:
        return [Finding(
            "npc-table", "INFO", f"{rel}:§{NPC_TABLE_TITLE}",
            f"npc-table: NPC Quick Reference has {len(non_table)} "
            f"non-table lines (one line per NPC)")]
    return []


def _is_inline_label(label: str) -> bool:
    return label in _INLINE_LABELS


def _label_present(body: str, label: str) -> bool:
    if label == "If the players...":
        return bool(re.search(
            r"^\*\*If the players(?:\.{1,3}|…)\*\*", body, re.MULTILINE))
    if _is_inline_label(label):
        return bool(re.search(
            rf"^\*\*{re.escape(label)}:\*\*", body, re.MULTILINE))
    # Block label: the bare label, or the label plus an optional
    # parenthetical (`**Complications (drop when the scene sags)**`).
    # Anything else after the label — a colon, a period, free text with
    # no parens — is a near miss, not a match, so `_label_near_miss`
    # stays reachable instead of this pattern swallowing it first.
    return bool(re.search(
        rf"^\*\*{re.escape(label)}(?:\s*\([^*\n]*\))?\*\*", body,
        re.MULTILINE))


def _label_near_miss(body: str, label: str) -> str | None:
    esc = re.escape(label)
    patterns = [rf"^\*\*{esc}\.\*\*", rf"^\*\*{esc};\*\*"]
    if _is_inline_label(label):
        patterns.append(rf"^\*\*{esc}\*\*")
    else:
        patterns.append(rf"^\*\*{esc}:\*\*")
    patterns.append(rf"^{esc}:")
    for pattern in patterns:
        m = re.search(pattern, body, re.MULTILINE)
        if m:
            return m.group(0)
    return None


_LEGACY_LABEL_RE = re.compile(r"^\*\*(\w+):\*\*")

# `Entities` is common furniture to both the pre-1.9.12 prose skeleton and
# the enumerated one, so its presence alone must not disqualify legacy
# detection — only the two labels unique to the new skeleton's opening do.
_MODERN_GATE_LABELS: tuple[str, ...] = ("Situation", "Starts it")


def _legacy_scene(body: str) -> list[str]:
    if any(_label_present(body, label) for label in _MODERN_GATE_LABELS):
        return []
    found: list[str] = []
    for line in body.splitlines():
        m = _LEGACY_LABEL_RE.match(line.strip())
        if m and m.group(1) in LEGACY_SCENE_LABELS and m.group(1) not in found:
            found.append(m.group(1))
    return found


def _scene_findings(rel: str, body: str, scene_title: str,
                    labels: tuple[str, ...]) -> list[Finding]:
    findings: list[Finding] = []
    locus = f"{rel}:§{scene_title}"
    legacy_found = _legacy_scene(body)
    if legacy_found:
        rewrite_as = " / ".join(labels)
        findings.append(Finding(
            "scene-labels", "ERROR", locus,
            f"scene-labels: '{scene_title}' uses the pre-1.9.12 prose "
            f"skeleton ({', '.join(legacy_found)}) — rewrite as "
            f"{rewrite_as}"))
    else:
        for label in labels:
            if _label_present(body, label):
                continue
            block = not _is_inline_label(label)
            shown = f"**{label}**" if block else f"**{label}:**"
            near = _label_near_miss(body, label)
            if near is not None:
                findings.append(Finding(
                    "scene-labels", "ERROR", locus,
                    f"scene-labels: '{scene_title}' has {near!r} — write "
                    f"'{shown}'"))
            else:
                findings.append(Finding(
                    "scene-labels", "ERROR", locus,
                    f"scene-labels: '{scene_title}' is missing {shown}"))
    type_match = re.search(r"\*\*Type:\*\*\s*([^\n]+)", body)
    if type_match:
        raw = type_match.group(1).strip()
        if "|" in raw:
            findings.append(Finding(
                "placeholder", "INFO", locus,
                f"placeholder: '{scene_title}' Type is still the "
                f"template's placeholder list"))
        else:
            value = re.split(r"[.\n]", raw)[0].strip().casefold()
            if value not in SCENE_TYPES:
                findings.append(Finding(
                    "scene-type", "WARNING", locus,
                    f"scene-type: '{scene_title}' Type '{raw}' not in "
                    f"{{{', '.join(sorted(SCENE_TYPES))}}}"))
    wc = vl.word_count(body)
    if wc > 1200:
        findings.append(Finding(
            "scene-length", "INFO", locus,
            f"scene-length: '{scene_title}' is {wc} words — confirm the "
            f"length is load-bearing"))
    return findings


def check_scenes(rel: str, by_norm: dict[str, tuple[int, str, str]]
                 ) -> list[Finding]:
    findings: list[Finding] = []
    planned = by_norm.get(_norm_title(PLANNED_SCENES_TITLE))
    if planned is not None:
        for scene_title, scene_body in vl.h3_blocks(planned[2]):
            findings.extend(
                _scene_findings(rel, scene_body, scene_title, SCENE_LABELS))
    contingency = by_norm.get(_norm_title(CONTINGENCY_SCENES_TITLE))
    if contingency is not None:
        for scene_title, scene_body in vl.h3_blocks(contingency[2]):
            findings.extend(_scene_findings(
                rel, scene_body, scene_title, CONTINGENCY_LABELS))
    return findings


_SHAPE_EXEMPT_NORM: frozenset[str] = frozenset(
    _norm_title(t) for t in SHAPE_EXEMPT_TITLES)


def _is_shape_exempt(section_title: str | None) -> bool:
    return (section_title is not None
            and _norm_title(section_title) in _SHAPE_EXEMPT_NORM)


def check_shape(rel: str, states: list[vl.LineState]) -> list[Finding]:
    """WARNING, in every session-running section except
    `SHAPE_EXEMPT_TITLES`: a bullet or `**Label` item, or a plain-prose
    paragraph, over `SHAPE_MAX_WORDS` words.

    Bullets and label lines are judged item by item, not as a merged
    run: an item is its own marker/label line plus any hard-wrapped
    continuation lines, ending at the next line that opens a new bullet
    marker, a new `**Label` line, a blank line, a table row, a quote,
    or a heading. So a list of short bullets never sums into one long
    "paragraph," and the skeleton's opening label run (`**Type:**` /
    `**Situation:**` / `**Starts it:**` / `**Entities:**` / ...) is
    judged one label at a time. Plain paragraphs still group by run —
    consecutive non-blank lines carrying no marker at all.
    """
    findings: list[Finding] = []
    current: list[str] = []
    current_kind: str | None = None
    current_start = 0

    def flush() -> None:
        nonlocal current, current_kind
        if current:
            text = "\n".join(current)
            wc = vl.word_count(text)
            if current_kind == "label" and wc > SHAPE_MAX_WORDS:
                findings.append(Finding(
                    "shape", "WARNING", f"{rel}:{current_start}",
                    f"shape: {wc}-word label line — one line for "
                    "Situation/Starts it, bullets under the block "
                    "labels"))
            elif current_kind == "bullet" and wc > SHAPE_MAX_WORDS:
                findings.append(Finding(
                    "shape", "WARNING", f"{rel}:{current_start}",
                    f"shape: {wc}-word bullet — two lines maximum"))
            elif current_kind == "plain" and wc > SHAPE_MAX_WORDS:
                findings.append(Finding(
                    "shape", "WARNING", f"{rel}:{current_start}",
                    f"shape: {wc}-word paragraph outside a blockquote — "
                    "bullets, a Do | Then table, or a read-aloud quote"))
        current = []
        current_kind = None

    for lineno, line, section, in_code, is_heading in _walk_body(states):
        if (in_code or is_heading or not _is_session_running(section)
                or _is_shape_exempt(section)):
            flush()
            continue
        stripped = line.strip()
        if (not stripped or stripped.startswith("|")
                or stripped.startswith(">")):
            flush()
            continue
        is_bullet_marker = bool(LIST_MARKER_RE.match(stripped))
        is_label_marker = stripped.startswith("**")
        if is_bullet_marker or is_label_marker:
            flush()
            current_start = lineno
            current_kind = "bullet" if is_bullet_marker else "label"
            current.append(line)
        elif current_kind in ("bullet", "label"):
            # A hard-wrapped continuation line of the current item —
            # stays part of it, whatever this line's own shape.
            current.append(line)
        else:
            # No marker at all: plain-prose run grouping.
            if not current:
                current_start = lineno
                current_kind = "plain"
            current.append(line)
    flush()
    return findings


def check_clarity(rel: str, states: list[vl.LineState]) -> list[Finding]:
    """INFO, in every session-running section outside code, blockquotes,
    and table rows: a sentence containing a vague referent
    (`\\bthe (VAGUE_REFERENTS)\\b`, casefolded) with no `[[link]]` and no
    capitalised token after its own first word — meaning the sentence
    never names the document or person "the letter" etc. refers to.

    Two caveats, both a consequence of the naive `[.!?]` sentence split
    and both accepted by design since this check is INFO, a nudge:
    an abbreviation ("Mr. Smith") fragments into two "sentences" at its
    period; and a sentence that simply *opens* with a proper noun (its
    own first token, excluded from the "capitalised token" scan) does
    not count as having named anyone — the scan only credits a name
    appearing after the sentence is already under way.

    Locus is the line the sentence's own first token sits on, not the
    run's first line — a run spanning several lines (a hard-wrapped
    paragraph, or several bullets with no marker of their own) can
    contain sentences that start well after its first line.
    """
    findings: list[Finding] = []
    current: list[tuple[int, str]] = []

    def flush() -> None:
        nonlocal current
        if current:
            parts: list[str] = []
            offsets: list[tuple[int, int]] = []
            pos = 0
            for lineno, text in current:
                offsets.append((pos, lineno))
                parts.append(text)
                pos += len(text) + 1
            joined = " ".join(parts)

            def lineno_at(offset: int) -> int:
                result = current[0][0]
                for start, ln in offsets:
                    if start > offset:
                        break
                    result = ln
                return result

            last_end = 0
            boundaries = [m.start() for m in re.finditer(r"[.!?]", joined)]
            boundaries.append(len(joined))
            for end in boundaries:
                fragment = joined[last_end:end]
                lead_ws = len(fragment) - len(fragment.lstrip())
                first_token_offset = last_end + lead_ws
                last_end = end + 1
                sentence = fragment.strip()
                if not sentence or "[[" in sentence:
                    continue
                m = _VAGUE_REFERENT_RE.search(sentence)
                if not m:
                    continue
                tokens = sentence.split()
                if any(t[:1].isupper() for t in tokens[1:]):
                    continue
                findings.append(Finding(
                    "clarity", "INFO",
                    f"{rel}:{lineno_at(first_token_offset)}",
                    f'clarity: "the {m.group(1).casefold()}" — name the '
                    "document or person in this sentence; the plan is "
                    "read cold (#195)"))
        current = []

    for lineno, line, section, in_code, is_heading in _walk_body(states):
        stripped = line.strip()
        skip = (in_code or is_heading or not _is_session_running(section)
                or stripped.startswith(">") or stripped.startswith("|"))
        if skip or not stripped:
            flush()
            continue
        current.append((lineno, LIST_MARKER_RE.sub("", stripped, count=1)))
    flush()
    return findings


def check_question_weight(rel: str, states: list[vl.LineState]
                          ) -> list[Finding]:
    findings: list[Finding] = []
    for start, joined in _open_questions_items(states):
        m = COSMETIC_QUESTION_RE.search(joined)
        if m:
            findings.append(Finding(
                "question-weight", "WARNING", f"{rel}:{start}",
                f"question-weight: {m.group(0)!r} is craft or "
                "bookkeeping, not a plot question — decide it or "
                "default it and note the default (#197)"))
    return findings


def check_duration(rel: str, states: list[vl.LineState]) -> list[Finding]:
    findings = []
    for lineno, line, section, in_code, is_heading in _walk_body(states):
        if in_code or is_heading or not _is_session_running(section):
            continue
        m = DURATION_RANGE_RE.search(line) or DURATION_TILDE_RE.search(line)
        level = "ERROR"
        if m is None:
            m = DURATION_BARE_RE.search(line)
            level = "WARNING"
        if m:
            findings.append(Finding(
                "duration", level, f"{rel}:{lineno}",
                f"duration: scene-duration estimate '{m.group(0).strip()}' "
                f"— never estimate durations"))
    return findings


def check_audit_trail(rel: str, states: list[vl.LineState]) -> list[Finding]:
    findings = []
    for lineno, line, section, in_code, is_heading in _walk_body(states):
        if in_code or is_heading or not _is_session_running(section):
            continue
        low = line.casefold()
        for phrase in AUDIT_TRAIL_PHRASES:
            if phrase in low:
                findings.append(Finding(
                    "audit-trail", "WARNING", f"{rel}:{lineno}",
                    f"audit-trail: '{phrase}' reads like an edit-history "
                    f"note, not session content — fix the other file "
                    f"instead"))
                break
    return findings


_PC_STATE_EXEMPT_SECTIONS = {
    _norm_title(PLANNED_SCENES_TITLE), _norm_title(CONTINGENCY_SCENES_TITLE),
}


def check_pc_state(rel: str, states: list[vl.LineState]) -> list[Finding]:
    """A `**Location:**`/`**Condition:**`/etc. line reads as a Current
    Status transcription almost everywhere in a plan — except inside
    `## Planned Scenes` / `## Contingency Scenes`, where a scene's own
    `**Location:**` field (naming where the scene happens, not a PC's
    status) is legitimate and must not be silently edited away (#M14)."""
    findings = []
    for lineno, line, section, in_code, is_heading in _walk_body(states):
        if in_code or is_heading:
            continue
        if section is not None and _norm_title(section) in _PC_STATE_EXEMPT_SECTIONS:
            continue
        m = PC_STATE_RE.match(line.strip())
        if m:
            findings.append(Finding(
                "pc-state", "WARNING", f"{rel}:{lineno}",
                f"pc-state: '**{m.group(1)}:**' transcribes Current "
                f"Status — reference the sheet instead"))
    return findings


def _quote_sentences(quote_text: str) -> list[str]:
    parts = re.split(r"[.!?]+(?:\s+|$)", quote_text.strip())
    return [p for p in parts if p.strip()]


def check_read_aloud(rel: str, states: list[vl.LineState]) -> list[Finding]:
    findings = []
    quote_lines: list[tuple[int, str]] = []

    def flush() -> None:
        if not quote_lines:
            return
        start = quote_lines[0][0]
        quote_text = " ".join(ln for _n, ln in quote_lines)
        sentences = _quote_sentences(quote_text)
        problems = []
        if len(sentences) < 2 or len(sentences) > 4:
            problems.append(f"{len(sentences)} sentence"
                            f"{'s' if len(sentences) != 1 else ''} "
                            f"(want 2-4)")
        hedges = sorted({m.group(0) for m in HEDGE_RE.finditer(quote_text)})
        for h in hedges:
            problems.append(f"hedge '{h}'")
        mechs = sorted({m.group(0) for m in MECHANICAL_RE.finditer(
            quote_text)})
        for mc in mechs:
            problems.append(f"mechanical term '{mc}'")
        if problems:
            findings.append(Finding(
                "read-aloud", "INFO", f"{rel}:{start}",
                "read-aloud: " + "; ".join(problems)))
        quote_lines.clear()

    for lineno, line, _section, in_code, _is_heading in _walk_body(states):
        if in_code:
            flush()
            continue
        stripped = line.lstrip()
        if stripped.startswith(">"):
            quote_lines.append((lineno, stripped.lstrip(">").strip()))
        else:
            flush()
    flush()
    return findings


def check_table(rel: str, text: str) -> list[Finding]:
    findings = []
    for row in vc.table_findings(rel, text):
        level, locus, message = row.split("\t", 2)
        findings.append(Finding("table", level, locus, f"table: {message}"))
    return findings


def check_guess(rel: str, states: list[vl.LineState]) -> list[Finding]:
    findings = []
    open_q_norm = _norm_title(OPEN_QUESTIONS_TITLE)
    for lineno, line, section, in_code, _is_heading in _walk_body(states):
        if in_code or not GUESS_RE.search(line):
            continue
        if section is not None and _norm_title(section) == open_q_norm:
            continue
        findings.append(Finding(
            "guess", "WARNING", f"{rel}:{lineno}",
            "guess: '(apprentice guess' marker appears outside "
            "## Open Questions"))
    return findings


def _open_questions_items(states: list[vl.LineState]
                          ) -> list[tuple[int, str]]:
    """(first lineno, joined text) per logical list item under
    `## Open Questions`, outside code fences.

    A list item is its `- `/`* `/`1. ` opener line plus every following
    line up to the next list marker, heading, or blank line — so a
    hard-wrapped bullet is one item, not one item per physical line. A
    content line with no list marker at all (plain prose under the
    heading) is still its own one-line item.
    """
    open_q_norm = _norm_title(OPEN_QUESTIONS_TITLE)
    items: list[tuple[int, list[str]]] = []
    current: list[str] | None = None
    current_start = 0

    def flush() -> None:
        nonlocal current
        if current:
            items.append((current_start, current))
        current = None

    for lineno, line, section, in_code, is_heading in _walk_body(states):
        in_open_questions = (not in_code and not is_heading
                             and section is not None
                             and _norm_title(section) == open_q_norm)
        if not in_open_questions:
            flush()
            continue
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if current is None or LIST_MARKER_RE.match(stripped):
            flush()
            current = [stripped]
            current_start = lineno
        else:
            current.append(stripped)
    flush()
    return [(start, " ".join(lines)) for start, lines in items]


def check_hard_guard(rel: str, states: list[vl.LineState],
                     by_norm: dict[str, tuple[int, str, str]]
                     ) -> list[Finding]:
    findings: list[Finding] = []
    for title in GUARD_SECTIONS:
        entry = by_norm.get(_norm_title(title))
        if entry is None:
            continue
        _lineno, raw_title, body = entry
        if not _is_placeholder_body(body):
            findings.append(Finding(
                "hard-guard", "ERROR", f"{rel}:§{raw_title}",
                f"hard-guard: '## {raw_title}' has non-placeholder "
                f"content while running headless — GM input required"))
    for start, joined in _open_questions_items(states):
        if GUARD_MARKER_RE.search(joined):
            continue
        findings.append(Finding(
            "hard-guard", "ERROR", f"{rel}:{start}",
            f"hard-guard: Open Questions item lacks the "
            f"'(apprentice guess — confirm)' marker: {joined!r}"))
    return findings


def check_prep_state(rel: str, text: str) -> list[Finding]:
    found = find_prep_state(text)
    if found is None:
        return [Finding(
            "prep-state", "INFO", f"{rel}:1",
            "prep-state: no <!-- prep-state: ... --> marker found")]
    lineno, raw = found
    _tokens, bad = _tokenize_prep_state(raw)
    if bad:
        return [Finding(
            "prep-state", "WARNING", f"{rel}:{lineno}",
            f"prep-state: malformed token(s) {', '.join(bad)} — expected "
            f"key=value")]
    return []


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------


def run_checks(rel: str, text: str, fm: dict[str, Any], headless: bool
              ) -> list[Finding]:
    by_norm = _by_norm_title(text)
    states, _problems = vl.scan_body(text)
    findings: list[Finding] = []
    findings.extend(check_type(rel, fm))
    findings.extend(check_frontmatter_links(rel, fm))
    findings.extend(check_sections(rel, by_norm))
    findings.extend(check_order(rel, by_norm))
    findings.extend(check_placeholder(rel, by_norm))
    findings.extend(check_preamble(rel, by_norm))
    findings.extend(check_recap(rel, by_norm))
    findings.extend(check_npc_table(rel, by_norm))
    findings.extend(check_scenes(rel, by_norm))
    findings.extend(check_shape(rel, states))
    findings.extend(check_clarity(rel, states))
    findings.extend(check_question_weight(rel, states))
    findings.extend(check_duration(rel, states))
    findings.extend(check_audit_trail(rel, states))
    findings.extend(check_pc_state(rel, states))
    findings.extend(check_read_aloud(rel, states))
    findings.extend(check_table(rel, text))
    findings.extend(check_guess(rel, states))
    findings.extend(check_prep_state(rel, text))
    if headless:
        findings.extend(check_hard_guard(rel, states, by_norm))
    return findings


def build_inventory(text: str) -> list[tuple[str, str, int]]:
    by_norm = _by_norm_title(text)
    rows = []
    for title in TEMPLATE_SECTIONS:
        norm = _norm_title(title)
        entry = by_norm.get(norm)
        if entry is None:
            rows.append((title, "absent", 0))
            continue
        _lineno, _raw_title, body = entry
        status = "placeholder" if _is_placeholder_body(body) else "present"
        rows.append((title, status, vl.word_count(body)))
    return rows


def build_state(text: str) -> dict[str, str]:
    found = find_prep_state(text)
    if found is None:
        return {}
    return parse_prep_state_tokens(found[1])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("plan", type=Path)
    ap.add_argument("--headless", action="store_true")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--inventory", action="store_true")
    mode.add_argument("--state", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        text = args.plan.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        print(f"error: cannot read {args.plan}: {e}", file=sys.stderr)
        return 2

    rel = str(args.plan)
    fm = vl.extract_frontmatter(text) or {}
    findings = run_checks(rel, text, fm, args.headless)
    has_error = any(f.level == "ERROR" for f in findings)

    if args.json:
        payload = {
            "findings": [
                {"id": f.id, "level": f.level, "locus": f.locus,
                 "message": f.message}
                for f in findings],
            "inventory": [
                {"title": title, "status": status, "words": words}
                for title, status, words in build_inventory(text)],
            "state": build_state(text),
        }
        print(json.dumps(payload, indent=2))
        return 1 if has_error else 0

    if args.inventory:
        for title, status, words in build_inventory(text):
            print(f"SECTION\t{title}\t{status}\t{words}")
        return 1 if has_error else 0

    if args.state:
        state = build_state(text)
        if not state:
            print("# no prep-state marker")
        else:
            for key, value in state.items():
                print(f"{key}\t{value}")
        return 1 if has_error else 0

    for f in findings:
        print(f.row)
    n_error = sum(1 for f in findings if f.level == "ERROR")
    n_warning = sum(1 for f in findings if f.level == "WARNING")
    n_info = sum(1 for f in findings if f.level == "INFO")
    print(f"# errors: {n_error}  warnings: {n_warning}  info: {n_info}")
    return 1 if has_error else 0


if __name__ == "__main__":
    sys.exit(main())

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
  sections      WARNING  every template H2 present
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
  scene-labels  WARNING  a scene names all seven Sly Flourish labels
                         (Contingency Scenes also require **Trigger:**)
                         (session-templates.md, Planned/Contingency Scenes)
  scene-type    WARNING  **Type:** is one of schema_rules.SCENE_TYPES
                         (session-templates.md, Planned Scenes)
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

SCENE_LABELS: tuple[str, ...] = (
    "Type", "Objective", "Entities", "Setup", "Behaviours", "Branching",
    "Complications",
)
CONTINGENCY_EXTRA_LABEL = "Trigger"

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
    return section_title.strip().casefold() not in SESSION_RUNNING_EXCLUDE


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
        if _norm_title(title) not in by_norm:
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


def _label_present(body: str, label: str) -> bool:
    if label == "Behaviours":
        return bool(re.search(r"\*\*Behaviou?rs:\*\*", body))
    return f"**{label}:**" in body


def _scene_findings(rel: str, body: str, scene_title: str,
                    extra_labels: tuple[str, ...] = ()) -> list[Finding]:
    findings: list[Finding] = []
    locus = f"{rel}:§{scene_title}"
    for label in SCENE_LABELS + extra_labels:
        if not _label_present(body, label):
            findings.append(Finding(
                "scene-labels", "WARNING", locus,
                f"scene-labels: '{scene_title}' is missing **{label}:**"))
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
            findings.extend(_scene_findings(rel, scene_body, scene_title))
    contingency = by_norm.get(_norm_title(CONTINGENCY_SCENES_TITLE))
    if contingency is not None:
        for scene_title, scene_body in vl.h3_blocks(contingency[2]):
            findings.extend(_scene_findings(
                rel, scene_body, scene_title,
                extra_labels=(CONTINGENCY_EXTRA_LABEL,)))
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


def check_pc_state(rel: str, states: list[vl.LineState]) -> list[Finding]:
    findings = []
    for lineno, line, _section, in_code, is_heading in _walk_body(states):
        if in_code or is_heading:
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
    ap.add_argument("--inventory", action="store_true")
    ap.add_argument("--state", action="store_true")
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

#!/usr/bin/env python3
"""Session-prep context bundle: the standard read-set in one call.

Emits the digest session-prep's Context Source pattern gathers by
hand every week: latest Wrap-Up, active PC `## Current Status`
blocks, the upcoming session's existing Plan, `_World/_flags.md`
deferred items, and the campaign overview. Read-only, stdlib only.
The skill drills into individual files only where the digest shows
it needs to.

Usage:
  session_context.py VAULT [--session N]
  session_context.py VAULT --brief
  session_context.py VAULT --prep
  session_context.py VAULT --arcs
  session_context.py VAULT --carry [--before INDEX]

--session N treats N as the just-played session. Otherwise the
campaign overview's `last_session` decides, and failing that the
most recently played session by `play_date` — NOT the highest
`session_number`, which is only a campaign-wide ordinal in vaults
that never restart numbering per chapter (#162). Pre-created
`planned`/`prepped` indexes for the next session are ignored.

Everything downstream is scoped to the selected session's chapter,
so a vault where two chapters each hold a Session 07 pairs the
right wrap-up and plan. Where the answer is ambiguous — a stale
overview pointer, a session number that appears in more than one
chapter — the bundle says so rather than choosing quietly: a wrong
bundle is worse than no bundle, because it reads as authoritative.

Each section is headed with its source path; missing pieces are
reported, not fatal. A `Note:` line in the header means read before
trusting: it appears for an ambiguous `last_session` pointer (one
that resolves to nothing, to several sessions, or to a session
number present in more than one chapter), when a later session
index in the same chapter was ignored as unplayed, when a later
session in the same chapter is already played (the selection may be
stale), and when the campaign
overview's `asOfSession` names a different chapter from the one the
selected session sits in. Confirm a `Note:` with
the GM — a wrong bundle reads exactly as authoritative as a right
one.

`--brief` shrinks the default bundle's three biggest sections: the
Wrap-Up's reconcile-provenance GM Notes blocks are stubbed to a
one-line word count each, and the Campaign Overview and the existing
Session Plan each print as frontmatter plus a heading outline instead
of their full bodies. Step 6 reads that Plan properly through
`gma plan-check` with `--inventory` or `--state` when it needs to.

`--arcs` replaces the default bundle with each active PC's durable
arc material instead: `## Background` and `## GM Notes` (the
bundle's `## Current Status` block is not repeated), plus a
chapter-scoped spotlight history built from every earlier Plan's
`## Spotlight Forecast` table, with sessions since the PC last
carried the B- and C-plot. A forecast section has three states, kept
apart because they mean different things: absent, present but written
as prose (listed for direct reading, never counted as evidence of a
spotlight drought), and a real table.

`--prep` is a prep run's opening read in one call: the version check's
verdict, the `--brief` bundle, the reconcile scan of the Wrap-Up just
written (when the session's status is `wrap-up`), the `--threads` and
`--arcs` reports, the chapter's prep queue (`scene_queue.py`) and its
narrative plans (`plans_index.py`, checked against the NPCs, locations
and factions the Wrap-Up links). Each part is the named script's own
output; nothing is worked out twice.

A PC's `## Current Status` (every bundle mode) and, in `--arcs`, its
`## Background` and `## GM Notes` print as an outline when they hold
`###` subsections: the text before the first one in full, then one line
per subsection with its word count and the note and heading path that
`gma section VAULT NOTE PATH` fetches whole. A section without `###`
prints exactly as it is written. One fetch line ends the bundle when any
outline line was printed.

`--carry` is session-wrapup's: from the Wrap-Up before session INDEX
(chapter, then session order; the latest without --before) it prints
only the Handoff, Unresolved Threads, Player-Stated Intentions,
Pending Consequences and open Keeper Checklist items, then a
`Paused Scenes` block naming each paused scene and the session it
paused after.

`--prep` also prints a `Paused Scenes` block after the scene queue: each
paused scene with its snapshot (the `## Paused` section, which ends at
its `<!-- /paused -->` line). `--play` names the paused scenes the Plan
does not point at, one line each; with no Plan it prints the same block
`--prep` does. Nothing is printed when no scene is paused.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path
from typing import NamedTuple

import scene_queue
import section as section_cmd
import vault_write as vw
from schema_rules import (SESSION_PLAYED, chapter_key, chapter_of,
                          extract_frontmatter, parse_session_number,
                          wikilink_target)
from threads import _hidden_lines, pc_thread_items, shared_threads
from vaultlib import (GM_MARKER_RE, is_active_pc, marker_re,  # noqa: F401
                      is_out_of_play, out_of_play,
                      report_unreadable_settings, setting_or_builtin,
                      SKIP_DIRS, WRAP_UP_TYPES, body_of, campaign_overview,
                      entity_type,
                      atx_title, fenced_headings, find_section_lines,
                      h3_blocks, line_headings, nested_mapping,
                      normalize, raw_frontmatter, section,
                      session_ref_number, word_count)
from vaultlib import LABEL_RE as _LABEL_RE
from vaultlib import BULLET_RE
from vaultlib import bullets as _bullets
from vaultlib import fence_step, link_name, split_paused
from vaultlib import vault_files as _vault_files


def vault_files(vault: Path):
    """vaultlib.vault_files, with the frontmatter dict every caller here
    wants — parsed once per file rather than at each use site."""
    for rel, text in _vault_files(vault):
        yield rel, text, extract_frontmatter(text) or {}


def overview_of(files) -> tuple[str, str, dict] | None:
    """The Campaign Overview's (rel, text, frontmatter) among `files`, by
    `vaultlib.campaign_overview` (never an archived or QA copy)."""
    files = list(files)
    rel = campaign_overview((r, fm) for r, _t, fm in files)
    return next((f for f in files if f[0] == rel), None)


def stem_of(entry) -> str:
    """Filename stem of a session record, casefolded, for ref matching."""
    return entry["rel"].rsplit("/", 1)[-1][:-3].casefold()


def emit(title: str, source: str | None, content: str | None):
    print(f"\n===== {title} =====")
    if source:
        print(f"(source: {source})")
    print(content if content else "(none found)")


# --------------------------------------------------------------------------
# --play / --threads shared helpers
# --------------------------------------------------------------------------

# A line that opens something of its own rather than continuing the
# label line above it: a blockquote, a table row, a bullet or bold label
# (both open with `-`/`*`), an ordered-list item, or a heading. Used to
# bound the `**Entities:**` strip below.
_CONTINUATION_STOP_RE = re.compile(r"^(?:>|\||[-*#]|\d+\.)")


def _remove_inline_label_line(text: str, label: str) -> str:
    """`text` with the `**label:** ...` line deleted outright — its own
    line removed, not just blanked — so no empty line is left standing
    where a single-line label (`**Entities:** ...`) used to sit between
    two other label lines with no blank line of its own to begin with.
    `text` unchanged if `label` is absent.

    Removal is line-bounded, not block-bounded: only the label line
    itself plus any hard-wrapped continuation of it (a following
    non-blank line that opens nothing of its own — no `>`, `|`, `-`,
    `*`, `**`, `N.` or `#`). Deleting to the next bold label instead
    swallowed a scene's read-aloud quote and any trailing prose whenever
    `**Entities:**` was the last label in the scene (#M15).
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        m = _LABEL_RE.match(line.strip())
        if m and m.group(1).strip().casefold() == label.casefold():
            start = i
            break
    if start is None:
        return text
    end = start + 1
    for line in lines[start + 1:]:
        stripped = line.strip()
        if not stripped or _CONTINUATION_STOP_RE.match(stripped):
            break
        end += 1
    del lines[start:end]
    return "\n".join(lines)


def _heading_block(text: str, level: int, title: str) -> str | None:
    """Body of a `#`*level heading titled `title`, up to the next heading
    of level <= `level`, or end of `text`. None if absent.

    Unlike `vaultlib.section`/`h3_blocks` (fixed at H2/H3), this walks an
    arbitrary depth: the Wrap-Up template nests `#### Unresolved Threads`
    under `### What Carries Forward` under `## GM Notes`, and
    `### PC Carry-Forward` directly under `## GM Notes` with its own
    `#### [[PC Name]] (Player)` sub-heading — "any nesting" per the
    thread report's sourcing rule.
    """
    marker = "#" * level
    pattern = re.compile(
        rf"^{marker}\s+{re.escape(title)}\s*$(.*?)(?=^#{{1,{level}}}\s|\Z)",
        re.MULTILINE | re.DOTALL)
    m = pattern.search(text)
    return m.group(1).strip() if m else None


# --------------------------------------------------------------------------
# --brief helpers
# --------------------------------------------------------------------------

# H2 blocks --brief stubs outright, and H3 blocks it stubs by title, alone
# or followed by a parenthetical (the template's Name Conflicts heading
# carries one); never a longer title that only starts with one (a
# `Resolved Threads Review` is the GM's own). The list also matches at
# `####`: the template's Resolved Threads sits one level down, under What
# Carries Forward.
BRIEF_DROP_H2: tuple[str, ...] = ("Memorable Moments",)
BRIEF_DROP_H3: tuple[str, ...] = (
    "Name Conflicts", "Cross-Entity Claims", "World Fact Findings",
    "Quality Notes", "Resolved Threads")

_H2_HEADING_RE = re.compile(r"^## (.+)$")
_H3_HEADING_RE = re.compile(r"^(#{3,4}) (.+)$")
_ANY_HEADING_RE = re.compile(r"^(#{1,6})\s")
# A gm-only or spoiler marker, anywhere on a line.
_ANY_MARKER_RE = marker_re()


def brief_wrapup(body: str) -> str:
    """`body` with each BRIEF_DROP_H2 `## ` block and each BRIEF_DROP_H3
    `### ` block replaced by its heading line plus one stub line:
    `(omitted in --brief: N words — read the Wrap-Up file for it)`.
    H3 titles match whole, or followed by ` (` (the template's Name
    Conflicts heading has a parenthetical). A block ends at the next heading of the same or
    higher level, at any line holding a gm-only or spoiler marker, or
    EOF — either marker is a terminator, not just the closer, because the
    template opens the fence right after ## Memorable Moments' own
    content and a terminator that only recognised the closer would eat
    the opening marker into the dropped block. The terminator line itself
    is never consumed, so it survives in the output. A blank line follows
    the stub, separating it from whatever comes next, unless that next
    line is already blank.

    Headings inside a fenced code block are inert, the same as in
    `outline`: a wrap-up that shows `### Quality Notes` as a markdown
    example must not have its example stubbed out from under it."""
    lines = body.splitlines()
    out: list[str] = []
    i = 0
    n = len(lines)
    in_fence = False
    while i < n:
        line = lines[i]
        if line.strip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            i += 1
            continue
        if in_fence:
            out.append(line)
            i += 1
            continue
        level: int | None = None
        m2 = _H2_HEADING_RE.match(line)
        if m2 and m2.group(1).strip() in BRIEF_DROP_H2:
            level = 2
        else:
            m3 = _H3_HEADING_RE.match(line)
            title = m3.group(2).strip() if m3 else ""
            if m3 and any(title == p or title.startswith(p + " (")
                          for p in BRIEF_DROP_H3):
                level = len(m3.group(1))
        if level is None:
            out.append(line)
            i += 1
            continue
        out.append(line)
        j = i + 1
        collected: list[str] = []
        inner_fence = False
        while j < n:
            if lines[j].strip().startswith("```"):
                inner_fence = not inner_fence
                collected.append(lines[j])
                j += 1
                continue
            if inner_fence:
                collected.append(lines[j])
                j += 1
                continue
            hm = _ANY_HEADING_RE.match(lines[j])
            if hm and len(hm.group(1)) <= level:
                break
            if _ANY_MARKER_RE.search(lines[j]):
                break
            collected.append(lines[j])
            j += 1
        wc = word_count("\n".join(collected))
        out.append(f"(omitted in --brief: {wc} words — read the Wrap-Up "
                   f"file for it)")
        if j < n and lines[j].strip() != "":
            out.append("")
        i = j
    result = "\n".join(out)
    return result + "\n" if body.endswith("\n") else result


_OUTLINE_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def outline(body: str) -> str:
    """One line per heading, any level `#` to `######`, in document
    order: `{heading line}  ({N} words)` — N = word count of the text
    between this heading and the next heading of any level. Headings
    inside fenced code are skipped (toggle on a line starting with ```).

    Every level is emitted, H4-H6 included: an outline that silently
    dropped the deeper headings hid whole sections (a wrap-up's
    `#### Unresolved Threads`, a plan's per-PC `#### [[Name]]`) from the
    reader deciding whether to open the file."""
    lines = body.splitlines()
    in_fence = False
    heads: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _OUTLINE_HEADING_RE.match(line)
        if m:
            heads.append((i, len(m.group(1)), line.rstrip()))
    out_lines: list[str] = []
    for idx, (line_i, _level, heading_line) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        wc = word_count("\n".join(lines[line_i + 1:end]))
        out_lines.append(f"{heading_line}  ({wc} words)")
    return "\n".join(out_lines)


def _norm_thread(text: str) -> str:
    """Casefolded thread text for fuzzy matching: a `[[Target|Alias]]`
    collapses to its target, and runs of whitespace collapse to one
    space."""
    text = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


_THREAD_LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
_THREAD_STOP = frozenset("""
about after again also and any are away back because been before being but
came can come could did does each even ever every few first for from gave get
give got going gone good had has have her him his how into its last left let
like made make many may more most much must never new next not now off one
only other our out over own put said say she see seen should since still
some such take taken than that the their them then there they this those too
took told two under upon use very want was were what when where which while
who whom why will with without would yet you your
knows resources major session relationships intent moment carried""".split())


def _thread_words(raw: str) -> tuple[set[str], set[str]]:
    """(wikilink targets, significant words) of a thread line, both
    casefolded. A word is significant when it has three or more letters
    and is no stop word; a link target's own words count as words."""
    links = {re.sub(r"^(the|a|an) ", "",
                    m.group(1).rpartition("/")[2].replace("_", " ")
                    .strip().casefold())
             for m in _THREAD_LINK_RE.finditer(raw)}
    words = {w for w in re.findall(r"[^\W\d_]{3,}", _norm_thread(raw))
             if w not in _THREAD_STOP}
    return links, words


def threads_related(a: str, b: str) -> bool:
    """The second matching tier for a PC thread and a Wrap-Up bullet the
    ratio test missed (a rewritten sheet line keeps its key words, not
    their order or length). They share a person, place or thing (a
    wikilink target of one that the other links or names) and two further
    significant words; or, with no such name, four significant words. Either
    way those words must be half of the shorter line's, so a long thread
    and a short bullet that only meet over a common name stay apart."""
    links_a, words_a = _thread_words(a)
    links_b, words_b = _thread_words(b)
    shared = words_a & words_b
    names = {t for t in links_a | links_b
             if (t in links_a and t in links_b)
             or set(t.split()) <= (words_b if t in links_a else words_a)}
    named = {w for t in names for w in t.split()}
    extra = len(shared - named)
    need = 2 if names else 4
    smaller = min(len(words_a), len(words_b))
    return extra >= need and extra * 2 >= smaller


_POINTER_RE = re.compile(r"\[\[([^\[\]|#]+)(?:[#|][^\[\]]*)?\]\]")


def _pointer_target(title: str) -> str | None:
    """The note a `### [[Note]]` Plan heading points at, else None."""
    m = _POINTER_RE.fullmatch(title.strip())
    return m.group(1).strip() if m else None


def _scene_note_text(files, name: str, chapter: str | None = None) -> str:
    """A scene note as the table needs it: `## Paused` first when there
    is one, no frontmatter. GM-only parts and `## GM Notes` stay (the
    brief is the GM's own sheet; nothing publishes from it); only the
    gm-only marker lines go. Of several
    notes of the name, the one in `chapter` (a chapter key); a `name`
    holding a path names its note. Still several: said, not guessed."""
    if "/" in name:
        want = normalize(name.removesuffix(".md"))
        hits = [f for f in files if entity_type(f[2]) == "scene"
                and normalize(f[0][:-3]) == want]
    else:
        want = normalize(name)
        hits = [f for f in files if entity_type(f[2]) == "scene"
                and normalize(Path(f[0]).stem) == want]
    if len(hits) > 1:
        hits = [f for f in hits
                if chapter_key(f[0], f[2]) == chapter] or hits
    if not hits:
        return f"(no scene note named {name})"
    if len(hits) > 1:
        return (f"({len(hits)} scene notes named {name}: "
                + ", ".join(f[0] for f in hits)
                + "; write the pointer as the path of the one meant)")
    _rel, text, _fm = hits[0]

    def strip_markers(part: str) -> str:
        kept: list[str] = []
        fence: str | None = None
        blanks = 0
        for line in part.splitlines():
            if GM_MARKER_RE.fullmatch(line.strip()):
                continue
            fence, edge = fence_step(line, fence)
            if fence is not None or edge:
                blanks = 0  # fenced text stays exactly as written
            elif line == "":
                blanks += 1
                if blanks > 1:
                    continue  # a blank run outside a fence collapses
            else:
                blanks = 0
            kept.append(line)
        return "\n".join(kept).strip()

    # Split on the raw body so the span is the one prep and the writer
    # see; only then drop the marker lines.
    paused, rest = split_paused(body_of(text))
    body = strip_markers(rest)
    if paused:
        body = f"## Paused\n{strip_markers(paused)}\n\n{body}".strip()
    return body or f"(scene note {name} is empty)"


def scene_pointer_titles(plan_text: str) -> list[tuple[str, str]]:
    """(target, heading) for each `### [[Note]]` heading under Planned and
    Contingency Scenes, in Plan order: the target as written (a path keeps
    its folders, `.md` dropped) and the heading text, alias and all."""
    out: list[tuple[str, str]] = []
    for title in ("Planned Scenes", "Contingency Scenes"):
        body = section(plan_text, title)
        for heading, _b in (h3_blocks(body) if body is not None else []):
            target = _pointer_target(heading)
            if target:
                out.append((target.removesuffix(".md"), heading.strip()))
    return out


def scene_pointers(plan_text: str) -> list[str]:
    """The notes a Plan's scene pointers name, as written (see
    `scene_pointer_titles`)."""
    return [t for t, _h in scene_pointer_titles(plan_text)]


def pointer_key(target: str) -> str:
    """How `plan_pointers` keys one `scene_pointers` target."""
    return normalize(target if "/" in target else target.removesuffix(".md"))


def plan_pointers(plan_text: str) -> set[str]:
    """The scene notes a Plan points at (`### [[Note]]` under Planned and
    Contingency Scenes): a bare `[[Note]]` by its `normalize`d name without
    `.md` (periods in the name kept), one
    written as a path by its `normalize`d vault-relative path without
    `.md` (it has a `/`, so the two kinds never collide)."""
    return {pointer_key(t) for t in scene_pointers(plan_text)}


def is_pointed_at(rel: str, pointed: set[str]) -> bool:
    """Whether a Plan pointer in `pointed` (see `plan_pointers`) names
    the scene note at `rel`."""
    return (normalize(rel.removesuffix(".md")) in pointed
            or normalize(Path(rel).stem) in pointed)


class Paused(NamedTuple):
    rel: str
    title: str
    after: str | None
    snapshot: str | None


def paused_scenes(vault: Path, files) -> list[Paused]:
    """The paused scenes, in the scene queue's order (which owns what
    `paused` means and where such a scene may sit). `after` is the last
    session in the note's `played_in`; `snapshot` its `## Paused`
    section as `split_paused` ends it, None when the note has none."""
    by_rel = {rel: (text, fm) for rel, text, fm in files}
    rows = []
    for row in scene_queue.queue(vault):
        if row.status != "paused":
            continue
        text, fm = by_rel.get(row.rel, ("", {}))
        played = fm.get("played_in") or []
        if not isinstance(played, list):
            played = [played]
        after = link_name(wikilink_target(played[-1])) if played else None
        snapshot, _rest = split_paused(body_of(text))
        rows.append(Paused(row.rel, row.title, after, snapshot or None))
    return rows


def _paused_head(p: Paused) -> str:
    return (f"[[{p.title}]] (paused after [[{p.after}]])" if p.after
            else f"[[{p.title}]] (paused)")


def paused_line_block(paused: list[Paused], title: str) -> str:
    """One line per paused scene under `title`; empty when none."""
    if not paused:
        return ""
    return f"{title}\n" + "\n".join(_paused_head(p) for p in paused)


def paused_snapshot_block(paused: list[Paused], title: str) -> str:
    """Each paused scene with its snapshot in full; empty when none."""
    if not paused:
        return ""
    return f"{title}\n" + "\n\n".join(
        f"### {_paused_head(p)}\n{p.snapshot or '(no snapshot written)'}"
        for p in paused)


def play_brief(files, plan_rel: str, plan_text: str) -> str:
    """The Play Brief for one Session Plan: scene titles, their full
    bodies minus the Entities link list — the enumerated skeleton is
    already table-shaped, so nothing else needs trimming — the NPC
    table, World State, Contingency scenes in full, and End Objectives.
    The Plan's Active Threads and GM Notes are dropped, because the
    table doesn't need them and the Keeper is already holding the full
    Plan if they do.

    A block titled by one wikilink (`### [[Ashworth Dinner]]`) points at a
    scene note: its body follows, `## Paused` first, GM-only parts and
    `## GM Notes` kept (the scene's secrets are what the table needs).
    `files` is where those notes are found; the Plan's own `session:`
    frontmatter is always enough to name it.
    """
    fm = extract_frontmatter(plan_text) or {}
    n = session_ref_number(fm)
    chapter = chapter_key(plan_rel, fm)
    parts = [f"===== Play Brief — Session {n if n is not None else '?'} =====\n"
             f"(source: {plan_rel})"]

    def verbatim(title: str) -> str:
        body = section(plan_text, title)
        return f"## {title}\n{body if body else f'(no ## {title})'}"

    parts.append(verbatim("Session Intent"))

    def scenes(section_title: str, *, strip_entities: bool) -> str:
        body = section(plan_text, section_title)
        blocks = h3_blocks(body) if body is not None else []
        if not blocks:
            return f"## {section_title}\n(no ## {section_title})"
        rendered = []
        for title, scene_body in blocks:
            reduced = scene_body
            if strip_entities:
                reduced = _remove_inline_label_line(
                    scene_body, "Entities").strip()
            piece = f"### {title}\n{reduced}" if reduced else f"### {title}"
            pointed = _pointer_target(title)
            if pointed:
                piece += "\n\n" + _scene_note_text(files, pointed, chapter)
            rendered.append(piece)
        return f"## {section_title}\n" + "\n\n".join(rendered)

    parts.append(scenes("Planned Scenes", strip_entities=True))
    parts.append(verbatim("NPC Quick Reference"))
    parts.append(verbatim("World State"))
    parts.append(scenes("Contingency Scenes", strip_entities=False))
    parts.append(verbatim("Session End Objectives"))

    return "\n\n".join(parts)


def _ratio_match(norm: str, bullet: str) -> bool:
    return SequenceMatcher(None, norm, _norm_thread(bullet)).ratio() >= 0.6


def _scoped_wrap_ups(files, chapter):
    """(session, text) of each Wrap-Up in scope (see `wrap_up_threads`)."""
    for rel, text, fm in files:
        if entity_type(fm) not in WRAP_UP_TYPES:
            continue
        if chapter is not None:
            ck = chapter_key(rel, fm)
            if ck is not None and ck != chapter:
                continue
        n = session_ref_number(fm)
        if n is not None:
            yield n, text


def _pc_key(target: str) -> str:
    """A PC note name or link target as matching reads it: its last path
    part, without `.md`, through `vaultlib.normalize`."""
    name = Path(target).name
    if name.casefold().endswith(".md"):
        name = name[:-3]
    return normalize(name)


_CLOSED_TAIL_RE = re.compile(r"\s+\u2014\s+closed:\s.*$")


def _whole_bullets(block: str) -> list[str]:
    """Each bullet of `block` with the plain lines under it (a wrapped
    line, indented or not) joined on after a space."""
    out: list[str] = []
    going = False   # a plain line now carries on the last bullet
    for line in block.splitlines():
        m = BULLET_RE.match(line)
        if m:
            out.append(m.group(1).strip())
            going = True
        elif going and line.strip() and not line.lstrip().startswith("#"):
            out[-1] += " " + line.strip()
        else:
            going = False   # a blank or a heading ends the bullet
    return out


def wrap_up_resolved(files, chapter) -> list[tuple[int, str]]:
    """(session, thread) per closed thread in the in-scope Wrap-Ups'
    `#### Resolved Threads`, each read whole and without its
    `— closed: …` tail (see `threads.format_resolved`)."""
    out: list[tuple[int, str]] = []
    for n, text in _scoped_wrap_ups(files, chapter):
        block = _heading_block(text, 4, "Resolved Threads")
        out.extend((n, _CLOSED_TAIL_RE.sub("", b, count=1))
                   for b in (_whole_bullets(block) if block else []))
    return out


def wrap_up_threads(files, chapter) -> list[tuple[int, list[str], list[str]]]:
    """(session, unresolved bullets, carry-forward bullets) per wrap-up.

    Wrap-ups are scoped to `chapter` the same way the rest of this file
    is (#162): a wrap-up filed under a different, resolvable chapter is
    excluded, but one with no resolvable chapter of its own still counts
    — a flat vault, or a legacy unfiled record, should not silently lose
    its threads.
    """
    wrap_ups: list[tuple[int, list[str], list[str]]] = []
    for n, text in _scoped_wrap_ups(files, chapter):
        unresolved_block = _heading_block(text, 4, "Unresolved Threads")
        carry_block = _heading_block(text, 3, "PC Carry-Forward")
        unresolved = _bullets(unresolved_block) if unresolved_block else []
        carry = _bullets(carry_block) if carry_block else []
        wrap_ups.append((n, unresolved, carry))
    return wrap_ups


def _match(thread: str, wrap_ups):
    """(sessions, mark, claimed): `claimed` holds the (session, bullet)
    Unresolved bullets a close match took."""
    norm = _norm_thread(thread)
    hits: list[int] = []
    claimed: set[tuple[int, str]] = set()
    for n, unresolved, carry in wrap_ups:
        for bullet in unresolved + carry:
            if _ratio_match(norm, bullet):
                hits.append(n)
                if bullet in unresolved:
                    claimed.add((n, bullet))
                break
    if hits:
        return hits, "=", claimed
    # The looser tier reads only what the first missed.
    for n, unresolved, carry in wrap_ups:
        if any(threads_related(thread, bullet)
               for bullet in unresolved + carry):
            hits.append(n)
    return hits, ("~" if hits else ""), claimed


def match_sessions(thread: str, wrap_ups) -> tuple[list[int], str]:
    """The session numbers whose Unresolved Threads / PC Carry-Forward
    bullets match `thread`, and how: `=` for a close match, `~` for the
    looser shared-words tier (tentative). No match gives `([], "")`.
    `wrap_ups` is what `wrap_up_threads` returns."""
    hits, mark, _claimed = _match(thread, wrap_ups)
    return hits, mark


def thread_report(files, current: int, chapter, vault: Path) -> str:
    """The Campaign Overview's shared Open Threads, then per-PC Open-threads
    ages against Wrap-Up Unresolved Threads / PC Carry-Forward bullets,
    plus wrap-up bullets that never made it onto any thread list
    (thread-decay candidates).
    """
    lines = ["===== Threads ====="]
    wrap_ups = wrap_up_threads(files, chapter)

    not_playing = out_of_play(vault)
    stale_after = setting_or_builtin(vault, "vault.stale_after_sessions")
    pcs = [(rel, text) for rel, text, fm in files
           if is_active_pc(rel, fm, not_playing)]
    overview = overview_of(files)
    overview_text = overview[1] if overview else ""
    shared = shared_threads(overview_text)

    # Unresolved bullets a thread actually matched, keyed by (session,
    # bullet text) — everything else is reported as an orphan below.
    matched: set[tuple[int, str]] = set()
    tentative = False

    def tags(thread: str) -> str:
        nonlocal tentative
        hits, mark, claimed = _match(thread, wrap_ups)
        matched.update(claimed)
        if not hits:
            return ("first=?\tlast=?\tage=?\t"
                    "(not in any wrap-up — check it is still live)")
        tentative = tentative or mark == "~"
        first, last = min(hits), max(hits)
        age = current - last
        stale = "STALE" if age >= stale_after else ""
        return (f"first{mark}{first}\tlast{mark}{last}"
                f"\tage{mark}{age}\t{stale}")

    # A PC's copy of a visible shared thread that involves them (or the
    # party) prints once, as shared; a hidden shared one shares nothing
    # with players, and one naming only others is not theirs, so the copy
    # stays. Text -> the involved names, casefolded ("" for the party).
    shared_texts: dict[str, set[str]] = {}
    for t in shared:
        if not t.hidden:
            shared_texts.setdefault(" ".join(t.text.split()), set()).update(
                [""] if t.party
                else [_pc_key(n) for n in t.involves])
    if shared:
        lines.append("--- Shared (Campaign Overview) ---")
    for t in shared:
        who = ("the party" if t.party else ", ".join(t.involves)
               or "(none named)")
        mark = " (hidden)" if t.hidden else ""
        lines.append(f"{t.text}{mark}\t{tags(t.text)}\tinvolves: {who}")

    if not pcs:
        lines.append("(no active PC entities found)")
    for rel, text in pcs:
        lines.append(f"--- {Path(rel).stem} ---")
        # Each thread whole on one line, as `vw threads` matches it; a
        # hidden one (in or next to hidden text) is shown but marked, since
        # `vw threads` refuses it.
        pc_items = pc_thread_items(text)
        if not pc_items:
            lines.append("(no ## Current Status Open threads)")
            continue
        own = 0
        stem = _pc_key(Path(rel).stem)
        for item in pc_items:
            flat = " ".join(item.text.split())
            if shared_texts.get(flat, set()) & {"", stem}:
                continue  # printed once, as shared
            own += 1
            mark = " (hidden)" if item.hidden else ""
            lines.append(f"{item.text}{mark}\t{tags(item.text)}")
        if not own:
            lines.append("(only threads held in the shared list, above)")

    if tentative:
        lines.insert(1, "(~ means a likely match by shared names and words, "
                        "not the same text: check it)")
    # A thread closed into a Resolved Threads list claims the Unresolved
    # bullets that are the same thread (the same words, as `_norm_thread`
    # reads them): it is done, not lost. A merely close bullet ("found"
    # against "still missing") stays an orphan, for the GM to judge.
    # It claims them up to the session that closed it: one raised again
    # after that is open again. With no chapter in scope, session numbers
    # from different chapters can collide, so any closure claims them.
    closed: dict[str, float] = {}
    for n, c in wrap_up_resolved(files, chapter):
        key = _norm_thread(c)
        closed[key] = (float("inf") if chapter is None
                       else max(n, closed.get(key, n)))
    matched.update((n, bullet) for n, unresolved, _carry in wrap_ups
                   for bullet in unresolved
                   if n <= closed.get(_norm_thread(bullet), -1))
    lines.append("--- Wrap-up threads not on any thread list ---")
    orphans = [f"session {n}\t{bullet}"
              for n, unresolved, _carry in wrap_ups
              for bullet in unresolved if (n, bullet) not in matched]
    lines.extend(orphans if orphans else ["(none)"])

    return "\n".join(lines)


# --------------------------------------------------------------------------
# --arcs helpers
# --------------------------------------------------------------------------

SPOTLIGHT_TITLE = "Spotlight Forecast"

_SEPARATOR_CELL_RE = re.compile(r"^[-:]+$")
_TRAILING_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")


def _row_cells(line: str) -> list[str]:
    r"""Cells of a `|`-delimited table row. Splits only on pipes that are
    a real cell boundary: an escaped `\|` and the alias pipe inside
    `[[Target|Alias]]` stay inside their cell. The table contract forbids
    both forms, but a plan reaches `--arcs` before `vault_check` has ever
    seen it, and a mis-split PC cell silently reports the wrong drought.

    An unbalanced `[[` would otherwise swallow the rest of the row, which
    is the same silent mis-read from the other side, so a row that ends
    mid-wikilink falls back to the naive split."""
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|") and not inner.endswith("\\|"):
        inner = inner[:-1]
    cells: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    while i < len(inner):
        if inner.startswith("\\|", i):
            buf.append("\\|")
            i += 2
        elif inner.startswith("[[", i):
            depth += 1
            buf.append("[[")
            i += 2
        elif inner.startswith("]]", i):
            depth = max(0, depth - 1)
            buf.append("]]")
            i += 2
        elif inner[i] == "|" and depth == 0:
            cells.append("".join(buf).strip())
            buf = []
            i += 1
        else:
            buf.append(inner[i])
            i += 1
    cells.append("".join(buf).strip())
    if depth != 0:
        return [c.strip() for c in inner.split("|")]
    return cells


def spotlight_rows(plan_body: str) -> list[tuple[str, str]] | None:
    """(pc_cell, role) per data row of the first table under
    `## Spotlight Forecast`; None when the section is absent. Only the
    first `|`-delimited table is read: collection starts at the first
    `|` line and stops at the first non-`|` line seen after that (a
    blank line or prose ends the table), so a second table later in
    the same section is never ingested. pc_cell = first cell with
    `[[Target|Alias]]` reduced to its target, `**`, `[[`, `]]` removed
    and a trailing `(...)` dropped, stripped.
    role = "B" if "b-plot" in the row (casefold) else "C" if "c-plot"
    else "A" if "a-plot" else "-". A share percentage in the row is not
    read: it was an estimate, not a fact. Header and separator rows
    skipped."""
    block = section(plan_body, SPOTLIGHT_TITLE)
    if block is None:
        return None
    table_lines: list[str] = []
    started = False
    for ln in block.splitlines():
        if ln.strip().startswith("|"):
            table_lines.append(ln)
            started = True
        elif started:
            break
    rows: list[tuple[str, str]] = []
    for line in table_lines[1:]:  # skip header row
        cells = _row_cells(line)
        if cells and all(_SEPARATOR_CELL_RE.match(c) for c in cells if c):
            continue  # separator row
        if not cells or not cells[0]:
            continue
        first = _WIKILINK_RE.sub(lambda m: m.group(1), cells[0])
        first = (first.replace("**", "").replace("[[", "")
                 .replace("]]", "").replace("\\|", "|"))
        first = _TRAILING_PAREN_RE.sub("", first).strip()
        low = line.casefold()
        if "b-plot" in low:
            role = "B"
        elif "c-plot" in low:
            role = "C"
        elif "a-plot" in low:
            role = "A"
        else:
            role = "-"
        rows.append((first, role))
    return rows


def pc_matches(cell: str, rel: str, fm: dict) -> bool:
    """cell.casefold() equals the file stem with `_`→space, or the stem's
    first token, or any entry of fm["aliases"] or fm["gm_aliases"] (list, or a single
    string), all casefolded. The cell is tried both as written and with
    `_`→space, so a PC named by wikilink target (`[[Hero_Name]]`)
    matches the file its link points at."""
    stem = Path(rel).stem.replace("_", " ")
    tokens = stem.split()
    candidates = {stem.casefold()}
    # First-token matching is intentional and can match two PCs who share a
    # first name — the report lists the PC's file path so the reader can tell.
    if tokens:
        candidates.add(tokens[0].casefold())
    for field in ("aliases", "gm_aliases"):
        aliases = fm.get(field)
        if isinstance(aliases, str):
            aliases = [aliases]
        if isinstance(aliases, list):
            candidates.update(str(a).casefold() for a in aliases)
    return (cell.casefold() in candidates
            or cell.replace("_", " ").casefold() in candidates)


FETCH_LINE = ('Outlined subsections: fetch one with `gma section "<vault>" '
              '"<note>" "<path>"`; the note and path are in its line above.')


class Outlines:
    """Remembers whether a bundle printed any outline line, so its one
    fetch line ends it, and the vault's note names, read once, that decide
    how an outline line names its note."""

    def __init__(self) -> None:
        self.used = False
        self.files: list = []   # the bundle's (rel, text, fm) notes
        self._batch: vw.Batch | None = None
        self._names: dict[str, list[str]] = {}

    def layered(self, body: str, vault: Path, rel: str, section: str,
                note_text: str) -> str:
        text, outlined = layered(body, lambda: self.note_ref(vault, rel),
                                 section, note_text)
        self.used = self.used or outlined
        return text

    def note_ref(self, vault: Path, rel: str) -> str:
        """What an outline line names the note at `rel` by: its file name
        when `gma section` resolves that name to this note, else its
        vault-relative path (without `.md`), which it resolves exactly."""
        path = Path(rel).as_posix()
        if self._batch is None:
            self._batch = vw.Batch(vault)
            self._names = section_cmd.name_index(
                (f[0], f[1]) for f in self.files)
        try:
            if section_cmd.resolve_note(self._batch, Path(rel).stem,
                                        self._names) == path:
                return Path(rel).stem
        except vw.WriteError:
            pass
        return path.removesuffix(".md")


_OPEN_THREADS_LABEL_RE = re.compile(
    r"^[ \t]*(?:[-*][ \t]+)?\*\*open threads:\*\*", re.I)


def layered(body: str, note: str | Callable[[], str], section: str,
            note_text: str | None = None) -> tuple[str, bool]:
    """A section body with its `###` subsections outlined, and whether it
    was. `body` is the section's text without its own `##` heading;
    `note_text` is the whole note, which `gma section` will read. Returns
    the text before the first heading of level 3 or deeper (a blank line
    after it kept), then one line per subsection,
    `### {title}  ({N} words; {note}: {path})`. N counts the whole
    subsection, deeper headings included, which is what the fetch returns.
    The path is `{section}/{title}` when that picks out this one heading in
    the note, else the same with the section's level pinned
    (`## {section}/{title}`), else the section's own path (pinned if its
    name repeats), which fetches every subsection under it; when not even
    that is unique, or a hidden heading as high as its own would end the
    fetched span early, the subsection prints whole. A deeper heading inside a
    subsection folds into it, and a heading inside a comment or a gm-only
    or `%%` block is not a subsection. A body with no subsection heading
    comes back unchanged. The `**Open threads:**` label is not a heading,
    so it stays in the text before the first one; a subsection holding the
    label under it prints whole. A CRLF body gets CRLF outline lines."""
    lines = body.split("\n")
    hidden = _hidden_lines(lines)
    every = line_headings(lines)
    heads = [h for h in every if h[1] >= 3 and not hidden[h[0]]]
    if not heads:
        return body, False
    tops: list[tuple[int, int, str]] = []
    for h in heads:
        if not tops or h[1] <= tops[-1][1]:
            tops.append(h)
    note = note() if callable(note) else note
    eol = "\r\n" if "\r\n" in body else "\n"
    before = lines[:tops[0][0]]
    out = ["\n".join(before).rstrip()]   # lines keep their own "\r"
    if before and not before[-1].strip():
        out.append("")
    # The note as `gma section` reads it; the section alone when not given.
    whole = (note_text.split("\n") if note_text is not None
             else ["## " + section, *lines])
    outlined = False
    for n, (idx, level, title) in enumerate(tops):
        end = tops[n + 1][0] if n + 1 < len(tops) else len(lines)
        name = atx_title(title)
        where = _fetch_path(whole, section, name)
        # `gma section` ends a span at a hidden heading too (it skips only
        # code fences), so a subsection holding one prints whole.
        cut = any(idx < h[0] < end and hidden[h[0]] and h[1] <= level
                  for h in every)
        if (where is None or cut
                or any(_OPEN_THREADS_LABEL_RE.match(x)
                       for x in lines[idx + 1:end])):
            out.append("\n".join(lines[idx:end]).rstrip())   # printed whole
            continue
        words = word_count("\n".join(lines[idx + 1:end]))
        out.append(f"{'#' * level} {name}  ({words} words; "
                   f"{note}: {where})")
        outlined = True
    return eol.join(out).lstrip("\r\n"), outlined


def _fetch_path(whole: list[str], section: str, name: str) -> str | None:
    """The path `gma section` takes to fetch the subsection `name` of
    `section` (see `layered`), or None when no path fetches exactly one
    span: the first of the plain path, the level-pinned path and the
    section itself (plain, then pinned) that finds one heading."""
    rest = [p.strip() for p in name.split("/")]
    for pinned in (False, True):
        top = f"## {section}" if pinned else section
        if isinstance(find_section_lines(
                whole, [section, *rest], level=2 if pinned else None),
                tuple):
            return f"{top}/{name}"
    for pinned in (False, True):
        if isinstance(find_section_lines(
                whole, [section], level=2 if pinned else None), tuple):
            return f"## {section}" if pinned else section
    return None


def arcs_report(files, chapter, upcoming: int, vault: Path,
                outlines: Outlines) -> str:
    """For each active PC (type pc, not *_Story.md, status not out of play
    for this vault):
      --- {stem} ({rel}, player: {player_name or ?}) ---
      ## Background
      {section or "(no ## Background section)"}
      ## GM Notes
      {section or "(no ## GM Notes section)"}
      Spotlight history (chapter-scoped, from ## Spotlight Forecast tables):
        Session 6: B
        Session 7: (no row for this PC)
      Sessions since last B-plot: 2 (Session 6)     or  never (in N plans read)
      Sessions since last C-plot: never (in 2 plans read)

    A Plan's `## Spotlight Forecast` has three states, and they are not
    interchangeable — 6 of 9 chapter plans on the campaign this was
    measured against write the forecast as prose, and folding those into
    "no row for this PC" reported a spotlight drought that did not exist:
      - section absent      -> named under `Plans without a
                               ## Spotlight Forecast: ...`;
      - section present but carrying no table rows -> named under `Plans
                               whose ## Spotlight Forecast has no table
                               (read those sections directly): ...`, with
                               no per-PC line and no place in the
                               `(in N plans read)` denominator;
      - table with rows     -> one `Session N: role` line per PC,
                               `(no row for this PC)` where the PC is
                               genuinely absent from a table that exists.
    Both buckets print once, after the PCs (`(none)` when empty).

    Plans = every type: session-plan with a parsable session number <
    upcoming, prefer_chapter semantics, sorted by number.
    "Sessions since" = upcoming - N."""
    lines = [f"===== PC Arcs — Sessions before {upcoming} ====="]

    plan_files = [(rel, text, fm) for rel, text, fm in files
                  if fm.get("type") == "session-plan"]
    numbers = sorted({n for rel, text, fm in plan_files
                      if (n := session_ref_number(fm)) is not None
                      and n < upcoming})

    plans: list[tuple[int, list[tuple[str, str]] | None]] = []
    for n in numbers:
        candidates = [c for c in plan_files if session_ref_number(c[2]) == n]
        picked = prefer_chapter(candidates, chapter)
        if picked is None:
            continue
        plans.append((n, spotlight_rows(picked[1])))

    tables = [(n, rows) for n, rows in plans if rows]
    prose_forecast = [n for n, rows in plans if rows == []]
    no_section = [n for n, rows in plans if rows is None]

    not_playing = out_of_play(vault)
    pcs = [(rel, text, fm) for rel, text, fm in files
           if is_active_pc(rel, fm, not_playing)]

    def since(last: int | None, label: str) -> str:
        if last is None:
            return (f"Sessions since last {label}-plot: never "
                     f"(in {len(tables)} plans read)")
        return (f"Sessions since last {label}-plot: {upcoming - last} "
                f"(Session {last})")

    for rel, text, fm in pcs:
        stem = Path(rel).stem
        player = fm.get("player_name") or "?"
        lines.append(f"\n--- {stem} ({rel}, player: {player}) ---")
        bg = section(text, "Background")
        lines.append("## Background")
        lines.append(outlines.layered(bg, vault, rel, "Background", text) if bg
                     else "(no ## Background section)")
        gm = section(text, "GM Notes")
        lines.append("## GM Notes")
        lines.append(outlines.layered(gm, vault, rel, "GM Notes", text) if gm
                     else "(no ## GM Notes section)")
        lines.append("Spotlight history (chapter-scoped, from "
                     "## Spotlight Forecast tables):")
        last_b: int | None = None
        last_c: int | None = None
        for n, rows in tables:
            match = next((r for r in rows if pc_matches(r[0], rel, fm)), None)
            if match is None:
                lines.append(f"  Session {n}: (no row for this PC)")
                continue
            role = match[1]
            lines.append(f"  Session {n}: {role}")
            if role == "B":
                last_b = n
            elif role == "C":
                last_c = n
        lines.append(since(last_b, "B"))
        lines.append(since(last_c, "C"))

    lines.append("")
    lines.append("Plans without a ## Spotlight Forecast: "
                 + (", ".join(f"Session {n}" for n in no_section)
                    if no_section else "(none)"))
    lines.append("Plans whose ## Spotlight Forecast has no table (read "
                 "those sections directly): "
                 + (", ".join(f"Session {n}" for n in prose_forecast)
                    if prose_forecast else "(none)"))

    return "\n".join(lines)


# --------------------------------------------------------------------------
# --carry
# --------------------------------------------------------------------------

def _heading_key(title: str) -> str:
    return " ".join(re.sub(r"[*_`]", "", title).split()).casefold()


# (title printed when the part is missing, level-free test on the heading's
# key). Older Wrap-Ups name these differently ("Unresolved Cliffhanger",
# "Unrealised Consequences"); Reconciliation Context's bare "Consequences"
# is reconcile's record, not a carried item.
CARRY_PARTS: tuple[tuple[str, Callable[[str], bool]], ...] = (
    ("Handoff to session-prep", lambda k: k.startswith("handoff")),
    ("Unresolved Threads", lambda k: k.startswith("unresolved")),
    ("Player-Stated Intentions", lambda k: k.endswith("intentions")),
    ("Pending Consequences",
     lambda k: k.endswith("consequences") and k != "consequences"),
)
_CHECK_OPEN_RE = re.compile(r"^[-*+] \[ \]")
_CHECK_ANY_RE = re.compile(r"^[-*+] \[.\]")
_CHAPTER_NUM_RE = re.compile(r"chapter\D{0,3}(\d+(?:\.\d+)?)", re.IGNORECASE)


def campaign_order(rel: str, fm: dict) -> tuple[float, float]:
    """(chapter number, session number) for ordering session notes and
    Wrap-Ups across a campaign. An unknown chapter sorts first; a Wrap-Up
    with no session number (a chapter's own Wrap-Up) sorts after the
    chapter's sessions."""
    ch = (chapter_of(rel, fm) or "").strip()
    m = re.fullmatch(r"(\d+(?:\.\d+)?)", ch) or _CHAPTER_NUM_RE.search(ch)
    n = parse_session_number(fm.get("session_number"))
    if n is None:
        n = session_ref_number(fm)
    return (float(m.group(1)) if m else -1.0,
            float(n) if n is not None else float("inf"))


def _blocks(body: str) -> list[tuple[int, str, list[str]]]:
    """(level, title, lines up to the next heading of that level or
    higher) for every heading outside code, gm-only marker lines left
    out."""
    lines = body.splitlines()
    heads = fenced_headings(body)
    out = []
    for n, (i, level, title) in enumerate(heads):
        end = next((j for j, lvl, _t in heads[n + 1:] if lvl <= level),
                   len(lines))
        out.append((level, title,
                    [ln for ln in lines[i + 1:end]
                     if not GM_MARKER_RE.fullmatch(ln.strip())]))
    return out


def _open_items(lines: list[str]) -> str:
    """The unchecked `- [ ]` items of a checklist, each with the indented
    lines that continue it."""
    out: list[str] = []
    keep = False
    for line in lines:
        if _CHECK_ANY_RE.match(line):
            keep = bool(_CHECK_OPEN_RE.match(line))
        elif not line.strip() or not line[:1].isspace():
            keep = False
        if keep:
            out.append(line)
    return "\n".join(out)


def carry_report(files, before: str | None) -> tuple[str | None, str]:
    """(error, report): what the Wrap-Up ahead of the session note `before`
    (vault-relative, `.md` optional, or its file name alone) carries
    forward: its Handoff, Unresolved Threads, Player-Stated Intentions,
    Pending Consequences and open Keeper Checklist items. With no
    `before`, the latest Wrap-Up's."""
    limit = (float("inf"), float("inf"))
    target_ck = None
    if before:
        want = before.strip().removesuffix(".md").casefold()
        hits = [(rel, fm) for rel, _t, fm in files
                if rel[:-3].casefold() == want]
        if not hits:
            hits = [(rel, fm) for rel, _t, fm in files
                    if Path(rel).stem.casefold() == want
                    and fm.get("type") == "session"]
        if len(hits) != 1:
            why = "matches no note" if not hits else "matches " + ", ".join(
                rel for rel, _fm in hits)
            return f"--before {before}: {why}", ""
        limit = campaign_order(*hits[0])
        target_ck = chapter_key(*hits[0])
    wraps = sorted(((campaign_order(rel, fm), rel, text, fm)
                    for rel, text, fm in files
                    if entity_type(fm) in WRAP_UP_TYPES
                    and not rel.startswith("_Templates/")),
                   key=lambda w: (w[0], w[1]))
    wraps = [w for w in wraps if w[0] < limit]
    # A chapter with no number cannot be ranked: stay inside the target's
    # own chapter, and say so when the choice is a guess across chapters.
    if limit[0] < 0 and target_ck is not None:
        wraps = [w for w in wraps
                 if chapter_key(w[1], w[3]) in (None, target_ck)]
    if not wraps:
        return None, "===== Carry =====\n(no earlier Wrap-Up)"
    _order, rel, text, fm = wraps[-1]
    canon = str(fm.get("canon_status") or "?")
    out = [f"===== Carry =====\n(source: {rel}, canon_status: {canon})"]
    if (before is None and wraps[-1][0][0] < 0
            and len({chapter_key(w[1], w[3]) for w in wraps}) > 1):
        out.append("Note: chapters have no number, so the latest Wrap-Up "
                   "is a guess by session number across chapters")
    if canon.upper() != "AUTHORITATIVE":
        out.append(f"Note: this Wrap-Up is not reviewed yet "
                   f"(canon_status: {canon})")
    blocks = _blocks(body_of(text))
    carries = next((b for b in blocks
                    if _heading_key(b[1]) == "what carries forward"), None)
    scoped = _blocks("\n".join(carries[2])) if carries else blocks
    for name, test in CARRY_PARTS:
        pool = blocks if name.startswith("Handoff") else scoped
        hit = next((b for b in pool
                    if b[0] >= 3 and test(_heading_key(b[1]))), None)
        body = "\n".join(hit[2]).strip() if hit else ""
        out.append(f"\n===== {hit[1] if hit else name} =====\n"
                   f"{body or '(none found)'}")
    checklist = next((b for b in blocks
                      if _heading_key(b[1]).startswith("keeper checklist")),
                     None)
    items = _open_items(checklist[2]) if checklist else ""
    out.append(f"\n===== Keeper Checklist (open items) =====\n"
               f"{items or '(none found)'}")
    return None, "\n".join(out)


def select_session(files, session_arg: int | None) -> tuple[dict | None, list[str]]:
    """Which session is "just played", and the warnings that go with it.

    Factored out of `main()` so `--play` and `--threads` share the exact
    #162 chapter-scoped resolution the default bundle uses, rather than
    a second copy of it silently drifting: `session_arg` is a bare
    session number ("just played" for the default bundle and
    `--threads`; `--play` derives its own target separately and calls
    this with `None` to learn only the *current* chapter).

    Returns (chosen, warnings): `chosen` is the session record (or None
    when the vault has no session indexes at all, or none match
    `session_arg`), and `warnings` are the "Note: ..." strings the header
    prints — in the same order `main()` always has, ambiguity notes
    first, then an `asOfSession` mismatch, then any pre-created
    unplayed-session indexes for this chapter.
    """
    sessions = []
    for rel, _text, fm in files:
        if fm.get("type") == "session":
            n = parse_session_number(fm.get("session_number"))
            if n is not None:
                sessions.append({
                    "rel": rel,
                    "fm": fm,
                    "n": n,
                    "chapter": chapter_key(rel, fm),
                    "chapter_label": chapter_of(rel, fm),
                    "played": str(fm.get("status", "")).casefold() in SESSION_PLAYED,
                    "date": str(fm.get("play_date") or ""),
                })
    played = [s for s in sessions if s["played"]]

    warnings: list[str] = []

    found = overview_of(files)
    overview_fm = found[2] if found else None
    overview_last = wikilink_target((overview_fm or {}).get("last_session"))

    def by_recency(entries):
        return max(entries, key=lambda s: (bool(s["date"]), s["date"], s["n"]))

    def resolve_ref(ref, pool):
        target = ref.casefold()
        exact = [s for s in pool if s["rel"][:-3].casefold() == target]
        if len(exact) == 1:
            return exact[0], None
        if len(exact) > 1:
            return None, "ambiguous"
        base = target.rsplit("/", 1)[-1]
        hits = [s for s in pool if stem_of(s) == base]
        if len(hits) == 1:
            return hits[0], None
        return None, ("ambiguous" if hits else "missing")

    chosen = None
    if session_arg is not None:
        matches = [s for s in sessions if s["n"] == session_arg]
        if matches:
            named = (resolve_ref(overview_last, matches)[0]
                     if overview_last else None)
            chosen = named or by_recency(matches)
            if len(matches) > 1:
                others = [s["chapter_label"] or s["rel"] for s in matches
                          if s is not chosen]
                warnings.append(
                    f"Note: {len(matches)} sessions are numbered "
                    f"{session_arg} (also in "
                    f"{', '.join(sorted(str(o) for o in others))}) — resolved "
                    f"to {chosen['chapter_label'] or chosen['rel']}.")
    elif overview_last:
        chosen, problem = resolve_ref(overview_last, sessions)
        if problem == "ambiguous":
            warnings.append(
                f"Note: campaign overview names last_session "
                f"'{overview_last}', which matches more than one session "
                f"file — falling back to the most recently played session. "
                f"Qualify the link with its folder to disambiguate.")
        elif problem == "missing":
            warnings.append(
                f"Note: campaign overview names last_session "
                f"'{overview_last}', which matches no session file — "
                f"falling back to the most recently played session.")
    if chosen is None and played:
        chosen = by_recency(played)
    elif chosen is None and sessions:
        chosen = by_recency(sessions)

    current = chosen["n"] if chosen else (session_arg or 0)
    chapter = chosen["chapter"] if chosen else None

    overview_as_of = str((overview_fm or {}).get("asOfSession") or "")
    if chosen and overview_as_of and chapter:
        as_of = overview_as_of.casefold()
        head = re.split(r"[,;]", chapter.split("/")[-1])[0].strip()
        if head and head not in as_of and not any(
                w in as_of for w in head.split() if len(w) > 3):
            warnings.append(
                f"Note: campaign overview reads asOfSession "
                f"'{overview_as_of}', but the selected session is in "
                f"'{chosen['chapter_label']}' — verify before trusting "
                f"this bundle.")

    if chosen:
        later = [s for s in sessions
                 if s["n"] > current and s["chapter"] == chapter]
        unplayed = sorted(s["n"] for s in later if not s["played"])
        played_later = sorted(s["n"] for s in later if s["played"])
        if unplayed:
            warnings.append(
                f"Note: session index(es) {unplayed} exist "
                f"with unplayed status — ignored for 'just played'.")
        if played_later:
            warnings.append(
                f"Note: session(s) {played_later} in this chapter are "
                f"numbered after the selected one and carry a played "
                f"status — the selection may be stale; verify before "
                f"trusting this bundle.")

    return chosen, warnings


def prefer_chapter(candidates, chapter):
    """The `chapter`'s own document among `candidates`, else an unfiled
    one.

    Accepting any unresolvable chapter equally let a document that merely
    sorted earlier — an archived copy at the vault root — outrank the
    chapter's real one. Scoped first, unscoped only as a fallback.
    """
    if chapter is not None:
        own = [c for c in candidates if chapter_key(c[0], c[2]) == chapter]
        if own:
            return (own[0][0], own[0][1])
    loose = [c for c in candidates
             if chapter is None or chapter_key(c[0], c[2]) is None]
    return (loose[0][0], loose[0][1]) if loose else None


def _find_plan(files, chapter, target: int):
    """The Session Plan for session `target`: a `type: session-plan`
    file naming it directly, chapter-preferred, else the session index's
    own `documents.plan` link resolved by filename stem."""
    plan = prefer_chapter(
        [(rel, text, fm) for rel, text, fm in files
         if fm.get("type") == "session-plan"
         and session_ref_number(fm) == target],
        chapter)
    if plan is not None:
        return plan
    idx = prefer_chapter(
        [(rel, text, fm) for rel, text, fm in files
         if fm.get("type") == "session"
         and parse_session_number(fm.get("session_number")) == target],
        chapter)
    if idx is None:
        return None
    plan_ref = nested_mapping(idx[1], "documents").get("plan")
    if not plan_ref:
        return None
    target_stem = wikilink_target(plan_ref).rsplit("/", 1)[-1].casefold()
    hits = [(rel, text) for rel, text, fm in files
            if Path(rel).stem.casefold() == target_stem]
    return hits[0] if len(hits) == 1 else None


SCRIPTS = Path(__file__).resolve().parent
# The note types a narrative plan names as participants or locations.
PLAN_NAME_TYPES = frozenset({"npc", "location", "faction", "creature"})


def run_script(script: str, *argv, title: str) -> str:
    """A sibling script's output under its own heading, stderr included
    and a failure said in one line, so the gather never stops part-way."""
    done = subprocess.run([sys.executable, str(SCRIPTS / script),
                           *map(str, argv)],
                          capture_output=True, text=True, check=False)
    out = (done.stdout + done.stderr).rstrip()
    if done.returncode:
        out += f"\n({script} exited {done.returncode})"
    return f"\n===== {title} =====\n{out or '(no output)'}"


def wrapup_names(files, wrap_text: str) -> list[str]:
    """The NPCs, locations, factions and creatures a Wrap-Up links, by
    note name, in the order first linked."""
    types = {normalize(rel.rsplit("/", 1)[-1][:-3]): entity_type(fm)
             for rel, _text, fm in files}
    names: list[str] = []
    for raw in re.findall(r"\[\[([^\]]+)\]\]", wrap_text):
        name = link_name(raw)
        if (types.get(normalize(name)) in PLAN_NAME_TYPES
                and name not in names):
            names.append(name)
    return names


def print_prep_rest(vault: Path, files, chosen, wrap, current: int,
                    chapter, upcoming: int, outlines: Outlines) -> None:
    """What `--prep` adds after the brief bundle."""
    status = str((chosen or {}).get("fm", {}).get("status") or "")
    if wrap and status == "wrap-up":
        print(run_script("reconcile_scan.py", vault, wrap[0],
                         title="Reconcile Scan"))
    else:
        print("\n===== Reconcile Scan =====\n(not run: the session's "
              f"status is {status or 'unknown'}, not wrap-up)")
    print(f"\n{thread_report(files, current, chapter, vault)}")
    print(f"\n{arcs_report(files, chapter, upcoming, vault, outlines)}")
    label = (chosen or {}).get("chapter_label")
    where = ("--chapter", label) if label else ()
    print(run_script("scene_queue.py", vault, *where, title="Scene Queue"))
    block = paused_snapshot_block(paused_scenes(vault, files),
                                  "===== Paused Scenes =====")
    if block:
        print(f"\n{block}")
    names = wrapup_names(files, wrap[1]) if wrap else []
    print(run_script("plans_index.py", vault, *where,
                     *(("--against", *names) if names else ()),
                     title="Narrative Plans"))


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path, help="the vault folder")
    ap.add_argument("--session", type=int,
                    help="just-played session number (default: highest); "
                         "with --play, the session whose Plan to print")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--play", action="store_true",
                      help="print only the upcoming (or --session) Play Brief")
    mode.add_argument("--threads", action="store_true",
                      help="print the Session Context header and Threads "
                           "report only: each active PC's Open threads aged "
                           "against the Wrap-Ups' Unresolved Threads and "
                           "PC Carry-Forward bullets, "
                           "age=N sessions since last touched, STALE at "
                           "the vault's stale-after number "
                           "(vault.stale_after_sessions; a candidate, not a "
                           "verdict — resolve, advance, or retire is the "
                           "GM's call). A thread read as first~N age~N (~ instead "
                           "of =) is a likely match by shared names and "
                           "words, not the same text: check it")
    mode.add_argument(
        "--arcs", action="store_true",
        help="print the Session Context header and the PC Arcs report "
             "only: each active PC's ## Background and ## GM Notes "
             "sections (the durable arc material the bundle does not "
             "carry — ## Current Status is already in the bundle and is "
             "not repeated) plus a chapter-scoped spotlight history "
             "parsed from every earlier Plan's ## Spotlight Forecast "
             "table (role A/B/C from the row text) with sessions since the PC last carried the "
             "B- and C-plot. A forecast section is one of three states: "
             "absent, present but prose (listed once for direct reading "
             "— no per-PC row, and not counted in the 'plans read' "
             "denominator), or a table. Arc stage is not a field: judge "
             "it against the five-stage model from this evidence.")
    mode.add_argument(
        "--prep", action="store_true",
        help="a prep run's opening read in one call: the version verdict, "
             "the --brief bundle, the reconcile scan (status wrap-up only), "
             "--threads, --arcs, the chapter's scene queue and its "
             "narrative plans checked against the NPCs, locations and "
             "factions the Wrap-Up links")
    mode.add_argument(
        "--carry", action="store_true",
        help="print only what the previous Wrap-Up carries forward: its "
             "Handoff to session-prep, Unresolved Threads, Player-Stated "
             "Intentions, Pending Consequences and open Keeper Checklist "
             "items. Runs on a vault kept by a player too.")
    ap.add_argument(
        "--before", metavar="INDEX",
        help="with --carry: the session being wrapped (its index, "
             "vault-relative); the Wrap-Up read is the one before it in "
             "chapter and session order. Default: the latest Wrap-Up.")
    ap.add_argument(
        "--brief", action="store_true",
        help="default mode only: Wrap-Up with the reconcile-provenance "
             "blocks stubbed (Memorable Moments; Name Conflicts, "
             "Cross-Entity Claims, World Fact Findings, Quality Notes — "
             "heading kept, body replaced by a "
             "one-line stub with its word count), and the Campaign "
             "Overview and the existing Session Plan each as frontmatter "
             "plus a heading outline with word counts. Everything else "
             "unchanged. Drill into a file only where a stub or outline "
             "shows the need — for the Plan that means "
             "`gma plan-check` with `--inventory` or `--state`, not a full read.")
    ap.epilog = 'Example: gma session-context "<vault>" --prep'
    return ap


def main(argv: list[str] | None = None) -> int:
    # Settings that cannot be read end in one `error:` line and exit 2,
    # the same whether run directly or through `gma`.
    return report_unreadable_settings(lambda: _main(argv))


def _main(argv: list[str] | None) -> int:
    outlines = Outlines()
    code = _bundle(argv, outlines)
    if outlines.used and code == 0:
        print("\n" + FETCH_LINE)
    return code


def _bundle(argv: list[str] | None, outlines: Outlines) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.brief and (args.play or args.threads or args.arcs
                       or args.prep):
        print("error: --brief applies to the default bundle only",
              file=sys.stderr)
        return 2
    if args.before and not args.carry:
        print("error: --before applies to --carry only", file=sys.stderr)
        return 2
    if args.prep:
        args.brief = True
        print(run_script("vault_check.py", args.vault, "version",
                         title="Version"))
    if args.carry and (args.brief or args.session is not None):
        print("error: --carry takes --before, not --brief or --session",
              file=sys.stderr)
        return 2
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2

    # session-wrapup reads the carry on any vault, a player's included.
    if args.carry:
        files = list(vault_files(args.vault))
        error, report = carry_report(files, args.before)
        if error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        print(report)
        block = paused_line_block(
            paused_scenes(args.vault, files),
            "===== Paused Scenes =====")
        if block:
            print(f"\n{block}")
        return 0

    # Session prep is the GM's job; a vault kept by a player has none.
    if setting_or_builtin(args.vault, "vault.kept_by") == "player":
        print("This vault is kept by a player (vault.kept_by: player), so "
              "there is no session prep to gather.")
        return 0

    files = list(vault_files(args.vault))
    outlines.files = files

    if args.play:
        # --session names the plan directly here, not "just played" — the
        # current/chapter context still comes from select_session so the
        # lookup prefers the campaign's own chapter over an unfiled plan.
        current_chosen, _warnings = select_session(files, None)
        current = current_chosen["n"] if current_chosen else 0
        chapter = current_chosen["chapter"] if current_chosen else None
        target = args.session if args.session is not None else current + 1
        if args.session is not None:
            # An explicit --session N names a specific session, which may
            # be filed under a different chapter than "current" — session
            # numbering restarts per chapter, so resolving the chapter
            # from the current session made a plan for N under another
            # chapter unfindable (#M13). Prefer N's own copy under the
            # current chapter (still handles the common, unambiguous
            # case) and fall back to wherever else it's filed.
            same_number = [(rel, text, fm) for rel, text, fm in files
                          if fm.get("type") == "session"
                          and parse_session_number(fm.get("session_number"))
                          == target]
            own = next((s for s in same_number
                       if chapter_key(s[0], s[2]) == chapter), None)
            target_session = own or (same_number[0] if same_number else None)
            if target_session is not None:
                chapter = chapter_key(target_session[0], target_session[2])
        plan = _find_plan(files, chapter, target)
        if plan is None:
            print(f"(no plan for session {target})")
            block = paused_snapshot_block(
                paused_scenes(args.vault, files), "## Paused Scenes")
        else:
            print(play_brief(files, plan[0], plan[1]))
            pointed = plan_pointers(plan[1])
            block = paused_line_block(
                [p for p in paused_scenes(args.vault, files)
                 if not is_pointed_at(p.rel, pointed)],
                "## Paused, not in this Plan")
        if block:
            print(f"\n{block}")
        return 0

    chosen, warnings = select_session(files, args.session)
    current = chosen["n"] if chosen else (args.session or 0)
    chapter = chosen["chapter"] if chosen else None
    upcoming = current + 1

    if chosen:
        note = "".join(f"\n{w}" for w in warnings)
        where = (f", chapter: {chosen['chapter_label']}"
                 if chosen["chapter_label"] else "")
        print(f"===== Session Context =====\n"
              f"Just played: session {current} ({chosen['rel']}, "
              f"status: {chosen['fm'].get('status', '?')}{where})\n"
              f"Preparing: session {upcoming}{note}")
    else:
        print(f"===== Session Context =====\n"
              f"No session indexes found"
              f"{f'; using --session {current}' if args.session is not None else ''}. "
              f"Preparing session {upcoming}.")

    if args.brief:
        print("(brief: Wrap-Up provenance blocks stubbed, Campaign Overview "
              "and existing Plan outlined — see --help)")

    if args.threads:
        print(f"\n{thread_report(files, current, chapter, args.vault)}")
        return 0

    if args.arcs:
        print(f"\n{arcs_report(files, chapter, upcoming, args.vault, outlines)}")
        return 0

    # --- latest wrap-up ---
    # Scoped to the chapter as well as the number: the wrap-up and plan lookups
    # carried the same flat-namespace assumption as the selection above, so in a
    # vault where numbering restarts they could pair the right number with the
    # wrong chapter's documents. An unknown chapter on either side matches, which
    # keeps flat vaults working exactly as before.
    wrap = prefer_chapter(
        [(rel, text, fm) for rel, text, fm in files
         if entity_type(fm) in WRAP_UP_TYPES
         and session_ref_number(fm) == current],
        chapter)
    if wrap is None:
        # Fallback: filename convention Chapter_CC_Session_NN_Wrap_Up.md
        pat = re.compile(rf"Session[ _-]0*{current}[ _-].*Wrap[ _-]?Up",
                         re.IGNORECASE)
        wrap = prefer_chapter([(rel, text, fm) for rel, text, fm in files
                               if pat.search(rel)], chapter)
    wrap_content = body_of(wrap[1]) if wrap else None
    if args.brief and wrap_content is not None:
        wrap_content = brief_wrapup(wrap_content)
    emit(f"Wrap-Up — Session {current}",
         wrap[0] if wrap else None,
         wrap_content)

    # --- active PCs: frontmatter line + Current Status block ---
    print("\n===== Active PCs =====")
    not_playing = out_of_play(args.vault)
    found_pc = False
    for rel, text, fm in files:
        if not is_active_pc(rel, fm, not_playing):
            continue
        found_pc = True
        as_of = fm.get("asOfSession", "?")
        print(f"\n--- {Path(rel).stem} ({rel}, asOfSession: {as_of}) ---")
        status_block = section(text, "Current Status")
        print(outlines.layered(status_block, args.vault, rel, "Current Status",
                         text)
              if status_block else "(no ## Current Status block)")
    if not found_pc:
        print("(no active PC entities found)")

    # --- existing plan for the upcoming session ---
    plan = prefer_chapter(
        [(rel, text, fm) for rel, text, fm in files
         if fm.get("type") == "session-plan"
         and session_ref_number(fm) == upcoming],
        chapter)
    if args.brief and plan:
        # Step 6 inspects the existing Plan through
        # `gma plan-check` with `--inventory` or `--state`, so the bundle only has to
        # say the Plan exists and what shape it is in — printing it whole
        # made it the third-biggest section of the read-set.
        emit(f"Existing Plan — Session {upcoming} (outline)", plan[0],
             raw_frontmatter(plan[1]) + "\n\n" + outline(body_of(plan[1])))
    else:
        emit(f"Existing Plan — Session {upcoming}",
             plan[0] if plan else None,
             body_of(plan[1]) if plan else None)

    # --- deferred world flags ---
    flags = next(((rel, text) for rel, text, fm in files
                  if rel.endswith("_flags.md")), None)
    emit("World Flags — Deferred",
         flags[0] if flags else None,
         section(flags[1], "Deferred") if flags else None)

    # --- campaign overview ---
    found = overview_of(files)
    overview = found[:2] if found else None
    if args.brief and overview:
        rel, text = overview
        emit("Campaign Overview (outline)", rel,
             raw_frontmatter(text) + "\n\n" + outline(body_of(text)))
    else:
        emit("Campaign Overview",
             overview[0] if overview else None,
             body_of(overview[1]) if overview else None)
    if args.prep:
        print_prep_rest(args.vault, files, chosen, wrap, current, chapter,
                        upcoming, outlines)
    return 0


if __name__ == "__main__":
    sys.exit(main())

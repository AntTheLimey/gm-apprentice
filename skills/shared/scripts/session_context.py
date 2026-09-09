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
  session_context.py VAULT --arcs

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

`--brief` shrinks the default bundle's two biggest sections: the
Wrap-Up's reconcile-provenance GM Notes blocks are stubbed to a
one-line word count each, and the Campaign Overview prints as
frontmatter plus a heading outline instead of its full body.

`--arcs` replaces the default bundle with each active PC's durable
arc material instead: `## Background` and `## GM Notes` (the
bundle's `## Current Status` block is not repeated), plus a
chapter-scoped spotlight history built from every earlier Plan's
`## Spotlight Forecast` table, with sessions since the PC last
carried the B- and C-plot.
"""

from __future__ import annotations

import argparse
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

from schema_rules import (chapter_key, chapter_of, extract_frontmatter,
                          parse_session_number, wikilink_target)
from vaultlib import (PC_INACTIVE_STATUS, SKIP_DIRS,  # noqa: F401
                      WRAP_UP_TYPES, body_of, entity_type, h3_blocks,
                      nested_mapping, raw_frontmatter, section, word_count)
from vaultlib import vault_files as _vault_files


def vault_files(vault: Path):
    """vaultlib.vault_files, with the frontmatter dict every caller here
    wants — parsed once per file rather than at each use site."""
    for rel, text in _vault_files(vault):
        yield rel, text, extract_frontmatter(text) or {}


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

_LABEL_RE = re.compile(r"^\*\*([^*:]+):\*\*")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.+)$")


def _labelled_block(text: str, label: str) -> str | None:
    """The `**label:** ...` line and any following lines, up to the next
    `**Other:**` label line or the end of `text`. None if `label` is
    absent. Used for both a Session Plan scene's `**Type:**` /
    `**Objective:**` / `**Setup:**` / `**Trigger:**` fields and a PC's
    `**Open threads:**` block — both are "a bold label, then prose or
    bullets, until the next bold label" in shape."""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        m = _LABEL_RE.match(line.strip())
        if m and m.group(1).strip().casefold() == label.casefold():
            start = i
            break
    if start is None:
        return None
    collected = [lines[start]]
    for line in lines[start + 1:]:
        if _LABEL_RE.match(line.strip()):
            break
        collected.append(line)
    return "\n".join(collected).strip()


def _bullets(text: str) -> list[str]:
    """`- item` / `* item` line text, in document order, any indentation."""
    out = []
    for line in text.splitlines():
        m = _BULLET_RE.match(line)
        if m:
            out.append(m.group(1).strip())
    return out


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

# H2 blocks --brief stubs outright, and H3 blocks it stubs by title prefix
# (the template's Name Conflicts heading carries a parenthetical, so an
# exact match would miss it).
BRIEF_DROP_H2: tuple[str, ...] = ("Memorable Moments",)
BRIEF_DROP_H3: tuple[str, ...] = (
    "Name Conflicts", "Cross-Entity Claims", "World Fact Findings",
    "Quality Notes", "Reconciliation Context")

_H2_HEADING_RE = re.compile(r"^## (.+)$")
_H3_HEADING_RE = re.compile(r"^### (.+)$")
_ANY_HEADING_RE = re.compile(r"^(#{1,6})\s")
_GM_MARKER_RE = re.compile(r"^<!--\s*/?gm-only\s*-->\s*$")


def brief_wrapup(body: str) -> str:
    """`body` with each BRIEF_DROP_H2 `## ` block and each BRIEF_DROP_H3
    `### ` block replaced by its heading line plus one stub line:
    `(omitted in --brief: N words — read the Wrap-Up file for it)`.
    H3 titles match on prefix (the template's Name Conflicts heading has
    a parenthetical). A block ends at the next heading of the same or
    higher level, at a `<!-- gm-only -->` or `<!-- /gm-only -->` line, or
    EOF — either marker is a terminator, not just the closer, because the
    template opens the fence right after ## Memorable Moments' own
    content and a terminator that only recognised the closer would eat
    the opening marker into the dropped block. The terminator line itself
    is never consumed, so it survives in the output. A blank line follows
    the stub, separating it from whatever comes next, unless that next
    line is already blank."""
    lines = body.splitlines()
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        level: int | None = None
        m2 = _H2_HEADING_RE.match(line)
        if m2 and m2.group(1).strip() in BRIEF_DROP_H2:
            level = 2
        else:
            m3 = _H3_HEADING_RE.match(line)
            if m3 and any(m3.group(1).strip().startswith(p)
                          for p in BRIEF_DROP_H3):
                level = 3
        if level is None:
            out.append(line)
            i += 1
            continue
        out.append(line)
        j = i + 1
        collected: list[str] = []
        while j < n:
            hm = _ANY_HEADING_RE.match(lines[j])
            if hm and len(hm.group(1)) <= level:
                break
            if _GM_MARKER_RE.match(lines[j].strip()):
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
    """One line per heading (`#`, `##`, `###`) in document order:
    `{heading line}  ({N} words)` — N = word count of the text between
    this heading and the next heading of any level. Headings inside
    fenced code are skipped (toggle on a line starting with ```)."""
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
    for idx, (line_i, level, heading_line) in enumerate(heads):
        if level > 3:
            continue
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


def play_brief(files, plan_rel: str, plan_text: str) -> str:
    """The Play Brief for one Session Plan: scene titles, their
    Type/Objective/Setup, the NPC table, World State, Contingency
    triggers, and End Objectives — everything else (Active Threads,
    GM Notes, Behaviours/Branching/Complications) dropped, because the
    table doesn't need it and the Keeper is already holding the full
    Plan if they do.

    `files` is accepted for interface symmetry with `thread_report` but
    unused: a Session Plan's own `session:` frontmatter is always enough
    to name it.
    """
    del files
    fm = extract_frontmatter(plan_text) or {}
    n = session_ref_number(fm)
    parts = [f"===== Play Brief — Session {n if n is not None else '?'} =====\n"
             f"(source: {plan_rel})"]

    def verbatim(title: str) -> str:
        body = section(plan_text, title)
        return f"## {title}\n{body if body else f'(no ## {title})'}"

    parts.append(verbatim("Session Intent"))

    def reduced_scenes(section_title: str, labels: tuple[str, ...]) -> str:
        body = section(plan_text, section_title)
        blocks = h3_blocks(body) if body is not None else []
        if not blocks:
            return f"## {section_title}\n(no ## {section_title})"
        rendered = []
        for title, scene_body in blocks:
            piece = [f"### {title}"]
            for label in labels:
                block = _labelled_block(scene_body, label)
                if block:
                    piece.append(block)
            rendered.append("\n".join(piece))
        return f"## {section_title}\n" + "\n\n".join(rendered)

    parts.append(reduced_scenes("Planned Scenes", ("Type", "Objective", "Setup")))
    parts.append(verbatim("NPC Quick Reference"))
    parts.append(verbatim("World State"))
    parts.append(reduced_scenes("Contingency Scenes", ("Trigger",)))
    parts.append(verbatim("Session End Objectives"))

    return "\n\n".join(parts)


def thread_report(files, current: int, chapter) -> str:
    """Per-PC Open-threads ages against Wrap-Up Unresolved Threads / PC
    Carry-Forward bullets, plus wrap-up bullets that never made it onto
    any PC sheet (thread-decay candidates).

    Wrap-ups are scoped to `chapter` the same way the rest of this file
    is (#162): a wrap-up filed under a different, resolvable chapter is
    excluded, but one with no resolvable chapter of its own still counts
    — a flat vault, or a legacy unfiled record, should not silently lose
    its threads.
    """
    lines = ["===== Threads ====="]

    def in_scope(rel: str, fm) -> bool:
        if chapter is None:
            return True
        ck = chapter_key(rel, fm)
        return ck is None or ck == chapter

    # (session, unresolved bullets, carry-forward bullets) per wrap-up.
    wrap_ups: list[tuple[int, list[str], list[str]]] = []
    for rel, text, fm in files:
        if entity_type(fm) not in WRAP_UP_TYPES or not in_scope(rel, fm):
            continue
        n = session_ref_number(fm)
        if n is None:
            continue
        unresolved_block = _heading_block(text, 4, "Unresolved Threads")
        carry_block = _heading_block(text, 3, "PC Carry-Forward")
        unresolved = _bullets(unresolved_block) if unresolved_block else []
        carry = _bullets(carry_block) if carry_block else []
        wrap_ups.append((n, unresolved, carry))

    pcs = [(rel, text) for rel, text, fm in files
           if fm.get("type") == "pc" and not rel.endswith("_Story.md")
           and str(fm.get("status", "")).casefold() not in PC_INACTIVE_STATUS]

    # Unresolved bullets a PC thread actually matched, keyed by (session,
    # bullet text) — everything else is reported as an orphan below.
    matched: set[tuple[int, str]] = set()

    if not pcs:
        lines.append("(no active PC entities found)")
    for rel, text in pcs:
        lines.append(f"--- {Path(rel).stem} ---")
        status_block = section(text, "Current Status") or ""
        threads_block = _labelled_block(status_block, "Open threads")
        thread_bullets = _bullets(threads_block) if threads_block else []
        if not thread_bullets:
            lines.append("(no ## Current Status Open threads)")
            continue
        for thread in thread_bullets:
            norm = _norm_thread(thread)
            hits: list[int] = []
            for n, unresolved, carry in wrap_ups:
                for bullet in unresolved + carry:
                    if SequenceMatcher(None, norm,
                                      _norm_thread(bullet)).ratio() >= 0.6:
                        hits.append(n)
                        if bullet in unresolved:
                            matched.add((n, bullet))
                        break
            if hits:
                first, last = min(hits), max(hits)
                age = current - last
                stale = "STALE" if age >= 3 else ""
                lines.append(f"{thread}\tfirst={first}\tlast={last}\t"
                             f"age={age}\t{stale}")
            else:
                lines.append(
                    f"{thread}\tfirst=?\tlast=?\tage=?\t"
                    f"(not in any wrap-up — check it is still live)")

    lines.append("--- Wrap-up threads not on any PC sheet ---")
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
_SHARE_RE = re.compile(r"~?(\d+%)")


def spotlight_rows(plan_body: str) -> list[tuple[str, str, str]] | None:
    """(pc_cell, role, share) per data row of the first table under
    `## Spotlight Forecast`; None when the section is absent. Only the
    first `|`-delimited table is read: collection starts at the first
    `|` line and stops at the first non-`|` line seen after that (a
    blank line or prose ends the table), so a second table later in
    the same section is never ingested. pc_cell = first cell with
    `**`, `[[`, `]]` removed and a trailing `(...)` dropped, stripped.
    role = "B" if "b-plot" in the row (casefold) else "C" if "c-plot"
    else "A" if "a-plot" else "-". share = first `~?\\d+%` in the row
    without the tilde, else "?". Header and separator rows skipped."""
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
    rows: list[tuple[str, str, str]] = []
    for line in table_lines[1:]:  # skip header row
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and all(_SEPARATOR_CELL_RE.match(c) for c in cells if c):
            continue  # separator row
        if not cells or not cells[0]:
            continue
        first = cells[0].replace("**", "").replace("[[", "").replace("]]", "")
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
        m = _SHARE_RE.search(line)
        share = m.group(1) if m else "?"
        rows.append((first, role, share))
    return rows


def pc_matches(cell: str, rel: str, fm: dict) -> bool:
    """cell.casefold() equals the file stem with `_`→space, or the stem's
    first token, or any entry of fm["aliases"] (list, or a single
    string), all casefolded."""
    stem = Path(rel).stem.replace("_", " ")
    tokens = stem.split()
    candidates = {stem.casefold()}
    # First-token matching is intentional and can match two PCs who share a
    # first name — the report lists the PC's file path so the reader can tell.
    if tokens:
        candidates.add(tokens[0].casefold())
    aliases = fm.get("aliases")
    if isinstance(aliases, str):
        aliases = [aliases]
    if isinstance(aliases, list):
        candidates.update(str(a).casefold() for a in aliases)
    return cell.casefold() in candidates


def arcs_report(files, chapter, upcoming: int) -> str:
    """For each active PC (type pc, not *_Story.md, status not in
    PC_INACTIVE_STATUS):
      --- {stem} ({rel}, player: {player_name or ?}) ---
      ## Background
      {section or "(no ## Background section)"}
      ## GM Notes
      {section or "(no ## GM Notes section)"}
      Spotlight history (chapter-scoped, from ## Spotlight Forecast tables):
        Session 6: B (30%)
        Session 7: (no row for this PC)
      Sessions since last B-plot: 2 (Session 6)     or  never (in N plans read)
      Sessions since last C-plot: never (in 2 plans read)
    Then once: `Plans without a ## Spotlight Forecast: Session 5` (or
    `(none)`). Plans = every type: session-plan with a parsable session
    number < upcoming, prefer_chapter semantics, sorted by number.
    "Sessions since" = upcoming - N."""
    lines = [f"===== PC Arcs — Sessions before {upcoming} ====="]

    plan_files = [(rel, text, fm) for rel, text, fm in files
                  if fm.get("type") == "session-plan"]
    numbers = sorted({n for rel, text, fm in plan_files
                      if (n := session_ref_number(fm)) is not None
                      and n < upcoming})

    plans: list[tuple[int, list[tuple[str, str, str]] | None]] = []
    for n in numbers:
        candidates = [c for c in plan_files if session_ref_number(c[2]) == n]
        picked = prefer_chapter(candidates, chapter)
        if picked is None:
            continue
        plans.append((n, spotlight_rows(picked[1])))

    tables = [(n, rows) for n, rows in plans if rows is not None]
    no_table = [n for n, rows in plans if rows is None]

    pcs = [(rel, text, fm) for rel, text, fm in files
           if fm.get("type") == "pc" and not rel.endswith("_Story.md")
           and str(fm.get("status", "")).casefold() not in PC_INACTIVE_STATUS]

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
        lines.append(bg if bg else "(no ## Background section)")
        gm = section(text, "GM Notes")
        lines.append("## GM Notes")
        lines.append(gm if gm else "(no ## GM Notes section)")
        lines.append("Spotlight history (chapter-scoped, from "
                     "## Spotlight Forecast tables):")
        last_b: int | None = None
        last_c: int | None = None
        for n, rows in tables:
            match = next((r for r in rows if pc_matches(r[0], rel, fm)), None)
            if match is None:
                lines.append(f"  Session {n}: (no row for this PC)")
                continue
            role, share = match[1], match[2]
            lines.append(f"  Session {n}: {role} ({share})")
            if role == "B":
                last_b = n
            elif role == "C":
                last_c = n
        lines.append(since(last_b, "B"))
        lines.append(since(last_c, "C"))

    lines.append("")
    if no_table:
        lines.append("Plans without a ## Spotlight Forecast: "
                     + ", ".join(f"Session {n}" for n in no_table))
    else:
        lines.append("Plans without a ## Spotlight Forecast: (none)")

    return "\n".join(lines)


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
    PLAYED = {"played", "wrap-up", "reviewed"}
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
                    "played": str(fm.get("status", "")).casefold() in PLAYED,
                    "date": str(fm.get("play_date") or ""),
                })
    played = [s for s in sessions if s["played"]]

    warnings: list[str] = []

    overview_fm = next((fm for rel, _t, fm in files
                        if fm.get("type") == "campaign_overview"), None)
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


def session_ref_number(fm: dict) -> int | None:
    """The session number named by `fm["session"]`.

    A `session:` value written as a wikilink ("[[Session 05]]") reaches
    us as a one-item list of bracket-stripped text, not a string — the
    frontmatter reader treats the quoted outer `[...]` as a YAML flow
    sequence (see `wikilink_target`'s docstring), and `parse_session_number`
    returns None outright for any list. `wikilink_target` unwraps that
    case to plain text first; a bare int or string session value passes
    through it unchanged. Since migration 1.9.5 the quoted wikilink is
    the canonical `session:` form, so every `session:` lookup in this
    file goes through here rather than calling `parse_session_number`
    directly on the raw value.
    """
    return parse_session_number(wikilink_target(fm.get("session")))


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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
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
                           "age >= 3 (a candidate, not a verdict — resolve, "
                           "advance, or retire is the GM's call)")
    mode.add_argument(
        "--arcs", action="store_true",
        help="print the Session Context header and the PC Arcs report "
             "only: each active PC's ## Background and ## GM Notes "
             "sections (the durable arc material the bundle does not "
             "carry — ## Current Status is already in the bundle and is "
             "not repeated) plus a chapter-scoped spotlight history "
             "parsed from every earlier Plan's ## Spotlight Forecast "
             "table (role A/B/C from the row text, share from the first "
             "percentage) with sessions since the PC last carried the "
             "B- and C-plot. Arc stage is not a field: judge it against "
             "the five-stage model from this evidence.")
    ap.add_argument(
        "--brief", action="store_true",
        help="default mode only: Wrap-Up with the reconcile-provenance "
             "blocks stubbed (Memorable Moments; Name Conflicts, "
             "Cross-Entity Claims, World Fact Findings, Quality Notes, "
             "Reconciliation Context — heading kept, body replaced by a "
             "one-line stub with its word count) and the Campaign Overview "
             "as frontmatter plus a heading outline with word counts. "
             "Everything else unchanged. Drill into a file only where a "
             "stub or outline shows the need.")
    args = ap.parse_args()
    if args.brief and (args.play or args.threads or args.arcs):
        print("error: --brief applies to the default bundle only",
              file=sys.stderr)
        return 2
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2

    files = list(vault_files(args.vault))

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
        else:
            print(play_brief(files, plan[0], plan[1]))
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
              "outlined — see --help)")

    if args.threads:
        print(f"\n{thread_report(files, current, chapter)}")
        return 0

    if args.arcs:
        print(f"\n{arcs_report(files, chapter, upcoming)}")
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
    found_pc = False
    for rel, text, fm in files:
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if str(fm.get("status", "")).casefold() in PC_INACTIVE_STATUS:
            continue
        found_pc = True
        as_of = fm.get("asOfSession", "?")
        print(f"\n--- {Path(rel).stem} ({rel}, asOfSession: {as_of}) ---")
        status_block = section(text, "Current Status")
        print(status_block if status_block
              else "(no ## Current Status block)")
    if not found_pc:
        print("(no active PC entities found)")

    # --- existing plan for the upcoming session ---
    plan = prefer_chapter(
        [(rel, text, fm) for rel, text, fm in files
         if fm.get("type") == "session-plan"
         and session_ref_number(fm) == upcoming],
        chapter)
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
    overview = next(((rel, text) for rel, text, fm in files
                     if fm.get("type") == "campaign_overview"), None)
    if args.brief and overview:
        rel, text = overview
        emit("Campaign Overview (outline)", rel,
             raw_frontmatter(text) + "\n\n" + outline(body_of(text)))
    else:
        emit("Campaign Overview",
             overview[0] if overview else None,
             body_of(overview[1]) if overview else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())

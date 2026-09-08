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
reported, not fatal.
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
                      nested_mapping, section)
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
    n = parse_session_number(fm.get("session"))
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
        n = parse_session_number(fm.get("session"))
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
        pending = sorted(s["n"] for s in sessions
                         if s["n"] > current and s["chapter"] == chapter)
        if pending:
            warnings.append(
                f"Note: session index(es) {pending} exist "
                f"with unplayed status — ignored for 'just played'.")

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
         and parse_session_number(fm.get("session")) == target],
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
                      help="print the Session Context header and Threads report only")
    args = ap.parse_args()
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

    if args.threads:
        print(f"\n{thread_report(files, current, chapter)}")
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
         and parse_session_number(fm.get("session")) == current],
        chapter)
    if wrap is None:
        # Fallback: filename convention Chapter_CC_Session_NN_Wrap_Up.md
        pat = re.compile(rf"Session[ _-]0*{current}[ _-].*Wrap[ _-]?Up",
                         re.IGNORECASE)
        wrap = prefer_chapter([(rel, text, fm) for rel, text, fm in files
                               if pat.search(rel)], chapter)
    emit(f"Wrap-Up — Session {current}",
         wrap[0] if wrap else None,
         body_of(wrap[1]) if wrap else None)

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
         and parse_session_number(fm.get("session")) == upcoming],
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
    emit("Campaign Overview",
         overview[0] if overview else None,
         body_of(overview[1]) if overview else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())

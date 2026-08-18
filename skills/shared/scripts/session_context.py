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

import argparse
import re
import sys
from pathlib import Path

from schema_rules import (chapter_key, chapter_of, extract_frontmatter,
                          parse_session_number, wikilink_target)

SKIP_DIRS = {"_Templates", "_templates", "_inbox"}


def vault_files(vault: Path):
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        parts = rel.split("/")
        if any(p.startswith(".") for p in parts) or parts[0] in SKIP_DIRS:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        yield rel, text, extract_frontmatter(text) or {}


def stem_of(entry) -> str:
    """Filename stem of a session record, casefolded, for ref matching."""
    return entry["rel"].rsplit("/", 1)[-1][:-3].casefold()


def section(text: str, heading: str) -> str | None:
    """Extract a `## Heading` block up to the next same-level heading."""
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)",
                  text, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else None


def body_of(text: str) -> str:
    m = re.match(r"^---\r?\n.*?\r?\n---\r?\n?(.*)$", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def emit(title: str, source: str | None, content: str | None):
    print(f"\n===== {title} =====")
    if source:
        print(f"(source: {source})")
    print(content if content else "(none found)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("--session", type=int,
                    help="just-played session number (default: highest)")
    args = ap.parse_args()
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2

    files = list(vault_files(args.vault))

    # --- current session from session indexes ---
    # "Just played" means a session that actually happened: prep for
    # the NEXT session creates its index early with status `planned`
    # or `prepped`, and that pre-created index must not shift the
    # bundle forward a session.
    PLAYED = {"played", "wrap-up", "reviewed"}
    # A session is identified by (chapter, number), never by number alone:
    # two chapters each having a Session 07 is normal, and keying on the bare
    # integer let whichever was walked last silently win (#162).
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

    warnings = []

    # The campaign overview states where the campaign actually stands, and it
    # is the only vault-wide source that carries the chapter. Prefer it over
    # any heuristic; fall back only when it is absent or does not resolve.
    overview_fm = next((fm for rel, _t, fm in files
                        if fm.get("type") == "campaign_overview"), None)
    overview_last = wikilink_target((overview_fm or {}).get("last_session"))

    def by_recency(entries):
        # Most recently *played* wins, which is chapter-agnostic and therefore
        # correct across a chapter restart. A vault with no play_date at all
        # falls back to the highest number, which is the old single-chapter
        # behaviour and right for a flat vault.
        return max(entries, key=lambda s: (bool(s["date"]), s["date"], s["n"]))

    chosen = None
    if args.session is not None:
        matches = [s for s in sessions if s["n"] == args.session]
        if matches:
            named = next((s for s in matches if overview_last and stem_of(s)
                          == overview_last.casefold()), None)
            chosen = named or by_recency(matches)
            if len(matches) > 1:
                others = [s["chapter_label"] or s["rel"] for s in matches
                          if s is not chosen]
                warnings.append(
                    f"Note: {len(matches)} sessions are numbered "
                    f"{args.session} (also in "
                    f"{', '.join(sorted(str(o) for o in others))}) — resolved "
                    f"to {chosen['chapter_label'] or chosen['rel']}.")
    elif overview_last:
        target = overview_last.casefold()
        chosen = next((s for s in sessions if stem_of(s) == target), None)
        if chosen is None:
            warnings.append(
                f"Note: campaign overview names last_session "
                f"'{overview_last}', which matches no session file — "
                f"falling back to the most recently played session.")
    if chosen is None and played:
        chosen = by_recency(played)
    elif chosen is None and sessions:
        chosen = by_recency(sessions)

    current = chosen["n"] if chosen else (args.session or 0)
    chapter = chosen["chapter"] if chosen else None
    upcoming = current + 1

    # A wrong bundle is worse than no bundle, because it reads as authoritative.
    overview_as_of = str((overview_fm or {}).get("asOfSession") or "")
    if chosen and overview_as_of and chapter:
        # asOfSession is prose ("Chapter 4, Session 7"), so containment on the
        # chapter's distinctive words is the most it can support.
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
        note = "".join(f"\n{w}" for w in warnings)
        # Only sessions in the SAME chapter can be "later" — a higher number in
        # a finished chapter is history, not a pre-created index.
        pending = sorted(s["n"] for s in sessions
                         if s["n"] > current and s["chapter"] == chapter)
        if pending:
            note += (f"\nNote: session index(es) {pending} exist "
                     f"with unplayed status — ignored for 'just played'.")
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

    # --- latest wrap-up ---
    # Scoped to the chapter as well as the number: the wrap-up and plan lookups
    # carried the same flat-namespace assumption as the selection above, so in a
    # vault where numbering restarts they could pair the right number with the
    # wrong chapter's documents. An unknown chapter on either side matches, which
    # keeps flat vaults working exactly as before.
    def in_chapter(rel, fm):
        other = chapter_key(rel, fm)
        return chapter is None or other is None or other == chapter

    wrap = next(
        ((rel, text) for rel, text, fm in files
         if fm.get("type") in ("session-wrap-up", "session_wrap")
         and parse_session_number(fm.get("session")) == current
         and in_chapter(rel, fm)),
        None)
    if wrap is None:
        # Fallback: filename convention Chapter_CC_Session_NN_Wrap_Up.md
        pat = re.compile(rf"Session[ _-]0*{current}[ _-].*Wrap[ _-]?Up",
                         re.IGNORECASE)
        wrap = next(((rel, text) for rel, text, fm in files
                     if pat.search(rel) and in_chapter(rel, fm)), None)
    emit(f"Wrap-Up — Session {current}",
         wrap[0] if wrap else None,
         body_of(wrap[1]) if wrap else None)

    # --- active PCs: frontmatter line + Current Status block ---
    print("\n===== Active PCs =====")
    found_pc = False
    for rel, text, fm in files:
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if str(fm.get("status", "")).casefold() in {"dead", "retired",
                                                    "inactive"}:
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
    plan = next(
        ((rel, text) for rel, text, fm in files
         if fm.get("type") == "session-plan"
         and parse_session_number(fm.get("session")) == upcoming
         and in_chapter(rel, fm)),
        None)
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

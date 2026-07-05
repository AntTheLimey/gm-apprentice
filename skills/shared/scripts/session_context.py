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

--session N treats N as the just-played session. The default is
the highest `session_number` whose status is played/wrap-up/
reviewed — pre-created `planned`/`prepped` indexes for the next
session are ignored. Each section is headed with its source
path; missing pieces are reported, not fatal.
"""

import argparse
import re
import sys
from pathlib import Path

from schema_rules import extract_frontmatter, parse_session_number

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
    sessions, played = {}, {}
    for rel, _text, fm in files:
        if fm.get("type") == "session":
            n = parse_session_number(fm.get("session_number"))
            if n is not None:
                sessions[n] = (rel, fm)
                if str(fm.get("status", "")).casefold() in PLAYED:
                    played[n] = (rel, fm)
    if args.session is not None:
        current = args.session
    elif played:
        current = max(played)
    elif sessions:
        current = max(sessions)
    else:
        current = 0
    upcoming = current + 1
    if current in sessions:
        rel, fm = sessions[current]
        status = fm.get("status", "?")
        note = ""
        pending = [n for n in sessions if n > current]
        if pending:
            note = (f"\nNote: session index(es) {sorted(pending)} exist "
                    f"with unplayed status — ignored for 'just played'.")
        print(f"===== Session Context =====\n"
              f"Just played: session {current} ({rel}, status: {status})\n"
              f"Preparing: session {upcoming}{note}")
    else:
        print(f"===== Session Context =====\n"
              f"No session indexes found"
              f"{f'; using --session {current}' if args.session is not None else ''}. "
              f"Preparing session {upcoming}.")

    # --- latest wrap-up ---
    wrap = next(
        ((rel, text) for rel, text, fm in files
         if fm.get("type") in ("session-wrap-up", "session_wrap")
         and parse_session_number(fm.get("session")) == current),
        None)
    if wrap is None:
        # Fallback: filename convention Chapter_CC_Session_NN_Wrap_Up.md
        pat = re.compile(rf"Session[ _-]0*{current}[ _-].*Wrap[ _-]?Up",
                         re.IGNORECASE)
        wrap = next(((rel, text) for rel, text, fm in files
                     if pat.search(rel)), None)
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
         and parse_session_number(fm.get("session")) == upcoming),
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

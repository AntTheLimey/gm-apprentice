#!/usr/bin/env python3
"""campaign-qa's hand procedures as code, called from vault_check.py.

  stories      each living PC has a `{Name}_Story.md`, and it is current
  timeline --order   a session's in_game_date does not go backwards
  report-new   create the QA report file: frontmatter and next free name
  report-stats tally the report's `vault_stats` from its findings

The checks return `LEVEL<TAB>path<TAB>message` rows like the others; the
report commands return the lines to print. Dates are read by the publish
tool, never here (`vaultlib.PUBLISH_LINES`, op `dates`).
"""

from __future__ import annotations

import datetime
import re
from pathlib import Path
from typing import Any

import vaultlib
from vaultlib import (
    WRAP_UP_TYPES,
    PublishToolUnavailable,
    active_pcs,
    chapter_of,
    entity_type,
    extract_frontmatter,
    frontmatter_span,
    parse_session_number,
    session_ref_number,
    vault_files,
)

CHAPTER_NUM_RE = re.compile(r"chapter\D{0,3}(\d+(?:\.\d+)?)", re.IGNORECASE)


def chapter_number(chapter: str | None) -> float:
    """The number in a chapter's name ("Chapter 4 - Calcutta" -> 4.0,
    "Chapter 0.5" -> 0.5); 0 when it has none."""
    m = CHAPTER_NUM_RE.search(chapter or "")
    return float(m.group(1)) if m else 0.0


# --------------------------------------------------------------------------
# stories
# --------------------------------------------------------------------------

def _as_of(value: Any) -> tuple[float | None, int | None]:
    """(chapter, session) an `asOfSession` value names. A bare number is a
    session; text must say "session" (a label like "Chapter 2 - Lyon
    (character deceased)" names no session). Either may be None."""
    text = str(value).strip() if value not in (None, "", []) else ""
    if not text:
        return None, None
    ch = CHAPTER_NUM_RE.search(text)
    chapter = float(ch.group(1)) if ch else None
    if re.fullmatch(r"\d+", text) or re.search(r"session", text, re.I):
        return chapter, parse_session_number(text)
    return chapter, None


def check_stories(vault: Path) -> list[str]:
    """For each living PC: the story file exists beside the sheet, and its
    `asOfSession` is no more than one Wrap-Up behind the latest."""
    wraps: set[tuple[float, int]] = set()
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if entity_type(fm) not in WRAP_UP_TYPES:
            continue
        n = session_ref_number(fm)
        if n is None:
            n = parse_session_number(fm.get("session_number"))
        if n is not None:
            wraps.add((chapter_number(chapter_of(rel, fm)), n))
    latest = max(wraps) if wraps else None
    rows: list[str] = []
    for rel, _fm in active_pcs(vault):
        story_rel = str(Path(rel).with_name(f"{Path(rel).stem}_Story.md"))
        story = vault / story_rel
        if not story.is_file():
            rows.append(f"WARNING\t{rel}\tno story file: create {story_rel} "
                        f"from shared/templates/character-story.md")
            continue
        if latest is None:
            continue
        fm = extract_frontmatter(story.read_text(encoding="utf-8")) or {}
        raw = fm.get("asOfSession")
        chapter, session = _as_of(raw)
        if session is None:
            shown = (f"asOfSession: {raw}" if raw not in (None, "")
                     else "no asOfSession")
            rows.append(f"WARNING\t{story_rel}\t{shown} names no session, so "
                        f"it cannot be compared with the latest Wrap-Up")
            continue
        key = (latest[0] if chapter is None else chapter, session)
        behind = sum(1 for w in wraps if w > key)
        if behind > 1:
            rows.append(f"WARNING\t{story_rel}\tstory file is current to "
                        f"{raw} but the latest Wrap-Up is chapter "
                        f"{latest[0]:g} session {latest[1]} ({behind} Wrap-Ups "
                        f"ahead) — run vault-ingest on the intervening "
                        f"wrap-ups to catch up")
    return rows


# --------------------------------------------------------------------------
# timeline --order
# --------------------------------------------------------------------------

def check_session_order(vault: Path) -> list[str]:
    """Sessions in play order (chapter, then session_number: numbering
    restarts in each chapter); a dated session whose date is before the
    last dated one's is reported. A date that names no day of the month
    is compared by month, since the timeline places it on the 1st."""
    sessions: list[tuple[float, int, str, Any]] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "session":
            continue
        n = parse_session_number(fm.get("session_number"))
        value = fm.get("in_game_date")
        if isinstance(value, list):
            value = value[0] if value else None
        if n is None or value in (None, ""):
            continue
        sessions.append((chapter_number(chapter_of(rel, fm)), n, rel, value))
    sessions.sort(key=lambda s: (s[0], s[1], s[2]))
    if not sessions:
        return []
    try:
        # Looked up now, not imported: use_publish_tool rebinds it.
        answer = vaultlib.PUBLISH_LINES.ask(
            {"op": "dates", "text": "",
             "values": [str(s[3]) for s in sessions]})
        dates = answer.get("dates")
        if not (isinstance(dates, list) and len(dates) == len(sessions)):
            raise PublishToolUnavailable("its answer about dates is not "
                                         "understood")
    except PublishToolUnavailable as e:
        # A tool that predates `dates` says "unknown op", or, when it
        # checks `text` before the op, "text must be a string".
        if "unknown op" in str(e) or "text must be a string" in str(e):
            # The wording of vault_check._tool_too_old_row.
            return [f"ERROR\t(vault)\ttimeline --order did not run: the "
                    f"site's publish tool predates {vaultlib.DATES_SINCE} "
                    f"and is too old for this check — run update-pin, then "
                    f"run this again"]
        return [f"ERROR\t(vault)\tthe session order was not checked: the "
                f"publish tool could not read the dates ({e})"]
    rows: list[str] = []
    prev: tuple[tuple[float, int, str, Any], dict[str, Any]] | None = None
    for s, d in zip(sessions, dates):
        if not isinstance(d, dict) or not d.get("iso"):
            continue
        if prev is not None:
            p, pd = prev
            width = 10 if d.get("day") and pd.get("day") else 7
            if d["iso"][:width] < pd["iso"][:width]:
                rows.append(
                    f"WARNING\t{s[2]}\tin_game_date \"{s[3]}\" is before "
                    f"\"{p[3]}\" of the session before it "
                    f"(chapter {p[0]:g} session {p[1]}, then chapter "
                    f"{s[0]:g} session {s[1]}) — a flashback, or a wrong date?")
        prev = (s, d)
    return rows


# --------------------------------------------------------------------------
# report-new, report-stats
# --------------------------------------------------------------------------

MODE_RE = re.compile(r"[a-z][a-z0-9_]*")
SCOPE_RE = re.compile(r"full_vault|custom|chapter_\d+(?:\.\d+)?")
STAT_KEYS = ("entities_scanned", "files_read", "findings_total",
             "findings_critical", "findings_warning", "findings_info",
             "findings_fixed", "findings_skipped", "findings_dismissed")
SEVERITIES = {"critical": "findings_critical", "warning": "findings_warning",
              "info": "findings_info"}

REPORT_BODY = """
# QA Report: {title} — {date}

**Scope:**

## Summary

## Critical Findings

## Warning Findings

## Info Findings

## Recommendations

## Dismissed Findings Register

| Finding | Reason | Files |
|---------|--------|-------|
"""


def report_new(vault: Path, mode: str, scope: str,
               date: str | None = None) -> list[str]:
    """Create `_QA/QA_{mode}_{date}.md` (a `_2`, `_3` ... suffix when the
    name is taken) with the template's frontmatter and headings; return the
    vault-relative path. Raises ValueError on a mode, scope or date that is
    not one the template knows the shape of."""
    if not MODE_RE.fullmatch(mode):
        raise ValueError(f"mode {mode!r} must be lower-case words joined by "
                         f"underscores (canon_audit, full_audit, ...)")
    if not SCOPE_RE.fullmatch(scope):
        raise ValueError(f"scope {scope!r} must be full_vault, custom or "
                         f"chapter_N")
    day = date or datetime.date.today().isoformat()
    try:
        datetime.date.fromisoformat(day)
    except ValueError as e:
        raise ValueError(f"date {day!r} must be YYYY-MM-DD") from e
    folder = vault / "_QA"
    folder.mkdir(exist_ok=True)
    name, n = f"QA_{mode}_{day}.md", 1
    while (folder / name).exists():
        n += 1
        name = f"QA_{mode}_{day}_{n}.md"
    stats = "".join(f"  {k}: 0\n" for k in STAT_KEYS)
    front = (f"---\ntype: qa_report\nmode: {mode}\nscope: {scope}\n"
             f"date: {day}\nin_game_date: null\nvault_stats:\n{stats}---\n")
    title = mode.replace("_", " ").title()
    (folder / name).write_text(
        front + REPORT_BODY.format(title=title, date=day), encoding="utf-8")
    return [f"_QA/{name}"]


def _status_word(text: str) -> str:
    m = re.search(r"\*\*Status:?\*\*:?\s*([A-Za-z]+)", text)
    return m.group(1).lower() if m else ""


def _table_cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def tally_findings(body: str) -> dict[str, int]:
    """Count the findings under the Critical, Warning and Info headings:
    each `###` block is one, and each row of a findings table (a header
    naming a Status column) is one. Fixed, Skipped and Dismissed come from
    the first word of the status; Pending or anything else counts in none."""
    counts = dict.fromkeys(
        ("findings_total", *SEVERITIES.values(), "findings_fixed",
         "findings_skipped", "findings_dismissed"), 0)
    states = {"fixed": "findings_fixed", "skipped": "findings_skipped",
              "dismissed": "findings_dismissed"}
    severity: str | None = None
    block: list[str] | None = None
    status_col: int | None = None
    in_table = False

    def count_status(word: str) -> None:
        if word in states:
            counts[states[word]] += 1

    def close() -> None:
        # A `###` heading is a finding only if it carries a **Status:**
        # line, as the template's findings do; a "### Not yet written"
        # list under Info is not one.
        nonlocal block
        text = "\n".join(block or [])
        if block is not None and severity and re.search(r"\*\*Status:?\*\*",
                                                        text):
            counts["findings_total"] += 1
            counts[SEVERITIES[severity]] += 1
            count_status(_status_word(text))
        block = None

    fenced = False
    for line in body.splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            fenced = not fenced
        if fenced:
            continue
        if re.match(r"##\s", line):
            close()
            h2 = re.match(r"##\s+(\w+)\s+Findings\s*$", line, re.IGNORECASE)
            word = h2.group(1).lower() if h2 else ""
            severity = word if word in SEVERITIES else None
            status_col, in_table = None, False
            continue
        if severity is None:
            continue
        if line.startswith("### "):
            close()
            block = []
        elif block is not None:
            block.append(line)
        elif line.lstrip().startswith("|"):
            cells = _table_cells(line)
            if not in_table:
                in_table = True
                low = [c.lower() for c in cells]
                status_col = low.index("status") if "status" in low else None
            elif not set("".join(cells)) <= set("-: "):
                counts["findings_total"] += 1
                counts[SEVERITIES[severity]] += 1
                if status_col is not None and status_col < len(cells):
                    words = re.sub(r"[^A-Za-z]+", " ",
                                   cells[status_col]).split()
                    count_status(words[0].lower() if words else "")
                else:
                    # No Status column: a row marked in its text, **FIXED ...**
                    m = next((re.match(r"\*\*\s*(fixed|skipped|dismissed)\b",
                                       c, re.IGNORECASE) for c in cells
                              if c.startswith("**")), None)
                    count_status(m.group(1).lower() if m else "")
        else:
            in_table = False
    close()
    return counts


def _scan_counts(vault: Path, fm: dict[str, Any], folder: str | None
                 ) -> tuple[int, int]:
    """(typed notes, notes) in the report's scope, QA reports left out."""
    chapter = re.fullmatch(r"chapter_(\d+(?:\.\d+)?)", str(fm.get("scope")))
    prefix = folder.strip("/") if folder else None
    notes = entities = 0
    for nrel, ntext in vault_files(vault):
        nfm = extract_frontmatter(ntext) or {}
        if nfm.get("type") == "qa_report":
            continue
        if prefix is not None and not (nrel == prefix
                                       or nrel.startswith(prefix + "/")):
            continue
        if prefix is None and chapter and chapter_number(
                chapter_of(nrel, nfm)) != float(chapter.group(1)):
            continue
        notes += 1
        entities += 1 if nfm.get("type") else 0
    return entities, notes


def report_stats(vault: Path, rel: str, folder: str | None = None,
                 dry_run: bool = False, force: bool = False) -> list[str]:
    """Update the QA report's `vault_stats` with the nine counts and return
    them as `key: value` lines (`key: old -> new` on a dry run, which
    writes nothing). Only a `type: qa_report` note is touched, and every
    other key in its `vault_stats` stays. The finding counts come from the
    report; `entities_scanned` and `files_read` are the typed notes and
    the notes in the report's scope (a `chapter_N` scope is that chapter;
    `folder` overrides it), the QA reports themselves left out, and are
    taken from today's vault only while the report holds 0 and is dated
    today: a scan count already there, or on an older report, is the vault
    as it was. A count that would drop below a
    non-zero one is refused unless `force`. A count that is not a plain
    integer ("272+") is left as written, even under `force`."""
    path = vault / rel
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    end, err = frontmatter_span(lines)
    if err:
        raise ValueError(f"{rel}: {err}")
    fm = extract_frontmatter(text) or {}
    if fm.get("type") != "qa_report":
        raise ValueError(f"{rel}: not a QA report (type: {fm.get('type')}); "
                         f"report-stats writes only `type: qa_report` notes")
    head = lines[1:end]
    at = next((i for i, ln in enumerate(head)
               if re.match(r"vault_stats\s*:", ln)), None)
    stop = 0
    if at is not None:
        stop = at + 1
        while stop < len(head) and (head[stop].startswith((" ", "\t"))
                                    or not head[stop].strip()):
            stop += 1
    old: dict[str, int] = {}
    kept: dict[str, str] = {}   # a count that is not a plain integer
    for ln in head[(at or 0) + 1:stop]:
        m = re.match(r"\s+([A-Za-z_]+)\s*:\s*(\S+)\s*$", ln)
        if m and m.group(1) in STAT_KEYS:
            if re.fullmatch(r"\d+", m.group(2)):
                old[m.group(1)] = int(m.group(2))
            else:
                kept[m.group(1)] = m.group(2)
    counts = tally_findings("".join(lines[end + 1:]))
    values = dict(counts)
    values["entities_scanned"] = old.get("entities_scanned", 0)
    values["files_read"] = old.get("files_read", 0)
    # Today's vault describes only a report written today.
    notes_out: list[str] = []
    open_scans = [k for k in ("entities_scanned", "files_read")
                  if not values[k] and k not in kept]
    if open_scans:
        day = str(fm.get("date"))
        if day == datetime.date.today().isoformat():
            entities, notes = _scan_counts(vault, fm, folder)
            for k, v in zip(("entities_scanned", "files_read"),
                            (entities, notes)):
                if k in open_scans:
                    values[k] = v
        else:
            notes_out = [f"# scan counts not taken from today's vault "
                         f"(the report is dated {day}, not today)"]
    lower = [k for k in STAT_KEYS if k not in kept
             and values[k] < old.get(k, 0)]
    if dry_run:
        return [f"{k}: {kept[k]} (kept, not a number)" if k in kept else
                f"{k}: {old.get(k, '-')} -> {values[k]}"
                + ("  (refused: lower; needs --force)"
                   if k in lower and not force else "")
                for k in STAT_KEYS] + notes_out
    if lower and not force:
        raise ValueError(
            f"{rel}: would lower " + ", ".join(
                f"{k} {old[k]} -> {values[k]}" for k in lower)
            + "; nothing written (--force to lower them)")
    if at is None:
        head += ["vault_stats:\n"] + [f"  {k}: {values[k]}\n"
                                      for k in STAT_KEYS]
    else:
        todo = {k: v for k, v in values.items() if k not in kept}
        for j in range(at + 1, stop):
            m = re.match(r"(\s+)([A-Za-z_]+)\s*:", head[j])
            if m and m.group(2) in todo:
                head[j] = f"{m.group(1)}{m.group(2)}: {todo.pop(m.group(2))}\n"
        indent = next((m.group(1) for ln in head[at + 1:stop]
                       if (m := re.match(r"(\s+)\S", ln))), "  ")
        extra = [f"{indent}{k}: {todo[k]}\n" for k in STAT_KEYS if k in todo]
        # New keys go after the last key line, not after trailing blanks.
        last = max((j for j in range(at, stop) if head[j].strip()),
                   default=at)
        head[last + 1:last + 1] = extra
    path.write_text("".join([lines[0], *head, *lines[end:]]),
                    encoding="utf-8")
    return [f"{k}: {kept.get(k, values[k])}" for k in STAT_KEYS] + notes_out

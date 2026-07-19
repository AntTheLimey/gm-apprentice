#!/usr/bin/env python3
"""Vault content checks: frontmatter, names, index drift, stale drafts.

Read-only companion to graph_check.py. Turns the mechanical parts of
entity validation and campaign-qa checks into one deterministic pass;
interpretation stays with the skill. Stdlib only.

Usage:
  vault_check.py VAULT frontmatter [--folder SUB]
  vault_check.py VAULT names [--threshold 0.85]
  vault_check.py VAULT index
  vault_check.py VAULT stale-drafts
  vault_check.py VAULT changed --since N
  vault_check.py VAULT tables
  vault_check.py VAULT timeline
  vault_check.py VAULT read-aloud
  vault_check.py VAULT all

Skips hidden directories, `_Templates/`, and `_inbox/` (staging).
Output: labelled sections, `# count: N` headers, one finding per
line as `LEVEL<TAB>path<TAB>message`.

Levels: ERROR (schema violation), WARNING (needs GM attention),
INFO (context the auditing skill should triage, not a defect).
"""

import argparse
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

from graph_check import link_target
from schema_rules import (
    CANON_STATUS_VALUES,
    DEPRECATED_FIELDS,
    NPC_STATUS,
    REQUIRED_FIELDS,
    SCENE_STATUS,
    SCENE_TYPES,
    SESSION_STATUS,
    extract_frontmatter,
    parse_session_number,
)

SKIP_DIRS = {"_Templates", "_templates", "_inbox"}
LINK_RE = re.compile(r"!?\[\[([^\[\]]+?)\]\]")
# A frontmatter line carrying an unquoted wikilink (Juggl breaks on these)
UNQUOTED_LINK_RE = re.compile(r'^\s*(?:[\w-]+:|-)\s*\[\[')

ENUM_CHECKS = {
    # field -> (allowed values, entity types it applies to; None = any)
    "canon_status": (CANON_STATUS_VALUES, None),
    "scene_type": (SCENE_TYPES, {"scene"}),
}
STATUS_BY_TYPE = {
    "session": SESSION_STATUS,
    "scene": SCENE_STATUS,
    "npc": NPC_STATUS,
}


def vault_files(vault: Path, folder: str | None = None):
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        parts = rel.split("/")
        if any(p.startswith(".") for p in parts):
            continue
        if parts[0] in SKIP_DIRS:
            continue
        if folder and not rel.startswith(folder.strip("/") + "/"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            print(f"warning: unreadable {rel}: {e}", file=sys.stderr)
            continue
        yield rel, text


def normalize(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("_", " ").strip()).casefold()


def emit(label: str, rows: list[str]):
    print(f"## {label}")
    print(f"# count: {len(rows)}")
    for r in rows:
        print(r)


def raw_frontmatter(text: str) -> str:
    m = re.match(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.DOTALL)
    return m.group(1) if m else ""


def check_frontmatter(vault: Path, folder: str | None) -> list[str]:
    rows = []
    for rel, text in vault_files(vault, folder):
        fm = extract_frontmatter(text)
        if fm is None:
            rows.append(f"INFO\t{rel}\tno frontmatter")
            continue
        etype = fm.get("type")
        if not etype or isinstance(etype, list):
            rows.append(f"ERROR\t{rel}\tmissing 'type' field")
            continue
        if etype not in REQUIRED_FIELDS:
            # Custom entity types are allowed; surface for awareness.
            rows.append(f"INFO\t{rel}\tcustom type '{etype}' "
                        f"(no schema rules applied)")
        else:
            for field in REQUIRED_FIELDS[etype]:
                if field not in fm:
                    rows.append(f"ERROR\t{rel}\tmissing required "
                                f"field '{field}' for type '{etype}'")
        for field, (allowed, types) in ENUM_CHECKS.items():
            value = fm.get(field)
            if value and not isinstance(value, list) \
                    and (types is None or etype in types) \
                    and value not in allowed:
                rows.append(f"ERROR\t{rel}\t{field}: '{value}' not in "
                            f"{{{', '.join(sorted(allowed))}}}")
        status = fm.get("status")
        allowed = STATUS_BY_TYPE.get(etype)
        if status and allowed and not isinstance(status, list) \
                and status not in allowed:
            rows.append(f"ERROR\t{rel}\tstatus: '{status}' not in "
                        f"{{{', '.join(sorted(allowed))}}}")
        for scope in ("*", etype):
            for old, new, since in DEPRECATED_FIELDS.get(scope, []):
                if old in fm:
                    rows.append(f"ERROR\t{rel}\tlegacy field '{old}' — "
                                f"renamed to '{new}' in {since} "
                                f"(see shared/canon-status.md)")
        for line in raw_frontmatter(text).splitlines():
            if UNQUOTED_LINK_RE.match(line):
                rows.append(f"WARNING\t{rel}\tunquoted wikilink in "
                            f"frontmatter: {line.strip()[:60]} "
                            f"(quote it: \"[[...]]\")")
    return rows


# Document-chain suffixes: "X - Wrap-Up" beside "X" is the designed
# session family, and "X_Story" beside "X" is the PC story pair —
# similarity between them is expected, not confusing.
CHAIN_SUFFIX_RE = re.compile(
    r"\s*[-–]\s*(wrap[- ]?up|plan|play notes|handouts)$|[_ ]story$",
    re.IGNORECASE,
)
DIGITS_RE = re.compile(r"\d+(?:\.\d+)?")

# Name-confusion checking is about entities (NPCs, locations,
# factions...). Structural documents — session notes, plans,
# wrap-ups, chapter overviews — share names by convention and
# only flood the report.
STRUCTURAL_TYPES = {
    "session", "session-plan", "session-play-notes",
    "session-wrap-up", "session_wrap", "scene", "chapter",
    "meta", "timeline", "world_flags", "plan",
}
STRUCTURAL_NAME_RE = re.compile(
    r"(session|chapter)s?[\s_#.\d-]", re.IGNORECASE)
STRUCTURAL_DOC_RE = re.compile(
    r"(note|plan|wrap|overview|handout|recap)", re.IGNORECASE)


def base_name(name: str) -> str:
    return CHAIN_SUFFIX_RE.sub("", name.replace("_", " ").strip())


def check_names(vault: Path, threshold: float) -> list[str]:
    # name -> list of (rel, kind) where kind is 'name' or 'alias'
    entries = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        stem = Path(rel).stem
        if fm.get("type") in STRUCTURAL_TYPES:
            continue
        if STRUCTURAL_NAME_RE.search(stem) and STRUCTURAL_DOC_RE.search(stem):
            continue
        entries.append((stem, rel, "name"))
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                entries.append((a, rel, "alias"))
    rows = []
    seen_pairs = set()
    for i, (name_a, rel_a, kind_a) in enumerate(entries):
        for name_b, rel_b, kind_b in entries[i + 1:]:
            if rel_a == rel_b:
                continue
            pair = tuple(sorted((rel_a, rel_b)))
            if normalize(base_name(name_a)) == normalize(base_name(name_b)) \
                    and normalize(name_a) != normalize(name_b):
                continue  # same document-chain family
            na, nb = normalize(name_a), normalize(name_b)
            numbered_family = (na != nb and
                               DIGITS_RE.sub("#", na) == DIGITS_RE.sub("#", nb))
            if na == nb:
                key = (pair, "exact")
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    rows.append(f"WARNING\t{rel_a} <> {rel_b}\t"
                                f"{kind_a} '{name_a}' duplicates "
                                f"{kind_b} '{name_b}'")
                continue
            matcher = SequenceMatcher(None, na, nb)
            if matcher.real_quick_ratio() < threshold \
                    or matcher.quick_ratio() < threshold:
                continue
            ratio = matcher.ratio()
            if ratio >= threshold:
                key = (pair, "fuzzy")
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                if numbered_family:
                    # Names differing only in digits are usually an
                    # intentional sequence — but can hide transposed
                    # numbers, so surface as INFO, not WARNING.
                    rows.append(f"INFO\t{rel_a} <> {rel_b}\t"
                                f"numbered pair '{name_a}' ~ "
                                f"'{name_b}' — verify intentional")
                else:
                    rows.append(f"WARNING\t{rel_a} <> {rel_b}\t"
                                f"'{name_a}' ~ '{name_b}' "
                                f"(similarity {ratio:.2f})")
    return sorted(rows)


ATTACHMENT_RE = re.compile(r"\.(?!md$)[A-Za-z0-9]{1,6}$")


def check_index(vault: Path) -> list[str]:
    index_path = vault / "_meta" / "index.md"
    if not index_path.is_file():
        return ["INFO\t_meta/index.md\tno index file — skipping check"]
    index_text = index_path.read_text(encoding="utf-8", errors="replace")
    # Resolve like graph_check does: strip alias/anchor/path/.md, skip
    # attachment embeds (images, PDFs) — they are not note references.
    indexed = set()
    for raw in LINK_RE.findall(index_text):
        target = re.split(r"[#^|]", raw, maxsplit=1)[0].strip()
        if ATTACHMENT_RE.search(target.rsplit("/", 1)[-1]):
            continue
        indexed.add(link_target(raw))

    names = set()
    referenced_by = {}  # rel -> set of names that count as references
    content_files = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        stem = normalize(Path(rel).stem)
        names.add(stem)
        refs = {stem}
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                names.add(normalize(a))
                refs.add(normalize(a))
        referenced_by[rel] = refs
        # Underscore dirs are infrastructure, not indexable content.
        if not rel.split("/")[0].startswith("_"):
            content_files.append(rel)

    rows = []
    for rel in content_files:
        if not referenced_by[rel] & indexed:
            rows.append(f"WARNING\t{rel}\tnot referenced from "
                        f"_meta/index.md")
    for target in sorted(indexed):
        if target and target not in names:
            rows.append(f"WARNING\t_meta/index.md\tindex links "
                        f"'[[{target}]]' but no such file exists")
    return rows


def check_stale_drafts(vault: Path) -> list[str]:
    files = list(vault_files(vault))
    current = 0
    for rel, text in files:
        fm = extract_frontmatter(text) or {}
        if fm.get("type") == "session":
            n = parse_session_number(fm.get("session_number"))
            if n:
                current = max(current, n)
    rows = []
    if not current:
        return ["INFO\t(vault)\tno session entities with "
                "session_number — cannot compute staleness"]
    for rel, text in files:
        fm = extract_frontmatter(text) or {}
        if fm.get("canon_status") != "DRAFT":
            continue
        if fm.get("type") == "session-plan":
            continue  # prep content is always DRAFT — exempt
        created = parse_session_number(fm.get("createdSession"))
        if created is None:
            rows.append(f"WARNING\t{rel}\tDRAFT missing createdSession — "
                        f"cannot determine staleness; add it or promote")
        elif created > current:
            rows.append(f"WARNING\t{rel}\tcreatedSession ({created}) "
                        f"exceeds current session ({current}) — check "
                        f"the value (dates don't belong in this field)")
        elif current - created >= 3:
            rows.append(f"WARNING\t{rel}\tstale DRAFT (created session "
                        f"{created}, now session {current}) — promote "
                        f"to AUTHORITATIVE or delete")
    return rows


def check_changed(vault: Path, since: int) -> list[str]:
    """Entities touched at or after session N — the incremental-audit
    scope. Keys off session-anchored fields (asOfSession,
    createdSession, session, session_number), not calendar dates."""
    rows = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        reasons = []
        for field in ("asOfSession", "createdSession", "session",
                      "session_number"):
            n = parse_session_number(fm.get(field))
            if n is not None and n >= since:
                reasons.append(f"{field}={n}")
        if reasons:
            rows.append(f"INFO\t{rel}\t{', '.join(reasons)}")
    return rows


def iter_body_lines(text: str):
    """Yield (lineno, line) for body lines, 1-based, skipping YAML
    frontmatter so scans never trip on `aliases:` or `type:` values."""
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
    for idx in range(start, len(lines)):
        yield idx + 1, lines[idx]


TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
ALIAS_LINK_RE = re.compile(r"\[\[[^\[\]]*\|[^\[\]]*\]\]")


def check_tables(vault: Path) -> list[str]:
    r"""Pipes inside table cells break the table when Obsidian reflows it.
    Flag aliased wikilinks ([[A|B]]) and escaped pipes (\|) inside table
    blocks. ERROR: deterministic render break the apprentice silently fixes
    as a chore (the level is internal — never shown to the GM as a report)."""
    rows = []
    for rel, text in vault_files(vault):
        body = list(iter_body_lines(text))
        is_row = [bool(TABLE_ROW_RE.match(ln)) for _, ln in body]
        for i, (lineno, ln) in enumerate(body):
            if not is_row[i]:
                continue
            # Require a table *block*: a stray piped prose line is not a table.
            neighbour = (i > 0 and is_row[i - 1]) or \
                        (i < len(body) - 1 and is_row[i + 1])
            if not neighbour:
                continue
            am = ALIAS_LINK_RE.search(ln)
            if am:
                rows.append(f"ERROR\t{rel}:{lineno}\taliased wikilink pipe "
                            f"in table cell breaks Obsidian reflow: "
                            f"{am.group(0)}")
            if "\\|" in ln:
                rows.append(f"ERROR\t{rel}:{lineno}\tescaped pipe '\\|' in "
                            f"table cell breaks Obsidian reflow")
    return rows


TIMELINE_SECTION_RE = re.compile(r"^##\s+Timeline\b", re.IGNORECASE | re.MULTILINE)
# A date-range marker in a string in_game_date: en/em dash, a spaced
# hyphen (so ISO "1893-05-01" is NOT a range), or a word form.
DATE_RANGE_RE = re.compile(
    r"[–—]|\s-|-\s|\bto\b|\bthrough\b|\bthru\b", re.IGNORECASE)


def _is_multi_day(value) -> bool:
    """Multi-day if in_game_date is a list of 2+ dates (the documented
    form) or a string expressing a range ("Sept 17–24", "1814 to 1815")."""
    if isinstance(value, list):
        return len([v for v in value if v is not None]) >= 2
    if isinstance(value, str):
        return bool(DATE_RANGE_RE.search(value))
    return False


def check_timeline(vault: Path) -> list[str]:
    """Internal 'is this multi-day?' cue (INFO, not a scold). When a
    `type: session-plan` spans multiple days (a 2+ list, or a string range)
    and has no `## Timeline` section, surface a cue so the apprentice can
    *offer to build the clock with the GM*. Single-day plans are silent."""
    rows = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "session-plan":
            continue
        if not _is_multi_day(fm.get("in_game_date")):
            continue
        if TIMELINE_SECTION_RE.search(text):
            continue
        rows.append(f"INFO\t{rel}\tmulti-day plan (in_game_date spans "
                    f"multiple days) — offer to build a '## Timeline' clock "
                    f"with the GM so hours and same-day travel stay coherent")
    return rows


PC_INACTIVE_STATUS = {"dead", "retired", "inactive"}


def active_pc_names(vault: Path) -> set[str]:
    """Active PCs, mirroring session_context.py: type: pc, not *_Story.md,
    status not dead/retired/inactive. Name set = filename stem, each
    capitalised stem token (len >= 3), and each alias — for whole-word
    matching of both 'Katherine Winslow' and 'Katherine'."""
    names: set[str] = set()
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if str(fm.get("status", "")).casefold() in PC_INACTIVE_STATUS:
            continue
        stem = Path(rel).stem.replace("_", " ").strip()
        if stem:
            names.add(stem)
            for tok in stem.split():
                if len(tok) >= 3 and tok[:1].isupper():
                    names.add(tok)
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a.strip():
                    names.add(a.strip())
    return names


def pc_name_regex(names: set[str]):
    """A single whole-word alternation, longest name first so multi-word
    names win over their tokens. None when there are no active PCs."""
    if not names:
        return None
    ordered = sorted(names, key=len, reverse=True)
    alt = "|".join(re.escape(n) for n in ordered)
    return re.compile(rf"\b({alt})\b", re.IGNORECASE)


READ_ALOUD_SCAN_TYPES = {"session-plan", "scene"}
SECOND_PERSON_RE = re.compile(
    r"\byou\s+(feel|feels|sense|senses|realize|realizes|realise|realises|"
    r"notice|notices|know|knows|want|wants|remember|remembers)\b",
    re.IGNORECASE)
THIRD_PERSON_RE = re.compile(r"\b(he|she|him|her|his|hers)\b", re.IGNORECASE)


def check_read_aloud(vault: Path) -> list[str]:
    """Read-aloud blockquote signal (INFO — a high-precision cue the
    apprentice uses to ask about a real read-aloud line, never a report the
    GM sees). Over `> ` blockquote lines in session-plan/scene files, flag a
    named PC, a 2nd-person feeling verb, or a 3rd-person pronoun. The Slice B
    plan-wide 'PC name as action subject' scan is intentionally *not* here —
    it scolded the GM's own prose."""
    pc_re = pc_name_regex(active_pc_names(vault))
    rows: list[str] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") not in READ_ALOUD_SCAN_TYPES:
            continue
        for lineno, line in iter_body_lines(text):
            stripped = line.lstrip()
            if not stripped.startswith(">"):
                continue
            bq = stripped.lstrip(">").strip()
            pm = pc_re.search(bq) if pc_re else None
            if pm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"names PC '{pm.group(0)}' — read-aloud addresses "
                            f"the table, not one PC")
            sm = SECOND_PERSON_RE.search(bq)
            if sm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"dictates player feeling: '{sm.group(0)}'")
            tm = THIRD_PERSON_RE.search(bq)
            if tm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"uses 3rd-person pronoun '{tm.group(0)}' "
                            f"(advisory — fine for NPCs)")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", choices=["frontmatter", "names", "index",
                                        "stale-drafts", "changed", "tables",
                                        "timeline", "read-aloud", "all"])
    ap.add_argument("--folder", help="restrict frontmatter check to subfolder")
    ap.add_argument("--threshold", type=float, default=0.85,
                    help="similarity ratio for names (default 0.85)")
    ap.add_argument("--since", type=int,
                    help="session number for the changed command")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    if args.command == "changed":
        if args.since is None:
            print("error: changed requires --since N", file=sys.stderr)
            return 2
        emit("changed", check_changed(args.vault, args.since))
        return 0

    if args.command in ("frontmatter", "all"):
        emit("frontmatter", check_frontmatter(args.vault, args.folder))
    if args.command in ("names", "all"):
        emit("names", check_names(args.vault, args.threshold))
    if args.command in ("index", "all"):
        emit("index", check_index(args.vault))
    if args.command in ("stale-drafts", "all"):
        emit("stale-drafts", check_stale_drafts(args.vault))
    if args.command in ("tables", "all"):
        emit("tables", check_tables(args.vault))
    if args.command in ("timeline", "all"):
        emit("timeline", check_timeline(args.vault))
    if args.command in ("read-aloud", "all"):
        emit("read-aloud", check_read_aloud(args.vault))
    return 0


if __name__ == "__main__":
    sys.exit(main())

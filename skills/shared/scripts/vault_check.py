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
            # Numbered structural families (Chapter_2_Overview vs
            # Chapter_4_Overview) are similar by design, not confusing.
            if na != nb and DIGITS_RE.sub("#", na) == DIGITS_RE.sub("#", nb):
                continue
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
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    rows.append(f"WARNING\t{rel_a} <> {rel_b}\t"
                                f"'{name_a}' ~ '{name_b}' "
                                f"(similarity {ratio:.2f})")
    return sorted(rows)


def check_index(vault: Path) -> list[str]:
    index_path = vault / "_meta" / "index.md"
    if not index_path.is_file():
        return ["INFO\t_meta/index.md\tno index file — skipping check"]
    index_text = index_path.read_text(encoding="utf-8", errors="replace")
    indexed = {normalize(re.split(r"[#^|]", t, maxsplit=1)[0])
               for t in LINK_RE.findall(index_text)}

    names = {}
    content_files = []
    for rel, text in vault_files(vault):
        top = rel.split("/")[0]
        names.setdefault(normalize(Path(rel).stem), []).append(rel)
        # Underscore dirs are infrastructure, not indexable content.
        if not top.startswith("_"):
            content_files.append(rel)

    rows = []
    for rel in content_files:
        if normalize(Path(rel).stem) not in indexed:
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
        elif current - created >= 3:
            rows.append(f"WARNING\t{rel}\tstale DRAFT (created session "
                        f"{created}, now session {current}) — promote "
                        f"to AUTHORITATIVE or delete")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", choices=["frontmatter", "names", "index",
                                        "stale-drafts", "all"])
    ap.add_argument("--folder", help="restrict frontmatter check to subfolder")
    ap.add_argument("--threshold", type=float, default=0.85,
                    help="similarity ratio for names (default 0.85)")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2

    if args.command in ("frontmatter", "all"):
        emit("frontmatter", check_frontmatter(args.vault, args.folder))
    if args.command in ("names", "all"):
        emit("names", check_names(args.vault, args.threshold))
    if args.command in ("index", "all"):
        emit("index", check_index(args.vault))
    if args.command in ("stale-drafts", "all"):
        emit("stale-drafts", check_stale_drafts(args.vault))
    return 0


if __name__ == "__main__":
    sys.exit(main())

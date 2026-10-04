#!/usr/bin/env python3
"""Vault graph queries: orphans, unresolved links, dead ends, backlinks.

Replaces per-query LLM link-map construction (and the retired Obsidian
MCP/CLI paths) with one deterministic pass over the vault. Stdlib only.

Usage:
  graph_check.py VAULT orphans [--folder SUB] [--exclude GLOB]...
  graph_check.py VAULT unresolved [--exclude GLOB]...
  graph_check.py VAULT deadends [--folder SUB] [--exclude GLOB]...
  graph_check.py VAULT backlinks NAME [--exclude GLOB]...
  graph_check.py VAULT ambiguous [--exclude GLOB]...
  graph_check.py VAULT all [--exclude GLOB]...

Output: a `# count: N` header line, then one vault-relative path (or
unresolved target name) per line. `all` prints labelled sections.

Link forms handled: [[Name]], [[Name|alias]], [[Name#heading]],
[[Name^block]], ![[embeds]], quoted "[[links]]" in YAML frontmatter,
spaces vs underscores, case differences, and frontmatter `aliases:`.
A link to an existing image or other non-note file counts as resolved. A
table link `[[Name\\|alias]]` counts as `[[Name|alias]]`. Links quoted in
code fences or inline code are not links. Like every other vault script it
skips hidden folders and the `_Templates`, `_templates` and `_inbox`
folders. Links written in notes under `_QA` and `_archive` (old reports,
archives) are not reported as unresolved; notes there still count as targets.
"""

import argparse
import fnmatch
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaultlib import (  # noqa: E402
    LINK_RE,
    frontmatter_aliases,
    inline_code_spans,
    inside_spans,
    is_skipped_path,
    is_unchecked_source,
    link_name,
    link_target,
    normalize,
    scan_body,
)


def body_links(text: str) -> list[str]:
    """Wikilink bodies that are links: frontmatter ones too, but not those
    quoted in a code fence or an inline code span."""
    states, _ = scan_body(text)
    code = {s.lineno for s in states if s.in_code}
    body_start = states[0].lineno if states else 1
    found: list[str] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if lineno in code:
            continue
        spans = inline_code_spans(line) if lineno >= body_start else []
        for m in LINK_RE.finditer(line):
            if not inside_spans(m.start(), spans):
                found.append(m.group(1))
    return found


def collect(vault: Path, excludes: list[str]):
    """Scan the vault once; return (notes, names, outbound, spellings).

    notes: relpath -> normalized basename
    names: normalized name/alias -> set of relpaths it resolves to
    outbound: relpath -> set of normalized link targets
    spellings: relpath -> {normalized link target: as first written there}
    """
    notes: dict[str, str] = {}
    names: dict[str, set[str]] = {}
    outbound: dict[str, set[str]] = {}
    spellings: dict[str, dict[str, str]] = {}
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        parts = rel.split("/")
        if is_skipped_path(rel):
            continue
        if any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(parts[0], g)
               for g in excludes):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            print(f"warning: unreadable {rel}: {e}", file=sys.stderr)
            continue
        base = normalize(path.stem)
        notes[rel] = base
        names.setdefault(base, set()).add(rel)
        for alias in frontmatter_aliases(text):
            names.setdefault(normalize(alias), set()).add(rel)
        written: dict[str, str] = {}
        for b in body_links(text):
            written.setdefault(link_target(b), link_name(b))
        outbound[rel] = set(written)
        spellings[rel] = written
    return notes, names, outbound, spellings


def attachment_names(vault: Path) -> set[str]:
    """Normalized names of the vault's non-note files (images, PDFs...),
    walked like the notes: a `![[map.png]]` or `[[Sheet.pdf]]` link is
    resolved against these, case-insensitively by file name like Obsidian."""
    found: set[str] = set()
    for root, dirs, files in os.walk(vault):
        here = Path(root).relative_to(vault).as_posix()
        prefix = "" if here == "." else here + "/"
        # Prune in place so hidden folders (.git, .obsidian) are not entered.
        dirs[:] = [d for d in dirs if not is_skipped_path(prefix + d)]
        for name in files:
            if name.lower().endswith(".md") or is_skipped_path(prefix + name):
                continue
            if (Path(root) / name).is_file():
                found.add(normalize(name))
    return found


def broken(vault: Path, names: dict[str, set[str]],
           spellings: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Links with no note or file behind them: normalized target ->
    {source relpath: the spelling written there}. Every source is here;
    the caller drops the ones `is_unchecked_source` names."""
    known = set(names) | attachment_names(vault)
    missing: dict[str, dict[str, str]] = {}
    for src, written in spellings.items():
        for target, spelling in written.items():
            if target and target not in known:
                missing.setdefault(target, {})[src] = spelling
    return missing


def inbound_map(notes, names, outbound):
    """relpath -> set of relpaths that link to it (self-links excluded)."""
    inbound: dict[str, set[str]] = {rel: set() for rel in notes}
    for src, targets in outbound.items():
        for t in targets:
            for dst in names.get(t, ()):
                if dst != src:
                    inbound[dst].add(src)
    return inbound


def in_folder(rel: str, folder: str | None) -> bool:
    return folder is None or rel.startswith(folder.strip("/") + "/")


def emit(rows, label=None):
    if label:
        print(f"## {label}")
    print(f"# count: {len(rows)}")
    for r in rows:
        print(r)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command",
                    choices=["orphans", "unresolved", "deadends",
                             "backlinks", "ambiguous", "all"])
    ap.add_argument("name", nargs="?",
                    help="target note name (backlinks only)")
    ap.add_argument("--folder", help="restrict results to this subfolder")
    ap.add_argument("--exclude", action="append", default=[],
                    help="glob of relpaths or top-level dirs to skip")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    if args.command == "backlinks" and not args.name:
        print("error: backlinks requires NAME", file=sys.stderr)
        return 2

    notes, names, outbound, spellings = collect(args.vault, args.exclude)
    inbound = inbound_map(notes, names, outbound)

    def orphans():
        return sorted(r for r, srcs in inbound.items()
                      if not srcs and in_folder(r, args.folder))

    def unresolved():
        rows = []
        for target, srcs in broken(args.vault, names, spellings).items():
            checked = sorted(s for s in srcs if not is_unchecked_source(s))
            if checked:
                rows.append(f"{target}  <- {', '.join(checked)}")
        return sorted(rows)

    def deadends():
        return sorted(r for r, targets in outbound.items()
                      if not any(t in names for t in targets)
                      and in_folder(r, args.folder))

    def backlinks():
        target = normalize(args.name)
        dsts = names.get(target, set())
        return sorted({src for dst in dsts for src in inbound[dst]})

    def ambiguous():
        # A bare [[link]] whose name matches more than one FILE resolves
        # unpredictably in Obsidian — a wrong link waiting to happen.
        # Filename collisions only: Obsidian resolves bare links by
        # filename, so an alias shadowing another note's name does not
        # compete with it.
        stems: dict[str, set[str]] = {}
        for rel, base in notes.items():
            stems.setdefault(base, set()).add(rel)
        linked = {t for targets in outbound.values() for t in targets}
        return sorted(
            f"{name}  -> {', '.join(sorted(paths))}"
            for name, paths in stems.items()
            if len(paths) > 1 and name in linked)

    if args.command == "orphans":
        emit(orphans())
    elif args.command == "unresolved":
        emit(unresolved())
    elif args.command == "deadends":
        emit(deadends())
    elif args.command == "backlinks":
        emit(backlinks())
    elif args.command == "ambiguous":
        emit(ambiguous())
    else:
        emit(orphans(), "orphans")
        emit(unresolved(), "unresolved")
        emit(deadends(), "deadends")
        emit(ambiguous(), "ambiguous")
    return 0


if __name__ == "__main__":
    sys.exit(main())

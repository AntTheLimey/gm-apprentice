#!/usr/bin/env python3
"""Vault graph queries: orphans, unresolved links, dead ends, backlinks.

Replaces per-query LLM link-map construction (and the retired Obsidian
MCP/CLI paths) with one deterministic pass over the vault. Stdlib only.

Usage:
  graph_check.py VAULT orphans [--folder SUB] [--exclude GLOB]...
  graph_check.py VAULT unresolved [--exclude GLOB]...
  graph_check.py VAULT deadends [--folder SUB] [--exclude GLOB]...
  graph_check.py VAULT backlinks NAME [--exclude GLOB]...
  graph_check.py VAULT all [--exclude GLOB]...

Output: a `# count: N` header line, then one vault-relative path (or
unresolved target name) per line. `all` prints labelled sections.

Link forms handled: [[Name]], [[Name|alias]], [[Name#heading]],
[[Name^block]], ![[embeds]], quoted "[[links]]" in YAML frontmatter,
spaces vs underscores, case differences, and frontmatter `aliases:`.
"""

import argparse
import fnmatch
import re
import sys
from pathlib import Path

LINK_RE = re.compile(r"!?\[\[([^\[\]]+?)\]\]")
ALIASES_BLOCK_RE = re.compile(
    r"^aliases:\s*(?:\[(?P<inline>[^\]]*)\]\s*$|(?P<list>(?:\n\s*-\s*.+)+))",
    re.MULTILINE,
)


def normalize(name: str) -> str:
    """Normalize a note name or link target for matching."""
    return re.sub(r"\s+", " ", name.replace("_", " ").strip()).casefold()


def link_target(raw: str) -> str:
    """Reduce a wikilink body to its target note name."""
    target = raw.split("|", 1)[0]
    target = re.split(r"[#^]", target, maxsplit=1)[0]
    # Path-style links resolve by final segment, like Obsidian.
    target = target.rstrip("/").rsplit("/", 1)[-1]
    if target.endswith(".md"):
        target = target[:-3]
    return normalize(target)


def frontmatter_aliases(text: str) -> list[str]:
    if not text.startswith("---"):
        return []
    end = text.find("\n---", 3)
    if end == -1:
        return []
    m = ALIASES_BLOCK_RE.search(text[:end])
    if not m:
        return []
    if m.group("inline") is not None:
        items = m.group("inline").split(",")
    else:
        items = re.findall(r"-\s*(.+)", m.group("list"))
    return [i.strip().strip("\"'") for i in items if i.strip().strip("\"'")]


def collect(vault: Path, excludes: list[str]):
    """Scan the vault once; return (notes, names, outbound).

    notes: relpath -> normalized basename
    names: normalized name/alias -> set of relpaths it resolves to
    outbound: relpath -> set of normalized link targets
    """
    notes, names, outbound = {}, {}, {}
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        parts = rel.split("/")
        if any(p.startswith(".") for p in parts):
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
        outbound[rel] = {link_target(m) for m in LINK_RE.findall(text)}
    return notes, names, outbound


def inbound_map(notes, names, outbound):
    """relpath -> set of relpaths that link to it (self-links excluded)."""
    inbound = {rel: set() for rel in notes}
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
                             "backlinks", "all"])
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

    notes, names, outbound = collect(args.vault, args.exclude)
    inbound = inbound_map(notes, names, outbound)

    def orphans():
        return sorted(r for r, srcs in inbound.items()
                      if not srcs and in_folder(r, args.folder))

    def unresolved():
        known = set(names)
        missing = {}
        for src, targets in outbound.items():
            for t in targets:
                if t and t not in known:
                    missing.setdefault(t, set()).add(src)
        return sorted(f"{t}  <- {', '.join(sorted(srcs))}"
                      for t, srcs in missing.items())

    def deadends():
        return sorted(r for r, targets in outbound.items()
                      if not any(t in names for t in targets)
                      and in_folder(r, args.folder))

    def backlinks():
        target = normalize(args.name)
        dsts = names.get(target, set())
        return sorted({src for dst in dsts for src in inbound[dst]})

    if args.command == "orphans":
        emit(orphans())
    elif args.command == "unresolved":
        emit(unresolved())
    elif args.command == "deadends":
        emit(deadends())
    elif args.command == "backlinks":
        emit(backlinks())
    else:
        emit(orphans(), "orphans")
        emit(unresolved(), "unresolved")
        emit(deadends(), "deadends")
    return 0


if __name__ == "__main__":
    sys.exit(main())

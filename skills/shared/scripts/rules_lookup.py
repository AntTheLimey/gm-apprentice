#!/usr/bin/env python3
"""Record-level lookup over the ttrpg-expert systems corpus.

Answers a one-line rules question ("what does Combat Reflexes cost?")
from a single record instead of making the model read a 30 KB reference
file. Indexes every `skills/ttrpg-expert/systems/<system>/**/*.md` and
recognises the three shapes those files actually use:

  * pipe-table rows — the header row supplies the field names
  * bold-lead blocks — `**Name** | ...` or `- **Name** | ...`, the lead
    line plus its continuation lines
  * `### Title` stat blocks — the heading names the record, the
    paragraph under it is the record

Matching runs in tiers, most confident first:

  1. exact — name and query are normalised the same way (casefold,
     `[a-z0-9]+` tokens joined by single spaces, trailing parenthetical
     dropped) and compare equal, so "fast draw" finds "Fast-Draw" and
     "off guard" finds "Off-Guard".
  2. substring — the normalised query is a substring of the normalised
     name.
  3. name-words — every query word (stopwords dropped, a trailing
     plural "s" folded) appears as a whole word in the record's NAME,
     in any order, so "pushing a roll" finds "Pushing Rolls".
  4. weak / "mentions" — the query doesn't name a record, but every
     query word appears as a whole word somewhere in the record's name
     or body text (no stemming of body text: "Fires" never matches
     "fire"), or all but one word do and at least one word hit the
     name. Scored by (words matched, words matched in the name) and
     sorted highest first; reported with a header that says the hit is
     weak and names the query, because these records don't name the
     thing asked for — they mention it.
  5. fuzzy — a difflib near-miss on the name, last resort.

Usage:
  rules_lookup.py SYSTEM "term" [--kind K] [--variant V] [--limit N]
                  [--json] [--personal] [--systems-dir DIR]

SYSTEM is a system slug (`gurps-4e`), a recognised alias (`gurps`,
`dnd`, `pf2e-remaster` and others — see SYSTEM_ALIASES), or `all`
(case-insensitive). It may carry a `/variant` suffix (`coc-7e/regency`)
when the base system has a `variants/<suffix>/` folder; this implies
`--variant <suffix>` (an explicit `--variant` still overrides it). An
unrecognised system or variant exits 2 with the list of valid slugs (or
valid variants), rather than reporting "no such rule" for what is
actually a bad invocation.

Output is one `name<TAB>system<TAB>kind<TAB>file:line<TAB>summary` row
per record, under a `# match: ...` header line; block records print
their text indented two spaces. `--json` instead prints one object,
`{"match": mode, "total": n, "records": [...]}` (plus `"kind_fallback"`
when a `--kind` miss fell back to an unfiltered lookup — see below).
A `--kind` filter that matches nothing falls back to an unfiltered
lookup and says so, rather than reporting "no such rule". Exit 0 on a
match, 1 on none, 2 on a bad invocation (blank term, unknown system or
variant, missing `--systems-dir`).

Copyright: this prints back only what the corpus files already contain,
one record at a time — never a whole table or file, and it writes
nothing to disk (no index, no cache). A blank term is rejected outright
rather than matching (and printing) the whole corpus. Files under
`personal/` are the user's private licensed copies and are skipped
unless `--personal` is passed explicitly.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

SYSTEMS_DIR = Path(__file__).resolve().parents[2] / "ttrpg-expert" / "systems"
# Each system directory ships a licence notice; it is not rules content.
NOTICE_FILE = "NOTICE.md"

# Prefix of a file stem -> the kind of record that file holds. Longest
# prefix wins; a stem with no mapped prefix is its own kind.
KIND_BY_STEM: dict[str, str] = {
    "traits": "trait",
    "skills": "skill",
    "spells": "spell",
    "monsters": "monster",
    "creatures": "monster",
    "animals": "monster",
    "feats": "feat",
    "equipment": "item",
    "magic-items": "item",
    "occupations": "class",
    "playbooks": "class",
    "classes": "class",
    "ancestries": "ancestry",
    "conditions": "condition",
}

# System slug -> the argument a user or a skill might type instead.
# Values must be real top-level directory names under SYSTEMS_DIR; that
# is checked at lookup time (list_systems()), not assumed here, so a
# stale alias fails loudly rather than silently resolving to nothing.
SYSTEM_ALIASES: dict[str, str] = {
    "gurps": "gurps-4e",
    "gurps4e": "gurps-4e",
    "dnd": "dnd-5e-2024",
    "dnd5e": "dnd-5e-2024",
    "5e": "dnd-5e-2024",
    "dnd-5e": "dnd-5e-2024",
    "d&d": "dnd-5e-2024",
    "pf2": "pf2e",
    "pathfinder": "pf2e",
    "pf2e-remaster": "pf2e",
    "coc": "coc-7e",
    "coc7e": "coc-7e",
    "cthulhu": "coc-7e",
    "blades": "fitd",
    "bitd": "fitd",
    "fitd": "fitd",
}

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
HEADING_RE = re.compile(r"^#{1,6}\s")
H3_RE = re.compile(r"^###\s+(.+?)\s*$")
BOLD_LEAD_RE = re.compile(r"^(?:- )?\*\*([^*]+)\*\*(?P<rest>.*)$")
# A bold lead introduces a record only when a column separator, a dash,
# the end of the line, or an optional parenthetical followed by one of
# those follows it (`**Spot Hidden** (25%) — ...`). A colon
# (`**XP trigger**:`) marks a label, not a record.
LEAD_TAIL_RE = re.compile(r"^\s*(?:\([^)]*\)\s*)?(?:[|—–]|--\s|$)")
SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")
TRAILING_TAG_RE = re.compile(r"\s*\[[^\[\]]*\]\s*$")
TRAILING_PAREN_RE = re.compile(r"\s*\([^()]*\)\s*$")
# A table row whose first cell is a bare integer (a level-progression
# table's "Level" column, e.g. GURPS Rogue's `| 1 | ... |`) isn't a
# named record.
NUMERIC_CELL_RE = re.compile(r"^\d+$")

WORD_TOKEN_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    {"a", "an", "the", "of", "to", "in", "on", "for", "and", "or"})

FUZZY_CUTOFF = 0.72


@dataclass
class Record:
    """One looked-up thing: a table row, a bold-lead block, or an H3 block."""

    name: str
    system: str
    kind: str
    file: str
    line: int
    headers: list[str] = field(default_factory=list)
    cells: list[str] = field(default_factory=list)
    text: str = ""
    # "table", "block" (text opens with the bold lead), or "heading"
    # (the `###` line names the record and text is the body).
    shape: str = "block"

    def summary(self) -> str:
        """A one-line gist: the row's fields, or the block's first body line."""
        if self.shape == "table":
            pairs = []
            for i in range(1, len(self.cells)):
                head = self.headers[i] if i < len(self.headers) else ""
                pairs.append(f"{head}={self.cells[i]}")
            return "; ".join(pairs)
        lines = self.text.split("\n")
        if self.shape == "block":
            return lines[1] if len(lines) > 1 else ""
        return lines[0] if lines else ""

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name, "system": self.system, "kind": self.kind,
            "file": self.file, "line": self.line, "headers": self.headers,
            "cells": self.cells, "text": self.text,
        }


def kind_for_stem(stem: str) -> str:
    for prefix in sorted(KIND_BY_STEM, key=len, reverse=True):
        if stem == prefix or stem.startswith(prefix + "-"):
            return KIND_BY_STEM[prefix]
    return stem


def list_systems(systems_dir: Path = SYSTEMS_DIR) -> list[str]:
    """Real system slugs: the top-level directories under `systems_dir`
    (skips loose files such as `shared-patterns.md`)."""
    if not systems_dir.is_dir():
        return []
    return sorted(p.name for p in systems_dir.iterdir() if p.is_dir())


def resolve_system(raw: str, systems_dir: Path = SYSTEMS_DIR) -> str | None:
    """Map a system argument to a real slug: itself if it already is one
    (case-insensitively), else a SYSTEM_ALIASES lookup validated against
    the real slugs, else None."""
    valid = list_systems(systems_dir)
    key = raw.strip().lower()
    for slug in valid:
        if slug.lower() == key:
            return slug
    canonical = SYSTEM_ALIASES.get(key)
    if canonical and canonical in valid:
        return canonical
    return None


def list_variants(base_slug: str, systems_dir: Path = SYSTEMS_DIR) -> list[str]:
    """Variant slugs for a base system: the subdirectories of its
    `variants/` folder (empty if it has none)."""
    variants_dir = systems_dir / base_slug / "variants"
    if not variants_dir.is_dir():
        return []
    return sorted(p.name for p in variants_dir.iterdir() if p.is_dir())


def _fold_plural(word: str) -> str:
    """'rolls' -> 'roll', but not 'his' (too short) or 'cross' (already
    ends 'ss') — a light plural fold, not a stemmer."""
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _normalize_key(text: str) -> str:
    """Casefold, drop a trailing parenthetical, keep only `[a-z0-9]+`
    tokens joined by single spaces. Used by the exact and substring
    tiers so punctuation differences (hyphens, en dashes, a missing
    space) don't matter: "Fast-Draw (Sword)" and "fast draw" both
    normalise to "fast draw"."""
    stripped = TRAILING_PAREN_RE.sub("", text)
    return " ".join(WORD_TOKEN_RE.findall(stripped.casefold()))


def _query_words(term: str) -> list[str]:
    """Query tokens for the word tiers: casefold, `[a-z0-9]+` only,
    stopwords dropped, a trailing plural folded."""
    return [_fold_plural(t) for t in WORD_TOKEN_RE.findall(term.casefold())
            if t not in STOPWORDS]


def _name_words(name: str) -> set[str]:
    """A record name's tokens, normalised the same way as the query —
    stopwords dropped, a trailing plural folded — so the name-words and
    weak tiers can compare them directly."""
    return {_fold_plural(t) for t in WORD_TOKEN_RE.findall(name.casefold())
            if t not in STOPWORDS}


def _text_words(text: str) -> set[str]:
    """A record's body tokens, literal — no stopword drop, no plural
    fold. The weak tier must not let "Fires" match a query for "fire";
    only an exact word counts against body text."""
    return set(WORD_TOKEN_RE.findall(text.casefold()))


def clean_name(raw: str) -> str:
    """Strip bold markers and trailing `[ORC]`-style provenance tags."""
    name = raw.strip().strip("*").strip()
    while True:
        trimmed = TRAILING_TAG_RE.sub("", name)
        if trimmed == name or not trimmed:
            break
        name = trimmed
    return name


def split_cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [cell.strip() for cell in body.split("|")]


def is_separator_row(cells: list[str]) -> bool:
    filled = [c for c in cells if c]
    return bool(filled) and all(SEPARATOR_CELL_RE.match(c) for c in filled)


def system_slug(rel_parts: tuple[str, ...]) -> str:
    """`coc-7e/variants/regency/skills.md` -> `coc-7e/regency`."""
    if len(rel_parts) >= 3 and rel_parts[1] == "variants":
        return f"{rel_parts[0]}/{rel_parts[2]}"
    return rel_parts[0]


def parse_file(path: Path, system: str, rel: str) -> list[Record]:
    """One pass over one file, emitting every record shape it contains."""
    kind = kind_for_stem(path.stem)
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    records: list[Record] = []

    def add(name: str, line_no: int, shape: str, text: str,
            headers: list[str] | None = None,
            cells: list[str] | None = None) -> None:
        if name:
            records.append(Record(
                name=name, system=system, kind=kind, file=rel, line=line_no,
                headers=headers or [], cells=cells or [], text=text,
                shape=shape))

    in_fence = False
    headers: list[str] = []
    pending_header: list[str] | None = None
    in_table = False

    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        if line.strip().startswith("|"):
            cells = split_cells(line)
            if is_separator_row(cells):
                if pending_header:
                    headers = [c.strip("*").strip() for c in pending_header]
                    in_table = True
                pending_header = None
            elif in_table:
                if (cells and cells[0]
                        and not NUMERIC_CELL_RE.match(cells[0].strip())):
                    add(clean_name(cells[0]), i + 1, "table", line.rstrip(),
                        headers, cells)
            else:
                pending_header = cells
            continue

        headers, pending_header, in_table = [], None, False

        heading = H3_RE.match(line)
        if heading:
            body = _h3_body(lines, i)
            if body:
                add(clean_name(heading.group(1)), i + 1, "heading",
                    "\n".join(body))
            continue

        lead = BOLD_LEAD_RE.match(line)
        if lead and LEAD_TAIL_RE.match(lead.group("rest")):
            block = _bold_block(lines, i)
            add(clean_name(lead.group(1)), i + 1, "block", "\n".join(block))

    return records


def _stops_block(line: str) -> bool:
    if HEADING_RE.match(line) or FENCE_RE.match(line):
        return True
    if line.strip().startswith("|"):
        return True
    lead = BOLD_LEAD_RE.match(line)
    return bool(lead and LEAD_TAIL_RE.match(lead.group("rest")))


def _bold_block(lines: list[str], start: int) -> list[str]:
    """Lead line plus continuations: to a blank line, the next record, or
    12 lines, whichever comes first."""
    block = [lines[start].rstrip()]
    for line in lines[start + 1:]:
        if len(block) >= 12 or not line.strip() or _stops_block(line):
            break
        block.append(line.rstrip())
    return block


def _h3_body(lines: list[str], start: int) -> list[str]:
    """Body of a `### Title` record, or empty if the heading only
    introduces a table or another heading."""
    first = start + 1
    while first < len(lines) and not lines[first].strip():
        first += 1
    if first >= len(lines):
        return []
    opener = lines[first]
    if HEADING_RE.match(opener) or opener.strip().startswith("|"):
        return []

    body: list[str] = []
    for line in lines[first:]:
        if HEADING_RE.match(line) or FENCE_RE.match(line):
            break
        if line.strip().startswith("|"):
            break
        if not line.strip() and len(body) >= 15:
            break
        body.append(line.rstrip())
    while body and not body[-1]:
        body.pop()
    return body


def iter_records(systems_dir: Path = SYSTEMS_DIR, *, personal: bool = False,
                 systems: Iterable[str] | None = None) -> Iterator[Record]:
    """Every record under `systems_dir`, in file order then line order."""
    if not systems_dir.is_dir():
        return
    wanted = set(systems) if systems is not None else None
    for path in sorted(systems_dir.rglob("*.md")):
        rel_parts = path.relative_to(systems_dir).parts
        if len(rel_parts) < 2:
            continue  # a loose file such as shared-patterns.md
        if rel_parts[-1] == NOTICE_FILE:
            continue
        if wanted is not None and rel_parts[0] not in wanted:
            continue
        if not personal and "personal" in rel_parts[:-1]:
            continue
        rel = "/".join(rel_parts)
        yield from parse_file(path, system_slug(rel_parts), rel)


def _sort_key(rec: Record) -> tuple[str, str, int]:
    return (rec.system, rec.file, rec.line)


def _confident_sort_key(rec: Record) -> tuple[int, str, str, int]:
    """For the exact/substring/name-words tiers: the shortest,
    least-decorated name sorts first (plain "Fast-Draw" ahead of
    "Fast-Draw (Sword)"), tie-broken by file order. Every record in
    these tiers is an equally valid match — this only orders which
    shows up first when several normalise the same way."""
    return (len(rec.name), *_sort_key(rec))


def _matches_filters(rec: Record, system: str | None, kind: str | None,
                     variant: str | None) -> bool:
    base, _, rec_variant = rec.system.partition("/")
    if rec_variant and rec_variant != variant:
        return False
    if system is not None and rec.system != system and base != system:
        return False
    if kind is not None and rec.kind != kind:
        return False
    return True


def lookup(term: str, *, system: str | None = None, kind: str | None = None,
           variant: str | None = None, limit: int = 10,
           personal: bool = False,
           systems_dir: Path = SYSTEMS_DIR
           ) -> tuple[str, list[Record], int]:
    """Find `term`, best tier first. Returns (match_mode, records, total)
    where `total` is the number of records at the reported tier before
    `--limit` truncates the list — so a caller can tell "5 shown" from
    "5 shown of 40 found".

    A blank (or all-whitespace) term matches nothing: an empty needle is
    a substring of every record name, which would otherwise dump close
    to the whole corpus — the opposite of this module's one-record-at-a-
    time copyright guard.
    """
    if not term.strip():
        return "none", [], 0
    systems = [system.split("/")[0]] if system else None
    candidates = [rec for rec in iter_records(systems_dir, personal=personal,
                                              systems=systems)
                  if _matches_filters(rec, system, kind, variant)]

    query_key = _normalize_key(term)
    exact: list[Record] = []
    substring: list[Record] = []
    for rec in candidates:
        name_key = _normalize_key(rec.name)
        if name_key == query_key:
            exact.append(rec)
        elif query_key and query_key in name_key:
            substring.append(rec)

    # Tiers are exclusive: a hit in a higher tier stops the lower ones
    # from being reported at all, so "exact (N)" never silently counts
    # substring rows in N (#M4).
    if exact:
        hits = sorted(exact, key=_confident_sort_key)
        return "exact", hits[:limit], len(hits)
    if substring:
        hits = sorted(substring, key=_confident_sort_key)
        return "substring", hits[:limit], len(hits)

    words = _query_words(term)
    if words:
        word_set = set(words)
        name_hits = [rec for rec in candidates
                    if word_set <= _name_words(rec.name)]
        if name_hits:
            hits = sorted(name_hits, key=_confident_sort_key)
            return "name-words", hits[:limit], len(hits)

        # Weak "mentions" tier: no record is named this, but some
        # mention every word (or all but one, with at least one word
        # landing in the name — that's the "Breathe Fire" case, a spell
        # named for one of the two query words whose short text doesn't
        # happen to repeat the other). Body text is matched literally,
        # never stemmed, so "Fires" never counts as "fire" (#C1).
        # Names compare folded tokens; body text compares the query's raw
        # tokens, so "bonus" (folded to "bonu") still matches a body
        # "bonus" while "fire" still never matches "fires".
        raw = [t for t in WORD_TOKEN_RE.findall(term.casefold())
               if t not in STOPWORDS]
        pairs = list(zip(words, raw))
        scored: list[tuple[tuple[int, int], Record]] = []
        for rec in candidates:
            name_toks = _name_words(rec.name)
            text_toks = _text_words(rec.text)
            matched = sum(1 for w, r in pairs
                          if w in name_toks or r in text_toks)
            name_hit_count = sum(1 for w in words if w in name_toks)
            if (matched == len(words)
                    or (name_hit_count >= 1 and matched >= len(words) - 1)):
                scored.append(((matched, name_hit_count), rec))
        if scored:
            scored.sort(key=lambda pair: _sort_key(pair[1]))
            scored.sort(key=lambda pair: (-pair[0][0], -pair[0][1]))
            hits = [rec for _, rec in scored]
            return "weak", hits[:limit], len(hits)

    names = sorted({rec.name.casefold() for rec in candidates})
    close = difflib.get_close_matches(term.casefold(), names, n=limit,
                                      cutoff=FUZZY_CUTOFF)
    if not close:
        return "none", [], 0
    rank = {name: i for i, name in enumerate(close)}
    fuzzy = [rec for rec in candidates if rec.name.casefold() in rank]
    fuzzy.sort(key=lambda rec: (rank[rec.name.casefold()], _sort_key(rec)))
    return "fuzzy", fuzzy[:limit], len(fuzzy)


def render(mode: str, records: list[Record], *, total: int = 0,
          kind: str | None = None, fallback: list[Record] | None = None,
          term: str | None = None) -> str:
    if mode == "none":
        if kind and fallback:
            out = [f"# match: none for kind={kind} — closest without it:"]
            records = fallback
        else:
            return "# match: none"
    elif mode == "fuzzy":
        out = ["# match: fuzzy — no exact hit, closest:"]
    elif mode == "weak":
        quoted = f'"{term}"' if term else "the term"
        header = (f'# match: weak ({total}) — {quoted} is not a record '
                  f"name; these records mention its words. Open the "
                  f"file before answering.")
        if total > len(records):
            header += (f" (showing {len(records)}, "
                      f"{total - len(records)} suppressed by --limit)")
        out = [header]
    else:
        header = f"# match: {mode} ({total})"
        if total > len(records):
            header += (f" — showing {len(records)}, "
                      f"{total - len(records)} suppressed by --limit")
        out = [header]
    for rec in records:
        out.append("\t".join([rec.name, rec.system, rec.kind,
                              f"{rec.file}:{rec.line}", rec.summary()]))
        if rec.shape != "table":
            out.extend("  " + line for line in rec.text.split("\n"))
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Look up one rules record in the systems corpus.")
    parser.add_argument("system",
                        help="system slug, a recognised alias, or 'all'")
    parser.add_argument("term", help="name to look up")
    parser.add_argument("--kind", help="restrict to one record kind")
    parser.add_argument("--variant", help="include this variant's records")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--json", action="store_true",
                        help="emit the records as JSON instead of rows")
    parser.add_argument("--personal", action="store_true",
                        help="also read the gitignored personal/ files")
    parser.add_argument("--systems-dir", type=Path, default=SYSTEMS_DIR)
    args = parser.parse_args(argv)

    if not args.systems_dir.is_dir():
        print(f"error: no systems directory at {args.systems_dir}",
              file=sys.stderr)
        return 2
    if not args.term.strip():
        print("error: blank lookup term", file=sys.stderr)
        return 2

    if args.system.strip().lower() == "all":
        system: str | None = None
        implied_variant: str | None = None
    else:
        base_part, _, variant_part = args.system.partition("/")
        base = resolve_system(base_part, args.systems_dir)
        if base is None:
            valid = list_systems(args.systems_dir)
            print(f"error: unknown system {base_part!r} — valid slugs: "
                  f"{', '.join(valid)}, all", file=sys.stderr)
            return 2
        if variant_part:
            valid_variants = list_variants(base, args.systems_dir)
            implied_variant = next(
                (v for v in valid_variants
                 if v.lower() == variant_part.strip().lower()), None)
            if implied_variant is None:
                detail = (f"valid variants: {', '.join(valid_variants)}"
                          if valid_variants else "it has no variants")
                print(f"error: unknown variant {variant_part!r} for "
                      f"system {base!r} — {detail}", file=sys.stderr)
                return 2
        else:
            implied_variant = None
        system = base

    variant = args.variant or implied_variant

    mode, records, total = lookup(
        args.term, system=system, kind=args.kind, variant=variant,
        limit=args.limit, personal=args.personal,
        systems_dir=args.systems_dir)

    fallback: list[Record] = []
    fallback_mode = "none"
    fallback_total = 0
    if mode == "none" and args.kind:
        fallback_mode, fallback, fallback_total = lookup(
            args.term, system=system, kind=None, variant=variant,
            limit=args.limit, personal=args.personal,
            systems_dir=args.systems_dir)

    if args.json:
        if records:
            payload: dict[str, object] = {
                "match": mode, "total": total,
                "records": [rec.as_dict() for rec in records]}
        elif fallback:
            payload = {
                "match": mode, "kind_fallback": fallback_mode,
                "total": fallback_total,
                "records": [rec.as_dict() for rec in fallback]}
        else:
            payload = {"match": mode, "total": total, "records": []}
        print(json.dumps(payload, indent=2))
    else:
        print(render(mode, records, total=total, kind=args.kind,
                     fallback=fallback, term=args.term))
    return 0 if records else 1


if __name__ == "__main__":
    sys.exit(main())

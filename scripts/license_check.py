"""License-scope check for skills/ttrpg-expert/systems/.

attribution_check.py proves each file carries its notice. This proves the
content stays inside what the notice licenses. Two independent checks:

GURPS: benchmark against the GCS master library
    GURPS is licensed under the SJG Online Policy. The GCS (GURPS Character
    Sheet) master library, https://github.com/richardwilkes/gcs_master_library,
    is the public, long-standing precedent for what a fan aid carries. The
    rule this repo holds itself to: an item table (weapons, armour, gear,
    skills, spells, traits, modifiers) may not have a column, or a note
    longer than, what GCS carries for the same kind of thing. Rows are free —
    only the shape of the data is benchmarked.
      * ERROR  a column with no GCS field behind it, unless it is in
               OWN_COLUMNS (columns this repo authors, not book data);
      * ERROR  a Notes cell longer than the longest GCS note for that kind.
    Tables that are not item data (rules charts: Thrust/Swing, hit
    locations, reaction rolls ...) have no GCS counterpart, so they cannot be
    benchmarked. They are never failed; --review lists them for a human.
    GCS is precedent, not a licence: its own README relies on the same SJG
    Online Policy.

PF2e: shingle overlap against the local ORC dataset (--shingles; local only)
    Policy is paraphrased mechanics: game math and names, never verbatim
    rules text. Every SHINGLE-word window of a prose line is looked up in the
    corpus; a run of matched windows of at least MIN_RUN_WORDS is verbatim
    copying. Table rows are game math and are skipped. Not scanned,
    deliberately: D&D 5e and Forged in the Dark (CC-BY permits verbatim SRD
    text) and CoC/BRP (the ORC License covers the mechanics).

Run:
  python3 scripts/license_check.py                    # GURPS vs GCS
  python3 scripts/license_check.py --review           # + list rules tables
  python3 scripts/license_check.py --files FILE...    # only these files
  python3 scripts/license_check.py --shingles         # + PF2e corpus overlap
GCS is found via --gcs, $GCS_MASTER_LIBRARY, or ~/PROJECTS/gcs_master_library.
Without it the GURPS check is skipped, unless --require-gcs (CI) is given.
Exit 0 clean, 1 on any finding.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
SYSTEMS_REL = Path("skills/ttrpg-expert/systems")

# --- GURPS / GCS benchmark ---
# our column (lowercase) -> GCS field. "w:x" is a field of a row's weapon
# entry. A field must exist somewhere in the GCS library of that kind, which
# is verified at run time, so a wrong mapping fails loudly.
_WEAPON_COLUMNS = {
    "skill": "w:defaults",
    "dmg": "w:damage",
    "damage": "w:damage",
    "reach": "w:reach",
    "parry": "w:parry",
    "block": "w:block",
    "st": "w:strength",
    "acc": "w:accuracy",
    "range": "w:range",
    "rof": "w:rate_of_fire",
    "shots": "w:shots",
    "bulk": "w:bulk",
    "rcl": "w:recoil",
}
COLUMN_MAP: dict[str, dict[str, str]] = {
    "eqp": {
        **dict.fromkeys(
            ("weapon", "item", "armor", "armour", "suit", "shield", "grenade", "ammo", "kit"),
            "description",
        ),
        "tl": "tech_level",
        "cost": "base_value",
        "cost ($)": "base_value",
        "wt": "base_weight",
        "weight (lbs)": "base_weight",
        "page": "reference",
        "notes": "local_notes",
        # GCS carries these as structured features or as notes text.
        "location": "features",
        "dr": "features",
        "db": "features",
        "hp": "local_notes",
        "fuse": "local_notes",
        **_WEAPON_COLUMNS,
    },
    "skl": {
        **dict.fromkeys(("skill", "technique", "path"), "name"),
        **dict.fromkeys(("diff", "attr/diff", "stat"), "difficulty"),
        "specialization": "specialization",
        "page": "reference",
        "defaults": "defaults",
        "default": "default",
        "max": "limit",
        "notes": "local_notes",
    },
    "spl": {
        "spell": "name",
        "diff": "difficulty",
        "cost": "casting_cost",
        "dur": "duration",
        "page": "reference",
        "prereq": "prereqs",
        "notes": "local_notes",
    },
    "adq": {
        **dict.fromkeys(("trait", "quirk", "perk"), "name"),
        "cost": "base_points",
        "cost/level": "points_per_level",
        "self-control": "cr",
        "page": "reference",
        "notes": "local_notes",
    },
    "adm": {
        **dict.fromkeys(("enhancement", "limitation"), "name"),
        "cost": "cost_adj",
        "effect": "local_notes",
        "page": "reference",
        "notes": "local_notes",
    },
}
# A table is an item table when its first column names one of these.
LIB_BY_FIRST_COLUMN = {
    col: lib for lib, cols in COLUMN_MAP.items() for col in cols
    if col in (
        "weapon", "item", "armor", "armour", "suit", "shield", "grenade", "ammo", "kit",
        "skill", "technique", "path", "specialization", "spell", "trait",
        "quirk", "perk", "enhancement", "limitation",
    )
}
GCS_GLOBS = {
    "eqp": "**/*.eqp",
    "skl": "**/*.skl",
    "spl": "**/*.spl",
    "adq": "**/*.adq",
    "adm": "**/*.adm",
}
# A table with two or more of these looks like item data even when its first
# column is not one we recognise; that is an error, never a silent skip.
ITEM_LIKE_COLUMNS = frozenset(
    "dmg damage reach parry acc rof shots bulk rcl defaults prereq dur wt tl".split()
)
# Columns this repo authors — derived numbers or play guidance, not book
# data — so no GCS field can exist for them.
OWN_COLUMNS = frozenset(
    {
        "cost for iq 14 scholar",  # our worked example
        "use when...",  # our guidance
        "vs. npc's",  # our guidance
        "also in",  # our cross-reference
        "primary",  # our cross-reference
        "attribute",  # our grouping
    }
)
# Book-coverage tracker, not rules content.
EXEMPT_FILES = frozenset({"sources.md"})
# A table whose cells are almost all empty is a blank form, not data.
BLANK_FORM_FILL = 0.10

# --- PF2e shingle settings ---
SHINGLE = 10
MIN_RUN_WORDS = 15
CORPORA: dict[str, list[str]] = {"pf2e": ["pf2e-orc-dataset/data"]}
SYSTEM_DIRS = {"pf2e": "pf2e"}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        loc = f"{self.path}:{self.line}" if self.line else self.path
        return f"ERROR {loc}: {self.message}"


@dataclass(frozen=True)
class RulesTable:
    path: str
    line: int
    header: tuple[str, ...]
    rows: int


@dataclass
class Gcs:
    keys: dict[str, Counter[str]] = field(default_factory=dict)
    weapon_keys: dict[str, Counter[str]] = field(default_factory=dict)
    max_notes: dict[str, int] = field(default_factory=dict)

    def has_field(self, lib: str, gcs_field: str) -> bool:
        if gcs_field.startswith("w:"):
            return self.weapon_keys[lib].get(gcs_field[2:], 0) > 0
        return self.keys[lib].get(gcs_field, 0) > 0


def _rows_of(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(rows: list[dict[str, Any]]) -> None:
        for r in rows:
            out.append(r)
            walk(r.get("children") or [])

    walk(json.loads(path.read_text(encoding="utf-8")).get("rows", []))
    return out


def _words(text: Any) -> int:
    return len(text.split()) if isinstance(text, str) else 0


def load_gcs(root: Path) -> Gcs | None:
    library = root / "Library"
    if not library.is_dir():
        return None
    gcs = Gcs()
    for lib, pattern in GCS_GLOBS.items():
        keys: Counter[str] = Counter()
        wkeys: Counter[str] = Counter()
        longest = 0
        for path in library.glob(pattern):
            for row in _rows_of(path):
                keys.update(row.keys())
                longest = max(longest, _words(row.get("local_notes")))
                for w in row.get("weapons") or []:
                    wkeys.update(w.keys())
                    longest = max(longest, _words(w.get("usage_notes")))
        gcs.keys[lib], gcs.weapon_keys[lib], gcs.max_notes[lib] = keys, wkeys, longest
    return gcs


_UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")
_QUOTE_PREFIX = re.compile(r"^\s*(?:>\s?)*")


def _cells(row: str) -> list[str]:
    """Split a pipe-table row; leading/trailing pipes optional, \\| is not a split."""
    body = _QUOTE_PREFIX.sub("", row).strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    return [c.strip() for c in _UNESCAPED_PIPE.split(body)]


def _is_separator(row: str) -> bool:
    if "|" not in row:
        return False
    cells = _cells(row)
    return bool(cells) and all(re.fullmatch(r":?-+:?", c) for c in cells)


def _tables(lines: list[str]) -> list[tuple[int, list[str], list[list[str]]]]:
    """(header line number, header cells, data rows) for every pipe table.

    A table is a header line containing a pipe followed by a separator row, so
    tables without outer pipes, indented tables and tables inside blockquotes
    are all found.
    """
    found = []
    in_fence = False
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
            i += 1
            continue
        if (
            in_fence
            or i + 1 >= len(lines)
            or "|" not in lines[i]
            or not _is_separator(lines[i + 1])
        ):
            i += 1
            continue
        j = i + 2
        while j < len(lines) and "|" in lines[j] and _QUOTE_PREFIX.sub("", lines[j]).strip():
            j += 1
        found.append((i + 1, _cells(lines[i]), [_cells(r) for r in lines[i + 2 : j]]))
        i = j
    return found


def _is_blank_form(header: list[str], rows: list[list[str]]) -> bool:
    """Almost every cell empty. A leading '#' column is a row counter, not data."""
    skip = 1 if header and header[0].strip() == "#" else 0
    cells = [c for r in rows for c in r[skip:]]
    return not cells or sum(1 for c in cells if c) / len(cells) < BLANK_FORM_FILL


def check_gurps_file(
    path: Path, rel: str, gcs: Gcs
) -> tuple[list[Finding], list[RulesTable]]:
    findings: list[Finding] = []
    review: list[RulesTable] = []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for line_no, header, rows in _tables(lines):
        cols = [re.sub(r"[*_`]", "", h).strip().lower() for h in header]
        lib = LIB_BY_FIRST_COLUMN.get(cols[0])
        if lib is None:
            if _is_blank_form(header, rows):
                continue
            like = [c for c in cols if c in ITEM_LIKE_COLUMNS]
            if len(like) >= 2:
                findings.append(
                    Finding(
                        rel,
                        line_no,
                        f"table looks like item data (columns {', '.join(like)}) "
                        f'but its first column "{header[0]}" is not recognised — '
                        f"rename it or add it to LIB_BY_FIRST_COLUMN",
                    )
                )
            else:
                review.append(RulesTable(rel, line_no, tuple(header), len(rows)))
            continue
        for col, name in zip(cols, header):
            if col in OWN_COLUMNS:
                continue
            target = COLUMN_MAP[lib].get(col)
            if target is None or not gcs.has_field(lib, target):
                findings.append(
                    Finding(
                        rel,
                        line_no,
                        f'column "{name}" has no GCS field ({lib}) — GCS does '
                        f"not carry this for {lib} data",
                    )
                )
        note_cols = [i for i, c in enumerate(cols) if c == "notes"]
        for offset, row in enumerate(rows):
            if len(row) != len(header):
                findings.append(
                    Finding(
                        rel,
                        line_no + 2 + offset,
                        f"row has {len(row)} cells but the header has "
                        f"{len(header)} — cells cannot be benchmarked",
                    )
                )
                continue
            for ni in note_cols:
                w = _words(row[ni])
                if w > gcs.max_notes[lib]:
                    findings.append(
                        Finding(
                            rel,
                            line_no + 2 + offset,
                            f"note is {w} words; the longest GCS {lib} note "
                            f"is {gcs.max_notes[lib]}",
                        )
                    )
    return findings, review


# ------------------------------------------------------------------ shingles


def _tokens_with_lines(
    text: str, skip_tables: bool = False
) -> tuple[list[str], list[int]]:
    """Lowercase word tokens (markdown punctuation dropped) and their lines.

    skip_tables drops table rows: on the repo side they are game math and
    names, which the licence allows, and a table's cells otherwise fuse into
    one long false "run".
    """
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for k in range(1, len(lines)):
            if lines[k].strip() == "---":
                start = k + 1
                break
    toks: list[str] = []
    nums: list[int] = []
    for n in range(start, len(lines)):
        if skip_tables and lines[n].lstrip().startswith("|"):
            continue
        for w in re.findall(r"[a-z0-9']+", lines[n].lower()):
            toks.append(w)
            nums.append(n + 1)
    return toks, nums


def _corpus_files(root: Path, rels: list[str]) -> list[Path]:
    files: list[Path] = []
    for rel in rels:
        p = root / rel
        if p.is_dir():
            files += sorted(p.rglob("*.md"))
        elif p.is_file():
            files.append(p)
    return files


def shingle_scan(
    repo_files: list[Path],
    corpus_files: list[Path],
    repo: Path,
    corpus_root: Path,
) -> list[Finding]:
    # Index the (small) repo side; stream the (large) corpus past it.
    index: dict[int, list[tuple[int, int]]] = {}
    docs: list[tuple[str, list[int]]] = []
    for d, f in enumerate(repo_files):
        toks, nums = _tokens_with_lines(
            f.read_text(encoding="utf-8", errors="replace"), skip_tables=True
        )
        docs.append((str(f.relative_to(repo)), nums))
        for i in range(len(toks) - SHINGLE + 1):
            index.setdefault(hash(" ".join(toks[i : i + SHINGLE])), []).append((d, i))

    hits: dict[int, dict[int, str]] = {}
    for cf in corpus_files:
        toks, _ = _tokens_with_lines(cf.read_text(encoding="utf-8", errors="replace"))
        src = str(cf.relative_to(corpus_root))
        for i in range(len(toks) - SHINGLE + 1):
            found = index.get(hash(" ".join(toks[i : i + SHINGLE])))
            if found:
                for d, pos in found:
                    hits.setdefault(d, {}).setdefault(pos, src)

    findings: list[Finding] = []
    for d, by_pos in sorted(hits.items()):
        rel, nums = docs[d]
        positions = sorted(by_pos)
        run_start = prev = positions[0]
        for pos in positions[1:] + [-2]:
            if pos == prev + 1:
                prev = pos
                continue
            words = prev - run_start + SHINGLE
            if words >= MIN_RUN_WORDS:
                findings.append(
                    Finding(
                        rel,
                        nums[run_start],
                        f"{words} consecutive words match the reference corpus "
                        f"({by_pos[run_start]}) — paraphrase it",
                    )
                )
            run_start = prev = pos
    return findings


# ---------------------------------------------------------------------- main


def _system_of(path: Path, repo: Path) -> str | None:
    try:
        parts = path.resolve().relative_to((repo / SYSTEMS_REL).resolve()).parts
    except ValueError:
        return None
    return parts[0] if parts else None


def _distributed(system_dir: Path) -> list[Path]:
    return sorted(
        p
        for p in system_dir.rglob("*.md")
        if "personal" not in p.relative_to(system_dir).parts
    )


def _default_gcs() -> Path:
    return Path(
        os.environ.get("GCS_MASTER_LIBRARY", Path.home() / "PROJECTS/gcs_master_library")
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", type=Path, default=REPO)
    ap.add_argument("--files", nargs="+", type=Path, help="check only these files")
    ap.add_argument("--gcs", type=Path, default=_default_gcs(), help="GCS master library checkout")
    ap.add_argument(
        "--require-gcs",
        action="store_true",
        help="fail, rather than skip, when GCS is not available (CI)",
    )
    ap.add_argument(
        "--review",
        action="store_true",
        help="list GURPS rules tables that GCS cannot benchmark",
    )
    ap.add_argument(
        "--shingles",
        action="store_true",
        help="also scan PF2e against the local reference corpus (never in CI)",
    )
    ap.add_argument(
        "--corpus-root",
        type=Path,
        default=Path(
            os.environ.get("GM_REFERENCE_SRDS", Path.home() / "PROJECTS/reference-srds")
        ),
    )
    args = ap.parse_args(argv)
    repo: Path = args.repo.resolve()
    systems = repo / SYSTEMS_REL

    if args.files:
        targets = [f.resolve() for f in args.files]
    else:
        targets = [f for s in sorted(systems.iterdir()) if s.is_dir() for f in _distributed(s)]

    findings: list[Finding] = []
    review: list[RulesTable] = []
    gurps = [
        f for f in targets
        if _system_of(f, repo) == "gurps-4e" and f.name not in EXEMPT_FILES
    ]
    if gurps or args.require_gcs:
        gcs = load_gcs(args.gcs)
        if gcs is None:
            msg = f"GCS master library not found at {args.gcs}"
            if args.require_gcs:
                findings.append(Finding("gcs", 0, msg))
            else:
                print(f"license_check: {msg} — GURPS check skipped", file=sys.stderr)
        else:
            for f in gurps:
                got, rev = check_gurps_file(f, str(f.relative_to(repo)), gcs)
                findings += got
                review += rev

    if args.shingles:
        for system, rels in CORPORA.items():
            files = [f for f in targets if _system_of(f, repo) == SYSTEM_DIRS[system]]
            corpus = _corpus_files(args.corpus_root, rels)
            if not files:
                continue
            if not corpus:
                print(
                    f"license_check: no corpus for {system} under "
                    f"{args.corpus_root} — skipped",
                    file=sys.stderr,
                )
                continue
            findings += shingle_scan(files, corpus, repo, args.corpus_root)

    for f in findings:
        print(f)
    if args.review:
        print_review(review)
    elif review:
        print(
            f"license_check: {len(review)} GURPS rules tables "
            f"({sum(r.rows for r in review)} rows) have no GCS counterpart; "
            f"--review lists them",
            file=sys.stderr,
        )
    if findings:
        print(f"\n{len(findings)} license-scope finding(s).", file=sys.stderr)
        return 1
    print("license_check: clean")
    return 0


def print_review(review: list[RulesTable]) -> None:
    print(f"\nRULES TABLES WITH NO GCS COUNTERPART: {len(review)} tables, "
          f"{sum(r.rows for r in review)} rows")
    by_file: dict[str, list[RulesTable]] = {}
    for r in review:
        by_file.setdefault(r.path, []).append(r)
    for path, tables in sorted(by_file.items()):
        print(f"\n{Path(path).name} ({sum(t.rows for t in tables)} rows)")
        for t in tables:
            print(f"  L{t.line:<4d} {t.rows:3d} rows  {' | '.join(t.header)}")


if __name__ == "__main__":
    sys.exit(main())

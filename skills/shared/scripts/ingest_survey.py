#!/usr/bin/env python3
"""Classify vault-ingest source material without reading everything blind.

Backs vault-ingest Phase 1 (`references/classification-taxonomy.md`). Three
of the taxonomy's nine rows are decidable with zero content read (extension
or existing frontmatter alone): Image/map, Spreadsheet/data, Session wrap-up.
The other six — play transcript, play fragment, scenario prep,
research/brainstorm, Keeper recollection, character sheet — are scored
against the literal indicator phrases the taxonomy already names, with
per-indicator hit counts and line numbers as evidence. Word/PDF files carry
no stdlib text extraction here and are reported UNSCORED rather than guessed
at.

This turns "read all source material" into "read the manifest, then read
only the files the manifest flags as ambiguous."

Not mechanized, on purpose (the taxonomy names these as judgment calls, not
literal patterns): "specific PC actions with outcomes", "multiple
alternative outcomes listed", "multiple options being evaluated", "handout
text not confirmed as found by players", section-level splitting of a mixed
document, and name-variant reconciliation (already covered by
`vault_check.py names`).

Usage
-----
  ingest_survey.py DIR
  ingest_survey.py VAULT --archive FILE [FILE ...]

Survey mode walks DIR recursively (hidden files/dirs, `_processed`, `__pycache__`
and `.git` skipped) and prints one row per file:

  VERDICT<TAB>path<TAB>proposal<TAB>confidence<TAB>evidence

VERDICT is DECIDED (extension or frontmatter alone settles it — zero
content read), SCORED (content read, indicators counted, GM/model
confirmation still wanted), UNSCORED (binary/unsupported format — Word,
PDF, VTT — needs a manual read), or ERROR (unreadable). A trailer line
follows:

  # N files: D decided, S scored, U unscored, E errors

Archive mode (`--archive`) implements Gotcha 5 — move processed `_inbox/`
files to `_inbox/_processed/<date>/`, preserving their relative path under
`_inbox/`, never deleting, never overwriting an existing archived copy
(a name collision gets a numeric suffix). VAULT here is the vault root, and
each FILE may be given vault-relative (`_inbox/notes/a.txt`),
`_inbox/`-relative (`notes/a.txt`), or absolute — all three resolve to the
same file, and a path that lands outside `_inbox/` (or inside
`_inbox/_processed/`, i.e. already archived) is refused. Dry-run by
default, matching every other mutating script in `shared/scripts/` —
prints `WOULD-ARCHIVE<TAB>path<TAB>-> new-path` and moves nothing; pass
`--write` to actually move. A move that fails (permissions, cross-device)
is reported as `ERROR<TAB>path<TAB>reason`, not a crash. A trailer line
follows: `# archived: N files, E errors` (or `dry-run would archive`).
Mutually exclusive with survey mode — makes its own row vocabulary.

Exit status
-----------
0  no ERROR row.
1  at least one ERROR row.
2  usage (bad arguments; DIR/VAULT missing or not a directory).
"""
from __future__ import annotations

import argparse
import datetime
import os
import re
import shutil
import sys
from collections.abc import Iterator
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaultlib import (  # noqa: E402
    WRAP_UP_TYPES,
    entity_type,
    extract_frontmatter,
)

# --------------------------------------------------------------------------
# Zero-read classification (extension / frontmatter alone)
# --------------------------------------------------------------------------

# classification-taxonomy.md:16 — exact enumeration.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".heic",
              ".tiff", ".tif", ".bmp", ".raw", ".cr2", ".nef", ".arw", ".dng"}
SPREADSHEET_EXTS = {".csv", ".xls", ".xlsx"}
TEXT_EXTS = {".md", ".markdown", ".txt"}
# Formats the "Supported formats" list names but stdlib cannot extract text
# from — reported UNSCORED rather than guessed at.
UNSCORED_EXTS = {".doc", ".docx", ".pdf", ".vtt"}

SKIP_DIR_NAMES = {"_processed", "__pycache__", ".git"}


def walk(root: Path) -> list[Path]:
    """Every file under root, sorted, skipping hidden files/dirs (matching
    vaultlib.vault_files's own convention — a hidden file's own name, not
    just a hidden parent dir, is skipped) and archive/junk dirs. Not
    vault-scoped — DIR may be an external folder or `_inbox/`."""
    out = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(p.startswith(".") for p in rel_parts):
            continue
        if any(p in SKIP_DIR_NAMES for p in rel_parts[:-1]):
            continue
        out.append(path)
    return out


# --------------------------------------------------------------------------
# Content scoring — literal patterns from classification-taxonomy.md
# --------------------------------------------------------------------------

# Each entry: (label, compiled pattern). Hits are counted per file with the
# first three matching line numbers kept as evidence.
INDICATORS: list[tuple[str, re.Pattern]] = [
    ("play_dice", re.compile(
        # Verb and pronoun are case-insensitive (a sentence may open with
        # "Rolled a 15" or "Failed his Listen"); the skill name that
        # follows must still be capitalised, so "failed his attempt" is
        # not a dice indicator.
        r"\b(?i:rolled) (?:a |an )?\d+\b"
        r"|\b(?i:failed|succeeded|passed)\s+(?i:her|his|their|its)\s+"
        r"[A-Z][\w' -]{1,30}\b",
    )),
    ("play_dialogue", re.compile(
        r"\bsaid to (?:the group|them|the (?:investigators|party))\b",
        re.IGNORECASE,
    )),
    ("play_vitals", re.compile(
        # A *change* — a signed delta, "lost N", or a current/max pair — is
        # a play event. A bare "SAN 65" is a character sheet's static
        # value, not a play indicator; charsheet_stats below owns that
        # shape, so the two indicators don't fight over the same line.
        r"\b(?:SAN|HP|MP)\s*[:\-]?\s*[+-]\d+\b"
        r"|\blost \d+\s*(?:SAN|HP|MP|sanity|hit points)\b"
        r"|\b\d+/\d+\s*(?:HP|SAN)\b",
        re.IGNORECASE,
    )),
    ("play_combat", re.compile(
        r"\bround \d+\b|\binitiative\b", re.IGNORECASE,
    )),
    ("prep_conditional", re.compile(
        r"\bif the (?:investigators|party|players|pcs)\b", re.IGNORECASE,
    )),
    ("prep_directive", re.compile(
        r"\bthe (?:gm|keeper|dm) should\b|\bat this point\b", re.IGNORECASE,
    )),
    ("research_qa", re.compile(
        r"^\s*(?:Q|Question)\s*:"
        r"|\bwhat would happen if\b",
        re.IGNORECASE | re.MULTILINE,
    )),
    ("keeper_recollection", re.compile(
        r"\bI remember\b|\bI recall\b|\bthe group did\b", re.IGNORECASE,
    )),
    ("charsheet_stats", re.compile(
        r"\b(?:STR|DEX|CON|INT|POW|APP|SIZ|EDU|HP|MP|SAN|ST|DX|IQ|HT)"
        r"\s*[:=]?\s*\d{1,3}\b"
        r"|\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|"
        r"Charisma|Hit Points?|Sanity)\s*[:=]?\s*\d{1,3}\b",
    )),
]

# Tense-shift evidence (mechanization-analysis.md §Tier 2 #12): reported
# alongside the proposal, never decides it — the mixed-document split stays
# a model/GM judgment call.
PAST_TENSE_RE = re.compile(
    r"\b\w+ed\b|\bwas\b|\bwere\b|\bhad\b", re.IGNORECASE)
CONDITIONAL_RE = re.compile(
    r"\bwould\b|\bshould\b|\bcould\b|\bmight\b|\bif\b", re.IGNORECASE)


def score(text: str) -> tuple[dict[str, int], dict[str, list[int]],
                              tuple[int, int]]:
    """(counts, evidence-lines, (past, conditional) tense tally).

    `counts` is the true per-indicator hit total, uncovered by any cap —
    `propose` decides on this. `evidence` is the same indicators' line
    numbers capped at 3 each, for the report only; a file with forty stat
    lines and one with three both show "(L6,7,8)", but their counts (40 vs
    3) still differ and drive different confidence.
    """
    lines = text.splitlines()
    counts: dict[str, int] = {name: 0 for name, _ in INDICATORS}
    evidence: dict[str, list[int]] = {name: [] for name, _ in INDICATORS}
    for lineno, line in enumerate(lines, start=1):
        for name, pattern in INDICATORS:
            # findall, not search: a stat block routinely packs several
            # matches ("STR 50 CON 60 SIZ 55...") onto one line, and a
            # per-line boolean undercounted exactly the files this
            # indicator exists to recognize.
            n = len(pattern.findall(line))
            if n:
                counts[name] += n
                if len(evidence[name]) < 3:
                    evidence[name].append(lineno)
    past = sum(len(PAST_TENSE_RE.findall(line)) for line in lines)
    conditional = sum(len(CONDITIONAL_RE.findall(line)) for line in lines)
    return counts, evidence, (past, conditional)


def propose(counts: dict[str, int]) -> tuple[str, str]:
    """(classification, confidence) from true indicator counts."""
    play = sum(counts[k] for k in
               ("play_dice", "play_dialogue", "play_vitals", "play_combat"))
    prep = sum(counts[k] for k in ("prep_conditional", "prep_directive"))
    research = counts["research_qa"]
    keeper = counts["keeper_recollection"]
    charsheet = counts["charsheet_stats"]

    # Tested before play: a character sheet's attribute block routinely
    # trips a handful of play-shaped patterns (a stray "HP 12", a "round"
    # in prose) without being one — structured stats dominating the line
    # count is the stronger signal.
    if charsheet >= 3 and charsheet > play:
        return "Character sheet", "high" if charsheet >= 6 else "medium"
    if play:
        if prep or research or keeper:
            return ("Play fragment (mixed content — consider a section "
                    "split)", "medium")
        return "Play transcript", "high" if play >= 3 else "medium"
    if charsheet >= 3:
        return "Character sheet", "high" if charsheet >= 6 else "medium"
    if prep:
        return "Scenario prep", "high" if prep >= 2 else "medium"
    if research:
        return "Research/brainstorm", "medium"
    if keeper:
        return "Keeper recollection", "medium"
    return "Unclassified — read manually", "low"


def evidence_text(counts: dict[str, int], evidence: dict[str, list[int]],
                  tense: tuple[int, int]) -> str:
    parts = [f"{name}={counts[name]}" + (f"(L{','.join(map(str, lines))})"
                                          if lines else "")
             for name, lines in evidence.items() if counts[name]]
    parts.append(f"tense: past={tense[0]} conditional={tense[1]}")
    return "; ".join(parts)


# --------------------------------------------------------------------------
# Survey mode
# --------------------------------------------------------------------------


def survey_row(root: Path, path: Path) -> tuple[str, str, str, str, str]:
    """(verdict, rel, proposal, confidence, evidence) for one file."""
    rel = path.relative_to(root).as_posix()
    ext = path.suffix.lower()

    if ext in IMAGE_EXTS:
        return "DECIDED", rel, "Image/map", "high", f"ext={ext}"
    if ext in SPREADSHEET_EXTS:
        return "DECIDED", rel, "Spreadsheet/data", "high", f"ext={ext}"

    if ext not in TEXT_EXTS:
        if ext in UNSCORED_EXTS:
            return ("UNSCORED", rel, "-", "-",
                    f"{ext} requires a manual read (no stdlib extractor)")
        return ("UNSCORED", rel, "-", "-",
                f"unrecognized extension {ext!r} — requires a manual read")

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return "ERROR", rel, "-", "-", f"unreadable ({e.__class__.__name__})"

    fm = extract_frontmatter(text)
    if fm is not None and entity_type(fm) in WRAP_UP_TYPES:
        return ("DECIDED", rel, "Session wrap-up", "high",
                f"frontmatter type: {entity_type(fm)}")

    counts, evidence, tense = score(text)
    proposal, confidence = propose(counts)
    return ("SCORED", rel, proposal, confidence,
            evidence_text(counts, evidence, tense))


def run_survey(root: Path) -> int:
    if not root.is_dir():
        print(f"ERROR: not a directory: {root}", file=sys.stderr)
        return 2
    decided = scored = unscored = errors = 0
    for path in walk(root):
        verdict, rel, proposal, confidence, evidence = survey_row(root, path)
        print(f"{verdict}\t{rel}\t{proposal}\t{confidence}\t{evidence}")
        if verdict == "DECIDED":
            decided += 1
        elif verdict == "SCORED":
            scored += 1
        elif verdict == "UNSCORED":
            unscored += 1
        else:
            errors += 1
    total = decided + scored + unscored + errors
    print(f"# {total} files: {decided} decided, {scored} scored, "
          f"{unscored} unscored, {errors} errors")
    return 1 if errors else 0


# --------------------------------------------------------------------------
# Archive mode (Gotcha 5: never delete, date-stamp, preserve subpath)
# --------------------------------------------------------------------------


def resolve_inbox_source(vault: Path, inbox: Path, given: str) -> Path:
    """The file `given` names, as an absolute resolved path.

    Accepts an absolute path, a vault-relative path (`_inbox/x`) or an
    `_inbox/`-relative one (`x`). A relative path whose first component is
    `_inbox` is tried vault-relative first and falls back to
    `_inbox/`-relative only if nothing is there — a sub-folder literally
    named `_inbox` inside `_inbox/` is possible but the vault-relative
    reading is the one the skill documents. The caller still checks the
    result stays inside `inbox`; this only picks which reading to use.
    """
    p = Path(given).expanduser()
    if p.is_absolute():
        return p.resolve()
    if p.parts and p.parts[0] == "_inbox":
        vault_rel = (vault / p).resolve()
        if vault_rel.exists():
            return vault_rel
    return (inbox / p).resolve()


def _candidate_names(dest_dir: Path, name: str) -> Iterator[Path]:
    """`name`, then `stem (2).ext`, `stem (3).ext`, ... — the numeric-suffix
    rule for an archive collision."""
    yield dest_dir / name
    stem, suffix = Path(name).stem, Path(name).suffix
    n = 2
    while True:
        yield dest_dir / f"{stem} ({n}){suffix}"
        n += 1


def _first_free_name(dest_dir: Path, name: str) -> Path:
    """Dry-run only: the name the move *would* take right now."""
    return next(p for p in _candidate_names(dest_dir, name) if not p.exists())


def _reserve_name(dest_dir: Path, name: str) -> Path:
    """Claim a destination atomically (O_EXCL), so two concurrent archivers
    — or a sync client — can never both decide the same name is free and
    have the second `shutil.move` replace the first's archived file.
    Returns the reserved path, holding an empty placeholder to move onto.
    """
    for candidate in _candidate_names(dest_dir, name):
        try:
            fd = os.open(str(candidate), os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                         0o644)
        except FileExistsError:
            continue
        os.close(fd)
        return candidate
    raise AssertionError("unreachable: _candidate_names is infinite")


def run_archive(vault: Path, files: list[str], write: bool) -> int:
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2
    inbox = (vault / "_inbox").resolve()
    processed_root = inbox / "_processed"
    stamp = datetime.date.today().isoformat()
    errors = archived = 0
    for rel in files:
        src = resolve_inbox_source(vault, inbox, rel)
        if src == inbox or not src.is_relative_to(inbox):
            print(f"ERROR\t{rel}\tescapes _inbox/ — refused")
            errors += 1
            continue
        if src.is_relative_to(processed_root):
            print(f"ERROR\t{rel}\talready under _inbox/_processed/ — refused")
            errors += 1
            continue
        if not src.is_file():
            print(f"ERROR\t{rel}\tfile not found under _inbox/")
            errors += 1
            continue
        # The archived subpath comes from where the file actually sits
        # under _inbox/, not from however the caller spelled it — an
        # absolute or vault-relative spelling must not leak its own
        # leading components into the destination.
        sub = src.relative_to(inbox)
        dest_dir = processed_root / stamp / sub.parent
        if not write:
            dest = _first_free_name(dest_dir, sub.name)
            print(f"WOULD-ARCHIVE\t{rel}\t-> "
                  f"{dest.relative_to(vault).as_posix()}")
            archived += 1
            continue
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = _reserve_name(dest_dir, sub.name)
        except OSError as e:
            print(f"ERROR\t{rel}\treserve failed ({e.__class__.__name__})")
            errors += 1
            continue
        new_rel = dest.relative_to(vault).as_posix()
        try:
            # Moving onto our own zero-byte placeholder is the one
            # overwrite that is safe: we created it exclusively just now.
            shutil.move(str(src), str(dest))
        except OSError as e:
            dest.unlink(missing_ok=True)
            print(f"ERROR\t{rel}\tmove failed ({e.__class__.__name__})")
            errors += 1
            continue
        print(f"ARCHIVED\t{rel}\t-> {new_rel}")
        archived += 1
    verb = "archived" if write else "dry-run would archive"
    print(f"# {verb}: {archived} files, {errors} errors")
    return 1 if errors else 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir", type=Path, help="DIR to survey, or VAULT with --archive")
    ap.add_argument("--archive", nargs="+", metavar="FILE", default=None,
                    help="files under _inbox/ to archive to "
                         "_inbox/_processed/<date>/ (vault-relative, "
                         "_inbox/-relative, or absolute)")
    ap.add_argument("--write", action="store_true",
                    help="apply the archive move (default: dry-run plan). "
                         "Only meaningful with --archive.")
    args = ap.parse_args()
    if args.write and not args.archive:
        ap.error("--write only applies to --archive")

    root = args.dir.expanduser().resolve()
    if args.archive:
        return run_archive(root, args.archive, args.write)
    return run_survey(root)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Classify vault-ingest source material without reading everything blind.

Backs vault-ingest Phase 1 (`references/classification-taxonomy.md`). Five
of the taxonomy's rows are decidable without judgment — by extension,
existing frontmatter, or a fixed heading signature: Image/map,
Spreadsheet/data, Session wrap-up, Session export (a table assistant's
summary: `## Summary` plus at least two of `## Memorable Moments` /
`## Scenes` / `## NPCs` / `## Locations` / `## Items`, and no
frontmatter), and a saved web page's `<name>_files/`
companion folder (reported as one row, its scripts and stylesheets never
listed). The other six — play transcript, play fragment, scenario prep,
research/brainstorm, Keeper recollection, character sheet — are scored
against the literal indicator phrases the taxonomy already names, with
per-indicator hit counts and line numbers as evidence. A saved `.html`
page is scored from its text with tags, scripts and styles stripped.
Word/PDF files carry no stdlib text extraction here and are reported
UNSCORED rather than guessed at.

Two guards learned from a real inbox (2026-09-08): a single play hit in a
document that otherwise reads as prep does not make it a mixed document
(two or more do), and three or more characteristics rows — a line
carrying three or more primary attributes, one per NPC stat block — are a
scenario's cast list, a prep indicator, not one character's sheet (a
sheet has one such row, however many sections its other stats sit in).

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

VERDICT is DECIDED (extension, frontmatter or heading signature settles it
without judgment), SCORED (content read, indicators counted, GM/model
confirmation still wanted), UNSCORED (binary/unsupported format — Word,
PDF, VTT — needs a manual read), or ERROR (unreadable). A `<name>_files/`
folder prints one DECIDED row with a trailing `/` and counts as one entry
in the trailer. A trailer line follows:

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
from html.parser import HTMLParser
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
# A page saved from the browser: scored from its text once tags, scripts
# and styles are stripped (stdlib html.parser).
HTML_EXTS = {".html", ".htm"}
# Formats the "Supported formats" list names but stdlib cannot extract text
# from — reported UNSCORED rather than guessed at.
UNSCORED_EXTS = {".doc", ".docx", ".pdf", ".vtt"}

SKIP_DIR_NAMES = {"_processed", "__pycache__", ".git"}
# "Webpage, Complete" saves drop `<title>_files/` beside the page — scripts,
# stylesheets, images the page pulled in. Not source material.
ASSET_DIR_SUFFIX = "_files"

# A table assistant's session export (gmassistant.app and the like): no
# frontmatter, a `Date:` line in the first few lines, and these H2s.
# `Summary` is required plus at least two of the others. GM-written prep
# can use the same headings, so the Date: line is not optional.
EXPORT_HEADINGS = ("Summary", "Memorable Moments", "Scenes", "NPCs",
                   "Locations", "Items")
H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
DATE_LINE_RE = re.compile(r"^Date:\s*\S")
DATE_LINE_WINDOW = 10  # non-empty lines from the top to look in


def _is_asset_dir(name: str) -> bool:
    return name.endswith(ASSET_DIR_SUFFIX) and name != ASSET_DIR_SUFFIX


def _hidden_or_skipped(rel_parts: tuple[str, ...]) -> bool:
    if any(p.startswith(".") for p in rel_parts):
        return True
    return any(p in SKIP_DIR_NAMES for p in rel_parts[:-1])


def walk(root: Path) -> list[Path]:
    """Every file under root, sorted, skipping hidden files/dirs (matching
    vaultlib.vault_files's own convention — a hidden file's own name, not
    just a hidden parent dir, is skipped), archive/junk dirs, and anything
    inside a `<name>_files/` companion folder (see `asset_dirs`). Not
    vault-scoped — DIR may be an external folder or `_inbox/`."""
    out = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if _hidden_or_skipped(rel_parts):
            continue
        if any(_is_asset_dir(p) for p in rel_parts[:-1]):
            continue
        out.append(path)
    return out


def asset_dirs(root: Path) -> list[tuple[Path, int]]:
    """Every `<name>_files/` companion folder under root with its file
    count, sorted — one survey row each instead of one per asset."""
    out = []
    for path in sorted(root.rglob("*")):
        if not path.is_dir() or not _is_asset_dir(path.name):
            continue
        rel_parts = path.relative_to(root).parts
        if _hidden_or_skipped(rel_parts + ("",)):
            continue
        if any(_is_asset_dir(p) for p in rel_parts[:-1]):
            continue  # nested inside another asset folder
        n = sum(1 for p in path.rglob("*") if p.is_file())
        out.append((path, n))
    return out


class _TextOnly(HTMLParser):
    """Collect a page's visible text, one line per block, dropping the
    contents of <script> and <style>. `unterminated` is set when the
    document ends inside one of those — everything after the open tag was
    dropped, and the caller says so rather than scoring the remnant as if
    it were the whole page."""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0
        self.unterminated = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4",
                     "h5", "h6", "table", "section", "article"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)

    def close(self) -> None:
        super().close()
        self.unterminated = self._skip > 0


def html_text(raw: str) -> tuple[str, bool]:
    """(visible text, unterminated-script-or-style flag)."""
    p = _TextOnly()
    p.feed(raw)
    p.close()
    lines = [ln.strip() for ln in "".join(p.parts).splitlines()]
    return "\n".join(ln for ln in lines if ln), p.unterminated


def export_signature(text: str) -> list[str]:
    """The EXPORT_HEADINGS present as H2s, in canonical order, if the file
    has a `Date:` line near the top, `Summary`, and at least two of the
    other headings; else []."""
    head = [ln for ln in text.splitlines() if ln.strip()][:DATE_LINE_WINDOW]
    if not any(DATE_LINE_RE.match(ln) for ln in head):
        return []
    found = {m.group(1).strip() for m in H2_RE.finditer(text)}
    hits = [h for h in EXPORT_HEADINGS if h in found]
    if "Summary" in hits and len(hits) >= 3:
        return hits
    return []


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
        # Between the label and its number, a sheet may have nothing but
        # whitespace ("STR 50"), a colon/equals ("STR: 50"), Markdown bold
        # wrapping the label with the closer landing *before* the number
        # ("**STR:** 50"), or a table pipe cell boundary ("| STR | 50 |").
        # All of those are just punctuation/whitespace noise around the
        # number, so one permissive class covers every shape instead of
        # requiring the label to be followed directly by the digits.
        r"\b(?:STR|DEX|CON|INT|POW|APP|SIZ|EDU|HP|MP|SAN|ST|DX|IQ|HT)"
        r"[\s*:=|]*\d{1,3}\b"
        r"|\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|"
        r"Charisma|Hit Points?|Sanity)[\s*:=|]*\d{1,3}\b",
    )),
]

# Tense-shift evidence (mechanization-analysis.md §Tier 2 #12): reported
# alongside the proposal, never decides it — the mixed-document split stays
# a model/GM judgment call.
PAST_TENSE_RE = re.compile(
    r"\b\w+ed\b|\bwas\b|\bwere\b|\bhad\b", re.IGNORECASE)
CONDITIONAL_RE = re.compile(
    r"\bwould\b|\bshould\b|\bcould\b|\bmight\b|\bif\b", re.IGNORECASE)


# A characteristics row: one line carrying this many distinct primary
# attributes ("STR 45 CON 50 SIZ 55 ..." / "ST 11 DX 12 IQ 13 HT 12"). A
# sheet has one per character; a scenario's cast list has one per NPC.
# Derived stats (HP/MP/SAN) and a skills table's Attr column never make
# a row, so a sheet with stats spread over several sections still counts
# as one block.
PRIMARY_ATTR_RE = re.compile(
    r"\b(STR|CON|SIZ|DEX|INT|POW|APP|EDU|ST|DX|IQ|HT|"
    r"Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)"
    r"[\s*:=|]*\d{1,3}\b")
CHAR_ROW_MIN_ATTRS = 3
# This many characteristics rows are a cast list, not one character.
CAST_LIST_BLOCKS = 3
# Play hits below this, in a document that otherwise reads as prep,
# research or recollection, are noise (one "rolled a 96" in a published
# scenario's chase rules), not a play fragment.
MIXED_MIN_PLAY = 2


def score(text: str) -> tuple[dict[str, int], dict[str, list[int]],
                              tuple[int, int], int]:
    """(counts, evidence-lines, (past, conditional) tense tally,
    stat-block count).

    `counts` is the true per-indicator hit total, uncovered by any cap —
    `propose` decides on this. `evidence` is the same indicators' line
    numbers capped at 3 each, for the report only; a file with forty stat
    lines and one with three both show "(L6,7,8)", but their counts (40 vs
    3) still differ and drive different confidence. The stat-block count
    is how many characteristics rows the file has (see PRIMARY_ATTR_RE) —
    the cast-list signal.
    """
    lines = text.splitlines()
    counts: dict[str, int] = {name: 0 for name, _ in INDICATORS}
    evidence: dict[str, list[int]] = {name: [] for name, _ in INDICATORS}
    stat_blocks = 0
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
        if len(set(PRIMARY_ATTR_RE.findall(line))) >= CHAR_ROW_MIN_ATTRS:
            stat_blocks += 1
    past = sum(len(PAST_TENSE_RE.findall(line)) for line in lines)
    conditional = sum(len(CONDITIONAL_RE.findall(line)) for line in lines)
    return counts, evidence, (past, conditional), stat_blocks


def propose(counts: dict[str, int], stat_blocks: int = 0) -> tuple[str, str]:
    """(classification, confidence) from true indicator counts and the
    number of characteristics rows (stat blocks) in the file."""
    play = sum(counts[k] for k in
               ("play_dice", "play_dialogue", "play_vitals", "play_combat"))
    prep = sum(counts[k] for k in ("prep_conditional", "prep_directive"))
    research = counts["research_qa"]
    keeper = counts["keeper_recollection"]
    charsheet = counts["charsheet_stats"]
    cast_list = stat_blocks >= CAST_LIST_BLOCKS
    non_play = prep or research or keeper or cast_list
    # A lone play hit inside prep/research/recollection is noise, not a
    # fragment — it neither makes the document mixed nor a transcript.
    play_signal = play >= MIXED_MIN_PLAY or (play and not non_play)

    # Tested first, ahead of both the charsheet-dominance rule and the
    # plain play-transcript rule: a stat block embedded in prep notes (an
    # NPC profile with a `STR 60, CON 70, ...` block, say) can rack up more
    # charsheet_stats hits than the document has play hits, but that does
    # not make the whole file a character sheet — it makes it a mixed
    # document that also happens to contain a stat block. Any document
    # with a play signal AND at least one of prep/research/keeper/cast
    # list wins the mixed-content verdict outright, regardless of how the
    # charsheet count compares to play.
    if play_signal and non_play:
        return ("Play fragment (mixed content — consider a section "
                "split)", "medium")
    # A cast list — one characteristics row per NPC — is the taxonomy's
    # "NPC stat blocks without play context" prep indicator, and outranks
    # the sheet rule however many stat hits it totals.
    if cast_list:
        return "Scenario prep", "high"
    # A character sheet's attribute block routinely trips a handful of
    # play-shaped patterns (a stray "HP 12", a "round" in prose) without
    # being one — structured stats dominating the line count is the
    # stronger signal, so this is tested before the plain play rule.
    if charsheet >= 3 and charsheet > play and not cast_list:
        return "Character sheet", "high" if charsheet >= 6 else "medium"
    if play_signal:
        return "Play transcript", "high" if play >= 3 else "medium"
    if charsheet >= 3 and not cast_list:
        return "Character sheet", "high" if charsheet >= 6 else "medium"
    if prep:
        return "Scenario prep", "high" if prep >= 2 else "medium"
    if research:
        return "Research/brainstorm", "medium"
    if keeper:
        return "Keeper recollection", "medium"
    return "Unclassified — read manually", "low"


def evidence_text(counts: dict[str, int], evidence: dict[str, list[int]],
                  tense: tuple[int, int], stat_blocks: int = 0) -> str:
    parts = [f"{name}={counts[name]}" + (f"(L{','.join(map(str, lines))})"
                                          if lines else "")
             for name, lines in evidence.items() if counts[name]]
    if counts["charsheet_stats"]:
        parts.append(f"stat_blocks={stat_blocks}")
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

    if ext not in TEXT_EXTS and ext not in HTML_EXTS:
        if ext in UNSCORED_EXTS:
            return ("UNSCORED", rel, "-", "-",
                    f"{ext} requires a manual read (no stdlib extractor)")
        return ("UNSCORED", rel, "-", "-",
                f"unrecognized extension {ext!r} — requires a manual read")

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return "ERROR", rel, "-", "-", f"unreadable ({e.__class__.__name__})"

    prefix = ""
    if ext in HTML_EXTS:
        text, unterminated = html_text(text)
        prefix = "html text extracted; "
        if unterminated:
            prefix += ("unterminated <script>/<style> — content after it "
                       "not read; ")
    else:
        fm = extract_frontmatter(text)
        if fm is not None and entity_type(fm) in WRAP_UP_TYPES:
            return ("DECIDED", rel, "Session wrap-up", "high",
                    f"frontmatter type: {entity_type(fm)}")
        if fm is None:
            headings = export_signature(text)
            if headings:
                return ("DECIDED", rel, "Session export (assistant summary)",
                        "high", "headings: " + ", ".join(headings))

    counts, evidence, tense, stat_blocks = score(text)
    proposal, confidence = propose(counts, stat_blocks)
    return ("SCORED", rel, proposal, confidence,
            prefix + evidence_text(counts, evidence, tense, stat_blocks))


def run_survey(root: Path) -> int:
    if not root.is_dir():
        print(f"ERROR: not a directory: {root}", file=sys.stderr)
        return 2
    decided = scored = unscored = errors = 0
    for d, n in asset_dirs(root):
        rel = d.relative_to(root).as_posix() + "/"
        print(f"DECIDED\t{rel}\tWeb page assets (companion folder)\thigh\t"
              f"{n} files — not source material")
        decided += 1
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

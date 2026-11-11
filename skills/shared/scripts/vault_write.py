#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes.

    vault_write.py VAULT wrapup-new --session INDEX [--source TEXT] [--write]
    vault_write.py VAULT wrapup-add WRAPUP [--replace | --append]
                               [--after HEADING]
                               [--write]                                < markdown
    vault_write.py VAULT wrapup-settle WRAPUP [--write]                 < rows
    vault_write.py VAULT story --wrapup WRAPUP [--label TEXT] [--as-of TEXT]
                               [--date YYYY-MM-DD] [--write]            < entries
    vault_write.py VAULT status PC [--write]                            < fields
    vault_write.py VAULT status PC --show
    vault_write.py VAULT log [--write]                                  < rows
    vault_write.py VAULT timeline --under HEADING [--after HEADING]
                               [--file REL] [--write]                   < entries
    vault_write.py VAULT session-new --number N --title T [--play-date D]
                               [--chapter C] [--export PATH | --upcoming] [--write]
    vault_write.py VAULT play-notes-new --session INDEX [--play-date D]
                               [--export PATH] [--write]
    vault_write.py VAULT resolve --export PATH                (read-only)
    vault_write.py VAULT chapter-new --title T [--sort-order N]
                               [--status S] [--write]
    vault_write.py VAULT scene-new --chapter C --title T [--set-piece]
                               [--folder SUB] [--write]
    vault_write.py VAULT scene-paused --scene T --session S
                               [--new [--chapter C] [--folder SUB]]
                               [--write]                                < snapshot
    vault_write.py VAULT scene-played --scene T (--session S | --dropped)
                               [--write]
    vault_write.py VAULT prop-new --chapter C --title T [--kind K]
                               [--style S | --file F]
                               [--hand ID [--hand-font FAMILY]
                               [--hand-who TEXT]] [--scene SCENE]
                               [--container NAME] [--folder SUB] [--write]
    vault_write.py VAULT prop-hand --hand ID --hand-font FAMILY
                               [--hand-who TEXT] [--write]
    vault_write.py VAULT promote-plan DRAFT --to PLAN --plan-type T
                               [--chapter C] [--leads-to PLAN]... [--write]
    vault_write.py VAULT plan --number N [--chapter C] [--title T]
                               [--section] [--headless [--gm-input [PART ...]]]
                               [--write]                                < markdown

Paths are vault-relative; a session index or Wrap-Up can also be named
(`Session 05 - Beneath the Mill`, or either half). Without --write every command prints its plan and
writes nothing. The script never writes prose: it places the text on stdin.
A section is Keeper-facing when it is written under GM Notes and
player-facing when it is not; any section name is accepted, except that a
Wrap-Up reserves its template's GM Notes section names for GM Notes.
`VAULT <command> --help` gives each command's stdin shape.

Rows are tab-separated: verb, path, §section, detail. WOULD-CREATE and
WOULD-ADD in a plan, CREATED and ADDED when written, plus SKIP, WARNING and
ERROR, then one `# create: N  add: N  skip: N  warnings: N  errors: N` line.

Exit: 0 done or a clean plan; 1 refused, and then nothing at all is
written; 2 bad arguments. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from collections.abc import Callable, Collection, Iterable
from dataclasses import dataclass
from dataclasses import field as dc_field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import plan_check
import schema_rules
import threads as th
import vault_check as vc
from vaultlib import cli_name, utf8_output  # noqa: E402
import vaultlib as vl
from migrate_core import StepFailed, write_text_atomic
from vaultlib import GM_MARKER_RE, LineState, scan_body

OPEN_GM, CLOSE_GM = "open-gm", "close-gm"
# Spoiler blocks hide text like gm-only blocks, so a section ends at them
# by the same rule.
OPENERS = frozenset({OPEN_GM, "open-spoiler"})
CLOSERS = frozenset({CLOSE_GM, "close-spoiler"})
ANY_MARKER_RE = vl.marker_re()   # a gm-only or spoiler marker
LIST_RE = re.compile(r"^\s*[-*+] ")
# The one non-note file a command may change, in the same all-or-none batch.
DATA_FILES = frozenset({"_meta/prop-hands.json"})
VERBS = {"WOULD-CREATE": "CREATED", "WOULD-ADD": "ADDED",
         "WOULD-MOVE": "MOVED", "WOULD-CLOSE": "CLOSED",
         "WOULD-RECORD": "RECORDED", "WOULD-REST": "RESTED",
         "WOULD-WAKE": "WOKE", "WOULD-HAND": "HANDED",
         "WOULD-SETTLE": "SETTLED"}


class WriteError(Exception):
    """A refusal. One line; nothing is written."""


class RestoreFailed(WriteError):
    """A write failed and the undo did too: some files are left changed."""


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


class Batch:
    """Every file one call reads or changes, held in memory until apply."""

    def __init__(self, vault: Path) -> None:
        self.vault = vault
        self.originals: dict[str, str | None] = {}
        self.texts: dict[str, str] = {}
        self.rows: list[str] = []
        self.after: list[str] = []      # printed below the totals line
        # Questions that can only be asked once the files are on disk.
        self.after_write: list[Callable[[], None]] = []
        self._listing: dict[str, str] | None = None
        # `threads`: threads done per kind for the totals line (a thread
        # counts once, whatever rows it printed), and the vault's thread
        # lists as the batch found them (see `threads_scope`).
        self.tally: Counter[str] = Counter()
        self.scope: ThreadsScope | None = None

    def guard(self, rel: str) -> None:
        """Refuse a path that is not a note inside the vault."""
        if not rel.lower().endswith(".md"):
            raise WriteError(f"{rel}: not a note (.md)")
        full = self.vault / rel
        try:
            full.resolve().relative_to(self.vault.resolve())
        except ValueError:
            raise WriteError(f"{rel}: outside the vault") from None
        if full.is_dir():
            raise WriteError(f"{rel}: not a note (.md)")

    def resolve(self, raw: str) -> str:
        """The path as it is spelled on disk. macOS may store an accented
        name decomposed, so a miss is retried NFC-normalised. A path that
        is not a note inside the vault is refused."""
        rel = vl.normalize_file_arg(raw)
        self.guard(rel)
        if rel in self.texts or (self.vault / rel).is_file():
            return rel
        return self._files().get(nfc(rel), rel)

    def _files(self) -> dict[str, str]:
        if self._listing is None:
            self._listing = {
                nfc(p.relative_to(self.vault).as_posix()):
                    p.relative_to(self.vault).as_posix()
                for p in self.vault.rglob("*.md")}
            for rel, before in self.originals.items():   # made by this batch
                if before is None and rel in self.texts:
                    self._listing.setdefault(nfc(rel), rel)
        return self._listing

    def with_stem(self, stem: str) -> list[str]:
        """Vault-relative paths of the notes whose file name (without .md)
        is `stem`, compared NFC and case-folded."""
        want = nfc(stem).casefold()
        return sorted(rel for rel in self._files().values()
                      if nfc(Path(rel).stem).casefold() == want)

    def note_named(self, raw: str, types: Collection[str],
                   what: str) -> str:
        """The note of one of `types` that `raw` names: a vault-relative
        path, or a file name or [[link]] as `scene-played` takes. A name
        like `Session 05 - Beneath the Mill` also answers to either half."""
        rel = vl.normalize_file_arg(
            re.split(r"[|#^]", bare_link(raw), maxsplit=1)[0].strip())
        if self.exists(rel):
            return self.resolve(rel)
        if "/" in rel:
            return self.resolve(rel if rel.lower().endswith(".md")
                                else f"{rel}.md")
        name = nfc(" ".join(rel.removesuffix(".md").split())).casefold()

        def typed(rels: Iterable[str]) -> list[str]:
            return sorted(r for r in rels if not is_record(r)
                          and vl.entity_type(vl.extract_frontmatter(
                              self.read(r)) or {}) in types)
        # An exact name never hides another note one half of whose name
        # matches: both count, and two hits are refused.
        hits = typed(set(self.with_stem(name)) | {
            r for r in self._files().values()
            if name in (nfc(half).strip().casefold()
                        for half in Path(r).stem.split(" - ", 1))})
        if len(hits) != 1:
            raise WriteError(
                f"{what}: no {' or '.join(sorted(types))} note at or named "
                f"{raw!r}" if not hits else
                f"{what}: {len(hits)} notes named {raw!r}: "
                + ", ".join(hits) + "; pass its path")
        return hits[0]

    def read_data(self, rel: str) -> str | None:
        """An internal data file's text, or None when it is not there yet.
        Only a command that owns the file calls this; `guard` still
        refuses the file as any user-supplied path."""
        assert rel in DATA_FILES
        if rel in self.texts:
            return self.texts[rel]
        try:
            with (self.vault / rel).open("r", encoding="utf-8", newline="") as f:
                text = f.read()
        except FileNotFoundError:
            return None
        except UnicodeDecodeError:
            raise WriteError(f"{rel} is not UTF-8 text; fix it by hand "
                             f"first") from None
        except OSError as e:
            raise WriteError(f"{rel} cannot be read: {e}") from None
        self.originals[rel] = self.texts[rel] = text
        return text

    def write_data(self, rel: str, text: str) -> None:
        assert rel in DATA_FILES
        if rel not in self.texts:
            self.originals[rel] = None
        self.texts[rel] = text

    def exists(self, rel: str) -> bool:
        return rel in self.texts or (self.vault / rel).is_file()

    def read(self, rel: str) -> str:
        if rel in self.texts:
            return self.texts[rel]
        self.guard(rel)
        try:
            with (self.vault / rel).open("r", encoding="utf-8",
                                         newline="") as f:
                text = f.read()
        except FileNotFoundError:
            raise WriteError(f"{rel}: no such note") from None
        except (OSError, UnicodeDecodeError) as e:
            raise WriteError(
                f"{rel}: unreadable ({e.__class__.__name__})") from e
        self.originals[rel] = text
        self.texts[rel] = text
        return text

    def create(self, rel: str, text: str) -> None:
        self.guard(rel)
        if self.exists(rel):
            raise WriteError(f"{rel}: already exists")
        self.originals[rel] = None
        self.texts[rel] = text
        if self._listing is not None:     # a later lookup finds it by name
            self._listing[nfc(rel)] = rel

    def put(self, rel: str, text: str) -> None:
        if rel not in self.texts:
            self.read(rel)
        self.texts[rel] = text

    def row(self, verb: str, rel: str, where: str = "",
            detail: str = "") -> None:
        self.rows.append("\t".join((verb, rel, where, detail)))

    def changed(self) -> list[str]:
        return [rel for rel, text in self.texts.items()
                if text != self.originals[rel]]


def _on_disk(path: Path) -> str | None:
    """A note's text exactly as stored, or None when it cannot be read (a
    file that is gone or half-written counts as needing the undo)."""
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def apply(batch: Batch) -> list[str]:
    """Write every changed file, or none: a failure part-way puts back the
    files already written, Ctrl-C included."""
    changed = batch.changed()
    for rel in changed:
        path, before = batch.vault / rel, batch.originals[rel]
        if before is None:
            if path.exists():
                raise WriteError(f"{rel}: appeared since the plan was made")
            continue
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                now = f.read()
        except OSError as e:
            raise WriteError(
                f"{rel}: unreadable ({e.__class__.__name__})") from e
        if now != before:
            raise WriteError(f"{rel}: changed since the plan was made")
    done: list[str] = []
    try:
        for rel in changed:
            done.append(rel)
            write_text_atomic(batch.vault / rel, batch.texts[rel])
    except BaseException as e:
        unrestored: list[str] = []
        for rel in reversed(done):
            before = batch.originals[rel]
            try:
                if before is None:
                    (batch.vault / rel).unlink(missing_ok=True)
                elif _on_disk(batch.vault / rel) != before:
                    write_text_atomic(batch.vault / rel, before)
            except (OSError, StepFailed):
                unrestored.append(rel)
        if unrestored:
            why = str(e) or e.__class__.__name__
            raise RestoreFailed(
                f"{why}; could not restore: {', '.join(unrestored)}") from e
        if isinstance(e, StepFailed):
            raise WriteError(str(e)) from e
        raise
    return changed


def check_fences(batch: Batch, given: str = "") -> None:
    """Refuse a write that would leave a gm-only fence unbalanced. `given`
    is the text the caller sent: when it holds a gm-only marker, the
    message says the marker is there and not in the note."""
    for rel in batch.changed():
        _states, problems = scan_body(batch.texts[rel], ())
        if problems:
            where = ("; the gm-only markers are in the text given, not in "
                     "the note" if GM_MARKER_RE.search(given) else "")
            raise WriteError(f"{rel}: this would leave a gm-only fence "
                             f"unbalanced ({problems[0]}){where}")


def emit(batch: Batch, wrote: bool) -> str:
    rows = batch.rows
    if wrote:
        rows = ["\t".join((VERBS.get(r.split("\t", 1)[0],
                                     r.split("\t", 1)[0]),
                           r.split("\t", 1)[1])) for r in rows]

    def count(*verbs: str) -> int:
        return sum(r.split("\t", 1)[0] in verbs for r in rows)

    # `threads` alone reports moves, closes, rests, wakes and hands (the
    # last four as threads, from its tally); other totals stay as they were.
    extra = "".join(f"{name}: {n}  " for name, n in (
        ("moved", count("WOULD-MOVE", "MOVED")),
        ("closed", batch.tally["closed"]),
        ("rested", batch.tally["rested"]),
        ("woken", batch.tally["woken"]),
        ("handed", batch.tally["handed"]),
        ("settled", count("WOULD-SETTLE", "SETTLED"))) if n)
    total = (f"# create: {count('WOULD-CREATE', 'CREATED')}  "
             f"add: {count('WOULD-ADD', 'ADDED')}  skip: {count('SKIP')}  "
             f"{extra}warnings: {count('WARNING')}  errors: {count('ERROR')}")
    return "\n".join([*rows, total]) + "\n"


# --- reading a note's body ---------------------------------------------------

@dataclass
class Head:
    idx: int        # 0-based line index
    level: int
    title: str
    gm: bool        # inside a gm-only block


@dataclass
class Doc:
    lines: list[str]            # with their endings
    eol: str
    states: list[LineState]
    problems: list[str]

    @property
    def heads(self) -> list[Head]:
        return [Head(s.lineno - 1, s.heading[0], s.heading[1],
                     s.gm_depth > 0)
                for s in self.states if s.heading is not None]


def parse(text: str) -> Doc:
    lines = text.splitlines(keepends=True)
    eol = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    states, problems = scan_body(text, ())
    return Doc(lines, eol, states, problems)


def key(title: str) -> str:
    """How two heading titles are compared: emphasis and backticks dropped,
    whitespace collapsed, case folded."""
    return " ".join(re.sub(r"[*_`]", "", title).split()).casefold()


def section_end(doc: Doc, head: Head) -> int:
    """The line index one past the section `head` opens: the next heading
    of its level or higher, the gm-only or spoiler marker that closes the
    block it sits in, the opener of a block that holds such a heading, or
    the end of the file. An aside wholly inside the section does not end
    it."""
    nest = 0
    opener: int | None = None
    for s in doc.states:
        i = s.lineno - 1
        if i <= head.idx:
            continue
        if s.marker in OPENERS:
            if nest == 0:
                opener = i
            nest += 1
        elif s.marker in CLOSERS:
            if nest == 0:
                return i
            nest -= 1
        elif s.heading is not None and s.heading[0] <= head.level:
            return opener if nest and opener is not None else i
    return len(doc.lines)


def _tight_with(above: str, first: str) -> bool:
    """Whether `first` follows `above` with no blank line between: a list
    item under a list item, or a table row under a table row."""
    return bool(LIST_RE.match(above)
                or (above.lstrip().startswith("|")
                    and first.lstrip().startswith("|")))


def place(doc: Doc, at: int, block: list[str], tight: bool = False,
          glue: bool = False) -> str:
    """The note's text with `block` (lines without endings) put after the
    last non-blank line before index `at`. A blank line separates it from
    what is above, unless `glue`, or `tight` and that line is a list item
    (or a table row above a table row). No existing byte is removed."""
    lines = list(doc.lines)
    j = at
    while j > 0 and lines[j - 1].strip() == "":
        j -= 1
    if j > 0 and not lines[j - 1].endswith(("\n", "\r")):
        lines[j - 1] += doc.eol
    new = [b + doc.eol for b in block]
    if j > 0 and not (glue or (tight and _tight_with(lines[j - 1], block[0]))):
        new.insert(0, doc.eol)
    if j == at and at < len(lines) and lines[at].strip():
        new.append(doc.eol)
    lines[j:j] = new
    return "".join(lines)


def _listy(line: str) -> bool:
    """Whether `line` opens a list item or a table row."""
    return bool(LIST_RE.match(line) or line.lstrip().startswith("|"))


TOP_LIST_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s")


def own_lines(doc: Doc, head: Head, end: int) -> list[int]:
    """The lines of the section `head` opens (ending at `end`) that are
    outside code and at the heading's own gm-only and spoiler depth: an
    aside inside the section is not part of it."""
    states = {s.lineno - 1: s for s in doc.states}
    mine = states.get(head.idx)
    if mine is None:
        return []
    return [i for i in range(head.idx + 1, end)
            if (st := states.get(i)) is not None and not st.in_code
            and st.gm_depth == mine.gm_depth
            and st.spoiler_depth == mine.spoiler_depth]


def list_end(doc: Doc, head: Head, end: int, line: str
             ) -> tuple[int, bool] | None:
    """(where `line` goes, whether it sits flush against the line above)
    in the section `head` opens, which ends at `end`: after the last
    top-level list item and what continues it, or, for a table row, after
    the last table row. Lines in code fences do not count. None when the
    section has no list (or no table) to join."""
    own = own_lines(doc, head, end)
    mine = set(own)
    states = {s.lineno - 1: s for s in doc.states}
    if line.lstrip().startswith("|"):
        rows = [i for i in own if doc.lines[i].lstrip().startswith("|")]
        return (rows[-1] + 1, True) if rows else None
    items = [i for i in own if TOP_LIST_RE.match(doc.lines[i])]
    if not items:
        return None
    j = items[-1] + 1
    while j < end:
        text = doc.lines[j]
        if not text.strip():
            k = j
            while k < end and not doc.lines[k].strip():
                k += 1
            if k < end and k in mine and doc.lines[k][:1] in (" ", "\t"):
                j = k + 1
                continue
            break
        st = states.get(j)
        if (st is None or j not in mine or st.heading or st.marker
                or text.lstrip().startswith((">", "```", "~~~"))
                and not text[:1].isspace()):
            break
        j += 1
    return j, bool(LIST_RE.match(line))


def added_states(old: str, new: str) -> list[LineState]:
    """The states of the non-blank, non-marker body lines of `new` that
    `old` does not have: the one block a placement inserted."""
    a = old.splitlines(keepends=True)
    b = new.splitlines(keepends=True)
    head = 0
    while head < min(len(a), len(b)) and a[head] == b[head]:
        head += 1
    tail = 0
    while (tail < min(len(a), len(b)) - head
           and a[-1 - tail] == b[-1 - tail]):
        tail += 1
    fresh = set(range(head, len(b) - tail))
    return [st for st in scan_body(new, ())[0]
            if st.lineno - 1 in fresh and st.line.strip()
            and st.marker is None]


SHARED_TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
WRAP_TEMPLATES = ("_Template_Session_WrapUp.md",)
COMMENT_TAIL_RE = re.compile(r"\s+#.*$")


def template_text(vault: Path, vault_names: tuple[str, ...],
                  shared_name: str) -> str:
    for name in vault_names:
        path = vault / "_Templates" / name
        if path.is_file():
            return path.read_text(encoding="utf-8-sig")
    try:
        return (SHARED_TEMPLATES / shared_name).read_text(encoding="utf-8")
    except OSError as e:
        raise WriteError(f"template {shared_name} is missing from the "
                         f"plugin ({e.__class__.__name__})") from e


def strip_comment(value: str) -> str:
    """`value` without a trailing YAML comment. A quoted value is kept
    through its closing quote, so a # inside the quotes survives."""
    if value.lstrip().startswith("#"):
        return ""
    # through the unescaped closing quote: `"A \\"B\\""` is one value
    quoted = re.match(r"""^\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*')""", value)
    if quoted:
        return quoted.group(1).strip()
    return COMMENT_TAIL_RE.sub("", value)


def template_frontmatter(text: str) -> list[str]:
    """A template's frontmatter lines without endings and without its
    comments (whole-line or trailing)."""
    lines = text.splitlines()
    if not lines or lines[0].lstrip("\ufeff").strip() != "---":
        raise WriteError("template has no frontmatter")
    out: list[str] = []
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        if line.strip().startswith("#") or not line.strip():
            continue
        name, colon, value = line.partition(":")
        if not colon:
            out.append(COMMENT_TAIL_RE.sub("", line))
            continue
        kept = strip_comment(value.lstrip())
        out.append(name + colon + (" " + kept if kept else ""))
    raise WriteError("template frontmatter never closes")


def raw_value(text: str, name: str) -> str | None:
    """A top-level frontmatter value exactly as written (quotes kept)."""
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(error)
    value = vl.get_key(lines[1:end], name)
    return None if value is None else strip_comment(value).strip()


def find_play_notes(batch: Batch, index: str, stem: str) -> list[str]:
    """Stems of the Play Notes notes in the index's own folder whose
    `session:` link names this index."""
    folder = index.rpartition("/")[0]
    types = vc.SESSION_DOC_TYPES["play_notes"][1]
    want = vl.normalize(stem)
    out = []
    for rel, text in vl.vault_files(batch.vault, folder or None):
        if rel.rpartition("/")[0] != folder:
            continue
        fm = vl.extract_frontmatter(text) or {}
        if (vl.entity_type(fm) in types and vl.normalize(
                vl.wikilink_target(fm.get("session"))) == want):
            out.append(Path(rel).stem)
    return out


def is_blank(value: str) -> bool:
    """Whether a frontmatter value says nothing: empty, null, ~ or an empty
    link."""
    return value.strip().strip("\"'").strip() in ("", "null", "~", "[[]]")


def cmd_wrapup_new(batch: Batch, args: argparse.Namespace, _text: str) -> None:
    index = batch.note_named(args.session, {"session"}, "--session")
    text = batch.read(index)
    fm = vl.extract_frontmatter(text) or {}
    if vl.entity_type(fm) != "session":
        raise WriteError(f"{index}: not a session index (type: session)")
    name = vl.wrapup_filename(index, fm)
    if name is None:
        raise WriteError(f"{index}: its chapter or session number cannot "
                         f"be read, so the Wrap-Up has no name")
    number = vl.parse_session_number(fm.get("session_number"))
    if number is None:
        number = vl.session_ref_number(fm)
    folder = index.rpartition("/")[0]
    rel = f"{folder}/{name}" if folder else name
    stem = Path(index).stem
    title = stem.split(" - ", 1)[1] if " - " in stem else stem
    documents = vl.nested_mapping(text, "documents")
    link = vl.wikilink_target(documents.get("wrap_up"))
    if link and not is_blank(link):
        stem_of = re.split(r"[#^]", link, maxsplit=1)[0].replace("\\", "/")
        have = batch.with_stem(stem_of.rsplit("/", 1)[-1].strip())
        if have:
            raise WriteError(f"{index}: already has a Wrap-Up: {have[0]}")
    notes = documents.get("play_notes") or ""
    if is_blank(notes):
        notes = ""
    notes_warning = ""
    if not notes:
        hits = find_play_notes(batch, index, stem)
        if len(hits) == 1:
            notes = f"[[{hits[0]}]]"
        else:
            notes_warning = (
                "no Play Notes found for this session: source_document "
                "left blank" if not hits else
                "several Play Notes notes link this session: "
                "source_document left blank")
    values = {
        "session": f'"[[{stem}]]"',
        "session_number": str(number),
        "source_document": (f'"{notes}"' if notes.startswith("[[")
                            else notes or '"[[]]"'),
    }
    for field in ("chapter", "campaign", "play_date", "in_game_date"):
        found = raw_value(text, field)
        if found:
            values[field] = found
    if "chapter" not in values:
        folder_chapter = vl.chapter_of(index, fm)
        if folder_chapter:
            values["chapter"] = f'"[[{folder_chapter}]]"'
    fm_lines = [line + "\n" for line in template_frontmatter(
        template_text(batch.vault, WRAP_TEMPLATES, "session-wrap.md"))]
    for field, value in values.items():
        vl.set_key(fm_lines, field, value, "\n")
    chapter_no, session_no = name.split("_")[1], name.split("_")[3]
    body = ["", f"# Chapter {chapter_no} \u00b7 Session {session_no} \u2014 "
                f"{title} \u2014 Wrap-Up", ""]
    if args.source:
        # GM bookkeeping (which file, which skill): never on the player site.
        body += ["<!-- gm-only -->", "> [!info] Source",
                 *[f"> {ln}".rstrip() for ln in args.source.splitlines()],
                 "<!-- /gm-only -->", ""]
    body += ["<!-- gm-only -->", "", "## GM Notes", "", "<!-- /gm-only -->"]
    batch.create(rel, "---\n" + "".join(fm_lines) + "---\n"
                 + "\n".join(body) + "\n")
    batch.row("WOULD-CREATE", rel, "", f"from {index}")
    if notes_warning:
        batch.row("WARNING", rel, "", notes_warning)


GM_NOTES = "gm notes"
PLAYERS_SEE = "new section — players will see this"


@dataclass
class TemplateMap:
    order: list[tuple[int, str]]    # (level, key) for H2-H4, template order
    titles: dict[str, str]          # key -> the template's own spelling
    parent: dict[str, str]          # H4 key -> its H3's key
    gm: set[str]                    # keys that sit under ## GM Notes

    def later(self, level: int, k: str, among: set[str] | None = None
              ) -> set[str]:
        """Keys of `level` that come after `k` in the template."""
        keys = [c for lvl, c in self.order
                if lvl == level and (among is None or c in among)]
        return set(keys[keys.index(k) + 1:]) if k in keys else set()


def read_template_map(text: str) -> TemplateMap:
    tmap = TemplateMap([], {}, {}, set())
    in_gm = False
    h3: str | None = None
    for h in parse(text).heads:
        if h.level not in (2, 3, 4):
            continue
        k = key(h.title)
        if h.level == 2:
            in_gm, h3 = k == GM_NOTES, None
            if in_gm:
                continue
        elif h.level == 3:
            h3 = k
        elif h3 is not None:
            tmap.parent[k] = h3
        tmap.order.append((h.level, k))
        tmap.titles[k] = h.title
        if in_gm:
            tmap.gm.add(k)
    return tmap


def split_units(text: str, known: set[str]
                ) -> list[tuple[int, str, list[str]]]:
    """The sections on stdin. A heading opens a new section when the
    template knows it or when it is no deeper than the section it follows;
    any other heading travels with the section above it."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise WriteError("nothing on stdin")
    heads = vl.fenced_headings("\n".join(lines))
    if not heads or any(line.strip() for line in lines[:heads[0][0]]):
        raise WriteError("stdin must start with a heading")
    starts: list[tuple[int, int, str]] = []
    for i, level, title in heads:
        if (not starts or key(title) in known or level <= starts[-1][1]):
            starts.append((i, level, title))
    units = []
    for n, (i, level, title) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        body = lines[i:end]
        while body and not body[-1].strip():
            body.pop()
        units.append((level, title, body))
    return units


def gm_region(doc: Doc, rel: str) -> tuple[Head, int, int]:
    fix = "run gma vault-check <vault> wrapup --fix"
    if doc.problems:
        raise WriteError(f"{rel}: gm-only fence is unbalanced "
                         f"({doc.problems[0]}) — {fix}")
    for h in doc.heads:
        if h.level == 2 and key(h.title) == GM_NOTES and h.gm:
            openers = [s.lineno - 1 for s in doc.states
                       if s.marker == OPEN_GM and s.lineno - 1 < h.idx]
            if not openers:
                break
            return h, max(openers), section_end(doc, h)
    raise WriteError(f"{rel}: no fenced ## GM Notes — {fix}")


def _replace(doc: Doc, head: Head, unit: list[str]) -> tuple[str, int]:
    """(the text with `head`'s section replaced by `unit`, how many lines
    the old section had)."""
    end = section_end(doc, head)
    while end > head.idx + 1 and not doc.lines[end - 1].strip():
        end -= 1
    new = [line + doc.eol for line in unit]
    return ("".join(doc.lines[:head.idx] + new + doc.lines[end:]),
            end - head.idx)


def out_of_hiding(doc: Doc, head: Head, at: int) -> int:
    """`at`, moved up past a gm-only or spoiler block that is still open
    there, so text for the section `head` opens never lands hidden."""
    states = {s.lineno - 1: s for s in doc.states}
    mine = states.get(head.idx)
    if mine is None:
        return at
    depth = mine.gm_depth + mine.spoiler_depth
    j = at
    while j - 1 > head.idx:
        st = states.get(j - 1)
        if st is None or not (st.gm_depth + st.spoiler_depth > depth
                              or st.marker in OPENERS):
            break
        j -= 1
    return j


def _append(doc: Doc, head: Head, unit: list[str]) -> str:
    """The text with `unit`'s body (its heading line left out) added at the
    end of the section `head` opens."""
    body = unit[1:]
    while body and not body[0].strip():
        body.pop(0)
    if not body:
        raise WriteError(f"nothing to append to '{'#' * head.level} "
                         f"{head.title}'")
    end = section_end(doc, head)
    if not vl.fenced_headings("\n".join(body)):
        # Text without headings belongs to the section's own content,
        # ahead of its first deeper heading.
        end = next((h.idx for h in doc.heads
                    if head.idx < h.idx < end and h.level > head.level), end)
        end = out_of_hiding(doc, head, end)
    return place(doc, end, body, tight=bool(LIST_RE.match(body[0])))


@dataclass
class Landed:
    text: str                   # the Wrap-Up's new text
    detail: str                 # the row's detail
    parent: str | None = None   # the ### a #### went under
    at: int | None = None       # line index the block was placed at


@lru_cache(maxsize=1)
def plugin_player_keys() -> frozenset[str]:
    """Keys of the player-facing sections the plugin's own template has."""
    try:
        tmap = read_template_map((SHARED_TEMPLATES / "session-wrap.md")
                                 .read_text(encoding="utf-8"))
    except OSError:
        return frozenset({"narrative recap", "memorable moments"})
    return frozenset(c for lvl, c in tmap.order if lvl == 2)


def sibling_at(doc: Doc, scope: list[Head], k: str, order: list[str],
               default: int) -> int:
    """Where a section goes among its siblings `scope`. `order` is the
    template's order for this kind of sibling. A name the template does
    not know goes at `default` (the end of the container). A known one goes
    after the last existing sibling that is earlier in the template; else
    before the first existing one that is later; else before the first
    sibling of any kind; else at `default`."""
    if k not in order:
        return default
    i = order.index(k)
    earlier, later = set(order[:i]), set(order[i + 1:])
    before = [h for h in scope if key(h.title) in earlier]
    if before:
        return max(section_end(doc, h) for h in before)
    after = next((h for h in scope if key(h.title) in later), None)
    if after is not None:
        return after.idx
    return scope[0].idx if scope else default


def _land(doc: Doc, rel: str, tmap: TemplateMap, level: int, title: str,
          unit: list[str], mode: str, after: str | None, scope: list[Head],
          order: list[str], default: int, detail: str = "") -> Landed:
    """Put `unit` among its siblings `scope`: replace, append to or refuse
    a section that is already there, else place a new one."""
    k = key(title)
    found = next((h for h in scope if key(h.title) == k), None)
    if found is not None:
        if mode == "replace":
            text, count = _replace(doc, found, unit)
            return Landed(text, f"replaced ({count} lines)")
        if mode == "append":
            return Landed(_append(doc, found, unit), "appended")
        raise WriteError(f"{rel}: already has '{'#' * level} {title}' "
                         f"\u2014 --replace to replace it, --append to add "
                         f"to it")
    if after and k not in tmap.titles:
        want = key(after.lstrip("#").strip())
        anchor = next((h for h in scope if key(h.title) == want), None)
        if anchor is None:
            raise WriteError(f"{rel}: no heading '{after}' to go after")
        at = section_end(doc, anchor)
    else:
        at = sibling_at(doc, scope, k, order, default)
    return Landed(place(doc, at, unit), detail, at=at)


def _add_player(doc: Doc, rel: str, tmap: TemplateMap, title: str,
                unit: list[str], mode: str, after: str | None,
                opener: int) -> Landed:
    """A `##` section: player-facing, before the GM Notes fence."""
    k = key(title)
    if k == GM_NOTES:
        raise WriteError(f"{rel}: '## {title}' is the container: send "
                         f"its sections as '### ...'")
    if k in tmap.gm or vc.template_keeper_title(title):
        raise WriteError(
            f"{rel}: '## {title}' is a GM Notes section \u2014 write it as "
            f"'{'#' * (4 if k in tmap.parent else 3)} {title}'")
    scope = [h for h in doc.heads if h.level == 2 and not h.gm]
    order = [c for lvl, c in tmap.order if lvl == 2]
    detail = "" if k in plugin_player_keys() else PLAYERS_SEE
    return _land(doc, rel, tmap, 2, title, unit, mode, after, scope, order,
                 opener, detail)


def _add_keeper3(doc: Doc, rel: str, tmap: TemplateMap, title: str,
                 unit: list[str], mode: str, after: str | None,
                 inside: list[Head], closer: int) -> Landed:
    """A `###` section under GM Notes."""
    scope = [h for h in inside if h.level == 3]
    order = [c for lvl, c in tmap.order if lvl == 3 and c in tmap.gm]
    return _land(doc, rel, tmap, 3, title, unit, mode, after, scope, order,
                 closer)


def h4_parent(tmap: TemplateMap, k: str, title: str, prev: str | None,
              first: bool) -> str | None:
    """The `###` an unplaced `####` belongs under: its template parent;
    else the `###` the unit before it in the same stdin went under; else,
    for a first unit shaped like a PC block (`[[Name]] (Player)`), PC
    Carry-Forward; else None (the end of GM Notes)."""
    pk = tmap.parent.get(k)
    if pk is not None:
        return tmap.titles[pk]
    if prev is not None:
        return prev
    if first and title.startswith("[["):
        return tmap.titles.get("pc carry-forward", "PC Carry-Forward")
    return None


def _add_keeper4(text: str, doc: Doc, rel: str, tmap: TemplateMap,
                 title: str, unit: list[str], mode: str, after: str | None,
                 inside: list[Head], closer: int, prev: str | None,
                 first: bool, made: list[tuple[str, str]]) -> Landed:
    """A `####` section under GM Notes."""
    k = key(title)
    ptitle = h4_parent(tmap, k, title, prev, first)
    if ptitle is None:
        scope = [h for h in inside if h.level == 4]
        landed = _land(doc, rel, tmap, 4, title, unit, mode, after, scope,
                       [], closer)
        if landed.at is not None and not landed.detail:
            under = [h for h in inside if h.level == 3 and h.idx < landed.at]
            landed.detail = (f"under '### {under[-1].title}'" if under
                             else "at the end of GM Notes")
        return landed
    pk = key(ptitle)
    parent = next((h for h in inside
                   if h.level == 3 and key(h.title) == pk), None)
    if parent is None:
        made.append((ptitle, title))
        grown = add_section(text, rel, tmap, 3, ptitle, [f"### {ptitle}"],
                            "").text
        return add_section(grown, rel, tmap, 4, title, unit, mode, after,
                           prev, first, made)
    stop = section_end(doc, parent)
    scope = [h for h in inside
             if h.level == 4 and parent.idx < h.idx < stop]
    order = [c for lvl, c in tmap.order
             if lvl == 4 and tmap.parent.get(c) == pk]
    landed = _land(doc, rel, tmap, 4, title, unit, mode, after, scope, order,
                   stop)
    landed.parent = parent.title
    return landed


def add_section(text: str, rel: str, tmap: TemplateMap, level: int,
                title: str, unit: list[str], mode: str = "",
                after: str | None = None, prev: str | None = None,
                first: bool = False,
                made: list[tuple[str, str]] | None = None) -> Landed:
    """Place one section in a Wrap-Up. `mode` is "", "replace" or "append";
    `after` names the heading a section the template does not know goes
    after; `prev` is the `###` the unit before this one in the same stdin
    went under and `first` says this is the stdin's first unit (both steer
    an unplaced `####`). A parent `###` created on the way is added to
    `made`."""
    doc = parse(text)
    gm_head, opener, closer = gm_region(doc, rel)
    if level == 2:
        return _add_player(doc, rel, tmap, title, unit, mode, after, opener)
    inside = [h for h in doc.heads if gm_head.idx < h.idx < closer]
    if level == 3:
        return _add_keeper3(doc, rel, tmap, title, unit, mode, after,
                            inside, closer)
    return _add_keeper4(text, doc, rel, tmap, title, unit, mode, after,
                        inside, closer, prev, first,
                        [] if made is None else made)


def require_hidden(old: str, new: str, rel: str, level: int,
                   title: str) -> None:
    """Refuse a Keeper section whose text would sit outside the hidden
    block (stdin that closes the block and opens it again, for one)."""
    if any(st.gm_depth == 0 for st in added_states(old, new)):
        raise WriteError(f"{rel}: this would put '{'#' * level} {title}' "
                         f"outside the hidden block")


def section_exists(note: str, rel: str, level: int, title: str) -> bool:
    """Whether the Wrap-Up already has a section of this level and title
    where `wrapup-add` would put one."""
    doc = parse(note)
    gm_head, _opener, closer = gm_region(doc, rel)
    k = key(title)
    if level == 2:
        pool = [h for h in doc.heads if h.level == 2 and not h.gm]
    else:
        pool = [h for h in doc.heads
                if h.level == level and gm_head.idx < h.idx < closer]
    return any(key(h.title) == k for h in pool)


def cmd_wrapup_add(batch: Batch, args: argparse.Namespace, text: str) -> None:
    rel = batch.note_named(args.wrapup, vc.WRAP_TYPES, "wrapup")
    note = batch.read(rel)
    if vl.entity_type(vl.extract_frontmatter(note) or {}) not in vc.WRAP_TYPES:
        raise WriteError(f"{rel}: not a Wrap-Up")
    tmap = read_template_map(
        template_text(batch.vault, WRAP_TEMPLATES, "session-wrap.md"))
    units = split_units(text, set(tmap.titles))
    doc = parse(note)
    if not doc.problems and not any(
            h.level == 2 and key(h.title) == GM_NOTES for h in doc.heads):
        note = place(doc, len(doc.lines),
                     ["<!-- gm-only -->", "", "## GM Notes", "",
                      "<!-- /gm-only -->"])
        batch.put(rel, note)
        batch.row("WOULD-ADD", rel, "\u00a7GM Notes",
                  "created (the Wrap-Up had none)")
    mode = "replace" if args.replace else "append" if args.append else ""
    prev: str | None = None
    placed = 0
    for n, (level, title, unit) in enumerate(units):
        if level not in (2, 3, 4):
            raise WriteError(f"'{'#' * level} {title}': a Wrap-Up section "
                             f"starts at ##, ### or ####")
        if len(unit) == 1 and section_exists(note, rel, level, title):
            # A heading and nothing else, for a section the note has: the
            # parent's marker for the units after it, not a second copy.
            prev = title if level == 3 else None
            continue
        placed += 1
        made: list[tuple[str, str]] = []
        before = note
        landed = add_section(note, rel, tmap, level, title, unit, mode,
                             args.after, prev, n == 0, made)
        # Only --replace is stopped: --append adds and destroys nothing (the
        # reconcile step adds to a reviewed Wrap-Up that way).
        if mode == "replace" and landed.detail.startswith("replaced") \
                and vl.scalar_value(raw_value(before, "canon_status") or "").upper() \
                == "AUTHORITATIVE":
            raise WriteError(
                f"{rel}: this Wrap-Up is reviewed (canon_status: AUTHORITATIVE), "
                f"so '{'#' * level} {title}' was not replaced. Ask the GM; "
                f"if they say yes, set canon_status back to DRAFT in the note "
                f"and run this again")
        note = landed.text
        if level != 2:
            require_hidden(before, note, rel, level, title)
        prev = (landed.parent if level == 4
                else title if level == 3 else None)
        batch.put(rel, note)
        for parent, child in made:
            batch.row("WOULD-ADD", rel, f"\u00a7{parent}", f"created for {child}")
        batch.row("WOULD-ADD", rel, f"\u00a7{title}", landed.detail)
        if level == 2:
            for _i, sub_level, sub in vl.fenced_headings("\n".join(unit)):
                if sub_level >= 3:
                    batch.row("WOULD-ADD", rel, f"\u00a7{title} \u203a {sub}",
                              "inside a player section \u2014 players will "
                              "see this")
    if not placed:
        raise WriteError(f"{rel}: nothing to add")


SETTLE_ITEM_RE = re.compile(
    r"^(?P<indent>[ \t]*)(?P<mark>[-*+]|\d+[.)])[ \t]+"
    r"(?P<box>\[[ xX]\][ \t]+)?(?P<text>.*)$")
KEEPER_CHECKLIST = "keeper checklist"


def settle_section(lines: list[str], title: str) -> tuple[int, int]:
    """(first line, end) of the body of the heading, outside a code fence,
    whose title equals `title` in any case. The body runs to the next
    heading of any level. Only the sections `--brief` drops settled items
    from are settled (`session_context.SETTLED_HEADING_RE`: `### Keeper
    Checklist`, a `###` heading starting `Open Questions`): one settled
    anywhere else would stay in the bundle, struck through."""
    import session_context as sc   # it imports this module at its top
    heads = th._headings(lines)
    want = title.strip().casefold()
    named = [n for n, (_idx, _level, found) in enumerate(heads)
             if found.casefold() == want]
    for n in named:
        idx = heads[n][0]
        if sc.SETTLED_HEADING_RE.match(lines[idx].rstrip("\r")):
            end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
            return idx + 1, end
    if named:
        raise WriteError(f"'{title}' is not settled here: only ### Keeper "
                         f"Checklist and ### Open Questions\u2026 sections "
                         f"are, the ones the bundle leaves settled items "
                         f"out of")
    raise WriteError(f"no section titled '{title}' (only ### Keeper "
                     f"Checklist and ### Open Questions\u2026 settle)")


def settle_items(lines: list[str], start: int,
                 end: int) -> list[tuple[int, re.Match[str]]]:
    """(line, match of SETTLE_ITEM_RE) for the list items of a section at
    its top indent, outside a code fence; nested items are left out."""
    found = []
    delim: str | None = None
    for i in range(start, end):
        line = lines[i].rstrip("\r")
        delim, is_fence = vl.fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        m = SETTLE_ITEM_RE.match(line)
        if m:
            found.append((i, m))
    if not found:
        return []
    width = [len(m["indent"].expandtabs(4)) for _i, m in found]
    return [item for item, w in zip(found, width) if w == min(width)]


def _unstruck(text: str) -> str:
    """An item's text without the `~~` a struck item opens with."""
    return text[2:] if text.startswith("~~") else text


def settle_one(lines: list[str], section: str, lead: str,
               ruling: str) -> str:
    """Settle the one item of `section` that `lead` names, in `lines`
    (changed in place); returns the item's text for the row. An item
    matches when its text, with a leading `[ ] `, the bold markers and a
    struck item's leading `~~` dropped, starts with `lead`
    (case-sensitive), or its bold lead (`threads.lead`) equals `lead`."""
    start, end = settle_section(lines, section)
    hits = [(i, m) for i, m in settle_items(lines, start, end)
            if _unstruck(m["text"]).replace("**", "").startswith(lead)
            or th.lead(_unstruck(m["text"])) == lead]
    if not hits:
        raise WriteError(f"'{section}': no item matches '{lead}'")
    if len(hits) > 1:
        raise WriteError(f"'{section}': {len(hits)} items match '{lead}'; "
                         f"use more of its words")
    i, m = hits[0]
    text = m["text"].strip()
    box = (m["box"] or "").strip()
    if box.lower() == "[x]" or text.startswith("~~"):
        raise WriteError(f"'{section}': '{lead}' is already settled")
    checklist = section.strip().casefold() == KEEPER_CHECKLIST
    ruling = " ".join(ruling.split())
    cr = "\r" if lines[i].endswith("\r") else ""
    tick = "[x] " if checklist or box else ""
    said = ruling if checklist else f"answered: {ruling}"
    # A text that opens with `~` is escaped: `~~~` would open a code fence.
    struck = "\\" + text if text.startswith("~") else text
    lines[i] = (f"{m['indent']}{m['mark']} {tick}~~{struck}~~ "
                f"\u2014 {said}{cr}")
    return text


def cmd_wrapup_settle(batch: Batch, args: argparse.Namespace,
                      text: str) -> None:
    rel = batch.note_named(args.wrapup, vc.WRAP_TYPES, "wrapup")
    note = batch.read(rel)
    if vl.entity_type(vl.extract_frontmatter(note) or {}) not in vc.WRAP_TYPES:
        raise WriteError(f"{rel}: not a Wrap-Up")
    rows = [ln.split("\t") for ln in text.splitlines() if ln.strip()]
    if not rows:
        raise WriteError("no rows on stdin")
    eol = th._eol(note)
    lines = th._lines(note)
    errors: list[str] = []
    for n, cols in enumerate(rows, 1):
        try:
            if len(cols) != 3 or not all(c.strip() for c in cols):
                raise WriteError("a row is SECTION, LEAD and RULING, "
                                 "separated by tabs")
            item = settle_one(lines, cols[0], cols[1].strip(), cols[2])
        except WriteError as e:
            errors.append(f"row {n}: {e}")
            continue
        batch.row("WOULD-SETTLE", rel, f"\u00a7{cols[0].strip()}", item)
    if errors:
        raise WriteError("\nERROR\t".join(errors))
    batch.put(rel, th._join(lines, eol))


STORY_TEMPLATES = ("character-story.md", "_Template_Character_Story.md")
PC_LINE_RE = re.compile(
    r"^#\s+(?:\[\[)?([^\]\[|#]+?)(?:\|[^\]]*)?(?:\]\])?\s*$")
LABEL_RE = re.compile(r"^(.*?\bSession\s+)(\d+)\s*$", re.IGNORECASE)
DASH = " \u2014 "


def dash_key(title: str) -> str:
    """`key` with the hyphen, en dash and em dash read as one."""
    return key(re.sub(r"[\u2013\u2014]", "-", title))


def find_pc(batch: Batch, name: str) -> str:
    """The vault-relative path of the one PC note called (or aliased) `name`."""
    want = vl.normalize(name)
    hits = []
    for rel, text in vl.vault_files(batch.vault):
        if rel.endswith("_Story.md"):
            continue
        fm = vl.extract_frontmatter(text) or {}
        if vl.entity_type(fm) != "pc":
            continue
        names = [Path(rel).stem, *vl.frontmatter_aliases(text)]
        if want in {vl.normalize(n) for n in names}:
            hits.append(rel)
    if not hits:
        raise WriteError(f"PC '{name}': not found (a line starting with "
                         f"'# ' opens a new PC's entry; an entry cannot "
                         f"hold a '# ' heading)")
    if len(hits) != 1:
        raise WriteError(f"PC '{name}': matches " + ", ".join(sorted(hits)))
    return hits[0]


def split_entries(text: str, noun: str = "PC"
                  ) -> list[tuple[str, str | None, list[str]]]:
    """(the PC's or NPC's name, the entry's own `## ` heading or None, its
    lines). An entry that opens with a `## ` line is headed exactly so.
    `noun` names what the entries are about in the refusals."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    raw: list[tuple[str, list[str]]] = []
    fence = False
    for line in lines:
        if line.lstrip().startswith(("```", "~~~")):
            fence = not fence
        m = None if fence else PC_LINE_RE.match(line)
        if m:
            raw.append((m.group(1).strip(), []))
        elif raw:
            raw[-1][1].append(line)
        elif line.strip():
            raise WriteError(f"stdin must start with a '# [[{noun} Name]]' "
                             f"line")
    if not raw:
        raise WriteError("nothing on stdin")
    out: list[tuple[str, str | None, list[str]]] = []
    for name, body in raw:
        while body and not body[0].strip():
            body.pop(0)
        while body and not body[-1].strip():
            body.pop()
        custom = None
        if body and re.match(r"^##\s+\S", body[0]):
            custom = body.pop(0).rstrip()
            while body and not body[0].strip():
                body.pop(0)
        if not body:
            raise WriteError(f"{noun} '{name}': the entry is empty")
        if any(h[1] <= 2 for h in vl.fenced_headings("\n".join(body))):
            raise WriteError(f"{noun} '{name}': an entry cannot hold a # or ## "
                             f"heading after its own (it would read as "
                             f"another session)")
        out.append((name, custom, body))
    return out


def story_label(story: str | None, number: int) -> str:
    """`Session N` in the shape of the file's last entry heading."""
    last = None
    for h in (parse(story).heads if story else []):
        if h.level == 2:
            m = LABEL_RE.match(re.split(r"\s+[\u2014\u2013-]\s+", h.title,
                                        maxsplit=1)[0])
            if m:
                last = m
    if last is None:
        return f"Session {number}"
    return f"{last.group(1)}{number:0{len(last.group(2))}d}"


@dataclass
class WrapInfo:
    rel: str
    text: str
    number: int
    title: str
    canon: str
    date: str   # "" when neither --date nor a play_date gives one
    chapter: str | None = None   # vl.chapter_of the Wrap-Up


def read_wrapup(batch: Batch, args: argparse.Namespace) -> WrapInfo:
    """The session number, title, canon status and play date a Wrap-Up
    names; `--date` overrides the date."""
    wrap_rel = batch.note_named(args.wrapup, vc.WRAP_TYPES, "--wrapup")
    wrap = batch.read(wrap_rel)
    fm = vl.extract_frontmatter(wrap) or {}
    if vl.entity_type(fm) not in vc.WRAP_TYPES:
        raise WriteError(f"{wrap_rel}: not a Wrap-Up")
    number = vl.parse_session_number(fm.get("session_number"))
    if number is None:
        number = vl.session_ref_number(fm)
    if number is None:
        raise WriteError(f"{wrap_rel}: no session number")
    stem = vl.wikilink_target(fm.get("session")) or ""
    title = stem.split(" - ", 1)[1] if " - " in stem else stem
    if not title:
        raise WriteError(f"{wrap_rel}: `session:` names no session")
    canon = raw_value(wrap, "canon_status") or "DRAFT"
    played = vl.unquote(raw_value(wrap, "play_date") or "")
    if played.casefold() in vc.YAML_NULLS:
        played = ""   # the template's `play_date: null`: no date yet
    return WrapInfo(wrap_rel, wrap, number, title, canon, args.date or played,
                    vl.chapter_of(wrap_rel, fm))


def cmd_story(batch: Batch, args: argparse.Namespace, text: str) -> None:
    info = read_wrapup(batch, args)
    wrap = info.text
    number, title, canon, date = (info.number, info.title, info.canon,
                                  info.date)
    replaced: set[str] = set()
    for name, custom, body in split_entries(text):
        pc_rel = find_pc(batch, name)
        rel = pc_rel[:-3] + "_Story.md"
        existing = batch.read(rel) if batch.exists(rel) else None
        label = args.label or story_label(existing, number)
        repeats = False
        if not args.label:
            # Per-chapter numbering: `Chapter C Session N`, as npc-story.
            chap_label, _c, repeats = npc_label(batch.vault, info)
            if chap_label.startswith("Chapter "):
                label = chap_label.split(" Session ")[0] + " " + re.sub(
                    r"(?i)^chapter\s+\d+\s+", "", label)
        heading = custom or f"## {label}{DASH}{title}"
        if args.replace:
            if rel in replaced:
                raise WriteError(f"PC '{name}': given twice")
            replaced.add(rel)
            story_replace(batch, args, rel, existing, info,
                          f"## {label}{DASH}{title}", custom, body)
            continue
        opener = closer = ""
        if existing is None:
            fm_lines = [line + "\n" for line in template_frontmatter(
                template_text(batch.vault, STORY_TEMPLATES,
                              "character-story.md"))]
            eol, tail = "\n", ""
            opener, closer = "---\n", "---\n"
        else:
            lines = existing.splitlines(keepends=True)
            # A BOM is part of the opener's bytes, not of the delimiter.
            probe = [lines[0].lstrip("\ufeff"), *lines[1:]] if lines else lines
            end, error = vl.frontmatter_span(probe)
            if error:
                raise WriteError(f"{rel}: {error}")
            eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
            opener, closer = lines[0], lines[end]
            if not closer.endswith(("\n", "\r")):
                closer += eol
            fm_lines, tail = lines[1:end], "".join(lines[end + 1:])
            if any(h.level == 2 and dash_key(h.title) == dash_key(heading[3:])
                   for h in parse(existing).heads):
                raise WriteError(f"{rel}: already has '{heading}'")
        old_as_of = vl.get_key(fm_lines, "asOfSession")
        old_plain = vl.unquote(old_as_of or "")
        as_of = args.as_of or (
            str(number) if existing is not None
            and re.fullmatch(r"\d+", old_plain) else label)
        # Where numbers repeat by chapter, the heading check above is the
        # one that tells sessions apart: a bare `2` names either chapter's.
        if existing is not None and old_plain == as_of and not repeats:
            raise WriteError(f"{rel}: already has an entry for {as_of} "
                             f"(asOfSession)")
        quoted_int = (old_as_of or "")[:1] in ('"', "'")
        stamps = {"asOfSession": vl.yaml_scalar(as_of, quoted_int=quoted_int),
                  "canon_status": canon}
        if date:
            stamps["lastUpdated"] = vl.yaml_scalar(date)
        if existing is None:
            stamps["character"] = f'"[[{Path(pc_rel).stem}]]"'
            stamps["createdSession"] = vl.yaml_scalar(as_of)
            campaign = raw_value(wrap, "campaign")
            if campaign:
                stamps["campaign"] = campaign
        for field, value in stamps.items():
            vl.set_key(fm_lines, field, value, eol)
        if tail and not tail.endswith(("\n", "\r")):
            tail += eol
        entry = eol.join(["", heading, "", *body]) + eol
        new = opener + "".join(fm_lines) + closer + tail + entry
        if existing is None:
            batch.create(rel, new)
            batch.row("WOULD-CREATE", rel, f"\u00a7{heading[3:]}", "")
        else:
            batch.put(rel, new)
            batch.row("WOULD-ADD", rel, f"\u00a7{heading[3:]}", "")
        if not date:
            batch.row("WARNING", rel, "", "no play_date on the Wrap-Up and "
                      "no --date: lastUpdated left as it was")


STORY_SESSION_RE = re.compile(
    r"^(?:chapter\s+0*(\d+)\b[\s,]*)?session\s+0*(\d+)\s*$", re.IGNORECASE)


def story_same_entry(title: str, info: WrapInfo, chapter: int | None,
                     repeats: bool) -> bool:
    """Is the Story entry headed `## title` this session's? Its label names
    the same number (any padding), and the same chapter when the label
    names one (even where no other chapter's index is left to say the
    numbers repeat); where they repeat, an unlabelled entry needs the same
    session title."""
    parts = re.split(r"\s+[\u2014\u2013-]\s+", title, maxsplit=1)
    m = STORY_SESSION_RE.match(parts[0].strip())
    if not m or int(m.group(2)) != info.number:
        return False
    if m.group(1) is not None and chapter is not None:
        return int(m.group(1)) == chapter
    if not repeats:
        return True
    return len(parts) == 2 and dash_key(parts[1]) == dash_key(info.title)


def _hidden_kinds(text: str) -> Counter[str]:
    """How many of each kind of hidden text `text` holds outside code
    fences: gm-only blocks, spoiler blocks (an opener on a line of its own
    or inline), HTML comments (not block markers) and `%%` marks."""
    states, _p = scan_body(text, ())
    kinds: Counter[str] = Counter()
    for st in states:
        if st.in_code:
            continue
        for _pos, word, is_close in vl.markers_in(st.line):
            if not is_close:
                kinds[f"{word} block"] += 1
        kinds["HTML comment"] += ANY_MARKER_RE.sub("", st.line).count("<!--")
        kinds["%% comment"] += st.line.count("%%")
    return kinds


def replaced_asides(doc: Doc, head: Head, body: list[str]) -> list[str]:
    """Each kind of hidden text (`_hidden_kinds`) the section `head` opens
    holds more of than `body` does: dropping one of two gm-only blocks
    counts, though the other is kept."""
    end = section_end(doc, head)
    old = _hidden_kinds("".join(doc.lines[head.idx + 1:end]))
    new = _hidden_kinds("\n".join(body) + "\n")
    order = ("gm-only block", "spoiler block", "HTML comment", "%% comment")
    return [k for k in order if old[k] > new[k]]


def hidden_hint(what: str, kinds: list[str]) -> str:
    return (f"the old {what} holds a " + ", ".join(kinds)
            + " the new text lacks: it goes too")


def restamp(text: str, rel: str, stamps: dict[str, str]) -> str:
    """`text` with the frontmatter `stamps` set, nothing else changed."""
    if not stamps:
        return text
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(
        [lines[0].lstrip("\ufeff"), *lines[1:]] if lines else lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm_lines = lines[1:end]
    if "asOfSession" in stamps:
        # A quoted number stays quoted, as the add path keeps it.
        old = vl.get_key(fm_lines, "asOfSession") or ""
        stamps = {**stamps, "asOfSession": vl.yaml_scalar(
            stamps["asOfSession"], quoted_int=old[:1] in ('"', "'"))}
    for field, value in stamps.items():
        vl.set_key(fm_lines, field, value, eol)
    return "".join([*lines[:1], *fm_lines, *lines[end:]])


def replace_stamps(args: argparse.Namespace) -> dict[str, str]:
    """What --replace stamps: `asOfSession` (the raw value; `restamp`
    quotes it) and `lastUpdated` only when --as-of and --date say so."""
    stamps = {}
    if args.as_of:
        stamps["asOfSession"] = args.as_of
    if args.date:
        stamps["lastUpdated"] = vl.yaml_scalar(args.date)
    return stamps


def story_replace(batch: Batch, args: argparse.Namespace, rel: str,
                  existing: str | None, info: WrapInfo, default: str,
                  custom: str | None, body: list[str]) -> None:
    """Replace the session's entry in a Story companion. The entry is the
    `## ` one for this session (`story_same_entry`), or, with --label or a
    heading on stdin, the one headed so. It gets `body`, under the stdin
    heading when given and its own otherwise. Every other entry is left
    as it is; frontmatter only as --as-of and --date say."""
    if existing is None:
        raise WriteError(f"{rel}: no Story file, so no entry for session "
                         f"{info.number} to replace")
    doc = parse(existing)
    wants = {dash_key(default[3:])}
    if custom:
        wants.add(dash_key(custom[3:]))
    _label, chapter, repeats = npc_label(batch.vault, info)
    hits = [h for h in doc.heads if h.level == 2 and not h.gm and (
        dash_key(h.title) in wants
        or (not args.label and story_same_entry(h.title, info, chapter,
                                                repeats)))]
    if not hits:
        raise WriteError(f"{rel}: no entry for session {info.number} "
                         f"('{custom or default}') to replace")
    if len(hits) > 1:
        raise WriteError(f"{rel}: {len(hits)} entries for session "
                         f"{info.number} (" + ", ".join(
                             f"'## {h.title}'" for h in hits)
                         + "): replace by hand")
    head = hits[0]
    new_heading = custom or doc.lines[head.idx].rstrip("\r\n")
    gone = replaced_asides(doc, head, body)
    if gone:
        batch.row("HINT", rel, f"\u00a7{head.title}",
                  hidden_hint("entry", gone))
    text, count = _replace(doc, head, [new_heading, "", *body])
    batch.put(rel, restamp(text, rel, replace_stamps(args)))
    batch.row("WOULD-ADD", rel, f"\u00a7{new_heading[3:]}",
              f"replaced ({count} lines)")


# --- NPC story ---------------------------------------------------------------

# A session passage's heading, as `npc-story` writes it and as notes like
# Marlo's carry it: `### Session N: Title`; `Session 0N` and a
# `Chapter C Session N` label are the same session N.
NPC_SESSION_RE = re.compile(
    r"^(?:chapter\s+0*(\d+)\s+)?session\s+0*(\d+)\b\s*:?\s*(.*)$",
    re.IGNORECASE)
CHAPTER_NO_RE = re.compile(r"(?i)\bchapter[\s_]+0*(\d+)")


def find_npc(batch: Batch, name: str) -> str:
    """The vault-relative path of the one NPC note called (or aliased)
    `name`. An archived, QA or Midwife copy is never it (`is_record`)."""
    want = vl.normalize(name)
    hits = []
    for rel, text in vl.vault_files(batch.vault):
        if is_record(rel):
            continue
        fm = vl.extract_frontmatter(text) or {}
        if vl.entity_type(fm) != "npc":
            continue
        names = [Path(rel).stem, *vl.frontmatter_aliases(text)]
        if want in {vl.normalize(n) for n in names}:
            hits.append(rel)
    if not hits:
        raise WriteError(f"NPC '{name}': not found")
    if len(hits) != 1:
        raise WriteError(f"NPC '{name}': matches " + ", ".join(sorted(hits)))
    return hits[0]


def hidden_sections(vault: Path) -> list[str]:
    """`player_site.hide.sections`: the section titles players never see."""
    hides = vl.setting_or_builtin(vault, "player_site.hide.sections")
    return [str(h) for h in hides] if isinstance(hides, list) else []


def npc_sections(text: str, doc: Doc, vault: Path) -> list[tuple[Head, str]]:
    """Each `##` section of the note, with why players never see it (""
    when they do): inside a gm-only or spoiler fence, or hidden by
    `player_site.hide.sections` as the publish tool reads it."""
    hides = hidden_sections(vault)
    try:
        states, _problems = scan_body(text, hides)
        hidden_by = {s.lineno - 1: s.excluded_by for s in states}
    except vl.PublishToolUnavailable:
        # No tool to ask: a heading named in the list is hidden.
        named = {key(h) for h in hides}
        hidden_by = {h.idx: h.title for h in doc.heads
                     if key(h.title) in named}
    at = {s.lineno - 1: s for s in doc.states}
    out = []
    for h in doc.heads:
        if h.level != 2:
            continue
        state = at[h.idx]
        why = ("is inside a gm-only fence" if state.gm_depth else
               "is inside a spoiler fence" if state.spoiler_depth else
               "is hidden from the player site (player_site.hide.sections: "
               f"{hidden_by[h.idx]})" if hidden_by.get(h.idx) else "")
        out.append((h, why))
    return out


def npc_passages(doc: Doc, head: Head) -> list[tuple[Head, int]]:
    """The `### Session N` headings in the section `head` opens, with N."""
    end = section_end(doc, head)
    out = []
    for h in doc.heads:
        m = NPC_SESSION_RE.match(h.title) if h.level == 3 else None
        if m and head.idx < h.idx < end:
            out.append((h, int(m.group(2))))
    return out


def npc_label(vault: Path, info: WrapInfo) -> tuple[str, int | None, bool]:
    """(label, chapter number, numbers repeat) for the Wrap-Up's passage.
    Where another chapter has a session of the same number (the vault
    numbers sessions per chapter), the label is `Chapter C Session N`;
    otherwise `Session N`, as notes like Marlo's carry it."""
    def chapter_no(chapter: str | None) -> int | None:
        m = CHAPTER_NO_RE.search(chapter or "")
        return int(m.group(1)) if m else None
    repeats = any(n == info.number and ch != info.chapter
                  for _rel, n, ch, _d in session_indexes(vault))
    c = chapter_no(info.chapter)
    if repeats and c is not None:
        return f"Chapter {c} Session {info.number}", c, True
    return f"Session {info.number}", c, repeats


def npc_same_passage(title: str, number: int, chapter: int | None,
                     repeats: bool, wrap_title: str) -> bool:
    """Is the passage headed `title` this session's? Same number, the same
    chapter when the heading names one, and in a vault whose numbers
    repeat, an unlabelled passage needs the same session title."""
    m = NPC_SESSION_RE.match(title)
    if not m or int(m.group(2)) != number:
        return False
    if m.group(1) is not None and chapter is not None:
        return int(m.group(1)) == chapter
    if not repeats:
        return True
    return key(m.group(3)) == key(wrap_title)


def npc_story_insert(doc: Doc, heading: str, body: list[str],
                     target: Head | None) -> list[str]:
    """The note's lines with the passage added at the end of `target`, or
    in a new `## Story` (before `## Related`, else before the first
    gm-only fence, else at the end) when `target` is None."""
    eol = doc.eol
    block = [heading, "", *body]
    if target is not None:
        at = section_end(doc, target)
    else:
        cands = [h.idx for h in doc.heads if not h.gm
                 and h.level == 2 and key(h.title) == "related"]
        cands += [s.lineno - 1 for s in doc.states if s.marker in OPENERS]
        at = min(cands) if cands else len(doc.lines)
        block = ["## Story", "", *block]
    q = at
    while q > 0 and not doc.lines[q - 1].strip():
        q -= 1
    new = [ln.rstrip("\r\n") + eol for ln in doc.lines[:q]]
    new.append(eol)
    new += [ln + eol for ln in block]
    if at < len(doc.lines):
        new.append(eol)
    new += doc.lines[at:]
    return new


def npc_heading_shows(text: str, heading: str, hides: list[str]) -> bool:
    """Does the player site render `heading` in `text`? The publish tool's
    own answer (an inline marker or an open comment hides what follows);
    with no tool to ask, the section checks already made stand."""
    try:
        shown = vl.publisher_lines(text, hides)
    except vl.PublishToolUnavailable:
        return True
    return heading in (line.strip() for line in shown)


def npc_replace(batch: Batch, args: argparse.Namespace, rel: str, doc: Doc,
                info: WrapInfo, target: Head | None,
                sections: list[tuple[Head, str]], body: list[str]) -> None:
    """Replace the session's passage in `target`, the section the add path
    would write it to (`## Story`, or --section's), with `body` under its
    own heading. A passage inside a gm-only block is never it, and no
    other section is searched: one there is named, never written. Every
    other passage is left as it is; frontmatter only as --as-of and
    --date say."""
    _label, chapter, repeats = npc_label(batch.vault, info)

    def same(sec: Head) -> list[Head]:
        return [h for h, _n in npc_passages(doc, sec) if not h.gm
                and npc_same_passage(h.title, info.number, chapter, repeats,
                                     info.title)]
    hits = same(target) if target is not None else []
    where = target.title if target is not None else "Story"
    if not hits:
        others = [h.title for h, why in sections
                  if not why and h is not target and same(h)]
        tail = (f"; '## {others[0]}' has one: pass --section \"{others[0]}\" "
                f"only if it is this NPC's story, not an appearance log"
                if others else "")
        raise WriteError(f"{rel}: no passage for session {info.number} "
                         f"under '## {where}' to replace{tail}")
    if len(hits) > 1:
        raise WriteError(f"{rel}: {len(hits)} passages for session "
                         f"{info.number} under '## {where}': replace by "
                         f"hand")
    head = hits[0]
    heading = doc.lines[head.idx].rstrip("\r\n")
    gone = replaced_asides(doc, head, body)
    if gone:
        batch.row("HINT", rel, f"\u00a7{head.title}",
                  hidden_hint("passage", gone))
    text, count = _replace(doc, head, [heading, "", *body])
    batch.put(rel, restamp(text, rel, replace_stamps(args)))
    batch.row("WOULD-ADD", rel, f"\u00a7{where}/{head.title}",
              f"replaced ({count} lines)")


def cmd_npc_story(batch: Batch, args: argparse.Namespace, text: str) -> None:
    # A correction of a passage already written is still the GM's to make.
    if not args.replace and not vl.setting_or_builtin(batch.vault,
                                                      "vault.voices"):
        raise WriteError("voices are off (vault.voices)")
    info = read_wrapup(batch, args)
    replaced: set[str] = set()
    for name, custom, body in split_entries(text, "NPC"):
        if custom:
            raise WriteError(f"NPC '{name}': an entry takes no '## ' "
                             f"heading of its own")
        if any(h[1] <= 3 for h in vl.fenced_headings("\n".join(body))):
            raise WriteError(f"NPC '{name}': a passage cannot hold a heading "
                             f"of its own (it would read as another passage)")
        rel = find_npc(batch, name)
        note = batch.read(rel)
        voice = vl.voice_read(note)
        if voice is None:
            raise WriteError(f"{rel}: its voice is {vl.VOICE_UNREADABLE}")
        if not voice:
            raise WriteError(f"{rel}: not a storied NPC: set its voice first")
        doc = parse(note)
        sections = npc_sections(note, doc, batch.vault)
        # `--section "## Overview"` and " Overview " name the same section.
        section = (args.section or "").strip().lstrip("#").strip()
        want = key(section) if section else "story"
        found = next(((h, why) for h, why in sections
                      if key(h.title) == want), None)
        if section and found is None:
            raise WriteError(f"{rel}: no '## {section}' section")
        target = found[0] if found else None
        if found and found[1]:
            raise WriteError(f"{rel}: '## {found[0].title}' {found[1]}; "
                             f"passages are for players")
        if args.replace:
            if rel in replaced:
                raise WriteError(f"NPC '{name}': given twice")
            replaced.add(rel)
            npc_replace(batch, args, rel, doc, info, target, sections, body)
            continue
        hides = hidden_sections(batch.vault)
        if found is None and "story" in {key(h) for h in hides}:
            raise WriteError(f"{rel}: '## Story' is hidden from the player "
                             f"site (player_site.hide.sections: Story); "
                             f"passages are for players")
        label, chapter, repeats = npc_label(batch.vault, info)
        if target is not None:
            for h, _n in npc_passages(doc, target):
                if npc_same_passage(h.title, info.number, chapter, repeats,
                                    info.title):
                    raise WriteError(f"{rel}: already has '{h.title}' "
                                     f"(session {info.number})")
        if not section:
            elsewhere = next((h for h, why in sections
                              if not why and h is not target
                              and npc_passages(doc, h)), None)
            if elsewhere is not None:
                batch.row("HINT", rel, "",
                          f"earlier session passages under ## "
                          f"{elsewhere.title}; pass --section "
                          f"\"{elsewhere.title}\" to keep them together")
        heading = f"### {label}: {info.title}"
        lines = npc_story_insert(doc, heading, body, target)
        if not npc_heading_shows("".join(lines), heading, hides):
            raise WriteError(f"{rel}: the passage would land inside a block "
                             f"the player site strips (a gm-only or spoiler "
                             f"block, or a comment left open), so players "
                             f"would never see it")
        where = target.title if target is not None else "Story"
        end, error = vl.frontmatter_span(
            [lines[0].lstrip("\ufeff"), *lines[1:]] if lines else lines)
        if error:
            raise WriteError(f"{rel}: {error}")
        fm_lines = lines[1:end]
        old_plain = vl.unquote(vl.get_key(fm_lines, "asOfSession") or "")
        as_of = args.as_of or (str(info.number)
                               if re.fullmatch(r"\d+", old_plain)
                               else f"Session {info.number}")
        stamps = {"asOfSession": vl.yaml_scalar(as_of)}
        if info.date:
            stamps["lastUpdated"] = vl.yaml_scalar(info.date)
        for field, value in stamps.items():
            vl.set_key(fm_lines, field, value, doc.eol)
        batch.put(rel, "".join([*lines[:1], *fm_lines, *lines[end:]]))
        batch.row("WOULD-ADD", rel, f"\u00a7{where}/{heading[4:]}", "")
        if not info.date:
            batch.row("WARNING", rel, "", "no play_date on the Wrap-Up and "
                      "no --date: lastUpdated left as it was")


# --- PC Current Status -------------------------------------------------------

CURRENT_STATUS = "Current Status"
FIELD_RE = re.compile(r"^(?P<bullet>[-*+][ \t]+)?\*\*(?P<label>[A-Za-z][^*]*?):\*\*")
PROTECTED = ("notes", GM_NOTES)


@dataclass
class Field:
    label: str
    bullet: str         # the list marker and its space, "" when unbulleted
    start: int          # line index in the note (or on stdin)
    end: int            # one past its last line
    lines: list[str]    # without line endings


def _indented_after(lines: list[str], i: int, end: int) -> bool:
    """Whether the blank run at `i` is followed, before `end`, by an
    indented line."""
    k = i
    while k < end and not lines[k].strip():
        k += 1
    return k < end and lines[k][:1].isspace()


def holds_list(first: str, rest: list[str]) -> bool:
    """Whether an unbulleted field (its first line `first`, then `rest`)
    is a list field: its label stands alone on its line, or a plain list
    item at the margin already sits under it. Only under such a field is
    a `- **Label:**` line a list item; under `**HP:** 12/12` it is the next field."""
    m = FIELD_RE.match(first)
    if m and not first[m.end():].strip():
        return True
    return any(LIST_RE.match(ln) and not ln[:1].isspace()
               and not FIELD_RE.match(ln) for ln in rest)


def read_fields(lines: list[str], rows: list[int]) -> list[Field]:
    """The labelled fields among `lines[i]` for i in `rows` (consecutive
    runs; a gap ends a field). A field is a `**Label:**` line at the
    margin, or a `- **Label:**` one unless a list field above it is open
    (there it is a thread item). An unbulleted field keeps the list
    items and indented lines under it; a bulleted one keeps its indented
    lines. A blank line ends a field unless an indented line follows it;
    a plain line (a lede) ends it."""
    fields: list[Field] = []
    cur: Field | None = None
    prev = -2
    stop = rows[-1] + 1 if rows else 0
    for i in rows:
        line = lines[i]
        if cur is not None and i != prev + 1:
            cur = None
        prev = i
        m = FIELD_RE.match(line)
        if cur is not None:
            if not line.strip():
                # Only an indented line carries a field past a blank line:
                # a margin bullet after one is the next thing in the
                # section (a journal entry), not this field's list.
                if not _indented_after(lines, i, stop):
                    cur = None
                continue
            # An unbulleted field holds the margin list under it; a
            # bulleted label there is an item only under a list field.
            item = (not cur.bullet and LIST_RE.match(line)
                    and not (m and m.group("bullet") and not holds_list(
                        lines[cur.start], lines[cur.start + 1:i])))
            if line[:1].isspace() or item:
                cur.end = i + 1
                continue
            cur = None
        if m and not line[:1].isspace():
            cur = Field(m.group("label").strip(), m.group("bullet") or "",
                        i, i + 1, [])
            fields.append(cur)
    for f in fields:
        f.lines = [ln.rstrip("\r\n") for ln in lines[f.start:f.end]]
    return fields


def _status_region(doc: Doc) -> tuple[Head | None, list[int]]:
    """(the public `## Current Status` heading, the lines its fields may
    sit on: its own lines up to its first subheading)."""
    head = next((h for h in doc.heads if h.level == 2 and not h.gm
                 and key(h.title) == key(CURRENT_STATUS)), None)
    if head is None:
        return None, []
    end = section_end(doc, head)
    end = next((h.idx for h in doc.heads if head.idx < h.idx < end), end)
    return head, own_lines(doc, head, end)


def stdin_fields(text: str) -> list[Field]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    if not any(line.strip() for line in lines):
        raise WriteError("nothing on stdin")
    if vl.fenced_headings("\n".join(lines)):
        raise WriteError("stdin holds a heading: send labelled fields only")
    lines = lines[next(i for i, line in enumerate(lines) if line.strip()):]
    if not FIELD_RE.match(lines[0]) or lines[0][:1].isspace():
        raise WriteError("stdin must start with a labelled field "
                         "('**Location:** ...')")
    fields: list[Field] = []
    for i, line in enumerate(lines):
        m = FIELD_RE.match(line)
        # A bulleted label is a list item only straight under (no blank
        # line between) an unbulleted list field.
        bulleted_item = (m and m.group("bullet") and fields
                         and not fields[-1].bullet and lines[i - 1].strip()
                         and holds_list(fields[-1].lines[0],
                                        fields[-1].lines[1:]))
        if m and not line[:1].isspace() and not bulleted_item:
            fields.append(Field(m.group("label").strip(),
                                m.group("bullet") or "", i, i + 1, [line]))
        else:
            fields[-1].lines.append(line)
    seen: set[str] = set()
    for f in fields:
        while f.lines and not f.lines[-1].strip():
            f.lines.pop()
        if key(f.label) in seen:
            raise WriteError(f"'{f.label}' is on stdin twice")
        seen.add(key(f.label))
    return fields


def reshape(field: Field, bullet: str) -> list[str]:
    """`field`'s lines in the note's shape: `bullet` is the marker the
    note's field carries ("" for an unbulleted one)."""
    m = FIELD_RE.match(field.lines[0])
    assert m is not None
    head = bullet + field.lines[0][m.end("bullet") if m.group("bullet")
                                   else 0:]
    rest = field.lines[1:]
    if field.bullet:
        indents = [len(ln) - len(ln.lstrip()) for ln in rest if ln.strip()]
        cut = min(indents, default=0)
        rest = [ln[cut:] for ln in rest]
    if bullet:
        pad = " " * len(bullet)
        rest = [pad + ln if ln.strip() else "" for ln in rest]
    return [head, *rest]


def status_target(batch: Batch, raw: str) -> tuple[str, str]:
    """(the PC note's path, its text): a vault-relative path, or a PC's
    name or alias."""
    rel = batch.resolve(raw) if raw.lower().endswith(".md") else find_pc(
        batch, raw)
    text = batch.read(rel)
    if vl.entity_type(vl.extract_frontmatter(text) or {}) != "pc":
        raise WriteError(f"{rel}: not a PC note")
    return rel, text


def show_status(batch: Batch, raw: str) -> str:
    """The labelled fields of a PC's Current Status, verbatim, and a line
    naming what else the section holds (left alone by `status`)."""
    rel, text = status_target(batch, raw)
    doc = parse(text)
    head, rows = _status_region(doc)
    if head is None:
        return f"{rel}: no ## {CURRENT_STATUS}\n"
    fields = read_fields(doc.lines, rows)
    used = {i for f in fields for i in range(f.start, f.end)}
    other = sum(1 for i in rows if i not in used and doc.lines[i].strip())
    subs = [f"{'#' * h.level} {h.title}" for h in doc.heads
            if head.idx < h.idx < section_end(doc, head)]
    out = [f"# {rel} §{CURRENT_STATUS}"]
    # A blank line between fields marks where each run ends, so the text
    # fed back to `--write` splits the way the note does.
    for n, f in enumerate(fields):
        if n:
            out.append("")
        out += f.lines
    out.append(f"# left alone: {other} other lines"
               + "".join(f"; {s}" for s in subs))
    return "\n".join(out) + "\n"


def cmd_status(batch: Batch, args: argparse.Namespace, text: str) -> None:
    rel, note = status_target(batch, args.pc)
    given = stdin_fields(text)
    write_fields(batch, rel, note, given)
    if any(key(f.label) == key(th.PC_PATH[1].strip("*:")) for f in given):
        warn_dropped_threads(batch, rel, note)


def warn_dropped_threads(batch: Batch, rel: str, before: str) -> None:
    """One WARNING per thread on the PC's Open threads before the rewrite
    whose lead (see `threads.lead`) no thread after it has: a rewrite may
    drop one by mistake, and a thread that ended is Reconcile's to close,
    with the GM. Rewording is fine, so this warns and never refuses."""
    after = [t.text for t in th.pc_thread_items(batch.read(rel))]
    pc = Path(rel).stem
    for thread in th.pc_thread_items(before):
        name = th.lead(thread.text)
        if not th.find_thread(after, name):
            batch.row("WARNING", rel, f"\u00a7{CURRENT_STATUS}/Open threads",
                      f"drops '{name}' from {pc}'s Open threads: if it "
                      f"ended, keep it on the list for Reconcile's thread "
                      f"step to close; if it is shared now, use "
                      f"`vw threads move`")


def threads_overview(batch: Batch) -> str:
    """The Campaign Overview's path (`vaultlib.campaign_overview`: never an
    archived or QA copy)."""
    found = vl.campaign_overview(
        (rel, vl.extract_frontmatter(text) or {})
        for rel, text in vl.vault_files(batch.vault, newline=""))
    if found is None:
        raise WriteError("no Campaign Overview to hold shared threads")
    return found


def threads_who(batch: Batch, who: str) -> list[str] | None:
    """The PC note names a row's `involves` column holds; None for
    `party`."""
    if who.strip().casefold() == "party":
        return None
    names = [n.strip() for n in who.split(",") if n.strip()]
    if not names:
        raise WriteError("no PC named in the involves column")
    out: list[str] = []
    for name in names:
        stem = Path(find_pc(batch, name)).stem
        if all(stem.casefold() != o.casefold() for o in out):
            out.append(stem)   # a PC named twice is one PC
    return out


def threads_find(bullets: list[str], lead_key: str, where: str) -> int:
    hits = th.find_thread(bullets, lead_key)
    if not hits:
        raise WriteError(f"{where}: no thread '{lead_key}'")
    if len(hits) > 1:
        raise WriteError(f"{where}: {len(hits)} threads match '{lead_key}'; "
                         f"use more of its text")
    return hits[0]


def threads_take(batch: Batch, rel: str, lead_key: str,
                 verb: str) -> th.PcThread:
    """Take the PC's thread `lead_key` off their Open threads and return
    it (its text has wrapped lines and nested bullets). A thread in or
    next to hidden text is refused: it must not reach a player-facing
    list, and taking it out could split a hidden block."""
    note = batch.read(rel)
    found = th.pc_thread_items(note)
    thread = found[threads_find([t.text for t in found], lead_key, rel)]
    if thread.hidden:
        raise WriteError(f"'{lead_key}' on {Path(rel).stem} is next to "
                         f"hidden text; edit it by hand")
    batch.put(rel, th.remove_pc_thread(note, thread))
    batch.row(verb, rel, "\u00a7Current Status/Open threads", lead_key)
    return thread


def threads_hidden_shared(lead_key: str, section: str = th.SECTION) -> str:
    return (f"'{lead_key}' in the Overview's {section} is in or next "
            f"to hidden text; edit it by hand")


def threads_take_shared(batch: Batch, overview: str, lead_key: str,
                        section: str, verb: str) -> th.SharedThread:
    """Take the shared thread `lead_key` off the Overview's `section`
    (Open or Dormant Threads) and return it. One in or next to hidden
    text is refused: taking it out could leave the secret as text and an
    orphan comment closer."""
    note = batch.read(overview)
    found = th.shared_threads(note, section)
    i = threads_find([t.text for t in found], lead_key, overview)
    if found[i].hidden:
        raise WriteError(threads_hidden_shared(lead_key, section))
    try:
        batch.put(overview, th.remove_shared(note, i, section))
    except (KeyError, IndexError):
        raise WriteError(f"{overview}: cannot take thread '{lead_key}' "
                         f"off {section}") from None
    batch.row(verb, overview, f"\u00a7{section}", lead_key)
    return found[i]


def threads_wrapup_session(batch: Batch, wrap_rel: str) -> str:
    """`Session N` for the Wrap-Up, read as the rest of this file reads
    one: its `session_number`, else the number in its `session` link."""
    fm = vl.extract_frontmatter(batch.read(wrap_rel)) or {}
    number = vl.parse_session_number(fm.get("session_number"))
    if number is None:
        number = vl.session_ref_number(fm)
    if number is None:
        raise WriteError(f"{wrap_rel}: no session number")
    return f"Session {number}"


def threads_insert(batch: Batch, overview: str, text: str, since: str | None,
                   involves: list[str] | None, verb: str) -> None:
    try:
        batch.put(overview, th.insert_shared(
            batch.read(overview), th.format_shared(text, since, involves)))
    except ValueError:
        raise WriteError(
            f"{overview}: the Campaign Overview has no place outside a "
            f"GM-only fence for Open Threads") from None
    batch.row(verb, overview, "\u00a7Open Threads", th.lead(text))


@dataclass
class ThreadsScope:
    """The vault as a `threads` batch found it (see `threads_scope`)."""
    files: list[tuple[str, str, dict[str, Any]]]
    chapter: str | None
    # Read on first use: the Wrap-Up lines on no list, as (session,
    # bullet), and the lists a `wrapup` row's lead must not be on.
    unlisted: list[tuple[int, str]] | None = None
    lists: list[tuple[str, list[str]]] | None = None
    # Indexes into `unlisted` a row of this batch has already taken.
    taken: set[int] = dc_field(default_factory=set)


def threads_scope(batch: Batch) -> ThreadsScope:
    """The vault's notes and current chapter as the batch found them, read
    once a batch. Nothing is written before the batch is applied, so the
    files on disk are the vault before any row ran."""
    import session_context as sc   # it imports this module at its top
    if batch.scope is None:
        files = list(sc.vault_files(batch.vault))
        chosen, _warnings = sc.select_session(files, None)
        batch.scope = ThreadsScope(files,
                                   chosen["chapter"] if chosen else None)
    return batch.scope


def threads_unlisted(batch: Batch, verb: str,
                     lead_key: str) -> tuple[int, int, str]:
    """The Wrap-Up lines on no thread list that `lead_key` names, as one
    thread: (the first session one appears in, the newest one's session,
    the newest one's text). Read as the batch found the vault, so a row
    may close a line another row of the batch has just put on a list in
    other words; a line one row takes is gone for the rows after it.
    Refused when the lead is on a list (that thread closes or rests
    there, and its Wrap-Up lines are claimed by it), or when none match."""
    import session_context as sc   # it imports this module at its top
    scope = threads_scope(batch)
    if scope.unlisted is None:
        scope.unlisted = sc.unlisted_wrapup_threads(
            scope.files, scope.chapter, batch.vault)
        texts = {rel: text for rel, text, _fm in scope.files}
        note = texts.get(threads_overview(batch), "")
        scope.lists = [
            ("the shared list", [t.text for t in th.shared_threads(note)]),
            ("the dormant list",
             [t.text for t in th.shared_threads(note, th.DORMANT)])]
        gone = vl.out_of_play(batch.vault)
        for rel, text, fm in scope.files:
            if vl.is_active_pc(rel, fm, gone):
                scope.lists.append((f"{Path(rel).stem}'s Open threads",
                                    [t.text for t in th.pc_thread_items(text)]))
    unlisted = scope.unlisted
    hits = [i for i in th.find_thread([b for _n, b in unlisted], lead_key)
            if i not in scope.taken]
    for name, bullets in scope.lists or []:
        if th.find_thread(bullets, lead_key):
            raise WriteError(f"{verb}: '{lead_key}' is on {name}: {verb} "
                             f"it there")
    if not hits:
        raise WriteError(f"{verb}: no Wrap-Up line on no list matches "
                         f"'{lead_key}'")
    scope.taken.update(hits)
    newest = max(hits, key=lambda i: (unlisted[i][0], i))
    return (min(unlisted[i][0] for i in hits),
            unlisted[newest][0], unlisted[newest][1])


def threads_row(batch: Batch, cols: list[str], wrapup: list[str]) -> None:
    verb = cols[0].strip().casefold()
    if verb == "add":
        if len(cols) != 5 or cols[1].strip().casefold() != "shared":
            raise WriteError("add needs: add TAB shared TAB since TAB who "
                             "TAB text")
        since = None if cols[2].strip() in ("", "-") else cols[2].strip()
        if not cols[4].strip():
            raise WriteError("add: the thread text is empty")
        threads_insert(batch, threads_overview(batch), cols[4].strip(),
                       since, threads_who(batch, cols[3]), "WOULD-ADD")
    elif verb == "move":
        if len(cols) != 4:
            raise WriteError("move needs: move TAB lead TAB since TAB who")
        lead_key = cols[1].strip()
        if not lead_key:
            raise WriteError("move: the lead is empty")
        since = None if cols[2].strip() in ("", "-") else cols[2].strip()
        old_tool = vc.shared_threads_tool_too_old(batch.vault)
        if old_tool is not None:
            # A moved thread would drop off the PC's page until then.
            raise WriteError(old_tool[1])
        names = threads_who(batch, cols[3])
        overview = threads_overview(batch)
        # Every named PC is involved; the thread comes off each that has
        # it. `party` names every active PC.
        if names is None:
            gone = vl.out_of_play(batch.vault)
            pcs = sorted(rel for rel, t in vl.vault_files(batch.vault,
                                                          newline="")
                         if vl.is_active_pc(
                             rel, vl.extract_frontmatter(t) or {}, gone))
        else:
            pcs = [find_pc(batch, n) for n in names]
        pcs = [r for r in pcs
               if th.find_thread([t.text for t in th.pc_thread_items(
                   batch.read(r))], lead_key)]
        if not pcs:
            raise WriteError(f"no {'active' if names is None else 'named'} "
                             f"PC has a thread '{lead_key}'")
        taken = [threads_take(batch, rel, lead_key, "WOULD-MOVE")
                 for rel in pcs]
        texts = [t.text for t in taken]
        if len({t.lines for t in taken}) > 1:
            raise WriteError(
                f"the PCs word '{lead_key}' differently: "
                + " | ".join(f"{Path(r).stem}: {t}"
                             for r, t in zip(pcs, texts))
                + " \u2014 make them match, or add the shared thread and "
                  "close each PC's own")
        note = batch.read(overview)
        shared = [t for t in th.shared_threads(note) if not t.hidden]
        hits = th.find_thread([t.text for t in shared], lead_key)
        if len(hits) > 1:
            raise WriteError(f"{overview}: {len(hits)} threads match "
                             f"'{lead_key}'; use more of its text")
        if not hits and th.find_thread(
                [t.text for t in th.shared_threads(note) if t.hidden],
                lead_key):
            raise WriteError(threads_hidden_shared(lead_key))
        if hits:
            # Already shared: the PCs' copies go, and the entry comes to
            # involve every holder and every PC named (a party one stays).
            entry = shared[hits[0]]
            if " ".join(entry.text.split()) != " ".join(texts[0].split()):
                raise WriteError(
                    f"'{lead_key}' is already a shared thread, worded "
                    f"differently: shared: {entry.text} | "
                    f"{Path(pcs[0]).stem}: {texts[0]} \u2014 make them "
                    f"match, or close the PCs' copies")
            wider = th.widen_shared(
                note, entry.text, [Path(r).stem for r in pcs] + (names or []))
            if wider != note:
                batch.put(overview, wider)
                batch.row("WOULD-MOVE", overview, "\u00a7Open Threads",
                          lead_key)
            return
        threads_insert(batch, overview, texts[0], since, names, "WOULD-MOVE")
    elif verb == "rest":
        if len(cols) not in (4, 5):
            raise WriteError("rest needs: rest TAB list TAB lead TAB why "
                             "[TAB who, for wrapup]")
        which, lead_key, why = (c.strip() for c in cols[1:4])
        if not (which and lead_key and why):
            raise WriteError("rest needs a list, a lead and a reason; "
                             "one is empty")
        if len(cols) == 5 and which.casefold() != "wrapup":
            raise WriteError("rest: WHO is only for a wrapup line; a "
                             "listed thread keeps whom it involves")
        old_tool = vc.dormant_threads_tool_too_old(batch.vault)
        if old_tool is not None:
            # The site would publish the dormant list until then.
            raise WriteError(old_tool[1])
        # `;` ends the clause when the entry is read back.
        why = " ".join(why.replace(";", ",").split())
        dormant = f"{threads_wrapup_session(batch, wrapup[0])} ({why})"
        overview = threads_overview(batch)
        involves: list[str] | None
        if which.casefold() == "wrapup":
            # Every wording of the lead goes dormant as one thread: the
            # newest words, since the first session that raised it.
            first, _last, text = threads_unlisted(batch, "rest", lead_key)
            since = f"Session {first}"
            involves = (threads_who(batch, cols[4]) if len(cols) == 5
                        else None)
        elif which.casefold() == "shared":
            entry = threads_take_shared(batch, overview, lead_key,
                                        th.SECTION, "WOULD-REST")
            since, text = entry.since, entry.text
            involves = None if entry.party else entry.involves
        else:
            import session_context as sc   # it imports this module at its top
            rel = find_pc(batch, which)
            text = threads_take(batch, rel, lead_key, "WOULD-REST").text
            # The first session the threads report ages it from.
            scope = threads_scope(batch)
            seen, _mark = sc.match_sessions(
                text, sc.wrap_up_threads(scope.files, scope.chapter))
            since = f"Session {min(seen)}" if seen else None
            involves = [Path(rel).stem]
        try:
            batch.put(overview, th.insert_shared(
                batch.read(overview),
                th.format_dormant(text, since, involves, dormant),
                th.DORMANT))
        except ValueError:
            raise WriteError(
                f"{overview}: the Campaign Overview has no place "
                f"outside a GM-only fence for Dormant Threads") from None
        batch.row("WOULD-REST", overview, f"\u00a7{th.DORMANT}", lead_key)
    elif verb == "wake":
        if len(cols) not in (3, 4):
            raise WriteError("wake needs: wake TAB lead TAB who [TAB text]")
        lead_key = cols[1].strip()
        if not lead_key:
            raise WriteError("wake: the lead is empty")
        names = threads_who(batch, cols[2])
        overview = threads_overview(batch)
        entry = threads_take_shared(batch, overview, lead_key, th.DORMANT,
                                    "WOULD-WAKE")
        # A woken thread lands on a list players read: TEXT, when given,
        # is how it reads there.
        text = (cols[3].strip() if len(cols) == 4 and cols[3].strip()
                else entry.text)
        if names is not None and len(names) == 1:
            rel = find_pc(batch, names[0])
            try:
                batch.put(rel, th.add_pc_thread(batch.read(rel), text))
            except (KeyError, ValueError) as e:
                raise WriteError(
                    f"{rel}: no place to add the thread on Open threads "
                    f"({e.args[0] if e.args else e}); edit it by hand"
                ) from None
            batch.row("WOULD-WAKE", rel, "\u00a7Current Status/Open threads",
                      lead_key)
        else:
            threads_insert(batch, overview, text, entry.since,
                           names, "WOULD-WAKE")
    elif verb == "hand":
        # A PC's line about another PC's matter goes to that PC's list.
        if len(cols) != 4:
            raise WriteError("hand needs: hand TAB from TAB lead TAB to")
        giver, lead_key, taker = (c.strip() for c in cols[1:])
        if not (giver and lead_key and taker):
            raise WriteError("hand needs a PC to take it from, a lead and "
                             "a PC to give it to; one is empty")
        src, dst = find_pc(batch, giver), find_pc(batch, taker)
        if src == dst:
            raise WriteError(f"hand: '{giver}' and '{taker}' are the same PC")
        text = threads_take(batch, src, lead_key, "WOULD-HAND").text
        try:
            batch.put(dst, th.add_pc_thread(batch.read(dst), text))
        except (KeyError, ValueError) as e:
            raise WriteError(
                f"{dst}: no place to add the thread on Open threads "
                f"({e.args[0] if e.args else e}); edit it by hand"
            ) from None
        batch.row("WOULD-HAND", dst, "\u00a7Current Status/Open threads",
                  lead_key)
    elif verb == "close":
        if len(cols) != 4:
            raise WriteError("close needs: close TAB list TAB lead TAB "
                             "evidence")
        which, lead_key, evidence = (c.strip() for c in cols[1:])
        if not (which and lead_key and evidence):
            raise WriteError("close needs a list, a lead and evidence; "
                             "one is empty")
        if which.casefold() == "wrapup":
            # Every wording of the lead closes as one line: the newest
            # words, labelled with their session.
            _first, last, text = threads_unlisted(batch, "close", lead_key)
            lines = [th.format_resolved(text, evidence, f"Session {last}")]
        else:
            if which.casefold() in ("shared", "dormant"):
                label = which.casefold()
                section = th.SECTION if label == "shared" else th.DORMANT
                text = threads_take_shared(
                    batch, threads_overview(batch), lead_key, section,
                    "WOULD-CLOSE").text
            else:
                rel = find_pc(batch, which)
                label = Path(rel).stem
                text = threads_take(batch, rel, lead_key,
                                    "WOULD-CLOSE").text
            lines = [th.format_resolved(text, evidence, label)]
        try:
            for line in lines:
                batch.put(wrapup[0], th.append_resolved(
                    batch.read(wrapup[0]), line))
        except KeyError:
            raise WriteError(f"{wrapup[0]}: no What Carries Forward section "
                             f"to hold Resolved Threads") from None
        batch.row("WOULD-RECORD", wrapup[0], "\u00a7Resolved Threads",
                  lead_key)
    else:
        raise WriteError(f"unknown row '{verb}': use add, move, close, "
                         f"rest, wake or hand")


def cmd_threads(batch: Batch, args: argparse.Namespace, text: str) -> None:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise WriteError("no rows on stdin")
    rows = [ln.split("\t") for ln in lines]
    wrapup: list[str] = []
    needs = {r[0].strip().casefold() for r in rows} & {"close", "rest"}
    if needs:
        if not args.wrapup:
            raise WriteError(
                "close needs --wrapup: a closed thread is recorded in the "
                "Wrap-Up" if "close" in needs else
                "rest needs --wrapup: the dormant clause names the "
                "Wrap-Up's session")
        wrapup = [batch.note_named(args.wrapup, vc.WRAP_TYPES, "wrapup")]
    errors: list[str] = []
    done = {"close": "closed", "rest": "rested", "wake": "woken",
            "hand": "handed"}
    for n, cols in enumerate(rows, 1):
        saved = (dict(batch.texts), dict(batch.originals), len(batch.rows),
                 set(batch.scope.taken) if batch.scope else set())
        try:
            threads_row(batch, cols, wrapup)
        except WriteError as e:
            # A failed row leaves nothing behind for the rows after it.
            batch.texts, batch.originals = saved[0], saved[1]
            del batch.rows[saved[2]:]
            if batch.scope:
                batch.scope.taken = saved[3]
            errors.append(f"row {n}: {e}")
            continue
        verb = cols[0].strip().casefold()
        if verb in done:
            batch.tally[done[verb]] += 1
    if errors:
        raise WriteError("\nERROR\t".join(errors))


# A per-session journal entry that sits among the fields: `**Session 6 --
# Title:**` or `**New open threads (Session 6):**`. It is never an anchor.
SESSION_ENTRY_RE = re.compile(
    r"(?:session\s*\d+|(?:new\s+)?open threads\s*\(\s*session\s*\d+)",
    re.IGNORECASE)


def _anchor(have: list[Field]) -> Field | None:
    """The last real field, where a new one goes and whose shape it takes."""
    real = [f for f in have if not SESSION_ENTRY_RE.match(f.label)]
    return real[-1] if real else None


def write_fields(batch: Batch, rel: str, note: str,
                 given: list[Field]) -> None:
    """Put `given` into the PC note's Current Status: each replaces the
    field with its label, in that field's shape; a new label goes after
    the last field; a missing section is created before Notes/GM Notes."""
    doc = parse(note)
    if doc.problems:
        raise WriteError(f"{rel}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    head, rows = _status_region(doc)
    where = f"§{CURRENT_STATUS}/"
    if head is None:
        block = [f"## {CURRENT_STATUS}", ""]
        for f in given:
            block += reshape(f, f.bullet)
            batch.row("WOULD-ADD", rel, where + f.label, "new field")
        gm = _gm_notes_head(doc)
        stops = [h.idx for h in doc.heads if h.level == 2
                 and key(h.title) in PROTECTED]
        if gm is not None and gm.gm:
            stops += [s.lineno - 1 for s in doc.states
                      if s.marker == OPEN_GM and s.lineno - 1 < gm.idx]
            stops = [i for i in stops if i != gm.idx]
        at = min(stops, default=len(doc.lines))
        batch.put(rel, place(doc, at, block))
        return
    have = read_fields(doc.lines, rows)
    sent = {key(f.label) for f in given}
    by_key: dict[str, Field] = {}
    for f in have:
        if key(f.label) in by_key and key(f.label) in sent:
            raise WriteError(f"{rel}: '{f.label}' is in {CURRENT_STATUS} "
                             f"twice: fix it by hand first")
        by_key.setdefault(key(f.label), f)
    edits: list[tuple[int, int, list[str]]] = []
    fresh: list[str] = []
    for f in given:
        old = by_key.get(key(f.label))
        if old is None:
            anchor = _anchor(have)
            shape = anchor.bullet if anchor else f.bullet
            fresh += reshape(f, shape)
            batch.row("WOULD-ADD", rel, where + f.label, "new field")
            continue
        new = reshape(f, old.bullet)
        if new == old.lines:
            batch.row("SKIP", rel, where + f.label, "unchanged")
            continue
        edits.append((old.start, old.end, new))
        batch.row("WOULD-ADD", rel, where + f.label,
                  f"replaced ({old.end - old.start} lines)")
    lines = list(doc.lines)
    if fresh:
        anchor = _anchor(have)
        if anchor is not None:
            at = anchor.end
            if not lines[at - 1].endswith(("\n", "\r")):
                lines[at - 1] += doc.eol
            edits.append((at, at, fresh))
        else:
            batch.put(rel, place(doc, (rows[-1] + 1) if rows
                                 else head.idx + 1, fresh))
            doc = parse(batch.texts[rel])
            lines = list(doc.lines)
    for start, end, new in sorted(edits, reverse=True):
        last = doc.eol
        if (end > start and end == len(lines)
                and not lines[end - 1].endswith(("\n", "\r"))):
            last = ""       # the note's last line had no line ending
        lines[start:end] = [ln + doc.eol for ln in new[:-1]] + [new[-1] + last]
    batch.put(rel, "".join(lines))


def type_template(note_type: str) -> tuple[TemplateMap | None, bool]:
    """(the shared template's section map for a note type, whether that
    template fences its GM Notes). An unknown type has no map and is
    fenced."""
    path = SHARED_TEMPLATES / f"{note_type}.md"
    if (not note_type or "/" in note_type or "\\" in note_type
            or ".." in note_type or not path.is_file()):
        return None, True
    text = path.read_text(encoding="utf-8")
    return read_template_map(text), any(
        not m.group(1) for m in GM_MARKER_RE.finditer(text))


def _gm_notes_head(doc: Doc) -> Head | None:
    return next((h for h in doc.heads
                 if h.level == 2 and key(h.title) == GM_NOTES), None)


def split_section(section: str) -> tuple[bool, str]:
    """(whether it names a Keeper section, the section's name): `Name` is a
    public `##`, `GM Notes/Name` a `###` under GM Notes. Leading hashes and
    spaces are dropped from either part."""
    plain = section.strip().lstrip("#").strip()
    head, slash, rest = plain.partition("/")
    if slash and key(head) == GM_NOTES:
        return True, rest.strip().lstrip("#").strip()
    return False, plain


def _before_dataview(doc: Doc, head: Head, end: int) -> int:
    """Where a line goes in a section with no list: `end`, or the opener of
    a ```dataview block that closes the section (a log is the rows above
    its query)."""
    last = end - 1
    while last > head.idx and not doc.lines[last].strip():
        last -= 1
    if last <= head.idx or not doc.lines[last].lstrip().startswith("```"):
        return end
    for i in range(last - 1, head.idx, -1):
        fence = doc.lines[i].lstrip()
        if fence.startswith("```"):
            return i if fence.lower().startswith("```dataview") else end
    return end


def add_line(text: str, rel: str, section: str, line: str,
             tmap: TemplateMap | None, fenced: bool, note_type: str = ""
             ) -> tuple[str | None, str]:
    """(the note's new text, the row's detail), or (None, why) when `line`
    is already in the section. `section` is `Name` for a public `##` or
    `GM Notes/Name` for a `###` under GM Notes. A GM Notes the note has is
    used as it is; one it lacks is added at the end, fenced when `fenced`."""
    doc = parse(text)
    if doc.problems:
        raise WriteError(f"{rel}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    keeper, name = split_section(section)
    if not name:
        raise WriteError(f"{rel}: the section has no name")
    k = key(name)
    if (not keeper and tmap is not None and k in tmap.gm
            and not any(h.level == 2 and not h.gm and key(h.title) == k
                        for h in doc.heads)):
        raise WriteError(f"{rel}: '{name}' is a GM Notes section of a "
                         f"{note_type} note: write the section as "
                         f"'GM Notes/{name}'")
    gm = _gm_notes_head(doc)
    if keeper or k == GM_NOTES:
        if gm is None:
            block = ["## GM Notes", ""]
            if k != GM_NOTES:
                block += [f"### {name}", ""]
            block += [line]
            if fenced:
                block = ["<!-- gm-only -->", "", *block, "",
                         "<!-- /gm-only -->"]
            return place(doc, len(doc.lines), block), "new GM Notes"
        stop = section_end(doc, gm)
        head: Head
        if k == GM_NOTES:
            head = gm
        else:
            scope = [h for h in doc.heads
                     if h.level == 3 and gm.idx < h.idx < stop]
            found = next((h for h in scope if key(h.title) == k), None)
            if found is None:
                order = ([c for lvl, c in tmap.order
                          if lvl == 3 and c in tmap.gm] if tmap else [])
                at = sibling_at(doc, scope, k, order, stop)
                return place(doc, at, [f"### {name}", "", line]), \
                    "new section"
            head = found
    else:
        scope = [h for h in doc.heads if h.level == 2 and not h.gm
                 and key(h.title) != GM_NOTES]
        found = next((h for h in scope if key(h.title) == k), None)
        if found is None:
            default = len(doc.lines)
            if gm is not None:
                openers = [s.lineno - 1 for s in doc.states
                           if s.marker == OPEN_GM and s.lineno - 1 < gm.idx]
                default = max(openers) if gm.gm and openers else gm.idx
            public = ({c for _l, c in tmap.order} - tmap.gm) if tmap else set()
            later = tmap.later(2, k, public) if tmap else set()
            at = next((h.idx for h in scope if key(h.title) in later),
                      default)
            template_public = tmap is not None and any(
                lvl == 2 and c == k for lvl, c in tmap.order)
            return (place(doc, at, [f"## {name}", "", line]),
                    "created" if template_public else PLAYERS_SEE)
        head = found
    end = section_end(doc, head)
    if any(doc.lines[i].strip() == line.strip()
           for i in own_lines(doc, head, end)):
        return None, "already there"
    at, glue = list_end(doc, head, end, line) or (
        _before_dataview(doc, head, end), False)
    return place(doc, at, [line], tight=_listy(line), glue=glue), ""


LOG_SECTION = "campaign log"
LOG_ALIASES = frozenset({"appearances", "encounters"})


def resolve_log_section(note: str, section: str) -> str | None:
    """The name of the public log section a note keeps in place of
    `Campaign Log` (`Appearances` or `Encounters`, whichever comes first),
    or None when `section` is not `Campaign Log`, the note has one, or it
    has no equivalent."""
    if key(section.strip().lstrip("#")) != LOG_SECTION:
        return None
    heads = [h for h in parse(note).heads if h.level == 2 and not h.gm]
    if any(key(h.title) == LOG_SECTION for h in heads):
        return None
    return next((h.title for h in heads if key(h.title) in LOG_ALIASES),
                None)


def cmd_log(batch: Batch, _args: argparse.Namespace, text: str) -> None:
    rows = [r for r in text.replace("\r\n", "\n").split("\n") if r.strip()]
    if not rows:
        raise WriteError("nothing on stdin")
    templates: dict[str, tuple[TemplateMap | None, bool]] = {}
    for n, raw in enumerate(rows, 1):
        cells = raw.split("\t", 2)
        if len(cells) != 3 or not all(c.strip() for c in cells):
            raise WriteError(f"row {n}: want PATH<TAB>SECTION<TAB>LINE")
        rel = batch.resolve(cells[0].strip())
        note = batch.read(rel)
        note_type = vl.entity_type(vl.extract_frontmatter(note) or {})
        if note_type not in templates:
            templates[note_type] = type_template(note_type)
        tmap, fenced = templates[note_type]
        resolved = resolve_log_section(note, cells[1])
        section = resolved or cells[1]
        keeper, name = split_section(section)
        where = f"\u00a7{'GM Notes/' if keeper else ''}{name}"
        new, detail = add_line(note, rel, section, cells[2], tmap, fenced,
                               note_type)
        if new is None:
            batch.row("SKIP", rel, where, detail)
            continue
        batch.put(rel, new)
        batch.row("WOULD-ADD", rel, where, detail or ("resolved" if resolved
                                                      else ""))
        if (keeper or key(name) == GM_NOTES) and any(
                st.gm_depth == 0 for st in added_states(note, new)):
            batch.row("WARNING", rel, where,
                      "GM Notes has no hidden-markers here: only the "
                      "site's settings keep it from players")


# --- timeline ----------------------------------------------------------------

TIMELINE = "_Campaign/Timeline.md"
HEADING_ARG_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
TIME_OF_DAY_RE = re.compile(
    r"\b(morning|afternoon|evening|night|midnight|noon|dawn|dusk)\b",
    re.IGNORECASE)
YEAR_RE = re.compile(r"\b\d{4}\b")
ENTRY_DATE_RE = re.compile(r"^[-*+]\s+\*\*(.+?)\*\*")
LABEL_START_RE = re.compile(r"(?i)^(session|chapter)\b")


def split_timeline(text: str) -> list[list[str]]:
    """The entries on stdin, exactly as written. A line that starts at the
    margin opens an entry; indented lines and blank lines between them
    belong to the entry above."""
    entries: list[list[str]] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip() and not line[0].isspace():
            entries.append([line])
        elif entries:
            entries[-1].append(line)
        elif line.strip():
            raise WriteError("stdin must start with an entry at the margin "
                             "(the first line is indented)")
    for entry in entries:
        while not entry[-1].strip():
            entry.pop()
    return entries


def _heading_arg(raw: str, flag: str) -> tuple[int, str]:
    m = HEADING_ARG_RE.match(raw)
    if not m:
        raise WriteError(f"{flag} takes a heading with its hashes, "
                         f"e.g. '### Session 13 \u2014 The Assault'")
    return len(m.group(1)), m.group(2)


def _heading_in(doc: Doc, raw: str, flag: str) -> tuple[int, str]:
    """`raw` as (level, title). With its hashes it is taken as written; bare
    text names the note's heading of that title, whatever its level, and
    a heading that does not exist yet needs its hashes."""
    if HEADING_ARG_RE.match(raw):
        return _heading_arg(raw, flag)
    title = raw.strip()
    hits = [h for h in doc.heads if title and key(h.title) == key(title)]
    if len({h.level for h in hits}) > 1:
        raise WriteError(f"{flag} '{title}': headings at more than one level "
                         f"(" + ", ".join(f"'{'#' * h.level} {h.title}'"
                                          for h in hits)
                         + "): give the one meant with its hashes")
    if len(hits) > 1:
        raise WriteError(f"{flag} '{title}': {len(hits)} headings "
                         f"'{'#' * hits[0].level} {hits[0].title}': a bare "
                         f"title cannot say which; make them differ")
    if not hits and flag == "--after":
        raise WriteError(f"--after '{title}': no such heading")
    if not hits:
        raise WriteError(f"{flag} '{title}': no such heading; a new one "
                         f"takes its hashes, e.g. '### {title or 'Session 13'}'")
    return hits[0].level, hits[0].title


def _find(doc: Doc, level: int, title: str) -> Head | None:
    return next((h for h in doc.heads
                 if h.level == level and key(h.title) == key(title)), None)


def _need(doc: Doc, level: int, title: str) -> Head:
    head = _find(doc, level, title)
    if head is None:
        raise WriteError(f"heading '{title}' is missing after it was placed")
    return head


def _last_gm_opener(doc: Doc) -> int | None:
    """Line index of the opener of the last top-level gm-only block that
    runs to the end of the note (nothing but blank lines after its closer),
    or None when the note does not end with one."""
    depth = 0
    opener: int | None = None
    closed_at: int | None = None
    for s in doc.states:
        if s.marker == OPEN_GM:
            if depth == 0:
                opener = s.lineno - 1
            depth += 1
        elif s.marker == CLOSE_GM and depth > 0:
            depth -= 1
            if depth == 0:
                closed_at = s.lineno - 1
    if opener is None or closed_at is None:
        return None
    if any(line.strip() for line in doc.lines[closed_at + 1:]):
        return None
    return opener


def _flush(above: str, below: str) -> bool:
    """Whether two entries sit on adjacent lines: two list items, or two
    table rows."""
    return bool((LIST_RE.match(above) and LIST_RE.match(below))
                or (above.lstrip().startswith("|")
                    and below.lstrip().startswith("|")))


def _timeline_end(doc: Doc, head: Head) -> int:
    """Where entries under `head` stop. A Chapter's span runs through any
    visible Session heading at its level or higher that follows it (legacy
    sessions filed beside the chapter), to the next Chapter or other
    heading; anything else keeps its section."""
    end = section_end(doc, head)
    if not re.match(r"(?i)^chapter\b", head.title):
        return end
    while True:
        nxt = next((h for h in doc.heads if h.idx == end), None)
        if (nxt is None or nxt.gm
                or not re.match(r"(?i)^session\b", nxt.title)):
            return end
        end = section_end(doc, nxt)


def _later_entry_heading(doc: Doc, end: int) -> Head | None:
    """The first visible Session or Chapter heading at or after line `end`
    whose own lines hold a list item or table row: a place sessions were
    filed, so a new entry above it may be in the wrong spot."""
    for h in doc.heads:
        if h.idx < end or h.gm or not LABEL_START_RE.match(h.title):
            continue
        if any(TOP_LIST_RE.match(doc.lines[i])
               or doc.lines[i].lstrip().startswith("|")
               for i in own_lines(doc, h, section_end(doc, h))):
            return h
    return None


def cmd_timeline(batch: Batch, args: argparse.Namespace, text: str) -> None:
    rel = batch.resolve(args.file or TIMELINE)
    if not batch.exists(rel):
        raise WriteError(f"{rel}: no timeline \u2014 gma vault-scaffold creates it")
    entries = split_timeline(text)
    if not entries:
        raise WriteError("nothing on stdin")
    note = batch.read(rel)
    doc = parse(note)
    if doc.problems:
        raise WriteError(f"{rel}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    level, title = _heading_in(doc, args.under, "--under")
    where = f"\u00a7{title}"
    if _find(doc, level, title) is None:
        other = next((h for h in doc.heads if key(h.title) == key(title)),
                     None)
        if other is not None:
            raise WriteError(
                f"{rel}: has '{'#' * other.level} {other.title}' \u2014 a "
                f"second heading with that title would be a duplicate: use "
                f"--under '{'#' * other.level} {other.title}'")
        if args.after:
            after = _find(doc, *_heading_in(doc, args.after, "--after"))
            if after is None:
                raise WriteError(f"{rel}: no heading '{args.after}'")
            at = section_end(doc, after)
        else:
            opener = _last_gm_opener(doc)
            at = len(doc.lines) if opener is None else opener
        before = next((h.title for h in reversed(doc.heads) if h.idx < at),
                      "the top")
        following = next((h.title for h in doc.heads if h.idx >= at),
                         "the end")
        note = place(doc, at, [f"{'#' * level} {title}"])
        batch.put(rel, note)
        seen_by = ("hidden" if _need(parse(note), level, title).gm
                   else "players will see this")
        batch.row("WOULD-ADD", rel, where,
                  f"new heading between '{before}' and '{following}' "
                  f"\u2014 {seen_by}")
    doc = parse(note)
    head = _need(doc, level, title)
    end = _timeline_end(doc, head)
    known = {doc.lines[i].strip() for i in own_lines(doc, head, end)}
    plan: list[tuple[list[str], bool]] = []
    for entry in entries:
        fresh = entry[0].strip() not in known
        known.add(entry[0].strip())
        plan.append((entry, fresh))
    new_entries = [entry for entry, fresh in plan if fresh]
    at = end
    if new_entries:
        block: list[str] = []
        block_first = ""
        for entry in new_entries:
            if block and not _flush(block_first, entry[0]):
                block.append("")
            block += entry
            block_first = entry[0]
        at, glue = list_end(doc, head, end, new_entries[0][0]) or (end, False)
        note = place(doc, at, block, glue=glue, tight=_listy(block[0]))
        batch.put(rel, note)
    child = next((h for h in reversed(doc.heads) if head.idx < h.idx < at),
                 None)
    later = (_later_entry_heading(doc, end)
             if new_entries and not LABEL_START_RE.match(title) else None)
    if later is not None:
        batch.row("WARNING", rel, where,
                  f"the entries go above '{'#' * later.level} {later.title}', "
                  f"which also holds entries: if they belong after it, "
                  f"use --under '{'#' * later.level} {later.title}'")
    for entry, fresh in plan:
        if not fresh:
            batch.row("SKIP", rel, where, "already there")
            continue
        detail = entry[0][:60]
        if child is not None:
            detail = f"under '{'#' * child.level} {child.title}': {detail}"
        batch.row("WOULD-ADD", rel, where, detail)
        dated = ENTRY_DATE_RE.match(entry[0])
        date = dated.group(1) if dated else ""
        if not date or LABEL_START_RE.match(date):
            continue        # undated, or a label like "Session 2"
        if TIME_OF_DAY_RE.search(date):
            batch.row("WARNING", rel, where, f"'{date}' has a time of day: "
                      f"a published timeline cannot sort it")
        elif not YEAR_RE.search(date):
            batch.row("WARNING", rel, where, f"'{date}' has no 4-digit "
                      f"year: a published timeline cannot sort it")


# --- session-new and promote-plan --------------------------------------------

SESSION_TEMPLATES = ("_Template_Session.md",)
PLAN_TEMPLATES = ("_Template_Plan.md",)
# What a file name or a link cannot hold.
BAD_NAME_RE = re.compile(r'[\\/:*?"<>|#^\[\]]')
SESSION_DIR_RE = re.compile(r"^(Session\s*)(\d+)$", re.IGNORECASE)
TOP_KEY_RE = re.compile(r"^([A-Za-z_][\w.-]*):(.*)$")
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
EXPORT_SECTIONS = ("NPCs", "Locations", "Items")


is_record = vl.is_record_copy


def set_block(lines: list[str], key: str, value: str,
              children: list[str] | None = None) -> None:
    """Set a top-level frontmatter key (lines without endings) to `value`,
    replacing the block indented under it with `children`."""
    new = [f"{key}:" + (f" {value}" if value else ""), *(children or [])]
    for i, line in enumerate(lines):
        if line.startswith(f"{key}:"):
            j = i + 1
            while j < len(lines) and (not lines[j].strip()
                                      or lines[j][:1].isspace()):
                j += 1
            lines[i:j] = new
            return
    lines.extend(new)


def link_list(links: list[str]) -> tuple[str, list[str]]:
    """(value, children) for set_block: a block list of quoted links, or
    `[]`."""
    if not links:
        return "[]", []
    return "", [f"  - {vl.yaml_scalar(f'[[{link}]]')}" for link in links]


def bare_link(raw: str) -> str:
    return raw.strip().removeprefix("[[").removesuffix("]]").strip()


def template_body(text: str) -> str:
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"template: {error}")
    return "".join(lines[end + 1:])


def schema_check(batch: Batch, rel: str, text: str) -> None:
    """The schema's own rules on a note about to be created: an ERROR
    refuses the call, a WARNING is a row."""
    fm = vl.extract_frontmatter(text) or {}
    for level, message in schema_rules.frontmatter_findings(
            fm, None, vl.raw_frontmatter(text)):
        if level == "ERROR":
            raise WriteError(f"{rel}: {message}")
        if level == "WARNING":
            batch.row("WARNING", rel, "", message)


def session_indexes(vault: Path) -> list[tuple[str, int, str | None, str]]:
    """(rel, session number, chapter, play date) of every session index."""
    out = []
    for rel, text in vl.vault_files(vault):
        if is_record(rel):
            continue
        fm = vl.extract_frontmatter(text) or {}
        if vl.entity_type(fm) != "session":
            continue
        number = vl.parse_session_number(fm.get("session_number"))
        if number is not None:
            # Only an ISO date compares as text ("May 21, 2026" is real).
            date = str(fm.get("play_date") or "")
            out.append((rel, number, vl.chapter_of(rel, fm),
                        date if ISO_DATE_RE.fullmatch(date) else ""))
    return out


# Keys a new index never takes from the previous one: scenes live in their
# own notes now, so the index keeps no `scenes:` list.
NEVER_CARRIED = frozenset({"scenes"})


def carried_keys(prev: str, have: set[str], title: str) -> list[str]:
    """The previous index's own top-level keys the template lacks, each
    with the comment lines above it, and empty: `title` gets the new
    title."""
    out: list[str] = []
    comments: list[str] = []
    lines = vl.raw_frontmatter(prev).splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#"):
            comments.append(line)
            continue
        m = TOP_KEY_RE.match(line)
        if not m:
            if line.strip() and not line[:1].isspace():
                comments = []
            continue
        name, value = m.group(1), strip_comment(m.group(2)).strip()
        if name not in have and name not in NEVER_CARRIED:
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if name == "title":
                empty = f'"{title}"'
            elif value.startswith("[") or (
                    not value and nxt.lstrip().startswith("- ")):
                empty = "[]"
            elif value.startswith("{") or (not value and nxt[:1].isspace()):
                empty = "{}"
            else:
                empty = "null"
            out += [*comments, f"{name}: {empty}"]
        comments = []
    return out


def export_entries(text: str) -> list[tuple[str, str]]:
    """(section, name) for each entry under an export's `## NPCs`,
    `## Locations` and `## Items`: its `###` headings, or, in a section
    with none, its top-level list items (a bold name, or the text before
    the first dash, colon or comma)."""
    out: list[tuple[str, str]] = []
    section: str | None = None
    headed: set[str] = set()
    fence = False
    for line in text.splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            fence = not fence
            continue
        if fence:
            continue
        head = re.match(r"^(#{1,6})\s+(.*?)\s*$", line)
        if head:
            level, title = len(head.group(1)), head.group(2)
            if level <= 2:
                section = next((s for s in EXPORT_SECTIONS
                                if key(title) == s.casefold()), None)
            elif level == 3 and section:
                name = re.sub(r"[*`]", "", title).strip()
                if name:
                    out.append((section, name))
                    headed.add(section)
            continue
        item = re.match(r"^[-*+]\s+(.+)$", line)
        if section and item and section not in headed:
            raw = item.group(1).strip()
            bold = re.match(r"^\*\*(.+?)\*\*", raw)
            name = (bold.group(1) if bold else
                    re.split(r"\s[—–-]\s|:\s|,\s", raw)[0])
            name = name.strip().rstrip(".")
            if name:
                out.append((section, name))
    return out


def resolve_export(batch: Batch, entries: list[tuple[str, str]]) -> None:
    """One row per export entry: EXACT (a note's file name), ALIAS, NEAR
    (the candidates `links.py` offers for a broken link) or NONE. A name
    in parentheses after another is tried too. Archived notes and Midwife
    drafts are never a match."""
    import graph_check
    import links
    notes, names, _out, _spelt = graph_check.collect(batch.vault, [])
    live = {n: {r for r in rels if not is_record(r)}
            for n, rels in names.items()}
    live = {n: rels for n, rels in live.items() if rels}
    index = links._index(live)

    def direct(spelling: str) -> tuple[str, list[str]] | None:
        n = vl.normalize(spelling)
        rels = live.get(n, set())
        exact = sorted(r for r in rels if notes[r] == n)
        if exact:
            return "EXACT", exact
        return ("ALIAS", sorted(rels)) if rels else None

    for section, name in entries:
        where = f"§{section}"
        tries = [(name, "")]
        paren = re.match(r"^(.*?)\s*\(([^()]+)\)$", name)
        if paren:
            tries += [(p.strip(), f' — as "{p.strip()}"')
                      for p in paren.groups() if p.strip()]
        for spelling, how in tries:
            hit = direct(spelling)
            if hit:
                verb, rels = hit
                also = (f" — also {', '.join(rels[1:])}"
                        if len(rels) > 1 else "")
                batch.row(verb, rels[0], where, name + how + also)
                break
        else:
            near: list[tuple[str, str]] = []
            for spelling, _how in tries:
                near = links.candidates(spelling, index)
                if near:
                    break
            if near:
                more = "".join(f"; or {rel} ({tag})" for rel, tag in near[1:])
                batch.row("NEAR", near[0][0], where,
                          f"{name} — {near[0][1]}{more}")
            else:
                batch.row("NONE", "", where, name)


def read_export(path: str) -> str:
    """An export file's text, UTF-8, with LF line endings."""
    try:
        text = Path(path).read_bytes().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as e:
        raise WriteError(f"{path}: unreadable "
                         f"({e.__class__.__name__})") from e
    return text.replace("\r\n", "\n").replace("\r", "\n")


def check_play_date(value: str | None) -> None:
    """Refuse a --play-date that is not a real YYYY-MM-DD date."""
    if not value:
        return
    try:
        ok = bool(ISO_DATE_RE.fullmatch(value)) and bool(date.fromisoformat(value))
    except ValueError:
        ok = False
    if not ok:
        raise WriteError("--play-date must be a real date, YYYY-MM-DD")


def play_notes_naming(batch: Batch, stem: str) -> list[str]:
    """Vault-relative paths (without .md) of the Play Notes notes anywhere
    in the vault whose `session:` link names the index `stem`."""
    types = vc.SESSION_DOC_TYPES["play_notes"][1]
    want = vl.normalize(stem)
    out = []
    for rel, text in vl.vault_files(batch.vault):
        if is_record(rel):
            continue
        fm = vl.extract_frontmatter(text) or {}
        if (vl.entity_type(fm) in types and vl.normalize(
                vl.wikilink_target(fm.get("session"))) == want):
            out.append(rel.removesuffix(".md"))
    return sorted(out)


# A session index's status before play: play-notes-new raises it to played.
BEFORE_PLAY = frozenset({"", "planned", "prepped"})


def cmd_resolve(batch: Batch, args: argparse.Namespace, _text: str) -> None:
    resolve_export(batch, export_entries(read_export(args.export)))


def play_notes_text(stem: str, n: int, chapter_raw: str | None,
                    campaign_raw: str | None, play_date: str | None,
                    export_path: str | None, export: str) -> str:
    """A Play Notes note for the session index `stem`: its frontmatter,
    and the export, if any, whole under `## Narrative Record`."""
    note_fm = ["type: session-play-notes", f'session: "[[{stem}]]"',
               f"session_number: {n}"]
    if chapter_raw:
        note_fm.append(f"chapter: {chapter_raw}")
    note_fm += [f"campaign: {campaign_raw or chr(34) * 2}",
                "canon_status: AUTHORITATIVE", "created_by: manual"]
    if play_date:
        note_fm.append(f'play_date: "{play_date}"')
    note_fm.append("tags: []")
    text = ("---\n" + "\n".join(note_fm) + "\n---\n\n"
            f"# {stem} - Play Notes\n")
    if export_path:
        text += (f"\n## Narrative Record\n\nExport "
                 f"`{Path(export_path).name}`, placed whole and "
                 f"unedited.\n\n" + export)
    return text


def cmd_play_notes_new(batch: Batch, args: argparse.Namespace,
                       _text: str) -> None:
    """Play Notes beside an index already filed: the note, and on the
    index documents.play_notes, play_date (when given) and status played
    (from planned or prepped only). The Plan link stays as it is."""
    check_play_date(args.play_date)
    export = read_export(args.export) if args.export else ""
    index = batch.note_named(args.session, {"session"}, "--session")
    text = batch.read(index)
    fm = vl.extract_frontmatter(text) or {}
    if vl.entity_type(fm) != "session":
        raise WriteError(f"{index}: not a session index (type: session)")
    stem = Path(index).stem
    documents = vl.nested_mapping(text, "documents")
    link = vl.wikilink_target(documents.get("play_notes"))
    replaced = ""
    if link and not is_blank(link):
        linked = batch.with_stem(re.split(r"[#^|]", link, maxsplit=1)[0]
                                 .replace("\\", "/").rsplit("/", 1)[-1].strip())
        types = vc.SESSION_DOC_TYPES["play_notes"][1]
        for rel in linked:
            if vl.entity_type(vl.extract_frontmatter(batch.read(rel))
                              or {}) not in types:
                raise WriteError(
                    f"{index}: documents.play_notes links {rel}, which is "
                    f"not Play Notes: fix that link first")
            raise WriteError(f"{index}: already has Play Notes: {rel}")
        replaced = f" (replaces [[{link}]], which names no note)"
    have = play_notes_naming(batch, stem)
    if have:
        raise WriteError(f"{index}: already has Play Notes: {have[0]}")
    n = vl.parse_session_number(fm.get("session_number"))
    if n is None:
        n = vl.session_ref_number(fm)
    if n is None:
        raise WriteError(f"{index}: its session number cannot be read")
    chapter_raw = raw_value(text, "chapter")
    if not chapter_raw or is_blank(chapter_raw):
        folder_chapter = vl.chapter_of(index, fm)
        chapter_raw = f'"[[{folder_chapter}]]"' if folder_chapter else None
    campaign_raw = raw_value(text, "campaign")
    old_date = (raw_value(text, "play_date") or "").strip("\"'")
    if is_blank(old_date):
        old_date = ""
    played = args.play_date or old_date
    if played and not ISO_DATE_RE.fullmatch(played):
        batch.row("WARNING", index, "", f"play_date {played!r} is not "
                  "YYYY-MM-DD, so the Play Notes do not copy it")
    folder = index.rpartition("/")[0]
    notes_stem = f"{stem} - Play Notes"
    notes_rel = f"{folder}/{notes_stem}.md" if folder else f"{notes_stem}.md"
    notes_text = play_notes_text(
        stem, n, chapter_raw, campaign_raw,
        played if ISO_DATE_RE.fullmatch(played) else None,
        args.export, export)
    batch.create(notes_rel, notes_text)
    schema_check(batch, notes_rel, notes_text)

    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{index}: {error}")
    eol = "\r\n" if "\r\n" in text else "\n"
    fm_lines = lines[1:end]
    try:
        vl.set_nested_key(fm_lines, "documents", "play_notes",
                          f'"[[{notes_stem}]]"', eol)
    except ValueError as e:
        raise WriteError(f"{index}: {e}") from None
    changes = [f"documents.play_notes [[{notes_stem}]]{replaced}"]
    if args.play_date and args.play_date != old_date:
        vl.set_key(fm_lines, "play_date", f'"{args.play_date}"', eol)
        changes.append(f"play_date {old_date} -> {args.play_date}"
                       if old_date else f"play_date {args.play_date}")
    status = (raw_value(text, "status") or "").strip("\"'").casefold()
    if status in BEFORE_PLAY:
        at = next((i for i, ln in enumerate(fm_lines)
                   if ln.startswith("status:")), None)
        if at is None:
            fm_lines.append(f"status: played{eol}")
        else:
            # The value alone: a trailing comment stays.
            fm_lines[at] = re.sub(
                r"""^status:[ \t]*("[^"]*"|'[^']*'|[^\s#]*)""",
                "status: played", fm_lines[at])
        changes.append(f"status {status or '(none)'} -> played")
    batch.put(index, "".join([lines[0], *fm_lines, *lines[end:]]))
    batch.row("WOULD-CREATE", notes_rel, "",
              f"export {Path(args.export).name} under ## Narrative Record"
              if args.export else "no export: the notes are empty")
    if args.export and not export.strip():
        batch.row("WARNING", notes_rel, "", "the export is empty")
    batch.row("WOULD-ADD", index, "", ", ".join(changes))
    if args.export:
        resolve_export(batch, export_entries(export))


def cmd_session_new(batch: Batch, args: argparse.Namespace,
                    _text: str) -> None:
    n = args.number
    title = " ".join(args.title.split())
    if n < 1:
        raise WriteError("--number must be 1 or more")
    if not title or BAD_NAME_RE.search(title):
        raise WriteError(f"title {args.title!r} cannot be a file name "
                         f"(none of \\ / : * ? \" < > | # ^ [ ])")
    check_play_date(args.play_date)
    upcoming = args.upcoming
    if upcoming and args.export:
        raise WriteError("--upcoming has no Play Notes to place an export in")
    export = read_export(args.export) if args.export else ""
    # A chapter with sessions but no chapter note is still named by them.
    found = (find_chapter(batch.vault, args.chapter, missing_ok=True)
             if args.chapter else None)
    want = (found[2] if found else
            bare_link(args.chapter) if args.chapter else None)
    chapters = [(rel, vl.extract_frontmatter(text) or {})
                for rel, text in notes_of_type(batch.vault, "chapter")]

    def in_chapter(rel: str, chapter: str | None) -> bool:
        """A session is in the chapter by its link, by what that link
        names, or by its folder: older sessions often link the chapter
        by a name its note doesn't carry ("Chapter 1 - Title")."""
        if want is None or (chapter or "").casefold() == want.casefold():
            return True
        if found is None:
            return False
        return (rel.startswith(f"{found[1]}/") or bool(chapter) and
                [r for r, _fm in vl.chapters_named(chapters, chapter or "")]
                == [found[0]])

    indexes = session_indexes(batch.vault)
    earlier = [x for x in indexes if x[1] < n and in_chapter(x[0], x[2])]
    prev: tuple[str, int, str | None, str] | None
    chose = ""
    if want is None:
        # Session numbers restart per chapter: of several session N-1
        # indexes, the one played last, when its date says so.
        lasts = sorted((x for x in earlier if x[1] == n - 1),
                       key=lambda x: x[3], reverse=True)
        if len(lasts) > 1 and lasts[0][3] > lasts[1][3]:
            chose = f" (the latest played of {len(lasts)})"
            lasts = lasts[:1]
        if len(lasts) != 1:
            raise WriteError(
                (f"no session {n - 1} index found" if not lasts else
                 f"{len(lasts)} chapters have a session {n - 1} index") +
                ": pass --chapter \"Chapter N - Title\"")
        prev = lasts[0]
    else:
        prev = max(earlier, key=lambda x: x[1]) if earlier else None
    chapter = (prev[2] if prev else None) or want
    taken = [rel for rel, number, ch, _date in indexes
             if number == n and ((ch or "").casefold()
                                 == (chapter or "").casefold()
                                 or found is not None and in_chapter(rel, ch))]
    if taken:
        raise WriteError(f"session {n} already has an index: {taken[0]}; "
                         "play-notes-new files Play Notes beside it")
    prev_text = batch.read(prev[0]) if prev else ""
    if prev:
        folder = prev[0].rpartition("/")[0]
        parent, _, base = folder.rpartition("/")
        dir_m = SESSION_DIR_RE.match(base)
        if dir_m and int(dir_m.group(2)) == prev[1]:
            width = len(dir_m.group(2))
            base = f"{dir_m.group(1)}{n:0{width}d}"
            folder = f"{parent}/{base}" if parent else base
    else:
        if found is None:
            raise WriteError(no_chapter(args.chapter, chapters)
                             + ", and no earlier session in it to file "
                             "beside")
        folder = f"{found[1]}/Sessions/Session {n:02d}".lstrip("/")
    stem = f"Session {n:02d} - {title}"
    index_rel, notes_rel = f"{folder}/{stem}.md", f"{folder}/{stem} - Play Notes.md"

    chapter_raw = ((raw_value(prev_text, "chapter") if prev else None)
                   or f'"[[{chapter}]]"')
    campaign_raw = raw_value(prev_text, "campaign") if prev else None
    template = template_text(batch.vault, SESSION_TEMPLATES, "session.md")
    fm = template_frontmatter(template)
    have = {m.group(1) for line in fm if (m := TOP_KEY_RE.match(line))}
    values = {"session_number": str(n), "chapter": chapter_raw,
              "status": "planned" if upcoming else "played"}
    if campaign_raw:
        values["campaign"] = campaign_raw
    if args.play_date:
        values["play_date"] = f'"{args.play_date}"'
    for field, value in values.items():
        set_block(fm, field, value)
    children = []
    start = next((i for i, ln in enumerate(fm)
                  if ln.startswith("documents:")), None)
    if start is not None:
        for line in fm[start + 1:]:
            if not line[:1].isspace():
                break
            child = line.strip().split(":", 1)[0]
            children.append(f"  {child}: " + (f'"[[{stem} - Play Notes]]"'
                                              if child == "play_notes"
                                              and not upcoming else "null"))
    if "play_notes" not in "".join(children) and not upcoming:
        children.append(f'  play_notes: "[[{stem} - Play Notes]]"')
    set_block(fm, "documents", "", children)
    carried = carried_keys(prev_text, have, title) if prev else []
    body = template_body(template)
    body = re.sub(r"(?m)^(# .*)$", lambda m: m.group(1).replace(
        "NN", f"{n:02d}").replace("{Title}", title), body, count=1)
    body = re.sub(r"(?m)^\{[^{}]*\}[ \t]*\n?", "", body)
    index_text = "---\n" + "\n".join(fm + carried) + "\n---\n" + body
    batch.create(index_rel, index_text)
    schema_check(batch, index_rel, index_text)
    notes_text = play_notes_text(stem, n, chapter_raw, campaign_raw,
                                 args.play_date, args.export, export)
    if not upcoming:
        batch.create(notes_rel, notes_text)
        schema_check(batch, notes_rel, notes_text)
    source = (f"after {prev[0]}{chose}" if prev
              else "first session of the chapter")
    kept = [ln.split(":", 1)[0] for ln in carried if not ln.startswith("#")]
    batch.row("WOULD-CREATE", index_rel, "", f"session template, {source}"
              + (f"; its own keys carried: {', '.join(kept)}" if kept
                 else ""))
    if not upcoming:
        batch.row("WOULD-CREATE", notes_rel, "",
                  f"export {Path(args.export).name} under ## Narrative "
                  f"Record" if args.export else "no export: the notes are "
                  "empty")
    if not prev:
        batch.row("WARNING", index_rel, "", "no earlier session in this "
                  "chapter: campaign and the vault's own keys not carried")
    if args.export:
        resolve_export(batch, export_entries(export))


def cmd_promote_plan(batch: Batch, args: argparse.Namespace,
                     _text: str) -> None:
    draft = batch.resolve(args.draft)
    text = batch.read(draft)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error is None:
        body = "".join(lines[end + 1:])
    elif error == "no frontmatter":
        body = text
    else:
        raise WriteError(f"{draft}: {error}")
    target = vl.normalize_file_arg(args.to)
    if not re.fullmatch(r"[\w-]+", args.plan_type):
        raise WriteError(f"--plan-type {args.plan_type!r} is not one word")
    def link_arg(raw: str, flag: str) -> str:
        value = bare_link(raw)
        if not value or re.search(r'["\r\n]', value):
            raise WriteError(f"{flag} {raw!r} cannot be a link "
                             f"(no quote or line break)")
        return value

    chapter = (link_arg(args.chapter, "--chapter") if args.chapter
               else vl.chapter_of(target, {}))
    if not chapter:
        raise WriteError(f"{target} is not in a chapter folder: pass "
                         f"--chapter \"Chapter N - Title\"")

    eol = "\r\n" if "\r\n" in body else "\n"
    fm = template_frontmatter(
        template_text(batch.vault, PLAN_TEMPLATES, "plan.md"))
    set_block(fm, "name", f'"{Path(target).stem.replace("_", " ")}"')
    set_block(fm, "plan_type", args.plan_type)
    set_block(fm, "chapter", f'"[[{chapter}]]"')
    set_block(fm, "leads_to", *link_list(
        [link_arg(x, "--leads-to") for x in args.leads_to or []]))
    set_block(fm, "relationships", "[]")
    new = "---" + eol + eol.join(fm) + eol + "---" + eol + body
    batch.create(target, new)
    schema_check(batch, target, new)
    batch.row("WOULD-CREATE", target, "",
              f"from {draft}: body copied as written ({len(body.encode())} "
              f"bytes)")

# --- plan ---------------------------------------------------------------------

PLAN_SESSION_TEMPLATES = ("_Template_Session_Plan.md",)
PLAN_SETTABLE = frozenset({"planned", "prepped", ""})


def find_session(batch: Batch, n: int, chapter: str | None) -> str | None:
    """The index of session `n`, in `chapter` when one is named (by its
    link, by what that link names, or by its folder); None when there is
    none. Several are refused."""
    found = (find_chapter(batch.vault, chapter, missing_ok=True)
             if chapter else None)
    want = (found[2] if found else bare_link(chapter) if chapter else None)
    hits = [rel for rel, number, ch, _date in session_indexes(batch.vault)
            if number == n and (
                want is None or (ch or "").casefold() == want.casefold()
                or found is not None and rel.startswith(f"{found[1]}/"))]
    if len(hits) > 1:
        raise WriteError(f"{len(hits)} session {n} indexes: "
                         f"{', '.join(hits)}: pass --chapter")
    return hits[0] if hits else None


def stamp_index(batch: Batch, rel: str, plan_stem: str) -> None:
    """Set the index's status to prepped (from planned or empty) and its
    documents.plan to the Plan, as stamp_entities does. Nothing else in it
    changes."""
    text = batch.read(rel)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if "\r\n" in text else "\n"
    fm = lines[1:end]
    status = (raw_value(text, "status") or "").strip("\"'").casefold()
    if status not in PLAN_SETTABLE:
        batch.row("WARNING", rel, "", f"status {status!r} left as it is "
                  "(prepped is set only on a session not yet played)")
    elif status != "prepped":
        at = next((i for i, ln in enumerate(fm)
                   if ln.startswith("status:")), None)
        if at is None:
            fm.append(f"status: prepped{eol}")
        else:
            # The value alone: a trailing comment stays.
            fm[at] = re.sub(r"""^status:[ \t]*("[^"]*"|'[^']*'|[^\s#]*)""",
                            "status: prepped", fm[at])
    try:
        vl.set_nested_key(fm, "documents", "plan", f'"[[{plan_stem}]]"', eol)
    except ValueError as e:
        raise WriteError(f"{rel}: {e}") from None
    new = "".join([lines[0], *fm, *lines[end:]])
    if new != text:
        batch.put(rel, new)
        batch.row("WOULD-ADD", rel, "", "status prepped, documents.plan "
                  f"[[{plan_stem}]]")


def plan_body(text: str, batch: Batch, rel: str) -> str:
    """The Plan's body from stdin. Frontmatter sent with it is dropped:
    the Plan's own comes from the template and the index."""
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error is None:
        batch.row("WARNING", rel, "", "frontmatter on stdin dropped: the "
                  "Plan's comes from the template and the index")
        text = "".join(lines[end + 1:])
    body = text.strip("\r\n")
    if not body:
        raise WriteError("nothing on stdin")
    return "\n" + body + "\n"


def h2_slot(doc: Doc, order: list[str], k: str) -> int:
    """Where a `##` section the note lacks goes: before the first later
    `##` of the template the note has, else at the end."""
    later = order[order.index(k) + 1:] if k in order else []
    return next((h.idx for h in doc.heads
                 if h.level == 2 and key(h.title) in later), len(doc.lines))


def put_sections(batch: Batch, rel: str, text: str, template: str) -> None:
    """Each section on stdin replaces the Plan's section of that level
    and title; a `##` the Plan lacks goes where the template has it."""
    order = [key(h.title) for h in parse(template).heads if h.level == 2]
    note = batch.read(rel)
    # A section runs to the next heading no deeper than its own, so a ##
    # sent whole keeps its ### parts.
    for level, title, unit in split_units(text, set()):
        doc = parse(note)
        k = key(title)
        same = [h for h in doc.heads if h.level == level and key(h.title) == k]
        if len(same) > 1:
            raise WriteError(f"{rel}: {len(same)} sections "
                             f"'{'#' * level} {title}'")
        if same:
            note, old = _replace(doc, same[0], unit)
            detail = f"replaced {old} line" + ("" if old == 1 else "s")
        elif level == 2:
            note = place(doc, h2_slot(doc, order, k), unit)
            detail = "added"
        else:
            raise WriteError(f"{rel}: no '{'#' * level} {title}' to replace: "
                             f"send it inside its ## section")
        batch.row("WOULD-ADD", rel, f"\u00a7{title}", detail)
    batch.put(rel, note)


def plans_naming(batch: Batch, stem: str) -> list[str]:
    """The session Plans whose `session:` link names the index `stem`."""
    want = vl.normalize(stem)
    return sorted(
        rel for rel, text in vl.vault_files(batch.vault)
        if not is_record(rel)
        and vl.entity_type(fm := vl.extract_frontmatter(text) or {})
        == "session-plan"
        and vl.normalize(vl.wikilink_target(fm.get("session"))) == want)


def after_write_rows(batch: Batch, rel: str, plan: str, index: str
                     ) -> list[str]:
    """The vault checks prep runs on the Plan it writes, scoped to it and
    the scene notes its `### [[Scene]]` pointers name: read-aloud lines
    (a PC named, a feeling dictated), table-cell pipes in those notes, a
    multi-day Plan with no clock, and links with no note behind them. A
    pointer that names no note is left to plan_check's scene-pointer row."""
    import graph_check as gc
    import session_context as sc
    rows: list[str] = []
    try:  # the PC lookup reads settings; losing it costs one cue, not all
        pc_re = vc.pc_name_regex(vl.active_pc_names(batch.vault))
    except Exception as e:
        pc_re = None
        rows.append(f"WARNING\t{rel}\tread-aloud: the PC names could not be "
                    f"read ({type(e).__name__}: {e}), so no line was checked "
                    f"for one; the other checks ran")
    known = gc.known_names(batch.vault, [r for r, before in
                                         batch.originals.items()
                                         if before is None])
    targets = sc.scene_pointers(plan)
    pointed = {sc.pointer_key(t) for t in targets}
    notes = [(r, t, vl.extract_frontmatter(t) or {})
             for r, t in vl.vault_files(batch.vault)]
    scenes = [(r, t) for r, t, fm in notes if vl.entity_type(fm) == "scene"
              and (vl.normalize(Path(r).stem) in pointed
                   or vl.normalize(r.removesuffix(".md")) in pointed)]
    index_fm = vl.extract_frontmatter(batch.texts[index]) or {}
    rows += (vc.read_aloud_findings(rel, plan, pc_re)
             + vc.timeline_findings(rel, plan, index_fm.get("in_game_date")))
    for r, t in [(rel, plan)] + scenes:
        if r != rel:
            rows += vc.read_aloud_findings(r, t, pc_re)
            rows += vc.table_findings(r, t)
        rows += [f"INFO\t{r}\tunresolved: [[{name}]] has no note or file "
                 f"behind it: a gap to fill, or a misspelt link"
                 for name in gc.unresolved_in(t, known)
                 if r != rel or sc.pointer_key(name) not in pointed]
    return rows


def cmd_plan(batch: Batch, args: argparse.Namespace, text: str) -> None:
    try:
        gm_input = plan_check.gm_input_parts(args.gm_input)
    except ValueError as e:
        raise WriteError(str(e)) from None
    # --gm-input says what a run with no GM present was handed.
    headless = args.headless or args.gm_input is not None
    index = find_session(batch, args.number, args.chapter)
    if index is None:
        if not args.title:
            raise WriteError(f"no session {args.number} index: pass --title "
                             f"(and --chapter) to file one as upcoming")
        cmd_session_new(batch, argparse.Namespace(
            number=args.number, title=args.title, play_date=None,
            chapter=args.chapter, upcoming=True, export=None), "")
        index = next(rel for rel, before in batch.originals.items()
                     if before is None)
    index_text = batch.read(index)
    template = template_text(batch.vault, PLAN_SESSION_TEMPLATES,
                             "session-plan.md")
    linked = vl.wikilink_target(
        vl.nested_mapping(index_text, "documents").get("plan"))
    stem = Path(index).stem
    have = batch.with_stem(linked) if linked else []
    if len(have) != 1:
        # A Plan filed for the session but never linked from its index.
        have = plans_naming(batch, stem)
        if len(have) > 1:
            raise WriteError(f"{len(have)} Plans name {stem}: "
                             f"{', '.join(have)}: link one from the index's "
                             f"documents.plan")
    rel = have[0] if have else (
        f"{index.rpartition('/')[0]}/{stem} - Plan.md".lstrip("/"))
    if args.section:
        if not batch.exists(rel):
            raise WriteError(f"{rel}: no Plan yet: send the whole Plan "
                             f"without --section")
        put_sections(batch, rel, text, template)
    else:
        if batch.exists(rel):
            raise WriteError(f"{rel}: the Plan exists: pass --section to "
                             f"replace or add sections")
        fm = template_frontmatter(template)
        set_block(fm, "session", f'"[[{stem}]]"')
        for field in ("chapter", "campaign"):
            value = raw_value(index_text, field)
            if value and not is_blank(value):
                set_block(fm, field, value)
        new = "---\n" + "\n".join(fm) + "\n---\n" + plan_body(
            text, batch, rel)
        batch.create(rel, new)
        schema_check(batch, rel, new)
        batch.row("WOULD-CREATE", rel, "", f"beside {index}")
    stamp_index(batch, index, Path(rel).stem)
    plan = batch.texts[rel]
    findings = plan_check.run_checks(
        rel, plan, vl.extract_frontmatter(plan) or {}, headless,
        gm_input, batch.vault, rel)
    counts = {lv: sum(f.level == lv for f in findings)
              for lv in ("ERROR", "WARNING", "INFO")}
    # An empty section is allowed: its placeholder cues go on one line.
    empty = [f.locus.rpartition("\u00a7")[2] for f in findings
             if f.id == "placeholder"]
    rows = [f.row for f in findings if f.id != "placeholder"]
    if empty:
        rows.append(f"INFO\t{rel}\tplaceholder: empty or template text: "
                    + ", ".join(empty))
        counts["INFO"] -= len(empty) - 1  # printed as one row
    try:
        after = after_write_rows(batch, rel, plan, index)
    except Exception as e:  # an advisory check never blocks the write
        after = [f"WARNING\t{rel}\tthe read-aloud, clock and link "
                 f"checks failed ({type(e).__name__}: {e}): run "
                 f"gma vault-check <vault> read-aloud, and graph-check "
                 f"<vault> unresolved"]
    for row in after:
        level = row.split("\t", 1)[0]
        counts[level] = counts.get(level, 0) + 1
    batch.after = rows + after + [
        f"# plan_check: errors: {counts['ERROR']}  warnings: "
        f"{counts['WARNING']}  info: {counts['INFO']}"]


# --- chapter-new, scene-new and scene-played ---------------------------------

CHAPTER_TEMPLATES = ("_Template_Chapter.md",)
SCENE_TEMPLATES = ("_Template_Scene.md",)


def clean_name(raw: str, what: str) -> str:
    name = " ".join(raw.split())
    if not name or BAD_NAME_RE.search(name):
        raise WriteError(f"{what} {raw!r} cannot be a file name "
                         f"(none of \\ / : * ? \" < > | # ^ [ ])")
    return name


def notes_of_type(vault: Path, etype: str) -> list[tuple[str, str]]:
    """(rel, text) of every live note whose type is `etype`."""
    return [(rel, text) for rel, text in vl.vault_files(vault)
            if not is_record(rel)
            and vl.entity_type(vl.extract_frontmatter(text)) == etype]


def find_chapter(vault: Path, raw: str, *, missing_ok: bool = False
                 ) -> tuple[str, str, str] | None:
    """(chapter note, its folder, the name its notes link it by) for a
    chapter named as `vl.chapters_named` reads it. The link name is the
    chapter's own key (its folder, as sessions and scenes write it), never
    the note's file name. Zero matches are refused (or None with
    `missing_ok`); several always are."""
    notes = [(rel, vl.extract_frontmatter(text) or {})
             for rel, text in notes_of_type(vault, "chapter")]
    hits = vl.chapters_named(notes, raw)
    if len(hits) > 1:
        raise WriteError(f"{len(hits)} chapter notes match {raw!r}: "
                         + ", ".join(rel for rel, _fm in hits))
    if hits:
        rel, fm = hits[0]
        return rel, rel.rpartition("/")[0], vl.chapter_link_name(rel, fm)
    if missing_ok:
        return None
    raise WriteError(no_chapter(raw, notes))


def no_chapter(raw: str, notes: list[tuple[str, dict[str, Any]]]) -> str:
    """The refusal for a chapter name no note answers to, naming the
    chapters there are, so the next try needs no lookup."""
    known = "; ".join(vl.chapter_link_name(rel, fm)
                      + (f" ({fm['title']})" if fm.get("title") else "")
                      for rel, fm in sorted(notes))
    return (f"no chapter named {raw!r}: name one by its folder, file name "
            f"or title ({known or 'the vault has no chapter notes'})")


def cmd_chapter_new(batch: Batch, args: argparse.Namespace,
                    _text: str) -> None:
    title = clean_name(args.title, "title")
    if args.status not in schema_rules.CHAPTER_STATUS:
        raise WriteError(f"--status must be one of "
                         f"{', '.join(schema_rules.CHAPTER_STATUS)}")
    want = title.casefold()
    orders: list[float] = []
    for rel, text in notes_of_type(batch.vault, "chapter"):
        old = vl.extract_frontmatter(text) or {}
        if want in (Path(rel).stem.casefold(),
                    str(old.get("title") or "").casefold()):
            raise WriteError(f"chapter {title!r} already exists: {rel}")
        try:
            orders.append(float(str(old.get("sort_order"))))
        except (TypeError, ValueError):
            pass
    order = (args.sort_order if args.sort_order is not None
             else (max(orders) + 1 if orders else 1))
    order_text = str(int(order)) if float(order).is_integer() else str(order)
    rel = f"Chapters/{title}/{title}.md"
    template = template_text(batch.vault, CHAPTER_TEMPLATES, "chapter.md")
    fm = template_frontmatter(template)
    set_block(fm, "title", f'"{title}"')
    set_block(fm, "sort_order", order_text)
    set_block(fm, "status", args.status)
    text = "---\n" + "\n".join(fm) + "\n---\n" + template_body(template)
    batch.create(rel, text)
    schema_check(batch, rel, text)
    batch.row("WOULD-CREATE", rel, "",
              f"chapter template, sort_order {order_text}")


def chapter_subfolder(raw: str | None) -> str:
    """`/Sub/Folder` for a --folder value, or "" for none; refused unless
    it is a sub-folder of the chapter."""
    if not raw:
        return ""
    parts = [p for p in raw.replace("\\", "/").split("/") if p.strip()]
    if not parts or any(p in (".", "..") or BAD_NAME_RE.search(p)
                        for p in parts) or raw.startswith(("/", "\\")):
        raise WriteError(f"--folder {raw!r} must be a sub-folder of the "
                         f"chapter")
    return "/" + "/".join(parts)


def live_stem_clash(batch: Batch, name: str) -> list[str]:
    """The live notes whose file name is `name`."""
    return [other for other in batch.with_stem(name)
            if other.split("/", 1)[0] not in ("_Templates", "_meta")
            and not other.startswith(".")]


def cmd_scene_new(batch: Batch, args: argparse.Namespace,
                  _text: str) -> None:
    title = clean_name(args.title, "title")
    found = find_chapter(batch.vault, args.chapter)
    assert found is not None
    _chapter_rel, chapter_dir, chapter_name = found
    folder = chapter_subfolder(args.folder)
    base = f"{chapter_dir}{folder}/Scenes"
    rel = (f"{base}/{title}/{title}.md" if args.set_piece
           else f"{base}/{title}.md")
    # `[[Title]]` must name one note, or the Plan's pointer and
    # scene-played cannot tell which.
    clash = live_stem_clash(batch, title)
    if clash:
        raise WriteError(f"a note named {title!r} already exists: "
                         + ", ".join(clash) + "; choose another title")
    template = template_text(batch.vault, SCENE_TEMPLATES, "scene.md")
    fm = template_frontmatter(template)
    set_block(fm, "chapter", f'"[[{chapter_name}]]"')
    text = "---\n" + "\n".join(fm) + "\n---\n" + template_body(template)
    batch.create(rel, text)
    schema_check(batch, rel, text)
    batch.row("WOULD-CREATE", rel, "",
              f"scene template, chapter {chapter_name}"
              + (", set piece" if args.set_piece else ""))


def scene_matches(batch: Batch, name: str) -> list[str]:
    """The scene notes `name` means: its name, or its vault-relative path."""
    raw = bare_link(name)
    scene_notes = [rel for rel, _t in notes_of_type(batch.vault, "scene")]
    if "/" in raw:
        # A vault-relative path names one of several scenes of a name.
        want = nfc(raw.removesuffix(".md")).casefold()
        return [rel for rel in scene_notes
                if nfc(rel[:-3]).casefold() == want]
    want = nfc(raw).casefold()
    return [rel for rel in scene_notes
            if nfc(Path(rel).stem).casefold() == want]


def find_scene(batch: Batch, name: str, *, missing: str | None = None) -> str:
    """The one scene note `name` means: its name, or its vault-relative
    path when several share the name. `missing` replaces the refusal for
    no match."""
    scenes = scene_matches(batch, name)
    if len(scenes) != 1:
        raise WriteError(
            (missing or f"no scene note at or named {name!r}") if not scenes
            else f"{len(scenes)} scene notes named {name!r}: "
            + ", ".join(scenes) + "; pass its path as --scene")
    return scenes[0]


def _session_note(batch: Batch, raw: str) -> tuple[str, str]:
    """(the session's link name, its note's path); none or several are
    refused."""
    session = clean_name(bare_link(raw), "--session")
    sessions = [rel for rel in batch.with_stem(session)
                if not is_record(rel)
                and vl.entity_type(vl.extract_frontmatter(batch.read(rel))
                                   ) == "session"]
    if len(sessions) != 1:
        raise WriteError(
            f"no session note named {session!r}" if not sessions else
            f"{len(sessions)} session notes named {session!r}: "
            + ", ".join(sessions))
    return session, sessions[0]


def _played_links(have: dict[str, Any]) -> list[str]:
    played = have.get("played_in") or []
    if not isinstance(played, list):
        played = [played]
    return [vl.wikilink_target(str(x)) or bare_link(str(x))
            for x in played]


def _lists(have: dict[str, Any], session: str) -> bool:
    return nfc(session).casefold() in {
        nfc(x).casefold() for x in _played_links(have)}


def _mark(fm: list[str], have: dict[str, Any], session: str,
          status: str) -> bool:
    """Set `status` in the frontmatter lines `fm` and add `session` to
    played_in once; whether it was added."""
    links = _played_links(have)
    added = not _lists(have, session)
    if added:
        links.append(session)
    set_block(fm, "status", status)
    if added or "played_in" not in have:
        set_block(fm, "played_in", *link_list(links))
    return added


def cmd_scene_played(batch: Batch, args: argparse.Namespace,
                     _text: str) -> None:
    session = ""
    if not args.dropped:
        session, _session_rel = _session_note(batch, args.session)
    rel = find_scene(batch, args.scene)
    text = batch.read(rel)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    have = vl.extract_frontmatter(text) or {}
    new_status = "dropped" if args.dropped else "played"
    same = str(have.get("status") or "").strip() == new_status
    if args.dropped:
        if same:
            batch.row("SKIP", rel, "", "already dropped")
            return
        if str(have.get("status") or "").strip() == "played":
            raise WriteError(f"{rel}: already played; --dropped is for a "
                             f"scene that was not finished")
        set_block(fm, "status", "dropped")
        batch.put(rel, "---" + eol + eol.join(fm) + eol + "---" + eol
                  + "".join(lines[end + 1:]))
        batch.row("WOULD-ADD", rel, "", "status dropped")
        return
    if _lists(have, session) and "played_in" in have and same:
        batch.row("SKIP", rel, "", f"already {new_status}; played_in "
                  f"already lists [[{session}]]")
        return
    added = _mark(fm, have, session, new_status)
    new = ("---" + eol + eol.join(fm) + eol + "---" + eol
           + "".join(lines[end + 1:]))
    batch.put(rel, new)
    batch.row("WOULD-ADD", rel, "",
              f"status {new_status}; played_in "
              + (f"+ [[{session}]]" if added else "already lists "
                 f"[[{session}]]"))


H12_RE = re.compile(r"^ {0,3}#{1,2}(?:[ \t]+(.*))?$")
AFTER_RE = re.compile(r"^After \[\[(.+?)\]\]\.\s*$")


def paused_body(snapshot: str, batch: Batch, rel: str,
                eol: str) -> tuple[list[str], int]:
    """(the `## Paused` section's body lines, each with its ending, ending
    with the `<!-- /paused -->` marker; the number of snapshot lines) for the stdin text, with #/##
    headings outside code fences demoted to ###."""
    out: list[str] = []
    fence: str | None = None
    for n, line in enumerate(snapshot.strip().splitlines(), 1):
        fence, is_fence = vl.fence_step(line, fence)
        if fence is None and not is_fence and vl.PAUSED_END_RE.match(line):
            batch.row("WARNING", rel, "", f"snapshot line {n} is an end "
                      f"marker ({vl.PAUSED_END}); dropped, the section "
                      f"gets its own")
            continue
        m = H12_RE.match(line)
        if m and not is_fence:
            if fence is None:
                line = ("### " + m.group(1)) if m.group(1) else "###"
                batch.row("WARNING", rel, "", f"snapshot line {n} was a "
                          f"heading above ###; demoted to {line!r}")
            else:
                batch.row("WARNING", rel, "", f"snapshot line {n} is a "
                          f"#/## line inside a code fence: left alone, "
                          f"but it would end the section for readers")
        out.append(line.rstrip())
    count = len(out)
    if fence is not None:
        # An open fence would swallow the end marker and the rest of the
        # note for every reader.
        out.append(fence)
        batch.row("WARNING", rel, "", "the snapshot leaves a code fence "
                  "open; closed it")
    out.append(vl.PAUSED_END)
    return [ln + eol for ln in out], count


def top_insert_index(body: list[str]) -> int:
    """Where a new section goes: 0, or after a leading HTML comment that
    is not a gm-only or spoiler marker."""
    i = 0
    while i < len(body) and not body[i].strip():
        i += 1
    if i < len(body) and body[i].lstrip().startswith("<!--"):
        for j in range(i, len(body)):
            if vl.markers_in(body[j]):
                return 0
            if "-->" in body[j]:
                return j + 1
    return 0


def cmd_scene_paused(batch: Batch, args: argparse.Namespace,
                     snapshot: str) -> None:
    session, session_rel = _session_note(batch, args.session)
    if not snapshot.strip():
        raise WriteError("nothing to write: send the snapshot on stdin")
    if (args.chapter or args.folder) and not args.new:
        raise WriteError("--chapter and --folder only go with --new")
    created = False
    if args.new:
        name = clean_name(bare_link(args.scene), "--scene")
        if scene_matches(batch, args.scene):
            where = find_scene(batch, args.scene)
            raise WriteError(f"scene {name!r} already exists at {where}; "
                             f"drop --new")
        if args.chapter:
            found = find_chapter(batch.vault, args.chapter)
        else:
            fm_s = vl.extract_frontmatter(batch.read(session_rel)) or {}
            of = vl.chapter_of(session_rel, fm_s)
            found = find_chapter(batch.vault, of, missing_ok=True) \
                if of else None
            if found is None:
                # The link names no chapter note: try the chapter whose
                # folder holds the session note.
                folder = vl.chapter_of(session_rel, {})
                found = find_chapter(batch.vault, folder, missing_ok=True) \
                    if folder and folder != of else None
            if found is None:
                raise WriteError(
                    f"session {session!r} has no chapter note to file the "
                    f"scene in: pass --chapter, or make the chapter with "
                    f"gma vault-write <vault> chapter-new")
        assert found is not None
        _crel, chapter_dir, chapter_name = found
        rel = f"{chapter_dir}{chapter_subfolder(args.folder)}/Scenes/{name}.md"
        clash = live_stem_clash(batch, name)
        if clash:
            raise WriteError(f"a note named {name!r} already exists: "
                             + ", ".join(clash) + "; choose another title")
        template = template_text(batch.vault, SCENE_TEMPLATES, "scene.md")
        fm = template_frontmatter(template)
        set_block(fm, "chapter", f'"[[{chapter_name}]]"')
        text = "---\n" + "\n".join(fm) + "\n---\n"
        created = True
    else:
        rel = find_scene(batch, args.scene, missing=(
            f"no scene note named {args.scene!r}; for a scene born at the "
            f"table, add --new"))
        text = batch.read(rel)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    have = vl.extract_frontmatter(text) or {}
    _mark(fm, have, session, "paused")
    head = "---" + eol + eol.join(fm) + eol + "---" + eol
    body = lines[end + 1:]
    text_lines, count = paused_body(snapshot, batch, rel, eol)
    section = [f"## Paused{eol}", eol, f"After [[{session}]].{eol}", eol,
               *text_lines]
    old_session = None
    span = vl.paused_span(body)
    left = None
    if span and not created:
        s0, e0 = span
        if not vl.PAUSED_END_RE.match(body[e0 - 1].rstrip("\r\n")) \
                and any(ln.strip() for ln in body[e0:]):
            # No end line and text below: the guessed span may hold the
            # GM's prep, so leave that section alone.
            left, span = s0, None
    if created:
        new_body = [eol, *section]
    elif span:
        s0, e0 = span
        for ln in body[s0 + 1:e0]:
            m = AFTER_RE.match(ln.strip())
            if m:
                old_session = m.group(1)
                break
        new_section = list(section)
        if not body[e0 - 1].endswith(("\n", "\r")):
            new_section[-1] = new_section[-1].rstrip("\r\n")
        new_body = body[:s0] + new_section + body[e0:]
    else:
        at = top_insert_index(body)
        before, rest = body[:at], body[at:]
        while rest and not rest[0].strip():
            rest = rest[1:]
        while before and not before[-1].strip():
            before = before[:-1]
        new_body = [*before, eol, *section, *([eol] if rest else []), *rest]
        if left is not None:
            at_new = left if left < at else \
                left + len(new_body) - len(body)
            batch.row("WARNING", rel, "", f"line {len(fm) + 3 + at_new}: "
                      f"an older ## Paused section with no end line was "
                      f"left as it is; delete it by hand once the new one "
                      f"is right")
    if created:
        new = head + "".join(new_body)
        batch.create(rel, new)
        schema_check(batch, rel, new)
        batch.row("WOULD-CREATE", rel, "§Paused",
                  f"scene born at the table, chapter {chapter_name}, "
                  f"paused after [[{session}]]")
        return
    new = head + "".join(new_body)
    if new == text:
        batch.row("SKIP", rel, "§Paused", f"already paused after "
                  f"[[{session}]] with this snapshot")
        return
    batch.put(rel, new)
    detail = f"status paused; played_in + [[{session}]]; "
    if not span:
        detail += f"snapshot {count} lines"
    elif old_session:
        detail += f"replaces the snapshot after [[{old_session}]]"
    else:
        detail += "replaces the earlier snapshot"
    batch.row("WOULD-ADD", rel, "§Paused", detail)


# --- prop-new ----------------------------------------------------------------

PROP_TEMPLATES = ("_Template_Prop.md",)
HANDS_REL = "_meta/prop-hands.json"
HAND_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
# tools/publish/lib/fonts.js isValidFamily, which the build reads a hand's
# font with: a family it refuses is skipped there.
HAND_FONT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 \-]{0,63}")


def valid_font(name: object) -> bool:
    """Whether the publish tool can use `name` as a font family."""
    return isinstance(name, str) and HAND_FONT_RE.fullmatch(name) is not None \
        and "  " not in name


def read_hands(batch: Batch) -> tuple[dict[str, Any], dict[str, Any]]:
    """(the hand registry as read, its `hands` table); none yet is empty."""
    raw = batch.read_data(HANDS_REL)
    if raw is None:
        return {}, {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise WriteError(f"{HANDS_REL} is not JSON; fix it by hand "
                         f"first") from None
    hands = data.get("hands") if isinstance(data, dict) else None
    if not isinstance(hands, dict):
        raise WriteError(f"{HANDS_REL} has no \"hands\" table; fix it "
                         f"by hand first")
    for name, entry in hands.items():
        if not isinstance(entry, dict):
            raise WriteError(f"{HANDS_REL}: hand {name!r} is not an "
                             f"object with a font; fix it by hand first")
    return data, hands


def use_hand(batch: Batch, hand: str, font: str | None,
             who: str | None) -> None:
    """Check `hand` against the registry and add it when it is new."""
    if not HAND_ID_RE.match(hand):
        raise WriteError(f"--hand {hand!r} must be lower-case letters, "
                         f"digits and hyphens, up to 41 characters")
    data, hands = read_hands(batch)
    have = hands.get(hand)
    if have is not None and not valid_font(have.get("font")):
        if font is None:
            raise WriteError(f'hand "{hand}" in {HANDS_REL} has no font the '
                             f"site can use ({have.get('font')!r}); give one "
                             f"with prop-hand --hand {hand} --hand-font")
    elif have is not None:
        have_font = str(have.get("font"))
        if font is not None and font != have_font:
            raise WriteError(f'hand "{hand}" is already {have_font}; use '
                             f"it, or choose a new id for a new writer")
        batch.row("SKIP", HANDS_REL, "", f"hand {hand} is {have_font}")
        if who is not None:
            batch.row("WARNING", HANDS_REL, "", f"--hand-who ignored: hand "
                      f"{hand} already exists")
        return
    if font is None:
        raise WriteError(f'hand "{hand}" is new: give its font with '
                         f"--hand-font")
    if not valid_font(font):
        raise WriteError(f"--hand-font {font!r} must be a font family name "
                         f"(letters, digits, single spaces and hyphens, "
                         f"starting with a letter or digit, up to 64)")
    fresh = batch.read_data(HANDS_REL) is None
    old: dict[str, Any] = have or {}
    hands[hand] = {"font": font, "who": who or str(old.get("who") or "")}
    batch.write_data(HANDS_REL, json.dumps(
        {**data, "hands": hands}, indent=2, ensure_ascii=False,
        sort_keys=True) + "\n")
    batch.row("WOULD-CREATE" if fresh else "WOULD-ADD", HANDS_REL, "",
              f"hand {hand} is {font}"
              + (f" (was {old.get('font')!r}, which the site cannot use)"
                 if have is not None else ""))


def cmd_prop_hand(batch: Batch, args: argparse.Namespace,
                  _text: str) -> None:
    """Add a hand to the registry for props already filed."""
    use_hand(batch, args.hand, args.hand_font, args.hand_who)


def one_container(batch: Batch, raw: str) -> str:
    name = clean_name(bare_link(raw), "--container")
    hits = live_stem_clash(batch, name)
    hits = [h for h in hits if not is_record(h)]
    if len(hits) != 1:
        raise WriteError(
            f"no note named {name!r} for --container" if not hits else
            f"{len(hits)} notes named {name!r}: " + ", ".join(hits))
    return name


def warn_if_unmapped(batch: Batch, rel: str) -> None:
    folder = Path(rel).parent.as_posix()
    answer = vc.ask_publish_tool(batch.vault, ["explain", rel])
    data = answer.data
    verdict = data.get("verdict") if isinstance(data, dict) else None
    if answer.why or (data is not None and not isinstance(verdict, dict)):
        batch.row("WARNING", rel, "",
                  f"could not check whether the site shows notes in {folder}: "
                  f"{answer.why or 'the publish tool answer is not understood'}")
        return
    if not isinstance(verdict, dict) or verdict.get("code") != "DIR_UNMAPPED":
        return
    batch.row("WARNING", rel, "",
              f"the site does not show notes in {folder}: add it to "
              f"player_site.folder_map (gm-publish settings set \u2026)")


def cmd_prop_new(batch: Batch, args: argparse.Namespace,
                 _text: str) -> None:
    title = clean_name(args.title, "title")
    found = find_chapter(batch.vault, args.chapter)
    assert found is not None
    _chapter_rel, chapter_dir, chapter_name = found
    if args.kind not in schema_rules.PROP_KINDS:
        raise WriteError(f"--kind must be one of "
                         f"{', '.join(sorted(schema_rules.PROP_KINDS))}")
    if args.style and args.file:
        raise WriteError("a prop has a style or a hand-made file, not both")
    if args.style and not HAND_ID_RE.match(args.style):
        raise WriteError(f"--style {args.style!r} must be lower-case "
                         f"letters, digits and hyphens")
    if args.hand_font is not None and not args.hand:
        raise WriteError("--hand-font needs --hand")
    folder = chapter_subfolder(args.folder)
    rel = f"{chapter_dir}{folder}/Props/{title}.md"
    clash = live_stem_clash(batch, title)
    if clash:
        raise WriteError(f"a note named {title!r} already exists: "
                         + ", ".join(clash) + "; choose another title")
    if args.file:
        parts = args.file.replace("\\", "/").split("/")
        if args.file.startswith(("/", "\\")) or ".." in parts:
            raise WriteError(f"--file {args.file!r} must be a name beside "
                             f"the note")
    container = one_container(batch, args.container) \
        if args.container else None
    scene = find_scene(batch, args.scene) if args.scene else None
    if args.hand:
        use_hand(batch, args.hand, args.hand_font, args.hand_who)
    template = template_text(batch.vault, PROP_TEMPLATES, "prop.md")
    fm = template_frontmatter(template)

    def quoted(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)
    set_block(fm, "name", quoted(title))
    set_block(fm, "prop_kind", args.kind)
    if args.style:
        set_block(fm, "prop_style", quoted(args.style))
    if args.file:
        set_block(fm, "prop_file", quoted(args.file))
    if args.hand:
        set_block(fm, "prop_hand", quoted(args.hand))
    if container:
        set_block(fm, "prop_container", quoted(f"[[{container}]]"))
    text = "---\n" + "\n".join(fm) + "\n---\n" + template_body(template)
    batch.create(rel, text)
    schema_check(batch, rel, text)
    detail = f"prop template, chapter {chapter_name}, kind {args.kind}"
    if args.style:
        detail += f", style {args.style}"
    if args.hand:
        detail += f", hand {args.hand}"
    batch.row("WOULD-CREATE", rel, "", detail)
    if args.file and not (batch.vault / Path(rel).parent / args.file
                          ).exists():
        batch.row("WARNING", rel, "", "write the page beside the note "
                  "before it is revealed")
    if scene:
        link_scene(batch, scene, title)
    batch.after_write.append(lambda: warn_if_unmapped(batch, rel))


def link_scene(batch: Batch, rel: str, title: str) -> None:
    """Add [[title]] to the scene's `entities` once; nothing else changes."""
    text = batch.read(rel)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    have = (vl.extract_frontmatter(text) or {}).get("entities") or []
    if not isinstance(have, list):
        have = [have]
    links = [vl.wikilink_target(str(x)) or bare_link(str(x)) for x in have]
    if nfc(title).casefold() in {nfc(x).casefold() for x in links}:
        batch.row("SKIP", rel, "", f"entities already lists [[{title}]]")
        return
    set_block(fm, "entities", *link_list([*links, title]))
    batch.put(rel, "---" + eol + eol.join(fm) + eol + "---" + eol
              + "".join(lines[end + 1:]))
    batch.row("WOULD-ADD", rel, "", f"entities + [[{title}]]")


# --- CLI ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path, help="the vault folder")
    sub = ap.add_subparsers(dest="command", required=True)
    new = sub.add_parser("wrapup-new", help="create a session's Wrap-Up")
    new.add_argument("--session", required=True,
                     help="the session index: vault-relative, or its name")
    new.add_argument("--source", help="text of the Source callout")
    new.add_argument("--write", action="store_true", help="write it (default: preview)")
    raw = argparse.RawDescriptionHelpFormatter
    add = sub.add_parser(
        "wrapup-add", help="place Wrap-Up sections (stdin)",
        formatter_class=raw, description=(
            "stdin: markdown sections, each starting with a heading.\n"
            "A ## section is player-facing and goes before GM Notes; a ###\n"
            "or #### section goes under GM Notes, unless it is written\n"
            "inside a ## section, where it stays and players see it."))
    add.add_argument("wrapup", help="the Wrap-Up: vault-relative, or its name")
    how = add.add_mutually_exclusive_group()
    how.add_argument("--replace", action="store_true",
                     help="replace a section that already exists")
    how.add_argument("--append", action="store_true",
                     help="add the text to the end of a section that "
                          "already exists")
    add.add_argument("--after", help="the heading a new section goes after")
    add.add_argument("--write", action="store_true", help="write it (default: preview)")
    settle = sub.add_parser(
        "wrapup-settle", help="tick Keeper Checklist items and strike "
        "answered questions (stdin rows)",
        formatter_class=raw, description=(
            "stdin: one tab-separated row per item: SECTION, LEAD, RULING.\n"
            "SECTION is the title, any case, of the Wrap-Up's ### Keeper\n"
            "Checklist or a ### heading starting Open Questions (the ones\n"
            "the bundle leaves settled items out of; any other is\n"
            "refused). LEAD names one top-level list item: its text\n"
            "(bold markers and a leading [ ] dropped) starts with LEAD, or\n"
            "its bold lead is LEAD. In Keeper Checklist the item becomes\n"
            "'- [x] ~~item~~ \u2014 RULING'; under Open Questions\n"
            "'~~item~~ \u2014 answered: RULING'. Nested lines stay. An item\n"
            "already ticked or struck is refused."))
    settle.add_argument("wrapup", help="the Wrap-Up: vault-relative, or its name")
    settle.add_argument("--write", action="store_true",
                        help="write it (default: preview)")
    story = sub.add_parser(
        "story", help="append story entries (stdin)",
        formatter_class=raw, description=(
            "stdin: entries, each opened by a '# [[PC Name]]' line.\n"
            "An entry may open with its own '## ' heading; otherwise it\n"
            "gets '## Session N - Title'. An entry holds no # or ## after that.\n"
            "--replace rewrites the session's entry instead of adding one."))
    story.add_argument("--wrapup", required=True, help="the wrap-up the entries come from")
    story.add_argument("--label", help="the entry heading's label")
    story.add_argument("--as-of", dest="as_of", help="asOfSession value")
    story.add_argument("--date", help="lastUpdated value, YYYY-MM-DD")
    story.add_argument("--replace", action="store_true",
                       help="replace each PC's existing entry for this "
                            "session (refused when there is none); other "
                            "entries stay as they are, and the frontmatter "
                            "but for --as-of and --date")
    story.add_argument("--write", action="store_true", help="write it (default: preview)")
    npcs = sub.add_parser(
        "npc-story", help="add a storied NPC's passage for a session (stdin)",
        formatter_class=raw, description=(
            "stdin: entries, each opened by a '# [[NPC Name]]' line.\n"
            "Each is added to that NPC's note as '### Session N: Title'\n"
            "('### Chapter C Session N: Title' where another chapter has\n"
            "a session N) at the end of '## Story' (made before\n"
            "'## Related' when the note has none), or of the '## '\n"
            "section --section names.\n"
            "Refused: a hidden or gm-only section (passages are for\n"
            "players), a place inside a block the site strips, a session\n"
            "the section already has (--replace rewrites it), an NPC\n"
            "with no voice, and a new passage while vault.voices is off.\n"
            "Archived and QA copies are never the NPC. With no\n"
            "--section, a HINT row names a section holding earlier\n"
            "session passages."))
    npcs.add_argument("--wrapup", required=True, help="the wrap-up the entries come from")
    npcs.add_argument("--section", metavar="HEADING",
                      help="the '## ' section to write under (default: Story)")
    npcs.add_argument("--as-of", dest="as_of", help="asOfSession value")
    npcs.add_argument("--date", help="lastUpdated value, YYYY-MM-DD")
    npcs.add_argument("--replace", action="store_true",
                      help="replace the NPC's existing passage for this "
                           "session in the section a new one would go to "
                           "(refused when there is none); other "
                           "passages stay as they are, and the frontmatter "
                           "but for --as-of and --date")
    npcs.add_argument("--write", action="store_true", help="write it (default: preview)")
    status = sub.add_parser(
        "status", help="rewrite a PC's Current Status fields (stdin)",
        formatter_class=raw, description=(
            "stdin: labelled fields, each opened by '**Label:** value' at\n"
            "the margin; lines under it (an Open threads list) belong to it.\n"
            "Each field sent replaces the one with that label in\n"
            "## Current Status, in the note's own shape; a label the note\n"
            "lacks is added after its last field. Fields not sent, the\n"
            "lede, subsections and asides are left alone. --show prints\n"
            "the fields as they stand, and reads no stdin."))
    status.add_argument("pc", help="the PC note, vault-relative, or its name")
    how_status = status.add_mutually_exclusive_group()
    how_status.add_argument("--show", action="store_true", help="print the PC's Current Status fields")
    how_status.add_argument("--write", action="store_true", help="write it (default: preview)")
    threads = sub.add_parser(
        "threads", help="add, move, close, rest, wake and hand threads (stdin rows)",
        formatter_class=raw, description=(
            "stdin: one row per line, fields separated by TAB.\n"
            "  add   shared  SINCE  WHO  TEXT   add to the Overview's Open Threads\n"
            "  move  LEAD    SINCE  WHO         take LEAD off each named PC that\n"
            "                                   has it, add it once to the shared\n"
            "                                   list involving them all (already\n"
            "                                   there word for word: the copies\n"
            "                                   just go)\n"
            "  close LIST    LEAD   EVIDENCE    LIST is 'shared', 'dormant' or a PC's\n"
            "                                   note name; the thread leaves it and\n"
            "                                   is recorded in the Wrap-Up's\n"
            "                                   Resolved Threads. 'wrapup': the\n"
            "                                   Wrap-Up lines on no list with that\n"
            "                                   lead, recorded as one, in the\n"
            "                                   newest words\n"
            "  rest  LIST    LEAD   WHY  [WHO]  LIST is 'shared', 'wrapup' (lines\n"
            "                                   on no list, as one; WHO, default\n"
            "                                   party, only here) or a PC's note\n"
            "                                   name; the thread leaves it for the\n"
            "                                   Overview's Dormant Threads, with\n"
            "                                   'dormant since Session N (WHY)', N\n"
            "                                   the Wrap-Up's session. Waits for a\n"
            "                                   site tool that hides that list\n"
            "  wake  LEAD    WHO    [TEXT]      a dormant thread goes back to a\n"
            "                                   list players read: one PC names\n"
            "                                   their Open threads; several PCs or\n"
            "                                   'party', the shared list. TEXT:\n"
            "                                   how it reads there\n"
            "  hand  FROM    LEAD   TO          take LEAD off PC FROM's Open threads\n"
            "                                   and add it, unchanged, to PC TO's\n"
            "                                   Open threads\n"
            "SINCE is a session label, or - for none. WHO is PC note\n"
            "names separated by commas, or 'party' (for move, every active\n"
            "PC). Any ERROR row writes nothing."))
    threads.add_argument("--wrapup", help="the Wrap-Up that records closed "
                         "threads (needed by close and rest rows): vault-relative, or its name")
    threads.add_argument("--write", action="store_true", help="write it (default: preview)")
    log = sub.add_parser(
        "log", help="add log lines to notes (stdin rows)",
        formatter_class=raw, description=(
            "stdin: one row per line, PATH<TAB>SECTION<TAB>LINE.\n"
            "SECTION is 'Campaign Log' or 'GM Notes/Behind the Scenes';\n"
            "a note with no Campaign Log but an Appearances or Encounters\n"
            "section gets the row there (the row says 'resolved');\n"
            "any section name is accepted. A section the note's template\n"
            "keeps under GM Notes must be written as 'GM Notes/<Name>'\n"
            "unless the note already has it as a public section."))
    log.add_argument("--write", action="store_true", help="write it (default: preview)")
    tl = sub.add_parser(
        "timeline", help="add timeline entries (stdin)",
        formatter_class=raw, description=(
            "stdin: entries exactly as they should read. A line at the\n"
            "margin opens an entry; indented lines belong to it."))
    tl.add_argument("--under", required=True,
                    help="the heading to add under: its text names an "
                         "existing heading at any level; a new heading "
                         "takes its hashes ('### October 1923')")
    tl.add_argument("--after", help="where a new heading goes (its text, "
                    "or with its hashes)")
    tl.add_argument("--file", help=f"the timeline note (default {TIMELINE})")
    tl.add_argument("--write", action="store_true", help="write it (default: preview)")
    sn = sub.add_parser(
        "session-new", help="a cold session's index and Play Notes, or "
        "with --upcoming an unplayed session's index alone",
        formatter_class=raw, description=(
            "Files both beside the previous session, from the session\n"
            "template; the previous index's own keys come forward empty.\n"
            "--export places a table-assistant export whole under\n"
            "## Narrative Record and resolves its NPCs, Locations and\n"
            "Items: EXACT, ALIAS, NEAR (candidates) or NONE, one row each."))
    sn.add_argument("--number", type=int, required=True, help="the session's number")
    sn.add_argument("--title", required=True, help="the session's title")
    sn.add_argument("--play-date", dest="play_date", help="YYYY-MM-DD")
    sn.add_argument("--chapter", help="the chapter, when the number "
                    "alone does not say which")
    sn.add_argument("--upcoming", action="store_true",
                    help="a session not yet played (prep): the index "
                    "alone, status planned, no Play Notes")
    sn.add_argument("--export", help="the export file (any path)")
    sn.add_argument("--write", action="store_true", help="write it (default: preview)")
    pn = sub.add_parser(
        "play-notes-new", help="Play Notes beside a session index prep "
        "already filed", formatter_class=raw, description=(
            "Files <index> - Play Notes beside the index and sets its\n"
            "documents.play_notes, play_date (with --play-date) and a\n"
            "planned or prepped status to played; the Plan link stays.\n"
            "Refused when Play Notes anywhere name the session. --export\n"
            "works as in session-new."))
    pn.add_argument("--session", required=True,
                    help="the session index: path or name")
    pn.add_argument("--play-date", dest="play_date", help="YYYY-MM-DD")
    pn.add_argument("--export", help="the export file (any path)")
    pn.add_argument("--write", action="store_true", help="write it (default: preview)")
    rs = sub.add_parser(
        "resolve", help="an export's names against the vault (read-only)",
        description="The name rows session-new prints, for an export "
                    "whose session is already filed.")
    rs.add_argument("--export", required=True, help="the export file")
    rs.add_argument("--write", action="store_true", help=argparse.SUPPRESS)
    pp = sub.add_parser(
        "promote-plan", help="file a Midwife draft as a vault plan",
        formatter_class=raw, description=(
            "Scaffolds from the plan template, copies the draft's body\n"
            "exactly and runs the schema check. participants and locations\n"
            "are left for the caller to fill."))
    pp.add_argument("draft", help="the draft, vault-relative")
    pp.add_argument("--to", required=True, help="the plan, vault-relative")
    pp.add_argument("--plan-type", dest="plan_type", required=True, help="the plan's type, one word")
    pp.add_argument("--chapter", help="default: the chapter folder of --to")
    pp.add_argument("--leads-to", dest="leads_to", action="append",
                    help="a plan this one leads to (repeatable)")
    pp.add_argument("--write", action="store_true", help="write it (default: preview)")
    ch = sub.add_parser(
        "chapter-new", help="file a new chapter note",
        description="Creates Chapters/<title>/<title>.md from the chapter "
                    "template. Refused when a chapter of that title exists.")
    ch.add_argument("--title", required=True, help="the chapter's title")
    ch.add_argument("--sort-order", dest="sort_order", type=float,
                    help="default: one after the highest chapter")
    ch.add_argument("--status", default="planned",
                    help="planned | active | complete (default planned)")
    ch.add_argument("--write", action="store_true", help="write it (default: preview)")
    sc = sub.add_parser(
        "scene-new", help="file a new scene under its chapter",
        formatter_class=raw, description=(
            "Creates <chapter folder>[/<folder>]/Scenes/<title>.md from the\n"
            "scene template, or with --set-piece\n"
            "Scenes/<title>/<title>.md. --chapter is the chapter note's\n"
            "name, its title or its folder; none or several: refused."))
    sc.add_argument("--chapter", required=True, help="the chapter the scene belongs to")
    sc.add_argument("--title", required=True, help="the scene's title")
    sc.add_argument("--set-piece", dest="set_piece", action="store_true",
                    help="give the scene a folder of its own")
    sc.add_argument("--folder", help="a sub-folder of the chapter, e.g. "
                    "Side_Adventures/The Audition")
    sc.add_argument("--write", action="store_true", help="write it (default: preview)")
    pa = sub.add_parser(
        "scene-paused", help="write a paused scene's snapshot",
        formatter_class=raw, description=(
            "Sets status to paused, adds the session to played_in once and\n"
            "writes the snapshot on stdin as the scene's `## Paused`\n"
            "section (replaced in place when there is one, else at the top\n"
            "of the body). --new files a scene born at the table in the\n"
            "session's chapter (or --chapter) as Scenes/<scene>.md."))
    pa.add_argument("--scene", required=True,
                    help="the scene note's name or path; with --new, "
                         "its title")
    pa.add_argument("--session", required=True,
                    help="the session note's name")
    pa.add_argument("--new", action="store_true",
                    help="create the scene note")
    pa.add_argument("--chapter", help="with --new: the chapter (default: "
                    "the session's)")
    pa.add_argument("--folder", help="with --new: a sub-folder of the "
                    "chapter")
    pa.add_argument("--write", action="store_true", help="write it (default: preview)")
    sp = sub.add_parser(
        "scene-played", help="mark a scene played or dropped",
        description="Sets status to played or dropped; played adds the "
                    "session to played_in once. No other field changes.")
    sp.add_argument("--scene", required=True,
                    help="the scene note's name, or its vault-relative "
                         "path when several share the name")
    sp.add_argument("--session",
                    help="the session note's name (not with --dropped)")
    sp.add_argument("--dropped", action="store_true",
                    help="the scene will not be played; no session")
    sp.add_argument("--write", action="store_true", help="write it (default: preview)")
    pr = sub.add_parser(
        "prop-new", help="file a new prop in its chapter's Props folder",
        formatter_class=raw, description=(
            "Creates <chapter folder>[/<folder>]/Props/<title>.md from the\n"
            "prop template. --style builds the page on the site; --file\n"
            "names a hand-made page beside the note. --hand names the\n"
            "writer's hand in _meta/prop-hands.json (a new one needs\n"
            "--hand-font). --scene links the prop from that scene's\n"
            "entities. The publish list is never touched."))
    pr.add_argument("--chapter", required=True, help="the chapter the prop belongs to")
    pr.add_argument("--title", required=True, help="the prop's title")
    pr.add_argument("--kind", default="document",
                    help="document | object | diagram | supplied | "
                         "container (default document)")
    pr.add_argument("--style", help="a site style, e.g. letter")
    pr.add_argument("--file", help="a hand-made page beside the note")
    pr.add_argument("--hand", help="the writer's hand id, e.g. sophia")
    pr.add_argument("--hand-font", dest="hand_font",
                    help="a new hand's font family")
    pr.add_argument("--hand-who", dest="hand_who",
                    help="a new hand's writer, in words")
    pr.add_argument("--scene", help="the scene that hands it over")
    pr.add_argument("--container", help="the container prop it sits in")
    pr.add_argument("--folder", help="a sub-folder of the chapter")
    pr.add_argument("--write", action="store_true", help="write it (default: preview)")
    ph = sub.add_parser(
        "prop-hand", help="add a writer's hand to _meta/prop-hands.json",
        formatter_class=raw, description=(
            "Adds a hand for props already filed (prop-new adds one for a\n"
            "new prop). The same id with the same font is a skip; with a\n"
            "different font, refused. It never touches a note or the\n"
            "publish list."))
    ph.add_argument("--hand", required=True,
                    help="the writer's hand id, e.g. sophia")
    ph.add_argument("--hand-font", dest="hand_font", required=True,
                    help="the hand's font family")
    ph.add_argument("--hand-who", dest="hand_who",
                    help="the hand's writer, in words")
    ph.add_argument("--write", action="store_true", help="write it (default: preview)")
    pl = sub.add_parser(
        "plan", help="write a session's Plan and check it",
        formatter_class=raw, description=(
            "Writes the Plan on stdin beside session N's index, with the\n"
            "template's frontmatter, sets the index to prepped with\n"
            "documents.plan, and prints plan_check's rows, then the\n"
            "Plan's read-aloud, clock and unresolved-link rows. No index yet:\n"
            "--title (and --chapter) files one as upcoming. An existing\n"
            "Plan is never overwritten: --section replaces each section\n"
            "on stdin by level and title, and adds a missing ## where the\n"
            "template has it."))
    pl.add_argument("--number", type=int, required=True, help="the session's number")
    pl.add_argument("--chapter", help="the chapter, when the number "
                    "alone does not say which")
    pl.add_argument("--title", help="the session's title, to file its "
                    "index when it has none")
    pl.add_argument("--section", action="store_true",
                    help="replace or add sections of the existing Plan")
    pl.add_argument("--headless", action="store_true",
                    help="check as a run with no GM (plan_check --headless)")
    pl.add_argument("--gm-input", dest="gm_input", nargs="*",
                    metavar="PART", help="a run with no GM (implies "
                    "--headless): the parts the request supplied (intent, "
                    "scenes, spotlight, spaced or comma-separated; bare: all)")
    pl.add_argument("--write", action="store_true", help="write it (default: preview)")
    ap.epilog = 'Example: gma vault-write "<vault>" wrapup-add "<wrap-up>" --write'
    bt = sub.add_parser(
        "batch", help="many writes, one plan, one commit",
        formatter_class=raw, description=(
            "Runs the blocks in FILE (several files: one batch, in order)\n"
            "against one plan: each\n"
            "'=== <command> <args>' line starts a block whose body is that\n"
            "command's stdin. Commands: every writer here, plus\n"
            "'stamp FILE... <stamp-entities options>', 'note-new PATH'\n"
            "(body: the whole note) and 'section NOTE HEADING\n"
            "[--append|--replace]' (body: the text). A body line starting\n"
            "'===' is written '\\==='. Without --write: each block's rows,\n"
            "nothing written. With --write: every chosen block, or none if\n"
            "any is refused (all refusals listed), then the frontmatter,\n"
            "relationships, pc-body and wrapup checks on what it wrote."))
    bt.add_argument("file", nargs="+",
                    help="the batch file(s), read in order as one batch; "
                    "- for stdin")
    bt.add_argument("--write", action="store_true",
                    help="write it (default: preview)")
    pick = bt.add_mutually_exclusive_group()
    pick.add_argument("--skip", metavar="N,M",
                      help="leave these blocks out, for later")
    pick.add_argument("--only", metavar="N,M",
                      help="write only these blocks")
    return ap


Command = Callable[[Batch, argparse.Namespace, str], None]
COMMANDS: dict[str, Command] = {"wrapup-new": cmd_wrapup_new,
                                "wrapup-add": cmd_wrapup_add,
                                "wrapup-settle": cmd_wrapup_settle,
                                "story": cmd_story,
                                "npc-story": cmd_npc_story,
                                "status": cmd_status,
                                "threads": cmd_threads,
                                "log": cmd_log,
                                "timeline": cmd_timeline,
                                "session-new": cmd_session_new,
                                "play-notes-new": cmd_play_notes_new,
                                "resolve": cmd_resolve,
                                "promote-plan": cmd_promote_plan,
                                "plan": cmd_plan,
                                "chapter-new": cmd_chapter_new,
                                "scene-new": cmd_scene_new,
                                "scene-played": cmd_scene_played,
                                "scene-paused": cmd_scene_paused,
                                "prop-new": cmd_prop_new,
                                "prop-hand": cmd_prop_hand}
NO_STDIN = frozenset({"wrapup-new", "session-new", "play-notes-new", "resolve",
                      "promote-plan", "chapter-new", "scene-new",
                      "scene-played", "prop-new", "prop-hand"})


def read_stdin() -> str:
    """Standard input as UTF-8 text, whatever the system code page is. A
    leading byte-order mark is dropped."""
    buffer = getattr(sys.stdin, "buffer", None)
    if buffer is None:
        return sys.stdin.read()
    try:
        return buffer.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        raise WriteError("stdin is not UTF-8") from None


def main(argv: list[str] | None = None, stdin: str | None = None) -> int:
    utf8_output()
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.command == "scene-played":
        if args.dropped and args.session:
            ap.error("--session does not go with --dropped")
        if not args.dropped and not args.session:
            ap.error("--session is required unless --dropped")
    if not args.vault.is_dir():
        print(f"{cli_name()}: {args.vault} is not a folder",
              file=sys.stderr)
        return 2
    if args.command == "batch":
        import vw_batch     # here: it imports this module
        return vw_batch.run(args)
    needs_stdin = args.command not in NO_STDIN
    batch = Batch(args.vault)
    if args.command == "status" and args.show:
        try:
            sys.stdout.write(show_status(batch, args.pc))
        except WriteError as e:
            print(f"ERROR\t{e}")
            return 1
        return 0
    try:
        text = ""
        if needs_stdin:
            text = read_stdin() if stdin is None else stdin
        try:
            COMMANDS[args.command](batch, args, text)
        except WriteError:
            raise
        except Exception as e:      # a refusal, never a traceback
            raise WriteError(f"{e.__class__.__name__}: {e}") from e
        check_fences(batch, text)
        wrote = False
        if args.write:
            apply(batch)
            wrote = True
            for ask in batch.after_write:
                try:
                    ask()
                except Exception as e:      # the files are written
                    batch.row("WARNING", "", "", f"a check after writing "
                              f"failed ({e.__class__.__name__}: {e})")
    except RestoreFailed as e:
        print(f"ERROR\t{e}")
        print("# files were left changed: restore them from the list above")
        return 1
    except WriteError as e:
        print(f"ERROR\t{e}")
        print("# nothing written")
        return 1
    sys.stdout.write(emit(batch, wrote))
    if batch.after:
        print("\n".join(batch.after))
    return 0


if __name__ == "__main__":
    sys.exit(main())

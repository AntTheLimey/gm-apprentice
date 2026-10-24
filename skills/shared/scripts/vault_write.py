#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes.

    vault_write.py VAULT wrapup-new --session INDEX [--source TEXT] [--write]
    vault_write.py VAULT wrapup-add WRAPUP [--replace | --append]
                               [--after HEADING]
                               [--write]                                < markdown
    vault_write.py VAULT story --wrapup WRAPUP [--label TEXT] [--as-of TEXT]
                               [--date YYYY-MM-DD] [--write]            < entries
    vault_write.py VAULT status PC [--write]                            < fields
    vault_write.py VAULT status PC --show
    vault_write.py VAULT log [--write]                                  < rows
    vault_write.py VAULT timeline --under HEADING [--after HEADING]
                               [--file REL] [--write]                   < entries
    vault_write.py VAULT session-new --number N --title T [--play-date D]
                               [--chapter C] [--export PATH | --upcoming] [--write]
    vault_write.py VAULT resolve --export PATH                (read-only)
    vault_write.py VAULT chapter-new --title T [--sort-order N]
                               [--status S] [--write]
    vault_write.py VAULT scene-new --chapter C --title T [--set-piece]
                               [--folder SUB] [--write]
    vault_write.py VAULT scene-played --scene T --session S [--paused]
                               [--write]
    vault_write.py VAULT promote-plan DRAFT --to PLAN --plan-type T
                               [--chapter C] [--leads-to PLAN]... [--write]
    vault_write.py VAULT plan --number N [--chapter C] [--title T]
                               [--section] [--headless [--gm-input [PART ...]]]
                               [--write]                                < markdown

Paths are vault-relative. Without --write every command prints its plan and
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
import re
import sys
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import plan_check
import schema_rules
import vault_check as vc
import vaultlib as vl
from migrate_core import StepFailed, write_text_atomic
from vaultlib import GM_MARKER_RE, LineState, scan_body

OPEN_GM, CLOSE_GM = "open-gm", "close-gm"
# Spoiler blocks hide text like gm-only blocks, so a section ends at them
# by the same rule.
OPENERS = frozenset({OPEN_GM, "open-spoiler"})
CLOSERS = frozenset({CLOSE_GM, "close-spoiler"})
LIST_RE = re.compile(r"^\s*[-*+] ")
VERBS = {"WOULD-CREATE": "CREATED", "WOULD-ADD": "ADDED"}


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
        self._listing: dict[str, str] | None = None

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
        return self._listing

    def with_stem(self, stem: str) -> list[str]:
        """Vault-relative paths of the notes whose file name (without .md)
        is `stem`, compared NFC and case-folded."""
        want = nfc(stem).casefold()
        return sorted(rel for rel in self._files().values()
                      if nfc(Path(rel).stem).casefold() == want)

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

    total = (f"# create: {count('WOULD-CREATE', 'CREATED')}  "
             f"add: {count('WOULD-ADD', 'ADDED')}  skip: {count('SKIP')}  "
             f"warnings: {count('WARNING')}  errors: {count('ERROR')}")
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
    quoted = re.match(r"""^\s*("[^"]*"|'[^']*')""", value)
    if quoted:
        return quoted.group(1).strip()
    return COMMENT_TAIL_RE.sub("", value)


def template_frontmatter(text: str) -> list[str]:
    """A template's frontmatter lines without endings and without its
    comments (whole-line or trailing)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
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
    index = batch.resolve(args.session)
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
        body += ["> [!info] Source",
                 *[f"> {ln}".rstrip() for ln in args.source.splitlines()], ""]
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
    fix = "run vault_check.py wrapup --fix"
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
    rel = batch.resolve(args.wrapup)
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


def split_entries(text: str) -> list[tuple[str, str | None, list[str]]]:
    """(PC name, the entry's own `## ` heading or None, its lines). An
    entry that opens with a `## ` line is headed exactly so."""
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
            raise WriteError("stdin must start with a '# [[PC Name]]' line")
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
            raise WriteError(f"PC '{name}': the entry is empty")
        if any(h[1] <= 2 for h in vl.fenced_headings("\n".join(body))):
            raise WriteError(f"PC '{name}': an entry cannot hold a # or ## "
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


def cmd_story(batch: Batch, args: argparse.Namespace, text: str) -> None:
    wrap_rel = batch.resolve(args.wrapup)
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
    date = args.date or vl.unquote(raw_value(wrap, "play_date") or "")
    for name, custom, body in split_entries(text):
        pc_rel = find_pc(batch, name)
        rel = pc_rel[:-3] + "_Story.md"
        existing = batch.read(rel) if batch.exists(rel) else None
        label = args.label or story_label(existing, number)
        heading = custom or f"## {label}{DASH}{title}"
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
        if existing is not None and old_plain == as_of:
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
    write_fields(batch, rel, note, stdin_fields(text))


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


# `**New open threads (Session 6):**`, the per-session bullet wrap-ups once
# appended to Current Status instead of reconciling its Open threads list.
SESSION_THREADS_RE = re.compile(
    r"(?:new\s+)?open threads\s*\(\s*session\s*(\d+)\s*\)")


def session_threads(text: str) -> list[tuple[int, Field]]:
    """(session number, field) for each per-session open-threads field
    anywhere in the note's public Current Status, subsections included."""
    doc = parse(text)
    head, _rows = _status_region(doc)
    if head is None or doc.problems:
        return []
    rows = own_lines(doc, head, section_end(doc, head))
    out = []
    for f in read_fields(doc.lines, rows):
        m = SESSION_THREADS_RE.fullmatch(key(f.label))
        if m:
            out.append((int(m.group(1)), f))
    return out


def fold_session_threads(batch: Batch, rel: str) -> list[int]:
    """Fold the note's per-session open-threads fields into its one Open
    threads field (created when it has none), through `write_fields`.
    Each becomes an item `**Session N:**` followed by its text word for
    word; the bullet itself is removed. Returns the sessions folded."""
    note = batch.read(rel)
    found = session_threads(note)
    if not found:
        return []
    doc = parse(note)
    _head, region = _status_region(doc)
    main = [f for f in read_fields(doc.lines, region)
            if key(f.label) == "open threads"]
    if len(main) > 1:
        raise WriteError(f"{rel}: 'Open threads' is in {CURRENT_STATUS} "
                         f"twice: fix it by hand first")
    lines = (reshape(main[0], "") if main else ["**Open threads:**"])
    for n, f in found:
        m = FIELD_RE.match(f.lines[0])
        assert m is not None
        rest = f.lines[1:]
        cut = min((len(ln) - len(ln.lstrip()) for ln in rest if ln.strip()),
                  default=0)
        lines.append(f"- **Session {n}:**{f.lines[0][m.end():]}")
        lines += ["  " + ln[cut:] if ln.strip() else "" for ln in rest]
    label = main[0].label if main else "Open threads"
    out = list(doc.lines)
    for _n, f in sorted(found, key=lambda x: x[1].start, reverse=True):
        start, end = f.start, f.end
        # Don't leave two blank lines where the bullet stood alone.
        if (0 < start and end < len(out) and not out[start - 1].strip()
                and not out[end].strip()):
            end += 1
        del out[start:end]
    note = "".join(out)
    batch.put(rel, note)
    write_fields(batch, rel, note, [Field(label, "", 0, 0, lines)])
    return [n for n, _f in found]


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
        raise WriteError(f"{rel}: no timeline \u2014 vault_scaffold.py creates it")
    entries = split_timeline(text)
    if not entries:
        raise WriteError("nothing on stdin")
    level, title = _heading_arg(args.under, "--under")
    where = f"\u00a7{title}"
    note = batch.read(rel)
    doc = parse(note)
    if doc.problems:
        raise WriteError(f"{rel}: gm-only fence is unbalanced "
                         f"({doc.problems[0]})")
    if _find(doc, level, title) is None:
        other = next((h for h in doc.heads if key(h.title) == key(title)),
                     None)
        if other is not None:
            raise WriteError(
                f"{rel}: has '{'#' * other.level} {other.title}' \u2014 a "
                f"second heading with that title would be a duplicate: use "
                f"--under '{'#' * other.level} {other.title}'")
        if args.after:
            after = _find(doc, *_heading_arg(args.after, "--after"))
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


def is_record(rel: str) -> bool:
    """A note no name means: archived, a QA report, or a Midwife draft."""
    return vl.is_unchecked_source(rel) or rel.split("/", 1)[0] == "_midwife"


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
    return "", [f'  - "[[{link}]]"' for link in links]


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
    return text.replace("\r\n", "\n")


def cmd_resolve(batch: Batch, args: argparse.Namespace, _text: str) -> None:
    resolve_export(batch, export_entries(read_export(args.export)))


def cmd_session_new(batch: Batch, args: argparse.Namespace,
                    _text: str) -> None:
    n = args.number
    title = " ".join(args.title.split())
    if n < 1:
        raise WriteError("--number must be 1 or more")
    if not title or BAD_NAME_RE.search(title):
        raise WriteError(f"title {args.title!r} cannot be a file name "
                         f"(none of \\ / : * ? \" < > | # ^ [ ])")
    if args.play_date and not ISO_DATE_RE.fullmatch(args.play_date):
        raise WriteError("--play-date must be YYYY-MM-DD")
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
        raise WriteError(f"session {n} already has an index: {taken[0]}")
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
    note_fm = ["type: session-play-notes", f'session: "[[{stem}]]"',
               f"session_number: {n}", f"chapter: {chapter_raw}", f"campaign: {campaign_raw or chr(34) * 2}",
               "canon_status: AUTHORITATIVE", "created_by: manual"]
    if args.play_date:
        note_fm.append(f'play_date: "{args.play_date}"')
    note_fm.append("tags: []")
    notes_text = ("---\n" + "\n".join(note_fm) + "\n---\n\n"
                  f"# {stem} - Play Notes\n")
    if args.export:
        notes_text += (f"\n## Narrative Record\n\nExport "
                       f"`{Path(args.export).name}`, placed whole and "
                       f"unedited.\n\n" + export)
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


def cmd_plan(batch: Batch, args: argparse.Namespace, text: str) -> None:
    if args.gm_input is not None and not args.headless:
        raise WriteError("--gm-input only changes what --headless checks: "
                         "pass --headless too")
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
    gm_input: bool | frozenset[str] = (
        False if args.gm_input is None else
        frozenset(plan_check.GM_INPUT_PARTS[p] for p in args.gm_input)
        or True)
    findings = plan_check.run_checks(
        rel, plan, vl.extract_frontmatter(plan) or {}, args.headless,
        gm_input)
    counts = {lv: sum(f.level == lv for f in findings)
              for lv in ("ERROR", "WARNING", "INFO")}
    # An empty section is allowed: its placeholder cues go on one line.
    empty = [f.locus.rpartition("\u00a7")[2] for f in findings
             if f.id == "placeholder"]
    rows = [f.row for f in findings if f.id != "placeholder"]
    if empty:
        rows.append(f"INFO\t{rel}\tplaceholder: empty or template text: "
                    + ", ".join(empty))
    batch.after = rows + [
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


def cmd_scene_new(batch: Batch, args: argparse.Namespace,
                  _text: str) -> None:
    title = clean_name(args.title, "title")
    found = find_chapter(batch.vault, args.chapter)
    assert found is not None
    _chapter_rel, chapter_dir, chapter_name = found
    folder = ""
    if args.folder:
        parts = [p for p in args.folder.replace("\\", "/").split("/")
                 if p.strip()]
        if not parts or any(p in (".", "..") or BAD_NAME_RE.search(p)
                            for p in parts) \
                or args.folder.startswith(("/", "\\")):
            raise WriteError(f"--folder {args.folder!r} must be a "
                             f"sub-folder of the chapter")
        folder = "/" + "/".join(parts)
    base = f"{chapter_dir}{folder}/Scenes"
    rel = (f"{base}/{title}/{title}.md" if args.set_piece
           else f"{base}/{title}.md")
    # `[[Title]]` must name one note, or the Plan's pointer and
    # scene-played cannot tell which.
    clash = [other for other in batch.with_stem(title)
             if other.split("/", 1)[0] not in ("_Templates", "_meta")
             and not other.startswith(".")]
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


def cmd_scene_played(batch: Batch, args: argparse.Namespace,
                     _text: str) -> None:
    session = clean_name(bare_link(args.session), "--session")
    sessions = [rel for rel in batch.with_stem(session)
                if not is_record(rel)
                and vl.entity_type(vl.extract_frontmatter(batch.read(rel))
                                   ) == "session"]
    if len(sessions) != 1:
        raise WriteError(
            f"no session note named {session!r}" if not sessions else
            f"{len(sessions)} session notes named {session!r}: "
            + ", ".join(sessions))
    raw = bare_link(args.scene)
    scene_notes = [rel for rel, _t in notes_of_type(batch.vault, "scene")]
    if "/" in raw:
        # A vault-relative path names one of several scenes of a name.
        want = nfc(raw.removesuffix(".md")).casefold()
        scenes = [rel for rel in scene_notes
                  if nfc(rel[:-3]).casefold() == want]
    else:
        want = nfc(raw).casefold()
        scenes = [rel for rel in scene_notes
                  if nfc(Path(rel).stem).casefold() == want]
    if len(scenes) != 1:
        raise WriteError(
            f"no scene note at or named {args.scene!r}" if not scenes else
            f"{len(scenes)} scene notes named {args.scene!r}: "
            + ", ".join(scenes) + "; pass its path as --scene")
    rel = scenes[0]
    text = batch.read(rel)
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(f"{rel}: {error}")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    have = vl.extract_frontmatter(text) or {}
    played = have.get("played_in") or []
    if not isinstance(played, list):
        played = [played]
    links = [vl.wikilink_target(str(x)) or bare_link(str(x))
             for x in played]
    new_status = "paused" if args.paused else "played"
    added = nfc(session).casefold() not in {
        nfc(x).casefold() for x in links}
    if not added and "played_in" in have \
            and str(have.get("status") or "").strip() == new_status:
        batch.row("SKIP", rel, "", f"already {new_status}; played_in "
                  f"already lists [[{session}]]")
        return
    if added:
        links.append(session)
    set_block(fm, "status", new_status)
    if added or "played_in" not in have:
        set_block(fm, "played_in", *link_list(links))
    new = ("---" + eol + eol.join(fm) + eol + "---" + eol
           + "".join(lines[end + 1:]))
    batch.put(rel, new)
    batch.row("WOULD-ADD", rel, "",
              f"status {new_status}; played_in "
              + (f"+ [[{session}]]" if added else "already lists "
                 f"[[{session}]]"))


# --- CLI ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="vault_write.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    sub = ap.add_subparsers(dest="command", required=True)
    new = sub.add_parser("wrapup-new", help="create a session's Wrap-Up")
    new.add_argument("--session", required=True,
                     help="the session index, vault-relative")
    new.add_argument("--source", help="text of the Source callout")
    new.add_argument("--write", action="store_true")
    raw = argparse.RawDescriptionHelpFormatter
    add = sub.add_parser(
        "wrapup-add", help="place Wrap-Up sections (stdin)",
        formatter_class=raw, description=(
            "stdin: markdown sections, each starting with a heading.\n"
            "A ## section is player-facing and goes before GM Notes; a ###\n"
            "or #### section goes under GM Notes, unless it is written\n"
            "inside a ## section, where it stays and players see it."))
    add.add_argument("wrapup", help="the Wrap-Up, vault-relative")
    how = add.add_mutually_exclusive_group()
    how.add_argument("--replace", action="store_true",
                     help="replace a section that already exists")
    how.add_argument("--append", action="store_true",
                     help="add the text to the end of a section that "
                          "already exists")
    add.add_argument("--after", help="the heading a new section goes after")
    add.add_argument("--write", action="store_true")
    story = sub.add_parser(
        "story", help="append story entries (stdin)",
        formatter_class=raw, description=(
            "stdin: entries, each opened by a '# [[PC Name]]' line.\n"
            "An entry may open with its own '## ' heading; otherwise it\n"
            "gets '## Session N - Title'. An entry holds no # or ## after that."))
    story.add_argument("--wrapup", required=True)
    story.add_argument("--label", help="the entry heading's label")
    story.add_argument("--as-of", dest="as_of", help="asOfSession value")
    story.add_argument("--date", help="lastUpdated value, YYYY-MM-DD")
    story.add_argument("--write", action="store_true")
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
    how_status.add_argument("--show", action="store_true")
    how_status.add_argument("--write", action="store_true")
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
    log.add_argument("--write", action="store_true")
    tl = sub.add_parser(
        "timeline", help="add timeline entries (stdin)",
        formatter_class=raw, description=(
            "stdin: entries exactly as they should read. A line at the\n"
            "margin opens an entry; indented lines belong to it."))
    tl.add_argument("--under", required=True,
                    help="the heading to add under, with its hashes")
    tl.add_argument("--after", help="where a new heading goes")
    tl.add_argument("--file", help=f"the timeline note (default {TIMELINE})")
    tl.add_argument("--write", action="store_true")
    sn = sub.add_parser(
        "session-new", help="a cold session's index and Play Notes, or "
        "with --upcoming an unplayed session's index alone",
        formatter_class=raw, description=(
            "Files both beside the previous session, from the session\n"
            "template; the previous index's own keys come forward empty.\n"
            "--export places a table-assistant export whole under\n"
            "## Narrative Record and resolves its NPCs, Locations and\n"
            "Items: EXACT, ALIAS, NEAR (candidates) or NONE, one row each."))
    sn.add_argument("--number", type=int, required=True)
    sn.add_argument("--title", required=True)
    sn.add_argument("--play-date", dest="play_date", help="YYYY-MM-DD")
    sn.add_argument("--chapter", help="the chapter, when the number "
                    "alone does not say which")
    sn.add_argument("--upcoming", action="store_true",
                    help="a session not yet played (prep): the index "
                    "alone, status planned, no Play Notes")
    sn.add_argument("--export", help="the export file (any path)")
    sn.add_argument("--write", action="store_true")
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
    pp.add_argument("--plan-type", dest="plan_type", required=True)
    pp.add_argument("--chapter", help="default: the chapter folder of --to")
    pp.add_argument("--leads-to", dest="leads_to", action="append",
                    help="a plan this one leads to (repeatable)")
    pp.add_argument("--write", action="store_true")
    ch = sub.add_parser(
        "chapter-new", help="file a new chapter note",
        description="Creates Chapters/<title>/<title>.md from the chapter "
                    "template. Refused when a chapter of that title exists.")
    ch.add_argument("--title", required=True)
    ch.add_argument("--sort-order", dest="sort_order", type=float,
                    help="default: one after the highest chapter")
    ch.add_argument("--status", default="planned",
                    help="planned | active | complete (default planned)")
    ch.add_argument("--write", action="store_true")
    sc = sub.add_parser(
        "scene-new", help="file a new scene under its chapter",
        formatter_class=raw, description=(
            "Creates <chapter folder>[/<folder>]/Scenes/<title>.md from the\n"
            "scene template, or with --set-piece\n"
            "Scenes/<title>/<title>.md. --chapter is the chapter note's\n"
            "name, its title or its folder; none or several: refused."))
    sc.add_argument("--chapter", required=True)
    sc.add_argument("--title", required=True)
    sc.add_argument("--set-piece", dest="set_piece", action="store_true",
                    help="give the scene a folder of its own")
    sc.add_argument("--folder", help="a sub-folder of the chapter, e.g. "
                    "Side_Adventures/The Audition")
    sc.add_argument("--write", action="store_true")
    sp = sub.add_parser(
        "scene-played", help="mark a scene played and link its session",
        description="Sets status to played (or paused) and adds the "
                    "session to played_in once. No other field changes.")
    sp.add_argument("--scene", required=True,
                    help="the scene note's name, or its vault-relative "
                         "path when several share the name")
    sp.add_argument("--session", required=True,
                    help="the session note's name")
    sp.add_argument("--paused", action="store_true")
    sp.add_argument("--write", action="store_true")
    pl = sub.add_parser(
        "plan", help="write a session's Plan and check it",
        formatter_class=raw, description=(
            "Writes the Plan on stdin beside session N's index, with the\n"
            "template's frontmatter, sets the index to prepped with\n"
            "documents.plan, and prints plan_check's rows. No index yet:\n"
            "--title (and --chapter) files one as upcoming. An existing\n"
            "Plan is never overwritten: --section replaces each section\n"
            "on stdin by level and title, and adds a missing ## where the\n"
            "template has it."))
    pl.add_argument("--number", type=int, required=True)
    pl.add_argument("--chapter", help="the chapter, when the number "
                    "alone does not say which")
    pl.add_argument("--title", help="the session's title, to file its "
                    "index when it has none")
    pl.add_argument("--section", action="store_true",
                    help="replace or add sections of the existing Plan")
    pl.add_argument("--headless", action="store_true",
                    help="check as a run with no GM (plan_check --headless)")
    pl.add_argument("--gm-input", dest="gm_input", nargs="*",
                    choices=sorted(plan_check.GM_INPUT_PARTS),
                    metavar="PART", help="with --headless: the parts the "
                    "GM supplied (intent, scenes, spotlight; bare: all)")
    pl.add_argument("--write", action="store_true")
    return ap


Command = Callable[[Batch, argparse.Namespace, str], None]
COMMANDS: dict[str, Command] = {"wrapup-new": cmd_wrapup_new,
                                "wrapup-add": cmd_wrapup_add,
                                "story": cmd_story,
                                "status": cmd_status,
                                "log": cmd_log,
                                "timeline": cmd_timeline,
                                "session-new": cmd_session_new,
                                "resolve": cmd_resolve,
                                "promote-plan": cmd_promote_plan,
                                "plan": cmd_plan,
                                "chapter-new": cmd_chapter_new,
                                "scene-new": cmd_scene_new,
                                "scene-played": cmd_scene_played}
NO_STDIN = frozenset({"wrapup-new", "session-new", "resolve",
                      "promote-plan", "chapter-new", "scene-new",
                      "scene-played"})


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


def utf8_output() -> None:
    """Make stdout and stderr write UTF-8 and never raise on a character."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None, stdin: str | None = None) -> int:
    utf8_output()
    ap = build_parser()
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"vault_write.py: {args.vault} is not a folder",
              file=sys.stderr)
        return 2
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

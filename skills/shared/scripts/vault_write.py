#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes.

    vault_write.py VAULT wrapup-new --session INDEX [--source TEXT] [--write]
    vault_write.py VAULT wrapup-add WRAPUP [--replace | --append]
                               [--after HEADING]
                               [--write]                                < markdown
    vault_write.py VAULT story --wrapup WRAPUP [--label TEXT] [--as-of TEXT]
                               [--date YYYY-MM-DD] [--write]            < entries
    vault_write.py VAULT log [--write]                                  < rows
    vault_write.py VAULT timeline --under HEADING [--after HEADING]
                               [--file REL] [--write]                   < entries

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

import vault_check as vc
import vaultlib as vl
from migrate_core import StepFailed, write_text_atomic
from vaultlib import LineState, scan_body

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


GM_MARKER_RE = re.compile(r"<!--\s*/?\s*gm-only\s*-->")


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


def list_end(doc: Doc, head: Head, end: int, line: str
             ) -> tuple[int, bool] | None:
    """(where `line` goes, whether it sits flush against the line above)
    in the section `head` opens, which ends at `end`: after the last
    top-level list item and what continues it, or, for a table row, after
    the last table row. Lines in code fences do not count. None when the
    section has no list (or no table) to join."""
    states = {s.lineno - 1: s for s in doc.states}

    mine = states.get(head.idx)

    def plain(i: int) -> bool:
        """A line outside code at the heading's own gm-only and spoiler
        depth: an aside inside the section is not part of its list."""
        st = states.get(i)
        return (st is not None and not st.in_code and mine is not None
                and st.gm_depth == mine.gm_depth
                and st.spoiler_depth == mine.spoiler_depth)

    span = range(head.idx + 1, end)
    if line.lstrip().startswith("|"):
        rows = [i for i in span if plain(i)
                and doc.lines[i].lstrip().startswith("|")]
        return (rows[-1] + 1, True) if rows else None
    items = [i for i in span if plain(i) and TOP_LIST_RE.match(doc.lines[i])]
    if not items:
        return None
    j = items[-1] + 1
    while j < end:
        text = doc.lines[j]
        if not text.strip():
            k = j
            while k < end and not doc.lines[k].strip():
                k += 1
            if k < end and plain(k) and doc.lines[k][:1] in (" ", "\t"):
                j = k + 1
                continue
            break
        st = states[j] if j in states else None
        if (st is None or not plain(j) or st.heading or st.marker
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
    for n, (level, title, unit) in enumerate(units):
        if level not in (2, 3, 4):
            raise WriteError(f"'{'#' * level} {title}': a Wrap-Up section "
                             f"starts at ##, ### or ####")
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


def type_template(note_type: str) -> tuple[TemplateMap | None, bool]:
    """(the shared template's section map for a note type, whether that
    template fences its GM Notes). An unknown type has no map and is
    fenced."""
    path = SHARED_TEMPLATES / f"{note_type}.md"
    if (not note_type or "/" in note_type or "\\" in note_type
            or ".." in note_type or not path.is_file()):
        return None, True
    text = path.read_text(encoding="utf-8")
    return read_template_map(text), "<!-- gm-only -->" in text


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
    if any(existing.strip() == line.strip()
           for existing in doc.lines[head.idx + 1:end]):
        return None, "already there"
    at, glue = list_end(doc, head, end, line) or (end, False)
    return place(doc, at, [line], tight=_listy(line), glue=glue), ""


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
        keeper, name = split_section(cells[1])
        where = f"\u00a7{'GM Notes/' if keeper else ''}{name}"
        new, detail = add_line(note, rel, cells[1], cells[2], tmap, fenced,
                               note_type)
        if new is None:
            batch.row("SKIP", rel, where, detail)
            continue
        batch.put(rel, new)
        batch.row("WOULD-ADD", rel, where, detail)
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


def cmd_timeline(batch: Batch, args: argparse.Namespace, text: str) -> None:
    rel = batch.resolve(args.file or TIMELINE)
    if not batch.exists(rel):
        raise WriteError(f"{rel}: no timeline \u2014 new-vault setup creates it")
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
    end = section_end(doc, head)
    known = {line.strip() for line in doc.lines[head.idx + 1:end]}
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
    log = sub.add_parser(
        "log", help="add log lines to notes (stdin rows)",
        formatter_class=raw, description=(
            "stdin: one row per line, PATH<TAB>SECTION<TAB>LINE.\n"
            "SECTION is 'Campaign Log' or 'GM Notes/Behind the Scenes';\n"
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
    return ap


Command = Callable[[Batch, argparse.Namespace, str], None]
COMMANDS: dict[str, Command] = {"wrapup-new": cmd_wrapup_new,
                                "wrapup-add": cmd_wrapup_add,
                                "story": cmd_story,
                                "log": cmd_log,
                                "timeline": cmd_timeline}


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
    needs_stdin = args.command != "wrapup-new"
    batch = Batch(args.vault)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())

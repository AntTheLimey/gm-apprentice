#!/usr/bin/env python3
"""vault_write.py: place text the apprentice wrote into vault notes.

    vault_write.py VAULT wrapup-new --session INDEX [--source TEXT] [--write]
    vault_write.py VAULT wrapup-add WRAPUP [--replace] [--after HEADING]
                               [--write]                                < markdown
    vault_write.py VAULT story --wrapup WRAPUP [--label TEXT] [--as-of TEXT]
                               [--date YYYY-MM-DD] [--write]            < entries
    vault_write.py VAULT log [--write]                                  < rows
    vault_write.py VAULT timeline --under HEADING [--after HEADING]
                               [--file REL] [--write]                   < entries

Paths are vault-relative. Without --write every command prints its plan and
writes nothing. The script never writes prose: it places the text on stdin.
A section is Keeper-facing when it is written under GM Notes and
player-facing when it is not; any section name is accepted.

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
from dataclasses import dataclass
from pathlib import Path

import vaultlib as vl
from migrate_core import StepFailed, write_text_atomic
from vaultlib import LineState, scan_body

OPEN_GM, CLOSE_GM = "open-gm", "close-gm"
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

    def resolve(self, raw: str) -> str:
        """The path as it is spelled on disk. macOS may store an accented
        name decomposed, so a miss is retried NFC-normalised."""
        rel = vl.normalize_file_arg(raw)
        if rel in self.texts or (self.vault / rel).is_file():
            return rel
        if self._listing is None:
            self._listing = {
                nfc(p.relative_to(self.vault).as_posix()):
                    p.relative_to(self.vault).as_posix()
                for p in self.vault.rglob("*.md")}
        return self._listing.get(nfc(rel), rel)

    def exists(self, rel: str) -> bool:
        return rel in self.texts or (self.vault / rel).is_file()

    def read(self, rel: str) -> str:
        if rel in self.texts:
            return self.texts[rel]
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
                else:
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
    of its level or higher, the gm-only marker that closes the block it
    sits in, the opener of a block that holds such a heading, or the end
    of the file. A gm-only aside wholly inside the section does not end
    it."""
    nest = 0
    opener: int | None = None
    for s in doc.states:
        i = s.lineno - 1
        if i <= head.idx:
            continue
        if s.marker == OPEN_GM:
            if nest == 0:
                opener = i
            nest += 1
        elif s.marker == CLOSE_GM:
            if nest == 0:
                return i
            nest -= 1
        elif s.heading is not None and s.heading[0] <= head.level:
            return opener if nest and opener is not None else i
    return len(doc.lines)


def place(doc: Doc, at: int, block: list[str], tight: bool = False) -> str:
    """The note's text with `block` (lines without endings) put after the
    last non-blank line before index `at`. A blank line separates it from
    what is above, unless `tight` and that line is a list item. No
    existing byte is removed."""
    lines = list(doc.lines)
    j = at
    while j > 0 and lines[j - 1].strip() == "":
        j -= 1
    if j > 0 and not lines[j - 1].endswith(("\n", "\r")):
        lines[j - 1] += doc.eol
    new = [b + doc.eol for b in block]
    if j > 0 and not (tight and LIST_RE.match(lines[j - 1])):
        new.insert(0, doc.eol)
    if j == at and at < len(lines):
        new.append(doc.eol)
    lines[j:j] = new
    return "".join(lines)


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
        quoted = re.match(r'^(\s*[\w-]+:\s*"[^"]*")', line)
        out.append(quoted.group(1) if quoted
                   else COMMENT_TAIL_RE.sub("", line))
    raise WriteError("template frontmatter never closes")


def raw_value(text: str, name: str) -> str | None:
    """A top-level frontmatter value exactly as written (quotes kept)."""
    lines = text.splitlines(keepends=True)
    end, error = vl.frontmatter_span(lines)
    if error:
        raise WriteError(error)
    value = vl.get_key(lines[1:end], name)
    return None if value is None else COMMENT_TAIL_RE.sub("", value).strip()


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
    notes = vl.nested_mapping(text, "documents").get("play_notes") or ""
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
    fm_lines = [line + "\n" for line in template_frontmatter(
        template_text(batch.vault, WRAP_TEMPLATES, "session-wrap.md"))]
    for field, value in values.items():
        vl.set_key(fm_lines, field, value, "\n")
    chapter_no, session_no = name.split("_")[1], name.split("_")[3]
    body = ["", f"# Chapter {chapter_no} \u00b7 Session {session_no} \u2014 "
                f"{title} \u2014 Wrap-Up", ""]
    if args.source:
        body += ["> [!info] Source", f"> {args.source}", ""]
    body += ["<!-- gm-only -->", "", "## GM Notes", "", "<!-- /gm-only -->"]
    batch.create(rel, "---\n" + "".join(fm_lines) + "---\n"
                 + "\n".join(body) + "\n")
    batch.row("WOULD-CREATE", rel, "", f"from {index}")


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
    return ap


COMMANDS: dict[str, object] = {"wrapup-new": cmd_wrapup_new}


def main(argv: list[str] | None = None, stdin: str | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"vault_write.py: {args.vault} is not a folder",
              file=sys.stderr)
        return 2
    needs_stdin = args.command != "wrapup-new"
    text = (sys.stdin.read() if stdin is None else stdin) if needs_stdin else ""
    batch = Batch(args.vault)
    try:
        run_command = COMMANDS[args.command]
        run_command(batch, args, text)  # type: ignore[operator]
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

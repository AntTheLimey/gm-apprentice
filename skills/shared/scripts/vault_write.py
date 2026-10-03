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

import vault_check as vc
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
    heads = vl._fenced_headings("\n".join(lines))
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
            opener = max(s.lineno - 1 for s in doc.states
                         if s.marker == OPEN_GM and s.lineno - 1 < h.idx)
            return h, opener, section_end(doc, h)
    raise WriteError(f"{rel}: no fenced ## GM Notes — {fix}")


def _replace(doc: Doc, head: Head, unit: list[str]) -> str:
    end = section_end(doc, head)
    while end > head.idx + 1 and not doc.lines[end - 1].strip():
        end -= 1
    new = [line + doc.eol for line in unit]
    return "".join(doc.lines[:head.idx] + new + doc.lines[end:])


def add_section(text: str, rel: str, tmap: TemplateMap, level: int,
                title: str, unit: list[str], replace: bool,
                after: str | None = None) -> tuple[str, str]:
    """(the Wrap-Up's new text, the row's detail). `after` names the
    heading a section the template does not know goes after."""
    doc = parse(text)
    gm_head, opener, closer = gm_region(doc, rel)
    k = key(title)
    if level == 2:
        if k == GM_NOTES or k in tmap.gm:
            raise WriteError(
                f"{rel}: '## {title}' is a GM Notes section — write it as "
                f"'{'#' * (4 if k in tmap.parent else 3)} {title}'")
        scope = [h for h in doc.heads if h.level == 2 and not h.gm]
        default, detail = opener, "" if k in tmap.titles else PLAYERS_SEE
        later = tmap.later(2, k, {c for _l, c in tmap.order} - tmap.gm)
    else:
        inside = [h for h in doc.heads if gm_head.idx < h.idx < closer]
        pk = tmap.parent.get(k) if level == 4 else None
        if pk is not None:
            parent = next((h for h in inside
                           if h.level == 3 and key(h.title) == pk), None)
            if parent is None:
                made, _ = add_section(text, rel, tmap, 3, tmap.titles[pk],
                                      [f"### {tmap.titles[pk]}"], False)
                return add_section(made, rel, tmap, level, title, unit,
                                   replace, after)
            stop = section_end(doc, parent)
            scope = [h for h in inside
                     if h.level == 4 and parent.idx < h.idx < stop]
            default = stop
            later = tmap.later(4, k, {c for c, p in tmap.parent.items()
                                      if p == pk})
        else:
            scope = [h for h in inside if h.level == 3]
            default, later = closer, tmap.later(3, k)
        detail = ""
    found = next((h for h in scope if key(h.title) == k), None)
    if found is not None:
        if not replace:
            raise WriteError(f"{rel}: already has '{'#' * level} {title}' "
                             f"— --replace to replace it")
        return _replace(doc, found, unit), "replaced"
    if after and k not in tmap.titles:
        want = key(after.lstrip("#").strip())
        anchor = next((h for h in scope if key(h.title) == want), None)
        if anchor is None:
            raise WriteError(f"{rel}: no heading '{after}' to go after")
        return place(doc, section_end(doc, anchor), unit), detail
    at = next((h.idx for h in scope if key(h.title) in later), default)
    return place(doc, at, unit), detail


def cmd_wrapup_add(batch: Batch, args: argparse.Namespace, text: str) -> None:
    rel = batch.resolve(args.wrapup)
    note = batch.read(rel)
    if vl.entity_type(vl.extract_frontmatter(note) or {}) not in vc.WRAP_TYPES:
        raise WriteError(f"{rel}: not a Wrap-Up")
    tmap = read_template_map(
        template_text(batch.vault, WRAP_TEMPLATES, "session-wrap.md"))
    for level, title, unit in split_units(text, set(tmap.titles)):
        if level not in (2, 3, 4):
            raise WriteError(f"'{'#' * level} {title}': a Wrap-Up section "
                             f"starts at ##, ### or ####")
        note, detail = add_section(note, rel, tmap, level, title, unit,
                                   args.replace, args.after)
        batch.put(rel, note)
        batch.row("WOULD-ADD", rel, f"§{title}", detail)


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
    add = sub.add_parser("wrapup-add", help="place Wrap-Up sections (stdin)")
    add.add_argument("wrapup", help="the Wrap-Up, vault-relative")
    add.add_argument("--replace", action="store_true",
                     help="replace a section that already exists")
    add.add_argument("--after", help="the heading a new section goes after")
    add.add_argument("--write", action="store_true")
    return ap


COMMANDS: dict[str, object] = {"wrapup-new": cmd_wrapup_new,
                               "wrapup-add": cmd_wrapup_add}


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

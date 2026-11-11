"""`vault-write batch`: many writes, one plan, one commit. Stdlib only.

    gma vault-write VAULT batch FILE [--write] [--skip N,M | --only N,M]

FILE (or `-` for stdin) holds blocks. A block starts with a line
`=== <command> <args>` and its body, the command's stdin, runs to the
next such line or the end. A body line that must start with `===` is
written `\\===`; the backslash is dropped. Blocks are numbered from 1.

Commands: every `vault-write` writer with its own arguments and stdin
(`wrapup-add`, `log`, `status`, `timeline`, `threads`, `story`, ...), and

    stamp FILE... <stamp-entities options>   no body
    note-new PATH                            body: the whole new note
    section NOTE HEADING [--append|--replace] body: the section's text

Every block plans against one staging area, in order, so a block sees
what an earlier one made. Without --write it prints each block's rows
under a `## N command target` line and writes nothing. With --write it
writes every selected block at once, or none of them (a refusal anywhere
writes nothing, and every refusal is listed), then checks the notes it
wrote. --skip leaves blocks out for later; --only writes just those.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import io
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import section as sec
import stamp_entities as se
import vault_write as vw
import vaultlib as vl

HEAD_RE = re.compile(r"^=== (.*?)\s*$")
EXTRA = ("stamp", "note-new", "section")
NOT_HERE = frozenset({"resolve"})          # read-only: run it on its own
PAST = {**vw.VERBS, "WOULD-STAMP": "STAMPED", "WOULD-REPLACE": "REPLACED"}


@dataclass
class Block:
    n: int
    line: int
    command: str
    args: list[str]
    body: str
    rows: list[str] = field(default_factory=list)
    error: str = ""

    @property
    def label(self) -> str:
        target = next((a for a in self.args if not a.startswith("-")), "")
        return f"## {self.n} {self.command}" + (f" {target}" if target else "")


def parse_blocks(text: str) -> list[Block]:
    blocks: list[Block] = []
    body: list[str] = []
    for i, line in enumerate(text.splitlines(keepends=True), 1):
        m = HEAD_RE.match(line.rstrip("\r\n"))
        if m:
            if blocks:
                blocks[-1].body = "".join(body)
            elif "".join(body).strip():
                raise vw.WriteError(f"line 1: text before the first "
                                    f"'=== <command>' line")
            body = []
            try:
                words = shlex.split(m.group(1))
            except ValueError as e:
                raise vw.WriteError(f"line {i}: {e}") from None
            if not words:
                raise vw.WriteError(f"line {i}: '===' with no command")
            blocks.append(Block(len(blocks) + 1, i, words[0], words[1:], ""))
        else:
            body.append(line[1:] if line.startswith("\\===") else line)
    if not blocks:
        raise vw.WriteError("no blocks: start each with '=== <command>'")
    blocks[-1].body = "".join(body)
    return blocks


def numbers(raw: str | None, count: int, flag: str) -> set[int]:
    if raw is None:
        return set()
    out = set()
    for part in raw.split(","):
        part = part.strip()
        if not part.isdigit() or not 1 <= int(part) <= count:
            raise vw.WriteError(f"{flag}: {part!r} is not a block number "
                                f"(1-{count})")
        out.add(int(part))
    return out


def _parse(parser_call, argv: list[str], what: str) -> argparse.Namespace:
    """An argparse parse whose complaint becomes a refusal, not an exit."""
    if "-h" in argv or "--help" in argv:
        raise vw.WriteError(f"{what}: --help is not for a block; run "
                            f"`gma vault-write <vault> {what} --help`")
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err), \
                contextlib.redirect_stdout(io.StringIO()):
            return parser_call(argv)
    except SystemExit:
        msg = err.getvalue().strip().splitlines()
        last = re.sub(r"^\S+: error: ", "", msg[-1]) if msg else "bad arguments"
        raise vw.WriteError(f"{what}: {last}") from None


def find_note(batch: vw.Batch, raw: str) -> str:
    """`section.resolve_note`, with the vault's name index built once per
    batch, and notes an earlier block created found by name or alias."""
    names = getattr(batch, "batch_names", None)
    if names is None:
        names = sec.name_index(vl.vault_files(batch.vault))
        batch.batch_names = names       # type: ignore[attr-defined]
    try:
        return sec.resolve_note(batch, raw, names)
    except vw.WriteError:
        want = vl.normalize(raw.removesuffix(".md"))
        hits = sorted(rel for rel, before in batch.originals.items()
                      if before is None and rel in batch.texts
                      and want in {vl.normalize(n) for n in (
                          Path(rel).stem,
                          *vl.frontmatter_aliases(batch.texts[rel]))})
        if len(hits) == 1:
            return hits[0]
        raise


def run_stamp(batch: vw.Batch, b: Block) -> None:
    ns = _parse(se.parse_args, [str(batch.vault), *b.args], "stamp")
    if ns.repair_canon or ns.write:
        raise vw.WriteError("stamp: --repair-canon and --write are not for "
                            "a batch (--write goes on the batch)")
    if b.body.strip():
        raise vw.WriteError("stamp takes no body")
    for raw in ns.files:
        rel = find_note(batch, raw)
        before = batch.read(rel)
        lines = before.splitlines(keepends=True)
        actions, _override, error = se.plan_file(rel, lines, ns)
        if error:
            raise vw.WriteError(f"{rel}: {'; '.join(actions)}")
        after = "".join(lines)
        if after != before:
            batch.put(rel, after)
            batch.row("WOULD-STAMP", rel, "", "; ".join(actions))
        else:
            batch.row("SKIP", rel, "", "already so")


def run_note_new(batch: vw.Batch, b: Block) -> None:
    if len(b.args) != 1:
        raise vw.WriteError("note-new takes one path")
    rel = vl.normalize_file_arg(b.args[0])
    if not rel.endswith(".md"):
        raise vw.WriteError(f"note-new: {rel} is not a .md path")
    if vl.extract_frontmatter(b.body) is None:
        raise vw.WriteError(f"note-new {rel}: the body must start with "
                            f"frontmatter between --- lines")
    batch.create(rel, b.body.rstrip("\r\n") + "\n")
    kind = (vl.extract_frontmatter(b.body) or {}).get("type", "")
    batch.row("WOULD-CREATE", rel, "", f"type: {kind}" if kind else "")


def run_section(batch: vw.Batch, b: Block) -> None:
    ap = argparse.ArgumentParser(prog="section", add_help=False)
    ap.add_argument("note")
    ap.add_argument("heading")
    how = ap.add_mutually_exclusive_group()
    how.add_argument("--append", action="store_true")
    how.add_argument("--replace", action="store_true")
    ns = _parse(ap.parse_args, b.args, "section")
    if not b.body.strip():
        raise vw.WriteError("section: no text to write")
    rel = find_note(batch, ns.note)
    text = batch.read(rel)
    path = [p.strip() for p in ns.heading.split("/")]
    pin = sec.PIN_RE.match(path[0])
    level = None
    if pin:
        level, path[0] = len(pin.group(1)), pin.group(2)
    found = vl.find_section(text, path, level=level)
    if found is None:
        raise vw.WriteError(f"{rel} has no section {ns.heading!r}")
    if isinstance(found, list):
        raise vw.WriteError(f"{ns.heading!r} matches more than one heading "
                            f"in {rel}: " + "; ".join(found) + ". "
                            + sec.advice(found))
    start, _end = found
    doc = vw.parse(text)
    head = next((h for h in doc.heads if h.idx == start), None)
    if head is None:
        raise vw.WriteError(f"{rel}: cannot place text under {ns.heading!r}")
    body = [ln.rstrip("\r") for ln in b.body.replace("\r\n", "\n")
            .strip("\n").split("\n")]
    for ln in body:
        m = re.match(r"^(#{1,6})\s", ln)
        if m and len(m.group(1)) <= head.level:
            raise vw.WriteError(
                f"section {ns.heading!r} in {rel}: the text holds a heading "
                f"({ln.strip()!r}) at or above the section's own level, "
                f"which would end the section")
    end = vw.section_end(doc, head)
    # The section's own text: up to its first deeper heading, which stays.
    stop = next((h.idx for h in doc.heads
                 if head.idx < h.idx < end and h.level > head.level), end)
    if ns.replace:
        hidden = [s for s in doc.states if head.idx < s.lineno - 1 < stop
                  and s.marker in vw.OPENERS]
        if hidden:
            raise vw.WriteError(
                f"section {ns.heading!r} in {rel} holds a gm-only or spoiler "
                f"block: --replace would drop it; use --append, or edit "
                f"around the block")
        lines = list(doc.lines)
        if not lines[head.idx].endswith("\n"):
            lines[head.idx] += doc.eol
        cut = stop
        while cut > head.idx + 1 and not lines[cut - 1].strip():
            cut -= 1
        blank = head.idx + 1 < len(lines) and not lines[head.idx + 1].strip()
        new = [doc.eol] if blank else []
        new += [ln + doc.eol for ln in body]
        if cut == stop and stop < len(lines):
            new.append(doc.eol)
        lines[head.idx + 1:cut] = new
        new_text = "".join(lines)
        verb = "WOULD-REPLACE"
    else:
        at = end
        if not vl.fenced_headings("\n".join(body)):
            at = vw.out_of_hiding(doc, head, stop)
        at = vw._before_dataview(doc, head, at)
        new_text = vw.place(doc, at, body,
                            tight=bool(vw.LIST_RE.match(body[0])))
        verb = "WOULD-ADD"
    batch.put(rel, new_text)
    batch.row(verb, rel, f"§{ns.heading}", f"{len(body)} lines")


def run_writer(batch: vw.Batch, b: Block) -> None:
    if "--write" in b.args:
        raise vw.WriteError(f"{b.command}: --write goes on the batch, not a "
                            f"block")
    ns = _parse(vw.build_parser().parse_args,
                [str(batch.vault), b.command, *b.args], b.command)
    if b.command == "status" and getattr(ns, "show", False):
        raise vw.WriteError("status --show only reads: run it on its own")
    if b.command == "scene-played" and bool(ns.dropped) == bool(ns.session):
        raise vw.WriteError("scene-played: --session or --dropped, one of "
                            "them")
    if b.command in vw.NO_STDIN and b.body.strip():
        raise vw.WriteError(f"{b.command} takes no body")
    vw.COMMANDS[b.command](batch, ns, b.body)


def run_block(batch: vw.Batch, b: Block) -> None:
    if b.command == "stamp":
        run_stamp(batch, b)
    elif b.command == "note-new":
        run_note_new(batch, b)
    elif b.command == "section":
        run_section(batch, b)
    elif b.command in vw.COMMANDS and b.command not in NOT_HERE:
        run_writer(batch, b)
    else:
        known = sorted(set(vw.COMMANDS) - NOT_HERE) + list(EXTRA)
        raise vw.WriteError(f"unknown command {b.command!r}; one of: "
                            + ", ".join(known))


def _snapshot(batch: vw.Batch) -> tuple:
    return (dict(batch.texts), dict(batch.originals), len(batch.rows),
            None if batch._listing is None else dict(batch._listing),
            len(batch.after_write), len(batch.after),
            copy.copy(batch.tally), copy.deepcopy(batch.scope))


def _restore(batch: vw.Batch, snap: tuple) -> None:
    texts, originals, rows, listing, aw, af, tally, scope = snap
    batch.texts, batch.originals = texts, originals
    del batch.rows[rows:]
    batch._listing = listing
    del batch.after_write[aw:]
    del batch.after[af:]
    batch.tally, batch.scope = tally, scope


def checks(vault: Path, written: list[str]) -> list[str]:
    """The Validate checks, on exactly the notes written: their rows."""
    script = Path(__file__).with_name("vault_check.py")
    notes = [r for r in written if r.endswith(".md")]
    if not notes:
        return []
    runs: list[list[str]] = []
    folders = sorted({Path(r).parent.as_posix() for r in notes})
    for folder in folders:
        # A note at the vault's top: the whole vault (rows are filtered).
        runs.append(["frontmatter"] if folder == "." else
                    ["frontmatter", "--folder", folder])
    runs.append(["relationships", *[a for r in notes for a in ("--file", r)]])
    pcs = [r for r in notes if r.startswith("Characters/PCs/")
           and not r.endswith("_Story.md")]
    if pcs:
        runs.append(["pc-body", *[a for r in pcs for a in ("--file", r)]])
    for r in notes:
        fm = vl.extract_frontmatter((vault / r).read_text(encoding="utf-8"))
        if (fm or {}).get("type") in vl.WRAP_UP_TYPES:
            runs.append(["wrapup", "--file", r])
    out: list[str] = []
    for argv in runs:
        p = subprocess.run([sys.executable, str(script), str(vault), *argv],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace",
                           env={**os.environ, "PYTHONUTF8": "1",
                                "PYTHONIOENCODING": "utf-8"})
        mine = set(notes)
        keep = [ln for ln in p.stdout.splitlines()
                if ln.startswith(("ERROR", "WARNING", "ASK"))
                and ln.split("\t")[1:2] and ln.split("\t")[1] in mine]
        what = " ".join(argv[:1] + argv[2:3]) if argv[0] == "frontmatter" \
            else argv[0]
        out.append(f"# check {what}: {len(keep)} rows (exit {p.returncode})")
        out.extend(keep)
        if p.stderr.strip() and (p.returncode not in (0, 1)
                                 or "Traceback" in p.stderr):
            out.append(f"WARNING\t\t\tcheck {what} failed: "
                       f"{p.stderr.strip().splitlines()[-1]}")
    return out


def run(args: argparse.Namespace) -> int:
    vault: Path = args.vault
    try:
        text = (vw.read_stdin() if args.file == "-" else
                Path(args.file).read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, vw.WriteError) as e:
        print(f"ERROR\t{args.file}: cannot read as UTF-8 text "
              f"({e.__class__.__name__})")
        return 1
    try:
        blocks = parse_blocks(text)
        skip = numbers(args.skip, len(blocks), "--skip")
        only = numbers(args.only, len(blocks), "--only")
    except vw.WriteError as e:
        print(f"ERROR\t{e}\n# nothing written")
        return 1
    if skip and only:
        print("ERROR\t--skip and --only do not go together\n# nothing written")
        return 1
    chosen = [b for b in blocks if (b.n in only if only else b.n not in skip)]
    left_out = [b.n for b in blocks if b not in chosen]
    batch = vw.Batch(vault)
    for b in chosen:
        snap = _snapshot(batch)
        try:
            try:
                run_block(batch, b)
            except vw.WriteError:
                raise
            except Exception as e:      # a refusal, never a traceback
                raise vw.WriteError(f"{e.__class__.__name__}: {e}") from e
            b.rows = batch.rows[snap[2]:]
        except vw.WriteError as e:
            _restore(batch, snap)
            b.error = str(e)
            earlier = [n for n in left_out if n < b.n]
            if earlier:
                b.error += (f" (blocks {', '.join(map(str, earlier))} are left "
                            f"out: does this block need one of them?)")
    refused = [b for b in chosen if b.error]
    if not refused:
        try:
            vw.check_fences(batch, "".join(b.body for b in chosen))
        except vw.WriteError as e:
            print(f"ERROR\t{e}\n# nothing written")
            return 1
    wrote = False
    if args.write and not refused:
        try:
            written = vw.apply(batch)
        except vw.RestoreFailed as e:
            print(f"ERROR\t{e}")
            print("# files were left changed: restore them from the list above")
            return 1
        except vw.WriteError as e:
            print(f"ERROR\t{e}\n# nothing written")
            return 1
        wrote = True
        for ask in batch.after_write:
            try:
                ask()
            except Exception as e:      # the files are written
                batch.row("WARNING", "", "", f"a check after writing failed "
                          f"({e.__class__.__name__}: {e})")
    out: list[str] = []
    for b in blocks:
        if b in chosen:
            out.append(b.label)
            if b.error:
                out.append(f"ERROR\t\t\t{b.error}")
            for r in b.rows:
                verb, _, rest = r.partition("\t")
                out.append(f"{PAST.get(verb, verb) if wrote else verb}\t{rest}")
        else:
            out.append(f"{b.label}\t(left out)")
    rows = [r for b in chosen for r in b.rows]
    tail = batch.rows[sum(len(b.rows) for b in chosen):]
    out.extend(tail)

    def count(*verbs: str) -> int:
        return sum(r.split("\t", 1)[0] in verbs for r in rows + tail)
    out.append(f"# blocks: {len(chosen)}  left out: {len(left_out)}  "
               f"refused: {len(refused)}  create: {count('WOULD-CREATE')}  "
               f"add: {count('WOULD-ADD')}  replace: {count('WOULD-REPLACE')}  "
               f"stamp: {count('WOULD-STAMP')}  "
               + "".join(f"{name}: {n}  " for name, n in (
                   ("moved", count("WOULD-MOVE")),
                   ("closed", batch.tally["closed"]),
                   ("rested", batch.tally["rested"]),
                   ("woken", batch.tally["woken"]),
                   ("handed", batch.tally["handed"])) if n)
               + f"warnings: {count('WARNING')}")
    if refused:
        out.append(f"# nothing written: fix block"
                   f"{'s' if len(refused) > 1 else ''} "
                   + ", ".join(str(b.n) for b in refused)
                   + " in the file and run it again")
    elif wrote:
        out.append(f"# written: {len(written)} files")
        try:
            out.extend(checks(vault, written))
        except Exception as e:          # the files are written
            out.append(f"WARNING\t\t\tthe checks after writing failed "
                       f"({e.__class__.__name__}: {e}); run gma vault-check")
    else:
        out.append("# plan only: nothing written (add --write)")
    sys.stdout.write("\n".join(out) + "\n")
    if batch.after:
        print("\n".join(batch.after))
    return 1 if refused else 0

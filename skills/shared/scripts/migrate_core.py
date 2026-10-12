#!/usr/bin/env python3
"""migrate_core.py: what every migration check is made of.

A `Check` looks at a vault and returns `Item`s. An item is something the
one yes covers (WILL), something the GM picks by id (CHOICE), or something
a script cannot settle (PERSON). There is no state file: an item is
pending when its check finds it.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from vaultlib import PUBLISH_TOOL, frontmatter_span

WILL, CHOICE, PERSON = "will", "choice", "person"
TOOL_TIMEOUT = 600  # update-pin runs npm install


class StepFailed(Exception):
    """A step could not be done. The run stops; the message is one line."""


@dataclass
class Item:
    id: str
    group: str
    lines: list[str]        # PERSON: finished rows; else one line per change
    apply: Callable[[str | None], list[str]] | None = None
    wants: str | None = None  # a CHOICE that needs `--choose id=value`
    # A wants-CHOICE whose answers include "leave it": until it is answered
    # `apply` does not stamp, or its release gate would hide it for good.
    holds_stamp: bool = False


@dataclass(frozen=True)
class Check:
    name: str
    release: str | None     # None: looked at on every pass
    band: int               # 1 repin, 2 config, 3 files, 4 asks the site's tool
    title: str              # shown when the check waits for the repin
    find: Callable[[Path], list[Item]]
    asks_site: bool = False
    # ids it can offer; "x:" is a prefix; a trailing "=" ("mode=",
    # "sheet-source:=") marks a choice that needs `--choose id=value`
    choices: tuple[str, ...] = ()


def write_text_atomic(path: Path, text: str) -> None:
    """Write `text` to `path` exactly (no newline translation), so a failure
    partway leaves the file as it was. Writes beside it and swaps it in;
    resolves first so a symlinked file keeps its link. New files get the
    mode a plain write would."""
    real = path.resolve()
    tmp = None
    try:
        try:
            mode = real.stat().st_mode & 0o7777
        except FileNotFoundError:
            umask = os.umask(0)
            os.umask(umask)
            mode = 0o666 & ~umask
        real.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=real.parent, prefix=f".{real.name}.")
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, real)
        tmp = None
    except OSError as e:
        raise StepFailed(f"{path.name} cannot be written "
                         f"({e.__class__.__name__})") from e
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def write_all_or_none(vault: Path, originals: dict[str, str],
                      texts: dict[str, str], *,
                      read: Callable[[Path, str], str | None],
                      what: str = "the fix",
                      holds: str = "the new text",
                      write: Callable[[Path, str], None] | None = None
                      ) -> None:
    """Write every note of `texts`, or leave the vault exactly as it was.
    `originals` is each note's text when the change was planned: a note
    that differs now stops the run. `read` is the caller's own reader, so
    the comparison is made the way the plan was; `write` is the caller's
    own writer (default `write_text_atomic`)."""
    write = write or write_text_atomic
    written: list[str] = []
    try:
        for rel in sorted(texts):
            if read(vault, rel) != originals[rel]:
                raise StepFailed(f"{rel} changed while {what} was being "
                                 f"made; run it again")
            written.append(rel)  # before the write: an interrupt mid-write
            write(vault / rel, texts[rel])
    except BaseException as e:
        stuck, edited = [], []
        for rel in written:
            try:
                now = read(vault, rel)
                if now == originals[rel]:
                    continue  # never changed: nothing to put back
                if now != texts[rel]:
                    edited.append(rel)  # not this run's text: not ours to undo
                    continue
                write(vault / rel, originals[rel])
            except BaseException:
                stuck.append(rel)
        said = str(e) or type(e).__name__
        if stuck:
            said += (f"; these notes could not be put back and still have "
                     f"{holds}: {', '.join(stuck)}")
        if edited:
            said += (f"; these notes were changed by something else while "
                     f"{what} ran and were left as they are: "
                     f"{', '.join(edited)}")
        if not stuck and not edited:
            said += "; the vault is as it was"
        if isinstance(e, KeyboardInterrupt):
            raise KeyboardInterrupt(said) from None
        raise StepFailed(said) from e


def _read_note(path: Path) -> tuple[list[str], int, str]:
    """(the note's lines with endings, where its frontmatter closes, its
    byte-order mark or ""). Raises StepFailed when the file cannot be read
    or its frontmatter cannot be edited line by line."""
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        raise StepFailed(f"{path.name} cannot be read "
                         f"({e.__class__.__name__})") from e
    bom = "\ufeff" if text.startswith("\ufeff") else ""
    lines = text[len(bom):].splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        raise StepFailed(f"{path.name}: {error}")
    return lines, end, bom


def check_editable(path: Path) -> None:
    """Raise StepFailed unless `edit_frontmatter` could edit this note."""
    _read_note(path)


def edit_frontmatter(path: Path,
                     change: Callable[[list[str], str], object]) -> None:
    """Run `change(frontmatter lines, eol)` on a note and write it back.
    Only the frontmatter lines change; line endings are kept."""
    lines, end, bom = _read_note(path)
    fm = lines[1:end]
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    try:
        change(fm, eol)
    except ValueError as e:
        raise StepFailed(f"{path.name}: {e}") from e
    new_text = "".join([bom, lines[0], *fm, *lines[end:]])
    write_text_atomic(path, new_text)


def plugin_tool(args: list[str]) -> tuple[int, str, str]:
    """Run the plugin's own publish tool: (exit code, stdout, stderr)."""
    node = shutil.which("node")
    if not node:
        raise StepFailed("node is not on PATH; install Node.js, then run "
                         "migrate.py again")
    if not PUBLISH_TOOL.is_file():
        raise StepFailed(f"the publish tool is not at {PUBLISH_TOOL}")
    try:
        proc = subprocess.run(
            [node, str(PUBLISH_TOOL), *args], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=TOOL_TIMEOUT,
            check=False)
    except subprocess.TimeoutExpired as e:
        raise StepFailed(f"{args[0]} timed out after {TOOL_TIMEOUT}s") from e
    except OSError as e:
        raise StepFailed(f"node could not run "
                         f"({e.__class__.__name__})") from e
    return proc.returncode, proc.stdout, proc.stderr


def cells(row: str) -> tuple[str, str, str]:
    level, _, rest = row.partition("\t")
    where, _, message = rest.partition("\t")
    return level, where, message


def stopped(rows: list[tuple[str, str, str]]) -> None:
    """A check that could not ask the tool says so in an ERROR on the
    vault; what it found before that is not the whole answer."""
    for level, where, message in rows:
        if level == "ERROR" and where == "(vault)":
            raise StepFailed(message)

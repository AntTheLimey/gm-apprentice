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


def edit_frontmatter(path: Path,
                     change: Callable[[list[str], str], object]) -> None:
    """Run `change(frontmatter lines, eol)` on a note and write it back.
    Only the frontmatter lines change; line endings are kept."""
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        raise StepFailed(f"{path.name} cannot be read "
                         f"({e.__class__.__name__})") from e
    lines = text.splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        raise StepFailed(f"{path.name}: {error}")
    fm = lines[1:end]
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    try:
        change(fm, eol)
    except ValueError as e:
        raise StepFailed(f"{path.name}: {e}") from e
    new_text = "".join([lines[0], *fm, *lines[end:]])
    # Write beside the note and swap it in, so a failure partway leaves the
    # note as it was. Resolve first so a symlinked note keeps its link.
    real = path.resolve()
    tmp = None
    try:
        mode = real.stat().st_mode & 0o7777
        fd, tmp = tempfile.mkstemp(dir=real.parent, prefix=f".{real.name}.")
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(new_text)
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

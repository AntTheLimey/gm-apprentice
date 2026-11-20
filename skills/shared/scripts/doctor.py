#!/usr/bin/env python3
"""gma doctor: is this machine ready for gm-apprentice?

    gma doctor

Checks Python, these skills' version, Node and the publish tool, one line
each, with what to do about anything missing, then counts the GM's
personal reference files and any still left in the plugin's own folders. Nothing is installed or
changed. Exit 0 when the skills can run (a missing Node only warns: a vault
with no site needs none), 1 when something must be fixed first.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, NamedTuple

import install_layout
import personal_home
import tool_cache
from install_layout import Layout, terminal_command

PYTHON_FLOOR = (3, 10)
NODE_URL = "https://nodejs.org"


class Check(NamedTuple):
    level: str  # "ok", "warn" or "fail"
    what: str
    fix: str = ""


def _skills_version(layout: Layout) -> str | None:
    try:
        text = (layout.shared / "VERSION").read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return text or None


def _install_kind(layout: Layout) -> str:
    root = layout.root
    if root is None:
        return "installed with npx skills"
    # An installed plugin sits in its agent's plugins/cache: under ~/.codex or ~/.claude, or where CODEX_HOME and
    # CLAUDE_CONFIG_DIR point. It is asked first: Codex copies a plugin's .git along with it.
    where = root.resolve().as_posix().lower() + "/"
    if "/plugins/cache/" in where:
        for name, env, folder in (("Codex", "CODEX_HOME", "/.codex/"), ("Claude Code", "CLAUDE_CONFIG_DIR", "/.claude/")):
            home = os.environ.get(env)
            if folder in where or (home and where.startswith(Path(home).resolve().as_posix().lower() + "/")):
                return f"the {name} plugin"
        return "a plugin"
    if (root / ".git").exists():
        return f"a checkout of the repository at {root.as_posix()}"
    return "a plugin"


def _tool_version(tool: Path) -> str | None:
    """The version in the package.json of a tool beside the skills."""
    try:
        data = json.loads((tool.parent.parent / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    version = data.get("version") if isinstance(data, dict) else None
    return version if isinstance(version, str) else None


def _node_version(node: str) -> str | None:
    try:
        said = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None
    return said.lstrip("v") or None


def checks(layout: Layout, *, python: tuple[int, ...] = tuple(sys.version_info[:3]),
           which: Callable[[str], str | None] = shutil.which,
           node_too_old: Callable[[str], str | None] = tool_cache.node_too_old,
           node_version: Callable[[str], str | None] = _node_version,
           user_home: Path | None = None) -> list[Check]:
    found: list[Check] = []
    shown = ".".join(str(n) for n in python)
    if tuple(python[:2]) >= PYTHON_FLOOR:
        found.append(Check("ok", f"Python {shown}"))
    else:
        found.append(Check("fail", f"Python {shown} is too old",
                           "install Python 3.10 or newer from https://www.python.org"))

    version = _skills_version(layout)
    if version is None:
        found.append(Check("fail", "the skills' version is unknown: shared/VERSION is missing or empty",
                           "this install is incomplete: install gm-apprentice again"))
    else:
        found.append(Check("ok", f"gm-apprentice {version}, {_install_kind(layout)}"))

    node = which("node")
    if node is None:
        found.append(Check("warn", "Node is not installed",
                           f"needed only for a campaign site: install Node {tool_cache.NODE_FLOOR} "
                           f"or newer from {NODE_URL}"))
    else:
        said = node_version(node)
        old = node_too_old(node) if said is not None else None
        if said is None:
            found.append(Check("warn", "Node is installed, but `node --version` did not answer",
                               f"the campaign site needs Node {tool_cache.NODE_FLOOR} or newer: reinstall it "
                               f"from {NODE_URL}"))
        elif old is not None:
            found.append(Check("warn", f"Node {old} is too old for the campaign site",
                               f"upgrade to Node {tool_cache.NODE_FLOOR} or newer from {NODE_URL}"))
        else:
            found.append(Check("ok", f"Node {said}"))

    wanted = install_layout.publish_version(layout.shared)
    tool = layout.publish_tool
    if wanted is None:
        found.append(Check("fail", f"the publish tool's version is unknown: shared/{install_layout.PUBLISH_STAMP} "
                                   "is missing or empty",
                           "this install is incomplete: install gm-apprentice again"))
    elif tool is not None and tool.is_file():
        have = _tool_version(tool) if layout.door_owns_tool else wanted
        if have is None:
            found.append(Check("fail", f"the publish tool at {tool.as_posix()} has no readable version",
                               "this install is incomplete: install gm-apprentice again"))
        elif have != wanted:
            found.append(Check("fail", f"the publish tool is {have}, but these skills go with {wanted}",
                               "this install is mixed: install gm-apprentice again"))
        else:
            found.append(Check("ok", f"the publish tool {have}, at {tool.as_posix()}"))
    elif node is None:
        found.append(Check("warn", "the publish tool is not installed",
                           "it downloads once Node is installed, on the first command that needs it"))
    else:
        found.append(Check("warn", f"the publish tool {wanted} is not downloaded yet",
                           f"it downloads on the first command that needs it; to fetch it now, run "
                           f"`{terminal_command('tool', 'install')}`"))
    found.extend(_personal(layout, user_home))
    return found


def _personal(layout: Layout, user_home: Path | None) -> list[Check]:
    """The GM's personal reference files: how many, and any still in the plugin's own folders
    (counted, never copied: doctor changes nothing). No line when there are none."""
    out: list[Check] = []
    files = personal_home.listing(user_home=user_home)
    count = sum(len(f) for f in files.values())
    where = personal_home.shown(personal_home.home(user_home), user_home)
    if count:
        out.append(Check("ok", f"personal reference files: {count} in {where} ({', '.join(files)})"))
    try:
        left = personal_home.adopt(layout.shared, user_home=user_home, dry_run=True).total
    except OSError:
        left = 0
    if left:
        out.append(Check("warn", f"{left} personal reference file{'s are' if left != 1 else ' is'} still "
                                 "in the plugin's own folders, which an update replaces",
                         f"`{terminal_command('personal')}` copies them to {where}"))
    return out


def report(found: list[Check]) -> tuple[str, int]:
    width = max(len(c.level) for c in found)
    lines = []
    for c in found:
        lines.append(f"{c.level.ljust(width)}  {c.what}" + (f": {c.fix}" if c.fix else ""))
    fails = sum(c.level == "fail" for c in found)
    warns = sum(c.level == "warn" for c in found)
    if fails:
        lines.append(f"Not ready: {fails} to fix first.")
    elif warns:
        lines.append(f"Ready, with {warns} warning{'s' if warns > 1 else ''}.")
    else:
        lines.append("Ready.")
    return "\n".join(lines) + "\n", 1 if fails else 0


def build_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        description="Check this machine is ready for gm-apprentice: Python, the skills' version, "
                    "Node and the publish tool. Changes nothing.",
        epilog="Example: gma doctor")


def main(argv: list[str] | None = None) -> int:
    build_parser().parse_args(argv)
    text, code = report(checks(install_layout.LAYOUT))
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    sys.exit(main())

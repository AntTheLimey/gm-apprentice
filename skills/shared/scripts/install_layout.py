"""Where this install keeps shared/ and the publish tool.

The one place that finds the install root and the publish tool. Everything
else asks `LAYOUT`.
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

MISSING_TOOL = ("the publish tool is not installed with these skills; it "
                "ships with the Claude Code plugin, and other installs get "
                "it in a later release")

_TOOL = Path("tools") / "publish" / "bin" / "gm-publish.js"


class Layout(NamedTuple):
    shared: Path               # the shared/ folder these scripts sit in
    root: Path | None          # plugin or repo root, when shared/ is <root>/skills/shared
    publish_tool: Path | None  # <root>/tools/publish/bin/gm-publish.js when that file exists


def find_layout(scripts_dir: Path | None = None) -> Layout:
    here = Path(__file__).resolve().parent if scripts_dir is None else scripts_dir
    shared = here.parent
    root: Path | None = None
    if shared.parent.name == "skills":
        candidate = shared.parent.parent
        if ((candidate / ".claude-plugin" / "plugin.json").is_file()
                or (candidate / _TOOL).is_file()):
            root = candidate
    tool = root / _TOOL if root is not None else None
    if tool is not None and not tool.is_file():
        tool = None
    return Layout(shared, root, tool)


LAYOUT = find_layout()

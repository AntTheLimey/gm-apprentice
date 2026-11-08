"""Where this install keeps shared/ and the publish tool.

The one place that finds the install root and the publish tool. Everything
else asks `LAYOUT`.
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

INSTALL_STOP = ("This install is incomplete: stop here, tell the GM what is "
                "missing, and do not work around it.")
MISSING_TOOL = ("the publish tool is not installed with these skills; it "
                "ships with the Claude Code plugin, and other installs get "
                "it in a later release. " + INSTALL_STOP)
VERSION_UNKNOWN = ("cannot determine the plugin version: this install has "
                   "no shared/VERSION. " + INSTALL_STOP)

_TOOL = Path("tools") / "publish" / "bin" / "gm-publish.js"
# Manifests an install can carry beside skills/: the Claude Code plugin's,
# and the one OpenAI's plugin import converts it to.
MANIFESTS = (Path(".claude-plugin") / "plugin.json",
             Path(".codex-plugin") / "plugin.json")


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
        if (any((candidate / m).is_file() for m in MANIFESTS)
                or (candidate / _TOOL).is_file()):
            root = candidate
    tool = root / _TOOL if root is not None else None
    if tool is not None and not tool.is_file():
        tool = None
    return Layout(shared, root, tool)


LAYOUT = find_layout()

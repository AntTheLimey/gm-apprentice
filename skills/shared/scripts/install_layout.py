"""Where this install keeps shared/ and the publish tool.

The one place that finds the install root and the publish tool. Everything
else asks `LAYOUT`.
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

INSTALL_STOP = ("Assistants: stop here, tell the GM what is missing, and do "
                "not work around it.")
MISSING_TOOL = ("the publish tool is not installed with these skills; it "
                "ships with the Claude Code plugin, and other installs get "
                "it in a later release. " + INSTALL_STOP)
VERSION_UNKNOWN = ("cannot determine the version of these skills: "
                   "shared/VERSION is missing, empty or unreadable. This "
                   "install is incomplete. " + INSTALL_STOP)

# The publish tool release these skills go with; a copy without the tool
# beside it fetches that release (tool_cache).
PUBLISH_STAMP = "PUBLISH_VERSION"
_TOOL = Path("tools") / "publish" / "bin" / "gm-publish.js"
# Manifests an install can carry beside skills/: the Claude Code plugin's,
# and the one OpenAI's plugin import converts it to.
MANIFESTS = (Path(".claude-plugin") / "plugin.json",
             Path(".codex-plugin") / "plugin.json")


def publish_version(shared: Path) -> str | None:
    """The tool version stamped in `shared`, or None when the stamp is
    missing, empty or unreadable."""
    try:
        text = (shared / PUBLISH_STAMP).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text or None


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

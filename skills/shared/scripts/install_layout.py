"""Where this install keeps shared/ and the publish tool.

The one place that finds the install root and the publish tool. Everything
else asks `LAYOUT`.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import NamedTuple

from tool_cache import cached_tool

def terminal_command(*words: str) -> str:
    """A command line a GM can paste into a terminal: this plugin's `gma.py`
    by its full path. `gma` alone is the skills' shorthand, not a command a
    terminal has (oh-my-zsh aliases it to `git merge --abort`)."""
    script = Path(__file__).resolve().with_name("gma.py")
    return " ".join([f'python3 "{script}"', *words])


INSTALL_STOP = ("Assistants: stop here, tell the GM what is missing, and do "
                "not work around it.")
MISSING_TOOL = ("the publish tool is not installed. The Claude Code and "
                "Codex plugins carry it; other installs download it once (it needs Node "
                "22.21 or newer): run `" + terminal_command("tool", "install")
                + "` with network access. " + INSTALL_STOP)
VERSION_UNKNOWN = ("cannot determine the version of these skills: "
                   "shared/VERSION is missing, empty or unreadable. This "
                   "install is incomplete. " + INSTALL_STOP)

# A site pinned to a release tarball that `update-pin --tag` vendored.
TARBALL_PIN = re.compile(r"^file:vendor/gm-apprentice-publish-\d+\.\d+\.\d+\.tgz$")

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
    except (OSError, UnicodeDecodeError):
        return None
    return text or None


class Layout(NamedTuple):
    shared: Path               # the shared/ folder these scripts sit in
    root: Path | None          # plugin or repo root, when shared/ is <root>/skills/shared
    publish_tool: Path | None  # beside the skills, else the fetched one in the cache
    door_owns_tool: bool = False  # the tool sits beside the skills (plugin, repo)


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
    if tool is not None and tool.is_file():
        return Layout(shared, root, tool, True)
    version = publish_version(shared)
    if version is None:
        return Layout(shared, root, None)
    return Layout(shared, root, cached_tool(version))


# Off the plugin (Claude Code's or Codex's), the skills came from `npx skills`.
NPX_UPDATE = ("update the gm-apprentice skills the way they were installed: "
              "`npx skills update -g` (without `-g` for an install in one "
              "project; one pinned to a release: run `npx skills add` again "
              "with the new tag)")


def update_step(plugin_words: str, layout: Layout | None = None) -> str:
    """How the GM updates these skills: `plugin_words` on a plugin install,
    unchanged, so a plugin GM reads what they always have."""
    here = LAYOUT if layout is None else layout
    on_plugin = here.root is not None and any(
        (here.root / m).is_file() for m in MANIFESTS)
    return plugin_words if on_plugin else NPX_UPDATE


LAYOUT = find_layout()

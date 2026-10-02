"""A site for a test vault.

`publish.site` says whether a vault has a site, and with it off the leak
checks have nothing to check. A test of those checks therefore needs a
vault whose site is on: a site folder with a vault.config.json and the
repo's own publish tool installed in it (a symlink), named by `site_dir`.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Callable

TOOL_DIR = Path(__file__).resolve().parents[1] / "tools" / "publish"
BARE = "---\npublish:\n---\n"


_SITE: Path | None = None


def new_site(vault: Path, cleanup: Callable[[Path], object]) -> Path:
    """The site folder test vaults share, with the repo's publish tool
    installed. One folder for the whole run: the checks keep one node
    process per installed tool, so a folder per vault would start a new
    process for every test. The tool is always told which vault to read
    (`--vault`), so the folder's own `vaultPath` is never used."""
    global _SITE
    if _SITE is None:
        _SITE = Path(tempfile.mkdtemp(prefix="vc-site-"))
        atexit.register(shutil.rmtree, _SITE, ignore_errors=True)
        (_SITE / "vault.config.json").write_text(
            json.dumps({"vaultPath": "."}), encoding="utf-8")
        (_SITE / "node_modules").mkdir()
        os.symlink(TOOL_DIR, _SITE / "node_modules" / "gm-apprentice-publish",
                   target_is_directory=True)
    return _SITE


def with_site(config: str | None, vault: Path,
              cleanup: Callable[[Path], object]) -> str | None:
    """`config` with `publish.site: true` and a `site_dir`, when it has a
    `publish:` block at the margin that sets neither, or no `publish:` at
    all (None, no file, becomes a file with only that). Any other text
    comes back as it was: it says for itself whether the vault has a
    site."""
    if config is None:
        config = BARE
    if re.search(r"^\s*site(_dir)?\s*:", config, re.M):
        return config
    lines = config.split("\n")
    at = next((i for i, line in enumerate(lines)
               if line.rstrip() == "publish:"), None)
    if at is None:
        if "publish" in config or lines[0].rstrip() != "---":
            return config
        close = next((i for i, line in enumerate(lines[1:], 1)
                      if line.rstrip() == "---"), None)
        if close is None:
            return config
        lines.insert(close, "publish:")
        at = close
    child = next((line for line in lines[at + 1:] if line.strip()), "")
    pad = child[:len(child) - len(child.lstrip())] or "  "
    site = new_site(vault, cleanup)
    lines[at + 1:at + 1] = [f"{pad}site: true",
                            f"{pad}site_dir: {site.as_posix()}"]
    return "\n".join(lines)


def _remove(path: Path) -> None:
    atexit.register(shutil.rmtree, path, ignore_errors=True)


def site_copy(fixture: Path) -> Path:
    """A copy of a fixture vault with its site on, kept for the whole run.
    The fixture itself stays as it is in the repo."""
    root = Path(tempfile.mkdtemp(prefix="vc-fixture-"))
    _remove(root)
    vault = root / "vault"
    shutil.copytree(fixture, vault)
    give_site(vault, _remove)
    return vault


def give_site(vault: Path, cleanup: Callable[[Path], object]) -> None:
    """Turn the site on in a vault already on disk."""
    file = vault / "_meta" / "vault-config.md"
    config = file.read_text(encoding="utf-8") if file.is_file() else None
    text = with_site(config, vault, cleanup)
    if text is not None and text != config:
        file.parent.mkdir(exist_ok=True)
        file.write_text(text, encoding="utf-8")

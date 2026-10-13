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
_CONFIG = {"vaultPath": ".",
           "folderMap": {"Characters/NPCs": "characters/npcs",
                         "Characters/PCs": "characters/pcs",
                         "Chapters": "chronicle"}}


def _link_and_config(site: Path) -> None:
    """The publish tool linked into `site` and its vault.config.json."""
    link = site / "node_modules" / "gm-apprentice-publish"
    if not link.is_symlink() or not link.exists():
        if link.is_symlink():
            link.unlink()
        (site / "node_modules").mkdir(exist_ok=True)
        os.symlink(TOOL_DIR, link, target_is_directory=True)
    (site / "vault.config.json").write_text(json.dumps(_CONFIG),
                                            encoding="utf-8")


def private_site() -> Path:
    """A site folder of its own, for a test that changes its site (a
    migration moves settings out of vault.config.json, a repin replaces the
    tool). The shared folder must never be changed: other tests, some of
    them built at import time, rely on it as it was made."""
    site = Path(tempfile.mkdtemp(prefix="vc-site-"))
    atexit.register(shutil.rmtree, site, ignore_errors=True)
    _link_and_config(site)
    return site


def shared_site() -> Path | None:
    """The folder test vaults share, or None before any vault asked."""
    return _SITE


def shared_site_problem() -> str | None:
    """What is wrong with the shared folder (it lost its publish tool, its
    folderMap, or went missing), or None when it is as `new_site` made it."""
    if _SITE is None:
        return None
    tool = _SITE / "node_modules" / "gm-apprentice-publish" / "bin" / "gm-publish.js"
    if not tool.is_file():
        return f"the publish tool is gone from {_SITE}"
    try:
        config = json.loads((_SITE / "vault.config.json").read_text(
            encoding="utf-8"))
    except (OSError, ValueError) as e:
        return f"vault.config.json in {_SITE} cannot be read ({e})"
    if config != _CONFIG:
        return f"vault.config.json in {_SITE} no longer holds its folderMap"
    return None


def restore_shared_site() -> None:
    """Put the shared folder back as `new_site` made it."""
    if _SITE is not None:
        _SITE.mkdir(exist_ok=True)
        _link_and_config(_SITE)


def new_site(vault: Path, cleanup: Callable[[Path], object],
             private: bool = False) -> Path:
    """The site folder test vaults share, with the repo's publish tool
    installed. One folder for the whole run: the checks keep one node
    process per installed tool, so a folder per vault would start a new
    process for every test. The tool is always told which vault to read
    (`--vault`), so the folder's own `vaultPath` is never used. A test that
    changes its site asks for `private=True`; the folder is restored on
    every call all the same, and the suite's conftest fails the test that
    leaves it changed."""
    global _SITE
    if private:
        return private_site()
    if _SITE is None:
        _SITE = Path(tempfile.mkdtemp(prefix="vc-site-"))
        atexit.register(shutil.rmtree, _SITE, ignore_errors=True)
    # The folderMap is for the folders test notes live in, so the tool
    # publishes them.
    restore_shared_site()
    return _SITE


def with_site(config: str | None, vault: Path,
              cleanup: Callable[[Path], object],
              private: bool = False) -> str | None:
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
    site = new_site(vault, cleanup, private)
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


def give_site(vault: Path, cleanup: Callable[[Path], object],
              private: bool = False) -> None:
    """Turn the site on in a vault already on disk. `private=True` for a
    test that changes the site (see `private_site`)."""
    file = vault / "_meta" / "vault-config.md"
    config = file.read_text(encoding="utf-8") if file.is_file() else None
    text = with_site(config, vault, cleanup, private)
    if text is not None and text != config:
        file.parent.mkdir(exist_ok=True)
        file.write_text(text, encoding="utf-8")


def site_of(vault: Path) -> Path:
    """The site folder a test vault's settings name (`player_site.folder`)."""
    text = (vault / "_meta" / "vault-config.md").read_text(encoding="utf-8")
    found = re.search(r"^\s*site_dir:\s*(.+)$", text, re.M)
    assert found, "the vault names no site folder"
    return Path(found.group(1).strip().strip("\"'"))


def point_site_at(vault: Path, site: Path | None = None, **keys: object) -> Path:
    """Make the site's vault.config.json name `vault` (the update's move
    refuses a site file that does not say which vault it belongs to), with
    any `keys` added to it. Returns the site folder."""
    site = site or site_of(vault)
    file = site / "vault.config.json"
    config = json.loads(file.read_text(encoding="utf-8"))
    config["vaultPath"] = str(vault)
    config.update(keys)
    file.write_text(json.dumps(config), encoding="utf-8")
    return site


def pin_site(site: Path, spec: str | None = None) -> None:
    """Write the site's package.json: pinned to the repo's own publish tool
    (a plugin path, so the tool is the plugin's own), or to `spec`."""
    pin = spec if spec is not None else f"file:{TOOL_DIR.as_posix()}"
    (site / "package.json").write_text(json.dumps(
        {"name": "site", "dependencies": {"gm-apprentice-publish": pin}}),
        encoding="utf-8")

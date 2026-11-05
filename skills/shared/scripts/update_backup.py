#!/usr/bin/env python3
"""A copy of the vault's notes, taken before `gma update` writes anything.

The archive holds every file the update can write: each .md, .yaml and
.json note, and the props move's pages, styles and scripts, in the vault
(the update never edits pictures); and the site folder's package.json,
package-lock.json, vault.config.json and scripts/ (the repin, the settings
move and the retired build steps write those), under
`.gm-apprentice-site/`. It lives under
the home folder, outside the vault, so it never syncs or publishes. It is
written as `<name>.tar.gz.partial` and renamed when whole, so an
interrupted backup never passes for one.
"""

from __future__ import annotations

import errno
import hashlib
import os
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path

NOTE_SUFFIXES = {".md", ".yaml", ".json",
                 ".html", ".htm", ".css", ".js", ".mjs", ".svg"}
SITE_FILES = ("package.json", "package-lock.json", "vault.config.json")
SITE_DIRS = ("scripts",)
# Where the site's files sit in the archive: a folder the walk skips, so
# no vault path can share it.
SITE_ARC = ".gm-apprentice-site"
SKIP_DIRS = {".obsidian", ".git", ".trash", ".gm-apprentice",
             ".gm-apprentice-site"}


class BackupFailed(Exception):
    """The backup could not be made; the message names the file at fault."""


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _site_folder(vault: Path) -> Path | None:
    """The site folder, wherever it is, else None. Settings that cannot be
    read mean no site: the backup must not fail on them."""
    import vaultlib  # a failed import is a broken install: let it raise
    try:
        folder = vaultlib.settings(vault).get("player_site.folder")
        if not folder or not isinstance(folder, str):
            return None
        return (vault.resolve() / folder).resolve()  # an absolute one stays itself
    except Exception:  # noqa: BLE001 - any settings fault: back up anyway
        return None


def _site_files(site: Path | None) -> list[Path]:
    """The site files the update can write; none of node_modules or the
    built pages."""
    if site is None or not site.is_dir():
        return []
    found = [site / n for n in SITE_FILES
             if (site / n).is_file() and not (site / n).is_symlink()]
    for d in SITE_DIRS:
        if (site / d).is_dir() and not (site / d).is_symlink():
            found.extend(p for p in sorted((site / d).rglob("*"))
                         if p.is_file() and not p.is_symlink())
    return found


def _unreadable_note(path: object, e: OSError) -> str:
    """Why a file could not be read, with the iCloud fix when iCloud holds it."""
    from migrate_vault import DATALESS
    said = f"could not read {path}: {e.strerror or e}"
    try:
        dataless = bool(getattr(os.stat(str(path)), "st_flags", 0) & DATALESS)
    except OSError:
        dataless = False
    # Errno 60 is macOS's ETIMEDOUT, what reading an evicted iCloud file gives.
    if dataless or e.errno in (errno.ETIMEDOUT, 60):
        said += (f'; iCloud has not downloaded it: run brctl download '
                 f'"{path}", then the update again')
    return said


def _notes(vault: Path, site: Path | None) -> list[Path]:
    found: list[Path] = []
    def unreadable(e: OSError) -> None:
        raise BackupFailed(_unreadable_note(e.filename, e)) from e

    for dirpath, dirnames, filenames in os.walk(vault, onerror=unreadable):
        here = Path(dirpath)
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in SKIP_DIRS
            and not (here / d).is_symlink()
            and not (site is not None and (here / d).resolve() == site))   # under site/
        for name in sorted(filenames):
            path = here / name
            if path.suffix.lower() in NOTE_SUFFIXES and not path.is_symlink():
                found.append(path)
    return found


def _free_name(folder: Path, stamp: str) -> Path:
    path = folder / f"{stamp}.tar.gz"
    n = 2
    while path.exists() or path.with_name(path.name + ".partial").exists():
        path = folder / f"{stamp}-{n}.tar.gz"
        n += 1
    return path


def backup(vault: Path, *, home: Path | None = None, keep: int = 10) -> Path:
    """Write `<home>/.gm-apprentice/backups/<vault name>/<UTC stamp>.tar.gz`
    and keep the newest `keep`. Raises `BackupFailed` naming the file it
    could not read."""
    vault = Path(vault)
    root = vault.resolve()
    tag = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:8]
    folder = ((home if home is not None else Path.home())
              / ".gm-apprentice" / "backups" / f"{root.name}-{tag}")
    folder.mkdir(parents=True, exist_ok=True)
    target = _free_name(folder, _stamp())
    partial = target.with_name(target.name + ".partial")
    site = _site_folder(vault)
    files = [(p, p.relative_to(vault).as_posix()) for p in _notes(vault, site)]
    files += [(p, f"{SITE_ARC}/{p.relative_to(site).as_posix()}")
              for p in _site_files(site)] if site is not None else []
    try:
        with tarfile.open(partial, "w:gz") as tar:
            for path, arcname in files:
                try:
                    tar.add(path, arcname=arcname, recursive=False)
                except OSError as e:
                    raise BackupFailed(_unreadable_note(path, e)) from e
        os.replace(partial, target)
    except BackupFailed:
        partial.unlink(missing_ok=True)
        raise
    except OSError as e:
        partial.unlink(missing_ok=True)
        raise BackupFailed(f"could not write {target}: {e.strerror or e}") from e
    except BaseException:
        partial.unlink(missing_ok=True)   # interrupted: no half archive
        raise
    _prune(folder, keep)
    return target


def _prune(folder: Path, keep: int) -> None:
    def age(p: Path) -> tuple[str, int]:
        n = p.name.removesuffix(".tar.gz")[16:]
        return (p.name[:15], int(n) if n.isdigit() else 1)

    ours = re.compile(r"\d{8}-\d{6}(-\d+)?\.tar\.gz")
    old = sorted((p for p in folder.glob("*.tar.gz")
                  if ours.fullmatch(p.name)), key=age)
    for path in old[:max(0, len(old) - keep)]:
        path.unlink(missing_ok=True)

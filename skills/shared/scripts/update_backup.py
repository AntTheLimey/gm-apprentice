#!/usr/bin/env python3
"""A copy of the vault's notes, taken before `gma update` writes anything.

The archive holds every .md, .yaml and .json file (the update never edits
images) and lives under the home folder, outside the vault, so it never
syncs or publishes.
"""

from __future__ import annotations

import hashlib
import os
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path

NOTE_SUFFIXES = {".md", ".yaml", ".json"}
SKIP_DIRS = {".obsidian", ".git", ".trash", ".gm-apprentice"}


class BackupFailed(Exception):
    """The backup could not be made; the message names the file at fault."""


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _site_folder(vault: Path) -> Path | None:
    """The site folder when it sits inside the vault, else None. Settings
    that cannot be read mean no skip: the backup must not fail on them."""
    import vaultlib  # a failed import is a broken install: let it raise
    try:
        folder = vaultlib.settings(vault).get("player_site.folder")
        if not folder or not isinstance(folder, str):
            return None
        root = vault.resolve()
        path = (root / folder).resolve()  # an absolute folder stays itself
        path.relative_to(root)
        return path
    except Exception:  # noqa: BLE001 - any settings fault: back up anyway
        return None


def _notes(vault: Path, site: Path | None) -> list[Path]:
    found: list[Path] = []
    def unreadable(e: OSError) -> None:
        raise BackupFailed(
            f"could not read {e.filename}: {e.strerror or e}") from e

    for dirpath, dirnames, filenames in os.walk(vault, onerror=unreadable):
        here = Path(dirpath)
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in SKIP_DIRS
            and not (here / d).is_symlink()
            and not (site is not None and (here / d).resolve() == site))
        for name in sorted(filenames):
            path = here / name
            if path.suffix.lower() in NOTE_SUFFIXES and not path.is_symlink():
                found.append(path)
    return found


def _free_name(folder: Path, stamp: str) -> Path:
    path = folder / f"{stamp}.tar.gz"
    n = 2
    while path.exists():
        path = folder / f"{stamp}-{n}.tar.gz"
        n += 1
    return path


def backup(vault: Path, *, home: Path | None = None, keep: int = 5) -> Path:
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
    try:
        with tarfile.open(target, "w:gz") as tar:
            for path in _notes(vault, _site_folder(vault)):
                try:
                    tar.add(path, arcname=path.relative_to(vault).as_posix(),
                            recursive=False)
                except OSError as e:
                    raise BackupFailed(
                        f"could not read {path}: {e.strerror or e}") from e
    except BackupFailed:
        target.unlink(missing_ok=True)
        raise
    except OSError as e:
        target.unlink(missing_ok=True)
        raise BackupFailed(f"could not write {target}: {e.strerror or e}") from e
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

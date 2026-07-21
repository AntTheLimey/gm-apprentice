"""Managed, cross-platform store for the mobRPG CLI credential.

The single place that knows where the credential lives and how it is stored.
Precedence for the directory: MOBRPG_CONFIG_DIR override wins (both platforms);
then %APPDATA%\\mobrpg on Windows, $XDG_CONFIG_HOME/mobrpg else ~/.config/mobrpg
on POSIX. The credential JSON is 0600 on POSIX; on Windows the per-user
%APPDATA% profile is already ACL-scoped so no chmod is attempted.
"""

from __future__ import annotations

import json
import os


def config_dir() -> str:
    override = os.environ.get("MOBRPG_CONFIG_DIR")
    if override:
        return override
    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser(r"~\AppData\Roaming")
        return os.path.join(base, "mobrpg")
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "mobrpg")


def credentials_path() -> str:
    return os.path.join(config_dir(), "credentials.json")


def read() -> dict | None:
    """Parsed credential JSON, or None if absent/unreadable/corrupt."""
    try:
        with open(credentials_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write(cred: dict) -> None:
    """Persist the credential JSON, 0600 on POSIX."""
    os.makedirs(config_dir(), exist_ok=True)
    path = credentials_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cred, f, indent=2)
    if os.name != "nt":
        os.chmod(path, 0o600)


def clear() -> bool:
    """Delete the credential file; True if it existed."""
    try:
        os.remove(credentials_path())
        return True
    except FileNotFoundError:
        return False

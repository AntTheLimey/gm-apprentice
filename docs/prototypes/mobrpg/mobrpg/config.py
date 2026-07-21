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
    """Persist the credential JSON. On POSIX the file is created 0600 with no
    world-readable window (mode set at open time), inside a 0700 config dir."""
    d = config_dir()
    os.makedirs(d, exist_ok=True)
    path = credentials_path()
    data = json.dumps(cred, indent=2)
    if os.name == "nt":
        with open(path, "w", encoding="utf-8") as f:
            f.write(data)
        return
    os.chmod(d, 0o700)
    # O_CREAT with mode 0600 sets perms at creation (no 0644 window); the trailing
    # chmod also tightens a pre-existing file that was created with looser perms.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
    os.chmod(path, 0o600)


def clear() -> bool:
    """Delete the credential file; True if it existed."""
    try:
        os.remove(credentials_path())
        return True
    except FileNotFoundError:
        return False

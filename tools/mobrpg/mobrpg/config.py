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
    """Persist the credential JSON atomically.

    The secret is staged in a sibling temp file created 0600 (mode set at open
    time — never a 0644 window) and then atomically renamed onto the final path.
    A pre-existing loose-perm credential file is therefore never truncated in
    place: it is replaced wholesale by the already-0600 temp inode, and a failure
    mid-write leaves the original untouched. The temp lands in the same 0700
    config dir so the rename stays on one filesystem (atomic)."""
    d = config_dir()
    os.makedirs(d, exist_ok=True)
    path = credentials_path()
    data = json.dumps(cred, indent=2)
    if os.name == "nt":
        _atomic_write(d, path, data, chmod=False)
        return
    os.chmod(d, 0o700)
    _atomic_write(d, path, data, chmod=True)


def _atomic_write(d: str, path: str, data: str, *, chmod: bool) -> None:
    """Write ``data`` to a temp file in dir ``d`` (0600 when ``chmod``), then
    atomically replace ``path``. The temp is cleaned up on any failure."""
    import tempfile

    fd, tmp = tempfile.mkstemp(dir=d, prefix=".credentials-", suffix=".tmp")
    try:
        if chmod:
            os.chmod(tmp, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def clear() -> bool:
    """Delete the credential file; True if it existed."""
    try:
        os.remove(credentials_path())
        return True
    except FileNotFoundError:
        return False

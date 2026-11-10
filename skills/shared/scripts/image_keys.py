"""Where the picture-drawing service keys live. Stdlib only.

A key is looked for in the environment, then the macOS keychain, then a
key file in the user's config folder. It is never written into a vault, a
log or a message: callers say only where a key came from.
"""
from __future__ import annotations

import getpass
import json
import os
import subprocess
import sys
from pathlib import Path

ENV = {"gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
KEYCHAIN_SERVICE = "gm-apprentice.images"
RUN = subprocess.run   # tests replace this


class NeedsTerminal(Exception):
    """A key can only be typed in the GM's own terminal window."""


def config_dir() -> Path:
    """Where keys.json lives: $GMA_CONFIG, else the platform's user config."""
    override = os.environ.get("GMA_CONFIG")
    if override:
        return Path(override)
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "gm-apprentice"
    xdg = os.environ.get("XDG_CONFIG_HOME")
    return (Path(xdg) if xdg else Path.home() / ".config") / "gm-apprentice"


def _key_file() -> Path:
    return config_dir() / "keys.json"


def _read_file(service: str) -> str | None:
    try:
        data = json.loads(_key_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    key = data.get(service) if isinstance(data, dict) else None
    return key if isinstance(key, str) and key else None


def find(service: str) -> tuple[str, str] | None:
    """The key for `service` and where it came from, or None."""
    for var in ENV.get(service, ()):
        value = os.environ.get(var, "").strip()
        if value:
            return value, "environment"
    if sys.platform == "darwin":
        try:
            done = RUN(["security", "find-generic-password", "-s",
                        KEYCHAIN_SERVICE, "-a", service, "-w"],
                       capture_output=True, text=True)
        except OSError:
            done = None
        # A miss (exit 44) is an answer, not an error.
        if done is not None and done.returncode == 0 and done.stdout.strip():
            return done.stdout.strip(), "keychain"
        return None
    key = _read_file(service)
    return (key, "key file") if key else None


def store(service: str) -> str:
    """Store a key the person types, and say where it went."""
    if not sys.stdin.isatty():
        raise NeedsTerminal()
    if sys.platform == "darwin":
        # `security` asks for the key itself, on the inherited terminal.
        RUN(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
             "-a", service, "-w"], check=True)
        return "keychain"
    key = getpass.getpass(f"Paste the {service} key (it will not show): ").strip()
    if not key:
        raise ValueError("no key was typed")
    path = _key_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data[service] = key
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(path, 0o600)
    return "key file"

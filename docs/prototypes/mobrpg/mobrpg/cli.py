#!/usr/bin/env python3
"""
mobrpg — CLI over the mobRPG world-builder API for gm-apprentice vault sync.

Manual top-level dispatcher (strangler migration): native verbs call into
mobrpg.commands.*; every other verb shells out to its legacy prototype script
with argv passed through verbatim, so the whole surface works while verbs are
ported one at a time.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# Directory holding the legacy prototype scripts (this package's parent).
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent

# Native verbs (ported to mobrpg.commands.*). Filled in by later tasks.
NATIVE: dict = {}

# Fallback verbs → legacy script filename in _SCRIPTS_DIR.
FALLBACK: dict[str, str] = {
    "whoami": "smoketest.py",
    "worlds": "smoketest.py",
    "pull": "etl_extract.py",
    "write": "vault_write.py",
    "merge": "merge_overlaps.py",
    "link-orphans": "orphan_link.py",
    "sync": "detect_updates.py",
    "push": "push_to_mobrpg.py",
    "suggest": "push_suggestions.py",
    "types": "assign_types.py",
    "links": "push_relationships.py",
    "images": "pull_images.py",
}

# Ordered help text for `mobrpg --help`.
VERB_HELP: list[tuple[str, str]] = [
    ("whoami", "print the authenticated user and their worlds"),
    ("worlds", "list worlds visible to the authenticated user"),
    ("pull", "import a mobRPG world into a structured JSON extract"),
    ("write", "render a JSON extract into vault markdown files"),
    ("merge", "non-destructive merge for entities present in both"),
    ("link-orphans", "auto-link obvious orphan relationships post-import"),
    ("sync", "detect mobRPG entities edited since the last pull (bootstrap|sync)"),
    ("push", "push vault entities to mobRPG (direct create; needs write access)"),
    ("suggest", "push vault entities to mobRPG as review suggestions"),
    ("types", "set entity types via Attribute edges"),
    ("links", "push vault relationships as mobRPG events"),
    ("images", "pull entity images from a mobRPG world into the vault"),
]

_HELP = """\
mobrpg — CLI over the mobRPG world-builder API (gm-apprentice vault sync)

usage: mobrpg <command> [args...]

commands:
{commands}

Auth: set MOBRPG_TOKEN (bearer), or MOBRPG_EMAIL + MOBRPG_PASSWORD.
Target: MOBRPG_ENV=dev|prod (default prod). Writing to prod also needs
MOBRPG_ALLOW_PROD_WRITES=1. The resolved target prints to stderr on every run.

Run `mobrpg <command> --help` for a command's own options.
AI agents: read llms.txt (next to this package) for the full command model,
auth, and safe-write rules.
"""


def _print_help(stream=None) -> None:
    if stream is None:
        stream = sys.stdout
    width = max(len(v) for v, _ in VERB_HELP)
    lines = "\n".join(f"  {v.ljust(width)}  {h}" for v, h in VERB_HELP)
    print(_HELP.format(commands=lines), file=stream)


def _shellout(script_name: str, argv: list[str]) -> int:
    """Run a legacy prototype script with argv passed through verbatim."""
    script = _SCRIPTS_DIR / script_name
    proc = subprocess.run([sys.executable, str(script), *argv])
    return proc.returncode


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        _print_help()
        return 0

    verb, rest = argv[0], argv[1:]
    if verb in NATIVE:
        return NATIVE[verb](rest)
    if verb in FALLBACK:
        return _shellout(FALLBACK[verb], rest)

    print(f"unknown command: {verb}", file=sys.stderr)
    _print_help(sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

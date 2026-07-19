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

from mobrpg.commands import whoami as _whoami
from mobrpg.commands import pull as _pull
from mobrpg.commands import suggestions as _suggestions
from mobrpg.commands import catalog as _catalog
from mobrpg.commands import review as _review
from mobrpg.commands import submit_batch as _submit_batch
from mobrpg.commands import update as _update
from mobrpg.commands import map_cmd as _map
from mobrpg.commands import suggest as _suggest
from mobrpg.commands import pull_canon as _pull_canon
from mobrpg.commands import backfill as _backfill

# Directory holding the legacy prototype scripts (this package's parent).
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent

# Native verbs (ported to mobrpg.commands.*).
NATIVE: dict = {
    "whoami": _whoami.run,
    "worlds": _whoami.run,
    "pull": _pull.run,
    "suggestions": _suggestions.run,
    "catalog": _catalog.run,
    "review": _review.run,
    "submit-batch": _submit_batch.run,
    "update": _update.run,
    "map": _map.run,
    "suggest": _suggest.run,
    "pull-canon": _pull_canon.run,
    "backfill": _backfill.run,
}

# Fallback verbs → legacy script filename in _SCRIPTS_DIR.
FALLBACK: dict[str, str] = {
    "write": "vault_write.py",
    "merge": "merge_overlaps.py",
    "link-orphans": "orphan_link.py",
    "sync": "detect_updates.py",
    "push": "push_to_mobrpg.py",
    "types": "assign_types.py",
    "links": "push_relationships.py",
    "images": "pull_images.py",
}

# Ordered help text for `mobrpg --help`.
VERB_HELP: list[tuple[str, str]] = [
    ("whoami", "print the authenticated user and their worlds"),
    ("worlds", "list worlds visible to the authenticated user"),
    ("pull", "import a mobRPG world into a structured JSON extract"),
    ("suggestions", "list suggestions by review state; --correlate maps accepted back to the vault"),
    ("catalog", "list the elements of one kind (e.g. political/type, landfeature) in a world"),
    ("review", "accept | dismiss | reinstate a suggestion (GM; needs write access)"),
    ("submit-batch", "submit a pre-built compound suggestion batch (types+edges+relations) from JSON"),
    ("update", "replace a Pending suggestion's payload (PUT) from JSON; edits inline fields only"),
    ("map", "init | sync | check the per-vault mobRPG type mapping (discover + propose)"),
    ("pull-canon", "pull ratified mobRPG canon down into vault mobrpg: nodes"),
    ("backfill", "one-time: migrate a sidecar crosswalk into mobrpg: nodes"),
    ("write", "render a JSON extract into vault markdown files"),
    ("merge", "non-destructive merge for entities present in both"),
    ("link-orphans", "auto-link obvious orphan relationships post-import"),
    ("sync", "detect mobRPG entities edited since the last pull (bootstrap|sync)"),
    ("push", "push vault entities to mobRPG (direct create; needs write access)"),
    ("suggest", "build + submit the full datatype graph per entity (types + edges + events)"),
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

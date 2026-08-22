#!/usr/bin/env python3
"""
mobrpg — CLI over the mobRPG world-builder API for gm-apprentice vault sync.

Top-level dispatcher: every verb is a native subcommand implemented under
mobrpg.commands.*. (Prior to Task 14 this strangled a set of legacy prototype
scripts via a shell-out fallback layer; that layer and the scripts it ran are
gone — the whole surface is native now.)
"""

from __future__ import annotations

import sys

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
from mobrpg.commands import whats_new as _whats_new
from mobrpg.commands import adopt as _adopt
from mobrpg.commands import relink as _relink
from mobrpg.commands import auth as _auth
from mobrpg.commands import sync_cmd as _sync
from mobrpg.commands import write_cmd as _write
from mobrpg.commands import images as _images
from mobrpg.commands import link_orphans as _link_orphans

# Native verbs (all of them — the CLI's whole surface).
NATIVE: dict = {
    "auth": _auth.run,
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
    "whats-new": _whats_new.run,
    "adopt": _adopt.run,
    "relink": _relink.run,
    "sync": _sync.run,
    "write": _write.run,
    "images": _images.run,
    "link-orphans": _link_orphans.run,
}

# Ordered help text for `mobrpg --help`.
VERB_HELP: list[tuple[str, str]] = [
    ("auth", "manage mobRPG credentials: import | status | refresh | logout"),
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
    ("whats-new", "read-only report: entities/types new in mobRPG, and vault notes gone upstream"),
    ("adopt", "stamp mobrpg: nodes onto unlinked entities, matched to live elements by name"),
    ("relink", "re-point a moved/renamed note's mobrpg external_ref (vault-only)"),
    ("sync", "LWW sync of linked notes: pull newer canon, suggest newer vault edits"),
    ("write", "materialize a pull extract into vault markdown"),
    ("images", "download element images into the vault _attachments"),
    ("link-orphans", "auto-link obvious orphans after an import (report + vault edits)"),
    ("suggest", "build + submit the full datatype graph per entity (types + edges + events)"),
]

_HELP = """\
mobrpg — CLI over the mobRPG world-builder API (gm-apprentice vault sync)

usage: mobrpg <command> [args...]

commands:
{commands}

Auth: set MOBRPG_TOKEN (bearer), or MOBRPG_EMAIL + MOBRPG_PASSWORD.
Target: MOBRPG_ENV=dev|prod (default prod). The resolved target prints to
stderr on every run.

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


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        _print_help()
        return 0
    if argv[0] in ("-V", "--version"):
        from mobrpg import __version__
        print(f"mobrpg {__version__}")
        return 0

    verb, rest = argv[0], argv[1:]
    if verb in NATIVE:
        return NATIVE[verb](rest)

    print(f"unknown command: {verb}", file=sys.stderr)
    _print_help(sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

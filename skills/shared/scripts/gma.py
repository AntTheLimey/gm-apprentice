#!/usr/bin/env python3
"""gma: one entry point for the gm-apprentice vault scripts.

    gma <command> [args...]

Each command is one of the scripts beside this file; `gma <name> args` runs
that script's `main(args)`. `gma publish args` runs the publish tool under
node. COMMANDS is plain data (module name and one-line summary) so another
implementation can read the same table.

A module is imported only when its command runs; `full_tree()` imports them
all, for the docs generator and the tests.
"""

from __future__ import annotations

import argparse
import importlib
import subprocess
import sys
from typing import NamedTuple

import vaultlib


class Command(NamedTuple):
    module: str
    summary: str


COMMANDS: dict[str, Command] = {
    "dnd-ddb": Command("dnd_ddb", "Bring a D&D 5e PC note up to date from D&D Beyond."),
    "dnd-sheet": Command("dnd_sheet", "Report and fill the derived numbers on a D&D 5e PC note."),
    "graph-check": Command("graph_check", "Vault graph queries: orphans, unresolved links, dead ends, backlinks."),
    "gurps-check": Command("gurps_check", "GURPS 4e sheet arithmetic checks."),
    "gurps-skill-default": Command("gurps_skill_default", "Add a GURPS skill to a PC's sheet at its default level."),
    "index-build": Command("index_build", "Derive _meta/index.md from a vault scan."),
    "ingest-images": Command("ingest_images", "File and link vault-ingest image material."),
    "ingest-survey": Command("ingest_survey", "Classify vault-ingest source material."),
    "links": Command("links", "List a vault's broken links by kind, and fix them."),
    "migrate": Command("migrate", "Bring a vault and its site up to the plugin's version."),
    "moments": Command("moments", "A wrap-up's Memorable Moments, as the Story page reads them."),
    "plan-check": Command("plan_check", "Session Plan conformance checks."),
    "plans-index": Command("plans_index", "Narrative-plan and midwife-adventure discovery."),
    "prop-move": Command("prop_move", "Move a vault's own props into prop notes."),
    "reconcile-scan": Command("reconcile_scan", "What reconcile counts before it talks to the GM."),
    "relink": Command("relink", "Rename or move a note and rewrite every link to it."),
    "reveal": Command("reveal", "Apply the GM's yes to what a session let the players learn."),
    "reveal-scan": Command("reveal_scan", "What is still hidden in the notes a session touched."),
    "rules-lookup": Command("rules_lookup", "Record-level lookup over the ttrpg-expert systems corpus."),
    "scene-queue": Command("scene_queue", "The prep queue: scenes written ahead and not yet played."),
    "schema-rules": Command("schema_rules", "Canonical vault schema rules and relationship vocabulary."),
    "session-context": Command("session_context", "Session-prep context bundle in one call."),
    "stamp-entities": Command("stamp_entities", "Batch frontmatter writes for the session workflows."),
    "tones": Command("tones", "List a vault's stray tone words, and tidy them."),
    "vault-check": Command("vault_check", "Vault content checks: frontmatter, names, index, drafts and more."),
    "vault-scaffold": Command("vault_scaffold", "Build a new vault's skeleton, or list what one lacks."),
    "vault-search": Command("vault_search", "Ranked vault search."),
    "vault-write": Command("vault_write", "Place text the apprentice wrote into vault notes."),
    "publish": Command("", "Build and deploy the campaign site (runs the publish tool under node)."),
}

AGENT_NOTE = ("Agents: do not work from --help alone. Run 'gma llms' for the "
              "command reference and when to use each command.")


def _root(with_commands: bool) -> argparse.ArgumentParser:
    """The root parser; `with_commands` adds one subparser per command."""
    root = argparse.ArgumentParser(
        prog="gma",
        description="One entry point for the gm-apprentice vault scripts.\n\n"
                    + AGENT_NOTE,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    root.add_argument("--version", action="store_true",
                      help="print the plugin version")
    if with_commands:
        root.add_subparsers(dest="command", metavar="<command>")
    return root


def _reprog(parser: argparse.ArgumentParser, old: str, new: str) -> None:
    """Swap the leading program name at every depth of a parser."""
    parser.prog = new + parser.prog[len(old):]
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            for child in set(action.choices.values()):
                _reprog(child, old, new)


def _load(name: str) -> argparse.ArgumentParser:
    # Same mechanism as dispatch: build under argv[0] = "gma <name>". The
    # _reprog pass covers scripts that fix their own prog= (see the tests).
    saved = sys.argv[0]
    sys.argv[0] = f"gma {name}"
    try:
        module = importlib.import_module(COMMANDS[name].module)
        parser: argparse.ArgumentParser = module.build_parser()
    finally:
        sys.argv[0] = saved
    _reprog(parser, parser.prog, f"gma {name}")
    return parser


def _subparsers(root: argparse.ArgumentParser) -> argparse._SubParsersAction:
    for action in root._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action
    raise RuntimeError("root has no subcommands")


def full_tree() -> argparse.ArgumentParser:
    """The root parser with one subparser per command (imports every module)."""
    root = _root(True)
    sub = _subparsers(root)
    for name, cmd in COMMANDS.items():
        if cmd.module:
            # The script's own parser, whole (options, nested commands).
            sub.choices[name] = _load(name)
        else:
            stub = argparse.ArgumentParser(
                prog=f"gma {name}", description=cmd.summary)
            stub.add_argument("args", nargs=argparse.REMAINDER,
                              help="passed to the publish tool unchanged")
            sub.choices[name] = stub
        sub._choices_actions.append(
            sub._ChoicesPseudoAction(name, (), cmd.summary))
    return root


def _publish(args: list[str]) -> int:
    cmd = ["node", str(vaultlib.PUBLISH_TOOL), *args]
    try:
        return subprocess.call(cmd)
    except FileNotFoundError:
        print("gma: publish needs node on the PATH", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        # Help lists every command with its summary; the table is enough,
        # so no script's own parser is built.
        root = _root(True)
        sub = _subparsers(root)
        for name, cmd in COMMANDS.items():
            sub.add_parser(name, help=cmd.summary)
        root.print_help()
        return 0
    if args[0] == "--version":
        found = vaultlib.plugin_version()
        if found is None:
            print("gma: cannot determine the plugin version", file=sys.stderr)
            return 1
        print(found[0])
        return 0
    name, rest = args[0], args[1:]
    if name not in COMMANDS:
        print(f"gma: unknown command '{name}'; run 'gma llms'", file=sys.stderr)
        return 2
    if name == "publish":
        return _publish(rest)
    module = importlib.import_module(COMMANDS[name].module)
    # argparse derives its default prog from sys.argv[0], so usage and error
    # lines read `gma <name> ...` at every depth.
    saved = sys.argv[0]
    sys.argv[0] = f"gma {name}"
    try:
        result: int | None = module.main(rest)
    finally:
        sys.argv[0] = saved
    return result or 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""gma: one entry point for the gm-apprentice vault scripts.

    gma <command> [args...]

Each command is one of the scripts beside this file; `gma <name> args` runs
that script's `main(args)`. `gma publish args` runs the publish tool under
node; `gma llms [<command>]` prints the command reference. COMMANDS is
plain data (module name and one-line summary) so another implementation
can read the same table.

A module is imported only when its command runs; `full_tree()` imports them
all, for the docs generator and the tests.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

import install_layout
import tool_cache
import vaultlib
from install_layout import INSTALL_STOP, MISSING_TOOL, VERSION_UNKNOWN


class Command(NamedTuple):
    module: str
    summary: str


COMMANDS: dict[str, Command] = {
    "dnd-ddb": Command("dnd_ddb", "Bring a D&D 5e PC note up to date from D&D Beyond."),
    "dnd-sheet": Command("dnd_sheet", "Report and fill the derived numbers on a D&D 5e PC note."),
    "graph-check": Command("graph_check", "Vault graph queries: orphans, unresolved links, dead ends, backlinks."),
    "gurps-check": Command("gurps_check", "GURPS 4e sheet arithmetic checks."),
    "gurps-skill-default": Command("gurps_skill_default", "Add a GURPS skill to a PC's sheet at its default level."),
    "image": Command("image", "Draw a vault's pictures: plan, draw, look, place."),
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
    "section": Command("section", "Print one section of a note by heading path."),
    "session-context": Command("session_context", "Session-prep context bundle in one call."),
    "stamp-entities": Command("stamp_entities", "Batch frontmatter writes for the session workflows."),
    "tones": Command("tones", "List a vault's stray tone words, and tidy them."),
    "update": Command("update", "Update a vault and its site to the plugin's version, with a plain report."),
    "vault-check": Command("vault_check", "Vault content checks: frontmatter, names, index, drafts and more."),
    "vault-scaffold": Command("vault_scaffold", "Build a new vault's skeleton, or list what one lacks."),
    "vault-search": Command("vault_search", "Ranked vault search."),
    "vault-write": Command("vault_write", "Place text the apprentice wrote into vault notes."),
    "workaround": Command("workaround", "Record the vault's workarounds by the issue each stands in for."),
    "publish": Command("", "Build and deploy the campaign site (runs the publish tool under node)."),
    "tool": Command("", "Download the publish tool (installs without it), or print where it is."),
    "llms": Command("", "The command reference: when to use each command, its flags, an example."),
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
        root.add_subparsers(dest="command", metavar="<command>",
                            help="the command to run; each has its own --help")
    return root


PAGES = Path(__file__).resolve().parent.parent / "gma"


def _publish_parser() -> argparse.ArgumentParser:
    stub = argparse.ArgumentParser(
        prog="gma publish", description=COMMANDS["publish"].summary,
        epilog="Example: gma publish build --site player")
    stub.add_argument("args", nargs=argparse.REMAINDER,
                      help="passed to the publish tool unchanged")
    return stub


def _llms_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="gma llms", description=COMMANDS["llms"].summary,
        epilog="Example: gma llms relink")
    ap.add_argument("page", nargs="?", metavar="command",
                    help="the command whose page to print; none prints the index")
    return ap


def _llms(args: list[str]) -> int:
    page = _llms_parser().parse_args(args).page
    if page is None:
        path = PAGES / "llms.md"
    else:
        names = sorted(p.stem for p in (PAGES / "llms").glob("*.md"))
        if page not in names:
            print(f"gma llms: no page '{page}'; pages: {', '.join(names)}",
                  file=sys.stderr)
            return 2
        path = PAGES / "llms" / f"{page}.md"
    text = path.read_text(encoding="utf-8").replace(
        "{gma}", f'python3 "{Path(__file__).resolve().as_posix()}"')
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    sys.stdout.write(text.encode(enc, "replace").decode(enc))
    return 0


def _tool_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="gma tool", description=COMMANDS["tool"].summary,
        epilog="Example: gma tool install")
    sub = ap.add_subparsers(dest="action", required=True, metavar="<action>",
                            help="install: download and check it now; "
                                 "path: print the tool in use")
    sub.add_parser("install", help="download and check the tool now")
    sub.add_parser("path", help="print the tool in use")
    return ap


def _fetch_tool(timeout: int | None = None) -> Path:
    """Fetch this install's tool release into the cache and point this
    process at it. Raises tool_cache.FetchFailed."""
    version = install_layout.publish_version(install_layout.LAYOUT.shared)
    if version is None:
        raise tool_cache.FetchFailed(
            f"shared/{install_layout.PUBLISH_STAMP} is missing or empty, so "
            "the tool version is unknown")
    tool = tool_cache.fetch(version, timeout=timeout)
    install_layout.LAYOUT = install_layout.LAYOUT._replace(publish_tool=tool)
    vaultlib.adopt_publish_tool(tool)
    return tool


# The automatic fetch runs before a command, maybe at the table: it gives
# up sooner than `gma tool install`, and a failure holds it off a while.
AUTO_FETCH_TIMEOUT = 60


def _ensure_tool() -> None:
    """Before a command: an install without the tool fetches it once. A
    failure warns once and the command runs without it, as it would have."""
    if vaultlib.PUBLISH_TOOL is not None or shutil.which("node") is None:
        return
    version = install_layout.publish_version(install_layout.LAYOUT.shared)
    if version is None or tool_cache.failed_recently(version):
        return
    try:
        _fetch_tool(timeout=AUTO_FETCH_TIMEOUT)
    except tool_cache.FetchFailed as e:
        tool_cache.note_failure(version)
        fix = ("ask the GM to allow `gma tool install` outside the sandbox"
               if e.outside
               else "run `gma tool install` with network access"
               if "could not download" in e.reason
               else "run `gma tool install` to try again")
        print(f"gma: warning: could not install the publish tool ({e.reason}); "
              f"{fix}", file=sys.stderr)


def _tool(args: list[str]) -> int:
    action = _tool_parser().parse_args(args).action
    if action == "install":
        try:
            tool = (vaultlib.PUBLISH_TOOL if vaultlib.PUBLISH_TOOL is not None
                    else _fetch_tool())
        except tool_cache.FetchFailed as e:
            if e.outside:
                print(f"gma tool: could not save the publish tool: {e.reason}. "
                      + tool_cache.OUTSIDE_STOP, file=sys.stderr)
            else:
                print(f"gma tool: could not download the publish tool: {e.reason}. "
                      + INSTALL_STOP, file=sys.stderr)
            return 1
        print(tool)
        return 0
    if vaultlib.PUBLISH_TOOL is None:
        print("gma tool: " + MISSING_TOOL, file=sys.stderr)
        return 1
    print(vaultlib.PUBLISH_TOOL)
    return 0


BUILTINS = {"publish": _publish_parser, "llms": _llms_parser,
            "tool": _tool_parser}


def _load(name: str) -> argparse.ArgumentParser:
    # Same mechanism as dispatch: build under argv[0] = "gma <name>".
    saved = sys.argv[0]
    sys.argv[0] = f"gma {name}"
    try:
        module = importlib.import_module(COMMANDS[name].module)
        parser: argparse.ArgumentParser = module.build_parser()
    finally:
        sys.argv[0] = saved
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
            sub.choices[name] = BUILTINS[name]()
        sub._choices_actions.append(
            sub._ChoicesPseudoAction(name, (), cmd.summary))
    return root


def _site_pin_spec(tool: Path, args: list[str]) -> str:
    """What the site's package.json pins, as `update-pin --check --json`
    reports it ("" when it does not say)."""
    asked = [a for a in args if a not in ("--check", "--json")]
    try:
        done = subprocess.run(["node", str(tool), *asked, "--check", "--json"],
                              capture_output=True, text=True, timeout=120)
        spec = json.loads(done.stdout).get("spec")
    except (OSError, subprocess.TimeoutExpired, ValueError, AttributeError):
        return ""
    return spec if isinstance(spec, str) else ""


class StampMissing(Exception):
    pass


def _door_args(tool: Path, args: list[str]) -> list[str]:
    """`update-pin` with no --tag repoints at the plugin's cache. An install
    without the plugin has none, and a site already on a release tarball
    is left alone by it: both pin the release these skills go with
    instead, as `gma update` does (migrate_site._door_check). A `--check`
    asks about that same release. Raises StampMissing."""
    if (not args or args[0] != "update-pin"
            or any(a in ("--tag", "-h", "--help")
                   or a.startswith("--tag=") for a in args[1:])):
        return args
    layout = install_layout.LAYOUT
    if layout.door_owns_tool and not install_layout.TARBALL_PIN.match(
            _site_pin_spec(tool, args).replace("\\", "/")):
        return args
    version = install_layout.publish_version(layout.shared)
    if version is None:
        raise StampMissing
    return [*args, "--tag", f"publish-v{version}"]


def _run_tool(tool: Path, args: list[str]) -> int:
    cmd = ["node", str(tool), *args]
    try:
        if os.name != "nt":
            # Replace this process, so a killed background `serve` takes
            # Node with it instead of leaving it orphaned.
            os.execvp("node", cmd)
        code = subprocess.call(cmd)
        # A signal death comes back negative; exit codes are 0..255.
        return code if 0 <= code <= 255 else 1
    except OSError:
        print("gma: publish needs node on the PATH", file=sys.stderr)
        return 1


def _publish(args: list[str]) -> int:
    tool = vaultlib.PUBLISH_TOOL
    if tool is None:
        print("gma: " + MISSING_TOOL, file=sys.stderr)
        return 1
    try:
        args = _door_args(tool, args)
    except StampMissing:
        print(f"gma: shared/{install_layout.PUBLISH_STAMP} is missing or "
              "unreadable, so the tool release these skills go with is "
              "unknown and the site cannot be repinned. "
              + install_layout.INSTALL_STOP, file=sys.stderr)
        return 1
    if (args and args[0] == "update-pin" and "--check" not in args
            and any(a == "--tag" or a.startswith("--tag=") for a in args)):
        # A tagged repin downloads the release with Node's own fetch.
        old = tool_cache.node_too_old("node")
        if old is not None:
            print(f"gma: {tool_cache.node_upgrade(old)}, then run this again.",
                  file=sys.stderr)
            return 1
    return _run_tool(tool, args)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    # Node's fetch uses a sandbox's HTTPS_PROXY only when asked: the tool
    # download, `update-pin --tag` and every other Node child.
    os.environ.setdefault("NODE_USE_ENV_PROXY", "1")
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
        if len(args) > 1:
            print(f"gma: --version takes no arguments, got '{args[1]}'",
                  file=sys.stderr)
            return 2
        found = vaultlib.plugin_version()
        if found is None:
            print("gma: " + VERSION_UNKNOWN, file=sys.stderr)
            return 1
        print(found[0])
        return 0
    name, rest = args[0], args[1:]
    if name not in COMMANDS:
        print(f"gma: unknown command '{name}'; run 'gma llms'", file=sys.stderr)
        return 2
    if name == "llms":
        return _llms(rest)
    if name == "tool":
        return _tool(rest)
    if name == "publish" or not any(a in ("-h", "--help") for a in rest):
        # A Python command's help needs no tool, so no wait on a download.
        _ensure_tool()
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

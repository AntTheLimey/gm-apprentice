#!/usr/bin/env python3
"""Render the generated blocks of the gma llms pages from the command tree.

The pages (skills/shared/gma/llms.md, the index, and llms/<command>.md,
one per command) are hand-written prose around blocks this module owns:

    <!-- BEGIN GENERATED: gma <command> [<sub> ...] -->  usage, arguments, example
    <!-- BEGIN GENERATED ROUTING -->                      the index's command table
    <!-- END GENERATED -->

`render(doc, tree)` re-renders every block in a document; it is the only
definition of conforming. A command with no page, or a page missing one of
its command's blocks, is reported (`problems`), never written in, because
where a block sits among the prose is a person's choice.

Display names come from the path the walk takes, never from `parser.prog`
(Python 3.14 takes prog from `-m` when run as `python -m ...`), so the
blocks are the same under any interpreter.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterator

import gma

DOCS = Path(__file__).resolve().parent.parent / "gma"
INDEX = DOCS / "llms.md"
PAGES = DOCS / "llms"
# The index is read on every routed call: every byte costs every lookup.
INDEX_BUDGET = 12_000

# The subcommands of the publish tool: the `command === '<name>'` literals
# of tools/publish/bin/gm-publish.js (a test holds the two together).
PUBLISH_SUBCOMMANDS = (
    "build", "deploy", "doctor", "explain", "flush", "inbox", "init",
    "leaks", "lines", "manifest", "props", "relationships", "serve",
    "settings", "setup-inbox", "setup-status-bar", "sheet", "update-pin",
)

END = "<!-- END GENERATED -->"
ROUTING = "<!-- BEGIN GENERATED ROUTING -->"
BLOCK_RE = re.compile(
    r"<!-- BEGIN GENERATED(?:: (?P<name>gma[^>]*?)| ROUTING) -->\n"
    r"(?P<body>.*?)" + re.escape(END), re.S)

# Built-ins with no page of their own: llms's page is the index.
NO_PAGE = ("llms",)


def _sub_action(parser: argparse.ArgumentParser) -> argparse._SubParsersAction | None:
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action
    return None


def walk(parser: argparse.ArgumentParser, path: tuple[str, ...],
         summary: str = "") -> Iterator[tuple[tuple[str, ...], argparse.ArgumentParser, str]]:
    """(path, parser, one-line help) for `parser` and every subcommand below."""
    yield path, parser, summary
    sub = _sub_action(parser)
    if sub is None:
        return
    helps = {a.dest: a.help or "" for a in sub._choices_actions}
    for name, child in sub.choices.items():
        yield from walk(child, path + (name,), helps.get(name, ""))


def commands(tree: argparse.ArgumentParser) -> dict[str, argparse.ArgumentParser]:
    sub = _sub_action(tree)
    return dict(sub.choices) if sub else {}


def _leading(parser: argparse.ArgumentParser) -> list[str]:
    """The positionals a parser takes before its subcommand, as usage words."""
    words = []
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            break
        if not action.option_strings:
            words.append(_shape(action, f"<{_metavar(action)}>"))
    return words


def _index(tree: argparse.ArgumentParser) -> dict[str, tuple[argparse.ArgumentParser, str, str]]:
    """Display name -> (parser, summary, usage prefix), for the root and
    every command path. The prefix carries each parent's positionals, so a
    subcommand's usage reads `gma moments <vault> status`."""
    out = {"gma": (tree, "One entry point for the gm-apprentice vault scripts.", "gma")}

    def add(parser: argparse.ArgumentParser, path: tuple[str, ...],
            summary: str, prefix: str) -> None:
        out["gma " + " ".join(path)] = (parser, summary, prefix)
        sub = _sub_action(parser)
        if sub is None:
            return
        helps = {a.dest: a.help or "" for a in sub._choices_actions}
        lead = " ".join([prefix, *_leading(parser)])
        for name, child in sub.choices.items():
            add(child, path + (name,), helps.get(name, ""), f"{lead} {name}")

    for name, parser in commands(tree).items():
        summary = gma.COMMANDS[name].summary if name in gma.COMMANDS else ""
        add(parser, (name,), summary, f"gma {name}")
    return out


def examples(parser: argparse.ArgumentParser) -> list[str]:
    """The command lines of a parser's `Example:` epilog."""
    text = (parser.epilog or "").strip()
    if not text.startswith("Example:"):
        return []
    text = text[len("Example:"):]
    return [line.strip() for line in text.splitlines() if line.strip()]


def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def _help(action: argparse.Action, display: str) -> str:
    text = action.help or ""
    if text == argparse.SUPPRESS:
        return ""
    if "%" in text:
        params = dict(vars(action), prog=display)
        try:
            text = text % params
        except (KeyError, TypeError, ValueError):
            pass
    return _cell(text)


def _metavar(action: argparse.Action) -> str:
    if action.metavar is not None:
        meta = action.metavar
        return " ".join(meta) if isinstance(meta, tuple) else str(meta)
    if action.option_strings:
        return action.dest.upper()
    return action.dest


def _shape(action: argparse.Action, meta: str) -> str:
    nargs = action.nargs
    if nargs == "?":
        return f"[{meta}]"
    if nargs == "*":
        return f"[{meta} ...]"
    if nargs == "+":
        return f"{meta} ..."
    if nargs == argparse.REMAINDER:
        return "..."
    if isinstance(nargs, int) and nargs > 1:
        return " ".join([meta] * nargs)
    return meta


def _usage(prefix: str, parser: argparse.ArgumentParser) -> str:
    parts = [prefix]
    has_optional = False
    for action in parser._actions:
        if isinstance(action, argparse._HelpAction) or action.help == argparse.SUPPRESS:
            continue
        if isinstance(action, argparse._SubParsersAction):
            parts.append("<command> ...")
            continue
        if action.option_strings:
            if action.required:
                flag = action.option_strings[-1]
                parts.append(flag if action.nargs == 0
                             else f"{flag} {_shape(action, _metavar(action))}")
            else:
                has_optional = True
            continue
        parts.append(_shape(action, f"<{_metavar(action)}>"))
    if has_optional:
        parts.append("[options]")
    return " ".join(parts)


def _value(action: argparse.Action) -> str:
    if isinstance(action, argparse._SubParsersAction):
        return ", ".join(f"`{c}`" for c in action.choices)
    if action.choices is not None:
        return ", ".join(f"`{c}`" for c in action.choices)
    if action.option_strings and action.nargs == 0:
        return ""
    return f"`{_shape(action, _metavar(action))}`" if action.option_strings else ""


def render_block(display: str, parser: argparse.ArgumentParser, summary: str,
                 prefix: str = "") -> str:
    """The body of one command's block (between the markers)."""
    lines = []
    if summary:
        lines += [_cell(summary), ""]
    lines += ["```text", _usage(prefix or display, parser), "```", ""]
    rows = []
    for action in parser._actions:
        if isinstance(action, argparse._HelpAction) or action.help == argparse.SUPPRESS:
            continue
        if action.option_strings:
            name = ", ".join(f"`{o}`" for o in sorted(
                action.option_strings, key=lambda o: (not o.startswith("--"), o)))
        elif isinstance(action, argparse._SubParsersAction):
            name = "`<command>`"
        else:
            name = f"`<{_metavar(action)}>`"
        help_text = _help(action, display)
        if isinstance(action, (argparse._AppendAction, argparse._ExtendAction)):
            help_text = (help_text + " (repeatable)").strip()
        rows.append(f"| {name} | {_value(action)} | {help_text} |")
    if rows:
        lines += ["| Argument | Value | Help |", "|---|---|---|", *rows, ""]
    for example in examples(parser):
        lines += [f"Example: `{example}`", ""]
    return "\n".join(lines)


def render_routing(tree: argparse.ArgumentParser) -> str:
    lines = ["| Command | Page | Summary |", "|---|---|---|"]
    for name in commands(tree):
        page = "this page" if name in NO_PAGE else f"`gma llms {name}`"
        summary = gma.COMMANDS[name].summary if name in gma.COMMANDS else ""
        lines.append(f"| `{name}` | {page} | {_cell(summary)} |")
    return "\n".join(lines) + "\n"


def render(doc: str, tree: argparse.ArgumentParser) -> str:
    """`doc` with every generated block re-rendered from `tree`.

    A block naming no command is left as it is; `problems` reports it.
    """
    known = _index(tree)

    def one(m: re.Match[str]) -> str:
        name = m.group("name")
        if name is None:
            return f"{ROUTING}\n{render_routing(tree)}{END}"
        name = name.strip()
        if name not in known:
            return m.group(0)
        parser, summary, prefix = known[name]
        return (f"<!-- BEGIN GENERATED: {name} -->\n"
                f"{render_block(name, parser, summary, prefix)}{END}")

    return BLOCK_RE.sub(one, doc)


def block_names(doc: str) -> list[str]:
    return [m.group("name").strip() for m in BLOCK_RE.finditer(doc)
            if m.group("name")]


def expected_blocks(tree: argparse.ArgumentParser, command: str) -> list[str]:
    """The blocks the page for `command` carries: the command and each subcommand."""
    parser = commands(tree)[command]
    return ["gma " + " ".join(path) for path, _, _ in walk(parser, (command,))]


def missing_pages(tree: argparse.ArgumentParser, pages_dir: Path) -> list[str]:
    return [name for name in commands(tree)
            if name not in NO_PAGE and not (pages_dir / f"{name}.md").is_file()]


def documents(tree: argparse.ArgumentParser, docs: Path) -> dict[Path, list[str]]:
    """Every page that should exist, with the blocks it must carry."""
    out: dict[Path, list[str]] = {
        docs / "llms.md": ["gma"] + [b for n in NO_PAGE
                                     for b in expected_blocks(tree, n)]}
    for name in commands(tree):
        if name not in NO_PAGE:
            out[docs / "llms" / f"{name}.md"] = expected_blocks(tree, name)
    return out


def problems(tree: argparse.ArgumentParser, docs: Path = DOCS) -> list[str]:
    """Everything that keeps the pages from conforming to `tree`."""
    found = []
    known = _index(tree)
    for name, parser in commands(tree).items():
        if not examples(parser):
            found.append(f"gma {name}: no 'Example:' epilog")
    pages_dir = docs / "llms"
    for name in missing_pages(tree, pages_dir):
        found.append(f"llms/{name}.md: missing (gen_gma_docs.py --stub {name})")
    expected = documents(tree, docs)
    for path in sorted(pages_dir.glob("*.md")) if pages_dir.is_dir() else []:
        if path not in expected:
            found.append(f"llms/{path.name}: a page for no command")
    for path, blocks in expected.items():
        if not path.is_file():
            continue
        rel = path.relative_to(docs).as_posix()
        doc = path.read_text(encoding="utf-8")
        have = block_names(doc)
        for name in blocks:
            if name not in have:
                found.append(f"{rel}: no block for {name}")
        for name in have:
            if name not in known:
                found.append(f"{rel}: block for {name}, which is no command")
            elif name not in blocks:
                found.append(f"{rel}: block for {name} belongs on another page")
        if path == docs / "llms.md" and ROUTING not in doc:
            found.append(f"{rel}: no routing table")
        if render(doc, tree) != doc:
            found.append(f"{rel}: generated blocks out of date")
    return found

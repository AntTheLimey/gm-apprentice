#!/usr/bin/env python3
"""migrate.py: bring a vault and its site up to the plugin's version.

    migrate.py VAULT [plan]
    migrate.py VAULT apply [--choose ID[=VALUE]]...

`plan` writes nothing. It prints the vault's version and the plugin's,
then up to three lists: Will do (what one yes covers, in run order), Your
choice (each with an id for --choose) and Needs a person (file, line, what
is wrong). While the site's publish tool is out of date the steps that ask
it are listed under a fourth heading. An `apply` that repins the site
runs them right after: their Will do is done and their Needs a person
printed. Only if one offers a Your choice the GM was never shown does it
hold the stamp, for the next `plan`, which lists that choice.

`apply` runs Will do, then the chosen choices, stamps
`gm_apprentice_version`, and prints what it did and Needs a person again.
A step that fails stops the run; the vault is stamped at the last release
whose steps all completed, so the next run starts at the failed step.

Exit: 0 done or nothing to do; 1 a step failed; 2 bad arguments, or a
vault this script does not migrate (below 1.10.12, or ahead of the plugin).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          check_editable, edit_frontmatter)
from migrate_site import REPIN, SITE_CHECKS
from migrate_vault import VAULT_CHECKS
from vaultlib import extract_frontmatter, parse_version, plugin_version, set_key

FLOOR = "1.10.12"
LAST_PROSE = "1.10.25"   # the last release whose skills migrate by hand
TITLES = {WILL: "Will do", CHOICE: "Your choice", PERSON: "Needs a person"}
WAITING = "Checked once the site's tool is updated"
WAITED_LINE = ("the site's publish tool is updated; run plan again for the "
               "choices it now offers")

CHECKS: list[Check] = [*SITE_CHECKS, *VAULT_CHECKS]


def gate(vault: Path) -> tuple[str, str] | str:
    """(vault version, plugin version), or the one line that refuses."""
    found = plugin_version()
    if found is None:
        return "cannot determine the plugin version"
    plugin = found[0]
    if not (vault / "_meta").is_dir():
        return f"{vault} has no _meta/ folder: first-time setup, not a migration"
    try:
        fm = extract_frontmatter((vault / "_meta" / "vault-config.md").read_text(
            encoding="utf-8-sig", errors="replace")) or {}
    except OSError:
        fm = {}
    current = fm.get("gm_apprentice_version")
    shown = str(current) if current and not isinstance(current, list) else None
    if shown is None or parse_version(shown) < parse_version(FLOOR):
        return (f"this vault is at {shown or 'no recorded version'}, below "
                f"{FLOOR}, the oldest this script migrates from; migrate it "
                f"with gm-apprentice {LAST_PROSE} first")
    if parse_version(shown) > parse_version(plugin):
        return (f"vault {shown} is ahead of plugin {plugin}; update the "
                f"plugin before touching this vault")
    return shown, plugin


def offered(checks: list[Check], vault_v: str,
            plugin_v: str) -> list[Check]:
    """The checks this vault is offered, in run order: band, then release.
    A release above the plugin's own is not offered."""
    below, top = parse_version(vault_v), parse_version(plugin_v)
    keep = [c for c in checks
            if c.release is None
            or below < parse_version(c.release) <= top]
    return sorted(keep, key=lambda c: (
        c.band, parse_version(c.release) if c.release else ()))


Row = tuple[str, str]   # (the check or item that printed it, its row)


def _rows(item: Item) -> list[Row]:
    if item.group == PERSON:
        return [(item.id, line) for line in item.lines]
    label = f"{item.id}=<{item.wants}>" if item.wants else item.id
    return [(item.id, f"{label}\t{line}") for line in item.lines]


def _grouped(rows: list[Row]) -> list[str]:
    """The rows as printed: rows of one check that say the same thing after
    the tab become one line saying it once, then their heads (path, id)
    indented under it. Other rows print as they are."""
    buckets: dict[tuple[str, str], list[str]] = {}
    for who, row in rows:
        head, tab, message = row.partition("\t")
        buckets.setdefault((who, message if tab else row), []).append(
            head if tab else "")
    out: list[str] = []
    for (who, message), heads in buckets.items():
        if len(heads) == 1 or len(set(heads)) == 1 or not heads[0]:
            out.extend(f"{h}\t{message}" if h else message for h in heads)
        else:
            out.append(f"{who} ({len(heads)}): {message}")
            out.extend(f"  {h}" for h in heads)
    return out


def emit(label: str, rows: list[Row], unchanged: int = 0) -> None:
    """A list under its heading; `# count` is rows, not printed lines."""
    print(f"## {label}")
    print(f"# count: {len(rows) + unchanged}")
    if unchanged:
        print(f"# {unchanged} row{'s' * (unchanged != 1)} already shown in the plan")
    for line in _grouped(rows):
        print(line)


def run_plan(vault: Path, checks: list[Check] | None = None) -> int:
    refused = gate(vault)
    if isinstance(refused, str):
        print(f"migrate.py: {refused}", file=sys.stderr)
        return 2
    vault_v, plugin_v = refused
    groups: dict[str, list[Row]] = {WILL: [], CHOICE: [], PERSON: []}
    waiting: list[Row] = []
    repin_waits = False
    for check in offered(CHECKS if checks is None else checks, vault_v, plugin_v):
        if check.asks_site and repin_waits:
            waiting.append((check.name, f"{check.name}\t{check.title}"))
            continue
        try:
            items = check.find(vault)
        except StepFailed as e:
            groups[PERSON].append((check.name, f"{check.name}\t{e} (apply "
                                   f"stops here until this is fixed)"))
            repin_waits = repin_waits or check.name == REPIN
            continue
        for item in items:
            groups[item.group].extend(_rows(item))
        if check.name == REPIN and any(i.group == WILL for i in items):
            repin_waits = True
    behind = parse_version(vault_v) < parse_version(plugin_v)
    print(f"vault {vault_v}, plugin {plugin_v}")
    if not behind and not waiting and not any(groups.values()):
        print("up to date")
        return 0
    if behind:
        groups[WILL].append(
            ("stamp", f"stamp\tgm_apprentice_version {vault_v} -> {plugin_v}"))
    for group in (WILL, CHOICE, PERSON):
        if groups[group]:
            emit(TITLES[group], groups[group])
        if group == WILL and waiting:
            emit(WAITING, waiting)
    return 0


def _stamp(vault: Path, version: str) -> None:
    edit_frontmatter(
        vault / "_meta" / "vault-config.md",
        lambda fm, eol: set_key(fm, "gm_apprentice_version",
                                f'"{version}"', eol))


def _choice_problem(choice: str, value: str | None,
                    known: list[str]) -> str | None:
    """Why `--choose choice[=value]` cannot run, or None. A known entry
    ending in "=" needs a value; "x:" entries match by prefix."""
    for entry in known:
        base = entry.removesuffix("=")
        if choice == base or (base.endswith(":") and choice.startswith(base)):
            if entry.endswith("=") and not value:
                return (f"--choose {choice} needs a value: "
                        f"{choice}=<value>")
            return None
    return (f"--choose {choice}: not something this vault is offered; "
            f"run plan to see the ids")


def run_apply(vault: Path, chosen: list[tuple[str, str | None]],
              checks: list[Check] | None = None) -> int:
    refused = gate(vault)
    if isinstance(refused, str):
        print(f"migrate.py: {refused}", file=sys.stderr)
        return 2
    vault_v, plugin_v = refused
    todo = offered(CHECKS if checks is None else checks, vault_v, plugin_v)
    known = [c for check in todo for c in check.choices]
    for choice, value in chosen:
        problem = _choice_problem(choice, value, known)
        if problem:
            print(f"migrate.py: {problem}", file=sys.stderr)
            return 2
    if parse_version(vault_v) < parse_version(plugin_v):
        try:   # a stamp is due, written last; find out now that it can be
            check_editable(vault / "_meta" / "vault-config.md")
        except StepFailed as e:
            print(f"migrate.py: {e}; nothing was changed", file=sys.stderr)
            return 1
    did: list[Row] = []
    person: list[Row] = []
    shown = 0   # person rows the plan already listed
    used: set[str] = set()
    failed: int | None = None
    error = ""
    repinned = waited = False
    for n, check in enumerate(todo):
        after_repin = check.asks_site and repinned   # plan did not list it
        try:
            for item in check.find(vault):
                if item.group == PERSON:
                    # a check that waited on the repin was not in the plan
                    person.extend(_rows(item) if after_repin else [])
                    shown += 0 if after_repin else len(item.lines)
                    continue
                picks = ([None] if item.group == WILL else
                         [v for i, v in chosen if i == item.id])
                if after_repin and item.group == CHOICE and not picks:
                    waited = True   # a choice the GM has not seen
                for value in picks:
                    if item.wants and not value:
                        raise StepFailed(
                            f"--choose {item.id} needs a value: "
                            f"{item.id}=<{item.wants}>")
                    if item.apply is None:
                        raise StepFailed(f"{item.id} has nothing to run")
                    did.extend((item.id, f"{item.id}\t{line}")
                               for line in item.apply(value))
                    used.add(item.id)
                    repinned = repinned or (check.name == REPIN
                                            and item.group == WILL)
        except StepFailed as e:
            failed, error = n, f"{check.name}: {e}"
            break
    target = plugin_v
    if failed is not None:
        target = vault_v
        left = [c.release for c in todo[failed:] if c.release]
        if left:
            first = parse_version(min(left, key=parse_version))
            done = [c.release for c in todo
                    if c.release and parse_version(c.release) < first]
            target = max([vault_v, *done], key=parse_version)
    stamped = parse_version(target) > parse_version(vault_v) and not waited
    if stamped:
        try:
            _stamp(vault, target)
        except StepFailed as e:
            stamped = False
            error = error or f"stamp: {e}"
            failed = failed if failed is not None else len(todo)
    emit("Did", did)
    for choice in dict.fromkeys(i for i, _v in chosen if i not in used):
        print(f"not offered: {choice}")
    if person or shown:
        emit(TITLES[PERSON], person, shown)
    if waited:
        print(WAITED_LINE)
    if failed is not None:
        print(f"migrate.py: {error}", file=sys.stderr)
        print(f"stamped {target}; the rest is offered again next time"
              if stamped else "not stamped")
        return 1
    if waited:
        print("not stamped")
    else:
        print(f"stamped {plugin_v}" if stamped else f"already at {plugin_v}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="migrate.py",
        description="Bring a vault and its site up to the plugin's version.")
    ap.add_argument("vault")
    ap.add_argument("command", nargs="?", choices=["plan", "apply"],
                    default="plan")
    ap.add_argument("--choose", action="append", default=[],
                    metavar="ID[=VALUE]",
                    help="apply only: a Your-choice id from plan; repeatable")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    vault = Path(args.vault).expanduser()
    if not vault.is_dir():
        print(f"migrate.py: not a directory: {vault}", file=sys.stderr)
        return 2
    if args.command == "plan":
        if args.choose:
            print("migrate.py: --choose goes with apply", file=sys.stderr)
            return 2
        return run_plan(vault)
    chosen: list[tuple[str, str | None]] = []
    for raw in args.choose:
        choice, sep, value = raw.partition("=")
        chosen.append((choice, value if sep else None))
    return run_apply(vault, chosen)


if __name__ == "__main__":
    sys.exit(main())

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
hold the stamp, for the next `plan`, which lists that choice. The stamp row
names the choices it waits for (see `apply`).

`apply` runs Will do, then the chosen choices, stamps
`gm_apprentice_version`, and prints what it did and Needs a person again.
A choice that can be answered "leave it" (`--choose id=leave`) and was not
chosen is printed as "not answered" and holds the stamp, so the next `plan`
lists it again; everything else in the plan still runs.
A step that fails stops the run; the vault is stamped at the last release
whose steps all completed, so the next run starts at the failed step.

`gma update` (update.py) is the command skills run; this is its engine.
For a direct caller: a template's choice needs a value
(`--choose template:<file>=keep|take`); `apply` writes the update record
(`_meta/update-record.json`) with the template decisions; an unreadable
template is a Needs a person row and never stops the run.

Exit: 0 done or nothing to do; 1 a step failed; 2 bad arguments, or a
vault this script does not migrate (below the floor, `MOVED_FLOOR`, or
ahead of the plugin).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

import update_record

from migrate_core import CHOICE, PERSON, WILL, Check, Item, StepFailed
from migrate_site import REPIN, SITE_CHECKS
from migrate_vault import VAULT_CHECKS
from update_record import AnswerEntry, lines_sha
from vault_check import MOVED_FLOOR, Left, refusal, unmoved
from install_layout import VERSION_UNKNOWN, update_step  # noqa: E402
from vaultlib import cli_name  # noqa: E402
from vaultlib import (STATE_FILE, SettingsUnavailable, StateUnreadable, parse_version, plugin_version,
                      read_held, read_stamp, vault_layout, write_held,
                      write_stamp)

FLOOR = MOVED_FLOOR
TITLES = {WILL: "Will do", CHOICE: "Your choice", PERSON: "Needs a person"}
WAITING = "Checked once the site's tool is updated"
WAITED_LINE = ("the site's publish tool is updated; run plan again for the "
               "choices it now offers")

CHECKS: list[Check] = [*SITE_CHECKS, *VAULT_CHECKS]
TEMPLATE = "template:"   # a template's choice; its answer is in the update record


def gate(vault: Path,
         notes: list[str] | None = None) -> tuple[str, str] | str:
    """(vault version, plugin version), or the one line that refuses. A
    check the gate had to skip is said on `notes`."""
    found = plugin_version()
    if found is None:
        return VERSION_UNKNOWN
    plugin = found[0]
    if not (vault / "_meta").is_dir():
        return f"{vault} has no _meta/ folder: first-time setup, not a migration"
    try:
        shown = read_stamp(vault)
    except StateUnreadable as e:
        return str(e)
    if shown is None and vault_layout(vault) == "none":
        return (f"{vault} has a _meta/ folder but no settings file: that is "
                f"first-time setup (gma vault-scaffold), not a migration")
    left = unmoved(vault, shown, notes)
    if left:
        return refusal(left, plugin)
    if shown is None:   # unmoved lists a missing stamp; never pass without one
        return refusal([Left(STATE_FILE, f"no update stamp ({STATE_FILE})",
                             True)], plugin)
    if parse_version(shown) > parse_version(plugin):
        return (f"vault {shown} is ahead of plugin {plugin}; "
                f"{update_step('update the plugin')} before touching this vault")
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


@dataclass
class Found:
    """What one offered check found, in run order."""
    check: Check
    items: list[Item] = field(default_factory=list)
    failed: str | None = None   # its find raised StepFailed: the message
    waiting: bool = False       # behind a pending repin: not looked at


def collect(vault: Path, checks: list[Check]) -> list[Found]:
    """Run each check's find, in the order given (`offered`), printing
    nothing. A check that asks the site's tool waits, unlooked-at, while a
    repin is still to run; a find that fails is kept with its message."""
    out: list[Found] = []
    repin_waits = False
    for check in checks:
        if check.asks_site and repin_waits:
            out.append(Found(check, waiting=True))
            continue
        try:
            items = check.find(vault)
        except StepFailed as e:
            out.append(Found(check, failed=str(e)))
            repin_waits = repin_waits or check.name == REPIN
            continue
        out.append(Found(check, items))
        if check.name == REPIN and any(i.group == WILL for i in items):
            repin_waits = True
    return out


def recorded_answers(vault: Path) -> dict[str, AnswerEntry]:
    """The answers the update record keeps; none when it cannot be read
    (`gma update` reports that; a plan only shows the question again)."""
    try:
        return update_record.load(vault)["answers"]
    except update_record.RecordUnreadable:
        return {}


# Answers that change nothing: the only ones the record answers again. A
# yes to a change is given fresh each time, or a GM's later edit could be
# overwritten by an old yes.
STANDING = ("leave", "keep")


def recorded(item: Item, answers: dict[str, AnswerEntry]) -> str | None:
    """The standing answer (leave or keep) the record keeps for this item
    while its lines are the ones it was given against; a template's answer
    is the record's templates entry, never this."""
    if item.group == PERSON or item.id.startswith(TEMPLATE):
        return None
    entry = answers.get(item.id)
    if isinstance(entry, dict) and entry.get("lines_sha") == lines_sha(item.lines):
        answer = entry.get("answer")
        return answer if answer in STANDING else None
    return None


def answered(item: Item, held: dict[str, set[str]],
              answers: dict[str, AnswerEntry] | None = None) -> bool:
    """Is this item settled by what a held update remembered (a "leave"
    already given, or a notice already said), or by an answer the update
    record keeps against these same lines?"""
    if answers and recorded(item, answers) is not None:
        return True
    if item.group == CHOICE:
        # A template's answer lives in the update record, not here.
        return item.id in held["left"] and not item.id.startswith(TEMPLATE)
    return item.notice and item.id in held["said"]


def _rows(item: Item) -> list[Row]:
    if item.group == PERSON:
        return [(item.id, line) for line in item.lines]
    label = f"{item.id}=<{item.wants}>" if item.wants else item.id
    lines = list(item.lines)
    said = (item.detail or {}).get("summary")
    if lines and isinstance(said, str) and said:
        lines[-1] = f"{lines[-1]} ({said})"
    return [(item.id, f"{label}\t{line}") for line in lines]


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
        print(f"{cli_name()}: {refused}", file=sys.stderr)
        return 2
    vault_v, plugin_v = refused
    groups: dict[str, list[Row]] = {WILL: [], CHOICE: [], PERSON: []}
    waiting: list[Row] = []
    holding: list[str] = []   # choices apply will not stamp without
    maybe: list[str] = []     # checks behind the repin that may ask one
    held = read_held(vault)
    answers = recorded_answers(vault)
    stuck: list[str] = []     # things only a person can settle, that hold it
    todo = offered(CHECKS if checks is None else checks, vault_v, plugin_v)
    for found in collect(vault, todo):
        check = found.check
        if found.waiting:
            waiting.append((check.name, f"{check.name}\t{check.title}"))
            if any(c.endswith("=") for c in check.choices):
                # not looked at yet: all that is known is that it can ask
                maybe.append(check.name)
            continue
        if found.failed is not None:
            groups[PERSON].append((check.name, f"{check.name}\t{found.failed} "
                                   f"(apply stops here until this is fixed)"))
            continue
        for item in found.items:
            if answered(item, held, answers):
                continue
            groups[item.group].extend(_rows(item))
            if item.holds_stamp:
                (stuck if item.group == PERSON else holding).append(item.id)
    behind = parse_version(vault_v) < parse_version(plugin_v)
    print(f"vault {vault_v}, plugin {plugin_v}")
    if not behind and not waiting and not any(groups.values()):
        print("up to date")
        return 0
    if behind:
        parts = ([f"only once {', '.join(holding)} "
                  f"{'is' if len(holding) == 1 else 'are'} answered"]
                 if holding else [])
        if maybe:
            parts.append(f"{', '.join(maybe)} may ask a choice once the "
                         f"site's tool is updated")
        until = f" ({'; '.join(parts)})" if parts else ""
        if stuck:
            until = (f" (not until {', '.join(stuck)} "
                     f"{'is' if len(stuck) == 1 else 'are'} settled)")
        groups[WILL].append(
            ("stamp", f"stamp\tgm_apprentice_version {vault_v} -> "
                      f"{plugin_v}{until}"))
    for group in (WILL, CHOICE, PERSON):
        if groups[group]:
            emit(TITLES[group], groups[group])
        if group == WILL and waiting:
            emit(WAITING, waiting)
    return 0


def stamp_target(todo: list[Check], failed: int | None, vault_v: str,
                 plugin_v: str) -> str:
    """The version a run may stamp: the plugin's, or after the check at
    `failed` stopped it, the last release whose steps all finished."""
    if failed is None:
        return plugin_v
    left = [c.release for c in todo[failed:] if c.release]
    if not left:
        return vault_v
    first = parse_version(min(left, key=parse_version))
    done = [c.release for c in todo
            if c.release and parse_version(c.release) < first]
    return max([vault_v, *done], key=parse_version)


def stamp(vault: Path, version: str) -> None:
    try:
        write_stamp(vault, version)
    except (StateUnreadable, OSError) as e:
        raise StepFailed(str(e) if isinstance(e, StateUnreadable) else
                         f"the version stamp cannot be written "
                         f"({e.__class__.__name__})") from e


def check_stampable(vault: Path) -> None:
    """Raise StepFailed unless the stamp could be written."""
    try:
        read_stamp(vault)
    except StateUnreadable as e:
        raise StepFailed(str(e)) from e


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
            if not entry.endswith("=") and value not in (None, "leave"):
                return (f"--choose {choice} takes no value but "
                        f"{choice}=leave; to run it, name {choice} alone")
            return None
    return (f"--choose {choice}: not something this vault is offered; "
            f"run plan to see the ids")


def _last_check(choice: str, todo: list[Check]) -> int:
    """The index in `todo` of the last check that may offer `choice`
    (matched as `_choice_problem` matches it: several checks can share a
    prefix such as `retire-step:`); len(todo) when none does."""
    last = len(todo)
    for n, check in enumerate(todo):
        for entry in check.choices:
            base = entry.removesuffix("=")
            if choice == base or (base.endswith(":") and choice.startswith(base)):
                last = n
    return last


def run_apply(vault: Path, chosen: list[tuple[str, str | None]],
              checks: list[Check] | None = None) -> int:
    refused = gate(vault)
    if isinstance(refused, str):
        print(f"{cli_name()}: {refused}", file=sys.stderr)
        return 2
    vault_v, plugin_v = refused
    todo = offered(CHECKS if checks is None else checks, vault_v, plugin_v)
    known = [c for check in todo for c in check.choices]
    for choice, value in chosen:
        problem = _choice_problem(choice, value, known)
        if problem:
            print(f"{cli_name()}: {problem}", file=sys.stderr)
            return 2
    if parse_version(vault_v) < parse_version(plugin_v):
        try:   # a stamp is due, written last; find out now that it can be
            check_stampable(vault)
        except StepFailed as e:
            print(f"{cli_name()}: {e}; nothing was changed", file=sys.stderr)
            return 1
    did: list[Row] = []
    person: list[Row] = []
    shown = 0   # person rows the plan already listed
    used: set[str] = set()
    failed: int | None = None
    error = ""
    repinned = waited = False
    unanswered: list[str] = []   # value choices the GM was not asked
    held = read_held(vault)
    answers = recorded_answers(vault)
    left_ids: set[str] = set()   # "leave" answers given this run
    said: set[str] = set()       # notices seen this run
    stuck: list[str] = []        # person rows that hold the stamp
    for n, check in enumerate(todo):
        after_repin = check.asks_site and repinned   # plan did not list it
        try:
            for item in check.find(vault):
                picked = any(i == item.id for i, _v in chosen)
                if answered(item, held, answers) and not picked:
                    continue
                if item.notice:
                    said.add(item.id)
                if item.group == PERSON:
                    if item.holds_stamp:
                        stuck.append(item.id)
                    # a check that waited on the repin was not in the plan
                    person.extend(_rows(item) if after_repin else [])
                    shown += 0 if after_repin else len(item.lines)
                    continue
                picks = ([None] if item.group == WILL else
                         [v for i, v in chosen if i == item.id])
                if after_repin and item.group == CHOICE and not picks:
                    waited = True   # a choice the GM has not seen
                if item.holds_stamp and not picks:
                    # Silence is not an answer (`leave` is), and past the
                    # stamp the release gate would never offer it again.
                    unanswered.append(
                        f"{item.id}=<{item.wants}>" if item.wants else
                        f"{item.id} (name it to run it, or {item.id}=leave)")
                for value in picks:
                    if value == "leave" and not item.wants:
                        # A yes/no choice declined by name: nothing is run,
                        # and the release gate does not offer it again.
                        left_ids.add(item.id)
                        did.append((item.id, f"{item.id}\tleft as it is"))
                        if item.on_leave:
                            did.extend((item.id, f"{item.id}\t{line}")
                                       for line in item.on_leave())
                        used.add(item.id)
                        continue
                    if item.wants and not value:
                        raise StepFailed(
                            f"--choose {item.id} needs a value: "
                            f"{item.id}=<{item.wants}>")
                    if item.apply is None:
                        raise StepFailed(f"{item.id} has nothing to run")
                    # its failure is reported; it was offered (#595)
                    used.add(item.id)
                    did.extend((item.id, f"{item.id}\t{line}")
                               for line in item.apply(value))
                    if value == "leave" and item.holds_stamp:
                        left_ids.add(item.id)   # only once it has worked
                    repinned = repinned or (check.name == REPIN
                                            and item.group == WILL)
        except (StepFailed, SettingsUnavailable) as e:
            failed, error = n, f"{check.name}: {e}"
            break
    target = stamp_target(todo, failed, vault_v, plugin_v)
    stamped = (parse_version(target) > parse_version(vault_v)
               and not waited and not unanswered and not stuck)
    if stamped:
        try:
            stamp(vault, target)
        except StepFailed as e:
            stamped = False
            error = error or f"stamp: {e}"
            failed = failed if failed is not None else len(todo)
    if not stamped:
        try:   # the next plan does not ask these again
            write_held(vault, {i for i in left_ids
                               if not i.startswith(TEMPLATE)}, said)
        except (StateUnreadable, OSError) as e:
            print(f"{cli_name()}: answers could not be remembered "
                  f"({e.__class__.__name__}); they will be asked again",
                  file=sys.stderr)
    emit("Did", did)
    for choice in dict.fromkeys(i for i, _v in chosen if i not in used):
        # A choice not every one of whose checks finished was not fully
        # looked for, so "not offered" would be a guess (#595). A failed
        # stamp comes after every check (failed == len(todo)).
        reached = failed is None or _last_check(choice, todo) < failed
        print(f"not offered: {choice}" if reached else
              f"not run: {choice} (the update stopped first)")
    if person or shown:
        emit(TITLES[PERSON], person, shown)
    for label in unanswered:
        print(f"not answered: {label}")
    for label in stuck:
        print(f"not settled: {label}")
    if waited:
        print(WAITED_LINE)
    if failed is not None:
        print(f"{cli_name()}: {error}", file=sys.stderr)
        print(f"stamped {target}; the rest is offered again next time"
              if stamped else "not stamped")
        return 1
    if waited or unanswered or stuck:
        print("not stamped")
    else:
        print(f"stamped {plugin_v}" if stamped else f"already at {plugin_v}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Bring a vault and its site up to the plugin's version.")
    ap.add_argument("vault", help="the vault folder")
    ap.add_argument("command", nargs="?", choices=["plan", "apply"],
                    default="plan", help="plan (writes nothing) or apply (default: plan)")
    ap.add_argument("--choose", action="append", default=[],
                    metavar="ID[=VALUE]",
                    help="apply only: a Your-choice id from plan; repeatable")
    ap.epilog = 'Example: gma migrate "<vault>" plan'
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    vault = Path(args.vault).expanduser()
    if not vault.is_dir():
        print(f"{cli_name()}: not a directory: {vault}", file=sys.stderr)
        return 2
    if args.command == "plan":
        if args.choose:
            print(f"{cli_name()}: --choose goes with apply", file=sys.stderr)
            return 2
        try:
            return run_plan(vault)
        except SettingsUnavailable as e:
            print(f"{cli_name()}: {e}", file=sys.stderr)
            return 1
    chosen: list[tuple[str, str | None]] = []
    for raw in args.choose:
        choice, sep, value = raw.partition("=")
        chosen.append((choice, value if sep else None))
    return run_apply(vault, chosen)


if __name__ == "__main__":
    sys.exit(main())

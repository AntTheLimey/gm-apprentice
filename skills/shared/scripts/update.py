#!/usr/bin/env python3
"""update.py: `gma update`, the vault update as one command.

    gma update VAULT [--answer ID=VALUE]... [--headless] [--json]

Every change a check finds is one of three kinds (`Check.kind`):
bookkeeping changes form and keeps content, so it runs in every run,
headless too, and is reported; removes could delete what the GM or their
agent wrote, and asks needs a value only the GM has, so both are put to
the GM as questions. A question is answered with `--answer ID=VALUE` on the
next run. Every answer is kept in the update record (`_meta/update-record.json`)
against the lines it was asked with, so it is never asked again while
those lines stay the same.

Order: the version gate (a refusal is exit 2); what every check finds;
nothing to do is exit 0 with nothing written; else a backup of the notes,
then the bookkeeping and the answered questions, in run order; the stamp,
by migrate.py's rules (a question that would never be offered again past
the stamp holds it); the record; the report.

Exit: 0 done or nothing to do; 1 a step failed (the vault is stamped at the
last release whose steps all finished); 2 refused (the gate, bad
arguments); 3 questions are waiting for the GM.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import migrate
import update_backup
import update_record
from migrate_core import CHOICE, PERSON, Check, Item, StepFailed
from update_record import AnswerEntry, lines_sha
from vaultlib import (SettingsUnavailable, StateUnreadable, cli_name,
                      parse_version, read_held, write_held)

HOME: Path | None = None   # where backups go; None is the home folder
UNREADABLE = "template-unreadable:"
# Checks whose apply lines are already written for the GM.
PLAIN_LINES = {"templates"}
YES_NO = ["yes", "leave"]
SHOWN_LINES = 3   # a question's text shows this many of its lines


@dataclass
class Question:
    id: str
    kind: str                 # removes, asks, or person (fix it by hand)
    text: str
    options: list[str]        # "<...>" is a value the GM writes; none: by hand
    detail: dict[str, object] = field(default_factory=dict)


@dataclass
class UpdateResult:
    exit: int = 0
    vault: str = ""
    from_version: str | None = None
    to_version: str | None = None   # the plugin's version
    did: list[str] = field(default_factory=list)
    questions: list[Question] = field(default_factory=list)
    read_problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    left_open: list[str] = field(default_factory=list)
    stamped: str | None = None
    backup: str | None = None
    headless: bool = False
    error: str | None = None


def _today() -> str:
    return datetime.date.today().isoformat()


def options(item: Item) -> list[str]:
    """What the GM may answer: a value choice's words ("dark, light or
    leave"), else yes or leave."""
    if not item.wants:
        return list(YES_NO)
    words = [w.strip() for part in item.wants.split(" or ")
             for w in part.split(",")]
    return [w if " " not in w else f"<{w}>" for w in words if w]


def _fits(value: str, allowed: list[str]) -> bool:
    """`leave` is always an answer (a template's leave is a keep)."""
    return (value in allowed or value == "leave"
            or any(o.startswith("<") for o in allowed))


def _row(line: str) -> str:
    head, tab, rest = line.partition("\t")
    return f"{head}: {rest}" if tab and head else rest if tab else line


def _question(check: Check, item: Item) -> Question:
    if item.group == PERSON:
        return Question(item.id, "person", "; ".join(_row(x) for x in item.lines),
                        [], {"lines": list(item.lines)})
    shown = [_row(x) for x in item.lines[:SHOWN_LINES]]
    more = len(item.lines) - SHOWN_LINES
    text = "; ".join(shown) + (f"; and {more} more" if more > 0 else "")
    detail: dict[str, object] = dict(item.detail or {})
    said = detail.get("summary")
    if isinstance(said, str) and said:
        text = f"{text} ({said})"
    detail.setdefault("lines", list(item.lines))
    detail.setdefault("check", check.title)
    detail.setdefault("if_yes", check.ask or check.plain)
    kind = kind_of(check, item)
    kind = kind if kind in ("removes", "asks") else "asks"
    return Question(item.id, kind, text, options(item), detail)


def kind_of(check: Check, item: Item) -> str:
    """The item's own kind, else its check's; none is asks."""
    return item.kind or check.kind or "asks"


def _asks(check: Check, item: Item) -> bool:
    """Is this item put to the GM, rather than run?"""
    return bool(item.wants) or kind_of(check, item) != "bookkeeping"


def _holds(check: Check, item: Item) -> bool:
    """Does leaving this item open hold the stamp? A PERSON row only when
    it says so; a question also when its check is release-gated, since past
    the stamp it would never be offered again."""
    if item.group == PERSON:
        return item.holds_stamp
    return item.holds_stamp or check.release is not None


def _answer_for(item: Item, given: dict[str, str],
                answers: dict[str, AnswerEntry]) -> tuple[str | None, bool]:
    """(the answer, whether the GM gave it this run). The record answers
    only with a standing answer (leave, keep), and only while the item's
    lines are the ones it was given against."""
    if item.id in given:
        return given[item.id], True
    return migrate.recorded(item, answers), False


def _would_write(found: list[migrate.Found], given: dict[str, str],
                 answers: dict[str, AnswerEntry],
                 held: dict[str, set[str]]) -> bool:
    for f in found:
        if f.waiting or f.failed is not None:
            return True
        for item in f.items:
            if item.group == PERSON:
                if item.notice and item.id not in held["said"]:
                    return True   # said once: the run remembers it said it
                continue
            if not _asks(f.check, item):
                return True
            if item.id in given:
                return True
    return False


def _refuse(res: UpdateResult, why: str) -> UpdateResult:
    res.exit, res.error = 2, why
    return res


def run(vault: Path, answers: dict[str, str], headless: bool, *,
        checks: list[Check] | None = None,
        home: Path | None = None) -> UpdateResult:
    """Update the vault; see the module docstring."""
    res = UpdateResult(vault=vault.name, headless=headless)
    if headless and answers:
        return _refuse(res, "a headless run takes no --answer: there is no "
                            "GM to have given one")
    gate = migrate.gate(vault)
    if isinstance(gate, str):
        return _refuse(res, gate)
    vault_v, plugin_v = gate
    res.from_version, res.to_version = vault_v, plugin_v
    try:
        record = update_record.load(vault)
        held = read_held(vault)
    except (StepFailed, StateUnreadable) as e:
        res.exit, res.error = 1, f"{e}; nothing was changed"
        return res
    known = record["answers"]
    todo = migrate.offered(migrate.CHECKS if checks is None else checks,
                           vault_v, plugin_v)
    behind = parse_version(vault_v) < parse_version(plugin_v)
    found = migrate.collect(vault, todo)
    for f in found:   # an answer the GM gave must fit, before any write
        for item in f.items:
            if item.id in answers and item.group != PERSON \
                    and not _fits(answers[item.id], options(item)):
                return _refuse(res, f"--answer {item.id}={answers[item.id]}: "
                                    f"the answers are {', '.join(options(item))}")
    if not behind and not _would_write(found, answers, known, held):
        for f in found:
            for item in f.items:
                _sort_unapplied(f.check, item, held, known, res)
        _unused(answers, set(), found, res)
        res.exit = 3 if res.questions else 0
        return res
    if behind:
        try:   # the stamp is written last; find out now that it can be
            migrate.check_stampable(vault)
        except StepFailed as e:
            res.exit, res.error = 1, f"{e}; nothing was changed"
            return res
    _apply(vault, todo, answers, known, held, vault_v, plugin_v, res,
           home if home is not None else HOME)
    return res


def _sort_unapplied(check: Check, item: Item, held: dict[str, set[str]],
                    known: dict[str, AnswerEntry], res: UpdateResult) -> None:
    """File an item the run does not apply: a read problem, a note, or a
    question."""
    if item.group == PERSON and item.id.startswith(UNREADABLE):
        res.read_problems.extend(_row(x) for x in item.lines)
    elif item.group == PERSON and item.notice:
        if item.id not in held["said"]:
            res.notes.extend(_row(x) for x in item.lines)
    elif not migrate.answered(item, held, known):
        res.questions.append(_question(check, item))
        res.left_open.append(item.id)


def _unused(given: dict[str, str], used: set[str],
            found: list[migrate.Found], res: UpdateResult) -> None:
    seen = {i.id for f in found for i in f.items}
    for choice, value in given.items():
        if choice not in used and choice not in seen:
            res.notes.append(f"Your answer {choice}={value} was not used: "
                             f"nothing asks it now.")


class _Run:
    """What a run has done so far, and the backup taken before its first
    write (a run that writes nothing takes none)."""

    def __init__(self, vault: Path, res: UpdateResult, home: Path | None,
                 vault_v: str, plugin_v: str) -> None:
        self.vault, self.res, self.home = vault, res, home
        self.vault_v, self.plugin_v = vault_v, plugin_v
        self.did: dict[str, None] = {}          # plain sentences, once each
        self.new: dict[str, AnswerEntry] = {}   # answers that finished
        self.asked: list[str] = []

    def before_write(self) -> None:
        if self.res.backup is None:
            try:
                self.res.backup = str(update_backup.backup(self.vault,
                                                           home=self.home))
            except update_backup.BackupFailed as e:
                raise StepFailed(f"the backup could not be made ({e}); "
                                 f"nothing more was changed") from e

    def wrote(self) -> bool:
        return bool(self.did or self.new)

    def record(self, to: str) -> None:
        """Append this run to the record, with the answers that finished."""
        self.before_write()   # first, so the entry names the backup
        self.res.did = list(self.did)
        entry: update_record.UpdateEntry = {
            "from": self.vault_v, "to": to, "on": _today(),
            "did": self.res.did, "asked": self.asked,
            "left_open": list(self.res.left_open),
            "backup": self.res.backup or ""}
        _save_record(self.vault, self.new, entry)


def _apply(vault: Path, todo: list[Check], given: dict[str, str],
           known: dict[str, AnswerEntry], held: dict[str, set[str]],
           vault_v: str, plugin_v: str, res: UpdateResult,
           home: Path | None) -> None:
    run = _Run(vault, res, home, vault_v, plugin_v)
    used: set[str] = set()
    left_ids: set[str] = set()
    said: set[str] = set()
    holding: list[str] = []
    seen: list[migrate.Found] = []
    failed: int | None = None
    try:
        for n, check in enumerate(todo):
            try:
                items = check.find(vault)
                seen.append(migrate.Found(check, items))
                for item in items:
                    _one(run, check, item, given, known, held, used,
                         left_ids, said, holding)
            except (StepFailed, SettingsUnavailable) as e:
                failed, res.error = n, f"{check.name}: {e}"
                break
    except BaseException as original:
        # Not a failure the checks know: keep what finished, then let it go.
        # The original error stays the one raised; a record that cannot be
        # written is said beside it.
        if run.wrote():
            try:
                run.record(vault_v)
            except Exception as e:
                print(f"{cli_name()}: the update record could not be written "
                      f"({e})", file=sys.stderr)
                note = getattr(original, "add_note", None)   # Python 3.11+
                if note is not None:
                    note(f"the update record could not be written: {e}")
        raise
    _unused(given, used, seen, res)
    target = migrate.stamp_target(todo, failed, vault_v, plugin_v)
    stamping = parse_version(target) > parse_version(vault_v) and not holding
    if run.wrote() or stamping:
        try:
            run.record(target if stamping else vault_v)
        except (StepFailed, OSError) as e:
            stamping = False   # an answer not kept must not be passed by the stamp
            res.error = res.error or (f"the update record could not be "
                                      f"written ({e}); the answers will be "
                                      f"asked again")
            failed = len(todo) if failed is None else failed
    if stamping:
        try:
            migrate.stamp(vault, target)
            res.stamped = target
        except StepFailed as e:
            res.error = res.error or f"stamp: {e}"
            failed = len(todo) if failed is None else failed
            try:   # the record must not claim a stamp that was not written
                _fix_last_to(vault, vault_v)
            except (StepFailed, OSError):
                pass   # the error above is already the run's report
    left = {i for i in left_ids if not i.startswith(migrate.TEMPLATE)}
    if res.stamped is None and (left or said - held["said"]):
        try:   # migrate.py's plan does not ask these again either
            run.before_write()
            write_held(vault, left, said)
        except (StateUnreadable, OSError, StepFailed) as e:
            res.notes.append(f"What this run said could not be remembered "
                             f"({e}); it may be said again.")
    res.did = list(run.did)
    res.exit = 1 if failed is not None else 3 if res.questions else 0


def _one(run: _Run, check: Check, item: Item, given: dict[str, str],
         known: dict[str, AnswerEntry], held: dict[str, set[str]],
         used: set[str], left_ids: set[str], said: set[str],
         holding: list[str]) -> None:
    """Run, ask or file one item."""
    res = run.res
    if item.group == PERSON:
        if item.notice:
            said.add(item.id)
        before = len(res.questions)
        _sort_unapplied(check, item, held, known, res)
        if len(res.questions) > before and _holds(check, item):
            holding.append(item.id)
        return
    if not _asks(check, item):
        run.before_write()
        _did(check, item.apply(None) if item.apply else [], run.did)
        return
    answer, now = _answer_for(item, given, known)
    if answer is not None and not now:
        return   # a standing answer the record keeps: nothing to run or ask
    if answer is None:
        if item.group == CHOICE and migrate.answered(item, held):
            return   # an older update's "leave"
        res.questions.append(_question(check, item))
        res.left_open.append(item.id)
        if _holds(check, item):
            holding.append(item.id)
        return
    if not _fits(answer, options(item)):
        raise StepFailed(f"{item.id}: the answers are "
                         f"{', '.join(options(item))}")
    used.add(item.id)
    run.before_write()
    lines: list[str] = []
    if answer == "leave" and not item.wants:
        left_ids.add(item.id)   # a yes/no left: nothing runs
    else:
        if item.apply is None:
            raise StepFailed(f"{item.id} has nothing to run")
        lines = item.apply(None if not item.wants else answer)
        if answer == "leave":
            left_ids.add(item.id)
    if answer == "leave" and check.name not in PLAIN_LINES:
        run.did[check.left or "Left that as it is, as you asked."] = None
    else:
        _did(check, lines, run.did)
    run.asked.append(item.id)
    run.new[item.id] = {"answer": answer, "lines_sha": lines_sha(item.lines),
                        "on": _today(), "plugin": run.plugin_v}


def _did(check: Check, lines: list[str], did: dict[str, None]) -> None:
    if check.name in PLAIN_LINES:
        did.update(dict.fromkeys(lines))
    elif lines:
        did[check.plain] = None


def _save_record(vault: Path, new: dict[str, AnswerEntry],
                 entry: update_record.UpdateEntry) -> None:
    """The answers that finished, the templates found the same as the
    plugin's (their release and plugin refreshed), and this update."""
    import migrate_vault
    rec = update_record.load(vault)
    rec["answers"].update(new)
    for name, same in migrate_vault.same_templates(vault).items():
        old = rec["templates"].get(name)
        if not (isinstance(old, dict)
                and update_record._same_entry(old, same)):
            rec["templates"][name] = same
    rec["updates"].append(entry)
    update_record.save(vault, rec)


def _fix_last_to(vault: Path, to: str) -> None:
    rec = update_record.load(vault)
    if rec["updates"]:
        rec["updates"][-1]["to"] = to
        update_record.save(vault, rec)


def report(res: UpdateResult) -> str:
    """The plain report: what was done, what waits, what could not be read."""
    out: list[str] = []
    name = res.vault
    if res.exit == 2:
        return f"Refused: {res.error}\n"
    verb = "Updated" if res.did else "Checked"
    if res.stamped:
        out.append(f"Updated {name} from {res.from_version} to {res.stamped}.")
    elif res.from_version != res.to_version:
        out.append(f"{verb} {name}; it stays at {res.from_version}"
                   + ("." if res.error else
                      " until what waits below is settled."))
    elif res.did:
        out.append(f"Updated {name}, which was already at {res.from_version}.")
    else:
        out.append(f"Checked {name} (at {res.from_version}); nothing was "
                   f"changed.")
    if res.error:
        out.append(f"Stopped: {res.error}. What finished is kept; run the "
                   f"update again once this is fixed.")
    sections = [("Done:", res.did),
                (f"Waiting for you ({len(res.questions)}):",
                 [q.text for q in res.questions]),
                ("Could not read:", res.read_problems),
                ("Worth knowing:", res.notes)]
    for title, lines in sections:
        if lines:
            out.append("")
            out.append(title)
            out.extend(f"- {line}" for line in lines)
    if res.headless:
        out.append("")
        n = len(res.questions)
        left = "1 question was" if n == 1 else f"{n} questions were"
        out.append(f"Run without a GM: {left} left for next time; "
                   f"nothing was asked.")
    if res.backup:
        out.append("")
        out.append(f"Backup: {res.backup}")
    return "\n".join(out) + "\n"


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Update a vault and its site to the plugin's version: "
                    "does the bookkeeping, asks what only the GM can answer, "
                    "and reports in plain words.")
    ap.add_argument("vault", help="the vault folder")
    ap.add_argument("--answer", action="append", default=[],
                    metavar="ID=VALUE",
                    help="the GM's answer to a waiting question, by its id")
    ap.add_argument("--headless", action="store_true",
                    help="no GM to ask: do the bookkeeping only and leave "
                         "every question for next time")
    ap.add_argument("--json", action="store_true",
                    help="print the result as JSON instead of the report")
    ap.epilog = ("Example: gma update ~/Vaults/Canticle "
                 "--answer template:pc-coc-7e-regency.md=keep")
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
    given: dict[str, str] = {}
    for raw in args.answer:
        choice, sep, value = raw.partition("=")
        if not sep or not choice or not value:
            print(f"{cli_name()}: --answer {raw}: write it as ID=VALUE",
                  file=sys.stderr)
            return 2
        given[choice] = value
    try:
        res = run(vault, given, args.headless)
    except SettingsUnavailable as e:
        print(f"{cli_name()}: {e}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(asdict(res), indent=2, ensure_ascii=False))
    elif res.exit == 2:
        print(f"{cli_name()}: {res.error}", file=sys.stderr)
    else:
        sys.stdout.write(report(res))
    return res.exit


if __name__ == "__main__":
    sys.exit(main())

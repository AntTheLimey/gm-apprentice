#!/usr/bin/env python3
"""update.py: `gma update`, the vault update as one command.

    gma update VAULT [--answer <id>@<hash>=VALUE]... [--headless] [--json]

Every change a check finds is one of three kinds (`Check.kind`):
bookkeeping changes form and keeps content, so it runs in every run,
headless too, and is reported; removes could delete what the GM or their
agent wrote, and asks needs a value only the GM has, so both are put to
the GM as questions. A question is answered with `--answer ID@HASH=VALUE`
on the next run, by the id the report printed: the hash names the text the
GM was shown, so an answer is applied only while that text is unchanged
(else the question is asked again). Every answer is kept in the update record (`_meta/update-record.json`)
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
import re
import shutil
import subprocess
import sys
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path

import github_issues
import migrate
import update_backup
import update_record
from migrate_core import CHOICE, PERSON, Check, Item, StepFailed
from update_record import AnswerEntry, lines_sha
from vaultlib import (SettingsUnavailable, StateUnreadable, cli_name,
                      parse_version, read_held, utf8_output, write_held)

HOME: Path | None = None   # where backups go; None is the home folder
UNREADABLE = ("template-unreadable:", "agent-block-unreadable:")
# Checks whose apply lines are already written for the GM.
PLAIN_LINES = {"templates", "agent-block"}
YES_NO = ["yes", "leave"]
SHOWN_LINES = 3   # a question's text shows this many of its lines
HASH_LEN = 8      # an answer id's hash: `<id>@<8 hex>`
ASKED_RE = re.compile(rf"(.+)@([0-9a-f]{{{HASH_LEN}}})")
WORKAROUND = "workaround:"   # a workaround question's id is this + its id
WORKAROUND_OPTIONS = ["retire", "keep"]
NO_SWEEP = ("No workaround record yet: run the one-time sweep "
            "(campaign-organizer/references/workaround-sweep.md).")
NO_GITHUB = ("Could not ask GitHub whether the issues these workarounds wait "
             "on are fixed, so they were not checked; the next update asks "
             "again.")
GH_TIMEOUT = 5.0   # seconds GitHub gets per question; a slow answer stops the rest
_RELEASE = re.compile(r"\d+\.\d+\.\d+")


@dataclass(frozen=True)
class Given:
    """An --answer as the GM gave it: the hash names the text they saw."""
    value: str
    hash: str | None   # None: a bare id, which is never applied
    raw: str           # the id as written


def split_answers(answers: dict[str, str]) -> dict[str, Given]:
    """`{"<id>@<hash>": value}` by the item id each answers."""
    out: dict[str, Given] = {}
    for key, value in answers.items():
        m = ASKED_RE.fullmatch(key)
        out[m.group(1) if m else key] = Given(value, m.group(2) if m else None,
                                              key)
    return out


def asked_hash(item: Item) -> str:
    """The hash of what the GM is shown for this item: a template's two
    texts (`detail.texts_sha`), else its lines."""
    texts = (item.detail or {}).get("texts_sha")
    return (texts if isinstance(texts, str) else lines_sha(item.lines))[:HASH_LEN]


def asked_id(item: Item) -> str:
    return f"{item.id}@{asked_hash(item)}"


def _matches(item: Item, given: dict[str, Given]) -> str | None:
    """The GM's answer for this item, only if it names the text it has now."""
    g = given.get(item.id)
    return g.value if g is not None and g.hash == asked_hash(item) else None


def _offered(item: Item, given: dict[str, Given], res: UpdateResult,
             answers: dict[str, AnswerEntry] | None = None) -> str | None:
    """_matches, saying in Worth knowing why an answer given was not used."""
    g = given.get(item.id)
    if g is None:
        return None
    if g.hash == asked_hash(item):
        return g.value
    if answers and migrate.recorded(item, answers) is not None:
        note = (f"Your answer {g.raw}={g.value} was not used: {item.id} was "
                f"already answered (kept as it is), so nothing is asked.")
        if note not in res.notes:
            res.notes.append(note)
        return None
    why = (f"{item.id} changed since you were asked" if g.hash is not None
           else f"it does not name the question as it was shown "
                f"({asked_id(item)}), so it may be for other text")
    note = (f"Your answer {g.raw}={g.value} was not used: {why}; it is asked "
            f"again below.")
    if note not in res.notes:
        res.notes.append(note)
    return None


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
    return Question(asked_id(item), kind, text, options(item), detail)


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


def _answer_for(item: Item, given: dict[str, Given],
                answers: dict[str, AnswerEntry],
                res: UpdateResult) -> tuple[str | None, bool]:
    """(the answer, whether the GM gave it this run). A given answer counts
    only for the text it names; one that does not is asked again. The
    record answers only with a standing answer (leave, keep), and only
    while the item's lines are the ones it was given against."""
    if item.id in given:
        value = _offered(item, given, res, answers)
        return value, value is not None
    return migrate.recorded(item, answers), False


def _would_write(found: list[migrate.Found], given: dict[str, Given],
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
            if _matches(item, given) is not None:
                return True
    return False


@dataclass
class _Offers:
    """The workarounds this run offers for retirement, and what the GM
    said to them."""
    questions: list[Question] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    keep: list[str] = field(default_factory=list)    # workaround ids
    ids: set[str] = field(default_factory=set)       # every item id offered
    refused: str | None = None   # an answer outside the options


def _offers(record: update_record.Record, plugin_v: str,
            given: dict[str, Given]) -> _Offers:
    """Every active workaround whose issue GitHub says was closed as fixed
    before the installed release came out (or whose release the GM set by
    hand, at or below this one, while GitHub does not say it is still open):
    a question, or the GM's answer to it. A fix may cover only part of what
    the workaround does, so the question asks rather than says. An answer
    counts only for the question text it names (`workaround:<id>@<hash>`),
    as every other does. `keep` is recorded in the workaround and stands;
    `retire` changes nothing here: the agent swaps it for the built-in way
    and runs `gma workaround retire`."""
    out = _Offers()
    if record["swept"] is None:
        out.notes.append(NO_SWEEP)
    active: list[update_record.Workaround] = []
    for w in record["workarounds"]:
        if (isinstance(w, dict) and w.get("id")
                and w.get("state") not in ("active", "kept", "retired")):
            out.notes.append(f"{w['id']} has state '{w.get('state')}' in "
                             f"{update_record.RECORD_FILE}, not active, kept "
                             f"or retired, so it was not checked; fix it there.")
            continue
        if not (isinstance(w, dict) and w.get("state") == "active"
                and w.get("id")):
            continue
        issue, hand = w.get("issue"), w.get("release")
        if not isinstance(issue, int) or isinstance(issue, bool) or issue <= 0:
            out.notes.append(f"{w['id']} has issue '{issue}' in "
                             f"{update_record.RECORD_FILE}, not a number, so "
                             f"it was not checked; fix it there.")
        elif hand is not None and not (isinstance(hand, str)
                                       and _RELEASE.fullmatch(hand)):
            out.notes.append(f"{w['id']} has release '{hand}' in "
                             f"{update_record.RECORD_FILE}, not X.Y.Z, so it "
                             f"was not checked; fix it there.")
        else:
            active.append(w)
    if not active:
        return out
    plugin = parse_version(plugin_v)
    hub = github_issues.GitHub(timeout=GH_TIMEOUT)
    unasked = False
    for w in active:
        issue = int(w["issue"])
        hand = w.get("release")
        info = hub.issue(issue)
        if info is not None and info.state == "open":
            out.notes.append(f"#{issue} is still open, so {w['id']} was not "
                             f"offered.")
            continue
        if hand:
            if parse_version(str(hand)) > plugin:
                continue
            release = str(hand)
            cite = (f"You set {release} by hand as the release that builds "
                    f"it in.")
        else:
            out_at = hub.published(plugin_v) if info is not None else None
            if info is None or out_at is None:
                unasked = True
                continue
            if info.reason == "not_planned":
                out.notes.append(f"#{issue} was closed as not planned, so "
                                 f"{w['id']} was not offered.")
                continue
            if not github_issues.closed_before(info, out_at):
                continue   # fixed in a later release than this one
            release = plugin_v
            cite = (f"GitHub closed #{issue} as fixed on "
                    f"{str(info.closed_at)[:10]}, before {plugin_v} came out.")
        item_id = f"{WORKAROUND}{w['id']}"
        where_list = w.get("where") or []
        if not isinstance(where_list, list):
            out.notes.append(f"{w['id']} has where in "
                             f"{update_record.RECORD_FILE} that is not a list, "
                             f"so it was not offered; fix it there.")
            continue
        where = ", ".join(str(p) for p in where_list)
        text = (f"{w.get('what')} ({where}) stands in for #{issue}. {cite} "
                f"If that release built in what this stands in for, retire "
                f"it and switch to the built-in way; otherwise keep it.")
        qid = f"{item_id}@{lines_sha([text])[:HASH_LEN]}"
        out.ids.add(item_id)
        g = given.get(item_id)
        answer = g.value if g is not None and g.raw == qid else None
        if g is not None and answer is None:
            why = (f"{item_id} changed since you were asked"
                   if g.hash is not None else
                   f"it does not name the question as it was shown ({qid})")
            out.notes.append(f"Your answer {g.raw}={g.value} was not used: "
                             f"{why}; it is asked again below.")
        if answer is not None and answer not in (*WORKAROUND_OPTIONS, "leave"):
            out.refused = (f"--answer {qid}={answer}: the answers are "
                           f"{', '.join(WORKAROUND_OPTIONS)}")
        elif answer in ("keep", "leave"):
            out.keep.append(str(w["id"]))
        elif answer == "retire":
            out.notes.append(f"Retire {w['id']}: {where}")
        else:
            out.questions.append(Question(
                qid, "asks", text, list(WORKAROUND_OPTIONS),
                {"issue": issue, "release": release,
                 "where": list(w.get("where") or []),
                 "if_yes": "You swap it for the built-in way and remove it, "
                           "then run gma workaround retire.",
                 "if_keep": "It stays, and is not offered again."}))
    if unasked:
        out.notes.append(NO_GITHUB)
    return out


def _add_offers(offers: _Offers, res: UpdateResult) -> None:
    """The workaround questions and notes, after the checks'."""
    res.questions.extend(offers.questions)
    res.left_open.extend(q.id.rsplit("@", 1)[0] for q in offers.questions)
    res.notes.extend(offers.notes)


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
    gate = migrate.gate(vault, res.notes)
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
    given = split_answers(answers)
    offers = _offers(record, plugin_v, given)
    if offers.refused:
        return _refuse(res, offers.refused)
    for f in found:   # an answer the GM gave must fit, before any write
        for item in f.items:
            value = _matches(item, given)
            if value is not None and item.group != PERSON \
                    and not _fits(value, options(item)):
                return _refuse(res, f"--answer {asked_id(item)}={value}: "
                                    f"the answers are {', '.join(options(item))}")
    if not behind and not offers.keep \
            and not _would_write(found, given, known, held):
        for f in found:
            for item in f.items:
                if item.group != PERSON and _asks(f.check, item):
                    _offered(item, given, res, known)
                _sort_unapplied(f.check, item, held, known, res)
        _add_offers(offers, res)
        _unused(given, offers.ids, found, res)
        res.exit = 3 if res.questions else 0
        return res
    if behind:
        try:   # the stamp is written last; find out now that it can be
            migrate.check_stampable(vault)
        except StepFailed as e:
            res.exit, res.error = 1, f"{e}; nothing was changed"
            return res
    _apply(vault, todo, given, known, held, vault_v, plugin_v, res,
           home if home is not None else HOME, offers)
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


def _unused(given: dict[str, Given], used: set[str],
            found: list[migrate.Found], res: UpdateResult,
            stopped: bool = False) -> None:
    seen = {i.id for f in found for i in f.items}
    by_hand = {i.id for f in found for i in f.items if i.group == PERSON}
    for choice, g in given.items():
        if choice in by_hand:
            res.notes.append(f"Nothing to answer: {choice} is fixed by hand, "
                             f"then the update is run again.")
        elif choice not in used and choice not in seen:
            why = ("the run stopped before it was reached" if stopped
                   else "nothing asks it now")
            res.notes.append(f"Your answer {g.raw}={g.value} was not used: "
                             f"{why}.")


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
        self.kept: list[str] = []               # workarounds the GM keeps

    def before_write(self) -> None:
        if self.res.backup is None:
            try:
                self.res.backup = str(update_backup.backup(self.vault,
                                                           home=self.home))
            except update_backup.BackupFailed as e:
                raise StepFailed(f"the backup could not be made ({e}); "
                                 f"nothing more was changed") from e

    def wrote(self) -> bool:
        return bool(self.did or self.new or self.kept)

    def record(self, to: str) -> None:
        """Append this run to the record, with the answers that finished."""
        self.before_write()   # first, so the entry names the backup
        self.res.did = list(self.did)
        entry: update_record.UpdateEntry = {
            "from": self.vault_v, "to": to, "on": _today(),
            "did": self.res.did, "asked": self.asked,
            "left_open": list(self.res.left_open),
            "backup": self.res.backup or ""}
        _save_record(self.vault, self.new, entry, self.kept, self.plugin_v)


def _apply(vault: Path, todo: list[Check], given: dict[str, Given],
           known: dict[str, AnswerEntry], held: dict[str, set[str]],
           vault_v: str, plugin_v: str, res: UpdateResult,
           home: Path | None, offers: _Offers | None = None) -> None:
    run = _Run(vault, res, home, vault_v, plugin_v)
    offers = offers or _Offers()
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
            except Exception as e:  # noqa: BLE001 - reported, never swallowed
                # Not a failure the checks know: it stops the run like one,
                # so what finished is recorded and reported; the trace goes
                # to stderr for whoever fixes it.
                traceback.print_exc(file=sys.stderr)
                failed, res.error = n, (f"{check.name}: unexpected "
                                        f"{e.__class__.__name__}: {e}")
                break
    except BaseException as original:
        # Interrupted (Ctrl-C, exit): keep what finished, then let it go.
        # The original stays the one raised; a record that cannot be
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
    _add_offers(offers, res)
    for wid in offers.keep:
        run.kept.append(wid)
        run.asked.append(f"{WORKAROUND}{wid}")
        run.did[f"Kept the workaround {wid}; it will not be offered "
                f"again."] = None
    _unused(given, used | offers.ids, seen, res, stopped=failed is not None)
    target = migrate.stamp_target(todo, failed, vault_v, plugin_v)
    stamping = parse_version(target) > parse_version(vault_v) and not holding
    if run.wrote() or stamping:
        try:
            run.record(target if stamping else vault_v)
        except Exception as e:  # noqa: BLE001 - any failure: reported below
            stamping = False   # an answer not kept must not be passed by the stamp
            why = (f"the update record could not be written ({e}); the "
                   f"answers will be asked again")
            if res.error:
                res.notes.append(why[0].upper() + why[1:] + ".")
            else:
                res.error = why
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
            except (StepFailed, OSError) as e2:
                print(f"{cli_name()}: the update record still names {target} "
                      f"as this run's version ({e2})", file=sys.stderr)
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


def _one(run: _Run, check: Check, item: Item, given: dict[str, Given],
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
        _did(check, _unreadable(res, item.apply(None) if item.apply else []),
             run.did)
        return
    answer, now = _answer_for(item, given, known, res)
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


def _unreadable(res: UpdateResult, lines: list[str]) -> list[str]:
    """The apply lines for Done; a file that broke since the find goes to
    Could not read instead."""
    import migrate_vault
    mark = migrate_vault.AGENT_BLOCK_BROKE
    res.read_problems.extend(_row(x[len(mark):]) for x in lines
                             if x.startswith(mark))
    return [x for x in lines if not x.startswith(mark)]


def _did(check: Check, lines: list[str], did: dict[str, None]) -> None:
    if check.name in PLAIN_LINES:
        did.update(dict.fromkeys(lines))
    elif lines:
        did[check.plain] = None


def _save_record(vault: Path, new: dict[str, AnswerEntry],
                 entry: update_record.UpdateEntry,
                 kept: list[str] | None = None, plugin_v: str = "") -> None:
    """The answers that finished, the workarounds the GM keeps, the
    templates found the same as the plugin's, and this update. A template's entry is refreshed only when
    one of its two texts changed: an entry this run's apply wrote (take,
    a copy, an update from a release) is made against the texts as they
    are now, so it stays, with its decision and why."""
    import migrate_vault
    rec = update_record.load(vault)
    rec["answers"].update(new)
    for w in rec["workarounds"]:
        if isinstance(w, dict) and w.get("id") in (kept or []):
            w["state"], w["kept_at"] = "kept", plugin_v
    for name, same in migrate_vault.same_templates(vault).items():
        old = rec["templates"].get(name)
        if not (isinstance(old, dict) and update_record.same_texts(old, same)):
            rec["templates"][name] = same
    rec["updates"].append(entry)
    update_record.save(vault, rec)


def _fix_last_to(vault: Path, to: str) -> None:
    rec = update_record.load(vault)
    if rec["updates"]:
        rec["updates"][-1]["to"] = to
        update_record.save(vault, rec)


def _waiting(q: Question) -> str:
    if not q.options:
        return q.text
    return f"{q.text} [answer {q.id}={'|'.join(q.options)}]"


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
                 [_waiting(q) for q in res.questions]),
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
                    metavar="ID@HASH=VALUE",
                    help="the GM's answer to a waiting question, by the id "
                         "the report printed (the hash names the text the GM "
                         "was shown; a changed question is asked again)")
    ap.add_argument("--headless", action="store_true",
                    help="no GM to ask: do the bookkeeping only and leave "
                         "every question for next time")
    ap.add_argument("--json", action="store_true",
                    help="print the result as JSON instead of the report")
    ap.epilog = ("Example: gma update ~/Vaults/Canticle "
                 "--answer template:pc-coc-7e-regency.md@1a2b3c4d=keep")
    return ap


def _emit(res: UpdateResult, as_json: bool) -> None:
    """Print the result. The report is what the GM must see, so a stream
    that cannot take a character gets it with that character escaped."""
    if as_json:
        data = asdict(res)
        data["report"] = report(res)
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    elif res.exit == 2:
        print(f"{cli_name()}: {res.error}", file=sys.stderr)
        return
    else:
        text = report(res)
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except (UnicodeError, ValueError):
        buffer = getattr(sys.stdout, "buffer", None)
        if buffer is None:
            raise
        buffer.write(text.encode("ascii", "backslashreplace"))
        buffer.flush()


def main(argv: list[str] | None = None) -> int:
    utf8_output()
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
            print(f"{cli_name()}: --answer {raw}: write it as ID@HASH=VALUE",
                  file=sys.stderr)
            return 2
        given[choice] = value
    try:
        res = run(vault, given, args.headless)
    except Exception as e:  # noqa: BLE001 - the report says it, exit 1
        if not isinstance(e, SettingsUnavailable):
            traceback.print_exc(file=sys.stderr)
        res = UpdateResult(exit=1, vault=vault.name, headless=args.headless,
                           error=(str(e) if isinstance(e, SettingsUnavailable)
                                  else f"unexpected {e.__class__.__name__}: {e}"))
    _emit(res, args.json)
    return res.exit


if __name__ == "__main__":
    sys.exit(main())

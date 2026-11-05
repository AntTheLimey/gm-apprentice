#!/usr/bin/env python3
"""update_record.py: the update's lasting record, `_meta/update-record.json`.

What the update decided about each template (and why), and what each
update did. It is a file of its own, so stamping the version (which clears
`update_held` in vault-state.json) never touches it: a decision made once
is not asked again while both texts it was made against stay the same.
Library module, no CLI.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal, Optional, TypedDict

from migrate_core import StepFailed, write_text_atomic

RECORD_FILE = "_meta/update-record.json"
FIX = (f"Fix: restore {RECORD_FILE} from the latest update backup "
       f"(~/.gm-apprentice/backups/), or delete it and answer the template "
       f"questions again.")


class TemplateEntry(TypedDict):
    state: Literal["plugin", "gms"]   # whose text the vault's copy is
    matches: Optional[str]            # the release it equals, if any
    decision: Optional[Literal["keep", "take"]]
    file_sha: str                     # migrate_vault.text_hash of the vault's copy
    shipped_sha: str                  # ... and of the plugin's text it was compared with
    plugin: str                       # the plugin version that recorded it
    on: str                           # ISO date
    why: str                          # one plain sentence


# `from` is a Python keyword, so this one is spelt the functional way.
UpdateEntry = TypedDict("UpdateEntry", {
    "from": str, "to": str, "on": str, "did": list[str], "asked": list[str],
    "left_open": list[str], "backup": str})

WorkaroundKind = Literal["note", "field", "css", "script", "meta", "memory"]
WORKAROUND_KINDS: tuple[str, ...] = ("note", "field", "css", "script", "meta",
                                     "memory")


class Workaround(TypedDict):
    """Something the GM or their agent built to stand in for a plugin
    issue, kept so the update can offer to retire it once the issue ships."""
    id: str                  # a slug of `what`, unique in the record
    issue: int               # the gm-apprentice GitHub issue it stands in for
    what: str                # one plain line
    where: list[str]         # vault-relative paths, or memory:<file>
    kind: WorkaroundKind
    added: str               # ISO date
    release: Optional[str]   # by hand: the release that ships it, over the CHANGELOG's
    state: Literal["active", "kept", "retired"]
    kept_at: Optional[str]   # the plugin version when the GM said keep
    retired: Optional[str]   # date and reason


class AnswerEntry(TypedDict):
    """The GM's answer to one question, kept against the lines it was asked
    with: while a check finds the same lines, the answer stands."""
    answer: str
    lines_sha: str   # lines_sha of the item's lines when it was answered
    on: str          # ISO date
    plugin: str      # the plugin version that asked


def lines_sha(lines: list[str]) -> str:
    """The sha256 of an item's lines, joined by newlines."""
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


class Record(TypedDict):
    templates: dict[str, TemplateEntry]
    answers: dict[str, AnswerEntry]
    updates: list[UpdateEntry]
    workarounds: list[Workaround]
    swept: Optional[str]


class RecordUnreadable(StepFailed):
    """The record exists but cannot be read: never written over."""


def empty() -> Record:
    return {"templates": {}, "answers": {}, "updates": [], "workarounds": [],
            "swept": None}


def load(vault: Path) -> Record:
    """The vault's record; an empty one when it has none yet. A record that
    cannot be read raises RecordUnreadable rather than read as empty, so
    the decisions in it are never lost to a save."""
    path = vault / RECORD_FILE
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return empty()
    except (OSError, UnicodeDecodeError) as e:
        raise RecordUnreadable(f"{RECORD_FILE} cannot be read "
                               f"({e.__class__.__name__}). {FIX}") from e
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise RecordUnreadable(f"{RECORD_FILE} is not valid JSON "
                               f"(line {getattr(e, 'lineno', '?')}). {FIX}") from e
    if not isinstance(data, dict):
        raise RecordUnreadable(f"{RECORD_FILE} does not hold a JSON object. {FIX}")
    rec = empty()
    for key, kind in (("templates", dict), ("answers", dict), ("updates", list),
                      ("workarounds", list)):
        if key in data:
            if not isinstance(data[key], kind):
                raise RecordUnreadable(f"{RECORD_FILE}: {key} is not a "
                                       f"{'list' if kind is list else 'mapping'}. {FIX}")
            rec[key] = data[key]  # type: ignore[literal-required]
    swept = data.get("swept")
    rec["swept"] = swept if isinstance(swept, str) else None
    return rec


def dumps(rec: Record) -> str:
    return json.dumps(rec, indent=2, ensure_ascii=False) + "\n"


def save(vault: Path, rec: Record) -> None:
    """Write the record whole, atomically (a failure leaves the old one)."""
    write_text_atomic(vault / RECORD_FILE, dumps(rec))


def _same_entry(a: TemplateEntry, b: TemplateEntry) -> bool:
    """The same entry but for the day it was written."""
    return {k: v for k, v in a.items() if k != "on"} == \
        {k: v for k, v in b.items() if k != "on"}


def same_texts(a: TemplateEntry, b: TemplateEntry) -> bool:
    """Two entries made against the same two texts (the vault's copy and
    the plugin's)."""
    return (a.get("file_sha"), a.get("shipped_sha")) == \
        (b.get("file_sha"), b.get("shipped_sha"))


def record_templates(vault: Path, entries: dict[str, TemplateEntry],
                     refresh: dict[str, TemplateEntry] | None = None) -> bool:
    """Merge `entries` (what an apply decided) into the record's templates,
    and `refresh` (templates found the same as the plugin's) where the
    record has no entry made against the same two texts; save it only when
    that changes something. An entry that differs only in its date keeps
    the old one. True when the file was written."""
    rec = load(vault)
    changed = False
    for name, entry in (refresh or {}).items():
        old = rec["templates"].get(name)
        if name not in entries and not (isinstance(old, dict)
                                        and same_texts(old, entry)):
            rec["templates"][name] = entry
            changed = True
    for name, entry in entries.items():
        old = rec["templates"].get(name)
        if isinstance(old, dict) and _same_entry(old, entry):
            continue
        rec["templates"][name] = entry
        changed = True
    if changed:
        save(vault, rec)
    return changed

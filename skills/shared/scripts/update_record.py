#!/usr/bin/env python3
"""update_record.py: the update's lasting record, `_meta/update-record.json`.

What the update decided about each template (and why), and what each
update did. It is a file of its own, so stamping the version (which clears
`update_held` in vault-state.json) never touches it: a decision made once
is not asked again while both texts it was made against stay the same.
Library module, no CLI.
"""

from __future__ import annotations

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

Workaround = dict[str, object]   # PR D gives it its fields


class Record(TypedDict):
    templates: dict[str, TemplateEntry]
    updates: list[UpdateEntry]
    workarounds: list[Workaround]
    swept: Optional[str]


class RecordUnreadable(StepFailed):
    """The record exists but cannot be read: never written over."""


def empty() -> Record:
    return {"templates": {}, "updates": [], "workarounds": [], "swept": None}


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
    for key, kind in (("templates", dict), ("updates", list),
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


def record_templates(vault: Path, entries: dict[str, TemplateEntry]) -> bool:
    """Merge `entries` into the record's templates and save it, only when
    that changes something; an entry that differs only in its date keeps
    the old one. True when the file was written."""
    rec = load(vault)
    changed = False
    for name, entry in entries.items():
        old = rec["templates"].get(name)
        if isinstance(old, dict) and _same_entry(old, entry):
            continue
        rec["templates"][name] = entry
        changed = True
    if changed:
        save(vault, rec)
    return changed

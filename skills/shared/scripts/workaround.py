#!/usr/bin/env python3
"""workaround.py: `gma workaround`, the record of the vault's workarounds.

    gma workaround add VAULT --issue N --what TEXT --kind K --where PATH
                       [--where PATH]... [--release X.Y.Z]
    gma workaround list VAULT [--json]
    gma workaround keep VAULT ID
    gma workaround retire VAULT ID --reason TEXT
    gma workaround scan VAULT [--memory DIR] [--json]
    gma workaround swept VAULT

A workaround is something the GM or their agent built to stand in for a
gm-apprentice issue: a note, a field, a CSS section, a site script, a
`_meta` note, an agent memory note. It is kept in `_meta/update-record.json`
under the issue it stands in for, so `gma update` can offer to retire it
once a release ships that issue. `scan` lists candidate lines for the
one-time sweep and records nothing; the agent shows the GM each one and
`add`s only those the GM says yes to, then runs `swept`.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import update_record
from migrate_core import StepFailed
from update_record import WORKAROUND_KINDS, Workaround
from vaultlib import cli_name, extract_frontmatter, plugin_version, vault_files

MEMORY = "memory:"
SHOWN = 160   # a scan line's text is trimmed to this many characters
_ISSUE_REFS = re.compile(
    r"github\.com/AntTheLimey/gm-apprentice/issues/(\d+)|(?<![\w&])#(\d{1,6})\b")
_VERSION = re.compile(r"^\d+(\.\d+)*$")


class Refused(ValueError):
    """The call is wrong; nothing was written."""


def _today() -> str:
    return datetime.date.today().isoformat()


def slug(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return "-".join(words)[:48].strip("-") or "workaround"


def _check_where(vault: Path, where: list[str]) -> list[str]:
    if not where:
        raise Refused("give at least one --where")
    out: list[str] = []
    for raw in where:
        if raw.startswith(MEMORY):
            if not raw[len(MEMORY):].strip():
                raise Refused(f"--where {raw}: name the memory file after "
                              f"{MEMORY}")
            out.append(raw)
            continue
        rel = Path(raw)
        if rel.is_absolute() or ".." in rel.parts:
            raise Refused(f"--where {raw}: write a path inside the vault, "
                          f"relative to it (or {MEMORY}<file> for agent memory)")
        if not (vault / rel).exists():
            raise Refused(f"--where {raw}: no such file or folder in the vault")
        out.append(rel.as_posix())
    return out


def add(vault: Path, issue: int, what: str, kind: str, where: list[str],
        release: str | None = None) -> Workaround:
    """Record a workaround; its id is a slug of `what`, made unique."""
    if issue <= 0:
        raise Refused(f"--issue {issue}: an issue number is a positive whole number")
    if kind not in WORKAROUND_KINDS:
        raise Refused(f"--kind {kind}: the kinds are {', '.join(WORKAROUND_KINDS)}")
    if not what.strip():
        raise Refused("--what: say in one line what the workaround is")
    if release is not None and not _VERSION.match(release):
        raise Refused(f"--release {release}: write a release as X.Y.Z")
    paths = _check_where(vault, where)
    rec = update_record.load(vault)
    taken = {str(w.get("id")) for w in rec["workarounds"] if isinstance(w, dict)}
    base = slug(what)
    wid, n = base, 2
    while wid in taken:
        wid, n = f"{base}-{n}", n + 1
    entry: Workaround = {
        "id": wid, "issue": issue, "what": what.strip(), "where": paths,
        "kind": kind, "added": _today(), "release": release,  # type: ignore[typeddict-item]
        "state": "active", "kept_at": None, "retired": None}
    rec["workarounds"].append(entry)
    update_record.save(vault, rec)
    return entry


def _find(rec: update_record.Record, wid: str) -> Workaround:
    for w in rec["workarounds"]:
        if isinstance(w, dict) and w.get("id") == wid:
            return w
    known = [str(w.get("id")) for w in rec["workarounds"] if isinstance(w, dict)]
    raise Refused(f"no workaround '{wid}' in the record"
                  + (f"; the ids are {', '.join(known)}" if known else ""))


def keep(vault: Path, wid: str) -> Workaround:
    """The GM keeps it: it is not offered for retirement again."""
    rec = update_record.load(vault)
    w = _find(rec, wid)
    found = plugin_version()
    w["state"], w["kept_at"] = "kept", found[0] if found else None
    update_record.save(vault, rec)
    return w


def retire(vault: Path, wid: str, reason: str) -> Workaround:
    """The agent has swapped it for the built-in way and removed it."""
    if not reason.strip():
        raise Refused("--reason: say in a few words why it was retired")
    rec = update_record.load(vault)
    w = _find(rec, wid)
    w["state"], w["retired"] = "retired", f"{_today()}: {reason.strip()}"
    update_record.save(vault, rec)
    return w


def swept(vault: Path) -> str:
    """The one-time sweep is done: the update stops asking for it."""
    rec = update_record.load(vault)
    today = _today()
    rec["swept"] = today
    update_record.save(vault, rec)
    return today


@dataclass
class Hit:
    file: str          # vault-relative, or memory:<path under --memory>
    line: int
    issues: list[int]
    text: str


def _hits(name: str, text: str) -> list[Hit]:
    out: list[Hit] = []
    for n, line in enumerate(text.splitlines(), 1):
        nums = [int(a or b) for a, b in _ISSUE_REFS.findall(line)]
        if nums:
            shown = line.strip()
            if len(shown) > SHOWN:
                shown = shown[:SHOWN - 1] + "…"
            out.append(Hit(name, n, list(dict.fromkeys(nums)), shown))
    return out


def _is_workaround_note(rel: str, text: str) -> bool:
    if "workaround" in Path(rel).stem.lower():
        return True
    fm = extract_frontmatter(text) or {}
    tags = fm.get("tags")
    tags = tags if isinstance(tags, list) else [tags] if tags else []
    return any("workaround" in str(t).lower() for t in tags)


def scan(vault: Path, memory: Path | None = None) -> list[Hit]:
    """Lines that cite a gm-apprentice issue, in the places workarounds
    are written down. Writes nothing."""
    hits: list[Hit] = []
    seen: set[str] = set()
    for name in ("CLAUDE.md", "AGENTS.md"):
        path = vault / name
        if path.is_file():
            seen.add(name)
            hits += _hits(name, path.read_text(encoding="utf-8", errors="replace"))
    for rel, text in vault_files(vault):
        if rel in seen:
            continue
        top_meta = rel.startswith("_meta/") and rel.count("/") == 1
        if top_meta or _is_workaround_note(rel, text):
            hits += _hits(rel, text)
    if memory is not None:
        for path in sorted(p for p in memory.rglob("*") if p.is_file()):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            hits += _hits(MEMORY + path.relative_to(memory).as_posix(), text)
    return hits


def _row(w: Workaround) -> str:
    state = w.get("state", "?")
    extra = (f", kept at {w.get('kept_at')}" if state == "kept"
             else f", retired {w.get('retired')}" if state == "retired" else "")
    release = f", release {w['release']} by hand" if w.get("release") else ""
    return (f"{w.get('id')}\t#{w.get('issue')}\t{state}{extra}{release}\t"
            f"{w.get('what')}\t{', '.join(w.get('where') or [])}")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Record the vault's workarounds by the gm-apprentice "
                    "issue each stands in for.")
    sub = ap.add_subparsers(dest="command", required=True,
                            help="what to do; each has its own --help")
    a = sub.add_parser("add", help="record a workaround the GM said yes to")
    a.add_argument("vault", help="the vault folder")
    a.add_argument("--issue", type=int, required=True, metavar="N",
                   help="the gm-apprentice GitHub issue it stands in for")
    a.add_argument("--what", required=True, metavar="TEXT",
                   help="what it is, in one plain line; its id is made from this")
    a.add_argument("--kind", required=True, choices=WORKAROUND_KINDS,
                   help="what sort of thing it is")
    a.add_argument("--where", action="append", default=[], metavar="PATH",
                   help="a vault-relative path it lives in, or memory:<file> "
                        "for agent memory")
    a.add_argument("--release", metavar="X.Y.Z",
                   help="the release that ships the issue, when the "
                        "CHANGELOG's is wrong")
    ls = sub.add_parser("list", help="the recorded workarounds")
    ls.add_argument("vault", help="the vault folder")
    ls.add_argument("--json", action="store_true", help="print them as JSON")
    k = sub.add_parser("keep", help="the GM keeps it: never offered again")
    k.add_argument("vault", help="the vault folder")
    k.add_argument("id", help="the workaround's id")
    r = sub.add_parser("retire", help="record it retired, once the agent has "
                                      "switched to the built-in way")
    r.add_argument("vault", help="the vault folder")
    r.add_argument("id", help="the workaround's id")
    r.add_argument("--reason", required=True, metavar="TEXT",
                   help="why, in a few words")
    s = sub.add_parser("scan", help="lines citing a gm-apprentice issue, for "
                                    "the one-time sweep (writes nothing)")
    s.add_argument("vault", help="the vault folder")
    s.add_argument("--memory", metavar="DIR",
                   help="the agent's memory folder, read as well")
    s.add_argument("--json", action="store_true", help="print the lines as JSON")
    w = sub.add_parser("swept", help="record that the one-time sweep is done")
    w.add_argument("vault", help="the vault folder")
    ap.epilog = ('Example: gma workaround add "<vault>" --issue 510 '
                 '--what "Gravity noted by hand on the sheet" --kind note '
                 '--where "PCs/Six.md"')
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
    try:
        if args.command == "add":
            w = add(vault, args.issue, args.what, args.kind, args.where,
                    args.release)
            print(f"Recorded {w['id']}: {w['what']} (#{w['issue']}).")
        elif args.command == "list":
            rows = [w for w in update_record.load(vault)["workarounds"]
                    if isinstance(w, dict)]
            if args.json:
                print(json.dumps(rows, indent=2, ensure_ascii=False))
            else:
                print("\n".join(_row(w) for w in rows) if rows
                      else "No workarounds recorded.")
        elif args.command == "keep":
            w = keep(vault, args.id)
            print(f"Kept {w['id']}; it will not be offered for retirement again.")
        elif args.command == "retire":
            w = retire(vault, args.id, args.reason)
            print(f"Retired {w['id']}.")
        elif args.command == "scan":
            memory = Path(args.memory).expanduser() if args.memory else None
            if memory is not None and not memory.is_dir():
                print(f"{cli_name()}: not a directory: {memory}", file=sys.stderr)
                return 2
            hits = scan(vault, memory)
            if args.json:
                print(json.dumps([asdict(h) for h in hits], indent=2,
                                 ensure_ascii=False))
            else:
                for h in hits:
                    nums = ", ".join(f"#{n}" for n in h.issues)
                    print(f"{h.file}:{h.line}\t{nums}\t{h.text}")
                if not hits:
                    print("No lines cite a gm-apprentice issue.")
        else:
            print(f"Swept on {swept(vault)}.")
    except Refused as e:
        print(f"{cli_name()}: {e}; nothing was written", file=sys.stderr)
        return 2
    except StepFailed as e:
        print(f"{cli_name()}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

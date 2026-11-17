#!/usr/bin/env python3
"""reconcile_promote.py: reconcile's promotion, in one step (#701).

    reconcile_promote.py VAULT WRAP_UP --reconciled YYYY-MM-DD
                         [--except NOTE]... [--write]

WRAP_UP is taken as `gma reconcile-scan` takes it: a path, a name or a
[[link]]. Promotes exactly what the scan lists, so the two can never
disagree about which notes qualify:

- the Wrap-Up: DRAFT -> AUTHORITATIVE, `reconciled:` stamped;
- the session index: `status: reviewed`;
- the scan's "draft entities created this session" and "pre-play draft
  entities played this session": DRAFT -> AUTHORITATIVE. Older DRAFTs the
  Wrap-Up links are never touched, nor one named with --except (a note
  the GM has not confirmed: it stays DRAFT).

Each note is planned with `stamp-entities`' own rules (a STUB or
SUPERSEDED note is refused, not promoted). Dry run by default: one row per
note it would change. With --write it writes every note or none: one that
cannot be stamped stops the run before anything is written.

Exit: 0 done (or nothing to do); 1 a note refused (nothing written), or a
write failed (put back, unless its error line names notes that were not);
2 a bad date, no such Wrap-Up or --except note, or no session index to
mark reviewed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stamp_entities  # noqa: E402
from migrate_core import StepFailed, write_all_or_none  # noqa: E402
from reconcile_scan import survey  # noqa: E402
from vaultlib import normalize, normalize_file_arg  # noqa: E402


def _read(vault: Path, rel: str) -> str:
    with (vault / rel).open("r", encoding="utf-8", newline="") as f:
        return f.read()


def plan(vault: Path, wrap_arg: str, reconciled: str,
         keep: Sequence[str] = ()
         ) -> tuple[list[str], dict[str, str], dict[str, str], int]:
    """(rows, original texts, new texts, errors) for the promotion. `keep`
    names notes of the scan's lists to leave DRAFT, by path or name."""
    found = survey(vault, wrap_arg)
    if found.index is None:
        raise LookupError(f"{found.wrap.rel}: no session index links this "
                          f"Wrap-Up, so none can be marked reviewed")
    listed = [*found.new, *found.preplay]
    kept: set[str] = set()
    for raw in keep:
        rel = normalize_file_arg(raw)
        hits = [n.rel for n in listed if n.rel in (rel, f"{rel}.md")
                or normalize(Path(n.rel).stem) == normalize(
                    Path(rel).name.removesuffix(".md"))]
        if len(hits) != 1:
            raise LookupError(
                f"--except {raw!r}: " + (
                    "not among the notes the scan lists as created or "
                    "played this session" if not hits else
                    f"names {len(hits)} of them: {', '.join(hits)}; pass "
                    f"its path"))
        kept.add(hits[0])
    steps: list[tuple[str, list[str]]] = [
        (found.wrap.rel, ["--promote", "--reconciled", reconciled]),
        (found.index.rel, ["--set", "status=reviewed"]),
        *((n.rel, ["--promote"]) for n in listed if n.rel not in kept)]
    rows: list[str] = [f"KEPT\t{rel}\tleft DRAFT (--except)"
                       for rel in sorted(kept)]
    originals: dict[str, str] = {}
    texts: dict[str, str] = {}
    errors = 0
    for rel, flags in steps:
        args = stamp_entities.parse_args([str(vault), rel, *flags])
        text = _read(vault, rel)
        lines = text.splitlines(keepends=True)
        actions, _override, error = stamp_entities.plan_file(rel, lines, args)
        if error:
            rows.append(f"ERROR\t{rel}\t{'; '.join(actions)}")
            errors += 1
            continue
        new = "".join(lines)
        if new == text:
            rows.append(f"UNCHANGED\t{rel}\t{'; '.join(actions)}")
            continue
        rows.append(f"WOULD-STAMP\t{rel}\t{'; '.join(actions)}")
        originals[rel], texts[rel] = text, new
    return rows, originals, texts, errors


def _date(value: str) -> str:
    if not stamp_entities.ISO_DATE_RE.match(value):
        raise argparse.ArgumentTypeError(f"{value!r} is not YYYY-MM-DD")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Promote a reconciled session: the Wrap-Up, its index "
                    "(reviewed) and the DRAFTs reconcile-scan lists as "
                    "created or played this session. Dry run by default.")
    parser.add_argument("vault", type=Path, help="the vault folder")
    parser.add_argument("wrap_up", help="the Wrap-Up: its path (vault-relative "
                        "or absolute) or its name")
    parser.add_argument("--reconciled", required=True, metavar="YYYY-MM-DD",
                        type=_date,
                        help="the date stamped as the Wrap-Up's reconciled:")
    parser.add_argument("--except", dest="keep", action="append", default=[],
                        metavar="NOTE",
                        help="a note of the scan's lists the GM has not "
                             "confirmed: left DRAFT (path or name; repeatable)")
    parser.add_argument("--write", action="store_true",
                        help="write it (default: preview)")
    parser.epilog = ('Example: gma reconcile-promote "<vault>" "<wrap-up>" '
                     '--reconciled 2026-11-17 --write')
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        rows, originals, texts, errors = plan(args.vault, args.wrap_up,
                                              args.reconciled, args.keep)
    except LookupError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if errors:
        print("\n".join(rows))
        print(f"# nothing written: {errors} note(s) cannot be promoted")
        return 1
    if args.write and texts:
        try:
            write_all_or_none(args.vault, originals, texts, read=_read,
                              what="the promotion")
        except StepFailed as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        rows = [r.replace("WOULD-STAMP\t", "STAMPED\t", 1) for r in rows]
    print("\n".join(rows))
    done = "stamped" if args.write else "dry-run would stamp"
    print(f"# {done}: {len(texts)} files, 0 errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())

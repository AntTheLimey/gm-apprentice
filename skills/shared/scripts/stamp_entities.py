#!/usr/bin/env python3
"""Batch frontmatter stamping for session-wrapup's PC sheet refresh.

Sets `asOfSession` and `lastUpdated` (and optionally swaps a chapter
tag) across many files in one call, replacing per-file Read+Edit
cycles. Surgical: only the targeted frontmatter lines change; body
content and all other fields are preserved byte-for-byte.

Dry-run by default — prints planned changes and exits. Pass --write
to apply. Stdlib only.

Usage:
  stamp_entities.py VAULT --session N --date YYYY-MM-DD \
      [--retag OLD=NEW] [--write] FILE [FILE...]

FILE paths are vault-relative. Files without frontmatter are
reported as errors and left untouched.
"""

import argparse
import re
import sys
from pathlib import Path

FM_RE = re.compile(r"^(---\r?\n)(.*?)(\r?\n---(?:\r?\n|$))", re.DOTALL)


def set_key(fm_body: str, key: str, value: str) -> tuple[str, str]:
    """Set key: value in frontmatter text; returns (new_body, action)."""
    pattern = re.compile(rf"^({re.escape(key)}:)[^\n]*$", re.MULTILINE)
    if pattern.search(fm_body):
        old = pattern.search(fm_body).group(0)
        new_body = pattern.sub(rf"\1 {value}", fm_body, count=1)
        return new_body, f"{old.strip()} -> {key}: {value}"
    return fm_body + f"\n{key}: {value}", f"added {key}: {value}"


def retag(fm_body: str, old: str, new: str) -> tuple[str, str | None]:
    """Swap a tag in a block-style or inline tags list."""
    block = re.compile(rf"^(\s*-\s*){re.escape(old)}\s*$", re.MULTILINE)
    if block.search(fm_body):
        return block.sub(rf"\g<1>{new}", fm_body, count=1), \
            f"tag {old} -> {new}"
    inline = re.compile(
        rf"^(tags:\s*\[[^\]]*?)(?<=[\[,\s]){re.escape(old)}(?=[,\]\s])",
        re.MULTILINE)
    if inline.search(fm_body):
        return inline.sub(rf"\g<1>{new}", fm_body, count=1), \
            f"tag {old} -> {new}"
    return fm_body, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("files", nargs="+", help="vault-relative paths")
    ap.add_argument("--session", type=int, required=True)
    ap.add_argument("--date", required=True,
                    help="lastUpdated value, YYYY-MM-DD")
    ap.add_argument("--retag", help="OLD=NEW chapter tag swap")
    ap.add_argument("--write", action="store_true",
                    help="apply changes (default: dry run)")
    args = ap.parse_args()

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        print(f"error: --date must be YYYY-MM-DD, got {args.date}",
              file=sys.stderr)
        return 2
    tag_old = tag_new = None
    if args.retag:
        if "=" not in args.retag:
            print("error: --retag needs OLD=NEW", file=sys.stderr)
            return 2
        tag_old, tag_new = args.retag.split("=", 1)

    errors = 0
    stamped = 0
    for rel in args.files:
        path = args.vault / rel
        if not path.is_file():
            print(f"ERROR\t{rel}\tfile not found")
            errors += 1
            continue
        text = path.read_text(encoding="utf-8")
        m = FM_RE.match(text)
        if not m:
            print(f"ERROR\t{rel}\tno frontmatter — not stamped")
            errors += 1
            continue
        head, fm_body, tail = m.group(1), m.group(2), m.group(3)
        actions = []
        fm_body, act = set_key(fm_body, "asOfSession", str(args.session))
        actions.append(act)
        fm_body, act = set_key(fm_body, "lastUpdated", f'"{args.date}"')
        actions.append(act)
        if tag_old:
            fm_body, act = retag(fm_body, tag_old, tag_new)
            actions.append(act if act else
                           f"tag {tag_old} not present — no swap")
        new_text = head + fm_body + tail + text[m.end():]
        changed = new_text != text
        mode = "STAMPED" if (args.write and changed) else \
            ("WOULD-STAMP" if changed else "UNCHANGED")
        print(f"{mode}\t{rel}\t{'; '.join(actions)}")
        if args.write and changed:
            path.write_text(new_text, encoding="utf-8")
            stamped += 1
    print(f"# {'stamped' if args.write else 'dry-run'}: "
          f"{stamped if args.write else len(args.files) - errors} files, "
          f"{errors} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

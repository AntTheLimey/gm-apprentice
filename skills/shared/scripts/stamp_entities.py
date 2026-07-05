#!/usr/bin/env python3
"""Batch frontmatter stamping for session-wrapup's PC sheet refresh.

Sets `asOfSession` and `lastUpdated` (and optionally swaps a chapter
tag inside the `tags:` list) across many files in one call, replacing
per-file Read+Edit cycles. Surgical: only the targeted frontmatter
lines change; body content, other fields, and line endings are
preserved. Files whose frontmatter delimiters are malformed or whose
frontmatter doesn't look like YAML are refused, never guessed at.

Dry-run by default — prints planned changes and exits. Pass --write
to apply. Stdlib only.

Usage:
  stamp_entities.py VAULT --session N --date YYYY-MM-DD \
      [--retag OLD=NEW] [--write] FILE [FILE...]

FILE paths are vault-relative.
"""

import argparse
import re
import sys
from pathlib import Path

YAML_LINE_RE = re.compile(r"^\s*$|^\s*#|^[\w.-]+:|^\s+-\s|^\s+\S+:")


def frontmatter_span(lines: list[str]) -> tuple[int, str | None]:
    """Return (index of closing delimiter line, error).

    Fail-safe rules: the file must open with exactly `---`; the FIRST
    subsequent line starting with `---` must be exactly `---` (a
    malformed delimiter like `--- ` is an error, not a reason to keep
    scanning into the body); every line between must look like YAML.
    """
    if not lines or lines[0].rstrip("\r\n") != "---":
        return -1, "no frontmatter"
    for i, line in enumerate(lines[1:], start=1):
        stripped = line.rstrip("\r\n")
        if stripped.startswith("---"):
            if stripped != "---":
                return -1, f"malformed frontmatter delimiter {stripped!r}"
            for body_line in lines[1:i]:
                if not YAML_LINE_RE.match(body_line.rstrip("\r\n")):
                    return -1, ("frontmatter region does not look like "
                                f"YAML ({body_line.rstrip()!r}) — refusing")
            return i, None
    return -1, "unterminated frontmatter"


def set_key(fm: list[str], key: str, value: str, eol: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}:[^\r\n]*")
    for i, line in enumerate(fm):
        m = pattern.match(line)
        if m:
            old = m.group(0)
            fm[i] = pattern.sub(f"{key}: {value}", line, count=1)
            return f"{old.strip()} -> {key}: {value}"
    fm.append(f"{key}: {value}{eol}")
    return f"added {key}: {value}"


def retag(fm: list[str], old: str, new: str) -> str | None:
    """Swap a tag inside the tags: list only — never other lists."""
    in_tags = False
    for i, raw in enumerate(fm):
        line = raw.rstrip("\r\n")
        if re.match(r"^tags:\s*$", line):
            in_tags = True
            continue
        if in_tags:
            m = re.match(rf"^(\s*-\s*){re.escape(old)}\s*$", line)
            if m:
                fm[i] = raw.replace(f"{m.group(1)}{old}",
                                    f"{m.group(1)}{new}", 1)
                return f"tag {old} -> {new}"
            if not re.match(r"^\s*-\s", line):
                in_tags = False  # tags block ended
        inline = re.match(
            rf"^(tags:\s*\[[^\]]*?)(?<=[\[,\s]){re.escape(old)}(?=[,\]\s])",
            line)
        if inline:
            fm[i] = raw.replace(inline.group(0),
                                f"{inline.group(1)}{new}", 1)
            return f"tag {old} -> {new}"
    return None


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
        # newline='' preserves the file's own line endings exactly.
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
        lines = text.splitlines(keepends=True)
        close, err = frontmatter_span(lines)
        if err:
            print(f"ERROR\t{rel}\t{err} — not stamped")
            errors += 1
            continue
        eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
        fm = lines[1:close]
        actions = [set_key(fm, "asOfSession", str(args.session), eol),
                   set_key(fm, "lastUpdated", f'"{args.date}"', eol)]
        if tag_old:
            act = retag(fm, tag_old, tag_new)
            actions.append(act if act else
                           f"tag {tag_old} not present in tags — no swap")
        new_text = "".join(lines[:1] + fm + lines[close:])
        changed = new_text != text
        mode = "STAMPED" if (args.write and changed) else \
            ("WOULD-STAMP" if changed else "UNCHANGED")
        print(f"{mode}\t{rel}\t{'; '.join(actions)}")
        if args.write and changed:
            with path.open("w", encoding="utf-8", newline="") as f:
                f.write(new_text)
            stamped += 1
    print(f"# {'stamped' if args.write else 'dry-run'}: "
          f"{stamped if args.write else len(args.files) - errors} files, "
          f"{errors} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

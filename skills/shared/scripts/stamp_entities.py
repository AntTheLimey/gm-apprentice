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
  stamp_entities.py VAULT --session SESSION --date YYYY-MM-DD \
      [--retag OLD=NEW] [--force-shape] [--write] FILE [FILE...]

FILE paths are vault-relative.

SESSION is written verbatim as `asOfSession`: a bare integer (`9`) stays a
bare integer, anything else (`"Chapter 4, Session 9"`) is written as a
quoted string. A vault that already uses one shape keeps it: a file whose
existing `asOfSession` is a label is refused a bare number (and vice
versa) unless --force-shape is given, because silently flattening
"Chapter 4, Session 8" to `9` drops the chapter and diverges from what
every other writer in the toolchain produces.
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


def get_key(fm: list[str], key: str) -> str | None:
    """Raw value text after `key:` (whitespace-stripped), or None."""
    pattern = re.compile(rf"^{re.escape(key)}:([^\r\n]*)")
    for line in fm:
        m = pattern.match(line)
        if m:
            return m.group(1).strip()
    return None


def unquote(text: str) -> str:
    """Strip one layer of matching surrounding quotes, if present."""
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def yaml_scalar(value: str, *, quoted_int: bool = False) -> str:
    """An integer stays bare unless the file already quotes its integer
    (`asOfSession: "9"` stays `"10"`); anything else is double-quoted."""
    if re.fullmatch(r"\d+", value) and not quoted_int:
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def session_shape(raw: str | None) -> str | None:
    """'int' for an integer (bare or quoted), 'label' for any other
    non-empty value, None for absent or empty (a fresh template's
    `asOfSession: ""`)."""
    if raw is None:
        return None
    text = unquote(raw)
    if text == "":
        return None
    return "int" if re.fullmatch(r"\d+", text) else "label"


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
            if not line.strip():
                continue  # blank lines inside the list don't end it
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
    ap.add_argument("--session", required=True,
                    help="asOfSession value, written verbatim: a bare "
                         "number (9) or a label (\"Chapter 4, Session 9\")")
    ap.add_argument("--date", required=True,
                    help="lastUpdated value, YYYY-MM-DD")
    ap.add_argument("--retag", help="OLD=NEW chapter tag swap")
    ap.add_argument("--force-shape", action="store_true",
                    help="allow asOfSession to change shape (label <-> "
                         "bare number) in files that already use one")
    ap.add_argument("--write", action="store_true",
                    help="apply changes (default: dry run)")
    args = ap.parse_args()

    # A shell-quoted '"10"' means the integer 10, not a label containing quotes.
    session = unquote(args.session)
    if not session:
        print("error: --session must not be empty", file=sys.stderr)
        return 2
    new_shape = session_shape(session)

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        print(f"error: --date must be YYYY-MM-DD, got {args.date}",
              file=sys.stderr)
        return 2
    tag_old = tag_new = None
    if args.retag:
        tag_old, sep, tag_new = args.retag.partition("=")
        if not sep or not tag_old.strip() or not tag_new.strip():
            print("error: --retag needs OLD=NEW with both sides "
                  "non-empty", file=sys.stderr)
            return 2

    errors = 0
    stamped = 0
    would = 0
    vault_root = args.vault.resolve()
    for rel in args.files:
        path = (args.vault / rel).resolve()
        if not path.is_relative_to(vault_root):
            print(f"ERROR\t{rel}\tescapes the vault — refused")
            errors += 1
            continue
        if not path.is_file():
            print(f"ERROR\t{rel}\tfile not found")
            errors += 1
            continue
        # newline='' preserves the file's own line endings exactly.
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError) as e:
            print(f"ERROR\t{rel}\tunreadable ({e.__class__.__name__}) "
                  f"— not stamped")
            errors += 1
            continue
        lines = text.splitlines(keepends=True)
        close, err = frontmatter_span(lines)
        if err:
            print(f"ERROR\t{rel}\t{err} — not stamped")
            errors += 1
            continue
        eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
        fm = lines[1:close]
        old_raw = get_key(fm, "asOfSession")
        old_shape = session_shape(old_raw)
        if (old_shape and old_shape != new_shape
                and not args.force_shape):
            want = ("a label like the existing value" if old_shape == "label"
                    else "a plain session number")
            print(f"ERROR\t{rel}\tasOfSession is currently "
                  f"{old_raw} ({old_shape}); --session "
                  f"{session!r} would change its shape. Pass {want}, or "
                  f"--force-shape to override — not stamped")
            errors += 1
            continue
        quoted_int = (old_shape == "int" and old_raw.strip()[:1] in "\"'")
        actions = [set_key(fm, "asOfSession",
                           yaml_scalar(session, quoted_int=quoted_int), eol),
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
        if changed:
            would += 1
            if args.write:
                with path.open("w", encoding="utf-8", newline="") as f:
                    f.write(new_text)
                stamped += 1
    print(f"# {'stamped' if args.write else 'dry-run would stamp'}: "
          f"{stamped if args.write else would} files, "
          f"{errors} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

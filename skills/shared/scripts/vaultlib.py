#!/usr/bin/env python3
"""One vault model for every bundled script.

Owns the pieces each utility used to keep a private copy of: the
frontmatter reader and its YAML scalar rules, the frontmatter *line*
editors (surgical edits that preserve everything else byte-for-byte),
wikilink parsing and name normalization, the fenced-block / marker /
excluded-section scanner that mirrors the publish pipeline, and the
small vault queries (file walk, active PCs, plugin version).

Every other script in this directory imports from here rather than
re-deriving the same regexes: three private copies of "what counts as
frontmatter" is how the fm dict and the body strip drift apart.
Stdlib only, Python 3.10+.

`scan_body` mirrors tools/publish/lib/processor.js but is NOT byte-parity
with it. Headings inside code fences are inert here; `filterSections` in
the publish tool does not track fences, so a fenced `## GM Notes` example
still starts exclusion on the site. The divergence is deliberate and one
-directional: this module errs toward reporting a line as published, which
is the safe direction for a leak check — it over-reports what a reader
might see rather than quietly assuming something is hidden. gm-leak no
longer reads it: `build_lines` asks the publish tool instead (#441).
"""

from __future__ import annotations

import atexit
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Iterator, Literal

# --------------------------------------------------------------------------
# Vault walking
# --------------------------------------------------------------------------

SKIP_DIRS = {"_Templates", "_templates", "_inbox"}

# Top-level folders whose notes are records of the past (QA reports,
# archives). Links written in them are not reported as broken; notes in
# them still count as link targets.
UNCHECKED_DIRS: tuple[str, ...] = ("_QA", "_archive")
LINK_RE = re.compile(r"!?\[\[([^\[\]]+?)\]\]")
FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)


def normalize_file_arg(raw: str) -> str:
    """A `--file` value as a vault-relative posix path.

    Converts backslashes to `/` and strips a leading `./` (repeated, not
    just once) and a trailing `/`. This is prefix stripping, not
    character-class stripping — `../foo.md` is left alone rather than
    losing its leading dots, so a caller checking whether the result
    still resolves inside the vault sees the real path. Does not touch
    interior `..` segments; callers that must keep a path inside the
    vault check that themselves (see `vault_check.py main()`).
    """
    value = raw.strip().replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return value.rstrip("/")


def is_skipped_path(rel: str, skip_dirs: set[str] = SKIP_DIRS) -> bool:
    """Would `vault_files` skip this vault-relative posix path?

    True for a hidden directory/file (a leading `.` on any path
    segment) or a top-level directory in `skip_dirs` (templates, the
    `_inbox` staging area). Shared with the `--file` existence check in
    `vault_check.py main()`, so a path that is real on disk but would
    never be walked — `_Templates/Foo.md` — is reported as the same
    clear error as a path that doesn't exist at all, rather than a
    silently empty report.
    """
    parts = rel.split("/")
    if any(p.startswith(".") for p in parts):
        return True
    return parts[0] in skip_dirs


def is_unchecked_source(rel: str) -> bool:
    """Is this vault-relative posix path a note whose links are not
    checked (one under a top-level `UNCHECKED_DIRS` folder)?"""
    parts = rel.split("/")
    return len(parts) > 1 and parts[0] in UNCHECKED_DIRS


def vault_files(vault: Path, folder: str | None = None,
                files: Iterable[str] | None = None,
                skip_dirs: set[str] = SKIP_DIRS,
                newer_than: float | None = None,
                newline: str | None = None) -> Iterator[tuple[str, str]]:
    """Yield (vault-relative posix path, text) for every readable note.

    `newline` is `open`'s: None reads with universal newlines (`\\r` and
    `\\r\\n` become `\\n`), "" yields the text as written.

    Hidden directories and `skip_dirs` (templates, the `_inbox` staging
    area) are skipped; an unreadable file warns on stderr rather than
    aborting the walk. Sorted, so every caller's output is stable.

    `files`, when given, restricts the walk to that exact set of
    vault-relative paths (as `--file` collects them, run through
    `normalize_file_arg`) — combined with `folder` by AND, not OR, so a
    caller can pass both. A path in `files` that names no real note
    yields nothing here, which is why callers that need a clear error
    validate existence themselves (with `is_skipped_path` too) before
    walking.

    `newer_than`, when given, keeps only files whose mtime is at or
    after it (an epoch timestamp, as `--newer-than <path>` derives from
    that path's own `st_mtime`) — a backstop scope for "everything
    touched since I started", independent of an explicit `files` list
    and combined with `folder`/`files` by AND like everything else here.
    """
    wanted = ({normalize_file_arg(f) for f in files}
              if files is not None else None)
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        if is_skipped_path(rel, skip_dirs):
            continue
        if folder and not rel.startswith(folder.strip("/") + "/"):
            continue
        if wanted is not None and rel not in wanted:
            continue
        try:
            if newer_than is not None and path.stat().st_mtime < newer_than:
                continue
            with path.open(encoding="utf-8", errors="replace",
                           newline=newline) as f:
                text = f.read()
        except OSError as e:
            print(f"warning: unreadable {rel}: {e}", file=sys.stderr)
            continue
        yield rel, text


# --------------------------------------------------------------------------
# Frontmatter reading
# --------------------------------------------------------------------------

# A complete quoted scalar and nothing else after it but blanks or a comment.
# The closing quote is the *unescaped* one (`\"` inside double quotes, `''`
# inside single), so `"5'4\" - 6'0\""` is one value rather than a truncated
# prefix. Content after the closing quote means the line is not a valid quoted
# scalar at all — see scalar_value.
QUOTED_SCALAR_RE = re.compile(
    r"""^(?:"((?:\\.|[^"\\])*)"|'((?:''|[^'])*)')\s*(?:\#.*)?$"""
)


def scalar_value(value: str) -> str:
    """Unwrap a YAML scalar: quoted content, or unquoted up to a comment.

    A quoted scalar with trailing content (`type: "npc" trailing`) is not
    valid YAML. Unwrapping it would hand a clean-looking `npc` to the type
    and predicate checks and pass malformed frontmatter silently, so the raw
    text is returned instead and the caller reports it.
    """
    text = value.strip()
    m = QUOTED_SCALAR_RE.match(text)
    if m:
        # Escapes are left as authored — nothing downstream compares against
        # an unescaped form, and decoding them here would be a second guess
        # at YAML this parser is deliberately not implementing.
        return m.group(1) if m.group(1) is not None else m.group(2)
    # Unquoted: a ' #' starts a YAML comment, and so does a leading '#'.
    if text.startswith("#"):
        return ""
    return re.split(r"\s+#", text, maxsplit=1)[0].strip()


def extract_frontmatter(content: str) -> dict[str, Any] | None:
    """Extract YAML frontmatter from markdown content."""
    # Handle both LF and CRLF line endings
    match = FRONTMATTER_RE.match(content)
    if not match:
        return None

    frontmatter: dict[str, Any] = {}
    yaml_content = match.group(1)

    # Simple YAML parsing (handles flat key: value and arrays)
    current_key = None
    for line in yaml_content.split("\n"):
        # Skip empty lines
        if not line.strip():
            continue

        # Array item
        if line.strip().startswith("- "):
            if current_key and current_key in frontmatter:
                if not isinstance(frontmatter[current_key], list):
                    frontmatter[current_key] = []
                frontmatter[current_key].append(
                    line.strip()[2:].strip('"').strip("'"))
            continue

        # Key: value pair
        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            key, _, value = line.partition(":")
            key = key.strip()
            value = scalar_value(value)

            # Handle empty value (might be start of array)
            if value == "" or value == "[]":
                frontmatter[key] = []
            elif value.startswith("[") and value.endswith("]"):
                # Inline array: aliases: [Doc, "The Colonel"]
                frontmatter[key] = [
                    v.strip().strip('"').strip("'")
                    for v in value[1:-1].split(",") if v.strip()]
            else:
                frontmatter[key] = value
            current_key = key

    return frontmatter


def entity_type(fm: dict[str, Any] | None) -> str:
    """A file's `type` as a string, or "" when it has no usable one.

    `extract_frontmatter` hands back `[]` for a bare `type:` line and a
    list for `type: [a, b]`, so the raw value is not always hashable.
    Every `type in SOME_SET` test would raise `TypeError` on such a file
    and take the whole run down; a malformed `type` is ordinary bad-vault
    input, so it reduces to "" and simply matches nothing.
    """
    value = (fm or {}).get("type")
    return value if isinstance(value, str) else ""


def raw_frontmatter(text: str) -> str:
    """The inner YAML text of the frontmatter block, or "" when absent."""
    m = FRONTMATTER_RE.match(text)
    return m.group(1) if m else ""


def body_of(text: str) -> str:
    """Everything after the closing `---`, stripped; the whole text if
    there is no frontmatter block."""
    m = re.match(r"^---\r?\n.*?\r?\n---\r?\n?(.*)$", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def _nested_block(raw: str, key: str) -> list[str]:
    """The indented lines belonging to a top-level `key:` block.

    Empty when the key is absent or carries a value of its own (a scalar
    or an inline flow collection opens no block).
    """
    lines = raw.split("\n")
    for i, line in enumerate(lines):
        m = re.match(rf"^{re.escape(key)}:\s*(.*)$", line)
        if not m:
            continue
        value = m.group(1).strip()
        if value and not value.startswith("#"):
            return []
        block = []
        for nxt in lines[i + 1:]:
            if nxt.strip() and not nxt[:1].isspace():
                break
            block.append(nxt)
        return block
    return []


def has_nested_block(raw: str, key: str) -> bool:
    """Whether a top-level `key:` in the raw frontmatter has indented lines
    under it (a map such as a session's `documents:`), which
    `extract_frontmatter` reads as an empty value."""
    return any(ln.strip() and not ln.strip().startswith("#")
               for ln in _nested_block(raw, key))


def nested_mapping(text: str, key: str) -> dict[str, str]:
    """Child key -> scalar value for the block indented under `key:`.

    Covers the two nested shapes the vault schema actually uses: a
    session index's `documents:` map and `_meta/vault-config.md`'s
    `publish:` map. Only the block's own level is read — a grandchild
    belongs to its parent's block, not this one. An inline list value
    (`exclude_sections: ["A", "B"]`) is returned raw; for a parsed
    setting ask the publish tool (`settings`).
    """
    out: dict[str, str] = {}
    indent: int | None = None
    for line in _nested_block(raw_frontmatter(text), key):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if indent is None:
            indent = depth
        if depth > indent or stripped.startswith("- "):
            continue
        m = re.match(r"^([^:\s][^:]*):\s*(.*)$", stripped)
        if m:
            out[m.group(1).strip()] = scalar_value(m.group(2))
    return out


# --------------------------------------------------------------------------
# Frontmatter line editing
#
# These operate on the *raw lines* between the delimiters, so an edit
# touches only the targeted line: body content, other fields, comments and
# the file's own line endings are preserved byte-for-byte.
# --------------------------------------------------------------------------

YAML_LINE_RE = re.compile(r"^\s*$|^\s*#|^[\w.-]+:|^\s+-\s|^\s+[^\s#:][^:]*:(\s|$)")


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


def set_key(fm: list[str], key: str, value: str, eol: str) -> str:
    """Replace (or append) a top-level `key:` line, keeping its own EOL.

    The line is built literally rather than substituted through `re.sub`:
    a replacement template eats one level of backslash escaping, so a
    value of `"C:\\\\Users\\\\ant"` landed in the file as `"C:\\Users\\ant"`
    and a value containing `\\g<0>` would expand to the whole matched
    line. Values here are already YAML-encoded by `yaml_scalar` /
    `yaml_value_for_cli`; nothing may re-interpret them.
    """
    pattern = re.compile(rf"^{re.escape(key)}:[^\r\n]*")
    for i, line in enumerate(fm):
        m = pattern.match(line)
        if m:
            old = m.group(0)
            # The pattern consumes everything up to the newline, so the
            # remainder is exactly this line's own EOL — empty only for a
            # file whose last line has none, where adding one would be a
            # change of its own.
            fm[i] = f"{key}: {value}{line[len(old):]}"
            return f"{old.strip()} -> {key}: {value}"
    fm.append(f"{key}: {value}{eol}")
    return f"added {key}: {value}"


def set_nested_key(fm: list[str], parent: str, child: str, value: str,
                   eol: str) -> str:
    """Set `child` inside the `parent:` block, creating what's missing.

    Replaces the child in place when it is already there, else appends it
    at the end of the block using the block's own indent (2 spaces when
    the block is empty or has to be created). Only the parent's own level
    is considered a child, so `documents.plan` never collides with a
    top-level `plan:`.

    Raises `ValueError` when `parent:` already carries an inline value
    (`documents: {plan: "[[P]]"}`, `documents: []`, `documents: {}`).
    Appending a second `parent:` block there would leave the file with a
    duplicate top-level key, which every YAML reader resolves last-wins —
    the inline map's contents would vanish from the whole toolchain while
    the writer reported a successful stamp. Refusing is the contract this
    module already keeps everywhere else: malformed frontmatter is
    refused, never guessed at.
    """
    parent_re = re.compile(rf"^{re.escape(parent)}:\s*(?:#.*)?$")
    inline_re = re.compile(rf"^{re.escape(parent)}:[ \t]+(?!#)\S")
    start = next((i for i, line in enumerate(fm)
                  if parent_re.match(line.rstrip("\r\n"))), None)
    if start is None:
        if any(inline_re.match(line.rstrip("\r\n")) for line in fm):
            raise ValueError(
                f"{parent}: has an inline value — convert it to a block "
                f"mapping by hand")
        fm.append(f"{parent}:{eol}")
        fm.append(f"  {child}: {value}{eol}")
        return f"added {parent}: with {child}: {value}"

    end = len(fm)
    for j in range(start + 1, len(fm)):
        text = fm[j].rstrip("\r\n")
        if text.strip() and not text[:1].isspace():
            end = j
            break

    indent: int | None = None
    for j in range(start + 1, end):
        text = fm[j].rstrip("\r\n")
        if not text.strip():
            continue
        depth = len(text) - len(text.lstrip())
        if indent is None or depth < indent:
            indent = depth

    child_re = re.compile(rf"^(\s+){re.escape(child)}:[^\r\n]*$")
    for j in range(start + 1, end):
        text = fm[j].rstrip("\r\n")
        m = child_re.match(text)
        if m and len(m.group(1)) == indent:
            fm[j] = f"{m.group(1)}{child}: {value}{fm[j][len(text):]}"
            return f"{text.strip()} -> {child}: {value}"

    pad = " " * (indent if indent is not None else 2)
    at = end
    while at > start + 1 and not fm[at - 1].strip():
        at -= 1
    fm.insert(at, f"{pad}{child}: {value}{eol}")
    return f"added {child}: {value} under {parent}"


def delete_key(fm: list[str], key: str) -> str | None:
    """Remove the first top-level `key:` line; return its text, or None.

    The returned text has no trailing newline — callers report it, they
    do not re-insert it.

    Column 0 only: a nested `documents.type` is not the top-level `type`,
    and deleting the wrong one is a silent schema break.
    """
    pattern = re.compile(rf"^{re.escape(key)}:")
    for i, line in enumerate(fm):
        if pattern.match(line):
            return fm.pop(i).rstrip("\r\n")
    return None


def opens_a_block(fm: list[str], key: str) -> bool:
    """Does `key:` carry an indented block rather than a scalar?

    `delete_key` and `set_key` both edit exactly one line. On a key whose
    value is a block list or a nested mapping that leaves the indented
    items behind — a deletion orphans them, a rename re-parents them onto
    the new key. Every writer that touches a key it did not itself write
    has to be able to tell the two shapes apart first.
    """
    pattern = re.compile(rf"^{re.escape(key)}:")
    for i, line in enumerate(fm):
        if not pattern.match(line):
            continue
        for nxt in fm[i + 1:]:
            if not nxt.strip():
                continue
            return nxt[:1].isspace()
        return False
    return False


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


def yaml_value_for_cli(raw: str) -> str:
    """Type a `--set key=value` CLI argument as YAML.

    A shell round-trip loses YAML's types, so the shape has to be
    recovered here: `null`/`~`/empty write the null literal, booleans and
    integers stay bare, an already-quoted argument keeps its quotes —
    `'"9"'` asked for the string `"9"`, not the integer 9 — and
    everything else — wikilinks and prose labels most of all — is
    double-quoted, because an unquoted `[[Link]]` is a flow sequence to
    every YAML reader and a comma turns a label into two.
    """
    text = raw.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return yaml_scalar(unquote(text), quoted_int=True)
    low = text.casefold()
    if low in ("null", "~", ""):
        return "null"
    if low in ("true", "false"):
        return text
    if re.fullmatch(r"-?\d+", text):
        return text
    return yaml_scalar(text)


# --------------------------------------------------------------------------
# Names and links
# --------------------------------------------------------------------------


def normalize(name: str) -> str:
    """Normalize a note name or link target for matching. Composed (NFC)
    first: macOS stores accented filenames decomposed, links are typed
    composed."""
    name = unicodedata.normalize("NFC", name)
    return re.sub(r"\s+", " ", name.replace("_", " ").strip()).casefold()


INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1).)+?\1")


def inline_code_spans(line: str) -> list[tuple[int, int]]:
    """(start, end) of each inline code span on a line."""
    return [m.span() for m in INLINE_CODE_RE.finditer(line)]


def inside_spans(pos: int, spans: list[tuple[int, int]]) -> bool:
    """Whether `pos` falls inside one of the spans."""
    return any(a <= pos < b for a, b in spans)


def alias_split(raw: str) -> str:
    """The part of a wikilink body before its alias pipe. Obsidian writes
    the pipe as `\\|` inside a table cell, and the backslash belongs to
    the pipe, not the target."""
    target = raw.split("|", 1)[0]
    if "|" in raw and target.endswith("\\"):
        target = target[:-1]
    return target


def link_name(raw: str) -> str:
    """A wikilink body's target as it was written: no alias, heading,
    block, folder or `.md`. Not normalised."""
    target = alias_split(raw)
    target = re.split(r"[#^]", target, maxsplit=1)[0]
    # Path-style links resolve by final segment, like Obsidian.
    target = target.rstrip("/").rsplit("/", 1)[-1]
    if target.endswith(".md"):
        target = target[:-3]
    return target.strip()


def link_target(raw: str) -> str:
    """Reduce a wikilink body to its target note name."""
    return normalize(link_name(raw))


def wikilink_target(value: Any) -> str:
    """Bare target of a `[[Link|alias]]`, or the plain string.

    A quoted wikilink reaches us as a one-item list, not a string: the
    frontmatter reader treats the outer `[...]` of `"[[Note]]"` as a YAML
    flow sequence and yields `['[Note]']`. Rejecting lists here silently
    disabled every wikilink-valued lookup, so unwrap the single-item case
    and strip whatever brackets survive.
    """
    if value is None:
        return ""
    if isinstance(value, list):
        if len(value) != 1:
            return ""
        value = value[0]
    body = re.sub(r"[\[\]]", "", str(value))
    return alias_split(body).split("#")[0].strip()


def link_aliases(fm: dict[str, Any]) -> list[str]:
    """Every name a link may use for this file: `aliases:` then the
    GM-only `gm_aliases:` (#212), deduplicated. An `aliases: Doc` scalar
    is malformed and skipped, matching the publish tool. A `gm_aliases:`
    scalar is read as one name: dropping it would leave the secret
    unprotected without a word. The frontmatter parser keeps YAML escapes
    as written, so a quoted `'O''Neil'` or `"a \\"b\\""` also adds its
    decoded spelling, the one a link actually uses."""
    names: list[str] = []
    for field in ("aliases", "gm_aliases"):
        values = fm.get(field)
        if field == "gm_aliases" and isinstance(values, str):
            values = [values] if values.strip() else []
        if not isinstance(values, list):
            continue
        for a in values:
            name = str(a).strip()
            if len(name) > 1 and name[0] == name[-1] and name[0] in "\"'":
                name = name[1:-1].strip()
            for n in (name, name.replace("''", "'"), name.replace('\\"', '"')):
                if n and n not in names:
                    names.append(n)
    return names


def frontmatter_aliases(text: str) -> list[str]:
    """`link_aliases` of a file's text."""
    return link_aliases(extract_frontmatter(text) or {})


# Session numbers above this are implausible — a larger value is a
# year or date fragment that leaked into a session field.
MAX_PLAUSIBLE_SESSION = 500


def parse_session_number(value: Any) -> int | None:
    """Parse a session reference like '3', 'Session 3', or 'session-03'.

    Real vaults hold free-text values: compound references
    ("Chapter 3, Session 7") must key on the session, not the first
    number, and date-bearing prose ("Reconstructed 2026-07-04") must
    parse as unknown rather than as session 2026.
    """
    if value is None or isinstance(value, list):
        return None
    text = str(value)
    m = re.search(r"session\D{0,3}(\d+)", text, re.IGNORECASE)
    if not m:
        m = re.search(r"(\d+)", text)
    if not m:
        return None
    n = int(m.group(1))
    return n if n <= MAX_PLAUSIBLE_SESSION else None


def session_ref_number(fm: dict[str, Any]) -> int | None:
    """The session number named by `fm["session"]`.

    A `session:` value written as a wikilink ("[[Session 05]]") reaches
    us as a one-item list of bracket-stripped text, not a string — the
    frontmatter reader treats the quoted outer `[...]` as a YAML flow
    sequence (see `wikilink_target`'s docstring), and
    `parse_session_number` returns None outright for any list.
    `wikilink_target` unwraps that case to plain text first; a bare int
    or string session value passes through it unchanged. Since migration
    1.9.5 the quoted wikilink is the canonical `session:` form, so every
    `session:` lookup should come through here rather than calling
    `parse_session_number` on the raw value.
    """
    return parse_session_number(wikilink_target(fm.get("session")))


def chapter_of(rel: str, fm: dict[str, Any]) -> str | None:
    """Which chapter a note belongs to, or None if it cannot be told.

    Session numbering restarts per chapter in real vaults, so a bare
    `session_number` is not a campaign-wide ordinal (#162). The
    frontmatter ref is authoritative; the path is the fallback for
    vaults that file by folder without tagging. Returns None for a
    flat vault, where number alone is the only ordering available and
    is correct.
    """
    ref = wikilink_target(fm.get("chapter"))
    if ref:
        # A ref may be written as a path ("[[Chapters/Chapter 4 - Calcutta]]")
        # while the folder fallback yields only the segment. Keep the last
        # segment either way, or one chapter acquires two identities and stops
        # matching its own wrap-ups and plans.
        return ref.rsplit("/", 1)[-1]
    parts = rel.split("/")
    if len(parts) > 1 and parts[0].casefold() in {"chapters", "_chapters"}:
        return parts[1]
    return None


def chapter_key(rel: str, fm: dict[str, Any]) -> str | None:
    """chapter_of, casefolded for comparison. None stays None."""
    c = chapter_of(rel, fm)
    return c.casefold() if c else None


def wrapup_filename(rel: str, fm: dict[str, Any]) -> str | None:
    """`Chapter_CC_Session_NN_Wrap_Up.md` for the session a note at `rel`
    with frontmatter `fm` belongs to, or None when its chapter or session
    number cannot be read. A decimal chapter (0.5) has no such name."""
    session = parse_session_number(fm.get("session_number"))
    if session is None:
        session = session_ref_number(fm)
    ch = (chapter_of(rel, fm) or "").strip()
    chapter = (re.fullmatch(r"(\d+)(?!\.\d)", ch)
               or re.search(r"chapter\D{0,3}(\d+)(?!\.?\d)", ch,
                            re.IGNORECASE))
    if session is None or chapter is None:
        return None
    return (f"Chapter_{int(chapter.group(1)):02d}_Session_{session:02d}"
            f"_Wrap_Up.md")


# The ontology file beside this package holds the short lists the scripts
# share with the publish tool (wrap-up spellings, session statuses, game
# systems, type folders); schema_rules reads the rest of it. Resolved from
# this file's own location: the lists travel with the plugin, never with
# the vault under audit.
ONTOLOGY_PATH = Path(__file__).resolve().parent.parent / "gm-apprentice-ontology.json"


@lru_cache(maxsize=1)
def ontology() -> dict[str, Any]:
    """The ontology file, read once."""
    loaded: dict[str, Any] = json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))
    return loaded


# Every `type:` spelling a Session Wrap-Up is written with in the wild.
# One definition, because a script that knows only two of the three finds
# a vault's wrap-ups and another one silently does not: `vault_check
# sessions` reported a wrap-up that `session_context.py` never loaded.
# The first is the spelling the templates write.
WRAP_UP_TYPE: str = ontology()["wrap_up_types"][0]
WRAP_UP_TYPES: frozenset[str] = frozenset(ontology()["wrap_up_types"])


# --------------------------------------------------------------------------
# Body scanning
# --------------------------------------------------------------------------


def iter_body_lines(text: str) -> Iterator[tuple[int, str]]:
    """Yield (lineno, line) for body lines, 1-based, skipping YAML
    frontmatter so scans never trip on `aliases:` or `type:` values."""
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
    for idx in range(start, len(lines)):
        yield idx + 1, lines[idx]


def section(text: str, heading: str) -> str | None:
    """Extract a `## Heading` block up to the next same-level heading."""
    m = re.search(rf"^##\s+{re.escape(heading)}\s*$(.*?)(?=^##\s|\Z)",
                  text, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else None


_SECTION_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def fence_step(line: str, fence_delim: str | None) -> tuple[str | None, bool]:
    """One step of the code-fence walk. Given a line and the delimiter of
    the fence currently open (None outside one), return (new delimiter,
    whether this line opens or closes a fence). A closing fence must use the
    same marker character, be at least as long as the opener and carry no
    info string; a backtick opener's info string may not contain a backtick.
    A line inside a fence is code whenever the returned delimiter is not None
    or the flag is set."""
    fence = FENCE_RE.match(line)
    if not fence:
        return fence_delim, False
    delim, info = fence.group(1), fence.group(2)
    if fence_delim is None:
        if delim[0] != "`" or "`" not in info:
            return delim, True
    elif (delim[0] == fence_delim[0]
          and len(delim) >= len(fence_delim)
          and info.strip() == ""):
        return None, True
    return fence_delim, False


def fenced_headings(text: str) -> list[tuple[int, int, str]]:
    """(0-based line index, level, title) for every heading outside a
    code fence. Shared walk behind `sections` and `h3_blocks` — both need
    the same "don't mistake a fenced example for a real heading" fence
    tracking `scan_body` already does, but neither needs `scan_body`'s
    marker/exclusion bookkeeping."""
    lines = text.splitlines()
    fence_delim: str | None = None
    heads: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        fence_delim, is_fence_line = fence_step(line, fence_delim)
        if is_fence_line or fence_delim is not None:
            continue
        m = _SECTION_HEADING_RE.match(line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))
    return heads


_fenced_headings = fenced_headings


def sections(text: str) -> list[tuple[int, int, str, str]]:
    """(lineno, level, title, body) for each `## ` heading outside a code
    fence, in document order. `lineno` is 1-based; `body` is the text
    between this heading and the next heading of level <= 2 (a `# ` title
    ends a section too), stripped. A `### `+ heading inside the fence
    tracking here still ends up in a prior `## `'s body — only level-1/2
    headings are section boundaries."""
    lines = text.splitlines()
    heads = _fenced_headings(text)
    result: list[tuple[int, int, str, str]] = []
    for idx, (line_i, level, title) in enumerate(heads):
        if level != 2:
            continue
        end = len(lines)
        for later_i, later_level, _later_title in heads[idx + 1:]:
            if later_level <= level:
                end = later_i
                break
        body = "\n".join(lines[line_i + 1:end]).strip()
        result.append((line_i + 1, level, title, body))
    return result


def h3_blocks(section_body: str) -> list[tuple[str, str]]:
    """(title, body) for each `### ` heading inside a section body,
    outside a code fence, in document order. Mirrors `sections`'s fence
    tracking and boundary rule (next heading of level <= 3 ends a block),
    scoped one level down — this is how `plan_check.py` reads Planned
    Scenes' and Contingency Scenes' individual scene blocks."""
    lines = section_body.splitlines()
    heads = _fenced_headings(section_body)
    result: list[tuple[str, str]] = []
    for idx, (line_i, level, title) in enumerate(heads):
        if level != 3:
            continue
        end = len(lines)
        for later_i, later_level, _later_title in heads[idx + 1:]:
            if later_level <= level:
                end = later_i
                break
        body = "\n".join(lines[line_i + 1:end]).strip()
        result.append((title, body))
    return result


_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_TABLE_SEP_CHARS_RE = re.compile(r"^[|:\- ]+$")


def word_count(text: str) -> int:
    """Whitespace-token count, ignoring markdown table separator rows
    (`|---|---|`, or a bare `---`) and HTML comments (`<!-- ... -->`,
    single- or multi-line).

    Backs the Session Plan preamble/recap word budgets — a separator row
    is Obsidian table scaffolding, not prose the Keeper reads, and an
    editorial `<!-- -->` note is by definition not what gets said at the
    table either. Counting either would make the budget punish the
    template's own furniture rather than what the GM actually wrote.
    """
    stripped = _HTML_COMMENT_RE.sub(" ", text)
    total = 0
    for line in stripped.splitlines():
        s = line.strip()
        if s and _TABLE_SEP_CHARS_RE.match(s) and "-" in s:
            continue
        total += len(line.split())
    return total


FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_ATX_CLOSE_RE = re.compile(r"\s+#+$")


def atx_title(raw: str) -> str:
    """A heading's title without an ATX closing sequence (`## GM Notes ##`
    renders as "GM Notes"), as processor.js `walkSections` reads it."""
    return _ATX_CLOSE_RE.sub("", raw.strip()).strip()
_MARKERS = (("gm", "gm-only"), ("spoiler", "spoiler"))
# Everything either side calls a space (Python's `\s` and JavaScript's
# differ by these).
_MARKER_SPACE = r"[\s\x1c-\x1f\x85\ufeff]"


def marker_re(*words: str) -> re.Pattern[str]:
    """The publish tool's one reading of a gm-only or spoiler marker
    (tools/publish/lib/markers.js `markerRe`): an HTML comment holding
    the name and nothing else, `/` before the name for a closer. Capitals
    and spacing inside the comment do not matter. Group 1 is `/` for a
    closer, group 2 the name as typed. No words: both markers.
    tools/publish/test/fixtures/marker-vectors.json pins both sides."""
    # Capitals are spelled out letter by letter: `re.I` on text also
    # reads "ſ" as "s" and "ı" as "i", which the tool does not.
    def any_case(word: str) -> str:
        return "".join(f"[{c.lower()}{c.upper()}]" if c.isalpha()
                       else re.escape(c) for c in word)
    names = "|".join(any_case(w) for w in words or
                     tuple(word for _, word in _MARKERS))
    return re.compile(rf"<!--{_MARKER_SPACE}*(/?){_MARKER_SPACE}*({names})"
                      rf"{_MARKER_SPACE}*-->")


GM_MARKER_RE = marker_re("gm-only")
_ANY_MARKER_RE = marker_re()


def markers_in(line: str) -> list[tuple[int, str, bool]]:
    """Every gm-only and spoiler marker in `line`, in order, as
    (position, "gm-only" or "spoiler", is a closer)."""
    return [(m.start(), m.group(2).lower(), m.group(1) == "/")
            for m in _ANY_MARKER_RE.finditer(line)]


# --------------------------------------------------------------------------
# What the build publishes, asked of the build
#
# Which lines of a note reach the site is the publish tool's decision:
# its strip chain, and a section filter whose headings come from its
# renderer's parser. Nothing here re-implements either. `gm-publish
# lines` answers from the functions the build itself calls
# (tools/publish/lib/lines-cli.js), and one process is kept open for the
# run so a whole vault can be asked note by note.
# --------------------------------------------------------------------------

# The publish tool, beside skills/ in both the repo and the installed plugin
# (<plugin>/skills/shared/scripts/vaultlib.py, <plugin>/tools/publish/...).
PUBLISH_TOOL = (Path(__file__).resolve().parents[3]
                / "tools" / "publish" / "bin" / "gm-publish.js")
# How long one question may take before the tool is given up on.
PUBLISH_LINES_TIMEOUT = 120


class PublishToolUnavailable(Exception):
    """The publish tool could not say what publishes. The message is why."""


# The first publish tool with the `lines` op `cut` (`build_lines`).
CUT_SINCE = "1.17.0"


class PublishToolTooOld(PublishToolUnavailable):
    """The tool answers, but predates a question asked of it. The message
    is the first version that has it."""


class PublishLines:
    """A `gm-publish lines` process: one JSON question per line."""

    def __init__(self, tool: Path = PUBLISH_TOOL) -> None:
        self.tool = tool
        self._proc: subprocess.Popen[str] | None = None

    def _process(self) -> subprocess.Popen[str]:
        if self._proc is not None and self._proc.poll() is None:
            return self._proc
        node = shutil.which("node")
        if not node:
            raise PublishToolUnavailable("node is not on PATH")
        if not self.tool.is_file():
            raise PublishToolUnavailable(
                f"the publish tool is not at {self.tool.as_posix()}")
        try:
            self._proc = subprocess.Popen(
                [node, str(self.tool), "lines"], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8")
        except OSError as e:
            raise PublishToolUnavailable(
                f"node could not run ({e.__class__.__name__})") from e
        return self._proc

    def run_once(self, args: list[str]) -> str:
        """One command of the tool, run to its end, and what it printed.
        Found and run as the `lines` process is: the same Node, the same
        tool file."""
        node = shutil.which("node")
        if not node:
            raise PublishToolUnavailable("node is not on PATH")
        if not self.tool.is_file():
            raise PublishToolUnavailable(
                f"the publish tool is not at {self.tool.as_posix()}")
        try:
            done = subprocess.run(
                [node, str(self.tool), *args], capture_output=True,
                stdin=subprocess.DEVNULL, timeout=PUBLISH_LINES_TIMEOUT)
        except subprocess.TimeoutExpired as e:
            raise PublishToolUnavailable(
                f"the publish tool did not answer within "
                f"{PUBLISH_LINES_TIMEOUT}s") from e
        except OSError as e:
            raise PublishToolUnavailable(
                f"node could not run ({e.__class__.__name__})") from e
        if done.returncode != 0:
            why = done.stderr.decode("utf-8", "replace").strip()
            raise PublishToolUnavailable(
                f"the publish tool refused: {why or done.returncode}")
        return done.stdout.decode("utf-8", "replace")

    def ask(self, request: dict[str, Any]) -> dict[str, Any]:
        proc = self._process()
        assert proc.stdin is not None and proc.stdout is not None
        # A tool that hangs is killed, which ends the read below.
        timed_out: list[bool] = []

        def give_up() -> None:
            timed_out.append(True)
            proc.kill()

        watchdog = threading.Timer(PUBLISH_LINES_TIMEOUT, give_up)
        watchdog.daemon = True
        watchdog.start()
        try:
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()
            line = proc.stdout.readline()
        except (OSError, ValueError) as e:
            self.close()
            raise PublishToolUnavailable(
                f"the publish tool did not answer within "
                f"{PUBLISH_LINES_TIMEOUT}s" if timed_out else
                f"the publish tool stopped answering "
                f"({e.__class__.__name__})") from e
        finally:
            watchdog.cancel()
        if not line and timed_out:
            self.close()
            raise PublishToolUnavailable(
                f"the publish tool did not answer within "
                f"{PUBLISH_LINES_TIMEOUT}s")
        if not line:
            self.close()
            raise PublishToolUnavailable(
                "the publish tool exited without answering (it needs Node "
                "22+, and a tool older than 1.12.1 has no `lines` command)")
        try:
            answer = json.loads(line)
        except ValueError as e:
            self.close()
            raise PublishToolUnavailable(
                f"the publish tool did not answer within "
                f"{PUBLISH_LINES_TIMEOUT}s" if timed_out else
                "the publish tool did not answer the question (a tool "
                "older than 1.12.1 has no `lines` command)") from e
        if not isinstance(answer, dict) or "error" in answer:
            why = answer.get("error") if isinstance(answer, dict) else answer
            raise PublishToolUnavailable(f"the publish tool refused: {why}")
        return answer

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            if proc.stdin is not None:
                proc.stdin.close()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            proc.kill()
        finally:
            if proc.stdout is not None:
                proc.stdout.close()


# The process every question below goes to. The plugin's own tool until a
# check that knows the vault's site points it at the tool that site builds
# with (`use_publish_tool`).
PUBLISH_LINES = PublishLines()
_LINES_BY_TOOL: dict[Path, PublishLines] = {PUBLISH_TOOL: PUBLISH_LINES}


def use_publish_tool(tool: Path) -> None:
    """Ask `tool` from here on: the publish tool a vault's site builds
    with, whose answer is the one that counts for that vault."""
    global PUBLISH_LINES
    if tool not in _LINES_BY_TOOL:
        _LINES_BY_TOOL[tool] = PublishLines(tool)
    PUBLISH_LINES = _LINES_BY_TOOL[tool]


def _close_publish_tools() -> None:
    for lines in set(_LINES_BY_TOOL.values()) | {PUBLISH_LINES}:
        lines.close()


atexit.register(_close_publish_tools)


# --------------------------------------------------------------------------
# The vault's files in `_meta/`: which layout it is on, and the version stamp.
# The stamp is read with no Node on either layout: `vault_check.py version`
# runs at the start of every skill.
# --------------------------------------------------------------------------

SETTINGS_FILE = "_meta/vault-config.yaml"
LEGACY_SETTINGS_FILE = "_meta/vault-config.md"
STATE_FILE = "_meta/vault-state.json"
STAMP_KEY = "gm_apprentice_version"
# What an update that could not stamp the vault remembers for the next one:
# {"left": [choice ids answered "leave"], "said": [notices already shown]}.
# Dropped whenever the stamp is written.
HELD_KEY = "update_held"


def vault_layout(vault: Path) -> Literal["new", "legacy", "none"]:
    """Which settings file the vault is on, by which exist: "new" whenever
    `_meta/vault-config.yaml` does (an old file beside it is not read),
    "legacy" for `_meta/vault-config.md` alone, "none" for neither. The
    publish tool's `layoutOf` says the same."""
    if (vault / SETTINGS_FILE).is_file():
        return "new"
    if (vault / LEGACY_SETTINGS_FILE).is_file():
        return "legacy"
    return "none"


def settings_file(vault: Path) -> str:
    """The vault-relative name of the file the vault's settings are in, for
    a message: the new file, unless the vault is still on the old one."""
    return (LEGACY_SETTINGS_FILE if vault_layout(vault) == "legacy"
            else SETTINGS_FILE)


def stamp_file(vault: Path) -> str:
    """The vault-relative name of the file that holds the version stamp."""
    return (LEGACY_SETTINGS_FILE if vault_layout(vault) in ("legacy", "none")
            else STATE_FILE)


class StateUnreadable(RuntimeError):
    """`_meta/vault-state.json` is not a JSON object. The message is one
    plain line."""


def _read_state(vault: Path) -> dict[str, Any]:
    """The state file's keys ({} when there is no file)."""
    try:
        text = (vault / STATE_FILE).read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeDecodeError) as e:
        raise StateUnreadable(
            f"{STATE_FILE} could not be read ({e.__class__.__name__})") from e
    try:
        data = json.loads(text)
    except ValueError as e:
        raise StateUnreadable(f"{STATE_FILE} is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise StateUnreadable(
            f"{STATE_FILE} is not valid JSON: expected an object")
    return data


def read_stamp(vault: Path) -> str | None:
    """The plugin version the vault was last updated to, None when it
    records none. On the new layout it is `vault-state.json`'s
    `gm_apprentice_version` (a broken file raises `StateUnreadable`).
    On the old layout it is the old settings file's frontmatter: that
    branch is legacy and goes two releases after 1.10.54."""
    if vault_layout(vault) == "new":
        found: Any = _read_state(vault).get(STAMP_KEY)
    else:
        try:
            fm = extract_frontmatter((vault / LEGACY_SETTINGS_FILE).read_text(
                encoding="utf-8-sig", errors="replace")) or {}
        except OSError:
            fm = {}
        found = fm.get(STAMP_KEY)
    if not found or isinstance(found, (list, dict)):
        return None
    return str(found)


def write_stamp(vault: Path, version: str) -> None:
    """Record `version` as the plugin version the vault was updated to. On
    the new layout the state file is read, the one key changed and the file
    written whole in the form the publish tool writes it (two-space indent,
    a trailing newline, every other key and the key order kept), through a
    temporary file swapped in. On the old layout the old file's frontmatter
    line is edited (legacy, goes two releases after 1.10.54)."""
    if vault_layout(vault) != "new":
        from migrate_core import edit_frontmatter
        edit_frontmatter(
            vault / LEGACY_SETTINGS_FILE,
            lambda fm, eol: set_key(fm, STAMP_KEY, f'"{version}"', eol))
        return
    state = _read_state(vault)
    state[STAMP_KEY] = version
    state.pop(HELD_KEY, None)
    _write_state(vault, state)


def read_held(vault: Path) -> dict[str, set[str]]:
    """The `left` and `said` ids a held update remembered. Only the new
    layout keeps them; an old-layout vault moves in the same update."""
    if vault_layout(vault) != "new":
        return {"left": set(), "said": set()}
    held = _read_state(vault).get(HELD_KEY)
    held = held if isinstance(held, dict) else {}
    return {key: {str(i) for i in held[key]}
            if isinstance(held.get(key), list) else set()
            for key in ("left", "said")}


def write_held(vault: Path, left: set[str], said: set[str]) -> None:
    """Remember the ids for the next update (merged with those already
    remembered); nothing is written on the old layout."""
    if vault_layout(vault) != "new":
        return
    before = read_held(vault)
    left, said = left | before["left"], said | before["said"]
    state = _read_state(vault)
    if not left and not said:
        return
    state[HELD_KEY] = {"left": sorted(left), "said": sorted(said)}
    _write_state(vault, state)


def _write_state(vault: Path, state: dict[str, Any]) -> None:
    target = (vault / STATE_FILE).resolve()
    text = json.dumps(state, indent=2, ensure_ascii=False) + "\n"
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, target)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    forget_settings(vault)


# --------------------------------------------------------------------------
# Settings: the publish tool reads the vault's settings file, declares every
# setting and its default, and checks the file. Python parses none of it; it
# asks `gm-publish settings` and gets JSON. Nothing here falls back to a
# default when the tool cannot be asked: a caller that cannot read the
# settings must stop, never publish more.
# --------------------------------------------------------------------------


class SettingsUnavailable(RuntimeError):
    """The settings could not be read or written. The message is one plain
    line. `refused` is True when the tool ran and turned a `set` or `unset`
    down (the message is its reason, for the GM); False when the tool could
    not be asked at all (node or the tool missing, bad output, a timeout)."""

    def __init__(self, message: str, *, refused: bool = False) -> None:
        super().__init__(message)
        self.refused = refused


@dataclass(frozen=True)
class Settings:
    """What the tool says the vault's settings are. Every call to
    `settings()` returns a fresh copy, so changing one never reaches the
    next caller."""

    values: dict[str, Any]
    origins: dict[str, str]
    faults: list[dict[str, Any]]
    # Whether the file holds the block the site's settings live in
    # (`player_site:`; on the old file `publish:`). A key with nothing under
    # it does not count.
    has_site_block: bool
    # Old file only: its `publish:` block is written on one line.
    inline: bool
    # Each setting's name as THIS vault's file writes it (the tool's answer):
    # the same name on the new file, the old file's name on the old one.
    names: dict[str, str] = field(default_factory=dict)

    def named(self, name: str) -> str:
        """`name` as the vault's own file writes it, for a message."""
        return self.names.get(name, name)

    def get(self, name: str) -> Any:
        """The value of `name`; a KeyError for a name that is no setting."""
        return copy.deepcopy(self.values[name])

    def written(self, name: str) -> bool:
        """Whether the GM wrote `name` (its origin is not the default)."""
        return self.origins[name] != "default"


# The cache and its defaults are filled without a lock: not safe to fill
# from several threads at once. A caller that starts threads must read the
# settings it needs before starting them.
_SettingsKey = tuple[Path, Path | None]
_SETTINGS_CACHE: dict[_SettingsKey, dict[str, Any]] = {}
_DEFAULTS_CACHE: dict[str, Any] = {}


_REASON_LIMIT = 200


def _cut(text: str) -> str:
    return text if len(text) <= _REASON_LIMIT else text[:_REASON_LIMIT - 1] + "…"


def _stderr_reason(raw: bytes) -> tuple[str, bool]:
    """(the reason, whether it is the command's own). The command's own
    complaint is made only of `Error: ...` lines, and its reason is the last
    one. Anything else (a Node stack trace, a missing module) is a tool that
    did not start: the first line that names an error (`Error`, `TypeError`, ...), else the first
    line."""
    lines = [ln.strip() for ln in raw.decode("utf-8", "replace").splitlines()
             if ln.strip()]
    if not lines:
        return "", False
    if all(ln.startswith("Error: ") for ln in lines):
        return _cut(lines[-1].removeprefix("Error: ")), True
    first = next((ln for ln in lines if re.match(r"\w*Error\b", ln)), lines[0])
    return _cut(first), False


def _check_vault(vault: Path) -> None:
    if not vault.is_dir():
        raise SettingsUnavailable(
            f"could not read the vault's settings: {vault.as_posix()} "
            "is not a folder")


def _check_names(names: list[str]) -> None:
    """A name that begins with `-` would be read as an option."""
    for name in names:
        if name.startswith("-"):
            raise SettingsUnavailable(f"{name} is not a setting",
                                      refused=True)


def _run_settings(args: list[str], *, refusable: bool = False,
                  blockable: bool = False) -> Any:
    """Run `gm-publish settings <args>` and return its JSON. A refusal
    (`refusable`) carries the command's own reason; any other failure reads
    "could not read the vault's settings: <reason>"."""
    def fail(reason: str) -> SettingsUnavailable:
        return SettingsUnavailable(
            f"could not read the vault's settings: {reason}")

    node = shutil.which("node")
    if not node:
        raise fail("node is not on PATH")
    if not PUBLISH_TOOL.is_file():
        raise fail(f"the publish tool is not at {PUBLISH_TOOL.as_posix()}")
    try:
        done = subprocess.run(
            [node, str(PUBLISH_TOOL), "settings", *args, "--json"],
            capture_output=True, stdin=subprocess.DEVNULL,
            timeout=PUBLISH_LINES_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise fail(f"the publish tool did not answer within "
                   f"{PUBLISH_LINES_TIMEOUT}s") from e
    except OSError as e:
        raise fail(f"node could not run ({e.__class__.__name__})") from e
    if done.returncode != 0:
        if blockable:
            # A blocked move exits 1 and still answers in JSON, with its
            # blockers; that answer is the reason.
            try:
                blocked = json.loads(done.stdout.decode("utf-8", "replace"))
            except ValueError:
                blocked = None
            if isinstance(blocked, dict) and blocked.get("ok") is False:
                return blocked
        reason, own = _stderr_reason(done.stderr)
        if own and refusable:
            raise SettingsUnavailable(reason, refused=True)
        if own:
            raise fail(reason)
        started = ("the publish tool failed to start "
                   f"({reason or 'exit code ' + str(done.returncode)})")
        if refusable:
            raise SettingsUnavailable(started)
        raise fail(started)
    try:
        return json.loads(done.stdout.decode("utf-8", "replace"))
    except ValueError as e:
        raise fail("the publish tool did not answer in JSON") from e


def run_relationships(vault: Path, args: list[str]) -> Any:
    """Run `gm-publish relationships <args> --json --vault VAULT` and return
    its JSON. The publish tool's reader is the one place a note's
    `relationships:` block is parsed, so a script that needs the ties asks
    it (as `settings` asks `settings`). The tool's own refusal (`Error: ...`,
    exit 1) is raised as its one-line reason; any other failure says the tool
    could not be asked."""
    def fail(reason: str) -> PublishToolUnavailable:
        return PublishToolUnavailable(
            f"could not ask the publish tool about the relationships: "
            f"{reason}")

    node = shutil.which("node")
    if not node:
        raise fail("node is not on PATH")
    if not PUBLISH_TOOL.is_file():
        raise fail(f"the publish tool is not at {PUBLISH_TOOL.as_posix()}")
    try:
        done = subprocess.run(
            [node, str(PUBLISH_TOOL), "relationships", *args, "--json",
             "--vault", str(vault)],
            capture_output=True, stdin=subprocess.DEVNULL,
            timeout=PUBLISH_LINES_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise fail(f"it did not answer within {PUBLISH_LINES_TIMEOUT}s") from e
    except OSError as e:
        raise fail(f"node could not run ({e.__class__.__name__})") from e
    if done.returncode != 0:
        reason, own = _stderr_reason(done.stderr)
        if own:
            raise PublishToolUnavailable(reason)
        raise fail(reason or f"exit code {done.returncode}")
    try:
        return json.loads(done.stdout.decode("utf-8", "replace"))
    except ValueError as e:
        raise fail("it did not answer in JSON") from e


def _target_args(vault: Path, site_config: Path | None = None) -> list[str]:
    args = ["--vault", str(vault)]
    if site_config is not None:
        args += ["--config", str(site_config)]
    else:
        # The scripts read the site folder file themselves; the tool must not
        # also read the one the vault names, or its rows would be said twice.
        args.append("--no-site-file")
    return args


def settings(vault: Path, *, site_config: Path | None = None) -> Settings:
    """Every setting of `vault`, as the publish tool reads it. Asked once
    per (vault, site_config) for the process. `site_config` is the site
    folder's vault.config.json, whose old keys take part in the read.

    The answer is fixed for the process until `settings_set`,
    `settings_unset` or `forget_settings`. Anything else that writes the
    settings file or the site's vault.config.json (templates, migrations,
    the scaffold) must call `forget_settings(vault)` afterwards, or a later
    read here is stale."""
    _check_vault(vault)
    key = (vault.resolve(),
           site_config.resolve() if site_config is not None else None)
    if key not in _SETTINGS_CACHE:
        answer = _run_settings(["get", *_target_args(vault, site_config)])
        try:
            _SETTINGS_CACHE[key] = {
                "values": dict(answer["values"]),
                "origins": dict(answer["origins"]),
                "faults": list(answer["faults"]),
                "file": dict(answer["file"]),
                "names": dict(answer.get("written") or {}),
            }
        except (KeyError, TypeError, AttributeError, ValueError) as e:
            raise SettingsUnavailable(
                "could not read the vault's settings: the publish tool's "
                "answer was not in the shape expected") from e
    read = copy.deepcopy(_SETTINGS_CACHE[key])
    return Settings(
        values=read["values"], origins=read["origins"], faults=read["faults"],
        has_site_block=bool(read["file"].get("hasSiteBlock")),
        inline=bool(read["file"].get("inline")), names=read["names"])


def setting_name(vault: Path, name: str) -> str:
    """`name` as the vault's own file writes it, for a message to the GM.
    The tool says (never a table here); when it cannot be asked the new name
    stands."""
    try:
        return settings(vault).named(name)
    except SettingsUnavailable:
        return name


# The vault file's own words, as against a value that came from the site
# folder's old file or an old name.
_IN_VAULT_FILE = ("file", "fault")


def written_in_vault_file(s: Settings, name: str) -> bool:
    """Whether the GM wrote `name` in the vault's settings file (a value the
    tool could not read counts: it is written, and reads as the tool says)."""
    return s.origins[name] in _IN_VAULT_FILE


def site_switch_written(s: Settings) -> bool | None:
    """`player_site.publish` when the vault file writes it (True or False; a
    value that is not a switch word reads off), else None."""
    if not written_in_vault_file(s, "player_site.publish"):
        return None
    return bool(s.get("player_site.publish"))


def site_without_tool(s: Settings) -> bool:
    """Whether the vault has a site, for the one time the publish tool's
    site answer cannot be had: the switch where the vault file writes it,
    else whether a site folder is set."""
    switch = site_switch_written(s)
    if switch is not None:
        return switch
    return bool(s.get("player_site.folder"))


def settings_set(vault: Path, pairs: list[tuple[str, object]], *,
                 create: bool = False) -> list[str]:
    """Write settings, all or none; the names written. A value the tool
    refuses raises SettingsUnavailable (refused=True) with its reason.
    `create` makes the settings file when the vault has none."""
    _check_vault(vault)
    _check_names([n for n, _ in pairs])
    args = ["set", *_target_args(vault)]
    if create:
        args.append("--create")
    args += [f"{name}={json.dumps(value)}" for name, value in pairs]
    forget_settings(vault)
    answer = _run_settings(args, refusable=True)
    return [str(n) for n in answer["written"]]


def settings_unset(vault: Path, names: list[str]) -> list[str]:
    """Remove settings from the file, all or none; the names that were
    there. Refusals raise as `settings_set`'s do."""
    _check_vault(vault)
    _check_names(names)
    forget_settings(vault)
    answer = _run_settings(["unset", *_target_args(vault), *names],
                           refusable=True)
    return [str(n) for n in answer["removed"]]


def settings_written(vault: Path, name: str) -> tuple[Any, str]:
    """What `settings get` says of one name as the file holds it: (value,
    origin). Unlike `settings`, it answers for a retired name too, with the
    value the file still writes and origin `file`; a name the file does not
    write is (None, "default"). Not cached."""
    _check_vault(vault)
    _check_names([name])
    answer = _run_settings(["get", *_target_args(vault), name])
    return answer["values"].get(name), str(answer["origins"].get(name))


def settings_carry(vault: Path, written: str, name: str) -> list[str]:
    """Put the value of the key `written` (a mis-named key in the new file)
    under the setting `name`, validated, and remove the key: one change, all
    or none. A list's entries are added to the list. Refusals raise as
    `settings_set`'s do."""
    _check_vault(vault)
    _check_names([written, name])
    forget_settings(vault)
    answer = _run_settings(["carry", *_target_args(vault), written, name],
                           refusable=True)
    return [str(answer["into"])]


def settings_move_plan(vault: Path) -> dict[str, Any]:
    """What `settings move --check` says of a vault: `ok`, `lines`,
    `blockers`, `files`, and for a moved vault with an old file left beside
    the new one, `leftover` (`redundant`, `keys`). Writes nothing."""
    _check_vault(vault)
    answer = _run_settings(["move", *_target_args(vault), "--check"],
                           blockable=True)
    if not isinstance(answer, dict):
        raise SettingsUnavailable(
            "could not read the vault's settings: the publish tool's "
            "answer was not in the shape expected")
    return answer


def settings_tidy(vault: Path, *, discard_old_file: bool = False) -> list[str]:
    """Tidy a moved vault (`settings move` on it): remove what a stopped
    move left, the old settings file when it holds nothing the new one
    lacks (always, with `discard_old_file`). The lines it reports."""
    _check_vault(vault)
    forget_settings(vault)
    args = ["move", *_target_args(vault)]
    if discard_old_file:
        args.append("--discard-old-file")
    answer = _run_settings(args, refusable=True)
    forget_settings(vault)
    return [str(x) for x in answer.get("lines", [])]


def settings_fold_site_file(vault: Path,
                            keys: list[str] | None = None) -> list[str]:
    """On a vault already on the new file, take the settings its site
    folder's vault.config.json still holds out of that file, in one change
    across both files: a hiding list's entries are added to the vault's list,
    the stricter callout rule is kept, any other value is the vault's own
    already. With `keys` (site-file key names, `package.json` or
    `package.json <script>`) only those are taken and every other key is
    left where it is. The lines the tool reports."""
    _check_vault(vault)
    forget_settings(vault)
    only = [a for k in keys or [] for a in ("--only", k)]
    answer = _run_settings(
        ["move", *_target_args(vault), "--fold-site-file", *only],
        refusable=True, blockable=True)
    if answer.get("ok") is False:
        said = " ".join(str(b) for b in answer.get("blockers") or [])
        raise SettingsUnavailable(said or "the move was blocked",
                                  refused=True)
    forget_settings(vault)
    return [str(x) for x in answer.get("lines", [])]


def settings_add(vault: Path, name: str, entries: list[str]) -> list[str]:
    """Add entries to the list setting `name`, keeping what it holds now
    (the built-in list included); the entries that were new. Refusals raise
    as `settings_set`'s do."""
    _check_vault(vault)
    _check_names([name])
    forget_settings(vault)
    answer = _run_settings(
        ["add", *_target_args(vault), name,
         *[json.dumps(e) for e in entries]], refusable=True)
    return [str(e) for e in answer["added"]]


def settings_remove(vault: Path, name: str, entries: list[str]) -> list[str]:
    """Remove entries from the list setting `name`; the entries that were
    there. Refusals raise as `settings_set`'s do."""
    _check_vault(vault)
    _check_names([name])
    forget_settings(vault)
    answer = _run_settings(
        ["remove", *_target_args(vault), name,
         *[json.dumps(e) for e in entries]], refusable=True)
    return [str(e) for e in answer["removed"]]


def settings_describe(name: str) -> dict[str, Any]:
    """What the tool says of one setting: `{"name", "kind", "does",
    "takes", "default", "guards", "oldNames"}`. A name that is no setting
    raises as `settings_set`'s refusals do."""
    _check_names([name])
    answer = _run_settings(["describe", name], refusable=True)
    if not isinstance(answer, dict):
        raise SettingsUnavailable(
            "could not read the vault's settings: the publish tool's "
            "description was not in the shape expected")
    return answer


def settings_raw(vault: Path, name: str | None = None) -> Any:
    """The settings file as written ({} when there is no file), or the
    value at `name` (None when `name` is not in the file). On the old file
    a name is asked by the old name (`publish.wrap_up`: the names that exist
    only there); the new file is asked by the new names. Not cached."""
    _check_vault(vault)
    if name is not None:
        _check_names([name])
    args = ["raw", *_target_args(vault)]
    if name is not None:
        args.append(name)
    return _run_settings(args)


def settings_default(name: str) -> Any:
    """The built-in default of the setting `name`; KeyError if no such
    setting. Asked of the tool once for the process."""
    if not _DEFAULTS_CACHE:
        answer = _run_settings(["list"])
        try:
            _DEFAULTS_CACHE.update(
                {n["name"]: n["default"] for n in answer["names"]})
        except (KeyError, TypeError) as e:
            raise SettingsUnavailable(
                "could not read the vault's settings: the publish tool's "
                "list was not in the shape expected") from e
    return copy.deepcopy(_DEFAULTS_CACHE[name])


SETTINGS_SCHEMA = (Path(__file__).resolve().parents[3] / "tools" / "publish"
                   / "schema" / "vault-config.schema.json")
_NO_NODE_NOTICE = ("Node was not found, so this vault's own settings were not "
                   "read; the built-in values were used.")
_NO_NODE_NOTICE_GIVEN = False


def _schema_default(name: str) -> Any:
    """The `default` of setting `name` in the generated schema file, read
    with `json`. KeyError when the schema gives the name none."""
    try:
        node = json.loads(SETTINGS_SCHEMA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SettingsUnavailable(
            "could not read the vault's settings: the built-in values are "
            f"not at {SETTINGS_SCHEMA.as_posix()}") from e
    for part in name.split("."):
        node = node.get("properties", {}).get(part)
        if node is None:
            raise KeyError(name)
    if "default" not in node:
        raise KeyError(name)
    return copy.deepcopy(node["default"])


def setting_or_builtin(vault: Path, name: str) -> Any:
    """The value of setting `name` for `vault`, from the publish tool. For a
    command that has to keep running where Node cannot be run, the built-in
    value (the schema file's default) and one line on stderr, once per
    process. A name the schema gives no default raises KeyError there; any
    other failure of the tool is raised, never hidden."""
    global _NO_NODE_NOTICE_GIVEN
    try:
        return settings(vault).get(name)
    except SettingsUnavailable:
        if shutil.which("node"):
            raise
    if not _NO_NODE_NOTICE_GIVEN:
        _NO_NODE_NOTICE_GIVEN = True
        print(_NO_NODE_NOTICE, file=sys.stderr)
    return _schema_default(name)


def report_unreadable_settings(main: Callable[[], int]) -> int:
    """`main()`'s exit code; settings that cannot be read (a typo in the
    settings file, no publish tool) end the command with one `error:` line
    on stderr and exit code 2, never a traceback."""
    try:
        return main()
    except SettingsUnavailable as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


def forget_settings(vault: Path | None = None) -> None:
    """Drop what was read for `vault` (every vault with None). Call it after
    anything that writes the vault's settings file or the site's
    vault.config.json other than `settings_set` and `settings_unset`, which
    do it themselves."""
    if vault is None:
        _SETTINGS_CACHE.clear()
        return
    here = vault.resolve()
    for key in [k for k in _SETTINGS_CACHE if k[0] == here]:
        del _SETTINGS_CACHE[key]


def vault_site(vault: Path) -> tuple[bool, bool, Path | None]:
    """(whether the vault file has a `publish:` block, whether the vault
    has a site, the site folder its `site_dir` names). `player_site.publish` is
    the switch: off is no site whatever `site_dir` says, and on with no
    folder is a site still to be set up. Asked of the plugin's own publish
    tool, which reads the file with the build's YAML parser. Raises
    `PublishToolUnavailable` when the tool cannot be asked or cannot
    parse the file."""
    answer = _LINES_BY_TOOL[PUBLISH_TOOL].ask(
        {"op": "site", "vault": str(vault.resolve())})
    publishes, on = answer.get("publishes"), answer.get("site")
    site = answer.get("siteDir")
    if (not isinstance(publishes, bool) or not isinstance(on, bool)
            or not (site is None or isinstance(site, str))):
        raise PublishToolUnavailable(
            "the publish tool's answer about the site is not understood")
    return publishes, on, Path(site) if site else None


def google_fonts(vault: Path, site_config: Path | None = None) -> list[str]:
    """The font families the vault's site would load from Google (none when
    its fonts are hosted), worked out by the plugin's own publish tool, never
    the site's pinned copy. `site_config` is the site's vault.config.json.
    Raises `PublishToolUnavailable` when it cannot be asked."""
    request: dict[str, Any] = {"op": "google-fonts",
                               "vault": str(vault.resolve())}
    if site_config is not None:
        request["config"] = str(site_config.resolve())
    families = _LINES_BY_TOOL[PUBLISH_TOOL].ask(request).get("families")
    if not (isinstance(families, list)
            and all(isinstance(f, str) for f in families)):
        raise PublishToolUnavailable(
            "the publish tool's answer about fonts is not understood")
    return families


def publish_rename_refs(vault: Path, old: str, new: str,
                        config: Path | None = None,
                        names: Iterable[str] = (),
                        tool: Path | None = None) -> dict[str, Any]:
    """What renaming the note `old` to `new` (vault-relative paths) changes
    in the files the publish tool owns, asked of the plugin's own tool:
    `{"files": {path: new text}, "pin": {"live_key": slug}, "companions":
    [{"from", "to"}], "owners": {spelling: path or null}}` (`owners`
    only for the `names` asked: where the site's link map sends each
    spelling), or
    `"detaches"` / `"refusal"` / `"unpublishes"` with a reason in place of an answer, `"published"` (the notes the site publishes, with `names`)
    (`pin` only for a page the site keeps live state for). `config`, the
    site's vault.config.json, is read by the tool when given; `tool` is
    the one to ask (the plugin's own when None). Writes
    nothing. Raises `PublishToolUnavailable` when it cannot be asked or
    its answer is not understood."""
    args = ["manifest", "rename", "--vault", str(vault.resolve()),
            "--from", old, "--to", new, "--json"]
    if config is not None:
        args += ["--config", str(config)]
    for name in names:
        args += ["--name", name]
    asked = _LINES_BY_TOOL[PUBLISH_TOOL] if tool is None else PublishLines(tool)
    out = asked.run_once(args)
    bad = PublishToolUnavailable("the publish tool's answer was not understood")
    try:
        answer = json.loads(out)
    except ValueError as e:
        raise bad from e
    if not isinstance(answer, dict):
        raise bad

    def text_or_none(v: Any) -> bool:
        return v is None or isinstance(v, str)

    files, pin = answer.get("files"), answer.get("pin")
    companions = answer.get("companions", [])
    if (not isinstance(files, dict)
            or not all(isinstance(k, str) and isinstance(v, str)
                       for k, v in files.items())
            or not (pin is None or (isinstance(pin, dict) and isinstance(
                pin.get("live_key"), str) and pin["live_key"]))
            or not isinstance(companions, list)
            or not all(isinstance(c, dict) and isinstance(c.get("from"), str)
                       and isinstance(c.get("to"), str)
                       for c in companions)
            or not (answer.get("owners") is None or (
                isinstance(answer["owners"], dict)
                and all(isinstance(k, str) and text_or_none(v)
                        for k, v in answer["owners"].items())))
            or not text_or_none(answer.get("detaches"))
            or not text_or_none(answer.get("unpublishes"))
            or not (answer.get("published") is None or (
                isinstance(answer["published"], list)
                and all(isinstance(x, str) for x in answer["published"])))
            or not text_or_none(answer.get("refusal"))):
        raise bad
    return answer


def publish_tool_problem() -> str | None:
    """Why the publish tool cannot be asked what publishes, or None when it
    can. A check that depends on the answer asks this first and says so,
    rather than guess."""
    try:
        PUBLISH_LINES.ask({"op": "sections", "text": "", "excludeSections": []})
    except PublishToolUnavailable as e:
        return str(e)
    return None


def withheld_by(lines: list[str], exclude_sections: Iterable[str]
                ) -> list[str | None]:
    """For each line, the excluded section that withholds it on the site,
    or None. The publish tool's own section walk."""
    excludes = [str(s) for s in exclude_sections]
    if not excludes or not lines:
        return [None] * len(lines)
    answer = PUBLISH_LINES.ask({"op": "sections", "text": "\n".join(lines),
                                "excludeSections": excludes})
    verdicts = answer.get("withheldBy")
    if not isinstance(verdicts, list) or len(verdicts) != len(lines):
        raise PublishToolUnavailable(
            "the publish tool's answer does not match the note's lines")
    return [v if isinstance(v, str) else None for v in verdicts]


def cut_lines(lines: list[str]) -> list[str | None]:
    """For each line, what the publish tool's strip chain leaves of it
    (gm-only and spoiler blocks, HTML and `%%` comments), or None when
    the chain removes the line. `PublishToolUnavailable` when it cannot
    be asked, or answers without the `cut` op (a tool older than the one
    that added it)."""
    if not lines:
        return []
    answer = PUBLISH_LINES.ask({"op": "cut", "text": "\n".join(lines)})
    cut = answer.get("cut")
    if (not isinstance(cut, list) or len(cut) != len(lines)
            or not all(c is None or isinstance(c, str) for c in cut)):
        raise PublishToolUnavailable(
            "the publish tool's answer does not match the note's lines")
    return cut


def stub_kept(lines: list[str], include: Iterable[Any]) -> list[bool]:
    """For each line, whether a `publish: stub` page with these
    `publish_include_sections` keeps it. The publish tool's own answer."""
    if not lines:
        return []
    answer = PUBLISH_LINES.ask({
        "op": "stub", "text": "\n".join(lines),
        "include": [s for s in include if isinstance(s, str)]})
    kept = answer.get("kept")
    if not isinstance(kept, list) or len(kept) != len(lines):
        raise PublishToolUnavailable(
            "the publish tool's answer does not match the note's lines")
    return [k is True for k in kept]


@dataclass
class LineState:
    """What the publish pipeline would make of one body line."""

    lineno: int
    line: str
    in_code: bool
    gm_depth: int
    spoiler_depth: int
    excluded_by: str | None
    heading: tuple[int, str] | None
    marker: str | None

    @property
    def published(self) -> bool:
        return (self.gm_depth == 0 and self.spoiler_depth == 0
                and self.excluded_by is None and self.marker is None)

    @property
    def written(self) -> str:
        """The line as written in the note."""
        return self.line


@dataclass
class BuildLine:
    """One body line as the build reads it (`build_lines`): the publish
    tool's own strip chain and section filter, nothing modelled here."""

    lineno: int
    written: str  # the line as written, `\r` dropped as the build drops it
    line: str  # what the strip chain leaves of it; "" when it is cut
    cut: bool  # the strip chain removes the line
    excluded_by: str | None
    in_code: bool
    heading: tuple[int, str] | None

    @property
    def published(self) -> bool:
        return not self.cut and self.excluded_by is None


def build_lines(text: str, exclude_sections: Iterable[str] = (), *,
                note_type: str | None = None,
                pc_keep: list[str] | None = None,
                callouts: Any = False,
                ) -> tuple[list[BuildLine], list[str]]:
    """Every body line of a note as the build reads it, and the gm-only and
    spoiler markers its block strips find unbalanced, as `scan_body`'s
    problems are worded.

    The build splits at `\\n` alone (a form feed, `\\x85` or a lone `\\r`
    is inside a line) and drops `\\r`; `text` must be the file as written,
    not read with universal newlines. Which lines the strip chain cuts
    (gm-only and spoiler blocks, HTML and `%%` comments, dataview, the
    hidden callouts) and which an excluded section withholds is the
    publish tool's one `cut` answer, given the page's section rules: the
    exclude list, the note's `type:` (`note_type`), the PC keep-list while
    sheets are off (`pc_keep`) and `player_site.hide.callouts`
    (`callouts`). So a withheld heading inside a hidden block withholds
    the text after the block, as on the site (#447). A tool older than
    that answers without `withheldBy`: the section filter is then asked
    about the lines left. Headings and code fences are read from what is
    left. Raises `PublishToolUnavailable` when the tool cannot be asked,
    and `PublishToolTooOld` when it predates `cut`."""
    lines = text.split("\n")
    if len(lines) > 1 and lines[-1] == "":
        lines.pop()
    lines = [line.replace("\r", "") for line in lines]
    start = 0
    if lines and lines[0].strip() == "---":
        start = next((i + 1 for i in range(1, len(lines))
                      if lines[i].strip() == "---"), 0)
    body = lines[start:]
    if not body:
        return [], []
    excludes = [str(s) for s in exclude_sections]
    request: dict[str, Any] = {
        "op": "cut", "text": "\n".join(body), "excludeSections": excludes,
        "type": note_type, "pcKeepSections": pc_keep,
        "excludeCallouts": callouts if isinstance(callouts, (bool, list))
        else False}
    try:
        answer = PUBLISH_LINES.ask(request)
    except PublishToolUnavailable as e:
        if "unknown op" in str(e):
            raise PublishToolTooOld(CUT_SINCE) from e
        raise
    cut = answer.get("cut")
    unbalanced = answer.get("unbalanced")
    own = _LINES_BY_TOOL[PUBLISH_TOOL]
    if unbalanced is None and PUBLISH_LINES is not own:
        # A site's tool from before the faults were reported: where the
        # blocks run is still its answer; only the faults' lines are the
        # plugin's tool's.
        unbalanced = own.ask({"op": "cut", "text": request["text"]}).get(
            "unbalanced")
    by = answer.get("withheldBy")
    if by is not None and (
            not isinstance(by, list) or len(by) != len(body)
            or not all(v is None or isinstance(v, str) for v in by)):
        raise PublishToolUnavailable(
            "the publish tool's answer does not match the note's lines")
    if (not isinstance(cut, list) or len(cut) != len(body)
            or not all(c is None or isinstance(c, str) for c in cut)
            or not isinstance(unbalanced, list)
            or not all(isinstance(u, dict)
                       and isinstance(u.get("line"), int)
                       and 0 <= u["line"] < len(body)
                       and u.get("marker") in ("gm-only", "spoiler")
                       and isinstance(u.get("close"), bool)
                       for u in unbalanced)):
        raise PublishToolUnavailable(
            "the publish tool's answer does not match the note's lines")
    if by is not None:
        verdicts = iter([v for v, c in zip(by, cut) if c is not None])
    else:
        # A tool from before #447: the section filter asked about the
        # lines the strips left, in a second question.
        verdicts = iter(withheld_by([c for c in cut if c is not None],
                                    excludes))
    states: list[BuildLine] = []
    fence_delim: str | None = None
    for i, (written, kept) in enumerate(zip(body, cut)):
        lineno = start + i + 1
        if kept is None:
            states.append(BuildLine(lineno, written, "", True, None, False,
                                    None))
            continue
        fence_delim, is_fence_line = fence_step(kept, fence_delim)
        in_code = fence_delim is not None or is_fence_line
        hm = None if in_code else HEADING_RE.match(kept)
        states.append(BuildLine(
            lineno, written, kept, False, next(verdicts), in_code,
            (len(hm.group(1)), atx_title(hm.group(2))) if hm else None))
    problems = [f"line {start + u['line'] + 1}: <!-- /{u['marker']} --> "
                f"with no opener" for u in sorted(
                    (u for u in unbalanced if u["close"]),
                    key=lambda u: u["line"])]
    for _name, word in _MARKERS:
        problems += [f"line {start + u['line'] + 1}: <!-- {word} --> "
                     f"never closed" for u in unbalanced
                     if not u["close"] and u["marker"] == word]
    return states, problems


def scan_body(text: str,
              exclude_sections: Iterable[str] = ()) -> tuple[list[LineState],
                                                             list[str]]:
    """Classify every body line the way the publish pipeline would.

    Mirrors tools/publish/lib/processor.js `stripMarkedBlocks` for the
    `<!-- gm-only -->` / `<!-- spoiler -->` fences. Excluded sections are
    not modelled here: with an exclude list, the publish tool is asked
    which lines its section filter withholds (`withheld_by`), and
    `PublishToolUnavailable` is raised when it cannot be.

    The two behaviours worth restating, because both were bugs once:

    * Code fences are tracked by their *delimiter*, not a boolean, per
      CommonMark: a fence closes only on the same character, at least as
      long as the opener, with nothing but whitespace after it. A marker
      shown inside a fenced example is documentation, not a directive —
      this repo's own docs are full of them (#168's sibling defect).
    * Marker depth nests. An inner closer closes only the inner block;
      with a boolean it ended the outer one and published everything
      after it, silently, which is the worst possible failure of the one
      primitive whose whole job is hiding things (#168).

    The section filter is asked about the note with its marker lines and
    marker blocks blanked, so a `## GM Notes` written inside a
    `<!-- gm-only -->` block (the shape `wrapup --fix` writes) neither
    starts nor ends an exclusion here.

    Known divergences of the marker model, which can err either way — so
    the leak checks do not use it: the leak invariant in vault_check.py
    reads `publisher_lines` and gm-leak reads `build_lines`, the tool's
    own answers (#441, #447). What still calls this is writers and
    structure checks, which need to see inside the blocks:

    * The site puts a withheld heading from a hidden block back where the
      block ends (#447), so the text after a fenced `## GM Notes`, up to
      the next heading of its level or higher, is withheld there and
      called published here.
    * Only the two marker blocks are blanked before the tool is asked,
      not multi-line HTML comments. A `## GM Notes` commented out that
      way starts its exclusion here at the heading, and on the site where
      the comment ends.
    * A line that starts with a marker is a marker line here, whatever
      follows it: `<!-- /gm-only -->## Public` is no heading here, and is
      one on the site.
    * Lines are split by `str.splitlines`, at a form feed, `\\x85` and a
      lone `\\r` too; the build splits at `\\n` alone.

    Returns (states, problems); problems are authoring defects — orphan
    closers and blocks left open at EOF.
    """
    excludes = [str(s) for s in exclude_sections]
    names = {word: name for name, word in _MARKERS}
    stacks: dict[str, list[tuple[bool, int]]] = {n: [] for n, _ in _MARKERS}
    depths = {name: 0 for name, _ in _MARKERS}
    open_lines: dict[str, list[int]] = {name: [] for name, _ in _MARKERS}
    words = dict(_MARKERS)

    states: list[LineState] = []
    problems: list[str] = []
    shadow: list[str] = []      # the note as `filterSections` is handed it
    fence_delim: str | None = None

    for lineno, line in iter_body_lines(text):
        # up to 3 leading spaces; 4+ would be an indented code block
        fence = FENCE_RE.match(line)
        is_fence_line = False
        if fence:
            delim, info = fence.group(1), fence.group(2)
            if fence_delim is None:
                # A backtick fence's info string may not contain a backtick.
                if delim[0] != "`" or "`" not in info:
                    fence_delim = delim
                    is_fence_line = True
            elif (delim[0] == fence_delim[0]
                  and len(delim) >= len(fence_delim)
                  and info.strip() == ""):
                fence_delim = None
                is_fence_line = True

        in_code = fence_delim is not None or is_fence_line
        marker: str | None = None
        heading: tuple[int, str] | None = None

        if not in_code:
            # Markers count wherever they sit on the line (inline, inside an
            # HTML wrapper, several per line), exactly as stripMarkedBlocks
            # does. `marker` is only set for a line that STARTS with one — the
            # own-line shape the wrap-up structure fixes reason about.
            found = [(pos, names[word], is_close)
                     for pos, word, is_close in markers_in(line)]
            for idx, (pos, name, is_close) in enumerate(found):
                inline = line[:pos].strip() != ""
                if idx == 0 and not inline:
                    marker = f"{'close' if is_close else 'open'}-{name}"
                stack = stacks[name]
                if not is_close:
                    stack.append((inline, lineno))
                    depths[name] += 1
                    open_lines[name].append(lineno)
                elif not stack:
                    # A closer with nothing open. Don't let it drive depth
                    # negative — that would make a LATER opener fail to
                    # strip. Record it instead.
                    problems.append(
                        f"line {lineno}: <!-- /{words[name]} --> "
                        f"with no opener")
                else:
                    top_inline, top_line = stack[-1]
                    if not inline or top_inline or top_line == lineno:
                        stack.pop()
                        depths[name] -= 1
                        open_lines[name].pop()

            if marker is None:
                hm = HEADING_RE.match(line)
                if hm:
                    heading = (len(hm.group(1)), atx_title(hm.group(2)))

        # Headings drive exclusion only at marker depth zero: the pipeline
        # strips marker blocks before `filterSections` runs.
        visible = (marker is None and depths["gm"] == 0
                   and depths["spoiler"] == 0)
        shadow.append(line if visible else "")

        states.append(LineState(
            lineno=lineno,
            line=line,
            in_code=in_code,
            gm_depth=depths["gm"],
            spoiler_depth=depths["spoiler"],
            excluded_by=None,
            heading=heading,
            marker=marker,
        ))

    if excludes:
        for state, title in zip(states, withheld_by(shadow, excludes)):
            state.excluded_by = title

    for name, word in _MARKERS:
        for lineno in open_lines[name]:
            problems.append(f"line {lineno}: <!-- {word} --> never closed")
    return states, problems


@dataclass(frozen=True)
class LinkLine:
    """One line of a note, as everything that reads or rewrites its links
    must see it."""

    lineno: int
    line: str  # with its line ending
    in_code: bool  # in a code fence: nothing on it is a link
    in_frontmatter: bool
    # Inline code spans, where a link is quoted, not made. In frontmatter a
    # backtick is YAML, not code, so the only span there is a YAML comment.
    spans: list[tuple[int, int]]


# A line that opens a block scalar (`key: |`, `- >-`, `key: |2`): the
# indented lines after it are its text, where `#` is no comment.
_YAML_BLOCK_SCALAR = re.compile(r"(?:^|[:-])\s+[|>][1-9+-]{0,2}$")


def _yaml_line_comment(line: str, quote: str) -> tuple[int | None, str]:
    """Where a YAML comment starts on one line (None when it has none) and
    the quote still open at its end, given the quote open at its start: a
    `#` at the start or after whitespace, outside quotes. `\\` in double
    quotes escapes the next character."""
    i = 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\" and quote == '"':
                i += 1
            elif ch == quote:
                quote = ""
        elif ch in "\"'" and (i == 0 or not line[i - 1].isalnum()):
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            return i, quote
        i += 1
    return None, quote


def yaml_comment_spans(lines: Sequence[str]) -> list[list[tuple[int, int]]]:
    """Each frontmatter line's YAML comment span, from its `#` to the line's
    end. The build never renders it, so a `[[link]]` in it is an example,
    not a link. A block scalar's lines and the inside of a quoted value that
    runs over lines have none."""
    out: list[list[tuple[int, int]]] = []
    quote = ""
    block: int | None = None
    for line in lines:
        text = line.rstrip("\r\n")
        indent = len(text) - len(text.lstrip(" "))
        if block is not None and (not text.strip() or indent > block):
            out.append([])
            continue
        block = None
        opened = quote
        at, quote = _yaml_line_comment(text, quote)
        out.append([] if at is None else [(at, len(line))])
        code = text[:at].rstrip() if at is not None else text.rstrip()
        if not opened and not quote and _YAML_BLOCK_SCALAR.search(code):
            block = indent
    return out


def link_lines(text: str) -> Iterator[LinkLine]:
    """Every line of a note, in order, classified for link work. The one
    definition of which lines hold live links: `graph_check.py` reads them,
    `relink.py` and `links.py` rewrite them, and the three must agree or a
    link one reports is a link another skips.

    Frontmatter is everything before `scan_body`'s first body line; a note
    that is only frontmatter has no body line at all."""
    lines = text.splitlines(keepends=True)
    states, _ = scan_body(text)
    code = {s.lineno for s in states if s.in_code}
    body_start = states[0].lineno if states else len(lines) + 1
    fm_spans = yaml_comment_spans(lines[:body_start - 1])
    for lineno, line in enumerate(lines, 1):
        in_fm = lineno < body_start
        yield LinkLine(lineno, line, lineno in code, in_fm,
                       fm_spans[lineno - 1] if in_fm
                       else inline_code_spans(line))


# The one definition of an UNVERIFIED marker: `<!-- UNVERIFIED: claim -->`,
# tagged with the session that wrote it as `<!-- UNVERIFIED (S12): claim -->`,
# or `(Ch4 S12)` where session numbers restart each chapter. Untagged
# markers predate tags. The publish tool strips every HTML comment, so it
# needs no parser of its own.
UNVERIFIED_RE = re.compile(
    r"<!--\s*UNVERIFIED\b(?:\s*\(\s*(?:Ch\s*(\d+(?:\.\d+)?)\s+)?S\s*(\d+)\s*\))?(.*?)-->",
    re.I | re.S)


@dataclass(frozen=True)
class Unverified:
    line: int
    chapter: str | None
    session: int | None  # None: untagged
    text: str

    @property
    def tag(self) -> str:
        if self.session is None:
            return ""
        return (f"Ch{self.chapter} " if self.chapter else "") + f"S{self.session}"

    def from_session(self, number: int, chapter: str | None) -> bool | None:
        """Whether the session numbered `number` (in `chapter`, when known)
        wrote this marker; None for an untagged one. A chapter on only one
        side is judged by number alone."""
        if self.session is None:
            return None
        if self.session != number:
            return False
        return same_chapter(chapter, self.chapter)


def same_chapter(a: str | None, b: str | None) -> bool:
    """Whether two chapter numbers name one chapter, compared as numbers
    ("01" is "1"). A chapter missing on either side matches any."""
    return a is None or b is None or float(a) == float(b)


def _blank_spans(line: str, spans: list[tuple[int, int]]) -> str:
    """The line with each character inside a span turned to a space."""
    return "".join(" " if inside_spans(i, spans) and c != "\n" else c
                   for i, c in enumerate(line))


def unverified_markers(text: str) -> list[Unverified]:
    """Each UNVERIFIED marker outside code, inline code and frontmatter (any
    case; one may span lines)."""
    body = "".join("\n" if ll.in_code or ll.in_frontmatter
                   else _blank_spans(ll.line, ll.spans)
                   for ll in link_lines(text))
    return [Unverified(body.count("\n", 0, m.start()) + 1, m.group(1),
                       int(m.group(2)) if m.group(2) else None,
                       " ".join(m.group(3).strip(" :").split()))
            for m in UNVERIFIED_RE.finditer(body)]


def live_wikilinks(line: str,
                   spans: list[tuple[int, int]]) -> Iterator[re.Match[str]]:
    """The wikilinks on a line that are links: not inside an inline code
    span."""
    for m in LINK_RE.finditer(line):
        if not inside_spans(m.start(), spans):
            yield m


def sub_wikilinks(line: str, spans: list[tuple[int, int]],
                  replace: Callable[[re.Match[str]], str]) -> str:
    """The line with each live wikilink replaced by `replace(match)`; a
    link inside an inline code span is left as written."""
    return LINK_RE.sub(
        lambda m: m.group(0) if inside_spans(m.start(), spans) else replace(m),
        line)



# --------------------------------------------------------------------------
# The publisher's body pipeline
# --------------------------------------------------------------------------


def body_text(text: str) -> str:
    """The body as gray-matter hands it to the publisher: frontmatter
    removed, `\\r` dropped (playerSafeMarkdown does the same)."""
    norm = text.replace("\r\n", "\n").replace("\r", "")
    lines = norm.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return "\n".join(lines[i + 1:])
    return norm


def strip_comment_spans(line: str, in_comment: bool) -> tuple[str, bool]:
    """One line with its HTML comment spans removed, as `stripHtmlComments`
    leaves it: (kept text, whether a comment is still open at line end).
    For a check that needs line numbers and reads comments as the
    publisher does. HTML comments only: `%%` comments are the publish tool's
    to read (`cut_lines`); this is for a vault with no site to ask."""
    kept, i = "", 0
    while i < len(line):
        if in_comment:
            end = line.find("-->", i)
            if end == -1:
                break
            in_comment, i = False, end + 3
        else:
            start = line.find("<!--", i)
            if start == -1:
                kept += line[i:]
                break
            kept += line[i:start]
            in_comment, i = True, start + 4
    return kept, in_comment


def publisher_lines(text: str, excludes: Iterable[str],
                    fm: dict[str, Any] | None = None) -> list[str]:
    """The body lines the player site renders for this file.

    The publish tool's own answer (`gm-publish lines`, op `published`):
    the page's `publish:` gate, then `playerSafeMarkdown` under the
    exclude list. Callout stripping is left out: it is a config option
    that only ever removes more. Raises `PublishToolUnavailable` when the
    tool cannot be asked."""
    mode = publish_mode(fm)
    if mode == "none":
        return []
    raw = (fm or {}).get("publish_include_sections")
    answer = PUBLISH_LINES.ask({
        "op": "published", "text": body_text(text),
        "excludeSections": [str(s) for s in excludes], "publish": mode,
        "include": [s for s in raw if isinstance(s, str)]
        if isinstance(raw, list) else []})
    published = answer.get("text")
    if not isinstance(published, str):
        raise PublishToolUnavailable(
            "the publish tool's answer has no text")
    return published.split("\n")


# --------------------------------------------------------------------------
# Publish gating
# --------------------------------------------------------------------------

WITHHELD_KEY_RE = re.compile(r"""^["']?withheld["']?[ \t]*:""", re.M)


def note_withheld(text: str) -> tuple[bool, list[str]]:
    """Whether a note's own name is a secret (`withheld: true`, #291), and
    the names its title, aliases and gm_aliases give it. Asked of the
    publish tool, which reads the frontmatter with the build's YAML reader
    and the flag with the build's rule (`isWithheld`), so a number YAML
    makes 1 (`0x1`, `1e0`) reads the same on both sides (#352). A note
    with no `withheld` key is not asked about. Raises
    `PublishToolUnavailable` when the tool cannot be asked or cannot read
    the note's frontmatter."""
    if not WITHHELD_KEY_RE.search(raw_frontmatter(text)):
        return False, []
    answer = PUBLISH_LINES.ask({"op": "withheld", "text": text})
    withheld, names = answer.get("withheld"), answer.get("names")
    if not isinstance(withheld, bool) or not (
            isinstance(names, list) and all(isinstance(n, str) for n in names)):
        raise PublishToolUnavailable(
            "the publish tool's answer about withheld is not understood")
    return withheld, names


# The two explicit opt-outs processor.js honours, and nothing else.
PUBLISH_NONE_VALUES = ("false", "none")


def publish_mode(fm: dict[str, Any] | None) -> Literal["all", "stub", "none"]:
    """Whether one file publishes whole, as a stub, or not at all.

    Mirrors tools/publish/lib/processor.js `publishMode`, which build.js
    consults twice: a `none` page is dropped before the link map is even
    built, and a `stub` page's body is reduced to the sections named by
    `publish_include_sections` (via `keepOnlySections`) before anything
    downstream reads it. A leak check that ignores this reports content
    that never reaches a reader.

    Absent, `true`, or anything unrecognised means "all", exactly as
    there. A value that says no is read in any capitals and trimmed
    (`False`, `None`; this module's frontmatter reader hands back strings
    where a real YAML parser gives a boolean), and a list is read item
    by item with the no winning, as there.
    tools/publish/test/fixtures/publish-mode-vectors.json pins both.
    """
    raw = (fm or {}).get("publish")
    items = _flat_list(raw) if isinstance(raw, list) else [raw]
    items = [i.strip().lower() if isinstance(i, str) else i for i in items]
    if any(i is False or (isinstance(i, str) and i in PUBLISH_NONE_VALUES)
           for i in items):
        return "none"
    if "stub" in [i for i in items if isinstance(i, str)]:
        return "stub"
    return "all"


def _flat_list(value: list[Any]) -> list[Any]:
    """`value` with every list inside it opened out, as JavaScript's
    `flat(Infinity)`."""
    out: list[Any] = []
    for item in value:
        out.extend(_flat_list(item) if isinstance(item, list) else [item])
    return out


# --------------------------------------------------------------------------
# Vault queries
# --------------------------------------------------------------------------

def out_of_play(vault: Path) -> frozenset[str]:
    """The statuses that take a character out of play
    (`vault.statuses.out_of_play`), each word trimmed and lower-cased as the
    publish tool does. Compare a note's status the same way:
    `str(status).strip().lower() in out_of_play(vault)`."""
    words = setting_or_builtin(vault, "vault.statuses.out_of_play")
    return frozenset(str(w).strip().lower() for w in words)


def is_out_of_play(fm: dict[str, Any], words: frozenset[str]) -> bool:
    """Whether a note's `status:` is one of `words` (from `out_of_play`).
    A one-item list (Obsidian's list property) is read as its item; any
    other list is no status. The build's `isOutOfPlay` reads it the same."""
    status = fm.get("status", "")
    if isinstance(status, list):
        status = status[0] if len(status) == 1 else ""
    return str(status).strip().lower() in words


def active_pcs(vault: Path) -> list[tuple[str, dict[str, Any]]]:
    """(rel, frontmatter) for every playable PC sheet.

    `type: pc`, excluding the `*_Story.md` companion notes (same type,
    but narrative history rather than a sheet) and anyone whose status
    is on the vault's out-of-play list.
    """
    out: list[tuple[str, dict[str, Any]]] = []
    gone = out_of_play(vault)
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if is_out_of_play(fm, gone):
            continue
        out.append((rel, fm))
    return out


def active_pc_names(vault: Path) -> set[str]:
    """Active PCs, mirroring session_context.py: type: pc, not *_Story.md,
    status not on the out-of-play list. Name set = filename stem, each
    capitalised stem token (len >= 3), and each alias — for whole-word
    matching of both 'Katherine Winslow' and 'Katherine'."""
    names: set[str] = set()
    for rel, fm in active_pcs(vault):
        stem = Path(rel).stem.replace("_", " ").strip()
        if stem:
            names.add(stem)
            for tok in stem.split():
                if len(tok) >= 3 and tok[:1].isupper():
                    names.add(tok)
        names.update(link_aliases(fm))
    return names


# --------------------------------------------------------------------------
# Plugin version
# --------------------------------------------------------------------------


def parse_version(text: str) -> tuple[int, ...]:
    """"1.8.15" -> (1, 8, 15), so 1.8.9 sorts below 1.8.15.

    Anything after a `-` or `+` (pre-release, build metadata) is dropped,
    and parsing stops at the first non-numeric component.
    """
    core = re.split(r"[-+]", str(text).strip(), maxsplit=1)[0]
    parts: list[int] = []
    for piece in core.split("."):
        if not re.fullmatch(r"\d+", piece):
            break
        parts.append(int(piece))
    return tuple(parts)


def plugin_version() -> tuple[str, str] | None:
    """(version, source) for the installed plugin, or None.

    `.claude-plugin/plugin.json` is authoritative. A skill zip ships
    without it, so the zip build writes the same version into
    `shared/VERSION`, and that is the fallback.

    A *missing* manifest is the ordinary skill-zip case and falls through
    quietly. A manifest that exists but cannot be parsed warns on stderr
    first: that is a broken install, not a zip.
    """
    here = Path(__file__).resolve()
    manifest = here.parents[3] / ".claude-plugin" / "plugin.json"
    try:
        version = json.loads(manifest.read_text(encoding="utf-8"))["version"]
        if version:
            return str(version), ".claude-plugin/plugin.json"
        print(f"warning: {manifest} has an empty version — falling back to "
              f"shared/VERSION", file=sys.stderr)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"warning: unusable {manifest} ({e.__class__.__name__}: {e}) "
              f"— falling back to shared/VERSION", file=sys.stderr)
    stamp = here.parents[1] / "VERSION"
    try:
        current = stamp.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except OSError as e:
        print(f"warning: unreadable {stamp}: {e} — the plugin version "
              f"is unknown", file=sys.stderr)
        return None
    return (current, "shared/VERSION") if current else None

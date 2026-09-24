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
might see rather than quietly assuming something is hidden.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Literal

# --------------------------------------------------------------------------
# Vault walking
# --------------------------------------------------------------------------

SKIP_DIRS = {"_Templates", "_templates", "_inbox"}
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


def vault_files(vault: Path, folder: str | None = None,
                files: Iterable[str] | None = None,
                skip_dirs: set[str] = SKIP_DIRS,
                newer_than: float | None = None) -> Iterator[tuple[str, str]]:
    """Yield (vault-relative posix path, text) for every readable note.

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
            text = path.read_text(encoding="utf-8", errors="replace")
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
    # Unquoted: a ' #' starts a YAML comment.
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


def nested_mapping(text: str, key: str) -> dict[str, str]:
    """Child key -> scalar value for the block indented under `key:`.

    Covers the two nested shapes the vault schema actually uses: a
    session index's `documents:` map and `_meta/vault-config.md`'s
    `publish:` map. Only the block's own level is read — a grandchild
    belongs to its parent's block, not this one. An inline list value
    (`exclude_sections: ["A", "B"]`) is returned raw; use
    `effective_exclude_sections` when you want it parsed.
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
    """Normalize a note name or link target for matching."""
    return re.sub(r"\s+", " ", name.replace("_", " ").strip()).casefold()


def link_target(raw: str) -> str:
    """Reduce a wikilink body to its target note name."""
    target = raw.split("|", 1)[0]
    target = re.split(r"[#^]", target, maxsplit=1)[0]
    # Path-style links resolve by final segment, like Obsidian.
    target = target.rstrip("/").rsplit("/", 1)[-1]
    if target.endswith(".md"):
        target = target[:-3]
    return normalize(target)


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
    return re.sub(r"[\[\]]", "", str(value)).split("|")[0].split("#")[0].strip()


def frontmatter_aliases(text: str) -> list[str]:
    """The `aliases:` list, inline or block. Never a bare scalar — an
    `aliases: Doc` is malformed, and treating it as one alias would make
    the link graph disagree with Obsidian's own reading of the file."""
    fm = extract_frontmatter(text) or {}
    aliases = fm.get("aliases")
    if not isinstance(aliases, list):
        return []
    return [str(a).strip().strip("\"'") for a in aliases
            if str(a).strip().strip("\"'")]


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


# Every `type:` spelling a Session Wrap-Up is written with in the wild.
# One definition, because a script that knows only two of the three finds
# a vault's wrap-ups and another one silently does not: `vault_check
# sessions` reported a wrap-up that `session_context.py` never loaded.
WRAP_UP_TYPES: frozenset[str] = frozenset(
    {"session_wrap", "session-wrap-up", "session-wrapup"})


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


def _fenced_headings(text: str) -> list[tuple[int, int, str]]:
    """(0-based line index, level, title) for every heading outside a
    code fence. Shared walk behind `sections` and `h3_blocks` — both need
    the same "don't mistake a fenced example for a real heading" fence
    tracking `scan_body` already does, but neither needs `scan_body`'s
    marker/exclusion bookkeeping."""
    lines = text.splitlines()
    fence_delim: str | None = None
    heads: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        fence = FENCE_RE.match(line)
        if fence:
            delim, info = fence.group(1), fence.group(2)
            if fence_delim is None:
                if delim[0] != "`" or "`" not in info:
                    fence_delim = delim
                    continue
            elif (delim[0] == fence_delim[0]
                  and len(delim) >= len(fence_delim)
                  and info.strip() == ""):
                fence_delim = None
                continue
        if fence_delim is not None:
            continue
        m = _SECTION_HEADING_RE.match(line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))
    return heads


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
_MARKERS = (("gm", "gm-only"), ("spoiler", "spoiler"))


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


def scan_body(text: str,
              exclude_sections: Iterable[str] = ()) -> tuple[list[LineState],
                                                             list[str]]:
    """Classify every body line the way the publish pipeline would.

    Mirrors tools/publish/lib/processor.js — `stripMarkedBlocks` for the
    `<!-- gm-only -->` / `<!-- spoiler -->` fences and `filterSections`
    for excluded headings — so a check written against this agrees with
    what actually ships.

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

    Section exclusion follows the pipeline's *order*, not just its rule.
    `processContent` / `playerSafeMarkdown` run `stripGmOnly` and
    `stripSpoiler` BEFORE `filterSections`, so a `## GM Notes` written
    inside a `<!-- gm-only -->` block is already gone when the section
    filter runs: it never starts an exclusion, and it never ends one
    either. Headings are therefore only allowed to drive `excluded_by`
    at marker depth zero. They are still reported in `LineState.heading`
    wherever they appear. This matters because `<!-- gm-only -->`
    wrapping `## GM Notes` is exactly the shape `wrapup --fix` writes:
    letting that heading exclude the rest of the file would blind every
    leak check to everything a GM appends below the fence.

    Exclusion boundaries match `filterSections`: a heading-shaped line
    inside a code fence starts or ends an exclusion exactly as on the
    built site (it does no fence tracking), though `heading` stays unset
    for it. A nested excluded heading never re-anchors an exclusion that
    is already running.

    Known divergences, which can err either way — the leak invariant in
    vault_check.py uses `publisher_lines`, an exact port, instead:

    * Titles are compared with `str.casefold()`; `filterSections` uses
      JavaScript `toLowerCase()`. The two differ on a handful of
      non-ASCII titles (German `ß`, Turkish dotted/dotless `I`), so a
      heading using them can match here and not there, or vice versa.
    * Only the two marker blocks suppress exclusion, not multi-line HTML
      comments, which `stripHtmlComments` also removes before
      `filterSections`. A `## GM Notes` commented out that way still
      starts an exclusion here and does not on the site, so what follows
      it is called hidden here and publishes there.

    Returns (states, problems); problems are authoring defects — orphan
    closers and blocks left open at EOF.
    """
    excludes = {s.casefold() for s in exclude_sections}
    marker_res = {
        name: (re.compile(rf"^<!--\s*{re.escape(word)}\s*-->"),
               re.compile(rf"^<!--\s*/{re.escape(word)}\s*-->"))
        for name, word in _MARKERS
    }
    depths = {name: 0 for name, _ in _MARKERS}
    open_lines: dict[str, list[int]] = {name: [] for name, _ in _MARKERS}
    words = dict(_MARKERS)

    states: list[LineState] = []
    problems: list[str] = []
    fence_delim: str | None = None
    excluded_by: str | None = None
    exclude_level = 0

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
            stripped = line.strip()
            for name, _word in _MARKERS:
                open_re, close_re = marker_res[name]
                if open_re.match(stripped):
                    depths[name] += 1
                    open_lines[name].append(lineno)
                    marker = f"open-{name}"
                    break
                if close_re.match(stripped):
                    marker = f"close-{name}"
                    if depths[name] == 0:
                        # A closer with nothing open. Don't let it drive depth
                        # negative — that would make a LATER opener fail to
                        # strip. Record it instead.
                        problems.append(
                            f"line {lineno}: <!-- /{words[name]} --> "
                            f"with no opener")
                    else:
                        depths[name] -= 1
                        open_lines[name].pop()
                    break

            if marker is None:
                hm = HEADING_RE.match(line)
                if hm:
                    heading = (len(hm.group(1)), hm.group(2).strip())

        # Exclusion boundaries follow `filterSections`, which sees every
        # heading-shaped line — inside a code fence too — but only at
        # marker depth zero: the pipeline strips marker blocks first.
        hm = HEADING_RE.match(line)
        if hm and marker is None and depths["gm"] == 0 \
                and depths["spoiler"] == 0:
            level = len(hm.group(1))
            title = hm.group(2).strip()
            if excluded_by is not None and level <= exclude_level:
                excluded_by = None
            # A nested excluded heading inside an active exclusion never
            # re-anchors it deeper (the #228 filterSections fix).
            if excluded_by is None and title.casefold() in excludes:
                excluded_by = title
                exclude_level = level

        states.append(LineState(
            lineno=lineno,
            line=line,
            in_code=in_code,
            gm_depth=depths["gm"],
            spoiler_depth=depths["spoiler"],
            excluded_by=excluded_by,
            heading=heading,
            marker=marker,
        ))

    for name, word in _MARKERS:
        for lineno in open_lines[name]:
            problems.append(f"line {lineno}: <!-- {word} --> never closed")
    return states, problems


# --------------------------------------------------------------------------
# An exact port of the publisher's body pipeline
#
# tools/publish/lib/processor.js `playerSafeMarkdown` (stripDataview,
# stripGmOnly, stripSpoiler, stripHtmlComments, filterSections), preceded
# by build.js's `keepOnlySections` for a `publish: stub` page. Callout
# stripping is left out: it is a config option that only ever removes
# more, and leaving it out errs toward calling a line published. Kept
# line-for-line with the JS so the leak invariant never trusts a model.
# --------------------------------------------------------------------------

_JS_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_JS_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_JS_COMMENT_FENCE_RE = re.compile(r"^\s*(```|~~~)")


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


def _js_keep_only_sections(lines: list[str],
                           include: list[str]) -> list[str]:
    wanted = [s.lower() for s in include if isinstance(s, str)]
    if not wanted:
        return []
    out: list[str] = []
    keeping, keep_level = False, 0
    for line in lines:
        m = _JS_HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            if keeping and level <= keep_level:
                keeping = False
            if m.group(2).strip().lower() in wanted:
                keeping, keep_level = True, level
        if keeping:
            out.append(line)
    return out


def _js_strip_marked(lines: list[str], word: str) -> list[str]:
    open_re = re.compile(rf"^<!--\s*{re.escape(word)}\s*-->")
    close_re = re.compile(rf"^<!--\s*/{re.escape(word)}\s*-->")
    out: list[str] = []
    depth = 0
    fence: str | None = None
    for line in lines:
        m = _JS_FENCE_RE.match(line)
        is_fence_line = False
        if m:
            delim, info = m.group(1), m.group(2)
            if fence is None:
                if delim[0] != "`" or "`" not in info:
                    fence, is_fence_line = delim, True
            elif (delim[0] == fence[0] and len(delim) >= len(fence)
                  and not info.strip()):
                fence, is_fence_line = None, True
        if fence is not None or is_fence_line:
            if depth == 0:
                out.append(line)
            continue
        if open_re.match(line.strip()):
            depth += 1
            if depth == 1:
                out.append("")
            continue
        if close_re.match(line.strip()):
            if depth:
                depth -= 1
            continue
        if depth == 0:
            out.append(line)
    return out


def _js_strip_comments(lines: list[str]) -> list[str]:
    out: list[str] = []
    fence: str | None = None
    in_comment = False
    for line in lines:
        m = None if in_comment else _JS_COMMENT_FENCE_RE.match(line)
        if m:
            if fence is None:
                fence = m.group(1)
            elif fence == m.group(1):
                fence = None
        if fence is not None or m:
            out.append(line)
            continue
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
        if not kept.strip() and line.strip():
            continue
        out.append(kept)
    return out


def _js_filter_sections(lines: list[str], excludes: Iterable[str]
                        ) -> list[str]:
    wanted = {s.lower() for s in excludes}
    out: list[str] = []
    excluding, exclude_level = False, 0
    for line in lines:
        m = _JS_HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            if excluding and level <= exclude_level:
                excluding = False
            if not excluding and m.group(2).strip().lower() in wanted:
                excluding, exclude_level = True, level
                continue
        if not excluding:
            out.append(line)
    return out


def publisher_lines(text: str, excludes: Iterable[str],
                    fm: dict[str, Any] | None = None) -> list[str]:
    """The body lines the player site renders for this file."""
    body = body_text(text)
    body = re.sub(r"```dataview[\s\S]*?```", "", body)
    lines = body.split("\n")
    if publish_mode(fm) == "none":
        return []
    if publish_mode(fm) == "stub":
        raw = (fm or {}).get("publish_include_sections")
        lines = _js_keep_only_sections(lines,
                                       raw if isinstance(raw, list) else [])
    lines = _js_strip_marked(lines, "gm-only")
    lines = _js_strip_marked(lines, "spoiler")
    lines = _js_strip_comments(lines)
    return _js_filter_sections(lines, excludes)


# --------------------------------------------------------------------------
# publish.exclude_sections, parsed strictly
# --------------------------------------------------------------------------


@dataclass
class ExcludeListConfig:
    """`publish.<key>` in `_meta/vault-config.md`.

    `value` is the list, or None when the vault sets none (key absent,
    null, or a scalar — config.js falls back to its defaults for any
    non-array). `error` is set when the key is present in a shape this
    parser does not understand exactly; `value` is then None and must not
    be trusted by anything that writes. `span` is the [start, end)
    frontmatter-line range (0-based, within the lines between the
    delimiters) the key and its items occupy, for a writer to replace.
    """

    value: list[str] | None = None
    error: str | None = None
    span: tuple[int, int] | None = None
    publish_line: int | None = None


_KEY_LINE_RE = re.compile(r"""^(\s*)(["']?)([\w.-]+)\2\s*:(?:\s+(.*)|\s*)$""")
_PLAIN_BAD_START = tuple("[]{}&*!|>'\"%@`,#?:-")


def _strip_comment(value: str) -> str:
    """Drop an unquoted trailing ` # comment`."""
    quote: str | None = None
    for i, ch in enumerate(value):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or value[i - 1] in " \t"):
            return value[:i].rstrip()
    return value.strip()


def _yaml_item(raw: str) -> str:
    """One flow- or block-list scalar, or ValueError if not a plain
    string this parser reads exactly."""
    item = raw.strip()
    if not item:
        raise ValueError("empty list item")
    if item[0] == '"':
        if len(item) < 2 or item[-1] != '"':
            raise ValueError(f"unterminated quoted item {item!r}")
        inner = item[1:-1]
        if re.search(r'\\[^"\\]', inner) or re.search(r'(?<!\\)"', inner):
            raise ValueError(f"escape sequence in {item!r}")
        return inner.replace('\\"', '"').replace("\\\\", "\\")
    if item[0] == "'":
        if len(item) < 2 or item[-1] != "'":
            raise ValueError(f"unterminated quoted item {item!r}")
        inner = item[1:-1]
        if re.search(r"(?<!')'(?!')", inner):
            raise ValueError(f"stray quote in {item!r}")
        return inner.replace("''", "'")
    if item.startswith(_PLAIN_BAD_START) or ": " in item or item.endswith(":"):
        raise ValueError(f"list item {item!r} is not a plain string")
    return item


def _flow_items(value: str) -> list[str]:
    """`[a, "b, c"]` → items, splitting on commas outside quotes."""
    inner = value[1:-1]
    items: list[str] = []
    buf = ""
    quote: str | None = None
    for ch in inner:
        if quote:
            buf += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            buf += ch
        elif ch == ",":
            items.append(buf)
            buf = ""
        elif ch in "[]{}":
            raise ValueError("nested flow collection")
        else:
            buf += ch
    if quote:
        raise ValueError("unterminated quote in flow list")
    items.append(buf)
    if items and not items[-1].strip():
        items.pop()      # a trailing comma is legal YAML
    return [_yaml_item(i) for i in items]


def parse_publish_list(fm_lines: list[str], key: str) -> ExcludeListConfig:
    """Strictly read `publish.<key>` from the raw frontmatter lines.

    Understood exactly: an inline flow list on one line, a block list of
    plain or quoted scalars (items at or below the key's indent), null,
    or a plain scalar (no list set), each with optional trailing
    comments; the key itself may be quoted. Anything else — a flow
    `publish:` mapping that names the key, a multi-line flow list,
    anchors, tags, a duplicate key, tabs — is an error rather than a
    guess.
    """
    lines = [line.rstrip("\r\n") for line in fm_lines]
    cfg = ExcludeListConfig()
    starts = []
    for i, line in enumerate(lines):
        m = _KEY_LINE_RE.match(line)
        if m and not m.group(1) and m.group(3) == "publish":
            starts.append((i, _strip_comment(m.group(4) or "")))
        elif re.match(r"""^["']?publish["']?\s*:""", line):
            starts.append((i, "?"))
    if not starts:
        return cfg
    if len(starts) > 1:
        cfg.error = "publish: appears more than once"
        return cfg
    start, inline = starts[0]
    cfg.publish_line = start
    if inline:
        if key in inline or inline == "?":
            cfg.error = f"publish: is a flow mapping — write {key} as a block"
        return cfg
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].strip() and not lines[j][:1].isspace():
            end = j
            break
    indent: int | None = None
    for j in range(start + 1, end):
        body = lines[j]
        if "\t" in body[:len(body) - len(body.lstrip())]:
            cfg.error = "tab indentation under publish:"
            return cfg
        if not body.strip() or body.strip().startswith("#"):
            continue
        depth = len(body) - len(body.lstrip())
        if indent is None:
            indent = depth
    hits = []
    for j in range(start + 1, end):
        m = _KEY_LINE_RE.match(lines[j])
        if m and len(m.group(1)) == indent and m.group(3) == key:
            hits.append((j, m))
        elif re.match(rf"""^\s{{{indent or 0}}}["']?{re.escape(key)}["']?\s*:""",
                      lines[j]) and len(lines[j]) - len(lines[j].lstrip()) == indent:
            cfg.error = f"{key}: line not understood"
            return cfg
    if not hits:
        return cfg
    if len(hits) > 1:
        cfg.error = f"{key}: appears more than once under publish:"
        return cfg
    j, m = hits[0]
    value = _strip_comment(m.group(4) or "")
    k = j + 1
    try:
        if value in ("", ):
            items: list[str] = []
            last = j
            while k < end:
                body = lines[k]
                stripped = body.strip()
                depth = len(body) - len(body.lstrip())
                if not stripped or stripped.startswith("#"):
                    k += 1
                    continue
                if stripped.startswith("-") and depth >= len(m.group(1)):
                    if not re.match(r"^-(\s|$)", stripped):
                        raise ValueError(f"list item {stripped!r}")
                    items.append(_yaml_item(_strip_comment(stripped[1:])))
                    last = k
                    k += 1
                    continue
                if depth > len(m.group(1)):
                    raise ValueError(f"unexpected line {stripped!r}")
                break
            cfg.span = (j, last + 1)
            cfg.value = items or None
            return cfg
        cfg.span = (j, j + 1)
        if value in ("~", "null", "Null", "NULL"):
            return cfg
        if value.startswith("["):
            if not value.endswith("]"):
                raise ValueError("multi-line flow list")
            cfg.value = _flow_items(value)
            return cfg
        if value[0] in "{&*!|>":
            raise ValueError(f"value {value!r}")
        _yaml_item(value)        # a string: config.js uses its defaults
        return cfg
    except ValueError as e:
        cfg.span = None
        cfg.value = None
        cfg.error = f"{key}: {e}"
        return cfg


def _frontmatter_lines(text: str) -> list[str] | None:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r\n") == "---":
            return lines[1:i]
    return None


def read_publish_list(vault: Path, key: str) -> ExcludeListConfig:
    """`parse_publish_list` over `_meta/vault-config.md`; no file, no
    frontmatter → no list set. An unreadable file is an error."""
    config = vault / "_meta" / "vault-config.md"
    try:
        text = config.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ExcludeListConfig()
    except (OSError, UnicodeDecodeError) as e:
        return ExcludeListConfig(error=f"unreadable _meta/vault-config.md "
                                       f"({e.__class__.__name__})")
    fm = _frontmatter_lines(text)
    if fm is None:
        return ExcludeListConfig()
    return parse_publish_list(fm, key)


# The publish pipeline's own defaults (tools/publish/lib/config.js
# PUBLISH_DEFAULTS.exclude_sections). Keep the two in step: a section the
# site drops but a check treats as published is a leak waiting to happen.
DEFAULT_EXCLUDE_SECTIONS: tuple[str, ...] = (
    "GM Notes", "DM Notes", "Player Notes", "Source References",
    "Reconciliation Context", "Handoff to Reconcile",
)


def resolve_exclude_sections(vault_list: list[str] | None) -> list[str]:
    """config.js `unionExcludeList` for the vault-config source: the
    vault's own list when it sets one — the defaults are NOT added — and
    the defaults only when it sets none. De-duplicated
    case-insensitively, first casing wins.

    The site's `vault.config.json` `excludeSections` is unioned in by the
    publisher too; it is not read here. That only ever adds exclusions,
    so ignoring it errs toward reporting a line as published.
    """
    source = list(DEFAULT_EXCLUDE_SECTIONS) if vault_list is None else vault_list
    result: list[str] = []
    seen: set[str] = set()
    for value in source:
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            result.append(value)
    return result


def effective_exclude_sections(vault: Path) -> list[str]:
    """The exclude list the publisher actually applies to this vault.

    Matches tools/publish/lib/config.js exactly: a vault that sets
    `publish.exclude_sections` gets that list and nothing else (the
    defaults are a fallback, not a floor); a vault that sets none gets
    the defaults. Treating the defaults as always-on told the checks
    Player Notes and Source References were hidden on sites that
    publish them.
    """
    cfg = read_publish_list(vault, "exclude_sections")
    if cfg.error:
        # Guessing at a list we cannot read is how a check ends up
        # trusting a section to be hidden that the site publishes. Treat
        # nothing as excluded (over-reporting) and say why.
        print(f"warning: _meta/vault-config.md publish.exclude_sections "
              f"not understood ({cfg.error}) — treating nothing as "
              f"excluded", file=sys.stderr)
        return []
    return resolve_exclude_sections(cfg.value)


# --------------------------------------------------------------------------
# Publish gating
# --------------------------------------------------------------------------

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
    there: a typo must not silently unpublish a page, and must not
    silently convince a check that a page is safe.

    The comparison is literal, as it is there. `publish: False` reaches
    the publish tool through a real YAML parser as boolean false and IS
    dropped, while this module's frontmatter reader hands back the string
    "False" and calls it "all" — an over-report, which is the direction a
    leak check is allowed to be wrong in.
    """
    raw = (fm or {}).get("publish")
    if raw is False or (isinstance(raw, str) and raw in PUBLISH_NONE_VALUES):
        return "none"
    if raw == "stub":
        return "stub"
    return "all"


# --------------------------------------------------------------------------
# Vault queries
# --------------------------------------------------------------------------

PC_INACTIVE_STATUS = {"dead", "retired", "inactive"}


def active_pcs(vault: Path) -> list[tuple[str, dict[str, Any]]]:
    """(rel, frontmatter) for every playable PC sheet.

    `type: pc`, excluding the `*_Story.md` companion notes (same type,
    but narrative history rather than a sheet) and anyone whose status
    says they have left the table.
    """
    out: list[tuple[str, dict[str, Any]]] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if str(fm.get("status", "")).casefold() in PC_INACTIVE_STATUS:
            continue
        out.append((rel, fm))
    return out


def active_pc_names(vault: Path) -> set[str]:
    """Active PCs, mirroring session_context.py: type: pc, not *_Story.md,
    status not dead/retired/inactive. Name set = filename stem, each
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
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a.strip():
                    names.add(a.strip())
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

    `.claude-plugin/plugin.json` is authoritative. `migrations.md` is the
    fallback because it carries the same version (CI enforces the match),
    so a skill zip that ships without the plugin manifest still knows its
    own version.

    A *missing* manifest is the ordinary skill-zip case and falls through
    quietly. A manifest that exists but cannot be parsed warns on stderr
    first: that is a broken install, and a mid-edit version bump can leave
    `migrations.md` behind the working version, so falling through
    silently could report `AHEAD` on a current vault and send the GM off
    to update a plugin that is already up to date.
    """
    here = Path(__file__).resolve()
    manifest = here.parents[3] / ".claude-plugin" / "plugin.json"
    try:
        version = json.loads(manifest.read_text(encoding="utf-8"))["version"]
        if version:
            return str(version), ".claude-plugin/plugin.json"
        print(f"warning: {manifest} has an empty version — falling back to "
              f"shared/migrations.md", file=sys.stderr)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"warning: unusable {manifest} ({e.__class__.__name__}: {e}) "
              f"— falling back to shared/migrations.md", file=sys.stderr)
    migrations = here.parents[1] / "migrations.md"
    try:
        fm = extract_frontmatter(
            migrations.read_text(encoding="utf-8")) or {}
    except OSError as e:
        print(f"warning: unreadable {migrations}: {e} — the plugin version "
              f"is unknown", file=sys.stderr)
        return None
    current = fm.get("current_version")
    if isinstance(current, str) and current:
        return current, "shared/migrations.md"
    return None

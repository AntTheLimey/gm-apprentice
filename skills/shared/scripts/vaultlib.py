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


def vault_files(vault: Path, folder: str | None = None,
                skip_dirs: set[str] = SKIP_DIRS) -> Iterator[tuple[str, str]]:
    """Yield (vault-relative posix path, text) for every readable note.

    Hidden directories and `skip_dirs` (templates, the `_inbox` staging
    area) are skipped; an unreadable file warns on stderr rather than
    aborting the walk. Sorted, so every caller's output is stable.
    """
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        parts = rel.split("/")
        if any(p.startswith(".") for p in parts):
            continue
        if parts[0] in skip_dirs:
            continue
        if folder and not rel.startswith(folder.strip("/") + "/"):
            continue
        try:
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


def _list_value(lines: list[str], key: str) -> list[str]:
    """A YAML list value for `key:` within `lines` — inline or block."""
    for i, line in enumerate(lines):
        m = re.match(rf"^(\s*){re.escape(key)}:\s*(.*)$", line)
        if not m:
            continue
        indent = len(m.group(1))
        value = scalar_value(m.group(2))
        if value.startswith("[") and value.endswith("]"):
            return [v.strip().strip('"').strip("'")
                    for v in value[1:-1].split(",") if v.strip()]
        if value:
            return [value]
        items = []
        for nxt in lines[i + 1:]:
            if not nxt.strip():
                continue
            depth = len(nxt) - len(nxt.lstrip())
            stripped = nxt.strip()
            if stripped.startswith("- ") and depth >= indent:
                items.append(stripped[2:].strip().strip('"').strip("'"))
                continue
            if depth <= indent:
                break
        return items
    return []


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

    Two deliberate divergences from `filterSections`, both erring toward
    calling a line published — the safe direction for a leak check, since
    over-reporting costs a false positive while under-reporting hides a
    real leak:

    * Heading detection here is gated on being outside a code fence.
      `filterSections` does no fence tracking at all, so a `## GM Notes`
      written inside a fenced example DOES start exclusion on the built
      site. A line this module calls published may therefore be dropped
      by the publish tool.
    * Titles are compared with `str.casefold()`; `filterSections` uses
      JavaScript `toLowerCase()`. The two differ on a handful of
      non-ASCII titles (German `ß`, Turkish dotted/dotless `I`), so a
      heading using them can match here and not there, or vice versa.
    * Only the two marker blocks suppress exclusion, not multi-line HTML
      comments, which `stripHtmlComments` also removes before
      `filterSections`. A `## GM Notes` commented out that way still
      starts an exclusion here and does not on the site — the same safe
      direction, and rare enough not to be worth a third depth counter.

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
                    level = len(hm.group(1))
                    title = hm.group(2).strip()
                    heading = (level, title)
                    # A heading inside a marker block neither starts nor
                    # ends an exclusion: the publish pipeline strips the
                    # block before `filterSections` ever sees the line.
                    if depths["gm"] == 0 and depths["spoiler"] == 0:
                        if excluded_by is not None and level <= exclude_level:
                            excluded_by = None
                        if title.casefold() in excludes:
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


# The publish pipeline's own defaults (tools/publish/lib/config.js
# PUBLISH_DEFAULTS.exclude_sections). Keep the two in step: a section the
# site drops but a check treats as published is a leak waiting to happen.
DEFAULT_EXCLUDE_SECTIONS: tuple[str, ...] = (
    "GM Notes", "DM Notes", "Player Notes", "Source References",
    "Reconciliation Context", "Handoff to Reconcile",
)


def effective_exclude_sections(vault: Path) -> list[str]:
    """The defaults plus whatever `_meta/vault-config.md` adds.

    Union, never replacement — matching config.js's `unionExcludeList`,
    so naming one extra section in a vault config cannot accidentally
    re-publish GM Notes. De-duplicated case-insensitively, first casing
    wins.
    """
    result = list(DEFAULT_EXCLUDE_SECTIONS)
    seen = {s.casefold() for s in result}
    config = vault / "_meta" / "vault-config.md"
    try:
        text = config.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        # No vault config at all is the ordinary case, not a failure.
        return result
    except OSError as e:
        # An unreadable config silently reverting to the defaults is how
        # a check quietly stops honouring the vault's own exclude list.
        # The direction is safe (over-reporting), but say so.
        print(f"warning: unreadable _meta/vault-config.md: {e} — "
              f"using the default exclude_sections", file=sys.stderr)
        return result
    block = _nested_block(raw_frontmatter(text), "publish")
    for value in _list_value(block, "exclude_sections"):
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            result.append(value)
    return result


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
    fallback because the build stamps it from plugin.json, so a skill zip
    that ships without the plugin manifest still knows its own version.

    A *missing* manifest is the ordinary skill-zip case and falls through
    quietly. A manifest that exists but cannot be parsed warns on stderr
    first: in a repo checkout `migrations.md` carries the last stamped
    version rather than the working one, so falling through silently
    would report `AHEAD` on a current vault and send the GM off to update
    a plugin that is already up to date.
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

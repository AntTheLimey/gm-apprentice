#!/usr/bin/env python3
"""relink.py: rename or move a note and rewrite every link to it.

    relink.py VAULT OLD NEW [--apply]

OLD is the note's vault-relative path, or its filename when only one note
has that filename. NEW is a vault-relative path (a move, a rename, or
both) or a bare filename (a rename in place); `.md` is added if missing.

Without --apply it prints the plan and writes nothing. With --apply it
carries the plan out: each changed note is written atomically, the note
is moved last, and a failure puts every file back.

Rewritten: [[Old]], [[Old|Shown]], [[Old#h]], [[Old^b]], ![[Old]],
path-written [[Dir/Old]] and [[Old.md]], links in frontmatter, markdown
links [t](Dir/Old.md), and `.canvas` file nodes. Left alone: links through
an alias, and anything in a code fence or an inline code span. A bare
link whose name two notes share is rewritten only when the note being
renamed is in the linking note's folder; otherwise it is an UNSURE row
and stays as written.

Exit: 0 done or a clean plan; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path

from vaultlib import LINK_RE, is_skipped_path, normalize, scan_body

BAD_NAME_CHARS = set("[]#^|")
INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1).)+?\1")


class RelinkError(Exception):
    """A rename refused or failed. The message is one line."""


@dataclass
class Change:
    rel: str
    lineno: int
    before: str
    after: str


@dataclass
class Plan:
    vault: Path
    old: str
    new: str
    originals: dict[str, str] = field(default_factory=dict)
    texts: dict[str, str] = field(default_factory=dict)
    changes: list[Change] = field(default_factory=list)
    unsure: list[Change] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _stem(rel: str) -> str:
    return posixpath.splitext(posixpath.basename(rel))[0]


def _walk(vault: Path, suffix: str) -> list[str]:
    return sorted(
        rel for rel in (p.relative_to(vault).as_posix()
                        for p in vault.rglob(f"*{suffix}") if p.is_file())
        if not is_skipped_path(rel))


def _read(vault: Path, rel: str) -> str | None:
    """The note's text exactly as stored, or None if it is not UTF-8."""
    try:
        return (vault / rel).read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        return None
    except OSError as e:
        raise RelinkError(f"{rel} cannot be read: {e}") from e


class _Resolver:
    """Which links point at OLD, and what they become."""

    def __init__(self, notes: list[str], old: str, new: str) -> None:
        self.old, self.new = old, new
        self.old_noext = old[:-3]
        self.new_noext = new[:-3]
        self.old_stem = normalize(_stem(old))
        self.sharing = [n for n in notes
                        if normalize(_stem(n)) == self.old_stem]

    def _bare_owner(self, src: str) -> str | None:
        """For a bare link from `src` whose name OLD has: OLD, another
        note, or None when it cannot be told."""
        if len(self.sharing) == 1:
            return self.sharing[0]
        here = [n for n in self.sharing
                if posixpath.dirname(n) == posixpath.dirname(src)]
        return here[0] if len(here) == 1 else None

    def wiki(self, src: str, body: str) -> str | None | bool:
        """New link body, False if not a link to OLD, None if unsure."""
        m = re.match(r"([^|#^]*)([#^][^|]*)?(\|.*)?$", body, re.DOTALL)
        if not m:
            return False
        dest, sub, alias = m.group(1), m.group(2) or "", m.group(3) or ""
        if alias and (sub or dest).endswith("\\"):
            # An escaped pipe (table cell): the backslash belongs to the
            # separator, not the destination.
            alias = "\\" + alias
            if sub:
                sub = sub[:-1]
            else:
                dest = dest[:-1]
        if not dest.strip():
            return False
        has_md = dest.lower().endswith(".md")
        bare = dest[:-3] if has_md else dest
        suffix = ".md" if has_md else ""
        if "/" in bare.strip("/"):
            if bare.startswith(("./", "../")):
                resolved = posixpath.normpath(
                    posixpath.join(posixpath.dirname(src), bare))
                ours = normalize(resolved) == normalize(self.old_noext)
            else:
                segs = [normalize(s) for s in bare.split("/") if s]
                old_segs = [normalize(s) for s in self.old_noext.split("/")]
                ours = old_segs[-len(segs):] == segs
            if not ours:
                return False
            return f"{self.new_noext}{suffix}{sub}{alias}"
        if normalize(bare.strip("/")) != self.old_stem:
            return False
        owner = self._bare_owner(src)
        if owner is None:
            return None
        if owner != self.old:
            return False
        return f"{_stem(self.new)}{suffix}{sub}{alias}"


def _code_spans(line: str) -> list[tuple[int, int]]:
    return [m.span() for m in INLINE_CODE_RE.finditer(line)]


def _inside(pos: int, spans: list[tuple[int, int]]) -> bool:
    return any(a <= pos < b for a, b in spans)


def _rewrite_note(rel: str, text: str, res: _Resolver,
                  p: Plan) -> str:
    states, _ = scan_body(text)
    code = {s.lineno for s in states if s.in_code}
    body_start = states[0].lineno if states else 1
    out: list[str] = []
    for lineno, line in enumerate(text.splitlines(keepends=True), 1):
        if lineno in code:
            out.append(line)
            continue
        spans = _code_spans(line) if lineno >= body_start else []
        new_line = _rewrite_wikilinks(rel, lineno, line, spans, res, p)
        out.append(new_line)
    return "".join(out)


def _rewrite_wikilinks(rel: str, lineno: int, line: str,
                       spans: list[tuple[int, int]], res: _Resolver,
                       p: Plan) -> str:
    def sub(m: re.Match[str]) -> str:
        if _inside(m.start(), spans):
            return m.group(0)
        got = res.wiki(rel, m.group(1))
        if got is False:
            return m.group(0)
        if got is None:
            p.unsure.append(Change(rel, lineno, m.group(0), m.group(0)))
            return m.group(0)
        assert isinstance(got, str)
        bang = "!" if m.group(0).startswith("!") else ""
        after = f"{bang}[[{got}]]"
        p.changes.append(Change(rel, lineno, m.group(0), after))
        return after
    return LINK_RE.sub(sub, line)


def _vault_rel(vault: Path, raw: str, base: str | None) -> str:
    rel = raw.replace("\\", "/").strip().strip("/")
    if base is not None and "/" not in rel:
        rel = posixpath.join(base, rel) if base else rel
    if not rel.lower().endswith(".md"):
        rel += ".md"
    return posixpath.normpath(rel)


def plan(vault: Path, old: str, new: str) -> Plan:
    """Everything a rename of OLD to NEW would change. Writes nothing."""
    notes = _walk(vault, ".md")
    old = _vault_rel(vault, old, None)
    new = _vault_rel(vault, new, posixpath.dirname(old))
    p = Plan(vault, old, new)
    res = _Resolver(notes, old, new)
    for rel in notes:
        text = _read(vault, rel)
        if text is None:
            p.warnings.append(
                f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = _rewrite_note(rel, text, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    return p

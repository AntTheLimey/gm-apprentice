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

import json
import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, unquote

from vaultlib import (
    LINK_RE,
    extract_frontmatter,
    is_skipped_path,
    link_aliases,
    normalize,
    scan_body,
)

BAD_NAME_CHARS = set("[]#^|")
INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1).)+?\1")
MD_LINK_RE = re.compile(
    r"(!?\[[^\]\n]*\]\()(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+\"[^\"\n]*\")?\))")


URI_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


class RelinkError(Exception):
    """A rename refused or failed. The message is one line; `usage` marks
    a bad command line (exit 2) rather than a refusal (exit 1)."""

    def __init__(self, message: str, usage: bool = False) -> None:
        super().__init__(message)
        self.usage = usage


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
                if src == self.old and bare.startswith(("./", "../")):
                    new_dir = posixpath.dirname(self.new)
                    if new_dir != posixpath.dirname(self.old):
                        rel = posixpath.relpath(resolved, new_dir or ".")
                        if bare.startswith("./") and not rel.startswith("../"):
                            rel = "./" + rel
                        return f"{rel}{suffix}{sub}{alias}"
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

    def markdown(self, src: str, dest: str) -> str | None:
        """New destination for a markdown link to OLD, else None."""
        wrapped = dest.startswith("<") and dest.endswith(">")
        raw = dest[1:-1] if wrapped else dest
        if URI_RE.match(raw):
            return None
        path, hashmark, frag = raw.partition("#")
        decoded = unquote(path)
        if not decoded:
            return None
        rooted = decoded.startswith("/")
        old_dir = posixpath.dirname(src)
        # A moved note's own relative links keep their targets.
        new_dir = posixpath.dirname(self.new) if src == self.old else old_dir
        target = posixpath.normpath(posixpath.join(old_dir, decoded))
        if not rooted and target == self.old:
            out = posixpath.relpath(self.new, new_dir or ".")
        elif posixpath.normpath(decoded.lstrip("/")) == self.old:
            out = ("/" if rooted else "") + self.new
        elif (src == self.old and not rooted and decoded
              and new_dir != old_dir):
            out = posixpath.relpath(target, new_dir or ".")
        else:
            return None
        if not wrapped and ("%" in path or " " in out):
            out = quote(out, safe="/")
        out = f"{out}{hashmark}{frag}"
        return f"<{out}>" if wrapped else out


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
        in_body = lineno >= body_start
        new_line = _rewrite_wikilinks(
            rel, lineno, line, _code_spans(line) if in_body else [], res, p)
        spans = _code_spans(new_line) if in_body else []
        new_line = _rewrite_markdown(rel, lineno, new_line, spans, res, p)
        out.append(new_line)
    return "".join(out)


def _rewrite_wikilinks(rel: str, lineno: int, line: str,
                       spans: list[tuple[int, int]], res: _Resolver,
                       p: Plan, json_escape: bool = False) -> str:
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
        if json_escape:
            # The link sits inside a JSON string in a canvas.
            got = json.dumps(got, ensure_ascii=False)[1:-1]
        after = f"{bang}[[{got}]]"
        if after == m.group(0):
            return after
        p.changes.append(Change(rel, lineno, m.group(0), after))
        return after
    return LINK_RE.sub(sub, line)


def _rewrite_markdown(rel: str, lineno: int, line: str,
                      spans: list[tuple[int, int]], res: _Resolver,
                      p: Plan) -> str:
    def sub(m: re.Match[str]) -> str:
        if _inside(m.start(), spans):
            return m.group(0)
        got = res.markdown(rel, m.group(2))
        if got is None:
            return m.group(0)
        after = f"{m.group(1)}{got}{m.group(3)}"
        if after == m.group(0):
            return after
        p.changes.append(Change(rel, lineno, m.group(0), after))
        return after
    return MD_LINK_RE.sub(sub, line)


def _vault_rel(vault: Path, raw: str, base: str | None) -> str:
    rel = raw.replace("\\", "/").strip().strip("/")
    if base is not None and "/" not in rel:
        rel = posixpath.join(base, rel) if base else rel
    if not rel.lower().endswith(".md"):
        rel += ".md"
    return posixpath.normpath(rel)


def resolve_old(vault: Path, raw: str) -> str:
    """OLD as a vault-relative path. A bare name must be one note's."""
    value = raw.replace("\\", "/").strip().strip("/")
    if "/" in value:
        return value if value.lower().endswith(".md") else value + ".md"
    stem = normalize(value[:-3] if value.lower().endswith(".md") else value)
    found = [n for n in _walk(vault, ".md") if normalize(_stem(n)) == stem]
    if len(found) == 1:
        return found[0]
    if not found:
        return value if value.lower().endswith(".md") else value + ".md"
    raise RelinkError(f"{len(found)} notes are named {raw}: "
                      f"{', '.join(found)}; give the path", usage=True)


def _refusal(vault: Path, notes: list[str], old: str, new: str) -> str | None:
    if is_skipped_path(old):
        return f"{old} is in a folder the vault scripts skipped"
    if not (vault / old).is_file():
        return f"{old} does not exist"
    if new.startswith("../") or new == ".." or posixpath.isabs(new):
        return f"{new} is outside the vault"
    if new == old:
        return f"{old} and {new} are the same path"
    if BAD_NAME_CHARS & set(_stem(new)):
        return (f"a link to {_stem(new)} cannot be written: the name has "
                f"one of [ ] # ^ |")
    case_only = new.casefold() == old.casefold()
    if (vault / new).exists() and not case_only:
        return f"{new} already exists"
    clash = [n for n in notes if n != old
             and normalize(_stem(n)) == normalize(_stem(new))]
    if clash:
        return (f"{clash[0]} already has the name {_stem(new)}; links to it "
                f"would become ambiguous")
    return None


def _alias_warnings(vault: Path, notes: list[str], old: str,
                    new: str) -> list[str]:
    want = normalize(_stem(new))
    out = []
    for rel in notes:
        if rel == old:
            continue
        text = _read(vault, rel)
        fm = extract_frontmatter(text or "") or {}
        if any(normalize(a) == want for a in link_aliases(fm)):
            out.append(f"{rel} has the alias {_stem(new)}; links to that "
                       f"name will reach the renamed note, not it")
    return out


def plan(vault: Path, old: str, new: str) -> Plan:
    """Everything a rename of OLD to NEW would change. Writes nothing."""
    notes = _walk(vault, ".md")
    old = _vault_rel(vault, old, None)
    new = _vault_rel(vault, new, posixpath.dirname(old))
    why = _refusal(vault, notes, old, new)
    if why:
        raise RelinkError(why)
    p = Plan(vault, old, new)
    p.warnings = _alias_warnings(vault, notes, old, new)
    res = _Resolver(notes, old, new)
    for rel in notes:
        text = _read(vault, rel)
        if text is None:
            raw = (vault / rel).read_bytes().decode("utf-8", "replace")
            if any(res.wiki(rel, m.group(1)) is not False
                   for m in LINK_RE.finditer(raw)):
                raise RelinkError(f"{rel} is not valid UTF-8 and links to "
                                  f"{_stem(old)}; fix its encoding first")
            p.warnings.append(
                f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = _rewrite_note(rel, text, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    for rel in _walk(vault, ".canvas"):
        text = _read(vault, rel)
        if text is None:
            p.warnings.append(
                f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = _rewrite_canvas(rel, text, old, new, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    return p


def _json_string(value: str, ascii_only: bool, slash: bool) -> str:
    out = json.dumps(value, ensure_ascii=ascii_only)
    return out.replace("/", "\\/") if slash else out


def _rewrite_canvas(rel: str, text: str, old: str, new: str,
                    res: _Resolver, p: Plan) -> str:
    # [[wikilinks]] inside text nodes sit in the raw JSON string.
    lines = text.splitlines(keepends=True)
    text = "".join(_rewrite_wikilinks(rel, n, line, [], res, p, True)
                   for n, line in enumerate(lines, 1))
    # Writers differ: Obsidian keeps UTF-8 raw, others escape it or `/`.
    seen: set[str] = set()
    for ascii_only in (True, False):
        for slash in (False, True):
            old_s = _json_string(old, ascii_only, slash)
            if old_s in seen:
                continue
            seen.add(old_s)
            new_s = _json_string(new, ascii_only, slash)
            needle = re.compile(r'("file"\s*:\s*)' + re.escape(old_s))
            for m in needle.finditer(text):
                p.changes.append(Change(
                    rel, text.count("\n", 0, m.start()) + 1,
                    m.group(0), m.group(1) + new_s))
            text = needle.sub(lambda m: m.group(1) + new_s, text)
    return text

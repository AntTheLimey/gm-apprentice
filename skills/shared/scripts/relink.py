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
link whose name two notes share is, in a vault with a site, rewritten or
left as the site's build links it (the publish tool says where it sends
that name); in a vault without one, rewritten only when the note being
renamed is in the linking note's folder, otherwise it is an UNSURE row
and stays as written. A RULE row says which applied.

A vault with a site is also asked, of the publish tool, what the rename
changes there (it alone knows those formats): the publish list and the
vault settings that name the note are rewritten in the same apply
(REPUBLISH), and a PC page, which the site keys its live stats by the
filename, gets `live_key` pinned first (PIN) so the stats stay with the
character. A file the site pairs to the note by name, a PC's `_Story.md`,
moves with it in the same all-or-nothing change; renaming the story alone
is refused. A vault with no publish list and no site is not asked and
needs no Node.

Exit: 0 done or a clean plan; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

import vaultlib
from migrate_core import StepFailed, write_text_atomic
from vaultlib import (
    LINK_RE,
    PublishToolUnavailable,
    extract_frontmatter,
    frontmatter_span,
    get_key,
    inline_code_spans,
    inside_spans,
    is_skipped_path,
    link_aliases,
    normalize,
    publish_rename_refs,
    scalar_value,
    scan_body,
    set_key,
    site_unasked,
    vault_site,
)

BAD_NAME_CHARS = set("[]#^|")
MD_LINK_RE = re.compile(
    r"(!?\[[^\]\n]*\]\()(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+\"[^\"\n]*\")?\))")


URI_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


class RelinkError(Exception):
    """A rename refused or failed. The message is one line; `usage` marks
    a bad command line (exit 2) rather than a refusal (exit 1)."""

    def __init__(self, message: str, usage: bool = False) -> None:
        super().__init__(message)
        self.usage = usage


class ToolTooOld(RelinkError):
    """The site's publish tool does not know the rename question."""


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
    # The warnings that are about a note whose alias the new name would
    # capture (a subset of `warnings`).
    alias_warnings: list[str] = field(default_factory=list)
    republished: list[str] = field(default_factory=list)
    pin: str | None = None
    # Files the site pairs to the note by name (a PC's story), moved with it.
    companions: list[tuple[str, str]] = field(default_factory=list)
    # Where the site's link map sends each bare spelling a moved note is
    # linked by: spelling -> vault path, or None for nothing.
    owners: dict[str, str | None] = field(default_factory=dict)
    rules: list[str] = field(default_factory=list)
    published: set[str] | None = None

    @property
    def moves(self) -> list[tuple[str, str]]:
        """Every move, the note's own first."""
        return [(self.old, self.new), *self.companions]


def _nfc(s: str) -> str:
    """Composed form: macOS stores accented names decomposed, links are
    typed composed. Paths are compared in NFC and written as given."""
    return unicodedata.normalize("NFC", s)


def _stem(rel: str) -> str:
    return posixpath.splitext(posixpath.basename(rel))[0]


def name_key(rel: str) -> str:
    """The note name as relink compares it: two notes with one key clash."""
    return normalize(_stem(rel))


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


def _raw(vault: Path, rel: str) -> str:
    try:
        return (vault / rel).read_bytes().decode("utf-8", "replace")
    except OSError as e:
        raise RelinkError(f"{rel} cannot be read: {e}") from e


def _plain(s: str) -> str:
    return s


def _json_inner(s: str) -> str:
    """Text as it sits inside a JSON string."""
    return json.dumps(s, ensure_ascii=False)[1:-1]


def _parse_link(body: str, json_text: bool = False
                ) -> tuple[str, str, str] | None:
    """(destination, #heading or ^block, |alias) of a wikilink body. In
    canvas JSON text the escaped pipe of a table cell is `\\\\|`."""
    m = re.match(r"([^|#^]*)([#^][^|]*)?(\|.*)?$", body, re.DOTALL)
    if not m:
        return None
    dest, sub, alias = m.group(1), m.group(2) or "", m.group(3) or ""
    slash = "\\\\" if json_text else "\\"
    if alias and (sub or dest).endswith(slash):
        # An escaped pipe (table cell): the backslash belongs to the
        # separator, not the destination.
        alias = slash + alias
        if sub:
            sub = sub[:-len(slash)]
        else:
            dest = dest[:-len(slash)]
    return dest, sub, alias


def _bare_spelling(body: str) -> str | None:
    """The name a bare wikilink writes, as the site's link map is asked for
    it: the site resolves `[[Name#heading]]`, `[[Name^block]]` and
    `[[Name.md]]` by the name alone. None for a path-written link."""
    parsed = _parse_link(body)
    if parsed is None or not parsed[0].strip():
        return None
    bare = parsed[0][:-3] if parsed[0].lower().endswith(".md") else parsed[0]
    return None if "/" in bare.strip("/") else bare


class _Move:
    """Which links point at one moved note, and what they become."""

    def __init__(self, notes: list[str], old: str, new: str,
                 owners: dict[str, str | None]) -> None:
        self.old, self.new = old, new
        # Where the site's build sends each bare spelling; empty when there
        # is no site to follow.
        self.owners = owners
        self.old_noext = old[:-3]
        self.old_nfc = _nfc(old)
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

    def wiki(self, src: str, body: str, esc: Callable[[str], str] = _plain,
             rebase: bool = False, src_new_dir: str = "",
             use_owners: bool = True) -> str | None | bool:
        """New link body, False if not a link to OLD, None if unsure.
        With `rebase`, a relative link of the moved note `src` to some
        other note is rewritten to keep its target."""
        parsed = _parse_link(body, esc is _json_inner)
        if parsed is None:
            return False
        dest, sub, alias = parsed
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
                if ours and len(segs) < len(old_segs):
                    # A partial path: certain only if no other note ends
                    # the same way.
                    same = [n for n in self.sharing
                            if [normalize(x) for x in n[:-3].split("/")][
                                -len(segs):] == segs]
                    if len(same) > 1:
                        return None
            if not ours:
                if rebase and bare.startswith(("./", "../")):
                    new_dir = src_new_dir
                    if new_dir != posixpath.dirname(src):
                        rel = posixpath.relpath(resolved, new_dir or ".")
                        if bare.startswith("./") and not rel.startswith("../"):
                            rel = "./" + rel
                        return f"{esc(rel)}{suffix}{sub}{alias}"
                return False
            return f"{esc(self.new_noext)}{suffix}{sub}{alias}"
        if normalize(bare.strip("/")) != self.old_stem:
            return False
        site_owner = self.owners.get(bare) if use_owners else None
        if site_owner is not None:
            # The site resolves each spelling by its exact key: it is OLD's
            # link only if the site sends it to OLD.
            if _nfc(site_owner) != self.old_nfc:
                return False
            return f"{esc(_stem(self.new))}{suffix}{sub}{alias}"
        owner = self._bare_owner(src)
        if owner is None:
            return None
        if owner != self.old:
            return False
        return f"{esc(_stem(self.new))}{suffix}{sub}{alias}"

    def markdown(self, src: str, dest: str, src_new_dir: str,
                 rebase: bool = False) -> str | None:
        """New destination for a markdown link to OLD, else None. With
        `rebase`, a relative link of the moved note `src` to another note
        keeps its target."""
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
        new_dir = src_new_dir
        target = posixpath.normpath(posixpath.join(old_dir, decoded))
        if not rooted and _nfc(target) == self.old_nfc:
            out = posixpath.relpath(self.new, new_dir or ".")
        elif _nfc(posixpath.normpath(decoded.lstrip("/"))) == self.old_nfc:
            out = ("/" if rooted else "") + self.new
        elif (rebase and not rooted and decoded
              and new_dir != old_dir):
            out = posixpath.relpath(target, new_dir or ".")
        else:
            return None
        if not wrapped and ("%" in path or " " in out):
            out = quote(out, safe="/")
        out = f"{out}{hashmark}{frag}"
        return f"<{out}>" if wrapped else out


class _Resolver:
    """Every link to any moved note, in one pass: each move answers for the
    links to its own note, and a moved note's relative links to notes that
    stay put are rebased."""

    def __init__(self, notes: list[str], moves: list[tuple[str, str]],
                 owners: dict[str, str | None] | None = None,
                 published: set[str] | None = None) -> None:
        owners = owners or {}
        # The notes the site publishes: only links in these are read through
        # its link map. None when there is no site to follow.
        self.published = published
        self.moves = {old: _Move(notes, old, new, owners)
                      for old, new in moves}
        self.new_of = dict(moves)

    def _new_dir(self, src: str) -> str:
        return posixpath.dirname(self.new_of.get(src, src))

    def wiki(self, src: str, body: str,
             esc: Callable[[str], str] = _plain) -> str | None | bool:
        nd = self._new_dir(src)
        use = self.published is None or _nfc(src) in self.published
        for m in self.moves.values():
            got = m.wiki(src, body, esc, False, nd, use)
            if got is not False:
                return got
        if src in self.moves:
            return self.moves[src].wiki(src, body, esc, True, nd, use)
        return False

    def linked(self, src: str, raw: str, canvas: bool = False) -> str | None:
        """The moved note that `raw`, text that cannot be rewritten, links
        to, else None."""
        nd = self._new_dir(src)
        for old, m in self.moves.items():
            if (any(isinstance(m.wiki(src, b.group(1), _plain, False, nd), str)
                    for b in LINK_RE.finditer(raw))
                    or any(m.markdown(src, b.group(2), nd) is not None
                           for b in MD_LINK_RE.finditer(raw))
                    or (canvas and _canvas_names_old(raw, old))):
                return old
        return None

    def markdown(self, src: str, dest: str) -> str | None:
        nd = self._new_dir(src)
        for m in self.moves.values():
            got = m.markdown(src, dest, nd)
            if got is not None:
                return got
        if src in self.moves:
            return self.moves[src].markdown(src, dest, nd, True)
        return None


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
            rel, lineno, line, inline_code_spans(line) if in_body else [], res, p)
        spans = inline_code_spans(new_line) if in_body else []
        new_line = _rewrite_markdown(rel, lineno, new_line, spans, res, p)
        out.append(new_line)
    return "".join(out)


def _rewrite_wikilinks(rel: str, lineno: int, line: str,
                       spans: list[tuple[int, int]], res: _Resolver,
                       p: Plan, json_escape: bool = False) -> str:
    def sub(m: re.Match[str]) -> str:
        if inside_spans(m.start(), spans):
            return m.group(0)
        got = res.wiki(rel, m.group(1), _json_inner if json_escape else _plain)
        if got is False:
            return m.group(0)
        if got is None:
            p.unsure.append(Change(rel, lineno, m.group(0), m.group(0)))
            return m.group(0)
        assert isinstance(got, str)
        bang = "!" if m.group(0).startswith("!") else ""
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
        if inside_spans(m.start(), spans):
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


def _is_absolute(raw: str) -> bool:
    text = raw.replace("\\", "/").strip()
    return text.startswith("/") or bool(re.match(r"^[A-Za-z]:/", text))


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


def _case_only(vault: Path, old: str, new: str) -> bool:
    """A rename that only changes case. On a case-sensitive file system a
    different file already named NEW makes it an ordinary clash."""
    if _nfc(old).casefold() != _nfc(new).casefold():
        return False
    dst = vault / new
    return not dst.exists() or os.path.samefile(vault / old, dst)


def _temp_name(vault: Path, old: str) -> Path:
    src = vault / old
    return src.with_name(f".{src.name}.relink")


def _refusal(vault: Path, notes: list[str], old: str, new: str) -> str | None:
    if is_skipped_path(old):
        return f"{old} is in a folder the vault scripts skipped"
    if not (vault / old).is_file():
        return f"{old} does not exist"
    if new.startswith("../") or new == ".." or posixpath.isabs(new):
        return f"{new} is outside the vault"
    if is_skipped_path(new):
        return f"{new} is in a folder the vault scripts skip"
    if new == old:
        return f"{old} and {new} are the same path"
    old_dir, new_dir = posixpath.dirname(old), posixpath.dirname(new)
    if (new_dir != old_dir and (vault / new_dir).exists()
            and os.path.samefile(vault / old_dir, vault / new_dir)):
        return (f"{new_dir} is {old_dir} in another case; folder case "
                f"changes aren't supported: rename the folder in Obsidian")
    if BAD_NAME_CHARS & set(_stem(new)):
        return (f"a link to {_stem(new)} cannot be written: the name has "
                f"one of [ ] # ^ |")
    case_only = _case_only(vault, old, new)
    if (vault / new).exists() and not case_only:
        return f"{new} already exists"
    if case_only and _temp_name(vault, old).exists():
        return (f"{_temp_name(vault, old).name} is left over from an earlier "
                f"rename; remove it first")
    clash = [n for n in notes if n != old
             and normalize(_stem(n)) == normalize(_stem(new))]
    if clash:
        return (f"{clash[0]} already has the name {_stem(new)}; links to it "
                f"would become ambiguous")
    return None


def _alias_warnings(texts: dict[str, str | None], old: str,
                    new: str) -> list[str]:
    want = normalize(_stem(new))
    out = []
    for rel, text in texts.items():
        if rel == old:
            continue
        fm = extract_frontmatter(text or "") or {}
        if any(normalize(a) == want for a in link_aliases(fm)):
            out.append(f"{rel} has the alias {_stem(new)}; links to that "
                       f"name will reach the renamed note, not it")
    return out


MANIFEST_REL = "_meta/publish-manifest.md"
YAML_WORDS = {"true", "false", "null", "yes", "no", "on", "off", "y", "n"}


def _has_site(vault: Path) -> bool:
    """Whether the vault has a site, asked of the publish tool. A vault
    with no vault file has none, and nothing is asked. When the tool cannot
    be asked, the file's own switch is read instead."""
    if not (vault / "_meta" / "vault-config.md").is_file():
        return False
    try:
        return vault_site(vault)[1]
    except PublishToolUnavailable:
        return site_unasked(vault)


def _site_config(vault: Path) -> Path | None:
    """The site's own vault.config.json, which the tool reads for settings
    the vault file does not hold, when the vault has a site folder."""
    try:
        site = vault_site(vault)[2]
    except PublishToolUnavailable:
        return None
    config = site / "vault.config.json" if site else None
    return config if config is not None and config.is_file() else None


def _live_key_text(slug: str) -> str:
    plain = re.fullmatch(r"[a-z][a-z0-9-]*", slug) and slug not in YAML_WORDS
    return slug if plain else f'"{slug}"'


def _pin_live_key(p: Plan, texts: dict[str, str | None], slug: str) -> None:
    """Write `live_key` into OLD's frontmatter, on top of whatever the link
    rewrite did to it, unless the note already pins one."""
    text = p.texts.get(p.old, texts.get(p.old))
    if text is None:
        raise RelinkError(f"{p.old} is not valid UTF-8 and the site keeps "
                          f"live state for it; nothing was changed")
    lines = text.splitlines(keepends=True)
    close, err = frontmatter_span(lines)
    if err:
        raise RelinkError(f"{p.old} holds live state on the site but its "
                          f"frontmatter cannot be edited ({err}); nothing "
                          f"was changed")
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = lines[1:close]
    if scalar_value(get_key(fm, "live_key") or ""):
        return
    set_key(fm, "live_key", _live_key_text(slug), eol)
    lines[1:close] = fm
    p.originals.setdefault(p.old, texts[p.old] or "")
    p.texts[p.old] = "".join(lines)
    p.pin = slug


class _SiteToolMissing(PublishToolUnavailable):
    """The site has no publish tool that can be asked; the message says
    why and what to do."""


def _site_tool(vault: Path) -> Path | None:
    """The publish tool the vault's site builds with, which is the one to
    ask what a rename changes there. None means the plugin's own, for a
    vault with no site; a site with no tool to ask is an error."""
    import vault_check  # the one place that resolves a site's tool
    if vault_site(vault)[2] is None:
        return None  # a site still to be set up builds with nothing yet
    tool, why, fix, has_site = vault_check._lines_tool(vault)
    if not has_site:
        return None
    if tool is None:
        reason = why or "the site tool cannot be found"
        if "is missing" in reason or "not installed" in reason:
            # The migration repins the site's tool; the GM is not sent to
            # update-pin by hand, which is what `fix` says here.
            hint = "run the migration (`migrate.py <vault> apply`) to repin it"
        else:
            hint = fix if fix and "update-pin" not in fix else ""
        raise _SiteToolMissing(f"{reason}; {hint}" if hint else reason)
    return None if tool == vaultlib.PUBLISH_TOOL else tool


def _ask_publish(vault: Path, old: str, new: str, listed: bool,
                 site: bool, names: tuple[str, ...] = ()
                 ) -> dict[str, Any] | None:
    """What the publish tool says a rename of OLD changes on the site (and,
    for the bare `names`, where its link map sends each), or None when the
    vault has no site, so nothing is asked (the publish list included) and no
    Node is needed. The tool the site builds with is the one asked."""
    if not site:
        return None  # no site: nothing is asked and no Node is needed
    try:
        tool = _site_tool(vault)
        return publish_rename_refs(vault, old, new, _site_config(vault),
                                   names, tool)
    except _SiteToolMissing as e:
        raise RelinkError(
            f"{old} belongs to the vault's site, whose publish tool cannot "
            f"be asked: {e}; nothing was changed") from None
    except PublishToolUnavailable as e:
        if site and ("Unknown manifest command" in str(e)
                     or "Unknown argument" in str(e)):
            raise ToolTooOld(
                "the site's publish tool is older than this rename needs; "
                "run the migration (`migrate.py <vault> apply`) first"
            ) from None
        raise RelinkError(
            f"{old} is on the site's publish list and the publish tool "
            f"could not be asked to update it; nothing was changed"
            if listed else
            f"{old} belongs to the vault's site and the publish tool "
            f"could not be asked what a rename changes there; nothing was "
            f"changed") from None


def _spellings(texts: list[str], moves: list[tuple[str, str]]) -> tuple[str, ...]:
    """Every bare spelling the notes use for a moved note's name, for the
    site to say where each goes."""
    stems = {normalize(_stem(o)) for o, _ in moves}
    found: set[str] = set()
    for text in texts:
        for m in LINK_RE.finditer(text):
            spelling = _bare_spelling(m.group(1))
            if spelling is not None and normalize(spelling.strip("/")) in stems:
                found.add(spelling)
    return tuple(sorted(found))


def _companions(vault: Path, notes: list[str], p: Plan,
                answer: dict[str, Any] | None) -> None:
    """The files the site pairs to the note by name, which move with it:
    refuse a rename that would detach the note, else plan their moves."""
    if not answer:
        return
    if answer.get("detaches"):
        raise RelinkError(f"{answer['detaches']}; nothing was changed")
    if answer.get("unpublishes"):
        raise RelinkError(f"{answer['unpublishes']}; nothing was changed")
    if answer.get("refusal"):
        raise RelinkError(f"{answer['refusal']}; nothing was changed")
    for pair in answer.get("companions") or []:
        old = _vault_rel(vault, pair["from"], None)
        new = _vault_rel(vault, pair["to"], None)
        why = _refusal(vault, notes, old, new)
        if why:
            raise RelinkError(f"{why} (it moves with {p.old}); nothing "
                              f"was changed")
        p.companions.append((old, new))


def _publish_updates(p: Plan, answer: dict[str, Any] | None,
                     texts: dict[str, str | None], res: _Resolver) -> None:
    """The site's own files that name the note (its publish list, vault
    settings) and the live key a PC is stored under, as the publish tool
    says: it alone knows their formats."""
    if not answer:
        return
    for rel, text in sorted(answer["files"].items()):
        if rel.startswith("/") or ".." in rel.split("/"):
            raise RelinkError(f"the publish tool named {rel}, which is not "
                              f"in the vault; nothing was changed")
        before = _read(p.vault, rel)
        if before is None:
            raise RelinkError(f"{rel} is not valid UTF-8 and names "
                              f"{_stem(p.old)} for the site; fix its "
                              f"encoding first")
        if text == before:
            continue
        # The tool's edits (paths, names) and the link rewrite (wikilinks)
        # do not overlap: the links go over the tool's text. The links were
        # already counted, so this pass is scratch.
        text = _rewrite_note(rel, text, res,
                             Plan(p.vault, p.old, p.new))
        p.originals[rel], p.texts[rel] = before, text
        p.republished.append(rel)
    pin = answer.get("pin")
    if pin:
        _pin_live_key(p, texts, pin["live_key"])


def plan(vault: Path, old: str, new: str) -> Plan:
    """Everything a rename of OLD to NEW would change, and the files that
    move with it. Writes nothing."""
    notes = _walk(vault, ".md")
    old = _vault_rel(vault, old, None)
    if _is_absolute(new):
        raise RelinkError(f"{new} is outside the vault")
    new = _vault_rel(vault, new, posixpath.dirname(old))
    why = _refusal(vault, notes, old, new)
    if why:
        raise RelinkError(why)
    p = Plan(vault, old, new)
    listed = (vault / MANIFEST_REL).is_file()
    site = _has_site(vault)
    answer = _ask_publish(vault, old, new, listed, site)
    _companions(vault, notes, p, answer)
    texts = {rel: _read(vault, rel) for rel in notes}
    names: tuple[str, ...] = ()
    if site and answer is not None:
        # The site resolves each spelling by its exact name, so ask where
        # every spelling goes, not just the filename.
        sources = [t for t in texts.values() if t is not None]
        sources += [t for t in (_read(vault, c) for c in _walk(vault, ".canvas"))
                    if t is not None]
        names = _spellings(sources, p.moves)
        if names:
            asked = _ask_publish(vault, old, new, listed, site, names)
            if asked is not None and asked.get("owners"):
                p.owners = dict(asked["owners"])
                p.published = {_nfc(x) for x in asked.get("published", [])}
    for o, n in p.moves:
        aliased = _alias_warnings(texts, o, n)
        p.warnings += aliased
        p.alias_warnings += aliased
    res = _Resolver(notes, p.moves, p.owners, p.published)
    for o, _n in p.moves:
        shared = [n for n in notes if normalize(_stem(n)) == normalize(_stem(o))]
        if len(shared) > 1:
            mine = [x for x in names if normalize(x.strip("/")) == normalize(_stem(o))]
            if not site:
                how = "the same-folder rule (no site to follow)"
            elif any(p.owners.get(x) is not None for x in mine):
                outside = p.published is not None and any(
                    t is not None and _nfc(r) not in p.published
                    and _spellings([t], [(o, _n)])
                    for r, t in texts.items())
                how = ("the site's link map in notes the site publishes, the "
                       "same-folder rule in the rest" if outside
                       else "the site's link map")
            else:
                how = "the same-folder rule (no site answer)"
            p.rules.append(f"RULE\t{o}\tbare links to {_stem(o)} follow {how}")
    for rel, text in texts.items():
        if text is None:
            hit = res.linked(rel, _raw(vault, rel))
            if hit:
                raise RelinkError(f"{rel} is not valid UTF-8 and links to "
                                  f"{_stem(hit)}; fix its encoding first")
            p.warnings.append(
                f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = _rewrite_note(rel, text, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    for rel in _walk(vault, ".canvas"):
        text = _read(vault, rel)
        if text is None:
            hit = res.linked(rel, _raw(vault, rel), canvas=True)
            if hit:
                raise RelinkError(f"{rel} is not valid UTF-8 and links to "
                                  f"{_stem(hit)}; fix its encoding first")
            p.warnings.append(
                f"{rel} is not UTF-8; links in it were not checked")
            continue
        changed = _rewrite_canvas(rel, text, p.moves, res, p)
        if changed != text:
            p.originals[rel], p.texts[rel] = text, changed
    _publish_updates(p, answer, texts, res)
    return p


def _json_string(value: str, ascii_only: bool, slash: bool) -> str:
    out = json.dumps(value, ensure_ascii=ascii_only)
    return out.replace("/", "\\/") if slash else out


def _canvas_names_old(raw: str, old: str) -> bool:
    for form in _forms(old):
        for ascii_only in (True, False):
            for slash in (False, True):
                needle = re.compile(
                    r'"file"\s*:\s*'
                    + re.escape(_json_string(form, ascii_only, slash)))
                if needle.search(raw):
                    return True
    return False


def _forms(path: str) -> list[str]:
    """A path as an NFC and as an NFD writer would store it."""
    nfc = _nfc(path)
    return [nfc, *([unicodedata.normalize("NFD", nfc)]
                   if unicodedata.normalize("NFD", nfc) != nfc else [])]


def _rewrite_canvas(rel: str, text: str, moves: list[tuple[str, str]],
                    res: _Resolver, p: Plan) -> str:
    # [[wikilinks]] inside text nodes sit in the raw JSON string.
    lines = text.splitlines(keepends=True)
    text = "".join(_rewrite_wikilinks(rel, n, line, [], res, p, True)
                   for n, line in enumerate(lines, 1))
    for old, new in moves:
        # Writers differ: Obsidian keeps UTF-8 raw, others escape it or `/`.
        seen: set[str] = set()
        for form in _forms(old):
            for ascii_only in (True, False):
                for slash in (False, True):
                    old_s = _json_string(form, ascii_only, slash)
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


def rows(p: Plan, done: bool = False) -> list[str]:
    ren, rel = ("RENAMED", "RELINKED") if done else ("WOULD-RENAME",
                                                     "WOULD-RELINK")
    out = [f"{ren}\t{o}\t{n}" for o, n in p.moves]
    out += [f"{rel}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
            for c in p.changes]
    ful, pin = ("REPUBLISHED", "PINNED") if done else ("WOULD-REPUBLISH",
                                                         "WOULD-PIN")
    out += [f"{ful}\t{r}\t{p.old} -> {p.new}" for r in p.republished]
    if p.pin:
        out.append(f"{pin}\t{p.old}\tlive_key: {p.pin}")
    out += p.rules
    out += [f"UNSURE\t{c.rel}:{c.lineno}\t{c.before} — two notes have "
            f"this name; left as written" for c in p.unsure]
    out += [f"WARNING\t{w}" for w in p.warnings]
    files = len({c.rel for c in p.changes})
    renames = (f"{len(p.moves)} renames" if len(p.moves) > 1 else "1 rename")
    total = (f"# {renames}, {len(p.changes)} link(s) in {files} note(s)"
             + (f", {len(p.republished)} publish file(s) updated"
                if p.republished else "")
             + (", live key pinned" if p.pin else "")
             + (f", {len(p.unsure)} left as written" if p.unsure else ""))
    return out + [total]


class _Stranded(Exception):
    """The note is parked under a temporary name and could not be put back."""


def _move(vault: Path, old: str, new: str) -> list[Path]:
    """Move the note; the folders it had to create, outermost first."""
    src, dst = vault / old, vault / new
    made: list[Path] = []
    for d in reversed([dst.parent, *dst.parent.parents]):
        if d == vault or d.exists() or vault not in d.parents:
            continue
        made.append(d)
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if _case_only(vault, old, new):
            tmp = _temp_name(vault, old)
            if tmp.exists():
                raise OSError(f"{tmp.name} is left over from an earlier rename")
            os.rename(src, tmp)
            try:
                os.rename(tmp, dst)
            except BaseException as e:
                if not tmp.exists():
                    raise  # the second rename had already completed
                try:
                    os.rename(tmp, src)
                except BaseException:
                    raise _Stranded(
                        f"{old} is stranded as {tmp.relative_to(vault)}: "
                        f"rename it back by hand ({e or type(e).__name__})"
                    ) from e
                raise
            return made
        if dst.exists():
            raise OSError(f"{new} appeared since the plan")
        os.rename(src, dst)
        return made
    except BaseException:
        for d in reversed(made):
            try:
                d.rmdir()
            except OSError:
                pass
        raise


def _moved_one(vault: Path, old: str, new: str) -> bool:
    """True when the note is already at NEW, whatever step was reached."""
    dst = vault / new
    try:
        if _nfc(old).casefold() == _nfc(new).casefold():
            # `_move` never renames a folder: the file leaves OLD's folder
            # for NEW's, so OLD's exact name must be gone from its folder.
            src = vault / old
            return (dst.name in os.listdir(dst.parent)
                    and src.name not in os.listdir(src.parent)
                    and not _temp_name(vault, old).exists())
        return dst.exists() and not (vault / old).exists()
    except OSError:
        return False


def _moved(p: Plan) -> bool:
    """True when every note of the plan is already at its new path."""
    return all(_moved_one(p.vault, o, n) for o, n in p.moves)


def _check_fresh(p: Plan) -> None:
    """Refuse a plan the vault has moved on from. Nothing is written."""
    stale = "changed since the plan; nothing was changed, run it again"
    for rel, text in p.originals.items():
        try:
            now = _read(p.vault, rel)
        except RelinkError:
            raise RelinkError(f"{rel} can no longer be read; nothing was "
                              f"changed, run it again") from None
        if now is None:
            raise RelinkError(f"{rel} is no longer valid UTF-8; nothing was "
                              f"changed, run it again")
        if now != text:
            raise RelinkError(f"{rel} {stale}")
    for old, new in p.moves:
        if not (p.vault / old).is_file():
            raise RelinkError(f"{old} {stale}")
        if not _case_only(p.vault, old, new) and (p.vault / new).exists():
            raise RelinkError(f"{new} {stale}")
    try:
        fresh = plan(p.vault, p.old, p.new)
    except RelinkError as e:
        raise RelinkError(f"{e} (the vault {stale})") from e
    if (fresh.originals, fresh.texts, fresh.changes, fresh.moves) != (
            p.originals, p.texts, p.changes, p.moves):
        raise RelinkError(f"the vault {stale}")


def apply(p: Plan) -> list[str]:
    """Carry the plan out, or leave the vault exactly as it was."""
    _check_fresh(p)
    written: list[str] = []
    created: dict[tuple[str, str], list[Path]] = {}
    try:
        for rel in sorted(p.texts):
            written.append(rel)  # before the write: an interrupt mid-write
            write_text_atomic(p.vault / rel, p.texts[rel])
        for old, new in p.moves:
            created[(old, new)] = _move(p.vault, old, new) or []
    except BaseException as e:
        if _moved(p):
            # Every note is already at its new path, so the rewritten links
            # are right.
            names = " and ".join(f"{o} to {n}" for o, n in p.moves)
            said = (f"{names} {'were' if p.companions else 'was'} renamed "
                    f"and the links were rewritten; the rename completed "
                    f"({str(e) or type(e).__name__})")
            if isinstance(e, KeyboardInterrupt):
                raise KeyboardInterrupt(said) from None
            raise RelinkError(said) from e
        # Put back the notes that did move, last first, then the texts.
        unmoved = []
        for old, new in reversed(p.moves):
            if _moved_one(p.vault, old, new):
                try:
                    _move(p.vault, new, old)
                except BaseException:
                    unmoved.append(new)
                    continue
                for d in reversed(created.get((old, new), [])):
                    try:
                        d.rmdir()  # only if empty
                    except OSError:
                        pass
        stuck = []
        # A note whose move back failed is still at its new path: writing
        # its old text to the old path would make a second copy.
        left = {old for old, new in p.moves if new in unmoved}
        for rel in written:
            if rel in left:
                continue
            try:
                write_text_atomic(p.vault / rel, p.originals[rel])
            except BaseException:
                stuck.append(rel)
        cause = e.__cause__ if isinstance(e, _Stranded) else e
        said = str(e) or type(e).__name__
        if unmoved:
            said += (f"; these notes could not be moved back and are still "
                     f"at their new names: {', '.join(unmoved)}")
        if stuck:
            said += (f"; these notes could not be put back and still have "
                     f"the new links: {', '.join(stuck)}")
        elif not unmoved:
            said += ("; the links were put back" if isinstance(e, _Stranded)
                     else "; the vault is as it was")
        if isinstance(cause, KeyboardInterrupt):
            raise KeyboardInterrupt(said) from None
        if (isinstance(cause, SystemExit) and not stuck and not unmoved
                and e is cause):
            raise
        raise RelinkError(said) from e
    return rows(p, done=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Rename or move a note and rewrite every link to it.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"relink.py: not a directory: {args.vault}", file=sys.stderr)
        return 2
    try:
        old = resolve_old(args.vault, args.old)
        p = plan(args.vault, old, args.new)
        out = apply(p) if args.apply else rows(p)
    except RelinkError as e:
        print(f"relink.py: {e}", file=sys.stderr)
        return 2 if e.usage else 1
    except KeyboardInterrupt as e:
        print(f"relink.py: interrupted; {e}" if str(e)
              else "relink.py: interrupted", file=sys.stderr)
        return 130
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())

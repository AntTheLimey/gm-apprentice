#!/usr/bin/env python3
"""prop_move.py: move a vault's own props into prop notes.

    prop_move.py VAULT plan [--decisions FILE] [--draft OUT] [--json OUT]
    prop_move.py VAULT apply [--decisions FILE]

Two layouts are read: notes a site script builds props from (`prop:` and
`prop_look:` in the frontmatter, the build_props layout), and hand-made
prop pages in a chapter's `Props/` folder with copies kept in the site's
output by hand (`player_site.keep`).

A build_props note becomes a `type: prop` note in place: its look is its
`prop_style`, its page lives where it did (`props/<page>`), its blurb is its
`prop_line`, its hand is a hand in `_meta/prop-hands.json` (the family read
from the build's stylesheet), and the section holding the prop's lines
becomes `## The Text`, with the description above it.

A hand-made page gets a prop note of its own (the handout notes are left
alone): live when the kept folder holds a copy (the note is published at
that address, and the page takes the live copy's words, the vault's own
lines kept in gm-only fences), held otherwise (not published; its Keeper
lines wrapped in gm-only fences). Every other page of a kept folder comes
into the vault with the files it links, as a supplied prop; a page that
reads a state script becomes a container with a note per entry; a listing
of the papers becomes a container.

`plan` works on a copy of the vault and writes nothing in the vault or the
site; it checks the copy against the live site with `props move-check`,
whose leak check on the new build must find nothing the live site did not
have (a finding that is new is a blocker).
`apply` does the same to the vault, publishes, sets the settings, runs the
check, and only then retires the kept folders and build steps, prunes the
leak check's accepts and starts the reveals log. A blocker or any failure
puts every file back as it was. Decisions (JSON, `--decisions`) override
what is inferred, key by key; `--draft` writes what was used.

Rows are `verb <TAB> path <TAB> detail` (WOULD-CREATE, WOULD-EDIT,
WOULD-COPY, WOULD-WRAP, WOULD-PUBLISH, WOULD-SET, WOULD-RETIRE, CHECK,
NEEDS-A-PERSON, and EXPECT-GONE for each build_props page's credits line
the move takes off; the done forms on apply), then
`# notes: N files: N publish: N retire: N blockers: N`.
Exit: 0 a plan made, or the move applied; 1 nothing changed (a blocker, a
failure; the vault was put back); 2 bad arguments.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import posixpath
import re
import shutil
import signal
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vault_write  # noqa: E402
from migrate_core import StepFailed, plugin_tool  # noqa: E402
from migrate_site import AFTER_BUILD, _set_settings  # noqa: E402
from reveal import LOG, _load_log, _write_log, apply_publish, prop_paths, publish_state  # noqa: E402
from reveal_scan import NEVER_CANDIDATES  # noqa: E402
from vault_check import configured_site  # noqa: E402
from vault_write import BAD_NAME_RE, HAND_ID_RE, HANDS_REL, Batch, WriteError, use_hand  # noqa: E402
from vaultlib import (PublishToolUnavailable, SettingsUnavailable, entity_type,  # noqa: E402
                      extract_frontmatter, forget_settings, frontmatter_span, is_skipped_path,
                      scalar_value, settings, settings_remove, yaml_scalar, yaml_value_for_cli)

PERSON = "NEEDS-A-PERSON"
# A top-level frontmatter line: its key and the rest of the line.
KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")
FENCE_RE = re.compile(r"^```")
HAND_SUFFIX = "-hand"


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _eol(line: str) -> str:
    return "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""


def _bare(raw: str) -> str:
    """A frontmatter value as YAML reads a plain or quoted scalar."""
    return scalar_value(raw.strip())


# --- the build_props layout ----------------------------------------------------

def is_build_props_note(text: str) -> bool:
    """Whether the note declares a build_props prop: `prop:` and `prop_look:`
    both in its frontmatter."""
    lines = text.lstrip("﻿").splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        return False
    keys = {m.group(1) for m in (KEY_RE.match(ln.rstrip("\r\n")) for ln in lines[1:end]) if m}
    return {"prop", "prop_look"} <= keys


def _requote(raw: str, value: str) -> str:
    """`value` written as `raw` was: in the same quotes, or bare."""
    text = raw.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return f"{text[0]}{value}{text[0]}"
    return value


def _text_section(body: list[str]) -> tuple[list[str] | None, str | None]:
    """The body with the section that holds the prop's lines rewritten: the
    first fenced block (the one build_props reads) is the prop's lines; the
    `## ` heading over it gives way to the prose before the fence, then
    `## The Text`, a blank line and the fence; a `---` rule right after the
    fence goes. (None, why) when there is no fence or no heading over it."""
    fence = next((i for i, ln in enumerate(body) if FENCE_RE.match(ln)), None)
    if fence is None:
        return None, "no fenced block holds the prop's lines"
    close = next((i for i in range(fence + 1, len(body)) if FENCE_RE.match(body[i])), None)
    if close is None:
        return None, "the fenced block that holds the prop's lines never closes"
    heading = next((i for i in range(fence - 1, -1, -1)
                    if body[i].startswith("## ")), None)
    if heading is None:
        return None, "no ## heading over the prop's lines"
    eol = _eol(body[heading]) or "\n"
    desc = body[heading + 1:fence]
    while desc and not desc[0].strip():
        desc = desc[1:]
    while desc and not desc[-1].strip():
        desc = desc[:-1]
    rest = body[close + 1:]
    nxt = next((i for i, ln in enumerate(rest) if ln.strip()), None)
    if nxt is not None and rest[nxt].strip() == "---":
        after = rest[nxt + 1:]
        while after and not after[0].strip():
            after = after[1:]
        rest = [eol, *after] if after else []
    if desc and not _eol(desc[-1]):
        desc[-1] += eol
    fence_lines = body[fence:close + 1]
    if not _eol(fence_lines[-1]) and rest:
        fence_lines[-1] += eol
    out = [*body[:heading], *desc, *([eol] if desc else []),
           f"## The Text{eol}", eol, *fence_lines, *rest]
    return out, None


def convert_build_props_note(text: str) -> tuple[str | None, str | None, str | None]:
    """(the note as a prop note, the hand class it uses or None, why it could
    not be converted). Key order, line endings and every key the mapping
    does not name are kept."""
    bom = "﻿" if text.startswith("﻿") else ""
    lines = text[len(bom):].splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        return None, None, f"frontmatter: {error}"
    eol = _eol(lines[0]) or "\n"
    fm: list[str] = []
    page = look = hand = None
    for line in lines[1:end]:
        m = KEY_RE.match(line.rstrip("\r\n"))
        if not m:
            fm.append(line)
            continue
        key, raw = m.group(1), m.group(2)
        own = _eol(line) or eol
        if key == "type":
            fm.append(f"type: prop{own}")
        elif key == "prop":
            page = _bare(raw)
        elif key == "prop_look":
            look = _bare(raw)
        elif key == "prop_blurb":
            fm.append(f"prop_line:{raw}{own}")
        elif key == "prop_frank":
            first, bar, amount = _bare(raw).partition("|")
            fm.append(f"prop_frank: {yaml_scalar(first)}{own}")
            if bar:
                fm.append(f"prop_frank_amount: {yaml_scalar(amount)}{own}")
        elif key == "prop_hand":
            hand = _bare(raw)
            short = hand[:-len(HAND_SUFFIX)] if hand.endswith(HAND_SUFFIX) else hand
            fm.append(f"prop_hand: {_requote(raw, short)}{own}")
        elif key == "prop_hand_shift":
            fm.append(f"prop_shift:{raw}{own}")
        else:
            fm.append(line)
    if not page or not look:
        return None, None, "prop and prop_look must both name something"
    if fm and not _eol(fm[-1]):
        fm[-1] += eol
    fm.append(f"prop_style: {look}{eol}")
    fm.append(f"prop_address: props/{page}{eol}")
    body, why = _text_section(lines[end + 1:])
    if body is None:
        return None, hand, why
    return bom + "".join([lines[0], *fm, lines[end], *body]), hand, None


def hand_fonts(vault: Path) -> dict[str, list[str]]:
    """Each `.<x>-hand` rule's first font family in the build's stylesheets
    (`props.css` in a `Props/` folder, the one build_props copies beside its
    pages), by hand class; a class two stylesheets give different families
    has both."""
    found: dict[str, list[str]] = {}
    for css in sorted(vault.rglob("Props/props.css")):
        rel = css.relative_to(vault).as_posix()
        if is_skipped_path(rel):
            continue
        try:
            text = css.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        for selectors, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
            names = [s.strip() for s in selectors.split(",")]
            family = re.search(r"font-family\s*:\s*([^;}]+)", body)
            if not family:
                continue
            first = family.group(1).split(",")[0].strip().strip("'\"").strip()
            for name in names:
                m = re.fullmatch(r"\.([\w-]+-hand)", name)
                if m and first and first not in found.setdefault(m.group(1), []):
                    found[m.group(1)].append(first)
    return found


# --- the conversion ------------------------------------------------------------

@dataclass
class Conversion:
    """Everything the move would write, held in memory: notes (and the hand
    registry) in `batch`, every other file in `files`."""
    vault: Path
    batch: Batch
    files: dict[str, bytes] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)
    publish: list[str] = field(default_factory=list)
    rows: list[str] = field(default_factory=list)
    build_props: list[str] = field(default_factory=list)    # the notes converted
    addresses: dict[str, str] = field(default_factory=dict)  # note -> its prop's address
    decisions: dict[str, Any] = field(default_factory=dict)
    inferred_settings: dict[str, Any] = field(default_factory=dict)
    taken: set[str] = field(default_factory=set)            # note names made now
    states: list[str] = field(default_factory=list)          # the live state files the made ones replace
    live_root: Path | None = None

    def row(self, verb: str, where: str, detail: str = "") -> None:
        self.rows.append(f"{verb}\t{where}\t{detail}")


def _notes(vault: Path) -> list[tuple[str, str]]:
    """(rel, text as written) of every note the move reads."""
    out = []
    for path in sorted(vault.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        if is_skipped_path(rel) or rel.startswith("_meta/"):
            continue
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                out.append((rel, f.read()))
        except (OSError, UnicodeDecodeError):
            continue
    return out


def convert_build_props(c: Conversion) -> None:
    """15a: every build_props note becomes a prop note; its hands go into the
    hand registry through the one writer `vault_write.py prop-hand` uses."""
    used: dict[str, list[str]] = {}
    for rel, text in _notes(c.vault):
        if not is_build_props_note(text):
            continue
        new, hand, why = convert_build_props_note(text)
        if new is None:
            c.row(PERSON, rel, f"not converted: {why}")
            continue
        c.batch.put(rel, new)
        c.build_props.append(rel)
        m = re.search(r"^prop_address: (.*)$", new, re.M)
        if m:
            c.addresses[rel] = m.group(1).strip()
        if hand:
            used.setdefault(hand, []).append(rel)
        elif re.search(r"^prop_envelope:", new, re.M):
            c.row(PERSON, rel, "its envelope was written in a hand build_props chose for "
                  "every envelope; set prop_hand to that hand, or the style's own font is used")
    if not used:
        return
    fonts = hand_fonts(c.vault)
    for hand, rels in sorted(used.items()):
        where = rels[0]
        short = hand[:-len(HAND_SUFFIX)] if hand.endswith(HAND_SUFFIX) else hand
        if not hand.endswith(HAND_SUFFIX) or not HAND_ID_RE.match(short):
            c.row(PERSON, where, f"prop_hand {hand!r}: not a hand class this "
                  f"can name (lower-case letters, digits and hyphens, then "
                  f"-hand); add the hand with vault_write.py prop-hand and "
                  f"set prop_hand on {', '.join(rels)}")
            continue
        families = fonts.get(hand, [])
        if len(families) != 1:
            why = ("no props.css rule gives it a font-family" if not families
                   else f"the stylesheets disagree ({', '.join(families)})")
            c.row(PERSON, where, f"hand {short}: {why}; add it with "
                  f"vault_write.py prop-hand --hand {short} --hand-font FAMILY")
            continue
        try:
            use_hand(c.batch, short, families[0], None)
        except WriteError as e:
            c.row(PERSON, HANDS_REL, f"hand {short}: {e}")


# --- reading pages (html.parser) ------------------------------------------------

VOID = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input",
                  "link", "meta", "source", "track", "wbr"})
EXTERNAL_RE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)
CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3""")
PAGE_EXTS = (".html", ".htm")
PICTURE_PATH_RE = re.compile(r"^[^\s:]+\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$", re.I)
GM_FENCE_RE = re.compile(r"<!--\s*(/?)gm-only\s*-->")
CODE_TAG_RE = re.compile(r"<(/?)(script|style)\b", re.I)


def squash(text: str) -> str:
    return " ".join(text.split())


class PageReader(HTMLParser):
    """What the move reads off a page: its title, every address it names,
    its pictures and scripts, and its links with the words in them (the
    first element inside a link, the rest, and the heading or `p.sub` line
    the link sits under)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.refs: list[str] = []
        self.imgs: list[tuple[str, str]] = []
        self.scripts: list[str] = []
        self.anchors: list[dict[str, str]] = []
        self._group = ""
        self._cap: tuple[str, list[str]] | None = None
        self._a: dict[str, Any] | None = None
        self._in_title = False
        self._code = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        for key in ("href", "src"):
            if a.get(key):
                self.refs.append(a[key])
        # A picture named in a data- attribute, which the page's script shows
        # (the publish tool copies it as it does an img src).
        self.refs += [v for k, v in a.items() if k.startswith("data-") and PICTURE_PATH_RE.match(v.strip())]
        if tag == "img" and a.get("src"):
            self.imgs.append((a["src"], squash(a.get("alt", ""))))
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        if tag == "title":
            self._in_title = True
        if tag in ("script", "style"):
            self._code += 1
        anchor = self._a
        if anchor is not None:
            if tag not in VOID:
                anchor["depth"] += 1
                if anchor["first_tag"] is None and anchor["depth"] == 1:
                    anchor["first_tag"], anchor["in_first"] = tag, True
            return
        if tag in ("h2", "h3", "h4") or (tag == "p" and "sub" in a.get("class", "").split()):
            self._cap = (tag, [])
        if tag == "a" and a.get("href"):
            self._a = {"href": a["href"], "depth": 0, "first_tag": None,
                       "in_first": False, "first": [], "rest": []}

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID:
            return
        if tag in ("script", "style") and self._code:
            self._code -= 1
        if tag == "title":
            self._in_title = False
        anchor = self._a
        if anchor is not None:
            if tag == "a" and anchor["depth"] == 0:
                first, rest = squash("".join(anchor["first"])), squash("".join(anchor["rest"]))
                if anchor["first_tag"] is None:
                    first, rest = rest, ""
                self.anchors.append({"href": anchor["href"], "title": first,
                                     "line": rest, "group": self._group})
                self._a = None
            elif anchor["depth"] > 0:
                anchor["depth"] -= 1
                if anchor["depth"] == 0:
                    anchor["in_first"] = False
            return
        if self._cap is not None and tag == self._cap[0]:
            self._group = squash("".join(self._cap[1]))
            self._cap = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._code:
            return
        if self._a is not None:
            self._a["first" if self._a["in_first"] else "rest"].append(data)
        elif self._cap is not None:
            self._cap[1].append(data)


class LineReader(HTMLParser):
    """The first tag on a line, its class, and the words on it (a script's
    or a stylesheet's text is code, not words)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tag = ""
        self.cls = ""
        self.text: list[str] = []
        self._code = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if not self.tag:
            self.tag = tag
            self.cls = squash(dict(attrs).get("class") or "")
        if tag in ("script", "style"):
            self._code += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._code:
            self._code -= 1

    def handle_data(self, data: str) -> None:
        if not self._code:
            self.text.append(data)


class CreditsReader(HTMLParser):
    """The words of a page's first `class="credits"` element: the line
    build_props writes under every page it builds (`<p class="credits">`)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.done = False
        self._tag = ""
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._depth:
            if tag == self._tag:
                self._depth += 1
        elif not self.done and "credits" in (dict(attrs).get("class") or "").split() and tag not in VOID:
            self._tag, self._depth = tag, 1

    def handle_endtag(self, tag: str) -> None:
        if self._depth and tag == self._tag:
            self._depth -= 1
            self.done = self._depth == 0

    def handle_data(self, data: str) -> None:
        if self._depth:
            self.text.append(data)


def credits_of(path: Path) -> str:
    reader = CreditsReader()
    reader.feed(read_text(path))
    reader.close()
    return squash("".join(reader.text))


def read_line(line: str) -> LineReader:
    reader = LineReader()
    reader.feed(line)
    reader.close()
    return reader


def words_of(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def read_text(path: Path) -> str:
    with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        return f.read()


def read_page(path: Path) -> PageReader:
    reader = PageReader()
    reader.feed(read_text(path))
    reader.close()
    return reader


def short_title(title: str) -> str:
    """A page's title before its ` — ` (the site's name after it)."""
    return squash(title).split(" — ")[0].strip()


def target(page_rel: str, url: str) -> str | None:
    """The address `url` on the page at `page_rel` goes to, without its query
    or anchor, a folder as its index.html; None off the site."""
    v = unquote(url.strip())
    if not v or v.startswith("#") or EXTERNAL_RE.match(v):
        return None
    v = re.sub(r"[?#].*$", "", v)
    if not v:
        return None
    joined = v[1:] if v.startswith("/") else posixpath.join(posixpath.dirname(page_rel), v)
    joined = posixpath.normpath(joined) if joined else "."
    if joined == ".." or joined.startswith("../"):
        return None
    if joined == "." or v.endswith("/"):
        joined = posixpath.join("" if joined == "." else joined, "index.html")
    return nfc(joined)


def linked_files(live: Path, page_rel: str, inside: str) -> list[str]:
    """The files (not pages) the page at `page_rel` names, and the files its
    stylesheets name in turn, that exist under `inside` in the live output."""
    found: list[str] = []
    todo = [(page_rel, url) for url in read_page(live / page_rel).refs]
    while todo:
        at, url = todo.pop(0)
        rel = target(at, url)
        if (rel is None or rel in found or rel.lower().endswith(PAGE_EXTS)
                or not rel.startswith(inside) or not (live / rel).is_file()):
            continue
        found.append(rel)
        if rel.lower().endswith(".css"):
            for m in CSS_URL_RE.finditer(read_text(live / rel)):
                todo.append((rel, m.group(2) or m.group(4)))
    return found


def read_state(path: Path) -> dict[str, Any] | None:
    """What a container's hand-made state script sets, as the publish tool
    reads it (`props read-state`): {global, items}, or None when it is not a
    state script the tool can read."""
    try:
        code, out, _err = plugin_tool(["props", "read-state", str(path), "--json"])
    except StepFailed:
        return None
    if code != 0:
        return None
    try:
        data = json.loads(out)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


# --- the diff-merge of a delivered page ----------------------------------------

def _code_lines(lines: list[str]) -> set[int]:
    """The lines inside a <script> or <style> block: their words are code."""
    inside, out = False, set()
    for i, line in enumerate(lines):
        start = inside
        for m in CODE_TAG_RE.finditer(line):
            inside = not m.group(1)
        if start or (inside and not CODE_TAG_RE.search(line)):
            out.add(i)
    return out


def _says(lines: list[str], at: int, code: set[int]) -> bool:
    return any(not (at + k in code) and words_of("".join(read_line(ln).text))
               for k, ln in enumerate(lines))


def _only_external(line: str) -> bool:
    """Whether the line names at least one address and every address it
    names is off the site."""
    reader = PageReader()
    reader.feed(line)
    reader.close()
    refs = [r.strip() for r in reader.refs if r.strip()]
    return bool(refs) and all(EXTERNAL_RE.match(r) for r in refs)


def _tags_only(mine: list[str], theirs: list[str], eol: str) -> list[str]:
    """A difference of tags alone: the vault's lines, except that the lines
    naming only addresses off the site (a font service's link) are the live
    page's, set where the vault's first such line was, or first when the
    vault has none (a line the live page added)."""
    outside = [ln for ln in theirs if _only_external(ln)]
    out: list[str] = []
    placed = False
    for line in mine:
        if outside and _only_external(line):
            if not placed:
                out += _ended(outside, eol)
                placed = True
            continue
        out.append(line)
    return out if placed else [*_ended(outside, eol), *out]


def _ended(lines: list[str], eol: str) -> list[str]:
    return [ln.rstrip("\r\n") + eol for ln in lines]


Shape = tuple[str, str, str]


def shape_of(line: str) -> Shape | None:
    """A Keeper line's shape: its first tag, that tag's class, the first two
    words on it; None for a line with no words."""
    r = read_line(line)
    words = words_of("".join(r.text))
    return (r.tag, r.cls, " ".join(words[:2])) if words else None


def merge_delivered(vault_text: str, live_text: str) -> tuple[str, list[str]]:
    """(the vault page with the live copy's words, the vault lines that only
    the GM keeps). Lines both share stay; a difference of tags alone keeps
    the vault's side; any other difference keeps the vault's lines in a
    gm-only fence with the live lines after them, so the page's player view
    says what the live page says."""
    a = vault_text.splitlines(keepends=True)
    b = live_text.splitlines(keepends=True)
    eol = _eol(a[0]) if a and _eol(a[0]) else "\n"
    code_a, code_b = _code_lines(a), _code_lines(b)
    matcher = difflib.SequenceMatcher(None, [x.rstrip("\r\n") for x in a],
                                      [x.rstrip("\r\n") for x in b], autojunk=False)
    out: list[str] = []
    keeper: list[str] = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        mine, theirs = a[i1:i2], b[j1:j2]
        if op == "equal":
            out += mine
            continue
        if not _says(mine, i1, code_a) and not _says(theirs, j1, code_b):
            out += _tags_only(mine, theirs, eol)
            continue
        if out and not _eol(out[-1]):
            out[-1] += eol
        if mine:
            out += [f"<!-- gm-only -->{eol}", *_ended(mine, eol), f"<!-- /gm-only -->{eol}"]
            keeper += [ln for k, ln in enumerate(mine) if i1 + k not in code_a]
        out += _ended(theirs, eol)
    return "".join(out), keeper


def wrap_keeper_lines(text: str, shapes: set[Shape]) -> tuple[str, int]:
    """`text` with every line whose shape is a Keeper line's in a gm-only
    fence (lines side by side share one); (new text, lines wrapped). Lines
    already in a fence, and code, are left."""
    lines = text.splitlines(keepends=True)
    eol = _eol(lines[0]) if lines and _eol(lines[0]) else "\n"
    code = _code_lines(lines)
    depth, count = 0, 0
    out: list[str] = []
    run: list[str] = []

    def flush() -> None:
        nonlocal count
        if run:
            out.extend([f"<!-- gm-only -->{eol}", *_ended(run, eol), f"<!-- /gm-only -->{eol}"])
            count += len(run)
            run.clear()
    for i, line in enumerate(lines):
        before = depth
        for m in GM_FENCE_RE.finditer(line):
            depth = max(0, depth - 1) if m.group(1) else depth + 1
        if before == 0 and depth == 0 and i not in code and not GM_FENCE_RE.search(line) \
                and shape_of(line) in shapes:
            run.append(line)
            continue
        flush()
        out.append(line)
    flush()
    return "".join(out), count


# --- 15b: hand-made pages and kept folders --------------------------------------

KNOWN_STEPS: dict[str, dict[str, list[str]]] = {
    "add-props": {"serves": ["props/"], "expect_gone": ["Chapter 1 props", "About this handout"]},
    "inject-gazetteer": {"serves": ["gazetteer/"], "expect_gone": []},
}
STEP_RE = re.compile(r"\s*node\s+([\"']?)((?:[^\s\"']*[/\\])?([\w.-]+?)\.(?:m|c)?js)\1\s*")
BANNER = ("player_site.landing.banner.title", "player_site.landing.banner.text",
          "player_site.landing.banner.link")
PROPS_ADDRESS = "player_site.props.address"
DEFAULT_PROPS_ADDRESS = "props/index.html"
DECISION_KEYS = ("notes_folder", "settings", "retire", "serves", "listings", "expect_gone", "groups")


def step_script(command: str) -> tuple[str, str] | None:
    """(the script's path as written, its name) of a `node <script>` step."""
    m = STEP_RE.fullmatch(command)
    return (m.group(2), m.group(3)) if m else None


def quoted(value: str) -> str:
    """A text value for a frontmatter line: a JSON string is a valid YAML
    double-quoted scalar, escapes and all."""
    return json.dumps(value, ensure_ascii=False)


def field_value(value: Any) -> str | None:
    """A state entry's value as YAML: text as a quoted string, a number,
    true/false or null as `yaml_value_for_cli` types them, a list or map as
    JSON-style flow YAML; None for anything else."""
    if isinstance(value, str):
        return quoted(value)
    if value is None or isinstance(value, (bool, int)):
        return yaml_value_for_cli(json.dumps(value))
    if isinstance(value, float):
        return json.dumps(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return None


def clean_stem(title: str, fallback: str) -> str:
    stem = squash(BAD_NAME_RE.sub("", title))
    return stem or fallback


@dataclass
class Live:
    """The site's output as the move reads it."""
    root: Path
    kept: list[str]                              # kept folders that are there
    files: list[str] = field(default_factory=list)   # every file under them

    def pages(self, under: str) -> list[str]:
        return [f for f in self.files if f.startswith(under) and f.lower().endswith(PAGE_EXTS)]


def _live(root: Path, keep: list[str]) -> Live:
    kept = [k for k in keep if (root / k).is_dir()]
    files = sorted(nfc(p.relative_to(root).as_posix()) for k in kept
                   for p in (root / k).rglob("*") if p.is_file())
    return Live(root=root, kept=kept, files=files)


def _note_path(c: Conversion, folder: str, stem: str) -> str | None:
    """A free note path for `stem` in `folder`: the stem when no note in the
    vault has it, else `<stem> (prop)`; None (and a row) when both are taken."""
    for name in (stem, f"{stem} (prop)"):
        key = nfc(name).casefold()
        if key not in c.taken and not vault_write.live_stem_clash(c.batch, name):
            c.taken.add(key)
            return f"{folder}/{name}.md" if folder else f"{name}.md"
    c.row(PERSON, f"{folder}/{stem}.md", f"no free note name for {stem!r} "
          f"(it and {stem!r} (prop) are taken)")
    return None


def _prop_note(c: Conversion, rel: str, fields: list[tuple[str, str]], body: str = "") -> None:
    """A note made from the prop template, with `fields` set (YAML values)."""
    template = vault_write.template_text(c.vault, vault_write.PROP_TEMPLATES, "prop.md")
    fm = vault_write.template_frontmatter(template)
    for key, value in fields:
        vault_write.set_block(fm, key, value)
    c.batch.create(rel, "---\n" + "\n".join(fm) + "\n---\n" + body)


def _copy(c: Conversion, rel: str, source: Path, label: str) -> bool:
    """Plan a copy of `source` to `rel` in the vault; a different file already
    there is never overwritten (a row says so)."""
    data = source.read_bytes()
    if rel in c.files:
        return c.files[rel] == data
    have = c.vault / rel
    if have.is_file():
        if have.read_bytes() == data:
            return True
        c.row(PERSON, rel, f"not copied: the vault already has another file "
              f"here; {label} needs it (compare the two and keep one)")
        return False
    c.files[rel] = data
    c.sources[rel] = label
    return True


def _printable_lines(c: Conversion) -> list[tuple[str, str, str]]:
    """(note, its name, the words of each `Printable prop` line, with the line
    after a heading of that name) of every note that is not prep or a Props
    folder's own file."""
    out = []
    for rel, text in _notes(c.vault):
        if "Printable prop" not in text or "/Props/" in f"/{rel}":
            continue
        fm = extract_frontmatter(text) or {}
        if entity_type(fm) in NEVER_CANDIDATES:
            continue
        name = str(fm.get("name") or fm.get("title") or Path(rel).stem.replace("_", " "))
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if "Printable prop" not in line:
                continue
            window = [line]
            if line.lstrip().startswith("#"):
                window += [ln for ln in lines[i + 1:i + 4] if ln.strip()][:1]
            out.append((rel, name, " ".join(window)))
    return out


def _handout_for(printable: list[tuple[str, str, str]], page: str) -> tuple[str, str] | None:
    """(the handout note, its name) whose Printable prop line names `page`."""
    name = re.escape(posixpath.basename(page))
    pattern = re.compile(rf"(?:^|[\s`/(\[]){name}(?:$|[\s`).,;:\]])")
    hits = sorted((rel, title) for rel, title, line in printable
                  if page in line or pattern.search(line))
    return hits[0] if hits else None


def _handmade_pages(c: Conversion) -> list[str]:
    """Pages in a `Props/` folder under Chapters/ that no prop note names by
    `prop_file` and no build_props note builds (index.html aside)."""
    candidates = []
    for folder in sorted((c.vault / "Chapters").rglob("Props")) if (c.vault / "Chapters").is_dir() else []:
        if not folder.is_dir():
            continue
        for p in sorted(folder.iterdir()):
            rel = nfc(p.relative_to(c.vault).as_posix())
            if (p.is_file() and p.suffix.lower() in PAGE_EXTS and p.name.lower() != "index.html"
                    and not is_skipped_path(rel)):
                candidates.append(rel)
    if not candidates:
        return []
    # Which notes are props is the publish tool's answer (explain --all); their prop_file says which page each has.
    props, _no_page, why = prop_paths(c.vault)
    if props is None:
        raise StepFailed(f"the publish tool could not say which notes are props: {why}")
    built = {f"*/{posixpath.basename(c.addresses[rel])}" for rel in c.build_props if rel in c.addresses}
    named: set[str] = set()
    for rel, text in _notes(c.vault):
        fm = extract_frontmatter(text) or {}
        value = fm.get("prop_file")
        if nfc(rel) in props and isinstance(value, str) and value.strip():
            named.add(nfc(posixpath.normpath(posixpath.join(posixpath.dirname(rel), value.strip()))))
        build_page = fm.get("prop")
        if isinstance(build_page, str) and build_page.strip() and fm.get("prop_look"):
            built.add(f"*/{build_page.strip()}")
    return [rel for rel in candidates
            if rel not in named and f"*/{posixpath.basename(rel)}" not in built]


def _infer_retire(c: Conversion, site: Path | None, steps: list[str], converting: list[str]) -> None:
    """retire.after_build, serves and expect_gone from the site's build steps:
    a known prop step is retired when what it serves is being moved; any
    other step is left, and named for a person when its script writes under
    a served folder. Unknown steps are never retired."""
    retire, serves, gone = [], [f"{k}/" for k in converting], []
    for command in steps:
        found = step_script(str(command))
        if not found or found[1] not in KNOWN_STEPS:
            continue
        name = found[1]
        if name == "add-props" and not c.build_props:
            continue
        if name == "inject-gazetteer" and "gazetteer" not in converting:
            continue
        retire.append(str(command))
        serves += KNOWN_STEPS[name]["serves"]
        gone += KNOWN_STEPS[name]["expect_gone"]
    serves = list(dict.fromkeys(serves))
    for command in steps:
        found = step_script(str(command))
        if str(command) in retire:
            continue
        script = site / found[0] if site and found else None
        try:
            text = script.read_text(encoding="utf-8", errors="replace") if script else ""
        except OSError:
            text = ""
        hit = [p for p in serves if p in text]
        if hit:
            c.row(PERSON, str(command), f"a build step that is left: its script "
                  f"names {', '.join(hit)}, which the move serves from the vault; "
                  f"check what it writes there")
    c.decisions["retire"] = {"keep": [], "after_build": retire}
    c.decisions["serves"] = serves
    c.decisions["expect_gone"] = list(dict.fromkeys(gone))


def _infer_listings(c: Conversion, root: Path, converted: set[str], props_address: str) -> None:
    """Every index.html under a served folder whose links mostly go to
    converted props is a listing; one that is not the props page becomes a
    container named by its title."""
    listings: dict[str, dict[str, Any]] = {}
    for prefix in c.decisions["serves"]:
        if not (root / prefix).is_dir():
            continue
        for p in sorted((root / prefix).rglob("index.html")):
            rel = nfc(p.relative_to(root).as_posix())
            reader = read_page(p)
            links = {t for t in (target(rel, a["href"]) for a in reader.anchors) if t}
            if not links or sum(t in converted for t in links) * 2 <= len(links):
                continue
            name = None if rel == props_address else clean_stem(short_title(reader.title), "Listing")
            listings[rel] = {"container": name, "style": None}
    c.decisions["listings"] = listings


def _infer_notes_folder(c: Conversion, live: Live, homes: dict[str, str]) -> None:
    """Each kept folder's vault home: a folder named for it in the Props
    folder holding most of its live pages."""
    folders: dict[str, str] = {}
    for k in live.kept:
        counts: dict[str, int] = {}
        for page, address in homes.items():
            if address.startswith(f"{k}/"):
                props = posixpath.dirname(page)
                counts[props] = counts.get(props, 0) + 1
        base = max(sorted(counts), key=lambda f: counts[f]) if counts else "Props"
        folders[k] = f"{base}/{k[:1].upper()}{k[1:]}"
    c.decisions["notes_folder"] = folders


def _given(c: Conversion, given: dict[str, Any] | None, keys: tuple[str, ...]) -> None:
    for key in keys:
        if given and key in given:
            c.decisions[key] = given[key]


def convert_kept(c: Conversion, site: Path | None, live_root: Path | None,
                 keep: list[str], steps: list[str], props_address: str,
                 given: dict[str, Any] | None) -> None:
    """15b: hand-made pages become prop notes (live ones published, held ones
    not), and every page and file of each kept folder is served by a note."""
    live = _live(live_root, keep) if live_root and live_root.is_dir() else Live(Path("."), [])
    printable = _printable_lines(c)
    # What publishes now, as the publish tool says; None when it cannot say.
    publishing, _why = publish_state(c.vault)
    pages = _handmade_pages(c)
    by_name: dict[str, list[str]] = {}
    for f in live.files:
        by_name.setdefault(posixpath.basename(f), []).append(f)
    homes: dict[str, str] = {}
    for page in pages:
        found = by_name.get(posixpath.basename(page), [])
        if len(found) > 1:
            c.row(PERSON, page, f"live in {len(found)} places ({', '.join(found)}); "
                  f"read as {found[0]}")
        if found:
            homes[page] = found[0]
    _infer_notes_folder(c, live, homes)
    _infer_retire(c, site, steps, live.kept)
    converted = set(homes.values()) | set(c.addresses.values())
    c.decisions["listings"] = {}
    if live_root and live_root.is_dir():
        _infer_listings(c, live_root, converted, props_address)
    # Each build_props page's credits line goes with the move: its words, read
    # from the live page's own credits element, are expected gone.
    credits: list[tuple[str, str]] = []
    if live_root and live_root.is_dir():
        for built_note in c.build_props:
            built = c.addresses.get(built_note, "")
            if built and (live_root / built).is_file() and any(built.startswith(x) for x in c.decisions["serves"]):
                said = credits_of(live_root / built)
                if said:
                    credits.append((built, said))
    c.decisions["expect_gone"] = list(dict.fromkeys([*c.decisions["expect_gone"], *(t for _, t in credits)]))
    _given(c, given, ("notes_folder", "retire", "serves", "listings", "expect_gone"))
    for built, said in credits:
        if said in c.decisions["expect_gone"]:
            c.row("EXPECT-GONE", built, said)
    listings: dict[str, dict[str, Any]] = c.decisions["listings"]

    # Each listing's words for the pages it links, and its container.
    info: dict[str, dict[str, str]] = {}
    container_of: dict[str, str] = {}
    folder_container: dict[str, str] = {}
    # The decided listings first: a page's title and line are the ones its listing gives it, not the cover's link.
    indexes = [f for f in live.files if posixpath.basename(f) == "index.html"]
    for f in sorted(indexes, key=lambda f: (f not in listings, f)):
        for a in read_page(live.root / f).anchors:
            t = target(f, a["href"])
            if t and t not in info:
                info[t] = a
        listed = (listings.get(f) or {}).get("container")
        if listed:
            folder_container[posixpath.dirname(f)] = listed
            for a in read_page(live.root / f).anchors:
                t = target(f, a["href"])
                if t:
                    container_of[t] = listed

    # Shapes of the Keeper lines, learnt from each delivered page and its live copy.
    merged: dict[str, str] = {}
    shapes: set[Shape] = set()
    for page, delivered in homes.items():
        text, keeper = merge_delivered(read_text(c.vault / page), read_text(live.root / delivered))
        merged[page] = text
        shapes |= {s for s in map(shape_of, keeper) if s}

    for page in pages:
        folder, base = posixpath.dirname(page), posixpath.basename(page)
        stem = posixpath.splitext(base)[0]
        handout = _handout_for(printable, page)
        address: str | None = homes.get(page)
        box: str | None
        if address is not None:
            row = info.get(address, {})
            title = row.get("title") or short_title(read_page(c.vault / page).title) or stem
            line, group = row.get("line", ""), row.get("group", "")
            box = container_of.get(address)
            if merged[page] != read_text(c.vault / page):
                c.files[page] = merged[page].encode("utf-8")
                c.sources[page] = f"merged with {address}"
        else:
            siblings = [posixpath.dirname(homes[p]) for p in pages
                        if p in homes and posixpath.dirname(p) == folder]
            home = max(sorted(set(siblings)), key=siblings.count) if siblings else None
            address = f"{home}/{base}" if home else None
            title = handout[1] if handout else (short_title(read_page(c.vault / page).title) or stem)
            line, group = "", ""
            box = folder_container.get(home or "")
            text, n = wrap_keeper_lines(read_text(c.vault / page), shapes)
            if n:
                c.files[page] = text.encode("utf-8")
                c.sources[page] = "Keeper lines wrapped"
                c.row("WOULD-WRAP", page, f"{n} Keeper lines put in a gm-only fence "
                      f"(the same shape as a line the live copies dropped)")
        rel = _note_path(c, folder, stem)
        if rel is None:
            continue
        fields = [("name", quoted(title)), ("prop_kind", "document"), ("prop_file", quoted(base))]
        if address:
            fields.append(("prop_address", quoted(address)))
        fields += [("prop_title", quoted(title)), ("prop_line", quoted(line)),
                   ("prop_group", quoted(group))]
        if box:
            fields.append(("prop_container", quoted(f"[[{box}]]")))
        body = ""
        if handout:
            said = f"The page that goes with [[{Path(handout[0]).stem}]]."
            # A handout the site does not show is named for the GM only.
            body = (f"\n## Description\n\n{said}\n" if publishing and nfc(handout[0]) in publishing
                    else f"\n<!-- gm-only -->\n\n## GM Notes\n\n{said}\n\n<!-- /gm-only -->\n")
        _prop_note(c, rel, fields, body)
        if page in homes:
            c.publish.append(rel)

    served = set(homes.values())
    folders: dict[str, str] = c.decisions["notes_folder"]
    groups: dict[str, str] = {}
    for k in live.kept:
        cover = live.root / k / "index.html"
        groups[k] = short_title(read_page(cover).title) if cover.is_file() else k
    c.decisions["groups"] = groups
    _given(c, given, ("groups",))
    groups = c.decisions["groups"]

    def home_of(address: str) -> tuple[str, str] | None:
        """(the kept folder, the vault folder that mirrors it) of an address."""
        k = address.split("/", 1)[0]
        if k not in folders:
            return None
        return k, folders[k]

    def vault_rel(address: str) -> str | None:
        found = home_of(address)
        return f"{found[1]}/{address.split('/', 1)[1]}" if found else None

    def copy_page(address: str) -> bool:
        """The page at `address` and the files it links, into the vault."""
        dest = vault_rel(address)
        if dest is None:
            return False
        k = address.split("/", 1)[0]
        ok = _copy(c, dest, live.root / address, address)
        for f in linked_files(live.root, address, f"{k}/"):
            rel = vault_rel(f)
            if rel:
                _copy(c, rel, live.root / f, f)
        return ok

    # Listing pages become containers.
    for address, choice in sorted(listings.items()):
        box = (choice or {}).get("container")
        served.add(address)
        if not box:
            continue
        mirror = home_of(address)
        folder = posixpath.dirname(vault_rel(address) or "") if mirror else posixpath.dirname(address)
        rel = _note_path(c, folder, clean_stem(str(box), "Listing"))
        if rel is None:
            continue
        fields = [("name", quoted(str(box))), ("prop_kind", "container"),
                  ("prop_address", quoted(address)), ("show_sealed", "none")]
        if (choice or {}).get("style"):
            fields.append(("prop_style", quoted(str(choice["style"]))))
        if mirror:
            fields.append(("prop_group", quoted(groups.get(mirror[0], ""))))
        _prop_note(c, rel, fields)
        c.publish.append(rel)

    # A kept sub-folder whose page loads a state script: a container and its items.
    for f in live.files:
        if posixpath.basename(f) != "index.html" or f in served:
            continue
        reader = read_page(live.root / f)
        for src in reader.scripts:
            script = target(f, src)
            if not script or not (live.root / script).is_file():
                continue
            state = read_state(live.root / script)
            items = state.get("items") if state else None
            if not (state and isinstance(state.get("global"), str) and isinstance(items, dict) and items
                    and all(isinstance(v, dict) and isinstance(v.get("title"), str) for v in items.values())):
                continue
            served.add(f)
            _state_container(c, live.root, f, script, state, reader, copy_page, vault_rel, served, groups)
            break

    # Every other page of a kept folder: a supplied prop, copied with its files.
    for k in live.kept:
        for address in live.pages(f"{k}/"):
            if address in served:
                continue
            reader = read_page(live.root / address)
            if not copy_page(address):
                continue
            dest = vault_rel(address)
            assert dest is not None
            served.add(address)
            title = short_title(reader.title) or posixpath.splitext(posixpath.basename(address))[0]
            rel = _note_path(c, posixpath.dirname(dest), clean_stem(title, posixpath.splitext(posixpath.basename(address))[0]))
            if rel is None:
                continue
            _prop_note(c, rel, [("name", quoted(title)), ("prop_kind", "supplied"),
                                ("prop_file", quoted(posixpath.basename(address))),
                                ("prop_address", quoted(address)), ("prop_title", quoted(title)),
                                ("prop_group", quoted(groups.get(k, "")))])
            c.publish.append(rel)
            if address == f"{k}/index.html" and "player_site.props.cover" not in c.inferred_settings:
                c.inferred_settings["player_site.props.title"] = title
                c.inferred_settings["player_site.props.cover"] = f"[[{Path(rel).stem}]]"
            # Its player maps (SVG pictures) are props of their own.
            for src, alt in reader.imgs:
                svg = target(address, src)
                if not svg or not svg.lower().endswith(".svg") or svg in served or not (live.root / svg).is_file():
                    continue
                served.add(svg)
                svg_rel = vault_rel(svg)
                if svg_rel is None or not _copy(c, svg_rel, live.root / svg, svg):
                    continue
                page_dir = posixpath.dirname(dest)
                inside = svg_rel.startswith(f"{page_dir}/")
                note_dir = page_dir if inside else posixpath.dirname(svg_rel)
                stem = posixpath.splitext(posixpath.basename(svg))[0]
                name = short_title(alt) or stem
                note = _note_path(c, note_dir, clean_stem(name, stem))
                if note is None:
                    continue
                _prop_note(c, note, [("name", quoted(name)), ("prop_kind", "supplied"),
                                     ("prop_file", quoted(posixpath.relpath(svg_rel, note_dir))),
                                     ("prop_address", quoted(svg)), ("prop_title", quoted(name)),
                                     ("prop_group", quoted(groups.get(k, "")))])
                c.publish.append(note)

    # A kept folder retires only when the vault serves every page in it.
    keep_done = [k for k in live.kept if all(p in served for p in live.pages(f"{k}/"))]
    for k in live.kept:
        left = [p for p in live.pages(f"{k}/") if p not in served]
        if left:
            c.row(PERSON, f"{k}/", f"kept: {len(left)} pages the move does not serve "
                  f"({', '.join(left[:5])}{' …' if len(left) > 5 else ''})")
    retire = c.decisions["retire"]
    if not (given and "retire" in given):
        retire["keep"] = keep_done


def _state_container(c: Conversion, root: Path, index: str, script: str, state: dict[str, Any],
                     reader: PageReader, copy_page: Any, vault_rel: Any,
                     served: set[str], groups: dict[str, str]) -> None:
    """A kept sub-folder whose page reads a state script: a container note
    for the page, an item note per entry, every item published."""
    dest = vault_rel(index)
    if dest is None or not copy_page(index):
        return
    folder = posixpath.dirname(dest)
    sub = posixpath.dirname(index)
    k = index.split("/", 1)[0]
    script_rel = vault_rel(script)
    if script_rel:
        _copy(c, script_rel, root / script, script)
    title = short_title(reader.title) or posixpath.basename(sub)
    box = clean_stem(title, posixpath.basename(sub))
    rel = _note_path(c, folder, box)
    if rel is None:
        return
    box = Path(rel).stem
    _prop_note(c, rel, [("name", quoted(title)), ("prop_kind", "container"),
                        ("prop_file", quoted("index.html")),
                        ("prop_state", quoted(posixpath.relpath(script, sub))),
                        ("prop_state_global", quoted(state["global"])),
                        ("prop_address", quoted(index)), ("show_sealed", "none"),
                        ("prop_group", quoted(groups.get(k, "")))])
    c.publish.append(rel)
    c.states.append(script)
    # The fields the publish tool reads off a prop itself, which a state file never gives back to an item (its answer).
    reads = state.get("tool_fields")
    if not isinstance(reads, list):
        raise StepFailed("props read-state does not name the fields the tool reads; the publish tool is older than this script")
    for key, entry in state["items"].items():
        name = str(entry["title"])
        href = entry.get("href")
        fields = [("name", quoted(name)),
                  ("prop_kind", "document" if isinstance(href, str) and href else "object"),
                  ("prop_container", quoted(f"[[{box}]]")), ("prop_title", quoted(name)),
                  ("prop_line", quoted(str(entry.get("line") or "")))]
        if isinstance(href, str) and href:
            address = target(index, href)
            if address and (root / address).is_file():
                copy_page(address)
                served.add(address)
                fields += [("prop_file", quoted(href)), ("prop_address", quoted(address))]
        for k2, value in entry.items():
            if k2 in ("title", "line", "href", "sealed"):
                continue
            yaml = field_value(value)
            if yaml is None or not re.fullmatch(r"[A-Za-z0-9_]+", k2):
                c.row(PERSON, rel, f"{key}: field {k2!r} not carried over")
                continue
            if f"prop_{k2}" in reads:
                c.row(PERSON, rel, f"{key}: field {k2!r} not carried over: the publish tool reads prop_{k2} "
                      f"itself and never gives it back to the shelf's script (rename it in the script and the "
                      f"state file, then carry it over by hand)")
                continue
            fields.append((f"prop_{k2}", yaml))
            # A picture the entry names comes into the vault beside its page.
            if isinstance(value, str) and not EXTERNAL_RE.match(value):
                pic = target(index, value)
                pic_rel = vault_rel(pic) if pic else None
                if pic and pic_rel and (root / pic).is_file() and not pic.lower().endswith(PAGE_EXTS):
                    _copy(c, pic_rel, root / pic, pic)
        item = _note_path(c, folder, clean_stem(name, key))
        if item is None:
            continue
        _prop_note(c, item, fields)
        c.publish.append(item)


def new_conversion(vault: Path) -> Conversion:
    return Conversion(vault=vault, batch=vault_write.Batch(vault))


def _setting(s: Any, name: str, default: Any) -> Any:
    try:
        value = s.get(name)
    except KeyError:
        return default
    return default if value is None else value


def convert(vault: Path, *, site: Path | None = None, given: dict[str, Any] | None = None) -> Conversion:
    """Everything the move would do to `vault`, worked out without writing.
    `site` is the site folder whose output holds what is live; `given`, the
    decisions file, overrides what is inferred, key by key."""
    c = new_conversion(vault)
    convert_build_props(c)
    keep: list[str] = []
    steps: list[str] = []
    props_address = DEFAULT_PROPS_ADDRESS
    output = "docs"
    try:
        s = settings(vault)
    except SettingsUnavailable as e:
        raise StepFailed(str(e)) from e
    keep = [str(k) for k in _setting(s, "player_site.keep", []) or []]
    steps = [str(x) for x in _setting(s, "player_site.after_build", []) or []]
    output = str(_setting(s, "player_site.output", "docs") or "docs")
    props_address = str(_setting(s, PROPS_ADDRESS, "") or DEFAULT_PROPS_ADDRESS)
    given_settings = (given or {}).get("settings") or {}
    props_address = str(given_settings.get(PROPS_ADDRESS) or props_address)
    c.live_root = (site / output) if site else None
    convert_kept(c, site, c.live_root, keep, steps, props_address, given)
    if given and "settings" in given:
        c.decisions["settings"] = dict(given["settings"])
    else:
        c.decisions["settings"] = dict(c.inferred_settings)
    have = c.decisions["settings"]
    retire = c.decisions["retire"]
    known = []
    for command in retire.get("after_build") or []:
        found = step_script(str(command))
        if found and found[1] in KNOWN_STEPS:
            known.append(str(command))
        else:
            c.row(PERSON, str(command), "not retired: not a prop step the move knows; "
                  "it stays in player_site.after_build")
    # Only what the check compares retires: a kept folder or a step whose folder is not served is never checked.
    served = {x if str(x).endswith("/") else f"{x}/" for x in c.decisions.get("serves") or []}
    checked = []
    for command in known:
        found = step_script(command)
        need = KNOWN_STEPS[found[1]]["serves"] if found else []
        if all(x in served for x in need):
            checked.append(command)
        else:
            c.row(PERSON, command, f"not retired: the check does not compare {', '.join(need)} "
                  "(add it to serves, or keep the step)")
    retire["after_build"] = checked
    keep = []
    for k in [str(k) for k in retire.get("keep") or []]:
        if f"{k.strip('/')}/" in served:
            keep.append(k)
        else:
            c.row(PERSON, f"{k}/", "not retired: the check does not compare this kept folder "
                  "(add it to serves, or keep the folder)")
    retire["keep"] = keep
    names = [found[1] for found in map(step_script, known) if found]
    if "inject-gazetteer" in names and not all(b in have for b in BANNER):
        c.row(PERSON, "player_site.landing.banner", "inject-gazetteer.js writes a box on the "
              "landing page; write its heading, words and link (gazetteer/index.html) as "
              f"{', '.join(BANNER)} in the decisions file")
    c.decisions = {"version": 1, **{k: c.decisions[k] for k in DECISION_KEYS if k in c.decisions}}
    return c


# --- 15c: writing, checking, retiring, putting back ------------------------------

KEEP = "player_site.keep"
PAGE_EDITS = ("merged with", "Keeper lines")     # sources of a page edited in place
# What a vault copy for the plan holds: notes, pictures and pages (never
# audio or video), plus every file under _meta/ and in each Props/ folder.
COPY_EXTS = frozenset({".md", ".html", ".htm", ".css", ".js", ".png", ".jpg", ".jpeg",
                       ".gif", ".webp", ".svg", ".avif", ".pdf"})


class Stopped(KeyboardInterrupt):
    """The move was told to stop (SIGTERM, SIGHUP): it puts the vault back as
    it does on Ctrl-C."""


def _stop(signum: int, _frame: Any) -> None:
    # One stop is enough: a second signal must not cut the put-back short.
    for sig in STOP_SIGNALS:
        signal.signal(sig, signal.SIG_IGN)
    raise Stopped(f"the move was stopped by {signal.Signals(signum).name}")


STOP_SIGNALS = tuple(s for s in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGHUP", None)) if s is not None)


class Blocked(StepFailed):
    """move-check found a served page the vault alone does not reproduce."""


def _write_bytes(path: Path, data: bytes) -> None:
    """Write `data` to `path` exactly, swapped in so a failure partway leaves
    the file as it was."""
    try:
        mode = path.stat().st_mode & 0o7777
    except FileNotFoundError:
        umask = os.umask(0)
        os.umask(umask)
        mode = 0o666 & ~umask
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class Journal:
    """Every vault file the move writes or creates, with its bytes before; the
    tool's own writes to `_meta/` (the settings, the publish list) are watched
    the same way. `restore` puts all of it back and says what would not go."""

    def __init__(self, vault: Path) -> None:
        self.vault = vault
        self.saved: dict[str, bytes | None] = {}
        self.made: list[Path] = []
        self.meta: set[str] = set()

    def record(self, rel: str) -> None:
        if rel not in self.saved:
            path = self.vault / rel
            self.saved[rel] = path.read_bytes() if path.is_file() else None

    def watch_meta(self) -> None:
        meta = self.vault / "_meta"
        for p in sorted(meta.iterdir()) if meta.is_dir() else []:
            if p.is_file():
                rel = f"_meta/{p.name}"
                self.meta.add(rel)
                self.record(rel)

    def write(self, rel: str, data: bytes) -> None:
        self.record(rel)
        path = self.vault / rel
        missing = []
        folder = path.parent
        while not folder.exists():
            missing.append(folder)
            folder = folder.parent
        for f in reversed(missing):
            f.mkdir()
            self.made.append(f)
        _write_bytes(path, data)

    def restore(self) -> list[str]:
        """Put every recorded file back and remove what the run created;
        then read each one again. The files that are not as they were."""
        for rel, data in self.saved.items():
            path = self.vault / rel
            try:
                if data is None:
                    path.unlink(missing_ok=True)
                elif not path.is_file() or path.read_bytes() != data:
                    _write_bytes(path, data)
            except OSError:
                pass
        meta = self.vault / "_meta"
        for p in sorted(meta.iterdir()) if meta.is_dir() else []:
            rel = f"_meta/{p.name}"
            if p.is_file() and rel not in self.meta and rel not in self.saved:
                try:
                    p.unlink()      # made by the tool during the run
                except OSError:
                    pass
        for folder in reversed(self.made):
            try:
                folder.rmdir()
            except OSError:
                pass
        forget_settings(self.vault)
        stuck = []
        for rel, data in self.saved.items():
            path = self.vault / rel
            now = path.read_bytes() if path.is_file() else None
            if now != data:
                stuck.append(rel)
        stuck += [f.relative_to(self.vault).as_posix() + "/" for f in self.made if f.exists()]
        return sorted(stuck)


def write_conversion(c: Conversion, journal: Journal) -> None:
    """Write every note and file of the conversion into `c.vault`, each one
    first checked to be as the conversion read it."""
    for rel in sorted(c.batch.changed()):
        before = c.batch.originals.get(rel)
        path = c.vault / rel
        now = read_text(path) if path.is_file() else None
        if now != before:
            raise StepFailed(f"{rel} changed while the move was being worked out; run it again")
    for rel in sorted(c.batch.changed()):
        journal.write(rel, c.batch.texts[rel].encode("utf-8"))
    for rel in sorted(c.files):
        journal.write(rel, c.files[rel])


def move_check(config: Path, decisions: dict[str, Any], keep: Path | None = None) -> dict[str, Any]:
    """`gm-publish props move-check` on the site at `config`: {rows, blockers}.
    `keep`: a new folder the check's build is left in. Raises StepFailed
    when the tool gives no answer."""
    args = ["props", "move-check", "--config", str(config), "--json"]
    if keep is not None:
        args += ["--keep-build", str(keep)]
    for prefix in decisions.get("serves") or []:
        args += ["--serves", str(prefix)]
    for address in decisions.get("listings") or {}:
        args += ["--listing", str(address)]
    for phrase in decisions.get("expect_gone") or []:
        args += ["--expect-gone", str(phrase)]
    _code, out, err = plugin_tool(args)
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("rows"), list) \
            or not isinstance(data.get("blockers"), int):
        said = [ln.strip() for ln in err.splitlines() if ln.strip().startswith("Error:")]
        raise StepFailed(f"move-check gave no answer: {said[-1] if said else 'no reason given'}")
    return data


def _state_differences(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    """What the made state file changes of the live one: an entry or a field
    gone, added or with another value. Order is no difference, nor the
    tool's own `sealed: false` and an `href` it adds, nor a null field the
    made file leaves out (the tool writes no empty value; a script reads
    both as nothing)."""
    out = []
    if old.get("global") != new.get("global"):
        out.append(f"window.{old.get('global')} is now window.{new.get('global')}")
    a, b = old.get("items") or {}, new.get("items") or {}
    out += [f"{k} gone" for k in a if k not in b] + [f"{k} added" for k in b if k not in a]
    for k in (k for k in a if k in b):
        x, y = a[k], b[k]
        if not (isinstance(x, dict) and isinstance(y, dict)):
            if x != y:
                out.append(f"{k} changed")
            continue
        out += [f"{k}.{f} gone" if f not in y else f"{k}.{f} changed" for f in x
                if y.get(f, object()) != x[f] and not (x[f] is None and f not in y)]
        out += [f"{k}.{f} added" for f in y if f not in x
                and not (f == "sealed" and y[f] is False) and f != "href"]
    return out


def state_rows(c: Conversion, build: Path) -> list[str]:
    """A CHECK row (a blocker) for each live state file the made one does not
    match entry for entry and value for value, both read by `props read-state`."""
    rows = []
    for address in c.states:
        old = read_state(c.live_root / address) if c.live_root else None
        new = read_state(build / address)
        if old is None:
            continue
        if new is None:
            said = ["the new build has no state file the tool can read here"]
        else:
            said = _state_differences(old, new)
        if said:
            more = f" and {len(said) - 8} more" if len(said) > 8 else ""
            rows.append(f"CHECK\t{address}\tSTATE-DIFFERS: {', '.join(said[:8])}{more}; "
                        f"the shelf's script would read other values")
    return rows


def check_rows(data: dict[str, Any]) -> list[str]:
    return [f"CHECK\t{r.get('address', '')}\t{str(r.get('kind', '')).upper()}: {r.get('detail', '')}"
            for r in data["rows"] if isinstance(r, dict)]


def _publish(vault: Path, paths: list[str]) -> None:
    if not paths:
        return
    done, why = apply_publish(vault, paths)
    if why:
        raise StepFailed(f"publish failed: {why}")
    left = [p for p in paths if p not in done]
    if left:
        raise StepFailed(f"the publish tool does not list these as publishing: {', '.join(left)}")


def _settings(c: Conversion) -> list[tuple[str, object]]:
    return [(str(k), v) for k, v in (c.decisions.get("settings") or {}).items()]


def plan_rows(c: Conversion, done: bool = False) -> list[str]:
    """One row per note, file, publish, setting and retirement."""
    verb = (lambda a, b: b if done else f"WOULD-{a}")
    rows = []
    for rel in sorted(c.batch.changed()):
        created = c.batch.originals.get(rel) is None
        rows.append(f"{verb('CREATE', 'CREATED') if created else verb('EDIT', 'EDITED')}\t{rel}\t")
    for rel in sorted(c.files):
        edited = c.sources.get(rel, "").startswith(PAGE_EDITS)
        rows.append(f"{verb('EDIT', 'EDITED') if edited else verb('COPY', 'COPIED')}\t{rel}\t{c.sources.get(rel, '')}")
    rows += [f"{verb('PUBLISH', 'PUBLISHED')}\t{rel}\t" for rel in c.publish]
    rows += [f"{verb('SET', 'SET')}\t{name}\t{json.dumps(value, ensure_ascii=False)}"
             for name, value in _settings(c)]
    retire = c.decisions.get("retire") or {}
    rows += [f"{verb('RETIRE', 'RETIRED')}\t{KEEP}\t{k}" for k in retire.get("keep") or []]
    rows += [f"{verb('RETIRE', 'RETIRED')}\t{AFTER_BUILD}\t{x}" for x in retire.get("after_build") or []]
    return rows


def counts(c: Conversion, blockers: int) -> dict[str, int]:
    retire = c.decisions.get("retire") or {}
    notes = [r for r in c.batch.changed() if r.endswith(".md")]
    return {"notes": len(notes), "files": len(c.files) + (len(c.batch.changed()) - len(notes)),
            "publish": len(c.publish),
            "retire": len(retire.get("keep") or []) + len(retire.get("after_build") or []),
            "blockers": blockers}


def totals(n: dict[str, int]) -> str:
    return (f"# notes: {n['notes']} files: {n['files']} publish: {n['publish']} "
            f"retire: {n['retire']} blockers: {n['blockers']}")


def _site_of(vault: Path) -> tuple[Path | None, Path | None, str]:
    """(the site folder, its output folder, why the move cannot check)."""
    site, has_config = configured_site(vault)
    if site is None:
        return None, None, "the vault has no site to check against"
    if not has_config:
        return site, None, f"no vault.config.json in {site}"
    output = str(_setting(settings(vault), "player_site.output", "docs") or "docs")
    live = site / output
    if not live.is_dir():
        return site, None, f"the site's output folder is not there ({live}); build or deploy it first"
    return site, live, ""


def _copy_vault(vault: Path, to: Path) -> None:
    """The vault's notes, pictures and pages, every file under _meta/ and in
    each Props/ folder: what the conversion and the build read."""
    for p in sorted(vault.rglob("*")):
        rel = p.relative_to(vault)
        parts = rel.parts
        if not p.is_file() or any(x.startswith(".") for x in parts):
            continue
        if parts[0] == "_meta" or "Props" in parts[:-1] or p.suffix.lower() in COPY_EXTS:
            dest = to / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dest)


def leak_findings(config: Path) -> set[tuple[str, str]]:
    """The leak check's findings on a site as it stands (`leaks list`), as
    (page, sentence): what is there before the move is not the move's."""
    code, out, err = plugin_tool(["leaks", "list", "--config", str(config), "--json"])
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if code != 0 or not isinstance(data, dict) or data.get("missing") or not isinstance(data.get("findings", []), list):
        said = [ln.strip() for ln in err.splitlines() if ln.strip()]
        raise StepFailed(f"the leak check could not read the live site: {said[-1] if said else f'exit {code}'}")
    return {(str(f.get("page")), str(f.get("text"))) for f in data.get("findings") or [] if isinstance(f, dict)}


def new_leaks(data: dict[str, Any], before: set[tuple[str, str]]) -> list[str]:
    """A CHECK row for each leak finding on move-check's new build that the
    live site did not have: each is a blocker."""
    leaks = data.get("leaks")
    if not isinstance(leaks, list):
        raise StepFailed("move-check did not run the leak check on its build; the publish tool is older than this script")
    rows = []
    for f in leaks:
        if not isinstance(f, dict) or (str(f.get("page")), str(f.get("text"))) in before:
            continue
        why = f" ({f['reason']})" if f.get("reason") else ""
        rows.append(f"CHECK\t{f.get('page')}\tLEAK: \"{f.get('text')}\" from {f.get('note') or 'a hidden note'}"
                    f"{why}; the live site does not show it")
    return rows


def run_plan(vault: Path, given: dict[str, Any] | None) -> tuple[list[str], Conversion | None, int]:
    """Work the move out and check it on a copy of the vault; nothing in the
    vault or the site is written. (rows, the conversion, blockers)."""
    site, live, why = _site_of(vault)
    tmp = Path(tempfile.mkdtemp(prefix="prop-move-"))
    copy = tmp / "vault"
    try:
        _copy_vault(vault, copy)
        forget_settings(copy)
        # The copy never names the real site: its site is a stand-in folder
        # whose vault.config.json names the copy.
        stand_in = tmp / "site"
        stand_in.mkdir()
        (stand_in / "vault.config.json").write_text(json.dumps({"vaultPath": str(copy)}), encoding="utf-8")
        if site:
            pairs: list[tuple[str, object]] = [("player_site.folder", str(stand_in))]
            if _setting(settings(copy), "gm_site.folder", None):
                pairs.append(("gm_site.folder", str(tmp / "gm-site")))
            _set_settings(copy, pairs)
        before: set[tuple[str, str]] = set()
        if site and live:
            # The live output, whole, beside the copy as it was: the leak check's findings before the move.
            shutil.copytree(live, stand_in / live.relative_to(site), symlinks=True)
            before = leak_findings(stand_in / "vault.config.json")
        c = convert(copy, site=site if live else None, given=given)
        rows = plan_rows(c) + c.rows
        blockers = 0
        if not live or not c.decisions.get("serves"):
            if c.batch.changed() or c.files:
                rows.append(f"{PERSON}\t-\tthe move cannot be checked: "
                            f"{why or 'nothing the live site serves is moved'}")
            return rows, c, 0
        write_conversion(c, Journal(copy))
        _publish(copy, c.publish)
        if _settings(c):
            _set_settings(copy, _settings(c))
        data = move_check(stand_in / "vault.config.json", c.decisions, tmp / "build")
        leaks = new_leaks(data, before)
        states = state_rows(c, tmp / "build")
        rows += check_rows(data) + leaks + states
        blockers = data["blockers"] + len(leaks) + len(states)
        return rows, c, blockers
    finally:
        forget_settings(copy)
        shutil.rmtree(tmp, ignore_errors=True)


def run_apply(vault: Path, given: dict[str, Any] | None) -> tuple[list[str], int]:
    """The move on the vault itself: write, publish, set, check; on a blocker
    or any failure, everything is put back. Then retire, prune, log."""
    site, live, why = _site_of(vault)
    if not site or not live:
        return [f"ERROR\t-\tnothing changed: {why}"], 1
    c = convert(vault, site=site, given=given)
    if not c.decisions.get("serves"):
        if c.batch.changed() or c.files:
            return [*c.rows, "ERROR\t-\tnothing changed: nothing the live site serves is "
                    "moved, so the move cannot be checked"], 1
        return [*c.rows, "# nothing to move"], 0
    config = site / "vault.config.json"
    journal = Journal(vault)
    rows: list[str] = []
    blockers = 0
    # The build move-check makes, kept until the end: its state files are compared, and an accept it still needs stays.
    checked = Path(tempfile.mkdtemp(prefix="prop-move-check-"))
    try:
        before = leak_findings(config)
        journal.watch_meta()
        write_conversion(c, journal)
        _publish(vault, c.publish)
        if _settings(c):
            _set_settings(vault, _settings(c))
        data = move_check(config, c.decisions, checked / "build")
        leaks = new_leaks(data, before)
        states = state_rows(c, checked / "build")
        rows += check_rows(data) + leaks + states
        blockers = data["blockers"] + len(leaks) + len(states)
        if blockers:
            raise Blocked(f"move-check found {blockers} blocker{'' if blockers == 1 else 's'}")
        retire = c.decisions.get("retire") or {}
        if retire.get("keep"):
            settings_remove(vault, KEEP, list(retire["keep"]))
        if retire.get("after_build"):
            settings_remove(vault, AFTER_BUILD, list(retire["after_build"]))
        code, out, err = plugin_tool(["leaks", "prune", "--config", str(config), "--also", str(checked / "build"), "--json"])
        try:
            pruned = json.loads(out).get("pruned") if code == 0 else None
        except (ValueError, AttributeError):
            pruned = None
        if not isinstance(pruned, int):
            lines = [ln.strip() for ln in err.splitlines() if ln.strip()]
            raise StepFailed(f"leaks prune failed: {lines[-1] if lines else f'exit {code}'}")
        logged = False
        if not (vault / LOG).is_file():
            journal.record(LOG)
            _write_log(vault, _load_log(vault))
            logged = True
    except (Exception, KeyboardInterrupt) as e:
        stuck = journal.restore()
        said = str(e) or type(e).__name__
        if isinstance(e, SettingsUnavailable):
            said = f"the settings could not be written: {said}"
        rows.append(f"ERROR\t-\t{said}; " + (
            f"these could not be put back: {', '.join(stuck)}" if stuck else "the vault is as it was"))
        rows.append(totals(counts(c, blockers)))
        return [*c.rows, *rows], 1
    finally:
        shutil.rmtree(checked, ignore_errors=True)
    rows = plan_rows(c, done=True) + [r.replace("WOULD-WRAP\t", "WRAPPED\t", 1) for r in c.rows] + rows
    rows.append(f"PRUNED\t_meta/publish-list.yaml\t{pruned} accepted finding"
                f"{'' if pruned == 1 else 's'} the leak check no longer needs")
    if logged:
        rows.append(f"LOGGED\t{LOG}\tcreated with its before-tracking entry")
    rows.append(totals(counts(c, 0)))
    return rows, 0


# --- the command line ------------------------------------------------------------

def _load_decisions(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ValueError(f"{path} cannot be read as JSON ({e.__class__.__name__})") from e
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError(f"{path} is not a version 1 decisions file")
    return data


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="prop_move.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    ap.add_argument("mode", choices=("plan", "apply"))
    ap.add_argument("--decisions", type=Path, metavar="FILE")
    ap.add_argument("--draft", type=Path, metavar="OUT")
    ap.add_argument("--json", type=Path, metavar="OUT", dest="json_out")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return int(e.code) if isinstance(e.code, int) else 2
    if not args.vault.is_dir():
        print(f"prop_move.py: error: {args.vault} is not a folder", file=sys.stderr)
        return 2
    if args.mode == "apply" and (args.draft or args.json_out):
        print("prop_move.py: error: --draft and --json are for plan", file=sys.stderr)
        return 2
    try:
        given = _load_decisions(args.decisions) if args.decisions else None
    except ValueError as e:
        print(f"prop_move.py: error: {e}", file=sys.stderr)
        return 2
    vault = args.vault.resolve()
    try:
        if args.mode == "apply":
            # A kill (the update stopping, a closed terminal) takes the same put-back path as Ctrl-C.
            kept = {sig: signal.signal(sig, _stop) for sig in STOP_SIGNALS}
            try:
                rows, code = run_apply(vault, given)
            finally:
                for sig, handler in kept.items():
                    signal.signal(sig, handler)
            print("\n".join(rows))
            return code
        rows, c, blockers = run_plan(vault, given)
    except (StepFailed, SettingsUnavailable, PublishToolUnavailable, WriteError) as e:
        print(f"ERROR\t-\t{e}")
        return 1
    assert c is not None
    n = counts(c, blockers)
    rows.append(totals(n))
    print("\n".join(rows))
    if args.draft:
        _write_json(args.draft, c.decisions)
    if args.json_out:
        _write_json(args.json_out, {"rows": rows[:-1], "counts": n, "decisions": c.decisions})
    return 0


if __name__ == "__main__":
    sys.exit(main())

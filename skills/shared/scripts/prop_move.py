#!/usr/bin/env python3
"""prop_move.py: move a vault's own props into prop notes.

Two layouts are read: notes a site script builds props from (`prop:` and
`prop_look:` in the frontmatter, the build_props layout), and hand-made
prop pages in a chapter's `Props/` folder with copies kept in the site's
output by hand (`player_site.keep`).

A build_props note becomes a `type: prop` note in place: its look is its
`prop_style`, its page lives where it did (`props/<page>`), its blurb is its
`prop_line`, its hand is a hand in `_meta/prop-hands.json` (the family read
from the build's stylesheet), and the section holding the prop's lines
becomes `## The Text`, with the description above it. Nothing else on the
note changes.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vault_write  # noqa: E402
from vault_write import HAND_ID_RE, HANDS_REL, Batch, WriteError, use_hand  # noqa: E402
from vaultlib import frontmatter_span, is_skipped_path, scalar_value, yaml_scalar  # noqa: E402

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


def new_conversion(vault: Path) -> Conversion:
    return Conversion(vault=vault, batch=vault_write.Batch(vault))


def convert(vault: Path) -> Conversion:
    """Everything the move would do to `vault`, worked out without writing."""
    c = new_conversion(vault)
    convert_build_props(c)
    return c


def written_rows(c: Conversion, verb_prefix: str = "WOULD-") -> list[str]:
    """One row per note and file the conversion writes."""
    rows = []
    for rel in sorted(c.batch.changed()):
        created = c.batch.originals.get(rel) is None
        rows.append(f"{verb_prefix}{'CREATE' if created else 'EDIT'}\t{rel}\t")
    return rows

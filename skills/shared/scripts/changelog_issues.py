#!/usr/bin/env python3
"""changelog_issues.py: which release shipped each GitHub issue.

Read offline from the plugin's own CHANGELOG.md. Only released sections
(`## [x.y.z]`) count; `[Unreleased]` and anything else is skipped. Within
a release only its intro paragraphs and its change subsections (Added,
Changed, Fixed, Removed, Security, Deprecated) are read: Follow-ups,
Testing, Note and the like name issues filed, not fixed. Every `#N` in
those entries is an issue the release ships. An issue cited in more
than one release maps to the highest: the last is when the fix was
complete. Library module, no CLI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from vaultlib import parse_version

# skills/shared/scripts/ -> the plugin root, where CHANGELOG.md sits. A skill
# zip install has none.
CHANGELOG = Path(__file__).resolve().parents[3] / "CHANGELOG.md"

_RELEASE = re.compile(r"^## \[(\d+(?:\.\d+)*)\]")
_HEADING = re.compile(r"^#{1,6} ")
_BULLET = re.compile(r"^\s*[-*] ")
_ISSUE = re.compile(r"#(\d+)\b")
_SUBSECTION = re.compile(r"^### +(\w+)")
# A `### ` subsection is read when its title's first word is one of these
# ("Fixed (publish tool)" counts as Fixed).
SHIPPED = ("Added", "Changed", "Fixed", "Removed", "Security", "Deprecated")


@dataclass
class ReleaseNote:
    release: str
    lines: list[str] = field(default_factory=list)   # the entries citing it


def _entries(body: list[str]) -> list[str]:
    """A section's entries, one string each: a bullet with its wrapped
    lines, or a paragraph. Wrapped lines are joined by one space."""
    out: list[str] = []
    open_ = False
    for raw in body:
        line = raw.rstrip()
        if not line.strip() or _HEADING.match(line) or line.strip() == "---":
            open_ = False
            continue
        if _BULLET.match(line) or not open_:
            out.append(line.strip())
            open_ = True
        else:
            out[-1] = f"{out[-1]} {line.strip()}"
    return out


def issue_releases(changelog: str) -> dict[int, ReleaseNote]:
    """Each issue a released section cites, mapped to the highest release
    citing it and that release's entries that cite it."""
    sections: list[tuple[str, list[str]]] = []
    current: list[str] | None = None
    reading = True
    for line in changelog.splitlines():
        if line.startswith("## "):
            m = _RELEASE.match(line)
            current = None
            if m:
                current, reading = [], True   # the intro is read
                sections.append((m.group(1), current))
        elif current is not None:
            sub = _SUBSECTION.match(line)
            if sub:
                reading = sub.group(1) in SHIPPED
                current.append(line)   # a heading ends the entry before it
            elif reading:
                current.append(line)
    found: dict[int, ReleaseNote] = {}
    for release, body in sections:
        here: dict[int, list[str]] = {}
        for entry in _entries(body):
            for n in dict.fromkeys(int(x) for x in _ISSUE.findall(entry)):
                here.setdefault(n, []).append(entry)
        for n, lines in here.items():
            old = found.get(n)
            if old is None or parse_version(release) > parse_version(old.release):
                found[n] = ReleaseNote(release, lines)
    return found


def plugin_releases(path: Path | None = None) -> dict[int, ReleaseNote] | None:
    """issue_releases over the plugin's CHANGELOG; None when it cannot be
    read (a skill zip install ships without it)."""
    try:
        text = (path or CHANGELOG).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    return issue_releases(text)

#!/usr/bin/env python3
"""Write the release notes for a publish-tool release (publish-vX.Y.Z).

The notes list the commits that touched tools/publish since the previous
tool tag, then the CHANGELOG.md entry of every plugin release those commits
shipped in. CHANGELOG.md stays the one place a change is written up; the
tool's release only copies the entries, so an outside project moving its
pin reads what changed where it already looks.

Usage: publish_release_notes.py VERSION [PREV_TAG] > notes.md
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HEADING = re.compile(r"^## \[([^\]]+)\]")


def git(*args: str, cwd: Path) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout


def changelog_entries(text: str) -> dict[str, str]:
    """Each `## [version]` section of the changelog, keyed by version,
    without its trailing `---` rule."""
    entries: dict[str, str] = {}
    current: str | None = None
    lines: list[str] = []
    for line in text.splitlines() + ["## [end]"]:
        found = HEADING.match(line)
        if found:
            if current is not None:
                body = "\n".join(lines).strip()
                entries[current] = re.sub(r"\n-{3,}\s*$", "", body).strip()
            current, lines = found.group(1), [line]
        elif current is not None:
            lines.append(line)
    return entries


def demote(entry: str) -> str:
    """Push every heading of an entry one level down, under the notes' own."""
    return re.sub(r"(?m)^(#{2,5}) ", r"#\1 ", entry)


def plugin_version_at(sha: str, cwd: Path) -> str | None:
    try:
        raw = git("show", f"{sha}:.claude-plugin/plugin.json", cwd=cwd)
    except subprocess.CalledProcessError:
        return None
    return json.loads(raw).get("version") or None


def notes(version: str, prev: str | None, cwd: Path) -> str:
    out = [f"Publish tool {version}, packed with `npm pack`.", "",
           "Pin with the attached .tgz and verify it with `SHA256SUMS`.", "",
           "## Changes to tools/publish", ""]
    if not prev:
        out.append("Initial tagged release.")
        return "\n".join(out) + "\n"
    log = git("log", "--no-merges", "--format=%H%x09%h%x09%s",
              f"{prev}..HEAD", "--", "tools/publish", cwd=cwd)
    commits = [line.split("\t", 2) for line in log.splitlines() if line]
    out += [f"Since `{prev}`:", ""]
    out += [f"- {subject} ({short})" for _sha, short, subject in commits]
    versions: list[str] = []
    for sha, _short, _subject in commits:
        found = plugin_version_at(sha, cwd)
        if found and found not in versions:
            versions.append(found)
    entries = changelog_entries((cwd / "CHANGELOG.md").read_text(encoding="utf-8"))
    shown = [v for v in versions if v in entries]
    if shown:
        out += ["", "## What changed", "",
                "The CHANGELOG entry of each plugin release above, newest first.", ""]
        for v in shown:
            out += [demote(entries[v]), ""]
    return "\n".join(out).rstrip() + "\n"


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    version = argv[1]
    prev = argv[2] if len(argv) == 3 and argv[2] else None
    root = Path(git("rev-parse", "--show-toplevel", cwd=Path.cwd()).strip())
    sys.stdout.write(notes(version, prev, root))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

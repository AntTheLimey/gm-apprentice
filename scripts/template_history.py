#!/usr/bin/env python3
"""template_history.py: regenerate skills/shared/template-history.json.

    python3 scripts/template_history.py

For the working tree and every git tag from v1.4.22 on (the first with the
shared templates), builds the templates a vault of each system would have
been given (the migration's own `templates_for`) and records a hash of each
text, keyed by system ("generic" for none), then by vault filename.
migrate.py upgrades an untouched `_Templates/` file whose text is in its own
system's list as Will do instead of asking. Run this whenever a template under
skills/shared/templates/ changes; a test fails until you do.

Each hash records the last release that wrote that text (null while the
working tree still writes it). A hash whose last release is older than the
oldest vault migrate.py migrates from (its FLOOR) is dropped: no supported
migration can meet a vault that got that text from a release that old. The
file is rebuilt whole from the tags and the working tree, so a hash nothing
here can trace is not kept either.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

from migrate import FLOOR  # noqa: E402
from migrate_vault import GENERIC, HISTORY, TEMPLATES, templates_for, text_hash  # noqa: E402
from vaultlib import parse_version  # noqa: E402

FIRST_TAG = (1, 4, 22)   # the first tag with skills/shared/templates/
SUBPATH = "skills/shared/templates"


def systems_in(source: Path) -> set[str | None]:
    """None (generic) and every system a template folder names."""
    found: set[str | None] = {None, "coc-7e-regency"}
    for path in source.glob("pc-*.md"):
        found.add(path.stem.removeprefix("pc-"))
    for path in source.glob("*-stats/*.md"):
        found.add(path.stem)
    found.discard("generic")
    return found


# system -> filename -> {hash: last release that wrote it, or None while the
# working tree still does}
History = dict[str, dict[str, dict[str, str | None]]]
Seen = dict[str, dict[str, set[str]]]


def collect(source: Path, into: Seen) -> None:
    for system in systems_in(source):
        names = into.setdefault(system or GENERIC, {})
        for name, text in templates_for(system, source, skip_missing=True).items():
            names.setdefault(name, set()).add(text_hash(text))


def release_tags() -> list[str]:
    out = subprocess.run(["git", "tag", "-l", "v*"], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout.split()
    keep = []
    for tag in out:
        m = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", tag)
        if m and tuple(int(g) for g in m.groups()) >= FIRST_TAG:
            keep.append(tag)
    return sorted(keep, key=lambda t: tuple(int(g) for g in t[1:].split(".")))


def tag_templates(tag: str, dest: Path) -> bool:
    """Unpack the tag's template folder into dest without a checkout."""
    archive = subprocess.run(["git", "archive", tag, SUBPATH], cwd=ROOT,
                             capture_output=True)
    if archive.returncode != 0:
        return False
    subprocess.run(["tar", "-x", "-C", str(dest)], input=archive.stdout,
                   check=True)
    return True


def build(tags: list[str] | None = None) -> History:
    """Every hash the tags and the working tree write, with the last release
    (tag without its `v`) that wrote it; None for one the working tree still
    writes. Tags are read oldest first, so a later one overwrites."""
    current: Seen = {}
    collect(TEMPLATES, current)
    last: dict[str, dict[str, dict[str, str | None]]] = {}
    for tag in release_tags() if tags is None else tags:
        with tempfile.TemporaryDirectory() as tmp:
            if tag_templates(tag, Path(tmp)):
                seen: Seen = {}
                collect(Path(tmp) / SUBPATH, seen)
                for system, names in seen.items():
                    for name, found in names.items():
                        into = last.setdefault(system, {}).setdefault(name, {})
                        for h in found:
                            into[h] = tag.removeprefix("v")
    out: History = {}
    for system in sorted(set(last) | set(current)):
        out[system] = {}
        for name in sorted(set(last.get(system, {})) | set(current.get(system, {}))):
            hashes = dict(last.get(system, {}).get(name, {}))
            for h in current.get(system, {}).get(name, ()):
                hashes[h] = None
            out[system][name] = dict(sorted(hashes.items()))
    return out


def expire(history: History, floor: str) -> History:
    """`history` without the hashes whose last release is older than `floor`.
    A system or file left with nothing stays, empty: a system the file does
    not name is read as generic."""
    least = parse_version(floor)
    return {system: {name: {h: last for h, last in hashes.items()
                            if last is None or parse_version(last) >= least}
                     for name, hashes in names.items()}
            for system, names in history.items()}


def refusal(tags: list[str]) -> str | None:
    """Why the history must not be written, or None: a checkout without the
    release tags would record only the working tree's text."""
    if not tags:
        return "no release tags found (shallow clone?): run `git fetch --tags`"
    return None


def main() -> int:
    tags = release_tags()
    problem = refusal(tags)
    if problem:
        print(f"template_history.py: {problem}", file=sys.stderr)
        return 1
    HISTORY.write_text(json.dumps(expire(build(tags), FLOOR), indent=1) + "\n",
                       encoding="utf-8")
    print(f"wrote {HISTORY.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

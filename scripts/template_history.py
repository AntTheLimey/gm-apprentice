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

from migrate_vault import GENERIC, HISTORY, TEMPLATES, templates_for, text_hash  # noqa: E402

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


History = dict[str, dict[str, list[str]]]   # system -> filename -> hashes


def collect(source: Path, into: dict[str, dict[str, set[str]]]) -> None:
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
    hashes: dict[str, dict[str, set[str]]] = {}
    collect(TEMPLATES, hashes)
    for tag in release_tags() if tags is None else tags:
        with tempfile.TemporaryDirectory() as tmp:
            if tag_templates(tag, Path(tmp)):
                collect(Path(tmp) / SUBPATH, hashes)
    return {system: {name: sorted(hashes[system][name])
                     for name in sorted(hashes[system])}
            for system in sorted(hashes)}


def refusal(old: History, new: History, tags: list[str]) -> str | None:
    """Why the new history must not replace the old, or None: a checkout
    without the release tags would silently drop released hashes."""
    if not tags:
        return "no release tags found (shallow clone?): run `git fetch --tags`"
    dropped = sum(1 for system, names in old.items()
                  for name, hashes in names.items()
                  for h in hashes
                  if h not in new.get(system, {}).get(name, []))
    if dropped:
        return (f"{dropped} hash(es) already in the history would be "
                f"dropped; fetch all release tags and run again")
    return None


def main() -> int:
    tags = release_tags()
    new = build(tags)
    try:
        old = json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    if not all(isinstance(v, dict) for v in old.values()):
        old = {}   # the earlier flat shape: nothing to compare per system
    problem = refusal(old, new, tags)
    if problem:
        print(f"template_history.py: {problem}", file=sys.stderr)
        return 1
    HISTORY.write_text(json.dumps(new, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {HISTORY.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

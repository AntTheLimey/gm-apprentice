"""The GM's personal reference files: one folder outside the plugin.

    gma personal [--system SYSTEM] [--json]

A GM's own notes from books they own live in `~/gm-apprentice/personal/
<system>/`, a visible folder in their home directory. The plugin's own
folder is replaced on every update (and is write-protected inside the
agent's settings), so files kept there were stranded by an update and then
deleted with the old version's folder.

`adopt` copies personal files it finds in the running install's
`skills/ttrpg-expert/systems/<system>/personal/` and, for an installed
plugin, in the older version folders beside it, into the home. It copies:
it never moves, deletes or overwrites. A file already in the home is kept;
a different file of the same name left behind is reported only when it is
the newer of the two (it may hold edits the home's copy lacks). Each file is
dealt with once (the home's hidden `.adopted.json` names it), so a file the
GM renames or deletes in the home is never brought back. `gma personal` and `gma update`
run it; `gma doctor` counts what it would copy, changing nothing.

This command lists the home; its files are the GM's licensed material and
are never printed here.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import install_layout

# Under the GM's home directory, visible: these are their own documents.
FOLDER = Path("gm-apprentice") / "personal"
# Where an install keeps the systems corpus, relative to the folder holding shared/.
SYSTEMS = Path("ttrpg-expert") / "systems"
README = "readme.md"
# In the home: every file adoption has dealt with (`fitd/factions.md`), so it is never copied twice.
RECORD = ".adopted.json"


# For clean-room test runs only: a stand-in for the user's home directory, so a run that
# must keep the real HOME (where the agent's login lives) still never reads the GM's own files.
TEST_HOME_ENV = "GM_APPRENTICE_TEST_HOME"


def _user_home(user_home: Path | None) -> Path:
    if user_home is not None:
        return user_home
    stand_in = os.environ.get(TEST_HOME_ENV)
    return Path(stand_in) if stand_in else Path.home()


def home(user_home: Path | None = None) -> Path:
    """The personal files' folder: `~/gm-apprentice/personal`."""
    return _user_home(user_home) / FOLDER


def shown(path: Path, user_home: Path | None = None) -> str:
    """`path` as a GM reads it: under their home it starts with `~/`. A stand-in home
    (TEST_HOME_ENV) is never shortened, so a `~` the agent expands can't reach the real one."""
    base = Path.home() if user_home is None else user_home
    try:
        return "~/" + path.relative_to(base).as_posix()
    except ValueError:
        return str(path)


def known_systems(shared: Path) -> list[str]:
    """The systems this install has a folder for (`fitd`, `gurps-4e`, ...)."""
    systems = shared.parent / SYSTEMS
    if not systems.is_dir():
        return []
    return sorted(p.name for p in systems.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))


def _version_key(name: str) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", name)) or (-1,)


def sources(shared: Path) -> list[tuple[str, Path]]:
    """(label, systems folder) to adopt from: this install first, then, for a
    plugin in Claude Code's or Codex's plugin cache, every other version
    folder beside it, newest first. A repo checkout's neighbours are other
    projects, never versions of this one, so they are not looked at."""
    found = [("this install", shared.parent / SYSTEMS)]
    root = shared.parent.parent
    if shared.parent.name == "skills" and "/plugins/cache/" in root.as_posix() + "/":
        others = [p for p in root.parent.iterdir() if p.is_dir() and p != root]
        for other in sorted(others, key=lambda p: _version_key(p.name), reverse=True):
            found.append((other.name, other / "skills" / SYSTEMS))
    return found


def _files(personal: Path) -> list[Path]:
    """Every file under one `personal/` folder, hidden ones (.DS_Store) left out."""
    out = []
    for path in sorted(personal.rglob("*")):
        rel = path.relative_to(personal)
        if path.is_file() and not any(part.startswith(".") for part in rel.parts):
            out.append(path)
    return out


@dataclass
class Adoption:
    copied: dict[str, int] = field(default_factory=dict)      # source label -> files copied
    clashes: list[tuple[Path, Path]] = field(default_factory=list)  # (left behind, kept in home)

    @property
    def total(self) -> int:
        return sum(self.copied.values())


def _copy(src: Path, dest: Path) -> None:
    """Copy through a temporary file, so a stopped copy leaves no half file to read as a clash."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".copying-")
    os.close(fd)
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dest)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _read_record(target: Path) -> set[str]:
    try:
        data = json.loads((target / RECORD).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {k for k in data if isinstance(k, str)} if isinstance(data, list) else set()


def _write_record(target: Path, keys: set[str]) -> None:
    target.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target, prefix=".copying-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(sorted(keys), f, indent=0)
    os.replace(tmp, target / RECORD)


def adopt(shared: Path, *, user_home: Path | None = None, dry_run: bool = False) -> Adoption:
    """Copy every personal file the install folders hold into the home (see the module text).
    Each file is dealt with once: the home's record names it from then on, so one the GM
    renamed or deleted is not brought back, and a clash is reported once."""
    target = home(user_home)
    result = Adoption()
    record = _read_record(target)
    seen = set(record)
    try:
        _adopt_into(shared, target, seen, result, dry_run)
    finally:
        # Written when a copy fails too, so the files already copied stay dealt with. The one
        # that failed never reached `seen`, so the next run tries it again.
        if not dry_run and seen != record:
            _write_record(target, seen)
    return result


def _adopt_into(shared: Path, target: Path, seen: set[str], result: Adoption, dry_run: bool) -> None:
    for label, systems in sources(shared):
        if not systems.is_dir():
            continue
        for personal in sorted(systems.glob("*/personal")):
            if not personal.is_dir():
                continue
            system = personal.parent.name
            for src in _files(personal):
                rel = src.relative_to(personal)
                key = "/".join((system, *rel.parts))
                if key in seen:
                    continue
                dest = target / system / rel
                if dest.exists():
                    # Same bytes, or the home's copy is the newer (the GM edited it after it came
                    # across): nothing to say. Only a newer file left behind may hold edits to lose.
                    same = dest.is_file() and dest.read_bytes() == src.read_bytes()
                    if not same and src.stat().st_mtime > dest.stat().st_mtime:
                        result.clashes.append((src, dest))
                else:
                    if not dry_run:
                        _copy(src, dest)
                    result.copied[label] = result.copied.get(label, 0) + 1
                seen.add(key)


def adoption_lines(result: Adoption, *, user_home: Path | None = None) -> list[str]:
    """What `adopt` did, one line each; none when it found nothing to do."""
    where = shown(home(user_home), user_home)
    lines = [f"personal files: copied {n} from {label} into {where}" for label, n in result.copied.items()]
    for left, kept in result.clashes:
        lines.append(f"personal files: {left} differs from {shown(kept, user_home)}; "
                     f"kept the one in {where}")
    return lines


def listing(*, user_home: Path | None = None) -> dict[str, list[str]]:
    """{system: its files relative to the system folder}, README first."""
    target = home(user_home)
    if not target.is_dir():
        return {}
    out: dict[str, list[str]] = {}
    for folder in sorted(p for p in target.iterdir() if p.is_dir() and not p.name.startswith(".")):
        files = [f.relative_to(folder).as_posix() for f in _files(folder)]
        out[folder.name] = sorted(files, key=lambda f: (f.lower() != README, f.lower()))
    return out


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Where the GM's personal reference files live, and what is there. "
                    "Copies any left in the plugin's own folders into it first.",
        epilog="Example: gma personal --system fitd")
    ap.add_argument("--system", help="list this system's files (fitd, gurps-4e, coc-7e, dnd-5e-2024, pf2e)")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    shared = install_layout.LAYOUT.shared
    systems = known_systems(shared)
    if args.system and args.system not in systems:
        print(f"gma personal: unknown system {args.system!r}; one of: {', '.join(systems)}", file=sys.stderr)
        return 2
    try:
        result = adopt(shared)
    except OSError as e:
        print(f"gma personal: could not copy the personal files: {e}", file=sys.stderr)
        return 1
    files = listing()
    where = home()
    if args.json:
        chosen = {args.system: files.get(args.system, [])} if args.system else files
        print(json.dumps({
            "folder": str(where),
            "copied": result.copied,
            "clashes": [{"left": str(a), "kept": str(b)} for a, b in result.clashes],
            "systems": chosen,
        }, indent=2))
        return 0
    for line in adoption_lines(result):
        print(line)
    print(f"Personal reference files: {shown(where)}")
    if args.system:
        mine = files.get(args.system, [])
        if not mine:
            print(f"{args.system}: none yet. The GM's notes for it go in {shown(where / args.system)}/")
        else:
            print(f"{args.system}: {len(mine)} file{'s' if len(mine) != 1 else ''} in {shown(where / args.system)}/")
            for f in mine:
                print(f"  {f}")
        return 0
    if not files:
        print("None yet. Each system's go in its own folder here: " + ", ".join(f"{s}/" for s in systems))
    for system, mine in files.items():
        print(f"{system}: {len(mine)} file{'s' if len(mine) != 1 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

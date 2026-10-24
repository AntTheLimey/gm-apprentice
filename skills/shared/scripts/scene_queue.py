#!/usr/bin/env python3
"""The prep queue: scenes written ahead of time and not yet played.

A scene is a `type: scene` note under a chapter's `Scenes/` folder (or a
sub-folder of the chapter, such as a side adventure). The queue lists the
ones whose status is `planned` or `paused`, paused first, then by folder,
then title. A `paused` scene is listed wherever it sits, whatever
`--chapter` says (a scene paused at a chapter break is still to play). Scenes inside a
session folder (`Sessions/`, or a folder named `Session NN`) are an older
layout's history and are never queued unless paused.

Read-only. Bookkeeping only: it reads `type` and `status`, never the body.

Usage: scene_queue.py VAULT [--chapter NAME]   (NAME as scene-new takes it)
Output: STATUS<TAB>folder<TAB>[[title]], one row per scene.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vaultlib as vl                                  # noqa: E402
from schema_rules import VALUE_ALIASES                  # noqa: E402

SESSION_FOLDER_RE = re.compile(r"^Session[ _]?\d+", re.IGNORECASE)
QUEUED = ("planned", "paused")


class QueueRow(NamedTuple):
    rel: str
    title: str
    chapter: str
    folder: str
    status: str


def _status(fm: dict) -> str:
    raw = str(fm.get("status") or "").strip().lower()
    return VALUE_ALIASES["scene"]["status"].get(raw, raw)


def _chapter_names(chapters: list[tuple[str, dict]], raw: str) -> set[str]:
    """Every name `raw`'s chapter goes by, normalized: its note found as
    `vault_write scene-new --chapter` finds it, else `raw` itself."""
    hits = vl.chapters_named(chapters, raw)
    if len(hits) > 1:
        raise ValueError(f"{len(hits)} chapter notes match {raw!r}: "
                         + ", ".join(rel for rel, _fm in hits))
    if not hits:
        return {vl.normalize(raw.strip().removeprefix("[[")
                             .removesuffix("]]"))}
    rel, fm = hits[0]
    return {vl.normalize(n) for n in (
        vl.chapter_link_name(rel, fm), Path(rel).stem,
        rel.rpartition("/")[0].rpartition("/")[2])}


def queue(vault: Path, chapter: str | None = None) -> list[QueueRow]:
    """The queue; `chapter` keeps planned scenes of that chapter only (a
    paused scene is listed whatever its chapter). ValueError when
    `chapter` names several chapter notes."""
    notes = [(rel, vl.extract_frontmatter(text) or {})
             for rel, text in vl.vault_files(vault)]
    chapters = [(rel, fm) for rel, fm in notes
                if vl.entity_type(fm) == "chapter"]
    chapter_dirs = {rel.rpartition("/")[0]: Path(rel).stem
                    for rel, _fm in chapters}
    wanted = _chapter_names(chapters, chapter) if chapter else None
    rows: list[QueueRow] = []
    for rel, fm in notes:
        if vl.entity_type(fm) != "scene":
            continue
        status = _status(fm)
        if status not in QUEUED:
            continue
        parts = rel.split("/")[:-1]
        in_session = any(p == "Sessions" or SESSION_FOLDER_RE.match(p)
                         for p in parts)
        # The chapter folder: the deepest ancestor holding a chapter note.
        base = next((i for i in range(len(parts), 0, -1)
                     if "/".join(parts[:i]) in chapter_dirs), None)
        scenes_at = next((i for i, p in enumerate(parts)
                          if p == "Scenes" and (base is None or i >= base)),
                         None)
        if status != "paused":
            if in_session or scenes_at is None or base is None:
                continue
        name = (vl.wikilink_target(fm.get("chapter"))
                or (chapter_dirs.get("/".join(parts[:base]), "")
                    if base is not None else ""))
        if wanted is not None and status != "paused" and not wanted & {
                vl.normalize(name), vl.normalize(parts[base - 1])
                if base else ""}:
            continue
        sub = parts[base:scenes_at] if base is not None and scenes_at \
            is not None else []
        rows.append(QueueRow(rel, Path(rel).stem, name, "/".join(sub),
                             status))
    rows.sort(key=lambda r: (r.status != "paused", r.folder.casefold(),
                             r.title.casefold()))
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("vault", type=Path)
    ap.add_argument("--chapter")
    args = ap.parse_args(argv)
    try:
        rows = queue(args.vault, args.chapter)
    except ValueError as e:
        print(f"scene_queue: {e}", file=sys.stderr)
        return 1
    for row in rows:
        print(f"{row.status}\t{row.folder}\t[[{row.title}]]")
    return 0


if __name__ == "__main__":
    sys.exit(main())

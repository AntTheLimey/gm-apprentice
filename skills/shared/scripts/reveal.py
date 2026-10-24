#!/usr/bin/env python3
"""reveal.py: apply the GM's yes to what a session let the players learn.

    reveal.py VAULT --session "Session 12" [--publish PATH]...
              [--released "PATH=what came out"]... [--write]

Without `--write` it only says what it would do. With it, in this order:

1. publish: the paths go on the publish list through the publish tool
   (`manifest apply`); the tool says which now publish.
2. clear: `withheld: false` on each of those notes that carries a
   `withheld` key (a note without one is left alone).
3. log: the session is recorded in `_meta/reveals.json`. The log is
   history only; nothing reads it to decide what publishes.

A path that does not end up publishing keeps its `withheld`. Prep notes
(sessions, plans, scenes, play notes, wrap-ups, chapters, `_meta/`) are
never published here. With no site to publish through, `--publish` is
refused; `--released` still logs.

Rows are `verb <TAB> path <TAB> detail`, then
`# publish: N clear: N log: N errors: N`.
Exit: 0 ok; 1 a path was refused or failed; 2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reveal_scan import NEVER_CANDIDATES  # noqa: E402
from vault_check import _site_config, ask_publish_tool  # noqa: E402
from vault_write import set_block  # noqa: E402
from vaultlib import entity_type, extract_frontmatter, frontmatter_span, normalize_file_arg  # noqa: E402

LOG = "_meta/reveals.json"


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def apply_publish(vault: Path, paths: list[str]) -> tuple[list[str], str | None]:
    """(paths that now publish, why not). Puts `paths` on the publish list
    through the publish tool, then asks the tool what publishes."""
    listing = ask_publish_tool(vault, ["manifest", "list"])
    if listing.why or not isinstance(listing.data, dict):
        return [], listing.why or "the publish tool gave no answer"
    if not listing.data.get("listed"):
        return [], "the vault has no publish list; set one up first"
    args = ["manifest", "apply"]
    for p in paths:
        args += ["--publish", p]
    done = ask_publish_tool(vault, args)
    if done.why or not isinstance(done.data, dict):
        return [], done.why or "the publish tool gave no answer"
    after = ask_publish_tool(vault, ["manifest", "list"])
    if after.why or not isinstance(after.data, dict):
        return [], after.why or "the publish tool gave no answer"
    publishing = {_nfc(str(p)) for p in after.data.get("publishing") or []}
    return [p for p in paths if _nfc(p) in publishing], None


def _refusal(vault: Path, rel: str) -> str | None:
    if rel.startswith("_meta/"):
        return "not published here: _meta notes stay out of the site"
    if "=" in rel:
        return "a path with `=` cannot be passed to the publish tool"
    full = vault / rel
    if not rel.lower().endswith(".md") or not full.is_file():
        return "no such note"
    try:
        full.resolve().relative_to(vault.resolve())
    except ValueError:
        return "outside the vault"
    kind = entity_type(extract_frontmatter(full.read_text(encoding="utf-8")))
    if kind in NEVER_CANDIDATES:
        return f"a {kind} note is prep or structure; it never publishes"
    return None


def _clear_withheld(vault: Path, rel: str) -> str | None:
    """New text with `withheld: false`, or None when there is nothing to do."""
    text = (vault / rel).read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        return None
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    current = next((ln for ln in fm if ln.startswith("withheld:")), None)
    if current is None or current.split(":", 1)[1].strip().lower() == "false":
        return None
    set_block(fm, "withheld", "false")
    return "---" + eol + eol.join(fm) + eol + "---" + eol + "".join(lines[end + 1:])


def _load_log(vault: Path) -> dict[str, Any]:
    target = vault / LOG
    if not target.is_file():
        today = date.today().isoformat()
        return {"entries": [{
            "before_tracking": True, "date": today,
            "note": "Everything published by this date counts as revealed."}]}
    data = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise ValueError(f"{LOG} is not a reveals log")
    return data


def _merge_entry(log: dict[str, Any], session: str, published: list[str],
                 released: list[dict[str, str]]) -> None:
    today = date.today().isoformat()
    entry = next((e for e in log["entries"]
                  if isinstance(e, dict) and e.get("session") == session), None)
    if entry is None:
        entry = {"session": session, "date": today, "published": [], "released": []}
        log["entries"].append(entry)
    entry["date"] = today
    entry["published"] = sorted({*entry.get("published", []), *published})
    seen = {(r["page"], r["what"]) for r in [*entry.get("released", []), *released]}
    entry["released"] = [{"page": p, "what": w} for p, w in sorted(seen)]


def _write_log(vault: Path, log: dict[str, Any]) -> None:
    target = vault / LOG
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(log, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def run(vault: Path, session: str, publish: list[str], released: list[tuple[str, str]],
        write: bool) -> tuple[list[str], int]:
    rows: list[str] = []
    counts = {"publish": 0, "clear": 0, "log": 0, "errors": 0}

    def row(verb: str, path: str, detail: str = "") -> None:
        rows.append(f"{verb}\t{path}\t{detail}")

    def error(path: str, why: str) -> None:
        counts["errors"] += 1
        row("ERROR", path, why)

    wanted: list[str] = []
    for raw in publish:
        rel = normalize_file_arg(raw)
        why = _refusal(vault, rel)
        if why:
            error(rel, why)
        elif rel not in wanted:
            wanted.append(rel)
    if wanted and _site_config(vault)[0] is None:
        for rel in wanted:
            error(rel, "no site to publish through")
        wanted = []

    published: list[str] = []
    if wanted and not write:
        for rel in wanted:
            counts["publish"] += 1
            row("WOULD-PUBLISH", rel)
            if _clear_withheld(vault, rel) is not None:
                counts["clear"] += 1
                row("WOULD-CLEAR", rel, "withheld: false")
        published = wanted
    elif wanted:
        done, why = apply_publish(vault, wanted)
        if why:
            error(", ".join(wanted), f"publish failed, nothing changed: {why}")
        for rel in wanted:
            if rel in done:
                continue
            if not why:
                error(rel, "the publish tool does not list it as publishing; withheld kept")
        for rel in done:
            counts["publish"] += 1
            row("PUBLISHED", rel)
            new = _clear_withheld(vault, rel)
            if new is not None:
                (vault / rel).write_text(new, encoding="utf-8", newline="")
                counts["clear"] += 1
                row("CLEARED", rel, "withheld: false")
        published = list(done)

    items = [{"page": normalize_file_arg(p), "what": w} for p, w in released]
    if published or items:
        counts["log"] = 1
        row("LOGGED" if write else "WOULD-LOG", LOG,
            f"{session}: {len(published)} published, {len(items)} released")
        if write:
            try:
                log = _load_log(vault)
                _merge_entry(log, session, published, items)
                _write_log(vault, log)
            except (OSError, ValueError) as e:
                counts["log"] = 0
                error(LOG, f"not logged: {e}")
    rows.append(f"# publish: {counts['publish']} clear: {counts['clear']} "
                f"log: {counts['log']} errors: {counts['errors']}")
    return rows, (1 if counts["errors"] else 0)


def _parse(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="reveal.py",
        description="Publish what a session let the players learn, lift "
                    "withheld, and log it. Dry run unless --write.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("--session", required=True, help="the session's name, e.g. 'Session 12'")
    ap.add_argument("--publish", action="append", default=[], metavar="PATH")
    ap.add_argument("--released", action="append", default=[], metavar="PATH=WHAT")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        ap.error(f"{args.vault} is not a folder")
    if not args.session.strip():
        ap.error("--session is empty")
    for r in args.released:
        page, _, what = r.partition("=")
        if not page.strip() or not what.strip():
            ap.error(f"--released needs PATH=what came out, got {r!r}")
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parse(argv)
    except SystemExit as e:
        return int(e.code) if isinstance(e.code, int) else 2
    released = [(p.strip(), w.strip()) for p, _, w in (r.partition("=") for r in args.released)]
    rows, code = run(args.vault, args.session.strip(), args.publish, released, args.write)
    print("\n".join(rows))
    return code


if __name__ == "__main__":
    sys.exit(main())

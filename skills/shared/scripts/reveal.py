#!/usr/bin/env python3
"""reveal.py: apply the GM's yes to what a session let the players learn.

    reveal.py VAULT --session "Session 12" [--publish PATH]...
              [--released "PATH=what came out"]... [--write]

Without `--write` it only says what it would do. With it, in this order:

1. publish: the paths go on the publish list through the publish tool
   (`manifest apply`); the tool says which now publish.
2. clear: `withheld: false` on each of those notes that carries a
   `withheld` key (a note without one is left alone).
3. stamp: `revealed_in: "[[SESSION]]"` on each of those notes the publish
   tool (`explain --all`, asked before publishing) says is a prop, unless
   it already names one. Only notes revealed in this run are stamped; the
   clear and the stamp are one write per note.
4. log: the session is recorded in `_meta/reveals.json`. The log is
   history only; nothing reads it to decide what publishes.

A note revealed in this run is one newly publishing, or one already on the
list whose `withheld` is lifted now (the site showed nothing of it before);
any other note already on the list is skipped, unlogged and unstamped. A
path that does not end up publishing keeps its `withheld` and gets no
`revealed_in`. When `explain` cannot be asked, a WARNING row says so and
nothing is stamped; publishing goes ahead. A WARNING row also names each
note the site makes no page for (a folder outside the folder map); a prop
there is stamped all the same, and the row says so. Prep notes
(sessions, plans, scenes, play notes, wrap-ups, chapters, `_meta/`) are
never published here. With no site to publish through, `--publish` is
refused; `--released` still logs.

Rows are `verb <TAB> path <TAB> detail`, then
`# publish: N clear: N stamp: N log: N errors: N`.
Exit: 0 ok; 1 a path was refused or failed; 2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reveal_scan import NEVER_CANDIDATES  # noqa: E402
from vault_check import _site_config, ask_publish_tool  # noqa: E402
from vault_write import set_block  # noqa: E402
from vaultlib import (  # noqa: E402
    WITHHELD_KEY_RE, PublishToolUnavailable, entity_type, extract_frontmatter,
    frontmatter_span, normalize_file_arg, note_withheld, scalar_value)

LOG = "_meta/reveals.json"
EMPTY_VALUES = ("", "[]", "null", "~")     # YAML's empty values, as scalar_value reads them
REVEALED_IN_KEY_RE = re.compile(r"""^["']?revealed_in["']?[ \t]*:""")


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _tool_why(answer: Any) -> str:
    """Why the tool failed, with the reason it printed on stdout when it
    refused (the tool says which path and why there, not on stderr)."""
    said = [ln.strip() for ln in (answer.stdout or "").splitlines()
            if ln.strip() and not ln.strip().startswith("Nothing was written")]
    return " ".join([answer.why or "the publish tool gave no answer", *said])


def publish_state(vault: Path) -> tuple[set[str] | None, str | None]:
    """(paths on the publish list now, why not). `None` with a reason when
    the tool cannot be asked or the vault has no publish list."""
    listing = ask_publish_tool(vault, ["manifest", "list"])
    if listing.why or not isinstance(listing.data, dict):
        return None, _tool_why(listing)
    if not listing.data.get("listed"):
        return None, "the vault has no publish list; set one up first"
    return {_nfc(str(p)) for p in listing.data.get("publishing") or []}, None


def apply_publish(vault: Path, paths: list[str],
                  before: set[str] | None = None) -> tuple[list[str], str | None]:
    """(paths that now publish, why not). Puts `paths` on the publish list
    through the publish tool, then asks the tool what publishes. `before` is
    the state the caller already asked for; without it the tool is asked."""
    if before is None:
        before, why = publish_state(vault)
        if before is None:
            return [], why
    args = ["manifest", "apply"]
    for p in paths:
        args += ["--publish", p]
    done = ask_publish_tool(vault, args)
    if done.why or not isinstance(done.data, dict):
        return [], _tool_why(done)
    after, why = publish_state(vault)
    if after is None:
        return [], why
    return [p for p in paths if _nfc(p) in after], None


def prop_paths(vault: Path) -> tuple[set[str] | None, dict[str, str], str | None]:
    """(the notes the publish tool says are props, read from the note itself
    when the site makes no page for it; the notes it makes no page for, with
    its verdict code; why not)."""
    answer = ask_publish_tool(vault, ["explain", "--all"])
    if answer.why or not isinstance(answer.data, dict):
        return None, {}, _tool_why(answer)
    props: set[str] = set()
    no_page: dict[str, str] = {}
    try:
        for page in answer.data["pages"]:
            path = _nfc(str(page["path"]))
            if page.get("prop") is True:
                props.add(path)
            if "strippedSections" in page and page["strippedSections"] is None:
                no_page[path] = str(page.get("code") or "")
    except (KeyError, TypeError, AttributeError):
        return None, {}, "the publish tool's explain answer is not understood"
    return props, no_page, None


def _no_page_why(rel: str, code: str) -> str:
    if code == "DIR_UNMAPPED":
        folder = Path(rel).parent.as_posix()
        return (f"on the publish list, but the site does not show notes in {folder}, "
                "so it has no page (add the folder to player_site.folder_map)")
    return f"on the publish list, but the site makes no page for it ({code or 'no reason given'})"


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


def _revealed_in_set(fm: list[str]) -> bool:
    """Whether the frontmatter lines name a `revealed_in` (a string or a
    list). A value not read as empty counts as set: an arrival is never
    written over."""
    at = next((i for i, ln in enumerate(fm) if REVEALED_IN_KEY_RE.match(ln)), None)
    if at is None:
        return False
    if scalar_value(fm[at].split(":", 1)[1]).lower() not in EMPTY_VALUES:
        return True
    for line in fm[at + 1:]:
        if line.strip() and not line[:1].isspace():
            break
        if scalar_value(line.strip().removeprefix("-")):
            return True
    return False


def _has_frontmatter(vault: Path, rel: str) -> bool:
    lines = (vault / rel).read_text(encoding="utf-8").splitlines(keepends=True)
    return frontmatter_span(lines)[1] != "no frontmatter"


def _frontmatter_edit(vault: Path, rel: str, *, clear: bool,
                      stamp: str | None) -> tuple[str | None, str | None]:
    """(new text, or None when there is nothing to do; why it could not be
    done). `clear` sets `withheld: false` on a note whose `withheld` is not
    already false; `stamp` sets `revealed_in: "[[stamp]]"` on a note that
    names no `revealed_in` yet. Both land in the one edit."""
    with open(vault / rel, encoding="utf-8", newline="") as f:
        text = f.read()     # no newline translation: a CRLF note stays CRLF
    lines = text.splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error == "no frontmatter":
        return None, None
    if error:
        what = "withheld not cleared" if clear else "revealed_in not written"
        return None, f"{what}: frontmatter {error}"
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = [ln.rstrip("\r\n") for ln in lines[1:end]]
    changed = False
    if clear:
        at = next((i for i, ln in enumerate(fm) if WITHHELD_KEY_RE.match(ln)), None)
        if at is not None and fm[at].split(":", 1)[1].strip().lower() != "false":
            fm[at] = "withheld:"    # the spellings the build accepts, one spelling here
            set_block(fm, "withheld", "false")
            changed = True
    if stamp is not None and not _revealed_in_set(fm):
        at = next((i for i, ln in enumerate(fm) if REVEALED_IN_KEY_RE.match(ln)), None)
        if at is not None:
            fm[at] = "revealed_in:"
        # A JSON string is a valid YAML double-quoted scalar, escapes and all.
        set_block(fm, "revealed_in", json.dumps(f"[[{stamp}]]", ensure_ascii=False))
        changed = True
    if not changed:
        return None, None
    return "---" + eol + eol.join(fm) + eol + "---" + eol + "".join(lines[end + 1:]), None


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
    old_pub = entry.get("published")
    old = old_pub if isinstance(old_pub, list) else []
    entry["published"] = sorted({*(x for x in old if isinstance(x, str)), *published})
    old_rel = entry.get("released")
    kept: list[Any] = []
    seen = {(r["page"], r["what"]) for r in released}
    for r in old_rel if isinstance(old_rel, list) else []:
        if isinstance(r, dict) and isinstance(r.get("page"), str) \
                and isinstance(r.get("what"), str):
            seen.add((r["page"], r["what"]))
        else:
            kept.append(r)      # hand-edited: kept as written, not merged
    entry["released"] = [{"page": p, "what": w} for p, w in sorted(seen)] + kept


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
    counts = {"publish": 0, "clear": 0, "stamp": 0, "log": 0, "errors": 0}

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
    if wanted:
        before, why = publish_state(vault)
        if before is None:
            for rel in wanted:
                error(rel, f"publish refused, nothing changed: {why}")
            wanted = []
        else:
            listed = [r for r in wanted if _nfc(r) in before]
            fresh = [r for r in wanted if r not in listed]
            # Listed but withheld, the site showed nothing of it: lifting withheld
            # is this session's reveal, logged and stamped like a new publish.
            lifted: list[str] = []
            unknown: dict[str, str] = {}
            for rel in listed:
                try:
                    if note_withheld((vault / rel).read_text(encoding="utf-8"))[0]:
                        lifted.append(rel)
                except PublishToolUnavailable as e:
                    unknown[rel] = str(e)
            already = [r for r in listed if r not in lifted]
            revealing = [*fresh, *lifted]
            verb_pub, verb_clear, verb_stamp = ("PUBLISHED", "CLEARED", "STAMPED") if write \
                else ("WOULD-PUBLISH", "WOULD-CLEAR", "WOULD-STAMP")
            props: set[str] = set()
            no_page: dict[str, str] = {}
            if revealing:
                found, no_page, why = prop_paths(vault)
                if found is None:
                    row("WARNING", "-", f"revealed_in not written: {why}")
                else:
                    props = found
            # Know the edit can be done before anything is published: the
            # clear, and on a prop revealed now with no arrival yet, the stamp,
            # one write per note. A note published before is never stamped.
            edits: dict[str, tuple[str | None, str | None]] = {}
            clearing: set[str] = set()
            stamping: set[str] = set()
            unstamped: dict[str, str] = {}     # a prop not stamped, and why
            for rel in wanted:
                edits[rel] = _frontmatter_edit(vault, rel, clear=True, stamp=None)
                new, problem = edits[rel]
                if new is not None:
                    clearing.add(rel)
                if problem or rel not in revealing or _nfc(rel) not in props:
                    continue
                if _frontmatter_edit(vault, rel, clear=False, stamp=session)[0] is None:
                    unstamped[rel] = "revealed_in already set" if _has_frontmatter(vault, rel) \
                        else "revealed_in not written: the note has no frontmatter"
                else:
                    stamping.add(rel)
                    edits[rel] = _frontmatter_edit(vault, rel, clear=True, stamp=session)
            for rel in revealing:
                if _nfc(rel) in no_page:
                    stamped = (f"; revealed_in: [[{session}]] "
                               + ("is" if write else "would be") + " written all the same") \
                        if rel in stamping else ""
                    row("WARNING", rel, _no_page_why(rel, no_page[_nfc(rel)]) + stamped)
            for rel in list(fresh):
                if edits[rel][1]:
                    error(rel, f"not published, nothing changed: {edits[rel][1]}")
                    fresh.remove(rel)
            done = list(fresh)
            if write and fresh:
                done, why = apply_publish(vault, fresh, before)
                if why:
                    for rel in fresh:
                        error(rel, f"publish failed, nothing changed: {why}")
                else:
                    for rel in fresh:
                        if rel not in done:
                            error(rel, "the publish tool does not list it as "
                                       "publishing; withheld kept")
            for rel in already:
                why_not = f"withheld unknown ({unknown[rel]}), so " if rel in unknown else ""
                row("SKIP", rel, f"already published; {why_not}not logged for this session")
            for rel in [*done, *lifted, *already]:
                if rel in done:
                    counts["publish"] += 1
                    row(verb_pub, rel)
                    published.append(rel)
                new, problem = edits[rel]
                if problem:
                    error(rel, problem)
                elif new is not None:
                    if write:
                        try:
                            (vault / rel).write_text(new, encoding="utf-8", newline="")
                        except OSError as e:
                            undone = [w for w, on in (("withheld not cleared", rel in clearing),
                                                      ("revealed_in not written", rel in stamping))
                                      if on]
                            error(rel, f"{', '.join(undone)}: {e}")
                            continue
                    if rel in lifted:
                        counts["publish"] += 1
                        row(verb_pub, rel, "already on the publish list; withheld lifted")
                        published.append(rel)
                    if rel in clearing:
                        counts["clear"] += 1
                        row(verb_clear, rel, "withheld: false")
                    if rel in stamping:
                        counts["stamp"] += 1
                        row(verb_stamp, rel, f"revealed_in: [[{session}]]"
                            + ("" if write or rel in lifted else " if it publishes"))
                if rel in unstamped:
                    row("SKIP", rel, unstamped[rel])

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
                f"stamp: {counts['stamp']} log: {counts['log']} errors: {counts['errors']}")
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

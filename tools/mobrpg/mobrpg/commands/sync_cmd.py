"""mobrpg sync — timestamp last-writer-wins reconciliation of description prose.

Replaces the hash/baseline machinery (pull-desc / suggest-desc, deleted in
Task 10) with a single verb driven by three timestamps: the note file's mtime,
the node's recorded `last_synced`, and the server element's `lastModified`
(Task 1 verdict — NOT `updatedDate`). `lww.decide` maps those to one of
skip / pull / push / tie inside a ±skew window; this command acts on the verdict.

Directions:
  pull  — server is newer: overwrite the note's canon prose with the converted
          server description, preserving the GM Notes tail verbatim, and stamp
          `last_synced`.
  push/ — the vault is newer (or a tie the GM must adjudicate): compare the
  tie     authored canon prose to the live description; if they normalize equal
          the note is already in sync (stamp only), otherwise file one reviewable
          `UpdateElement` suggestion and mark the node `review_state: pending`
          (the stamp lands later, on accept/dismiss — Task 9). GM Notes are never
          pushed.

A `review_state == "pending"` note is held (already awaiting adjudication) and is
not even fetched. Dry-run by default: it prints the per-note decision table and
writes nothing; `--execute` gates every file write and the suggestion submit.

Design: docs/plans/2026-07-25-mobrpg-sync-lww-design.md.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass

import re

from mobrpg import client
from mobrpg import links
from mobrpg import lww
from mobrpg import md as _md
from mobrpg import node
from mobrpg import section
from mobrpg.vault import body_of, iter_linked_notes
from mobrpg.commands import submit_batch
from mobrpg.commands import suggest
from mobrpg.commands import suggestions


# ---------------- file-text surgery ----------------

def _rebuild(txt: str, new_node: dict, new_body: str) -> str:
    """Write the updated node into the frontmatter and swap in the new body."""
    txt2 = node.write_node(txt, new_node)
    pre, fm_body, post = node._split_frontmatter(txt2)
    if fm_body is None:
        return txt2
    # Guarantee exactly one line break between the closing "---" fence and the
    # body: a body rebuilt from html_to_md carries no leading newline and would
    # otherwise glue onto the fence as "---New prose".
    sep = "" if new_body[:1] in ("\n", "\r") else "\n"
    return pre + fm_body + post[:3] + sep + new_body


# ---------------- pure planning ----------------

@dataclass
class Action:
    """One resolved note. `new_text` (if set) is written under --execute;
    `suggestion` (if set) is batched into the submit under --execute."""
    path: str
    ref: str
    decision: str                       # hold | deleted | unknown | skip | pull | in-sync | push
    new_text: str | None = None
    suggestion: dict | None = None


def _note_name(path: str, txt: str) -> str:
    """The display name a `[[wikilink]]` should carry for this note: the
    top-level frontmatter `name:` if present, else the filename stem. Consumed
    only to build the pull-side {element_id: name} map."""
    _pre, fm_body, _post = node._split_frontmatter(txt)
    if fm_body:
        m = re.search(r"(?m)^name:\s*(.+?)\s*$", fm_body)
        if m:
            return m.group(1).strip().strip('"')
    return os.path.splitext(os.path.basename(path))[0]


def _pull_body(old_body: str, description: str | None, desc_type: str | None,
               name_by_eid: dict | None) -> str:
    """Behavior 5: server prose (converted, element links rewritten back to
    wikilinks) + preserved GM Notes tail. When the server stores the
    description as Markdown it is used verbatim — no `html_to_md` round-trip,
    which is lossy; otherwise it is converted from HTML (legacy Html-typed
    elements). A "\\n\\n" separator is inserted only when a GM tail exists and
    the converted prose does not already end with a blank line. The GM Notes
    tail is never touched by the link rewrite."""
    _main, gm_tail = section.gm_notes_split(old_body)
    if (desc_type or "").lower() == "markdown":
        converted = description or ""
    else:
        converted = _md.html_to_md(description or "")
    converted = links.rewrite_md_for_pull(converted, name_by_eid or {})
    if gm_tail and not converted.endswith("\n\n"):
        return converted + "\n\n" + gm_tail
    return converted + gm_tail


def _build_suggestion(nd: dict, cand_md: str) -> dict:
    """One UpdateElement suggestion item, sent as raw Markdown (mobRPG supports
    it natively; omitting descriptionType silently selects Html — #150).

    externalRef gets its OWN namespace, `<ns>:upd/<relpath>#<sha256[:12] of the
    pushed markdown>` (#151). The note's plain `<ns>:<relpath>` ref is the
    create-time element join key, and a ref is claimed for good once its
    suggestion goes terminal — reusing it meant the second update the GM ever
    accepted was silently swallowed by the first one's Accepted row. A per-content
    hash keeps both halves: identical content re-pushed mints the identical ref,
    so our own still-Pending row is corrected in place (idempotent), while edited
    content mints a new ref that no terminal row can claim. The relpath stays
    recoverable, so `suggestions --correlate` and `pull-canon` (via
    `node.note_ref`) still join the suggestion back to its note."""
    item = {"operation": "UpdateElement",
            "payload": {"operation": "UpdateElement",
                        "targetRef": nd["element_id"],
                        "description": cand_md,
                        "descriptionType": "Markdown"},
            "dependsOn": []}
    xref = nd.get("external_ref")
    if xref and ":" in xref:
        ns, rel = xref.split(":", 1)
        digest = hashlib.sha256(cand_md.encode("utf-8")).hexdigest()[:12]
        item["externalRef"] = f"{ns}:upd/{rel}#{digest}"
    elif xref:
        item["externalRef"] = xref
    return item


def plan(notes, fetch, now: str, skew: float, *,
         idx: dict | None = None, world: str = "",
         url_fmt: str = links.URL_FMT,
         name_by_eid: dict | None = None) -> list[Action]:
    """Pure decision pass. `notes` yields (path, txt, nd, mtime); `fetch(nd)`
    returns (detail, status) with status in {ok, deleted, unknown}. `now` is the
    stamp to apply; no I/O happens here. `idx`/`world`/`url_fmt` drive the push
    wikilink->element rewrite; `name_by_eid` drives the pull element->wikilink
    rewrite."""
    idx = idx or {}
    actions: list[Action] = []
    for path, txt, nd, mtime in notes:
        ref = nd.get("external_ref") or path

        # Behavior 1: a pending note is already awaiting GM adjudication.
        if nd.get("review_state") == "pending":
            actions.append(Action(path, ref, "hold"))
            continue

        # Behavior 2: fetch the live element; a missing kind mapping or 404 skips.
        detail, status = fetch(nd)
        if status != "ok":
            actions.append(Action(path, ref, status))
            continue

        # Behavior 3: the timestamp verdict.
        decision = lww.decide(mtime, nd.get("last_synced"),
                              detail.get("lastModified"), skew)
        old_body = body_of(txt)

        # Behavior 4: nothing to do.
        if decision == "skip":
            actions.append(Action(path, ref, "skip"))
            continue

        # Behavior 5: server wins — overwrite prose, keep GM Notes, stamp.
        if decision == "pull":
            new_body = _pull_body(old_body, detail.get("description"),
                                  detail.get("descriptionType"), name_by_eid)
            new_node = dict(nd)
            new_node["last_synced"] = now
            actions.append(Action(path, ref, "pull",
                                  new_text=_rebuild(txt, new_node, new_body)))
            continue

        # Behavior 6: push / tie — compare authored prose to the live description.
        # Rewrite vault wikilinks to element links BEFORE conversion; the GM Notes
        # tail is sliced off here so it is neither rewritten nor pushed. The
        # compare always happens in HTML space — raw markdown vs
        # html_to_md(server_html) produced 170 false positives on a real vault —
        # so the server side is folded to HTML when it is stored as Markdown.
        # Only the PUSHED PAYLOAD switches to raw Markdown (#150).
        main = section.gm_notes_split(old_body)[0]
        main = links.rewrite_md_for_push(main, idx, world, url_fmt)
        cand_md = _md.strip_boilerplate(main).strip()
        cand_html = _md.md_to_html(cand_md)
        server_desc = detail.get("description") or ""
        if (detail.get("descriptionType") or "").lower() == "markdown":
            server_html = _md.md_to_html(server_desc)
        else:
            server_html = server_desc
        if (_md.normalize_html_for_compare(cand_html)
                == _md.normalize_html_for_compare(server_html)):
            # Already in sync — stamp last_synced only (no suggestion).
            new_node = dict(nd)
            new_node["last_synced"] = now
            actions.append(Action(path, ref, "in-sync",
                                  new_text=_rebuild(txt, new_node, old_body)))
            continue
        # File a reviewable suggestion; mark pending, do NOT stamp last_synced
        # (the stamp lands on accept/dismiss — Task 9).
        new_node = dict(nd)
        new_node["review_state"] = "pending"
        actions.append(Action(path, ref, "push",
                              new_text=_rebuild(txt, new_node, old_body),
                              suggestion=_build_suggestion(nd, cand_md)))
    return actions


# ---------------- I/O ----------------

def _kind_ep(nd: dict) -> str | None:
    """Resolve the element_kind to its detail endpoint. Nodes store the API
    classifier type verbatim (e.g. "Creature", "LandFeature"); a strict lookup is
    correct — .title() would mangle "LandFeature" to "Landfeature" and miss. An
    unknown/blank kind returns None and the caller reports-and-skips."""
    return suggestions.TYPE_EP.get(nd.get("element_kind") or "")


def _make_fetch(world: str, token: str):
    def fetch(nd: dict):
        ep = _kind_ep(nd)
        eid = nd.get("element_id")
        if not ep or not eid:
            return None, "unknown"
        try:
            el = client._request("GET", f"/world/{world}/{ep}/{eid}", token=token)
        except client.ApiError as e:
            return None, ("deleted" if e.status == 404 else "unknown")
        except ValueError:
            return None, "unknown"
        if not isinstance(el, dict):
            return None, "unknown"
        return el, "ok"
    return fetch


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg sync",
        description="Timestamp last-writer-wins reconciliation of note description "
                    "prose with mobRPG canon. Dry-run by default.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--only", help="restrict to notes whose external_ref/path contains this substring")
    ap.add_argument("--skew", type=float, default=lww.SKEW_SECONDS,
                    help=f"tie window in seconds (default {int(lww.SKEW_SECONDS)})")
    ap.add_argument("--execute", action="store_true",
                    help="write vault changes and submit suggestions (default: dry-run)")
    ap.add_argument("--batch-label", default="sync", help="suggestion batch label")
    args = ap.parse_args(argv)

    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Resolution indexes for link rewriting. `idx` (name-key -> element_id) drives
    # the push rewrite; `name_by_eid` (element_id -> display name) drives the pull
    # rewrite. Both are built from ALL linked notes — a --only-filtered note can
    # still be a valid link target — so they are populated before the filter.
    idx, _linked, _submitted = suggest.node_index(args.vault)
    try:
        notes = []
        name_by_eid: dict[str, str] = {}
        for path, txt, nd in iter_linked_notes(args.vault):
            eid = nd.get("element_id")
            if eid:
                name_by_eid[eid] = _note_name(path, txt)
            if args.only and args.only not in (nd.get("external_ref") or "") and args.only not in path:
                continue
            notes.append((path, txt, nd, os.path.getmtime(path)))
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    fetch = _make_fetch(args.world, token)
    now = lww.now_iso()
    try:
        actions = plan(notes, fetch, now, args.skew,
                       idx=idx, world=args.world, url_fmt=links.URL_FMT,
                       name_by_eid=name_by_eid)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Decision table (always printed; the dry-run surface and the execute log).
    counts: dict[str, int] = {}
    for a in actions:
        counts[a.decision] = counts.get(a.decision, 0) + 1
        print(f"  {a.decision:8} {a.ref}")

    if args.execute:
        # pull and in-sync writes stamp `last_synced`; pin the file mtime to that
        # stamp so decide sees `mtime == last_synced` (skip) on the next run rather
        # than mtime > last_synced (a spurious vault-dirty push). now_iso truncates
        # to whole seconds, so an un-pinned sub-second mtime always reads as newer.
        # The push write only marks review_state pending (no stamp) and is held on
        # later runs, so it needs no pin.
        ls = lww.parse_ts(now)
        for a in actions:
            if a.new_text is not None:
                with open(a.path, "w", encoding="utf-8") as fh:
                    fh.write(a.new_text)
                if a.decision in ("pull", "in-sync") and ls is not None:
                    os.utime(a.path, (ls, ls))

    batch = [a.suggestion for a in actions if a.suggestion is not None]
    if batch:
        request = {"batchLabel": args.batch_label, "suggestions": batch}
        try:
            submit_batch.submit(args.world, request, execute=args.execute)
        except client.ApiError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1

    summary = ", ".join(f"{v} {k}" for k, v in sorted(counts.items())) or "0 notes"
    tag = "" if args.execute else "  [dry-run — no files changed]"
    print(f"\nsync: {summary}{tag}")
    return 0

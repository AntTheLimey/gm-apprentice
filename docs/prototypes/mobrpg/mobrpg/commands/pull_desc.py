"""mobrpg pull-desc — reconcile a note's *description prose* with mobRPG canon.

`pull-canon` reconciles the machine `mobrpg:` node but not the description prose.
This command adds the Plan 2 description content-merge: a recorded canon base
(`canon_html_hash` + `canon_base_md`) lets it tell which side changed since the
last sync, so it can offer the GM a per-entity outcome without clobbering
authored prose.

Two primitives the mobrpg-sync skill drives (the skill is the interactive UI):

  report  (default, read-only): classify every synced note and, for changed
          ones, show base/vault/canon plus a diff.
  --resolve <mode> --only <ref>: apply one entity's outcome
          (take-canon | keep-vault | merge | separate | baseline),
          dry-run by default, writes gated by --execute (vault-only).

Change detection never routes prose through the lossy md<->html converter:
canon-changed compares mobRPG's raw HTML to its recorded hash; vault-changed
compares the current canon-section markdown to the frozen base. See the design
spec 2026-07-19-mobrpg-description-merge-design.md.
"""
from __future__ import annotations

import argparse
import difflib
import glob
import hashlib
import os
import re
import sys
from datetime import datetime, timezone

from mobrpg import client
from mobrpg import md as _md
from mobrpg import merge3
from mobrpg import node
from mobrpg import section
from mobrpg.commands import map_cmd
from mobrpg.commands import suggestions

RESOLVE_MODES = ("take-canon", "keep-vault", "merge", "separate", "baseline")


def html_hash(html: str | None) -> str:
    """sha256 of mobRPG's raw description HTML. Compared to itself across syncs,
    so the lossy converter is never in the change-detection path."""
    return "sha256:" + hashlib.sha256((html or "").strip().encode("utf-8")).hexdigest()


def _norm(s: str | None) -> str:
    """Comparison-only normalization of authored markdown: trim per-line trailing
    whitespace, collapse blank runs, strip ends. No converter round-trip."""
    text = "\n".join(ln.rstrip() for ln in (s or "").splitlines())
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def classify(nd: dict, body: str, live_html: str | None) -> str:
    """Return one of: separate, unbaselined, in-sync, canon-only, vault-only,
    conflict. Pure — the caller supplies the fetched description HTML."""
    if nd.get("description_policy") == "separate":
        return "separate"
    base = nd.get("canon_base_md")
    if base is None:
        return "unbaselined"
    region = section.canon_section(body)[0]
    vault_changed = _norm(region) != _norm(base)
    canon_changed = html_hash(live_html) != nd.get("canon_html_hash")
    if not vault_changed and not canon_changed:
        return "in-sync"
    if canon_changed and not vault_changed:
        return "canon-only"
    if vault_changed and not canon_changed:
        return "vault-only"
    return "conflict"


def resolve(nd: dict, body: str, live_html: str | None, mode: str, now: str):
    """Apply one outcome. Returns (new_node, new_body, note). Pure — no I/O.
    `note` is a human message (e.g. conflict markers left), "" when clean."""
    region, reinsert = section.canon_section(body)
    out = dict(nd)

    if mode == "separate":
        out["description_policy"] = "separate"
        return out, body, ""

    if mode in ("keep-vault", "baseline"):
        # keep-vault: adopt the vault prose and record that we've seen canon,
        # clearing the conflict. baseline: first-time capture (no prior base).
        out["canon_base_md"] = region
        out["canon_html_hash"] = html_hash(live_html)
        out["canon_synced_at"] = now
        return out, body, ""

    if mode == "take-canon":
        new_region = _md.html_to_md(live_html)
        out["canon_base_md"] = new_region
        out["canon_html_hash"] = html_hash(live_html)
        out["canon_synced_at"] = now
        return out, reinsert(new_region), ""

    if mode == "merge":
        canon_md = _md.html_to_md(live_html)
        merged, conflict = merge3.merge3(nd.get("canon_base_md") or "", region, canon_md)
        new_body = reinsert(merged)
        if conflict:
            # Do NOT re-baseline: a marker-laden base would poison every future
            # diff. The entity stays surfaced until the GM cleans the markers.
            return out, new_body, "conflict markers left — resolve them, then re-run"
        out["canon_base_md"] = merged
        out["canon_html_hash"] = html_hash(live_html)
        out["canon_synced_at"] = now
        return out, new_body, ""

    raise ValueError(f"unknown resolve mode: {mode}")


# ---------------- I/O ----------------

def _iter_notes(vault: str):
    """Yield (path, text, node_dict) for every vault note carrying an element_id."""
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for path in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(path, encoding="utf-8").read()
            nd = node.read_node(txt)
            if nd and nd.get("element_id"):
                yield path, txt, nd


def _body_of(txt: str) -> str:
    # node._split_frontmatter anchors on a real "\n---" fence, so a --- rule in
    # the body or a "| --- |" table row inside a single-line node scalar can't
    # fool it (str.split("---") can). `post` starts at the closing "---" fence.
    _, fm_body, post = node._split_frontmatter(txt)
    if fm_body is None:
        return txt
    return post[3:]              # drop the closing "---", keep the rest (incl. \n)


def _rebuild(txt: str, new_node: dict, new_body: str) -> str:
    """Write the updated node into the frontmatter and swap in the new body."""
    txt2 = node.write_node(txt, new_node)
    pre, fm_body, post = node._split_frontmatter(txt2)
    if fm_body is None:
        return txt2
    return pre + fm_body + post[:3] + new_body    # ...--- + new body


def _fetch_description(world: str, nd: dict, token: str):
    """Return (live_html, status). status: ok | deleted | unknown."""
    ep = suggestions.TYPE_EP.get(nd.get("element_kind") or "")
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
    return el.get("description") or "", "ok"


def _diff(a: str, b: str, a_label: str, b_label: str) -> str:
    return "\n".join(difflib.unified_diff(
        (a or "").splitlines(), (b or "").splitlines(),
        fromfile=a_label, tofile=b_label, lineterm=""))


def _report(world: str, vault: str, token: str) -> int:
    counts: dict[str, int] = {}
    for path, txt, nd in _iter_notes(vault):
        body = _body_of(txt)
        live_html, status = _fetch_description(world, nd, token)
        state = "deleted" if status == "deleted" else (
            "unknown" if status == "unknown" else classify(nd, body, live_html))
        counts[state] = counts.get(state, 0) + 1
        ref = nd.get("external_ref") or path
        if state in ("in-sync", "separate"):
            continue
        print(f"\nENTITY {ref} :: {state}")
        if state in ("canon-only", "vault-only", "conflict"):
            region = section.canon_section(body)[0]
            canon_md = _md.html_to_md(live_html)
            print(_diff(nd.get("canon_base_md") or "", region, "base", "vault"))
            print(_diff(nd.get("canon_base_md") or "", canon_md, "base", "mobRPG"))
    summary = ", ".join(f"{v} {k}" for k, v in sorted(counts.items())) or "0 notes"
    print(f"\npull-desc report: {summary}")
    return 0


def _find_note(notes, only):
    """Return (path_or_None, reason). An exact external_ref/path match wins
    outright; otherwise a suffix match resolves only when unambiguous, so a
    short/loose --only can never silently write the wrong note."""
    suffix = []
    for path, txt, nd in notes:
        ref = nd.get("external_ref") or ""
        if only == ref or only == path:
            return path, (path, txt, nd)
        if path.endswith(only) or ref.endswith(only):
            suffix.append((path, txt, nd))
    if len(suffix) == 1:
        return suffix[0][0], suffix[0]
    if len(suffix) > 1:
        return None, f"ambiguous --only {only!r}: matches {len(suffix)} notes"
    return None, f"no synced note matching --only {only!r}"


def _resolve_one(world, vault, token, only, mode, execute) -> int:
    found, detail = _find_note(list(_iter_notes(vault)), only)
    if found is None:
        print(f"ERROR: {detail}", file=sys.stderr)
        return 1
    path, txt, nd = detail
    body = _body_of(txt)
    live_html, status = _fetch_description(world, nd, token)
    if status == "deleted":
        print(f"{nd.get('external_ref')}: canon deleted this element — not merging.")
        return 1
    if status == "unknown":
        print(f"{nd.get('external_ref')}: could not fetch the live element — skipped.")
        return 1
    new_node, new_body, note = resolve(nd, body, live_html, mode, now_iso())
    changed = (new_node != nd) or (new_body != body)
    if execute and changed:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(_rebuild(txt, new_node, new_body))
    tag = "" if execute else "  [dry-run — no files changed]"
    extra = f"  ({note})" if note else ""
    print(f"pull-desc {mode}: {nd.get('external_ref')}{extra}{tag}")
    return 0


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg pull-desc",
        description="Reconcile note description prose with mobRPG canon (Plan 2).")
    ap.add_argument("world")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--resolve", choices=RESOLVE_MODES,
                    help="apply one entity's outcome (needs --only)")
    ap.add_argument("--only", help="external_ref (or path suffix) of the note to resolve")
    ap.add_argument("--execute", action="store_true",
                    help="write vault changes (default: dry-run)")
    args = ap.parse_args(argv)

    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    if args.resolve:
        if not args.only:
            print("ERROR: --resolve requires --only <ref>", file=sys.stderr)
            return 2
        return _resolve_one(args.world, args.vault, token, args.only,
                            args.resolve, args.execute)
    return _report(args.world, args.vault, token)

"""mobrpg pull-canon — pull ratified mobRPG canon down into vault nodes.

mobRPG is canon; the vault is the working surface. This applies the authority
rule per entity review_state: accepted (fill ids), accepted-after-edit / drift
(canon overwrites `determined`), dismissed (record note, preserve vault),
deleted (flag), pending (leave the vault alone). Reads the review queue via the
same endpoint `suggestions` uses. NOT named `reconcile` — that names a different
gm-apprentice concept (canon_status promotion).
"""
from __future__ import annotations

import argparse
import os
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import map_cmd
from mobrpg.commands import suggest


def apply_state(existing: dict, live: dict) -> dict:
    state = live.get("state")
    if state == "pending":
        return existing
    out = dict(existing)
    if state == "deleted":
        out["review_state"] = "deleted"
        out["element_id"] = None
        return out
    if state == "dismissed":
        out["review_state"] = "dismissed"
        out["review_note"] = live.get("review_note") or ""
        return out
    if state == "accepted":
        out["element_id"] = live.get("element_id") or existing.get("element_id")
        live_det = live.get("determined") or {}
        if live_det and live_det != existing.get("determined"):
            out["review_state"] = "edited"
            out["determined"] = dict(live_det)
        else:
            out["review_state"] = "accepted"
        eids = live.get("event_ids") or {}
        rels = []
        for r in existing.get("relationships", []):
            r2 = dict(r)
            key = f"{r.get('predicate')}|{r.get('target')}"
            if key in eids:
                r2["event_id"] = eids[key]
                r2["review_state"] = "accepted"
            rels.append(r2)
        out["relationships"] = rels
        return out
    return existing


_ELEMENTKIND_VAULTKIND = {"Person": "npc", "Political": "location", "LandFeature": "location",
                          "Organization": "faction", "Creature": "creature", "Item": "item"}


def scaffold_note(external_ref, live, namespace):
    _, rel = external_ref.split(":", 1)
    name = live.get("name") or rel.rsplit("/", 1)[-1].replace("_", " ")
    vault_kind = live.get("kind") or _ELEMENTKIND_VAULTKIND.get(
        live.get("element_kind"), "npc")
    n = {
        "world_id": "", "external_ref": external_ref,
        "element_id": live.get("element_id"),
        "element_kind": live.get("element_kind") or "Person",
        "review_state": "accepted", "content_hash": "", "last_synced": "",
        "review_note": "", "determined": dict(live.get("determined") or {}),
        "relationships": [], "languages": [],
    }
    text = (f"---\ntype: {vault_kind}\n" + node.emit_node(n) + f"---\n# {name}\n")
    return rel + ".md", text


def _vault_file(external_ref, vault):
    if not external_ref or ":" not in external_ref:
        return None
    _, rel = external_ref.split(":", 1)
    p = os.path.join(os.path.expanduser(vault), rel + ".md")
    return p if os.path.exists(p) else None


def _fetch_live(world, token):
    """Return {external_ref: live_summary} across Accepted+Dismissed queues.
    live_summary = {state, element_id, determined, review_note, event_ids}."""
    live = {}
    for state in ("Accepted", "Dismissed"):
        try:
            data = client._request(
                "GET", f"/world/{world}/suggestion?reviewState={state}", token=token)
        except (client.ApiError, ValueError):
            continue
        rows = data if isinstance(data, list) else (
            data.get("content", []) if isinstance(data, dict) else [])
        for s in rows:
            ext = s.get("externalRef")
            if not ext:
                continue
            live[ext] = {
                "state": state.lower(),
                "element_id": s.get("resultElementId"),
                "review_note": s.get("reviewNote") or "",
                "determined": {}, "event_ids": {}}
    return live


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg pull-canon",
        description="Pull ratified mobRPG canon down into vault mobrpg: nodes.")
    ap.add_argument("world")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args(argv)
    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    live_by_ref = _fetch_live(args.world, token)
    updated = 0
    for ext, live in live_by_ref.items():
        path = _vault_file(ext, args.vault)
        if not path:
            if live.get("state") == "accepted":
                rel, text = scaffold_note(ext, live, os.path.basename(args.vault))
                dest = os.path.join(os.path.expanduser(args.vault), rel)
                if args.execute and not os.path.exists(dest):
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, "w", encoding="utf-8") as fh:
                        fh.write(text)
                updated += 1
            continue
        txt = open(path, encoding="utf-8").read()
        existing = node.read_node(txt)
        if not existing:
            continue
        newn = apply_state(existing, live)
        if newn == existing:
            continue
        merged = node.write_node(txt, newn)
        if args.execute:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(merged)
        updated += 1
    print(f"pull-canon: {updated} node(s) updated"
          + ("" if args.execute else "  [dry-run — no files changed]"))
    return 0

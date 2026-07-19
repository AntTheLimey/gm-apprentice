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
import json
import os
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import pull_desc
from mobrpg.commands import rel_baseline
from mobrpg.commands import suggest
from mobrpg.commands import suggestions


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


def _scaffoldable(external_ref):
    """True only for refs that safely map to a new vault note. Rejects:
    colon-less refs (scaffold_note would ValueError), reified-relationship Event
    refs (rel-path starts with `rel/` — Events are not notes), and any rel-path
    that would escape the vault via `..`/absolute traversal."""
    if not external_ref or ":" not in external_ref:
        return False
    rel = external_ref.split(":", 1)[1]
    if rel.startswith("rel/"):
        return False
    norm = os.path.normpath(rel)
    if os.path.isabs(norm) or norm == ".." or norm.startswith(".." + os.sep):
        return False
    return True


# Live-element classifier -> vault `determined` key. Attribute relations carry
# the classifier as source.type (lowercased, no separators); item/landfeature
# store their type in a top-level field instead. Confirmed against real payloads
# (Regency Cthulhu, 2026-07-19).
_ATTR_TYPE_DETKEY = {
    "sex": "sex", "race": "race", "profession": "profession",
    "politicaltype": "political_type", "organizationtype": "organization_type",
    "creaturetype": "creature_type",
}


def determined_from_element(element: dict) -> dict:
    """Rebuild the ratified `determined` dict from a live mobRPG element, in the
    same scalar shape `suggest.determined_for` emits, so it can be compared for
    drift. A type with multiple values (e.g. several professions) collapses to a
    sorted comma-joined string — a single value stays scalar (no false drift)."""
    names: dict = {}
    for rel in element.get("relations") or []:
        if not isinstance(rel, dict) or rel.get("type") != "Attribute":
            continue
        src = rel.get("source")
        if not isinstance(src, dict):
            continue
        key = _ATTR_TYPE_DETKEY.get((src.get("type") or "").lower())
        name = src.get("name")
        if key and name:
            names.setdefault(key, []).append(name)
    out = {k: ", ".join(sorted(v)) for k, v in names.items()}
    attrs = element.get("attributes")
    if isinstance(attrs, dict) and attrs.get("itemType"):
        out["item_type"] = attrs["itemType"]
    lft = element.get("landFeatureTypes")
    if isinstance(lft, list) and lft:
        out["land_feature_type"] = ", ".join(sorted(lft))
    return out


def _verify_accepted(world, token, sug, summary):
    """GET the ratified element for an Accepted suggestion so the edited/drift
    and deleted outcomes become reachable. A 404 means canon deleted it; a live
    element supplies `determined`. Other errors leave the row plain-accepted
    (never mistake a transient failure for a deletion)."""
    rid = sug.get("resultElementId")
    pl = sug.get("payload") or {}
    etype = (pl.get("data") or {}).get("type") or sug.get("typeName") or ""
    ep = suggestions.TYPE_EP.get(etype)
    if not rid or not ep:
        return
    try:
        element = client._request("GET", f"/world/{world}/{ep}/{rid}", token=token)
    except client.ApiError as e:
        if e.status == 404:
            summary["state"] = "deleted"
        return
    except ValueError:
        return
    if isinstance(element, dict):
        summary["determined"] = determined_from_element(element)


def _fetch_live(world, token, *, verify=True):
    """Return {external_ref: live_summary} across the Accepted, Dismissed and
    Pending queues (the review-state enum has no Deleted — deletion is detected
    by verifying the accepted element). live_summary =
    {state, element_id, determined, review_note, event_ids}. With verify, each
    Accepted row's element is fetched to populate `determined` (drift) or flag it
    `deleted`; verify=False skips that pass (accepted/dismissed only)."""
    live = {}
    # Precedence is iteration order + first-write-wins: a ref that already has an
    # authoritative Accepted outcome is never shadowed by a later Dismissed or
    # (re-submitted) Pending row for the same externalRef.
    for state in ("Accepted", "Dismissed", "Pending"):
        try:
            data = client._request(
                "GET", f"/world/{world}/suggestion?reviewState={state}", token=token)
        except (client.ApiError, ValueError):
            continue
        rows = data if isinstance(data, list) else (
            data.get("content", []) if isinstance(data, dict) else [])
        for s in rows:
            ext = s.get("externalRef")
            if not ext or ext in live:
                continue
            summary = {
                "state": state.lower(),
                "element_id": s.get("resultElementId"),
                "review_note": s.get("reviewNote") or "",
                "determined": {}, "event_ids": {}}
            if state == "Accepted" and verify:
                _verify_accepted(world, token, s, summary)
            live[ext] = summary
    return live


def run_baseline(world, vault, token, *, execute) -> int:
    """Relationship-baseline pass: read mobRPG's PRE-EXISTING edges among the
    vault's linked elements and stamp `event_id` onto matching node relationships,
    so a subsequent `suggest` skips edges that already exist upstream instead of
    re-proposing them. Vault-write only (dry-run default). See rel_baseline."""
    vault = os.path.expanduser(vault)
    map_path = os.path.join(vault, "_meta", "mobrpg-map.json")
    try:
        mp = json.load(open(map_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading map {map_path}: {e}", file=sys.stderr)
        return 2
    id_by_key, _ = suggest.node_index(vault)
    notes = list(pull_desc._iter_notes(vault))          # (path, txt, node) for every linked note
    try:
        structural, reified, _known = rel_baseline.fetch_upstream(
            world, token, [nd for _, _, nd in notes])
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    stamped_nodes = matched = 0
    reviews: list[str] = []
    for path, txt, nd in notes:
        eids, revs = rel_baseline.match_node(nd, id_by_key, structural, reified, mp)
        reviews += [f"{os.path.relpath(path, vault)}: {r}" for r in revs]
        if not eids:
            continue
        newn = rel_baseline.stamp_baseline(nd, eids)
        if newn == nd:
            continue
        merged = node.write_node(txt, newn)
        if execute:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(merged)
        stamped_nodes += 1
        matched += len(eids)

    reified_edges = sum(len(v) for v in reified.values())
    print(f"pull-canon --baseline: matched {matched} pre-existing upstream "
          f"relationship(s) across {stamped_nodes} node(s)"
          + ("" if execute else "  [dry-run — no files changed]"))
    print(f"  scanned {len(structural)} structural + {reified_edges} reified "
          f"upstream edge(s)")
    for r in reviews:
        print(f"  [review] {r}")
    return 0


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg pull-canon",
        description="Pull ratified mobRPG canon down into vault mobrpg: nodes.")
    ap.add_argument("world")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip the accepted-element verification pass (faster / "
                         "offline; edited-drift and deleted outcomes won't be detected)")
    ap.add_argument("--baseline", action="store_true",
                    help="instead of the review-queue pass, reconcile PRE-EXISTING "
                         "mobRPG relationships against the vault's authored edges and "
                         "stamp their event_ids (so a later suggest skips them). "
                         "Vault-write only; dry-run unless --execute.")
    args = ap.parse_args(argv)
    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if args.baseline:
        return run_baseline(args.world, args.vault, token, execute=args.execute)
    live_by_ref = _fetch_live(args.world, token, verify=not args.no_verify)
    updated = 0
    for ext, live in live_by_ref.items():
        path = _vault_file(ext, args.vault)
        if not path:
            if live.get("state") == "accepted" and _scaffoldable(ext):
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

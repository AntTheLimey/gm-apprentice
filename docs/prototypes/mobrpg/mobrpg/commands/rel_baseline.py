"""Relationship baseline — discover mobRPG's PRE-EXISTING relationships among the
vault's already-linked elements and match them to authored vault relationships, so
`pull-canon --baseline` can stamp `event_id`s on edges that already exist upstream.

Why it's needed: the vault nodes were linked (element_ids) without a relationship
baseline, so every node relationship carries `event_id: null`. `suggest` skips a
relationship only when it's in `node_linked` (already carries an event_id), so with
no baseline it re-proposes every edge — 0 skipped — risking duplicate reified-Event
elements for relationships mobRPG already holds. This pass reads mobRPG's real edge
graph and fills those event_ids.

mobRPG models a relationship two ways (see the server's WorldElementRelationType
{Attribute, Link, Parent, Child, Spouse} and reified Event elements):
  - structural edge — a WorldElementRelation row (Parent/Child/Link/Spouse) with
    its own id, read via GET /world/{id}/{kind}/{eid}/relation (all types, both
    directions); the element-GET body omits these for non-events, so the per-
    element /relation endpoint is required.
  - reified Event — an Event element (eventType) whose participants are Link edges;
    read via the event list/detail endpoints (reused from `pull`).

Folded into the pull-canon verb (--baseline), not a separate verb.
"""
from __future__ import annotations

import re

from mobrpg import client
from mobrpg.commands import map_cmd
from mobrpg.commands import pull
from mobrpg.commands.suggest import _key, _mapped_type

# Structural WorldElementRelation types (entity↔entity), as opposed to reified
# Events. Attribute is a classifier edge, never a vault "relationship", so it is
# not in this set — a relationship predicate never maps to Attribute.
STRUCTURAL = map_cmd.RELATION_TYPES  # {Parent, Child, Link, Spouse}

# node element_kind → API kind path segment for the /relation endpoint.
KIND_PATH = {"Person": "person", "Organization": "organization", "Political": "political",
             "LandFeature": "landfeature", "Item": "item", "Creature": "creature"}

_PAGE = 200


# ---------------- pure index + match ----------------

def build_structural_index(relations_by_element, known_ids) -> dict:
    """{(sourceId, type, targetId): relation_id} for structural edges whose BOTH
    endpoints are known linked elements. A Link edge to an Event (the Event id is
    not a known element) is excluded — that's the reified mechanism. Duplicate
    edges (the same row seen from each endpoint) collapse to the same id."""
    idx: dict = {}
    for rels in relations_by_element.values():
        for r in rels:
            t, s, d = r.get("type"), r.get("sourceId"), r.get("targetId")
            if t in STRUCTURAL and s in known_ids and d in known_ids:
                idx.setdefault((s, t, d), r.get("id"))
    return idx


def build_reified_index(events, known_ids) -> dict:
    """{(frozenset(participants ∩ known), eventType): [event_id, ...]} — a list so
    a caller can flag an ambiguous match (same participants + type on >1 event).
    Events with fewer than two *known* participants are dropped (unmatchable)."""
    idx: dict = {}
    for ev in events:
        parts = frozenset(p for p in ev.get("participants", []) if p in known_ids)
        if len(parts) < 2:
            continue
        idx.setdefault((parts, ev.get("eventType")), []).append(ev.get("id"))
    return idx


def _target_name(raw: str) -> str:
    return re.sub(r"^\[\[|\]\]$", "", (raw or "")).split("|")[0].strip()


def match_node(node, id_by_key, structural_idx, reified_idx, mp) -> tuple[dict, list]:
    """Match one node's relationships against the upstream indexes.

    Returns (event_ids, reviews). `event_ids` is keyed the way pull-canon's node
    stamping expects — ``f"{predicate}|{target}"`` (target raw, with brackets) →
    the upstream id (a structural relation.id or a reified Event id). A relationship
    whose target isn't an upstream element can't pre-exist and is skipped; one that
    already carries an event_id is left alone; an ambiguous reified match (multiple
    upstream events) is reported for review, never auto-stamped."""
    src = node.get("element_id")
    event_ids: dict = {}
    reviews: list = []
    if not src:
        return event_ids, reviews
    for r in node.get("relationships", []):
        if r.get("event_id"):
            continue
        pred = r.get("predicate")
        tgt = id_by_key.get(_key(_target_name(r.get("target"))))
        if not tgt:
            continue
        et = _mapped_type(mp, pred)
        key = f"{pred}|{r.get('target')}"
        if et in STRUCTURAL:
            rid = structural_idx.get((src, et, tgt))
            if rid:
                event_ids[key] = rid
        else:
            hits = reified_idx.get((frozenset({src, tgt}), et)) or []
            if len(hits) == 1:
                event_ids[key] = hits[0]
            elif len(hits) > 1:
                reviews.append(
                    f"{_target_name(r.get('target'))} ({pred}/{et}): "
                    f"{len(hits)} upstream events match — review, not auto-stamped")
    return event_ids, reviews


def stamp_baseline(node, event_ids) -> dict:
    """Return the node with `event_id` + rel-level `review_state='accepted'` set on
    each relationship whose key is in `event_ids`; every node-level field and every
    other relationship is left exactly as-is. Returns the input unchanged when
    there is nothing to stamp."""
    if not event_ids:
        return node
    out = dict(node)
    rels = []
    for r in node.get("relationships", []):
        r2 = dict(r)
        key = f"{r.get('predicate')}|{r.get('target')}"
        if key in event_ids and not r2.get("event_id"):
            r2["event_id"] = event_ids[key]
            r2["review_state"] = "accepted"
        rels.append(r2)
    out["relationships"] = rels
    return out


# ---------------- network reads ----------------

def _get_relations(world, kind, eid, token) -> list:
    """All WorldElementRelation edges touching one element (both directions, all
    types), paged. Returns [{id, sourceId, targetId, type}, ...]."""
    out, page = [], 0
    while True:
        try:
            r = client._request("GET", f"/world/{world}/{kind}/{eid}/relation",
                                 token=token, query={"page": page, "size": _PAGE})
        except (client.ApiError, ValueError):
            break
        content = r.get("content", r) if isinstance(r, dict) else r
        if not isinstance(content, list) or not content:
            break
        out.extend(content)
        if not isinstance(r, dict) or r.get("last") is True or len(content) < _PAGE:
            break
        page += 1
    return out


def _fetch_events(world, token) -> list:
    """Every Event element as {id, eventType, participants:[element_id,...]},
    reusing pull's event list/detail readers. Participants are the Link-edge ends."""
    out = []
    for it in pull._list_all(world, "event", token):
        eid = it.get("id")
        if not eid:
            continue
        ev = pull._get_one(world, "event", eid, token)
        parts = [(rel["targetId"] if rel.get("sourceId") == eid else rel.get("sourceId"))
                 for rel in (ev.get("relations") or []) if rel.get("type") == "Link"]
        out.append({"id": eid, "eventType": ev.get("eventType"),
                    "participants": [p for p in parts if p]})
    return out


def fetch_upstream(world, token, nodes) -> tuple[dict, dict, set]:
    """Read mobRPG's existing relationships among the linked `nodes` (each a node
    dict with element_id + element_kind). Returns (structural_idx, reified_idx,
    known_ids). One /relation call per element for structural edges + one event
    walk for reified relationships."""
    known = {n["element_id"] for n in nodes if n.get("element_id")}
    rels_by: dict = {}
    for n in nodes:
        eid = n.get("element_id")
        kind = KIND_PATH.get(n.get("element_kind"))
        if not eid or not kind:
            continue
        rels_by[eid] = _get_relations(world, kind, eid, token)
    structural = build_structural_index(rels_by, known)
    reified = build_reified_index(_fetch_events(world, token), known)
    return structural, reified, known

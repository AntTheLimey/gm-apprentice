"""mobrpg submit-batch — submit a pre-built suggestion batch from a JSON file.

`mobrpg suggest` only emits bare single CreateElements. This submits an arbitrary
SubmitSuggestionsRequest — a *compound* batch with classifier-Type creates,
Attribute edges, relationships (reified Event + Link), and in-batch dependency
wiring (client-local ref + "suggestion:<ref>"). It is the transport the
map-driven "complete data" push is built on; for now it takes a hand/script-built
JSON file so we can exercise full compound groups end-to-end.

    POST /world/{worldId}/suggestion   body = the file's JSON

File shape (SubmitSuggestionsRequest):
    { "batchLabel": "...",
      "suggestions": [ { "ref","operation","payload","dependsOn","externalRef" }, ... ] }

Mutating: dry-run by default (prints a summary, no call); --execute submits.

    mobrpg submit-batch <worldId> batch.json               # dry-run summary
    mobrpg submit-batch <worldId> batch.json --execute
"""

from __future__ import annotations

import argparse
import json
import sys

from mobrpg import client


def _summarize(req: dict) -> None:
    items = req.get("suggestions", [])
    print(f"batchLabel={req.get('batchLabel')!r}  n={len(items)}")
    for it in items:
        op = it.get("operation")
        pl = it.get("payload") or {}
        if op == "CreateElement":
            d = (pl.get("data") or {}).get("type")
            print(f"  {it.get('ref',''):6} CreateElement  {d:14} {pl.get('name')!r}"
                  f"  externalRef={it.get('externalRef') or '-'}")
        else:  # relation ops
            print(f"  {'':6} {op:14} {pl.get('type','')}  "
                  f"{pl.get('sourceRef')} -> {pl.get('targetRef')}  deps={it.get('dependsOn')}")


def classify(resp: dict) -> tuple[list, list, list]:
    """Split a submit response into (stored, corrected, claimed) rows.

    `claimed` are rows the server refused to store because their externalRef is
    already held by a terminal (Accepted/Dismissed) suggestion — the GM will
    never see them. Callers that record local state about a submitted proposal
    must consult this: a note marked `pending` against a claimed row points at a
    suggestion that does not exist upstream and can never be adjudicated.
    """
    rows = resp.get("suggestions", []) if isinstance(resp, dict) else []
    updated = set(resp.get("updatedIds") or []) if isinstance(resp, dict) else set()
    stored, corrected, claimed = [], [], []
    for s in rows:
        if s.get("id") in updated:
            corrected.append(s)
        elif (s.get("reviewState") or "").lower() in ("accepted", "dismissed"):
            claimed.append(s)
        else:
            stored.append(s)
    return stored, corrected, claimed


def refused_refs(resp: dict) -> set:
    """The externalRefs the server positively refused to store.

    Deliberately the refused set and not the landed set: a response that does
    not enumerate rows at all still means the POST succeeded, and treating that
    as "nothing landed" would stop every note being marked pending. Only a row
    we can see was bounced is withheld.
    """
    _stored, _corrected, claimed = classify(resp)
    return {s.get("externalRef") for s in claimed if s.get("externalRef")}


def submit(world: str, request: dict, *, execute: bool, index: int | None = None) -> dict:
    """Dry-run summary (returns {}) or POST one SubmitSuggestionsRequest (returns the response).
    Shared by `submit-batch` (file in) and `suggest` (built in memory)."""
    tag = f"batch {index}: " if index is not None else ""
    n = len(request.get("suggestions", []))
    if not execute:
        print(f"{tag}DRY-RUN — would POST this batch (add --execute to submit):")
        _summarize(request)
        return {}
    token = client.get_access_token()
    print(f"→ {tag}POST /world/{world}/suggestion  n={n} ...")
    resp = client._request("POST", f"/world/{world}/suggestion", token=token, body=request)
    resolved = resp.get("resolvedRefs", {}) if isinstance(resp, dict) else {}
    stored, corrected, claimed = classify(resp)
    parts = [f"{len(stored)} stored"]
    if corrected:
        parts.append(f"{len(corrected)} corrected in place")
    if claimed:
        parts.append(f"{len(claimed)} already claimed (NOT submitted)")
    print(f"  ✓ {', '.join(parts)}")
    for s in stored + corrected:
        pl = s.get("payload") or {}
        print(f"      - {s.get('reviewState','?'):8} {s.get('operation',''):14} "
              f"id={s.get('id')} {pl.get('name') or ''}")
    if claimed:
        print(f"  ⚠ {len(claimed)} externalRef(s) already claimed by a terminal "
              f"(Accepted/Dismissed) suggestion — these proposals were NOT stored "
              f"and the GM will never see them:")
        for s in claimed:
            print(f"      - {s.get('externalRef') or '?'}  "
                  f"(claimed by a {s.get('reviewState','?')} row)")
    if resolved:
        print(f"  resolvedRefs (deduped/swallowed → existing element id): {resolved}")
    return resp if isinstance(resp, dict) else {}


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg submit-batch",
        description="Submit a pre-built suggestion batch (compound: types, edges, relationships) "
                    "from a JSON file. Dry-run by default.",
    )
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("file", help="path to a SubmitSuggestionsRequest JSON file")
    ap.add_argument("--execute", action="store_true", help="actually submit (default: dry-run)")
    args = ap.parse_args(argv)

    try:
        with open(args.file, encoding="utf-8") as fh:
            req = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading {args.file}: {e}", file=sys.stderr)
        return 2

    try:
        submit(args.world, req, execute=args.execute)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0

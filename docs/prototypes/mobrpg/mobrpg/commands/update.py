"""mobrpg update — edit a Pending suggestion's payload (PUT, whole-payload replace).

Wraps `PUT /world/{worldId}/suggestion/{id}` (UpdateSuggestionRequest). The API
replaces the payload WHOLESALE (there is no partial/PATCH), so the file must be a
complete UpdateSuggestionRequest — `{"payload": <full SuggestionPayload>}` — not a
delta. Only legal while the suggestion is Pending; needs ReadWriteDelete.

Note: update can only change the create's own fields (name/description/altNames/
inline data such as Person.languages or Item.attributes). It CANNOT add classifier
Type edges (Race/Sex/Profession/…) — those are separate elements + Attribute edges,
so use a fresh compound batch (submit-batch) for those.

Tip: fetch the current payload first (GET /world/{id}/suggestion/{id}), edit it,
and pass the whole thing back.

Mutating: dry-run by default; --execute to PUT; prod also needs MOBRPG_ALLOW_PROD_WRITES=1.

    mobrpg update <worldId> <suggestionId> update.json            # dry-run
    MOBRPG_ALLOW_PROD_WRITES=1 mobrpg update <worldId> <suggestionId> update.json --execute
"""

from __future__ import annotations

import argparse
import json
import sys

from mobrpg import client


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg update",
        description="Replace a Pending suggestion's payload from a JSON file "
                    "({\"payload\": <full SuggestionPayload>}). Whole-payload replace.",
    )
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("suggestion", help="suggestion id")
    ap.add_argument("file", help="UpdateSuggestionRequest JSON ({\"payload\": {...}})")
    ap.add_argument("--execute", action="store_true", help="actually PUT (default: dry-run)")
    args = ap.parse_args(argv)

    try:
        with open(args.file) as fh:
            body = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading {args.file}: {e}", file=sys.stderr)
        return 2
    if "payload" not in body:
        print("ERROR: file must be {\"payload\": <SuggestionPayload>} (whole-payload replace)",
              file=sys.stderr)
        return 2

    path = f"/world/{args.world}/suggestion/{args.suggestion}"
    if not args.execute:
        pl = body["payload"]
        print(f"DRY-RUN: would PUT {path}")
        print(f"  payload.name={pl.get('name')!r}  data.type={(pl.get('data') or {}).get('type')}")
        print("  (add --execute to apply; prod also needs MOBRPG_ALLOW_PROD_WRITES=1)")
        return 0

    try:
        client.assert_writes_allowed()
        token = client.get_access_token()
        print(f"→ PUT {path} ...")
        resp = client._request("PUT", path, token=token, body=body)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    if isinstance(resp, dict):
        print(f"  ✓ {resp.get('reviewState','?')}  id={resp.get('id')}")
    return 0

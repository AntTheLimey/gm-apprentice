"""mobrpg review — act on a suggestion's review lifecycle (GM side).

The write counterpart to `mobrpg suggestions` (which only reads). Wraps the
reviewer endpoints, all of which need ReadWriteDelete on the world:

    accept    POST /world/{worldId}/suggestion/{id}/accept      (no body; irreversible)
    dismiss   POST /world/{worldId}/suggestion/{id}/dismiss      (optional {reviewNote})
    reinstate POST /world/{worldId}/suggestion/{id}/reinstate    (Dismissed -> Pending)

Mutating: like the other write verbs it is dry-run by default (prints what it
would do) and needs --execute to fire; against prod it also needs
MOBRPG_ALLOW_PROD_WRITES=1 (client.assert_writes_allowed()).

Note on dismiss+resubmit: a dismissed suggestion KEEPS its externalRef claimed
(unique index on (world_id, external_ref) over all live rows), so re-pushing the
same vault entity under the same externalRef resolves to the dismissed row rather
than creating a fresh Pending one. To genuinely re-propose a corrected version,
`reinstate` it (then edit), or push under a different externalRef.

Examples:
    mobrpg review <worldId> <suggestionId> dismiss --note "needs a type" --execute
    mobrpg review <worldId> <suggestionId> reinstate --execute
    MOBRPG_ALLOW_PROD_WRITES=1 mobrpg review <worldId> <suggestionId> accept --execute
"""

from __future__ import annotations

import argparse
import json
import sys

from mobrpg import client

ACTIONS = ("accept", "dismiss", "reinstate")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg review",
        description="Accept, dismiss, or reinstate a suggestion (needs ReadWriteDelete). "
                    "Dry-run by default; add --execute to actually act.",
    )
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("suggestion", help="suggestion id")
    ap.add_argument("action", choices=ACTIONS)
    ap.add_argument("--note", default="", help="reviewNote (dismiss only)")
    ap.add_argument("--execute", action="store_true", help="actually act (default: dry-run)")
    args = ap.parse_args(argv)

    path = f"/world/{args.world}/suggestion/{args.suggestion}/{args.action}"
    body = {"reviewNote": args.note} if (args.action == "dismiss" and args.note) else None

    if not args.execute:
        print(f"DRY-RUN: would POST {path}" + (f"  body={body}" if body else ""))
        print("  (add --execute to act; prod also needs MOBRPG_ALLOW_PROD_WRITES=1)")
        return 0

    try:
        client.assert_writes_allowed()
        token = client.get_access_token()
        print(f"→ POST {path} ...")
        resp = client._request("POST", path, token=token, body=body)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("  (review actions need ReadWriteDelete on the world)", file=sys.stderr)
        return 1

    if isinstance(resp, dict):
        print(f"  ✓ {resp.get('reviewState', '?')}  id={resp.get('id')}"
              f"  resultElementId={resp.get('resultElementId') or '-'}")
        print(json.dumps(resp, indent=2, ensure_ascii=False))
    else:
        print(f"  ✓ done: {resp}")
    return 0

"""mobrpg catalog — list the elements of one kind in a world.

A thin, read-only window onto any /world/{worldId}/{kind} collection, so you can
see what already exists before pushing (e.g. which political Types or land
features are present, to avoid minting duplicates). Handles the API's default
page size of 20 by requesting a large page (--size, default 200).

    GET /world/{worldId}/{kind}?size={n}&page=0

`kind` is any element sub-resource, including the classifier Type endpoints:
    person  political  political/type  landfeature  organization  organization/type
    creature  creature/type  item  event  term  culture  currency  calendar
    person/race  person/profession  writing  map  color  icon

Read-only. Examples:
    mobrpg catalog <worldId> political/type
    mobrpg catalog <worldId> landfeature
    mobrpg catalog <worldId> person --size 500 --json
"""

from __future__ import annotations

import argparse
import json
import sys

from mobrpg import client


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg catalog",
        description="List the elements of one kind in a world (names + ids). "
                    "Useful for seeing existing classifier Types / land features "
                    "before pushing suggestions.",
    )
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("kind", help="element kind, e.g. political/type, landfeature, person")
    ap.add_argument("--size", type=int, default=200,
                    help="page size (default 200; the API defaults to only 20)")
    ap.add_argument("--json", action="store_true", help="print full element JSON")
    ap.add_argument("--names-only", action="store_true", help="print only names, one per line")
    args = ap.parse_args(argv)

    kind = args.kind.strip("/")
    try:
        token = client.get_access_token()
        data = client._request(
            "GET", f"/world/{args.world}/{kind}?size={args.size}&page=0", token=token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    items = data if isinstance(data, list) else data.get("content", []) if isinstance(data, dict) else []
    items = sorted(items, key=lambda x: (x.get("name") or "") if isinstance(x, dict) else "")

    if args.json:
        print(json.dumps(items, indent=2, ensure_ascii=False))
        return 0
    if args.names_only:
        for e in items:
            print(e.get("name") if isinstance(e, dict) else e)
        return 0

    print(f"{kind}: {len(items)}")
    for e in items:
        if isinstance(e, dict):
            print(f"  - {(e.get('name') or ''):32} id={e.get('id')}")
        else:
            print(f"  - {e}")
    if len(items) == args.size:
        print(f"  (returned exactly --size={args.size}; there may be more — raise --size)",
              file=sys.stderr)
    return 0

"""mobrpg catalog — list the elements of one kind in a world.

A thin, read-only window onto any /world/{worldId}/{kind} collection, so you can
see what already exists before pushing (e.g. which political Types or land
features are present, to avoid minting duplicates). Handles the API's default
page size of 20 by requesting a large page (--size, default 200), and follows
`page.totalPages` so a world larger than one page is never truncated.

    GET /world/{worldId}/{kind}?size={n}&page={n}

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


def _fetch_all(path: str, size: int, token: str) -> list:
    """Fetch every page of a catalog collection.

    Handles a bare-list response and a Spring page envelope ({content,
    page.totalPages}). Deliberately STRICT, unlike `map_cmd._fetch_all`: an
    ApiError propagates so `run` can report a failure and exit non-zero. A
    catalog that silently returned a partial list would be read as "these are
    all the types that exist", which is exactly the reading that leads to
    minting a duplicate Type.
    """
    out, page = [], 0
    while True:
        data = client._request(
            "GET", f"{path}?size={size}&page={page}", token=token)
        if isinstance(data, list):
            out.extend(data)
            break  # a bare list is unpaged
        if not isinstance(data, dict):
            break
        out.extend(data.get("content", []))
        total = (data.get("page") or {}).get("totalPages", 1)
        if page >= total - 1:
            break
        page += 1
    return out


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
        items = _fetch_all(f"/world/{args.world}/{kind}", args.size, token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

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
    return 0

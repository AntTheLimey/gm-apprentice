"""mobrpg whoami / worlds — print the authenticated user and their worlds."""

from __future__ import annotations

import argparse
import json
import sys

from mobrpg import client


def run(argv: list[str]) -> int:
    argparse.ArgumentParser(
        prog="mobrpg whoami",
        description="Print the authenticated user and the worlds they can see.",
    ).parse_args(argv)

    try:
        access = client.get_access_token()

        print("→ GET /user/me ...")
        me = client.whoami(access)
        print("  ✓ " + json.dumps({k: me.get(k) for k in ("id", "email", "firstName", "lastName")}))

        print("→ GET /world ...")
        worlds = client.list_worlds(access)
        content = worlds.get("content", worlds) if isinstance(worlds, dict) else worlds
        n = len(content) if isinstance(content, list) else "?"
        print(f"  ✓ {n} world(s):")
        for w in (content or [])[:25]:
            if isinstance(w, dict):
                print(f"      - {w.get('name')!r:30} id={w.get('id')} "
                      f"system={w.get('gameSystemType')}")
        return 0
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

#!/usr/bin/env python3
"""
Pull entity images from a mobRPG world into a gm-apprentice vault.

mobRPG stores uploads per-entity in the detail response's `files[]` array
(type "Image", public S3 URLs) — the list endpoints omit it, so this walks
every entity detail. For each image it downloads to
`_attachments/<category>/<vault-basename>.png` (category by kind: person →
characters, organization → factions, political/landfeature → locations,
item → items) and fills the vault file's `portrait: ""` frontmatter when the
entity is linked (its element_id appears in a vault `mobrpg:` node). Existing
attachments are never overwritten (a colliding name gets a " (mobRPG)" suffix)
and a non-empty portrait field is left alone — both cases are reported instead.

The mobRPG element_id -> vault-file map comes from the vault's own `mobrpg:`
nodes (the single source of truth); there is no sidecar crosswalk.

World-level AI art lives separately at /world/{w}/generated/images and is
attached to no entity; it is listed at the end for manual placement.

Usage:
    export MOBRPG_TOKEN="$(grep '^AccessToken,' ~/Downloads/credentials.csv | cut -d, -f2)"
    python3 pull_images.py <worldId> <vault_dir>            # dry-run
    python3 pull_images.py <worldId> <vault_dir> --execute
"""
from __future__ import annotations
import os, re, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import smoketest as api
from mobrpg import node as _node

KINDS = ["person", "organization", "political", "landfeature", "item"]
FOLDER = {"person": "characters", "organization": "factions",
          "political": "locations", "landfeature": "locations", "item": "items"}


def node_paths(vault: str) -> dict:
    """Map mobRPG element_id -> vault-relative path, read from the vault's own
    `mobrpg:` nodes. Replaces the retired sidecar crosswalk as the id->file map."""
    out = {}
    for root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if not d.startswith(".")]   # skip .obsidian, .git, etc.
        for fn in files:
            if not fn.endswith(".md"):
                continue
            full = os.path.join(root, fn)
            try:
                nd = _node.read_node(open(full, encoding="utf-8").read())
            except OSError:
                continue
            if nd and nd.get("element_id"):
                out[nd["element_id"]] = os.path.relpath(full, vault)
    return out


def scan(world: str, token: str) -> list[dict]:
    found = []
    for kind in KINDS:
        page = 0
        while True:
            r = api._request("GET", f"/world/{world}/{kind}?page={page}&size=50", token=token)
            if not isinstance(r, dict):
                break
            for e in r.get("content", []):
                d = api._request("GET", f"/world/{world}/{kind}/{e['id']}", token=token) or {}
                imgs = [f for f in (d.get("files") or []) if f.get("type") == "Image"]
                if imgs:
                    found.append({"kind": kind, "id": e["id"], "name": d.get("name"),
                                  "images": [{"name": f.get("name"), "url": f.get("url")} for f in imgs]})
            if page >= r.get("page", {}).get("totalPages", 1) - 1:
                break
            page += 1
    return found


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    world, vault = sys.argv[1], sys.argv[2]
    execute = "--execute" in sys.argv
    token = os.environ.get("MOBRPG_TOKEN")
    if not token:
        print("set MOBRPG_TOKEN", file=sys.stderr)
        return 2
    id_to_path = node_paths(vault)

    found = scan(world, token)
    print(f"{len(found)} entities with images")
    wired = occupied = saved = 0
    for ent in found:
        vp = id_to_path.get(ent["id"])
        base = os.path.splitext(os.path.basename(vp))[0] if vp else ent["name"]
        folder = FOLDER[ent["kind"]]
        for i, img in enumerate(ent["images"]):
            ext = os.path.splitext(img["url"].split("?")[0])[1] or ".png"
            fname = f"{base}{'' if i == 0 else f' {i + 1}'}{ext}"
            dest = os.path.join(vault, "_attachments", folder, fname)
            if os.path.exists(dest):
                fname = fname.replace(ext, f" (mobRPG){ext}")
                dest = os.path.join(vault, "_attachments", folder, fname)
            rel = f"_attachments/{folder}/{fname}"
            fresh = not os.path.exists(dest)
            if execute and fresh:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                urllib.request.urlretrieve(img["url"], dest)
            if not vp or i > 0:
                saved += 1
                print(f"  saved only ({'no vault file' if not vp else 'extra image'}): {ent['name']} -> {rel}")
                continue
            full = os.path.join(vault, vp)
            text = open(full).read()
            if re.search(r'^portrait:\s*""\s*$', text, flags=re.M):
                if execute:
                    text = re.sub(r'^portrait:\s*""\s*$', f'portrait: "{rel}"', text, count=1, flags=re.M)
                    open(full, "w").write(text)
                wired += 1
            elif re.search(r'^portrait:\s*"[^"]+"\s*$', text, flags=re.M):
                occupied += 1
                print(f"  portrait already set, saved beside it: {ent['name']} -> {rel}")
    print(f"{'wired' if execute else 'would wire'}: {wired}, occupied: {occupied}, saved-only: {saved}")

    gen = api._request("GET", f"/world/{world}/generated/images", token=token) or {}
    for g in gen.get("content", []):
        print(f"world-level generated image (attach by hand): {g.get('url')}")
    if not execute:
        print("dry-run — pass --execute to download and wire")
    return 0


if __name__ == "__main__":
    sys.exit(main())

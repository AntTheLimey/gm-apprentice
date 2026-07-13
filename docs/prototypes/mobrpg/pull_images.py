#!/usr/bin/env python3
"""
Pull entity images from a mobRPG world into a gm-apprentice vault.

mobRPG stores uploads per-entity in the detail response's `files[]` array
(type "Image", public S3 URLs) — the list endpoints omit it, so this walks
every entity detail. For each image it downloads to
`_attachments/<category>/<vault-basename>.png` (category by kind: person →
characters, organization → factions, political/landfeature → locations,
item → items) and fills the vault file's `portrait: ""` frontmatter when the
entity is in the crosswalk. Existing attachments are never overwritten (a
colliding name gets a " (mobRPG)" suffix) and a non-empty portrait field is
left alone — both cases are reported instead.

World-level AI art lives separately at /world/{w}/generated/images and is
attached to no entity; it is listed at the end for manual placement.

Usage:
    export MOBRPG_TOKEN="$(grep '^AccessToken,' ~/Downloads/credentials.csv | cut -d, -f2)"
    python3 pull_images.py <worldId> <vault_dir> <crosswalk.json>            # dry-run
    python3 pull_images.py <worldId> <vault_dir> <crosswalk.json> --execute
"""
from __future__ import annotations
import json, os, re, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import smoketest as api

KINDS = ["person", "organization", "political", "landfeature", "item"]
FOLDER = {"person": "characters", "organization": "factions",
          "political": "locations", "landfeature": "locations", "item": "items"}


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
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    world, vault, xwalk_path = sys.argv[1], sys.argv[2], sys.argv[3]
    execute = "--execute" in sys.argv
    token = os.environ.get("MOBRPG_TOKEN")
    if not token:
        print("set MOBRPG_TOKEN", file=sys.stderr)
        return 2
    crosswalk = json.load(open(xwalk_path)) if os.path.exists(xwalk_path) else {}

    found = scan(world, token)
    print(f"{len(found)} entities with images")
    wired = occupied = saved = 0
    for ent in found:
        xw = crosswalk.get(ent["id"])
        vp = xw["vault_path"] if xw else None
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

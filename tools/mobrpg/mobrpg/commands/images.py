"""mobrpg images — pull entity images from a mobRPG world into a vault.

mobRPG stores uploads per-entity in the detail response's `files[]` array
(type "Image", public S3 URLs) — the list endpoints omit it, so this walks
every entity detail. For each image it downloads to
`_attachments/<category>/<vault-basename><ext>` (category by kind: person ->
characters, organization -> factions, political/landfeature -> locations,
item -> items) and fills the vault file's `portrait: ""` frontmatter when the
entity is linked (its element_id appears in a vault `mobrpg:` node). Existing
attachments are never overwritten (a colliding name gets a " (mobRPG)" suffix)
and a non-empty portrait field is left alone — both cases are reported instead.

The mobRPG element_id -> vault-file map comes from the vault's own `mobrpg:`
nodes (the single source of truth); there is no sidecar crosswalk.

World-level AI art lives separately at /world/{w}/generated/images and is
attached to no entity; it is listed at the end for manual placement.

GET-only against mobRPG; writes only the vault (dry-run default, --execute to
apply).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.request

from mobrpg import client
from mobrpg import vault as _vault

KINDS = ["person", "organization", "political", "landfeature", "item"]
FOLDER = {"person": "characters", "organization": "factions",
          "political": "locations", "landfeature": "locations", "item": "items"}


def _download(url: str) -> bytes:
    """Fetch raw bytes from a URL. Factored out so tests can stub the network
    without ever hitting a live server."""
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read()


def _node_paths(vault_dir: str) -> dict:
    """mobRPG element_id -> vault-relative path, read from the vault's own
    `mobrpg:` nodes (the single source of truth)."""
    return {nd["element_id"]: os.path.relpath(path, vault_dir)
            for path, _txt, nd in _vault.iter_linked_notes(vault_dir)
            if nd.get("element_id")}


def _scan(world: str, token: str) -> list[dict]:
    """Every entity, across all kinds, that carries at least one Image file."""
    found = []
    for kind in KINDS:
        page = 0
        while True:
            r = client._request("GET", f"/world/{world}/{kind}", token=token,
                                 query={"page": page, "size": 50})
            if not isinstance(r, dict):
                break
            for e in r.get("content", []):
                d = client._request("GET", f"/world/{world}/{kind}/{e['id']}", token=token) or {}
                imgs = [f for f in (d.get("files") or []) if f.get("type") == "Image"]
                if imgs:
                    found.append({"kind": kind, "id": e["id"], "name": d.get("name"),
                                  "images": [{"name": f.get("name"), "url": f.get("url")}
                                             for f in imgs]})
            total = (r.get("page") or {}).get("totalPages", 1)
            if page >= total - 1:
                break
            page += 1
    return found


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg images",
        description="Pull entity images from a mobRPG world into the vault's "
                    "_attachments/ folders and fill empty portrait: fields.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--execute", action="store_true",
                     help="download and write files (default: dry-run)")
    args = ap.parse_args(argv)

    vault_dir = os.path.expanduser(args.vault)
    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    id_to_path = _node_paths(vault_dir)

    found = _scan(args.world, token)
    print(f"{len(found)} entities with images")
    wired = occupied = saved = 0
    for ent in found:
        vp = id_to_path.get(ent["id"])
        base = os.path.splitext(os.path.basename(vp))[0] if vp else ent["name"]
        folder = FOLDER[ent["kind"]]
        for i, img in enumerate(ent["images"]):
            ext = os.path.splitext(img["url"].split("?")[0])[1] or ".png"
            fname = f"{base}{'' if i == 0 else f' {i + 1}'}{ext}"
            dest = os.path.join(vault_dir, "_attachments", folder, fname)
            if os.path.exists(dest):
                fname = fname.replace(ext, f" (mobRPG){ext}")
                dest = os.path.join(vault_dir, "_attachments", folder, fname)
            rel = f"_attachments/{folder}/{fname}"
            fresh = not os.path.exists(dest)
            if args.execute and fresh:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                data = _download(img["url"])
                with open(dest, "wb") as fh:
                    fh.write(data)
            if not vp or i > 0:
                saved += 1
                print(f"  saved only ({'no vault file' if not vp else 'extra image'}): "
                      f"{ent['name']} -> {rel}")
                continue
            full = os.path.join(vault_dir, vp)
            text = open(full, encoding="utf-8").read()
            if re.search(r'^portrait:\s*""\s*$', text, flags=re.M):
                if args.execute:
                    text = re.sub(r'^portrait:\s*""\s*$', f'portrait: "{rel}"',
                                   text, count=1, flags=re.M)
                    open(full, "w", encoding="utf-8").write(text)
                wired += 1
            elif re.search(r'^portrait:\s*"[^"]+"\s*$', text, flags=re.M):
                occupied += 1
                print(f"  portrait already set, saved beside it: {ent['name']} -> {rel}")
    print(f"{'wired' if args.execute else 'would wire'}: {wired}, "
          f"occupied: {occupied}, saved-only: {saved}")

    gen = client._request("GET", f"/world/{args.world}/generated/images", token=token) or {}
    for g in gen.get("content", []) if isinstance(gen, dict) else []:
        print(f"world-level generated image (attach by hand): {g.get('url')}")
    if not args.execute:
        print("dry-run — pass --execute to download and wire")
    return 0

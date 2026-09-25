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

Without --push it is GET-only against mobRPG and writes only the vault
(dry-run default, --execute to apply).

`--push` goes the other way (#185): each linked note's `portrait:` and body
image embeds are uploaded to its element through mobRPG's three-step upload
(POST .../file/url for a signed URL, PUT the bytes to it, PUT .../complete).
It is a direct write, so it needs write access to the element; there is no
suggestion-queue path for files yet. An image whose bytes already match one of
the element's files is skipped, so pushing is idempotent and never re-uploads
an image this command pulled down. mobRPG caps a non-admin at two files per
element; a push over the cap is reported, not attempted.

Body embeds are collected only from the player-visible part of the note — the
same split `sync` applies to prose before a push: vault-only H2 sections
(`## GM Notes` and the rest of `vault_only_sections`) are dropped, then any
`<!-- gm-only -->` fenced block is stripped. `portrait:` is always eligible (it
is never GM-only). This keeps a secret reference image out of the shared world
even when it resolves to a real `_attachments/` file.
"""
from __future__ import annotations

import argparse
import hashlib
import mimetypes
import os
import re
import sys
import urllib.parse
import urllib.request

from mobrpg import client
from mobrpg import md as _md
from mobrpg import section as _section
from mobrpg import vault as _vault

KINDS = ["person", "organization", "political", "landfeature", "item"]
FOLDER = {"person": "characters", "organization": "factions",
          "political": "locations", "landfeature": "locations", "item": "items"}


_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _check_url(url: str) -> str:
    """Reject any image URL we are not willing to fetch.

    The URL comes from the world API, so it is attacker-controllable by whoever
    can edit the world. `urlopen` speaks `file:` (and `ftp:`) as happily as
    `https:`, so an unchecked URL turns `images --execute` into a local-file
    read or a probe of whatever the operator's machine can reach. Allow https
    everywhere, and http only against a loopback host so the dev/local
    environment preset still works. Credentials in the URL are always refused.
    """
    parts = urllib.parse.urlsplit(url)
    scheme, host = parts.scheme.lower(), (parts.hostname or "").lower()
    if parts.username or parts.password:
        raise ValueError(f"refusing image URL with embedded credentials: {url!r}")
    if scheme == "https" and host:
        return url
    if scheme == "http" and host in _LOCAL_HOSTS:
        return url
    raise ValueError(f"refusing non-https image URL: {url!r}")


def _download(url: str) -> bytes:
    """Fetch raw bytes from a URL. Factored out so tests can stub the network
    without ever hitting a live server."""
    with urllib.request.urlopen(_check_url(url), timeout=30) as resp:  # noqa: S310 - scheme checked
        return resp.read()


_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _safe_component(name: str) -> str:
    """Reduce an untrusted string to one filename component.

    Separators, `..`, and characters that would break the quoted YAML the path
    is later written into are all removed, so the result can neither climb out
    of `_attachments/` nor terminate the `portrait: "..."` value early.
    """
    cleaned = _UNSAFE_NAME.sub("_", name).replace("..", "_").strip(" .")
    return cleaned or "unnamed"


def _safe_ext(ext: str) -> str:
    """Keep only a plain `.abc` extension carved off an untrusted URL."""
    return ext if re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext or "") else ".png"


def _within(root: str, path: str) -> bool:
    """True when `path` resolves inside `root`."""
    target = os.path.realpath(path)
    return target == root or target.startswith(root + os.sep)


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


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# mobRPG refuses a third file on an element for anyone but an admin.
FILE_CAP = 2
_EMBED = re.compile(r"!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")
_PORTRAIT = re.compile(r'^portrait:\s*"?([^"\n]*?)"?\s*$', re.M)
# node element_kind -> API endpoint segment.
_KIND_EP = {"person": "person", "organization": "organization", "political": "political",
            "landfeature": "landfeature", "item": "item", "creature": "creature"}


def _attachment_index(vault_dir: str) -> dict:
    """lower-cased basename -> [vault paths] under _attachments/, for resolving a
    bare `portrait: Vela.png` or `![[Vela.png]]` the way Obsidian does."""
    idx: dict = {}
    root = os.path.join(vault_dir, "_attachments")
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            idx.setdefault(f.lower(), []).append(os.path.join(dirpath, f))
    return idx


def _local_images(vault_dir: str, txt: str, index: dict,
                  vault_only: tuple = _section.DEFAULT_VAULT_ONLY) -> tuple[list[str], list[str]]:
    """(image files this note shows, references that didn't resolve to one file).
    The portrait first, then body embeds, each once. Only files inside the vault.

    `portrait:` is always eligible — it is never GM-only. Body embeds are
    collected only from the player-visible part of the body: the same split
    `sync`'s `_push_candidate` applies (`section.split_vault_only` to drop the
    vault-only H2 sections, then `md.strip_boilerplate` to drop `<!-- gm-only
    -->` fenced blocks). An embed the GM keeps secret under `## GM Notes` or a
    gm-only fence must never be uploaded to the shared world, even when it
    resolves to a real attachment."""
    refs = []
    m = _PORTRAIT.search(txt.split("\n---", 1)[0] if txt.startswith("---") else "")
    if m and m.group(1).strip():
        refs.append(m.group(1).strip())
    public_body = _section.split_vault_only(_vault.body_of(txt), vault_only)[0]
    public_body = _md.strip_boilerplate(public_body)
    refs += [r.strip() for r in _EMBED.findall(public_body)]
    root = os.path.realpath(vault_dir)
    found, unresolved = [], []
    for ref in refs:
        if os.path.splitext(ref)[1].lower() not in IMAGE_EXTS:
            continue
        direct = os.path.join(vault_dir, ref)
        hits = [direct] if os.path.isfile(direct) else index.get(os.path.basename(ref).lower(), [])
        if len(hits) != 1 or not _within(root, hits[0]):
            unresolved.append(ref)
            continue
        if hits[0] not in found:
            found.append(hits[0])
    return found, unresolved


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _put(url: str, data: bytes, content_type: str, meta: dict) -> None:
    """PUT the bytes to the signed URL, with the headers the signature covers."""
    req = urllib.request.Request(_check_url(url), data=data, method="PUT")
    req.add_header("Content-Type", content_type)
    for k, v in (meta or {}).items():
        req.add_header(f"x-amz-meta-{k}", str(v))
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 - scheme checked
        if resp.status >= 300:
            raise client.ApiError(resp.status, "", "signed upload URL")


def _upload(world: str, kind_ep: str, eid: str, path: str, token: str) -> dict:
    """mobRPG's three-step element file upload. Returns the attached file."""
    with open(path, "rb") as fh:
        data = fh.read()
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    base = f"/world/{world}/{kind_ep}/{eid}/file/url"
    signed = client._request("POST", base, token=token, body={
        "fileName": os.path.basename(path), "contentType": ctype,
        "contentLength": len(data)}) or {}
    if not signed.get("signedUrl") or not signed.get("key"):
        raise ValueError("mobRPG returned no upload URL for this file")
    _put(signed["signedUrl"], data, signed.get("contentType") or ctype,
         signed.get("metaData") or {})
    return client._request("PUT", f"{base}/complete", token=token,
                           body={"key": signed["key"]}) or {}


def run_push(args, token: str) -> int:
    vault_dir = os.path.expanduser(args.vault)
    index = _attachment_index(vault_dir)
    vault_only = _vault.vault_only_sections(vault_dir)
    uploaded = present = capped = denied = failed = 0
    for path, txt, nd in _vault.iter_linked_notes(vault_dir):
        name = os.path.splitext(os.path.basename(path))[0].replace("_", " ")
        if args.only and args.only.lower() not in name.lower():
            continue
        images, unresolved = _local_images(vault_dir, txt, index, vault_only)
        for ref in unresolved:
            print(f"  not found (or more than one match) under _attachments/: {name} -> {ref}")
        if not images:
            continue
        kind_ep = _KIND_EP.get(str(nd.get("element_kind") or "").lower())
        if not kind_ep:
            print(f"  SKIPPED (unknown element kind {nd.get('element_kind')!r}): {name}")
            continue
        eid = nd["element_id"]
        try:
            detail = client._request("GET", f"/world/{args.world}/{kind_ep}/{eid}", token=token) or {}
        except client.ApiError as e:
            print(f"  FAILED reading the element: {name}: HTTP {e.status}", file=sys.stderr)
            failed += 1
            continue
        files = detail.get("files") or []
        remote = set()
        for f in files:
            if f.get("type") == "Image" and f.get("url"):
                try:
                    remote.add(_sha(_download(f["url"])))
                except (ValueError, OSError) as e:
                    print(f"  could not read an existing image on {name} ({e}); "
                          "it can't be compared", file=sys.stderr)
        count = len(files)
        for img in images:
            rel = os.path.relpath(img, vault_dir)
            with open(img, "rb") as fh:
                local_sha = _sha(fh.read())
            if local_sha in remote:
                present += 1
                continue
            if count >= FILE_CAP:
                capped += 1
                print(f"  NOT PUSHED (element already has {count} files, mobRPG's limit "
                      f"for non-admins): {name} <- {rel}")
                continue
            if not args.execute:
                print(f"  would upload: {name} <- {rel}")
                uploaded += 1
                count += 1
                remote.add(local_sha)
                continue
            try:
                _upload(args.world, kind_ep, eid, img, token)
            except client.ApiError as e:
                if e.status in (401, 403, 404):
                    denied += 1
                    print(f"  NOT PUSHED (HTTP {e.status}: you need write access to this "
                          f"element; ask the world owner to upload it): {name} <- {rel}")
                else:
                    failed += 1
                    print(f"  FAILED (HTTP {e.status}): {name} <- {rel}", file=sys.stderr)
                continue
            except (ValueError, OSError) as e:
                failed += 1
                print(f"  FAILED ({e}): {name} <- {rel}", file=sys.stderr)
                continue
            uploaded += 1
            count += 1
            remote.add(local_sha)
            print(f"  uploaded: {name} <- {rel}")
    print(f"{'uploaded' if args.execute else 'would upload'}: {uploaded}, "
          f"already there: {present}, over the file cap: {capped}, "
          f"no write access: {denied}, failed: {failed}")
    if not args.execute:
        print("dry-run — pass --execute to upload")
    return 1 if failed or denied else 0


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg images",
        description="Pull entity images from a mobRPG world into the vault's "
                    "_attachments/ folders and fill empty portrait: fields, or "
                    "with --push, upload the vault's images to their elements.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--execute", action="store_true",
                     help="download and write files, or upload with --push (default: dry-run)")
    ap.add_argument("--push", action="store_true",
                    help="upload each linked note's portrait and image embeds to its "
                         "element (needs write access to the element)")
    ap.add_argument("--only", default="",
                    help="with --push: only notes whose name contains this text")
    args = ap.parse_args(argv)
    if args.only and not args.push:
        ap.error("--only needs --push")

    vault_dir = os.path.expanduser(args.vault)
    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    if args.push:
        return run_push(args, token)

    id_to_path = _node_paths(vault_dir)

    found = _scan(args.world, token)
    print(f"{len(found)} entities with images")
    wired = occupied = saved = 0
    for ent in found:
        vp = id_to_path.get(ent["id"])
        # For an unlinked entity the stem is the API-supplied name, and the
        # extension is carved off the API-supplied URL — both untrusted. Reduce
        # each to a single safe filename component before it reaches a path or
        # a quoted YAML value.
        base = _safe_component(
            os.path.splitext(os.path.basename(vp))[0] if vp else ent["name"])
        folder = FOLDER[ent["kind"]]
        attach_root = os.path.realpath(os.path.join(vault_dir, "_attachments"))
        for i, img in enumerate(ent["images"]):
            ext = _safe_ext(os.path.splitext(img["url"].split("?")[0])[1])
            fname = f"{base}{'' if i == 0 else f' {i + 1}'}{ext}"
            dest = os.path.join(vault_dir, "_attachments", folder, fname)
            if os.path.exists(dest):
                fname = f"{base}{'' if i == 0 else f' {i + 1}'} (mobRPG){ext}"
                dest = os.path.join(vault_dir, "_attachments", folder, fname)
            if not _within(attach_root, dest):
                print(f"  SKIPPED (path escapes _attachments): {ent['name']}",
                      file=sys.stderr)
                continue
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

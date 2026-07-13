#!/usr/bin/env python3
"""
Push vault entities INTO a mobRPG world (reverse direction of etl_extract.py).

Reverse ETL: vault markdown entity -> mobRPG Create*Request payload.
  npc/pc   -> POST /world/{w}/person
  location -> POST /world/{w}/political
  faction  -> POST /world/{w}/organization
  item     -> POST /world/{w}/item
  creature -> POST /world/{w}/creature

Lossy by design (schema-map.md): rich frontmatter + markdown body collapse into
mobRPG's single HTML `description`. GM Notes are excluded. Relationships are NOT
pushed here (deferred to a second pass).

SAFETY: defaults to --dry-run (writes payloads to disk, no API calls). Use
--execute to actually create. --limit N caps the count. --only NAME does one.
`--execute` also refuses to run against prod unless MOBRPG_ALLOW_PROD_WRITES=1
(see smoketest.py's assert_writes_allowed()).

This is the DIRECT-CREATE path (one POST per entity, immediately live). For
submitting entities as review-queue SUGGESTIONS instead (batched, idempotent
on externalRef, does not require write permission on the world), see the
sibling script `push_suggestions.py`.

Environment + auth are resolved by smoketest.py (`import smoketest as api`):
MOBRPG_ENV=dev|prod selects BASE/CLIENT_ID/REDIRECT_URI, then MOBRPG_TOKEN or
MOBRPG_EMAIL+MOBRPG_PASSWORD authenticates against it.

Usage:
    python3 push_to_mobrpg.py <worldId> --chapter chapter-1 --dry-run
    MOBRPG_ENV=dev MOBRPG_EMAIL=gm@localhost MOBRPG_PASSWORD=local \
        python3 push_to_mobrpg.py <worldId> --chapter chapter-1 --execute --limit 1
"""
from __future__ import annotations
import argparse, glob, json, os, re, sys
import smoketest as api

VAULT = os.path.expanduser("~/Documents/CTHULHU/Canticle")
KIND_EP = {"npc": "person", "pc": "person", "location": "political",
           "faction": "organization", "organization": "organization",
           "item": "item", "creature": "creature"}
FOLDERS = {"Characters/NPCs": "npc", "Characters/PCs": "pc", "Locations": "location",
           "Factions & Organizations": "faction", "Items & Artifacts": "item",
           "Creatures": "creature"}


def parse(path: str) -> dict:
    txt = open(path).read()
    fm, body = "", txt
    if txt.startswith("---"):
        _, fm, body = txt.split("---", 2)
    def field(name):
        m = re.search(rf"^{name}:\s*(.+)$", fm, re.M)
        return m.group(1).strip().strip('"') if m else ""
    aliases = re.findall(r'-\s*"?([^"\n]+?)"?\s*$', re.search(r"aliases:(.*?)(?=\n\w|\Z)", fm, re.S).group(1)) if "aliases:" in fm else []
    aliases = [a for a in (re.findall(r'aliases:\s*\[([^\]]*)\]', fm) or [""])[0].split(",") if a.strip()] or aliases
    return {"type": field("type"), "tags": field("tags"),
            "aliases": [a.strip().strip('"') for a in aliases if a.strip()], "body": body}


def md_to_html(body: str) -> str:
    """Vault markdown body -> simple HTML for mobRPG description. Drops boilerplate + GM Notes."""
    # cut everything from these housekeeping headings onward / between
    for h in ["## Appearances", "## Source References", "## GM Notes", "## Notes"]:
        i = body.find(h)
        if i != -1:
            # drop that section up to the next H2 or EOF
            nxt = body.find("\n## ", i + 3)
            body = body[:i] + (body[nxt:] if nxt != -1 and h in ("## Appearances", "## Source References") else "")
    body = re.sub(r"```.*?```", "", body, flags=re.S)          # drop dataview/code
    body = re.sub(r"!\[\[[^\]]+\]\]", "", body)                # drop embeds
    body = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", lambda m: m.group(2).replace("_", " "), body)
    body = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).replace("_", " "), body)
    body = re.sub(r"^#\s+.*$", "", body, flags=re.M)           # drop leading H1 title (== name)
    out = []
    for blk in re.split(r"\n\s*\n", body.strip()):
        blk = blk.strip()
        if not blk:
            continue
        m = re.match(r"^(#{2,4})\s+(.*)$", blk)
        if m:
            lvl = len(m.group(1)); out.append(f"<h{lvl}>{m.group(2).strip()}</h{lvl}>"); continue
        blk = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", blk)
        blk = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)", r"<em>\1</em>", blk)
        blk = blk.replace("\n", "<br>")                        # single newlines -> <br>
        out.append(f"<p>{blk}</p>")
    return "".join(out) or "<p></p>"


def display_name(path: str, info: dict) -> str:
    base = os.path.splitext(os.path.basename(path))[0].replace("_", " ")
    return base


def norm(n: str) -> str:
    n = n.replace("_", " ").lower()
    n = re.sub(r"\b(mr|mrs|miss|dr|lord|lady|sir|the|of|st)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n).replace("ae", "").replace("æ", "")


def mob_existing(world: str, token: str) -> set:
    out = set()
    for ep in set(KIND_EP.values()):
        try:
            r = api._request("GET", f"/world/{world}/{ep}", token=token, query={"page": 0, "size": 300})
            c = r.get("content", r) if isinstance(r, dict) else r
            for it in (c or []):
                out.add(norm(it.get("name") or it.get("title") or ""))
        except Exception:
            pass
    return out


def build_payload(path: str, info: dict) -> dict:
    name = display_name(path, info)
    return {"name": name, "altNames": info["aliases"], "description": md_to_html(info["body"])}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("world")
    ap.add_argument("--chapter", required=True, help="e.g. chapter-1")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="./push_out")
    args = ap.parse_args()
    token = api.get_access_token()
    if args.execute:
        api.assert_writes_allowed()

    existing = mob_existing(args.world, token)
    cand = []
    for folder, kind in FOLDERS.items():
        for p in glob.glob(os.path.join(VAULT, folder, "*.md")):
            info = parse(p)
            if args.chapter not in info["tags"]:
                continue
            nm = display_name(p, info)
            if args.only and args.only.lower() not in nm.lower():
                continue
            if norm(nm) in existing:
                continue   # already in mobRPG
            cand.append((p, kind, info))
    cand.sort(key=lambda x: x[0])
    if args.limit:
        cand = cand[:args.limit]

    os.makedirs(args.out, exist_ok=True)
    results = []
    for p, kind, info in cand:
        ep = KIND_EP[kind]
        payload = build_payload(p, info)
        rec = {"name": payload["name"], "kind": kind, "endpoint": f"/world/{args.world}/{ep}",
               "payload": payload}
        if args.execute:
            try:
                resp = api._request("POST", f"/world/{args.world}/{ep}", token=token, body=payload)
                rec["created_id"] = (resp or {}).get("id"); rec["status"] = "created"
            except Exception as e:
                rec["status"] = "ERROR"; rec["error"] = str(e)[:300]
        else:
            rec["status"] = "dry-run"
        results.append(rec)
        print(f"  [{rec['status']}] {kind:8} {payload['name']}" + (f"  id={rec.get('created_id')}" if rec.get("created_id") else ""))

    json.dump(results, open(os.path.join(args.out, f"push-{args.chapter}.json"), "w"),
              indent=2, ensure_ascii=False)
    print(f"\n{'EXECUTED' if args.execute else 'DRY-RUN'}: {len(results)} entities "
          f"({sum(1 for r in results if r['status']=='ERROR')} errors). -> {args.out}/push-{args.chapter}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Create relationships for already-pushed vault entities, as mobRPG events, and
write the resulting event ID back into the vault frontmatter `mobrpg:` node.

mobRPG models a relationship as a reified `event` (join entity): an event with
an `eventType` (the 7-enum) + two `Link` edges to the participants. For each
vault frontmatter relationship we:
  1. POST /world/{w}/event   {name, description, altNames, eventType, title}
     (description is NOT NULL in prod — always send it)
  2. POST /world/{w}/event/{eventId}/relation {targetId: subjectId, type: Link}
  3. POST /world/{w}/event/{eventId}/relation {targetId: targetId,  type: Link}
  4. write `mobrpg_event_id: "<id>"` into that relationship block in the vault file

Predicate -> eventType from gm-apprentice-ontology.json. tone/strength/prose go
into the event description (mobRPG has no field). Only links when BOTH endpoints
exist in mobRPG. Idempotent: a relationship that already has `mobrpg_event_id`
is skipped. Defaults to dry-run; --execute writes (to mobRPG AND the vault).

Usage: python3 push_relationships.py <worldId> --chapter chapter-1 [--execute]
"""
from __future__ import annotations
import argparse, collections, glob, json, os, re
import smoketest as api

VAULT = os.path.expanduser("~/Documents/CTHULHU/Canticle")
FOLDERS = {"Characters/NPCs": "npc", "Characters/PCs": "pc", "Locations": "location",
           "Factions & Organizations": "faction", "Items & Artifacts": "item",
           "Creatures": "creature"}
ONTO = json.load(open(os.path.join(os.path.dirname(__file__), "gm-apprentice-ontology.json")))
PRED2ET = {p["type"]: p["mobrpg_event_type"] for p in ONTO["predicates"]}


def norm(n: str) -> str:
    n = re.sub(r"\.md$", "", n).replace("_", " ").lower().replace("æ", "ae")
    n = re.sub(r"\b(mr|mrs|miss|dr|lord|lady|sir|the|of|st)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def mob_index(world, token):
    idx = {}
    for kind in ["person", "political", "organization", "item", "creature", "landfeature"]:
        r = api._request("GET", f"/world/{world}/{kind}", token=token, query={"page": 0, "size": 400})
        c = r.get("content", r) if isinstance(r, dict) else r
        for it in (c or []):
            nm = it.get("name") or it.get("title")
            if nm and it.get("id"):
                idx[norm(nm)] = it["id"]
    return idx


def parse_rels(fm: str):
    """Yield (target_raw, type, desc, tone, strength, already_has_id) per relationship."""
    m = re.search(r"^relationships:\s*\n(.*?)(?=^\S|\Z)", fm, re.S | re.M)
    if not m:
        return []
    out = []
    for blk in re.split(r"\n\s*-\s+target:", m.group(1)):
        if "[[" not in blk:
            continue
        t = re.search(r"\[\[([^\]]+)\]\]", blk)
        if not t:
            continue
        out.append({
            "target": t.group(1).split("|")[0],
            "type": (re.search(r"type:\s*(\S+)", blk) or [None, "associated_with"])[1],
            "desc": (re.search(r'description:\s*"?(.*?)"?\s*$', blk, re.M) or [None, ""])[1].strip(),
            "tone": (re.search(r"tone:\s*(\S+)", blk) or [None, ""])[1],
            "strength": (re.search(r"strength:\s*(\S+)", blk) or [None, ""])[1],
            "has_id": bool(re.search(r"mobrpg_event_id:", blk)),
        })
    return out


def write_back(path: str, target_raw: str, event_id: str) -> bool:
    """Insert `mobrpg_event_id` into the first matching relationship block lacking one."""
    lines = open(path).read().split("\n")
    out, done = [], False
    for i, ln in enumerate(lines):
        out.append(ln)
        if done:
            continue
        m = re.search(r"^(\s*)-\s+target:\s*\"?\[\[" + re.escape(target_raw), ln)
        if m:
            # don't double-insert: peek ahead for an existing id before the next entry
            blk = "\n".join(lines[i:i + 8])
            if "mobrpg_event_id:" in blk.split("- target:", 1)[-1].split("\n- ")[0]:
                done = True
                continue
            out.append(f'{m.group(1)}  mobrpg_event_id: "{event_id}"')
            done = True
    if done:
        open(path, "w").write("\n".join(out))
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("world")
    ap.add_argument("--chapter", required=True)
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    W, tok, DO = args.world, os.environ["MOBRPG_TOKEN"], args.execute
    idx = mob_index(W, tok)

    planned, skipped_missing, skipped_done = [], [], 0
    for folder in FOLDERS:
        for p in glob.glob(os.path.join(VAULT, folder, "*.md")):
            txt = open(p).read()
            if args.chapter not in txt:
                continue
            fm = txt.split("---", 2)[1] if txt.startswith("---") else ""
            subj_name = os.path.splitext(os.path.basename(p))[0].replace("_", " ")
            subj_id = idx.get(norm(subj_name))
            if not subj_id:
                continue
            for r in parse_rels(fm):
                if r["has_id"]:
                    skipped_done += 1
                    continue
                tgt_id = idx.get(norm(r["target"]))
                tgt_disp = r["target"].replace("_", " ")
                if not tgt_id:
                    skipped_missing.append(f"{subj_name} --{r['type']}--> {tgt_disp}")
                    continue
                et = PRED2ET.get(r["type"], "Generic")
                meta = [x for x in (f"tone: {r['tone']}" if r["tone"] else "",
                                    f"strength: {r['strength']}" if r["strength"] else "") if x]
                desc = (r["desc"] or r["type"]) + (f" ({', '.join(meta)})" if meta else "")
                planned.append({"path": p, "subj": subj_name, "subj_id": subj_id,
                                "pred": r["type"], "et": et, "target": tgt_disp,
                                "target_raw": r["target"], "tgt_id": tgt_id,
                                "name": f"{subj_name}, {r['type']} {tgt_disp}",
                                "description": f"<p>{desc}</p>", "title": r["type"]})

    print(f"{'EXECUTE' if DO else 'DRY-RUN'} chapter={args.chapter}")
    print(f"  planned: {len(planned)} | target-missing: {len(skipped_missing)} | already-linked: {skipped_done}")
    print("  by eventType:", dict(collections.Counter(p["et"] for p in planned)))
    for p in planned[:20]:
        print(f"    {p['subj']} --{p['pred']}[{p['et']}]--> {p['target']}")
    if len(planned) > 20:
        print(f"    ... +{len(planned)-20} more")

    if args.limit:
        planned = planned[:args.limit]
    if DO:
        created = 0
        for p in planned:
            try:
                ev = api._request("POST", f"/world/{W}/event", token=tok,
                                  body={"name": p["name"], "altNames": [], "eventType": p["et"],
                                        "title": p["title"], "description": p["description"]})
                eid = ev["id"]
                for end in (p["subj_id"], p["tgt_id"]):
                    api._request("POST", f"/world/{W}/event/{eid}/relation", token=tok,
                                 body={"targetId": end, "type": "Link"})
                write_back(p["path"], p["target_raw"], eid)
                created += 1
            except Exception as e:
                print(f"    ERROR {p['name']}: {str(e)[:120]}")
        print(f"  created {created} relationship-events (+ wrote mobrpg_event_id back to vault)")

    os.makedirs("push_out", exist_ok=True)
    json.dump({"planned": planned, "skipped_missing": skipped_missing},
              open(f"push_out/relationships-{args.chapter}.json", "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()

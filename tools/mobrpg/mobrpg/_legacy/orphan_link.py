#!/usr/bin/env python3
"""
Auto-link obvious orphan entities after a mobRPG import, and emit:
  1. the vault edits (added `relationships`),
  2. a linking report (linked + still-orphan),
  3. the mobRPG API calls that would add the same relationships to the Space
     world (generated, NOT executed — we only have Read access there).

Conservative, structural rules only:
  - "<System> <ROMAN>"            planet  -> part_of "<System> System"
  - "<System> <ROMAN> <LETTER>"   moon    -> part_of "<System> <ROMAN>"  (else system)
  - "<System> <LETTER>"           body    -> part_of "<System> System"
  - "... Gate ..." / "<Sys> Gate" jump pt -> part_of "<System> System"
  - "<System>ian Belt"/"<Sys> Belt"       -> part_of "<System> System"
  - ship item with "built by X"/"by X"    -> created (manufacturer)
Only links when the TARGET entity already exists (no new broken links).

Usage: python3 orphan_link.py space_extract.json /path/to/vault out_dir
"""
from __future__ import annotations
import json, os, re, sys, glob

ROMAN = r"(?:I{1,3}|IV|VI{0,3}|IX|XI{0,2})"
SYSTEMS = ["Corwin", "Eris", "Thides"]


def vault_entity_names(vault: str) -> set:
    out = set()
    for d in ["Characters/NPCs", "Characters/PCs", "Locations",
              "Factions & Organizations", "Items & Artifacts", "Heritages", "Creatures"]:
        for p in glob.glob(os.path.join(vault, d, "**", "*.md"), recursive=True):
            out.add(os.path.splitext(os.path.basename(p))[0])
    return out


def vault_has_rels(vault: str) -> set:
    """Names whose VAULT file already has a relationship target. Orphan status
    must be judged from the live vault, NOT the mobRPG extract — a merged file
    can carry vault relationships while its mobRPG record looks like an orphan."""
    out = set()
    for d in ["Characters/NPCs", "Characters/PCs", "Locations",
              "Factions & Organizations", "Items & Artifacts", "Heritages", "Creatures"]:
        for p in glob.glob(os.path.join(vault, d, "**", "*.md"), recursive=True):
            if re.search(r'^\s*-\s*target:\s*"\[\[', open(p).read(), flags=re.M):
                out.add(os.path.splitext(os.path.basename(p))[0])
    return out


def derive_parent(name: str, exists: set) -> str | None:
    for sys_ in SYSTEMS:
        sysname = f"{sys_} System"
        if name == sysname or name == sys_:
            return None
        # moon: "<Sys> <ROMAN> <LETTER>"
        m = re.fullmatch(rf"{sys_}\s+({ROMAN})\s+([A-Z])", name)
        if m:
            parent = f"{sys_} {m.group(1)}"
            return parent if parent in exists else (sysname if sysname in exists else None)
        # planet: "<Sys> <ROMAN>"
        if re.fullmatch(rf"{sys_}\s+{ROMAN}", name):
            return sysname if sysname in exists else None
        # body: "<Sys> <LETTER>"
        if re.fullmatch(rf"{sys_}\s+[A-Z]", name):
            return sysname if sysname in exists else None
        # gate: contains "Gate" and the system token
        if "Gate" in name and name.startswith(sys_):
            return sysname if sysname in exists else None
        # belt: "<Sys>ian Belt" or "<Sys> Belt"
        if re.search(rf"{sys_}(ian)?\s+Belt", name):
            return sysname if sysname in exists else None
    return None


def derive_maker(desc: str, exists: set) -> str | None:
    """Ship description mentions its manufacturer: 'built by X' / 'by X'."""
    if not desc:
        return None
    for m in re.finditer(r"\b(?:built|build|made|manufactured)\s+by\s+([A-Z][\w&\- ]+?)(?:[,.\n]| are | is | these)", desc):
        cand = m.group(1).strip()
        # try progressively shorter prefixes against known entities
        words = cand.split()
        for n in range(len(words), 0, -1):
            guess = " ".join(words[:n])
            if guess in exists:
                return guess
    return None


def add_relationship(text: str, target: str, rtype: str, desc: str) -> str:
    block = (f"relationships:\n"
             f"  - target: \"[[{target}]]\"\n"
             f"    type: {rtype}\n"
             f"    tone: neutral\n"
             f"    strength: 6\n"
             f"    bidirectional: false\n"
             f"    description: {json.dumps(desc, ensure_ascii=False)}")
    if re.search(r"^relationships:\s*\[\]\s*$", text, flags=re.M):
        return re.sub(r"^relationships:\s*\[\]\s*$", block, text, count=1, flags=re.M)
    # append under existing relationships:
    return re.sub(r"^(relationships:\s*\n)", r"\1" + block.split("\n", 1)[1] + "\n",
                  text, count=1, flags=re.M)


def main() -> int:
    extract = json.load(open(sys.argv[1]))
    vault, outdir = sys.argv[2], sys.argv[3]
    by_name = {e["name"]: e for e in extract["entities"]}
    id_of = {e["name"]: e["id"] for e in extract["entities"]}
    exists = vault_entity_names(vault)
    already_linked = vault_has_rels(vault)   # judge orphan status from the vault

    linked, still = [], []
    for e in extract["entities"]:
        name, kind = e["name"], e["kind"]
        if e.get("relationships") or name in already_linked:
            continue  # not an orphan (per live vault state)
        target = rtype = None
        if kind in ("landfeature", "political"):
            p = derive_parent(name, exists)
            if p:
                target, rtype, why = p, "part_of", "structural containment"
        elif kind == "item":
            mk = derive_maker(e.get("body_md", ""), exists)
            if mk:
                target, rtype, why = mk, "created", "manufacturer named in description"
        if not target:
            still.append((kind, name))
            continue
        # edit the vault file
        # locate the file
        folder = {"landfeature": "Locations", "political": "Locations",
                  "item": "Items & Artifacts"}[kind]
        path = os.path.join(vault, folder, f"{name}.md")
        if not os.path.exists(path):
            still.append((kind, name)); continue
        txt = open(path).read()
        open(path, "w").write(add_relationship(txt, target, rtype, "auto-linked: " + why))
        linked.append({"entity": name, "kind": kind, "type": rtype, "target": target,
                       "subj_id": id_of.get(name), "obj_id": id_of.get(target)})

    os.makedirs(outdir, exist_ok=True)
    # report
    rep = [f"# Orphan auto-linking report — {len(linked)} linked, {len(still)} still orphan\n"]
    rep.append("## Linked\n")
    rep.append("| entity | type | → target |\n|---|---|---|")
    for l in linked:
        rep.append(f"| {l['entity']} | {l['type']} | {l['target']} |")
    rep.append("\n## Still orphan (need manual judgement)\n")
    for k, n in sorted(still):
        rep.append(f"- [{k}] {n}")
    open(os.path.join(outdir, "orphan-linking-report.md"), "w").write("\n".join(rep) + "\n")

    # mobRPG API calls to mirror these links (Generic events; Read-only here → for Tim)
    calls = ["#!/usr/bin/env bash",
             "# Generated mobRPG API calls to add the auto-linked relationships to the",
             "# Space world. We have READ-only access — Tim (owner) must run these.",
             "# Each relationship = a Generic event join with two Link participants.",
             'BASE=https://www.mobrpg.com/api',
             'W=a254e424-6a9e-493c-aa8e-4e76e4824fc2',
             ': "${MOBRPG_TOKEN:?set MOBRPG_TOKEN with write access}"', ""]
    for l in linked:
        calls.append(
            f'# {l["entity"]} --{l["type"]}--> {l["target"]}\n'
            f'curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" '
            f'-H "Content-Type: application/json" -d \'{json.dumps({"name": f"{l['entity']} {l['type']} {l['target']}", "altNames": [], "eventType": "Generic", "title": l["type"]})}\'\n'
            f'#   then add Link relations to subject={l["subj_id"]} and object={l["obj_id"]}')
    open(os.path.join(outdir, "mobrpg-add-relationships.sh"), "w").write("\n".join(calls) + "\n")
    # also machine-readable
    json.dump({"linked": linked, "still_orphan": still},
              open(os.path.join(outdir, "orphan-linking.json"), "w"), indent=2, ensure_ascii=False)

    print(f"linked {len(linked)}, still orphan {len(still)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""mobrpg link-orphans — auto-link obvious orphan entities after a mobRPG
import/extract, and write a report of what was (or would be) linked.

Conservative, structural rules only, evaluated against the `--systems` names
given on the command line (there is no hardcoded system list):
  - "<System> <ROMAN>"            planet  -> part_of "<System> System"
  - "<System> <ROMAN> <LETTER>"   moon    -> part_of "<System> <ROMAN>"  (else system)
  - "<System> <LETTER>"           body    -> part_of "<System> System"
  - "... Gate ..." / "<Sys> Gate" jump pt -> part_of "<System> System"
  - "<System>ian Belt"/"<Sys> Belt"       -> part_of "<System> System"
  - ship item with "built by X"/"by X"    -> created (manufacturer)
Only links when the TARGET entity already exists in the vault (no new broken
links). Orphan status is judged from the live vault, not the extract, so a
merged note can already carry a relationship even when its mobRPG record
looks orphaned.

Writes `orphan-linking-report.md` + `orphan-linking.json` to `--out`. Vault
edits (adding `relationships:` frontmatter) are gated on `--execute`, same as
every other vault-mutating verb. No script or API-call output is generated —
an added relationship shows up in the vault's own frontmatter, and `suggest`
is the sanctioned path that pushes it upstream.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

from mobrpg.commands import map_cmd

ROMAN = r"(?:I{1,3}|IV|VI{0,3}|IX|XI{0,2})"

# Which vault folder to open when writing back a link for a given extract
# entity `kind`. This is the mobRPG entity-kind vocabulary (landfeature,
# political, item, ...), distinct from map_cmd.FOLDERS' vault-kind values
# (npc/pc/location/faction/item/creature) — it says where a NAMED file lives,
# not which folders to enumerate.
_WRITE_FOLDER = {"landfeature": "Locations", "political": "Locations",
                 "item": "Items & Artifacts"}


def vault_entity_names(vault: str) -> set:
    out = set()
    for folder in map_cmd.FOLDERS:
        for p in glob.glob(os.path.join(vault, folder, "*.md")):
            out.add(os.path.splitext(os.path.basename(p))[0])
    return out


def vault_has_rels(vault: str) -> set:
    """Names whose VAULT file already has a relationship target. Orphan status
    must be judged from the live vault, NOT the mobRPG extract — a merged file
    can carry vault relationships while its mobRPG record looks like an orphan."""
    out = set()
    for folder in map_cmd.FOLDERS:
        for p in glob.glob(os.path.join(vault, folder, "*.md")):
            if re.search(r'^\s*-\s*target:\s*"\[\[', open(p, encoding="utf-8").read(), flags=re.M):
                out.add(os.path.splitext(os.path.basename(p))[0])
    return out


def derive_parent(name: str, exists: set, systems: list[str]) -> str | None:
    for sys_ in systems:
        sysname = f"{sys_} System"
        # --systems is operator input interpolated into patterns below. A name
        # carrying a regex metacharacter ("St. John", "Alpha (Prime)") would
        # otherwise match the wrong things, or raise re.error outright.
        esc = re.escape(sys_)
        if name == sysname or name == sys_:
            return None
        # moon: "<Sys> <ROMAN> <LETTER>"
        m = re.fullmatch(rf"{esc}\s+({ROMAN})\s+([A-Z])", name)
        if m:
            parent = f"{sys_} {m.group(1)}"
            return parent if parent in exists else (sysname if sysname in exists else None)
        # planet: "<Sys> <ROMAN>"
        if re.fullmatch(rf"{esc}\s+{ROMAN}", name):
            return sysname if sysname in exists else None
        # body: "<Sys> <LETTER>"
        if re.fullmatch(rf"{esc}\s+[A-Z]", name):
            return sysname if sysname in exists else None
        # gate: contains "Gate" and the system token
        if "Gate" in name and name.startswith(sys_):
            return sysname if sysname in exists else None
        # belt: "<Sys>ian Belt" or "<Sys> Belt"
        if re.search(rf"{esc}(ian)?\s+Belt", name):
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


def add_relationship(text: str, target: str, rtype: str, desc: str) -> str | None:
    """Insert one relationship entry, or return None if there was nowhere to put it.

    None means the note's frontmatter carries neither `relationships: []` nor a
    `relationships:` block. Previously this fell through to a no-op `re.sub`,
    the note was rewritten byte-identical, and the caller still reported the
    link as created — the edge was lost and the report was wrong.

    The replacements are function-form on purpose: the entry is a *literal*, and
    `desc` is JSON-encoded, so a backslash in it would otherwise be read as a
    replacement-template escape (`\\\\` collapsing to `\\`, `\\u...` raising
    "bad escape").
    """
    block = (f"relationships:\n"
             f"  - target: \"[[{target}]]\"\n"
             f"    type: {rtype}\n"
             f"    tone: neutral\n"
             f"    strength: 6\n"
             f"    bidirectional: false\n"
             f"    description: {json.dumps(desc, ensure_ascii=False)}")
    if re.search(r"^relationships:\s*\[\]\s*$", text, flags=re.M):
        return re.sub(r"^relationships:\s*\[\]\s*$", lambda _m: block,
                      text, count=1, flags=re.M)
    # append under an existing `relationships:` block
    entry = block.split("\n", 1)[1] + "\n"
    new_text, n = re.subn(r"^(relationships:\s*\n)", lambda m: m.group(1) + entry,
                          text, count=1, flags=re.M)
    return new_text if n else None


def fill_parent_location(text: str, target: str) -> tuple[str, str]:
    """Make the `parent_location:` scalar agree with a freshly written `part_of`
    edge. Both are documented vault conventions and the publish renderer groups
    its location index on the scalar, so writing only the edge left an import
    looking right in the graph and wrong on the site (#186).

    Returns (new_text, status): 'filled' (empty scalar set — any empty YAML
    spelling: "", '\'\'', bare, null, ~), 'inserted' (the Optional key was
    absent and has been added after location_type:/type:), 'agrees' (already
    the target), or 'disagrees' (an authored value names something else — left
    untouched, but surfaced in the report rather than silently shipped).

    Only the opening YAML frontmatter block is read or written: a body line
    that happens to start with `parent_location:` (docs, examples) is data,
    not the scalar."""
    fm_m = re.match(r"^---\r?\n.*?\r?\n---(?:\r?\n|$)", text, flags=re.S)
    if fm_m is None:
        return text, "disagrees"          # no frontmatter — nowhere safe to write
    fm, body = text[:fm_m.end()], text[fm_m.end():]
    link = f'parent_location: "[[{target}]]"'
    m = re.search(r"^parent_location:(.*)$", fm, flags=re.M)
    if m is None:
        for key in ("location_type", "type"):
            new_fm, n = re.subn(rf"^({key}:[^\n]*\n)",
                                lambda mm: mm.group(1) + link + "\n",
                                fm, count=1, flags=re.M)
            if n:
                return new_fm + body, "inserted"
        return text, "disagrees"          # no slot to write — surface it
    val = m.group(1).strip()
    if val in ("", '""', "''", "null", "~"):
        return fm.replace(m.group(0), link, 1) + body, "filled"
    if val.strip('"\'') == f"[[{target}]]":
        return text, "agrees"
    return text, "disagrees"


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg link-orphans",
        description="Auto-link obvious orphan entities after a mobRPG extract, "
                    "using conservative structural naming rules. Writes a report; "
                    "vault edits are gated on --execute.")
    ap.add_argument("extract", help="path to the extract JSON (mobrpg pull output)")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--out", required=True, help="output dir for the report/json")
    ap.add_argument("--systems", default="",
                    help="comma-separated star system names the structural naming "
                         "rules apply to (e.g. 'Corwin,Eris,Thides'); default none")
    ap.add_argument("--execute", action="store_true",
                    help="write the derived relationships into the vault (default: dry-run)")
    args = ap.parse_args(argv)

    vault = os.path.expanduser(args.vault)
    systems = [s.strip() for s in args.systems.split(",") if s.strip()]

    extract = json.load(open(args.extract, encoding="utf-8"))
    id_of = {e["name"]: e["id"] for e in extract["entities"]}
    exists = vault_entity_names(vault)
    already_linked = vault_has_rels(vault)   # judge orphan status from the vault

    linked, still, unwritable = [], [], []
    for e in extract["entities"]:
        name, kind = e["name"], e["kind"]
        if e.get("relationships") or name in already_linked:
            continue  # not an orphan (per live vault state)
        target = rtype = why = None
        if kind in ("landfeature", "political"):
            p = derive_parent(name, exists, systems)
            if p:
                target, rtype, why = p, "part_of", "structural containment"
        elif kind == "item":
            mk = derive_maker(e.get("body_md", ""), exists)
            if mk:
                target, rtype, why = mk, "created", "manufacturer named in description"
        if not target:
            still.append((kind, name))
            continue
        folder = _WRITE_FOLDER[kind]
        # `name` comes from the extract, which is built from the world API, so
        # it is untrusted. A name containing `../` would otherwise resolve to an
        # existing file outside this kind's folder and be rewritten there.
        folder_root = os.path.realpath(os.path.join(vault, folder))
        path = os.path.realpath(os.path.join(folder_root, f"{name}.md"))
        if path != folder_root and not path.startswith(folder_root + os.sep):
            print(f"  SKIPPED (path escapes {folder}): {name}", file=sys.stderr)
            still.append((kind, name))
            continue
        if not os.path.exists(path):
            still.append((kind, name))
            continue
        # Read and validate in BOTH modes. A dry-run exists to predict the
        # execute run; doing this check only under --execute meant the preview
        # listed a note as linked that the real run would refuse and report as
        # unwritable. Only the write itself is gated.
        with open(path, encoding="utf-8") as fh:
            txt = fh.read()
        edited = add_relationship(txt, target, rtype, "auto-linked: " + why)
        scalar_status = None
        if edited is not None and rtype == "part_of":
            edited, scalar_status = fill_parent_location(edited, target)
        if edited is None:
            # No relationships key to write into. Report it rather than
            # rewriting the file unchanged and claiming the link was made.
            unwritable.append((kind, name, target, rtype))
            continue
        if args.execute:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(edited)
        entry = {"entity": name, "kind": kind, "type": rtype, "target": target,
                 "subj_id": id_of.get(name), "obj_id": id_of.get(target)}
        if scalar_status is not None:
            entry["parent_scalar"] = scalar_status
        linked.append(entry)

    outdir = args.out
    os.makedirs(outdir, exist_ok=True)

    head = f"# Orphan auto-linking report — {len(linked)} linked, {len(still)} still orphan"
    if unwritable:
        head += f", {len(unwritable)} could not be written"
    rep = [head + "\n"]
    rep.append("## Linked\n")
    rep.append("| entity | type | → target |\n|---|---|---|")
    for l in linked:
        rep.append(f"| {l['entity']} | {l['type']} | {l['target']} |")
    if unwritable:
        rep.append("\n## Not written — no `relationships:` key in the note\n")
        rep.append("Add the key (or `relationships: []`) and re-run, "
                   "or add these by hand.\n")
        rep.append("| entity | type | → target |\n|---|---|---|")
        for kind, name, target, rtype in sorted(unwritable):
            rep.append(f"| {name} | {rtype} | {target} |")
    misaligned = [l for l in linked if l.get("parent_scalar") == "disagrees"]
    if misaligned:
        rep.append("\n## parent_location scalar not aligned\n")
        rep.append("The part_of edge was written, but the note's "
                   "parent_location: scalar names something else (or offered "
                   "no slot) and was left untouched. The published site groups "
                   "locations on the scalar, so these need a manual look.\n")
        rep.append("| entity | edge target |\n|---|---|")
        for l in misaligned:
            rep.append(f"| {l['entity']} | {l['target']} |")
    rep.append("\n## Still orphan (need manual judgement)\n")
    for k, n in sorted(still):
        rep.append(f"- [{k}] {n}")
    with open(os.path.join(outdir, "orphan-linking-report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rep) + "\n")

    with open(os.path.join(outdir, "orphan-linking.json"), "w", encoding="utf-8") as fh:
        json.dump({"linked": linked, "still_orphan": still,
                   "unwritable": [{"entity": n, "kind": k, "type": t, "target": tgt}
                                  for k, n, tgt, t in unwritable]},
                  fh, indent=2, ensure_ascii=False)

    if not args.execute and linked:
        print("dry-run — pass --execute to write the vault edits above")
    print(f"linked {len(linked)}, still orphan {len(still)}")
    if misaligned:
        print(f"WARNING: {len(misaligned)} note(s) keep a parent_location: that "
              f"does not match the new part_of edge — see the report",
              file=sys.stderr)
    if unwritable:
        print(f"WARNING: {len(unwritable)} note(s) have no `relationships:` key — "
              f"nothing was written for them; see the report", file=sys.stderr)
    return 0

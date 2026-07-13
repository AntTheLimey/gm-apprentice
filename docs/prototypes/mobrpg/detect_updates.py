#!/usr/bin/env python3
"""
Detect and surface mobRPG entity updates since the last sync — the "keep
Dead End up to date" enhancement flagged as a known limitation in
integration-log.md.

The existing pipeline (etl_extract.py -> vault_write.py -> cp -Rn) only ever
picks up entities NEW to mobRPG: the no-clobber copy skips anything that
already has a vault file, so it never notices when Tim edits an entity
that's already been imported. This script closes that gap with a persisted
crosswalk (sidecar JSON, per the GM's standing "no crosswalk in frontmatter"
policy — see integration-log.md):

    mobRPG entity id -> {vault_path, content_hash, canonical snapshot}

Two modes:

  bootstrap   Seed the crosswalk from a known-good BASELINE extract (the
              state at the time of the actual import — space_extract.json,
              not "whatever mobRPG says today") plus the live vault, so
              already-imported content gets a real baseline instead of an
              arbitrary bootstrap-day one. Read-only on the vault; only
              writes the crosswalk file.

  sync        Compare a freshly-pulled extract against the crosswalk. For
              anything changed, append a clearly-marked, non-destructive
              "mobRPG Update Available" section to the vault file — never
              touching hand-authored prose above it — and write a report.
              A still-pending section from an earlier sync is replaced
              wholesale (not stacked) if the entity changed again before
              the GM reviewed it. New mobRPG entities (not yet imported)
              and crosswalk entries whose vault file has vanished are
              reported, not acted on.

Never blind-overwrites, per the GM's established canon policy (see
integration-log.md, "the biggest lesson").

Usage:
  python3 detect_updates.py bootstrap <baseline_extract.json> <vault_dir> <crosswalk.json>
  python3 detect_updates.py sync <fresh_extract.json> <vault_dir> <crosswalk.json> <report_dir>
"""
from __future__ import annotations
import json, hashlib, os, re, sys
from datetime import date

# Mirrors vault_write.py's KIND_MAP + slug() so vault paths resolve identically.
KIND_MAP = {
    "person":       "Characters/NPCs",
    "organization": "Factions & Organizations",
    "political":    "Locations",
    "landfeature":  "Locations",
    "item":         "Items & Artifacts",
}
NAME_STYLE = "space"  # this vault uses spaces, not underscores — see vault_write.py

# Matches a previously-inserted update section, from its blank-line lead-in up
# to (but not including) the next heading or end of file — so a re-run replaces
# a still-pending section wholesale instead of stacking a second one.
MARKER_RE = re.compile(r"\n\n## mobRPG Update Available \([^)]*\)\n.*?(?=\n## |\Z)", re.S)


def slug(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name).strip()
    s = re.sub(r"\s+", " ", s)
    return s if NAME_STYLE == "space" else s.replace(" ", "_")


def vault_path_for(kind: str, name: str) -> str | None:
    folder = KIND_MAP.get(kind)
    return f"{folder}/{slug(name)}.md" if folder else None


def canonical(rec: dict) -> dict:
    """Fields that matter for vault content, sorted so ordering differences
    in mobRPG's API response don't register as false-positive changes."""
    rels = sorted(
        ({"target": r.get("target"), "predicate": r.get("predicate"),
          "role": r.get("role"), "eventType": r.get("eventType")}
         for r in rec.get("relationships", [])),
        key=lambda r: (r["predicate"] or "", r["target"] or "", r["role"] or ""))
    classifiers = sorted(
        ({"kind": c.get("kind"), "name": c.get("name")} for c in rec.get("classifiers", [])),
        key=lambda c: (c["kind"] or "", c["name"] or ""))
    canon = {
        "name": rec.get("name", ""),
        "altNames": sorted(rec.get("altNames") or []),
        "body_md": rec.get("body_md", ""),
        "classifiers": classifiers,
        "relationships": rels,
    }
    # Notes are keyed in only when present, so entities with no notes hash
    # identically to the pre-notes baseline (no false "changed" flags); the two
    # entities that DO carry notes correctly surface for review on next sync.
    if rec.get("notes_public"):
        canon["notes_public"] = sorted(rec["notes_public"])
    if rec.get("notes_gm"):
        canon["notes_gm"] = sorted(rec["notes_gm"])
    return canon


def content_hash(canon: dict) -> str:
    blob = json.dumps(canon, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def load_extract(path: str) -> dict[str, dict]:
    data = json.load(open(path))
    return {e["id"]: e for e in data["entities"]}


def summarize_change(old: dict, new: dict) -> str:
    bits = []
    if old["name"] != new["name"]:
        bits.append(f'renamed from "{old["name"]}"')
    if old["body_md"] != new["body_md"]:
        bits.append("description text changed")
    old_rels = {(r["predicate"], r["target"]) for r in old["relationships"]}
    new_rels = {(r["predicate"], r["target"]) for r in new["relationships"]}
    added, removed = new_rels - old_rels, old_rels - new_rels
    if added:
        bits.append(f"+{len(added)} relationship{'s' if len(added) != 1 else ''} ("
                     + ", ".join(f"{p} {t}" for p, t in sorted(added)) + ")")
    if removed:
        bits.append(f"-{len(removed)} relationship{'s' if len(removed) != 1 else ''} ("
                     + ", ".join(f"{p} {t}" for p, t in sorted(removed)) + ")")
    if old["altNames"] != new["altNames"]:
        bits.append("alt names changed")
    if old["classifiers"] != new["classifiers"]:
        bits.append("classifiers changed")
    if old.get("notes_public", []) != new.get("notes_public", []):
        bits.append("player-safe notes changed")
    if old.get("notes_gm", []) != new.get("notes_gm", []):
        bits.append("GM-only notes changed")
    return "; ".join(bits) if bits else "content changed (hash differs)"


def write_update_section(path: str, rec: dict, summary: str) -> None:
    text = open(path).read()
    text = MARKER_RE.sub("", text, count=1)  # drop any still-pending prior section
    rels = rec.get("relationships", [])
    rel_lines = "".join(
        f"\n- **{r['predicate']}** → [[{r['target']}]]"
        + (f" — *{r['role']}*" if r.get("role") else "")
        for r in rels)
    body = rec.get("body_md") or "*(no description in mobRPG)*"
    pub_notes = rec.get("notes_public") or []
    gm_notes = rec.get("notes_gm") or []
    note_lines = "".join(f"\n- {n.replace(chr(10), ' ')}" for n in pub_notes)
    gm_note_lines = "".join(f"\n> - {n.replace(chr(10), ' ')}" for n in gm_notes)
    section = (
        f"\n\n## mobRPG Update Available ({date.today()})\n\n"
        f"<!-- mobRPG's Space world changed this entity since the last sync. Appended, not "
        f"merged — review against the sections above, fold in whatever's new, then delete "
        f"this block. A later sync replaces it wholesale if it's still here when the entity "
        f"changes again. -->\n\n"
        f"**What changed:** {summary}\n\n"
        f"**mobRPG's current description:**\n\n{body}\n"
        + (f"\n**mobRPG's current relationships:**{rel_lines}\n" if rels else "")
        + (f"\n**mobRPG's player-safe notes:**{note_lines}\n" if pub_notes else "")
        + (f"\n> [!info] Keeper Only — mobRPG's GM-only notes (hidden=true){gm_note_lines}\n"
           if gm_notes else "")
    )
    gm = re.search(r"\n##\s+GM Notes", text)
    if gm:
        text = text[:gm.start()] + section + text[gm.start():]
    else:
        text = text.rstrip() + section + "\n"
    open(path, "w").write(text)


def cmd_bootstrap(argv: list[str]) -> int:
    baseline_path, vault, crosswalk_path = argv
    entities = load_extract(baseline_path)
    crosswalk: dict[str, dict] = {}
    seeded = skipped = 0
    for eid, rec in entities.items():
        vp = vault_path_for(rec["kind"], rec["name"])
        if not vp or not os.path.exists(os.path.join(vault, vp)):
            skipped += 1
            continue
        canon = canonical(rec)
        crosswalk[eid] = {
            "name": rec["name"], "kind": rec["kind"], "vault_path": vp,
            "content_hash": content_hash(canon), "canonical": canon,
            "last_synced": str(date.today()),
        }
        seeded += 1
    json.dump(crosswalk, open(crosswalk_path, "w"), indent=2, ensure_ascii=False)
    print(f"bootstrap: seeded {seeded} entities into {crosswalk_path}, skipped {skipped} "
          f"(no matching vault file — not yet imported, or an unmapped kind)")
    return 0


def cmd_sync(argv: list[str]) -> int:
    fresh_path, vault, crosswalk_path, report_dir = argv
    crosswalk = json.load(open(crosswalk_path)) if os.path.exists(crosswalk_path) else {}
    fresh = load_extract(fresh_path)

    updated, unchanged, new_entities, missing_file = [], [], [], []

    for eid, rec in fresh.items():
        canon = canonical(rec)
        h = content_hash(canon)
        prior = crosswalk.get(eid)
        if not prior:
            new_entities.append({"id": eid, "name": rec["name"], "kind": rec["kind"]})
            continue
        vp = prior["vault_path"]
        full = os.path.join(vault, vp)
        # Check file existence before trusting a hash match — an unchanged mobRPG
        # entity whose vault file was since moved/deleted must still be reported,
        # not silently swallowed into "unchanged".
        if not os.path.exists(full):
            missing_file.append({"id": eid, "name": rec["name"], "vault_path": vp})
            continue
        if prior["content_hash"] == h:
            unchanged.append(eid)
            continue
        summary = summarize_change(prior["canonical"], canon)
        write_update_section(full, rec, summary)
        crosswalk[eid] = {**prior, "content_hash": h, "canonical": canon,
                          "last_synced": str(date.today())}
        updated.append({"id": eid, "name": rec["name"], "vault_path": vp, "summary": summary})

    json.dump(crosswalk, open(crosswalk_path, "w"), indent=2, ensure_ascii=False)

    os.makedirs(report_dir, exist_ok=True)
    lines = [f"# mobRPG sync report — {date.today()}\n",
             f"{len(updated)} updated, {len(new_entities)} new (not yet imported), "
             f"{len(unchanged)} unchanged, {len(missing_file)} crosswalk entries with a "
             f"missing vault file.\n"]
    if updated:
        lines.append("## Updated (flagged inline in the vault file)\n")
        lines.append("| entity | vault file | what changed |")
        lines.append("|---|---|---|")
        for u in updated:
            lines.append(f"| {u['name']} | {u['vault_path']} | {u['summary']} |")
    if new_entities:
        lines.append("\n## New in mobRPG, not yet imported\n")
        lines.append("Run the normal import path (vault_write.py + additive copy) to bring "
                      "these in, then re-run bootstrap so they join the crosswalk.\n")
        for n in new_entities:
            lines.append(f"- [{n['kind']}] {n['name']}")
    if missing_file:
        lines.append("\n## Crosswalk entries whose vault file is missing\n")
        lines.append("The vault file was moved, renamed, or deleted since the last sync — "
                      "resolve manually.\n")
        for m in missing_file:
            lines.append(f"- {m['name']} → expected `{m['vault_path']}`")
    open(os.path.join(report_dir, "sync-report.md"), "w").write("\n".join(lines) + "\n")
    print(f"sync: {len(updated)} updated, {len(new_entities)} new, "
          f"{len(unchanged)} unchanged, {len(missing_file)} missing-file "
          f"— see {report_dir}/sync-report.md")
    return 0


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("bootstrap", "sync"):
        print(__doc__, file=sys.stderr)
        return 2
    mode, rest = sys.argv[1], sys.argv[2:]
    if mode == "bootstrap":
        if len(rest) != 3:
            print("usage: detect_updates.py bootstrap <baseline_extract.json> <vault_dir> "
                  "<crosswalk.json>", file=sys.stderr)
            return 2
        return cmd_bootstrap(rest)
    if len(rest) != 4:
        print("usage: detect_updates.py sync <fresh_extract.json> <vault_dir> <crosswalk.json> "
              "<report_dir>", file=sys.stderr)
        return 2
    return cmd_sync(rest)


if __name__ == "__main__":
    raise SystemExit(main())

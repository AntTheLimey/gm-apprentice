#!/usr/bin/env python3
"""
Push vault entities into a mobRPG world as SUGGESTIONS (review queue), rather
than direct-create elements. Sibling to push_to_mobrpg.py, which does the
direct-create path — this script hits the newer

    POST /world/{worldId}/suggestion

batch endpoint instead of one POST per entity type. Reuses push_to_mobrpg.py's
vault parsing (`parse`, `md_to_html`, `display_name`) so the two paths stay in
sync on how a vault file becomes a name/description/altNames.

Why suggestions instead of direct create:
  - Only needs Read on the world, not ReadWriteDelete — the whole point is
    that a Read-only collaborator (e.g. suggester@localhost) can propose
    content for a GM to accept/dismiss later, without write access.
  - Idempotent on `externalRef`: re-submitting the same externalRef returns
    the existing suggestion instead of creating a duplicate row (server-side,
    see SuggestionService.submit + the unique index on
    world_elements.suggestions(world_id, external_ref)).
  - Batched: one call submits many suggestions (SubmitSuggestionsRequest).

Payload shape (SubmitSuggestionsRequest -> SubmitSuggestionRequest):
    {
      "batchLabel": "...",
      "suggestions": [
        {
          "ref": "item1",
          "operation": "CreateElement",
          "payload": {
            "operation": "CreateElement",   # payload is polymorphic on this
            "name": ..., "description": ..., "altNames": [...],
            "data": {"type": "Political", "titles": []}   # type-specific, @Valid
          },
          "dependsOn": [],
          "externalRef": "canticle:Locations/Fourviere"
        },
        ...
      ]
    }

`payload.data` is `@Valid @NotNull` on the backend — it IS validated at submit
time, so every vault "kind" needs a data object that satisfies its element
type's own @NotNull fields (read straight from ~/PROJECTS/game's *Data.java
classes, not guessed):

    location            -> {"type": "Political",    "titles": []}
    npc / pc             -> {"type": "Person",        "languages": [], "equipment": []}
    faction/organization -> {"type": "Organization",  "titles": []}
    item                  -> {"type": "Item",          "attributes": {"itemType": "Generic"}}
    creature              -> {"type": "Creature"}      # no @NotNull fields beyond notes,
                                                        # which defaults to {} if omitted

Only `location` (-> Political) has been exercised end-to-end against dev; the
others are supported by the same code path but unverified live — see
integration-log.md.

SAFETY: defaults to dry-run (writes the request body to disk, no API call).
--execute actually submits, and refuses to run against prod unless
MOBRPG_ALLOW_PROD_WRITES=1 (smoketest.py's assert_writes_allowed()).

Environment + auth are resolved by smoketest.py (`import smoketest as api`):
MOBRPG_ENV=dev|prod selects BASE/CLIENT_ID/REDIRECT_URI, then MOBRPG_TOKEN or
MOBRPG_EMAIL+MOBRPG_PASSWORD authenticates against it.

Usage:
    python3 push_suggestions.py <worldId> --chapter chapter-2 --kind location --dry-run
    MOBRPG_ENV=dev MOBRPG_EMAIL=suggester@localhost MOBRPG_PASSWORD=local \\
        python3 push_suggestions.py <worldId> --chapter chapter-2 --kind location \\
            --limit 8 --execute
"""
from __future__ import annotations
import argparse, glob, json, os, sys

import smoketest as api
import push_to_mobrpg as push  # reuse parse(), md_to_html(), display_name(), VAULT, FOLDERS

# vault "kind" -> minimal valid WorldElementData for a CreateElement suggestion.
# Each entry is a zero-arg callable returning a *fresh* dict (never share/mutate
# a shared literal across suggestions).
KIND_DATA = {
    "location":     lambda: {"type": "Political", "titles": []},
    "npc":          lambda: {"type": "Person", "languages": [], "equipment": []},
    "pc":           lambda: {"type": "Person", "languages": [], "equipment": []},
    "faction":      lambda: {"type": "Organization", "titles": []},
    "organization": lambda: {"type": "Organization", "titles": []},
    "item":         lambda: {"type": "Item", "attributes": {"itemType": "Generic"}},
    "creature":     lambda: {"type": "Creature"},
}


def external_ref(path: str) -> str:
    """Stable per-entity externalRef: canticle:<vault-relative path, no extension>.
    Submit is idempotent on (worldId, externalRef), so re-running the same vault
    file always resolves to the same suggestion instead of duplicating it."""
    rel = os.path.relpath(path, push.VAULT)
    if rel.endswith(".md"):
        rel = rel[:-3]
    return "canticle:" + rel.replace(os.sep, "/")


def build_suggestion(path: str, kind: str, info: dict, ref: str) -> dict:
    name = push.display_name(path, info)
    payload = {
        "operation": "CreateElement",
        "name": name,
        "description": push.md_to_html(info["body"]),
        "altNames": info["aliases"],
        "data": KIND_DATA[kind](),
    }
    return {
        "ref": ref,
        "operation": "CreateElement",
        "payload": payload,
        "dependsOn": [],
        "externalRef": external_ref(path),
    }


def collect_candidates(chapter: str, kind_filter: str, only: str) -> list[tuple[str, str, dict]]:
    cand = []
    for folder, kind in push.FOLDERS.items():
        if kind_filter and kind != kind_filter:
            continue
        for p in sorted(glob.glob(os.path.join(push.VAULT, folder, "*.md"))):
            info = push.parse(p)
            if chapter not in info["tags"]:
                continue
            nm = push.display_name(p, info)
            if only and only.lower() not in nm.lower():
                continue
            cand.append((p, kind, info))
    return cand


def main() -> int:
    ap = argparse.ArgumentParser(description="Push vault entities to mobRPG as suggestions")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--chapter", required=True, help="e.g. chapter-2")
    ap.add_argument("--kind", default="",
                    help="restrict to one vault kind: location, npc, pc, faction, "
                         "organization, item, creature (default: all)")
    ap.add_argument("--execute", action="store_true", help="actually submit (default: dry-run)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="", help="substring match on entity name")
    ap.add_argument("--batch-label", default="", help="override the default batchLabel")
    ap.add_argument("--out", default="./push_out")
    args = ap.parse_args()

    cand = collect_candidates(args.chapter, args.kind, args.only)
    if args.limit:
        cand = cand[:args.limit]

    if not cand:
        print("No matching vault entities found for that --chapter/--kind/--only.",
              file=sys.stderr)
        return 1

    suggestions = []
    skipped = []
    for i, (p, kind, info) in enumerate(cand):
        if kind not in KIND_DATA:
            skipped.append((kind, push.display_name(p, info)))
            continue
        suggestions.append(build_suggestion(p, kind, info, ref=f"item{i + 1}"))

    for kind, name in skipped:
        print(f"  [skip] {kind:12} {name}  (no suggestion data mapping)")

    if not suggestions:
        print("Nothing left to submit after filtering.", file=sys.stderr)
        return 1

    batch_label = args.batch_label or f"Canticle {args.chapter} (dev smoke)"
    request_body = {"batchLabel": batch_label, "suggestions": suggestions}

    os.makedirs(args.out, exist_ok=True)
    req_path = os.path.join(args.out, f"suggestions-{args.chapter}-request.json")
    json.dump(request_body, open(req_path, "w"), indent=2, ensure_ascii=False)

    if not args.execute:
        print(f"DRY-RUN: {len(suggestions)} suggestion(s) prepared, batchLabel={batch_label!r}")
        for s in suggestions:
            d = s["payload"]["data"]
            print(f"  [dry-run] {d['type']:12} {s['payload']['name']!r:40} "
                  f"externalRef={s['externalRef']}")
        print(f"-> {req_path}")
        return 0

    api.assert_writes_allowed()
    token = api.get_access_token()

    print(f"→ POST /world/{args.world}/suggestion  batchLabel={batch_label!r}  "
          f"n={len(suggestions)} ...")
    resp = api._request("POST", f"/world/{args.world}/suggestion", token=token, body=request_body)

    stored = resp.get("suggestions", []) if isinstance(resp, dict) else []
    resolved_refs = resp.get("resolvedRefs", {}) if isinstance(resp, dict) else {}

    print(f"  ✓ {len(stored)} suggestion(s) stored (of {len(suggestions)} submitted)")
    for s in stored:
        name = (s.get("payload") or {}).get("name")
        print(f"      - {s.get('reviewState', '?'):8} id={s.get('id')} "
              f"externalRef={s.get('externalRef')}  name={name!r}")
    if resolved_refs:
        print(f"  resolvedRefs (client ref -> existing element id, deduped Type creates): "
              f"{resolved_refs}")

    resp_path = os.path.join(args.out, f"suggestions-{args.chapter}-response.json")
    json.dump(resp, open(resp_path, "w"), indent=2, ensure_ascii=False)
    print(f"-> {resp_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

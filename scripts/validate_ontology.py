#!/usr/bin/env python3
"""Validate the mobRPG projection in the relationship ontology (issue #123).

`skills/shared/gm-apprentice-ontology.json` is the one source of the
relationship vocabulary; every table that documents it is written by
scripts/gen_ontology_docs.py, and `gen_ontology_docs.py --check` fails when
one is stale. What is left to check here is the mobRPG projection the file
adds on top of the vocabulary.

This check fails when a predicate's `mobrpg_event_type` /
`mobrpg_relation_type` is not a member of the corresponding enum in the file.

It warns (without failing) when an enum value is unreachable from any
predicate: a mobRPG-projection observation that is deliberately not a hard
error, since the enum documents mobRPG's own fixed event types.

A vault's per-campaign `_meta/relationship-types.md` is checked at vault time
by campaign-qa's graph-health step (issue #120), not here.
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ONTOLOGY = REPO / "skills" / "shared" / "gm-apprentice-ontology.json"


def main() -> int:
    if not ONTOLOGY.exists():
        raise SystemExit(f"ERROR: missing {ONTOLOGY}")

    ontology = json.loads(ONTOLOGY.read_text(encoding="utf-8"))
    errors: list[str] = []

    event_enum = set(ontology.get("mobrpg_event_type_enum", []))
    relation_enum = set(ontology.get("mobrpg_relation_type_enum", [])) | {None}
    used_events = set()
    for p in ontology["predicates"]:
        ev = p.get("mobrpg_event_type")
        rel = p.get("mobrpg_relation_type")
        if ev is not None:
            used_events.add(ev)
            if ev not in event_enum:
                errors.append(f"predicate {p['type']!r} has mobrpg_event_type {ev!r} not in mobrpg_event_type_enum")
        if rel not in relation_enum:
            errors.append(f"predicate {p['type']!r} has mobrpg_relation_type {rel!r} not in mobrpg_relation_type_enum")

    unreachable = sorted(event_enum - used_events - {"Generic"})
    for value in unreachable:
        print(f"  WARN  mobrpg_event_type {value!r} is in the enum but no predicate reifies to it")

    print("=" * 50)
    print(f"ontology predicates : {len(ontology['predicates'])}")
    if errors:
        for e in errors:
            print(f"  ERROR {e}")
        print(f"\nOntology validation FAILED with {len(errors)} error(s).")
        return 1
    print("mobRPG projection is consistent. All checks passed!")
    return 0


if __name__ == "__main__":
    sys.exit(main())

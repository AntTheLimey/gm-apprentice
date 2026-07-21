#!/usr/bin/env python3
"""Validate that the relationship-ontology copies agree (issue #123).

The relationship vocabulary is the contract between gm-apprentice and mobRPG,
and it exists in more than one place. `skills/shared/entity-schema.md` is the
authoritative, human-authored source of truth; `skills/shared/gm-apprentice-ontology.json`
is the machine-readable export that adds the mobRPG projection on top. Nothing
used to check that the two agree, so vocabulary drift was only ever caught by a
human noticing.

This check fails when:
  * the predicate set in entity-schema.md differs from the ontology export in
    either direction;
  * the set of predicates marked symmetric differs between the two copies;
  * a predicate's `mobrpg_event_type` / `mobrpg_relation_type` is not a member
    of the corresponding enum in the export.

It warns (without failing) when an enum value is unreachable from any predicate
— a mobRPG-projection observation that is deliberately not a hard error, since
the enum documents mobRPG's own fixed event types.

Scope: this validates the two in-repo copies. A vault's per-campaign
`_meta/relationship-types.md` is a genre-filtered subset checked at vault time by
campaign-qa's graph-health step (issue #120), not here. The mobRPG CLI's derived
tables live on the (unmerged, gitignored) mobrpg-cli branch and are out of scope.
"""

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCHEMA = REPO / "skills" / "shared" / "entity-schema.md"
ONTOLOGY = REPO / "skills" / "shared" / "gm-apprentice-ontology.json"


def schema_predicates(text: str) -> set[str]:
    """Parse the predicate vocabulary from entity-schema.md's category table.

    The table is `| Category | Types |` rows where the Types cell is a
    comma-separated predicate list, ending before the 'Each type has an inverse'
    paragraph.
    """
    block = re.search(r"\| Category \| Types \|(.*?)Each type has an", text, re.S)
    if not block:
        raise SystemExit("ERROR: could not locate the predicate category table in entity-schema.md")
    preds: set[str] = set()
    for line in block.group(1).splitlines():
        if "|" not in line or "---" in line or "Types" in line:
            continue
        cells = [c.strip() for c in line.split("|") if c.strip()]
        if len(cells) != 2:
            continue
        for t in cells[1].split(","):
            t = t.strip()
            if t:
                preds.add(t)
    return preds


def schema_symmetric(text: str) -> set[str]:
    """Parse the '**Symmetric types** …:' comma/newline list from entity-schema.md."""
    block = re.search(r"\*\*Symmetric types\*\*[^:]*:\n(.*?)\n\n", text, re.S)
    if not block:
        raise SystemExit("ERROR: could not locate the Symmetric types list in entity-schema.md")
    return {t.strip() for t in re.split(r"[,\n]", block.group(1)) if t.strip()}


def main() -> int:
    if not SCHEMA.exists():
        raise SystemExit(f"ERROR: missing {SCHEMA}")
    if not ONTOLOGY.exists():
        raise SystemExit(f"ERROR: missing {ONTOLOGY}")

    schema_preds = schema_predicates(SCHEMA.read_text())
    ontology = json.loads(ONTOLOGY.read_text())
    ont_preds = {p["type"] for p in ontology["predicates"]}

    errors: list[str] = []

    missing_from_ontology = sorted(schema_preds - ont_preds)
    if missing_from_ontology:
        errors.append(
            "predicates in entity-schema.md but missing from the ontology export: "
            + ", ".join(missing_from_ontology)
        )
    missing_from_schema = sorted(ont_preds - schema_preds)
    if missing_from_schema:
        errors.append(
            "predicates in the ontology export but missing from entity-schema.md: "
            + ", ".join(missing_from_schema)
        )

    # Attribute agreement: the two copies must also agree on which predicates are
    # symmetric (a consumer that stores a symmetric edge once must not disagree with one
    # that stores an inverse). Catches the class of drift the set check alone would miss.
    schema_sym = schema_symmetric(SCHEMA.read_text())
    ont_sym = {p["type"] for p in ontology["predicates"] if p.get("symmetric")}
    if schema_sym != ont_sym:
        sym_only_schema = sorted(schema_sym - ont_sym)
        sym_only_ont = sorted(ont_sym - schema_sym)
        if sym_only_schema:
            errors.append("symmetric in entity-schema.md but not in the ontology export: " + ", ".join(sym_only_schema))
        if sym_only_ont:
            errors.append("symmetric in the ontology export but not in entity-schema.md: " + ", ".join(sym_only_ont))

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
    print(f"entity-schema.md predicates : {len(schema_preds)}")
    print(f"ontology export predicates  : {len(ont_preds)}")
    if errors:
        for e in errors:
            print(f"  ERROR {e}")
        print(f"\nOntology validation FAILED with {len(errors)} error(s).")
        return 1
    print("Ontology copies agree. All checks passed!")
    return 0


if __name__ == "__main__":
    sys.exit(main())

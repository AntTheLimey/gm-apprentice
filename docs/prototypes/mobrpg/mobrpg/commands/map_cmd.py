"""mobrpg map — generate and maintain the per-vault mapping (vault vocab -> mobRPG types).

Turns the per-vault map from hand-authored into discovered-and-maintained. See
COMPLETE-SUGGESTIONS-SPEC.md ("The map command family").

    mobrpg map init  <world> --vault <path> [--out FILE]   # discover + scan + propose
    mobrpg map sync  <world> --vault <path> [--map FILE]    # re-discover, merge non-destructively
    mobrpg map check <world> --vault <path> [--map FILE]    # read-only coverage report

Discovery (mobRPG side) reuses the classifier catalog endpoints; the vault scan
collects the distinct values of the mapping-relevant frontmatter. `map` emits a
DRAFT: exact/ci matches bind to the existing type's real id (status "bound"),
unmatched values propose a new type ("new"), and genuinely ambiguous location
routes are flagged "review" for the skill / a human to resolve. Sync preserves
resolved entries: any entry with "confirmed": true, and any entry already bound
to a real mobrpgId. A hand-edited entry that sets neither is NOT protected — mark
it "confirmed": true to keep it.

Read-only against mobRPG; writes only the local map file (never the vault content).
"""

from __future__ import annotations

import argparse
import datetime
import difflib
import glob
import json
import os
import re
import sys

from mobrpg import client
from mobrpg import node

# The gm-apprentice ontology export is the contract between the two systems: the
# controlled predicate vocabulary, how predicates project onto mobRPG's two
# relationship mechanisms, how entity kinds project onto element kinds, and the
# natural/built axis for locations. Everything derived from it below is derived,
# never restated — a client copy is how these drifted in the first place.
_ONTOLOGY_PATH = os.path.join(os.path.dirname(__file__), "..", "..",
                              "gm-apprentice-ontology.json")


def _load_ontology():
    with open(_ONTOLOGY_PATH, encoding="utf-8") as fh:
        return json.load(fh)


_ONTOLOGY = _load_ontology()
ONTOLOGY_PREDICATES = frozenset(p["type"] for p in _ONTOLOGY["predicates"])

# vault entity kind -> mobRPG element kind. A projection of gm-apprentice's own
# entity types onto mobRPG's, so it lives in the ontology rather than here.
KINDS = {k: v for k, v in _ONTOLOGY["mobrpg_element_kind"].items()
         if not k.startswith("$")}

# location_type natural/built axis (open vocabulary — see the export's comment).
LOCATION_NATURAL = _ONTOLOGY["location_nature"]["natural"]
LOCATION_BUILT = frozenset(_ONTOLOGY["location_nature"]["built"])

# vault folder -> vault kind (mirrors push_to_mobrpg.FOLDERS)
FOLDERS = {"Characters/NPCs": "npc", "Characters/PCs": "pc", "Locations": "location",
           "Factions & Organizations": "faction", "Items & Artifacts": "item",
           "Creatures": "creature"}

# closed LandFeatureSubType enum (authoritative, from LandFeatureType.java) — lowercased
LAND_SUBTYPES = {s.lower(): s for s in [
    "Arch", "Archipelago", "Artic", "Atoll", "Beach", "Bluff", "Butte", "Caldera", "Cave", "Cliff",
    "Crater", "Dale", "Desert", "DryLake", "Dune", "Farmland", "Forest", "Grassland", "Glen", "Gorge",
    "Gully", "Hill", "Island", "Jungle", "Mesa", "Mountain", "Pass", "Plain", "Range", "Ridge", "Rock",
    "Scrubland", "Shore", "Sinkhole", "Spit", "Vale", "Valley", "Volcano", "Wood",
    "Bar", "Bay", "Bayou", "Coast", "Cove", "Delta", "Estuary", "Fjord", "Glacier", "Gulf", "Inlet",
    "Lagoon", "Lake", "Marsh", "Oasis", "Ocean", "Pool", "Pond", "Reef", "River", "SaltMarsh", "Sea",
    "Shoal", "Sound", "Spring", "Strait", "Stream", "Swamp", "TidalMarsh", "Waterfall"]}

# The controlled relationship vocabulary, loaded from the gm-apprentice ontology
# export (source of truth: skills/shared/entity-schema.md). This is the contract
# between the two systems: a predicate outside it is a vault-authoring defect, not
# something to silently coerce, so predicate_type() refuses it rather than
# defaulting to Generic. Both tables below are keyed on this vocabulary — never on
# predicates discovered in vault data, which is how they drifted originally.
class UnknownPredicate(ValueError):
    """Raised for a predicate outside the controlled vocabulary."""

    def __init__(self, predicate, message=None):
        self.predicate = predicate
        super().__init__(message or (
            f"predicate {predicate!r} is not in the controlled relationship "
            f"vocabulary (skills/shared/entity-schema.md). Normalize the vault "
            f"before mapping or pushing — do not add an alias here."))

    @classmethod
    def aggregate(cls, predicates):
        """One error listing every offending predicate, so a drifted vault can
        be fixed in a single pass instead of one failure at a time."""
        listed = ", ".join(repr(p) for p in predicates)
        return cls(predicates, message=(
            f"{len(predicates)} predicate(s) outside the controlled "
            f"relationship vocabulary (skills/shared/entity-schema.md): "
            f"{listed}. Normalize the vault before mapping or pushing — "
            f"do not add aliases to the predicate tables."))


# vault relationship predicate -> mobRPG Event eventType, derived from the same
# export as PREDICATE_RELATION. Hand-maintaining this alongside the ontology let
# the two disagree (commands/serves/participated_in) and left seven predicates
# the ontology types falling through to Generic. A per-world map can still
# override any entry via `relationshipTypes`; change the ontology, not this module.
# Generic is the default, so only non-Generic entries are carried here.
PREDICATE_EVENTTYPE = {p["type"]: p["mobrpg_event_type"]
                       for p in _ONTOLOGY["predicates"]
                       if p.get("mobrpg_event_type")
                       and p["mobrpg_event_type"] != "Generic"}

# mobRPG has a SECOND relationship mechanism besides reified Events: a direct
# WorldElementRelation (enum Attribute | Link | Parent | Child | Spouse).
#
# Parent/Child/Spouse are GENEALOGY BETWEEN PEOPLE, not a containment hierarchy.
# Their only consumer in the API is PersonService.getSiblings (find a person's
# parents via Child, then their other children via Parent), and the backend
# auto-creates the reciprocal row for them (CreateWorldRelationRequest
# .toReverseModel: Parent->Child, Child->Parent, Spouse->Spouse; Link and
# Attribute get no reciprocal). Direction reads source-first: (S, Parent, T)
# means "S is the parent of T".
#
# Place containment is a Link — a single row, no reciprocal. Mapping spatial
# predicates onto Parent was wrong twice over: wrong domain, and inverted, so
# `Corwin IV part_of Corwin System` asserted that the planet was the parent of
# its own star system, doubled by an auto-reciprocal.
#
# Unlike eventTypes, which are per-world created classifiers, this is a backend
# enum and is therefore stable across worlds — so the mapping lives in the
# ontology export as `mobrpg_relation_type` and is derived here rather than
# restated. Change the ontology, not this module.
RELATION_TYPES = set(_ONTOLOGY["mobrpg_relation_type_enum"])
PREDICATE_RELATION = {p["type"]: p["mobrpg_relation_type"]
                      for p in _ONTOLOGY["predicates"]
                      if p.get("mobrpg_relation_type")}


def predicate_type(predicate: str) -> str:
    """Resolve a vault predicate to its mobRPG type. A WorldElementRelationType
    (Parent/Child/Link/Spouse — see RELATION_TYPES) means a direct relation;
    a sanctioned predicate with no specific mapping is an Event eventType,
    defaulting to Generic.

    Raises UnknownPredicate for anything outside the controlled vocabulary.
    Coercing an unknown predicate to Generic is what let vault drift reach
    mobRPG as a pile of untyped events; an off-vocabulary predicate is a defect
    to fix in the vault, not a case to absorb here."""
    if predicate not in ONTOLOGY_PREDICATES:
        raise UnknownPredicate(predicate)
    if predicate in PREDICATE_RELATION:
        return PREDICATE_RELATION[predicate]
    return PREDICATE_EVENTTYPE.get(predicate, "Generic")


def derive_namespace(vault: str) -> str:
    """Derive the vault's mobRPG namespace instead of hardcoding it. A hardcoded
    namespace is a footgun: writing e.g. `canticle:` externalRefs for a vault
    whose nodes actually use `space_game:` breaks externalRef correlation, so
    `suggest` can't dedupe against the existing element and risks a duplicate
    create on `--execute`. Prefer the namespace of an existing note's `mobrpg:`
    node `external_ref` (the substring before the first ':'); else fall back to
    the vault directory basename."""
    vault = os.path.expanduser(vault)
    for folder in FOLDERS:
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            nd = node.read_node(open(p, encoding="utf-8").read())
            ref = nd.get("external_ref") if nd else None
            if ref and ":" in ref:
                return ref.split(":", 1)[0]
    return os.path.basename(vault.rstrip("/")) or "default"


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _first_token(s: str) -> str:
    return re.split(r"[,/;]", s or "", maxsplit=1)[0].strip()


def classifier_name(s: str) -> str:
    """Clean base label for a shared-vocabulary classifier (profession, org type,
    creature type) minted into someone else's world.

    The vault's own fields are rich authorial free text — "Recovery agent
    (contracted to [[Corvid Financial]])" — and STAY that way in the vault. What
    gets pushed must be the base label only: no affiliation clause, no wikilink
    markup, no parenthetical qualifier, because those turn a shared type into a
    one-off and (for wikilinks) leak raw Obsidian syntax upstream. Casing is left
    to the call site.

    Strips, in order: the delimited suffix (`, / ;` via `_first_token`), a
    spaced-dash clause (`— …`, `- …` — the space guard preserves hyphenated words
    like "bare-knuckle"), parentheticals, then any surviving wikilink markup as a
    defensive last pass so `[[` can never reach mobRPG however it was embedded."""
    s = _first_token(s)
    s = re.split(r"\s+[—–-]\s+", s, maxsplit=1)[0]
    s = re.sub(r"\s*\([^)]*\)", "", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).split("|")[-1], s)
    return re.sub(r"\s{2,}", " ", s).strip()


def _frontmatter(path: str) -> str:
    txt = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---", txt, re.S)
    return m.group(1) if m else ""


def _scalar(fm: str, key: str) -> str | None:
    m = re.search(rf"^{re.escape(key)}:\s*(.+)$", fm, re.M)
    if not m:
        return None
    return m.group(1).strip().strip('"').strip("'") or None


def _predicates(fm: str) -> list[str]:
    # relationship predicates appear as indented `type:` lines under `relationships:`
    block = re.search(r"^relationships:\s*\n(.*?)(?=^\S|\Z)", fm, re.S | re.M)
    if not block:
        return []
    return [m.group(1) for m in re.finditer(r"^\s+type:\s*(\S+)", block.group(1), re.M)]


def scan_vault(vault: str) -> dict:
    """Collect distinct mapping-relevant vocab (value -> count) from the vault frontmatter."""
    vocab = {k: {} for k in ("location_type", "occupation", "gender", "faction_type",
                             "creature_type", "predicate")}
    for folder in FOLDERS:
        for p in glob.glob(os.path.join(os.path.expanduser(vault), folder, "*.md")):
            fm = _frontmatter(p)
            for field in ("location_type", "occupation", "gender", "faction_type", "creature_type"):
                v = _scalar(fm, field)
                if v:
                    key = _first_token(v)
                    vocab[field][key] = vocab[field].get(key, 0) + 1
            for pred in _predicates(fm):
                vocab["predicate"][pred] = vocab["predicate"].get(pred, 0) + 1
    return vocab


def discover(world: str, token: str) -> dict:
    """Fetch existing mobRPG classifier vocab: kind -> {normalized name: id}."""
    out = {}
    for kind in ("political/type", "organization/type", "creature/type",
                 "person/race", "person/profession", "language", "landfeature"):
        try:
            data = client._request("GET", f"/world/{world}/{kind}?size=500", token=token)
        except (client.ApiError, ValueError):
            data = []  # ValueError covers JSONDecodeError (some endpoints return non-JSON/empty)
        items = data if isinstance(data, list) else data.get("content", []) if isinstance(data, dict) else []
        out[kind] = {_norm(e.get("name")): e.get("id") for e in items if isinstance(e, dict)}
    return out


# A vault value this close to an existing type (but not an exact-CI match) is
# probably a variant/typo of it, not a genuinely new type — park it for review.
_NEAR_DUP_CUTOFF = 0.85


def _closest(n: str, existing: dict) -> tuple[str, str] | None:
    """The (normalized-name, id) of the existing type closest to `n` above the
    near-duplicate cutoff, or None. `n` is assumed already normalized and NOT an
    exact match (callers check that first).

    Falls back to a head-noun match, because edit distance misses the common
    qualifier case: `location_type` is uncontrolled free text, so a vault authors
    "hyperspace gate" where the world already has "Gate" — similarity 0.55, well
    under the cutoff, so it would mint a near-duplicate type. English head nouns
    trail, so the last word is the type and the leading words qualify it. The
    caller marks any hit `review` with the candidate attached, so this proposes a
    binding for the GM rather than making one."""
    hit = difflib.get_close_matches(n, list(existing), n=1, cutoff=_NEAR_DUP_CUTOFF)
    if hit and hit[0] != n:
        return hit[0], existing[hit[0]]
    words = n.split()
    if len(words) > 1 and words[-1] in existing:
        return words[-1], existing[words[-1]]
    return None


def _bind(value: str, existing: dict, target_kind: str) -> dict:
    """Match a vault value to an existing mobRPG type, flag a near-duplicate for
    review, else propose a new one."""
    # Match on the first-token key (consistent with scan_vault's keying), but store
    # the sanitized base label — the name is what gets minted into mobRPG.
    tok = _first_token(value)
    n = _norm(tok)
    name = classifier_name(value)
    hit = existing.get(n)
    if hit:
        return {"target": target_kind, "name": name, "mobrpgId": hit, "status": "bound"}
    near = _closest(n, existing)
    if near:
        return {"target": target_kind, "name": name.title(), "mobrpgId": None,
                "status": "review", "nearExisting": near[0], "nearId": near[1]}
    return {"target": target_kind, "name": name.title(), "mobrpgId": None, "status": "new"}


# natural-feature words NOT spelled exactly like a LandFeatureSubType enum value
LAND_SYNONYMS = {
    "waterway": "River", "brook": "Stream", "creek": "Stream", "woods": "Wood", "wood": "Wood",
    "hills": "Hill", "mountains": "Mountain", "peak": "Mountain", "summit": "Mountain",
    "plateau": "Mesa", "canyon": "Gorge", "ravine": "Gorge", "gully": "Gully", "marshland": "Marsh",
    "wetland": "Marsh", "bog": "Swamp", "seashore": "Shore", "coastline": "Coast", "riverbank": "River",
}


def _embedded_landfeature(n: str) -> str | None:
    """The canonical LandFeatureSubType named by a *component word* of `n`, or
    None. Splits on non-letters so 'river valley' / 'old mill creek' surface the
    'river' / 'creek' feature word while single clean features (handled earlier)
    and plain political names ('hospital') do not."""
    for w in re.split(r"[^a-z]+", n):
        if w in LAND_SUBTYPES:
            return LAND_SUBTYPES[w]
        if w in LAND_SYNONYMS:
            return LAND_SYNONYMS[w]
    return None


def _axis_keys(value: str):
    """Keys to test against the location_nature axis: the whole normalised type,
    then its head noun. English head nouns trail, so 'icy planet' and
    'toxic-atmosphere planet' both resolve via 'planet' without needing an entry
    each — location_type is free text and cannot be enumerated.

    Parenthesised and dash-trailing qualifiers are dropped first, so
    'planet (habitable — for now)' resolves as 'planet' rather than on 'now'.
    Only the head noun is tested, never every word: 'Planet Hollywood' is a venue,
    and matching any word would call it a planet."""
    base = re.sub(r"\(.*?\)", " ", value)          # drop parentheticals
    base = re.split(r"\s+[—–-]\s+", base)[0]       # drop a trailing dash qualifier
    words = [w for w in re.split(r"[^a-z0-9]+", _norm(base)) if w]
    keys = [" ".join(words)] if words else []
    if len(words) > 1:
        keys.append(words[-1])
    return keys


def _ontology_natural(value: str):
    for k in _axis_keys(value):
        if k in LOCATION_NATURAL:
            return LOCATION_NATURAL[k]
    return None


def _ontology_built(value: str) -> bool:
    return any(k in LOCATION_BUILT for k in _axis_keys(value))


def canon_location_bindings(vault: str) -> dict:
    """{normalized location_type: (target, classifier_name, element_kind)} learned
    from linked notes' ratified `determined` blocks.

    The vault's `location_type` is the GM's own free-text vocabulary and is not
    required to match mobRPG's; a vault says "hyperspace gate" where the world
    says "Gate". Rather than guess a mapping between them, observe it: every
    linked note already records what its element actually IS upstream, so a
    vocabulary term used by any linked note has a known answer. That makes the
    mapping self-correcting — `pull-canon --refresh` updates `determined` from
    canon, and the next `map init` picks the correction up — instead of routing
    off a locally-invented value and proposing a duplicate type upstream.

    A term whose linked notes disagree is left out, so the ordinary heuristics
    (and the near-duplicate review) decide rather than an arbitrary winner.
    """
    seen: dict = {}
    for path in glob.glob(os.path.join(os.path.expanduser(vault), "**", "*.md"),
                          recursive=True):
        if os.sep + "_midwife" + os.sep in path:
            continue
        try:
            txt = open(path, encoding="utf-8").read()
        except OSError:
            continue
        nd = node.read_node(txt)
        if not nd or not nd.get("element_id") or nd.get("review_state") != "accepted":
            continue
        lt = _scalar(_frontmatter(path), "location_type")
        if not lt:
            continue
        det = nd.get("determined") or {}
        pol, land = det.get("political_type"), det.get("land_feature_type")
        if pol:
            hit = ("political", pol)
        elif land:
            hit = ("landfeature", land)
        else:
            continue
        seen.setdefault(_norm(lt), set()).add(hit)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def _route_location(value: str, disc: dict, canon: dict | None = None) -> dict:
    """Route a vault location_type to a mobRPG target. An existing PoliticalType
    binds; a type that IS a clean natural feature (exact LandFeatureSubType enum
    or a synonym) routes to LandFeature; a type that merely EMBEDS a feature word
    but isn't itself a clean feature is genuinely ambiguous (a natural feature, or
    a place named after one?) and is parked in 'review' with both candidates; and
    everything else defaults to a new PoliticalType."""
    tok = _first_token(value)
    n = _norm(tok)
    # Canon outranks every heuristic: if linked notes using this vault term are
    # already typed upstream, that IS the mapping — no need to infer one.
    hit = (canon or {}).get(_norm(value))
    if hit:
        target, name = hit
        if target == "landfeature":
            return {"target": "landfeature", "landFeatureType": name,
                    "mobrpgId": None, "status": "canon"}
        return {"target": "political", "politicalType": name,
                "mobrpgId": disc["political/type"].get(_norm(name)),
                "status": "bound" if disc["political/type"].get(_norm(name)) else "canon"}
    # The ontology's natural/built axis outranks everything, including an existing
    # upstream PoliticalType: a world that already carries "Planet" as a political
    # type got it from a bad push, and binding to it would re-commit that error
    # (this is what would have reclassified 38 planets/moons/stars as Political).
    nat = _ontology_natural(value)
    if nat:
        return {"target": "landfeature", "landFeatureType": nat,
                "mobrpgId": None, "status": "new"}
    if _ontology_built(value):
        hit = disc["political/type"].get(n)
        return {"target": "political", "politicalType": tok if hit else tok.title(),
                "mobrpgId": hit, "status": "bound" if hit else "new"}
    hit = disc["political/type"].get(n)
    if hit:  # reuse an existing PoliticalType
        return {"target": "political", "politicalType": tok, "mobrpgId": hit, "status": "bound"}
    if n in LAND_SUBTYPES:  # clearly a natural feature (exact enum)
        return {"target": "landfeature", "landFeatureType": LAND_SUBTYPES[n],
                "mobrpgId": None, "status": "new"}
    if n in LAND_SYNONYMS:  # clearly natural (synonym of an enum value)
        return {"target": "landfeature", "landFeatureType": LAND_SYNONYMS[n],
                "mobrpgId": None, "status": "new"}
    feature = _embedded_landfeature(n)
    if feature:  # embeds a feature word but isn't a clean feature -> GM decides
        return {"target": "political", "politicalType": tok.title(),
                "landFeatureType": feature, "mobrpgId": None, "status": "review"}
    # default: a new PoliticalType (obviously-not-landfeature => political)
    return {"target": "political", "politicalType": tok.title(), "mobrpgId": None, "status": "new"}


def build_map(world: str, world_meta: dict, vault: str, disc: dict, vocab: dict, now: str) -> dict:
    classifiers = {
        "profession": {v: _bind(v, disc["person/profession"], "person/profession")
                       for v in vocab["occupation"]},
        "organizationType": {v: _bind(v, disc["organization/type"], "organization/type")
                             for v in vocab["faction_type"]},
        "creatureType": {v: _bind(v, disc["creature/type"], "creature/type")
                         for v in vocab["creature_type"]},
        "sex": {v: {"target": "person/race/sex", "name": v.title(), "status": "new"}
                for v in vocab["gender"]},
    }
    canon_loc = canon_location_bindings(vault)
    location_routing = {v: _route_location(v, disc, canon_loc)
                        for v in vocab["location_type"]}
    # Report every off-vocabulary predicate at once rather than dying on the
    # first: the caller needs the whole list to fix the vault in one pass.
    rel_types, off_vocab = {}, []
    for p in vocab["predicate"]:
        try:
            rel_types[p] = predicate_type(p)
        except UnknownPredicate:
            off_vocab.append(p)
    if off_vocab:
        raise UnknownPredicate.aggregate(sorted(off_vocab))
    return {
        "schema": "mobrpg-vault-map/v1",
        "world": world_meta.get("name"), "worldId": world,
        "vault": os.path.expanduser(vault), "vaultNamespace": derive_namespace(vault),
        "discoveredAt": now,
        "kinds": dict(KINDS),
        "locationRouting": location_routing,
        "classifiers": classifiers,
        "relationshipTypes": rel_types,
        "_discoveredVocab": {k: sorted(vlist) for k, vlist in
                             {kk: list(vv.keys()) for kk, vv in disc.items()}.items()},
        "_vaultVocab": {k: v for k, v in vocab.items()},
    }


def _counts(m: dict) -> dict:
    def over(section):
        vals = list(section.values())
        return {"bound": sum(1 for x in vals if x.get("status") == "bound"),
                "new": sum(1 for x in vals if x.get("status") == "new"),
                "review": sum(1 for x in vals if x.get("status") == "review"),
                "confirmed": sum(1 for x in vals if x.get("confirmed")), "total": len(vals)}
    out = {"locationRouting": over(m.get("locationRouting", {}))}
    for name, sec in m.get("classifiers", {}).items():
        out[name] = over(sec)
    return out


def _entry(old_entry: dict | None, fresh: dict, label: str, notes: list[str]) -> dict:
    """Reconcile one mapping entry across a sync.

    A rediscovery is a *proposal*; what is already in the map may be a *resolution*.
    A proposal never overwrites a resolution — that is the whole contract `sync`
    offers, and breaking it silently discards GM decisions. Two things count as
    resolved: the explicit `confirmed` idiom, and a binding that already carries a
    real `mobrpgId`. The latter matters because the fuzzy near-duplicate matcher
    re-proposes an already-bound value as `review` on every run (a vault
    `government` bound to mobRPG's `Governmental` scores 0.91 and comes back as a
    near-dup), which would silently unbind it each time.
    """
    if old_entry is None:
        return fresh
    if old_entry.get("confirmed") or old_entry.get("status") == "confirmed":
        return old_entry  # human decision wins
    if old_entry.get("status") == "stale":
        return fresh  # a tombstone for a value that left the vault; let it come back
    old_id, new_id = old_entry.get("mobrpgId"), fresh.get("mobrpgId")
    if old_id and not new_id:
        if fresh.get("nearId") == old_id:
            # rediscovery is re-proposing the very binding already held: keep it
            notes.append(f"{label}: kept existing binding {old_id} "
                         f"(rediscovery proposed '{fresh.get('status')}')")
            return old_entry
        # canon has no type for this value at all, so the held id is dangling. Keep
        # the decision -- a discovery blip must not destroy it -- but stop reporting
        # it as `bound`, so `map check` surfaces it rather than counting it healthy.
        notes.append(f"{label}: upstream type for binding {old_id} is no longer "
                     f"discoverable — kept, flagged for review")
        return {**old_entry, "status": "review"}
    if old_id and new_id and old_id != new_id:
        notes.append(f"{label}: canon now resolves to a different type "
                     f"({old_id} -> {new_id})")
        return fresh
    if old_entry.get("status") in ("new", "review") and fresh.get("status") == "bound":
        notes.append(f"{label}: now bound to existing type")
    return fresh


def _merge_section(o: dict, n: dict, label: str, notes: list[str]) -> dict:
    """Merge one section: reconcile shared keys, add new ones, flag dropped ones."""
    res = {k: _entry(o.get(k), nv, f"{label}[{k}]", notes) for k, nv in n.items()}
    for k in o:
        if k not in n:
            stale = dict(o[k]); stale["status"] = "stale"; res[k] = stale
            notes.append(f"{label}[{k}]: no longer in vault (stale)")
    return res


def _merge(old: dict, new: dict) -> tuple[dict, list[str]]:
    """Non-destructive merge: preserve resolved/confirmed entries; add new keys;
    promote new->bound when a matching type now exists; flag stale keys."""
    notes = []
    merged = dict(new)
    merged["locationRouting"] = _merge_section(
        old.get("locationRouting", {}), new.get("locationRouting", {}),
        "locationRouting", notes)
    # rebind rather than mutate: `dict(new)` is shallow, so writing into
    # merged["classifiers"] in place would reach through into the caller's `new`.
    merged["classifiers"] = {}
    for name in new.get("classifiers", {}):
        merged["classifiers"][name] = _merge_section(
            old.get("classifiers", {}).get(name, {}), new["classifiers"][name],
            f"classifiers.{name}", notes)
    return merged, notes


def _default_map_path(vault: str) -> str:
    return os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="mobrpg map",
                                 description="Generate/maintain the per-vault mobRPG mapping.")
    ap.add_argument("action", choices=("init", "sync", "check"))
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
    ap.add_argument("--out", default="", help="init: where to write (default: the map path)")
    ap.add_argument("--now", default="", help="timestamp override (tests); default: UTC now")
    args = ap.parse_args(argv)

    map_path = args.map or args.out or _default_map_path(args.vault)
    now = args.now or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    try:
        token = client.get_access_token()
        world_meta = {}
        try:
            worlds = client._request("GET", "/world", token=token)
            wl = worlds if isinstance(worlds, list) else worlds.get("content", [])
            world_meta = next((w for w in wl if w.get("id") == args.world), {})
        except client.ApiError:
            pass
        disc = discover(args.world, token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    vocab = scan_vault(args.vault)
    fresh = build_map(args.world, world_meta, args.vault, disc, vocab, now)

    if args.action == "check":
        old = json.load(open(map_path)) if os.path.exists(map_path) else fresh
        print(f"map coverage ({map_path if os.path.exists(map_path) else '(no map yet; showing fresh)'}):")
        for section, c in _counts(old).items():
            print(f"  {section:18} total={c['total']:3}  bound={c['bound']:3}  new={c['new']:3}  "
                  f"review={c['review']:3}  confirmed={c['confirmed']:3}")
        return 0

    if args.action == "init":
        if os.path.exists(map_path):
            print(f"map already exists at {map_path} — use `map sync` to update it.", file=sys.stderr)
            return 2
        os.makedirs(os.path.dirname(map_path), exist_ok=True)
        json.dump(fresh, open(map_path, "w"), indent=2, ensure_ascii=False)
        c = _counts(fresh)
        print(f"wrote {map_path}")
        for section, cc in c.items():
            print(f"  {section:18} total={cc['total']:3} bound={cc['bound']:3} new={cc['new']:3} review={cc['review']:3}")
        return 0

    # sync
    if not os.path.exists(map_path):
        print(f"no map at {map_path} — run `map init` first.", file=sys.stderr)
        return 2
    old = json.load(open(map_path))
    merged, notes = _merge(old, fresh)
    merged["discoveredAt"] = now
    json.dump(merged, open(map_path, "w"), indent=2, ensure_ascii=False)
    print(f"synced {map_path}: {len(notes)} change(s)")
    for n in notes:
        print(f"  - {n}")
    if not notes:
        print("  (no drift)")
    return 0

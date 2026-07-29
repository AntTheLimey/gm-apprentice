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
import functools
import glob
import importlib.resources
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
# The ontology JSON ships as package data (mobrpg/gm-apprentice-ontology.json)
# and is loaded LAZILY via importlib.resources: importing this module must never
# read the file, so a missing/broken ontology degrades only `map` and its callers
# — not `whoami`, `auth`, or any other verb. The load and every derivation below
# are memoized on first use.
_ONTOLOGY_RESOURCE = "gm-apprentice-ontology.json"
# Filesystem path to the same resource, kept for tests/tooling. Computing it does
# not read the file; only _load_ontology() (below) opens the resource.
_ONTOLOGY_PATH = os.path.join(os.path.dirname(__file__), "..", _ONTOLOGY_RESOURCE)


@functools.lru_cache(maxsize=1)
def _load_ontology():
    ref = importlib.resources.files("mobrpg").joinpath(_ONTOLOGY_RESOURCE)
    with ref.open(encoding="utf-8") as fh:
        return json.load(fh)


@functools.lru_cache(maxsize=1)
def _derived():
    """All ontology-derived vocabularies, computed once on first access. Nothing
    here runs at import time — see __getattr__ for how the public names below are
    exposed as lazy module attributes."""
    ont = _load_ontology()
    return {
        "ONTOLOGY_PREDICATES": frozenset(p["type"] for p in ont["predicates"]),
        # vault entity kind -> mobRPG element kind. A projection of
        # gm-apprentice's own entity types onto mobRPG's, so it lives in the
        # ontology rather than here.
        "KINDS": {k: v for k, v in ont["mobrpg_element_kind"].items()
                  if not k.startswith("$")},
        # location_type natural/built axis (open vocabulary — see the export).
        "LOCATION_NATURAL": ont["location_nature"]["natural"],
        "LOCATION_BUILT": frozenset(ont["location_nature"]["built"]),
        # vault predicate -> mobRPG Event eventType (only non-Generic entries).
        "PREDICATE_EVENTTYPE": {p["type"]: p["mobrpg_event_type"]
                                for p in ont["predicates"]
                                if p.get("mobrpg_event_type")
                                and p["mobrpg_event_type"] != "Generic"},
        # backend WorldElementRelationType enum (Attribute|Link|Parent|Child|Spouse).
        "RELATION_TYPES": set(ont["mobrpg_relation_type_enum"]),
        "PREDICATE_RELATION": {p["type"]: p["mobrpg_relation_type"]
                               for p in ont["predicates"]
                               if p.get("mobrpg_relation_type")},
        # ASYMMETRIC Link predicates (subordinate-first authored, container-first
        # in mobRPG) that `suggest` swaps source/target for.
        "REVERSED_PREDICATES": frozenset(
            p["type"] for p in ont["predicates"]
            if p.get("mobrpg_relation_type") == "Link"
            and not p.get("symmetric", False)),
    }


_LAZY_NAMES = frozenset({
    "ONTOLOGY_PREDICATES", "KINDS", "LOCATION_NATURAL", "LOCATION_BUILT",
    "PREDICATE_EVENTTYPE", "RELATION_TYPES", "PREDICATE_RELATION",
    "REVERSED_PREDICATES",
})


def __getattr__(name):
    # PEP 562 lazy module attributes: resolve the ontology-derived vocabularies
    # (and the raw ontology) on first external access, so `import map_cmd` never
    # reads the file. Internal code calls _derived()/_load_ontology() directly.
    if name in _LAZY_NAMES:
        return _derived()[name]
    if name == "_ONTOLOGY":
        return _load_ontology()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

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


# The predicate->eventType, RELATION_TYPES, predicate->relation, and reversed-
# predicate vocabularies are all derived from the ontology in _derived() above and
# exposed as lazy module attributes (PREDICATE_EVENTTYPE, RELATION_TYPES,
# PREDICATE_RELATION, REVERSED_PREDICATES). Design notes preserved there:
#   - PREDICATE_EVENTTYPE: only non-Generic entries; a per-world map can override
#     any entry via `relationshipTypes`. Change the ontology, not this module.
#   - RELATION_TYPES / PREDICATE_RELATION: mobRPG's SECOND relationship mechanism,
#     a direct WorldElementRelation (Attribute|Link|Parent|Child|Spouse). Parent/
#     Child/Spouse are GENEALOGY BETWEEN PEOPLE (backend auto-creates the
#     reciprocal); place containment is a Link (single row, no reciprocal). This
#     is a stable backend enum, so it lives in the ontology, derived here.
#   - REVERSED_PREDICATES: spatial predicates are authored subordinate-first
#     ("X part_of Y" = Y contains X) but mobRPG's Link convention is container-
#     first; `suggest` swaps source/target for the ASYMMETRIC Link predicates so a
#     push never lands a reversed edge (borders is symmetric, so it is excluded).


# --- person <-> group affiliation ------------------------------------------
#
# mobRPG never asks a user to choose an eventType. The GUI hangs relation tabs
# off an element and derives the type from which tab you were on: Reign and
# Employ live on a Political element, Leadership and Membership on an
# Organization (site/src/component/world/elements/info/{person,political,
# organization}-info.tsx, via event-type-elements.tsx). So the SAME vault
# predicate means different things depending on what it points at, and a flat
# predicate->eventType table cannot express that: `serves` -> Employ fired
# against Corvid Financial and Kinetic Logistics, both Organizations — a pairing
# the GUI itself cannot produce.
#
# _PERSON_STANCE records what the SUBJECT is relative to the object. When the
# person is the object instead, the stance inverts: "Corvid employs Marek" makes
# Marek the subordinate, i.e. the same event as "Marek serves Corvid".
_PERSON_STANCE = {
    "rules": "superior", "owns": "superior", "leads": "superior",
    "employs": "superior", "commands": "superior",
    "serves": "subordinate", "member_of": "subordinate", "vassal_of": "subordinate",
    "founded": "subordinate", "infiltrates": "subordinate",
    "defected_from": "subordinate",
}

# (person's stance, the group's element kind) -> Event eventType. From
# EventType.java and the tab wiring above.
_AFFILIATION_EVENTTYPE = {
    ("superior", "Political"): "Reign",
    ("superior", "Organization"): "Leadership",
    ("subordinate", "Political"): "Employ",
    ("subordinate", "Organization"): "Membership",
}

# Default title word + preposition per eventType, mirroring formatEventName in
# site/src/helpers/event.helper.ts so a pushed event reads the same as one made
# in the GUI. The title itself is the reviewer's to set — mobRPG offers a title
# picker (GET /world/{id}/{kind}/{id}/titles) that we deliberately don't guess
# at; these are its fallbacks.
AFFILIATION_NAMING = {
    "Reign": ("Owner", "of"),
    "Employ": ("Employment", "at"),
    "Membership": ("Member", "of"),
    "Leadership": ("Leader", "of"),
}

AFFILIATION_EVENT_TYPES = frozenset(AFFILIATION_NAMING)


def is_map_override(mp, predicate) -> bool:
    """True only for a `relationshipTypes` entry that DIFFERS from the ontology
    default — a deliberate per-world decision.

    `map init`/`map sync` write an entry for every predicate they discover, and
    those entries just restate `predicate_type()`. Treating any entry at all as
    an override would mean a real vault (space_game maps all 25 of its
    predicates this way) never reaches the affiliation grid. An entry for an
    off-vocabulary predicate counts as an override, because it is the only
    mapping that exists.
    """
    mapped = (mp.get("relationshipTypes") or {}).get(predicate)
    if not mapped:
        return False
    try:
        return mapped != predicate_type(predicate)
    except UnknownPredicate:
        return True


def resolve_event_type(mp, predicate, subject_kind=None, target_kind=None):
    """Resolve one authored edge to `(mobrpg_type, affiliation_or_None)`.

    `mobrpg_type` is either a structural WorldElementRelationType or an Event
    eventType; `affiliation_or_None` is `(eventType, person_is_subject)` when the
    person/group grid decided it.

    This is the SINGLE entry point both directions must use. `suggest` emits the
    type and `pull-canon --baseline` looks the type up again to match what is
    already upstream — if they disagree, the edge never reconciles, so every
    later run re-proposes an event mobRPG already holds. Passing no kinds
    degrades to the flat predicate mapping.
    """
    mapped = (mp.get("relationshipTypes") or {}).get(predicate)
    if is_map_override(mp, predicate):
        return mapped, None
    aff = affiliation(predicate, subject_kind, target_kind)
    if aff:
        return aff[0], aff
    et = mapped or predicate_type(predicate)
    # The grid declined, but the flat predicate table still names an affiliation
    # eventType — it maps `owns`/`serves` by predicate alone and cannot see the
    # endpoints. Those four types ARE the person/group join; mobRPG builds them
    # from a person and a Political/Organization and nothing else, so an edge the
    # grid rejected has no business wearing one. Degrade to Generic, which is how
    # mobRPG already carries every non-group edge (the predicate rides on the
    # title). Only when both kinds are known: no kinds means no judgement, and the
    # flat mapping stays the documented degraded behaviour.
    if et in AFFILIATION_EVENT_TYPES and subject_kind and target_kind:
        return "Generic", None
    return et, None


def event_types_for_kind(group_kind) -> list:
    """The affiliation eventTypes mobRPG offers against one group element kind —
    Reign/Employ on a Political, Leadership/Membership on an Organization."""
    return sorted(et for (_stance, kind), et in _AFFILIATION_EVENTTYPE.items()
                  if kind == group_kind)


def affiliation(predicate: str, subject_kind, target_kind):
    """Resolve a person<->group edge to `(eventType, person_is_subject)`.

    Returns None when the edge is not one of these — neither endpoint is a
    Person, the other endpoint is not a Political/Organization, or the predicate
    carries no stance — in which case the caller keeps the flat predicate
    mapping. Declining is deliberate: this grid describes what mobRPG's GUI can
    build, and an edge outside it is not something to force into the nearest fit.
    """
    stance = _PERSON_STANCE.get(predicate)
    if stance is None:
        return None
    if subject_kind == "Person" and target_kind in ("Political", "Organization"):
        person_is_subject, group_kind = True, target_kind
    elif target_kind == "Person" and subject_kind in ("Political", "Organization"):
        person_is_subject, group_kind = False, subject_kind
        stance = "subordinate" if stance == "superior" else "superior"
    else:
        return None
    et = _AFFILIATION_EVENTTYPE.get((stance, group_kind))
    return None if et is None else (et, person_is_subject)


def predicate_type(predicate: str) -> str:
    """Resolve a vault predicate to its mobRPG type. A WorldElementRelationType
    (Parent/Child/Link/Spouse — see RELATION_TYPES) means a direct relation;
    a sanctioned predicate with no specific mapping is an Event eventType,
    defaulting to Generic.

    Raises UnknownPredicate for anything outside the controlled vocabulary.
    Coercing an unknown predicate to Generic is what let vault drift reach
    mobRPG as a pile of untyped events; an off-vocabulary predicate is a defect
    to fix in the vault, not a case to absorb here."""
    d = _derived()
    if predicate not in d["ONTOLOGY_PREDICATES"]:
        raise UnknownPredicate(predicate)
    if predicate in d["PREDICATE_RELATION"]:
        return d["PREDICATE_RELATION"][predicate]
    return d["PREDICATE_EVENTTYPE"].get(predicate, "Generic")


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
    like "bare-knuckle"), balanced parentheticals (looped, so nested ones fully
    unwind), an unclosed `(` clause running to the end, and wikilink markup. A final
    scrub of any surviving bracket/paren guarantees no such character ever reaches
    mobRPG however malformed the input; the residual words are best-effort."""
    s = _first_token(s)
    s = re.split(r"\s+[—–-]\s+", s, maxsplit=1)[0]
    prev = None
    while prev != s:                                   # balanced parens, incl. nested
        prev = s
        s = re.sub(r"\s*\([^()]*\)", "", s)
    s = re.sub(r"\s*\([^)]*$", "", s)                  # an unclosed '(' clause to end
    s = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).split("|")[-1], s)
    s = re.sub(r"[\[\]()]", "", s)                     # defensive: never leak markup chars
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


def _fetch_all(path: str, token: str) -> list:
    """Fetch every item across pages for a catalog list endpoint.

    Handles both a bare-list response and a Spring page envelope
    ({content, page.totalPages}), following totalPages so a world with more than
    one page is never silently truncated — the old hardcoded ?size=500 fetched a
    single page and dropped the rest, minting duplicate types past the cap. A
    network/decode error stops paging and returns whatever was gathered so far
    (empty on a first-page failure), matching the previous fail-soft behaviour.
    """
    out, page = [], 0
    while True:
        try:
            data = client._request("GET", path, token=token,
                                   query={"page": page, "size": 200})
        except (client.ApiError, ValueError):
            break  # ValueError covers JSONDecodeError (some endpoints return non-JSON/empty)
        if isinstance(data, list):
            out.extend(data)
            break  # a bare list is unpaged
        if not isinstance(data, dict):
            break
        out.extend(data.get("content", []))
        total = (data.get("page") or {}).get("totalPages", 1)
        if page >= total - 1:
            break
        page += 1
    return out


def discover(world: str, token: str) -> dict:
    """Fetch existing mobRPG classifier vocab: kind -> {normalized name: id}."""
    out = {}
    for kind in ("political/type", "organization/type", "creature/type",
                 "person/race", "person/profession", "language", "landfeature"):
        items = _fetch_all(f"/world/{world}/{kind}", token)
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
    natural = _derived()["LOCATION_NATURAL"]
    for k in _axis_keys(value):
        if k in natural:
            return natural[k]
    return None


def _ontology_built(value: str) -> bool:
    built = _derived()["LOCATION_BUILT"]
    return any(k in built for k in _axis_keys(value))


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
        "sex": {v: {"target": "person/race/sex", "name": classifier_name(v).title(),
                    "status": "new"}
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
        "kinds": dict(_derived()["KINDS"]),
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

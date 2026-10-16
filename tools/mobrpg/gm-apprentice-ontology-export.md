# gm-apprentice Knowledge-Graph Ontology

A standalone export of the gm-apprentice campaign ontology for the mobRPG team.
The vocabulary itself is not kept here. The one source is
`skills/shared/gm-apprentice-ontology.json`; its generated copy for mobRPG is
`tools/mobrpg/mobrpg/gm-apprentice-ontology.json`, and `relationships words`
in the publish tool prints the current list. Edge structure and modeling:
`skills/ttrpg-expert/relationship-patterns.md`.

Each predicate in the ontology file carries a suggested `eventType`
(`mobrpg_event_type`) for reifying it onto mobRPG's `event`-as-join model
(enum: `Employ, Membership, Leadership, Reign, War, Score, Generic`).

---

## 1. Entity type hierarchy

Abstract types (italic) are not assigned directly — they exist for constraint
inheritance. Concrete leaf types are what entities actually use.

```text
person (abstract)
├── player
├── game_master
└── character (abstract)
    ├── pc
    └── npc

agent (abstract)            — can act, decide, exert influence
├── character (see above)
├── creature
│   ├── beast
│   ├── undead
│   ├── construct
│   ├── spirit
│   ├── deity
│   └── aberration
├── faction
└── organization
    ├── government
    ├── corporation
    ├── cult
    ├── guild
    ├── military
    └── criminal

place (abstract)
└── location                — nests via part_of

artifact (abstract)
├── item
│   ├── weapon
│   ├── armor
│   ├── vehicle
│   ├── treasure
│   ├── relic
│   ├── tool
│   └── consumable
└── document
    ├── spell
    ├── map
    ├── letter
    ├── prophecy
    ├── contract
    └── journal

narrative (abstract)
├── event
│   ├── battle
│   ├── ritual
│   ├── disaster
│   ├── discovery
│   ├── betrayal_event
│   └── celebration
├── clue
├── plan
├── adventure-brief
└── campaign_overview

world (abstract)
├── heritage
├── world_domain
└── world_flags
```

---

## 2. Relationship (edge) structure

Every relationship is a directed, typed edge. Stored **single-direction only** —
if `A --employs--> B` is recorded, the inverse `B --employed_by--> A` is *implied*,
never stored twice. Symmetric types (`symmetric: true` in the ontology file) are stored once with no direction.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | entity ref | yes | Relationship from |
| `target` | entity ref | yes | Relationship to |
| `type` | enum (below) | yes | Predicate |
| `tone` | enum | no | Emotional quality of the edge |
| `strength` | integer 1–10 | no | Intensity (1–2 weak … 9–10 defining) |
| `bidirectional` | boolean | no | True for symmetric types |
| `description` | string | no | Context/role (e.g. "Serves as lieutenant") |

The tone words and the strength scale are in the ontology file (`tones`,
`strength_scale`).

---

## 3. Predicate vocabulary

The predicate list (type, inverse, symmetric flag, category, genre, and the
suggested mobRPG `eventType` and relation type for each) lives in
`skills/shared/gm-apprentice-ontology.json` and nowhere else. Read the mobRPG
copy, `tools/mobrpg/mobrpg/gm-apprentice-ontology.json`, or run
`relationships words`. The inverse is a display and query convenience; the
directed predicate is canonical.

> **The `mobrpg_event_type` on a predicate is the predicate-only default, not the final answer.**
> The four affiliation types — **Membership**, **Leadership**, **Reign**,
> **Employ** — are the person/group join. mobRPG builds them from a person and a
> Political/Organization and nothing else, so `suggest` picks them from *both*
> endpoint kinds, not from the predicate. When both kinds are known and they are
> not a person/group pair, the type degrades to **Generic** (the predicate then
> rides on the event title). An Item→Organization `owns` edge is therefore
> Generic, not the Reign its predicate suggests; likewise a person→person `serves`.
> Passing no kinds at all falls back to the flat mapping below, which is the
> documented degraded behaviour. `map_cmd.resolve_event_type` is the single
> entry point both push and `pull-canon --baseline` use — read it, not this
> table, when the endpoints matter.

---

## 4. Notes for mapping onto mobRPG

- **Predicate granularity is the gap.** gm-apprentice has ~80 predicates;
  mobRPG has 7 `eventType` buckets. Five map cleanly
  (Employ/Membership/Leadership/Reign/War); the rest fall to `Generic` with the
  precise predicate preserved on the event `title` (e.g. `eventType: Generic`,
  `title: "worships"`).
- **gm-apprentice edges are timeless; mobRPG edges carry `start/endTimestamp`.**
  The vault has no per-relationship validity window — that's a mobRPG superset
  feature and the basis for a timeline.
- **`tone` and `strength`** have no mobRPG field; carry them in the join event's
  `description` if a round-trip needs to preserve them.
- **Symmetric predicates** (`symmetric: true`) should produce a single mobRPG event with two
  `Link` edges, not two events.
- **Classification** (entity subtype, e.g. `cult`, `relic`, `undead`) maps to
  mobRPG `Attribute` edges → reference entities (`organization/type`,
  `political/type`, `race`, `culture`), not to events.
- **The vocabulary is open in practice.** Real vaults use predicates beyond this
  list (we found `reports_to`, `affiliation`). An importer must treat any
  unrecognised predicate as `eventType: Generic` + `title: <predicate>` rather
  than assuming a closed set.

---

## 5. Worked round-trip examples

All examples use the real **Regency Cthulhu** world (`worldId
4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb`) and the NPC **Eleanor Finch**. Real IDs:

```text
person  Eleanor Finch                6edbfe87-6283-4a18-8d05-35f9b38662fb
org     Order of St. Ælfric          3ab9ce1c-0472-4145-877f-f397109be6a5
place   Hartwell House (political)   74ad65d8-8836-4e89-b680-f773b4eaa158
```

### Example A — clean bucket: `member_of` ↔ `Membership`

**gm-apprentice** (edge embedded in `Characters/NPCs/Miss_Eleanor_Finch.md`):

```yaml
relationships:
  - target: "[[Order_of_St_Aelfric]]"
    type: member_of
    tone: professional
    strength: 5
    bidirectional: false
    description: "Quiet informant — uses her position among servants and society
                  to gather intelligence"
```

**mobRPG** (real `GET /world/{w}/event/{id}` response — the join entity):

```json
{
  "id": "79afc7ff-87dd-4aa2-b950-4456d78da4ff",
  "type": "event",
  "name": "Eleanor Finch, Member of Order of St. Ælfric",
  "eventType": "Membership",
  "title": null,
  "startTimestamp": null,
  "endTimestamp": null,
  "relations": [
    { "type": "Link", "sourceId": "79afc7ff-…(this event)", "targetId": "3ab9ce1c-…(Order)" },
    { "type": "Link", "sourceId": "79afc7ff-…(this event)", "targetId": "6edbfe87-…(Eleanor)" }
  ]
}
```

**Write payload** to create it (`POST /world/{w}/event`, then attach the two
`Link` relations). Note how the role/intel detail lands in `title` +
`description`, and the lossy scalars (`tone`, `strength`) are folded into prose:

```json
{
  "name": "Eleanor Finch, Member of Order of St. Ælfric",
  "altNames": [],
  "eventType": "Membership",
  "title": "informant",
  "description": "<p>Quiet informant — uses her position among servants and society to gather intelligence. <em>(tone: professional, strength: 5)</em></p>"
}
```

**Round-trip back (mobRPG → vault):** `eventType: Membership` → predicate
`member_of`; resolve the two `Link` targets (person + org) to vault notes; emit
the edge on the person. **Clean** — the 5 specific eventTypes round-trip with no
predicate loss.

### Example B — clean bucket, modeling nuance: `Employ`

mobRPG promotes employment to an explicit **person → place** edge:

```json
{
  "id": "6089be45-a606-4524-8690-d3450ba16ed3",
  "name": "Eleanor Finch, Employment at Hartwell House",
  "eventType": "Employ",
  "relations": [
    { "type": "Link", "targetId": "74ad65d8-…(Hartwell House)" },
    { "type": "Link", "targetId": "6edbfe87-…(Eleanor)" }
  ]
}
```

The vault expresses the *same fact* implicitly — `occupation: "Lady's Maid"`,
`reports_to [[Mrs_Agnes_Rothwell]]`, `serves [[Marina_Garrick]]` — with no direct
"employed at Hartwell House" edge. **Mapping insight:** a vault→mobRPG exporter
should synthesise an `Employ` event from `occupation` + the residence/HQ a
character `located_at`, since mobRPG wants the explicit person→place edge the
vault leaves implicit.

### Example C — `Generic` fallback: `mentored_by` (no specific bucket)

**gm-apprentice:**

```yaml
  - target: "[[Lady_Honoria_Lyndhurst]]"
    type: mentored_by
    tone: respectful
    strength: 7
    bidirectional: true
    description: "Mentor and protector — recognised Eleanor's sharp mind and
                  brought her into the Order's confidence"
```

**mobRPG** — `mentored_by` has no eventType, so `Generic` carries it and the
**predicate is preserved in `title`** (this is exactly Tim's custom-title design):

```json
{
  "name": "Eleanor Finch, mentored by Lady Honoria Lyndhurst",
  "altNames": [],
  "eventType": "Generic",
  "title": "mentored_by",
  "description": "<p>Mentor and protector — recognised Eleanor's sharp mind and brought her into the Order's confidence. <em>(tone: respectful, strength: 7, bidirectional)</em></p>"
}
```
plus `Link` → Eleanor, `Link` → Lady Honoria.

**Round-trip back:** `eventType: Generic` → read the predicate from `title`
(`mentored_by`); recover `tone`/`strength` only if the exporter encoded them in
`description`. **Lossy on type unless `title` is set** — which is why the
exporter must always write the predicate into `title` for `Generic` events.

### Example D — unknown predicate: `reports_to`

`reports_to` isn't in the canonical 77. Treat exactly like Example C:
`eventType: Generic`, `title: "reports_to"`. The importer must not assume a
closed predicate set.

### Summary of the round-trip contract

| Vault predicate class | → mobRPG | Type round-trips? | What's lossy |
|---|---|---|---|
| The 16 mapped (`member_of`, `employs`, `leads`, `owns`, `enemy_of`…) | specific `eventType` | ✅ yes | `tone`, `strength` (→ description) |
| The other 61 + unknowns (`mentored_by`, `worships`, `reports_to`…) | `Generic` + `title: <predicate>` | ✅ if `title` set | type lost if `title` empty; `tone`/`strength` → description |
| Subtype/classification (`cult`, `relic`) | `Attribute` edge → type entity | ✅ yes | — |

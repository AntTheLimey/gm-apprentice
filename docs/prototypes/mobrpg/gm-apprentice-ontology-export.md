# gm-apprentice Knowledge-Graph Ontology

A standalone export of the gm-apprentice campaign ontology for the mobRPG team.
Reconciles two internal sources into one document:
`skills/shared/entity-schema.md` (authoritative vocabulary) and
`skills/ttrpg-expert/relationship-patterns.md` (edge structure & modeling).

The rightmost column of the predicate table suggests how each relationship would
reify onto mobRPG's `event`-as-join model (`eventType` enum:
`Employ, Membership, Leadership, Reign, War, Score, Generic`).

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
never stored twice. Symmetric types (see table) are stored once with no direction.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | entity ref | yes | Relationship from |
| `target` | entity ref | yes | Relationship to |
| `type` | enum (below) | yes | Predicate |
| `tone` | enum | no | Emotional quality of the edge |
| `strength` | integer 1–10 | no | Intensity (1–2 weak … 9–10 defining) |
| `bidirectional` | boolean | no | True for symmetric types |
| `description` | string | no | Context/role (e.g. "Serves as lieutenant") |

**Tones:** `friendly`, `romantic`, `respectful`, `professional` (positive);
`hostile`, `fearful`, `distrustful`, `contemptuous` (negative);
`neutral`, `unknown`, `complicated` (neutral).

**Strength:** 1–2 weak/casual · 3–4 moderate · 5–6 significant · 7–8 strong ·
9–10 defining.

---

## 3. Predicate vocabulary

~80 predicates in 17 genre-tagged categories. `sym` = symmetric (inverse is
itself). The **→ mobRPG** column is the suggested `eventType` when reifying the
edge as a mobRPG join event; the specific predicate name is preserved on the
event's `title`.

### Kinship — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| parent_of | child_of | | Generic |
| ancestor_of | descendant_of | | Generic |
| sibling_of | sibling_of | ✓ | Generic |
| spouse_of | spouse_of | ✓ | Generic |
| betrothed_to | betrothed_to | ✓ | Generic |

### Social — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| knows | knows | ✓ | Generic |
| friend_of | friend_of | ✓ | Generic |
| rival_of | rival_of | ✓ | Generic |
| mentors | mentored_by | | Generic |
| trusts | trusted_by | | Generic |
| betrayed | betrayed_by | | Generic |

### Power — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| rules | ruled_by | | **Reign** |
| employs | employed_by | | **Employ** |
| commands | commanded_by | | **Employ** |
| serves | served_by | | **Employ** |
| vassal_of | liege_of | | **Employ** |
| imprisons | imprisoned_by | | Generic |

### Spatial — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| located_at | location_of | | Generic¹ |
| headquartered_at | headquarters_of | | Generic¹ |
| part_of | has_part | | Generic¹ |
| borders | borders | ✓ | Generic |
| haunts | haunted_by | | Generic |

¹ In mobRPG, spatial containment is often modeled via `political` unit nesting
and `person.lives`/`political.spans` DateRanges rather than an event.

### Possession — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| owns | owned_by | | **Reign** |
| created | created_by | | Generic |
| wields | wielded_by | | Generic |
| seeks | sought_by | | Generic |

### Knowledge — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| discovered | discovered_by | | Generic |
| conceals | concealed_by | | Generic |
| recorded_in | records | | Generic |
| studies | studied_by | | Generic |

### Conflict — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| enemy_of | enemy_of | ✓ | **War** |
| at_war_with | at_war_with | ✓ | **War** |
| conspires_against | conspired_against_by | | **War** |
| allied_with | allied_with | ✓ | Generic |

### Affiliation — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| member_of | has_member | | **Membership** |
| founded | founded_by | | **Membership** |
| leads | led_by | | **Leadership** |
| defected_from | lost_member | | **Membership** |
| infiltrates | infiltrated_by | | **Membership** |

### Supernatural — genre: fantasy, horror
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| bound_to | binds | | Generic |
| cursed_by | cursed | | Generic |
| summoned | summoned_by | | Generic |
| worships | worshipped_by | | Generic |
| corrupted_by | corrupted | | Generic |

### Temporal — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| caused | caused_by | | Generic |
| triggered | triggered_by | | Generic |
| participated_in | had_participant | | Generic |
| witnessed | witnessed_by | | Generic |

### Economic — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| trades_with | trades_with | ✓ | Generic |
| supplies | supplied_by | | **Employ** |
| finances | financed_by | | Generic |
| indebted_to | creditor_of | | Generic |

### Event (past actions) — genre: universal
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| murdered | murdered_by | | Generic |
| poisoned | poisoned_by | | Generic |
| wounded | wounded_by | | Generic |
| rescued | rescued_by | | Generic |
| captured | captured_by | | Generic |
| deceived | deceived_by | | Generic |

### Horror — genre: horror
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| possessed_by | possesses | | Generic |
| infected_by | infected | | Generic |
| fears | feared_by | | Generic |
| feeds_on | fed_upon_by | | Generic |

### Romance — genre: romance
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| courts | courted_by | | Generic |
| rejected | rejected_by | | Generic |
| disguised_as | disguise_of | | Generic |
| blackmails | blackmailed_by | | Generic |

### Historical — genre: historical
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| conquered | conquered_by | | **War** |
| exiled_from | exiled | | Generic |
| succeeded | preceded | | Generic |
| negotiated_with | negotiated_with | ✓ | Generic |

### Sci-Fi — genre: scifi
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| uploaded_to | upload_source_of | | Generic |
| augmented_by | augments | | Generic |
| cloned_from | clone_source_of | | Generic |
| hacked | hacked_by | | Generic |

### Superhero — genre: superhero
| Predicate | Inverse | Sym | → mobRPG |
|-----------|---------|-----|----------|
| alter_ego_of | alter_ego_of | ✓ | Generic |
| empowered_by | empowers | | Generic |
| nemesis_of | nemesis_of | ✓ | Generic |

> Inverse names not explicitly enumerated in the source files are derived here
> by convention; treat the directed predicate as canonical and the inverse as a
> display/query convenience.

---

## 4. Required relationships

Validation enforces a minimum spatial anchor per entity type:

| Entity type | Required relationship |
|-------------|----------------------|
| npc | located_at |
| pc | located_at |
| creature | located_at |
| faction | headquartered_at |
| organization | headquartered_at |

---

## 5. Notes for mapping onto mobRPG

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
- **Symmetric predicates** (sym ✓) should produce a single mobRPG event with two
  `Link` edges, not two events.
- **Classification** (entity subtype, e.g. `cult`, `relic`, `undead`) maps to
  mobRPG `Attribute` edges → reference entities (`organization/type`,
  `political/type`, `race`, `culture`), not to events.
- **The vocabulary is open in practice.** Real vaults use predicates beyond this
  list (we found `reports_to`, `affiliation`). An importer must treat any
  unrecognised predicate as `eventType: Generic` + `title: <predicate>` rather
  than assuming a closed set.

---

## 6. Worked round-trip examples

All examples use the real **Regency Cthulhu** world (`worldId
4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb`) and the NPC **Eleanor Finch**. Real IDs:

```
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

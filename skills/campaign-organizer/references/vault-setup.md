# New Vault Setup

Read when `_meta/` is missing (first-time setup). No migration
runs here — the vault starts at the current version.

1. **Seed `_meta/`** — read `shared/entity-schema.md` for seed
   data and write all four `_meta/` files. Read
   `references/index-template.md` for the index structure; the
   index starts empty.
2. **Scaffold** — start from `shared/vault-structure.md`'s default
   layout, adapted to the content, and add:
   - `_World/` with `world-index.md` and `_flags.md` from
     `shared/templates/world-index.md` and
     `shared/templates/world-flags.md`. No domain files — those
     are created when content exists.
   - `Heritages/`.
   - The templates in the table below, from `shared/templates/`
     into `_Templates/`, where not already present.
   - A `Planning/` subfolder in each chapter directory, where
     missing — home of narrative plan entities (scene designs, arc
     structures, investigation flows).
   - `_inbox/` if the GM asks for it (vault-ingest staging).
3. **Stamp the version** — last step, once scaffolding succeeds:
   set `gm_apprentice_version` in `_meta/vault-config.md` to the
   plugin version: `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, or, only if
   that file is absent (skill-zip install), `current_version` in
   `shared/migrations.md` frontmatter. Stamping last means an
   interrupted setup never leaves a vault that looks current
   while scaffolding is still missing.

## Templates

Every entity type gets its template, so any skill writing an entity
can read `_Templates/_Template_{Type}.md`.

| `shared/templates/` | `_Templates/` |
|---|---|
| `npc.md` | `_Template_NPC.md` |
| `location.md` | `_Template_Location.md` |
| `item.md` | `_Template_Item.md` |
| `creature.md` | `_Template_Creature.md` |
| `organization.md` | `_Template_Organization.md` |
| `faction.md` | `_Template_Faction.md` |
| `event.md` | `_Template_Event.md` |
| `clue.md` | `_Template_Clue.md` |
| `document.md` | `_Template_Document.md` |
| `heritage.md` | `_Template_Heritage.md` |
| `world-domain.md` | `_Template_World_Domain.md` |
| `plan.md` | `_Template_Plan.md` |
| `campaign-overview.md` | `_Template_Campaign_Overview.md` |
| `session-plan.md` | `_Template_Session_Plan.md` |
| `session-wrap.md` | `_Template_Session_WrapUp.md` |
| `pc-{system}.md` for the vault's system (below), else `pc-generic.md` | same name |
| `character-story.md` | same name |
| `crew-fitd.md` (FitD vaults only) | same name |

**The vault's system** is `publish.system` in `_meta/vault-config.md`,
else the Campaign Overview's `game_system`, else the adventure
brief's `system`; if none is set, ask the GM once and record the
answer as `publish.system`. Read it case-insensitively and map
aliases to the file ids: `coc` → `coc-7e`; `regency-cthulhu` →
`coc-7e-regency`; `gurps` → `gurps-4e`; `dnd`, `dnd-5e` →
`dnd-5e-2024`; `pathfinder`, `pathfinder-2e` → `pf2e`; `blades` →
`fitd`.

**Stat blocks.** `npc.md` and `creature.md` hold a `{STAT BLOCK: …}`
paragraph under `## GM Notes`. Replace it with the vault's block:

- NPC: `npc-stats/{system}.md`.
- Creature: `creature-stats/{system}.md` if it exists, else
  `npc-stats/{system}.md`.
- `coc-7e-regency` uses the `coc-7e` files and keeps the
  **Reputation** line (drop its HTML comment); plain `coc-7e` drops
  that line.
- No system, or one without a file: replace the paragraph with
  `### Stats` and `{System stat block.}`.

A template compares equal to `shared/templates/` after this
substitution (the migration diff relies on that).

# New Vault Setup

Read when `_meta/` is missing (first-time setup). No migration
runs here — the vault starts at the current version.

1. **Seed `_meta/`** — read `shared/entity-schema.md` for seed
   data and write all four `_meta/` files. Read
   `references/index-template.md` for the index structure; the
   index starts empty.
2. **Stamp the version** — set `gm_apprentice_version` in
   `_meta/vault-config.md` to the plugin version: `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, or, only if
   that file is absent (skill-zip install), `current_version` in
   `shared/migrations.md` frontmatter.
3. **Scaffold** — start from `shared/vault-structure.md`'s default
   layout, adapted to the content, and add:
   - `_World/` with `world-index.md` and `_flags.md` from
     `shared/templates/world-index.md` and
     `shared/templates/world-flags.md`. No domain files — those
     are created when content exists.
   - `Heritages/`, plus `_Templates/_Template_Heritage.md` from
     `shared/templates/heritage.md`.
   - These templates from `shared/templates/`, where not already
     present: `faction.md` → `_Template_Faction.md`, `plan.md` →
     `_Template_Plan.md`, `session-wrap.md` →
     `_Template_Session_WrapUp.md`, `session-plan.md` →
     `_Template_Session_Plan.md`.
   - A `Planning/` subfolder in each chapter directory, where
     missing — home of narrative plan entities (scene designs, arc
     structures, investigation flows).
   - `_inbox/` if the GM asks for it (vault-ingest staging).

# New Vault Setup

Read when `_meta/` is missing (first-time setup). No migration
runs here — the vault starts at the current version.

1. **Know the system.** It is `publish.system` in
   `_meta/vault-config.md`, else the Campaign Overview's
   `game_system`, else the adventure brief's `system`; the script
   reads all three itself. If none is set, ask the GM once. If the
   vault names a system in words the script does not recognise, it
   refuses and names what it found: pass the matching id, or
   `--no-system`.
2. **Preview.** Run the script without `--write` and show the GM
   what it will create:

   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_scaffold.py" \
     <vault> [--system ID | --no-system] [--name "Campaign Name"] [--inbox]
   ```

   `--system` takes `coc-7e`, `coc-7e-regency`, `gurps-4e`,
   `dnd-5e-2024`, `pf2e`, `fitd` or a common alias (`coc`, `gurps`,
   `dnd`, `pathfinder`, `blades`); `--no-system` gives generic
   templates, for no system or one not listed. `--inbox` adds
   `_inbox/` when the GM wants vault-ingest staging.
3. **Create.** On the GM's yes, run it again with `--write`. It
   creates everything or nothing, never overwrites what is there,
   and stamps the version last. An `ERROR` row says why it refused;
   nothing was written.

The script makes the skeleton only: folders, `_Templates/` for the
system, the four `_meta/` files, the two `_World/` stubs and an
empty Timeline and Player Characters page. You write the content:
the Campaign Overview (from `_Templates/_Template_Campaign_Overview.md`),
the roster, chapters (each with a `Planning/` subfolder) and
entities. Folders may be added or renamed afterwards.

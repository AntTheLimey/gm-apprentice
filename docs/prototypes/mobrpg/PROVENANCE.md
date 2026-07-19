# Vault entity provenance marker

Every entity note carries a source-level `provenance:` field (placed directly
after `source:`), recording where the entity originated:

| value | meaning | detected by (backfill) |
|-------|---------|------------------------|
| `mobrpg` | imported from a mobRPG world | `mobrpg-import` tag or a linked `element_id` |
| `play` | created during a session | `source: play\|session-play\|character_sheet`, or a play-session `createdSession` |
| `midwife` | generated via the-midwife at genesis | genesis note with `createdSession: "Session 0"` |
| `backstory` | PC / character-creation backstory | `source: backstory` |
| `manual` | hand-authored, none of the above | fallback |

Backfilled onto the `space_game` vault by `scratchpad/stamp_provenance.py`
(idempotent — skips notes already marked). Going forward, whoever creates an
entity should set `provenance:` so origin stays answerable without inference.

## Using it in `mobrpg suggest`

Push in provenance tranches:

```
# Tranche A — everything the GM already wants in the shared world
mobrpg suggest <world> --vault <path> --exclude-provenance midwife --write-back --out push_A

# Tranche B — only the midwife-generated adventure cast (ask the world owner first)
mobrpg suggest <world> --vault <path> --only-provenance midwife --write-back --out push_B
```

Both `--only-provenance` and `--exclude-provenance` take a comma-separated list.

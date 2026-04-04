# Shared Patterns

Cross-system patterns and guidance that apply across all
supported TTRPG systems.

## Common Entity Attributes

All systems share these baseline entity attributes:

- Name (required)
- Description
- Tags
- GM notes (GM-only)
- Source document
- Source confidence

## Validation Rules

1. Verify attributes match game system schema
2. Check skill values are in valid range
3. Validate derived statistics
4. Confirm required fields present

## Cross-System Considerations

When designing features:

- Don't hardcode system mechanics
- Use schema validation
- Support flexible attributes
- Allow system-specific extensions

## Generation Tone by System

| System | Tone | Key Flavour |
|--------|------|-------------|
| Call of Cthulhu 7e | Dread, fragility, creeping unease | Investigators are ordinary people; horror comes from helplessness and the unknowable |
| D&D 5e (2024) | Heroic, adventurous, high-fantasy optimism | PCs are exceptional from level 1; the world rewards boldness |
| Forged in the Dark | Noir grit, desperate ambition, messy consequences | Scoundrels claw for scraps of power; nothing comes clean |
| GURPS 4e | Neutral / setting-dependent | Tone is set entirely by the campaign frame; the system itself is transparent |

When generating content (NPCs, locations, plot hooks), match the
tone column above unless the GM's campaign explicitly overrides it.

## Sources

System-specific sources are listed in each system's own files
under `systems/<system>/`. The following are cross-system or
system-agnostic references:

- Justin Alexander, The Three Clue Rule and Node-Based Scenario
  Design (The Alexandrian).
- Mike Shea, Return of the Lazy Dungeon Master (Sly Flourish).
- Matthew Colville, Action-Oriented Monsters (MCDM).
- Robin Laws, Robin's Laws of Good Game Mastering (2002).
- Robin Laws, GUMSHOE System Reference Document.

## External References

When you need the full detail of a framework referenced above,
fetch the original source at runtime. Do not reproduce the
content — summarize what you learn in your own words for the
user.

- **Action-Oriented Monsters:** https://mcdm.gg/ (Matthew
  Colville / MCDM)

# Event Entity Template

Vault template for event entity files. Use this when creating
new event files during session wrap-up or campaign organization.

## Event Threshold

An event earns its own vault file when it meets **at least two** of:

- **Changes entity state** — death, capture, exposure, retirement,
  allegiance shift
- **Has multiple named participants** whose individual actions matter
- **Creates forward consequences** — opens threads, shifts faction
  postures, triggers future scenes
- **Is referenced from multiple entity files** — multiple NPCs,
  locations, or factions point at the same incident

Minor events stay as inline timeline entries.

## Frontmatter

```yaml
---
type: event
source_confidence: DRAFT
aliases: []
tags: []
source_document: ""
campaign: ""
event_type: ""        # battle, discovery, betrayal, ritual, meeting, disaster
date: ""              # in-game date
location: ""          # [[wiki-link]]
participants:
  - ""                # "[[Entity]] (role annotation)"
outcome: ""
---
```

## Body Sections

```markdown
# {Event Name}

## Overview
{1-2 paragraph summary: when, where, what, why it matters}

## What Happened
{Chronological account — bullet points or narrative prose}

## Why This Matters
{Forward-looking consequences — what changed, what threads opened}

## Source References
{Links to session plans, wrap-ups, entity files}

## GM Notes
> [!info] Keeper Only
> {Keeper-only context — narrative function, design intent,
> downstream payoffs}
```

## Field Notes

- **participants** use the format `"[[Entity_Name]] (role annotation)"`.
  The role annotation describes what the entity did or why they
  matter to this event. Examples:
  - `"[[Anna_Lindqvist]] (rescued from Adler's control)"`
  - `"[[Klaus_Bauer]] (attacker — escaped)"`
  - `"Every active PC"` (plain text, no wiki-link)
- **outcome** is a concise summary of what resulted. Detailed
  consequences go in the "Why This Matters" body section.
- **significance** is deliberately omitted from frontmatter —
  the "Why This Matters" section handles this more richly.
- **Source References** and **GM Notes** are excluded from
  player-facing published sites.

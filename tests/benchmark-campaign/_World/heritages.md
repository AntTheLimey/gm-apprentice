---
type: world_domain
domain: heritages
status: active
source_confidence: AUTHORITATIVE
last_updated: "2"
asOfSession: "2"
summary: "Human-only world; non-human entities are Mythos horrors"
rules:
  - id: human-lifespan
    rule: "Humans live 60-85 years (1920s life expectancy)"
    check: { entity_type: [npc, pc], heritage: Human, field: age, max: 85 }
  - id: heritage-list
    rule: "Known heritages: Human"
    check: { field: heritage, allowed_values: [Human] }
---

## Overview

This is a human world. The horrors that lurk beneath Kingsport's
streets are not alternative heritages — they are alien,
incomprehensible, and fundamentally hostile to human existence.

## Heritages

### Human

The only playable heritage. Investigators are ordinary people
thrust into extraordinary circumstances. Their mortality and
limited lifespan make the Mythos all the more terrifying.

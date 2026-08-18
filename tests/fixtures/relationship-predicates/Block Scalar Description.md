---
canon_status: AUTHORITATIVE
summary: |
  A top-level folded note whose prose opens a block the scan must not read
  as YAML:
  relationships:
    - type: not_an_edge_at_all
relationships:
  - target: "[[The Order]]"
    type: member_of
    description: |
      They met during the siege and never spoke of it again.
      type: informal, but binding
      predicate: also just prose
  - target: "[[Vienna Station]]"
    type: located_at
    description: >
      A folded note whose second line reads
      type: of posting unclear
type: npc
lastUpdated: ""
---

Sanctioned predicates only. Every `type:`/`predicate:` line inside a block
scalar (`|` or `>`) is literal prose, not an edge — including the ones in
the top-level `summary` block above the `relationships:` key.

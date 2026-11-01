---
type: meta
purpose: relationship-types
---

# Relationship Types

Use the most specific type; generic types like `associated_with`
or `related_to` add edges without meaning. Record one direction
only: the inverse is implied, and both are never stored.

| Category | Types | Genre |
|---|---|---|
| Kinship | parent_of, ancestor_of, sibling_of, spouse_of, betrothed_to | universal |
| Social | knows, friend_of, rival_of, mentors, trusts, betrayed | universal |
| Power | rules, employs, commands, serves, vassal_of, imprisons | universal |
| Spatial | located_at, headquartered_at, part_of, borders, haunts, visited | universal |
| Possession | owns, created, wields, seeks | universal |
| Knowledge | discovered, conceals, recorded_in, studies | universal |
| Conflict | enemy_of, at_war_with, conspires_against, allied_with | universal |
| Affiliation | member_of, founded, leads, defected_from, infiltrates | universal |
| Supernatural | bound_to, cursed_by, summoned, worships, corrupted_by | fantasy, horror |
| Temporal | caused, triggered, participated_in, witnessed | universal |
| Economic | trades_with, supplies, finances, indebted_to | universal |
| Event | murdered, poisoned, wounded, rescued, captured, deceived | universal |
| Horror | possessed_by, infected_by, fears, feeds_on | horror |
| Romance | courts, rejected, disguised_as, blackmails | romance |
| Historical | conquered, exiled_from, succeeded, negotiated_with | historical |
| Sci-Fi | uploaded_to, augmented_by, cloned_from, hacked | scifi |
| Superhero | alter_ego_of, empowered_by, nemesis_of | superhero |

## Inverses

- `parent_of` / `child_of`
- `ancestor_of` / `descendant_of`
- `mentors` / `mentored_by`
- `trusts` / `trusted_by`
- `betrayed` / `betrayed_by`
- `rules` / `ruled_by`
- `employs` / `employed_by`
- `commands` / `commanded_by`
- `serves` / `served_by`
- `vassal_of` / `liege_of`
- `imprisons` / `imprisoned_by`
- `located_at` / `location_of`
- `headquartered_at` / `headquarters_of`
- `part_of` / `has_part`
- `haunts` / `haunted_by`
- `visited` / `visited_by`
- `owns` / `owned_by`
- `created` / `created_by`
- `wields` / `wielded_by`
- `seeks` / `sought_by`
- `discovered` / `discovered_by`
- `conceals` / `concealed_by`
- `recorded_in` / `records`
- `studies` / `studied_by`
- `conspires_against` / `conspired_against_by`
- `member_of` / `has_member`
- `founded` / `founded_by`
- `leads` / `led_by`
- `defected_from` / `lost_member`
- `infiltrates` / `infiltrated_by`
- `bound_to` / `binds`
- `cursed_by` / `cursed`
- `summoned` / `summoned_by`
- `worships` / `worshipped_by`
- `corrupted_by` / `corrupted`
- `caused` / `caused_by`
- `triggered` / `triggered_by`
- `participated_in` / `had_participant`
- `witnessed` / `witnessed_by`
- `supplies` / `supplied_by`
- `finances` / `financed_by`
- `indebted_to` / `creditor_of`
- `murdered` / `murdered_by`
- `poisoned` / `poisoned_by`
- `wounded` / `wounded_by`
- `rescued` / `rescued_by`
- `captured` / `captured_by`
- `deceived` / `deceived_by`
- `possessed_by` / `possesses`
- `infected_by` / `infected`
- `fears` / `feared_by`
- `feeds_on` / `fed_upon_by`
- `courts` / `courted_by`
- `rejected` / `rejected_by`
- `disguised_as` / `disguise_of`
- `blackmails` / `blackmailed_by`
- `conquered` / `conquered_by`
- `exiled_from` / `exiled`
- `succeeded` / `preceded`
- `uploaded_to` / `upload_source_of`
- `augmented_by` / `augments`
- `cloned_from` / `clone_source_of`
- `hacked` / `hacked_by`
- `empowered_by` / `empowers`

## Symmetric (stored once, no direction)

sibling_of, spouse_of, betrothed_to, knows, friend_of, rival_of, borders, enemy_of, at_war_with, allied_with, trades_with, negotiated_with, alter_ego_of, nemesis_of

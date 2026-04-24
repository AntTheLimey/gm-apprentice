# Image Handling

Reference for image processing during vault ingestion. Read when
any source material includes image files.

## Supported Formats

**Web-safe (pass through):** jpg, jpeg, png, webp, gif, svg

**Non-web-safe (convert or skip):** heic, tiff, tif, bmp, raw,
cr2, nef, arw, dng

## Format Conversion

When a non-web-safe image is encountered:

1. Check for `sips` (macOS built-in):
   `sips -s format jpeg input.heic --out output.jpg`
2. If `sips` unavailable, check for `magick` (ImageMagick):
   `magick input.heic output.jpg`
3. If neither available, skip the image and report:
   > "Skipped `filename.heic` — not a web-safe format and no
   > conversion tool available. Convert to jpg/png/webp manually
   > and re-ingest."

Use the original filename stem with `.jpg` extension for
converted files. Delete the non-web-safe original from the
vault after successful conversion (it was just copied in).

## Entity Matching

Slugify the image filename (strip extension, lowercase, replace
spaces and underscores with hyphens) and match against entity
files in the vault.

**Matching order — try each, stop at first hit:**

1. **Exact slug match:** `ronnie-vint.jpg` → find any entity
   file whose slug is `ronnie-vint` (e.g., `NPCs/Ronnie Vint.md`)
2. **Batch match:** same slug check against entity files being
   created in the current ingestion batch
3. **Suffix strip:** remove the last hyphenated segment and
   retry steps 1-2 (e.g., `ronnie-vint-young.jpg` → try
   `ronnie-vint`). Only strip one segment.

Slugify rule: strip file extension, lowercase the rest, replace
spaces and underscores with hyphens, collapse consecutive
hyphens.

**Unmatched images** go on the keeper interview list for
Phase 4.

## Filing Destination

Once an image matches an entity (or is assigned by the GM in
Phase 4), copy it to the correct `_attachments/` subfolder:

| Entity type            | Subfolder      |
|------------------------|----------------|
| PC, NPC                | `characters/`  |
| Location               | `locations/`   |
| Faction, Organization  | `factions/`    |
| Item                   | `items/`       |
| Creature               | `creatures/`   |
| Event, Session         | `events/`      |

Images the GM marks as "general atmosphere art" (no entity)
go to `_attachments/documents/`.

Rename the filed image to match the slug convention:
lowercase, hyphens, preserving any variant suffix. Example:
`Ronnie Vint Young.png` → `_attachments/characters/ronnie-vint-young.png`

## Entity Linking

### Single image for an entity

Set the entity's `portrait` frontmatter field:

```yaml
portrait: "_attachments/characters/ronnie-vint.jpg"
```

### Multiple images for an entity

File all images in the correct subfolder. Then:

- **If one image is unsuffixed** (e.g., `ronnie-vint.jpg`
  alongside `ronnie-vint-young.jpg`): the unsuffixed image
  becomes the `portrait`. Embed the others in the entity body:
  ```markdown
  ![[ronnie-vint-young.jpg]]
  ```

- **If all images are suffixed** (no clear default): defer
  portrait selection to the keeper interview (Phase 4). Ask
  the GM which image should be the portrait. Set it, then
  embed the rest in the body.

### Entity already has a portrait

If the entity already has a `portrait` field set, the new
image becomes a body embed only. Do not overwrite an existing
portrait without GM confirmation.

### Mid-conversation images

When an image arrives during an active ingestion session
(not part of the initial batch), apply the same
classify → file → match → link flow immediately.

## Keeper Interview Questions

Two new question types for Phase 4. Slot these into the
existing interview flow — they are not a separate pass.

### Unmatched images

For each unmatched image, show it to the GM and ask:

> "I found `[filename]` but couldn't match it to an entity.
> Which entity does this belong to, or is it general
> atmosphere art?"

If assigned to an entity, file and link per the rules above.
If marked as atmosphere art, file in `_attachments/documents/`.

### Portrait selection

When an entity has multiple suffixed images and no clear
default:

> "I have [N] images for [Entity Name]: [list filenames].
> Which one should be the main portrait?"

Set the chosen image as `portrait`, embed the rest in the
entity body.

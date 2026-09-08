# Image Handling

Reference for image processing during vault ingestion. Read when
any source material includes image files.

`ingest_images.py VAULT DIR [--execute]` (in `shared/scripts/`)
implements everything below except the GM decisions — run it
first, then work its report. Its row vocabulary: `WOULD-FILE` /
`FILED`, `DUP-SKIP` (identical file already filed), `DUP-FLAG`,
`UNMATCHED`, `AMBIGUOUS-ENTITY` (two vault entities share the
slug), `SKIP-FORMAT`, `SKIP-NO-CONVERTER`, `SKIP-BATCH-DUP`,
`ERROR`; the disposition column carries `portrait`,
`body-embed`, or `portrait-ambiguous`.

## What the Script Leaves to You

The script flags these rather than guessing (Design Principle 6):

- **`UNMATCHED` and `portrait-ambiguous` rows** are the Phase 4
  keeper interview questions (§ Keeper Interview Questions
  below). Apply the GM's answer with
  `stamp_entities.py <vault> FILE --set portrait="_attachments/..."
  --write`; re-running `ingest_images.py --execute` afterward
  picks up the remaining body embeds for that entity's other
  images automatically.
- **`DUP-FLAG`** (a same-name file already at the destination
  with different content, or two batch sources landing on the
  same slug) needs the GM's replace / keep-both / skip call —
  apply it by hand (for keep-both, rename the new file with a
  `-2` suffix and re-run).
- **"General atmosphere art"** has no entity and no row in the
  filing table — file it under `_attachments/documents/` by hand.
- **`AMBIGUOUS-ENTITY`** — two vault entities share a slug; ask
  the GM which one the image belongs to, then set `portrait` /
  embed by hand as for an unmatched image.

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
converted files. `ingest_images.py` converts through a private
temp file that it deletes immediately after use — the source
image (external or in `_inbox/`) is read-only throughout and is
never copied into the vault or deleted (Gotcha 3).

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

## Duplicate Detection

Before copying an image to `_attachments/`, check whether a
file with the same name already exists at the destination.

**Identical file:** If the existing and new files are the same
(same size and content), skip the copy silently. The image is
already filed — no action needed.

**Different file, same name:** Flag for the GM in Phase 4:

> "`ronnie-vint.jpg` already exists in `_attachments/characters/`
> but the new image looks different. Replace the existing one,
> keep both (I'll rename the new one), or skip the new one?"

If the GM chooses "keep both," rename the new image with a
numeric suffix: `ronnie-vint-2.jpg`.

**Same-batch duplicates:** If two files in a single ingestion
batch land on the same destination (same filename in two
folders, or two spellings of one name — `Ronnie Vint.jpg` and
`ronnie_vint.jpg`), compare their content. Identical: keep the
first occurrence and skip the rest with a note:

> "Found duplicate `ronnie-vint.jpg` in the batch — using
> the first copy."

Different content: flag both for the GM exactly as for a
same-name file already on disk — neither copy is silently
preferred.

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

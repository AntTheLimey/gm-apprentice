# Image Handling

Read when source material includes images.

`ingest_images.py VAULT DIR [--execute]` (in `shared/scripts/`)
converts, matches, files, de-duplicates and links images — run it
first (dry-run, then `--execute`) and work its report; don't
redo its steps by hand. It never modifies or deletes the source
image. Row vocabulary: `WOULD-FILE` / `FILED`, `DUP-SKIP`
(identical file already filed), `DUP-FLAG`, `UNMATCHED`,
`AMBIGUOUS-ENTITY` (two vault entities share the slug),
`SKIP-FORMAT`, `SKIP-NO-CONVERTER`, `SKIP-BATCH-DUP`, `ERROR`; the
disposition column carries `portrait`, `body-embed`, or
`portrait-ambiguous`. It never overwrites an existing `portrait`.

Matches are against entities that exist when it runs — re-run
`--execute` after creating new entities, and for images that
arrive mid-session.

## What the Script Leaves to You

Resolve these in the Phase 4 keeper interview, slotted into the
normal flow rather than as a separate pass:

- **`UNMATCHED`** — show the image and ask: "I found `[filename]`
  but couldn't match it to an entity. Which entity does this
  belong to, or is it general atmosphere art?"
- **`portrait-ambiguous`** — "I have [N] images for [Entity Name]:
  [list filenames]. Which one should be the main portrait?"
- **`AMBIGUOUS-ENTITY`** — ask which of the two entities the image
  belongs to.

Apply an entity answer with `stamp_entities.py <vault> FILE --set
portrait="_attachments/..." --write` (or embed by hand), then
re-run `ingest_images.py --execute` — it embeds that entity's
other images automatically. Atmosphere art has no row; file it
under `_attachments/documents/` by hand.

- **`DUP-FLAG`** (same destination, different content — on disk
  or two batch sources) — ask: "`[name]` already exists in
  `[folder]` but the new image looks different. Replace the
  existing one, keep both (I'll rename the new one), or skip the
  new one?" Apply by hand; for keep-both, rename the new file with
  a `-2` suffix and re-run.
- **`SKIP-NO-CONVERTER`** — no `sips` or `magick` available for a
  non-web-safe format (heic, tiff, bmp, raw…). Ask the GM to
  convert it to jpg/png/webp and re-ingest.

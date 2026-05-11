# Adding Your Own Reference Material

gm-apprentice ships with SRD and ORC-licensed mechanics for
each supported game system. These public files cover rules,
procedures, and character options -- but not setting-specific
content like named factions, locations, NPCs, or world lore.
That content is copyrighted by its publisher.

If you own a rulebook, supplement, or sourcebook, you can
create personal reference files that give Claude access to
that material during your sessions. These files live in a
`personal/` directory inside each system folder and are
automatically gitignored -- they stay on your machine and are
never distributed with the plugin.

## Important: This Is for Content You Own

Personal reference files are for **your own licensed copies**
of published material. You must legally own the source you're
working from -- a purchased PDF, a physical book you're
transcribing from, or content you've written yourself.

This feature exists so Claude can reference *your books* the
way you'd flip through them at the table. It is not a way to
redistribute copyrighted material. The `personal/` directory
is gitignored specifically to prevent accidental distribution.

**Do not** use this to share copyrighted content with others,
host it publicly, or circumvent publisher licensing terms.

## Where Personal Files Live

```text
skills/ttrpg-expert/systems/
  fitd/
    personal/           <-- your FitD setting content
      districts/        <-- optional subdirectories
  gurps-4e/
    personal/           <-- your GURPS supplements
  coc-7e/
    personal/           <-- your CoC setting material
  dnd-5e-2024/
    personal/           <-- your D&D supplements
```

Four skills discover and use these files automatically:
ttrpg-expert, session-play, session-prep, and session-wrapup.
You don't need to configure anything -- if the files exist,
Claude finds them.

## What to Put in Personal Files

Think about what you reach for during a session that isn't
covered by the public rules files:

- **Setting material** -- city districts, world history,
  cultural details, the parts of the book that make the
  setting feel real
- **Named factions** -- who they are, what they want, how
  they interact, their leadership
- **NPCs** -- contacts, rivals, notable figures with their
  affiliations and motivations
- **Random tables** -- the generation tables from your
  rulebook for names, locations, encounters, events
- **Supplementary rules** -- content from expansion books
  that isn't in the core SRD

### Examples

A Blades in the Dark GM might create files for the Doskvol
setting: district descriptions, the named underworld factions
with their tiers and goals, vice purveyors, notable NPCs, and
the city event tables from the back of the book.

A GURPS GM running a sci-fi campaign might convert relevant
sections of Ultra-Tech into personal reference files: weapon
tables, armor stats, gadget descriptions, and TL progression
notes.

A CoC GM might add Arkham location descriptions, notable
Miskatonic University faculty, or sanity-loss tables from a
published adventure they're running.

## How to Format Personal Files

Claude reads markdown, so the goal is to convert your source
material into well-structured `.md` files. Some guidelines:

**Use tables for structured data.** Faction rosters, equipment
lists, NPC directories, and anything with repeating fields
compress well as markdown tables:

```markdown
| Faction | Tier | Hold | Territory |
|---------|------|------|-----------|
| ...     | ...  | ...  | ...       |
```

**Paraphrase rather than transcribe.** Summarize descriptions
in your own words. Pull out the details that matter at the
table -- names, stats, relationships, motivations -- and leave
the prose in your book. This is both more compact and more
respectful of the source material.

**One topic per file.** A factions file, an NPC file, a
setting overview. If a topic is large (like districts in a
city), use a subdirectory with one file per entry.

**Add cross-references.** Link between your personal files
so Claude can navigate them:
`See [factions](factions.md)` or
`See [Crow's Foot](districts/crows-foot.md)`.

**Include page references.** When you paraphrase from a
source, note the page number. This helps you verify details
later and helps Claude cite where to look:
`*Source: Core Rulebook, pp. 280-282*`

**Keep a README.** A short `README.md` in your `personal/`
directory listing what files exist and what they cover helps
Claude (and you) find things quickly.

## What Not to Do

- **Don't copy pages verbatim.** Summarize and restructure.
  Your personal files should be a reference tool, not a
  reproduction of the book.
- **Don't commit personal files to git.** They're gitignored
  by default. If you override this, you risk distributing
  copyrighted material.
- **Don't create files for content already in the public
  system files.** The SRD mechanics are already there. Focus
  on the setting and supplementary content the public files
  don't cover.
- **Don't worry about completeness.** Add what you need for
  your campaign. You can always add more later.

## Converting from PDF

If you have a PDF of your source material, you can convert
it to markdown as a starting point. Tools like `pdftotext`
produce workable output for single-column text, but
two-column layouts (common in TTRPG books for tables and
sidebars) often come out garbled. Expect to clean up tables
and multi-column content by hand.

The raw conversion is a starting point, not a finished
product. Reorganize the content into topic-based files,
restructure tables into proper markdown, and trim it down
to what you actually need at the table.

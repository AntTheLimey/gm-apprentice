## Name Similarity

The name similarity check identifies entity names that are
duplicates, near-duplicates, or confusingly similar.

**Preferred procedure:** run the bundled utility and triage
its output with the GM:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> names
```

It covers exact duplicates, alias collisions, and fuzzy
matches (structural documents and document-chain families are
already filtered out). Your judgment still decides which
pairs are intentional (married couples, senior/junior) versus
confusing. Use the manual steps below only if Python is
unavailable.

### Step 1: Collect All Names

Build a complete list of entity names and aliases from the
vault. For each, record:
- Canonical name
- All aliases (from frontmatter `aliases` field)
- File path
- Entity type

Enumerate all entity files and read frontmatter from each to
build this list.

### Step 2: Exact Duplicate Check

Look for entities that share a canonical name or where one
entity's alias matches another's canonical name. These are
likely the same entity with two files.

### Step 3: Edit Distance Check

Compare all name pairs. Flag pairs where:
- Levenshtein distance ≤ 2 (e.g., "Herzfeld" vs "Herzberg")
- Names differ only in common variations (Dr./Doctor,
  von/Van, -burg/-berg, -feld/-stein)
- First or last name matches but the other differs slightly

For large entity sets, limit comparisons to entities of
the same type to avoid false positives (an NPC named
"Vienna" vs the location "Vienna" is expected overlap, not
a duplicate).

### Step 4: Phonetic Similarity Check

At the table, players hear names spoken aloud. Flag names
that sound similar even if spelled differently:
- Same consonant skeleton (remove vowels and compare)
- Rhyming names
- Names sharing first syllable and similar length
- Names differing only in a sound that's easy to mishear
  (b/d, m/n, s/z, f/v)

This check is especially important for NPCs who might appear
in the same scene. Two NPCs named "Adler" and "Adlar" in
different factions is a problem; "Adler" in Vienna and
"Adley" in Calcutta is less so.

### Step 5: Compile Findings

For each similarity found:
1. Note both entities, their types, and their files
2. Assess severity (Critical if they could appear in the
   same scene; Warning if same chapter; Info if different
   chapters/locations)
3. Propose a fix:
   - For true duplicates: merge into one file
   - For confusingly similar: suggest a rename for the less
     established entity
   - For acceptable similarities: dismiss with note

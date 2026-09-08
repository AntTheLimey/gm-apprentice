## Name Similarity

The name similarity check identifies entity names that are
duplicates, near-duplicates, or confusingly similar.

**Procedure:** run the bundled utility and triage its output
with the GM:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> names
```

It covers exact duplicates, alias collisions, fuzzy spelling
matches, and sound-alike pairs (INFO rows tagged `PHONETIC`:
two entities of the same type whose names share a consonant
skeleton, opening sound, and similar length once vowels are
dropped and the commonly misheard pairs p/b, t/d, c/g/k, m/n,
s/z, f/v are collapsed; files with no `type:` are skipped).
Structural documents and document-chain
families are already filtered out. Your judgment still decides
which pairs are intentional (married couples, senior/junior)
versus confusing, and which sound-alikes matter — the script
does not know which NPCs share a scene (Step 1).

### Step 1: Cross-Type and Untyped Sound-Alikes

At the table, players hear names spoken aloud. The script's
`PHONETIC` rows cover the consonant-skeleton and misheard-
consonant cases within an entity type. For the cross-type and
untyped pairs it skips, flag:
- Same consonant skeleton (remove vowels and compare)
- Rhyming names
- Names sharing first syllable and similar length
- Names differing only in a sound that's easy to mishear
  (b/d, m/n, s/z, f/v)

This check is especially important for NPCs who might appear
in the same scene. Two NPCs named "Adler" and "Adlar" in
different factions is a problem; "Adler" in Vienna and
"Adley" in Calcutta is less so.

### Step 2: Compile Findings

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

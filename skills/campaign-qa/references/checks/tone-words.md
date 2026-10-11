# Tone Words

A relationship's `tone` is one of 27 listed words (`shared/entity-schema.md`,
Tones). This check finds tones off the list and tidies them. The GM
answers; you run the tool. The GM never edits a note and is never told
to.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/tones.py" "<vault>"
```

Below, `tones.py` stands for that command, vault included.

The first line counts every tone, the listed ones, and the two kinds of
stray (`near`, `ask`). Then one row per stray word. No rows: say in a
line that the tones are tidy, and stop. In a report, strays are Info.

## NEAR rows: one yes

A `NEAR` row is a stray a rule can place: the word, the listed word it
becomes, how many times. A row whose two words match is a listed word
written with capitals or extra spaces.

1. Show the rows as a short table (word, becomes, count).
2. Ask once: "Tidy these?" The GM may take all, take all but some,
   place a word differently, or decline.
3. Run the fix (see Running a fix):
   - all: `tones.py fix --near`
   - a word placed differently: add `--set OLD=NEW` for it; it wins
     over the rule
   - all but some: leave out `--near` and give `--set OLD=NEW` for each
     row taken, NEW being the row's listed word. A row whose two words
     match cannot be set; it waits for a run with `--near`.
4. Say how many tones changed in how many notes (the last line).

## ASK rows: the GM picks

An `ASK` row is a word no rule can place: the word, how many times, up
to three notes that use it. `--near` never changes these.

1. Take three to five words at a time, in the order printed (commonest
   first).
2. For each, find a relationship with that tone in one of the named
   notes (its `description` usually says what was meant) and offer two
   or three listed words that fit, your pick first. Offer "leave it"
   too.
3. Apply the batch in one fix:
   `tones.py fix --set old1=new1 --set old2=new2`
4. Carry on until no `ASK` rows remain or the GM stops. What is left
   stays as written and is reported again next time.

One `--set` changes every use of the word in the vault. Where the old
word held something the listed word loses (`tragic` becoming
`negative`), offer to add the nuance to that relationship's
`description`, and write it yourself. Change a description only on a
yes.

## Running a fix

Run it once to preview (`WOULD-CHANGE` rows; nothing is written), then
again with `--write` added (`CHANGED` rows). Every note is written or
none is.

`--set` refuses an OLD that is already a listed word, a NEW that is
not listed, and an OLD no relationship has: one line, exit 1, nothing
written. Correct the pair and run it again.

A `KEPT` row, in either run, is a tone on a line the tool will not
rewrite (odd quoting or line endings). This is the one tone you change
by hand: open that note, correct the line, and say so.

## What this check never does

- It never changes `strength` or a relationship's kind, and never a
  `description` without a yes.
- It never reads notes under `_QA`, `_archive`, `_Templates` or
  `_inbox`.
- It never invents a tone word. The list changes only in the plugin.

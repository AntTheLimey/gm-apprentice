# Tone Words

A relationship's `tone` is one of 27 listed words (`shared/entity-schema.md`,
Tones). This check finds tones off the list and tidies them. The GM
answers; you run the tool. The GM never edits a note and is never told
to.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/tones.py" "<vault>"
```

Below, `tones.py` stands for that command, vault included. It reads the
whole vault whatever scope the GM chose, and a fix changes a word
everywhere it is used: say so when the scope was narrower.

The first line counts every tone, the listed ones, and the two kinds of
stray (`near`, `ask`). Then one row per stray word. No rows: say in a
line that the tones are tidy, and stop. In a report, strays are Info.
In a Full Audit, report the two counts; do not run `uses` or ask
anything until the report has been presented.

## NEAR rows: one yes

A `NEAR` row is a stray a rule can place: the word, the listed word it
becomes, how many times. A row whose two words match is a listed word
written with capitals or extra spaces.

1. Show the rows as a short table (word, becomes, count).
2. Ask once: "Tidy these?" The GM may take all, take all but some,
   place a word differently, or decline.
3. Run the fix (see Running a fix):
   - all: `tones.py fix --near`
   - all but some: `tones.py fix --near --except WORD`, one `--except`
     for each row declined, WORD as the row prints it. Once a row is
     declined, never run `--near` without its `--except`.
   - only a few: no `--near`; `--set OLD=NEW` for each row taken, NEW
     being the row's listed word. A row whose two words match cannot
     be set: take it with `--near` and an `--except` for every other
     row not taken.
   - a word placed differently: add `--set OLD=NEW` for it; it wins
     over the rule and over an `--except`
4. Say how many tones changed in how many notes (the last line).

## ASK rows: one table

An `ASK` row is a word no rule can place (word, count, up to three
notes); `--near` never changes it. Propose only listed words: the
three `#` lines.

1. `tones.py uses` lists every use, tab-separated: `note:line`, the
   word, the target, the description. Read that listing. Open a note
   only where a row's description is empty or does not settle it.
2. Show one table, however few the words: word, count, proposed listed
   word, why in a few words. Put `ask: X or Y` where the descriptions
   do not settle it, or the word means different things in different
   relationships. A word that names the tie, not a feeling (`sibling`,
   `central`): `neutral` or the tone the description supports, marked
   "not a feeling".
3. Take the answer in one go (all; all but these; these become X).
   What the GM leaves stays as written and is reported next time.
4. Apply it in one fix: `tones.py fix --set old1=new1 --set old2=new2`

One `--set` changes every use. To split a word, name the uses each way
in the question; on a yes, write the listed word on the fewer uses'
tone lines yourself, then `--set` the rest. Where the old word held
something the listed word loses (`tragic` becoming `negative`, any
"not a feeling" word), offer to add it to that relationship's
`description`; on a yes, write it yourself, there and on the tie's
line under `## Related`.

## Running a fix

Run it once to preview (`WOULD-CHANGE` rows; nothing is written), then
again with `--write` added (`CHANGED` rows). Every note is written or
none is.

`--set` refuses an OLD that is already a listed word, a NEW that is
not listed, an OLD no relationship has, and one OLD given two NEWs;
`--except` refuses a word no `NEAR` row has: one line, exit 1, nothing
written. Correct it and run it again.

A `KEPT` row, in either run, is a tone on a line the tool will not
rewrite (odd quoting or line endings). Change that tone by hand: open
the note and give the line the word this run was giving that tone
(your `--set` for it, else its `NEAR` row's listed word), never a word
of your own, and say so.

## Hostile ties the site shows

The site shows each relationship's tone as warm, hostile or neutral. A
hostile tie can give something away (who fears whom, who resents whom).

`tones.py shown` lists every relationship with a negative tone that is
not `gm_only`, on a note the site publishes: note and line, the tone as
written, the target, the description. It reads a tone the way the site
does, so `Cold` and `HOSTILE` count. Exit 1 means the site's tool could
not be asked.

Every time this check runs, run `tones.py shown` and add its count to
the report as one Info line: "N hostile ties show on the site". Say
nothing when the vault has no site or the tool could not be asked. With
N above 0, offer the walk in one short sentence beside that line. Walk
the ties only when the GM asks what the site shows of who is against
whom, or says yes to that offer; never without a yes. If the GM
declines, do not offer it again in the same session.

Put the rows to the GM three to five at a time as a table (who, toward
whom, tone, the line). For each the GM says one of:

- **leave**: players may see it.
- **re-tone**: the GM names a listed word; write it on that
  relationship's `tone` line yourself.
- **hide**: add `gm_only: true` to that relationship yourself. The
  relationship then leaves the site whole, from both pages.

A batch answer ("leave all of these", "hide the two about Hallam") is
fine. Record nothing for a `leave`: the list is short enough to show
again. Do not rebuild or deploy the site; say the changes show at the
next build.

The list errs on the side of showing more. The site colours an item by
the first relationship it has to a target, so a later hostile tie to the
same target may be listed that the site does not colour. A campaign that
hides `relationships` only in the site's own config file, not in
`vault-config.md`, still has its ties listed, and so does one whose
`overrides` mention `relationships`.

## What this check never does

- It never changes `strength` or a relationship's kind, and never a
  `description` without a yes.
- It never reads notes under `_QA`, `_archive`, `_Templates` or
  `_inbox`.
- It never invents a tone word. The list changes only in the plugin.
- It never marks a relationship `gm_only` without a yes.

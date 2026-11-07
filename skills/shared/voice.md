# Voices

Read when drafting a voice or folding a correction into one. A voice
is the `voice` field on the Campaign Overview, a PC's note or a
storied NPC's note. It changes how things are told, never what
happened.

## Drafting a voice

Draft from this campaign's own material, not a genre label:

- **Campaign:** the background, adventure plans, PC backstories and
  the session just played.
- **PC:** the sheet's background, signature traits and disadvantages,
  the backstory, and how the character has played.
- **NPC:** their note (its `**Speech:**` or older `**Voice:**` line)
  and their history
  in play.

A few sentences, on one line. What tends to belong, as guidance and
not a shape to fill: register and sentence shape; a touchstone (a
book, a show) if one fits; the engine of the comedy or drama in their
situation, which is often the situation more than the tone; where
callbacks come from; for the campaign, its house style rules. Name a
touchstone; never quote a work at length.

Show the GM the draft; they approve or correct it (players are never
asked). Before writing it on a vault whose site is on (`node
"${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js" settings get
player_site.publish player_site.hide.fields --vault <vault>`) and
whose `player_site.hide.fields` lacks `voice`, tell the GM the voice
would show on their site and ask the update's question: add `voice`
to the details the site hides (`settings add player_site.hide.fields
voice --vault <vault>`)? Whatever they answer about the site, write
the approved voice: dry-run, then `--write`.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
  <vault> "<note path>" --set 'voice="…"'
```

The stamp strips the double quotes around `…`, so quotes the voice
itself opens or closes with stay. An apostrophe goes in as `'\''`.

## Folding in a correction

When the GM corrects prose told in a voice, rewrite it per
`shared/character-story-format.md` § Corrections, then, unless
`vault.voices` is off, offer to fold the lesson into that voice, so
it sticks. The voice comes out no longer than it was: cut or reword
to make room. Same stamp.

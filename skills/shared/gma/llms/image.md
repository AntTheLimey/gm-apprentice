# gma image

Use it when the GM asks for a picture for a note: a portrait (PC, NPC, creature, heritage, document), a location, faction, organization or item, or a scene picture in a Wrap-Up's Narrative Recap. Use it unasked only as "When no one asked" below says, and for a fill as "A fill" says. `status` shows the source, whether Codex can draw, the service, model, key, this month's spending, the Image Guidance note's path and any job still `waiting`.

Who draws is the GM's choice, never yours: `vault.images.source` is `codex` (an installed Codex on a ChatGPT plan, no money), `self` (your own image tool, no money; see "Drawing them yourself" below) or `service` (the set service and model, paid). If `plan` says to choose, put the three choices to the GM (`status` says whether Codex can draw) and set the one they name. Pass `--source` only when the GM names a source for this batch. `plan`'s first line after the job number says what draws.

Rules:

- **Never keep a picture you have not opened and looked at.** If you cannot view images, hold them all and tell the GM.
- Never set `vault.images.unpriced`, `vault.images.price` or `vault.images.thinking`, or raise a limit, without the GM's yes.
- Never put `"replace": true` on a picture the GM did not name for replacing.
- Never run two `draw` commands on one vault at the same time, sub-agents included: a spending count can be lost.
- Pass `--unprompted` exactly when no one asked for these pictures.
- Never ask for a key in chat (the GM runs `gma image key gemini` in their own terminal).
- A picture shows only what the players have seen or been told: never what GM Notes, Behind the Scenes or a kept secret holds. Pictures land on the players' site.

When no one asked (your skill's steps send you here when the version check printed `# pictures on:`):

- Only after the skill's own work and report are done and nothing is waiting on the GM's answer. session-play never draws unasked.
- The GM chose the source when they set it: drawing with it needs no further yes. Ask only what the tool asks (a price, a limit).
- Write one requests file. A wrap-up asks for the session's big moments, as many as the Direction calls for, each `after` its recap paragraph, plus the notes this session created that have no picture. Any other skill asks for the notes it created that have no picture. No PCs.
- `self` and no image tool: plan nothing; see "Drawing them yourself".
- `plan --unprompted`. It plans nothing, and you draw nothing, when more than 10 are asked for (offer them to the GM as a fill of those same requests) or when there is no Image Guidance note (offer to draft it, as step 2 says; draw once it is written).
- Tell the GM in one line how many pictures, who draws, about how long (Codex about a minute each) and the cost if paid. It is not a question: go on to steps 3 to 5.
- "Not now", or cut off: stop any `draw` you started and wait until no `codex exec` is still running. The job keeps what was drawn; `status` lists it as `waiting`, and asked later, carry on with that job from step 3.
- End with one line in place of step 6: pictures made, the cost or no money, anything held and where, or the waiting job's number.

A fill (the GM asks to fill in the missing pictures, or says yes to one offered):

- `gma image missing "<vault>"` lists the notes of the vault's drawable kinds that have no picture; add `--pcs` only if the GM includes player characters. A fill offered after an unasked run uses those requests instead.
- Tell the GM the count, about how long, and the cost if paid, and wait for their yes.
- Work in batches of 10: plan (no `--unprompted`: the GM asked), draw, look, place, then the next. Stopping part-way loses nothing already placed. The month's ceiling still applies.

1. Read the Image Guidance note. Direction tells you what the pictures should show and is never sent. Write the requests file in the temp folder, never in the vault:

   ```json
   [
     {"for": "Inspector Hale", "subject": "A tired police inspector in his fifties, grey overcoat, 1920s London", "blocks": ["Portrait"]},
     {"for": "Session 4 Wrap-Up", "after": "The auction began", "name": "auction",
      "subject": "Two investigators at a crowded 1920s auction, a brass cylinder on the block", "shows": ["Inspector Hale", "Mara Quill"]}
   ]
   ```

   - `for`: the note (path, name or alias). A Wrap-Up makes a scene picture and also needs `after` (the opening words of exactly one recap paragraph, which the picture goes after) and `name` (short, for the file name).
   - `subject`: the whole picture in words: who and how many, place, period, any written words exactly as they must read. It is sent after the note's Always text and the `blocks` named.
   - `blocks`: `###` block names under the note's Blocks.
   - `shows`: notes whose `portrait` goes as a likeness (at most 4 characters and 14 pictures in all). A note with no portrait, or one that is not a PNG or JPEG under 5 MB inside the vault, is left out and `plan` says so.
   - `replace`: `true` to replace the note's existing picture.
2. `gma image plan "<vault>" requests.json` prints a job number, who draws it, each picture as `planned` (with its estimate), `refused` or `trimmed` (a limit) and why, the estimated total and the `Job file:` path. It sends nothing. Tell the GM what was not planned. If it says "No Image Guidance note yet", tell the GM the pictures will have no campaign style and offer to draft the note with them from `_Templates/_Template_Image_Guidance.md`, as a voice is drafted; write it only on their yes. If the vault already keeps style or picture-guidance notes by hand, offer to merge them into it, and retire the old ones only on the GM's yes.
3. `gma image draw "<vault>" 20261109-a1b2c3` (the job number) draws each planned picture and prints its path. The files sit beside the job file, named by picture number and type (`01.png`, `02.jpg`, `03.webp`) (a later `draw` prints no paths). Run it again to retry failed ones. A drawn picture is never sent twice. Through Codex each picture takes a minute or two: give `draw` a long timeout or run it in the background and wait for it to finish; if it is cut off, wait until no `codex exec` is still running, then run the same `draw` again (it carries on where it stopped). A picture the service declined cannot be redone: plan it again with a different `subject`.
4. Open every drawn file and compare it with its request: the right people and how many, period and setting, words on a document spelled as written, nothing modern. For a wrong one, run `draw` again with `--redo 2 "what was wrong"` and look again. A failed redraw keeps the earlier picture.
5. `gma image place "<vault>" 20261109-a1b2c3 --keep 1 2 --hold 3` to preview, then again with `--write`. Give every drawn picture a verdict, and `--keep` only numbers you opened in step 4. A kept picture is copied into `_attachments/` and set as the note's `portrait`, or embedded after its recap paragraph. A held one stays in the job folder (path printed) for 14 days and can still be kept later (if `plan` said the job is in the temp folder, the system may clear it sooner).
6. Tell the GM what was made and where, what the batch cost (`this job so far` on the `This run` line), the `This month` line, and what was held and where. For Codex or your own drawing there are no figures: say no money was spent.

When it stops:

- Unknown price: put the printed choice to the GM in the tool's own words. Run the setting command it names only on their yes (for `vault.images.price`, with the price they give).
- No service or model: ask the GM, then set `vault.images.service` and `vault.images.model`.
- A limit (refused, trimmed, likenesses dropped, run stopped): tell the GM and change nothing.
- "will not draw without thinking": the model forced thinking on for this batch. `draw` re-checks each picture against the limits at the higher cost and draws it with thinking if it fits, or its line says why not. Tell the GM. Change no setting without their yes.
- Key, credit, keychain or network messages: pass them on. In a sandbox, `draw` needs network access.
- Codex stopped (signed out, plan limit): tell the GM. Running the same `draw` later (signed in again, or once the plan's limit resets) retries for free. Only on the GM's yes, plan the pictures not drawn again with `--source service` (a new requests file holding just those); that costs money. Place each job's pictures from that job.

Drawing them yourself (`plan --source self`):

- `plan` prints each picture's `shape`, `likeness` files and `prompt`. Draw each with your own image tool from exactly that prompt, with the likeness files as references, at that shape.
- Hand them in: `gma image draw "<vault>" <job> --picture 1 /path/one.png --picture 2 /path/two.png` (PNG or JPEG, from anywhere; they are copied). For a redraw, draw it again and hand it in again with `--picture`; the vault's redraw limit applies.
- Then look and `place` as in steps 4 to 6. No money is counted.
- If you have no image tool (Claude Code has none), plan nothing: tell the GM a session that can draw for itself, such as Codex, can draw them when asked (for example "draw the pictures for the Session 16 Wrap-Up"). Never switch to another source.

<!-- BEGIN GENERATED: gma image -->
Draw a vault's pictures inside its spending limits.

```text
gma image <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `status`, `key`, `plan`, `draw`, `place`, `missing` | what to do: status, key, plan, draw, place or missing |

Example: `gma image status "<vault>"`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image plan -->
work out which pictures to draw, and what they cost

```text
gma image plan <vault> <requests> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<requests>` |  | a JSON file: a list with one object per picture (for, subject, and optionally blocks, shows, replace, after, name) |
| `--unprompted` |  | the GM did not ask for these pictures: apply the vault's rules for drawing without asking |
| `--source` | `codex`, `service`, `self` | who draws, for this job only, as the GM chose: codex (an installed Codex on a ChatGPT plan, no money), service (the vault's picture service and model, paid) or self (you, with your own image tool). Left out: the vault's vault.images.source |

Example: `gma image plan "<vault>" requests.json`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image draw -->
draw the planned pictures (on a paid service this costs money)

```text
gma image draw <vault> <job> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<job>` |  | the job number `plan` printed |
| `--redo` | `N WHAT` | draw picture N again, telling the service what was wrong with it (up to 500 characters); can be given more than once. On a paid service each attempt is paid for. Pictures are drawn one at a time; two gma image draw runs on one vault at the same time can lose a spending count (repeatable) |
| `--picture` | `N FILE` | for a job planned with --source self: hand in the picture you drew for picture N (a PNG or JPEG); again for a redraw; can be given more than once (repeatable) |

Example: `gma image draw "<vault>" 20261109-a1b2c3 --redo 2 "the cloak should be green"`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image place -->
file the pictures you kept and link them in the vault

```text
gma image place <vault> <job> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<job>` |  | the job number `plan` printed |
| `--keep` | `N ...` | numbers of the pictures to file in the vault |
| `--hold` | `N ...` | numbers of the pictures to leave out of the vault (they stay in the job folder) |
| `--write` |  | do it; without this, only say what would happen |

Example: `gma image place "<vault>" 20261109-a1b2c3 --keep 1 2 --hold 3 --write`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image status -->
where picture drawing stands for a vault

```text
gma image status <vault>
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |

Example: `gma image status "<vault>"`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image key -->
store a service key (in your own terminal)

```text
gma image key <service>
```

| Argument | Value | Help |
|---|---|---|
| `<service>` |  | the drawing service the key is for (gemini) |

Example: `gma image key gemini`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image missing -->
list the notes that could have a picture and have none, for a fill

```text
gma image missing <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--pcs` |  | list player characters too (only when the GM includes them) |

Example: `gma image missing "<vault>"`
<!-- END GENERATED -->

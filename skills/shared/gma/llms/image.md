# gma image

Use it when the GM asks for a picture for a note: a portrait (PC, NPC, creature, heritage, document), a location, faction, organization or item, or a scene picture in a Wrap-Up's Narrative Recap. `status` shows the service, model, key, this month's spending and the Image Guidance note's path.

Rules:

- **Never keep a picture you have not opened and looked at.** If you cannot view images, hold them all and tell the GM.
- Never set `vault.images.unpriced`, `vault.images.price` or `vault.images.thinking`, or raise a limit, without the GM's yes.
- Never put `"replace": true` on a picture the GM did not name for replacing.
- Never run two `draw` commands on one vault at the same time, sub-agents included: a spending count can be lost.
- Never pass `--unprompted` or ask for a key in chat (the GM runs `gma image key gemini` in their own terminal).

1. Read the Image Guidance note. Direction tells you what the pictures should show and is never sent. Write the requests file:

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
2. `gma image plan "<vault>" requests.json` prints a job number, each picture as `planned` (with its estimate), `refused` or `trimmed` (a limit) and why, the estimated total and the `Job file:` path. It sends nothing. Tell the GM what was not planned. If it says "No Image Guidance note yet", tell the GM the pictures will have no campaign style, and write the note from `_Templates/_Template_Image_Guidance.md` only if the GM asks.
3. `gma image draw "<vault>" 20261109-a1b2c3` (the job number) draws each planned picture and prints its path. The files sit beside the job file, named by picture number and type (`01.png`, `02.jpg`, `03.webp`) (a later `draw` prints no paths). Run it again to retry failed ones. A drawn picture is never sent twice. A picture the service declined cannot be redone: plan it again with a different `subject`.
4. Open every drawn file and compare it with its request: the right people and how many, period and setting, words on a document spelled as written, nothing modern. For a wrong one, run `draw` again with `--redo 2 "what was wrong"` and look again. A failed redraw keeps the earlier picture.
5. `gma image place "<vault>" 20261109-a1b2c3 --keep 1 2 --hold 3` to preview, then again with `--write`. Give every drawn picture a verdict, and `--keep` only numbers you opened in step 4. A kept picture is copied into `_attachments/` and set as the note's `portrait`, or embedded after its recap paragraph. A held one stays in the job folder (path printed) for 14 days and can still be kept later.
6. Tell the GM what was made and where, what the batch cost (`this job so far` on the `This run` line), the `This month` line, and what was held and where.

When it stops:

- Unknown price: put the printed choice to the GM in the tool's own words. Run the setting command it names only on their yes (for `vault.images.price`, with the price they give).
- No service or model: ask the GM, then set `vault.images.service` and `vault.images.model`.
- A limit (refused, trimmed, likenesses dropped, run stopped): tell the GM and change nothing.
- "will not draw without thinking": the model forced thinking on for this batch. `draw` re-checks each picture against the limits at the higher cost and draws it with thinking if it fits, or its line says why not. Tell the GM. Change no setting without their yes.
- Key, credit, keychain or network messages: pass them on. In a sandbox, `draw` needs network access.

<!-- BEGIN GENERATED: gma image -->
Draw a vault's pictures inside its spending limits.

```text
gma image <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `status`, `key`, `plan`, `draw`, `place` | what to do: status, key, plan, draw or place |

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

Example: `gma image plan "<vault>" requests.json`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma image draw -->
send the planned pictures to the drawing service (this costs money)

```text
gma image draw <vault> <job> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<job>` |  | the job number `plan` printed |
| `--redo` | `N WHAT` | draw picture N again, telling the service what was wrong with it (up to 500 characters); can be given more than once. Each attempt is paid for. Pictures are drawn one at a time; two gma image draw runs on one vault at the same time can lose a spending count (repeatable) |

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

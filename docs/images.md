# Drawing pictures

Ask the apprentice for a portrait, a place, a faction, an item, a
document or a scene from a session's recap, and it draws the picture
with the system you choose: Codex on your ChatGPT plan, which costs no
money, or Google's Gemini service on your own Google key, inside spending
limits you set in the vault. It looks at each picture, redraws a wrong one
and files the ones that are right.

## Choose what draws

The apprentice never picks for you. Set `vault.images.source`:

| Choice | What draws | Money |
|---|---|---|
| `codex` | An installed Codex signed in with a ChatGPT plan, using its own image tool | None counted |
| `self` | The apprentice's own image tool, when it has one (for example, the apprentice running inside Codex) | None counted |
| `service` | The service and model you set (`vault.images.service`, `vault.images.model`) | Paid, inside your limits |

Until you choose, the apprentice asks. A vault that already names a service
and model counts as having chosen `service`. The apprentice's image status check says
whether Codex is installed and signed in, so you can choose knowingly.
Codex draws with its own built-in image tool: you choose Codex, not the
model inside it.

## Drawing without being asked

Turn on `vault.images.auto` and the apprentice draws pictures by itself:

- **After a wrap-up**: scene pictures for the session's big moments, as
  your Image Guidance note's Direction describes them, placed under
  their recap paragraphs, plus pictures for the session's new notes that
  have none.
- **After prep, the Midwife, ingest or the organiser** create notes:
  pictures for those notes that have none.

It draws last, once its own work and report are done, and tells you in
one line how many pictures, what draws them, about how long and any
cost. Say "not now" and the job waits for 14 days (ask the apprentice for the image status
to see it): ask later for "the pictures from the wrap-up" and it carries
on where it stopped. More than ten pictures are never drawn unasked: the
apprentice offers them as a fill instead. Nothing is drawn unasked until
the vault has an Image Guidance note (the apprentice offers to draft
it), and a picture shows only what the players have seen. Player
characters are never drawn unasked, and nothing is drawn at the table.

## Filling in missing pictures

Ask the apprentice to "fill in the missing pictures". It lists the notes
that could have a picture and have none (player characters only if you
include them), tells you how many, how long and any cost, and waits for
your yes. It draws ten at a time, placing each batch before the next, so
stopping part-way loses nothing. A fill does not need
`vault.images.auto`.

## Drawing on a ChatGPT plan with Codex

With `vault.images.source` set to `codex`, Codex must be installed and
signed in with a ChatGPT plan (`codex login`). The pictures come out of
the plan you already pay for, so no money is counted against your limits,
and each picture takes a minute or two. The redraw limit still applies. A Codex
signed in with an API key is charged by the picture, so it is never used
this way, and the sign-in is checked again before every batch is drawn.
If your ChatGPT account has bought extra Codex credits, Codex may spend
them once the plan's allowance runs out: that is billed by OpenAI, outside
the apprentice's limits.

If you run the apprentice inside Codex, choose `self` and it draws the
pictures itself with Codex's own image tool. That costs no money either.

If Codex stops part-way, for example
when the plan's limit is reached, the apprentice says so and does not
switch to Gemini by itself: a batch planned as free only starts costing
money when you plan it again with Gemini and see the estimate.

## Set up a Google key

1. Create a key at <https://aistudio.google.com/apikey>.
2. At <https://aistudio.google.com/projects>, set up billing and add
   prepaid credit with auto-reload turned off. Then the credit you bought
   is the most Google can ever charge. When it runs out, Google draws
   nothing more and the apprentice says the account is out of credit (a
   limit on your account is reported as reached instead).
3. In your own terminal window, ask the apprentice for the exact
   command to store a Gemini key, run it there and paste the key when
   asked (it is `python3 ".../gma.py" image key gemini`, with the full
   path to the plugin's `gma.py`; plain `gma` is not a command in a
   terminal). On a Mac it goes into your keychain. Elsewhere it goes
   into a key file only you can read.

Never put the key in a chat with the apprentice, a note or
`_meta/vault-config.yaml`: the vault gets published. A key in the
`GEMINI_API_KEY` or `GOOGLE_API_KEY` environment variable is used first,
and the apprentice's image status check says where the key came from.

## Choose the service and model

Set `vault.images.service` to `gemini` and `vault.images.model` to the
model name Google uses, such as `gemini-nano-banana-2.1`. Any model
works, but one with no known price waits for your choice (see
[When the price is not known](#when-the-price-is-not-known)). Ask the
apprentice to change a setting, or edit `_meta/vault-config.yaml`. The
[Drawing pictures](site-settings.md#drawing-pictures) settings list every
picture setting and its starting value.

## The limits

Each time Google is asked for a picture is one try. A batch is the set of
pictures planned together for one request, with their redraws. A
likeness is a portrait from your vault sent with a request so a person
looks the same in every picture: up to 4 characters and 14 pictures in
all, and only from inside the vault.

| Setting | What it limits |
|---|---|
| `vault.images.attempt_limit` | One try at one picture. Likenesses are left out first to make it fit. A picture that still costs too much is not drawn. |
| `vault.images.redraws` | How many more tries a picture gets after the first. Every try is paid for. |
| `vault.images.run_cap` | One batch, redraws and retries included. |
| `vault.images.month_cap` | One calendar month. Each vault keeps its own count. |

Together they keep one picture, one batch and one month each to what you
chose. When a limit would be passed, the apprentice stops, tells you
which pictures did not fit, and leaves the limit as it is. Every picture
Google sends back is counted, and so is a reply where Google drew nothing
or sent something unusable. A reply lost on its way back is counted at
the estimate to be safe, and the report says it may have been charged.
An error from Google (a rejected key, no credit, a limit reached) costs
nothing. Draw on one vault at a time: two at once can lose a count.

## What a picture costs

Measured on 2026-11-09 with `gemini-nano-banana-2.1`, at the size the
apprentice draws (prices change, so treat these as a guide):

| | US cents per picture |
|---|---|
| Thinking on (the usual setting) | about 4.3 to 5.8, varying from picture to picture |
| Thinking off | about 3.6 to 4.5 (no likenesses to four) |
| Each likeness sent | about 0.17 more |

`vault.images.thinking` lets the service think before it draws, and it is
on unless you turn it off. One comparison of six pictures drawn both ways
found likenesses held equally well and thinking on followed the fine details
of a request a little more closely. Its cost varies from picture to picture,
so `vault.images.attempt_limit` is then a likely ceiling and not a
guarantee; the cap for a batch and the month's ceiling always count what was
really spent. With a limit lower than the usual one, a picture may be
refused with "Thinking is on, which costs more: raise the limit for one
attempt or turn thinking off."

Turn it off to pay about a cent less a picture, at a steadier cost. A model
that "will not draw without thinking" turns it on by itself for that batch.

## When the price is not known

For a model it has no price for, the apprentice cannot keep to your
limits, so it stops and asks you to choose. It changes nothing unasked.

- Set `vault.images.price` to what one picture costs, in cents, and the
  limits apply.
- Turn on `vault.images.unpriced` to draw anyway. The limits do not
  apply, and reports count the pictures paid for at an unknown price.

## How your pictures look

The Image Guidance note, the note `vault.images.guidance` names, sets the look.
The apprentice offers to draft it with you from
`_Templates/_Template_Image_Guidance.md`, and to merge any style notes you
keep by hand. It is never published. Without it, pictures have no
campaign style. As on the site, comments, spoilers and Dataview are left out.

- **Direction**: what pictures should show. Read, never sent.
- **Always**: style text sent with every picture. The template starts it
  with a line asking for no signature, watermark or lettering, as drawn
  pictures sometimes carry a scribbled one.
- **Blocks**: named `###` parts, such as Portrait, added when they fit.

## Where pictures go

A kept picture is copied into the vault under `_attachments/`, in a
folder for its kind (`characters`, `scenes` and so on), and becomes the
note's `portrait` or is embedded after its paragraph in the session's
recap. An existing picture is replaced only when you ask for that.

A **held** picture is one the apprentice looked at and did not keep. It
stays outside the vault, in a folder on your computer for that batch, and
the apprentice tells you where. You can still keep it for 14 days. When
the apprentice runs in a sandbox that cannot write to that folder (Codex,
by default), the batch goes to the system's temporary folder instead,
which the system may clear sooner, so keep a held picture within a day or
two. The next time the apprentice plans or places pictures where it can write
to the batch folder (and no drawing is running on that batch), it moves the
batch there. Moving does not restart the 14 days: they count from when the
batch was made, or from the last replace or hold. Until
it does, a batch made in the temporary folder is found again only by a
program that uses the same temporary folder, so finish it in the same place
you started it.

## What can go wrong

- **The keychain did not answer**: unlock your Mac keychain and try again.
- **Google declines a picture**: this is rare. The apprentice describes
  it differently and plans it again.
- **No network**: give the apprentice network access for the image drawing command.
- **Codex stops part-way**: it reports why (signed out, the plan's limit
  reached). Sign it in again, wait for the limit to reset, or draw the
  rest with Gemini.

# Drawing pictures

Ask the apprentice for a portrait, a place, a faction, an item, a
document or a scene from a session's recap, and it draws the picture with
Google's Gemini service on your own Google key, inside spending limits
you set in the vault. It looks at each picture, redraws a wrong one and
files the ones that are right. In this release it draws only when you
ask: `vault.images.auto`, for drawing without asking, has no effect yet.

## Set up a Google key

1. Create a key at <https://aistudio.google.com/apikey>.
2. At <https://aistudio.google.com/projects>, set up billing and add
   prepaid credit with auto-reload turned off. Then the credit you bought
   is the most Google can ever charge. When it runs out, Google draws
   nothing more and the apprentice says the account is out of credit (a
   limit on your account is reported as reached instead).
3. In your own terminal window, run `gma image key gemini` and paste the
   key when asked. On a Mac it goes into your keychain. Elsewhere it goes
   into a key file only you can read.

Never put the key in a chat with the apprentice, a note or
`_meta/vault-config.yaml`: the vault gets published. A key in the
`GEMINI_API_KEY` or `GOOGLE_API_KEY` environment variable is used first,
and `gma image status "<vault>"` says where the key came from.

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
| Thinking off | about 3.6 to 4.5 (no likenesses to four) |
| Thinking on | about 4.3 to 5.8, varying from picture to picture |
| Each likeness sent | about 0.17 more |

`vault.images.thinking` lets the service think before it draws. Turn it
on and raise `vault.images.attempt_limit` to about 7 cents too, or each
picture is reported "over the limit for one attempt" and nothing is
drawn. The limit then becomes a likely ceiling instead of a guarantee.
One comparison of six pictures drawn both ways found likenesses held
equally well, thinking on followed fine details a little more closely,
and thinking off was cheaper and steadier. A model that "will not draw
without thinking" needs the same raise.

## When the price is not known

For a model it has no price for, the apprentice cannot keep to your
limits, so it stops and asks you to choose. It changes nothing unasked.

- Set `vault.images.price` to what one picture costs, in cents, and the
  limits apply.
- Turn on `vault.images.unpriced` to draw anyway. The limits do not
  apply, and reports count the pictures drawn at an unknown price.

## How your pictures look

The Image Guidance note, the note `vault.images.guidance` names, sets the
look. Make it from `_Templates/_Template_Image_Guidance.md`, by hand for
now (a guided set-up comes later). It is never published. Without it,
pictures have no campaign style.

- **Direction**: what pictures should show. Read, never sent.
- **Always**: style text sent with every picture.
- **Blocks**: named `###` parts, such as Portrait, added when they fit.

## Where pictures go

A kept picture is copied into the vault under `_attachments/`, in a
folder for its kind (`characters`, `scenes` and so on), and becomes the
note's `portrait` or is embedded after its paragraph in the session's
recap. An existing picture is replaced only when you ask for that.

A **held** picture is one the apprentice looked at and did not keep. It
stays outside the vault, in a folder on your computer for that batch, and
the apprentice tells you where. You can still keep it for 14 days.

## What can go wrong

- **The keychain did not answer**: unlock your Mac keychain and try again.
- **Google declines a picture**: this is rare. The apprentice describes
  it differently and plans it again.
- **No network**: if the apprentice's network access is shut off, allow
  it for `gma image draw`.

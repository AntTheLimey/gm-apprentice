# Drawing pictures

Ask the apprentice for a picture and it draws one for your campaign: a
portrait of a character or creature, a place, a faction, an item, a
document, or a scene from a session's recap. It uses Google's Gemini
picture service on your own Google key, so Google bills you directly, and
it stays inside spending limits you set in the vault. The apprentice
writes the description, draws the picture, looks at it, redraws it if it
came out wrong, and files the ones that are right.

In this release it draws only when you ask, and `vault.images.auto`, the
setting for drawing without asking, has no effect until a later release.
Player characters are drawn only when you ask for them.

## Set up a Google key

1. Create a key at <https://aistudio.google.com/apikey>.
2. Set up billing at <https://aistudio.google.com/projects>. Prepaid
   credit with auto-reload turned off is a hard stop on Google's side:
   when the credit runs out, Google draws nothing more and the apprentice
   tells you the account is out of credit.
3. In your own terminal window, run `gma image key gemini` and paste the
   key when asked. On a Mac it goes into your keychain. Elsewhere it goes
   into a key file only you can read. Never paste a key into a chat with
   the apprentice.

## Choose the service and model

Set `vault.images.service` to `gemini` and `vault.images.model` to the
model name Google uses, such as `gemini-nano-banana-2.1`. Nothing is tied
to one model: a newer one works once you set its name. Ask the apprentice
to change a setting, or edit `_meta/vault-config.yaml`. The
[Drawing pictures](site-settings.md#drawing-pictures) settings list every
picture setting and its starting value. To check your set-up, run
`gma image status "<vault>"`.

## The limits

| Setting | What it limits |
|---|---|
| `vault.images.attempt_limit` | One attempt at one picture. Likeness pictures are left out first to make it fit. A picture that still costs too much is not drawn. |
| `vault.images.redraws` | How many more tries a picture gets after the first. Every try is paid for. |
| `vault.images.run_cap` | One drawing run, all its pictures together. |
| `vault.images.month_cap` | One calendar month. Each vault keeps its own count. |

When a limit would be passed, the apprentice stops, tells you which
pictures did not fit, and leaves the limit as it is. Every reply Google
charges for is counted, a refusal or a failed reply included. A reply
lost on its way back is counted at the estimate to be safe, and the
report says it may have been charged. Only a failure before the request
left your machine is free. Draw on one vault at a time: two drawing runs
at once can lose a count.

## What a picture costs

Measured on 2026-11-09 with `gemini-nano-banana-2.1`, at the size the
apprentice draws:

| | US cents per picture |
|---|---|
| Thinking off | about 3.6 to 3.9 |
| Thinking on | about 3.7 to 4.7 |
| Each likeness picture sent | about 0.17 more |

Google's price list says 3.36 cents, before the description, likeness
pictures and the service's own words. Prices change, so treat these
figures as a guide. Likeness pictures are portraits from your vault, sent
so a person looks the same in every picture: up to 4 characters and 14
pictures in all. Only pictures inside the vault are ever sent.

`vault.images.thinking` lets the service think before it draws. Turn it
on if likenesses or details suffer. On, a picture costs more and varies,
so the limit for one attempt becomes a likely ceiling and stops being a
guarantee, and the usual limit leaves no room to send likeness pictures:
raise that limit too. The run and month limits always count what was
really spent.

## When the price is not known

The apprentice knows the prices of the models it has been measured on.
For any other model it cannot keep to your limits, so it stops and puts
the choice to you. It changes neither setting without your yes.

- Set `vault.images.price` to what one picture costs, in cents, and the
  limits apply.
- Turn on `vault.images.unpriced` to draw anyway. The limits do not
  apply, and reports count the pictures drawn at an unknown price.

## How your pictures look

The Image Guidance note, the note `vault.images.guidance` names, sets the
look. Make it from `_Templates/_Template_Image_Guidance.md`, by hand for
now: a guided set-up comes later. It is never published to your players.
Without it, pictures have no campaign style.

- **Direction**: what the pictures should show, in your words. The
  apprentice reads it and never sends it.
- **Always**: style text sent with every picture.
- **Blocks**: named `###` parts, such as a Portrait block, that the
  apprentice adds to a picture when it fits.

## Where pictures go

A kept picture is copied into the vault under `_attachments/`, in a
folder for its kind (`characters`, `scenes` and so on), and becomes the
note's `portrait` or is embedded after its paragraph in the session's
recap. An existing picture is replaced only when you ask for that.

A **held** picture is one the apprentice looked at and did not keep. It
stays in a job folder on your machine, and the apprentice tells you
where. Ask to keep it within 14 days, before job folders are cleared.

## What can go wrong

- **The keychain did not answer**: unlock your Mac keychain and try again.
- **Google declines a picture**: this is rare. Dark and gory scenes were
  drawn in testing. A declined first attempt is final for that picture,
  so the apprentice describes it differently and plans it again.
- **No network**: in a sandbox, allow network access for `gma image draw`.

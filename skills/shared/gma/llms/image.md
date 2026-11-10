# gma image

Use it when the GM asks for a picture of a person, place or thing in the vault. `status` says whether a service key was found and where from, and `key` stores one. Run `key` in your own terminal window, because the key is typed there and never passes through the assistant. `plan` takes a JSON list of the pictures wanted and works out the prompts, likeness references and costs, saving a job; it draws nothing and writes nothing into the vault. `place` files the pictures the assistant has looked at and kept, sets the note's portrait or embeds a scene picture after its recap paragraph, and leaves held pictures in the job folder; it only says what it would do until you add `--write`.

<!-- BEGIN GENERATED: gma image -->
Draw a vault's pictures: plan, draw, look, place.

```text
gma image <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `status`, `key`, `plan`, `place` |  |

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

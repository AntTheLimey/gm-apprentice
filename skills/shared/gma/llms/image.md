# gma image

Use it when the GM asks for a picture of a person, place or thing in the vault. `status` says whether a service key was found and where from, and `key` stores one. Run `key` in your own terminal window, because the key is typed there and never passes through the assistant. `plan` takes a JSON list of the pictures wanted and works out the prompts, likeness references and costs, saving a job; it draws nothing and writes nothing into the vault.

<!-- BEGIN GENERATED: gma image -->
Draw a vault's pictures: plan, draw, look, place.

```text
gma image <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `status`, `key`, `plan` |  |

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

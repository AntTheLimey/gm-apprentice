# gma image

Use it when the GM asks for a picture of a person, place or thing in the vault. For now it sets up and checks the drawing service: `status` says whether a service key was found and where from, and `key` stores one. Run `key` in your own terminal window, because the key is typed there and never passes through the assistant. Later steps add planning, drawing and placing pictures.

<!-- BEGIN GENERATED: gma image -->
Draw a vault's pictures: plan, draw, look, place.

```text
gma image <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `status`, `key` |  |

Example: `gma image status "<vault>"`
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

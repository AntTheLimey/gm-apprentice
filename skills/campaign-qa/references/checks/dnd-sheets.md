# D&D Sheets

For a D&D 5e (2024) vault only. One call checks every PC's sheet:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/dnd_sheet.py" --party "<vault>"
```

In a vault that is not D&D 5e (2024) it prints one line saying nothing
was checked. It prints only findings, each prefixed with the PC's note name, and never
writes. Report `WRONG` and `LOOK` rows as findings; give the `CANTCHECK`
count in one line. What each row means, and how a `LOOK` the GM accepts
is settled, is in ttrpg-expert's
`systems/dnd-5e-2024/character-sheet.md`, "Rules checks". A PC with no
sheet is `pc-body`'s finding, not this check's.

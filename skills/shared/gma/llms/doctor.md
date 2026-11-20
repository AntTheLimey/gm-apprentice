# gma doctor

Use it right after installing gm-apprentice, and first when a GM says something will not run. It checks Python, the skills' version and how they were installed, Node and the publish tool, one line each, and says what to do about anything missing. It installs and changes nothing. Exit 0 means the skills can run; a missing or old Node only warns, because only a campaign site needs it. Exit 1 means a line marked `fail` must be fixed first: tell the GM what it says, and do not work around it.

<!-- BEGIN GENERATED: gma doctor -->
Check this machine is ready: Python, the skills' version, Node, the publish tool.

```text
gma doctor
```

Example: `gma doctor`
<!-- END GENERATED -->

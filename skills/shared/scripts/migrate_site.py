#!/usr/bin/env python3
"""migrate_site.py: the migration checks that concern the vault's site.

The site's publish tool is repinned first; everything else that asks the
tool runs after it. What publishes, what the pin is and what the config
holds are the publish tool's answers, never a second reading here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          cells, edit_frontmatter, plugin_tool, stopped)
from migrate_vault import vault_system
from vault_check import (ExplainAll, ask_publish_tool, check_frontmatter, check_gm_leak,
                         check_pc_body, check_sessions, configured_site,
                         vault_settings)
from vaultlib import (LEGACY_SETTINGS_FILE, PublishToolUnavailable, SettingsUnavailable,
                      forget_settings, google_fonts, set_key, setting_name, settings,
                      settings_default, settings_file, settings_raw, settings_set,
                      site_switch_written, vault_layout, written_in_vault_file, yaml_scalar)

INLINE_PUBLISH = (
    "the publish: block in _meta/vault-config.md is written on one line "
    "({…}); write it as a block so its settings can be read")  # old file only


# --- the checks ---------------------------------------------------------------

REPIN = "site-repin"


def _pin_check(site: Path) -> dict[str, Any]:
    """`update-pin --check --json` for the site; its answer has a boolean
    `ok`. Raises StepFailed when the tool does not give one."""
    code, out, err = plugin_tool(
        ["update-pin", "--check", "--json", "--site", str(site)])
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("ok"), bool):
        said = [x for x in err.splitlines() if x.strip()]
        raise StepFailed(
            "update-pin --check did not return the expected JSON: "
            + (said[-1].strip() if said else f"update-pin exited {code}"))
    return data


def find_site_repin(vault: Path) -> list[Item]:
    """The site builds with the tool installed in it, so that tool is
    brought to the plugin's before anything else asks it. `update-pin
    --check` says whether it is; this never reads the pin itself."""
    if settings(vault).inline:
        raise StepFailed(INLINE_PUBLISH)
    site, has_config = configured_site(vault)
    switch = setting_name(vault, "player_site.publish")
    folder = setting_name(vault, "player_site.folder")
    if site is None:
        if site_switch_written(settings(vault)) is True:
            raise StepFailed(
                f"{switch} is on but {folder} names no folder; "
                f"set {folder} to the site folder, or set {switch}: false")
        return []
    if not has_config:
        raise StepFailed(
            f"{folder} is set to {site} but no vault.config.json is "
            f"there; correct the path, or set {switch}: false")
    data = _pin_check(site)
    if data["ok"]:
        return []
    installed = data.get("installedBefore") or "none"

    def apply(_value: str | None) -> list[str]:
        code, text, err = plugin_tool(["update-pin", "--site", str(site)])
        # It may have written the site switch into the vault file.
        forget_settings(vault)
        lines = [line for line in text.splitlines() if line.strip()]
        if code != 0:
            tail = lines[-3:] or [err.strip() or f"update-pin exited {code}"]
            raise StepFailed("; ".join(tail))
        if not _pin_check(site)["ok"]:
            raise StepFailed(
                f"update-pin finished but the site ({folder} in "
                f"{settings_file(vault)}) is still out of date; run "
                "update-pin --site <that folder> by hand to see why")
        return lines

    return [Item(REPIN, WILL,
                 [f"repin the site's publish tool (installed: {installed})"], apply)]


MOVE = "settings-move"
NOT_OURS_FIRST = "1.23.0"   # the first publish tool that reads the new file


def _hidden_move_files(vault: Path) -> bool:
    """Whether `_meta` holds a hidden file a stopped move left."""
    meta = vault / "_meta"
    return meta.is_dir() and any(
        re.search(r"\.move\.(old|new)$", f.name) for f in meta.iterdir())


def _move_args(vault: Path, site: Path | None, has_config: bool,
               *extra: str) -> list[str]:
    args = ["settings", "move", "--vault", str(vault), "--json", *extra]
    if site is not None and has_config:
        args += ["--config", str(site / "vault.config.json")]
    return args


def _ask_move(vault: Path, args: list[str]) -> dict[str, Any]:
    """The settings command's answer to a move (a blocked move exits 1 and
    still answers in JSON). Raises StepFailed when it gives none."""
    code, out, err = plugin_tool(args)
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("ok"), bool) \
            or not isinstance(data.get("lines"), list):
        said = [x for x in err.splitlines() if x.strip()]
        raise StepFailed("the settings move gave no usable answer: "
                         + (said[-1].strip().removeprefix("Error: ") if said
                            else f"it exited {code}"))
    return data


def find_settings_move(vault: Path) -> list[Item]:
    """Every pass: a vault on the old settings file moves to the new one,
    all of it by the publish tool (`settings move`): the new file, the
    state file, the notes file, the settings out of the site folder's
    vault.config.json. A vault already moved is asked too when something
    could be left (an old file, a hidden file, a site folder), and tidied.
    The tool decides what moves; this decides only whether it is the plugin's
    to move: a vault with a site moves only when that site's tool is the
    plugin's own (`update-pin --check` says: `ours`), because an older pinned
    tool reads a moved vault as having no settings and would publish with
    defaults."""
    layout = vault_layout(vault)
    if layout == "none":
        return []    # no settings file: nothing names a site folder to ask
    site, has_config = configured_site(vault)
    if layout == "new" and not (
            (vault / LEGACY_SETTINGS_FILE).exists()
            or _hidden_move_files(vault) or (site is not None and has_config)):
        return []
    extra: list[str] = []
    if layout == "legacy":
        if site is not None and has_config:
            pin = _pin_check(site)
            if not pin.get("ours"):
                spec = pin.get("spec")
                return [Item(MOVE, PERSON, [
                    "settings\tthis vault stays on the old settings file "
                    f"because its site's publish tool is pinned by something "
                    f"else ({spec}). When that tool is {NOT_OURS_FIRST} or "
                    "later, run the update again."])]
        if not settings(vault).get("vault.system"):
            found = vault_system(vault)
            if found:
                extra = ["--fill", f"vault.system={found}"]
    base = _move_args(vault, site, has_config, *extra)
    plan = _ask_move(vault, [*base, "--check"])
    if not plan["ok"]:
        blockers = [str(b) for b in plan.get("blockers") or []]
        return [Item(MOVE, PERSON,
                     [f"settings\tthe settings cannot move to the new file "
                      f"yet: {b}" for b in blockers]
                     + ["settings\trun campaign-qa's Settings check, which "
                        "lists what to fix; the vault is not up to date "
                        "until it has moved"],
                     holds_stamp=True)]
    files = plan.get("files") or {}
    if not (files.get("write") or files.get("remove")):
        return []

    def apply(_value: str | None) -> list[str]:
        done = _ask_move(vault, base)
        forget_settings(vault)
        if not done["ok"]:
            raise StepFailed("; ".join(str(b) for b in done.get("blockers")
                                       or ["the move was blocked"]))
        if layout == "legacy" and vault_layout(vault) != "new":
            raise StepFailed("the move finished but the vault is not on the "
                             "new settings file")
        return [str(x) for x in done["lines"]]

    return [Item(MOVE, WILL, [str(x) for x in plan["lines"]], apply)]


def find_publish_site(vault: Path) -> list[Item]:
    """`player_site.publish` says whether the vault has a site. Written where it
    is missing: true with a site_dir, else false. A vault file with no
    `publish:` block has no site and gets nothing."""
    own = settings(vault)
    if own.inline or site_switch_written(own) is not None:
        return []
    # `has_site_block` is false for a `publish:` line with nothing under it,
    # which this still writes into; only a vault with no such line gets nothing.
    # The block that holds the site's settings, as the file names it.
    block = "player_site" if vault_layout(vault) == "new" else "publish"
    if block not in settings_raw(vault):
        return []
    has_dir = bool(own.get("player_site.folder"))
    value = "true" if has_dir else "false"
    where = settings_file(vault)
    switch = setting_name(vault, "player_site.publish")
    folder = setting_name(vault, "player_site.folder")
    row = (f"write {switch}: {value} in {where}" if has_dir
           else f"write {switch}: false in {where} (no site "
                f"folder is named; if this vault has a site, set "
                f"{folder} to its folder instead)")

    def apply(_value: str | None) -> list[str]:
        settings_set(vault, [("player_site.publish", has_dir)])
        return [f"wrote {switch}: {value}"]

    return [Item("publish-site", WILL, [row], apply)]


LEAK_NOTE = ("these sections no longer publish; if one was meant for "
             "players, say which and it is moved back out of GM Notes under "
             "a new heading")


# The headings the check reports on its own row beside a WOULD-FIX row, as
# vault_check's _heading_leak and _gm_leak word them; the title is the group.
_HEADING_ROW = re.compile(
    r"(?:bold-wrapped heading '(.+?)' defeats"
    r"|GM-only heading '(.+?)' publishes"
    r"|Keeper-facing heading '(.+?)' publishes"
    r"|'(.+?)' is Keeper material outside ## GM Notes)")
INCOMPLETE = "the check was incomplete: "


def _plain(title: str) -> str:
    return title.strip().strip("*_ ").casefold()


def _is_incomplete(level: str, message: str) -> bool:
    """A row on the vault saying the check did not look at everything, as
    opposed to the two routine INFO rows ("has no site to check", "asked
    <tool>")."""
    return level == "WARNING" or (level == "INFO" and message.endswith(
        "headings the site withholds on its own, like a handout's Context, "
        "Clues and Prop Notes, were not checked"))


def find_gm_leak(vault: Path) -> list[Item]:
    """Every pass: headings the site withholds are nested under GM Notes,
    so the vault matches the site (1.10.19 handout sections among them).
    What can be moved is Will do; what the check only reports needs a
    person. Per-note INFO rows (bold labels, callouts) can never be cleared
    and are left out."""
    rows = [cells(r) for r in check_gm_leak(vault, None, fix=False)]
    stopped(rows)
    would = [(where, m) for level, where, m in rows if level == "WOULD-FIX"]
    moved = {(where, _plain(m.split("'")[1])) for where, m in would
             if m.count("'") >= 2}

    def handled(where: str, message: str) -> bool:
        found = _HEADING_ROW.match(message)
        title = next((g for g in found.groups() if g), "") if found else ""
        return bool(found) and (where.rpartition(":")[0], _plain(title)) in moved

    person = [f"{where}\t{m}" for level, where, m in rows
              if level in ("ERROR", "WARNING") and where != "(vault)"
              and not handled(where, m)]
    person += [f"(vault)\t{INCOMPLETE}{m}" for level, where, m in rows
               if where == "(vault)" and _is_incomplete(level, m)]
    items: list[Item] = []
    if would:
        def apply(_value: str | None) -> list[str]:
            fixed = [cells(r) for r in check_gm_leak(vault, None, fix=True)]
            stopped(fixed)
            again = [cells(r) for r in check_gm_leak(vault, None, fix=False)]
            stopped(again)
            left = [r for r in again if r[0] == "WOULD-FIX"]
            if left:
                raise StepFailed(
                    f"gm-leak --fix left {len(left)} heading(s) to re-nest")
            return [*(f"{where}: {m}" for level, where, m in fixed
                      if level == "FIXED"), LEAK_NOTE]

        items.append(Item(
            "gm-leak", WILL,
            [f"{where}: {m.replace('re-nested', 're-nest', 1)}"
             for where, m in would], apply))
    if person:
        items.append(Item("gm-leak-review", PERSON, person))
    return items


def _played(vault: Path, extra: list[str]) -> dict[str, Any] | None:
    answer = ask_publish_tool(vault, ["manifest", "publish-played", *extra])
    if answer.why is not None:
        raise StepFailed(answer.why)
    data = answer.data
    if not isinstance(data, dict) or not data.get("applicable"):
        return None
    return data


def find_publish_played(vault: Path) -> list[Item]:
    """1.10.18: reviewed played sessions are registered in the publish
    manifest; the ones the tool calls unclear are the GM's choice."""
    data = _played(vault, ["--dry-run"])
    if data is None:
        return []
    items: list[Item] = []
    published = [str(p) for p in data.get("published") or []]
    if published:
        def apply(_value: str | None) -> list[str]:
            _played(vault, [])
            again = _played(vault, ["--dry-run"]) or {}
            pending = [p for p in published
                       if p in [str(x) for x in again.get("published") or []]]
            if pending:
                raise StepFailed("publish-played left these unregistered: "
                                 + ", ".join(pending))
            return [f"registered {p}" for p in published]

        items.append(Item("publish-played", WILL,
                          [f"register {p} as published" for p in published],
                          apply))
    for entry in data.get("unclear") or []:
        if not isinstance(entry, dict) or not entry.get("path"):
            continue
        path = str(entry["path"])
        flag = "--include-unreviewed" if entry.get("wrapUp") else "--publish-body"

        def apply_one(_value: str | None, path: str = path,
                      flag: str = flag) -> list[str]:
            _played(vault, ["--session", path, flag])
            again = _played(vault, ["--dry-run"]) or {}
            if path in [str(e.get("path")) for e in again.get("unclear") or []
                        if isinstance(e, dict)]:
                raise StepFailed(f"{path} is still unclear after "
                                 f"publish-played {flag}")
            return [f"registered {path}"]

        items.append(Item(f"played:{path}", CHOICE,
                          [f"publish this played session "
                           f"({entry.get('reason') or 'unclear'})"], apply_one))
    return items


# vault_check's row (an INFO on the vault) for a check that could not ask the tool.
NOT_CONSULTED = "the publish tool could not be consulted"


def _person_rows(vault: Path, rows: list[str], marker: str) -> list[str]:
    """The rows holding `marker`, as person rows. A vault with a site whose
    check could not ask the tool did not look: that stops the run, so the
    vault is not stamped past the release without the check having run."""
    if configured_site(vault)[0] is not None:
        for row in rows:
            _level, where, message = cells(row)
            if where == "(vault)" and message.startswith(NOT_CONSULTED):
                raise StepFailed(message)
    out = []
    for row in rows:
        _level, where, message = cells(row)
        if marker in message:
            out.append(f"{where}\t{message}")
    return out


def find_session_recaps(vault: Path) -> list[Item]:
    """1.10.18: a session index whose body the site now withholds."""
    rows = [_short_recap(r) for r in _person_rows(
        vault, check_sessions(vault), "session index body has")]
    return [Item("session-recaps", PERSON, rows)] if rows else []


_RECAP = re.compile(r"^(?P<where>[^\t]*)\tsession index body has (?P<n>\d+) "
                    r"line\(s\) outside a gm-only fence \u2014 .*?metadata "
                    r"only: (?P<homes>.*)$", re.S)
RECAP_SHARED = ("session index body outside a gm-only fence; the site "
                "withholds it now the session has a Wrap-Up. Keep the hub "
                "metadata only; ")


def _short_recap(row: str) -> str:
    """One recap row with what every row says moved to the shared text: the
    path keeps the line count and the hints that differ between notes."""
    found = _RECAP.match(row)
    if not found:
        return row
    *hints, remedy = found["homes"].split("; ")
    extra = "".join(f"; {h}" for h in hints)
    remedy = remedy.replace("on the hub", "there", 1)
    return (f"{found['where']} ({found['n']} lines{extra})"
            f"\t{RECAP_SHARED}{remedy}")


def find_unparseable(vault: Path) -> list[Item]:
    """1.10.23: notes whose frontmatter the build cannot parse."""
    rows = _person_rows(vault, check_frontmatter(vault, None, ExplainAll(vault)),
                        "cannot parse this frontmatter")
    return [Item("unparseable-notes", PERSON, rows)] if rows else []


# The remedy both "no usable Stat Sheet" warnings in vault_check's pc-body
# end with; the warning about retired frontmatter fields names the heading
# too but not this, so it is not a sheet problem.
NO_SHEET = "set sheet_source to where the sheet is kept"


def find_sheet_source(vault: Path) -> list[Item]:
    """1.10.22: a PC that publishes with no usable sheet. If the sheet is
    kept elsewhere the GM says where, and it is written to sheet_source."""
    rows = [cells(r) for r in check_pc_body(vault)]
    stopped(rows)
    items: list[Item] = []
    seen: set[str] = set()
    for level, where, message in rows:
        rel, _, line = where.rpartition(":")
        if not line.isdigit():
            rel = where
        if level != "WARNING" or NO_SHEET not in message or rel in seen:
            continue
        seen.add(rel)

        def apply(value: str | None, rel: str = rel) -> list[str]:
            if value == "leave":
                return [f"left sheet_source as it is in {rel}"]
            scalar = yaml_scalar(value or "")
            edit_frontmatter(
                vault / rel,
                lambda fm, eol: set_key(fm, "sheet_source", scalar, eol))
            return [f"wrote sheet_source: {scalar} to {rel}"]

        items.append(Item(f"sheet-source:{rel}", CHOICE,
                          [f"{message}; if the sheet is kept elsewhere, say "
                           f"where; leave: keep it as it is"], apply,
                          wants="where the sheet is kept, or leave",
                          holds_stamp=True))
    return items


POSTBUILD = ("the publish tool now adds the light/dark toggle and leaves "
             "retired PCs off the party board; if this script does either, "
             "remove that part")


def find_postbuild(vault: Path) -> list[Item]:
    """1.10.16 and 1.10.17: a site's own postbuild step may now double
    what the tool does. Whether it does is for a person to read."""
    site, _has_config = configured_site(vault)
    if site is None:
        return []
    try:
        data = json.loads((site / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    scripts = data.get("scripts") if isinstance(data, dict) else None
    script = scripts.get("postbuild") if isinstance(scripts, dict) else None
    if not isinstance(script, str) or not script.strip():
        return []
    return [Item("postbuild", PERSON,
                 [f'package.json (site)\tpostbuild script "{script}": '
                  f"{POSTBUILD}"])]


def _with_site(vault: Path) -> bool:
    """Whether the vault has a site; the steps below ask nothing of it
    otherwise."""
    return configured_site(vault)[0] is not None


def _set_settings(vault: Path, pairs: list[tuple[str, object]]) -> None:
    """Every pair in one write: the tool writes them in one edit, all or none.
    A refusal stops the step with the tool's reason."""
    try:
        settings_set(vault, pairs)
    except SettingsUnavailable as e:
        if not e.refused:
            raise
        raise StepFailed(str(e)) from e


def find_default_mode(vault: Path) -> list[Item]:
    """1.10.16: the site has a light/dark toggle. A site designed for one
    palette can start every reader there."""
    if (not _with_site(vault)
            or written_in_vault_file(vault_settings(vault),
                                     "player_site.theme.default_mode")):
        return []

    def apply(value: str | None) -> list[str]:
        if value not in ("dark", "light", "leave"):
            raise StepFailed("default-mode takes dark, light or leave")
        if value == "leave":
            return ["left the default palette to the reader's device"]
        _set_settings(vault, [("player_site.theme.default_mode", value)])
        return [f"wrote {setting_name(vault, 'player_site.theme.default_mode')}: "
                f"{value}"]

    return [Item("default-mode", CHOICE,
                 ["start every reader on one palette (unset follows the "
                  "reader's device, as before; leave: keep that)"],
                 apply, wants="dark, light or leave", holds_stamp=True)]


def _google_fonts(vault: Path) -> list[str]:
    """The families the site would load from Google, as the plugin's own
    publish tool works them out."""
    site, has_config = configured_site(vault)
    try:
        return google_fonts(
            vault, site / "vault.config.json" if site and has_config else None)
    except PublishToolUnavailable as e:
        raise StepFailed(str(e)) from e


def find_fonts(vault: Path) -> list[Item]:
    """1.10.17: fonts loaded from Google send each reader's IP address to
    Google. Self-hosting serves the same fonts from the site."""
    names = _google_fonts(vault) if _with_site(vault) else None
    if not names:
        return []

    def apply(_value: str | None) -> list[str]:
        _set_settings(vault, [("player_site.theme.fonts.source", "self-host")])
        return [f"wrote {setting_name(vault, 'player_site.theme.fonts.source')}: "
                "self-host; the next build "
                "downloads the fonts once and serves them from the site"]

    return [Item("fonts-self-host", CHOICE,
                 [f"serve {', '.join(str(n) for n in names)} from the site "
                  f"instead of Google Fonts, which sees each reader's IP "
                  f"address; the look does not change"], apply)]


def find_tone_shown(vault: Path) -> list[Item]:
    """1.10.45: the site shows a relationship's tone, as warm, hostile or
    neutral (never the word). A notice, said once: a check with a release
    is not offered again once the vault is stamped past it. Only a vault
    with a site that shows at least one tone has anything to be told: a
    tone on a note that does not publish, on a `gm_only` relationship or on
    a note that excludes `relationships` is not shown."""
    import tones    # it imports migrate_core, as this module does

    site, _has_config = configured_site(vault)
    if site is None or not tones.site_shows_a_tone(vault):
        return []
    return [Item("tone-shown", PERSON, [
        "relationship tones (site)\tthe site now shows each relationship's "
        "tone as warm, hostile or neutral, never the word itself. A tone "
        "that gives a secret away wants `gm_only: true` on that "
        "relationship, or another tone. campaign-qa's Tone Words check "
        "lists the hostile ties the site shows"])]


# The two lists the vault file holds in plain sight.
EXCLUDE_LISTS = ("player_site.hide.sections", "player_site.hide.fields")


def find_exclude_lists(vault: Path) -> list[Item]:
    """1.10.47: the lists of headings and fields the site hides are written
    into the vault file, where the GM can see them. A vault with no list of
    its own only ever had the tool's built-in one, so writing that same list
    changes nothing about what publishes. A list the vault owns is left."""
    if not _with_site(vault):
        return []
    now = vault_settings(vault)
    # A list is the vault's own when the vault file holds it, or the site file
    # still does; one the tool could not read is not (the built-in list stands).
    lists = [(name, default) for name, default in (
        (name, settings_default(name)) for name in EXCLUDE_LISTS)
        if now.origins[name] not in ("file", "site-file")
        and isinstance(default, list) and default]
    if not lists:
        return []

    def apply(_value: str | None) -> list[str]:
        _set_settings(vault, [(name, default) for name, default in lists])
        return [f"wrote {setting_name(vault, name)}: {len(default)} entries"
                for name, default in lists]

    return [Item("exclude-lists", WILL,
                 [f"write the built-in {setting_name(vault, name)} "
                  f"({', '.join(default)}) "
                  f"into {settings_file(vault)} so you can see and edit it; "
                  f"what publishes does not change"
                  for name, default in lists], apply)]


SITE_CHECKS: list[Check] = [
    Check(REPIN, None, 1, "the site's publish tool", find_site_repin),
    Check(MOVE, None, 2, "the settings move to the new settings file",
          find_settings_move),
    Check("publish-site", None, 2, "the site switch",
          find_publish_site),
    Check("default-mode", "1.10.16", 2, "a default palette", find_default_mode,
          asks_site=True, choices=("default-mode=",)),
    Check("fonts-self-host", "1.10.17", 2, "fonts served from the site",
          find_fonts, asks_site=True, choices=("fonts-self-host",)),
    Check("postbuild", "1.10.17", 3, "the site's postbuild script",
          find_postbuild),
    Check("tone-shown", "1.10.46", 3, "relationship tones shown on the site",
          find_tone_shown),
    Check("publish-played", "1.10.18", 4, "played sessions are registered",
          find_publish_played, asks_site=True, choices=("played:",)),
    Check("session-recaps", "1.10.18", 4, "recaps kept in session indexes",
          find_session_recaps, asks_site=True),
    Check("sheet-source", "1.10.22", 4, "PCs with no character sheet",
          find_sheet_source, asks_site=True, choices=("sheet-source:=",)),
    Check("unparseable-notes", "1.10.23", 4,
          "notes the build cannot parse", find_unparseable, asks_site=True),
    Check("exclude-lists", "1.10.47", 2, "the built-in exclude lists, written "
          "into the vault file", find_exclude_lists, asks_site=True),
    Check("gm-leak", None, 4, "sections the site withholds are nested under "
          "GM Notes", find_gm_leak, asks_site=True),
]

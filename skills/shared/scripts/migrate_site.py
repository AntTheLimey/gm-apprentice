#!/usr/bin/env python3
"""migrate_site.py: the migration checks that concern the vault's site.

The site's publish tool is repinned first; everything else that asks the
tool runs after it. What publishes, what the pin is and what the config
holds are the publish tool's answers, never a second reading here.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from migrate_core import (CHOICE, PERSON, WILL, Check, Item,
                          StepFailed, cells, edit_frontmatter, plugin_tool, stopped)
from vault_check import (ExplainAll, ask_publish_tool, check_frontmatter, check_gm_leak,
                         check_pc_body, check_sessions, configured_site,
                         _kept_by_player, semver_below, site_pin, vault_settings)
from vaultlib import (PublishToolUnavailable, SettingsUnavailable,
                      forget_settings, google_fonts, set_key, settings,
                      settings_added, settings_add, settings_default, settings_file, settings_raw, settings_remove, settings_set,
                      settings_unset, settings_written, site_switch_written, written_in_vault_file, yaml_scalar)

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
    site, has_config = configured_site(vault)
    switch = "player_site.publish"
    folder = "player_site.folder"
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


FULL_MODE = "full-mode"
RETIRED_MODE = "player_site.hide.mode"


def _drop_mode(vault: Path) -> list[str]:
    """Remove the retired `mode` line; nothing else is written."""
    try:
        settings_unset(vault, [RETIRED_MODE])
    except SettingsUnavailable as e:
        raise StepFailed(f"nothing was changed: {e}") from e
    return [f"removed {RETIRED_MODE} (no longer used)"]


def _move_full_vault(vault: Path) -> list[str]:
    """A `full` vault becomes a GM site: the GM site on (its folder beside
    the old site's, made by the tool), the player site off, then `mode` out.
    The first write is one edit, all or none. If taking `mode` out then
    fails, the first write is undone, so the vault is as it was; and if that
    cannot be undone either, the message says exactly what is in the file."""
    before = settings(vault)
    was = {n: (written_in_vault_file(before, n), before.get(n))
           for n in ("gm_site.publish", "gm_site.folder", "player_site.publish")}
    old_folder = before.get("player_site.folder")
    _set_settings(vault, [("gm_site.publish", True), ("player_site.publish", False)])
    after = settings(vault)
    folder = after.get("gm_site.folder")
    try:
        settings_unset(vault, [RETIRED_MODE])
    except SettingsUnavailable as e:
        raise StepFailed(_undo_full_move(vault, was, folder, str(e))) from e
    return [f"This vault's site published everything (`full`), so it is now "
            f"your GM site, built in {folder}; it never goes online. The old "
            f"site folder ({old_folder}) is no longer built, but still holds "
            "the last site that published everything; a copy already pushed "
            "or deployed stays online until you remove it."]


def _undo_full_move(vault: Path, was: dict[str, tuple[bool, Any]],
                    folder: Any, why: str) -> str:
    """Put the settings back as they were; the message for the run."""
    try:
        drop = [n for n in ("gm_site.publish", "gm_site.folder")
                if not was[n][0]]
        if not was["player_site.publish"][0]:
            drop.append("player_site.publish")
        if drop:
            settings_unset(vault, drop)
        back = [(n, was[n][1]) for n in ("gm_site.publish", "gm_site.folder",
                                         "player_site.publish")
                if was[n][0]]
        if back:
            _set_settings(vault, back)
    except (SettingsUnavailable, StepFailed) as e:
        return (f"{RETIRED_MODE} could not be removed ({why}), and the "
                f"change before it could not be fully undone ({e}). The "
                "file still has mode: full; gm_site.publish and "
                "player_site.publish may be part way between the old and "
                "new values. Run the update again: it finishes from there")
    made = Path(str(folder)) if folder else None
    if made is not None and not was["gm_site.folder"][0]:
        try:
            made.rmdir()   # the folder the tool made, if still empty
        except OSError:
            pass
    return (f"{RETIRED_MODE} could not be removed ({why}). Nothing was "
            "changed: the vault is as it was")


def find_full_mode(vault: Path) -> list[Item]:
    """`player_site.hide.mode` is retired: the GM site is what `full` was.
    Written anything but `full`: it is only removed. Written `full`: the
    vault's site becomes its GM site. Every pass; not written, nothing."""
    try:
        value, origin = settings_written(vault, RETIRED_MODE)
    except SettingsUnavailable as e:
        return [Item(FULL_MODE, PERSON,
                     [f"(vault)\tcould not read {RETIRED_MODE}, so the "
                      f"retired `mode` line was not looked at: {e}"])]
    if origin != "file" or value is None:
        return []
    name = RETIRED_MODE
    if str(value).strip().lower() != "full":
        return [Item(FULL_MODE, WILL, [f"remove {name} (no longer used)"],
                     lambda _v: _drop_mode(vault))]
    own = settings(vault)
    if own.get("vault.kept_by") == "player":
        return [Item(FULL_MODE, WILL,
                     [f"remove {name} (no longer used); this vault is kept by "
                      "a player, so it has no GM site, and its site follows "
                      "the publish list"],
                     lambda _v: _drop_mode(vault))]
    if not own.get("player_site.folder") and not own.get("gm_site.folder"):
        return [Item(FULL_MODE, PERSON,
                     [f"{name}\t`full` is no longer used: this vault's site "
                      "published everything, so it becomes a GM site, but no "
                      "site folder is named to put it beside. Tell me the "
                      "folder (settings set player_site.folder=<folder>), "
                      "then run the update again"], holds_stamp=True)]
    if any(
            written_in_vault_file(own, n) and own.get(n) is False
            for n in ("gm_site.publish", "player_site.publish")):
        return [Item(FULL_MODE, WILL,
                     [f"remove {name} (no longer used); a site switch is "
                      "written off in this vault, so this does not turn the "
                      "GM site on"],
                     lambda _v: [*_drop_mode(vault),
                                 "did not turn the GM site on: a site switch "
                                 "is written off. To have one, turn "
                                 "gm_site.publish on"])]
    return [Item(FULL_MODE, WILL,
                 [f"{name} is `full`: turn this vault's site into your GM site "
                  f"(gm_site.publish on, built beside the old site folder and "
                  f"never put online) and turn the player site off; then "
                  f"remove {name}"],
                 lambda _v: _move_full_vault(vault))]


def find_publish_site(vault: Path) -> list[Item]:
    """`player_site.publish` says whether the vault has a site. Written where it
    is missing: true with a site_dir, else false. A vault file with no
    `publish:` block has no site and gets nothing."""
    own = settings(vault)
    if site_switch_written(own) is not None:
        return []
    # `has_site_block` is false for a `publish:` line with nothing under it,
    # which this still writes into; only a vault with no such line gets nothing.
    if "player_site" not in settings_raw(vault):
        return []
    has_dir = bool(own.get("player_site.folder"))
    value = "true" if has_dir else "false"
    where = settings_file(vault)
    switch = "player_site.publish"
    folder = "player_site.folder"
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
    if _kept_by_player(vault):
        return []
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
        return ["wrote player_site.theme.default_mode: "
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
        return ["wrote player_site.theme.fonts.source: "
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
    import tones    # its refusals are StepFailed, which the update reports

    site, _has_config = configured_site(vault)
    if site is None or not tones.site_shows_a_tone(vault):
        return []
    return [Item("tone-shown", PERSON, [
        "relationship tones (site)\tthe site now shows each relationship's "
        "tone as warm, hostile or neutral, never the word itself. A tone "
        "that gives a secret away wants `gm_only: true` on that "
        "relationship, or another tone. campaign-qa's Tone Words check "
        "lists the hostile ties the site shows"], notice=True)]


# The two lists the vault file holds in plain sight.
EXCLUDE_LISTS = ("player_site.hide.sections", "player_site.hide.fields")
# The publish tool's fault kinds (tools/publish/lib/settings/read.js) that
# mean the GM wrote a value for a setting that was not used.
TYPED_FAULTS = ("not-allowed", "dropped", "old-name", "unknown-name")


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

    where = settings_file(vault)
    # A value the GM wrote that the tool could not use (not a list, an old
    # name, a misplaced name, a group that is not a map): the build ignored
    # it, so the built-in list has been what publishes; the line says what
    # was typed before it is replaced, and replacing it asks.
    typed: dict[str, str] = {}
    for f in now.faults:
        if f.get("kind") not in TYPED_FAULTS:
            continue
        setting, written = f.get("setting"), str(f.get("name") or "")
        said = str(f.get("message") or written)
        for name in EXCLUDE_LISTS:
            if setting == name or (setting is None and written
                                   and name.startswith(written + ".")):
                typed.setdefault(name, said)

    def line(name: str, default: list) -> str:
        replaced = f" (replacing: {typed[name]})" if name in typed else ""
        return (f"{'replace' if name in typed else 'write'} the built-in "
                f"{name} ({', '.join(default)}) "
                f"into {where} so you can see and edit it"
                f"{replaced}; what publishes does not change")

    def write(chosen: list[tuple[str, list]]) -> Callable[[str | None], list[str]]:
        def apply(_value: str | None) -> list[str]:
            _set_settings(vault, list(chosen))
            return [f"wrote {name}: {len(default)} entries"
                    for name, default in chosen]
        return apply

    # Writing a list the vault never had changes nothing; replacing what the
    # GM typed is theirs to say yes to (`gma update` asks; migrate.py runs
    # both on the one yes, as before).
    fresh = [(n, d) for n, d in lists if n not in typed]
    replacing = [(n, d) for n, d in lists if n in typed]
    items = []
    if fresh:
        items.append(Item("exclude-lists", WILL,
                          [line(n, d) for n, d in fresh], write(fresh)))
    if replacing:
        items.append(Item("exclude-lists-replace", WILL,
                          [line(n, d) for n, d in replacing], write(replacing),
                          kind="asks"))
    return items


def find_hide_additions(vault: Path, since: str) -> list[Item]:
    """An entry put in a built-in hide list in release `since` reaches a
    vault that owns its list only when the GM says yes: the list the vault
    owns replaces the built-in one, so without this step the entry would
    publish. One item per entry missing from a list the vault owns; none for
    a vault with no site or with no list of its own (the built-in list,
    which holds the entry, is what it uses)."""
    if not _with_site(vault):
        return []
    now = vault_settings(vault)
    items: list[Item] = []
    for name in EXCLUDE_LISTS:
        if now.origins[name] not in ("file", "site-file"):
            continue
        has = now.get(name)
        has = has if isinstance(has, list) else []
        for added in settings_added(name):
            entry = added["entry"]
            if added["since"] != since or entry in has:
                continue

            def apply(_value: str | None, name: str = name,
                      entry: str = entry) -> list[str]:
                try:
                    settings_add(vault, name, [entry])
                except SettingsUnavailable as e:
                    if not e.refused:
                        raise
                    raise StepFailed(str(e)) from e
                return [f"added {entry} to {name}"]

            # Held: silence is not an answer, and once the vault is
            # stamped the release gate would never offer this again.
            items.append(Item(
                f"hide-add:{entry}", CHOICE,
                [f"add {entry} to the details your site hides ({name}), "
                 f"so the site never shows it: {entry} is {added['why']}"],
                apply, holds_stamp=True))
    return items


AFTER_BUILD = "player_site.after_build"
PROP_KEEP = "player_site.keep"
PAGE_EXTS = (".html", ".htm")
OPTIMIZE = "player_site.images.optimize"

# The site build steps the publish tool now does itself, by script name: what
# the tool does, and what changes on the site once the step is gone.
RETIRED_STEPS = {
    "apply-overrides": (
        "the publish tool already links css/overrides.css on every page. "
        "Retire it and theme.css stops carrying a second copy of the same "
        "rules; look at one page in light and dark afterwards"),
    "add-tohit-calc": (
        "the publish tool already shows the GURPS to-hit calculator on PC "
        "pages. Retire it and the step's two extra files "
        "(css/tohit-calc.css, js/tohit-calc.js) and its link on each PC "
        "page go"),
    "add-theme-toggle": (
        "the publish tool already puts a light/dark button on every page, so "
        "each page has two. Retire it and the second button goes; a reader's "
        "saved light/dark choice may be forgotten once"),
    "add-crew-stories": (
        "the publish tool (1.46.0 on) already links every session on a story "
        "page (an id, a Sessions bar and a copy-link icon) and lists every "
        "NPC whose page runs session by session on the Story page. Retire it "
        "and the list's heading changes from \"Crew\" to \"NPC stories\"; "
        "the sessions look the same"),
    "optimize-images": (
        "the publish tool shrinks pictures to WebP itself, the same way, and "
        "keeps them between builds so a build only shrinks new pictures. "
        f"Retire it and the update turns on {OPTIMIZE} first, then removes "
        "the step; the site comes out the same"),
}


# The publish tool version that first does each step's work (git history of
# tools/publish/package.json): a site whose tool is older keeps the step.
RETIRED_FROM = {
    "apply-overrides": "1.9.0",
    "add-theme-toggle": "1.11.38",
    "add-tohit-calc": "1.21.0",
    "optimize-images": "1.29.1",
    "add-crew-stories": "1.46.0",
}
# The steps each release offers to retire (a release gate offers a check once).
RETIRED_IN = {
    "1.10.63": ("apply-overrides", "add-tohit-calc", "add-theme-toggle",
                "optimize-images"),
    "1.10.92": ("add-crew-stories",),
}


def _retired_step(command: str) -> str | None:
    """The retired step a build step runs, or None: `node` and the script's
    path, written any way the step runner reads the same file (`./`, either
    slash, quoted, extra spaces), and nothing after it."""
    m = re.fullmatch(r"\s*node\s+([\"']?)(?:[^\s\"']*[/\\])?([\w-]+)\.mjs\1\s*",
                     command)
    return m.group(2) if m and m.group(2) in RETIRED_STEPS else None


def find_retire_steps(vault: Path, release: str = "1.10.63") -> list[Item]:
    """1.10.63: a build step the publish tool now does itself is offered for
    retiring, one choice per step `release` added (RETIRED_IN). Only steps
    the vault's own settings file holds: steps still in the site folder move
    there first. Only once the site's own tool does the step's work: until
    then the GM is told, and the stamp waits."""
    try:
        s = settings(vault)
    except SettingsUnavailable:
        return []
    steps = s.get(AFTER_BUILD)
    if s.origins.get(AFTER_BUILD) != "file" or not isinstance(steps, list):
        return []
    site, _has_config = configured_site(vault)
    if site is None:
        return []
    tool = site_pin(site).version
    items: list[Item] = []
    seen: set[str] = set()
    for command in steps:
        name = _retired_step(str(command))
        if name is None or name in seen or name not in RETIRED_IN[release]:
            continue
        seen.add(name)
        if tool is None or semver_below(tool, RETIRED_FROM[name]):
            items.append(Item(
                f"retire-step:{name}", PERSON,
                [f"{AFTER_BUILD}\t"
                 f'build step "{command}": the site\'s publish tool is '
                 f"{tool or 'not installed'}, and does this step's work from "
                 f"{RETIRED_FROM[name]}; update it (update-pin --site {site}) "
                 "and the update offers to retire the step"],
                None, holds_stamp=True))
            continue
        # Every spelling of the same step goes ("scripts/x.mjs", "./scripts/x.mjs").
        same = [str(c) for c in steps if _retired_step(str(c)) == name]
        had_optimize = (s.origins.get(OPTIMIZE) == "file", s.get(OPTIMIZE))

        def apply(value: str | None, name: str = name,
                  command: str = str(command), same: list[str] = same,
                  had: tuple[bool, object] = had_optimize) -> list[str]:
            if value not in ("retire", "leave"):
                raise StepFailed(f"retire-step:{name} takes retire or leave")
            if value == "leave":
                return [f'kept the build step "{command}"']
            done: list[str] = []
            if name == "optimize-images":
                # Never without the setting: the pictures would ship unshrunk.
                _set_settings(vault, [(OPTIMIZE, True)])
                done.append(f"wrote {OPTIMIZE}: true")
            try:
                removed = settings_remove(vault, AFTER_BUILD, same)
                if not removed:
                    raise StepFailed(f'the build step "{command}" was not in '
                                     f"{AFTER_BUILD}")
            except (SettingsUnavailable, StepFailed) as e:
                if name == "optimize-images":
                    # Put the setting back as it was: the step still runs.
                    if had[0]:
                        _set_settings(vault, [(OPTIMIZE, had[1])])
                    else:
                        settings_unset(vault, [OPTIMIZE])
                raise StepFailed(str(e)) from e
            done.append(f'removed the build step "{command}" from '
                        f"{AFTER_BUILD}")
            return done

        items.append(Item(f"retire-step:{name}", CHOICE,
                          [f'build step "{command}": {RETIRED_STEPS[name]}. '
                           f"retire: stop running it; leave: keep the step"],
                          apply, wants="retire or leave", holds_stamp=True))
    return items


PROP_MOVE_DECISIONS = "_meta/prop-move.json"
PROP_STEPS = ("add-props", "inject-gazetteer")
PROP_MOVE_SCRIPT = Path(__file__).resolve().parent / "prop_move.py"


def _run_prop_move(vault: Path, args: list[str]) -> tuple[int, str, str]:
    """prop_move.py on `vault`: (exit code, stdout, stderr). No time limit:
    the move bounds each tool call itself, and a limit here would kill it
    between steps, past its put-back."""
    try:
        proc = subprocess.run(
            [sys.executable, str(PROP_MOVE_SCRIPT), str(vault), *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            check=False)
    except OSError as e:
        raise StepFailed(f"prop_move.py could not run ({e.__class__.__name__})") from e
    return proc.returncode, proc.stdout, proc.stderr


def _move_failure(code: int, out: str, err: str) -> str:
    """The move's own reason, one line: its ERROR rows (each ends with the
    outcome: the vault as it was, or the files it could not put back), else
    the last thing it said."""
    errors = [c[2] for c in (row.split("\t", 2) for row in out.splitlines())
              if len(c) == 3 and c[0] == "ERROR"]
    lines = [x.strip() for x in (out + "\n" + err).splitlines() if x.strip()]
    return "; ".join(errors) or (lines[-1] if lines else f"prop_move.py exited {code}")


def _prop_steps(steps: list[Any]) -> list[str]:
    """The names of the prop build steps (`add-props`, `inject-gazetteer`)
    among `steps`, once each."""
    from prop_move import step_script  # prop_move imports this module
    names = []
    for command in steps:
        found = step_script(str(command))
        if found and found[1] in PROP_STEPS:
            names.append(found[1])
    return list(dict.fromkeys(names))


def find_props_move(vault: Path) -> list[Item]:
    """1.10.105: props kept by hand or by site scripts can move into the
    vault as prop notes. Cheap: reads notes, folders and settings, builds
    nothing; `prop_move.py VAULT plan` does the comparing. Offered once per
    vault, and only the GM's answer moves anything."""
    site, _has_config = configured_site(vault)
    if site is None:
        return []
    from prop_move import _notes, is_build_props_note, moved_pages, nfc  # prop_move imports this module
    from vaultlib import extract_frontmatter, is_skipped_path
    try:
        s = settings(vault)
        keep = s.get(PROP_KEEP)
        steps = s.get(AFTER_BUILD)
        output = str(s.get("player_site.output") or "docs")
    except SettingsUnavailable:
        return []
    keep = [str(k) for k in keep] if isinstance(keep, list) else []
    built = 0
    notes = _notes(vault)
    named: set[str] = set()
    # The pages a finished move dealt with, by vault path (#525).
    done = moved_pages(vault)
    for rel, text in notes:
        if is_build_props_note(text):
            built += 1
        value = (extract_frontmatter(text) or {}).get("prop_file")
        if isinstance(value, str) and value.strip():
            named.add(Path(value.strip()).name.lower())
    pages: list[Path] = []
    chapters = vault / "Chapters"
    for folder in sorted(chapters.rglob("Props")) if chapters.is_dir() else []:
        for p in sorted(folder.iterdir()) if folder.is_dir() else []:
            if (p.is_file() and p.suffix.lower() in PAGE_EXTS
                    and p.name.lower() != "index.html" and p.name.lower() not in named
                    and nfc(p.relative_to(vault).as_posix()) not in done
                    and not is_skipped_path(p.relative_to(vault).as_posix())):
                pages.append(p)
    kept: dict[str, int] = {}
    live_names: set[str] = set()
    for k in keep:
        root = site / output / k
        if root.is_dir():
            files = [f for f in root.rglob("*") if f.is_file()]
            live_names.update(f.name.lower() for f in files)
            kept[k] = sum(1 for f in files if f.suffix.lower() in PAGE_EXTS)
    live = sum(1 for p in pages if p.name.lower() in live_names)
    lines: list[str] = []
    if built:
        lines.append(f"{built} build_props note{'' if built == 1 else 's'} "
                     "become prop notes")
    if pages:
        lines.append(f"{len(pages)} hand-made page{'' if len(pages) == 1 else 's'} "
                     f"in Props folders, {live} of them live on the site")
    for k, n in kept.items():
        lines.append(f"kept folder {k} with {n} page{'' if n == 1 else 's'}")
    for name in _prop_steps(steps if isinstance(steps, list) else []):
        lines.append(f"build step {name} is present")
    if not lines:
        return []
    lines.append("run prop_move.py VAULT plan to see every page compared "
                 "before choosing")

    def apply(value: str | None) -> list[str]:
        if value not in ("move", "leave"):
            raise StepFailed("props-move takes move or leave")
        if value == "leave":
            return ["left the props where they are; nothing moved"]
        args = ["apply"]
        if (vault / PROP_MOVE_DECISIONS).is_file():
            args += ["--decisions", PROP_MOVE_DECISIONS]
        code, out, err = _run_prop_move(vault, args)
        if code != 0:
            # prop_move's own ERROR row ends "the vault is as it was" or names the files it could not put back;
            # that outcome is passed through as it said it, never assumed.
            raise StepFailed(f"the props move did not go through: {_move_failure(code, out, err)}")
        done = [x for x in out.splitlines() if x.strip()]
        return [f"moved the props into the vault ({done[-1].lstrip('# ')})"
                if done else "moved the props into the vault"]

    return [Item("props-move", CHOICE, lines, apply, wants="move or leave",
                 holds_stamp=True)]


PROPS_SETTLE = "props-settle"


def find_props_settle(vault: Path) -> list[Item]:
    """1.10.106: the 1.10.105 move made its notes for live pages from the
    prop template, which marks them DRAFT, so their pages show players a
    Draft badge. Offered for exactly the notes the move wrote and left as it
    wrote them (prop_move.moved_drafts), each named; only the GM's answer
    changes anything, and only `canon_status`."""
    site, _has_config = configured_site(vault)
    if site is None:
        return []
    from prop_move import SETTLED, moved_drafts  # prop_move imports this module
    rels = moved_drafts(vault)
    if not rels:
        return []
    lines = [f"{len(rels)} prop note{'' if len(rels) == 1 else 's'} the props move made {'is' if len(rels) == 1 else 'are'} "
             f"published, still as the move wrote {'it' if len(rels) == 1 else 'them'}, never revealed by a session, and "
             f"marked DRAFT, so {'its page shows' if len(rels) == 1 else 'their pages show'} players a Draft badge. "
             f"settle: mark {'it' if len(rels) == 1 else 'them'} {SETTLED}; leave: keep DRAFT"]
    lines += [f"{rel}\tcanon_status: DRAFT -> {SETTLED}" for rel in rels]

    def apply(value: str | None) -> list[str]:
        if value not in ("settle", "leave"):
            raise StepFailed(f"{PROPS_SETTLE} takes settle or leave")
        if value == "leave":
            return ["left the moved prop notes as DRAFT"]
        done: list[str] = []
        for rel in rels:
            def change(fm: list[str], eol: str) -> None:
                at = [i for i, ln in enumerate(fm) if re.match(r"canon_status:\s*[\"']?DRAFT[\"']?\s*$", ln.rstrip("\r\n"))]
                if len(at) != 1:
                    raise ValueError("its canon_status is no longer DRAFT")
                fm[at[0]] = f"canon_status: {SETTLED}{eol}"
            try:
                edit_frontmatter(vault / rel, change)
            except StepFailed as e:
                # Say what already changed: those notes are settled and stay so.
                changed = ", ".join(rels[:len(done)]) or "none"
                raise StepFailed(f"{rel} was not settled ({e}); settled before it: {changed}") from e
            done.append(f"{rel}: canon_status {SETTLED}")
        return done

    return [Item(PROPS_SETTLE, CHOICE, lines, apply, wants="settle or leave", holds_stamp=True)]


SITE_CHECKS: list[Check] = [
    Check(REPIN, None, 1, "the site's publish tool", find_site_repin,
          kind="bookkeeping",
          plain=("Updated the site's publish tool to match the plugin.")),
    Check(FULL_MODE, None, 2, "a vault that published everything becomes a "
          "GM site", find_full_mode,
          kind="removes",
          plain=("Retired the old site mode setting; a site that showed everything became your GM site."),
          ask=("Removes the old site mode setting; if it said everything should show, your site becomes your GM site."),
          left=("Kept the old site mode setting.")),
    Check("publish-site", None, 2, "the site switch",
          find_publish_site,
          kind="bookkeeping",
          plain=("Wrote down whether this vault has a site, which it had only implied.")),
    Check("default-mode", "1.10.16", 2, "a default palette", find_default_mode,
          asks_site=True, choices=("default-mode=",),
          kind="asks",
          plain=("Set the colour scheme your site starts readers in."),
          ask=("Sets the colour scheme your site starts readers in."),
          left=("Kept your site starting in the reader's own colour scheme.")),
    Check("fonts-self-host", "1.10.17", 2, "fonts served from the site",
          find_fonts, asks_site=True, choices=("fonts-self-host",),
          kind="asks",
          plain=("Set your site to serve its own fonts, so readers' addresses are not sent to Google."),
          ask=("Makes your site serve its own fonts, so readers' addresses are not sent to Google."),
          left=("Kept your site loading its fonts from Google.")),
    Check("tone-shown", "1.10.46", 3, "relationship tones shown on the site",
          find_tone_shown,
          kind="bookkeeping",
          plain=("Said that the site now shows whether each relationship is warm, hostile or neutral; nothing was changed.")),
    Check("retire-steps", "1.10.63", 3, "build steps the publish tool now "
          "does itself", find_retire_steps, choices=("retire-step:=",),
          kind="removes",
          plain=("Removed build steps your site ran that the publish tool now does itself."),
          ask=("Removes a build step your site runs that the publish tool now does itself, so it is not done twice."),
          left=("Kept your site's own build step.")),
    Check("retire-steps-2", "1.10.92", 3, "build steps the publish tool now "
          "does itself", lambda v: find_retire_steps(v, "1.10.92"),
          choices=("retire-step:=",),
          kind="removes",
          plain=("Removed build steps your site ran that the publish tool now does itself."),
          ask=("Removes a build step your site runs that the publish tool now does itself, so it is not done twice."),
          left=("Kept your site's own build step.")),
    Check("publish-played", "1.10.18", 4, "played sessions are registered",
          find_publish_played, asks_site=True, choices=("played:",),
          kind="asks",
          plain=("Added the sessions you have played to the pages your site publishes."),
          ask=("Adds the sessions you have played to the pages your site publishes, so players can read them."),
          left=("Kept those sessions off your site.")),
    Check("session-recaps", "1.10.18", 4, "recaps kept in session indexes",
          find_session_recaps, asks_site=True,
          kind="asks",
          plain=("Pointed out session notes whose recap text the site now keeps off the player site."),
          ask=("Needs you to move the recap text by hand; nothing changes until then."),
          left=("Kept the recap text where it is.")),
    Check("sheet-source", "1.10.22", 4, "PCs with no character sheet",
          find_sheet_source, asks_site=True, choices=("sheet-source:=",),
          kind="asks",
          plain=("Recorded where each character's sheet is kept, for characters whose notes have none."),
          ask=("Records where the character's sheet is kept, so the site can show it."),
          left=("Left the character with no sheet named.")),
    Check("unparseable-notes", "1.10.23", 4,
          "notes the build cannot parse", find_unparseable, asks_site=True,
          kind="asks",
          plain=("Pointed out notes whose details at the top the site cannot read."),
          ask=("Needs you to fix the details at the top of the note by hand; nothing changes until then."),
          left=("Left the note as it is.")),
    Check("exclude-lists", "1.10.47", 2, "the built-in exclude lists, written "
          "into the vault file", find_exclude_lists, asks_site=True,
          kind="bookkeeping",
          plain=("Wrote the lists of headings and details your site hides into your settings, where you can see them; what publishes is unchanged."),
          ask=("Replaces a value you typed for the headings or details your site hides with the built-in list; what publishes does not change, since the site already ignored that value."),
          left=("Kept the value you typed for what your site hides.")),
    Check("hide-fields-voice", "1.11.2", 2, "the voice field kept off the site",
          lambda v: find_hide_additions(v, "1.11.2"), asks_site=True,
          choices=("hide-add:",),
          kind="asks",
          plain=("Added voice to the details your site hides, so the voice you keep for the campaign and its characters never shows on the site."),
          ask=("Adds voice to the details your site hides, so the voice you keep for the campaign and its characters never shows on the site."),
          left=("Kept your list of hidden details without voice, so a voice can show on your site wherever a page names that detail.")),
    Check("gm-leak", None, 4, "sections the site withholds are nested under "
          "GM Notes", find_gm_leak, asks_site=True,
          kind="bookkeeping",
          plain=("Moved headings the site keeps from players under GM Notes, so the notes match the site.")),
    Check("props-move", "1.10.105", 4, "props kept by hand or by site scripts "
          "move into the vault", find_props_move, asks_site=True,
          choices=("props-move=",),
          kind="asks",
          plain=("Moved props kept by hand or by site scripts into the vault as prop notes."),
          ask=("Moves props kept by hand or by site scripts into the vault as prop notes."),
          left=("Kept your props where they are.")),
    Check(PROPS_SETTLE, "1.10.106", 4, "prop notes the props move left as drafts",
          find_props_settle, asks_site=True, choices=(f"{PROPS_SETTLE}=",),
          kind="asks",
          plain=("Marked the prop notes the props move made as finished, so their pages stop showing a Draft badge."),
          ask=("Marks the prop notes the props move made as finished, so their pages stop showing a Draft badge."),
          left=("Kept those prop notes marked as drafts.")),
]

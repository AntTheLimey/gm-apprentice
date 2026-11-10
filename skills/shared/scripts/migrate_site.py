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

import install_layout
import tool_cache
from migrate_core import (CHOICE, PERSON, WILL, Check, Item,
                          StepFailed, cells, plugin_tool, stopped)
from vault_check import (check_gm_leak, configured_site,
                         _kept_by_player, vault_settings)
from vaultlib import (SettingsUnavailable,
                      forget_settings, settings,
                      settings_added, settings_add,
                      settings_file, settings_raw,
                      settings_set, settings_unset, settings_written,
                      site_switch_written, written_in_vault_file)

# --- the checks ---------------------------------------------------------------

REPIN = "site-repin"


def _pin_check(site: Path, extra: list[str]) -> dict[str, Any]:
    """`update-pin --check --json` for the site; its answer has a boolean
    `ok`. Raises StepFailed when the tool does not give one."""
    code, out, err = plugin_tool(
        ["update-pin", "--check", "--json", "--site", str(site), *extra])
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


def _door_check(site: Path) -> tuple[list[str], dict[str, Any]]:
    """(the update-pin args this door pins with, the check's answer).

    The plugin pins a site to its own cache folder, as it always has. Any
    other install, and any site already on a release tarball, pins to the
    tarball of the release named by shared/PUBLISH_VERSION, which works
    wherever the site is built."""
    layout = install_layout.LAYOUT
    if layout.door_owns_tool:
        data = _pin_check(site, [])
        if not install_layout.TARBALL_PIN.match(str(data.get("spec") or "").replace("\\", "/")):
            return [], data
    version = install_layout.publish_version(layout.shared)
    if version is None:
        raise StepFailed(
            f"shared/{install_layout.PUBLISH_STAMP} is missing or empty, so "
            "the publish tool's release is unknown. " + install_layout.INSTALL_STOP)
    tag = ["--tag", f"publish-v{version}"]
    return tag, _pin_check(site, tag)


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
    pin_args, data = _door_check(site)
    if data["ok"]:
        return []
    installed = data.get("installedBefore") or "none"

    def apply(_value: str | None) -> list[str]:
        if pin_args:
            # A tagged repin downloads the release with Node's own fetch.
            old = tool_cache.node_too_old("node")
            if old is not None:
                raise StepFailed(tool_cache.node_upgrade(old)
                                 + ", then run `gma update` again")
        code, text, err = plugin_tool(
            ["update-pin", "--site", str(site), *pin_args])
        # It may have written the site switch into the vault file.
        forget_settings(vault)
        lines = [line for line in text.splitlines() if line.strip()]
        if code != 0:
            tail = lines[-3:] or [err.strip() or f"update-pin exited {code}"]
            raise StepFailed("; ".join(tail))
        if not _pin_check(site, pin_args)["ok"]:
            by_hand = " ".join(["gma publish update-pin --site <that folder>",
                                *pin_args])
            raise StepFailed(
                f"update-pin finished but the site ({folder} in "
                f"{settings_file(vault)}) is still out of date; run "
                f"`{by_hand}` by hand to see why")
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


def _set_settings(vault: Path, pairs: list[tuple[str, object]]) -> None:
    """Every pair in one write: the tool writes them in one edit, all or none.
    A refusal stops the step with the tool's reason."""
    try:
        settings_set(vault, pairs)
    except SettingsUnavailable as e:
        if not e.refused:
            raise
        raise StepFailed(str(e)) from e


# The two lists the vault file holds in plain sight.
EXCLUDE_LISTS = ("player_site.hide.sections", "player_site.hide.fields")


def find_hide_additions(vault: Path, since: str) -> list[Item]:
    """An entry put in a built-in hide list in release `since` reaches a
    vault that owns its list only when the GM says yes: the list the vault
    owns replaces the built-in one, so without this step the entry would
    publish. One item per entry missing from a list the vault owns; none for
    a vault with no list of its own (the built-in list, which holds the
    entry, is what it uses). A site is not needed: a list the vault owns
    that lacks the entry would publish it the day a site is set up."""
    now = vault_settings(vault)
    items: list[Item] = []
    for name in EXCLUDE_LISTS:
        if now.origins[name] != "file":
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
    Check("hide-fields-voice", "1.11.2", 2, "the voice field kept off the site",
          lambda v: find_hide_additions(v, "1.11.2"), asks_site=True,
          choices=("hide-add:",),
          kind="asks",
          plain=("Added voice to the details your site hides, so the voice you keep for the campaign and its characters never shows on the site."),
          ask=("Adds voice to the details your site hides, so the voice you keep for the campaign and its characters never shows on the site."),
          left=("Kept your list of hidden details without voice, so a voice can show on your site wherever a page names that detail.")),
    Check("hide-sections-dormant", "1.12.7", 2, "the dormant threads list kept off the site",
          lambda v: find_hide_additions(v, "1.12.7"), asks_site=True,
          choices=("hide-add:",),
          kind="asks",
          plain=("Added Dormant Threads to the headings your site hides, so the threads you have parked for the GM never show on the site."),
          ask=("Adds Dormant Threads to the headings your site hides, so the threads you have parked for the GM never show on the site."),
          left=("Kept your list of hidden headings without Dormant Threads, so your parked threads can show on your site.")),
    Check("gm-leak", None, 4, "sections the site withholds are nested under "
          "GM Notes", find_gm_leak, asks_site=True,
          kind="bookkeeping",
          plain=("Moved headings the site keeps from players under GM Notes, so the notes match the site.")),
]

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
                         _kept_by_player, vault_settings)
from vaultlib import (LEGACY_SETTINGS_FILE, PublishToolUnavailable, SettingsUnavailable,
                      forget_settings, google_fonts, set_key, setting_name, settings,
                      settings_default, settings_file, settings_raw, settings_remove, settings_set,
                      settings_unset, settings_written, site_switch_written, vault_layout, written_in_vault_file, yaml_scalar)

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
    to move: the move itself holds a vault whose site's publish tool is
    pinned by something else (its answer has `held`, with the words), because
    such a tool reads a moved vault as having no settings and would publish
    with defaults. `held` is a notice that does not hold the stamp; a
    blocker does."""
    layout = vault_layout(vault)
    if layout == "none":
        return []    # no settings file: nothing names a site folder to ask
    site, has_config = configured_site(vault)
    if layout == "new" and not (
            (vault / LEGACY_SETTINGS_FILE).exists()
            or _hidden_move_files(vault) or (site is not None and has_config)):
        return []
    # The repin comes first, but only for a site it looked at: a switched-off
    # site is not looked at, so its folder's tool is still the move's to judge.
    extra: list[str] = (["--site-tool-updated"]
                        if site is not None and has_config else [])
    if layout == "legacy" and not settings(vault).get("vault.system"):
        found = vault_system(vault)
        if found:
            extra += ["--fill", f"vault.system={found}"]
    base = _move_args(vault, site, has_config, *extra)
    plan = _ask_move(vault, [*base, "--check"])
    if plan.get("held"):
        # Left behind, not wrong: the tool says why in plain words and the
        # vault is told it every pass. This does not hold the stamp.
        return [Item(MOVE, PERSON, [f"settings\t{plan.get('line')}"])]
    if not plan["ok"]:
        blockers = [str(b) for b in plan.get("blockers") or []]
        if layout == "legacy":
            cannot = "the settings cannot move to the new file yet"
            tail = "The vault is not up to date until it has moved"
        else:
            cannot = ("the site folder's settings cannot be carried into "
                      "the vault yet")
            tail = ("The vault is not up to date until the site folder's "
                    "settings are carried")
        return [Item(MOVE, PERSON,
                     [f"settings\t{cannot}: {b}" for b in blockers]
                     + ["settings\tfix what each line names, then run the "
                        "update again; for a line that names a setting, "
                        f"campaign-qa's Settings check fixes it or asks. {tail}"],
                     holds_stamp=True)]
    items: list[Item] = []
    differs = plan.get("siteDiffers")
    if differs:
        # Already moved, but the site folder's file still says things the
        # vault says differently: the Settings check fixes them. A notice, so
        # it does not hold the stamp.
        items.append(Item(MOVE + "-site-file", PERSON, [
            "vault.config.json\tstill holds settings this vault's file "
            f"decides ({', '.join(str(x) for x in differs)}); run "
            "campaign-qa's Settings check, which takes them out safely"]))
    # Left behind, not wrong: the site's installed tool is older than the one
    # that runs steps and reads the folder keys from the vault. The tool says
    # which part and in what words; neither holds the stamp.
    told: set[str] = set()
    for key, where in (("stepsHeld", "package.json (site)"),
                       ("keysHeld", "vault.config.json (site)")):
        held = plan.get(key)
        if isinstance(held, dict) and held.get("line"):
            told.add(str(held["line"]))
            items.append(Item(f"{MOVE}-{key}", PERSON,
                              [f"{where}\t{held['line']}"]))
    # A package.json step that differs from the vault's is left, and runs
    # beside the vault's under `npm run build`: told each pass, never written.
    for d in plan.get("stepsDiffer") or []:
        if isinstance(d, dict) and d.get("line"):
            told.add(str(d["line"]))
            items.append(Item(f"{MOVE}-stepsDiffer-{d.get('script')}", PERSON,
                              [f"package.json (site)\t{d['line']}"]))
    files = plan.get("files") or {}
    if not (files.get("write") or files.get("remove")):
        return items
    shows = _shows_lines(plan)

    def not_told(lines: list[Any]) -> list[str]:
        return [str(x) for x in lines if str(x) not in told]

    def apply(_value: str | None) -> list[str]:
        done = _ask_move(vault, base)
        forget_settings(vault)
        if not done["ok"]:
            raise StepFailed("; ".join(str(b) for b in done.get("blockers")
                                       or ["the move was blocked"]))
        if layout == "legacy" and vault_layout(vault) != "new":
            raise StepFailed("the move finished but the vault is not on the "
                             "new settings file")
        return [*_shows_lines(done), *not_told(done["lines"])]

    return [*items,
            Item(MOVE, WILL, [*shows, *not_told(plan["lines"])], apply)]


PUBLISH_LIST = "publish-list"
OLD_PUBLISH_LIST = "_meta/publish-manifest.md"   # dated: remove at 1.11.0


def _ask_convert(vault: Path, *extra: str) -> dict[str, Any]:
    """`manifest convert --json` for the vault, with the site's config when
    it has one (the tool judges the site: its own version, and the build
    steps that read the old file). A refused conversion exits 1 and still
    answers in JSON. Raises StepFailed when it gives none."""
    site, has_config = configured_site(vault)
    args = ["manifest", "convert", "--vault", str(vault), "--json", *extra]
    if site is not None and has_config:
        args += ["--config", str(site / "vault.config.json")]
    code, out, err = plugin_tool(args)
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("ok"), bool) \
            or not isinstance(data.get("lines"), list):
        said = [x for x in err.splitlines() if x.strip()]
        raise StepFailed("the publish list move gave no usable answer: "
                         + (said[-1].strip().removeprefix("Error: ") if said
                            else f"it exited {code}"))
    return data


def find_publish_list(vault: Path) -> list[Item]:
    """Every pass: a vault still on `_meta/publish-manifest.md` moves to
    `_meta/publish-list.yaml`, all of it by the publish tool (`manifest
    convert`), which writes the new file, reads it back, compares the three
    lists and every entry line with the old file's and only then sets the
    old one aside as `_meta/publish-manifest.md.converted`. The tool
    decides what moves and whether it should: it holds the list where it is
    (`held`, with the words) when the site's tool is older than 1.27.0 or a
    build step of the site reads the old file. A held list is left behind,
    not wrong: told every pass, and it does not hold the stamp. A list the
    tool cannot move holds it."""
    if not (vault / OLD_PUBLISH_LIST).is_file():
        return []
    site, has_config = configured_site(vault)
    # The repin comes first, so the site's tool is brought up to date before
    # this is judged (as the settings move does).
    flag = ["--site-tool-updated"] if site is not None and has_config else []
    plan = _ask_convert(vault, "--check", *flag)
    if plan.get("held"):
        return [Item(PUBLISH_LIST, PERSON,
                     [f"publish list\t{plan['lines'][0]}"])]
    if not plan["ok"]:
        return [Item(PUBLISH_LIST, PERSON,
                     [f"publish list\tthe publish list cannot move to its new "
                      f"file yet: {b}" for b in plan.get("blockers") or []]
                     + ["publish list\tfix what each line names, then run the "
                        "update again. Nothing was changed, and the old file "
                        "is still read. The vault is not up to date until it "
                        "has moved"], holds_stamp=True)]

    def apply(_value: str | None) -> list[str]:
        # Without the flag: by now the repin has run, so the site's tool is
        # judged as it is, and a repin that failed holds the list back.
        done = _ask_convert(vault)
        if done.get("held"):
            raise StepFailed(f"publish list {done['lines'][0]}")
        if not done["ok"]:
            raise StepFailed("; ".join(str(b) for b in done.get("blockers")
                                       or ["the move was blocked"]))
        if not (vault / "_meta" / "publish-list.yaml").is_file() \
                or (vault / OLD_PUBLISH_LIST).exists():
            raise StepFailed("the publish list move finished but "
                             "_meta/publish-list.yaml is not the only list")
        return [str(x) for x in done["lines"]]

    return [Item(PUBLISH_LIST, WILL, [str(x) for x in plan["lines"]], apply)]


FULL_MODE = "full-mode"
RETIRED_MODE = "player_site.hide.mode"


def _drop_mode(vault: Path) -> list[str]:
    """Remove the retired `mode` line; nothing else is written."""
    try:
        settings_unset(vault, [RETIRED_MODE])
    except SettingsUnavailable as e:
        raise StepFailed(f"nothing was changed: {e}") from e
    return [f"removed {setting_name(vault, RETIRED_MODE)} (no longer used)"]


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
    name = setting_name(vault, RETIRED_MODE)
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
    if vault_layout(vault) != "new":
        return [Item(FULL_MODE, PERSON,
                     [f"{name}\t`full` is no longer used: this vault's site "
                      "becomes a GM site once its settings have moved to the "
                      "new settings file. Run the update again after that"])]
    if not own.get("player_site.folder") and not own.get("gm_site.folder"):
        return [Item(FULL_MODE, PERSON,
                     [f"{name}\t`full` is no longer used: this vault's site "
                      "published everything, so it becomes a GM site, but no "
                      "site folder is named to put it beside. Tell me the "
                      "folder (settings set player_site.folder=<folder>), "
                      "then run the update again"], holds_stamp=True)]
    if vault_layout(vault) == "new" and any(
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


def _shows_lines(plan: dict[str, Any]) -> list[str]:
    """A value carried out of the site folder that the site did not show
    before (it was read by nothing), told on its own line."""
    out = []
    for c in plan.get("carried") or []:
        if isinstance(c, dict) and c.get("shows"):
            out.append(f"{c['shows']} becomes: {c.get('value')}")
    return out


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


POSTBUILD = ("the publish tool now adds the light/dark toggle and leaves "
             "retired PCs off the party board; if this step does either, "
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
        data = None
    scripts = data.get("scripts") if isinstance(data, dict) else None
    script = scripts.get("postbuild") if isinstance(scripts, dict) else None
    if isinstance(script, str) and script.strip():
        return [Item("postbuild", PERSON,
                     [f'package.json (site)\tbuild step "{script}": '
                      f"{POSTBUILD}"])]
    # The steps are in the vault's settings now (the move carried them).
    try:
        steps = settings(vault).get("player_site.after_build")
    except (SettingsUnavailable, KeyError):
        return []
    if not isinstance(steps, list) or not steps:
        return []
    name = setting_name(vault, "player_site.after_build")
    return [Item("postbuild", PERSON,
                 [f'{name} (settings)\tbuild steps "{" && ".join(map(str, steps))}": '
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

    # On the old file the same pass moves the settings first, so the old
    # file's name would be wrong by the time the lists are written.
    where = ("the vault's settings file" if vault_layout(vault) == "legacy"
             else settings_file(vault))
    return [Item("exclude-lists", WILL,
                 [f"write the built-in {setting_name(vault, name)} "
                  f"({', '.join(default)}) "
                  f"into {where} so you can see and edit it; "
                  f"what publishes does not change"
                  for name, default in lists], apply)]


AFTER_BUILD = "player_site.after_build"
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
    "optimize-images": (
        "the publish tool shrinks pictures to WebP itself, the same way, and "
        "keeps them between builds so a build only shrinks new pictures. "
        f"Retire it and the update turns on {OPTIMIZE} first, then removes "
        "the step; the site comes out the same"),
}


def _retired_step(command: str) -> str | None:
    """The retired step a build step runs, or None: `node` and the script's
    path, written any way the step runner reads the same file (`./`, either
    slash, quoted, extra spaces), and nothing after it."""
    m = re.fullmatch(r"\s*node\s+([\"']?)(?:[^\s\"']*[/\\])?([\w-]+)\.mjs\1\s*",
                     command)
    return m.group(2) if m and m.group(2) in RETIRED_STEPS else None


def find_retire_steps(vault: Path) -> list[Item]:
    """1.10.63: a build step the publish tool now does itself is offered for
    retiring, one choice per step. Only steps the vault's own settings file
    holds: steps still in the site folder move there first."""
    try:
        s = settings(vault)
    except SettingsUnavailable:
        return []
    steps = s.get(AFTER_BUILD)
    if s.origins.get(AFTER_BUILD) != "file" or not isinstance(steps, list):
        return []
    items: list[Item] = []
    seen: set[str] = set()
    for command in steps:
        name = _retired_step(str(command))
        if name is None or name in seen:
            continue
        seen.add(name)
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
                done.append(f"wrote {setting_name(vault, OPTIMIZE)}: true")
            try:
                removed = settings_remove(vault, AFTER_BUILD, same)
                if not removed:
                    raise StepFailed(f'the build step "{command}" was not in '
                                     f"{setting_name(vault, AFTER_BUILD)}")
            except (SettingsUnavailable, StepFailed) as e:
                if name == "optimize-images":
                    # Put the setting back as it was: the step still runs.
                    if had[0]:
                        _set_settings(vault, [(OPTIMIZE, had[1])])
                    else:
                        settings_unset(vault, [OPTIMIZE])
                raise StepFailed(str(e)) from e
            done.append(f'removed the build step "{command}" from '
                        f"{setting_name(vault, AFTER_BUILD)}")
            return done

        items.append(Item(f"retire-step:{name}", CHOICE,
                          [f'build step "{command}": {RETIRED_STEPS[name]}. '
                           f"retire: stop running it; leave: keep the step"],
                          apply, wants="retire or leave", holds_stamp=True))
    return items


SITE_CHECKS: list[Check] = [
    Check(REPIN, None, 1, "the site's publish tool", find_site_repin),
    Check(MOVE, None, 2, "the settings move to the new settings file",
          find_settings_move),
    Check(PUBLISH_LIST, None, 2, "the publish list moves to its new file",
          find_publish_list),
    Check(FULL_MODE, None, 2, "a vault that published everything becomes a "
          "GM site", find_full_mode),
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
    Check("retire-steps", "1.10.63", 3, "build steps the publish tool now "
          "does itself", find_retire_steps, choices=("retire-step:=",)),
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

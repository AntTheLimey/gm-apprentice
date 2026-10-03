#!/usr/bin/env python3
"""migrate_site.py: the migration checks that concern the vault's site.

The site's publish tool is repinned first; everything else that asks the
tool runs after it. What publishes, what the pin is and what the config
holds are the publish tool's answers, never a second reading here.
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          edit_frontmatter, plugin_tool)
from vault_check import (PUBLISH_PACKAGE, ExplainAll, ToolAnswer,
                         ask_publish_tool, check_frontmatter, check_gm_leak,
                         check_pc_body, check_sessions, configured_site,
                         publish_block_inline, site_pin)
from vaultlib import (PUBLISH_TOOL, read_publish_list, read_publish_scalar, set_key,
                      set_nested_key, site_switch, yaml_scalar)

DOES_NOT_PUBLISH = "this vault does not publish"
NOTHING_TO_DO = "nothing to do"
# The first publish tool whose `migrate-config` reports its own plan lines.
NEEDS_PUBLISH = "1.12.0"
NO_LINES = "migrate-config does not report its lines"
INLINE_PUBLISH = (
    "the publish: block in _meta/vault-config.md is written on one line "
    "({…}); write it as a block so its settings can be read")
# What the tool's note lines start with, for a tool that does not name them
# (`noteLines`); backups are never changes either.
NOTE_PREFIXES = ("left in ", "skipped ", "note ")


@dataclass
class StepPlan:
    applies: bool
    lines: list[str]        # one human line per change, or why it does not apply
    error: str | None = None
    after: tuple[str, ...] = ()  # trailing lines that are not changes (backups)
    kept_notes: tuple[str, ...] = ()  # the tool's notes: after the changes, not counted


# --- the config step ---------------------------------------------------------

def _update_pin(site: Path) -> str:
    return f"Run update-pin --site {site}, then migrate.py again."


def _tool_error(vault: Path, why: str) -> str:
    """One plain message for a tool that can't answer. The tool's own
    reason stands when the cause is the vault's files; a site whose tool
    is too old, or can't be read, says what to run instead."""
    site, has_config = configured_site(vault)
    if has_config and site is not None:
        pin = site_pin(site)
        if pin.stale and why == pin.stale:
            if pin.version is None and pin.spec is None:
                if pin.source == "package.json":
                    return f"{pin.stale}; fix or restore it, then run migrate.py again"
                return f"{pin.stale}. {_update_pin(site)}"
            if pin.version is None:
                return (f"cannot tell which publish tool the site at {site} "
                        f"uses ({pin.spec}). {_update_pin(site)}")
            return (f"the site's publish tool ({pin.version}) is older than "
                    f"this migration needs ({NEEDS_PUBLISH}). "
                    f"{_update_pin(site)}")
    if has_config and site is not None:
        script = site / "node_modules" / PUBLISH_PACKAGE / "bin" / "gm-publish.js"
        if why == f"{script} is missing":
            return f"{why}. {_update_pin(site)}"
    if why == "node is not on PATH":
        return f"{why}; install Node.js, then run migrate.py again"
    if "unknown command" in why.lower() or why == NO_LINES:
        what = "the site's publish tool" if has_config else "the publish tool"
        base = (f"{what} does not have migrate-config" if "unknown" in why.lower()
                else f"{what}'s migrate-config does not report its lines")
        base += f"; it is older than this migration needs ({NEEDS_PUBLISH}). "
        if has_config and site is not None:
            return base + _update_pin(site)
        return base + "Update the gm-apprentice plugin, then run migrate.py again."
    return why


def _backup_places(vault: Path) -> str:
    site, has_config = configured_site(vault)
    places = [str(vault / "_meta" / "vault-config.md.pre-migrate")]
    if site is not None and has_config:
        places.append(f"{site / 'vault.config.json'}.pre-migrate")
    return " and ".join(places)


def _ask(vault: Path, args: list[str]) -> tuple[dict[str, Any] | None, str | None]:
    """(the tool's answer, or why there is none). (None, None) means the
    vault has no `publish:` block."""
    answer: ToolAnswer = ask_publish_tool(vault, args, vault_only=True)
    if answer.why is not None:
        return None, _tool_error(vault, answer.why)
    if answer.data is None:
        return None, None
    data = answer.data
    if not isinstance(data, dict) or "applicable" not in data:
        return None, "migrate-config did not return the expected JSON"
    lines = data.get("lines")
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        # A tool from before the plan carried its own lines.
        return None, _tool_error(vault, NO_LINES)
    return data, None


def _config_plan(vault: Path, args: list[str]) -> tuple[StepPlan, bool]:
    """(the plan, whether it has changes)."""
    if publish_block_inline(vault):
        return StepPlan(False, [], error=INLINE_PUBLISH), False
    plan, why = _ask(vault, args)
    if why is not None:
        return StepPlan(False, [], error=why), False
    if plan is None:
        return StepPlan(False, [DOES_NOT_PUBLISH]), False
    if not plan["applicable"]:
        return StepPlan(False, [NOTHING_TO_DO]), False
    named = plan.get("noteLines")
    def is_note(x: str) -> bool:
        if isinstance(named, list) and all(isinstance(n, str) for n in named):
            return x in named
        return x.startswith(NOTE_PREFIXES)
    backups = [x for x in plan["lines"] if x.startswith("backup ")]
    kept = [x for x in plan["lines"] if not x.startswith("backup ") and is_note(x)]
    changes = [x for x in plan["lines"]
               if not x.startswith("backup ") and not is_note(x)]
    return StepPlan(True, changes, after=tuple(backups), kept_notes=tuple(kept)), True


def describe_config_to_vault(vault: Path) -> StepPlan:
    return _config_plan(vault, ["migrate-config", "--dry-run"])[0]


def apply_config_to_vault(vault: Path) -> StepPlan:
    done, _ = _config_plan(vault, ["migrate-config"])
    if done.error and ("expected JSON" in done.error
                       or "does not report its lines" in done.error):
        # The run exited 0 but said nothing usable: it may have written.
        done.error += (f"; the files may already have been changed, the "
                       f"originals are in {_backup_places(vault)}")
    if done.error or not done.applies:
        return done
    # Running it again must plan nothing; anything left is a failure.
    left, pending = _config_plan(vault, ["migrate-config", "--dry-run"])
    if left.error:
        return left
    if pending:
        return StepPlan(False, [], error=(
            "migrate-config left changes planned after applying: "
            + "; ".join(left.lines)))
    return done


# --- the checks ---------------------------------------------------------------

REPIN = "site-repin"


def find_site_repin(vault: Path) -> list[Item]:
    """The site builds with the tool installed in it, so that tool is
    brought to the plugin's before anything else asks it. `update-pin
    --check` says whether it is; this never reads the pin itself."""
    if publish_block_inline(vault):
        raise StepFailed(INLINE_PUBLISH)
    site, has_config = configured_site(vault)
    if site is None:
        if site_switch(vault) is True:
            raise StepFailed(
                "publish.site is on but publish.site_dir names no folder; "
                "set site_dir to the site folder, or set site: false")
        return []
    if not has_config:
        raise StepFailed(
            f"publish.site_dir is set to {site} but no vault.config.json is "
            f"there; correct the path, or set site: false")
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
    if data["ok"]:
        return []
    installed = data.get("installedBefore") or "none"

    def apply(_value: str | None) -> list[str]:
        code, text, err = plugin_tool(["update-pin", "--site", str(site)])
        lines = [line for line in text.splitlines() if line.strip()]
        if code != 0:
            tail = lines[-3:] or [err.strip() or f"update-pin exited {code}"]
            raise StepFailed("; ".join(tail))
        return lines

    return [Item(REPIN, WILL,
                 [f"repin the site's publish tool at {site} "
                  f"(installed: {installed})"], apply)]


def find_config_to_vault(vault: Path) -> list[Item]:
    """Every pass (since 1.10.24): campaign settings move from the site's
    vault.config.json into the vault file, whenever the site file still
    holds any. The publish tool plans and does it."""
    if configured_site(vault)[0] is None and (
            shutil.which("node") is None or not PUBLISH_TOOL.is_file()):
        # No site to move settings from, and no tool to ask (no Node, or a
        # skill-zip install without it): a vault that only keeps notes is
        # never stopped for the publish tool.
        return []
    plan = describe_config_to_vault(vault)
    if plan.error:
        raise StepFailed(plan.error)
    if not plan.applies:
        return []

    def apply(_value: str | None) -> list[str]:
        done = apply_config_to_vault(vault)
        if done.error:
            raise StepFailed(done.error)
        return [*done.lines, *done.kept_notes, *done.after]

    return [Item("config-to-vault", WILL, plan.lines, apply)]


def find_publish_site(vault: Path) -> list[Item]:
    """`publish.site` says whether the vault has a site. Written where it
    is missing: true with a site_dir, else false. A vault file with no
    `publish:` block has no site and gets nothing."""
    if (publish_block_inline(vault)
            or read_publish_list(vault, "exclude_sections").publish_line is None
            or site_switch(vault) is not None):
        return []
    has_dir = bool(read_publish_scalar(vault, "site_dir"))
    value = "true" if has_dir else "false"
    row = (f"write publish.site: {value} in _meta/vault-config.md" if has_dir
           else "write publish.site: false in _meta/vault-config.md (no site "
                "folder is named; if this vault has a site, set "
                "publish.site_dir to its folder instead)")

    def apply(_value: str | None) -> list[str]:
        edit_frontmatter(
            vault / "_meta" / "vault-config.md",
            lambda fm, eol: set_nested_key(fm, "publish", "site", value, eol))
        return [f"wrote publish.site: {value}"]

    return [Item("publish-site", WILL, [row], apply)]


def _cells(row: str) -> tuple[str, str, str]:
    level, _, rest = row.partition("\t")
    where, _, message = rest.partition("\t")
    return level, where, message


def _stopped(rows: list[tuple[str, str, str]]) -> None:
    """A check that could not ask the tool says so in an ERROR on the
    vault; what it found before that is not the whole answer."""
    for level, where, message in rows:
        if level == "ERROR" and where == "(vault)":
            raise StepFailed(message)


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
    rows = [_cells(r) for r in check_gm_leak(vault, None, fix=False)]
    _stopped(rows)
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
            fixed = [_cells(r) for r in check_gm_leak(vault, None, fix=True)]
            _stopped(fixed)
            again = [_cells(r) for r in check_gm_leak(vault, None, fix=False)]
            _stopped(again)
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


def _person_rows(rows: list[str], marker: str) -> list[str]:
    out = []
    for row in rows:
        _level, where, message = _cells(row)
        if marker in message:
            out.append(f"{where}\t{message}")
    return out


def find_session_recaps(vault: Path) -> list[Item]:
    """1.10.18: a session index whose body the site now withholds."""
    rows = _person_rows(check_sessions(vault), "session index body has")
    return [Item("session-recaps", PERSON, rows)] if rows else []


def find_unparseable(vault: Path) -> list[Item]:
    """1.10.23: notes whose frontmatter the build cannot parse."""
    rows = _person_rows(check_frontmatter(vault, None, ExplainAll(vault)),
                        "cannot parse this frontmatter")
    return [Item("unparseable-notes", PERSON, rows)] if rows else []


# The remedy both "no usable Stat Sheet" warnings in vault_check's pc-body
# end with; the warning about retired frontmatter fields names the heading
# too but not this, so it is not a sheet problem.
NO_SHEET = "set sheet_source to where the sheet is kept"


def find_sheet_source(vault: Path) -> list[Item]:
    """1.10.22: a PC that publishes with no usable sheet. If the sheet is
    kept elsewhere the GM says where, and it is written to sheet_source."""
    rows = [_cells(r) for r in check_pc_body(vault)]
    _stopped(rows)
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
            scalar = yaml_scalar(value or "")
            edit_frontmatter(
                vault / rel,
                lambda fm, eol: set_key(fm, "sheet_source", scalar, eol))
            return [f"wrote sheet_source: {scalar} to {rel}"]

        items.append(Item(f"sheet-source:{rel}", CHOICE,
                          [f"{message}; if the sheet is kept elsewhere, say "
                           f"where"], apply, wants="where the sheet is kept"))
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
                 [f'{site / "package.json"}\tpostbuild script "{script}": '
                  f"{POSTBUILD}"])]


def _theme_facts(vault: Path) -> dict[str, Any] | None:
    """What the site's tool says about the theme, or None with no site."""
    if configured_site(vault)[0] is None:
        return None
    answer = ask_publish_tool(vault, ["vault-setting"])
    if answer.why is not None:
        raise StepFailed(answer.why)
    return answer.data if isinstance(answer.data, dict) else None


def _set_setting(vault: Path, key: str, value: object) -> None:
    answer = ask_publish_tool(
        vault, ["vault-setting", "--set", f"{key}={json.dumps(value)}"])
    if answer.why is not None:
        raise StepFailed(answer.why)


def find_default_mode(vault: Path) -> list[Item]:
    """1.10.16: the site has a light/dark toggle. A site designed for one
    palette can start every reader there."""
    facts = _theme_facts(vault)
    if not facts or facts.get("defaultModeSet") is not False:
        return []

    def apply(value: str | None) -> list[str]:
        if value not in ("dark", "light"):
            raise StepFailed("default-mode takes dark or light")
        _set_setting(vault, "theme.default_mode", value)
        return [f"wrote publish.theme.default_mode: {value}"]

    return [Item("default-mode", CHOICE,
                 ["start every reader on one palette (unset follows the "
                  "reader's device, as before)"], apply, wants="dark or light")]


def find_fonts(vault: Path) -> list[Item]:
    """1.10.17: fonts loaded from Google send each reader's IP address to
    Google. Self-hosting serves the same fonts from the site."""
    facts = _theme_facts(vault)
    names = facts.get("googleFonts") if facts else None
    if not isinstance(names, list) or not names:
        return []

    def apply(_value: str | None) -> list[str]:
        _set_setting(vault, "theme.fonts.source", "self-host")
        return ["wrote publish.theme.fonts.source: self-host; the next build "
                "downloads the fonts once and serves them from the site"]

    return [Item("fonts-self-host", CHOICE,
                 [f"serve {', '.join(str(n) for n in names)} from the site "
                  f"instead of Google Fonts, which sees each reader's IP "
                  f"address; the look does not change"], apply)]


SITE_CHECKS: list[Check] = [
    Check(REPIN, None, 1, "the site's publish tool", find_site_repin),
    Check("config-to-vault", None, 2,
          "campaign settings move into the vault file", find_config_to_vault,
          asks_site=True),
    Check("publish-site", None, 2, "the publish.site switch",
          find_publish_site),
    Check("default-mode", "1.10.16", 2, "a default palette", find_default_mode,
          asks_site=True, choices=("default-mode=",)),
    Check("fonts-self-host", "1.10.17", 2, "fonts served from the site",
          find_fonts, asks_site=True, choices=("fonts-self-host",)),
    Check("postbuild", "1.10.17", 3, "the site's postbuild script",
          find_postbuild),
    Check("publish-played", "1.10.18", 4, "played sessions are registered",
          find_publish_played, asks_site=True, choices=("played:",)),
    Check("session-recaps", "1.10.18", 4, "recaps kept in session indexes",
          find_session_recaps, asks_site=True),
    Check("sheet-source", "1.10.22", 4, "PCs with no character sheet",
          find_sheet_source, asks_site=True, choices=("sheet-source:=",)),
    Check("unparseable-notes", "1.10.23", 4,
          "notes the build cannot parse", find_unparseable, asks_site=True),
    Check("gm-leak", None, 4, "sections the site withholds are nested under "
          "GM Notes", find_gm_leak, asks_site=True),
]

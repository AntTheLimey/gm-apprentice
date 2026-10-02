#!/usr/bin/env python3
"""migrate_site.py: the migration checks that concern the vault's site.

The site's publish tool is repinned first; everything else that asks the
tool runs after it. What publishes, what the pin is and what the config
holds are the publish tool's answers, never a second reading here.
"""

from __future__ import annotations

import json
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
from vaultlib import (read_publish_list, read_publish_scalar, set_key,
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
    """1.10.24: campaign settings move from the site's vault.config.json
    into the vault file. The publish tool plans and does it."""
    if configured_site(vault)[0] is None and shutil.which("node") is None:
        # No site to move settings from, and no Node to ask: a vault that
        # only keeps notes is never stopped for the publish tool.
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
    value = "true" if read_publish_scalar(vault, "site_dir") else "false"

    def apply(_value: str | None) -> list[str]:
        edit_frontmatter(
            vault / "_meta" / "vault-config.md",
            lambda fm, eol: set_nested_key(fm, "publish", "site", value, eol))
        return [f"wrote publish.site: {value}"]

    return [Item("publish-site", WILL,
                 [f"write publish.site: {value} in _meta/vault-config.md"],
                 apply)]


SITE_CHECKS: list[Check] = [
    Check(REPIN, None, 1, "the site's publish tool", find_site_repin),
    Check("config-to-vault", "1.10.24", 2,
          "campaign settings move into the vault file", find_config_to_vault,
          asks_site=True),
    Check("publish-site", None, 2, "the publish.site switch",
          find_publish_site),
]

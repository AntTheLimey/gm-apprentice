#!/usr/bin/env python3
"""migrate.py — run the vault's coded migrations, in version order.

    migrate.py VAULT [--status | --dry-run]

Each step belongs to a plugin version and has two halves: `describe` (what
would change, writing nothing) and `apply` (do it, report what changed).
Output has the shape vault_check's `emit` prints: `## <version> <name>`,
`# count: N`, then one row per line.

  --status    which steps are pending. A step is pending when its dry run
              says it has changes; there is no state file to drift.
  --dry-run   the planned changes of every step; nothing is written.
  (neither)   apply every step in version order; a step that fails stops
              the run and later steps do not run.

Exit: 0 done or nothing to do; 1 a step failed; 2 bad arguments.

The config step moves campaign settings into `_meta/vault-config.md`. The
publish tool does that (`migrate-config`) and is the only reader of those
keys; this script asks it and renders its plan, and never parses a publish
setting itself.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from vault_check import (ToolAnswer, ask_publish_tool, configured_site,
                         parse_semver, site_pin)

DOES_NOT_PUBLISH = "this vault does not publish"
NOTHING_TO_DO = "nothing to do"
# The first publish tool whose `migrate-config` reports its own plan lines.
NEEDS_PUBLISH = "1.12.0"
NO_LINES = "migrate-config does not report its lines"
SITE_DIR_UNSET = (
    "publish.site_dir is not set; site settings were not looked at. Set it "
    "to your site folder and run migrate.py again, or run "
    "`gm-apprentice-publish migrate-config --config <site>/vault.config.json` "
    "from the site.")


@dataclass
class StepPlan:
    applies: bool
    lines: list[str]        # one human line per change, or why it does not apply
    error: str | None = None
    notes: int = 0          # how many leading lines are warnings, not changes
    after: tuple[str, ...] = ()  # trailing lines that are not changes (backups)


@dataclass(frozen=True)
class Step:
    version: str            # the plugin version the step belongs to
    name: str
    describe: Callable[[Path], StepPlan]
    apply: Callable[[Path], StepPlan]


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
            if pin.version is None:
                return (f"cannot tell which publish tool the site at {site} "
                        f"uses ({pin.spec or 'no readable version'}). "
                        f"{_update_pin(site)}")
            return (f"the site's publish tool ({pin.version}) is older than "
                    f"this migration needs ({NEEDS_PUBLISH}). "
                    f"{_update_pin(site)}")
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


def _site_note(vault: Path) -> str:
    """The line for a site the tool did not look at: `publish.site_dir`
    unset, or set to a folder with no vault.config.json. The tool then
    only looks at the vault file, and saying so keeps a missing or
    mistyped path from reading as "nothing to move". Empty when the site
    was looked at."""
    site, has_config = configured_site(vault)
    if site is None:
        return SITE_DIR_UNSET
    if not has_config:
        return (f"publish.site_dir is set to {site} but no vault.config.json "
                f"is there; site settings were not looked at")
    return ""


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
    plan, why = _ask(vault, args)
    if why is not None:
        return StepPlan(False, [], error=why), False
    note = _site_note(vault)
    if plan is None:
        return StepPlan(False, [DOES_NOT_PUBLISH]), False
    notes = [note] if note else []
    if not plan["applicable"]:
        return StepPlan(False, [*notes, NOTHING_TO_DO]), False
    changes = [x for x in plan["lines"] if not x.startswith("backup ")]
    backups = [x for x in plan["lines"] if x.startswith("backup ")]
    return StepPlan(True, [*notes, *changes], notes=len(notes),
                    after=tuple(backups)), True


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


STEPS: list[Step] = [
    Step("1.10.24", "config-to-vault",
         describe_config_to_vault, apply_config_to_vault),
]


# --- the runner --------------------------------------------------------------

def _version_key(step: Step) -> tuple[int, int, int]:
    parsed = parse_semver(step.version)
    if parsed is None:
        raise ValueError(f"step {step.name} has no semver version: {step.version}")
    return parsed[0]


def run(vault: Path, mode: str, steps: list[Step] | None = None) -> int:
    """Run `steps` (default STEPS) in version order. `mode` is "apply",
    "dry-run" or "status". Returns the exit code."""
    chosen = STEPS if steps is None else steps
    for step in sorted(chosen, key=_version_key):
        plan = (step.apply if mode == "apply" else step.describe)(vault)
        label = f"{step.version} {step.name}"
        if plan.error:
            print(f"migrate.py: {label}: {plan.error}", file=sys.stderr)
            return 1
        count = len(plan.lines) - plan.notes if plan.applies else 0
        if mode == "status":
            rows = ([f"pending: {count} change(s)", *plan.lines[:plan.notes]]
                    if plan.applies else
                    [f"done: {plan.lines[-1] if plan.lines else NOTHING_TO_DO}",
                     *plan.lines[:-1]])
        else:
            rows = [*(plan.lines or [NOTHING_TO_DO]), *plan.after]
        print(f"## {label}")
        print(f"# count: {count}")
        for row in rows:
            print(row)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="migrate.py", description="Run the vault's coded migrations.")
    ap.add_argument("vault")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--status", action="store_true",
                       help="show which steps are pending")
    group.add_argument("--dry-run", action="store_true",
                       help="show what would change; write nothing")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    vault = Path(args.vault).expanduser()
    if not vault.is_dir():
        print(f"migrate.py: not a directory: {vault}", file=sys.stderr)
        return 2
    mode = "status" if args.status else "dry-run" if args.dry_run else "apply"
    return run(vault, mode)


if __name__ == "__main__":
    sys.exit(main())

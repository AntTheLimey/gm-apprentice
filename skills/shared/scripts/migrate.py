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

from vault_check import ToolAnswer, _site_config, ask_publish_tool, parse_semver

DOES_NOT_PUBLISH = "this vault does not publish"
NOTHING_TO_DO = "nothing to do"
UPDATE_PIN_HINT = "run update-pin, then migrate.py again"


@dataclass
class StepPlan:
    applies: bool
    lines: list[str]        # one human line per change, or why it does not apply
    error: str | None = None
    notes: int = 0          # how many leading lines are warnings, not changes


@dataclass(frozen=True)
class Step:
    version: str            # the plugin version the step belongs to
    name: str
    describe: Callable[[Path], StepPlan]
    apply: Callable[[Path], StepPlan]


# --- the config step ---------------------------------------------------------

def _tool_error(why: str) -> str:
    """The tool's reason, plus the way out when the cause is the tool
    itself (no node, a pin that is too old or lacks the command). A
    refusal about the vault's own files gets no such hint."""
    if " exited " in why and "unknown command" not in why.lower():
        return why
    return f"{why}; {UPDATE_PIN_HINT}"


def _site_note(vault: Path) -> str | None:
    """The line for a `publish.site_dir` that is set but has no
    vault.config.json: the tool then only looks at the vault file, and
    saying so keeps a mistyped path from reading as "nothing to move"."""
    config, why = _site_config(vault)
    if config is not None or not why or not why.startswith("no vault.config.json"):
        return None
    path = why[why.index("(") + 1:why.rindex(")")]
    return (f"publish.site_dir is set to {path} but no vault.config.json is "
            f"there; site settings were not looked at")


def _backup_places(vault: Path) -> str:
    config, _why = _site_config(vault)
    places = [str(vault / "_meta" / "vault-config.md.pre-migrate")]
    if config is not None:
        places.append(f"{config}.pre-migrate")
    return " and ".join(places)


def _ask(vault: Path, args: list[str]) -> tuple[dict[str, Any] | None, str | None]:
    """(the tool's answer, or why there is none). (None, None) means the
    vault has no `publish:` block."""
    answer: ToolAnswer = ask_publish_tool(vault, args, vault_only=True)
    if answer.why is not None:
        return None, _tool_error(answer.why)
    if answer.data is None:
        return None, None
    data = answer.data
    if not isinstance(data, dict) or "applicable" not in data:
        return None, "migrate-config did not return the expected JSON"
    lines = data.get("lines")
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        # A tool from before the plan carried its own lines.
        return None, _tool_error("this publish tool's migrate-config does not "
                                 "report its lines")
    return data, None


def _config_plan(vault: Path, args: list[str]) -> tuple[StepPlan, bool]:
    """(the plan, whether it has changes)."""
    plan, why = _ask(vault, args)
    if why is not None:
        return StepPlan(False, [], error=why), False
    note = _site_note(vault)
    notes = [note] if note else []
    if plan is None:
        return StepPlan(False, [DOES_NOT_PUBLISH]), False
    if not plan["applicable"]:
        return StepPlan(False, [*notes, NOTHING_TO_DO]), False
    return StepPlan(True, [*notes, *plan["lines"]], notes=len(notes)), True


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
            rows = plan.lines or [NOTHING_TO_DO]
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

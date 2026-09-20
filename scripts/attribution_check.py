#!/usr/bin/env python3
"""Attribution compliance check for skills/ttrpg-expert/systems/ (CI).

CLAUDE.md names copyright compliance the repo's highest-priority rule. Until
this script, nothing enforced it mechanically: four files carrying licensed
mechanics shipped with no notice at all (fixed in Slice 0, PR #193).

The skill zips ship the systems/ files without ATTRIBUTION.md, and CC-BY 3.0
and the ORC License attach per work, so every distributed file has to carry
its own system's notice. This check fails when:

  * a distributed file under systems/<system>/ is missing that system's
    notice, or carries it in the wrong place (GURPS opens with it, FitD
    closes with it, as ATTRIBUTION.md promises);
  * a non-markdown file ships under a system directory (the zips include
    every file, and only .md files are checked for a notice), or a file
    sits directly under systems/ without being on ROOT_EXEMPT;
  * a systems/<dir>/ exists with no rule here (a new licensed source needs a
    notice rule and an ATTRIBUTION.md section before any content lands);
  * ATTRIBUTION.md has no section for a system that has a rule;
  * a file under a personal/ directory is tracked by git, or a system's
    personal/ directory is not gitignored (CLAUDE.md hard rule 5);
  * with --base REF: a PR adds a licensed file without touching
    ATTRIBUTION.md (CLAUDE.md hard rule 3).

`generic/` carries no licensed content and is exempt. personal/ working
copies are never distributed and are never scanned.

Run: python3 scripts/attribution_check.py [--base origin/main]
Exit 0 clean, 1 on any finding.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SYSTEMS_REL = Path("skills/ttrpg-expert/systems")
ATTRIBUTION_REL = Path("ATTRIBUTION.md")
EXEMPT = {"generic"}
# Files directly under systems/ that carry no licensed content.
ROOT_EXEMPT = {"shared-patterns.md"}
HEAD_LINES = 20  # "opens with the notice"
TAIL_LINES = 12  # "closing paragraph"


@dataclass(frozen=True)
class Rule:
    # Every pattern must match (all_of), or at least one (any_of).
    all_of: tuple[str, ...] = ()
    any_of: tuple[str, ...] = ()
    where: str = "any"  # any | head | tail
    # Text that must appear in ATTRIBUTION.md for this system.
    attribution_marker: str = ""
    # Human summary for error messages.
    describe: str = ""


RULES: dict[str, Rule] = {
    "dnd-5e-2024": Rule(
        all_of=(
            r"SRD 5\.2",
            r"creativecommons\.org/licenses/by/4\.0",
            r"dndbeyond\.com/srd",
        ),
        attribution_marker="System Reference Document 5.2",
        describe="the SRD 5.2 CC-BY 4.0 notice with both URIs",
    ),
    "fitd": Rule(
        all_of=(
            r"bladesinthedark\.com",
            r"creativecommons\.org/licenses/by/3\.0",
            r"John Harper",
        ),
        where="tail",
        attribution_marker="Blades in the Dark",
        describe="the Blades in the Dark CC-BY 3.0 line as the closing paragraph",
    ),
    "pf2e": Rule(
        all_of=(r"ORC License", r"paizo\.com/orclicense", r"Paizo Inc"),
        attribution_marker="Pathfinder Second Edition",
        describe="the Paizo ORC notice",
    ),
    "gurps-4e": Rule(
        all_of=(
            r"Steve Jackson Games",
            r"sjgames\.com/general/online_policy",
        ),
        where="head",
        attribution_marker="## GURPS",
        describe="the SJG Online Policy notice as an opening blockquote",
    ),
    # CoC files carry one of several notice forms depending on what they
    # contain: BRP/ORC (mechanics), public domain (Lovecraft), or the
    # own-description note (character sheet, Regency Cthulhu overlays).
    "coc-7e": Rule(
        any_of=(
            r"ORC License",
            r"public domain",
            r"Baker v\. Selden",
            r"uncopyrightable",
        ),
        attribution_marker="Basic Roleplaying",
        describe="a BRP/ORC, public-domain, or own-description notice",
    ),
}


@dataclass(frozen=True)
class Finding:
    path: str
    message: str

    def __str__(self) -> str:
        return f"ERROR {self.path}: {self.message}"


def distributed_files(system_dir: Path) -> list[Path]:
    """Every .md under a system dir except personal/ working copies."""
    return sorted(
        p
        for p in system_dir.rglob("*.md")
        if "personal" not in p.relative_to(system_dir).parts
    )


def unexpected_files(base: Path, repo: Path, *, root: bool) -> list[Finding]:
    """Shipped files the notice check cannot see.

    Under a system dir: anything that is not markdown. Directly under
    systems/: anything not on ROOT_EXEMPT. Only .DS_Store is ignored, because
    build-skill-zips.sh is the only other thing that excludes files.
    """
    out: list[Finding] = []
    for p in sorted(base.rglob("*") if not root else base.iterdir()):
        rel = p.relative_to(base)
        if not p.is_file() or "personal" in rel.parts or p.name == ".DS_Store":
            continue
        if root:
            if p.name not in ROOT_EXEMPT:
                out.append(
                    Finding(
                        str(p.relative_to(repo)),
                        "file sits directly under systems/ with no notice rule — "
                        "move it into a system directory or add it to ROOT_EXEMPT "
                        "if it carries no licensed content",
                    )
                )
        elif p.suffix != ".md":
            out.append(
                Finding(
                    str(p.relative_to(repo)),
                    "non-markdown file ships in the skill zip but is not covered "
                    "by the notice check — convert it to markdown with the notice",
                )
            )
    return out


def _region(text: str, where: str) -> str:
    lines = text.splitlines()
    if where == "head":
        return "\n".join(lines[:HEAD_LINES])
    if where == "tail":
        body = [ln for ln in lines if ln.strip()]
        return "\n".join(body[-TAIL_LINES:])
    return text


def check_file(path: Path, rule: Rule, rel: str) -> list[Finding]:
    text = path.read_text(encoding="utf-8", errors="replace")
    region = _region(text, rule.where)
    ok = all(re.search(p, region, re.I) for p in rule.all_of) if rule.all_of else True
    if rule.any_of:
        ok = ok and any(re.search(p, region, re.I) for p in rule.any_of)
    if ok:
        return []
    place = {
        "head": f" in the first {HEAD_LINES} lines",
        "tail": f" in the last {TAIL_LINES} non-empty lines",
    }.get(rule.where, "")
    # Distinguish "absent" from "present but misplaced" — different fixes.
    anywhere = all(re.search(p, text, re.I) for p in rule.all_of) and (
        not rule.any_of or any(re.search(p, text, re.I) for p in rule.any_of)
    )
    if rule.where != "any" and anywhere:
        return [Finding(rel, f"notice is present but not{place}; expected {rule.describe}")]
    return [Finding(rel, f"missing {rule.describe}")]


def check_systems(repo: Path) -> list[Finding]:
    findings: list[Finding] = []
    systems = repo / SYSTEMS_REL
    attribution = (repo / ATTRIBUTION_REL).read_text(encoding="utf-8")
    findings += unexpected_files(systems, repo, root=True)
    for system_dir in sorted(p for p in systems.iterdir() if p.is_dir()):
        name = system_dir.name
        # generic/ carries no licensed content, so there is no notice for a
        # stray file there to be missing.
        if name in EXEMPT:
            continue
        rule = RULES.get(name)
        rel_dir = f"{SYSTEMS_REL}/{name}"
        if rule is None:
            findings.append(
                Finding(
                    rel_dir,
                    "no notice rule for this system — add one to "
                    "scripts/attribution_check.py and a section to ATTRIBUTION.md "
                    "before adding content",
                )
            )
            continue
        if rule.attribution_marker not in attribution:
            findings.append(
                Finding(
                    str(ATTRIBUTION_REL),
                    f"no section for {name} (expected to find "
                    f"{rule.attribution_marker!r})",
                )
            )
        findings += unexpected_files(system_dir, repo, root=False)
        for f in distributed_files(system_dir):
            findings += check_file(f, rule, str(f.relative_to(repo)))
    return findings


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=False
    )


def check_personal(repo: Path) -> list[Finding]:
    """personal/ working copies must be untracked and gitignored."""
    findings: list[Finding] = []
    tracked = _git(repo, "ls-files", "--", str(SYSTEMS_REL))
    if tracked.returncode != 0:
        return [Finding("git", f"git ls-files failed: {tracked.stderr.strip()}")]
    for line in tracked.stdout.splitlines():
        if "/personal/" in line:
            findings.append(Finding(line, "personal/ file is tracked by git"))
    for system_dir in sorted((repo / SYSTEMS_REL).iterdir()):
        if not system_dir.is_dir() or system_dir.name in EXEMPT:
            continue
        probe = f"{SYSTEMS_REL}/{system_dir.name}/personal/probe.md"
        if _git(repo, "check-ignore", "-q", probe).returncode != 0:
            findings.append(
                Finding(
                    f"{SYSTEMS_REL}/{system_dir.name}/personal/",
                    "not gitignored — add it to .gitignore",
                )
            )
    return findings


def check_added_files(repo: Path, base: str) -> list[Finding]:
    """A PR that adds licensed content must update ATTRIBUTION.md."""
    diff = _git(repo, "diff", "--name-status", f"{base}...HEAD")
    if diff.returncode != 0:
        return [Finding("git", f"git diff against {base} failed: {diff.stderr.strip()}")]
    added: list[str] = []
    touched: set[str] = set()
    for line in diff.stdout.splitlines():
        status, _, rest = line.partition("\t")
        for path in rest.split("\t"):
            touched.add(path)
        if status.startswith(("A", "R", "C")):
            path = rest.split("\t")[-1]
            parts = Path(path).parts
            sys_parts = SYSTEMS_REL.parts
            if (
                parts[: len(sys_parts)] == sys_parts
                and len(parts) > len(sys_parts) + 1
                and parts[len(sys_parts)] not in EXEMPT
                and "personal" not in parts
                and path.endswith(".md")
            ):
                added.append(path)
    if added and str(ATTRIBUTION_REL) not in touched:
        listing = ", ".join(added[:5]) + (" …" if len(added) > 5 else "")
        return [
            Finding(
                str(ATTRIBUTION_REL),
                f"not updated, but this change adds licensed-system files "
                f"({listing}); record source, license and transformation",
            )
        ]
    return []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", type=Path, default=REPO, help="repository root")
    ap.add_argument(
        "--base",
        help="git ref to diff against (e.g. origin/main); enables the "
        "ATTRIBUTION.md-updated-with-new-files check",
    )
    args = ap.parse_args(argv)

    findings = check_systems(args.repo) + check_personal(args.repo)
    if args.base:
        findings += check_added_files(args.repo, args.base)

    for f in findings:
        print(f)
    if findings:
        print(f"\n{len(findings)} attribution finding(s).", file=sys.stderr)
        return 1
    print("attribution_check: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

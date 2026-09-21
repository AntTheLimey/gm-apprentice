#!/usr/bin/env python3
"""Attribution compliance check for skills/ttrpg-expert/systems/ (CI).

CLAUDE.md names copyright compliance the repo's highest-priority rule. Until
this script, nothing enforced it mechanically: four files carrying licensed
mechanics shipped with no notice at all (fixed in Slice 0, PR #193).

The skill zips ship the systems/ files without ATTRIBUTION.md, so each system
directory carries its own notice in a NOTICE.md that ships with it. One notice
per system, not one per file: CC-BY 3.0 asks for attribution "reasonable to
the medium or means", and the ORC License says the same, neither per file.
Repeating the notice in every file cost about 90 tokens per file read.

This check fails when:

  * a system directory has no NOTICE.md, or its NOTICE.md lacks what that
    system's licence requires (the CC-BY attribution with its URIs, the ORC
    notice, the SJG Online Policy notice, ...). Text inside an HTML comment,
    a code fence or a heading does not count: it is not a notice a reader
    sees;
  * Call of Cthulhu's NOTICE.md does not list every file in the directory
    (it records what each file derives from, and is the only place that
    provenance lives) or lists one that does not exist;
  * a systems/<dir>/ exists with no rule here (a new licensed source needs a
    rule and an ATTRIBUTION.md section before any content lands);
  * ATTRIBUTION.md has no section for a system that has a rule;
  * a non-markdown file ships under a system directory (the zips include
    every file, and the other checks only read markdown), or a file sits
    directly under systems/ without being on ROOT_EXEMPT;
  * a file under a personal/ directory is tracked by git, or a system's
    personal/ directory is not gitignored (CLAUDE.md hard rule 5);
  * with --base REF: a PR adds a licensed file without touching
    ATTRIBUTION.md (CLAUDE.md hard rule 3);
  * with --zips DIR: the ttrpg-expert zip lacks a system's NOTICE.md, or
    contains anything from a personal/ directory.

`generic/` carries no licensed content and is exempt. personal/ working
copies are never distributed and are never scanned.

Run: python3 scripts/attribution_check.py [--base origin/main] [--zips dist]
Exit 0 clean, 1 on any finding.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SYSTEMS_REL = Path("skills/ttrpg-expert/systems")
ATTRIBUTION_REL = Path("ATTRIBUTION.md")
NOTICE_NAME = "NOTICE.md"
ZIP_NAME = "ttrpg-expert.zip"
EXEMPT = {"generic"}
# Files directly under systems/ that carry no licensed content.
ROOT_EXEMPT = {"shared-patterns.md"}


@dataclass(frozen=True)
class Rule:
    # Every pattern must appear in the system's NOTICE.md.
    all_of: tuple[str, ...]
    # Text that must appear in ATTRIBUTION.md for this system.
    attribution_marker: str
    # Human summary for error messages.
    describe: str
    # NOTICE.md must carry a "### `path`" entry for every file in the system.
    per_file_index: bool = False


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
        attribution_marker="Blades in the Dark",
        describe="the Blades in the Dark CC-BY 3.0 attribution",
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
        attribution_marker="## GURPS",
        describe="the SJG Online Policy notice",
    ),
    # CoC files derive from BRP (ORC), Lovecraft (public domain) or are our
    # own descriptions of mechanics; the notice records which is which.
    "coc-7e": Rule(
        all_of=(
            r"ORC License",
            r"public domain",
            r"Baker v\. Selden",
            r"uncopyrightable",
        ),
        attribution_marker="Basic Roleplaying",
        describe="the BRP/ORC, public-domain and own-description notices",
        per_file_index=True,
    ),
}


@dataclass(frozen=True)
class Finding:
    path: str
    message: str

    def __str__(self) -> str:
        return f"ERROR {self.path}: {self.message}"


def unexpected_files(base: Path, repo: Path, *, root: bool) -> list[Finding]:
    """Shipped files the other checks cannot see.

    Under a system dir: anything that is not markdown. Directly under
    systems/: anything not on ROOT_EXEMPT. Only .DS_Store is ignored,
    because build-skill-zips.sh is the only other thing that excludes files.
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
                    "by the content checks — convert it to markdown",
                )
            )
    return out


def _visible_text(text: str) -> str:
    """Notice text a reader actually sees: no HTML comments, code fences or headings."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    out: list[str] = []
    fence = ""
    for line in text.splitlines():
        marker = line.lstrip()[:3]
        if fence:
            if marker == fence:
                fence = ""
            continue
        if marker in ("```", "~~~"):
            fence = marker
            continue
        if re.match(r"\s{0,3}#{1,6}\s", line):
            continue
        out.append(line)
    return "\n".join(out)


def _indexed_files(system_dir: Path) -> set[str]:
    return {
        p.relative_to(system_dir).as_posix()
        for p in system_dir.rglob("*.md")
        if p.name != NOTICE_NAME and "personal" not in p.relative_to(system_dir).parts
    }


def check_notice(system_dir: Path, rule: Rule, repo: Path) -> list[Finding]:
    notice = system_dir / NOTICE_NAME
    rel = str(notice.relative_to(repo))
    if not notice.is_file():
        return [Finding(rel, f"missing — every system ships a notice ({rule.describe})")]
    raw = notice.read_text(encoding="utf-8", errors="replace")
    findings: list[Finding] = []
    visible = _visible_text(raw)
    missing = [p for p in rule.all_of if not re.search(p, visible, re.I)]
    if missing:
        findings.append(
            Finding(
                rel,
                f"does not contain {rule.describe} outside comments, code fences "
                f"and headings (no match for {', '.join(missing)})",
            )
        )
    if rule.per_file_index:
        listed = set(re.findall(r"^###\s+`([^`]+)`", raw, re.M))
        actual = _indexed_files(system_dir)
        for name in sorted(actual - listed):
            findings.append(
                Finding(rel, f"has no provenance entry for {name} — add a "
                        f"### `{name}` section saying what it derives from")
            )
        for name in sorted(listed - actual):
            findings.append(Finding(rel, f"lists {name}, which does not exist"))
    return findings


def check_systems(repo: Path) -> list[Finding]:
    findings: list[Finding] = []
    systems = repo / SYSTEMS_REL
    attribution = (repo / ATTRIBUTION_REL).read_text(encoding="utf-8")
    findings += unexpected_files(systems, repo, root=True)
    for system_dir in sorted(p for p in systems.iterdir() if p.is_dir()):
        name = system_dir.name
        # generic/ carries no licensed content, so there is nothing to notice.
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
        findings += check_notice(system_dir, rule, repo)
        findings += unexpected_files(system_dir, repo, root=False)
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
                and parts[-1] != NOTICE_NAME
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


def check_zips(zips: Path) -> list[Finding]:
    """The built ttrpg-expert zip must ship every NOTICE.md and no personal/ file."""
    zpath = zips / ZIP_NAME
    if not zpath.is_file():
        return [Finding(str(zpath), "zip not found — run scripts/build-skill-zips.sh first")]
    with zipfile.ZipFile(zpath) as z:
        names = set(z.namelist())
    findings: list[Finding] = []
    for system in sorted(RULES):
        entry = f"systems/{system}/{NOTICE_NAME}"
        if entry not in names:
            findings.append(Finding(str(zpath), f"does not contain {entry}"))
    for name in sorted(names):
        if "/personal/" in name or name.startswith("personal/"):
            findings.append(Finding(str(zpath), f"ships a personal/ file: {name}"))
    return findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", type=Path, default=REPO, help="repository root")
    ap.add_argument(
        "--base",
        help="git ref to diff against (e.g. origin/main); enables the "
        "ATTRIBUTION.md-updated-with-new-files check",
    )
    ap.add_argument(
        "--zips",
        type=Path,
        help="directory of built skill zips; checks the ttrpg-expert zip ships "
        "every NOTICE.md and nothing from personal/",
    )
    args = ap.parse_args(argv)

    findings = check_systems(args.repo) + check_personal(args.repo)
    if args.base:
        findings += check_added_files(args.repo, args.base)
    if args.zips:
        findings += check_zips(args.zips)

    for f in findings:
        print(f)
    if findings:
        print(f"\n{len(findings)} attribution finding(s).", file=sys.stderr)
        return 1
    print("attribution_check: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

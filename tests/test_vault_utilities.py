#!/usr/bin/env python3
"""Regression tests for the bundled vault utilities.

Runs graph_check.py and vault_search.py against the committed
mini-vault fixture and asserts exact outputs. The fixture covers:
aliases, [[Name|alias]], [[Name#anchor]] embeds, quoted frontmatter
links, space/underscore/case variants, an orphan, an unresolved
target, and dead ends.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
VAULT = ROOT / "tests" / "fixtures" / "mini-vault"
SCHEMA_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-schema"

FAILURES = []


def run(script, *args, vault=None):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / script),
         str(vault or VAULT), *args],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        FAILURES.append(f"{script} {args}: rc={result.returncode} "
                        f"stderr={result.stderr.strip()}")
        return []
    return result.stdout.strip().splitlines()


def check(label, actual, expected):
    if actual != expected:
        FAILURES.append(f"{label}:\n  expected {expected}\n  got      {actual}")
    else:
        print(f"ok: {label}")


# --- graph_check.py ---

check("orphans",
      run("graph_check.py", "orphans"),
      ["# count: 1", "Orphan.md"])

check("unresolved",
      run("graph_check.py", "unresolved"),
      ["# count: 1", "missing note  <- B.md"])

check("deadends",
      run("graph_check.py", "deadends"),
      ["# count: 2", "B.md", "D.md"])

check("backlinks via name with space",
      run("graph_check.py", "backlinks", "E Note"),
      ["# count: 2", "A.md", "C.md"])

check("backlinks via underscore/case variant",
      run("graph_check.py", "backlinks", "e_note"),
      ["# count: 2", "A.md", "C.md"])

# An alias resolves to its note; backlinks are per-note, so both
# [[B]] and [[bee]] linkers appear (matches Obsidian semantics).
check("backlinks via frontmatter alias",
      run("graph_check.py", "backlinks", "Bee"),
      ["# count: 2", "A.md", "C.md"])

check("backlinks counts embeds",
      run("graph_check.py", "backlinks", "D"),
      ["# count: 1", "A.md"])

check("orphans respects --folder",
      run("graph_check.py", "orphans", "--folder", "NoSuchDir"),
      ["# count: 0"])

# --- vault_search.py ---

lines = run("vault_search.py", "dragon treasure", "--limit", "10")
check("search match count header",
      lines[:1], ["# matched: 3"])
ranked_paths = [l.split("\t")[1] for l in lines[1:]]
check("search ranking (highest tf first)",
      ranked_paths[:1], ["D.md"])
check("search matches underscore-compound mentions",
      sorted(ranked_paths), ["A.md", "C.md", "D.md"])

lines = run("vault_search.py", "dragon", "--limit", "1")
check("search --limit truncates results not count",
      [lines[0], len(lines) - 1], ["# matched: 3", 1])

# --- graph_check.py: ambiguous ---

check("ambiguous bare-link targets",
      run("graph_check.py", "ambiguous", vault=SCHEMA_VAULT),
      ["# count: 1", "dupe  -> A/Dupe.md, B/Dupe.md"])

# --- vault_check.py ---

lines = run("vault_check.py", "frontmatter", vault=SCHEMA_VAULT)
check("frontmatter finding count", lines[:2], ["## frontmatter", "# count: 5"])
findings = "\n".join(lines)
for expect, label in [
    ("canon_status: 'PENDING'", "invalid canon_status enum"),
    ("status: 'undead'", "invalid npc status enum"),
    ("legacy field 'source_confidence'", "legacy field detection"),
    ("unquoted wikilink in frontmatter", "unquoted frontmatter link"),
    ("missing 'type' field", "missing type"),
]:
    check(f"frontmatter: {label}",
          [expect in findings], [True])

check("names: duplicates, fuzzy, alias collisions",
      run("vault_check.py", "names", vault=SCHEMA_VAULT),
      ["## names", "# count: 3",
       "WARNING\tA/Dupe.md <> B/Dupe.md\tname 'Dupe' duplicates "
       "name 'Dupe'",
       "WARNING\tNPCs/John_Smith.md <> NPCs/Jon_Smith.md\t"
       "'John_Smith' ~ 'Jon_Smith' (similarity 0.95)",
       "WARNING\tNPCs/John_Smith.md <> NPCs/Unquoted.md\t"
       "alias 'Doc' duplicates alias 'Doc'"])

lines = run("vault_check.py", "index", vault=SCHEMA_VAULT)
check("index: phantom link detected",
      ["index links '[[ghost]]' but no such file exists"
       in "\n".join(lines)], [True])
check("index: unreferenced files counted",
      lines[1:2], ["# count: 12"])

check("stale-drafts: stale, missing-createdSession, fresh exempt",
      run("vault_check.py", "stale-drafts", vault=SCHEMA_VAULT),
      ["## stale-drafts", "# count: 3",
       "WARNING\tNPCs/Legacy.md\tstale DRAFT (created session 1, "
       "now session 5) — promote to AUTHORITATIVE or delete",
       "WARNING\tNPCs/NoCreated.md\tDRAFT missing createdSession — "
       "cannot determine staleness; add it or promote",
       "WARNING\tNoType.md\tDRAFT missing createdSession — "
       "cannot determine staleness; add it or promote"])

# --- verdict ---

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURE(S):", file=sys.stderr)
    for f in FAILURES:
        print(f"  {f}", file=sys.stderr)
    sys.exit(1)
print("\nAll vault utility tests passed.")

#!/usr/bin/env python3
"""Regression tests for the bundled vault utilities.

Runs graph_check.py and vault_search.py against the committed
mini-vault fixture and asserts exact outputs. The fixture covers:
aliases, [[Name|alias]], [[Name#anchor]] embeds, quoted frontmatter
links, space/underscore/case variants, an orphan, an unresolved
target, and dead ends.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
VAULT = ROOT / "tests" / "fixtures" / "mini-vault"
SCHEMA_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-schema"
PREP_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-prep"

FAILURES = []


def run(script, *args, vault=None, expect_rc=0):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / script),
         str(vault or VAULT), *args],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != expect_rc:
        FAILURES.append(f"{script} {args}: rc={result.returncode} "
                        f"(expected {expect_rc}) "
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

# Alias shadowing (alias 'Doc' on two files, [[Doc]] linked, no
# Doc.md) must NOT count — bare links resolve by filename only.
check("ambiguous: filename collisions only, alias shadow excluded",
      run("graph_check.py", "ambiguous", vault=SCHEMA_VAULT),
      ["# count: 1", "dupe  -> A/Dupe.md, B/Dupe.md"])

# --- vault_check.py ---

lines = run("vault_check.py", "frontmatter", vault=SCHEMA_VAULT)
check("frontmatter finding count", lines[:2], ["## frontmatter", "# count: 5"])
findings = "\n".join(lines)
check("frontmatter: inline YAML comment not a false enum error",
      ["CommentVal" in findings], [False])
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
index_text = "\n".join(lines)
check("index: phantom link detected",
      ["index links '[[ghost]]' but no such file exists"
       in index_text], [True])
check("index: unreferenced files counted",
      lines[1:2], ["# count: 12"])
check("index: path-form link resolves (no false positive)",
      ["NPCs/BadEnum.md\tnot referenced" in index_text], [False])
check("index: .md-suffix link resolves (no false positive)",
      ["NPCs/Legacy.md\tnot referenced" in index_text], [False])
check("index: attachment embed ignored (no phantom)",
      ["banner" in index_text], [False])

check("stale-drafts: stale, missing, future, comment-stripped, fresh exempt",
      run("vault_check.py", "stale-drafts", vault=SCHEMA_VAULT),
      ["## stale-drafts", "# count: 5",
       "WARNING\tNPCs/CommentVal.md\tstale DRAFT (created session 1, "
       "now session 5) — promote to AUTHORITATIVE or delete",
       "WARNING\tNPCs/FutureDraft.md\tcreatedSession (9) exceeds "
       "current session (5) — check the value (dates don't belong "
       "in this field)",
       "WARNING\tNPCs/Legacy.md\tstale DRAFT (created session 1, "
       "now session 5) — promote to AUTHORITATIVE or delete",
       "WARNING\tNPCs/NoCreated.md\tDRAFT missing createdSession — "
       "cannot determine staleness; add it or promote",
       "WARNING\tNoType.md\tDRAFT missing createdSession — "
       "cannot determine staleness; add it or promote"])

# --- session_context.py ---

ctx = "\n".join(run("session_context.py", vault=PREP_VAULT))
for expect, present, label in [
    ("Just played: session 2", True,
     "planned session 3 index does not shift 'just played'"),
    ("Preparing: session 3", True, "computes upcoming session"),
    ("ignored for 'just played'", True,
     "unplayed indexes surfaced as a note"),
    ("lighthouse keeper vanished", True, "includes wrap-up body"),
    ("The Salty Dog inn", True, "includes PC Current Status"),
    ("Secretly cursed", False, "PC GM Notes not in status block"),
    ("Fallen", False, "dead PC excluded"),
    ("Search the lighthouse at dawn", True, "includes upcoming plan"),
    ("The Drowned Court", True, "includes deferred flags"),
    ("Giant crabs", False, "ignored flags excluded"),
    ("Fogport, 1923", True, "includes campaign overview"),
]:
    check(f"session_context: {label}", [expect in ctx], [present])

# --- vault_check.py changed ---

check("changed --since lists session-touched entities",
      run("vault_check.py", "changed", "--since", "2", vault=PREP_VAULT),
      ["## changed", "# count: 5",
       "INFO\tChapters/Chapter 1/Sessions/Chapter_01_Session_02_"
       "Wrap_Up.md\tcreatedSession=2, session=2",
       "INFO\tChapters/Chapter 1/Sessions/Session 02.md\t"
       "session_number=2",
       "INFO\tChapters/Chapter 1/Sessions/Session 03.md\t"
       "session_number=3",
       "INFO\tChapters/Chapter 1/Sessions/Session_03_Plan.md\t"
       "session=3",
       "INFO\tCharacters/PCs/Hero.md\tasOfSession=2"])

# --- schema_rules.parse_session_number on real-vault values ---

sys.path.insert(0, str(SCRIPTS))
from schema_rules import parse_session_number  # noqa: E402

for value, expected, label in [
    ("Chapter 3 — Vienna, Session 7 (character retired)", 7,
     "compound reference keys on Session, not chapter"),
    ("Reconstructed 2026-07-04 from notes", None,
     "date-bearing prose is unknown, not session 2026"),
    ("2026-03-01", None, "bare date is unknown"),
    ("Session 3", 3, "plain session string"),
    (14, 14, "plain int"),
    (0, 0, "session zero is valid"),
]:
    check(f"parse_session_number: {label}",
          [parse_session_number(value)], [expected])

# --- stamp_entities.py ---

dry = "\n".join(run("stamp_entities.py", "Characters/PCs/Hero.md",
                    "--session", "3", "--date", "2026-07-05",
                    "--retag", "chapter-1=chapter-2",
                    vault=PREP_VAULT))
check("stamp: dry run plans without writing",
      ["WOULD-STAMP" in dry and "# dry-run" in dry], [True])
check("stamp: fixture untouched after dry run",
      ["asOfSession: 2" in (PREP_VAULT / "Characters/PCs/Hero.md"
                            ).read_text()], [True])

tmp = Path(tempfile.mkdtemp())
try:
    work = tmp / "vault"
    shutil.copytree(PREP_VAULT, work)
    original = (work / "Characters/PCs/Hero.md").read_text()
    out = "\n".join(run("stamp_entities.py", "Characters/PCs/Hero.md",
                        "--session", "3", "--date", "2026-07-05",
                        "--retag", "chapter-1=chapter-2", "--write",
                        vault=work))
    stamped = (work / "Characters/PCs/Hero.md").read_text()
    check("stamp: write applies asOfSession",
          ["asOfSession: 3" in stamped], [True])
    check("stamp: write adds lastUpdated",
          ['lastUpdated: "2026-07-05"' in stamped], [True])
    check("stamp: write swaps chapter tag",
          ["- chapter-2" in stamped and "- chapter-1" not in stamped],
          [True])
    # Everything after the closing frontmatter delimiter must be
    # byte-identical, not merely contain the same phrases.
    check("stamp: body preserved byte-for-byte",
          [stamped.split("---\n", 2)[2] == original.split("---\n", 2)[2]],
          [True])

    traversal = "\n".join(run("stamp_entities.py", "../escape.md",
                              "--session", "3", "--date", "2026-07-05",
                              "--write", vault=work, expect_rc=1))
    check("stamp: path traversal outside vault refused",
          ["escapes the vault" in traversal
           and not (tmp / "escape.md").exists()], [True])

    rerun = "\n".join(run("stamp_entities.py", "Characters/PCs/Hero.md",
                          "--session", "3", "--date", "2026-07-05",
                          "--retag", "chapter-1=chapter-2", vault=work))
    check("stamp: dry-run count excludes UNCHANGED files",
          ["# dry-run would stamp: 0 files" in rerun
           and "UNCHANGED" in rerun], [True])

    run("stamp_entities.py", "Characters/PCs/Hero.md", "--session",
        "3", "--date", "2026-07-05", "--retag", "chapter-2=",
        vault=work, expect_rc=2)
    check("stamp: empty retag NEW side rejected",
          ["chapter-2" in (work / "Characters/PCs/Hero.md").read_text()],
          [True])
finally:
    shutil.rmtree(tmp)

# --- stamp_entities.py safety properties (review findings) ---

tmp = Path(tempfile.mkdtemp())
try:
    v = tmp / "v"
    v.mkdir()
    (v / "Arcs.md").write_text(
        "---\ntype: pc\ncanon_status: AUTHORITATIVE\narcs:\n"
        "  - chapter-1\ntags:\n  - chapter-1\n---\n\n# Arcs\n")
    run("stamp_entities.py", "Arcs.md", "--session", "3",
        "--date", "2026-07-05", "--retag", "chapter-1=chapter-2",
        "--write", vault=v)
    arcs = (v / "Arcs.md").read_text()
    check("stamp: retag scoped to tags list, arcs untouched",
          ["arcs:\n  - chapter-1" in arcs
           and "tags:\n  - chapter-2" in arcs], [True])

    crlf = ("---\r\ntype: pc\r\ncanon_status: AUTHORITATIVE\r\n"
            "asOfSession: 2\r\n---\r\n\r\n# CRLF body\r\n")
    (v / "Crlf.md").write_bytes(crlf.encode())
    run("stamp_entities.py", "Crlf.md", "--session", "3",
        "--date", "2026-07-05", "--write", vault=v)
    out_bytes = (v / "Crlf.md").read_bytes()
    check("stamp: CRLF line endings preserved",
          [out_bytes.count(b"\r\n") >= 7 and b"asOfSession: 3" in
           out_bytes and b"# CRLF body" in out_bytes], [True])

    bad = "---\ntype: pc\n--- \nBody text.\n\n---\n\nMore body.\n"
    (v / "Bad.md").write_text(bad)
    lines = run("stamp_entities.py", "Bad.md", "--session", "3",
                "--date", "2026-07-05", "--write", vault=v,
                expect_rc=1)
    check("stamp: malformed delimiter refused with error finding",
          ["malformed frontmatter delimiter" in "\n".join(lines)], [True])
    check("stamp: malformed closing delimiter refused",
          [(v / "Bad.md").read_text() == bad], [True])

    hr = "---\nJust a horizontal rule opener.\n\n---\n\nEssay text.\n"
    (v / "Hr.md").write_text(hr)
    run("stamp_entities.py", "Hr.md", "--session", "3",
        "--date", "2026-07-05", "--write", vault=v, expect_rc=1)
    check("stamp: non-YAML region between rules refused",
          [(v / "Hr.md").read_text() == hr], [True])
finally:
    shutil.rmtree(tmp)

# --- verdict ---

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURE(S):", file=sys.stderr)
    for f in FAILURES:
        print(f"  {f}", file=sys.stderr)
    sys.exit(1)
print("\nAll vault utility tests passed.")

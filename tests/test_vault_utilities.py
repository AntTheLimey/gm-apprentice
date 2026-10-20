#!/usr/bin/env python3
"""Regression tests for the bundled vault utilities.

Runs graph_check.py and vault_search.py against the committed
mini-vault fixture and asserts exact outputs. The fixture covers:
aliases, [[Name|alias]], [[Name#anchor]] embeds, quoted frontmatter
links, space/underscore/case variants, an orphan, an unresolved
target, and dead ends.

Every `check` below is its own pytest case. A check's second argument is a
function, so nothing runs (and no script starts) until the case does; a
script run is cached, so cases that read the same output share one run.
"""

import functools
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
VAULT = ROOT / "tests" / "fixtures" / "mini-vault"
SCHEMA_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-schema"
PREP_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-prep"
PREP_CHAPTERS_VAULT = ROOT / "tests" / "fixtures" / "mini-vault-prep-chapters"
PREP_NOLINK_VAULT = (ROOT / "tests" / "fixtures"
                     / "mini-vault-prep-chapters-nolink")

sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ROOT / "scripts"))
from schema_rules import (  # noqa: E402
    chapter_key, parse_session_number, scalar_value)
from session_context import wikilink_target  # noqa: E402
from validate_schema import validate_file  # noqa: E402

CASES = []


def check(label, actual, expected):
    """Register one case. `actual` is a function that computes the result
    when the case runs."""
    CASES.append(pytest.param(actual, expected, id=label))


def run_script(script, *args, vault=None, expect_rc=0):
    """The script's stdout lines; a return code other than `expect_rc`
    fails the case that asked."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / script),
         str(vault or VAULT), *args],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == expect_rc, (
        f"{script} {args}: rc={result.returncode} (expected {expect_rc}) "
        f"stderr={result.stderr.strip()}")
    return result.stdout.strip().splitlines()


# A read-only run shares one process between the cases that read it.
run = functools.cache(run_script)


def text_of(script, *args, vault=None):
    """The cached output of a read-only run, as one string."""
    return "\n".join(run(script, *args, vault=vault))


# --- graph_check.py ---

check("orphans",
      lambda: run("graph_check.py", "orphans"),
      ["# count: 1", "Orphan.md"])

check("unresolved",
      lambda: run("graph_check.py", "unresolved"),
      ["# count: 1", "missing note  <- B.md"])

check("deadends",
      lambda: run("graph_check.py", "deadends"),
      ["# count: 2", "B.md", "D.md"])

check("backlinks via name with space",
      lambda: run("graph_check.py", "backlinks", "E Note"),
      ["# count: 2", "A.md", "C.md"])

check("backlinks via underscore/case variant",
      lambda: run("graph_check.py", "backlinks", "e_note"),
      ["# count: 2", "A.md", "C.md"])

# An alias resolves to its note; backlinks are per-note, so both
# [[B]] and [[bee]] linkers appear (matches Obsidian semantics).
check("backlinks via frontmatter alias",
      lambda: run("graph_check.py", "backlinks", "Bee"),
      ["# count: 2", "A.md", "C.md"])

check("backlinks counts embeds",
      lambda: run("graph_check.py", "backlinks", "D"),
      ["# count: 1", "A.md"])

check("orphans respects --folder",
      lambda: run("graph_check.py", "orphans", "--folder", "NoSuchDir"),
      ["# count: 0"])

# --- vault_search.py ---


def search_dragon_treasure():
    return run("vault_search.py", "dragon treasure", "--limit", "10")


check("search match count header",
      lambda: search_dragon_treasure()[:1], ["# matched: 3"])
check("search ranking (highest tf first)",
      lambda: [l.split("\t")[1] for l in search_dragon_treasure()[1:]][:1],
      ["D.md"])
check("search matches underscore-compound mentions",
      lambda: sorted(l.split("\t")[1] for l in search_dragon_treasure()[1:]),
      ["A.md", "C.md", "D.md"])


def search_dragon_limit_one():
    lines = run("vault_search.py", "dragon", "--limit", "1")
    return [lines[0], len(lines) - 1]


check("search --limit truncates results not count",
      search_dragon_limit_one, ["# matched: 3", 1])

# --- graph_check.py: ambiguous ---

# Alias shadowing (alias 'Doc' on two files, [[Doc]] linked, no
# Doc.md) must NOT count — bare links resolve by filename only.
check("ambiguous: filename collisions only, alias shadow excluded",
      lambda: run("graph_check.py", "ambiguous", vault=SCHEMA_VAULT),
      ["# count: 1", "dupe  -> A/Dupe.md, B/Dupe.md"])

# --- vault_check.py ---


def frontmatter_lines():
    return run("vault_check.py", "frontmatter", vault=SCHEMA_VAULT)


check("frontmatter finding count",
      lambda: frontmatter_lines()[:2], ["## frontmatter", "# count: 6"])
check("frontmatter: inline YAML comment not a false enum error",
      lambda: ["CommentVal" in "\n".join(frontmatter_lines())], [False])
for expect, label in [
    ("canon_status: 'PENDING'", "invalid canon_status enum"),
    ("status: 'undead'", "invalid npc status enum"),
    ("legacy field 'source_confidence'", "legacy field detection"),
    ("unquoted wikilink in frontmatter", "unquoted frontmatter link"),
    ("missing 'type' field", "missing type"),
    ("Session_5.md\tmissing required field 'documents'",
     "an empty required field is missing"),
]:
    check(f"frontmatter: {label}",
          lambda expect=expect: [expect in "\n".join(frontmatter_lines())],
          [True])

check("names: duplicates, fuzzy, alias collisions",
      lambda: run("vault_check.py", "names", vault=SCHEMA_VAULT),
      ["## names", "# count: 3",
       "WARNING\tA/Dupe.md <> B/Dupe.md\tname 'Dupe' duplicates "
       "name 'Dupe'",
       "WARNING\tNPCs/John_Smith.md <> NPCs/Jon_Smith.md\t"
       "'John_Smith' ~ 'Jon_Smith' (similarity 0.95)",
       "WARNING\tNPCs/John_Smith.md <> NPCs/Unquoted.md\t"
       "alias 'Doc' duplicates alias 'Doc'"])


def index_lines():
    return run("vault_check.py", "index", vault=SCHEMA_VAULT)


def index_text():
    return "\n".join(index_lines())


check("index: phantom link detected",
      lambda: ["index links '[[ghost]]' but no such file exists"
               in index_text()], [True])
check("index: unreferenced files counted",
      lambda: index_lines()[1:2], ["# count: 12"])
check("index: path-form link resolves (no false positive)",
      lambda: ["NPCs/BadEnum.md\tnot referenced" in index_text()], [False])
check("index: .md-suffix link resolves (no false positive)",
      lambda: ["NPCs/Legacy.md\tnot referenced" in index_text()], [False])
check("index: attachment embed ignored (no phantom)",
      lambda: ["banner" in index_text()], [False])

check("stale-drafts: stale, missing, future, comment-stripped, fresh exempt",
      lambda: run("vault_check.py", "stale-drafts", vault=SCHEMA_VAULT),
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


def ctx():
    return text_of("session_context.py", vault=PREP_VAULT)


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
    check(f"session_context: {label}",
          lambda expect=expect: [expect in ctx()], [present])

# A later session that is already PLAYED is not "unplayed" — it means the
# selection (here an explicit --session 1 behind played session 2) may be
# stale, and the Note has to say so rather than mislabel it.


def ctx_s1():
    return text_of("session_context.py", "--session", "1", vault=PREP_VAULT)


check("session_context: later played session gets its own stale Note",
      lambda: ["session(s) [2] in this chapter are numbered after the "
               "selected one and carry a played status" in ctx_s1(),
               "session index(es) [3] exist with unplayed status"
               in ctx_s1(),
               "session index(es) [2" in ctx_s1()],
      [True, True, False])
check("session_context: default selection reports no played-later Note",
      lambda: ["carry a played status" in ctx()], [False])

# --- session_context.py with per-chapter session numbering (#162) ---
#
# Chapter 3 ran to Session 14; Chapter 4 restarted and is at Session 07. A
# vault-wide max() over session_number picks Vienna S14 and stays there until
# Calcutta reaches 15, handing back a stale wrap-up as if it were current. Two
# sessions also share number 7 across chapters, which silently collided on a
# bare-integer key.


def ctx_ch():
    return text_of("session_context.py", vault=PREP_CHAPTERS_VAULT)


for expect, present, label in [
    ("Session 07 - The Sterile Bay", True,
     "picks the most recently played session, not the highest number"),
    ("Preparing: session 8", True,
     "next session is numbered within the current chapter"),
    ("Chapter 3 - Vienna/Sessions/Session 14.md", False,
     "the completed chapter's last session is not 'just played'"),
    ("sterile bay swallowed", True, "pairs the current chapter's wrap-up"),
    ("Vienna opera burned", False, "stale chapter wrap-up excluded"),
    ("dredger's manifest inland", True, "finds the upcoming plan in-chapter"),
]:
    check(f"session_context chapters: {label}",
          lambda expect=expect: [expect in ctx_ch()], [present])

# Two chapters both hold a Session 07. Picking one silently is the collision
# itself, so an explicit --session 7 must say which chapter it resolved to.
# (Asserting only "Calcutta won" would pass today by directory walk order.)


def ctx_s7():
    return text_of("session_context.py", "--session", "7",
                   vault=PREP_CHAPTERS_VAULT)


check("session_context chapters: --session names the chapter it resolved to",
      lambda: ["resolved to Chapter 4 - Calcutta" in ctx_s7(),
               "also in Chapter 3 - Vienna" in ctx_s7()],
      [True, True])

# A quoted wikilink arrives from the frontmatter reader as a ONE-ITEM LIST
# (`"[[Note]]"` -> `['[Note]']`, outer brackets eaten as a YAML flow sequence),
# so anything that reads a wikilink-valued field has to unwrap it. Getting this
# wrong disables the lookup silently rather than erroring.
for value, expected, label in [
    (["[Session 07 - The Sterile Bay]"], "Session 07 - The Sterile Bay",
     "single-item list from a quoted wikilink"),
    ("[[Session 07]]", "Session 07", "plain string wikilink"),
    ("[[Session 07|the bay]]", "Session 07", "alias discarded"),
    ("[[Session 07#Recap]]", "Session 07", "anchor discarded"),
    ("Session 07", "Session 07", "bare text passes through"),
    (None, "", "missing value"),
    ([], "", "empty list"),
]:
    check(f"wikilink_target: {label}",
          lambda value=value: [wikilink_target(value)], [expected])

# When the overview's pointer is stale, saying so beats guessing quietly.


def ctx_nolink():
    return text_of("session_context.py", vault=PREP_NOLINK_VAULT)


for expect, present, label in [
    ("matches no session file", True, "unresolvable last_session is reported"),
    ("Session 07 - The Sterile Bay", True,
     "falls back to the most recently played session"),
]:
    check(f"session_context stale pointer: {label}",
          lambda expect=expect: [expect in ctx_nolink()], [present])

# Staleness took a vault-wide max() over session_number too, so in a vault that
# restarts numbering the just-played chapter's drafts read as many sessions old
# and were told to "promote or delete" (#162). Deleting current content on a
# miscount is the worst outcome in this file.
check("vault_check stale-drafts: the live chapter's draft is not stale",
      lambda: run("vault_check.py", "stale-drafts",
                  vault=PREP_CHAPTERS_VAULT),
      ["## stale-drafts", "# count: 1",
       "WARNING\t_World/_flags.md\tDRAFT missing createdSession — "
       "cannot determine staleness; add it or promote"])

# Review findings on #162. Three ways the chapter dimension could still be lost.

# (a) A chapter ref written as a path must key the same as the folder fallback,
# or one chapter becomes two identities and its own documents stop matching.
check("chapter_key: path-form ref matches the folder fallback",
      lambda: [chapter_key("Chapters/Chapter 4 - Calcutta/Sessions/S.md",
                           {"chapter": ["[Chapters/Chapter 4 - Calcutta]"]})],
      [chapter_key("Chapters/Chapter 4 - Calcutta/Sessions/S.md", {})])

# (b) last_session is a path-form wikilink in the fixture; it must still resolve.
# Assert the pointer RESOLVED, not merely that the answer came out right:
# the recency fallback reaches the same session, so only the absence of the
# "matches no session file" warning proves the overview path fired.
check("session_context: path-form last_session resolves",
      lambda: ["Session 07 - The Sterile Bay" in ctx_ch(),
               "matches no session file" in ctx_ch()],
      [True, False])


def with_copy_of(source, edit):
    """A throwaway copy of the fixture vault `source`, after `edit(copy)`,
    removed when the `with` block ends."""
    class Copy:
        def __enter__(self):
            self.root = Path(tempfile.mkdtemp())
            self.vault = self.root / "v"
            shutil.copytree(source, self.vault)
            edit(self.vault)
            return self.vault

        def __exit__(self, *_exc):
            shutil.rmtree(self.root, ignore_errors=True)
    return Copy()


# A bare stem must keep working — that is what the reported vault held.
def use_bare_stem(vault):
    overview = vault / "Overview.md"
    overview.write_text(overview.read_text(encoding="utf-8").replace(
        "[[Chapters/Chapter 4 - Calcutta/Sessions/Session 07 - The Sterile Bay]]",
        "[[Session 07 - The Sterile Bay]]"), encoding="utf-8")


def bare_stem_context():
    with with_copy_of(PREP_CHAPTERS_VAULT, use_bare_stem) as vault:
        return "\n".join(run_script("session_context.py", vault=vault))


check("session_context: bare-stem last_session resolves",
      lambda: ["Session 07 - The Sterile Bay" in bare_stem_context()],
      [True])

# (c) A document carrying no chapter must not outrank the chapter's own just
# because it sorts earlier. Archive_... deliberately sorts before Chapters/.
check("session_context: the chapter's own wrap-up outranks an unfiled one",
      lambda: ["sterile bay swallowed" in ctx_ch(),
               "unfiled wrap-up carrying no chapter" in ctx_ch()],
      [True, False])

# A malformed `type:` must not take the whole bundle down. The frontmatter
# reader hands back `[]` for a bare `type:` and a list for `type: [a, b]`, and
# the wrap-up filter tests membership of a frozenset — so an unguarded `in`
# hashes the left operand and raises TypeError on the first such file, losing
# every other file's context with it. A bad `type` is ordinary bad-vault input:
# match nothing, walk past.


def add_malformed_types(vault):
    (vault / "ListType.md").write_text(
        "---\ntype: [session_wrap, note]\nsession: 2\n---\n\n"
        "# Malformed list type\n", encoding="utf-8")
    (vault / "BareType.md").write_text(
        "---\ntype:\nsession: 2\n---\n\n# Malformed empty type\n",
        encoding="utf-8")


def bad_type_context():
    with with_copy_of(PREP_VAULT, add_malformed_types) as vault:
        return "\n".join(run_script("session_context.py", vault=vault))


check("session_context: a list-valued type does not abort the bundle",
      lambda: ["lighthouse keeper vanished" in bad_type_context(),
               "Just played: session 2" in bad_type_context(),
               "Malformed list type" in bad_type_context()],
      [True, True, False])

# The same shape must not take vault_check down either — its gm-leak, names,
# read-aloud, sessions and wrapup checks all test `type` against a set.


def add_list_type(vault):
    (vault / "ListType.md").write_text(
        "---\ntype: [session_wrap, note]\nsession: 2\n---\n\n"
        "# Malformed list type\n", encoding="utf-8")


def survives_list_type(command):
    with with_copy_of(PREP_VAULT, add_list_type) as vault:
        return [bool(run_script("vault_check.py", command, vault=vault))]


for _cmd in ("names", "gm-leak", "read-aloud", "sessions", "wrapup"):
    check(f"vault_check {_cmd}: survives a list-valued type",
          lambda _cmd=_cmd: survives_list_type(_cmd), [True])

# --- vault_check.py changed ---

check("changed --since lists session-touched entities",
      lambda: run("vault_check.py", "changed", "--since", "2",
                  vault=PREP_VAULT),
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
          lambda value=value: [parse_session_number(value)], [expected])

# --- schema_rules.scalar_value quoting ---

for raw, expected, label in [
    ('"npc"', "npc", "plain double-quoted scalar unwraps"),
    ("'npc'", "npc", "plain single-quoted scalar unwraps"),
    ('"npc"  # legacy', "npc", "a trailing comment is not content"),
    ("'npc' # legacy", "npc", "single-quoted, trailing comment"),
    ("npc # legacy", "npc", "unquoted value stops at the comment"),
    ("# where is it", "", "a value that is only a comment is empty"),
    ("#ff0000", "", "an unquoted leading # is a comment, as in YAML"),
    ('"#ff0000"', "#ff0000", "a quoted leading # is content"),
    ("a#b", "a#b", "a # inside a word is content"),
    # A quoted scalar with anything else after the closing quote is not a
    # valid YAML scalar. Unwrapping it would hand `npc` to the type check and
    # pass malformed frontmatter silently; the raw text fails loudly instead.
    ('"npc" trailing', '"npc" trailing', "trailing text is not unwrapped"),
    ('"npc",', '"npc",', "a stray flow comma is not unwrapped"),
    ('"unterminated', '"unterminated', "an unclosed quote stays raw"),
    # Escapes belong to the scalar: the closing quote is the unescaped one,
    # so a value like a height range survives whole instead of truncating.
    ('"5\'4\\" - 6\'0\\""', "5'4\\\" - 6'0\\\"", "escaped inner quote is kept"),
    ("'O''Brien'", "O''Brien", "single-quote escape is kept"),
]:
    check(f"scalar_value: {label}",
          lambda raw=raw: [scalar_value(raw)], [expected])

# Otherwise-complete npc frontmatter, so the only thing that can fail is the
# malformed type. Unwrapping the quoted prefix used to make this note valid.
check("validate_file: malformed quoted type is reported, not accepted",
      lambda: [[e.split(" —")[0] for e in validate_file(
          Path("Trailing.md"),
          '---\ntype: "npc" trailing\ncanon_status: AUTHORITATIVE\n---\n')]],
      [["Unknown type '\"npc\" trailing'"]])

# --- stamp_entities.py ---

HERO = "Characters/PCs/Hero.md"


def stamp(vault, *args, expect_rc=0):
    """One stamp_entities.py run, as one string. Not cached: the runs in a
    sequence change the vault the next one reads."""
    return "\n".join(run_script("stamp_entities.py", *args, vault=vault,
                                expect_rc=expect_rc))


@functools.cache
def stamp_dry_run():
    return stamp(PREP_VAULT, HERO, "--session", "3", "--date", "2026-07-05",
                 "--retag", "chapter-1=chapter-2")


check("stamp: dry run plans without writing",
      lambda: ["WOULD-STAMP" in stamp_dry_run()
               and "# dry-run" in stamp_dry_run()], [True])
check("stamp: fixture untouched after dry run",
      lambda: stamp_dry_run() and
      ["asOfSession: 2" in (PREP_VAULT / HERO).read_text()], [True])


@functools.cache
def stamp_work_vault():
    """The writes of the stamp tests that share one vault, in order, and
    what each left behind."""
    tmp = Path(tempfile.mkdtemp())
    try:
        work = tmp / "vault"
        shutil.copytree(PREP_VAULT, work)
        hero = work / HERO
        seen = {"original": hero.read_text()}
        args = ("--session", "3", "--date", "2026-07-05")
        stamp(work, HERO, *args, "--retag", "chapter-1=chapter-2", "--write")
        seen["stamped"] = hero.read_text()
        seen["traversal"] = stamp(work, "../escape.md", *args, "--write",
                                  expect_rc=1)
        seen["escaped"] = (tmp / "escape.md").exists()
        seen["rerun"] = stamp(work, HERO, *args, "--retag",
                              "chapter-1=chapter-2")
        stamp(work, HERO, *args, "--retag", "chapter-2=", expect_rc=2)
        seen["after_empty_retag"] = hero.read_text()

        # asOfSession shape (#180): a label vault must not be flattened
        hero.write_text(hero.read_text().replace(
            "asOfSession: 3", 'asOfSession: "Chapter 4, Session 8"'))
        seen["refused"] = stamp(work, HERO, "--session", "9",
                                "--date", "2026-08-27", "--write",
                                expect_rc=1)
        seen["after_refused"] = hero.read_text()
        seen["labelled"] = stamp(work, HERO, "--session", "Chapter 4, Session 9",
                                 "--date", "2026-08-27", "--write")
        seen["after_labelled"] = hero.read_text()
        seen["forced"] = stamp(work, HERO, "--session", "10",
                               "--date", "2026-08-28", "--force-shape",
                               "--write")
        seen["after_forced"] = hero.read_text()
        hero.write_text(hero.read_text().replace(
            "asOfSession: 10", 'asOfSession: ""'))
        seen["fresh"] = stamp(work, HERO, "--session", "Chapter 5, Session 1",
                              "--date", "2026-08-29", "--write")
        seen["after_fresh"] = hero.read_text()
        hero.write_text(hero.read_text().replace(
            'asOfSession: "Chapter 5, Session 1"', 'asOfSession: "9"'))
        seen["qint"] = stamp(work, HERO, "--session", "10",
                             "--date", "2026-08-30", "--write")
        seen["after_qint"] = hero.read_text()
        seen["qq"] = stamp(work, HERO, "--session", '"11"',
                           "--date", "2026-08-31", "--write")
        seen["after_qq"] = hero.read_text()
        return seen
    finally:
        shutil.rmtree(tmp)


def stamped_hero():
    return stamp_work_vault()["stamped"]


check("stamp: write applies asOfSession",
      lambda: ["asOfSession: 3" in stamped_hero()], [True])
check("stamp: write adds lastUpdated",
      lambda: ['lastUpdated: "2026-07-05"' in stamped_hero()], [True])
check("stamp: write swaps chapter tag",
      lambda: ["- chapter-2" in stamped_hero()
               and "- chapter-1" not in stamped_hero()], [True])
# Everything after the closing frontmatter delimiter must be
# byte-identical, not merely contain the same phrases.
check("stamp: body preserved byte-for-byte",
      lambda: [stamped_hero().split("---\n", 2)[2]
               == stamp_work_vault()["original"].split("---\n", 2)[2]],
      [True])
check("stamp: path traversal outside vault refused",
      lambda: ["escapes the vault" in stamp_work_vault()["traversal"]
               and not stamp_work_vault()["escaped"]], [True])
check("stamp: dry-run count excludes UNCHANGED files",
      lambda: ["# dry-run would stamp: 0 files" in stamp_work_vault()["rerun"]
               and "UNCHANGED" in stamp_work_vault()["rerun"]], [True])
check("stamp: empty retag NEW side rejected",
      lambda: ["chapter-2" in stamp_work_vault()["after_empty_retag"]],
      [True])
check("stamp: bare number refused on a label-shaped vault",
      lambda: ["would change its shape" in stamp_work_vault()["refused"]
               and 'asOfSession: "Chapter 4, Session 8"'
               in stamp_work_vault()["after_refused"]], [True])
check("stamp: label written verbatim, quoted",
      lambda: ['asOfSession: "Chapter 4, Session 9"'
               in stamp_work_vault()["after_labelled"]
               and "STAMPED" in stamp_work_vault()["labelled"]], [True])
check("stamp: --force-shape allows the shape change",
      lambda: ["asOfSession: 10" in stamp_work_vault()["after_forced"]
               and "STAMPED" in stamp_work_vault()["forced"]], [True])
check("stamp: an empty template value takes either shape",
      lambda: ['asOfSession: "Chapter 5, Session 1"'
               in stamp_work_vault()["after_fresh"]
               and "STAMPED" in stamp_work_vault()["fresh"]], [True])
check("stamp: a quoted integer is an int and keeps its quotes",
      lambda: ['asOfSession: "10"' in stamp_work_vault()["after_qint"]
               and "STAMPED" in stamp_work_vault()["qint"]], [True])
check("stamp: shell-quoted number never double-quotes",
      lambda: ['asOfSession: "11"' in stamp_work_vault()["after_qq"]
               and '\\"' not in stamp_work_vault()["after_qq"]
               and "STAMPED" in stamp_work_vault()["qq"]], [True])

# --- stamp_entities.py safety properties (review findings) ---

CRLF = ("---\r\ntype: pc\r\ncanon_status: AUTHORITATIVE\r\n"
        "asOfSession: 2\r\n---\r\n\r\n# CRLF body\r\n")
BAD_DELIMITER = "---\ntype: pc\n--- \nBody text.\n\n---\n\nMore body.\n"
HORIZONTAL_RULE = "---\nJust a horizontal rule opener.\n\n---\n\nEssay text.\n"


@functools.cache
def stamp_safety():
    tmp = Path(tempfile.mkdtemp())
    try:
        v = tmp / "v"
        v.mkdir()
        seen = {}
        args = ("--session", "3", "--date", "2026-07-05")
        (v / "Arcs.md").write_text(
            "---\ntype: pc\ncanon_status: AUTHORITATIVE\narcs:\n"
            "  - chapter-1\ntags:\n  - chapter-1\n---\n\n# Arcs\n")
        stamp(v, "Arcs.md", *args, "--retag", "chapter-1=chapter-2", "--write")
        seen["arcs"] = (v / "Arcs.md").read_text()

        (v / "Crlf.md").write_bytes(CRLF.encode())
        stamp(v, "Crlf.md", *args, "--write")
        seen["crlf"] = (v / "Crlf.md").read_bytes()

        (v / "Bad.md").write_text(BAD_DELIMITER)
        seen["bad_out"] = stamp(v, "Bad.md", *args, "--write", expect_rc=1)
        seen["bad_after"] = (v / "Bad.md").read_text()

        (v / "Hr.md").write_text(HORIZONTAL_RULE)
        stamp(v, "Hr.md", *args, "--write", expect_rc=1)
        seen["hr_after"] = (v / "Hr.md").read_text()
        return seen
    finally:
        shutil.rmtree(tmp)


check("stamp: retag scoped to tags list, arcs untouched",
      lambda: ["arcs:\n  - chapter-1" in stamp_safety()["arcs"]
               and "tags:\n  - chapter-2" in stamp_safety()["arcs"]], [True])
check("stamp: CRLF line endings preserved",
      lambda: [stamp_safety()["crlf"].count(b"\r\n") >= 7
               and b"asOfSession: 3" in stamp_safety()["crlf"]
               and b"# CRLF body" in stamp_safety()["crlf"]], [True])
check("stamp: malformed delimiter refused with error finding",
      lambda: ["malformed frontmatter delimiter" in stamp_safety()["bad_out"]],
      [True])
check("stamp: malformed closing delimiter refused",
      lambda: [stamp_safety()["bad_after"] == BAD_DELIMITER], [True])
check("stamp: non-YAML region between rules refused",
      lambda: [stamp_safety()["hr_after"] == HORIZONTAL_RULE], [True])


@pytest.mark.parametrize("actual, expected", CASES)
def test_check(actual, expected):
    assert actual() == expected

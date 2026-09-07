#!/usr/bin/env python3
"""Vault content checks: frontmatter, names, index drift, stale drafts.

Read-only companion to graph_check.py. Turns the mechanical parts of
entity validation and campaign-qa checks into one deterministic pass;
interpretation stays with the skill. Stdlib only.

Usage:
  vault_check.py VAULT frontmatter [--folder SUB]
  vault_check.py VAULT names [--threshold 0.85]
  vault_check.py VAULT index
  vault_check.py VAULT stale-drafts
  vault_check.py VAULT changed --since N
  vault_check.py VAULT tables
  vault_check.py VAULT timeline
  vault_check.py VAULT read-aloud
  vault_check.py VAULT relationships
  vault_check.py VAULT sessions
  vault_check.py VAULT gm-leak [--folder SUB]
  vault_check.py VAULT pc-body [--folder SUB]
  vault_check.py VAULT wrapup [--file REL] [--fix]
  vault_check.py VAULT version
  vault_check.py VAULT active-pcs
  vault_check.py VAULT all

Skips hidden directories, `_Templates/`, and `_inbox/` (staging).
Output: labelled sections, `# count: N` headers, one finding per
line as `LEVEL<TAB>path<TAB>message`.

Levels: ERROR (schema violation), WARNING (needs GM attention),
INFO (context the auditing skill should triage, not a defect).

`wrapup` is the one command that can write. It prints its findings
first and then a repair row per action — `WOULD-FIX` on a dry run,
`FIXED` when `--fix` applies them, `UNCHANGED` for a conformant
file. It joins `all` as a dry run: `all` never writes.

Two commands are gates rather than reports and sit outside `all`:
`version` emits one row whose first column is a verdict
(OK/MISMATCH/AHEAD/SETUP/ERROR) and sets the exit code — 0 for
OK/SETUP, 1 otherwise — so a skill can branch on it; `active-pcs`
emits `PC<TAB>path<TAB>roster line` for the session skills' opening
roster read.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import unicodedata
from pathlib import Path

from schema_rules import (
    CANON_STATUS_VALUES,
    DEPRECATED_FIELDS,
    NPC_STATUS,
    REQUIRED_FIELDS,
    SCENE_STATUS,
    SCENE_TYPES,
    SESSION_STATUS,
    extract_frontmatter,
    inverse_predicates,
    iter_relationship_predicates,
    chapter_key,
    parse_session_number,
    predicate_problem,
    predicate_vocabulary,
)
# LINK_RE, SKIP_DIRS and PC_INACTIVE_STATUS are re-exported: they were part
# of this module's surface before vaultlib existed.
from vaultlib import (  # noqa: F401
    FENCE_RE,
    HEADING_RE,
    LINK_RE,
    PC_INACTIVE_STATUS,
    SKIP_DIRS,
    WRAP_UP_TYPES,
    LineState,
    active_pc_names,
    active_pcs,
    delete_key,
    effective_exclude_sections,
    entity_type,
    frontmatter_span,
    get_key,
    iter_body_lines,
    link_target,
    nested_mapping,
    normalize,
    opens_a_block,
    parse_version,
    plugin_version,
    publish_mode,
    raw_frontmatter,
    scalar_value,
    scan_body,
    set_key,
    vault_files,
    wikilink_target,
    yaml_scalar,
)

# A frontmatter line carrying an unquoted wikilink (Juggl breaks on these)
UNQUOTED_LINK_RE = re.compile(r'^\s*(?:[\w-]+:|-)\s*\[\[')

ENUM_CHECKS = {
    # field -> (allowed values, entity types it applies to; None = any)
    "canon_status": (CANON_STATUS_VALUES, None),
    "scene_type": (SCENE_TYPES, {"scene"}),
}
STATUS_BY_TYPE = {
    "session": SESSION_STATUS,
    "scene": SCENE_STATUS,
    "npc": NPC_STATUS,
}


def emit(label: str, rows: list[str]):
    print(f"## {label}")
    print(f"# count: {len(rows)}")
    for r in rows:
        print(r)


def check_frontmatter(vault: Path, folder: str | None) -> list[str]:
    rows = []
    for rel, text in vault_files(vault, folder):
        fm = extract_frontmatter(text)
        if fm is None:
            rows.append(f"INFO\t{rel}\tno frontmatter")
            continue
        etype = fm.get("type")
        if not etype or isinstance(etype, list):
            rows.append(f"ERROR\t{rel}\tmissing 'type' field")
            continue
        if etype not in REQUIRED_FIELDS:
            # Custom entity types are allowed; surface for awareness.
            rows.append(f"INFO\t{rel}\tcustom type '{etype}' "
                        f"(no schema rules applied)")
        else:
            for field in REQUIRED_FIELDS[etype]:
                if field not in fm:
                    rows.append(f"ERROR\t{rel}\tmissing required "
                                f"field '{field}' for type '{etype}'")
        for field, (allowed, types) in ENUM_CHECKS.items():
            value = fm.get(field)
            if value and not isinstance(value, list) \
                    and (types is None or etype in types) \
                    and value not in allowed:
                rows.append(f"ERROR\t{rel}\t{field}: '{value}' not in "
                            f"{{{', '.join(sorted(allowed))}}}")
        status = fm.get("status")
        status_values = STATUS_BY_TYPE.get(etype)
        if status and status_values and not isinstance(status, list) \
                and status not in status_values:
            rows.append(f"ERROR\t{rel}\tstatus: '{status}' not in "
                        f"{{{', '.join(sorted(status_values))}}}")
        for scope in ("*", etype):
            for old, new, since in DEPRECATED_FIELDS.get(scope, []):
                if old in fm:
                    rows.append(f"ERROR\t{rel}\tlegacy field '{old}' — "
                                f"renamed to '{new}' in {since} "
                                f"(see shared/canon-status.md)")
        for line in raw_frontmatter(text).splitlines():
            if UNQUOTED_LINK_RE.match(line):
                rows.append(f"WARNING\t{rel}\tunquoted wikilink in "
                            f"frontmatter: {line.strip()[:60]} "
                            f"(quote it: \"[[...]]\")")
    return rows


# Document-chain suffixes: "X - Wrap-Up" beside "X" is the designed
# session family, and "X_Story" beside "X" is the PC story pair —
# similarity between them is expected, not confusing.
CHAIN_SUFFIX_RE = re.compile(
    r"\s*[-–]\s*(wrap[- ]?up|plan|play notes|handouts)$|[_ ]story$",
    re.IGNORECASE,
)
DIGITS_RE = re.compile(r"\d+(?:\.\d+)?")

# Name-confusion checking is about entities (NPCs, locations,
# factions...). Structural documents — session notes, plans,
# wrap-ups, chapter overviews — share names by convention and
# only flood the report.
STRUCTURAL_TYPES = {
    "session", "session-plan", "session-play-notes",
    "session-wrap-up", "session_wrap", "scene", "chapter",
    "meta", "timeline", "world_flags", "plan",
}
STRUCTURAL_NAME_RE = re.compile(
    r"(session|chapter)s?[\s_#.\d-]", re.IGNORECASE)
STRUCTURAL_DOC_RE = re.compile(
    r"(note|plan|wrap|overview|handout|recap)", re.IGNORECASE)


def base_name(name: str) -> str:
    return CHAIN_SUFFIX_RE.sub("", name.replace("_", " ").strip())


# Sound-alike detection for names players will *hear*. Two names collide
# phonetically when they have the same number of words and each word
# pair, after folding diacritics and digraphs (th/ch/sh/ph/gh/wh/ck/qu),
# dropping vowels, and collapsing the consonant pairs a listener most
# often confuses — the voiced/voiceless stops p/b, t/d, c/g/k plus m/n,
# s/z, f/v — leaves the same consonant skeleton, opens with the same
# sound, and is of similar length. "Adler"/"Adlar", "Herzfeld"/
# "Herzveld", "Marina"/"Miriam", "Barton"/"Parton" collide; "Adler"/
# "Adley" (r ≠ l), "Emile"/"Nell" (opening sound) and "Henri"/"Honoria"
# (length) do not. Only entities of the same type are compared (files
# with no `type:` are skipped) — the prose check's own advice, and what
# stops "The Mole" (NPC) ~ "The Nile" (location) — and the result is an
# INFO cue for the GM, not a finding.
DIGRAPHS = (("th", "t"), ("ch", "c"), ("sh", "s"), ("ph", "f"),
            ("gh", "g"), ("wh", "w"), ("ck", "c"), ("qu", "c"))
CONFUSABLE = str.maketrans({
    "p": "b", "t": "d", "g": "c", "k": "c", "n": "m", "z": "s", "v": "f",
})
MIN_SKELETON = 2  # total consonants across all words
MAX_LENGTH_DIFF = 1  # per word, in letters


def phonetic_words(name: str) -> list[tuple[str, int]]:
    """Per-word ("opening|consonants", letter count). Digits are kept as
    their own word so "Vienna 1814" is not "Vienna". Empty when the name
    is too short to compare meaningfully."""
    words = []
    consonants = 0
    folded = "".join(c for c in unicodedata.normalize("NFKD", normalize(name))
                     if not unicodedata.combining(c))
    for word in folded.split():
        word = re.sub(r"[^a-z0-9]", "", word)
        if not word:
            continue
        if word.isdigit():
            words.append((f"#{word}", len(word)))
            continue
        word = re.sub(r"[^a-z]", "", word)
        word = re.sub(r"(.)\1+", r"\1", word)  # "tt" → "t", "oo" → "o"
        for pair in DIGRAPHS:
            word = word.replace(*pair)
        if not word:
            continue
        opening = word[0].translate(CONFUSABLE)
        body = re.sub(r"[aeiouyh]", "", word).translate(CONFUSABLE)
        consonants += len(body)
        words.append((f"{opening}|{body}", len(word)))
    return words if consonants >= MIN_SKELETON else []


def sounds_alike(words_a: list[tuple[str, int]],
                 words_b: list[tuple[str, int]]) -> bool:
    """Compare two `phonetic_words` results."""
    if not words_a or len(words_a) != len(words_b):
        return False
    return all(sa == sb and abs(la - lb) <= MAX_LENGTH_DIFF
               for (sa, la), (sb, lb) in zip(words_a, words_b))


def check_names(vault: Path, threshold: float) -> list[str]:
    # name -> list of (rel, kind) where kind is 'name' or 'alias'
    entries = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        stem = Path(rel).stem
        if entity_type(fm) in STRUCTURAL_TYPES:
            continue
        if STRUCTURAL_NAME_RE.search(stem) and STRUCTURAL_DOC_RE.search(stem):
            continue
        etype = fm.get("type")
        entries.append((stem, rel, "name", etype, phonetic_words(stem)))
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                entries.append((a, rel, "alias", etype, phonetic_words(a)))
    rows = []
    seen_pairs = set()
    phonetic = {}  # pair -> row; emitted only if no exact/fuzzy row exists
    for i, (name_a, rel_a, kind_a, type_a, pw_a) in enumerate(entries):
        for name_b, rel_b, kind_b, type_b, pw_b in entries[i + 1:]:
            if rel_a == rel_b:
                continue
            pair = tuple(sorted((rel_a, rel_b)))
            if normalize(base_name(name_a)) == normalize(base_name(name_b)) \
                    and normalize(name_a) != normalize(name_b):
                continue  # same document-chain family
            na, nb = normalize(name_a), normalize(name_b)
            numbered_family = (na != nb and
                               DIGITS_RE.sub("#", na) == DIGITS_RE.sub("#", nb))
            if na == nb:
                key = (pair, "exact")
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    rows.append(f"WARNING\t{rel_a} <> {rel_b}\t"
                                f"{kind_a} '{name_a}' duplicates "
                                f"{kind_b} '{name_b}'")
                continue
            matcher = SequenceMatcher(None, na, nb)
            fuzzy = (matcher.real_quick_ratio() >= threshold
                     and matcher.quick_ratio() >= threshold
                     and matcher.ratio() >= threshold)
            if fuzzy:
                key = (pair, "fuzzy")
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                if numbered_family:
                    # Names differing only in digits are usually an
                    # intentional sequence — but can hide transposed
                    # numbers, so surface as INFO, not WARNING.
                    rows.append(f"INFO\t{rel_a} <> {rel_b}\t"
                                f"numbered pair '{name_a}' ~ "
                                f"'{name_b}' — verify intentional")
                else:
                    rows.append(f"WARNING\t{rel_a} <> {rel_b}\t"
                                f"'{name_a}' ~ '{name_b}' "
                                f"(similarity {matcher.ratio():.2f})")
                continue
            # Not close in spelling — but do they *sound* the same?
            if numbered_family or type_a is None or type_a != type_b:
                continue
            if pair not in phonetic and sounds_alike(pw_a, pw_b):
                phonetic[pair] = (f"INFO\t{rel_a} <> {rel_b}\t"
                                  f"PHONETIC '{name_a}' ~ '{name_b}' "
                                  f"— sound-alike {type_a}s when read "
                                  f"aloud; verify they never share a scene")
    # A document pair the exact or fuzzy check already reported (under any
    # name/alias combination) gets no second, weaker row.
    for pair, row in phonetic.items():
        if (pair, "exact") not in seen_pairs and (pair, "fuzzy") not in seen_pairs:
            rows.append(row)
    return sorted(rows)


ATTACHMENT_RE = re.compile(r"\.(?!md$)[A-Za-z0-9]{1,6}$")


def check_index(vault: Path) -> list[str]:
    index_path = vault / "_meta" / "index.md"
    if not index_path.is_file():
        return ["INFO\t_meta/index.md\tno index file — skipping check"]
    index_text = index_path.read_text(encoding="utf-8", errors="replace")
    # Resolve like graph_check does: strip alias/anchor/path/.md, skip
    # attachment embeds (images, PDFs) — they are not note references.
    indexed = set()
    for raw in LINK_RE.findall(index_text):
        target = re.split(r"[#^|]", raw, maxsplit=1)[0].strip()
        if ATTACHMENT_RE.search(target.rsplit("/", 1)[-1]):
            continue
        indexed.add(link_target(raw))

    names = set()
    referenced_by = {}  # rel -> set of names that count as references
    content_files = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        stem = normalize(Path(rel).stem)
        names.add(stem)
        refs = {stem}
        aliases = fm.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                names.add(normalize(a))
                refs.add(normalize(a))
        referenced_by[rel] = refs
        # Underscore dirs are infrastructure, not indexable content.
        if not rel.split("/")[0].startswith("_"):
            content_files.append(rel)

    rows = []
    for rel in content_files:
        if not referenced_by[rel] & indexed:
            rows.append(f"WARNING\t{rel}\tnot referenced from "
                        f"_meta/index.md")
    for target in sorted(indexed):
        if target and target not in names:
            rows.append(f"WARNING\t_meta/index.md\tindex links "
                        f"'[[{target}]]' but no such file exists")
    return rows


def check_stale_drafts(vault: Path) -> list[str]:
    files = list(vault_files(vault))
    # Staleness is "how many sessions ago", which only means something inside a
    # chapter: numbering restarts, so a vault-wide max() made every draft in the
    # live chapter look many sessions old and told the GM to promote or delete
    # content written last week (#162). Track the latest session per chapter and
    # measure each draft against its own chapter's.
    per_chapter: dict[str | None, int] = {}
    for rel, text in files:
        fm = extract_frontmatter(text) or {}
        if fm.get("type") == "session":
            n = parse_session_number(fm.get("session_number"))
            if n:
                key = chapter_key(rel, fm)
                per_chapter[key] = max(per_chapter.get(key, 0), n)
    current = max(per_chapter.values(), default=0)
    chaptered = len([k for k in per_chapter if k is not None]) > 1
    rows = []
    if not current:
        return ["INFO\t(vault)\tno session entities with "
                "session_number — cannot compute staleness"]
    for rel, text in files:
        fm = extract_frontmatter(text) or {}
        if fm.get("canon_status") != "DRAFT":
            continue
        if fm.get("type") == "session-plan":
            continue  # prep content is always DRAFT — exempt
        created = parse_session_number(fm.get("createdSession"))
        own = chapter_key(rel, fm)
        if chaptered and own is None and created is not None:
            # Numbering restarts per chapter and this note names none, so its
            # createdSession cannot be placed on any timeline. Saying so beats
            # guessing against an unrelated chapter's count.
            rows.append(f"INFO\t{rel}\tDRAFT createdSession ({created}) "
                        f"cannot be dated — this vault numbers sessions per "
                        f"chapter and the note names no chapter")
            continue
        # Its own chapter's latest where known, else the vault-wide latest.
        now = per_chapter.get(own, current)
        if created is None:
            rows.append(f"WARNING\t{rel}\tDRAFT missing createdSession — "
                        f"cannot determine staleness; add it or promote")
        elif created > now:
            rows.append(f"WARNING\t{rel}\tcreatedSession ({created}) "
                        f"exceeds current session ({now}) — check "
                        f"the value (dates don't belong in this field)")
        elif now - created >= 3:
            rows.append(f"WARNING\t{rel}\tstale DRAFT (created session "
                        f"{created}, now session {now}) — promote "
                        f"to AUTHORITATIVE or delete")
    return rows


def check_changed(vault: Path, since: int) -> list[str]:
    """Entities touched at or after session N — the incremental-audit
    scope. Keys off session-anchored fields (asOfSession,
    createdSession, session, session_number), not calendar dates."""
    rows = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        reasons = []
        for field in ("asOfSession", "createdSession", "session",
                      "session_number"):
            n = parse_session_number(fm.get(field))
            if n is not None and n >= since:
                reasons.append(f"{field}={n}")
        if reasons:
            rows.append(f"INFO\t{rel}\t{', '.join(reasons)}")
    return rows


TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
ALIAS_LINK_RE = re.compile(r"\[\[[^\[\]]*\|[^\[\]]*\]\]")


def check_tables(vault: Path) -> list[str]:
    r"""Pipes inside table cells break the table when Obsidian reflows it.
    Flag aliased wikilinks ([[A|B]]) and escaped pipes (\|) inside table
    blocks. ERROR: deterministic render break the apprentice silently fixes
    as a chore (the level is internal — never shown to the GM as a report)."""
    rows = []
    for rel, text in vault_files(vault):
        body = list(iter_body_lines(text))
        is_row = [bool(TABLE_ROW_RE.match(ln)) for _, ln in body]
        for i, (lineno, ln) in enumerate(body):
            if not is_row[i]:
                continue
            # Require a table *block*: a stray piped prose line is not a table.
            neighbour = (i > 0 and is_row[i - 1]) or \
                        (i < len(body) - 1 and is_row[i + 1])
            if not neighbour:
                continue
            am = ALIAS_LINK_RE.search(ln)
            if am:
                rows.append(f"ERROR\t{rel}:{lineno}\taliased wikilink pipe "
                            f"in table cell breaks Obsidian reflow: "
                            f"{am.group(0)}")
            if "\\|" in ln:
                rows.append(f"ERROR\t{rel}:{lineno}\tescaped pipe '\\|' in "
                            f"table cell breaks Obsidian reflow")
    return rows


TIMELINE_SECTION_RE = re.compile(r"^##\s+Timeline\b", re.IGNORECASE | re.MULTILINE)
# A date-range marker in a string in_game_date: en/em dash, a spaced
# hyphen (so ISO "1893-05-01" is NOT a range), or a word form.
DATE_RANGE_RE = re.compile(
    r"[–—]|\s-|-\s|\bto\b|\bthrough\b|\bthru\b", re.IGNORECASE)


def _is_multi_day(value) -> bool:
    """Multi-day if in_game_date is a list of 2+ dates (the documented
    form) or a string expressing a range ("Sept 17–24", "1814 to 1815")."""
    if isinstance(value, list):
        return len([v for v in value if v is not None]) >= 2
    if isinstance(value, str):
        return bool(DATE_RANGE_RE.search(value))
    return False


def check_timeline(vault: Path) -> list[str]:
    """Internal 'is this multi-day?' cue (INFO, not a scold). When a
    `type: session-plan` spans multiple days (a 2+ list, or a string range)
    and has no `## Timeline` section, surface a cue so the apprentice can
    *offer to build the clock with the GM*. Single-day plans are silent."""
    rows = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "session-plan":
            continue
        if not _is_multi_day(fm.get("in_game_date")):
            continue
        if TIMELINE_SECTION_RE.search(text):
            continue
        rows.append(f"INFO\t{rel}\tmulti-day plan (in_game_date spans "
                    f"multiple days) — offer to build a '## Timeline' clock "
                    f"with the GM so hours and same-day travel stay coherent")
    return rows


def pc_name_regex(names: set[str]):
    """A single whole-word alternation, longest name first so multi-word
    names win over their tokens. None when there are no active PCs."""
    if not names:
        return None
    ordered = sorted(names, key=len, reverse=True)
    alt = "|".join(re.escape(n) for n in ordered)
    return re.compile(rf"\b({alt})\b", re.IGNORECASE)


READ_ALOUD_SCAN_TYPES = {"session-plan", "scene"}
SECOND_PERSON_RE = re.compile(
    r"\byou\s+(feel|feels|sense|senses|realize|realizes|realise|realises|"
    r"notice|notices|know|knows|want|wants|remember|remembers)\b",
    re.IGNORECASE)
THIRD_PERSON_RE = re.compile(r"\b(he|she|him|her|his|hers)\b", re.IGNORECASE)


def check_read_aloud(vault: Path) -> list[str]:
    """Read-aloud blockquote signal (INFO — a high-precision cue the
    apprentice uses to ask about a real read-aloud line, never a report the
    GM sees). Over `> ` blockquote lines in session-plan/scene files, flag a
    named PC, a 2nd-person feeling verb, or a 3rd-person pronoun. The Slice B
    plan-wide 'PC name as action subject' scan is intentionally *not* here —
    it scolded the GM's own prose."""
    pc_re = pc_name_regex(active_pc_names(vault))
    rows: list[str] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if entity_type(fm) not in READ_ALOUD_SCAN_TYPES:
            continue
        for lineno, line in iter_body_lines(text):
            stripped = line.lstrip()
            if not stripped.startswith(">"):
                continue
            bq = stripped.lstrip(">").strip()
            pm = pc_re.search(bq) if pc_re else None
            if pm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"names PC '{pm.group(0)}' — read-aloud addresses "
                            f"the table, not one PC")
            sm = SECOND_PERSON_RE.search(bq)
            if sm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"dictates player feeling: '{sm.group(0)}'")
            tm = THIRD_PERSON_RE.search(bq)
            if tm:
                rows.append(f"INFO\t{rel}:{lineno}\tread-aloud blockquote "
                            f"uses 3rd-person pronoun '{tm.group(0)}' "
                            f"(advisory — fine for NPCs)")
    return rows


def check_relationships(vault: Path) -> list[str]:
    """Every relationship predicate must come from the sanctioned vocabulary.

    An invented `type:` is worse than a vague one: no query, no
    inverse-inference and no publish step knows about it, so the edge is
    written and then silently ignored (issue #130 — one session's entity
    generation invented eleven of them). ERROR, with the nearest
    sanctioned predicates so the fix is a rename, not a hunt."""
    try:
        vocabulary = predicate_vocabulary()
        # Warm the inverse map here too: predicate_problem() reads it through
        # a second cache, and an unguarded load there would abort `all`.
        inverse_predicates()
    except (OSError, ValueError, KeyError, TypeError) as e:
        return [f"ERROR\t(vault)\tcannot read the predicate vocabulary "
                f"from shared/gm-apprentice-ontology.json: {e}"]
    rows = []
    for rel, text in vault_files(vault):
        for lineno, key, predicate in iter_relationship_predicates(text):
            if predicate in vocabulary:
                continue
            rows.append(f"ERROR\t{rel}:{lineno}\t"
                        f"{predicate_problem(key, predicate)} "
                        f"(map it via shared/relationship-normalization.md)")
    return rows


MIGRATION_HINT = ("run campaign-organizer's migration workflow "
                  "(references/migration-procedure.md) before proceeding")


def check_version(vault: Path) -> tuple[list[str], int]:
    """The vault/plugin semver gate eight skills open with.

    Returns (rows, exit code). The single row's first column is a
    *verdict*, not a level: this command exists to be branched on, and a
    skill that has to grep prose to learn whether it may proceed is the
    by-eye comparison all over again. Ordering is deliberate — an
    unknown plugin version is an ERROR before anything about the vault
    is read, and a vault with no `_meta/` is first-time SETUP rather
    than a failed migration.

    Comparison is numeric per component (`parse_version`), so 1.8.9 is
    correctly behind 1.10.0; a lexical compare put it ahead.
    """
    found = plugin_version()
    if found is None:
        return ([("ERROR\t(plugin)\tcannot determine the plugin version "
                  "(no .claude-plugin/plugin.json or shared/migrations.md)")],
                1)
    plugin, _source = found
    if not (vault / "_meta").is_dir():
        return (["SETUP\t(vault)\tno _meta/ — first-time setup, "
                 "not migration"], 0)
    rel = "_meta/vault-config.md"
    fm: dict = {}
    try:
        fm = extract_frontmatter((vault / "_meta" / "vault-config.md")
                                 .read_text(encoding="utf-8",
                                            errors="replace")) or {}
    except OSError:
        # A `_meta/` with no readable config is the same situation as a
        # config with no version field: the vault never recorded one.
        fm = {}
    current = fm.get("gm_apprentice_version")
    if not current or isinstance(current, list):
        return ([f"MISMATCH\t{rel}\tgm_apprentice_version absent — "
                 f"{MIGRATION_HINT}"], 1)
    vault_v, plugin_v = parse_version(str(current)), parse_version(plugin)
    if vault_v == plugin_v:
        return ([f"OK\t{rel}\tvault {current} = plugin {plugin}"], 0)
    if vault_v < plugin_v:
        return ([f"MISMATCH\t{rel}\tvault {current} < plugin {plugin} — "
                 f"{MIGRATION_HINT}"], 1)
    return ([f"AHEAD\t{rel}\tvault {current} > plugin {plugin} — update "
             f"the plugin before touching this vault"], 1)


def list_active_pcs(vault: Path) -> list[str]:
    """The roster the session skills open with, as `PC` rows.

    Level column is `PC` rather than INFO/WARNING/ERROR: nothing here is
    a finding, and labelling a roster INFO invites a triage pass over
    rows that only ever needed reading.
    """
    rows = []
    for rel, fm in active_pcs(vault):
        aliases = fm.get("aliases")
        names = ", ".join(str(a).strip() for a in aliases
                          if str(a).strip()) if isinstance(aliases, list) else ""
        as_of = fm.get("asOfSession")
        stamp = str(as_of) if as_of not in (None, "", []) else "?"
        rows.append(f"PC\t{rel}\t{Path(rel).stem}; "
                    f"aliases: {names or 'none'}; asOfSession: {stamp}")
    return rows


# YAML's null spellings, as `vaultlib.yaml_value_for_cli` writes them.
YAML_NULLS = {"", "null", "~"}

# Chain key -> (label used in prose, the `type:` values that fill it).
# Insertion order is the reporting order; the wrap-up has three spellings
# in the wild and all three are canon-bearing.
SESSION_DOC_TYPES: dict[str, tuple[str, set[str]]] = {
    "plan": ("plan", {"session-plan"}),
    "play_notes": ("play notes", {"session-play-notes"}),
    "wrap_up": ("wrap-up", set(WRAP_UP_TYPES)),
}


def _chain_document(files: list[tuple[str, str, dict]], stems: dict[str, str],
                    types: set[str], stem: str, number: int | None,
                    chapter: str | None) -> str | None:
    """The note of one chain type belonging to a session index, or None.

    A `session:` link naming the index wins outright. Otherwise the
    session number has to agree AND the chapter has to be compatible —
    numbering restarts per chapter, so number alone pairs Chapter 2's
    session 1 with Chapter 1's plan (#162's shape). An unresolvable
    chapter on either side still matches, mirroring
    `session_context.prefer_chapter`, which keeps flat vaults working.

    A document that names a *different* index is never claimed by the
    number fallback: it already said where it belongs.
    """
    key = normalize(stem)
    candidates: list[tuple[str, dict]] = []
    for rel, _text, fm in files:
        if entity_type(fm) not in types:
            continue
        link = wikilink_target(fm.get("session"))
        target = link_target(link) if link else ""
        if target and target == key:
            return rel
        if target and target in stems:
            continue
        if number is None:
            continue
        n = parse_session_number(fm.get("session"))
        if n is None:
            n = parse_session_number(fm.get("session_number"))
        if n == number:
            candidates.append((rel, fm))
    # The chapter's own document first, an unfiled one only as a fallback.
    # Taking whichever number match came first let an archived copy at the
    # vault root — which sorts before any Chapters/ path — outrank the
    # chapter's real wrap-up.
    if chapter is not None:
        own = [rel for rel, fm in candidates if chapter_key(rel, fm) == chapter]
        if own:
            return own[0]
    loose = [rel for rel, fm in candidates
             if chapter is None or chapter_key(rel, fm) is None]
    return loose[0] if loose else None


def check_sessions(vault: Path) -> list[str]:
    """Derive each session's status from the documents that exist.

    `shared/session-document-chain.md` defines status as "the furthest
    document that exists", which every skill has so far checked by
    reading four filenames and remembering the table. Here the chain is
    resolved both ways — the index's `documents:` links and the
    documents' own `session:`/number/chapter — so the two disagreeing is
    itself a finding rather than a silent divergence.
    """
    files = [(rel, text, extract_frontmatter(text) or {})
             for rel, text in vault_files(vault)]
    stems = {normalize(Path(rel).stem): rel for rel, _t, _f in files}
    by_rel = {rel: fm for rel, _t, fm in files}
    indexes = [(rel, text, fm) for rel, text, fm in files
               if fm.get("type") == "session"]
    if not indexes:
        return ["INFO\t(vault)\tno session indexes found"]

    rows: list[str] = []
    for rel, text, fm in indexes:
        stem = Path(rel).stem
        number = parse_session_number(fm.get("session_number"))
        if number is None:
            number = parse_session_number(stem)
        chapter = chapter_key(rel, fm)
        documents = nested_mapping(text, "documents")

        chain: dict[str, str | None] = {}
        broken: list[str] = []
        unlinked: list[str] = []
        for key, (kind, types) in SESSION_DOC_TYPES.items():
            target = wikilink_target(documents.get(key))
            if target.casefold() in YAML_NULLS:
                # `plan: null` is the schema's own placeholder for "this
                # document does not exist yet" — reporting it as a broken
                # link would fire on nearly every index in a live vault.
                target = ""
            linked = stems.get(link_target(target)) if target else None
            if target and linked is None:
                broken.append(f"WARNING\t{rel}\tdocuments.{key} links "
                              f"'[[{target}]]' but no such note exists")
            found = _chain_document(files, stems, types, stem, number, chapter)
            chain[key] = linked or found
            if found and not linked:
                unlinked.append(
                    f"INFO\t{rel}\t{kind} exists ({found}) but "
                    f"documents.{key} does not link it — stamp_entities.py "
                    f'VAULT "{rel}" --set '
                    f'documents.{key}="[[{Path(found).stem}]]"')

        wrap = chain["wrap_up"]
        if wrap:
            # A wrap-up the GM has confirmed is the 'reviewed' end state;
            # one still in DRAFT means the wrap-up exists, nothing more.
            derived = ("reviewed"
                       if by_rel.get(wrap, {}).get("canon_status")
                       == "AUTHORITATIVE" else "wrap-up")
        elif chain["play_notes"]:
            derived = "played"
        elif chain["plan"]:
            derived = "prepped"
        else:
            derived = "planned"

        flags = " ".join(
            f"{label}={'✓' if chain[key] else '–'}"
            for key, label in (("plan", "plan"), ("play_notes", "play-notes"),
                               ("wrap_up", "wrap-up")))
        status = fm.get("status")
        declared = (str(status) if status and not isinstance(status, list)
                    else "?")
        rows.append(f"INFO\t{rel}\tsession "
                    f"{number if number is not None else '?'}: {flags} "
                    f"declared={declared} derived={derived}")
        if declared != derived:
            rows.append(f"WARNING\t{rel}\tstatus '{declared}' but the "
                        f"documents that exist derive '{derived}' — "
                        f'stamp_entities.py VAULT "{rel}" '
                        f"--set status={derived}")
        rows.extend(broken)
        rows.extend(unlinked)
    return rows


# --------------------------------------------------------------------------
# Publish safety
#
# Both checks answer the same question — "would a player see this?" — and
# both answer it through `scan_body`, which mirrors the publish pipeline's
# own fence tracking and section filter. That containment is the whole
# point: a grep for "Keeper" cannot tell a heading nested under an excluded
# `## GM Notes` from a sibling beside it, and reporting the first would
# train the GM to ignore the second.
# --------------------------------------------------------------------------

# graph-health.md, "Un-fenced GM-only content". Matched as substrings of a
# casefolded title, so "Tactics" hits "tactic" and "Secrets" hits "secret".
KEEPER_WORDS = ("keeper", "gm only", "gm-only", "dm only", "secret",
                "tactic", "confidential", "spoiler")

# Types the publish pipeline never builds a page for. Nothing in them can
# leak however it is written, and flagging their (correctly) Keeper-facing
# headings would bury the findings that matter.
GM_LEAK_SKIP_TYPES = {"session-plan", "session-play-notes", "plan", "meta"}

# A bold label opening a paragraph: `**Secret:** he lied.` The colon is
# optional and is dropped from the captured label.
BOLD_LABEL_RE = re.compile(r"^\*\*([^*]+?):?\*\*")
# A labelled Current Status field: `**Location:** the quay`.
LABELLED_FIELD_RE = re.compile(r"^\*\*[A-Za-z][^*]*:\*\*")
CALLOUT_RE = re.compile(r"^>\s*\[!(\w[\w-]*)\]\s*(.*)")
# "GM" as a word — "gm" inside "Kingman" is not a Keeper marker.
GM_WORD_RE = re.compile(r"\bgm\b")
# Emphasis wrapping a whole heading title. `### **GM Notes**` is the case
# that matters: processor.js `filterSections` compares the raw title, so
# the asterisks turn an excluded section into a published one. Single
# markers are in the alternation too — `### *GM Notes*` defeats the
# exclude list in exactly the same way, and landing it at WARNING would
# under-state a section that publishes in full.
EMPHASIS_RE = re.compile(r"^(\*\*|\*|__|_)(.+?)\1$")

FENCE_PROBLEM_RE = re.compile(r"^line (\d+): (.*)$")


def _fence_rows(rel: str, problems: list[str],
                kept: set[int] | None = None) -> list[str]:
    """`scan_body`'s authoring problems as rows, with the consequence named.

    An orphan closer is the worse of the two and is the ERROR: depth never
    went above zero, so nothing above it was ever hidden and the GM has no
    way to tell by looking. A block left open at EOF at least fails safe —
    the publish tool strips everything from the opener down.

    `kept` is the stub-page line filter (None = the whole file publishes).
    """
    rows: list[str] = []
    for problem in problems:
        m = FENCE_PROBLEM_RE.match(problem)
        if not m:
            # A problem shape this function does not know. Passing it
            # through verbatim is noisy exactly once; dropping it would
            # lose a new class of leak silently, forever.
            rows.append(f"WARNING\t{rel}\t{problem}")
            continue
        lineno, detail = m.group(1), m.group(2)
        if kept is not None and int(lineno) not in kept:
            continue
        if "with no opener" in detail:
            rows.append(f"ERROR\t{rel}:{lineno}\t{detail} — "
                        f"everything above it publishes")
        else:
            rows.append(f"WARNING\t{rel}:{lineno}\t{detail} — "
                        f"publish strips to end of file")
    return rows


def _keeper_text(text: str, excludes: list[str]) -> bool:
    """Does this title or label read as Keeper-facing?"""
    low = text.casefold()
    return (any(word in low for word in KEEPER_WORDS)
            or any(s.casefold() in low for s in excludes))


def _heading_leak(rel: str, state: LineState, excludes: list[str]) -> list[str]:
    """Rows for one published heading line."""
    if state.heading is None:
        return []
    _level, raw = state.heading
    m = EMPHASIS_RE.match(raw)
    title = m.group(2).strip() if m else raw
    if title.casefold() in {s.casefold() for s in excludes}:
        # An unwrapped exact match never reaches here: `scan_body` has
        # already marked that line excluded, exactly as the site would.
        # Only the emphasis-wrapped spelling survives to publish. The
        # remedy names the marker actually used, so the `*`/`_` spellings
        # do not send the GM hunting for asterisks that are not there.
        marker = m.group(1) if m else "**"
        return [f"ERROR\t{rel}:{state.lineno}\tbold-wrapped heading "
                f"'{title}' defeats the exclude list and publishes — "
                f"remove the {marker} or move it under ## GM Notes"]
    if _keeper_text(title, excludes):
        return [f"WARNING\t{rel}:{state.lineno}\tKeeper-facing heading "
                f"'{title}' publishes — nest it under ## GM Notes or fence it"]
    return []


def _published_linenos(states: list[LineState],
                       fm: dict) -> set[int] | None:
    """Which body lines a `publish: stub` page actually ships, or None.

    None means every line — the page is not a stub. Mirrors
    processor.js `keepOnlySections`, which build.js applies to a stub
    page's body before anything downstream reads it: content runs from an
    included heading down to the next heading at its level or shallower,
    and an absent or empty `publish_include_sections` ships nothing at
    all. Headings are matched on the raw line rather than through
    `LineState.heading`, because `keepOnlySections` — like
    `filterSections` — does no code-fence tracking, and the whole point
    of this helper is to agree with the tool.
    """
    if publish_mode(fm) != "stub":
        return None
    raw = fm.get("publish_include_sections")
    include = raw if isinstance(raw, list) else []
    wanted = {str(s).strip().casefold() for s in include if isinstance(s, str)}
    kept: set[int] = set()
    if not wanted:
        return kept
    keeping = False
    keep_level = 0
    for state in states:
        m = HEADING_RE.match(state.line)
        if m:
            level = len(m.group(1))
            if keeping and level <= keep_level:
                keeping = False
            if m.group(2).strip().casefold() in wanted:
                keeping = True
                keep_level = level
        if keeping:
            kept.add(state.lineno)
    return kept


def check_gm_leak(vault: Path, folder: str | None) -> list[str]:
    """Keeper-facing content that would actually reach the player site.

    Mechanises graph-health.md's "Un-fenced GM-only content" prose. The
    levels encode how mechanical the fix is: a heading can be moved or
    renamed (ERROR/WARNING), while a bold label or a callout is prose the
    GM has to judge (INFO) — neither is auto-movable without rewriting
    the paragraph around it.

    Every line is filtered through `scan_body`, so nothing inside a
    `<!-- gm-only -->`/`<!-- spoiler -->` fence, under an excluded
    heading, or inside a code fence is ever reported — and the file's own
    `publish:` gate is honoured first: a `publish: false` page is dropped
    before the site's link map exists, and a `publish: stub` page is
    reduced to `publish_include_sections`, so neither can leak whatever
    its headings say.

    A file's fence problems lead its rows rather than falling into line
    order: an orphan closer changes what every line above it means, so
    it is the first thing to read, not the fifth.
    """
    excludes = effective_exclude_sections(vault)
    rows: list[str] = []
    for rel, text in vault_files(vault, folder):
        fm = extract_frontmatter(text) or {}
        if entity_type(fm) in GM_LEAK_SKIP_TYPES:
            continue
        if publish_mode(fm) == "none":
            continue
        states, problems = scan_body(text, excludes)
        kept = _published_linenos(states, fm)
        if kept is not None and not kept:
            continue
        rows.extend(_fence_rows(rel, problems, kept))
        for state in states:
            if kept is not None and state.lineno not in kept:
                continue
            # `published` deliberately says nothing about code fences —
            # vaultlib's divergence note — so exclude them here, or this
            # repo's own documented examples become findings.
            if state.in_code or not state.published:
                continue
            if state.heading is not None:
                rows.extend(_heading_leak(rel, state, excludes))
                continue
            bold = BOLD_LABEL_RE.match(state.line)
            if bold and _keeper_text(bold.group(1), excludes):
                rows.append(f"INFO\t{rel}:{state.lineno}\tbold label "
                            f"'{bold.group(1)}' looks Keeper-facing — confirm "
                            f"with the GM (not a heading; not auto-movable)")
                continue
            callout = CALLOUT_RE.match(state.line)
            if callout:
                ctype, title = callout.group(1), callout.group(2).strip()
                low = f"{ctype} {title}".casefold()
                if GM_WORD_RE.search(low) or "keeper" in low:
                    label = f"[!{ctype}] {title}".strip()
                    rows.append(f"INFO\t{rel}:{state.lineno}\tcallout {label} "
                                f"reads Keeper-facing — confirm it should "
                                f"publish")
    return rows


CURRENT_STATUS = "current status"
# The two protected sections `## Current Status` must precede.
PROTECTED_H2 = {"notes", "gm notes"}
CANONICAL_FIRST_H2 = "Stat Sheet"


def _has_labelled_field(states: list[LineState], start: LineState,
                        level: int, kept: set[int] | None = None) -> bool:
    """Does the block `start` opens carry any `**Label:**` field?

    The block runs to the next heading of the same level or shallower —
    the same span the publish tool and session-wrapup read. `kept` is the
    stub-page line filter: a field the site never ships cannot be the one
    a machine consumer reads.
    """
    for state in states:
        if state.lineno <= start.lineno:
            continue
        if kept is not None and state.lineno not in kept:
            continue
        if state.heading is not None and state.heading[0] <= level:
            break
        if not state.in_code and LABELLED_FIELD_RE.match(state.line):
            return True
    return False


def check_pc_body(vault: Path, folder: str | None = None) -> list[str]:
    """PC sheet skeleton and `## Current Status` placement.

    `shared/pc-body-structure.md` makes three promises about the block
    that every downstream consumer relies on: it publishes, it sits
    before the protected sections, and its labelled fields are readable
    by machine. Each is checked here at the level its breakage deserves —
    a fenced block silently drops the PC's current state from the site
    (ERROR), a misplaced or duplicated heading is a structure the GM
    should fix (WARNING), and a missing block or an off-skeleton opening
    is context for the auditing skill (INFO).

    Every `type: pc` file is checked, whatever its status: a retired PC's
    page still publishes. `*_Story.md` companions are narrative history,
    not sheets, and are skipped, as is any sheet the `publish:` gate
    keeps off the site — a `publish: false` PC's Current Status cannot
    leak from inside a fence, because the page does not exist.
    """
    excludes = effective_exclude_sections(vault)
    rows: list[str] = []
    for rel, text in vault_files(vault, folder):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if publish_mode(fm) == "none":
            continue
        states, problems = scan_body(text, excludes)
        kept = _published_linenos(states, fm)
        if kept is not None and not kept:
            continue
        rows.extend(_fence_rows(rel, problems, kept))

        headings: list[tuple[LineState, int, str]] = []
        for state in states:
            if kept is not None and state.lineno not in kept:
                continue
            if state.heading is not None:
                headings.append((state, state.heading[0], state.heading[1]))
        h2s = [(s, title) for s, level, title in headings if level == 2]

        named = [h for h in headings if h[2].casefold() == CURRENT_STATUS]
        current = next((h for h in named if h[1] == 2), None)
        if current is None and named:
            current = named[0]

        if current is None:
            # On a stub only a named fragment of the sheet publishes, so
            # "this sheet has no Current Status" is a claim the published
            # page cannot support — the block may well exist, unshipped.
            if kept is None:
                rows.append(f"INFO\t{rel}\tno ## Current Status block — "
                            f"session-wrapup Step 3c creates it")
        else:
            state, level, _title = current
            n = state.lineno
            if state.gm_depth or state.spoiler_depth:
                rows.append(f"ERROR\t{rel}:{n}\t## Current Status is inside "
                            f"a <!-- gm-only --> / <!-- spoiler --> fence — "
                            f"it publishes; move it outside")
            if level != 2:
                rows.append(f"WARNING\t{rel}:{n}\tCurrent Status is an "
                            f"H{level} — it must be an H2 outside the "
                            f"protected sections")
            protected = [(s.lineno, title) for s, title in h2s
                         if title.casefold() in PROTECTED_H2]
            if protected:
                first_line, first_title = min(protected)
                if n > first_line:
                    rows.append(f"WARNING\t{rel}:{n}\t## Current Status "
                                f"comes after ## {first_title} — it must "
                                f"precede the protected sections")
            if not _has_labelled_field(states, state, level, kept):
                rows.append(f"INFO\t{rel}:{n}\t## Current Status has no "
                            f"labelled fields (**Location:** …) — machine "
                            f"consumers read the labels")

        seen: set[str] = set()
        for s, title in h2s:
            key = title.casefold()
            if key in seen:
                rows.append(f"WARNING\t{rel}:{s.lineno}\t"
                            f"duplicate H2 '{title}'")
            seen.add(key)

        if kept is None and h2s \
                and h2s[0][1].casefold() != CANONICAL_FIRST_H2.casefold():
            rows.append(f"INFO\t{rel}\tfirst body H2 is '## {h2s[0][1]}' — "
                        f"the canonical skeleton opens with "
                        f"## {CANONICAL_FIRST_H2}")
    return rows


# --------------------------------------------------------------------------
# Session Wrap-Up conformance
#
# Mechanises campaign-qa/references/checks/wrapup-conformance.md Steps 2–4
# and, as `--fix`, the structural half of the 1.9.4 → 1.9.5 migration. The
# failure this exists to prevent is narrow and expensive: a Keeper-facing
# `## Open Questions for Reconcile` sits beside `## Narrative Recap` rather
# than under `## GM Notes`, no exclude list anticipates its name, and it
# publishes to the player site in full.
#
# Every fix is content-preserving. Headings move, are demoted, and are
# renamed to the template's own names; frontmatter is backfilled from the
# session index and from date evidence already written in the body. No
# prose is reworded, nothing is deleted except a legacy date key whose
# value has been carried across intact, and a conformant file comes back
# byte-identical.
# --------------------------------------------------------------------------

# The three spellings in the wild. Enumeration is by `type:` only —
# `Session NN - Title - Wrap-Up.md`, `Session_NN_Wrap_Up.md` and the
# chapter-level variants have no filename in common.
WRAP_TYPES = SESSION_DOC_TYPES["wrap_up"][1]
CANONICAL_WRAP_TYPE = "session_wrap"

WRAP_TEMPLATE_PATH = (Path(__file__).resolve().parent.parent
                      / "templates" / "session-wrap.md")
# Used only when the template is missing — a skill zip that shipped
# without it must still normalise decorated headings rather than silently
# stop recognising them.
WRAP_SUBSECTIONS_FALLBACK: tuple[str, ...] = (
    "Quick Bullets", "PC Carry-Forward", "What Carries Forward",
    "World State", "Keeper Checklist",
    "Name Conflicts (export vs. vault canon)", "Cross-Entity Claims",
    "World Fact Findings", "Quality Notes", "Handoff to session-prep",
    "Reconciliation Context",
)


def _wrap_template_subsections() -> tuple[str, ...]:
    """The `###` names in shared/templates/session-wrap.md.

    Read from the template rather than transcribed, so adding a
    subsection there teaches the decorated-heading rename about it
    without a code change. Resolved from this file's own location, like
    `schema_rules.ONTOLOGY_PATH`: the template travels with the plugin,
    never with the vault under audit.
    """
    try:
        text = WRAP_TEMPLATE_PATH.read_text(encoding="utf-8")
    except OSError:
        return WRAP_SUBSECTIONS_FALLBACK
    found = tuple(m.group(1).strip() for m
                  in re.finditer(r"^###\s+(.+)$", text, re.MULTILINE))
    return found or WRAP_SUBSECTIONS_FALLBACK


WRAP_TEMPLATE_SUBSECTIONS = _wrap_template_subsections()

NARRATIVE_RECAP = "Narrative Recap"
MEMORABLE_MOMENTS = "memorable moments"
GM_NOTES = "gm notes"
RECONCILIATION_CONTEXT = "reconciliation context"
# A recap by any of the names three campaign vaults actually used.
RECAP_TITLES = {"recap", "session recap", "what happened"}
GM_ONLY_OPEN = "<!-- gm-only -->"
GM_ONLY_CLOSE = "<!-- /gm-only -->"
GM_MARKERS = ("open-gm", "close-gm")

# `session: "[[Session 07 - The Ball]]"` and nothing else. An integer, a
# bare title, or an unquoted `[[link]]` (a YAML flow sequence to every
# real parser) all fail this.
QUOTED_LINK_RE = re.compile(r'^(["\'])\[\[[^\[\]]+\]\]\1\s*(?:#.*)?$')
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SESSION_IN_NAME_RE = re.compile(r"session[ _-]?(\d+)", re.IGNORECASE)
WRAP_FILENAME_RE = re.compile(r"^Chapter_\d{2}_Session_\d{2}_Wrap_Up$")
CHAPTER_WRAP_FILENAME_RE = re.compile(r"^Chapter_\d+_Wrap_Up$")
RECONSTRUCTION_NOTE_RE = re.compile(
    r"^>\s*\[!\w[\w-]*\]\s*Reconstruction Note", re.IGNORECASE)
RECONCILED_LINE_RE = re.compile(
    r"\*\*Reconciled:?\*\*[^\n]*?(\d{4}-\d{2}-\d{2})", re.IGNORECASE)
# MULTILINE, because the section text this is searched against starts
# with its own heading — anchored at the string start it could never
# match the callout on line two, which is where reconcile writes it.
RECONCILED_CALLOUT_RE = re.compile(
    r"^>\s*(?:\[!\w[\w-]*\]\s*)?[^\n]*reconcil[^\n]*?(\d{4}-\d{2}-\d{2})",
    re.IGNORECASE | re.MULTILINE)
# The legacy date keys, newest spelling last so `_end` wins the mapping.
LEGACY_DATE_KEYS = ("in_game_dates", "in_game_date_start", "in_game_date_end")
# The qualifier separators a decorated heading actually uses.
HEADING_QUALIFIER_SEPARATORS = (" — ", " – ", " - ", ":")


@dataclass
class Finding:
    """One wrap-up finding, and what `--fix` would do about it.

    `kind` is how the fix layer reads a finding back: `fm` carries a
    frontmatter operation in `data`, the structural kinds drive the
    re-nest, and `""` is a finding with no mechanical repair at all.
    """

    level: str
    where: str
    message: str
    kind: str = ""
    data: tuple[str, ...] = field(default_factory=tuple)

    @property
    def row(self) -> str:
        return f"{self.level}\t{self.where}\t{self.message}"


@dataclass
class WrapContext:
    """What one wrap-up's fixes can be derived from.

    Resolution is deliberately all-or-nothing: a session index that is
    merely the most likely of several is not a fact, and writing a
    `session:` link from a guess is how a wrap-up ends up pointing at
    another chapter's session (#162's shape). `ambiguous_*` says the
    candidates existed and disagreed, so the row can say so.
    """

    number: int | None
    index_rel: str | None = None
    index_text: str = ""
    ambiguous_index: bool = False
    notes_rel: str | None = None
    ambiguous_notes: bool = False


def is_recap_title(title: str) -> bool:
    """A recap H2 under any of its spellings."""
    low = title.casefold().strip()
    return "narrative recap" in low or low in RECAP_TITLES


def decorated_heading(title: str) -> tuple[str, str] | None:
    """(template name, qualifier) for `Cross-Entity Claims — Held`.

    Only a template `###` name followed by a separator counts: a
    heading the template does not know is the GM's own, and renaming it
    would be a content edit rather than a conformance fix.
    """
    low = title.casefold()
    for name in sorted(WRAP_TEMPLATE_SUBSECTIONS, key=len, reverse=True):
        for sep in HEADING_QUALIFIER_SEPARATORS:
            prefix = f"{name}{sep}".casefold()
            if low.startswith(prefix) and title[len(prefix):].strip():
                return name, title[len(prefix):].strip()
    return None


def _wrap_eol(text: str) -> str:
    """The file's line ending: CRLF if the file uses it anywhere, else LF.

    A file with genuinely mixed endings is therefore normalised to CRLF
    by a re-nest. That is a deliberate simplification — mixed endings
    are already ambiguous to every tool that reads the vault — and it
    keeps a uniform file, which is every real one, byte-identical.

    The same applies to the exotic separators `str.splitlines()` also
    breaks on (`\\x0b`, `\\x0c`, U+2028, U+2029): a re-nest rejoins with
    this EOL, so they become ordinary line breaks. No content is lost,
    and no vault has ever carried one.
    """
    return "\r\n" if "\r\n" in text else "\n"


def _session_number_of(rel: str, fm: dict) -> int | None:
    """This note's session number, from frontmatter or its filename."""
    for key in ("session_number", "session"):
        n = parse_session_number(fm.get(key))
        if n is not None:
            return n
    m = SESSION_IN_NAME_RE.search(Path(rel).stem)
    return int(m.group(1)) if m else None


def _chapters_agree(a: str | None, b: str | None) -> bool:
    """Chapter compatibility, mirroring `session_context.prefer_chapter`:
    an unresolvable chapter on either side still matches, which is what
    keeps flat vaults working."""
    return a is None or b is None or a == b


def _wrap_context(rel: str, fm: dict,
                  entries: list[tuple[str, str, dict]]) -> WrapContext:
    """Resolve the session index and play notes this wrap-up belongs to."""
    chapter = chapter_key(rel, fm)
    ctx = WrapContext(number=_session_number_of(rel, fm))

    indexes = [(r, t, f) for r, t, f in entries if f.get("type") == "session"]
    link = wikilink_target(fm.get("session"))
    if link:
        target = link_target(link)
        named = [(r, t) for r, t, _f in indexes
                 if normalize(Path(r).stem) == target]
        if len(named) == 1:
            ctx.index_rel, ctx.index_text = named[0]
    if ctx.index_rel is None:
        found = [(r, t) for r, t, f in indexes
                 if ctx.number is not None
                 and _session_number_of(r, f) == ctx.number
                 and _chapters_agree(chapter, chapter_key(r, f))]
        if len(found) == 1:
            ctx.index_rel, ctx.index_text = found[0]
        elif found:
            ctx.ambiguous_index = True

    notes = [r for r, _t, f in entries
             if f.get("type") == "session-play-notes"
             and ctx.number is not None
             and _session_number_of(r, f) == ctx.number
             and _chapters_agree(chapter, chapter_key(r, f))]
    if len(notes) == 1:
        ctx.notes_rel = notes[0]
    elif notes:
        ctx.ambiguous_notes = True
    return ctx


def _index_value(ctx: WrapContext, key: str) -> str | None:
    """A raw frontmatter value from the resolved session index.

    The frontmatter span, not the whole file: `get_key` matches `^key:`
    at column 0, and a session index whose body quotes a YAML example
    would otherwise have that example's `chapter:` backfilled into a
    wrap-up's real frontmatter by `--fix`.
    """
    if ctx.index_rel is None:
        return None
    lines = ctx.index_text.splitlines(keepends=True)
    close, err = frontmatter_span(lines)
    if err:
        return None
    value = get_key(lines[1:close], key)
    return value or None


def _wrap_section(states: list[LineState], title: str) -> list[LineState]:
    """The lines of the first `## `/`### ` block with this title.

    Runs to the next heading at the same level or shallower — the same
    span the publish tool reads.
    """
    out: list[LineState] = []
    level: int | None = None
    for state in states:
        if state.heading is not None:
            if level is not None and state.heading[0] <= level:
                break
            if level is None and state.heading[1].casefold() == title:
                level = state.heading[0]
                out.append(state)
                continue
        if level is not None:
            out.append(state)
    return out


# `delete_key` removes one line; on a key whose value is a block list
# that would leave the `- "…"` items behind as orphan YAML, so the fix
# layer has to be able to tell the two shapes apart. Shared with
# `stamp_entities.py --repair-canon`, which refuses a block-valued legacy
# key for the same reason.
_opens_a_block = opens_a_block


def _legacy_dates(fm_lines: list[str]) -> tuple[list[str], str, str, str]:
    """(legacy keys present, range start, range end, value form).

    `in_game_date_start`/`_end` win over `in_game_dates` when both are
    written. A string `in_game_dates` that reads as a range is split on
    its own range marker, so `"5–6 March 1814"` is recognised as the
    two-day span it is rather than a single opaque value.

    The form is `scalar`, `block`, or `empty`. Neither of the last two
    may be fixed: `delete_key` removes one line, which on a block list
    would leave the `- "…"` items behind as orphan YAML, and an empty
    value carries no date to carry across. A corrupt or invented value
    is worse than an unmigrated one.
    """
    present = [k for k in LEGACY_DATE_KEYS if get_key(fm_lines, k) is not None]
    if not present:
        return [], "", "", "scalar"
    blank = [k for k in present if not (get_key(fm_lines, k) or "").strip()]
    if blank:
        form = "block" if any(_opens_a_block(fm_lines, k) for k in blank) \
            else "empty"
        return present, "", "", form
    start = scalar_value(get_key(fm_lines, "in_game_date_start") or "")
    end = scalar_value(get_key(fm_lines, "in_game_date_end") or "")
    if start or end:
        return present, start or end, end or start, "scalar"
    raw = get_key(fm_lines, "in_game_dates") or ""
    if raw.startswith("[") and raw.endswith("]"):
        items = [v.strip().strip("\"'") for v in raw[1:-1].split(",")
                 if v.strip()]
        if items:
            return present, items[0], items[-1], "scalar"
        return present, "", "", "empty"
    value = scalar_value(raw)
    m = DATE_RANGE_RE.search(value)
    if m:
        return (present, value[:m.start()].strip(),
                value[m.end():].strip() or value, "scalar")
    return present, value, value, "scalar"


def wrapup_frontmatter_findings(rel: str, text: str,
                                ctx: WrapContext) -> list[Finding]:
    """Step 2 of the conformance check, as findings carrying their fix.

    Field order follows the template's own frontmatter block, so a file
    that needs every backfill comes out reading like the template rather
    than like the order the checks happen to run in.
    """
    lines = text.splitlines(keepends=True)
    close, err = frontmatter_span(lines)
    if err:
        return [Finding("ERROR", rel, f"{err} — frontmatter not checked")]
    fm_lines = lines[1:close]
    body = "".join(lines[close + 1:])
    out: list[Finding] = []

    etype = scalar_value(get_key(fm_lines, "type") or "")
    if etype and etype != CANONICAL_WRAP_TYPE:
        out.append(Finding(
            "INFO", rel,
            f"type: '{etype}' — normalise to {CANONICAL_WRAP_TYPE}",
            "fm", ("set", "type", CANONICAL_WRAP_TYPE)))

    link = (f'"[[{Path(ctx.index_rel).stem}]]"'
            if ctx.index_rel is not None else "")
    session = get_key(fm_lines, "session")
    if session is None or not QUOTED_LINK_RE.match(session):
        shown = "absent" if session is None else session
        if link:
            out.append(Finding(
                "WARNING", rel,
                f"session: {shown} is not a quoted wiki-link — derive {link}",
                "fm", ("set", "session", link)))
        else:
            out.append(Finding(
                "WARNING", rel,
                f"session: {shown} is not a quoted wiki-link — no unique "
                f"session index matches; set it by hand (a chapter-level "
                f"wrap-up keeps its own value)"))

    if get_key(fm_lines, "session_number") is None:
        if ctx.number is not None:
            out.append(Finding(
                "INFO", rel, f"session_number: absent — backfill {ctx.number}",
                "fm", ("set", "session_number", str(ctx.number))))
        else:
            out.append(Finding(
                "INFO", rel, "session_number: absent — no session index or "
                             "filename gives a number"))

    play_date = get_key(fm_lines, "play_date")
    if play_date is None:
        out.append(Finding("INFO", rel, "play_date: absent — add "
                                        "play_date: null",
                           "fm", ("set", "play_date", "null")))
    else:
        value = scalar_value(play_date)
        if value.casefold() not in YAML_NULLS and not ISO_DATE_RE.match(value):
            out.append(Finding(
                "INFO", rel,
                f"play_date: '{value}' is not YYYY-MM-DD — fix it by hand"))

    legacy, start, end, form = _legacy_dates(fm_lines)
    has_date = get_key(fm_lines, "in_game_date") is not None
    if legacy and form == "block":
        out.append(Finding(
            "WARNING", rel,
            f"legacy {', '.join(legacy)} is a block list — map it to "
            f"in_game_date and remove the block by hand"))
    elif legacy and form == "empty":
        out.append(Finding(
            "WARNING", rel,
            f"legacy {', '.join(legacy)} has an empty value — set "
            f"in_game_date by hand"))
    elif legacy and not has_date:
        names = ", ".join(legacy)
        if start != end:
            out.append(Finding(
                "WARNING", rel,
                f"legacy {names} — range {start}–{end} must be preserved in "
                f"body prose before removing the legacy keys"))
        else:
            value = yaml_scalar(end) if end else "null"
            out.append(Finding(
                "INFO", rel,
                f"legacy {names} — map to in_game_date: {value} and remove "
                f"the legacy key(s)",
                "fm", ("set", "in_game_date", value)))
            for key in legacy:
                out.append(Finding("INFO", rel,
                                   f"legacy {key} — remove once mapped",
                                   "fm", ("delete", key, "")))
    elif legacy:
        out.append(Finding(
            "INFO", rel,
            f"legacy {', '.join(legacy)} alongside in_game_date — remove the "
            f"legacy key(s) once the range is in body prose"))
    elif not has_date:
        out.append(Finding("INFO", rel, "in_game_date: absent — add "
                                        "in_game_date: null",
                           "fm", ("set", "in_game_date", "null")))

    if get_key(fm_lines, "source_document") is None:
        if ctx.notes_rel is not None:
            value = f'"[[{Path(ctx.notes_rel).stem}]]"'
            out.append(Finding(
                "INFO", rel,
                f"source_document: absent — backfill {value}",
                "fm", ("set", "source_document", value)))
        else:
            reason = ("more than one" if ctx.ambiguous_notes else "no")
            out.append(Finding(
                "INFO", rel,
                f"source_document: absent — {reason} play notes resolve to "
                f"this session; add it by hand"))

    out.extend(_reconciled_findings(rel, text, fm_lines))

    for key, label in (("chapter", "chapter"), ("campaign", "campaign")):
        if get_key(fm_lines, key) is not None:
            continue
        inherited = _index_value(ctx, key)
        if inherited:
            out.append(Finding(
                "INFO", rel,
                f"{label}: absent — backfill {inherited} from the session "
                f"index", "fm", ("set", key, inherited)))
        else:
            out.append(Finding(
                "INFO", rel,
                f"{label}: absent — no session index resolves it; set it "
                f"by hand"))

    if get_key(fm_lines, "created_by") is None:
        who = ("vault-ingest"
               if any(RECONSTRUCTION_NOTE_RE.match(ln)
                      for ln in body.splitlines())
               else "session-wrapup")
        out.append(Finding("INFO", rel,
                           f"created_by: absent — backfill {who}",
                           "fm", ("set", "created_by", who)))
    if get_key(fm_lines, "tags") is None:
        out.append(Finding("INFO", rel, "tags: absent — backfill []",
                           "fm", ("set", "tags", "[]")))
    return out


def _reconciled_findings(rel: str, text: str,
                         fm_lines: list[str]) -> list[Finding]:
    """`reconciled:` backfill, and the promotion it can't explain.

    The date is never invented: it is read back out of the
    Reconciliation Context the reconcile pass already wrote. A section
    with no date in it is the one case the script refuses — asking the
    GM once beats stamping a guess into a machine-read field.
    """
    states, _problems = scan_body(text, ())
    section_states = _wrap_section(states, RECONCILIATION_CONTEXT)
    section = "\n".join(s.line for s in section_states)
    raw = get_key(fm_lines, "reconciled")
    value = scalar_value(raw) if raw is not None else ""
    out: list[Finding] = []

    if raw is None:
        date = None
        if section:
            m = (RECONCILED_LINE_RE.search(section)
                 or RECONCILED_CALLOUT_RE.search(section))
            date = m.group(1) if m else None
        if date:
            out.append(Finding(
                "INFO", rel,
                f'reconciled: absent — backfill "{date}" from the '
                f"Reconciliation Context",
                "fm", ("set", "reconciled", f'"{date}"')))
        elif section:
            out.append(Finding(
                "INFO", rel,
                "reconciled: absent and the Reconciliation Context carries "
                "no date — ask the GM once for the date (or confirm null)"))
        else:
            out.append(Finding(
                "INFO", rel,
                "reconciled: absent — no Reconciliation Context; add "
                "reconciled: null",
                "fm", ("set", "reconciled", "null")))

    empty = raw is None or value.casefold() in YAML_NULLS
    canon = scalar_value(get_key(fm_lines, "canon_status") or "")
    if canon == "AUTHORITATIVE" and empty and not section:
        out.append(Finding(
            "WARNING", rel,
            "canon_status: AUTHORITATIVE with reconciled: null and no "
            "Reconciliation Context — the promotion bypassed reconcile"))
    if section and canon == "DRAFT":
        out.append(Finding(
            "INFO", rel,
            "Reconciliation Context present while canon_status: DRAFT — "
            "reconcile promotes to AUTHORITATIVE"))
    return out


def wrapup_structure_findings(rel: str, text: str,
                              exclude: list[str]) -> list[Finding]:
    """Step 3 — publish safety. Every H2 is Keeper-facing by default.

    Player-facing H2s are exactly the recap and `## Memorable Moments`;
    anything else beside them is drift the re-nest repairs. The level
    says what it costs today: an ERROR publishes, a WARNING is already
    hidden by a fence or by the vault's effective exclude list and is
    structure drift only. A heading quoted inside a code fence is
    documentation — reported, never moved.

    Two fence shapes stop the re-nest for the whole file, because both
    make "what is the GM region?" a question only the GM can answer: a
    pair with one end inside a player-facing section and the other
    outside it (either placement changes what publishes), and a pair
    that never closes or closes without an opener.
    """
    states, problems = scan_body(text, exclude)
    preserved, crossing = _gm_pair_plan(states)
    infos = _fence_infos(states)
    out: list[Finding] = []
    for lineno in crossing:
        out.append(Finding(
            "ERROR", f"{rel}:{lineno}",
            "gm-only fence crosses a player-facing section boundary — "
            "re-nest by hand", "fence-crosses"))
    fence_rows = _fence_rows(rel, problems)
    for row in fence_rows:
        # `_fence_rows` already words these — an orphan closer publishes
        # everything above it, an unclosed one strips to EOF.
        fence_level, fence_where, fence_message = row.split("\t", 2)
        out.append(Finding(fence_level, fence_where, fence_message,
                           "fence-unbalanced"))
    if fence_rows:
        # An unbalanced pair stops every body repair, exactly as a
        # crossing pair does. The re-nest strips the markers of the GM
        # region and rebuilds one pair around whatever it decided the GM
        # region was; with one end of a pair missing there is no such
        # decision to make. An unclosed opener followed only by
        # player-facing blocks used to come out with no marker at all,
        # publishing everything the site strips to EOF today — silently,
        # and under a fix row claiming a fence had been written. Which
        # marker is missing, and where it belonged, is the GM's call.
        _level, where, message = fence_rows[0].split("\t", 2)
        word = "spoiler" if "spoiler" in message else "gm-only"
        out.append(Finding(
            "ERROR", where,
            f"{word} fence is unbalanced — close it by hand before --fix "
            f"re-nests", "fence-unbalanced"))

    # A pair the re-nest preserves is the author's own aside, not a
    # second copy of the canonical fence — counting it would report
    # drift the fix has already decided to leave alone.
    openers = [s for s in states
               if s.marker == "open-gm" and s.lineno not in preserved]
    if len(openers) > 1:
        out.append(Finding(
            "WARNING", f"{rel}:{openers[1].lineno}",
            f"{len(openers)} {GM_ONLY_OPEN} openers outside code — the "
            f"template uses a single pair", "renest"))

    has_recap = False
    for state in states:
        if state.heading is None:
            if state.in_code:
                out.extend(_fenced_heading_finding(
                    rel, state, infos.get(state.lineno, "")))
            continue
        level, title = state.heading
        where = f"{rel}:{state.lineno}"
        if level == 2:
            if is_recap_title(title) and has_recap:
                out.append(Finding(
                    "WARNING", where,
                    f"'## {title}' is a second recap-variant heading left "
                    f"as-is — merge by hand"))
                continue
            has_recap = has_recap or is_recap_title(title)
            out.extend(_wrap_h2_finding(rel, state, where, title))
        found = decorated_heading(title)
        if found:
            name, qualifier = found
            out.append(Finding(
                "INFO", where,
                f"decorated heading '{title}' — rename to the template name "
                f"'{name}' and keep the qualifier as an italic first line",
                "decorated", (title, name, qualifier)))

    if not has_recap and any(f.kind == "keeper-h2" for f in out):
        # Every H2 but the recap and Memorable Moments is Keeper-facing by
        # default, so a wrap-up that never names its recap has its whole
        # body re-nested into the GM block — correct, and a surprise. Say
        # so before the GM confirms the fix, not after the site loses the
        # session's recap.
        out.append(Finding(
            "WARNING", rel,
            "no ## Narrative Recap — the publish tool lifts that section as "
            "the session's player-facing recap, and --fix re-nests every "
            "other H2 under ## GM Notes; retitle the player-facing one first"))
    return out


def _fenced_heading_finding(rel: str, state: LineState,
                            info: str) -> list[Finding]:
    """A Keeper-facing H2 quoted inside a code fence — never re-nested.

    `scan_body` leaves `heading` unset inside a fence precisely so that
    this repo's own documented examples are inert. Saying so out loud
    beats a silent omission the GM reads as a clean bill of health.

    Only fences that plausibly hold markdown are read this way: a `##`
    line inside a ```python or ```yaml block is a comment or a string,
    and reporting it as a quoted heading is noise.
    """
    tag = info.split()[0].casefold() if info.split() else ""
    if tag not in ("", "markdown", "md"):
        return []
    m = HEADING_RE.match(state.line)
    if not m or len(m.group(1)) != 2:
        return []
    title = m.group(2).strip()
    if is_recap_title(title) or title.casefold() in (MEMORABLE_MOMENTS,
                                                     GM_NOTES):
        return []
    return [Finding("WARNING", f"{rel}:{state.lineno}",
                    f"Keeper-facing H2 '## {title}' is inside a code fence — "
                    f"quoted, not re-nested")]


def _wrap_h2_finding(rel: str, state: LineState, where: str,
                     title: str) -> list[Finding]:
    """One H2, classified. Player, GM Notes, or Keeper-facing drift."""
    if is_recap_title(title):
        if title != NARRATIVE_RECAP:
            return [Finding("INFO", where,
                            f"recap heading '## {title}' — rename to "
                            f"## {NARRATIVE_RECAP}", "recap", (title,))]
        return []
    low = title.casefold()
    if low == MEMORABLE_MOMENTS:
        return []
    if low == GM_NOTES:
        if state.gm_depth:
            return []
        return [Finding("WARNING", where,
                        f"## GM Notes is not inside a {GM_ONLY_OPEN} pair",
                        "renest")]
    if state.published:
        return [Finding("ERROR", where,
                        f"Keeper-facing H2 '## {title}' publishes — re-nest "
                        f"it under ## GM Notes", "keeper-h2", (title,))]
    return [Finding("WARNING", where,
                    f"Keeper-facing H2 '## {title}' is already hidden "
                    f"(exclude list or fence) — re-nest it under ## GM Notes",
                    "keeper-h2", (title,))]


def wrapup_filename_findings(rel: str) -> list[Finding]:
    """Step 4. Never fixed: the filename derives the page's site URL, so
    a rename 404s links players have already shared and has to update
    every inbound reference in the same pass."""
    stem = Path(rel).stem
    if WRAP_FILENAME_RE.match(stem):
        return []
    if CHAPTER_WRAP_FILENAME_RE.match(stem):
        return [Finding("INFO", rel,
                        "chapter-level wrap-up filename — conformant as-is")]
    return [Finding("WARNING", rel,
                    f"filename '{Path(rel).name}' is not "
                    f"Chapter_CC_Session_NN_Wrap_Up.md — opt-in on a "
                    f"published vault — a rename changes the page URL and "
                    f"needs every inbound link updated")]


def _wrap_blocks(states: list[LineState]) -> list[tuple[str, str,
                                                        list[LineState]]]:
    """(kind, title, lines) for the preamble and every H2 block.

    Kinds are the four the template knows — `preamble`, `recap`,
    `moments`, `gm` — plus `second-recap` and `keeper` for everything
    else, `keeper` being the default because real vaults invent
    Keeper-facing headings faster than any enumeration tracks. A heading
    inside a code fence never starts a block: `scan_body` leaves
    `heading` unset there.

    Only the FIRST recap-titled H2 is `recap`. A later one is
    `second-recap`: still player-facing, so it is not swept into the GM
    block, but left titled as the author wrote it — merging two recaps
    is a content decision, and renaming both would put two
    `## Narrative Recap` headings in one file.
    """
    blocks: list[tuple[str, str, list[LineState]]] = [("preamble", "", [])]
    seen_recap = False
    for state in states:
        if state.heading is not None and state.heading[0] == 2:
            title = state.heading[1]
            low = title.casefold()
            if is_recap_title(title) and not seen_recap:
                seen_recap = True
                kind = "recap"
            elif is_recap_title(title):
                kind = "second-recap"
            elif low == MEMORABLE_MOMENTS:
                kind = "moments"
            elif low == GM_NOTES:
                kind = "gm"
            else:
                kind = "keeper"
            blocks.append((kind, title, [state]))
        else:
            blocks[-1][2].append(state)
    return blocks


# The block kinds whose own `<!-- gm-only -->` pairs are the author's
# and are kept exactly where they are. Everything else — a Keeper block,
# the existing `## GM Notes` block, and the top-level gap between blocks,
# where the canonical pair's own markers live — is rebuilt.
PLAYER_BLOCK_KINDS = ("preamble", "recap", "second-recap", "moments")


def _gm_pair_plan(states: list[LineState]) -> tuple[set[int], list[int]]:
    """(marker lines to keep verbatim, marker lines that cross a boundary).

    The re-nest rebuilds one `<!-- gm-only -->` pair around the GM
    region, and stripping *every* marker first would republish a fenced
    aside the GM wrote inside `## Narrative Recap` — a leak caused by
    the repair, which is the worst kind. So a pair whose opener and
    closer both belong to the same player-facing block (or both to the
    preamble) is preserved untouched, and only the markers of the GM
    region are dropped.

    A block's own markers are those up to its last real content line;
    the trailing zone after it is where the canonical pair's opener
    sits, which is why the conformant template shape rebuilds cleanly.
    A closer in that trailing zone still belongs to the block when its
    opener does — an aside that ends a section is still that section's.

    A pair with one end inside a player block and the other outside it
    cannot be resolved mechanically: moving it would change what
    publishes either way, so the file is reported and left alone.
    """
    region: dict[int, tuple[int, bool]] = {}
    for index, (kind, _title, group) in enumerate(_wrap_blocks(states)):
        core = -1
        for j, state in enumerate(group):
            if state.line.strip() and state.marker not in GM_MARKERS:
                core = j
        player = kind in PLAYER_BLOCK_KINDS
        for j, state in enumerate(group):
            region[state.lineno] = (index, player and j <= core)

    keep: set[int] = set()
    crossing: list[int] = []
    stack: list[LineState] = []
    for state in states:
        if state.marker == "open-gm":
            stack.append(state)
        elif state.marker == "close-gm":
            if not stack:
                if region[state.lineno][1]:
                    crossing.append(state.lineno)
                continue
            opener = stack.pop()
            open_block, open_own = region[opener.lineno]
            close_block, close_own = region[state.lineno]
            if open_own and open_block == close_block:
                keep.add(opener.lineno)
                keep.add(state.lineno)
            elif open_own or close_own:
                crossing.append(opener.lineno)
    crossing.extend(s.lineno for s in stack if region[s.lineno][1])
    return keep, sorted(crossing)


def _fence_infos(states: list[LineState]) -> dict[int, str]:
    """Line number -> the info string of the code fence it sits in.

    `scan_body` reports *that* a line is fenced, not what the fence
    claimed to hold. The difference matters for one check: a `## Keeper
    Checklist` inside a ```python block is a string literal, not a
    quoted template.

    The closing delimiter is tracked rather than inferred from the first
    unfenced line, because `scan_body` marks a closer as `in_code` too:
    two fences written back to back would otherwise look like one, and
    the second would inherit the first one's language.
    """
    infos: dict[int, str] = {}
    current = ""
    delim = ""
    for state in states:
        if not state.in_code:
            current, delim = "", ""
            continue
        m = FENCE_RE.match(state.line)
        if not delim:
            current = m.group(2).strip() if m else ""
            delim = m.group(1) if m else "`"
        elif (m and m.group(1)[0] == delim[0]
                and len(m.group(1)) >= len(delim)
                and not m.group(2).strip()):
            infos[state.lineno] = current
            current, delim = "", ""
            continue
        infos[state.lineno] = current
    return infos


def _demoted(state: LineState) -> str:
    """One line of a relocated block, its heading pushed a level deeper.

    Capped at H6, and headings inside a code fence are left exactly as
    written — `scan_body` never sets `heading` there.
    """
    if state.heading is None:
        return state.line
    m = HEADING_RE.match(state.line)
    if not m:
        return state.line
    return "#" * min(state.heading[0] + 1, 6) + state.line[len(m.group(1)):]


def _trim(lines: list[str]) -> list[str]:
    """Drop trailing blank lines; leading spacing is the author's."""
    out = list(lines)
    while out and not out[-1].strip():
        out.pop()
    return out


def renest_wrapup(text: str) -> str:
    """The 1.9.5 migration's structural step, as a pure transform.

    Player-facing sections are hoisted above the GM block first — real
    files interleave them between Keeper-facing H2s, and a recap that
    ended up inside `<!-- gm-only -->` would vanish from the site. The
    GM region's own markers are then removed and a single pair rebuilt
    around one `## GM Notes`, existing GM content first and the
    relocated Keeper blocks after it, each demoted a level with its
    children. A gm-only pair the GM wrote *inside* a player-facing
    section is left exactly where it is — republishing it would be a
    leak caused by the repair. Content is never reordered inside a
    block and never reworded; a conformant file comes back
    byte-identical, and a file whose fences cross a section boundary
    comes back untouched.
    """
    states, _problems = scan_body(text, ())
    if not states:
        return text
    preserved, crossing = _gm_pair_plan(states)
    if crossing:
        return text
    raw = text.splitlines(keepends=True)
    head = "".join(raw[:states[0].lineno - 1])
    eol = _wrap_eol(text)

    recap: list[list[str]] = []
    extra_recaps: list[list[str]] = []
    moments: list[list[str]] = []
    preamble: list[str] = []
    gm_content: list[str] = []
    keeper: list[list[str]] = []
    for kind, _title, block_states in _wrap_blocks(states):
        group = [s for s in block_states
                 if s.marker not in GM_MARKERS or s.lineno in preserved]
        if kind == "preamble":
            preamble = [s.line for s in group]
        elif kind == "recap":
            recap.append([f"## {NARRATIVE_RECAP}"]
                         + [s.line for s in group[1:]])
        elif kind == "second-recap":
            extra_recaps.append([s.line for s in group])
        elif kind == "moments":
            moments.append([s.line for s in group])
        elif kind == "gm":
            gm_content.extend(_trim([s.line for s in group[1:]]))
        else:
            keeper.append([_demoted(s) for s in group])

    ordered = (preamble, *recap, *extra_recaps, *moments)
    parts = [t for t in (_trim(p) for p in ordered) if t]
    if gm_content or keeper:
        block = [GM_ONLY_OPEN, "", "## GM Notes"] + _trim(gm_content)
        for section_lines in keeper:
            block += [""] + _trim(section_lines)
        parts.append(block + ["", GM_ONLY_CLOSE])

    body: list[str] = []
    for part in parts:
        if body:
            body.append("")
        body.extend(part)
    tail = eol if text.endswith("\n") else ""
    return head + eol.join(body) + tail


def rename_decorated_headings(text: str) -> tuple[str, list[str]]:
    """Split `### Name — Qualifier` into the template name and an italic
    line. Returns (text, actions); the qualifier is kept, never dropped."""
    states, _problems = scan_body(text, ())
    if not states:
        return text, []
    raw = text.splitlines(keepends=True)
    head = "".join(raw[:states[0].lineno - 1])
    eol = _wrap_eol(text)
    out: list[str] = []
    actions: list[str] = []
    for i, state in enumerate(states):
        found = (decorated_heading(state.heading[1])
                 if state.heading is not None else None)
        if found is None or state.heading is None:
            out.append(state.line)
            continue
        name, qualifier = found
        out.append("#" * state.heading[0] + f" {name}")
        out.append("")
        out.append(f"*{qualifier}*")
        if i + 1 < len(states) and states[i + 1].line.strip():
            out.append("")
        actions.append(f"renamed heading '{state.heading[1]}' to '{name}' "
                       f"(qualifier kept as an italic line)")
    tail = eol if text.endswith("\n") else ""
    return head + eol.join(out) + tail, actions


def apply_frontmatter_fixes(lines: list[str],
                            fixes: list[tuple[str, ...]]) -> list[str]:
    """Apply `('set', key, value)` / `('delete', key, '')` to the raw
    frontmatter lines, returning one action description per edit.

    Line editing, not a YAML round-trip: comments, field order and the
    file's own line endings survive an edit that touches one key.
    """
    eol = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    actions: list[str] = []
    for op, key, value in fixes:
        if op == "delete":
            removed = delete_key(lines, key)
            if removed is not None:
                actions.append(f"removed {removed}")
        else:
            actions.append(set_key(lines, key, value, eol))
    return actions


def check_wrapup(vault: Path, file: str | None, fix: bool) -> list[str]:
    """Session Wrap-Up conformance, and the mechanical repairs.

    Without `--fix` this is a dry run: the findings, then a `WOULD-FIX`
    row per repair it would apply. With `--fix` the same repairs are
    written and the rows read `FIXED`. `UNCHANGED` means exactly one
    thing — the repaired text is byte-identical to what is on disk —
    so a file whose only findings are judgment calls reports it too.
    Findings always print first, so the GM sees what was wrong and not
    merely what changed.

    A file the publish gate drops (`publish:` false/none) still gets its
    frontmatter findings — the schema matters whether or not a page is
    built — but its structure findings are capped at WARNING: nothing in
    it publishes, so a Keeper-facing H2 there is drift, not a leak.

    Exit code is not a gate here: wrap-up drift is triage, and an
    ordinary vault of ingested back-history would fail every run.
    """
    excludes = effective_exclude_sections(vault)
    entries = [(rel, text, extract_frontmatter(text) or {})
               for rel, text in vault_files(vault)]
    rows: list[str] = []
    matched = False
    for rel, _text, fm in entries:
        if entity_type(fm) not in WRAP_TYPES:
            continue
        if file is not None and rel != file:
            continue
        matched = True
        rows.extend(_check_one_wrapup(vault, rel, fm, entries, excludes, fix))
    if file is not None and not matched:
        rows.append(f"INFO\t{file}\tno wrap-up with that path — `type:` must "
                    f"be one of {', '.join(sorted(WRAP_TYPES))}")
    return rows


def _check_one_wrapup(vault: Path, rel: str, fm: dict,
                      entries: list[tuple[str, str, dict]],
                      excludes: list[str], fix: bool) -> list[str]:
    """One wrap-up: findings, then the plan, then a single write."""
    path = vault / rel
    try:
        # newline='' preserves the file's own line endings exactly, the
        # same read stamp_entities.py uses before it edits in place.
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        return [f"ERROR\t{rel}\tunreadable ({e.__class__.__name__}) "
                f"— not checked"]

    lines = text.splitlines(keepends=True)
    close, err = frontmatter_span(lines)
    if err:
        return [f"ERROR\t{rel}\t{err} — not checked"]

    ctx = _wrap_context(rel, fm, entries)
    fm_findings = wrapup_frontmatter_findings(rel, text, ctx)
    structure = wrapup_structure_findings(rel, text, excludes)
    if publish_mode(fm) == "none":
        structure = [Finding("WARNING" if f.level == "ERROR" else f.level,
                             f.where, f.message, f.kind, f.data)
                     for f in structure]
    structure.sort(key=lambda f: _line_of(f.where))
    findings = fm_findings + structure + wrapup_filename_findings(rel)
    rows = [f.row for f in findings]

    fm_lines = lines[1:close]
    actions = apply_frontmatter_fixes(
        fm_lines, [f.data for f in findings if f.kind == "fm"])
    lines[1:close] = fm_lines
    new_text = "".join(lines)

    # A fence that crosses a section boundary, or one that is unbalanced,
    # stops every body repair — the frontmatter backfills are independent
    # of it and still apply.
    if not any(f.kind in ("fence-crosses", "fence-unbalanced")
               for f in structure):
        if any(f.kind in ("keeper-h2", "recap", "renest") for f in structure):
            renested = renest_wrapup(new_text)
            # Structure-only defects — an unfenced `## GM Notes`, a
            # second opener — carry no per-finding action, so what the
            # re-nest did is read back off the two texts rather than
            # predicted from the findings that triggered it.
            if renested != new_text:
                actions.extend(_renest_actions(new_text, renested))
                new_text = renested
        if any(f.kind == "decorated" for f in structure):
            new_text, renamed = rename_decorated_headings(new_text)
            actions.extend(renamed)

    if new_text == text:
        # Byte-identical: whatever the plan said, nothing moved.
        rows.append(f"UNCHANGED\t{rel}\tnothing to fix")
        return rows
    if fix:
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write(new_text)
    mode = "FIXED" if fix else "WOULD-FIX"
    rows.extend(f"{mode}\t{rel}\t{action}" for action in actions)
    return rows


def _renest_actions(before: str, after: str) -> list[str]:
    """What the re-nest did, as fix rows — read off the two texts.

    Derived, never predicted. The rows worded from the *findings* claimed
    a fence and a `## GM Notes` for a file that came out with neither,
    and in a dry run that row is the only thing the GM sees before
    approving the write. A fix row must describe the bytes the repair
    produced, or it is worse than no row at all.
    """
    before_blocks = _wrap_blocks(scan_body(before, ())[0])
    after_states, _ = scan_body(after, ())
    after_h2 = [s.heading[1] for s in after_states
                if s.heading is not None and s.heading[0] == 2]

    remaining = list(after_h2)
    moved = 0
    for kind, title, _group in before_blocks:
        if kind != "keeper":
            continue
        if title in remaining:
            remaining.remove(title)
        else:
            moved += 1

    fenced_gm = any(s.heading is not None and s.gm_depth > 0
                    and s.heading[1].casefold() == GM_NOTES
                    for s in after_states)
    if moved:
        out = [f"re-nested {moved} Keeper-facing H2 section"
               f"{'' if moved == 1 else 's'} under ## GM Notes in one "
               f"{GM_ONLY_OPEN} pair"]
    elif fenced_gm:
        out = [f"re-nested: single {GM_ONLY_OPEN} fence around ## GM Notes"]
    else:
        out = ["re-nested: player-facing sections hoisted; no GM region "
               "left to fence"]
    out.extend(f"renamed heading '{title}' to '{NARRATIVE_RECAP}'"
               for kind, title, _group in before_blocks
               if kind == "recap" and title != NARRATIVE_RECAP
               and NARRATIVE_RECAP in after_h2 and title not in after_h2)
    return out


def _line_of(where: str) -> int:
    """The line number in a `path:line` locator, or 0 for a whole-file
    row — findings sort by where they are, not by which check found them."""
    _path, _sep, tail = where.rpartition(":")
    return int(tail) if tail.isdigit() else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", choices=["frontmatter", "names", "index",
                                        "stale-drafts", "changed", "tables",
                                        "timeline", "read-aloud",
                                        "relationships", "sessions",
                                        "gm-leak", "pc-body", "wrapup",
                                        "version", "active-pcs", "all"])
    ap.add_argument("--folder",
                    help="restrict the frontmatter, gm-leak and pc-body "
                         "checks to a subfolder")
    ap.add_argument("--file",
                    help="restrict the wrapup check to one vault-relative "
                         "file (e.g. \"Chapters/C3/Sessions/Session 07/"
                         "Chapter_03_Session_07_Wrap_Up.md\")")
    ap.add_argument("--fix", action="store_true",
                    help="apply the wrapup check's mechanical repairs "
                         "(frontmatter backfills and the Keeper-facing "
                         "re-nest); without it the repairs print as "
                         "WOULD-FIX rows and nothing is written. Ignored "
                         "by `all`.")
    ap.add_argument("--threshold", type=float, default=0.85,
                    help="similarity ratio for names (default 0.85)")
    ap.add_argument("--since", type=int,
                    help="session number for the changed command")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    if args.command == "changed":
        if args.since is None:
            print("error: changed requires --since N", file=sys.stderr)
            return 2
        emit("changed", check_changed(args.vault, args.since))
        return 0
    # Gates, not reports: they answer one question and stay out of `all`
    # so a full audit is never gated on the plugin's own version.
    if args.command == "version":
        rows, code = check_version(args.vault)
        emit("version", rows)
        return code
    if args.command == "active-pcs":
        emit("active-pcs", list_active_pcs(args.vault))
        return 0

    if args.command in ("frontmatter", "all"):
        emit("frontmatter", check_frontmatter(args.vault, args.folder))
    if args.command in ("names", "all"):
        emit("names", check_names(args.vault, args.threshold))
    if args.command in ("index", "all"):
        emit("index", check_index(args.vault))
    if args.command in ("stale-drafts", "all"):
        emit("stale-drafts", check_stale_drafts(args.vault))
    if args.command in ("tables", "all"):
        emit("tables", check_tables(args.vault))
    if args.command in ("timeline", "all"):
        emit("timeline", check_timeline(args.vault))
    if args.command in ("read-aloud", "all"):
        emit("read-aloud", check_read_aloud(args.vault))
    if args.command in ("relationships", "all"):
        emit("relationships", check_relationships(args.vault))
    if args.command in ("sessions", "all"):
        emit("sessions", check_sessions(args.vault))
    if args.command in ("gm-leak", "all"):
        emit("gm-leak", check_gm_leak(args.vault, args.folder))
    if args.command in ("pc-body", "all"):
        emit("pc-body", check_pc_body(args.vault, args.folder))
    if args.command in ("wrapup", "all"):
        # `all` is a report, so it never writes: a full audit that
        # silently rewrote wrap-ups would be the last thing a GM expects
        # from a command whose other twelve checks are read-only.
        emit("wrapup", check_wrapup(args.vault, args.file,
                                    args.fix and args.command == "wrapup"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

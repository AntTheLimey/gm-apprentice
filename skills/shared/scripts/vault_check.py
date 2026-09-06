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
  vault_check.py VAULT pc-body
  vault_check.py VAULT version
  vault_check.py VAULT active-pcs
  vault_check.py VAULT all

Skips hidden directories, `_Templates/`, and `_inbox/` (staging).
Output: labelled sections, `# count: N` headers, one finding per
line as `LEVEL<TAB>path<TAB>message`.

Levels: ERROR (schema violation), WARNING (needs GM attention),
INFO (context the auditing skill should triage, not a defect).

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
    LINK_RE,
    PC_INACTIVE_STATUS,
    SKIP_DIRS,
    LineState,
    active_pc_names,
    active_pcs,
    effective_exclude_sections,
    iter_body_lines,
    link_target,
    nested_mapping,
    normalize,
    parse_version,
    plugin_version,
    raw_frontmatter,
    scan_body,
    vault_files,
    wikilink_target,
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
        if fm.get("type") in STRUCTURAL_TYPES:
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
        if fm.get("type") not in READ_ALOUD_SCAN_TYPES:
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
    "wrap_up": ("wrap-up", {"session_wrap", "session-wrap-up",
                            "session-wrapup"}),
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
        if fm.get("type") not in types:
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
# the asterisks turn an excluded section into a published one.
EMPHASIS_RE = re.compile(r"^(\*\*|__|_)(.+?)\1$")

FENCE_PROBLEM_RE = re.compile(r"^line (\d+): (.*)$")


def _fence_rows(rel: str, problems: list[str]) -> list[str]:
    """`scan_body`'s authoring problems as rows, with the consequence named.

    An orphan closer is the worse of the two and is the ERROR: depth never
    went above zero, so nothing above it was ever hidden and the GM has no
    way to tell by looking. A block left open at EOF at least fails safe —
    the publish tool strips everything from the opener down.
    """
    rows: list[str] = []
    for problem in problems:
        m = FENCE_PROBLEM_RE.match(problem)
        if not m:
            continue
        lineno, detail = m.group(1), m.group(2)
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
        # Only the emphasis-wrapped spelling survives to publish.
        return [f"ERROR\t{rel}:{state.lineno}\tbold-wrapped heading "
                f"'{title}' defeats the exclude list and publishes — "
                f"remove the ** or move it under ## GM Notes"]
    if _keeper_text(title, excludes):
        return [f"WARNING\t{rel}:{state.lineno}\tKeeper-facing heading "
                f"'{title}' publishes — nest it under ## GM Notes or fence it"]
    return []


def check_gm_leak(vault: Path, folder: str | None) -> list[str]:
    """Keeper-facing content that would actually reach the player site.

    Mechanises graph-health.md's "Un-fenced GM-only content" prose. The
    levels encode how mechanical the fix is: a heading can be moved or
    renamed (ERROR/WARNING), while a bold label or a callout is prose the
    GM has to judge (INFO) — neither is auto-movable without rewriting
    the paragraph around it.

    Every line is filtered through `scan_body`, so nothing inside a
    `<!-- gm-only -->`/`<!-- spoiler -->` fence, under an excluded
    heading, or inside a code fence is ever reported.

    A file's fence problems lead its rows rather than falling into line
    order: an orphan closer changes what every line above it means, so
    it is the first thing to read, not the fifth.
    """
    excludes = effective_exclude_sections(vault)
    rows: list[str] = []
    for rel, text in vault_files(vault, folder):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") in GM_LEAK_SKIP_TYPES:
            continue
        states, problems = scan_body(text, excludes)
        rows.extend(_fence_rows(rel, problems))
        for state in states:
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
                        level: int) -> bool:
    """Does the block `start` opens carry any `**Label:**` field?

    The block runs to the next heading of the same level or shallower —
    the same span the publish tool and session-wrapup read.
    """
    for state in states:
        if state.lineno <= start.lineno:
            continue
        if state.heading is not None and state.heading[0] <= level:
            break
        if not state.in_code and LABELLED_FIELD_RE.match(state.line):
            return True
    return False


def check_pc_body(vault: Path) -> list[str]:
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
    not sheets, and are skipped.
    """
    excludes = effective_exclude_sections(vault)
    rows: list[str] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        states, problems = scan_body(text, excludes)
        rows.extend(_fence_rows(rel, problems))

        headings: list[tuple[LineState, int, str]] = []
        for state in states:
            if state.heading is not None:
                headings.append((state, state.heading[0], state.heading[1]))
        h2s = [(s, title) for s, level, title in headings if level == 2]

        named = [h for h in headings if h[2].casefold() == CURRENT_STATUS]
        current = next((h for h in named if h[1] == 2), None)
        if current is None and named:
            current = named[0]

        if current is None:
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
            if not _has_labelled_field(states, state, level):
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

        if h2s and h2s[0][1].casefold() != CANONICAL_FIRST_H2.casefold():
            rows.append(f"INFO\t{rel}\tfirst body H2 is '## {h2s[0][1]}' — "
                        f"the canonical skeleton opens with "
                        f"## {CANONICAL_FIRST_H2}")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", choices=["frontmatter", "names", "index",
                                        "stale-drafts", "changed", "tables",
                                        "timeline", "read-aloud",
                                        "relationships", "sessions",
                                        "gm-leak", "pc-body",
                                        "version", "active-pcs", "all"])
    ap.add_argument("--folder",
                    help="restrict the frontmatter and gm-leak "
                         "checks to a subfolder")
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
        emit("pc-body", check_pc_body(args.vault))
    return 0


if __name__ == "__main__":
    sys.exit(main())

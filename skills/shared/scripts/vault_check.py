#!/usr/bin/env python3
"""Vault content checks: frontmatter, names, index drift, stale drafts.

Read-only companion to graph_check.py. Turns the mechanical parts of
entity validation and campaign-qa checks into one deterministic pass;
interpretation stays with the skill. Stdlib only.

Usage:
  vault_check.py VAULT frontmatter [--folder SUB]   (also: notes the site's build cannot parse)
  vault_check.py VAULT names [--threshold RATIO]
  vault_check.py VAULT index
  vault_check.py VAULT stale-drafts
  vault_check.py VAULT changed --since N
  vault_check.py VAULT tables [--folder SUB] [--file REL ...] [--newer-than REL]
  vault_check.py VAULT timeline
  vault_check.py VAULT read-aloud
  vault_check.py VAULT relationships [--folder SUB] [--file REL ...] [--newer-than REL]
  vault_check.py VAULT sessions      (also: played sessions/Wrap-Ups not under Publishing)
  vault_check.py VAULT gm-leak [--folder SUB] [--fix]
  vault_check.py VAULT gm-leak --renest-excludes [--fix]
  vault_check.py VAULT pc-body [--folder SUB] [--file REL ...] [--newer-than REL]
  vault_check.py VAULT wrapup [--file REL] [--fix]
  vault_check.py VAULT site-faults [--file REL ...]
  vault_check.py VAULT version
  vault_check.py VAULT active-pcs
  vault_check.py VAULT all

`--file` is repeatable (`--file A.md --file B.md`) and combines with
`--folder`/`--newer-than` by AND; `tables`, `relationships` and
`pc-body` scope their walk to it so a run's own receipts aren't buried
in the vault's pre-existing findings. `wrapup` takes only the first
`--file` given — that check enumerates by `type:`, not by folder, so
it has never taken `--folder`. `frontmatter` and `gm-leak` take
`--folder` but not `--file`/`--newer-than`; both are accepted (and
validated) on every command but read only by the three checks named
above, and `all` scopes exactly the checks that would scope on their
own. `--newer-than REL` is a backstop: it names a vault-relative file
(typically the Wrap-Up, written before its own validation step) and
keeps only files with an mtime at or after that file's own — useful
as the whole scope, or as a completeness cross-check run once
alongside an explicit `--file` list.

A `--file`/`--newer-than` value is validated once, up front, by
resolving it to a vault-relative path (an absolute value is resolved
fully; a relative one — including one with interior `..` or doubled
slashes — is normalised lexically, without following any symlink a
note itself might be) and then requiring an *exact* string match
against a listing of the vault's real `.md` files. A path outside
VAULT, in a skipped directory (hidden, `_Templates/`, `_inbox/`), or
merely a different case or Unicode form of a real filename is
rejected the same as one that plain doesn't exist — always a clear
error (exit 2), never a silently empty or silently wrong report.

Skips hidden directories, `_Templates/`, and `_inbox/` (staging).
Output: labelled sections, `# count: N` headers, one finding per
line as `LEVEL<TAB>path<TAB>message`.

Levels: ERROR (schema violation), WARNING (needs GM attention),
INFO (context the auditing skill should triage, not a defect).

`gm-leak` skips a note the publish tool says it does not publish (under
`player_site.hide.folders`, no `type:`, a draft), and otherwise by
frontmatter: a `type:` of
`session-plan`, `session-play-notes`, `plan`, or `meta` is never
published and always skipped, even under `_meta/`; `publish: none`
pages are skipped and `publish: stub` pages are scanned only over
the sections they ship. ERROR is an orphan `<!-- /gm-only -->`
closer (everything above it publishes); WARNING is an unclosed opener or a
published heading whose title contains an exclude-list entry or
Keeper keyword, or names a GM Notes subsection of the wrap-up template
(`World State`, …: the pre-fix 1.8.3 migration left some top-level); INFO is a Keeper-facing bold label or callout —
prose the GM has to judge, not auto-movable. A heading written with
emphasis, a colon or a link (`### **GM Notes**`) is the excluded
section: the site hides it, so it is not a finding (unless the site's
publish tool is older than 1.16.0, which does not: then it is an ERROR). `--fix` re-nests
only the `##` sections the site withholds by its own rule (a
handout's Keeper sections) under `## GM Notes`, demoting each and its
sub-headings a level; keyword WARNINGs and INFO rows never move. `--renest-excludes` is the 1.8.3 migration:
it re-nests every heading titled with a current `exclude_sections`
entry (hidden today or not), then collapses the list to
`["GM Notes"]` (a vault with no list keeps the defaults). It walks
every file the publisher might ship and fails closed on an
`exclude_sections` it cannot read exactly. No rewrite is written if
a hidden line would publish after it — judged by a port of the
publish pipeline — or a fence would unbalance (ERROR row instead),
and one refusal blocks the whole migration.

`pc-body` runs over every `type: pc` sheet except `*_Story.md`
companions and `publish: none` pages. ERROR is `## Current Status`
sitting inside a gm-only/spoiler fence; WARNING is `## Current
Status` coming after `## Notes`/`## GM Notes`, not being an H2, or a
duplicated H2; INFO is the block missing, having no labelled
fields, or the first body H2 not being `## Stat Sheet`.

`wrapup` checks conformance against `shared/templates/session-wrap.md`:
frontmatter backfills, an ERROR on a sibling H2 outside the fence that
is one of the template's GM Notes headings (`## World State`, `## Keeper
Checklist`, `## Skipped Prep`, ...), which would publish Keeper content,
the single `<!-- gm-only -->` fence around `## GM
Notes`, recap-heading and template-heading variants, and the
filename pattern. A gm-only fence that is unbalanced or crosses a
player-facing section boundary gets its frontmatter backfilled and
its body left alone, for the GM to fix by hand; filename renames
are left to `relink.py`, which the migration offers as a choice.

`sessions` derives each session's status from its chain documents. For
a session index whose Wrap-Up is explicitly linked (so the site
withholds the index body), it also reports body lines outside a gm-only
fence as INFO, naming the document each kind belongs in. In a player-mode
vault it warns on played sessions missing from the manifest's Publishing
section, saying what `manifest publish-played` will do with each. Both
answers come from the site's installed publish tool (the plugin's when
the site has none), never from a reading of its rules here.

`wrapup` and `gm-leak` are the commands that can write. Each prints
its findings first and then a repair row per action — `WOULD-FIX` on
a dry run, `FIXED` when `--fix` applies them; `wrapup` also prints
`UNCHANGED` for a conformant file. Both join `all` as a dry run:
`all` never writes.

`site-faults` lists the faults in the notes that change what the site
shows: a note with no page that a published page names, a stray `%%`, a
code fence never closed above a hidden marker, a `gm_aliases` name in a
page's text, and for a note marked `withheld: true`: its names in the
site's text, a link to it, the note itself being published, a name a
published page also answers to, and a flag value that cannot be read. The list is the site's publish tool's (`doctor --site
--json`); nothing about it is worked out here. A note the GM has settled
("stays hidden:" beside its Excluded entry) is counted in a closing INFO
row and not listed. A row names the first three pages that name a note;
`--file` keeps one note's rows and lists every page. It prints one INFO
row for a vault with no site, and one for a site whose tool is from before
these findings. It sits outside `all`: the list is long and has its own
procedure (campaign-qa's Site Faults).

Two commands are gates rather than reports and sit outside `all`:
`version` emits one row whose first column is a verdict
(OK/MISMATCH/AHEAD/SETUP/ERROR) and sets the exit code — 0 for
OK/SETUP, 1 otherwise — so a skill can branch on it; `active-pcs`
emits `PC<TAB>path<TAB>roster line` for the session skills' opening
roster read.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from html import unescape as _html_unescape
import unicodedata
from pathlib import Path
from typing import Any, Callable, Iterable

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
    iter_relationship_tones,
    chapter_key,
    parse_session_number,
    predicate_problem,
    predicate_vocabulary,
    tone_families,
    tone_proposal,
)
# LINK_RE and SKIP_DIRS are re-exported: they were part
# of this module's surface before vaultlib existed.
from vaultlib import (  # noqa: F401
    FENCE_RE,
    HEADING_RE,
    LINK_RE,
    SKIP_DIRS,
    WRAP_UP_TYPES,
    LineState,
    active_pc_names,
    atx_title,
    active_pcs,
    delete_key,
    entity_type,
    body_text,
    PUBLISH_TOOL,
    PublishToolUnavailable,
    publish_tool_problem,
    publisher_lines,
    stub_kept,
    use_publish_tool,
    Settings,
    SettingsUnavailable,
    StateUnreadable,
    LEGACY_SETTINGS_FILE,
    forget_settings,
    read_stamp,
    settings_file,
    stamp_file,
    vault_layout,
    report_unreadable_settings,
    setting_or_builtin,
    settings,
    settings_add,
    settings_carry,
    settings_fold_site_file,
    settings_move_plan,
    setting_name,
    settings_tidy,
    settings_describe,
    settings_raw,
    settings_set,
    settings_unset,
    site_switch_written,
    site_without_tool,
    written_in_vault_file,
    vault_site,
    strip_comment_spans,
    cut_lines,
    frontmatter_span,
    get_key,
    is_skipped_path,
    iter_body_lines,
    link_aliases,
    link_target,
    nested_mapping,
    normalize,
    normalize_file_arg,
    opens_a_block,
    parse_version,
    plugin_version,
    publish_mode,
    raw_frontmatter,
    scalar_value,
    FRONTMATTER_RE,
    scan_body,
    session_ref_number,
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


def _emit_tool_once() -> Callable[[str, list[str]], None]:
    """`emit` for `all`: the "asked <which tool>" row prints under the
    first check that used the tool, not again under each later one."""
    seen: set[str] = set()

    def emit_once(label: str, rows: list[str]) -> None:
        kept = [r for r in rows
                if not (r.startswith("INFO\t(vault)\tasked ") and r in seen)]
        seen.update(r for r in kept if r.startswith("INFO\t(vault)\tasked "))
        emit(label, kept)
    return emit_once


PUBLISH_MANIFEST_REL = "_meta/publish-manifest.md"


def check_frontmatter(vault: Path, folder: str | None,
                      explain: ExplainAll | None = None) -> list[str]:
    """Schema rules, read by vaultlib's line reader, then the one thing
    that reader cannot see: a note the site's build cannot parse at all
    (#287). The line reader takes the last of a duplicated key and accepts
    an unquoted `key: a: b`; js-yaml rejects both and the build makes no
    page. Which notes those are is the publish tool's answer (`explain
    --all`), never a second YAML reading here. An ERROR, like the schema
    rows: the post-write loops fix ERRORs, and a skill that has just
    written such a note must not leave it."""
    rows = []
    unparsed: set[str] = set()
    notes = list(vault_files(vault, folder))
    # Unscoped, ask even with nothing to walk here: the build walks
    # folders this script skips, and names any broken note in them.
    if notes or folder is None:
        tool = (explain or ExplainAll(vault))()
        broken, why = unparseable_files(tool)
        if broken is None and why:
            rows.append(_publish_tool_row(
                why, "notes whose frontmatter the site's build cannot "
                "parse were not looked for", tool.used))
        on_disk = {unicodedata.normalize("NFC", rel): rel
                   for rel, _text in notes}
        # Unscoped, name every file the build names: it walks folders this
        # script's own walk skips (`_inbox`).
        named = sorted((key, message or "")
                       for key, message in (broken or {}).items()
                       if key in on_disk or folder is None)
        if named:
            rows.extend(_tool_used_row(tool.used))
        for key, message in named:
            detail = f" ({message})" if message else ""
            rows.append(f"ERROR\t{on_disk.get(key, key)}\tthe site's build "
                        f"cannot parse this frontmatter{detail} and skips "
                        f"the note — {_yaml_hint(message)}")
        unparsed = {on_disk[key] for key, _message in named if key in on_disk}
    for rel, text in notes:
        if rel in unparsed:
            # Schema rows would come from the line reader's guess at YAML
            # the build rejects; they mean nothing until it parses.
            continue
        if rel == PUBLISH_MANIFEST_REL:
            # Written by the publish tool with no `type`, and regenerated
            # on every build: the GM cannot fix a row about it (#333).
            continue
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
        for a in link_aliases(fm):
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
        for a in link_aliases(fm):
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
    stale_after = setting_or_builtin(vault, "vault.stale_after_sessions")
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
        elif now - created >= stale_after:
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


def table_findings(rel: str, text: str) -> list[str]:
    r"""Pipes inside table cells break the table when Obsidian reflows it.
    Flag aliased wikilinks ([[A|B]]) and escaped pipes (\|) inside table
    blocks. ERROR: deterministic render break the apprentice silently fixes
    as a chore (the level is internal — never shown to the GM as a report).

    Per-file body of `check_tables`, extracted so `plan_check.py` can run
    the same table-cell lint over a single Session Plan without walking a
    whole vault.
    """
    rows = []
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


def check_tables(vault: Path, folder: str | None = None,
                 files: Iterable[str] | None = None,
                 newer_than: float | None = None) -> list[str]:
    """`table_findings` over the vault. `folder`/`files`/`newer_than`
    scope the walk to the file(s) a run just wrote, same as
    `check_relationships`."""
    return [r for rel, text in vault_files(vault, folder, files,
                                           newer_than=newer_than)
            for r in table_findings(rel, text)]


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


def check_relationships(vault: Path, folder: str | None = None,
                        files: Iterable[str] | None = None,
                        newer_than: float | None = None) -> list[str]:
    """Every relationship predicate must come from the sanctioned vocabulary.

    An invented `type:` is worse than a vague one: no query, no
    inverse-inference and no publish step knows about it, so the edge is
    written and then silently ignored (issue #130 — one session's entity
    generation invented eleven of them). ERROR, with the nearest
    sanctioned predicates so the fix is a rename, not a hunt. A tone off
    the listed words is a WARNING, with the listed word to use when a
    rule gives one.

    `folder`/`files`/`newer_than` scope the walk to what a run just
    touched — a full vault's off-vocabulary backlog otherwise buries
    the findings that belong to the files just written."""
    try:
        vocabulary = predicate_vocabulary()
        # Warm the inverse map here too: predicate_problem() reads it through
        # a second cache, and an unguarded load there would abort `all`.
        inverse_predicates()
        tones = tone_families()
    except (OSError, ValueError, KeyError, TypeError) as e:
        return [f"ERROR\t(vault)\tcannot read the predicate vocabulary "
                f"from shared/gm-apprentice-ontology.json: {e}"]
    rows = []
    for rel, text in vault_files(vault, folder, files, newer_than=newer_than):
        for lineno, key, predicate in iter_relationship_predicates(text):
            if predicate in vocabulary:
                continue
            rows.append(f"ERROR\t{rel}:{lineno}\t"
                        f"{predicate_problem(key, predicate)} "
                        f"(map it via shared/relationship-normalization.md)")
        for lineno, tone in iter_relationship_tones(text):
            if tone in tones:
                continue
            fix = tone_proposal(tone)
            rows.append(
                f"WARNING\t{rel}:{lineno}\ttone '{tone}' is off the list; "
                + (f"use '{fix}'" if fix else
                   "pick a listed tone (shared/entity-schema.md, Tones)"))
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
    rel = stamp_file(vault)
    try:
        current = read_stamp(vault)
    except StateUnreadable as e:
        return ([f"ERROR\t(vault)\t{e}"], 1)
    # A `_meta/` with no readable settings file is the same situation as one
    # with no version recorded: the vault never recorded one.
    if not current:
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
        names = ", ".join(link_aliases(fm))
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

    A `session:` link naming the index wins outright when the chapter is
    compatible. Otherwise the session number has to agree AND the
    chapter has to be compatible — numbering restarts per chapter, so
    number alone pairs Chapter 2's session 1 with Chapter 1's plan
    (#162's shape), and a bare stem in a `session:` link is exactly as
    ambiguous when two chapters both name their index the same way
    (#206's shape too — a stem match cannot be trusted over a known,
    different chapter). An unresolvable chapter on either side still
    matches, mirroring `session_context.prefer_chapter`, which keeps
    flat vaults working.

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
            if chapter is None or chapter_key(rel, fm) in (chapter, None):
                return rel
            continue
        if target and target in stems:
            continue
        if number is None:
            continue
        n = session_ref_number(fm)
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


def _resolve_document_link(target: str, by_stem: dict[str, list[str]],
                           by_rel: dict[str, dict], chapter: str | None,
                           index_rel: str
                           ) -> tuple[str | None, str | None]:
    """(note, other_chapter_note) a `documents:` link names.

    Notes share stems across chapters ("session_11_play_notes" exists in
    every chapter that restarts numbering), so name alone is ambiguous.
    A note filed beside the index, one whose `chapter:` resolves to the
    same chapter, or one whose own `session:` link names the index, is
    this session's — but a note whose chapter resolves to a *different*,
    known chapter is never claimed by directory or session-link alone;
    a bare stem is exactly as ambiguous in a `session:` link as it is
    here, so it cannot override an explicit chapter mismatch. Only when
    none of the hits is positively this session's does an unresolvable-
    chapter hit get taken as a last resort, mirroring `_chain_document`'s
    own "loose" fallback for flat vaults. If the index's own chapter is
    unresolvable, every hit is equally ambiguous and the first is taken,
    the same as everywhere else in this file.
    """
    hits = by_stem.get(link_target(target), [])
    if not hits:
        return None, None
    if chapter is None:
        return hits[0], None
    index_key = normalize(Path(index_rel).stem)
    index_dir = Path(index_rel).parent

    def is_own(rel: str) -> bool:
        fm = by_rel[rel]
        if Path(rel).parent == index_dir:
            return True
        key = chapter_key(rel, fm)
        if key is not None:
            return key == chapter
        said = wikilink_target(fm.get("session"))
        return bool(said) and link_target(said) == index_key

    own = [rel for rel in hits if is_own(rel)]
    if own:
        return own[0], None
    loose = [rel for rel in hits if chapter_key(rel, by_rel[rel]) is None]
    if loose:
        return loose[0], None
    return None, hits[0]


PLAYED_STATUSES = {"played", "wrap-up", "reviewed"}
_MANIFEST_ENTRY_RE = re.compile(r"^\s*-\s+(?:\[[ xX]\]\s+)?(.+)$")
_MANIFEST_PATH_RE = re.compile(r"^(.*?\.\w+)(?:\s+(?:—|–|--)\s+.*)?$")


def read_manifest_sections(vault: Path) -> dict[str, set[str]] | None:
    """Vault-relative paths of `_meta/publish-manifest.md`, by section
    (`publishing`, `excluded`, `needs_decision`), or None when the vault
    has no manifest. Mirrors tools/publish/lib/manifest.js: an inline
    ` — note` is dropped, paths are NFC-normalised, and only checked
    entries count under Publishing."""
    try:
        text = (vault / "_meta" / "publish-manifest.md").read_text(
            encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None
    sections: dict[str, set[str]] = {
        "publishing": set(), "excluded": set(), "needs_decision": set()}
    current: str | None = None
    for line in text.replace("\r", "").split("\n"):
        heading = re.match(r"^## (.+)", line)
        if heading:
            title = heading.group(1).strip()
            current = ("publishing" if title.startswith("Publishing")
                       else "needs_decision" if title.startswith("Needs Decision")
                       else "excluded" if title.startswith("Excluded")
                       else None)
            continue
        if current is None:
            continue
        m = _MANIFEST_ENTRY_RE.match(line)
        if not m or re.match(r"(?i)reason:", m.group(1).strip()):
            continue
        if current == "publishing" and not re.match(r"^- \[[xX]\]", line):
            continue
        raw = m.group(1).strip()
        split = _MANIFEST_PATH_RE.match(raw)
        sections[current].add(unicodedata.normalize(
            "NFC", split.group(1) if split else raw))
    return sections


def manifest_rows(vault: Path, played: list[str]) -> list[str]:
    """WARNING rows for played sessions (and their Wrap-Ups) that
    `_meta/publish-manifest.md` does not list under Publishing (#277).

    Silent unless the vault has a manifest and publishes in player mode —
    the only mode where the manifest is an allowlist, matching
    publish-decision.js. A file under Excluded is a decision, not an
    oversight, so it is not reported.

    What happens next is the publish tool's call, not this script's: it is
    asked (`manifest publish-played --dry-run --json`, the site's tool first,
    as for `explain`). A session it would tick "publish-played will register
    it"; one it lists as unclear "publish-site will ask the GM", with its
    reason. The Wrap-Up rows come from the same answer. When it can't be
    asked, the rows promise nothing about what happens next.
    """
    sections = read_manifest_sections(vault)
    if sections is None:
        return []
    # As the build reads it (the settings list's `player_site.hide.mode`): only
    # `full`, in any case, is full; anything else is player mode and the
    # list applies.
    # Only the vault file's own `mode` counts here; a site file's old one does not.
    own = settings(vault)
    if (written_in_vault_file(own, "player_site.hide.mode")
            and own.get("player_site.hide.mode") == "full"):
        return []

    def unlisted(rel: str) -> str | None:
        canon = unicodedata.normalize("NFC", rel)
        if canon in sections["publishing"] or canon in sections["excluded"]:
            return None
        return ("Needs Decision" if canon in sections["needs_decision"]
                else "no manifest section")

    waiting = [rel for rel in played if unlisted(rel)]
    if not played:
        return []
    answer = ask_publish_tool(vault, ["manifest", "publish-played",
                                      "--dry-run"])
    ticks: set[str] = set()
    asks: dict[str, str] = {}
    wraps: dict[str, str] = {}
    known = answer.data is not None
    if known:
        try:
            data = answer.data
            ticks = {unicodedata.normalize("NFC", str(p))
                     for p in data.get("published", [])}
            for u in data.get("unclear", []):
                path = unicodedata.normalize("NFC", str(u["path"]))
                asks[path] = str(u.get("reason") or "unclear")
                if u.get("wrapUp"):
                    wraps[unicodedata.normalize("NFC", str(u["wrapUp"]))] = (
                        asks[path])
        except (AttributeError, KeyError, TypeError):
            known = False
    rows: list[str] = []
    if not known and not waiting:
        return []
    if not known:
        rows.append(_publish_tool_row(
            answer.why or "manifest publish-played did not return the "
            "expected JSON", "the rows below don't say what publish-site "
            "will do with each session", answer.used))
    else:
        rows.extend(_tool_used_row(answer.used))

    def row(rel: str, kind: str) -> str:
        where = unlisted(rel)
        head = (f"WARNING\t{rel}\t{kind} is not under Publishing in "
                f"_meta/publish-manifest.md ({where}) — it will not publish")
        canon = unicodedata.normalize("NFC", rel)
        if not known:
            return (f"{head} until it is listed there (publish-site runs "
                    f"gm-publish manifest publish-played before every build)")
        if canon in ticks:
            return f"{head} yet; publish-played will register it"
        reason = asks.get(canon) or wraps.get(canon)
        if reason:
            return f"{head}; publish-site will ask the GM ({reason})"
        return (f"{head}; publish-played won't register it — run gm-publish "
                f"manifest publish-played --session \"{rel}\" to see why")

    for rel in waiting:
        rows.append(row(rel, "played session"))
    for rel in sorted((ticks | set(wraps)) - {unicodedata.normalize("NFC", r)
                                               for r in played}):
        if unlisted(rel):
            rows.append(row(rel, "Wrap-Up"))
    return rows


HUB_HOMES = (
    (re.compile(r"plan\s*\]\]|play[ _-]?notes|wrap[ _-]?up", re.IGNORECASE),
     "document links go in frontmatter `documents:`"),
    (re.compile(r"scene index|key prep|image prompt|contingency|premise",
                re.IGNORECASE),
     "scene prep, key prep and image prompts go in the Plan"),
    (re.compile(r"handoff", re.IGNORECASE),
     "handoffs go in the Wrap-Up's fenced ## GM Notes"),
)


def _hub_body_rows(rel: str, text: str) -> list[str]:
    """An INFO row when a session index that has a Wrap-Up holds anything
    in its body but the H1 title outside a gm-only fence (#276).

    INFO, not WARNING: once the session has a published Wrap-Up the site
    withholds the hub body, so nothing leaks. It is still bookkeeping in
    the wrong document — the skills that need it read the Plan and the
    Wrap-Up, not the hub — so the row names where each kind belongs.
    Comments are read as the publisher reads them (`cut_lines`, the tool's own
    strip chain; `strip_comment_spans` when it cannot be asked), so the
    template's own comment line is not prose. The caller gates on
    the Wrap-Up: without one the body is the session's only published
    record, and prose there is expected.
    """
    states, _problems = scan_body(text, ())
    loose: list[LineState] = []
    # The tool's strip chain knows `%%` comments; HTML comments alone are read
    # here when it cannot be asked (a site pinned to a tool without `cut`).
    try:
        cut = cut_lines([s.line for s in states])
    except PublishToolUnavailable:
        cut = None
    in_comment = False
    for i, s in enumerate(states):
        if s.gm_depth or s.spoiler_depth or s.marker is not None:
            continue
        if s.in_code:
            if s.line.strip():
                loose.append(s)
            continue
        if cut is not None:
            kept = cut[i] or ""
        else:
            kept, in_comment = strip_comment_spans(s.line, in_comment)
        if kept.strip() and not (s.heading is not None and s.heading[0] == 1):
            loose.append(s)
    if not loose:
        return []
    body = "\n".join(s.line for s in loose)
    homes = [home for pattern, home in HUB_HOMES if pattern.search(body)]
    homes.append("anything the Keeper keeps on the hub goes under a fenced "
                 "## GM Notes (see _Templates/_Template_Session.md)")
    return [f"INFO\t{rel}:{loose[0].lineno}\tsession index body has "
            f"{len(loose)} line(s) outside a gm-only fence — the site "
            f"withholds it now the session has a Wrap-Up, and the hub is "
            f"metadata only: {'; '.join(homes)}"]


def _resolve_chain_key(key: str, rel: str, stem: str, number: int | None,
                       chapter: str | None, documents: dict[str, str],
                       files: list[tuple[str, str, dict]],
                       stems: dict[str, str],
                       by_stem: dict[str, list[str]],
                       by_rel: dict[str, dict],
                       ) -> tuple[str | None, list[str], list[str]]:
    """One chain document of a session index: (path or None, broken-link
    rows, unlinked-document rows)."""
    kind, types = SESSION_DOC_TYPES[key]
    broken: list[str] = []
    unlinked: list[str] = []
    target = wikilink_target(documents.get(key))
    if target.casefold() in YAML_NULLS:
        # `plan: null` is the schema's own placeholder for "this
        # document does not exist yet" — reporting it as a broken
        # link would fire on nearly every index in a live vault.
        target = ""
    linked, elsewhere = (
        _resolve_document_link(target, by_stem, by_rel, chapter, rel)
        if target else (None, None))
    if elsewhere:
        broken.append(
            f"WARNING\t{rel}\tdocuments.{key} links '[[{target}]]' "
            f"but the only note by that name is in another chapter "
            f"({elsewhere}) — not counted for this session")
    elif target and linked is None:
        broken.append(f"WARNING\t{rel}\tdocuments.{key} links "
                      f"'[[{target}]]' but no such note exists")
    found = _chain_document(files, stems, types, stem, number, chapter)
    if found and not linked:
        unlinked.append(
            f"INFO\t{rel}\t{kind} exists ({found}) but "
            f"documents.{key} does not link it — stamp_entities.py "
            f'VAULT "{rel}" --set '
            f'documents.{key}="[[{Path(found).stem}]]"')
    return linked or found, broken, unlinked


# The publish tool (`PUBLISH_TOOL`, from vaultlib) sits beside skills/ in
# both the repo and the installed plugin.
PUBLISH_TOOL_TIMEOUT = 120
# The site builds with the tool installed in its own node_modules (update-pin
# reads it there too), so that is the renderer whose answer counts. The first
# release that withholds a paired hub's body, and has `explain --all --json`
# and `manifest publish-played --dry-run --json --vault`:
PUBLISH_PACKAGE = "gm-apprentice-publish"
WITHHOLDS_HUB_BODIES_SINCE = (1, 11, 40)


def _site_of(own: Settings, vault: Path) -> tuple[Path | None, bool]:
    site_dir = own.get("player_site.folder")
    if not site_dir or site_switch_written(own) is False:
        return None, False
    site = Path(site_dir).expanduser()
    if not site.is_absolute():
        site = vault / site
    return site, (site / "vault.config.json").is_file()


def configured_site(vault: Path) -> tuple[Path | None, bool]:
    """(the site folder `player_site.folder` names, whether a
    vault.config.json is in it). (None, False) when `site_dir` is unset or
    the site is off (`player_site.publish`). A relative `site_dir` is relative to
    the vault."""
    return _site_of(settings(vault), vault)


def vault_settings(vault: Path) -> Settings:
    """Every setting of the vault, with the site folder's own
    vault.config.json taking part when the vault has one (its old keys are
    still read until they are moved). The vault file alone says where the
    site is, so that is read first."""
    own = settings(vault)
    site, has_config = _site_of(own, vault)
    if site is not None and has_config:
        return settings(vault, site_config=site / "vault.config.json")
    return own


def no_site_dir(vault: Path) -> str:
    return f"{setting_name(vault, 'player_site.folder')} is not set"


def _site_config(vault: Path) -> tuple[Path | None, str | None]:
    """(the site's vault.config.json, why there is none).

    (None, None) means the vault publishes nothing — no `publish:` block —
    so there is nothing to ask about."""
    site, has_config = configured_site(vault)
    if site is None:
        if not settings(vault).has_site_block:
            return None, None
        return None, no_site_dir(vault)
    if not has_config:
        return None, (f"no vault.config.json in "
                      f"{setting_name(vault, 'player_site.folder')} ({site})")
    return site / "vault.config.json", None


_SEMVER = re.compile(
    r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?")


def parse_semver(text: object) -> tuple[tuple[int, int, int], list[str]] | None:
    """(core, prerelease identifiers) of a strict semver string, or None."""
    m = _SEMVER.fullmatch(str(text) if text is not None else "")
    if not m:
        return None
    return ((int(m[1]), int(m[2]), int(m[3])),
            m[4].split(".") if m[4] else [])


def semver_below(a: str, b: str) -> bool:
    """Semver precedence, as tools/publish/lib/site-pin.js semverBelow: a
    prerelease sorts below its release (1.11.40-rc.1 < 1.11.40). Both must
    be valid; an invalid one raises ValueError."""
    pa, pb = parse_semver(a), parse_semver(b)
    if pa is None or pb is None:
        raise ValueError(f"not a semver version: {a if pa is None else b}")
    if pa[0] != pb[0]:
        return pa[0] < pb[0]
    xa, xb = pa[1], pb[1]
    if not xa or not xb:
        return bool(xa) and not xb
    for i in range(max(len(xa), len(xb))):
        if i >= len(xa):
            return True
        if i >= len(xb):
            return False
        x, y = xa[i], xb[i]
        if x == y:
            continue
        nx, ny = x.isdigit(), y.isdigit()
        if nx and ny:
            return int(x) < int(y)
        if nx != ny:
            return nx
        return x < y
    return False


def _spec_version(spec: str) -> str | None:
    """The least version a package.json spec for the tool can install, or
    None when that can't be read for sure (site-pin.js specVersion)."""
    text = str(spec).strip()
    if text.startswith("file:"):
        target = text[len("file:"):].replace("\\", "/").rstrip("/")
        cached = re.search(r"/(\d+\.\d+\.\d+)/tools/publish$", target)
        if cached:
            return cached[1]
        tarball = re.search(r"-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$",
                            target)
        return tarball[1] if tarball and parse_semver(tarball[1]) else None
    m = re.fullmatch(r"(?:\^|~|>=|=)?\s*v?(\S+)", text)
    return m[1] if m and parse_semver(m[1]) else None


def _read_json(path: Path) -> tuple[bool, object, str | None]:
    """(missing, parsed data, error). A dangling symlink is missing."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return True, None, None
    except NotADirectoryError:
        return True, None, None
    except (OSError, UnicodeDecodeError) as e:
        return False, None, e.__class__.__name__
    try:
        return False, json.loads(text), None
    except ValueError:
        return False, None, "invalid JSON"


@dataclass
class SitePin:
    source: str  # "installed", "package.json" or "none"
    version: str | None
    stale: str | None
    spec: str | None = None  # the package.json spec, when that is what was read


def _stale_reason(version: str) -> str | None:
    since = ".".join(str(n) for n in WITHHOLDS_HUB_BODIES_SINCE)
    return (f"site pinned to {version} predates body withholding — run "
            f"update-pin" if semver_below(version, since) else None)


def site_pin(site: Path) -> SitePin:
    """Which gm-apprentice-publish the site builds with, by the rules of
    tools/publish/lib/site-pin.js (same test vectors): a usable installed
    tool answers; with nothing installed (or a dangling symlink) the
    site's package.json dependency does, since the next `npm install`
    installs it; a spec whose least version can't be read, or an
    installed tool with no readable version, is stale; no dependency on
    the tool at all is source "none"."""
    missing, data, error = _read_json(
        site / "node_modules" / PUBLISH_PACKAGE / "package.json")
    if not missing:
        version = data.get("version") if isinstance(data, dict) else None
        if not isinstance(version, str) or parse_semver(version) is None:
            return SitePin("installed", None,
                           f"the site's installed {PUBLISH_PACKAGE} has no "
                           f"readable version")
        return SitePin("installed", version, _stale_reason(version))
    missing, data, error = _read_json(site / "package.json")
    if missing:
        return SitePin("none", None, None)
    if not isinstance(data, dict):
        return SitePin("package.json", None,
                       f"the site's package.json can't be read "
                       f"({error or 'not an object'})")
    def dep(key: str) -> object:
        table = data.get(key)
        return table.get(PUBLISH_PACKAGE) if isinstance(table, dict) else None
    spec = dep("dependencies") or dep("devDependencies")
    if not spec:
        return SitePin("none", None, None)
    version = _spec_version(str(spec))
    if version is None:
        return SitePin("package.json", None,
                       f"the site pins {PUBLISH_PACKAGE} as \"{spec}\", which "
                       f"isn't a version this can check", str(spec))
    return SitePin("package.json", version, _stale_reason(version), str(spec))


def _publish_tool_for(site: Path) -> tuple[Path | None, str, str | None]:
    """(tool script, which tool it is, why it can't answer).

    The site's installed tool when it has one — its answer is the site's.
    A site whose tool (installed, or pinned in package.json and not yet
    installed) predates hub-body withholding, or can't be read, can't
    answer: the caller fails safe. The plugin's own tool stands in for a
    site with nothing installed, and says so."""
    pin = site_pin(site)
    if pin.source == "installed":
        label = (f"the site's installed publish tool "
                 f"{pin.version or '(unknown version)'}")
        if pin.stale:
            return None, label, pin.stale
        script = site / "node_modules" / PUBLISH_PACKAGE / "bin" / "gm-publish.js"
        if not script.is_file():
            return None, label, f"{script} is missing"
        return script, label, None
    if pin.stale:
        return None, f"the site's pinned publish tool {pin.version or ''}".rstrip(), pin.stale
    label = ("the plugin's publish tool (the site has none installed)"
             if pin.source == "none" else
             f"the plugin's publish tool (the site pins {pin.version}, not "
             f"installed yet)")
    if not PUBLISH_TOOL.is_file():
        return None, label, f"the publish tool is not at {PUBLISH_TOOL}"
    return PUBLISH_TOOL, label, None


@dataclass
class ToolAnswer:
    """What the publish tool said, or why it couldn't: `data` is its JSON
    (None on any failure), `why` the failure, `used` which tool answered
    (None when the site's own tool did — the normal case, not worth a
    row)."""
    data: Any = None
    why: str | None = None
    used: str | None = None


class ExplainAll:
    """One `explain --all` answer for a run, asked when first needed, so
    the checks that read it (frontmatter, gm-leak, pc-body) share one
    tool run."""

    def __init__(self, vault: Path) -> None:
        self.vault = vault
        self._answer: ToolAnswer | None = None

    def __call__(self) -> ToolAnswer:
        if self._answer is None:
            self._answer = ask_publish_tool(self.vault, ["explain", "--all"])
        return self._answer


def ask_publish_tool(vault: Path, args: list[str]) -> ToolAnswer:
    """Run the site's publish tool with `args` plus `--json`, `--config`
    and `--vault`, and parse its JSON. `ToolAnswer()` with no data and no
    reason means the vault publishes nothing."""
    config, why = _site_config(vault)
    if config is None:
        # A site that is off is not a tool that could not be asked: there is
        # nothing to say. One that is on with no folder is.
        quiet = (why == no_site_dir(vault)
                 and site_switch_written(settings(vault)) is not True)
        return ToolAnswer(why=None if quiet else why)
    site_args = ["--config", str(config)]
    tool, label, why = _publish_tool_for(config.parent)
    used = label if tool == PUBLISH_TOOL else None
    if tool is None:
        return ToolAnswer(why=why, used=label)
    node = shutil.which("node")
    if not node:
        return ToolAnswer(why="node is not on PATH", used=label)
    name = " ".join(args[:2])
    try:
        proc = subprocess.run(
            [node, str(tool), *args, "--json", *site_args,
             "--vault", str(vault.resolve())],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=PUBLISH_TOOL_TIMEOUT, check=False)
    except subprocess.TimeoutExpired:
        return ToolAnswer(why=f"{name} timed out after {PUBLISH_TOOL_TIMEOUT}s",
                          used=label)
    except OSError as e:
        return ToolAnswer(why=f"node could not run ({e.__class__.__name__})",
                          used=label)
    if proc.returncode != 0:
        detail = [ln.strip() for ln in (proc.stderr or "").splitlines()
                  if ln.strip()]
        stopped = next((i for i, ln in enumerate(detail)
                        if "the settings have a fault" in ln), None)
        if stopped is not None and len(detail) > stopped + 2:
            # A settings fault stopped it. Warnings print before the stop,
            # so the stop is found by its words; the lines after it up to
            # the last name the fault, each already a sentence.
            return ToolAnswer(
                why=(f"{name} exited {proc.returncode}: "
                     f"{' '.join(detail[stopped + 1:-1])} {detail[-1]}"),
                used=label)
        return ToolAnswer(why=(f"{name} exited {proc.returncode}"
                               + (f": {detail[-1]}" if detail else "")),
                          used=label)
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        data = None
    if data is None:
        # A bare `null` is no answer either, and must not read as "this
        # vault publishes nothing".
        return ToolAnswer(why=f"{name} did not return the expected JSON",
                          used=label)
    return ToolAnswer(data=data, used=used)


def hub_bodies_withheld(vault: Path, answer: ToolAnswer | None = None
                        ) -> tuple[set[str] | None, str | None, str | None]:
    """(session indexes whose body the site withholds, why the publish tool
    could not be asked, which tool answered when it wasn't the site's own).

    The answer comes from the publish tool itself (`explain --all --json`,
    its `bodyWithheld`), never a second reading of its rules here: #276's
    Python copy of the pairing drifted from session-hub.js within a day.
    It is the SITE's installed tool that answers, since that is what builds
    the site; the plugin's stands in only when the site has none installed.
    A vault with no `publish:` block publishes nothing, so nothing is
    withheld: (empty set, None, None). Otherwise any failure — no site_dir,
    no vault.config.json, a site pinned below 1.11.40 (it publishes every
    hub body), no node, an error, a timeout, output that isn't the expected
    JSON — is (None, reason, …), and the caller withholds nothing: a check
    that can't ask scans every hub body rather than guess. `answer` is an
    `explain --all` the caller already has, so one run serves two checks.
    """
    if answer is None:
        answer = ask_publish_tool(vault, ["explain", "--all"])
    if answer.data is None:
        return (set(), None, None) if answer.why is None else (
            None, answer.why, answer.used)
    try:
        pages = answer.data["pages"]
        return {unicodedata.normalize("NFC", str(p["path"]))
                for p in pages if p["bodyWithheld"] is True}, None, answer.used
    except (KeyError, TypeError):
        return None, "explain did not return the expected JSON", answer.used


# The first release whose `explain --all` names each file's stripped sections,
# and the first that withholds a handout's Keeper sections (#280).
STRIPPED_SECTIONS_SINCE = "1.11.41"

def _lines_tool(vault: Path) -> tuple[Path | None, str | None, str | None,
                                      bool]:
    """(the tool to ask what publishes, why none is asked, what to do
    about it, whether the vault has a site).

    `player_site.publish` is the switch, read by the plugin's publish tool
    (`vault_site`), which has the build's YAML parser. Off, there is no
    site: nothing is asked and nothing is checked for one, whatever
    `site_dir` says. Unset, in a vault from before the switch, a `site_dir`
    says on. On with no `site_dir` is a site still to be set up.

    With a site, the tool installed in that site folder answers: it is the
    one the site builds with, and it is not judged by a version number or
    a package.json pin, it is asked, and a tool without the `lines` command
    does not answer. A site whose package.json names the tool without it
    being installed has no tool to ask. One that does not name it is asked
    through whatever copy node would load from there (a workspace installs
    it higher up), and failing that by the plugin's own tool.
    """
    node_fix = "it needs Node 22+ on PATH"
    try:
        publishes, on, site = vault_site(vault)
    except PublishToolUnavailable as e:
        # No node, a node too old to run the tool, or a vault file the tool
        # will not parse: the switch is read here instead (`site_without_tool`).
        why = str(e)
        if why.startswith("the publish tool refused"):
            fix = f"fix {settings_file(vault)}"
        elif why.endswith("is not understood"):
            # The plugin's own tool answered in a shape this script does not
            # know: the two are from different releases.
            fix = "update the gm-apprentice plugin"
        else:
            fix = node_fix
        has_site = site_without_tool(settings(vault))
        if has_site:
            fix += (f"; if this vault has no site, set "
                    f"{setting_name(vault, 'player_site.publish')}: false "
                    f"in {settings_file(vault)}")
        elif fix == node_fix:
            # The site is off and only node is missing: there is nothing a
            # GM with no site has to hear about node.
            return None, site_is_off(vault), None, False
        return None, why, fix, has_site
    if not on:
        if _stop_fault(vault):
            # A stop fault can be what turned the switch off (a stray `publish:`
            # block in the new file): the vault may have a site, so say the
            # settings are the trouble, not that there is none.
            return None, SETTINGS_UNCLEAR, (
                "run the Settings check (vault_check.py <vault> settings) and "
                "fix what it lists"), True
        return None, site_is_off(vault), None, False
    if site is None:
        on_name = setting_name(vault, "player_site.publish")
        return None, (f"{on_name} is on but "
                      f"{setting_name(vault, 'player_site.folder')} names no "
                      f"site"), (
            f"set the site up with publish-site, or set {on_name}: false"
            ), True
    if publishes and settings(vault).inline:
        return None, (f"publish: in {settings_file(vault)} is written in a way that "
                      f"is not understood here (on one line)"), (
            "write it as a block at the margin, one key per line"), True
    if not (site / "vault.config.json").is_file():
        folder_name = setting_name(vault, "player_site.folder")
        return None, (f"no vault.config.json in {folder_name} "
                      f"({site.as_posix()})"), f"fix {folder_name}", True
    fix = f"run update-pin --site {site.as_posix()}, then run this again"
    installed = site / "node_modules" / PUBLISH_PACKAGE
    script = installed / "bin" / "gm-publish.js"
    if script.is_file():
        return script, None, fix, True
    if installed.is_symlink() or installed.exists():
        return None, f"{script.as_posix()} is missing", fix, True
    try:
        named = PUBLISH_PACKAGE in (site / "package.json").read_text(
            encoding="utf-8", errors="replace")
    except FileNotFoundError:
        named = False
    except OSError:
        named = True
    if named:
        # It builds with some version of the tool, not installed here. Which
        # one is npm's to work out, not a guess from the pin.
        return None, (f"the site's package.json names {PUBLISH_PACKAGE} "
                      f"but it is not installed in {site.as_posix()}"), (
            fix), True
    above = _resolved_from(site)
    if above is not None:
        # Installed above the site folder (a workspace): node loads it from
        # there when the site builds, so that is the one to ask.
        return above / "bin" / "gm-publish.js", None, fix, True
    # A site with no tool of its own is built with the plugin's.
    return PUBLISH_TOOL, None, node_fix, True


SETTINGS_UNCLEAR = "the settings could not be read cleanly"


def _stop_fault(vault: Path) -> bool:
    """Whether the vault's settings have a fault that stops a player build."""
    try:
        return any(f.get("level") == "stop" for f in settings(vault).faults)
    except SettingsUnavailable:
        return False


def site_is_off(vault: Path) -> str:
    return f"{setting_name(vault, 'player_site.publish')} is not on"


def _resolved_from(site: Path) -> Path | None:
    """The folder node would load the publish tool from when run in the
    site folder. None when node finds none, or cannot be run."""
    node = shutil.which("node")
    if not node:
        return None
    script = ("try { process.stdout.write(require.resolve("
              f"'{PUBLISH_PACKAGE}/package.json', {{ paths: [process.cwd()] "
              "})); } catch (e) {}")
    try:
        with subprocess.Popen(
                [node, "-e", script], cwd=site, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                errors="replace") as proc:
            try:
                found, _ = proc.communicate(timeout=PUBLISH_TOOL_TIMEOUT)
            except subprocess.TimeoutExpired:
                proc.kill()
                return None
    except OSError:
        return None
    found = found.strip()
    return Path(found).parent if found else None


def no_publish_tool(vault: Path, check: str) -> tuple[str | None, list[str]]:
    """(why the publish tool cannot say what publishes, the row saying so).

    (None, []) when it can; every later question in the run then goes to
    the tool chosen here (`_lines_tool`).

    What a section hides is the tool's decision and there is no copy of it
    here. For a vault with a site (`player_site.publish` on), no answer means the
    check stops and nothing is written: (why, [an ERROR]), because a guess
    could leak. For a vault with no site there is nothing to leak, nothing
    is asked and nothing has to be installed: (why, [an INFO]), and the
    caller carries on with whatever it does without the tool.
    """
    tool, why, fix, has_site = _lines_tool(vault)
    if tool is not None:
        use_publish_tool(tool)
        why = publish_tool_problem()
        if why is None:
            return None, []
    if has_site:
        return why, [f"ERROR\t(vault)\t{check} could not ask the publish "
                     f"tool what publishes ({why}) — nothing checked, "
                     f"nothing written; {fix}"]
    if _stop_fault(vault):
        # The settings are the trouble, and a vault whose settings cannot be
        # read may well have a site: not "this vault has no site".
        return SETTINGS_UNCLEAR, [
            f"ERROR\t(vault)\t{check} could not tell whether this vault has "
            f"a site: {SETTINGS_UNCLEAR} ({why}) — nothing checked, nothing "
            f"written; run the Settings check (vault_check.py <vault> "
            f"settings) and fix what it lists"]
    if why == site_is_off(vault):
        # gm-leak is only about the site, so it says why it has no rows. A
        # check with work of its own (pc-body, wrapup) just gets on with it.
        return why, [f"INFO\t(vault)\t{check} has no site to check: "
                     f"{site_is_off(vault)} in {settings_file(vault)}, so nothing publishes"
                     ] if check == "gm-leak" else []
    # The tool could not be asked. A vault file it refused is still to be
    # fixed; a missing node is nothing a GM with no site has to act on.
    todo = f"; {fix}" if fix == f"fix {settings_file(vault)}" else ""
    return why, [f"INFO\t(vault)\t{check} did not ask what a section would "
                 f"hide on a site ({why}). This vault has no site "
                 f"({site_is_off(vault)}), so nothing publishes{todo}"]


# The faults in a NOTE that change what the site shows, as the publish
# tool's `doctor --site --json` names them.
NOTE_FAULT_CODES = ("ALIAS_IN_PROSE", "WITHHELD_PUBLISHED",
                    "WITHHELD_IN_PROSE", "WITHHELD_NAME_PUBLIC",
                    "WITHHELD_FLAG_UNREADABLE", "FENCE_UNCLOSED",
                    "COMMENT_STRAY", "NAMED_NO_PAGE", "TOHIT_UNREAD")
# How many of the pages naming a note a row lists; `--file` lists them all.
SITE_FAULT_PAGES = 3


def _one_line(value: object) -> str:
    return " ".join(str(value if value is not None else "").split())


def _site_fault_row(f: dict[str, Any], whole: bool) -> str:
    """One finding of the tool's, as a row. Its words are the tool's own;
    nothing is worked out here."""
    code, level = f["code"], str(f.get("severity", "warning")).upper()
    path = _one_line(f.get("path")) or "(vault)"
    if code == "NAMED_NO_PAGE":
        kind = f.get("kind")
        what = (f"{kind} ({f.get('type')})" if kind else "no type")
        if f.get("withheld"):
            what = f"withheld {what}"
        pages = [_one_line(p) for p in f.get("pages") or []]
        shown = pages if whole else pages[:SITE_FAULT_PAGES]
        more = len(pages) - len(shown)
        printed = ", ".join(f'"{_one_line(w)}"' for w in f.get("printed") or [])
        reason = _one_line(f.get("reason"))
        count = f.get("pageCount", len(pages))
        msg = (f"NAMED_NO_PAGE: {what}, named on {count} "
               f"published page{'' if count == 1 else 's'} as {printed}; "
               f"no page because {f.get('why')}; "
               + (f"reason written: {reason}; " if reason else "no reason written; ")
               + "named on: " + "; ".join(shown)
               + (f"; +{more} more (--file lists them all)" if more > 0 else ""))
        # A page counted because an index or listing page prints the name
        # from it: the fix is in that note's field, not its text.
        via = [_one_line(p) for p in f.get("viaListing") or []]
        if via:
            outs = [_one_line(p) for p in f.get("listings") or []]
            msg += ("; printed only by an index or listing page ("
                    + ", ".join(outs[:SITE_FAULT_PAGES]) + ") from: "
                    + "; ".join(via if whole else via[:SITE_FAULT_PAGES]))
    elif code == "COMMENT_STRAY":
        msg = (f"COMMENT_STRAY: {_one_line(f.get('detail'))} | "
               f"{_one_line(f.get('text'))}")
    elif code == "FENCE_UNCLOSED":
        msg = f"FENCE_UNCLOSED: {_one_line(f.get('detail'))}"
    elif code == "TOHIT_UNREAD":
        msg = (f"TOHIT_UNREAD: {_one_line(f.get('detail'))} — "
               f"{_one_line(f.get('fix'))}")
    elif code in ("WITHHELD_NAME_PUBLIC", "WITHHELD_PUBLISHED",
                  "WITHHELD_FLAG_UNREADABLE"):
        msg = (f"{code}: {_one_line(f.get('detail'))} — "
               f"{_one_line(f.get('fix'))}")
    elif code == "WITHHELD_IN_PROSE":
        msg = (f"WITHHELD_IN_PROSE: \"{_one_line(f.get('name'))}\" (a "
               f"withheld note: {_one_line(f.get('owner'))}), printed "
               f"{f.get('count')} time{'' if f.get('count') == 1 else 's'} | "
               f"{_one_line(f.get('context'))}")
        outs = [_one_line(p) for p in f.get("listings") or []]
        if outs:
            msg += " | printed on the index or listing page: " + ", ".join(outs)
    else:
        msg = (f"ALIAS_IN_PROSE: \"{_one_line(f.get('alias'))}\" (a secret "
               f"name of {_one_line(f.get('owner'))}), printed "
               f"{f.get('count')} time{'' if f.get('count') == 1 else 's'} | "
               f"{_one_line(f.get('context'))}")
        outs = [_one_line(p) for p in f.get("listings") or []]
        if outs:
            msg += " | printed on the index or listing page: " + ", ".join(outs)
    return f"{level}\t{path}\t{msg}"


def check_site_faults(vault: Path, files: list[str] | None = None
                      ) -> list[str]:
    """The faults in the vault's notes that change what its site shows, as
    the site's own publish tool lists them (`doctor --site --json`): a note
    with no page named on a published page, a stray `%%`, an unclosed code
    fence over a hidden marker, a secret name printed in a page's text, and
    the faults of a withheld note (its name printed, a link to it, the note
    published, a shared name, an unreadable `withheld:` value).

    Every rule is the tool's. This asks, and prints its findings as rows;
    a finding the GM settled ("stays hidden:" in the manifest) is counted,
    not listed. A vault with no site has nothing to ask about. A tool from
    before these findings answers without them, and the row says so rather
    than report a clean site. `files` keeps the findings on those notes,
    with every page that names each."""
    tool, why, fix, has_site = _lines_tool(vault)
    if not has_site:
        if why == site_is_off(vault):
            return [f"INFO\t(vault)\tsite-faults has no site to check: "
                    f"{site_is_off(vault)} in {settings_file(vault)}"]
        # The switch reads off, but the publish tool could not be asked (a
        # vault file it will not parse): say that, and what to fix.
        todo = f"; {fix}" if fix else ""
        return [f"INFO\t(vault)\tsite-faults has no site to check "
                f"({why}){todo}"]
    if tool is None:
        return [f"ERROR\t(vault)\tsite-faults could not ask the publish tool "
                f"({why}) — nothing checked; {fix}"]
    _publishes, _on, site = vault_site(vault)
    node = shutil.which("node")
    if not node or site is None:
        return [f"ERROR\t(vault)\tsite-faults could not ask the publish tool "
                f"(node is not on PATH) — nothing checked; {fix}"]
    try:
        # Read to the end of the pipe: the answer runs to hundreds of KB on
        # a large vault, and the tool exits only once it is flushed (#279).
        proc = subprocess.run(
            [node, str(tool), "doctor", "--site", "--json", "--config",
             str(site / "vault.config.json"), "--vault", str(vault.resolve())],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=PUBLISH_TOOL_TIMEOUT, check=False)
    except subprocess.TimeoutExpired:
        return [f"ERROR\t(vault)\tsite-faults: the publish tool did not "
                f"answer within {PUBLISH_TOOL_TIMEOUT}s — nothing checked"]
    except OSError as e:
        return [f"ERROR\t(vault)\tsite-faults: node could not run "
                f"({e.__class__.__name__}) — nothing checked"]
    try:
        answer = json.loads(proc.stdout)
        findings = answer["findings"]
        # `counts.settled` came in with the note faults: a tool without it
        # has no such findings to give, which is not a clean site.
        settled = answer["counts"]["settled"]
        if not isinstance(findings, list) or not isinstance(settled, int):
            raise TypeError
        findings = [f for f in findings if isinstance(f, dict)]
    except (ValueError, KeyError, TypeError):
        return ["INFO\t(vault)\tsite-faults not run: the publish tool this "
                "site builds with is from before this check and does not "
                "list these faults — nothing checked; the vault migration "
                "brings the site's tool up to date"]
    rows = [f"ERROR\t{_one_line(f.get('path')) or '(vault)'}\t"
            f"{f.get('code')}: {_one_line(f.get('detail'))} — "
            f"{_one_line(f.get('fix'))}"
            for f in findings if f.get("severity") == "error"
            and f.get("code") not in NOTE_FAULT_CODES]
    if rows:
        return rows + ["ERROR\t(vault)\tsite-faults: the site audit stopped "
                       "at the error above — nothing else checked"]
    only = ({unicodedata.normalize("NFC", rel) for rel in files}
            if files else None)
    for f in findings:
        if f.get("code") not in NOTE_FAULT_CODES or f.get("settled"):
            continue
        if only is not None and unicodedata.normalize(
                "NFC", str(f.get("path"))) not in only:
            continue
        rows.append(_site_fault_row(f, whole=only is not None))
    if rows:
        # The tool that answered, the site file it read and the vault it
        # audited, so a fix is checked and recorded with the same three
        # (`explain --shown`, `manifest apply`): the site file may name
        # another vault than the one asked about.
        rows.insert(0, f"INFO\t(site)\tthe site's tool: node \"{tool}\" "
                       f"<command> --config \"{site / 'vault.config.json'}\""
                       f" --vault \"{vault.resolve()}\"")
    if settled and only is None:
        rows.append(f"INFO\t(vault)\t{settled} "
                    f"{'note is' if settled == 1 else 'notes are'} settled "
                    f"as \"stays hidden\" and not raised")
    return rows


def _tool_gone_row(check: str, e: Exception) -> str:
    """The row for a publish tool that stopped answering after a check
    began: what came before it stands, nothing after it was done."""
    return (f"ERROR\t(vault)\t{check} stopped: the publish tool stopped "
            f"answering ({e}) — the check is incomplete and nothing further "
            f"was written; run it again")


def sections_withheld(answer: ToolAnswer
                      ) -> tuple[dict[str, set[str]] | None, str | None]:
    """(per file, the casefolded headings the site withholds; why not).

    Read from `explain --all --json`'s `strippedSections`, the tool's own
    walk of its section filter — never a copy of its rules here. That
    covers the vault's exclude list and whatever the tool withholds by
    itself (a handout's Context, Clues and Prop Notes, #280). An answer
    without the field comes from a tool older than
    STRIPPED_SECTIONS_SINCE, which publishes those handout sections.
    """
    if answer.data is None:
        return None, answer.why
    try:
        pages = answer.data["pages"]
        if any("strippedSections" not in p for p in pages):
            return None, (f"the site's publish tool predates "
                          f"{STRIPPED_SECTIONS_SINCE}, so a handout's "
                          f"Context, Clues and Prop Notes sections publish "
                          f"— run update-pin")
        return {unicodedata.normalize("NFC", str(p["path"])):
                {str(t).strip().casefold() for t in p["strippedSections"]}
                for p in pages if p["strippedSections"]}, None
    except (KeyError, TypeError):
        return None, "explain did not return the expected JSON"


def pages_published(answer: ToolAnswer) -> set[str] | None:
    """The notes (NFC paths) the site publishes, from `explain --all --json`:
    the pages whose `publishes` is true. A note the tool's walk never reached
    (under an excluded folder) is not in its list at all, and one it lists
    with `publishes: false` (no `type:`, a draft, a play-notes page) is
    withheld; either way nothing in it can reach the players. None when the
    tool could not be asked, `pages` is missing or not a list, or a page does
    not give a boolean `publishes` (an older tool): the caller then skips
    nothing. An empty list is an answer: nothing publishes, so `set()`."""
    try:
        pages = answer.data["pages"] if answer.data is not None else None
        if not isinstance(pages, list) or not all(
                isinstance(p["publishes"], bool) for p in pages):
            return None
        return {unicodedata.normalize("NFC", str(p["path"]))
                for p in pages if p["publishes"]}
    except (KeyError, TypeError):
        return None


def publish_switches(answer: ToolAnswer) -> dict[str, bool] | None:
    """The site's resolved switches (`characterSheets`, `liveStats`,
    `inbox`) from `explain --all --json`, or None when the tool could not
    answer or its answer has no usable `switches` block (a tool older than
    1.12.0). Callers treat None as sheets on. The tool owns the keys and
    their precedence; nothing here reads them from the config."""
    try:
        block = answer.data["switches"] if answer.data is not None else None
        if not isinstance(block, dict):
            return None
        got = {k: block[k] for k in ("characterSheets", "liveStats", "inbox")}
    except (KeyError, TypeError):
        return None
    return got if all(isinstance(v, bool) for v in got.values()) else None


def pc_keep_sections(answer: ToolAnswer) -> set[str]:
    """The bare titles (`_bare_section_title`) of the `##` sections a PC
    keeps whatever the switches say: `pcKeepSections` in `explain --all
    --json` (a list when sheets are off, null or absent otherwise). Empty
    for a tool that predates the field; nothing here holds a copy of the
    list. Titles in parentheses are the tool's placeholders, not sections."""
    try:
        block = answer.data["pcKeepSections"] if answer.data is not None else None
    except (KeyError, TypeError):
        return set()
    if not isinstance(block, list) or not all(isinstance(t, str) for t in block):
        return set()
    return {_bare_section_title(t) for t in block if not t.strip().startswith("(")}


def sheet_withheld_sections(answer: ToolAnswer) -> dict[str, set[str]]:
    """Per file (NFC path), the `##` headings (`_bare_section_title`) the site withholds
    only because character sheets are off, from `sheetWithheldSections` in
    `explain --all --json`. Empty when the tool could not be asked,
    answered oddly, or predates the field: an older tool withholds nothing
    here, so nothing is removed from what gm-leak scans.

    The tool reports an HTML heading it withheld by its text, and names a
    heading it cannot read in parentheses (`(empty heading)`). So a title
    that starts with `(`, or that is one of `pc_keep_sections`, is never
    returned: a real, published `## Background` is scanned even when the
    tool also lists "Background" for an HTML heading."""
    keep = pc_keep_sections(answer)
    try:
        pages = answer.data["pages"] if answer.data is not None else []
        got = {unicodedata.normalize("NFC", str(p["path"])):
               {_bare_section_title(str(t)) for t in p["sheetWithheldSections"]
                if not str(t).strip().startswith("(")} - keep
               for p in pages if p.get("sheetWithheldSections")}
        return {rel: titles for rel, titles in got.items() if titles}
    except (KeyError, TypeError, AttributeError):
        return {}


_HK_WIKILINK = re.compile(r"\[\[((?:[^\]|\\]|\\(?!\|))+(?:\\?\|[^\]]*)?)\]\]")
# JavaScript's `\w` is the ASCII letters, digits and `_`; Python's takes in
# every letter, so the class is written out.
_HK_W = "A-Za-z0-9_"
_HK_PAIRS = [
    re.compile(r"(\*\*|__|~~|==)(.+?)\1"),
    re.compile(rf"(?<![{_HK_W}*])(\*)(?=\S)(.+?)(?<=\S)\1(?![{_HK_W}*])"),
    re.compile(rf"(?<![{_HK_W}])(_)(?=\S)(.+?)(?<=\S)\1(?![{_HK_W}])"),
    re.compile(r"(`+)([^`]+?)\1"),
]
_HK_EDGE = re.compile(r"^[*_~=`\s]+|[*_~=`\s]+$")


def _hk_class(ranges: str) -> re.Pattern[str]:
    """A character class from hex code-point ranges ("9-d 20 85")."""
    return re.compile("[" + "".join(
        "-".join(re.escape(chr(int(cp, 16))) for cp in r.split("-"))
        for r in ranges.split()) + "]")


# heading-key.js SPACE_RANGES and INVISIBLE_RANGES: every Unicode space,
# and every character that prints nothing. The shared vectors hold both
# lists, and both sides are tested against them.
_HK_SPACE_RANGES = "9-d 20 85 a0 1680 2000-200a 2028-2029 202f 205f 2800 3000"
_HK_INVISIBLE_RANGES = (
    "0-8 e-1f 7f-84 86-9f ad 34f 61c 115f-1160 17b4-17b5 180b-180f 200b-200f 202a-202e "
    "2060-206f 3164 fe00-fe0f feff ffa0 fff0-fffb 1bca0-1bca3 1d173-1d17a e0000-e0fff")
_HK_SPACE = _hk_class(_HK_SPACE_RANGES)
_HK_INVISIBLE = _hk_class(_HK_INVISIBLE_RANGES)


def _hk_decode_entities(text: str) -> str:
    """The character references heading-key.js `decodeReferences` reads:
    numeric ones, and every named one the Markdown renderer decodes, as
    the HTML5 rules decode it (`html.unescape` does the same, including a
    legacy name with no `;` of its own: `&nbsp2;` is a space and `2;`).
    A name not known as typed is tried in small letters."""
    def one(m: re.Match) -> str:
        body = m.group(1)
        if body[0] == "#":
            try:
                cp = (int(body[2:], 16) if body[1] in "xX"
                      else int(body[1:], 10))
            except ValueError:
                return m.group(0)
            if 0 < cp <= 0x10FFFF and not 0xD800 <= cp <= 0xDFFF:
                return chr(cp)
            return m.group(0)
        whole = m.group(0)
        exact = _html_unescape(whole)
        if exact != whole:
            return exact
        lower = whole.lower()
        folded = _html_unescape(lower)
        return folded if folded != lower else whole
    return re.sub(r"&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);", one, text,
                  flags=re.I)


def _bare_section_title(title: str) -> str:
    """heading-key.js `headingKey` (the label reading): lower-cased, with
    emphasis, link brackets, a `{#id}` block, a `^block-id`, closing `#`s,
    a trailing colon and spacing removed, so `**Skills**`, `Skills:` and
    `skills` are one section. Character references are decoded, every
    Unicode space is a space and every invisible character is dropped. The tool's titles and the file's headings
    both go through this, so a spelling cannot make them differ.
    tools/publish/test/fixtures/heading-key-vectors.json pins both."""
    text = _hk_decode_entities(title)
    text = unicodedata.normalize("NFC", text)
    text = _HK_SPACE.sub(" ", text)
    text = _HK_INVISIBLE.sub("", text)

    def label(m: re.Match) -> str:
        body = m.group(1)
        pipe = body.find("|")
        raw = body if pipe == -1 else body[:pipe]
        shown = "" if pipe == -1 else body[pipe + 1:]
        if shown.strip():
            return shown.strip()
        if pipe != -1 and raw.endswith("\\"):
            raw = raw[:-1]
        frag = re.search(r"[#^]", raw)
        name = raw if frag is None else raw[:frag.start()]
        # As the tool: a name that is only spaces is still a name (`[[ ^x]]`).
        return (re.sub(r"(?i)\.md$", "", name) or raw).strip()
    s = _HK_WIKILINK.sub(label, text)
    s = re.sub(r"<[^>]*>", "", s)
    s = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", s)
    for _ in range(12):
        before = s
        s = re.sub(r"\s*\{[#.][^}]*\}\s*$", "", s)
        s = re.sub(rf"\s+\^[{_HK_W}-]+\s*$", "", s)
        s = re.sub(r"(^|\s+)#+\s*$", "", s)
        s = re.sub(r"[:\uff1a]\s*$", "", s).strip()
        for pair in _HK_PAIRS:
            s = pair.sub(r"\2", s)
        s = _HK_EDGE.sub("", s)
        if s == before:
            break
    return re.sub(r"\s+", " ", s).strip().lower()


_LOOSE_HEADING_RE = re.compile(r"^\s{0,3}#{1,2}(\s|$)")
_SETEXT_UNDERLINE_RE = re.compile(r"^\s{0,3}(=+|-+)\s*$")
_HTML_HEADING_RE = re.compile(r"<h[1-6]", re.I)


def _without_sections(states: list[LineState], kept: set[int] | None,
                      titles: set[str]) -> set[int]:
    """`kept` (None: every line) minus the lines under each published H2
    whose title is in `titles` (already `_bare_section_title`d).

    Sections start only where this is sure: a level-2 heading that
    publishes and sits outside code. They end wherever a level-1 or 2
    heading could be, by a deliberately loose test the tool's own parser
    would pass or fail the same way or narrower (setext, indented ATX,
    empty `##`, an HTML heading), and the heading is then judged afresh.
    Any doubt leaves lines in the set, so they are scanned: a line wrongly
    dropped hides a leak, a line wrongly kept costs one row.
    """
    left = {s.lineno for s in states} if kept is None else set(kept)
    stops: set[int] = set()
    for i, state in enumerate(states):
        if (_LOOSE_HEADING_RE.match(state.line)
                or _HTML_HEADING_RE.search(state.line)):
            stops.add(i)
        elif (i > 0 and _SETEXT_UNDERLINE_RE.match(state.line)
                and states[i - 1].line.strip()):
            stops.update((i - 1, i))
    dropping = False
    for i, state in enumerate(states):
        if i in stops:
            dropping = False
        if (state.heading is not None and state.heading[0] == 2
                and state.published and not state.in_code
                and _bare_section_title(state.heading[1]) in titles):
            dropping = True
        if dropping:
            left.discard(state.lineno)
    return left


def _yaml_hint(message: str) -> str:
    """What to look for, read off the parser's own message. With no
    message (a tool older than 1.11.45) the two commonest causes; with
    one this does not know, nothing it cannot back up."""
    if not message:
        return ("most often a key written twice, or an unquoted value with "
                "a colon in it")
    if "duplicated mapping key" in message:
        return "a key is written twice; keep one"
    if "quoted scalar" in message:
        return ("a quote is not closed; the line named is where the block "
                "ends, not where the quote opens")
    if "flow collection" in message:
        return "a [ ] or { } value is not closed, or is missing a comma"
    if "mapping" in message:
        return ("most often a value with a colon or a quote mark in it; "
                "put the whole value in quotes")
    return "fix the YAML at the line named"


def unparseable_files(answer: ToolAnswer
                      ) -> tuple[dict[str, str | None] | None, str | None]:
    """(per file the site's build cannot parse, the parser's message; why
    the tool could not say).

    Read from `explain --all --json`: verdict code `FILE_UNPARSEABLE`, and
    `frontmatterError` for the message (None from a tool older than
    1.11.45, which reports the code alone, and misses the second of two
    notes with the same broken text). A vault that publishes nothing
    has no build to fail: (None, None).
    """
    if answer.data is None:
        return None, answer.why
    def headline(message: object) -> str | None:
        # js-yaml follows its one-line reason with a code excerpt.
        lines = str(message or "").strip().splitlines()
        return (lines[0].replace("\t", " ").rstrip(": ") or None
                ) if lines else None
    try:
        return {unicodedata.normalize("NFC", str(p["path"])):
                headline(p.get("frontmatterError"))
                for p in answer.data["pages"]
                if p.get("code") == "FILE_UNPARSEABLE"}, None
    except (KeyError, TypeError, AttributeError):
        return None, "explain did not return the expected JSON"


def _tool_used_row(used: str | None) -> list[str]:
    return ([f"INFO\t(vault)\tasked {used}"] if used else [])


def _publish_tool_row(why: str, consequence: str,
                      used: str | None = None) -> str:
    asked = f"; asked {used}" if used else ""
    return (f"INFO\t(vault)\tthe publish tool could not be consulted "
            f"({why}{asked}), so {consequence}")


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
    by_stem: dict[str, list[str]] = {}
    for rel, _t, _f in files:
        by_stem.setdefault(normalize(Path(rel).stem), []).append(rel)
    by_rel = {rel: fm for rel, _t, fm in files}
    indexes = [(rel, text, fm) for rel, text, fm in files
               if fm.get("type") == "session"]
    if not indexes:
        return ["INFO\t(vault)\tno session indexes found"]

    found, why, used = hub_bodies_withheld(vault)
    withheld = found if found is not None else set()
    rows: list[str] = []
    if found is None:
        rows.append(_publish_tool_row(
            why or "unknown", "no hub-bookkeeping rows are shown — they "
            "apply only where the site withholds the hub's body", used))
    else:
        rows.extend(_tool_used_row(used))
    played: list[str] = []
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
        for key in SESSION_DOC_TYPES:
            chain[key], b, u = _resolve_chain_key(
                key, rel, stem, number, chapter, documents,
                files, stems, by_stem, by_rel)
            broken.extend(b)
            unlinked.extend(u)

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
        # Only where the site really withholds the body (a paired Wrap-Up
        # that itself publishes); otherwise the body is live and prose is
        # the session's published record.
        if unicodedata.normalize("NFC", rel) in withheld:
            rows.extend(_hub_body_rows(rel, text))
        if declared.casefold() in PLAYED_STATUSES:
            played.append(rel)
    rows.extend(manifest_rows(vault, played))
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
# "Keeper" is the exception (`_keeper_word`): a whole word, and a job when
# another word comes right before it (#316).
KEEPER_WORDS = ("gm only", "gm-only", "dm only", "secret",
                "tactic", "confidential", "spoiler")
# Keeper or Keepers, not inside a longer word; "_" and "-" end it.
KEEPER_WORD_RE = re.compile(r"(?<![^\W_])keepers?(?![^\W_])")
# The whitespace-separated token just before it.
BEFORE_WORD_RE = re.compile(r"(\S+)\s+$")
PLAIN_WORD_RE = re.compile(r"\W*[^\W\d_][\w'’-]*")
# A word before "Keeper" that leaves it meaning the GM ("For the Keeper").
FUNCTION_WORDS = frozenset((
    "the", "a", "an", "for", "to", "of", "by", "from", "with", "and", "or",
    "your", "my", "our", "at", "under", "in", "on", "per", "see", "only",
    "any", "all", "no", "this", "that", "vs", "versus"))
# Before "Keeper", these are GM material, not an occupation.
GM_BEFORE = frozenset((
    "notes", "note", "background", "summary", "info", "information",
    "agenda", "guidance", "reference", "secrets", "brief", "truth"))
# After "Keeper", these end the phrase: "Lighthouse Keeper for hire".
FOLLOW_WORDS = frozenset(("the", "a", "an", "for", "to", "of", "by", "from",
                          "with", "and", "or", "at", "in", "on"))
END_PUNCTUATION = ".,;!?)]}\"”—–*"
# "Park Keeper's lodge" is a job; "Private Keeper's notes" is not.
GM_AFTER_POSSESSIVE = frozenset((
    "notes", "note", "only", "eyes", "info", "information", "agenda",
    "guidance", "advice", "tips", "secrets", "discretion", "control",
    "hands", "reference", "background", "section"))

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
# Emphasis wrapping a whole heading title, for the title shown in a row.
# Whether the site hides such a heading is the publish tool's answer
# (heading-key.js reads `### **GM Notes**` as `GM Notes`), never this pattern's.
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


def _phrase_ends(after: str) -> bool:
    """Does the phrase end right after "Keeper"? The text after it is
    empty or starts with closing punctuation or a function word, or a
    possessive that is not followed by a GM word."""
    if after[:2] in ("'s", "’s"):
        nxt = re.match(r"\W*([^\W_]+)", after[2:])
        return nxt is None or nxt.group(1) not in GM_AFTER_POSSESSIVE
    after = after.lstrip()
    if not after or after[0] in END_PUNCTUATION:
        return True
    word = re.match(r"[^\W_]+", after)
    return word is not None and word.group(0) in FOLLOW_WORDS


def _keeper_word(text: str) -> bool:
    """Does `text` say Keeper, the GM? "Lighthouse Keeper" is a job: a
    content word comes right before it and the phrase ends after it. A
    missed GM heading publishes unwarned, so every other shape flags:
    nothing before it, punctuation or a function word before it ("For the
    Keeper"), or more after it ("Private Keeper Notes")."""
    low = text.casefold()
    for m in KEEPER_WORD_RE.finditer(low):
        before = BEFORE_WORD_RE.search(low[:m.start()])
        if (before and PLAIN_WORD_RE.fullmatch(before.group(1))
                and before.group(1).strip("(*_[\"“‘'") not in FUNCTION_WORDS
                and before.group(1).strip("(*_[\"“‘'") not in GM_BEFORE
                and _phrase_ends(low[m.end():])):
            continue
        return True
    return False


def _keeper_text(text: str, excludes: list[str]) -> bool:
    """Does this title or label read as Keeper-facing?"""
    low = text.casefold()
    return (_keeper_word(low)
            or any(word in low for word in KEEPER_WORDS)
            or any(s.casefold() in low for s in excludes))


def _heading_leak(rel: str, state: LineState, excludes: list[str],
                  list_name: str) -> list[str]:
    """Rows for one published heading line."""
    if state.heading is None:
        return []
    level, raw = state.heading
    m = EMPHASIS_RE.match(raw)
    title = m.group(2).strip() if m else raw
    if _bare_section_title(raw) in {_bare_section_title(e) for e in excludes}:
        # A heading the site hides never reaches here: `scan_body` has
        # already marked it excluded, as the site's tool answered. This one
        # is on the exclude list under another spelling and the tool did
        # NOT hide it: a site pinned to a publish tool older than 1.16.0
        # (which read only an exact title), and so it publishes. The
        # remedy names the marker actually used, so the `*`/`_` spellings
        # do not send the GM hunting for asterisks that are not there.
        how = ("bold-wrapped" if m else "decorated")
        if m:
            fix = f"remove the {m.group(1)} or move it under ## GM Notes"
        else:
            fix = "write it plainly or move it under ## GM Notes"
        if level == 1:
            fix = ("rename the page title or move the page out of the "
                   "published folders")
        return [f"ERROR\t{rel}:{state.lineno}\t{how} heading "
                f"'{title}' defeats the exclude list and publishes — {fix}"]
    # Before the keyword check: "Keeper Checklist" is a wrap-template heading
    # and must get the re-nest advice, not the generic keyword row.
    if title.casefold() in {t.casefold() for t in WRAP_TEMPLATE_SUBSECTIONS}:
        # A GM Notes subsection of the wrap-up template (World State, …)
        # sitting where it publishes. The pre-fix 1.8.3 migration collapsed
        # exclude_sections to ["GM Notes"] without re-nesting, which left
        # these at the top level with nothing marking them GM-only (#239).
        # The pasted list keeps everything hidden today: the re-nest collapses
        # the list to ["GM Notes"] afterwards, so a list naming only this title
        # would un-hide every default it replaced.
        paste = list(excludes) + ([] if title.casefold() in
                                  {e.casefold() for e in excludes} else [title])
        return [f"WARNING\t{rel}:{state.lineno}\tGM-only heading '{title}' "
                f"publishes — nest it under ## GM Notes; to move every one at "
                f"once, set {list_name} to "
                f"{json.dumps(paste, ensure_ascii=False)} and run "
                f"`vault_check.py <vault> gm-leak --renest-excludes --fix`"]
    if _keeper_text(title, excludes):
        return [f"WARNING\t{rel}:{state.lineno}\tKeeper-facing heading "
                f"'{title}' publishes — nest it under ## GM Notes or fence it"]
    return []


def _published_linenos(states: list[LineState],
                       fm: dict) -> set[int] | None:
    """Which body lines a `publish: stub` page actually ships, or None.

    None means every line — the page is not a stub. The answer is the
    publish tool's `keepOnlySections` (`stub_kept`), which build.js
    applies to a stub page's body before anything downstream reads it:
    content runs from an included heading down to the next heading at its
    level or shallower, and an absent or empty `publish_include_sections`
    ships nothing at all.
    """
    if publish_mode(fm) != "stub":
        return None
    raw = fm.get("publish_include_sections")
    kept = stub_kept([s.line for s in states],
                     raw if isinstance(raw, list) else [])
    return {s.lineno for s, keep in zip(states, kept) if keep}


def check_gm_leak(vault: Path, folder: str | None,
                  fix: bool = False,
                  renest_excludes: bool = False,
                  explain: ExplainAll | None = None) -> list[str]:
    """`_gm_leak`, or one row when the publish tool stops answering part-way.
    Its writes all come after the last question, so nothing is written."""
    try:
        return _gm_leak(vault, folder, fix, renest_excludes, explain)
    except PublishToolUnavailable as e:
        return [_tool_gone_row("gm-leak", e)]


def _gm_leak(vault: Path, folder: str | None, fix: bool = False,
             renest_excludes: bool = False,
             explain: ExplainAll | None = None) -> list[str]:
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

    Every call also plans the heading re-nest (`WOULD-FIX` rows); `fix`
    writes it (`FIXED`). What moves: `##` sections the publish tool withholds by its own rule
    (`explain --all`'s `strippedSections`, #280). Keyword-only WARNING
    headings and INFO rows are the GM's call and are never moved.

    `renest_excludes` appends `renest_excludes_migration`'s rows (the
    1.8.3 migration) instead of planning the plain re-nest.

    Which lines an excluded section withholds is asked of the publish
    tool (`scan_body`); when it cannot be asked, or the site is pinned to
    a tool too old to ask, the check says so and stops
    (`no_publish_tool`).
    """
    notes = [(rel, text, extract_frontmatter(text) or {})
             for rel, text in vault_files(vault, folder)]
    if notes:
        why, gate = no_publish_tool(vault, "gm-leak")
        if why is not None:
            return gate
    # The list the build applies is the settings' own: the vault file's, the
    # site file's old one, else the built-in.
    explain = explain or ExplainAll(vault)
    tool = explain() if notes else None
    excludes = vault_settings(vault).get("player_site.hide.sections") if notes else []
    match = {s.casefold() for s in excludes}
    writes: list[tuple[str, str, list[str]]] = []
    rows: list[str] = []
    withheld: set[str] = set()
    published: set[str] | None = None
    not_published = 0
    # Headings only the tool withholds (not on the exclude list), per file.
    tool_stripped: dict[str, set[str]] = {}
    sheet_off: dict[str, set[str]] = {}
    if tool is not None:
        sheet_off = sheet_withheld_sections(tool)
        published = pages_published(tool)
        rows.extend(_tool_used_row(tool.used if tool.data is not None
                                   else None))
        if any(fm.get("type") == "session" for _r, _t, fm in notes):
            answer, why, used = hub_bodies_withheld(vault, tool)
            if answer is not None:
                withheld = answer
            else:
                rows.append(_publish_tool_row(
                    why or "unknown", "every session index body was scanned, "
                    "including any the site withholds", used))
        stripped, why = sections_withheld(tool)
        if stripped is not None:
            # The tool reports titles as written; the re-nest matches them
            # with emphasis unwrapped, so carry both spellings.
            tool_stripped = {rel: {v for t in titles
                                   for v in (t, _plain_title(t).casefold())}
                             - match for rel, titles in stripped.items()}
        has_documents = any(entity_type(fm) in ("document", "handout")
                            for _r, _t, fm in notes)
        if stripped is None and tool.data is not None:
            rows.append(f"WARNING\t(vault)\t{why}")
        elif stripped is None and why is not None and has_documents:
            rows.append(_publish_tool_row(
                why, "headings the site withholds on its own, like a "
                "handout's Context, Clues and Prop Notes, were not checked",
                tool.used))
    for rel, text, fm in notes:
        if entity_type(fm) in GM_LEAK_SKIP_TYPES:
            continue
        if publish_mode(fm) == "none":
            continue
        if published is not None and unicodedata.normalize(
                "NFC", rel) not in published:
            # The site does not publish this note (an excluded folder, no
            # `type:`, a draft): nothing in it can reach the players.
            not_published += 1
            continue
        if unicodedata.normalize("NFC", rel) in withheld:
            # session-hub.js suppressHubBody: the site publishes the
            # frontmatter and the Wrap-Up's recap, not this body.
            continue
        states, problems = scan_body(text, excludes)
        kept = _published_linenos(states, fm)
        # With character sheets off the tool withholds a PC's sheet sections
        # whatever they are called; their lines are no more published than a
        # stub's omitted ones, so they leave the kept set the same way.
        no_sheet = sheet_off.get(unicodedata.normalize("NFC", rel))
        if no_sheet:
            kept = _without_sections(states, kept, no_sheet)
        if kept is not None and not kept:
            continue
        rows.extend(_fence_rows(rel, problems, kept))
        own_strips = tool_stripped.get(unicodedata.normalize("NFC", rel), set())
        heading_leak = False
        for state in states:
            if kept is not None and state.lineno not in kept:
                continue
            # `published` deliberately says nothing about code fences —
            # vaultlib's divergence note — so exclude them here, or this
            # repo's own documented examples become findings.
            if state.in_code or not state.published:
                continue
            if state.heading is not None:
                found = _heading_leak(rel, state, excludes, setting_name(
                    vault, "player_site.hide.sections"))
                title = state.heading[1].strip()
                if (not found and state.heading[0] == 2
                        and title.casefold() in own_strips):
                    # The publish tool withholds it by its own rule (a
                    # handout's Keeper sections, #280) — from 1.11.41 on;
                    # an older pin publishes it, and the (vault) row says
                    # so. Its home is under GM Notes, and moving it is
                    # mechanical.
                    found = [f"WARNING\t{rel}:{state.lineno}\t'{title}' "
                             f"is Keeper material outside ## GM Notes — "
                             f"nest it under ## GM Notes (publish "
                             f"{STRIPPED_SECTIONS_SINCE}+ withholds it; to "
                             f"publish it, rename the heading)"]
                rows.extend(found)
                heading_leak = heading_leak or bool(found)
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
                if GM_WORD_RE.search(low) or _keeper_word(ctype) or _keeper_word(title):
                    label = f"[!{ctype}] {title}".strip()
                    rows.append(f"INFO\t{rel}:{state.lineno}\tcallout {label} "
                                f"reads Keeper-facing — confirm it should "
                                f"publish")
        if not heading_leak or renest_excludes:
            continue
        moved, new_text, refusal = _plan_gm_leak_fix(
            vault, rel, fm, excludes, excludes, match, excludes,
            h2_match=own_strips)
        if refusal:
            rows.append(f"ERROR\t{rel}\tre-nest refused: {refusal} — "
                        f"nothing written")
        elif new_text is not None:
            writes.append((rel, new_text, moved))
    if not_published:
        rows.append(f"INFO\t(vault)\t{not_published} notes skipped: the site "
                    f"does not publish them")
    if renest_excludes:
        return rows + renest_excludes_migration(vault, fix)
    mode = "FIXED" if fix else "WOULD-FIX"
    for rel, new_text, moved in writes:
        if fix:
            _write_text(vault, rel, new_text)
        rows.extend(f"{mode}\t{rel}\tre-nested '{title}' under ## GM Notes"
                    for title in moved)
    return rows

CURRENT_STATUS = "current status"
# The two protected sections `## Current Status` must precede.
PROTECTED_H2 = {"notes", "gm notes"}
CANONICAL_FIRST_H2 = "Stat Sheet"


# The first publish tool whose `explain --all` reports `sheetSourceSet`.
SHEET_SOURCE_SINCE = "1.11.44"


def _sheet_source_written(text: str) -> bool:
    """Is anything written after `sheet_source:` in this file's frontmatter?

    An absent key and the template's `sheet_source: ""` say nothing, and
    that much is read here so a vault of template PCs needs no publish tool.
    What a written value means is the publish tool's to say
    (sheet_sources_unset)."""
    match = FRONTMATTER_RE.match(text)
    lines = match.group(1).split("\n") if match else []
    for i, line in enumerate(lines):
        # YAML also takes `sheet_source : x` and a quoted key.
        key = re.match(r"""["']?sheet_source["']?[ \t]*:(.*)""", line)
        if not key:
            continue
        if scalar_value(key.group(1)).strip():
            return True
        # Nothing on the line: a list or block may follow, indented, past
        # any blank or comment lines.
        follow = next((ln for ln in lines[i + 1:]
                       if ln.strip() and not ln.lstrip().startswith("#")), "")
        return follow[:1].isspace() or follow.startswith("- ")
    return False


def sheet_sources_unset(answer: ToolAnswer
                        ) -> tuple[set[str] | None, str | None, str | None]:
    """(the PCs whose `sheet_source` says nothing, why the publish tool could not
    be asked, which tool answered when it wasn't the site's own).

    The publish tool reads the field (sheet-source.js) and reports it as
    `sheetSourceSet` in `explain --all --json`; nothing here reads the YAML
    a second way. A file the tool makes no page for (an unmapped folder)
    has no answer and is left out: nothing publishes to be missing a
    sheet. (None, None, None) means the vault publishes nothing, so there
    is no tool to ask. `answer` is the run's `explain --all`."""
    if answer.data is None:
        return None, answer.why, answer.used
    try:
        pages = answer.data["pages"]
        if not isinstance(pages, list):
            raise TypeError
        if any("sheetSourceSet" not in p for p in pages):
            return None, (f"the site's publish tool predates "
                          f"{SHEET_SOURCE_SINCE}"), answer.used
        return ({unicodedata.normalize("NFC", str(p["path"]))
                 for p in pages if p["sheetSourceSet"] is False},
                None, answer.used)
    except (KeyError, TypeError):
        return None, "explain did not return the expected JSON", answer.used


def retired_sheet_fields(answer: ToolAnswer) -> dict[str, list[str]]:
    """The frontmatter fields each PC carries that the character sheet no
    longer reads, by NFC path, from `retiredSheetFields` in `explain --all
    --json`. The publish tool owns the list (pc-prose.js); nothing here
    names a field. Empty when the tool could not be asked, answered oddly,
    or predates the field: the warning is advice, so an older tool means
    no row, never a guess."""
    try:
        pages = answer.data["pages"] if answer.data is not None else []
        return {unicodedata.normalize("NFC", str(p["path"])): list(p["retiredSheetFields"])
                for p in pages if p.get("retiredSheetFields")}
    except (KeyError, TypeError, AttributeError):
        return {}


def _is_stat_sheet(title: str) -> bool:
    """`## **Stat Sheet**` and `## Stat Sheet:` are the same section to the
    publish tool, which reads the heading's text."""
    bare = re.sub(r"[*_`]", "", title).strip().rstrip(":").strip()
    return bare.casefold() == CANONICAL_FIRST_H2.casefold()


def _normalise_sheet(lines: Iterable[str]) -> list[str]:
    """Section lines with table padding, delimiter rows and blank lines taken
    out, so a sheet re-aligned by an editor still compares equal to its
    template."""
    out = []
    for line in lines:
        collapsed = re.sub(r"\s+", " ", line).strip()
        collapsed = re.sub(r"\s*\|\s*", "|", collapsed)
        if collapsed and not re.fullmatch(r"[|:\- ]+", collapsed):
            out.append(collapsed)
    return out


def _stat_sheet_lines(states: list[LineState], start: LineState) -> list[str]:
    """The published lines of the `## Stat Sheet` section `start` opens, up
    to the next H2, normalised."""
    lines = []
    for state in states:
        if state.lineno <= start.lineno:
            continue
        if state.heading is not None and state.heading[0] <= 2:
            break
        # Fenced and excluded lines do not publish: no part of the sheet.
        if not state.published:
            continue
        lines.append(state.line)
    return _normalise_sheet(lines)


# How many lines of a Stat Sheet may differ from its template's before it
# counts as filled in. One (a note beside Level) is still the template's
# sheet. Two is already a possible character: a GURPS PC at all 10s but DX,
# with the Basic Speed that follows from it.
TEMPLATE_SLACK = 1

_TEMPLATE_STAT_SHEETS: list[set[str]] | None = None


def _template_stat_sheets() -> list[set[str]]:
    """Each shipped PC template's untouched `## Stat Sheet`, as its set of
    normalised lines."""
    global _TEMPLATE_STAT_SHEETS
    if _TEMPLATE_STAT_SHEETS is None:
        sheets: list[set[str]] = []
        templates = Path(__file__).resolve().parent.parent / "templates"
        for path in sorted(templates.glob("pc-*.md")):
            body = path.read_text(encoding="utf-8").replace("\r\n", "\n")
            match = re.search(r"^## Stat Sheet[ \t]*\n(.*?)(?=^## |\Z)", body,
                              re.M | re.S)
            lines = set(_normalise_sheet(match.group(1).split("\n"))) \
                if match else set()
            if lines:
                sheets.append(lines)
        _TEMPLATE_STAT_SHEETS = sheets
    return _TEMPLATE_STAT_SHEETS


def _stat_sheet_problem(lines: list[str]) -> str | None:
    """Why this Stat Sheet gives the page no real character sheet, or None.

    Three ways: nothing under the heading; the template's own values,
    untouched or nearly; a pointer or a "TBD" where the stats should be.
    The template test is by lines, not an exact match, so a note beside one
    row, or a PC made from an older template (a row since added or
    dropped), still counts.
    """
    if not lines:
        return "is empty"
    for template in _template_stat_sheets():
        differing = sum(1 for line in lines if line not in template)
        if differing == 0:
            return "still holds the template's placeholder values"
        # Slack only on a sheet long enough for two lines to be a small part.
        if differing <= TEMPLATE_SLACK and len(lines) >= 8:
            return (f"is the template's but for {differing} "
                    f"line{'' if differing == 1 else 's'}")
    # Subheads alone are a skeleton with nothing in it.
    content = [line for line in lines if not re.match(r"#{1,6}(?: |$)", line)]
    if not content:
        return "holds no stats"
    # A table is a sheet, as it is to the publish build, and so are dots
    # (●●○○ ratings) and an embedded image of the sheet.
    text = " ".join(content)
    if re.search(r"!\[|[●○◆◇]", text) \
            or any(line.startswith("|") for line in content):
        return None
    # A figure makes it a sheet. These are not figures, whatever digits they
    # hold: a link (its text and its target), a bare web address, a file
    # name, a page reference, a year in brackets, a list's own numbering.
    # Each pattern needs a mark a stat line does not have (a letter in the
    # file's name, a dot after "p", a lettered domain), so "PP 5", "Speed
    # 6.md" and "Move 6.5/turn" keep their figures. Other digits in a
    # pointer ("version 2 is on Roll20") still pass; a warning that misses
    # is cheaper than one that cries wolf.
    prose = " ".join(re.sub(r"^\d+[.)] ", "", line) for line in content)
    prose = re.sub(r"\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)"
                   r"|(?:https?://|www\.)\S+"
                   r"|\b[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/\S*",
                   "", prose)
    prose = re.sub(
        r"(?=[\w-]*[A-Za-z])[\w-]+\.(?:pdf|png|jpe?g|gif|webp|svg|heic|docx?"
        r"|odt|rtf|xls[xm]?|ods|csv|json|md|txt|gcs|gca\d?)\b"
        r"|\b(?:pages?|pp?\.|pg\.)\s*\d+(?:\s*(?:[-–,]|and)\s*\d+)*"
        r"|\((?:19|20)\d\d\)", "", prose, flags=re.I)
    # A figure stands alone: the 5 of "5e" or "D&D 5th" is part of a name.
    if re.search(r"(?<![A-Za-z0-9])[+-]?\d+(?![A-Za-z0-9])", prose):
        return None
    # Words only. A sheet in words (Fate aspects and skills) runs to several
    # lines and gives them a shape: list items, emphasised or `Label:` names,
    # `Name — rating` pairs, or values under subheads. A line or two, or
    # plain sentences, is a "TBD" or a pointer to where the sheet really is.
    shaped = len(lines) - len(content) >= 2 or any(
        re.match(r"(?:[-*+]|\d+[.)]) |[*_]|[^:]{1,30}:\s|[^—–-]{1,30} [—–-] \S",
                 line) for line in content)
    if len(content) <= 2 or not shaped:
        return "holds no stats"
    return None


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


def check_pc_body(vault: Path, folder: str | None = None,
                  files: Iterable[str] | None = None,
                  newer_than: float | None = None,
                  explain: ExplainAll | None = None) -> list[str]:
    """`_pc_body`, or one row when the publish tool stops answering
    part-way. The check writes nothing."""
    try:
        return _pc_body(vault, folder, files, newer_than, explain)
    except PublishToolUnavailable as e:
        return [_tool_gone_row("pc-body", e)]


def _pc_body(vault: Path, folder: str | None = None,
             files: Iterable[str] | None = None,
             newer_than: float | None = None,
             explain: ExplainAll | None = None) -> list[str]:
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

    `folder`/`files`/`newer_than` scope the walk to the PC sheet(s) a
    run just refreshed — the check reads every row it emits either way,
    so scoping is about not emitting the vault's pre-existing findings.
    """
    rows: list[str] = []
    # One `explain --all` for the run, shared by every question asked of it.
    explain = explain or ExplainAll(vault)
    # The build's exclude list, asked of the tool at the first PC.
    excludes: list[str] | None = None
    # Whether the publish tool can say what a section hides, once asked;
    # and whether this is a vault with no site and no tool to ask.
    gated = no_tool = False
    # The publish tool's reading of each PC's sheet_source, once asked.
    sources: tuple[set[str] | None, str | None, str | None] | None = None
    # The fields each PC carries that its sheet no longer reads, once asked.
    retired: dict[str, list[str]] | None = None
    # False once the tool says character sheets are off: no sheet is built, so
    # nothing about one is worth a row. Unknown (an older tool) means on.
    sheets_on = True
    for rel, text in vault_files(vault, folder, files, newer_than=newer_than):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "pc" or rel.endswith("_Story.md"):
            continue
        if publish_mode(fm) == "none":
            continue
        if not gated:
            gated = True
            why, gate = no_publish_tool(vault, "pc-body")
            if why is not None and gate and gate[0].startswith("ERROR"):
                return gate
            if why is not None:
                # No site and no tool: the structure checks still run,
                # with nothing counted as hidden by a section.
                rows.extend(gate)
                excludes, no_tool = [], True
        if excludes is None:
            excludes = vault_settings(vault).get("player_site.hide.sections")
        states, problems = scan_body(text, excludes)
        kept = None if no_tool else _published_linenos(states, fm)
        if kept is not None and not kept:
            continue
        rows.extend(_fence_rows(rel, problems, kept))

        if retired is None:
            answer = explain()
            retired = retired_sheet_fields(answer)
            switches = publish_switches(answer)
            sheets_on = switches is None or switches["characterSheets"]
        stale = retired.get(unicodedata.normalize("NFC", rel))
        if stale and sheets_on:
            rows.append(f"WARNING\t{rel}\tfrontmatter field(s) "
                        f"{', '.join(stale)} are no longer read for the "
                        f"character sheet \u2014 move the values into the "
                        f"note's ## {CANONICAL_FIRST_H2} sections")

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

        # A whole sheet with no stats, or with the template's own, publishes
        # a Character Sheet tab that says nothing (#273). `sheet_source`
        # records that the sheet is kept elsewhere, which settles it. A stub
        # publishes named fragments only, so its Stat Sheet is not judged.
        if kept is None and sheets_on:
            # A fenced or excluded Stat Sheet does not publish, so the page
            # has none.
            stat = next((st for st, title in h2s
                         if _is_stat_sheet(title) and st.published), None)
            remedy = ("fill it in, or set sheet_source to where the sheet "
                      "is kept")
            row = None
            if stat is None:
                row = (f"WARNING\t{rel}\tno published "
                       f"## {CANONICAL_FIRST_H2} section — the PC's page "
                       f"has no character sheet; fill one in, or set "
                       f"sheet_source to where the sheet is kept")
            else:
                problem = _stat_sheet_problem(_stat_sheet_lines(states, stat))
                if problem:
                    row = (f"WARNING\t{rel}:{stat.lineno}\t"
                           f"## {CANONICAL_FIRST_H2} {problem}; {remedy}")
            if row and _sheet_source_written(text):
                # Asked once a run, and only when a PC's answer turns on it.
                if sources is None:
                    sources = sheet_sources_unset(explain())
                    unset, why, used = sources
                    if unset is not None:
                        rows.extend(_tool_used_row(used))
                    elif why:
                        rows.append(_publish_tool_row(
                            why, "a sheet_source with anything written in "
                            "it was taken as set", used))
                unset = sources[0]
                if unset is None \
                        or unicodedata.normalize("NFC", rel) not in unset:
                    row = None
            if row:
                rows.append(row)

        if kept is None and sheets_on and h2s \
                and h2s[0][1].casefold() != CANONICAL_FIRST_H2.casefold():
            rows.append(f"INFO\t{rel}\tfirst body H2 is '## {h2s[0][1]}' — "
                        f"the canonical skeleton opens with "
                        f"## {CANONICAL_FIRST_H2}")
    return rows


# --------------------------------------------------------------------------
# Session Wrap-Up conformance
#
# Mechanises campaign-qa/references/checks/wrapup-conformance.md Steps 1-3
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
#
# Under GM Notes or not is the only rule: from 1.10.28 a novel H2 outside
# the fence is the author's choice (player-facing), never reported or
# moved. Only a title that is one of the template's own GM Notes
# subsections is a slip. Before 1.10.28 every other H2 was Keeper-facing
# unless the vault listed it in `publish.wrap_up.player_sections`. That list
# is retired; an explicit `player` set is that earlier reading, passed in by
# the migration's one-time step.
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

# Used only when the template is missing: the `####` names it nests under
# `### What Carries Forward`, on top of the `###` fallback above.
WRAP_GM_HEADINGS_FALLBACK: tuple[str, ...] = WRAP_SUBSECTIONS_FALLBACK + (
    "Unresolved Threads", "Player-Stated Intentions",
    "Pending Consequences", "NPCs Needing Follow-Up", "Skipped Prep",
)


def _wrap_template_gm_headings() -> tuple[str, ...]:
    """Every `###` and `####` heading below `## GM Notes` in the template.

    These are the names the checker reserves as Keeper when one appears
    as a `##` outside the fence. A placeholder heading (`#### [[PC Name]]
    (Player)`) is a pattern, not a name, and is left out.
    """
    try:
        text = WRAP_TEMPLATE_PATH.read_text(encoding="utf-8")
    except OSError:
        return WRAP_GM_HEADINGS_FALLBACK
    found: list[str] = []
    inside = False
    for line in text.splitlines():
        m = re.match(r"^(#{2,4})\s+(.+?)\s*$", line)
        if not m:
            continue
        if len(m.group(1)) == 2:
            inside = m.group(2).strip().casefold() == "gm notes"
        elif inside and not m.group(2).startswith("[["):
            found.append(m.group(2))
    return tuple(found) or WRAP_GM_HEADINGS_FALLBACK


WRAP_TEMPLATE_GM_HEADINGS = _wrap_template_gm_headings()

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
CHAPTER_WRAP_FILENAME_RE = re.compile(r"^Chapter_\d+(?:\.\d+)?_Wrap_Up$")
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
class WrapDetail:
    """One finding of a wrap-up, and whether that note publishes at all
    (it does not under `publish: none` or in a vault with no site)."""

    rel: str
    finding: Finding
    publishes: bool


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


def player_section_key(title: str) -> str:
    """How an H2 title is compared with an entry of the retired
    `publish.wrap_up.player_sections` list (the migration's one-time step
    still reads it): emphasis unwrapped, whitespace collapsed, case
    folded."""
    return " ".join(_plain_title(title).split()).casefold()


def _keeper_key(title: str) -> str:
    """A heading title reduced for the reserved-name match: emphasis,
    case, whitespace, trailing punctuation and a trailing parenthetical
    all ignored."""
    plain = re.sub(r"\*+|(?<!\w)_+|_+(?!\w)", "", title)
    plain = re.sub(r"\s*\([^)]*\)\s*$", "", plain.strip())
    plain = " ".join(plain.split()).strip(" \t:.,;!?-\u2013\u2014")
    return plain.casefold()


def template_keeper_title(title: str) -> bool:
    """Whether a Wrap-Up `##` title is a name the template reserves for
    GM Notes: any `###` or `####` heading under `## GM Notes` in
    `shared/templates/session-wrap.md` (`World State`, `Skipped Prep`,
    `Name Conflicts`, ...). Matching ignores emphasis, case, whitespace,
    trailing punctuation and a trailing parenthetical, so `World State:`,
    `**Quality Notes:**` and `World State (after the duel)` match, as does
    the decorated form `**World State** — after the duel`; `World State of
    Play` and `Skipped` do not. Outside the fence such a title is a slip:
    the re-nest moves it under GM Notes, where it becomes a `###` with its
    children demoted a level. This is the one definition; `vault_write.py`
    uses it to refuse the same titles."""
    names = {_keeper_key(n) for n in WRAP_TEMPLATE_GM_HEADINGS}
    if _keeper_key(title) in names:
        return True
    found = decorated_heading(re.sub(r"\*+", "", title).strip())
    return found is not None and _keeper_key(found[0]) in names


def is_player_h2(title: str, player: frozenset[str] | None) -> bool:
    """Whether a Wrap-Up H2 that is not the recap, Memorable Moments or GM
    Notes is player-facing. `None`: it is, unless the template names it a
    GM Notes subsection (under GM Notes or not is the only rule). A set:
    the reading before 1.10.28, where only listed titles are; the
    migration's `wrapup-sections` step runs it once."""
    if player is None:
        return not template_keeper_title(title)
    return player_section_key(title) in player


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
                              exclude: list[str],
                              player: frozenset[str] | None = None
                              ) -> list[Finding]:
    """Step 3 — publish safety. Under GM Notes or not is the rule.

    An H2 outside the fence is player-facing, the author's own: the
    recap, `## Memorable Moments` and any other. Only a title the
    template names a GM Notes subsection (`## World State`, plain or
    decorated) is drift the re-nest repairs. `player=None` is that
    reading; a frozenset of comparison keys is the reading before
    1.10.28, where only the recap, Memorable Moments and the listed
    titles are player-facing and every other H2 is drift. The level
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
    preserved, crossing = _gm_pair_plan(states, player)
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
            f"template uses a single pair", "renest", ("openers",)))

    has_recap = False
    for state in states:
        if state.heading is None:
            if state.in_code:
                out.extend(_fenced_heading_finding(
                    rel, state, infos.get(state.lineno, ""), player))
            continue
        level, title = state.heading
        where = f"{rel}:{state.lineno}"
        if level == 2:
            if is_recap_title(title) and has_recap:
                if player is None:
                    out.append(Finding(
                        "INFO", where,
                        f"'## {title}' is a second heading titled like a "
                        f"recap; the first is used as the session's recap"))
                else:
                    out.append(Finding(
                        "WARNING", where,
                        f"'## {title}' is a second recap-variant heading "
                        f"left as-is — merge by hand"))
                continue
            has_recap = has_recap or is_recap_title(title)
            out.extend(_wrap_h2_finding(rel, state, where, title, player))
        found = decorated_heading(title)
        if found:
            name, qualifier = found
            out.append(Finding(
                "INFO", where,
                f"decorated heading '{title}' — rename to the template name "
                f"'{name}' and keep the qualifier as an italic first line",
                "decorated", (title, name, qualifier)))

    if not has_recap and any(f.kind == "keeper-h2" for f in out):
        # A keeper-h2 with no recap. Under the pre-1.10.28 reading (an
        # explicit `player` set) every H2 but the recap and Memorable
        # Moments is Keeper-facing, so the whole body is re-nested into the
        # GM block — correct, and a surprise; the row says "every other H2"
        # for that reading and names only the template's subsections for
        # the new one. Say so before the GM confirms the fix, not after the
        # site loses the session's recap.
        out.append(Finding(
            "WARNING", rel,
            "no ## Narrative Recap — the publish tool lifts that section as "
            "the session's player-facing recap, and --fix re-nests "
            + ("the template's GM Notes subsections"
               if player is None else "every other H2")
            + " under ## GM Notes; retitle the player-facing one first",
            "no-recap"))
    return out


def _fenced_heading_finding(rel: str, state: LineState,
                            info: str,
                            player: frozenset[str] | None = None
                            ) -> list[Finding]:
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
    if is_player_h2(title, player):
        return []
    return [Finding("WARNING", f"{rel}:{state.lineno}",
                    f"Keeper-facing H2 '## {title}' is inside a code fence — "
                    f"quoted, not re-nested")]


def _wrap_h2_finding(rel: str, state: LineState, where: str,
                     title: str,
                     player: frozenset[str] | None = None
                     ) -> list[Finding]:
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
                        "renest", ("unfenced",))]
    if is_player_h2(title, player):
        # Player-facing under the reading in force; one the GM fenced is
        # deliberately hidden and stays where it is.
        return []
    if state.published:
        return [Finding("ERROR", where,
                        f"Keeper-facing H2 '## {title}' publishes — re-nest "
                        f"it under ## GM Notes", "keeper-h2", (title,))]
    return [Finding("WARNING", where,
                    f"Keeper-facing H2 '## {title}' is already hidden "
                    f"(exclude list or fence) — re-nest it under ## GM Notes",
                    "keeper-h2", (title,))]


def wrapup_filename_findings(rel: str) -> list[Finding]:
    """Step 4. Never fixed here: `relink.py` renames the file and every
    link to it, and the migration offers it as a choice."""
    stem = Path(rel).stem
    if WRAP_FILENAME_RE.match(stem):
        return []
    if CHAPTER_WRAP_FILENAME_RE.match(stem):
        return [Finding("INFO", rel,
                        "chapter-level wrap-up filename — conformant as-is")]
    return [Finding("WARNING", rel,
                    f"filename '{Path(rel).name}' is not "
                    f"Chapter_CC_Session_NN_Wrap_Up.md — relink.py renames "
                    f"it and updates every link")]


def _wrap_blocks(states: list[LineState],
                 player: frozenset[str] | None = None
                 ) -> list[tuple[str, str, list[LineState]]]:
    """(kind, title, lines) for the preamble and every H2 block.

    Kinds are the four the template knows — `preamble`, `recap`,
    `moments`, `gm` — plus `second-recap` and `keeper` for everything
    else, `keeper` being a title the template names a GM Notes subsection.
    Any other H2 (`player=None`) is `player` (published; the re-nest
    keeps these in written order), or `gm-listed` when the GM fenced it:
    hidden, kept as an H2 inside the rebuilt fence. An author's `##`
    inside its own separate gm-only pair, beside the GM Notes pair,
    draws the "openers" WARNING and `--fix` merges it into the single
    fence, still an H2 and still hidden. With an explicit `player`
    set (the reading before 1.10.28) only the listed titles are
    `player`; every other H2 is `keeper`. A heading
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
            elif is_player_h2(title, player):
                kind = "gm-listed" if _depth(state) else "player"
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
PLAYER_BLOCK_KINDS = ("preamble", "recap", "second-recap", "moments",
                      "player")


def _gm_pair_plan(states: list[LineState], player: frozenset[str] | None
                  ) -> tuple[set[int], list[int]]:
    """(marker lines to keep verbatim, marker lines that cross a boundary).

    `player` has no default: the findings and the re-nest must read the
    vault's listed sections the same way, or one reports a crossing (or a
    second opener) the other never acts on.

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
    for index, (kind, _title, group) in enumerate(_wrap_blocks(states, player)):
        core = -1
        for j, state in enumerate(group):
            if state.line.strip() and state.marker not in GM_MARKERS:
                core = j
        in_player = kind in PLAYER_BLOCK_KINDS
        for j, state in enumerate(group):
            region[state.lineno] = (index, in_player and j <= core)

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


def renest_wrapup(text: str,
                  player: frozenset[str] | None = None) -> str:
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
    comes back untouched. Any H2 that is not a template GM Notes
    subsection (`player=None`; with a set, only the titles in it) is
    hoisted above the GM block, or, when the GM fenced it, kept as an
    H2 inside the rebuilt fence. With `player=None` the player-facing
    sections keep their written order; with a set they are ordered
    recap, Memorable Moments, then the listed ones in written order.
    """
    states, _problems = scan_body(text, ())
    if not states:
        return text
    preserved, crossing = _gm_pair_plan(states, player)
    if crossing:
        return text
    raw = text.splitlines(keepends=True)
    head = "".join(raw[:states[0].lineno - 1])
    eol = _wrap_eol(text)

    recap: list[list[str]] = []
    extra_recaps: list[list[str]] = []
    moments: list[list[str]] = []
    listed: list[list[str]] = []
    preamble: list[str] = []
    gm_content: list[str] = []
    keeper: list[list[str]] = []
    # `player=None`: the author's own player-facing sections keep the order
    # they were written in, so a file with only its own H2s outside the
    # fence comes back byte-identical.
    in_order: list[list[str]] = []
    for kind, _title, block_states in _wrap_blocks(states, player):
        group = [s for s in block_states
                 if s.marker not in GM_MARKERS or s.lineno in preserved]
        if kind == "preamble":
            preamble = [s.line for s in group]
        elif kind == "recap":
            recap.append([f"## {NARRATIVE_RECAP}"]
                         + [s.line for s in group[1:]])
            in_order.append(recap[-1])
        elif kind == "second-recap":
            extra_recaps.append([s.line for s in group])
            in_order.append(extra_recaps[-1])
        elif kind == "moments":
            moments.append([s.line for s in group])
            in_order.append(moments[-1])
        elif kind == "player":
            listed.append([s.line for s in group])
            in_order.append(listed[-1])
        elif kind == "gm":
            gm_content.extend(_trim([s.line for s in group[1:]]))
        elif kind == "gm-listed":
            keeper.append([s.line for s in group])
        else:
            keeper.append([_demoted(s) for s in group])

    if player is None:
        ordered = (preamble, *in_order)
    else:
        ordered = (preamble, *recap, *extra_recaps, *moments, *listed)
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


def _plain_title(title: str) -> str:
    """A heading title with any whole-title emphasis unwrapped."""
    m = EMPHASIS_RE.match(title)
    # `**A** and **B**` is two emphasised words, not one wrapped title.
    if m and m.group(1) not in m.group(2):
        return m.group(2).strip()
    return title


def _depth(state: LineState) -> int:
    return state.gm_depth + state.spoiler_depth


def _line_key(line: str) -> str:
    """How a line is recognised after a move: a heading by its title
    alone, since the move demotes it; anything else verbatim."""
    stripped = line.strip()
    m = HEADING_RE.match(stripped)
    if m:
        return "#" + m.group(2).strip()
    return stripped


def _keys(lines: list[str]) -> Counter:
    return Counter(_line_key(line) for line in lines
                   if line.strip() and not line.strip().startswith("<!--"))


def hidden_lines(text: str, excludes: list[str], fm: dict) -> Counter:
    """Every non-blank, non-comment body line the site would NOT publish.

    Read through `publisher_lines`, the publish tool's own answer — not
    `scan_body`'s model — because this is the invariant
    every writer here checks before it writes: a line hidden before a
    repair must still be hidden after it. Counted by content, not
    position, because a repair moves lines; headings by title, because
    it demotes them. `fm` is the file's own frontmatter, so the page's
    `publish:` gate applies on both sides.
    """
    return (_keys(body_text(text).split("\n"))
            - _keys(publisher_lines(text, excludes, fm)))


def _marker_hidden(states: list[LineState]) -> Counter:
    """The lines a `<!-- gm-only -->` or `<!-- spoiler -->` block or an
    HTML comment hides, keyed as `hidden_lines` keys them. What an
    excluded section hides is not here: that is the publish tool's to
    say."""
    hidden: list[str] = []
    in_comment = False
    for s in states:
        opened = in_comment
        if not s.in_code:
            _kept, in_comment = strip_comment_spans(s.line, in_comment)
        if not s.published or opened or in_comment:
            hidden.append(s.line)
    return _keys(hidden)


def leak_problem(before: str, before_excludes: list[str], after: str,
                 after_excludes: list[str], fm: dict,
                 ask_tool: bool = True) -> str | None:
    """Why `after` must not be written, or None when it is safe.

    Unsafe means the rewrite added a gm-only/spoiler fence problem, or a
    line hidden in `before` (read under `before_excludes`) publishes in
    `after` (read under `after_excludes`). The two exclude lists differ
    only for a migration that also changes the vault's config.

    What publishes is the publish tool's answer; `PublishToolUnavailable`
    is raised when it cannot be asked. `ask_tool=False` is for a vault
    with no site and no tool: the fences, and the lines a gm-only or
    spoiler block hides, are checked without it.
    """
    _before, was = scan_body(before, ())
    _after, now = scan_body(after, ())
    if len(now) > len(was):
        return f"the rewrite leaves {now[-1]}"
    if ask_tool:
        lost = hidden_lines(before, before_excludes, fm) - hidden_lines(
            after, after_excludes, fm)
    else:
        # What a gm-only or spoiler block hides needs no tool to read.
        lost = _marker_hidden(_before) - _marker_hidden(_after)
    if lost:
        first = next(iter(lost)).lstrip("#")
        return (f"{sum(lost.values())} hidden line(s) would publish "
                f"(first: '{first[:60]}')")
    return None


def renest_gm_leak(text: str, match: set[str], excludes: list[str],
                   kept: set[int] | None = None,
                   h2_match: set[str] | frozenset[str] = frozenset()
                   ) -> tuple[str, list[str], str | None]:
    """(new text, titles moved, refusal) — the 1.8.3 migration's
    structural re-nest, generalised from Session Wrap-Ups to any entity
    file.

    Moves every heading of level 2 or deeper that publishes under
    `excludes` and whose title, with any emphasis unwrapped, is in
    `match` (casefolded). For plain `gm-leak --fix` both are the vault's
    current list, so only the emphasis-wrapped ERROR rows move;
    `--renest-excludes` passes `["GM Notes"]` and the pre-collapse list,
    so every exact title outside `## GM Notes` moves. Keyword-only
    WARNING headings never match, and a level-1 heading never moves.
    `h2_match` (casefolded) moves only at level 2: the sections the
    publish tool withholds by its own rule, which it matches only there
    (#280) — a `### Context` inside the handout text is not one.

    A moved block runs to the next heading at its level or shallower
    *at fence depth 0* — never ending while a gm-only/spoiler fence it
    opened is still open. Blocks go under the first `## GM Notes`, straight after its heading
    and any lead prose — before its first sub-heading, where a nested
    excluded heading could not claim them — and inside its fence when it
    is fenced; a new `## GM Notes` is appended when there is none.
    Nothing moves in a file with unbalanced fences. Content is never
    reworded or reordered inside a block, only relocated and demoted.
    The caller re-checks the result before writing.
    """
    states, problems = scan_body(text, excludes)
    if not states or problems:
        return text, [], None

    def target(s: LineState) -> bool:
        return (s.heading is not None and s.heading[0] >= 2
                and not s.in_code and s.published
                and (kept is None or s.lineno in kept)
                and (_plain_title(s.heading[1]).casefold() in match
                     or (s.heading[0] == 2 and (
                         s.heading[1].casefold() in h2_match
                         or _plain_title(s.heading[1]).casefold()
                         in h2_match))))

    def ends_block(s: LineState, level: int) -> bool:
        return (s.heading is not None and not s.in_code
                and _depth(s) == 0 and s.heading[0] <= level)

    kept_states: list[LineState] = []
    moved_blocks: list[list[LineState]] = []
    moved_titles: list[str] = []
    i, n = 0, len(states)
    while i < n:
        state = states[i]
        if state.heading is not None and target(state):
            level = state.heading[0]
            moved_titles.append(state.heading[1])
            j = i + 1
            while j < n and not ends_block(states[j], level):
                j += 1
            moved_blocks.append(states[i:j])
            i = j
        else:
            kept_states.append(state)
            i += 1
    if not moved_blocks:
        return text, [], None

    moved_lines: list[str] = []
    for block in moved_blocks:
        if moved_lines:
            moved_lines.append("")
        moved_lines.extend(_trim([_demoted(s) for s in block]))

    lines = [s.line for s in kept_states]
    gm = [idx for idx, s in enumerate(kept_states)
          if s.heading is not None and not s.in_code
          and s.heading[0] == 2 and s.heading[1].casefold() == GM_NOTES]
    unfenced = [idx for idx in gm if _depth(kept_states[idx]) == 0]
    if gm:
        g = (unfenced or gm)[0]
        head_state = kept_states[g]
        at = len(kept_states)
        for later in range(g + 1, len(kept_states)):
            s = kept_states[later]
            if s.in_code:
                continue
            if s.heading is not None and _depth(s) == _depth(head_state):
                at = later
                break
            if (s.marker is not None and s.marker.startswith("close-")
                    and (s.gm_depth < head_state.gm_depth
                         or s.spoiler_depth < head_state.spoiler_depth)):
                at = later
                break
        lead = _trim(lines[g + 1:at])
        while lead and not lead[0].strip():
            lead.pop(0)
        new_lines = lines[:g + 1] + [""]
        if lead:
            new_lines += lead + [""]
        new_lines += moved_lines
        rest = lines[at:]
        while rest and not rest[0].strip():
            rest.pop(0)
        if rest:
            new_lines += [""] + rest
    else:
        new_lines = _trim(lines)
        if new_lines:
            new_lines.append("")
        new_lines += ["## GM Notes", ""] + moved_lines
    new_lines = _trim(new_lines)

    raw = text.splitlines(keepends=True)
    head = "".join(raw[:states[0].lineno - 1])
    eol = _wrap_eol(text)
    tail = eol if text.endswith("\n") else ""
    return head + eol.join(new_lines) + tail, moved_titles, None


def _published_title_counts(text: str, excludes: list[str],
                            fm: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in publisher_lines(text, excludes, fm):
        m = HEADING_RE.match(line)
        if m:
            key = atx_title(m.group(2)).lower()
            counts[key] = counts.get(key, 0) + 1
    return counts


def _still_published(old_text: str, new_text: str, excludes: list[str],
                     fm: dict, titles: list[str]) -> str | None:
    """A moved title that the site would still render, or None.

    Counted, not just looked up: a `### Context` inside a handout's text
    publishes by design beside the `## Context` that moved (#280), so each
    moved title must publish exactly as many times fewer as it moved.
    """
    before = _published_title_counts(old_text, excludes, fm)
    after = _published_title_counts(new_text, excludes, fm)
    moved: dict[str, int] = {}
    for t in titles:
        key = atx_title(t).lower()
        moved[key] = moved.get(key, 0) + 1
    for key, n in moved.items():
        if after.get(key, 0) > max(before.get(key, 0) - n, 0):
            return next(atx_title(t) for t in titles
                        if atx_title(t).lower() == key)
    return None


def _h1_target(text: str, match: set[str]) -> str | None:
    """A level-1 heading whose title is in `match`, at fence depth 0."""
    states, _ = scan_body(text, ())
    for s in states:
        if (s.heading is not None and s.heading[0] == 1 and not s.in_code
                and _depth(s) == 0
                and _plain_title(s.heading[1]).casefold() in match):
            return s.heading[1]
    return None


def _plan_gm_leak_fix(vault: Path, rel: str, fm: dict,
                      before_excludes: list[str], after_excludes: list[str],
                      match: set[str], target_excludes: list[str],
                      always_check: bool = False,
                      h2_match: set[str] | frozenset[str] = frozenset()
                      ) -> tuple[list[str], str | None, str | None]:
    """`gm-leak`'s mechanical repair, planned for one file.

    Returns (moved titles, new text or None, refusal or None). Re-reads
    the file directly (exact bytes, its own line endings), the same
    discipline `wrapup --fix` uses. Nothing is written here. A refusal
    means the file must not be touched: the re-nest itself refused,
    `leak_problem` found a hidden line that would publish (or a new
    fence problem), a moved heading would still publish, or the file is
    unreadable. `always_check` (the migration) runs the leak check even
    when nothing moves, since the config collapse alone can expose a
    file.
    """
    path = vault / rel
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        return [], None, f"unreadable ({e.__class__.__name__})"
    states, problems = scan_body(text, target_excludes)
    kept = _published_linenos(states, fm)
    new_text, moved, refusal = renest_gm_leak(text, match, target_excludes,
                                              kept, h2_match)
    if refusal:
        return [], None, refusal
    if not always_check and (not moved or new_text == text):
        return [], None, None
    if moved and GM_NOTES not in {s.casefold() for s in after_excludes}:
        # Moving under a `## GM Notes` the site publishes hides nothing,
        # and the next run would find the same heading and demote it
        # again.
        return [], None, ("GM Notes is not in exclude_sections, so moving "
                          "under it hides nothing — add it to the list "
                          "first")
    problem = leak_problem(text, before_excludes, new_text, after_excludes,
                           fm)
    if problem:
        h1 = _h1_target(text, match)
        if h1 is not None:
            return [], None, (f"the page title '# {h1}' matches an exclude "
                              f"entry and would publish — rename the page "
                              f"title or move the page out of the "
                              f"published folders")
        if problems:
            problem += ("; its gm-only/spoiler fences are unbalanced, fix "
                        "the marker first")
        return [], None, problem
    if moved:
        still = _still_published(text, new_text, after_excludes, fm, moved)
        if still is not None:
            return [], None, f"'{still}' would still publish after the move"
    if not moved or new_text == text:
        return [], None, None
    return moved, new_text, None


def _distinct(values: list[str]) -> list[str]:
    """Without repeats ignoring case (the first spelling stays), and without
    empty entries."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            out.append(value)
    return out


def _write_text(vault: Path, rel: str, text: str) -> None:
    with (vault / rel).open("w", encoding="utf-8", newline="") as f:
        f.write(text)


COLLAPSED_EXCLUDES = ["GM Notes"]


def renest_excludes_migration(vault: Path, fix: bool) -> list[str]:
    """`gm-leak --renest-excludes`: the 1.8.3 migration, all or nothing.

    Moves every level-2+ heading titled with an entry of the vault's
    current `exclude_sections` (hidden today or not) under `## GM Notes`,
    then collapses the list to `["GM Notes"]`. A vault that sets no list
    is re-nested only: the publisher's defaults stay in force, and no
    list is written that would drop them for future content. When the
    vault file sets no list, the list in force is the settings' (the site
    file's old list, else the built-in one).

    Walks every file the publisher might ship, not just the ones the
    `gm-leak` report reads — a played session-plan publishes too — so
    only the publisher's `exclude_dirs`, untyped files and `publish:
    none` pages are skipped. Every file is planned and leak-checked
    against the new config before anything is written; one refusal, or
    an `exclude_sections` the tool cannot read, writes nothing.
    """
    name = "player_site.hide.sections"
    shown_name = setting_name(vault, name)
    own = settings(vault)
    if own.origins[name] == "fault":
        why = next((f["message"] for f in own.faults if f.get("setting") == name),
                   f"{shown_name} not understood")
        return [f"ERROR\t{settings_file(vault)}\t{why} — nothing written; rewrite "
                f"it as a plain list first"]
    listed = written_in_vault_file(own, name)
    # The vault file's own list when it has one; else the build's, which may
    # come from the site file.
    before = _distinct(own.get(name) if listed
                       else vault_settings(vault).get(name))
    collapse = listed and [s.casefold() for s in before] != [GM_NOTES]
    after = list(COLLAPSED_EXCLUDES) if listed else before
    match = {s.casefold() for s in before} | {GM_NOTES}
    dirs = list(vault_settings(vault).get("player_site.hide.folders"))

    rows: list[str] = []
    refused = 0
    writes: list[tuple[str, str, list[str]]] = []
    for rel, text in vault_files(vault, None, skip_dirs=set()):
        if any(rel.startswith(d + "/") for d in dirs):
            continue
        fm = extract_frontmatter(text) or {}
        if not fm.get("type") or publish_mode(fm) == "none":
            continue
        moved, new_text, refusal = _plan_gm_leak_fix(
            vault, rel, fm, before, after, match, list(COLLAPSED_EXCLUDES),
            always_check=True)
        if refusal:
            refused += 1
            rows.append(f"ERROR\t{rel}\tre-nest refused: {refusal} — "
                        f"nothing written")
        elif new_text is not None:
            writes.append((rel, new_text, moved))

    if collapse and own.inline:
        refused += 1
        rows.append(f"ERROR\t{settings_file(vault)}\t{shown_name} cannot be "
                    f"collapsed: publish: is written on one line")
    if refused:
        rows.append(f"ERROR\t{settings_file(vault)}\tmigration blocked by {refused} "
                    f"refusal(s) above — nothing written, {shown_name} "
                    f"left as it is")
        return rows

    mode = "FIXED" if fix else "WOULD-FIX"
    for rel, new_text, moved in writes:
        if fix:
            _write_text(vault, rel, new_text)
        rows.extend(f"{mode}\t{rel}\tre-nested '{title}' under ## GM Notes"
                    for title in moved)
    if collapse:
        old = "[" + ", ".join(f'"{s}"' for s in before) + "]"
        # The notes go first: if this write is refused they stand under the
        # hidden `## GM Notes`, still hidden.
        try:
            if fix:
                settings_set(vault, [(name, list(COLLAPSED_EXCLUDES))])
        except SettingsUnavailable as e:
            if not e.refused:
                raise
            rows.append(f"ERROR\t{settings_file(vault)}\t{shown_name} cannot be "
                        f"collapsed: {e} — the headings are already moved; "
                        f"the list is left as it is")
            return rows
        rows.append(f"{mode}\t{settings_file(vault)}\tcollapsed {shown_name} "
                    f"from {old} to [\"GM Notes\"]")
    return rows


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


def check_wrapup(vault: Path, file: str | None, fix: bool,
                 player: frozenset[str] | None = None,
                 *, renest_only: bool = False,
                 detail: list[WrapDetail] | None = None) -> list[str]:
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

    `player` is how an H2 outside the fence is read: `None` (the default)
    leaves the author's own H2s alone; a frozenset of comparison keys is
    the reading before 1.10.28, which the migration runs once. The
    vault's config is not read here.

    `renest_only` is for the migration: only a wrap-up with a Keeper-facing
    H2 is looked at, only its Keeper-facing-H2 and fence findings are
    reported, and the one repair is the re-nest. No frontmatter backfill,
    no heading rename, no row for any other wrap-up. A wrap-up with no
    recap heading the tool recognises is reported and never moved: under
    the old reading its whole body would count as Keeper content. `detail`
    collects each finding of the wrap-ups looked at, so the caller reads
    level, kind and data rather than the row's words.

    Exit code is not a gate here: wrap-up drift is triage, and an
    ordinary vault of ingested back-history would fail every run.
    """
    entries = [(rel, text, extract_frontmatter(text) or {})
               for rel, text in vault_files(vault)]
    # The build's exclude list (read only when there is a wrap-up to check).
    excludes: list[str] = []
    if any(entity_type(fm) in WRAP_TYPES for _r, _t, fm in entries):
        excludes = vault_settings(vault).get("player_site.hide.sections")
    rows: list[str] = []
    matched = False
    gated = no_tool = False
    for rel, _text, fm in entries:
        if entity_type(fm) not in WRAP_TYPES:
            continue
        if file is not None and rel != file:
            continue
        matched = True
        if not gated:
            gated = True
            why, gate = no_publish_tool(vault, "wrapup")
            rows.extend(gate)
            if why is not None and gate and gate[0].startswith("ERROR"):
                return rows
            if why is not None:
                # No site and no tool: nothing publishes, so the repairs
                # run with nothing counted as hidden by a section. What a
                # gm-only block hides is still checked before each write.
                excludes, no_tool = [], True
        try:
            rows.extend(_check_one_wrapup(vault, rel, fm, entries, excludes,
                                          fix, player, no_tool,
                                          renest_only=renest_only,
                                          detail=detail))
        except PublishToolUnavailable as e:
            rows.append(_tool_gone_row("wrapup", e))
            return rows
    if file is not None and not matched:
        rows.append(f"INFO\t{file}\tno wrap-up with that path — `type:` must "
                    f"be one of {', '.join(sorted(WRAP_TYPES))}")
    return rows


def _check_one_wrapup(vault: Path, rel: str, fm: dict,
                      entries: list[tuple[str, str, dict]],
                      excludes: list[str], fix: bool,
                      player: frozenset[str] | None = None,
                      no_tool: bool = False, *,
                      renest_only: bool = False,
                      detail: list[WrapDetail] | None = None) -> list[str]:
    """One wrap-up: findings, then the plan, then a single write.
    `no_tool`: a vault with no site and no publish tool to ask. The
    check before the write then covers what needs no tool: the fences,
    and the lines a gm-only or spoiler block hides."""
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
    structure = wrapup_structure_findings(rel, text, excludes, player)
    if publish_mode(fm) == "none":
        structure = [Finding("WARNING" if f.level == "ERROR" else f.level,
                             f.where, f.message, f.kind, f.data)
                     for f in structure]
    structure.sort(key=lambda f: _line_of(f.where))
    if renest_only:
        if not any(f.kind == "keeper-h2" for f in structure):
            return []
        fm_findings = []
        structure = [f for f in structure if f.kind in (
            "keeper-h2", "fence-crosses", "fence-unbalanced", "renest",
            "recap", "no-recap")]
        findings = structure
        if detail is not None:
            shown = publish_mode(fm) != "none" and not no_tool
            detail.extend(WrapDetail(rel, f, shown) for f in findings)
    else:
        findings = fm_findings + structure + wrapup_filename_findings(rel)
    rows = [f.row for f in findings]
    if renest_only and any(f.kind == "no-recap" for f in findings):
        return rows

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
            renested = renest_wrapup(new_text, player)
            # Structure-only defects — an unfenced `## GM Notes`, a
            # second opener — carry no per-finding action, so what the
            # re-nest did is read back off the two texts rather than
            # predicted from the findings that triggered it.
            if renested != new_text:
                actions.extend(_renest_actions(new_text, renested, player))
                new_text = renested
        if any(f.kind == "decorated" for f in structure):
            new_text, renamed = rename_decorated_headings(new_text)
            actions.extend(renamed)

    if new_text == text:
        # Byte-identical: whatever the plan said, nothing moved.
        rows.append(f"UNCHANGED\t{rel}\tnothing to fix")
        return rows
    problem = leak_problem(text, excludes, new_text, excludes, fm,
                           ask_tool=not no_tool)
    if problem:
        rows.append(f"ERROR\t{rel}\trepair refused: {problem} — nothing "
                    f"written; fix it by hand")
        return rows
    if fix:
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write(new_text)
    mode = "FIXED" if fix else "WOULD-FIX"
    rows.extend(f"{mode}\t{rel}\t{action}" for action in actions)
    return rows


def _renest_actions(before: str, after: str,
                    player: frozenset[str] | None = None) -> list[str]:
    """What the re-nest did, as fix rows — read off the two texts.

    Derived, never predicted. The rows worded from the *findings* claimed
    a fence and a `## GM Notes` for a file that came out with neither,
    and in a dry run that row is the only thing the GM sees before
    approving the write. A fix row must describe the bytes the repair
    produced, or it is worse than no row at all.
    """
    before_blocks = _wrap_blocks(scan_body(before, ())[0], player)
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


def _vault_relative_key(vault_root_abs: str, raw: str) -> str | None:
    """The vault-relative posix path a `--file` value names, or `None`
    when it normalises outside the vault (an absolute path elsewhere,
    or enough `..` to escape) — string arithmetic only, deliberately.

    A relative value is joined onto `vault_root_abs` and lexically
    normalised (`os.path.normpath`: collapses `..`, `.` and doubled
    slashes) without ever touching the filesystem — so a note that is
    itself a symlink keeps the path it was written at as its key,
    rather than being rewritten to wherever the symlink points.

    An absolute value is fully resolved (`Path.resolve()`) before the
    comparison, because `vault_root_abs` is resolved too: without that,
    an absolute path reached through a symlinked ancestor (macOS's
    `/tmp` -> `/private/tmp` is the everyday case) would never compare
    equal to one built from the vault's own resolved form. This is the
    one place a symlink is followed, and only for the value the caller
    handed in as absolute.

    The result is not checked for existence or case here — the caller
    matches it against an exact listing of real vault files, which is
    what turns a wrong-case or NFC/NFD-mismatched name into an error
    instead of a silent non-match.
    """
    value = normalize_file_arg(raw)
    if os.path.isabs(value):
        candidate = str(Path(value).resolve())
    else:
        candidate = os.path.normpath(os.path.join(vault_root_abs, value))
    if candidate != vault_root_abs and not candidate.startswith(
            vault_root_abs + os.sep):
        return None
    rel = os.path.relpath(candidate, vault_root_abs)
    return rel if os.sep == "/" else rel.replace(os.sep, "/")


def _resolve_vault_paths(vault: Path, raw_paths: list[str]
                         ) -> tuple[list[str], list[str]]:
    """(valid vault-relative keys, the raw values that didn't resolve).

    Shared by `--file` and `--newer-than` in `main()`: both name a real
    vault file and both get the same validation — see
    `_vault_relative_key` for what "resolve" means here.
    """
    vault_root = vault.resolve()
    vault_root_abs = str(vault_root)
    # One rglob, no reads: the exact set of real vault-relative `.md`
    # paths, on-disk casing and all. A value's derived key must be an
    # exact member of this set — a wrong-case or NFC/NFD-mismatched name
    # is a real string mismatch here, not a filesystem lookup that a
    # case-insensitive volume would paper over, so it errors instead of
    # silently matching nothing (or, for `--newer-than`, silently using
    # the wrong file's mtime).
    real_files = {p.relative_to(vault).as_posix()
                 for p in vault.rglob("*.md") if p.is_file()}
    valid: list[str] = []
    invalid: list[str] = []
    for raw in raw_paths:
        rel = _vault_relative_key(vault_root_abs, raw)
        if rel is None or is_skipped_path(rel) or rel not in real_files:
            invalid.append(raw)
            continue
        # A symlinked note whose target sits outside the vault is outside
        # the vault, whatever its own path says.
        if not (vault / rel).resolve().is_relative_to(vault_root):
            invalid.append(raw)
            continue
        valid.append(rel)
    return valid, invalid


# ---- The Settings check ---------------------------------------------------------------

# How a fix is classed. "certain": cannot make the site show more or switch
# anything on, so `--fix` applies it. "proposed": the GM must say yes by
# name (`--apply`). "none": the GM decides what to do.
SETTINGS_UNREAD = "could not read the vault's settings: "
SETTINGS_KINDS = ("certain", "proposed", "none")
SITE_FILE_NOTE = ("This one is in the site folder's vault.config.json, not "
                  "in the vault's settings file. Run the vault update "
                  "(campaign-organizer's migration) to move it; this check "
                  "does not change that file.")


@dataclass
class SettingsRow:
    """One fault in the settings, with its fix (`ops` non-empty) or the
    reason there is none (`note`)."""

    fault: dict[str, Any]
    kind: str = "none"
    ops: list[dict[str, Any]] = field(default_factory=list)
    fix: str | None = None
    done: str | None = None
    note: str | None = None
    comments: list[str] = field(default_factory=list)
    site: bool = False
    where: str | None = None    # the file a site row names, when not vault.config.json

    @property
    def certain(self) -> bool:
        return self.kind == "certain"


def _short(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= 60 else text[:59] + "…"


def _written_at(raw: Any, name: str) -> tuple[bool, Any]:
    """(whether the dotted `name` is written in the settings file, its
    value). `raw` is the file as written: the whole new file, or the old
    file's frontmatter."""
    cur = raw
    for seg in name.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return False, None
        cur = cur[seg]
    return True, cur


def _run_ops(vault: Path, ops: list[dict[str, Any]]) -> None:
    for op in ops:
        if op["op"] == "set":
            settings_set(vault, [(op["name"], op["value"])])
        elif op["op"] == "add":
            settings_add(vault, op["name"], op["entries"])
        elif op["op"] == "carry":
            settings_carry(vault, op["from"], op["to"])
        elif op["op"] == "fold-site":
            settings_fold_site_file(vault, op.get("keys"))
        elif op["op"] == "tidy":
            settings_tidy(vault, discard_old_file=bool(op.get("discard")))
        else:
            settings_unset(vault, list(op["names"]))


def _noun(takes: str) -> str:
    return takes.split("a list of ")[-1] if "a list of " in takes else "entries"


def _gist(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 300 else text[:299] + "…"


def _comment_clauses(text: str, name: str) -> list[str]:
    """What removing the key `name` does to comments near it: a comment on
    its own line goes with the line; a comment line above it stays."""
    last = re.escape(name.split(".")[-1])
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(rf"^(\s+){last}\s*:(.*)$", line)
        if not m:
            continue
        out = []
        if re.search(r"\s#", m.group(2)):
            out.append("its comment on the same line is removed with it")
        if i > 0 and lines[i - 1].lstrip().startswith("#"):
            out.append("the comment line above it stays")
        return out
    return []


def _effect(info: dict[str, Any], target: str, value: Any) -> str:
    """What moving `value` to `target` does, from the setting's own
    description: the value and the setting's first sentence of purpose."""
    if isinstance(value, bool) and info.get("kind") in (
            "switch", "switchOrList"):
        what = f"this turns {target} {'on' if value else 'off'}"
    else:
        what = f"this sets {target} to {_short(value)}"
    does = info.get("does")
    return f"{what}. {_gist(str(does))}" if does else f"{what}."


def _classify_move(fault_kind: str, name: str, value: Any, target: str,
                   info: dict[str, Any]) -> SettingsRow:
    """The row for moving `name`'s value to `target` (not yet tried). An
    old name is certain (the tool already reads its value, so nothing
    changes; checked on a copy). A misspelt name is certain only when the
    move hides the same or more: a hiding list is added to the built-in
    list, never put in its place."""
    row = SettingsRow({})
    unset = {"op": "unset", "names": [name]}
    takes = str(info.get("takes", ""))
    move = f"move this to {target}"
    if fault_kind == "old-name":
        row.kind = "certain"
        row.ops = [{"op": "set", "name": target, "value": value}, unset]
        row.fix, row.done = move, f"moved {name} to {target}"
    elif info.get("guards") and info.get("kind") in ("list", "switchOrList") \
            and isinstance(value, list) and value \
            and all(isinstance(x, str) and x.strip() for x in value):
        default = info.get("default")
        keep = (f", keeping the built-in {_noun(takes)}"
                if isinstance(default, list) and default else "")
        row.kind = "certain"
        row.ops = [{"op": "add", "name": target, "entries": value}, unset]
        row.fix = f"{move}{keep}"
        row.done = f"moved {name} to {target}{keep}"
    elif info.get("guards") and not isinstance(value, list) \
            and (value is True or value == info.get("default")):
        row.kind = "certain"
        row.ops = [{"op": "set", "name": target, "value": value}, unset]
        row.fix, row.done = move, f"moved {name} to {target}"
    else:
        row.kind = "proposed"
        row.ops = [{"op": "set", "name": target, "value": value}, unset]
        row.fix = f"{move}; {_effect(info, target, value)}"
        row.done = f"moved {name} to {target}"
    return row


SITE_FILE_PLACE = "in the site folder's vault.config.json"


def _site_move_plan(vault: Path) -> dict[str, Any]:
    """What the tool's move would do with the site folder's files, or {}
    when it cannot say (a blocked move exits 1; its words are the fault's)."""
    try:
        return settings_move_plan(vault)
    except SettingsUnavailable:
        return {}


def _site_held(plan: dict[str, Any]) -> str | None:
    """The tool's sentence when the site's own tool is too old to read the
    site-folder keys from the vault, else None."""
    held = plan.get("keysHeld")
    if isinstance(held, dict) and held.get("line"):
        return str(held["line"])
    return None


def _site_held_row(fault: dict[str, Any], line: str) -> SettingsRow:
    """One informational row for every site-folder key a too-old site tool
    leaves in the site file: nothing for the GM to do in the vault, so it is
    a note, not a warning, and the report does not count it."""
    return SettingsRow({**fault, "level": "info", "kind": "held",
                        "message": line}, site=True)


def _site_left_row(fault: dict[str, Any]) -> SettingsRow:
    """A site-folder key the vault sets none of: the site file's value is
    read until the tool's move carries it into the vault. Certain: the move
    changes nothing the site shows."""
    row = SettingsRow(fault, site=True)
    target = str(fault.get("use") or fault.get("setting") or "")
    key = fault["name"]
    row.kind = "certain"
    row.ops = [{"op": "fold-site", "keys": [key]}]
    row.fix = (f"move it to {target} in the vault's settings and take it out "
               "of vault.config.json (until it moves, the value is read from "
               "vault.config.json, so the site builds the same either way)")
    row.done = f"moved {key} to {target}"
    return row


def _site_unusable_row(fault: dict[str, Any]) -> SettingsRow:
    """A site-folder key whose value the tool cannot use (the fault says what
    it takes). The move would stop on it; the GM corrects it in the site
    file."""
    row = SettingsRow(fault, site=True)
    row.note = ("Nothing is changed automatically: fix it in the site "
                "folder's vault.config.json, then run this check again.")
    return row


def _site_differs_row(fault: dict[str, Any], own: Any,
                      site_value: Any) -> SettingsRow:
    """A site-folder key the vault sets too, to something else: the vault's
    value is the one in use. Dropping the site file's value is certain for an
    address, host or project name. For the kept folders and the output folder
    it is proposed, because a folder only the site file names is cleaned by
    the next build."""
    row = SettingsRow(fault, site=True)
    target = str(fault.get("use") or fault.get("setting") or "")
    key = fault["name"]
    try:
        mine = own.get(target)
    except KeyError:
        mine = None
    row.ops = [{"op": "fold-site", "keys": [key]}]
    row.done = f"took {key} out of vault.config.json"
    checks = fault.get("checks")
    if checks == "keep" and isinstance(site_value, list) \
            and isinstance(mine, list):
        kept = {str(x).strip().strip("/") for x in mine}
        lost = [str(x) for x in site_value
                if str(x).strip().strip("/") not in kept]
        if lost:
            names = ", ".join(lost)
            row.kind = "proposed"
            row.fix = (f"the site file keeps {names} but the vault's "
                       f"{target} ({_short(mine)}) does not, so {names} "
                       "would be cleaned at the next build. To keep "
                       f"{'it' if len(lost) == 1 else 'them'}, add "
                       f"{'it' if len(lost) == 1 else 'them'} to {target}; "
                       "to let "
                       f"{'it' if len(lost) == 1 else 'them'} go, apply this "
                       "fix, which drops the site file's list")
            return row
        row.kind = "certain"
        row.fix = (f"everything the site file keeps ({_short(site_value)}) is "
                   f"already in the vault's {target}; take the list out of "
                   "vault.config.json")
        return row
    if checks == "output":
        row.kind = "proposed"
        row.fix = (f"the site file says {_short(site_value)} and the vault's "
                   f"{target} says {_short(mine)}: the site builds into "
                   f"{_short(mine)} now and still will once the site file's "
                   f"is dropped, and {_short(site_value)} is not used. To "
                   f"build into {_short(site_value)} instead, set {target} to "
                   "it first; otherwise apply this fix, which drops the site "
                   "file's value")
        return row
    row.kind = "certain"
    row.fix = (f"the vault's {target} ({_short(mine)}) is the value in use; "
               f"drop the site file's {_short(site_value)} from "
               "vault.config.json")
    return row


def _package_step_rows(plan: dict[str, Any]) -> list[SettingsRow]:
    """The build steps the site folder's package.json still holds on a moved
    vault: certain rows, fixed by the tool's move. The tool names what it
    would carry (`carried`, from `package.json <script>`); steps that the
    vault's settings already hold are removed from package.json."""
    rows: list[SettingsRow] = []
    carried = [c for c in plan.get("carried") or []
               if isinstance(c, dict)
               and str(c.get("from", "")).startswith("package.json ")]
    for c in carried:
        script = str(c["from"]).split(" ", 1)[1]
        target = str(c.get("to"))
        fault = {"name": f"package.json {script}", "level": "warn",
                 "kind": "dropped", "setting": target, "use": target,
                 "message": f"the site's {script} step is still in "
                            "package.json; its tool runs it from there until "
                            f"the update moves it to {target}"}
        row = SettingsRow(fault, site=True, where="package.json")
        row.kind = "certain"
        row.ops = [{"op": "fold-site", "keys": [fault["name"]]}]
        row.fix = (f"move it to {target} in the vault's settings and take it "
                   "out of package.json (the tool then runs it from the "
                   "settings)")
        row.done = f"moved the {script} step to {target}"
        rows.append(row)
    for d in plan.get("stepsDiffer") or []:
        if not isinstance(d, dict):
            continue
        differing: dict[str, Any] = {"name": f"package.json {d.get('script')}", "level": "warn",
                 "kind": "dropped", "setting": d.get("setting"),
                 "message": str(d.get("line"))}
        row = SettingsRow(differing, site=True, where="package.json")
        row.note = ("Nothing is changed automatically. `npm run build` runs "
                    "the package.json script as well as the vault's steps, so "
                    "the step can run twice; the tool's own build and deploy "
                    "run only the vault's. Either make them the same (set "
                    f"{d.get('setting')} to match), or take the script out of "
                    "package.json.")
        rows.append(row)
    written = [Path(str(p)).name for p in (plan.get("files") or {}).get("write") or []]
    if not carried and "package.json" in written:
        fault = {"name": "package.json", "level": "warn", "kind": "dropped",
                 "message": "package.json holds build steps that the vault's "
                            "settings already hold, so they run twice under "
                            "npm run build"}
        row = SettingsRow(fault, site=True, where="package.json")
        row.kind = "certain"
        row.ops = [{"op": "fold-site", "keys": ["package.json"]}]
        row.fix = "take them out of package.json (the tool runs the vault's)"
        row.done = "took the build steps out of package.json"
        rows.append(row)
    return rows


def _site_key_row(fault: dict[str, Any], own: Any,
                  site_value: Any = None) -> SettingsRow:
    """A setting the site folder's vault.config.json still holds, on a vault
    already on the new file. That file is not read now, so the vault's own
    value is the one in use; the fix takes the key out of the site file, in
    one change with the vault's file (the tool does it). Certain: it hides
    the same or more."""
    row = SettingsRow(fault, site=True)
    target = str(fault.get("use") or fault.get("setting") or "")
    try:
        info = settings_describe(target)
    except SettingsUnavailable:
        info = {}
    key = fault["name"]
    carries = (info.get("kind") == "switchOrList" and site_value is True) or (
        isinstance(site_value, list)
        and any(isinstance(x, str) and x.strip() for x in site_value))
    nothing = (info.get("guards") and info.get("kind") in ("list", "switchOrList")
               and not carries)
    if nothing:
        # Not a list of entries: the old layout ignored it too, so nothing it
        # hid is shown, and nothing is carried over.
        what = ("remove it from vault.config.json; it holds no list of "
                f"entries, so nothing is added to {target}")
    elif info.get("guards") and info.get("kind") == "list":
        what = (f"add its entries to {target} (the built-in entries stay) "
                "and remove it from vault.config.json")
    elif info.get("guards"):
        what = (f"keep the stricter of the two rules in {target} and remove "
                "it from vault.config.json")
    else:
        shown = ""
        try:
            shown = f" ({_short(own.get(target))})"
        except KeyError:
            pass
        what = (f"remove it from vault.config.json; the vault's {target}"
                f"{shown} is already the value in use, because that file "
                "is not read now")
    row.kind = "certain"
    row.ops = [{"op": "fold-site", "keys": [key]}]
    row.fix = what
    row.done = (f"took {key} out of vault.config.json; it held no list of "
                "entries, so nothing was carried" if nothing
                else f"took {key} out of vault.config.json")
    return row


def _leftover_row(fault: dict[str, Any], vault: Path) -> SettingsRow:
    """The old settings file left beside the new one: the publish tool says
    whether it holds anything the new file lacks. Nothing more: removed when
    it holds nothing (certain), else removed only on the GM's yes."""
    row = SettingsRow(fault)
    try:
        left = settings_move_plan(vault).get("leftover")
    except SettingsUnavailable:
        return row
    if not isinstance(left, dict):
        return row
    if left.get("redundant"):
        row.kind = "certain"
        row.ops = [{"op": "tidy", "discard": False}]
        row.fix = (f"remove {LEGACY_SETTINGS_FILE}; it holds nothing the new "
                   "file lacks")
        row.done = f"removed {LEGACY_SETTINGS_FILE}"
    else:
        keys = ", ".join(str(k) for k in left.get("keys") or []) or "settings"
        row.kind = "proposed"
        row.ops = [{"op": "tidy", "discard": True}]
        row.fix = (f"remove {LEGACY_SETTINGS_FILE} anyway; it holds {keys}, "
                   "which the new file does not")
        row.done = f"removed {LEGACY_SETTINGS_FILE}"
    return row


def _both_set(row: SettingsRow, name: str, value: Any, target: str,
              there: bool, held: Any, info: dict[str, Any]) -> None:
    """A stray key whose right setting is already set, in the new file. A
    list's entries are added to the right list and the stray removed (the
    carry does that: it only hides more, so the classification stands). The
    same value on both is a plain removal (certain). Anything else is a
    question for the GM, and the row says which value wins."""
    if not there:
        row.kind, row.ops, row.fix, row.done = "none", [], None, None
        row.note = (f"{target} is being set by another fix and {name} holds "
                    f"{_short(value)}; run the check again after it.")
        return
    is_list = info.get("kind") in ("list", "switchOrList")
    if is_list and isinstance(value, list) and isinstance(held, list):
        row.fix = (f"add the entries of {name} to {target}, which is already "
                   f"set, and remove {name}")
        return
    if value == held:
        row.kind = "certain"
        row.fix = f"remove {name}; {target} already says the same"
        return
    row.kind = "proposed"
    row.fix = (f"{target} is already {_short(held)}; moving {name} here makes "
               f"it {_short(value)} (this value wins) and removes {name}")


def _plan_fix(fault: dict[str, Any], raw: Any, claimed: set[str],
              scratch: Path, text: str) -> SettingsRow:
    row = SettingsRow(fault)
    name, kind = str(fault["name"]), fault["kind"]
    if kind == "misplaced":
        # Beside `publish:`, not under it: the settings command only edits
        # inside the publish block, so it cannot move the key.
        row.note = ("the settings command cannot move a key from beside "
                    "publish:; move it under publish: by hand.")
        return row
    present, value = _written_at(raw, name)
    # On the old file only a key under `publish:` is fixed here; the new
    # file's keys all are settings or mistakes.
    old_file = vault_layout(scratch) == "legacy"
    if (old_file and not name.startswith("publish.")) or not present:
        return row
    if kind == "retired":
        row.kind = "certain"
        row.ops = [{"op": "unset", "names": [name]}]
        row.fix = f"remove {name} from the settings file"
        row.done = f"removed {name}"
    elif kind in ("unknown-name", "old-name"):
        target = fault.get("suggest") if kind == "unknown-name" \
            else fault.get("use")
        if not target:
            return row
        there, held = _written_at(raw, target)
        if (there or target in claimed) and old_file:
            shown = _short(held) if there else "a value from another fix"
            row.note = (f"{target} is already set ({shown}) and {name} holds "
                        f"{_short(value)}; keep one, then remove the other.")
            return row
        try:
            info = settings_describe(target)
        except SettingsUnavailable:
            return row  # not a setting the tool can describe
        # A stray key in the new file is not read at all, so what it holds is
        # judged as any mistyped name's would be, whatever it was called.
        moved = _classify_move("unknown-name" if not old_file else kind,
                               name, value, target, info)
        moved.fault = fault
        if not old_file:
            # One all-or-nothing change: the value (a list's entries added to
            # the list), then the stray key removed.
            moved.ops = [{"op": "carry", "from": name, "to": target}]
        if not old_file and (there or target in claimed):
            _both_set(moved, name, value, target, there, held, info)
        row = moved
    else:
        return row
    row.comments = _comment_clauses(text, name)
    if row.comments and row.fix:
        row.fix += f" ({'; '.join(row.comments)})"
    # Try it on a copy of the file first: a value the setting will not take
    # is no fix at all. Only certain fixes stay on the copy, so a later
    # certain fix is tried the way `--fix` will meet it.
    target_file = scratch / settings_file(scratch)
    kept = target_file.read_bytes()
    before = settings(scratch).values if kind == "old-name" and old_file \
        else None
    ok = False
    try:
        _run_ops(scratch, row.ops)
        ok = True
    except SettingsUnavailable as e:
        if not e.refused:
            raise
        takes = ""
        if kind != "retired":
            try:
                takes = settings_describe(
                    row.ops[0].get("name") or row.ops[0]["to"]).get("takes", "")
            except SettingsUnavailable:
                takes = ""
        row.note = (f"{name} holds {_short(value)}"
                    + (f", and {target} takes {takes}." if takes
                       else f" ({e})."))
    if ok and before is not None and settings(scratch).values != before:
        # The old name's value was read differently from the new name's.
        row.kind = "proposed"
    if not ok or row.kind != "certain":
        target_file.write_bytes(kept)
        forget_settings(scratch)
    if not ok:
        row.kind, row.ops, row.fix, row.done, row.comments = (
            "none", [], None, None, [])
        return row
    if row.kind == "certain":
        for op in row.ops:
            if op["op"] == "set":
                claimed.add(op["name"])
    return row


def plan_settings(vault: Path) -> tuple[list[SettingsRow], bool]:
    """(every fault in the settings as a row, whether the `publish:` block
    is written in a way the tool cannot edit). Writes nothing."""
    try:
        own = settings(vault)
    except SettingsUnavailable as e:
        if "is not valid YAML" not in str(e):
            raise
        reason = str(e).removeprefix(SETTINGS_UNREAD)
        return ([SettingsRow({"name": "publish", "level": "stop",
                              "kind": "invalid-yaml",
                              "message": reason})], False)
    rows: list[SettingsRow] = []
    file_name = settings_file(vault)
    if own.inline:
        rows = [SettingsRow(f) for f in own.faults]
        rows.append(SettingsRow({
            "name": "publish", "level": "warn", "kind": "inline",
            "message": f"publish: in {file_name} is written on one line, "
                       "which the settings command cannot edit; write it "
                       "with one setting to a line."}))
    else:
        raw = settings_raw(vault)
        source = vault / file_name
        text = source.read_text(encoding="utf-8") if source.is_file() else ""
        with tempfile.TemporaryDirectory(prefix="vc-settings-") as tmp:
            scratch = Path(tmp)
            (scratch / "_meta").mkdir()
            # Whichever file the vault is on, under its own name, so the tool
            # reads the copy the way it reads the real one.
            empty = ("---\ntype: meta\n---\n"
                     if vault_layout(vault) == "legacy" else "version: 1\n")
            (scratch / file_name).write_text(text or empty, encoding="utf-8")
            claimed: set[str] = set()
            try:
                for f in own.faults:
                    if f["kind"] == "dropped" and f["name"] == LEGACY_SETTINGS_FILE:
                        rows.append(_leftover_row(f, vault))
                        continue
                    rows.append(_plan_fix(f, raw, claimed, scratch, text))
            finally:
                forget_settings(scratch)
    # Faults the site folder's own vault.config.json adds.
    site, has_config = _site_of(own, vault)
    if has_config and site is not None:
        merged = settings(vault, site_config=site / "vault.config.json")
        seen = {(f["name"], f["kind"], f["message"]) for f in own.faults}
        try:
            site_json = json.loads(
                (site / "vault.config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            site_json = {}
        moved = vault_layout(vault) == "new"
        move_plan = _site_move_plan(vault) if moved else {}
        left_names = {f["name"] for f in merged.faults if f.get("siteLeft")}
        # A value the tool cannot use blocks the move; the tool names the key
        # first in its blocker, whatever the vault holds.
        blocked: dict[str, str] = {}
        for b in move_plan.get("blockers") or []:
            key = str(b).split(" ", 1)[0]
            if any(g["name"] == key for g in merged.faults):
                blocked.setdefault(key, str(b))
        held_line = _site_held(move_plan)
        said: set[str] = set()
        for f in merged.faults:
            if (f["name"], f["kind"], f["message"]) in seen:
                continue
            message = f["message"]
            if SITE_FILE_PLACE not in message:
                message += f" ({SITE_FILE_PLACE})"
            if moved:
                fault = {**f, "message": message}
                if f["name"] in blocked:
                    if f["name"] not in said:
                        said.add(f["name"])
                        rows.append(_site_unusable_row(
                            {"name": f["name"], "level": "stop",
                             "kind": "not-allowed",
                             "setting": f.get("setting"),
                             "message": blocked[f["name"]]}))
                    continue
                if held_line and (f.get("siteLeft") or f.get("siteDiffers")):
                    if "held" not in said:
                        said.add("held")
                        rows.append(_site_held_row(fault, held_line))
                    continue
                if f.get("siteLeft") and any(
                        g["name"] == f["name"] and g["level"] == "stop"
                        for g in merged.faults):
                    continue    # the unusable value's own row says it
                if f.get("siteLeft"):
                    rows.append(_site_left_row(fault))
                elif f["level"] == "stop" and f["name"] in left_names:
                    rows.append(_site_unusable_row(fault))
                elif f.get("siteDiffers"):
                    rows.append(_site_differs_row(
                        fault, own,
                        site_json.get(f["name"])
                        if isinstance(site_json, dict) else None))
                else:
                    rows.append(_site_key_row(
                        fault, own,
                        site_json.get(f["name"])
                        if isinstance(site_json, dict) else None))
                continue
            if f.get("siteLeft"):
                continue    # the update moves it; the legacy file reads it
            rows.append(SettingsRow(
                {**f, "message": message}, note=SITE_FILE_NOTE, site=True))
        if moved:
            rows.extend(_package_step_rows(move_plan))
    rows.sort(key=lambda r: (SETTINGS_KINDS.index(r.kind),
                             r.fault["level"] != "stop"))
    return rows, own.inline


def _row_json(r: SettingsRow) -> dict[str, Any]:
    f = r.fault
    out: dict[str, Any] = {"level": f["level"], "kind": r.kind,
                           "fault": f["kind"], "name": f["name"],
                           "message": f["message"],
                           "certain": r.certain, "fix": r.fix,
                           "operations": r.ops}
    if r.comments:
        out["comments"] = r.comments
    if r.site:
        out["file"] = "site"
    if r.note:
        out["note"] = r.note
    return out


def _row_lines(r: SettingsRow, file_name: str) -> list[str]:
    word = {"stop": "STOP", "info": "NOTE"}.get(r.fault["level"], "WARN")
    where = r.where or ("vault.config.json" if r.site else file_name)
    lines = [f"{word}\t{where}\t{r.fault['message']}"]
    if r.fix:
        lines.append(f"{'proposed' if r.kind == 'proposed' else 'fix'}: "
                     f"{r.fix}")
    if r.note:
        lines.append(f"note: {r.note}")
    return lines


def _apply_row(vault: Path, r: SettingsRow, applied: list[SettingsRow]) -> None:
    """Run one row's operations in order: the right name first, then the
    removal, so a failure half-way leaves the vault hiding as much as
    before."""
    written = 0
    try:
        for op in r.ops:
            _run_ops(vault, [op])
            written += 1
    except SettingsUnavailable as e:
        for a in applied:
            print(f"fixed: {a.done}")
        if written:
            raise SettingsUnavailable(
                f"{r.fault['name']}: the new value was written but the old "
                f"key could not be removed ({e}); nothing more was changed. "
                "Remove it with settings unset.") from e
        raise SettingsUnavailable(
            f"{r.fault['name']}: not fixed ({e}); nothing more was "
            "changed.") from e
    applied.append(r)


def check_settings(vault: Path, fix: bool, apply_names: list[str],
                   as_json: bool) -> int:
    """`vault_check.py <vault> settings`: the faults in the settings, and
    with `fix` the certain fixes done, with `apply_names` the named fixes
    (certain or proposed) done."""
    rows, inline = plan_settings(vault)
    applied: list[SettingsRow] = []
    skipped = ""
    if (fix or apply_names) and inline:
        skipped = (f"Nothing was written: publish: in {settings_file(vault)} is "
                   "written on one line, which the settings command cannot "
                   "edit. Write it with one setting to a line first.")
    elif fix or apply_names:
        bad = [n for n in apply_names
               if not any(r.fault["name"] == n and r.ops for r in rows)]
        if bad:
            print(f"error: no fix to apply for {', '.join(bad)}; nothing "
                  "was written", file=sys.stderr)
            return 2
        if fix:
            for r in [r for r in rows if r.certain]:
                _apply_row(vault, r, applied)
        for n in apply_names:
            if any(a.fault["name"] == n for a in applied):
                continue
            fresh = plan_settings(vault)[0] if applied else rows
            found = next((x for x in fresh
                          if x.fault["name"] == n and x.ops), None)
            if found is None:
                raise SettingsUnavailable(
                    f"{n}: it can no longer be fixed that way after the "
                    "earlier fixes; nothing more was changed.")
            _apply_row(vault, found, applied)
        if applied:
            rows, inline = plan_settings(vault)
    waiting = sum(1 for r in rows if r.kind == "proposed")
    if as_json:
        print(json.dumps({"applied": [
            {"name": a.fault["name"], "done": a.done, "operations": a.ops}
            for a in applied], "waiting": waiting,
            "faults": [_row_json(r) for r in rows],
            **({"skipped": skipped} if skipped else {})},
            indent=2, ensure_ascii=False))
        return 0
    for a in applied:
        print(f"fixed: {a.done}")
    if fix and waiting:
        print(f"{waiting} proposed fix{'es are' if waiting != 1 else ' is'} "
              "waiting for the GM's yes; apply one by name with --apply.")
    if skipped:
        print(skipped)
    if not rows:
        print("Settings: no faults")
    for r in rows:
        for line in _row_lines(r, settings_file(vault)):
            print(line)
    return 0


def settings_fault_rows(vault: Path) -> list[str]:
    """One row for a report (`all`, `wrapup`) when the settings have a
    fault, pointing at the Settings check; none when they read cleanly."""
    faults = vault_settings(vault).faults
    pending = [f for f in faults if f.get("siteLeft") or f.get("siteDiffers")]
    if pending and vault_layout(vault) == "new" \
            and _site_held(_site_move_plan(vault)):
        # The site's own tool is too old to take them: nothing to do in the
        # vault, so the report does not count them.
        faults = [f for f in faults if f not in pending]
    if not faults:
        return []
    stops = sum(1 for f in faults if f["level"] == "stop")
    warns = len(faults) - stops
    counts = ", ".join(c for c in (f"{stops} stop" if stops else "",
                                   f"{warns} warn" if warns else "") if c)
    return [f"{'ERROR' if stops else 'WARNING'}\t{settings_file(vault)}\t"
            f"{len(faults)} settings fault{'s' if len(faults) != 1 else ''} "
            f"({counts}) — run vault_check.py \"{vault}\" settings"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", choices=["frontmatter", "names", "index",
                                        "stale-drafts", "changed", "tables",
                                        "timeline", "read-aloud",
                                        "relationships", "sessions",
                                        "gm-leak", "pc-body", "wrapup",
                                        "site-faults", "settings",
                                        "version", "active-pcs", "all"])
    ap.add_argument("--folder",
                    help="restrict the frontmatter, tables, relationships, "
                         "gm-leak and pc-body checks to a subfolder")
    ap.add_argument("--file", action="append",
                    help="restrict the check to one vault-relative file "
                         "(e.g. \"Chapters/C3/Sessions/Session 07/"
                         "Chapter_03_Session_07_Wrap_Up.md\") — repeatable "
                         "for tables, relationships, pc-body and "
                         "site-faults; wrapup takes only the first if given "
                         "more than one")
    ap.add_argument("--newer-than",
                    help="restrict tables/relationships/pc-body to files "
                         "with an mtime at or after this vault-relative "
                         "file's own mtime — a backstop scope, or a "
                         "completeness cross-check against an explicit "
                         "--file list")
    ap.add_argument("--json", action="store_true",
                    help="settings only: print the rows as JSON")
    ap.add_argument("--apply", nargs="+", default=[], metavar="NAME",
                    help="settings only: apply the fix for each named fault "
                         "(a proposed fix needs the GM's yes by name)")
    ap.add_argument("--fix", action="store_true",
                    help="apply the settings check's certain fixes, or the "
                         "wrapup or gm-leak check's mechanical "
                         "repairs (frontmatter backfills and the "
                         "Keeper-facing re-nest for wrapup; the "
                         "bold-wrapped ERROR heading re-nest for gm-leak); "
                         "without it the repairs print as WOULD-FIX rows "
                         "and nothing is written. Ignored by `all`.")
    ap.add_argument("--renest-excludes", action="store_true",
                    help="gm-leak only, vault-wide: the 1.8.3 migration — "
                         "re-nest every heading titled with a current "
                         "exclude_sections entry under ## GM Notes, then "
                         "collapse exclude_sections to [\"GM Notes\"]. "
                         "Dry run unless --fix.")
    ap.add_argument("--threshold", type=float,
                    help="similarity ratio for names (default: the vault's "
                         "vault.name_match setting)")
    ap.add_argument("--since", type=int,
                    help="session number for the changed command")
    args = ap.parse_args()

    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    if args.renest_excludes and (args.command != "gm-leak" or args.folder):
        print("error: --renest-excludes needs the gm-leak command and the "
              "whole vault (no --folder): it rewrites the vault config",
              file=sys.stderr)
        return 2
    newer_than_mtime: float | None = None
    if args.file:
        normalized, invalid = _resolve_vault_paths(args.vault, args.file)
        if invalid:
            print(f"error: --file not found in vault: "
                  f"{', '.join(invalid)}", file=sys.stderr)
            return 2
        args.file = normalized
    if args.newer_than:
        normalized, invalid = _resolve_vault_paths(
            args.vault, [args.newer_than])
        if invalid:
            print(f"error: --newer-than not found in vault: "
                  f"{', '.join(invalid)}", file=sys.stderr)
            return 2
        newer_than_mtime = (args.vault / normalized[0]).stat().st_mtime
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
    # The site's own audit, asked whole: a long list with its own fixes
    # (campaign-qa's Site Faults), so it stays out of `all` too.
    if args.command == "site-faults":
        emit("site-faults", check_site_faults(args.vault, args.file))
        return 0

    if args.command == "settings":
        return check_settings(args.vault, args.fix, args.apply, args.json)

    explain = ExplainAll(args.vault)
    emit_rows = _emit_tool_once() if args.command == "all" else emit
    if args.command in ("frontmatter", "all"):
        emit_rows("frontmatter", check_frontmatter(args.vault, args.folder,
                                                   explain))
    if args.command in ("names", "all"):
        threshold = (args.threshold if args.threshold is not None
                     else setting_or_builtin(args.vault, "vault.name_match"))
        emit_rows("names", check_names(args.vault, threshold))
    if args.command in ("index", "all"):
        emit_rows("index", check_index(args.vault))
    if args.command in ("stale-drafts", "all"):
        emit_rows("stale-drafts", check_stale_drafts(args.vault))
    if args.command in ("tables", "all"):
        emit_rows("tables", check_tables(args.vault, args.folder, args.file,
                                         newer_than_mtime))
    if args.command in ("timeline", "all"):
        emit_rows("timeline", check_timeline(args.vault))
    if args.command in ("read-aloud", "all"):
        emit_rows("read-aloud", check_read_aloud(args.vault))
    if args.command in ("relationships", "all"):
        emit_rows("relationships",
                  check_relationships(args.vault, args.folder, args.file,
                                      newer_than_mtime))
    if args.command in ("sessions", "all"):
        emit_rows("sessions", check_sessions(args.vault))
    if args.command in ("gm-leak", "all"):
        # `all` is a report, so it never writes — same reasoning as
        # `wrapup` below.
        emit_rows("gm-leak", check_gm_leak(args.vault, args.folder,
                                           args.fix and args.command == "gm-leak",
                                           args.renest_excludes, explain))
    if args.command in ("pc-body", "all"):
        emit_rows("pc-body", check_pc_body(args.vault, args.folder, args.file,
                                           newer_than_mtime, explain))
    if args.command in ("wrapup", "all"):
        # `all` is a report, so it never writes: a full audit that
        # silently rewrote wrap-ups would be the last thing a GM expects
        # from a command whose other twelve checks are read-only.
        wrap_file = args.file[0] if args.file else None
        emit_rows("wrapup", check_wrapup(args.vault, wrap_file,
                                         args.fix and args.command == "wrapup"))
    # The one line the old exclude-list reader printed to stderr, now through
    # the settings: a hiding setting that cannot be read changes what these
    # checks say.
    if args.command in ("wrapup", "gm-leak", "pc-body", "all"):
        try:
            faults = settings_fault_rows(args.vault)
        except SettingsUnavailable as e:
            if args.command != "wrapup":
                raise
            # wrapup works without the tool; say the settings were not
            # checked rather than say nothing.
            why = str(e).removeprefix(SETTINGS_UNREAD)
            faults = [f"INFO\t{settings_file(args.vault)}\tthe settings could not be "
                      f"checked ({why})"]
        if faults:
            emit("settings", faults)
    return 0


def run() -> int:
    """`main`, with the failures no check can answer for itself: the
    publish tool going away after a check began asking it, and settings the
    tool cannot read."""
    try:
        return report_unreadable_settings(main)
    except PublishToolUnavailable as e:
        print(f"error: the publish tool stopped answering part-way ({e}) — "
              f"the rows above are incomplete and nothing further was "
              f"written; run it again", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(run())

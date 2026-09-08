#!/usr/bin/env python3
"""File and link vault-ingest image material without a file-by-file manual pass.

Backs vault-ingest Phase 1/3 image handling
(`references/image-handling.md`), whose 162-line spec nobody had turned
into code: classify by format, convert non-web-safe formats, slugify and
match against vault entities, file into the right `_attachments/`
subfolder, detect duplicates, and decide portrait vs. body-embed.

Deliberately not a reuse of `tools/mobrpg`'s `images` command: that matcher
solves a different problem (mobRPG API element_id -> vault file, via the
vault's own `mobrpg:` node crosswalk) and never slugifies a filename or
matches by name at all. This script's matching problem — slugify a local
filename, match it against vault entity filenames by exact/suffix-stripped
slug — has no existing implementation to extract; writing a second local
slug-matcher next to a differently-shaped API-driven one is not the
duplication the mechanization analysis warned about.

Read-only against DIR: source files are never modified or deleted, only
read (vault-ingest Gotcha 3). Non-web-safe conversion writes to a private
temp file, deleted immediately after use; the original is left untouched
either way.

Usage
-----
  ingest_images.py VAULT DIR [--execute]

VAULT is the vault root (entities are matched against its files). DIR is
walked recursively for image files (hidden files/dirs, `_processed`,
`__pycache__` and `.git` skipped — see `ingest_survey.py`'s `walk`).

Matching
--------
Slugify (strip filesystem/YAML/TSV-hostile characters, lowercase, spaces
and underscores -> hyphens, collapse consecutive hyphens) the image
filename, then:

1. Exact match against an entity file's own slug.
2. Suffix-strip once (drop the last hyphenated segment) and retry.

"Batch match" (matching against entities *created* in this same ingestion
pass) is out of scope for a single script invocation over an existing
vault — matches are checked against the entities that already exist when
the script runs.

Two source images that slugify to the *same* destination (different
filenames, same slug — "Ronnie Vint.jpg" and "ronnie_vint.jpg") are not a
matching bug, they're a batch collision: identical bytes make the second
one `SKIP-BATCH-DUP`; different bytes flag *both* as `DUP-FLAG`, because
neither can be silently preferred over the other.

Portrait vs. body-embed follows `image-handling.md`, gated on
`schema_rules.PORTRAIT_TYPES` (an entity type outside that set — `event`,
`session` — always gets a body embed, never a `portrait:` write, even as
the only match): a lone match becomes the portrait; among several matches
for one entity, an unsuffixed one becomes the portrait and the rest are
embedded; several suffixed matches with no unsuffixed default are left
unset and flagged "portrait-ambiguous" for the keeper interview; an entity
that already has a non-empty `portrait` never gets it overwritten — every
match becomes a body embed instead. This decision is recomputed on every
run against the vault's *current* state, so a portrait resolved by hand
after a "portrait-ambiguous" run, or a metadata write that failed midway,
is picked up and completed by the next `--execute` rather than frozen —
already-filed images (`DUP-SKIP`) still take part in this and still get
their `portrait:` / embed written if it wasn't already.

Resolving what the script leaves to a human is a manual step, not a
script flag: apply a keeper-interview portrait choice with
`stamp_entities.py VAULT FILE --set portrait="_attachments/..." --write`;
resolve a `DUP-FLAG` by hand (replace, rename the new file with a `-2`
suffix and re-run, or leave it); an unmatched image marked "atmosphere
art" has no dedicated destination in `image-handling.md`'s table — file
it under `_attachments/documents/` by hand.

Output
------
One row per image:

  ACTION<TAB>src<TAB>slug<TAB>matched-entity<TAB>dest<TAB>disposition

ACTION: FILED/WOULD-FILE, DUP-SKIP (identical file already filed —
metadata is still (re)applied under --execute if not already there),
DUP-FLAG (same destination, different content — from an on-disk file or
from a same-batch slug collision — needs a GM replace/keep-both/skip
decision), UNMATCHED, SKIP-FORMAT (not a recognized image extension),
SKIP-NO-CONVERTER (non-web-safe, neither `sips` nor `magick` available, or
conversion failed), SKIP-BATCH-DUP (same destination with identical
content seen earlier in this run — a same-named file with *different*
bytes is a DUP-FLAG, never a silent drop), AMBIGUOUS-ENTITY (two+
vault entities share this slug), or ERROR. A trailer line follows; N counts
image files only and the six buckets sum to it (SKIP-NO-CONVERTER and
SKIP-BATCH-DUP are the "skipped" bucket), with SKIP-FORMAT rows counted
separately as non-image files:

  # N images: F filed, D identical-skipped, L flagged, U unmatched,
  #   S skipped, E errors; X non-image files ignored

Dry-run by default: computes and reports the full plan, including
duplicate-identical/differs verdicts (which require actually performing any
non-web-safe conversion to get comparable bytes), but writes nothing. Pass
--execute to copy/convert into `_attachments/` and write the `portrait:`
field / `## Attachments` embed. A DUP-FLAG row is never auto-resolved, in
either mode — "flag, don't guess" (Design Principle 6).

Only a content digest, not the full bytes, is held across the planning
pass — a batch of hundreds of large images does not load them all into
memory at once. Bytes are read (and any conversion re-run) once at plan
time for the duplicate verdict and once more at write time; this trades a
little redundant I/O for bounded memory.

Exit status
-----------
0  no ERROR row.
1  at least one ERROR row.
2  usage (VAULT/DIR missing or not a directory).
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_survey import IMAGE_EXTS, walk  # noqa: E402
from schema_rules import PORTRAIT_TYPES  # noqa: E402
from vaultlib import (  # noqa: E402
    entity_type,
    extract_frontmatter,
    frontmatter_span,
    scalar_value,
    set_key,
    vault_files,
    yaml_scalar,
)

WEB_SAFE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}

# image-handling.md:58-66 — the filing map. Deliberately broader than
# schema_rules.PORTRAIT_TYPES (it adds event/session, which the schema
# does not consider portrait-bearing): this table says where the *file*
# goes, not who may claim `portrait:` — that gate is separate, below.
FOLDER = {
    "pc": "characters", "npc": "characters",
    "location": "locations",
    "faction": "factions", "organization": "factions",
    "item": "items",
    "creature": "creatures",
    "event": "events", "session": "events",
}

_UNSAFE_SLUG_CHARS = re.compile(r'[\\/:*?"<>|\t\r\n\x00-\x1f]')


def slugify(stem: str) -> str:
    """image-handling.md's slug rule (lowercase, spaces/underscores ->
    hyphens, collapse consecutive hyphens), plus stripping characters the
    spec doesn't anticipate but that would corrupt the written YAML
    (quotes, backslashes) or the tab-separated report (tabs, newlines)."""
    s = _UNSAFE_SLUG_CHARS.sub("", stem)
    s = re.sub(r"[ _]+", "-", s.strip().lower())
    return re.sub(r"-{2,}", "-", s)


def strip_suffix(slug: str) -> str | None:
    """Drop the last hyphenated segment once, or None if there is none."""
    if "-" not in slug:
        return None
    return slug.rsplit("-", 1)[0]


# --------------------------------------------------------------------------
# Entity index
# --------------------------------------------------------------------------


class Entity:
    __slots__ = ("rel", "etype", "portrait")

    def __init__(self, rel: str, etype: str, portrait: str):
        self.rel = rel
        self.etype = etype
        self.portrait = portrait


def build_entity_index(vault: Path) -> tuple[dict[str, Entity], set[str]]:
    """slug -> Entity for unambiguous slugs; the set of slugs shared by two
    or more entities (reported, never guessed at)."""
    by_slug: dict[str, list[Entity]] = {}
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        et = entity_type(fm)
        if et not in FOLDER:
            continue
        slug = slugify(Path(rel).stem)
        portrait_raw = fm.get("portrait")
        portrait = scalar_value(portrait_raw) if isinstance(portrait_raw, str) else ""
        by_slug.setdefault(slug, []).append(Entity(rel, et, portrait))
    ambiguous = {slug for slug, ents in by_slug.items() if len(ents) > 1}
    index = {slug: ents[0] for slug, ents in by_slug.items() if len(ents) == 1}
    return index, ambiguous


# --------------------------------------------------------------------------
# Conversion
# --------------------------------------------------------------------------


def _within(root: Path, path: Path) -> bool:
    target = path.resolve()
    return target == root or str(target).startswith(str(root) + os.sep)


def convert_to_jpeg(src: Path, dest: Path) -> bool:
    """Best-effort `sips` then `magick` conversion, per image-handling.md.
    Returns whether dest now holds converted bytes."""
    if shutil.which("sips"):
        r = subprocess.run(
            ["sips", "-s", "format", "jpeg", str(src), "--out", str(dest)],
            capture_output=True)
        if r.returncode == 0 and dest.exists():
            return True
    if shutil.which("magick"):
        r = subprocess.run(["magick", str(src), str(dest)], capture_output=True)
        if r.returncode == 0 and dest.exists():
            return True
    return False


def read_content(src: Path, tmp_dir: Path) -> tuple[bytes, str, str | None]:
    """(bytes, final-extension, skip-reason). skip-reason is None on
    success. Called once at plan time (for the duplicate verdict) and once
    more at write time — a small redundant cost that keeps the plan itself
    from holding every image's full bytes in memory at once."""
    ext = src.suffix.lower()
    if ext in WEB_SAFE_EXTS:
        return src.read_bytes(), ext, None
    if not (shutil.which("sips") or shutil.which("magick")):
        return b"", "", ("not a web-safe format and no conversion tool "
                         "available (sips/magick) — convert to jpg/png/webp "
                         "manually and re-ingest")
    fd, tmp_name = tempfile.mkstemp(dir=tmp_dir, suffix=".jpg")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        if convert_to_jpeg(src, tmp):
            return tmp.read_bytes(), ".jpg", None
        return b"", "", "conversion via sips/magick failed"
    finally:
        # A unique per-source temp name (not e.g. "<stem>.jpg", shared by
        # any other source with the same stem) and cleaned up immediately
        # — a large batch never accumulates converted copies on disk.
        tmp.unlink(missing_ok=True)


def digest_of(data: bytes) -> tuple[bytes, int]:
    return hashlib.sha256(data).digest(), len(data)


# --------------------------------------------------------------------------
# Planning
# --------------------------------------------------------------------------


class Plan:
    __slots__ = ("action", "src", "slug", "matched", "dest_rel",
                 "disposition", "content_hash", "content_len", "src_path",
                 "final_ext", "unsuffixed", "entity")

    def __init__(self, action: str, src: str, slug: str = "-",
                matched: str = "-", dest_rel: str = "-",
                disposition: str = "-", content_hash: bytes = b"",
                content_len: int = 0, src_path: Path | None = None,
                final_ext: str = ""):
        self.action = action
        self.src = src
        self.slug = slug
        self.matched = matched
        self.dest_rel = dest_rel
        self.disposition = disposition
        self.content_hash = content_hash
        self.content_len = content_len
        self.src_path = src_path
        self.final_ext = final_ext
        self.unsuffixed = False
        self.entity: Entity | None = None


def match_entity(slug: str, index: dict[str, Entity],
                 ambiguous: set[str]) -> tuple[Entity | None, str, bool]:
    """(entity, action-if-none, unsuffixed). unsuffixed is True when the
    slug matched an entity with no suffix stripped."""
    if slug in ambiguous:
        return None, "AMBIGUOUS-ENTITY", False
    if slug in index:
        return index[slug], "", True
    stripped = strip_suffix(slug)
    if stripped:
        if stripped in ambiguous:
            return None, "AMBIGUOUS-ENTITY", False
        if stripped in index:
            return index[stripped], "", False
    return None, "UNMATCHED", False


def build_plans(vault: Path, dir_: Path, tmp_dir: Path) -> list[Plan]:
    index, ambiguous = build_entity_index(vault)
    attach_root = (vault / "_attachments").resolve()

    # No basename-only pre-dedup here: two files that merely share a name
    # (dropbox/a/portrait.jpg vs dropbox/b/portrait.jpg) may hold entirely
    # different images. They slugify to the same destination, so the
    # dest_claims check below settles them on *content* — identical bytes
    # make the later one SKIP-BATCH-DUP (image-handling.md's "using the
    # first copy"), different bytes flag both, never a silent drop.
    candidates: list[tuple[str, Path]] = []
    for path in walk(dir_):
        if path.suffix.lower() not in IMAGE_EXTS:
            candidates.append(("skip-format", path))
            continue
        candidates.append(("ok", path))

    plans: list[Plan] = []
    groups: dict[str, list[Plan]] = {}
    # dest_rel -> the Plan currently claiming it, or "FLAGGED" once a
    # collision there has already been reported (so a third, fourth, ...
    # source landing on the same destination doesn't re-litigate it).
    dest_claims: dict[str, Plan | str] = {}

    for kind, path in candidates:
        rel_src = path.relative_to(dir_).as_posix()
        if kind == "skip-format":
            plans.append(Plan("SKIP-FORMAT", rel_src))
            continue

        slug = slugify(path.stem)
        entity, no_match_action, unsuffixed = match_entity(slug, index, ambiguous)
        if entity is None:
            plans.append(Plan(no_match_action, rel_src, slug))
            continue

        content, final_ext, skip_reason = read_content(path, tmp_dir)
        if skip_reason:
            plans.append(Plan("SKIP-NO-CONVERTER", rel_src, slug, entity.rel,
                              disposition=skip_reason))
            continue

        dest_name = f"{slug}{final_ext}"
        dest_rel = f"_attachments/{FOLDER[entity.etype]}/{dest_name}"
        dest_path = (vault / dest_rel).resolve()
        if not _within(attach_root, dest_path):
            plans.append(Plan("ERROR", rel_src, slug, entity.rel,
                              disposition="path escapes _attachments/"))
            continue

        digest, length = digest_of(content)
        collision_msg = (f"{dest_name} — multiple batch sources target the "
                         f"same destination (slug collision) — replace / "
                         f"keep-both / skip?")

        prior = dest_claims.get(dest_rel)
        if prior == "FLAGGED":
            plans.append(Plan("DUP-FLAG", rel_src, slug, entity.rel,
                              dest_rel, disposition=collision_msg))
            continue
        if isinstance(prior, Plan):
            if prior.content_hash == digest and prior.content_len == length:
                plans.append(Plan(
                    "SKIP-BATCH-DUP", rel_src, slug, entity.rel, dest_rel,
                    disposition=f"same destination as {prior.src} in this "
                                f"batch (identical content) — using the "
                                f"first copy"))
                continue
            prior.action = "DUP-FLAG"
            prior.disposition = collision_msg
            if prior.entity is not None:
                groups.get(prior.entity.rel, []).remove(prior)
            dest_claims[dest_rel] = "FLAGGED"
            plans.append(Plan("DUP-FLAG", rel_src, slug, entity.rel,
                              dest_rel, disposition=collision_msg))
            continue

        action = "FILE"
        if dest_path.exists():
            existing = dest_path.read_bytes()
            if existing != content:
                plans.append(Plan(
                    "DUP-FLAG", rel_src, slug, entity.rel, dest_rel,
                    disposition=f"{dest_name} exists with different "
                                f"content — replace / keep-both / skip?"))
                dest_claims[dest_rel] = "FLAGGED"
                continue
            action = "DUP-SKIP"

        plan = Plan(action, rel_src, slug, entity.rel, dest_rel,
                   content_hash=digest, content_len=length, src_path=path,
                   final_ext=final_ext)
        plan.unsuffixed = unsuffixed
        plan.entity = entity
        plans.append(plan)
        groups.setdefault(entity.rel, []).append(plan)
        dest_claims[dest_rel] = plan

    for entity_rel, group in groups.items():
        if not group:
            # Every plan that landed here was downgraded to DUP-FLAG by a
            # later slug collision — nothing left to decide a portrait for.
            continue
        entity = group[0].entity
        assert entity is not None
        if entity.etype not in PORTRAIT_TYPES:
            for p in group:
                p.disposition = ("body-embed (entity type does not "
                                 "support a portrait)")
            continue
        if entity.portrait:
            for p in group:
                p.disposition = "body-embed (entity already has a portrait)"
            continue
        if len(group) == 1:
            group[0].disposition = "portrait"
            continue
        unsuffixed_plans = [p for p in group if p.unsuffixed]
        if len(unsuffixed_plans) == 1:
            unsuffixed_plans[0].disposition = "portrait"
            for p in group:
                if p is not unsuffixed_plans[0]:
                    p.disposition = "body-embed"
        elif not unsuffixed_plans:
            for p in group:
                p.disposition = "portrait-ambiguous — defer to keeper interview"
        else:
            # Two+ unsuffixed matches for one entity (e.g. same stem, two
            # extensions) — no default in the spec; break the tie by
            # filename order rather than guessing at intent.
            unsuffixed_plans.sort(key=lambda p: p.src)
            unsuffixed_plans[0].disposition = "portrait"
            for p in group:
                if p is not unsuffixed_plans[0]:
                    p.disposition = "body-embed"

    return plans


# --------------------------------------------------------------------------
# Execution
# --------------------------------------------------------------------------


def insert_embed(text: str, filename: str) -> str:
    """Add `![[filename]]` under `## Attachments`, creating the heading at
    the end of the body if absent. Uses the file's own line ending
    throughout — `\\s*` is deliberately avoided in the heading match,
    since it would swallow a CRLF blank line and inject a bare LF."""
    embed_line = f"![[{filename}]]"
    if embed_line in text:
        return text
    eol = "\r\n" if "\r\n" in text else "\n"
    # `$` under MULTILINE matches before "\n" only, so a CRLF line needs
    # the "\r" allowed for explicitly (lookahead — it must not be consumed).
    heading = re.compile(r"^(##[ \t]+Attachments)[ \t]*(?=\r?$)", re.MULTILINE)
    if heading.search(text):
        return heading.sub(lambda m: f"{m.group(1)}{eol}{embed_line}",
                           text, count=1)
    sep = "" if text.endswith(("\n", "\r\n")) or not text else eol
    return f"{text}{sep}{eol}## Attachments{eol}{eol}{embed_line}{eol}"


def apply_metadata(vault: Path, rel: str, disposition: str,
                   dest_rel: str, dest_name: str) -> str | None:
    """Writes the portrait field or an Attachments embed. Returns an error
    string, or None on success (including a no-op — nothing to write, or
    the value/embed is already there — so a re-run is safe).

    `disposition` may carry an explanatory suffix (e.g. "body-embed (entity
    already has a portrait)") for the report column — dispatch matches on
    the prefix, not equality, so that annotation still triggers the embed.
    """
    if disposition != "portrait" and not disposition.startswith("body-embed"):
        return None
    path = vault / rel
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except OSError as e:
        return f"unreadable ({e.__class__.__name__})"

    if disposition == "portrait":
        lines = text.splitlines(keepends=True)
        close, err = frontmatter_span(lines)
        if err:
            return f"{err} — portrait not written"
        eol = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
        fm = lines[1:close]
        set_key(fm, "portrait", yaml_scalar(dest_rel), eol)
        lines[1:close] = fm
        new_text = "".join(lines)
    else:
        new_text = insert_embed(text, dest_name)

    if new_text != text:
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write(new_text)
    return None


def write_dest_bytes(vault: Path, plan: Plan, tmp_dir: Path) -> str | None:
    """Re-derives a FILE plan's bytes (re-reading, and re-converting if
    needed) and writes them to `_attachments/`. Returns an error string, or
    None."""
    assert plan.src_path is not None
    content, _final_ext, skip_reason = read_content(plan.src_path, tmp_dir)
    if skip_reason:
        return f"unreadable at write time: {skip_reason}"
    dest_path = vault / plan.dest_rel
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(content)
    except OSError as e:
        return f"write failed ({e.__class__.__name__})"
    return None


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    ap.add_argument("dir", type=Path)
    ap.add_argument("--execute", action="store_true",
                    help="write files and metadata (default: dry-run)")
    args = ap.parse_args()

    vault = args.vault.expanduser().resolve()
    dir_ = args.dir.expanduser().resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2
    if not dir_.is_dir():
        print(f"ERROR: not a directory: {dir_}", file=sys.stderr)
        return 2

    filed = dup_skip = flagged = unmatched = skipped = non_image = errors = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        plans = build_plans(vault, dir_, tmp_dir)
        for plan in plans:
            if plan.action in ("FILE", "DUP-SKIP"):
                err = None
                if args.execute:
                    if plan.action == "FILE":
                        err = write_dest_bytes(vault, plan, tmp_dir)
                    if err is None:
                        dest_name = Path(plan.dest_rel).name
                        err = apply_metadata(vault, plan.matched,
                                             plan.disposition,
                                             plan.dest_rel, dest_name)
                if err:
                    print(f"ERROR\t{plan.src}\t{plan.slug}\t{plan.matched}\t"
                          f"{plan.dest_rel}\t{err}")
                    errors += 1
                    continue
                if plan.action == "FILE":
                    verb = "FILED" if args.execute else "WOULD-FILE"
                    filed += 1
                else:
                    verb = "DUP-SKIP"
                    dup_skip += 1
                print(f"{verb}\t{plan.src}\t{plan.slug}\t{plan.matched}\t"
                      f"{plan.dest_rel}\t{plan.disposition}")
            else:
                print(f"{plan.action}\t{plan.src}\t{plan.slug}\t"
                      f"{plan.matched}\t{plan.dest_rel}\t{plan.disposition}")
                if plan.action == "DUP-FLAG":
                    flagged += 1
                elif plan.action in ("UNMATCHED", "AMBIGUOUS-ENTITY"):
                    unmatched += 1
                elif plan.action == "ERROR":
                    errors += 1
                elif plan.action == "SKIP-FORMAT":
                    non_image += 1
                else:
                    skipped += 1

    total = len(plans) - non_image
    print(f"# {total} images: {filed} filed, {dup_skip} identical-skipped, "
          f"{flagged} flagged, {unmatched} unmatched, {skipped} skipped, "
          f"{errors} errors; {non_image} non-image files ignored")
    if not args.execute:
        print("dry-run — pass --execute to write")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

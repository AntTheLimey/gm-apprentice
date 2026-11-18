#!/usr/bin/env python3
"""Batch frontmatter writes for the session workflows.

Replaces the per-file Read+Edit cycles the wrap-up and reconcile
procedures used to spell out by hand: the PC sheet refresh
(`asOfSession`/`lastUpdated`/chapter tag), the generic field writes a
wrap-up makes on session indexes and the campaign overview, canon
status promotion and supersession, and the legacy canon-key repair.

Surgical: only the targeted frontmatter lines change; body content,
other fields, comments, and line endings are preserved byte-for-byte.
Files whose frontmatter delimiters are malformed or whose frontmatter
doesn't look like YAML are refused, never guessed at.

Dry-run by default — prints planned changes and exits. Pass --write
to apply. Stdlib only.

Usage:
  stamp_entities.py VAULT [FILE ...] [--session S] [--date YYYY-MM-DD]
      [--retag OLD=NEW] [--set KEY=VALUE]... [--add KEY=VALUE]...
      [--increment KEY]...
      [--advance KEY=FROM:TO]... [--promote] [--reconciled YYYY-MM-DD] [--supersede-by "[[Winner]]"]
      [--repair-canon] [--force-shape] [--write]

FILE paths are vault-relative, and at least one is required for every
action except --repair-canon. At least one action is required.

Actions
-------
--session S     `asOfSession`, written verbatim: a bare integer (`9`)
                stays a bare integer, anything else (`"Chapter 4,
                Session 9"`) is written as a quoted string. A vault
                that already uses one shape keeps it: a file whose
                existing `asOfSession` is a label is refused a bare
                number (and vice versa) unless --force-shape is given,
                because silently flattening "Chapter 4, Session 8" to
                `9` drops the chapter and diverges from what every
                other writer in the toolchain produces.
--date D        `lastUpdated: "D"`, YYYY-MM-DD.
--retag OLD=NEW Swap one tag inside the `tags:` list only.
--set KEY=VALUE Any other field. KEY is a top-level key or a one-level
                dotted `parent.child` (`documents.wrap_up`), created
                inside the parent's block when it is missing. VALUE is
                typed the way YAML would: `null`/`true`/`12` stay bare,
                everything else — wikilinks and prose labels most of
                all — is double-quoted. Repeatable. The fields with
                their own flags — `canon_status`, `superseded_by`,
                `asOfSession`, `lastUpdated`, `reconciled` — are
                refused here, dotted forms included, because those
                flags carry the guards.
                A VALUE that opens with `[` (but not `[[`, a wikilink)
                is a list, written as JSON: `'entities=["[[Ada]]",
                "Bram"]'`, or `[]` to empty it. It replaces the field
                with a block list of quoted items, one per line, the
                way `vault-write` writes a scene's entities. A list
                that is not JSON, or holds anything but text, is
                refused; to set text that opens with `[`, quote it.
                Top-level keys only.
--add KEY=VALUE Append one item to a top-level list field, making the
                list when the field is absent or empty. An item the
                list already holds (same link target, case ignored) is
                skipped; a field holding text, a number or a mapping is
                refused. Repeatable.

In `entities`, `locations`, `participants` and `leads_to`, the fields
that hold links, each item of a list --set or --add is a note: a bare
name, a `[[link]]` or a vault path, resolved as a link resolves (file
name, then alias) and written `[[File Name]]`. A name no note has yet
is written as given, with a WARNING row (a red link is the GM's to-do);
a name two notes share is refused: pass the path.
--increment KEY Add one to an integer field (absent counts as 0), for
                counters like `sessions_played`. Writes bare. A
                non-integer value is an error, not a reset, and the
                fields with their own flags are refused here too.
--advance KEY=FROM:TO
                Set a top-level field to TO only when it is FROM now
                (case ignored); any other value, or none, is left as
                it is and reported. Neither value may hold a colon.
                For one-way moves such as a
                campaign's `status=not_started:in_progress`, which must
                never undo a paused or completed one. Repeatable; the
                fields with their own flags are refused.
--promote       `canon_status` DRAFT or absent -> AUTHORITATIVE, in
                whatever case the file writes it. STUB and SUPERSEDED
                are refused: a stub needs content first, and a
                superseded entity's successor is what should be
                promoted. So is any value outside those four states —
                promoting an unrecognised status blind is exactly the
                silent status flip the repair below exists to prevent.
--supersede-by "[[Winner]]"
                `canon_status: SUPERSEDED` plus `superseded_by`.
                Mutually exclusive with --promote.
--reconciled D  `reconciled: "D"`, YYYY-MM-DD.
--repair-canon  Apply `shared/canon-status.md` § Repairing Legacy Keys
                to `source_confidence` / `confidence`: rename when it
                is the only status key, delete when it agrees with an
                existing `canon_status`, and when it disagrees keep
                `canon_status`, delete the legacy line and report a
                CONFLICT for the GM to confirm. Runs on its own — with
                no FILE it sweeps every `.md` in the vault, templates
                and `_meta/` included, and files with no legacy key
                produce no row so the sweep stays readable.

A trailing YAML comment is a comment, not part of the value:
`canon_status: DRAFT  # confirmed` promotes, and a legacy key annotated
the same way still counts as agreeing with it.

Output
------
One tab-separated row per file: `MODE<TAB>path<TAB>actions`, actions
joined with `; `, after any `WARNING<TAB>path<TAB>message` rows for
it. MODE is STAMPED / WOULD-STAMP / UNCHANGED / ERROR,
or REPAIRED / WOULD-REPAIR / CONFLICT / WOULD-CONFLICT / UNCHANGED /
ERROR under --repair-canon — the WOULD- forms are what a dry run
prints. Trailers:

  # stamped: N files, E errors
  # repaired: N files, M conflicts, E errors

with `dry-run would stamp` / `dry-run would repair` in place of the
verb on a dry run. N counts files changed, conflicts included; M is how
many of those had a legacy value disagreeing with `canon_status`.

Exit status
-----------
0  no ERROR row. A CONFLICT is not an error: the repair is applied and
   only the resulting status wants a GM's confirmation.
1  at least one ERROR row. Every ERROR leaves its file byte-identical.
2  usage. No action flag; FILE missing for anything but --repair-canon;
   --repair-canon mixed with another action; --promote with
   --supersede-by; a malformed --set / --add / --increment / --advance /
   --retag / --session / --supersede-by argument (a --set list that is
   not a JSON list of text included); a --date or --reconciled that is not
   YYYY-MM-DD.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vaultlib as vl  # noqa: E402
from vaultlib import (  # noqa: E402,F401 — YAML_LINE_RE re-exported
    YAML_LINE_RE,
    delete_key,
    frontmatter_span,
    get_key,
    opens_a_block,
    raw_frontmatter,
    scalar_value,
    set_key,
    set_nested_key,
    unquote,
    vault_files,
    yaml_scalar,
    yaml_value_for_cli,
)

# The two pre-1.8.0 names for canon_status. Exactly these two: a repair
# pass that guesses at further synonyms would rewrite fields it does not
# own.
LEGACY_KEYS = ("source_confidence", "confidence")

# Fields with a dedicated flag, because each carries a guard the generic
# writers have no way to apply (shape checking, status transitions, date
# validation). Both generic paths consult this: --set on the *top-level*
# component of its key, so `canon_status.child` cannot smuggle a mapping
# in under a protected name, and --increment on the whole key, so
# `--increment asOfSession` cannot walk a session label past its shape
# rules.
RESERVED_KEYS = {
    "canon_status": "use --promote or --supersede-by",
    "superseded_by": "use --supersede-by",
    "asOfSession": "use --session",
    "lastUpdated": "use --date",
    "reconciled": "use --reconciled",
}

KEY_RE = re.compile(r"^[A-Za-z_][\w-]*$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The list fields that hold links to notes (`shared/entity-schema.md`: a
# scene's entities and locations, a plan's participants, locations and
# leads_to). An item given to one is resolved to a note and written as a
# [[link]] (#761).
LINK_FIELDS = ("entities", "locations", "participants", "leads_to")

# (field, item as given) -> the link body to write. Raises ValueError for
# a name it refuses (two notes answer to it).
Linker = Callable[[str, str], str]


def session_shape(raw: str | None) -> str | None:
    """'int' for an integer (bare or quoted), 'label' for any other
    non-empty value, None for absent or empty (a fresh template's
    `asOfSession: ""`)."""
    if raw is None:
        return None
    text = unquote(raw)
    if text == "":
        return None
    return "int" if re.fullmatch(r"\d+", text) else "label"


def retag(fm: list[str], old: str, new: str) -> str | None:
    """Swap a tag inside the tags: list only — never other lists."""
    in_tags = False
    for i, raw in enumerate(fm):
        line = raw.rstrip("\r\n")
        if re.match(r"^tags:\s*$", line):
            in_tags = True
            continue
        if in_tags:
            if not line.strip():
                continue  # blank lines inside the list don't end it
            m = re.match(rf"^(\s*-\s*){re.escape(old)}\s*$", line)
            if m:
                fm[i] = raw.replace(f"{m.group(1)}{old}",
                                    f"{m.group(1)}{new}", 1)
                return f"tag {old} -> {new}"
            if not re.match(r"^\s*-\s", line):
                in_tags = False  # tags block ended
        inline = re.match(
            rf"^(tags:\s*\[[^\]]*?)(?<=[\[,\s]){re.escape(old)}(?=[,\]\s])",
            line)
        if inline:
            fm[i] = raw.replace(inline.group(0),
                                f"{inline.group(1)}{new}", 1)
            return f"tag {old} -> {new}"
    return None


def _rename_first(fm: list[str], old: str, new: str) -> str | None:
    """Rewrite the key of the first top-level `old:` line, keeping its
    value text and its own line ending exactly."""
    for i, line in enumerate(fm):
        if line.startswith(f"{old}:"):
            fm[i] = f"{new}:{line[len(old) + 1:]}"
            return line.rstrip("\r\n")
    return None


def repair_canon(fm: list[str]) -> tuple[list[str], str | None]:
    """Apply the canon-status legacy-key repair to one frontmatter block.

    Returns (actions, conflict). Empty actions means there was no legacy
    key and nothing was touched. A conflict message means the repair was
    applied — `canon_status` wins, per `shared/canon-status.md` — but the
    legacy value disagreed and the GM has to confirm which is right.

    Never a blind rename: a file carrying both a legacy key and
    `canon_status` would end up with two `canon_status:` lines, and a
    YAML reader silently keeping one of them can flip an entity's status.
    """
    if not any(get_key(fm, key) is not None for key in LEGACY_KEYS):
        return [], None

    actions: list[str] = []
    if get_key(fm, "canon_status") is None:
        for key in LEGACY_KEYS:
            if get_key(fm, key) is not None:
                old_line = _rename_first(fm, key, "canon_status")
                actions.append(
                    f"renamed {old_line} -> canon_status: "
                    f"{scalar_value(get_key(fm, 'canon_status') or '')}")
                break

    # scalar_value, not unquote: a trailing `# legacy note` is a YAML
    # comment, and comparing it as part of the value turned an agreeing
    # pair into a spurious CONFLICT.
    canon = scalar_value(get_key(fm, "canon_status") or "")
    disagreements: list[str] = []
    for key in LEGACY_KEYS:
        # Loop: a file may carry the same legacy key twice, and leaving
        # the second copy behind would fail the repair silently.
        while get_key(fm, key) is not None:
            raw = get_key(fm, key) or ""
            removed = delete_key(fm, key)
            actions.append(f"removed {removed}")
            if scalar_value(raw).casefold() != canon.casefold():
                disagreements.append(f"{key}: {scalar_value(raw)}")

    conflict = None
    if disagreements:
        conflict = (f"{'; '.join(disagreements)} disagrees with "
                    f"canon_status: {canon} — kept canon_status, confirm it")
    return actions, conflict


def _plan_repair(fm: list[str]) -> tuple[list[str], str | None, bool]:
    """repair_canon plus the post-conditions every caller has to enforce:
    a legacy key has to hold a scalar, and exactly one `canon_status:`
    line survives, or nothing is written."""
    # A legacy key whose value is an indented block is not a status at
    # all. Renaming it yields `canon_status:` followed by list items —
    # a shape no consumer accepts and no reader flags, reported as
    # REPAIRED; deleting it orphans the same items. Both are wrong.
    blocked = [key for key in LEGACY_KEYS
               if get_key(fm, key) is not None and opens_a_block(fm, key)]
    if blocked:
        return ([f"{', '.join(blocked)} carries an indented block, not a "
                 f"status value — repair this file by hand"], None, True)
    actions, conflict = repair_canon(fm)
    if not actions:
        return [], None, False
    count = sum(1 for line in fm if line.startswith("canon_status:"))
    if count != 1:
        return ([f"{count} canon_status: lines after repair — "
                 f"repair this file by hand"], None, True)
    if conflict:
        actions.append(conflict)
        return actions, "CONFLICT", False
    return actions, None, False


def _plan_set(fm: list[str], key: str, value: str | list[str],
              eol: str, link: Linker | None = None) -> tuple[str, bool]:
    """One --set write. Returns (action text, error)."""
    parent, dot, child = key.partition(".")
    hint = RESERVED_KEYS.get(parent)
    if hint:
        return f"refusing --set {key} — {hint}", True
    if isinstance(value, list):
        return _plan_set_list(fm, key, value, eol, link)
    if not dot:
        return set_key(fm, key, yaml_value_for_cli(value), eol), False
    try:
        return set_nested_key(fm, parent, child, yaml_value_for_cli(value),
                              eol), False
    except ValueError as e:
        # An inline parent map (`documents: {plan: …}`) cannot take an
        # appended block without leaving a duplicate top-level key, which
        # a YAML reader resolves last-wins — the inline entries would
        # vanish from the whole toolchain while this reported STAMPED.
        return str(e), True


def list_value(raw: str) -> list[str] | None:
    """A --set VALUE as a list, or None when it is not written as one.

    A list opens with `[`; a `[[link]]` is a scalar, as it always was.
    Read with the standard JSON reader (the plugin is stdlib only, and a
    JSON list is also a YAML flow list). Raises ValueError for one that
    is not a JSON list of text."""
    text = raw.strip()
    if not text.startswith("[") or text.startswith("[["):
        return None
    try:
        value = json.loads(text)
    except ValueError:
        raise ValueError(
            f"{text!r} is not a list written as JSON: quote each item, "
            f"as in [\"[[Ada]]\", \"Bram\"]; to set text that opens with "
            f"[, quote the whole value") from None
    if not isinstance(value, list) or not all(
            isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"{text!r}: every item of a list must be quoted, "
                         f"non-empty text")
    return [item.strip() for item in value]


def _same_item(item: str) -> str:
    """What two items are compared by: the link target, case ignored."""
    return vl.link_target(vl.wikilink_target(item))


def _list_item(key: str, raw: str, link: Linker | None) -> str:
    """One item as it is written: a link field's item as a [[link]] to
    the note it names (as given when there is no vault to ask)."""
    if key not in LINK_FIELDS:
        return raw
    body = (link(key, raw) if link is not None
            else raw.strip().removeprefix("[[").removesuffix("]]").strip())
    return f"[[{body}]]"


def _current(fm: list[str]) -> dict[str, Any]:
    """The frontmatter as the toolchain's reader reads it now."""
    return vl.extract_frontmatter("---\n" + "".join(fm) + "---\n") or {}


def _block_span(fm: list[str], key: str) -> tuple[int, int] | None:
    """(first, end) of the top-level `key:` line and the indented lines
    it owns; blank lines after them stay outside. (`frontmatter_span`
    refuses a list whose items sit at column zero before this runs.)"""
    pattern = re.compile(rf"^{re.escape(key)}:")
    start = next((i for i, line in enumerate(fm) if pattern.match(line)),
                 None)
    if start is None:
        return None
    end = start + 1
    while end < len(fm):
        text = fm[end].rstrip("\r\n")
        if text.strip() and not text[:1].isspace():
            break
        end += 1
    while end > start + 1 and not fm[end - 1].strip():
        end -= 1
    return start, end


def _holds_mapping(fm: list[str], key: str) -> bool:
    """Does `key:` own a nested mapping (`documents:` and its children)?"""
    span = _block_span(fm, key)
    if span is None or not opens_a_block(fm, key):
        return False
    first = next((line for line in fm[span[0] + 1:span[1]]
                  if line.strip() and not line.lstrip().startswith("#")), "-")
    return not first.lstrip().startswith("-")


def _write_list(fm: list[str], key: str, items: list[str], eol: str) -> None:
    """Write `key` as a block list of quoted items (`[]` when empty), the
    shape `vault_write.link_list` gives a scene's entities."""
    new = ([f"{key}: []{eol}"] if not items else
           [f"{key}:{eol}"] + [f"  - {yaml_scalar(item, quoted_int=True)}"
                               f"{eol}" for item in items])
    span = _block_span(fm, key)
    if span is None:
        fm.extend(new)
        return
    start, end = span
    # The last line keeps its own ending: none, at the end of a file
    # whose frontmatter has none, stays none.
    own = fm[end - 1][len(fm[end - 1].rstrip("\r\n")):]
    new[-1] = new[-1][:-len(eol)] + own
    fm[start:end] = new


def _show(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _plan_set_list(fm: list[str], key: str, items: list[str], eol: str,
                   link: Linker | None) -> tuple[str, bool]:
    """One --set of a list. Returns (action text, error)."""
    if _holds_mapping(fm, key):
        return f"{key} holds a mapping — not replaced by a list", True
    try:
        written = [_list_item(key, item, link) for item in items]
    except ValueError as e:
        return str(e), True
    # One entry per note: a name and its [[link]] are the same item.
    seen: dict[str, str] = {}
    for item in written:
        seen.setdefault(_same_item(item), item)
    written = list(seen.values())
    before = _current(fm).get(key)
    _write_list(fm, key, written, eol)
    if before is None:
        return f"added {key}: {_show(written)}", False
    return f"{key}: {_show(before)} -> {key}: {_show(written)}", False


def _plan_add(fm: list[str], key: str, raw: str, eol: str,
              link: Linker | None) -> tuple[str, bool]:
    """One --add. Returns (action text, error)."""
    hint = RESERVED_KEYS.get(key)
    if hint:
        return f"refusing --add {key} — {hint}", True
    if _holds_mapping(fm, key):
        return f"{key} holds a mapping, not a list — --add refused", True
    have = _current(fm).get(key)
    if have is not None and not isinstance(have, list):
        return (f"{key} is {get_key(fm, key)} — not a list; --add refused "
                f"(--set it to a list first)", True)
    try:
        item = _list_item(key, raw, link)
    except ValueError as e:
        return str(e), True
    items = list(have or [])
    if _same_item(item) in {_same_item(x) for x in items}:
        return f"{key} already lists {item}", False
    _write_list(fm, key, [*items, item], eol)
    return f"{key} + {item}", False


def _plan_increment(fm: list[str], key: str,
                    eol: str) -> tuple[str, bool]:
    """One --increment write. Returns (action text, error)."""
    hint = RESERVED_KEYS.get(key)
    if hint:
        return f"refusing --increment {key} — {hint}", True
    raw = get_key(fm, key)
    text = scalar_value(raw) if raw is not None else ""
    if text and not re.fullmatch(r"-?\d+", text):
        return (f"{key} is {raw} — not an integer; --increment refused",
                True)
    new = (int(text) if text else 0) + 1
    added = set_key(fm, key, str(new), eol)
    if raw is None:
        return added, False
    # A counter reads better as `sessions_played: 3 -> 4` than as the
    # full replacement text set_key reports. An existing key with no
    # value would otherwise read `sessions_played: -> sessions_played: 1`.
    return f"{key}: {raw or '(empty)'} -> {new}", False


def _plan_advance(fm: list[str], key: str, old: str, new: str,
                  eol: str) -> tuple[str, bool]:
    """One --advance. Returns (action text, error)."""
    hint = RESERVED_KEYS.get(key)
    if hint:
        return f"refusing --advance {key} — {hint}", True
    raw = get_key(fm, key)
    have = scalar_value(raw) if raw is not None else ""
    if have.casefold() != old.casefold():
        return f"{key} is {have or '(none)'}, not {old} — left as it is", False
    set_key(fm, key, yaml_value_for_cli(new), eol)
    return f"{key}: {have} -> {new}", False


def _plan_promote(fm: list[str], eol: str) -> tuple[str, bool]:
    """--promote. Returns (action text, error)."""
    raw = get_key(fm, "canon_status")
    status = scalar_value(raw or "").upper()
    if status in ("", "DRAFT"):
        return set_key(fm, "canon_status", "AUTHORITATIVE", eol), False
    if status == "AUTHORITATIVE":
        return "canon_status already AUTHORITATIVE", False
    if status == "STUB":
        return "refusing to promote a STUB — flesh it out first", True
    if status == "SUPERSEDED":
        return "SUPERSEDED — promote the superseding entity", True
    return f"canon_status is {raw} — not a promotable status", True


def plan_file(rel: str, lines: list[str], opts: argparse.Namespace,
              link: Linker | None = None
              ) -> tuple[list[str], str | None, bool]:
    """Plan one file's edits, mutating `lines` in place when they hold.

    Returns (actions, mode override, error). On an error nothing is
    spliced back, so the caller's `"".join(lines)` is byte-identical to
    what it read and the file is never half-written. `link` resolves the
    items of a link field's list (`vault_linker`); without it they are
    written as given.
    """
    close, err = frontmatter_span(lines)
    if err:
        verb = "repaired" if opts.repair_canon else "stamped"
        return [f"{err} — not {verb}"], None, True
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = lines[1:close]

    if opts.repair_canon:
        actions, mode, error = _plan_repair(fm)
        if error:
            return actions, mode, True
        lines[1:close] = fm
        return actions, mode, False

    actions = []
    if opts.session:
        old_raw = get_key(fm, "asOfSession")
        old_shape = session_shape(old_raw)
        if (old_shape and old_shape != opts.session_shape
                and not opts.force_shape):
            want = ("a label like the existing value" if old_shape == "label"
                    else "a plain session number")
            return ([f"asOfSession is currently {old_raw} ({old_shape}); "
                     f"--session {opts.session!r} would change its shape. "
                     f"Pass {want}, or --force-shape to override — "
                     f"not stamped"], None, True)
        quoted_int = (old_raw is not None and old_shape == "int"
                      and old_raw.strip()[:1] in "\"'")
        actions.append(set_key(fm, "asOfSession",
                               yaml_scalar(opts.session,
                                           quoted_int=quoted_int), eol))
    if opts.date:
        actions.append(set_key(fm, "lastUpdated", f'"{opts.date}"', eol))
    if opts.retag_pair:
        tag_old, tag_new = opts.retag_pair
        act = retag(fm, tag_old, tag_new)
        actions.append(act if act else
                       f"tag {tag_old} not present in tags — no swap")
    for key, value in opts.set_pairs:
        act, error = _plan_set(fm, key, value, eol, link)
        if error:
            return [act], None, True
        actions.append(act)
    for key, value in getattr(opts, "add_pairs", []):
        act, error = _plan_add(fm, key, value, eol, link)
        if error:
            return [act], None, True
        actions.append(act)
    for key in opts.increment:
        act, error = _plan_increment(fm, key, eol)
        if error:
            return [act], None, True
        actions.append(act)
    for key, old, new in opts.advance_triples:
        act, error = _plan_advance(fm, key, old, new, eol)
        if error:
            return [act], None, True
        actions.append(act)
    if opts.promote:
        act, error = _plan_promote(fm, eol)
        if error:
            return [act], None, True
        actions.append(act)
    if opts.reconciled:
        actions.append(set_key(fm, "reconciled", f'"{opts.reconciled}"', eol))
    if opts.supersede_by:
        actions.append(set_key(fm, "canon_status", "SUPERSEDED", eol))
        actions.append(set_key(fm, "superseded_by",
                               yaml_scalar(unquote(opts.supersede_by)), eol))

    lines[1:close] = fm
    return actions, None, False


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path, help="the vault folder")
    ap.add_argument("files", nargs="*", help="vault-relative paths")
    ap.add_argument("--session",
                    help="asOfSession value, written verbatim: a bare "
                         "number (9) or a label (\"Chapter 4, Session 9\")")
    ap.add_argument("--date", help="lastUpdated value, YYYY-MM-DD")
    ap.add_argument("--retag", help="OLD=NEW chapter tag swap")
    ap.add_argument("--set", dest="sets", action="append", default=[],
                    metavar="KEY=VALUE",
                    help="set a top-level or one-level dotted key; a "
                         "JSON list ([\"[[A]]\", \"B\"]) sets a "
                         "top-level list; repeatable")
    ap.add_argument("--add", dest="adds", action="append", default=[],
                    metavar="KEY=VALUE",
                    help="append one item to a top-level list field, "
                         "skipping one it already holds")
    ap.add_argument("--increment", action="append", default=[],
                    metavar="KEY",
                    help="add one to an integer field; repeatable")
    ap.add_argument("--advance", action="append", default=[],
                    metavar="KEY=FROM:TO",
                    help="set KEY to TO only when it is FROM; repeatable")
    status = ap.add_mutually_exclusive_group()
    status.add_argument("--promote", action="store_true",
                        help="canon_status DRAFT or absent -> AUTHORITATIVE")
    status.add_argument("--supersede-by", metavar="LINK",
                        help='canon_status: SUPERSEDED plus superseded_by')
    ap.add_argument("--reconciled", metavar="YYYY-MM-DD",
                    help="reconciled date")
    ap.add_argument("--repair-canon", action="store_true",
                    help="repair legacy canon-status keys; sweeps the "
                         "whole vault when no FILE is given")
    ap.add_argument("--force-shape", action="store_true",
                    help="allow asOfSession to change shape (label <-> "
                         "bare number) in files that already use one")
    ap.add_argument("--write", action="store_true",
                    help="apply changes (default: dry run)")
    ap.epilog = ('Example: gma stamp-entities "<vault>" "<note>" --set '
                 'status=active --write\n'
                 '  gma stamp-entities "<vault>" "<scene>" --set '
                 '\'entities=["Ada", "Bram"]\' --add locations=Mill --write')
    return ap


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = build_parser()
    args = ap.parse_args(argv)

    stamping = bool(args.session or args.date or args.retag or args.sets
                    or args.adds or args.increment or args.advance or args.promote or args.reconciled
                    or args.supersede_by)
    if not stamping and not args.repair_canon:
        ap.error("at least one action is required: --session, --date, "
                 "--retag, --set, --add, --increment, --advance, --promote, --reconciled, "
                 "--supersede-by or --repair-canon")
    if args.repair_canon and stamping:
        # The repair has its own row vocabulary and its own summary; a
        # mixed run would report two different things in one column.
        ap.error("--repair-canon runs on its own — re-run the other "
                 "actions in a second call")
    if stamping and not args.files:
        ap.error("FILE is required — only --repair-canon may sweep the "
                 "whole vault")

    if args.session is not None:
        # A shell-quoted '"10"' means the integer 10, not a label
        # containing quotes.
        args.session = unquote(args.session)
        if not args.session:
            ap.error("--session must not be empty")
    args.session_shape = session_shape(args.session)

    for label, value in (("--date", args.date),
                         ("--reconciled", args.reconciled)):
        if value is not None and not ISO_DATE_RE.match(value):
            ap.error(f"{label} must be YYYY-MM-DD, got {value}")

    args.retag_pair = None
    if args.retag:
        tag_old, sep, tag_new = args.retag.partition("=")
        if not sep or not tag_old.strip() or not tag_new.strip():
            ap.error("--retag needs OLD=NEW with both sides non-empty")
        args.retag_pair = (tag_old, tag_new)

    args.set_pairs = []
    for item in args.sets:
        key, sep, value = item.partition("=")
        key = key.strip()
        parent, dot, child = key.partition(".")
        if not sep:
            ap.error(f"--set needs KEY=VALUE, got {item!r}")
        # Branch on the separator, not on the child's truthiness: with
        # `child and ...` an empty child skipped validation entirely and
        # `--set 'a.=1'` wrote `a:` with a nameless `: 1` under it, which
        # every writer in the toolchain then refuses as non-YAML.
        if not KEY_RE.match(parent) or (dot and not KEY_RE.match(child)):
            ap.error(f"--set key must be `key` or `parent.child`, got "
                     f"{key!r}")
        try:
            items = list_value(value)
        except ValueError as e:
            ap.error(f"--set {key}: {e}")
        if items is not None and dot:
            ap.error(f"--set {key}: a list goes on a top-level key")
        args.set_pairs.append((key, value if items is None else items))

    args.add_pairs = []
    for item in args.adds:
        key, sep, value = item.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not KEY_RE.match(key) or not unquote(value):
            ap.error(f"--add needs KEY=VALUE with a top-level key and an "
                     f"item, got {item!r}")
        args.add_pairs.append((key, unquote(value)))

    for key in args.increment:
        if not KEY_RE.match(key.strip()):
            ap.error(f"--increment takes a top-level key, got {key!r}")
    args.increment = [key.strip() for key in args.increment]

    args.advance_triples = []
    for item in args.advance:
        key, sep, pair = item.partition("=")
        old, colon, new = pair.partition(":")
        # FROM is compared unquoted; TO keeps its quotes for the YAML
        # typing (`"9"` stays a string).
        key, old, new = key.strip(), unquote(old.strip()), new.strip()
        if (not sep or not colon or ":" in new or not KEY_RE.match(key)
                or not old or not unquote(new)):
            ap.error(f"--advance needs KEY=FROM:TO, got {item!r}")
        args.advance_triples.append((key, old, new))

    if args.supersede_by is not None and not unquote(args.supersede_by):
        ap.error("--supersede-by must not be empty")
    return args


def _legacy_scan_region(text: str) -> str:
    """The text a sweep's legacy-key filter should search.

    The frontmatter's YAML normally — a `confidence:` line inside a
    fenced example in the body is documentation, and a note with no
    frontmatter at all has nothing to repair. But when a file opens with
    `---` and the block is malformed, `raw_frontmatter` yields nothing,
    and skipping on that would let a broken file keep its legacy key
    silently. Hand back the whole text there so the planner sees it and
    reports the malformed delimiter.
    """
    raw = raw_frontmatter(text)
    if raw or not text.lstrip("\ufeff").startswith("---"):
        return raw
    return text


def targets(args: argparse.Namespace) -> list[str]:
    """The vault-relative paths to visit.

    A --repair-canon sweep deliberately walks templates and `_meta/` too
    — a legacy key in a template reproduces itself into every entity made
    from it — and pre-filters on the legacy key so the vast majority of
    notes are never opened a second time.

    The filter reads the frontmatter region only (see
    `_legacy_scan_region`). Matching the whole file would pull in prose
    whose code block happens to show a `confidence:` line, and a note
    with no frontmatter at all would then reach the planner and be
    reported as an error it has no business failing.
    """
    if args.files:
        return list(args.files)
    legacy = re.compile(
        rf"(?m)^(?:{'|'.join(re.escape(k) for k in LEGACY_KEYS)}):")
    return [rel for rel, text in vault_files(args.vault, skip_dirs=set())
            if legacy.search(_legacy_scan_region(text))]


def needs_links(args: argparse.Namespace) -> bool:
    """Does the run write a list to a link field?"""
    return any(key in LINK_FIELDS and isinstance(value, list)
               for key, value in args.set_pairs) or any(
        key in LINK_FIELDS for key, _ in getattr(args, "add_pairs", []))


def vault_linker(batch: Any, warn: Callable[[str], None]) -> Linker:
    """A `Linker` over `batch` (a `vault_write.Batch`): names resolved by
    `vault_write.NoteLinks`, the resolver `promote-plan` writes a plan's
    participants and locations with, red links reported through `warn`."""
    import vault_write as vw   # here: only a link field needs it
    notes = vw.NoteLinks(batch)
    want = {"locations": vw.PLAN_PLACES, "participants": vw.PLAN_PEOPLE}

    def link(key: str, raw: str) -> str:
        try:
            return notes.named(raw, key, want.get(key), warn)
        except vw.WriteError as e:
            raise ValueError(str(e)) from None
    return link


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repairing = args.repair_canon
    sweeping = repairing and not args.files

    # Past tense for a run that wrote, infinitive for a plan.
    verb, infinitive = (("repaired", "repair") if repairing
                        else ("stamped", "stamp"))
    errors = 0
    written = 0
    would = 0
    conflicts = 0
    vault_root = args.vault.resolve()
    warnings: list[str] = []
    link: Linker | None = None
    if needs_links(args):
        import vault_write as vw
        link = vault_linker(vw.Batch(args.vault), warnings.append)
    for rel in targets(args):
        path = (args.vault / rel).resolve()
        if not path.is_relative_to(vault_root):
            print(f"ERROR\t{rel}\tescapes the vault — refused")
            errors += 1
            continue
        if not path.is_file():
            print(f"ERROR\t{rel}\tfile not found")
            errors += 1
            continue
        # newline='' preserves the file's own line endings exactly.
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError) as e:
            print(f"ERROR\t{rel}\tunreadable ({e.__class__.__name__}) "
                  f"— not {verb}")
            errors += 1
            continue
        lines = text.splitlines(keepends=True)
        warnings.clear()
        actions, override, error = plan_file(rel, lines, args, link)
        for message in warnings:
            print(f"WARNING\t{rel}\t{message}")
        if error:
            print(f"ERROR\t{rel}\t{'; '.join(actions)}")
            errors += 1
            continue
        if repairing and not actions:
            # A sweep stays silent about the notes it had nothing to do
            # with; a file the GM named by hand deserves an answer.
            if sweeping:
                continue
            actions = ["no legacy key"]
        new_text = "".join(lines)
        changed = new_text != text
        if override == "CONFLICT":
            mode = "CONFLICT" if args.write else "WOULD-CONFLICT"
        elif not changed:
            mode = "UNCHANGED"
        elif repairing:
            mode = "REPAIRED" if args.write else "WOULD-REPAIR"
        else:
            mode = "STAMPED" if args.write else "WOULD-STAMP"
        print(f"{mode}\t{rel}\t{'; '.join(actions)}")
        if override == "CONFLICT":
            conflicts += 1
        if changed:
            would += 1
            if args.write:
                with path.open("w", encoding="utf-8", newline="") as f:
                    f.write(new_text)
                written += 1
    count = written if args.write else would
    trailer = verb if args.write else f"dry-run would {infinitive}"
    if repairing:
        print(f"# {trailer}: {count} files, {conflicts} conflicts, "
              f"{errors} errors")
    else:
        print(f"# {trailer}: {count} files, {errors} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

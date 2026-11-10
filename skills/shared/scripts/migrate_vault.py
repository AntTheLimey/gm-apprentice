#!/usr/bin/env python3
"""migrate_vault.py: the migration checks that read and write vault files
alone: templates, the schema mirror, and the small per-release fixes."""

from __future__ import annotations

import datetime
import hashlib
import json
import posixpath
import re
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import relink
import threads as th
import update_record
from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          edit_frontmatter, plugin_tool, write_text_atomic)
from schema_rules import system_id as _system_id
from schema_rules import TEMPLATE_NAMES
from template_compare import compare, summary
from vault_check import (WRAP_TYPES, shared_threads_tool_too_old,
                         wrapup_filename_findings)
from vaultlib import (WRAP_UP_TYPES, StateUnreadable, campaign_overview,
                      entity_type, extract_frontmatter, is_active_pc, out_of_play,
                      set_key, frontmatter_span,
                      parse_version, plugin_version,
                      read_held, read_stamp, settings,
                      vault_files, vault_layout,
                      wrapup_filename)

SHARED = Path(__file__).resolve().parent.parent
TEMPLATES = SHARED / "templates"
HISTORY = SHARED / "template-history.json"

STAT_BLOCK_RE = re.compile(r"^\{STAT BLOCK:.*?\}[ \t]*$", re.M | re.S)
GENERIC_BLOCK = "### Stats\n\n{System stat block.}"


def vault_system(vault: Path) -> str | None:
    """The vault's game system, aliases mapped to the file ids; None when
    the vault records none. A vault on the settings file records it in
    `vault.system` and nowhere else. For a vault with no settings file yet
    (the scaffold's and the midwife's first contact) the Campaign
    Overview's `game_system` is read, then the adventure brief's
    `system`."""
    found = _system_id(settings(vault).get("vault.system"))
    if found or vault_layout(vault) == "new":
        return found
    # The brief's type is written `adventure-brief`; older notes used `_`.
    for wanted, key in ((("campaign_overview",), "game_system"),
                        (("adventure-brief", "adventure_brief"), "system")):
        for _rel, text in vault_files(vault):
            fm = extract_frontmatter(text) or {}
            if entity_type(fm) in wanted and _system_id(fm.get(key)):
                return _system_id(fm.get(key))
    return None


def _stat_block(kind: str, system: str | None, source: Path) -> str:
    base = "coc-7e" if system == "coc-7e-regency" else system
    if not base:
        return GENERIC_BLOCK
    for folder in ((f"{kind}-stats", "npc-stats") if kind == "creature"
                   else ("npc-stats",)):
        path = source / folder / f"{base}.md"
        if path.is_file():
            lines = path.read_text(encoding="utf-8").strip().split("\n")
            kept = []
            for line in lines:
                if "**Reputation**" in line:
                    if system != "coc-7e-regency":
                        continue
                    line = re.sub(r"\s*<!--.*?-->", "", line).rstrip()
                kept.append(line)
            return "\n".join(kept)
    return GENERIC_BLOCK


def templates_for(system: str | None, source: Path = TEMPLATES,
                  skip_missing: bool = False) -> dict[str, str]:
    """What `_Templates/` holds for a vault of this system, built from the
    template folder `source`: vault filename -> text. `skip_missing` leaves
    out a template an older release's folder does not have."""
    def read(name: str) -> str | None:
        path = source / name
        if skip_missing and not path.is_file():
            return None
        return path.read_text(encoding="utf-8")

    out: dict[str, str] = {}
    for src, name in TEMPLATE_NAMES.items():
        text = read(src)
        if text is None:
            continue
        if src in ("npc.md", "creature.md"):
            block = _stat_block(src[:-3], system, source)
            text = STAT_BLOCK_RE.sub(lambda _m: block, text, count=1)
        out[name] = text
    pc = f"pc-{system}.md" if system and (source / f"pc-{system}.md").is_file() \
        else "pc-generic.md"
    text = read(pc)
    if text is not None:
        out[pc] = text
    if system == "fitd":
        text = read("crew-fitd.md")
        if text is not None:
            out["crew-fitd.md"] = text
    return out


def expected_templates(vault: Path) -> dict[str, str]:
    """What `_Templates/` should hold: vault filename -> text."""
    return templates_for(vault_system(vault))


def normalise(text: str) -> str:
    """The text with trailing blanks, CRLFs and runs of blank lines gone:
    a template a model copied by hand differs that way and no other."""
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(normalise(text).encode("utf-8")).hexdigest()


def _same(a: str, b: str) -> bool:
    return normalise(a) == normalise(b)


def _same_entry(a: str, b: str) -> bool:
    """Two mirror entries that differ only in where lines wrap are the same."""
    return " ".join(a.split()) == " ".join(b.split())


REGENCY_LINE_NOTE_RE = re.compile(r"[ \t]*<!--.*?-->")
COC_FAMILY = ("coc-7e", "coc-7e-regency")
# The template's own Reputation line, as the Regency build writes it.
REPUTATION_LINE_RE = re.compile(r"^\*\*Reputation\*\* \{", re.M)


def _without_setup_comment(text: str) -> str:
    """The text with the setup comment gone from its Reputation line, the
    form `npc-stats/coc-7e.md` holds before vault setup processes it."""
    return "\n".join(
        REGENCY_LINE_NOTE_RE.sub("", line) if "**Reputation**" in line
        else line for line in text.split("\n"))


def _regency_build(system: str | None, name: str, current: str) -> str | None:
    """The Regency Cthulhu build of a CoC stat-block template, when
    `current` is one: its Reputation stat line (processed or not) is the
    mark. The vault's stamped system does not decide it: a Regency campaign
    stamped plain `coc-7e` must not lose the line to an overwrite (#311)."""
    if system not in COC_FAMILY or not REPUTATION_LINE_RE.search(current):
        return None
    return templates_for("coc-7e-regency").get(name)


# A PC template named for Regency, as the plugin ships it (`pc-coc-7e-regency.md`)
# or as a vault holds it (`_Template_PC_CoC_7e_Regency.md`); not any note that
# has "regency" in its name.
REGENCY_PC_NAME_RE = re.compile(r"(?i)(?:^|[_-])pc[_-].*regency.*\.md$")


def _regency_pc_template(vault: Path) -> bool:
    folder = vault / "_Templates"
    try:
        return any(f.is_file() and REGENCY_PC_NAME_RE.search(f.name)
                   for f in folder.iterdir())
    except OSError:
        return False


GENERIC = "generic"   # the history's key for a vault with no known system


def _released_hashes(system: str | None) -> dict[str, dict[str, str | None]]:
    """template-history.json: system -> vault filename -> {hash: the last
    release that wrote it, or null}, for what releases wrote for that
    system (scripts/template_history.py drops the old ones). A system the history does not know gets
    the generic templates, so it is read as generic. Missing or unreadable,
    no template counts as released (all are choices)."""
    try:
        data = json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    found = data.get(system if system in data else GENERIC)
    return found if isinstance(found, dict) else {}


# A top-level frontmatter key the template leaves blank (`campaign: ""`, `tags: []`, `age:`, `play_date: null`,
# `chapter: "[[]]"`) is the vault's to fill in, and so is `campaign` whatever placeholder a template gives it: its value
# is not a difference from the plugin's text, and an overwrite keeps it (#366). The cost, taken knowingly: a later
# release that changes such a key's value can never clean an older default out of a vault's copy.
BLANK_VALUE_RE = re.compile(r"""^[ \t]*(?:""|''|\[\]|null|~|"\[\[\]\]")?[ \t]*(?:#.*)?$""")
FILL_IN_BY_NAME = frozenset({"campaign"})
TOP_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")


def _frontmatter_blocks(text: str) -> tuple[list[str], dict[str, tuple[int, int]]]:
    """The text's lines (endings kept) and, for each top-level frontmatter key,
    the span of lines its value takes: the key's line and the lines under it,
    less any blank or comment-only lines that end it. Empty when the text has
    no frontmatter, or one this cannot split safely (a line at the margin that
    is not a key, a list item or a comment; a key given twice)."""
    lines = text.splitlines(keepends=True)
    def bare(i: int) -> str:
        return lines[i].rstrip("\r\n")
    if not lines or bare(0).lstrip("\ufeff") != "---":
        return lines, {}
    end = next((i for i in range(1, len(lines)) if bare(i) == "---"), None)
    if end is None:
        return lines, {}
    blocks: dict[str, tuple[int, int]] = {}
    key, start = None, 1
    for i in range(1, end + 1):
        m = TOP_KEY_RE.match(bare(i)) if i < end else None
        if i < end and not m and bare(i)[:1] not in ("", " ", "\t", "#", "-"):
            return lines, {}
        if i == end or m:
            if key is not None:
                if key in blocks:
                    return lines, {}
                stop = i
                while stop > start + 1 and (not bare(stop - 1).strip()
                                            or bare(stop - 1).lstrip().startswith("#")):
                    stop -= 1
                blocks[key] = (start, stop)
            key, start = (m.group(1), i) if m else (None, i)
    return lines, blocks


def _fill_in_keys(template: str) -> set[str]:
    lines, blocks = _frontmatter_blocks(template)
    out = set()
    for key, (a, b) in blocks.items():
        m = TOP_KEY_RE.match(lines[a].rstrip("\r\n"))
        if key in FILL_IN_BY_NAME or (b - a == 1 and m and BLANK_VALUE_RE.match(m.group(2))):
            out.add(key)
    return out


def _with_values(target: str, source: str, keys: set[str]) -> str:
    """`target` with each of `keys` given the value `source` has for it, where
    both have the key; everything else in `target` is kept as it is."""
    t_lines, t_blocks = _frontmatter_blocks(target)
    s_lines, s_blocks = _frontmatter_blocks(source)
    newline = "\r\n" if "\r\n" in target else "\n"
    swaps = sorted(((t_blocks[k], s_blocks[k]) for k in keys
                    if k in t_blocks and k in s_blocks), reverse=True)
    for (a, b), (c, d) in swaps:
        taken = [line.rstrip("\r\n") + newline for line in s_lines[c:d]]
        t_lines[a:b] = taken
    return "".join(t_lines)


# A plain name for each template the plugin ships (by its file in
# skills/shared/templates/), for what the GM is told about it.
TEMPLATE_LABELS = {
    "campaign-overview.md": "Campaign Overview",
    "chapter.md": "Chapter",
    "character-story.md": "character story",
    "clue.md": "Clue",
    "creature.md": "Creature",
    "crew-fitd.md": "crew sheet",
    "document.md": "Document",
    "event.md": "Event",
    "faction.md": "Faction",
    "heritage.md": "Heritage",
    "image-guidance.md": "Image Guidance",
    "item.md": "Item",
    "location.md": "Location",
    "npc.md": "NPC",
    "organization.md": "Organization",
    "pc-coc-7e-regency.md": "Regency sheet",
    "pc-coc-7e.md": "Call of Cthulhu character sheet",
    "pc-dnd-5e-2024.md": "D&D character sheet",
    "pc-fitd.md": "Forged in the Dark character sheet",
    "pc-generic.md": "character sheet",
    "pc-gurps-4e.md": "GURPS character sheet",
    "pc-pf2e.md": "Pathfinder character sheet",
    "plan.md": "Plan",
    "prop.md": "Prop",
    "scene.md": "Scene",
    "session-plan.md": "Session Plan",
    "session-wrap.md": "Session Wrap-Up",
    "session.md": "Session",
    "world-domain.md": "World Domain",
    "world-flags.md": "world flags",
    "world-index.md": "world index",
}
_SHIPPED_NAME = {vault_name: src for src, vault_name in TEMPLATE_NAMES.items()}


def template_label(name: str) -> str:
    """The plain name of the template a vault holds as `_Templates/<name>`;
    the file name when it has none."""
    return TEMPLATE_LABELS.get(_SHIPPED_NAME.get(name, name), name)


DATALESS = 0x40000000   # macOS UF_DATALESS: iCloud holds the file, not the disk


def _unreadable_reason(path: Path) -> str:
    """Why a template that read as empty is a read problem: a shipped
    template is never empty."""
    try:
        st = path.stat()
    except OSError as e:
        return e.strerror or e.__class__.__name__
    if getattr(st, "st_flags", 0) & DATALESS:
        return "iCloud has not downloaded it to this computer"
    if st.st_size > 0:
        return (f"it read as empty, though it holds {st.st_size} "
                f"byte{'s' * (st.st_size != 1)}")
    return "it is empty"


def _unreadable(name: str, path: Path, reason: str) -> Item:
    return Item(f"template-unreadable:{name}", PERSON, [
        f"_Templates/{name} could not be read ({reason}); left as it is. "
        f'Fix: brctl download "{path}" (iCloud), or check its permissions, '
        f"then run the update again."])


def _empty_on_disk(name: str, what: str = "0 bytes on disk") -> Item:
    """A template that truly holds nothing: no download brings it back."""
    return Item(f"template-unreadable:{name}", PERSON, [
        f"_Templates/{name} is empty ({what}); left as it is. Fix: "
        f"restore it from a backup, or delete it so the update copies the "
        f"plugin's, then run the update again."])


def _is_empty_on_disk(path: Path) -> bool:
    try:
        st = path.stat()
    except OSError:
        return False
    return st.st_size == 0 and not getattr(st, "st_flags", 0) & DATALESS


def _release_of(released: dict[str, str | None] | list[str],
                hashes: set[str]) -> tuple[bool, str | None]:
    """(is any of `hashes` a released text, the last release that wrote it
    when the history names one)."""
    found = hashes & set(released)
    if not found:
        return False, None
    if isinstance(released, dict):
        named = sorted((v for h in found if isinstance(v := released.get(h), str)),
                       key=parse_version)
        return True, named[-1] if named else None
    return True, None


def _today() -> str:
    return datetime.date.today().isoformat()


def find_templates(vault: Path) -> list[Item]:
    """Each template is decided by rule, in order: missing, copied; not
    readable, said so and left alone; the plugin's text, nothing; an older
    release's text, unedited, updated; the GM's own, asked once (keep or
    take) and the answer remembered in the update record against both
    texts, so it is asked again only when one of them changes."""
    return _survey_templates(vault)[0]


def same_templates(vault: Path) -> dict[str, update_record.TemplateEntry]:
    """A record entry for each template that is the plugin's text, as it
    is now: what `gma update` writes at the end of a run that did work."""
    return _survey_templates(vault)[1]


def _survey_templates(vault: Path) -> tuple[
        list[Item], dict[str, update_record.TemplateEntry]]:
    """find_templates' items, and the entries of the templates found the
    same as the plugin's."""
    folder = vault / "_Templates"
    items: list[Item] = []
    system = vault_system(vault)
    released = _released_hashes(system)
    regency_released = _released_hashes("coc-7e-regency")
    regency_pc = _regency_pc_template(vault)
    record = update_record.load(vault)
    found_plugin = plugin_version()
    version = found_plugin[0] if found_plugin else "unknown"
    try:
        stamp = read_stamp(vault)
    except StateUnreadable:   # the gate reports it
        stamp = None
    behind = stamp is not None and version != "unknown" \
        and parse_version(stamp) < parse_version(version)
    same: dict[str, update_record.TemplateEntry] = {}
    try:   # "leave" answers an older update kept before the record existed
        held_left = read_held(vault)["left"]
    except (StateUnreadable, OSError):
        held_left = set()

    def entry(name: str, file_text: str, shipped: str, why: str,
              state: Literal["plugin", "gms"] = "plugin",
              matches: str | None = version,
              decision: Literal["keep", "take"] | None = None
              ) -> update_record.TemplateEntry:
        return {"state": state, "matches": matches,
                "decision": decision, "file_sha": text_hash(file_text),
                "shipped_sha": text_hash(shipped), "plugin": version,
                "on": _today(), "why": why}

    def remember(*entries: tuple[str, update_record.TemplateEntry]) -> None:
        # The templates found the same as the plugin's ride along with any
        # write; a run that changes nothing writes nothing.
        update_record.record_templates(vault, dict(entries), refresh=same)

    for name, text in expected_templates(vault).items():
        path = folder / name
        label = template_label(name)
        current = ""
        if path.is_file():
            try:
                current = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                items.append(_unreadable(name, path, "it is not UTF-8 text"))
                continue
            except OSError as e:
                items.append(_unreadable(
                    name, path, e.strerror or e.__class__.__name__))
                continue
            if not current:
                items.append(_empty_on_disk(name) if _is_empty_on_disk(path)
                             else _unreadable(name, path, _unreadable_reason(path)))
                continue
            if not current.strip():
                items.append(_empty_on_disk(name, "only blank lines"))
                continue
            regency = _regency_build(system, name, current)
            if regency is not None:
                text = regency
        elif regency_pc and system == "coc-7e" and name.startswith("pc-"):
            continue   # the Regency PC template is the one in use

        filled = _fill_in_keys(text)
        mine = current if path.is_file() else text
        written = _with_values(text, mine, filled)

        if not path.is_file():
            def copy(_value: str | None, path: Path = path, text: str = text,
                     written: str = written, name: str = name) -> list[str]:
                write_text_atomic(path, written)
                remember((name, entry(name, written, text,
                                      f"The vault had no copy, so the plugin's "
                                      f"{version} text was copied in.")))
                return [f"Added the missing {template_label(name)} template."]

            items.append(Item(f"template:{name}", WILL,
                              [f"copy the missing template _Templates/{name}"],
                              copy))
            continue
        # What releases wrote for a Regency build is the Regency list,
        # whatever system the vault is stamped (#355).
        regency_build = _regency_build(system, name, current) is not None
        shown = _with_values(
            _without_setup_comment(current) if regency_build else current,
            text, filled)
        if _same(shown, text):
            same[name] = entry(name, current, text,
                               f"It is the plugin's {version} text.")
            continue
        known = record["templates"].get(name)
        if isinstance(known, dict) and known.get("decision") == "keep" \
                and known.get("file_sha") == text_hash(current) \
                and known.get("shipped_sha") == text_hash(text):
            if behind:
                on = known.get("on") or "earlier"

                def kept(_value: str | None, label: str = label,
                         on: str = str(on)) -> list[str]:
                    return [f"Kept your {label} template (decided {on})."]

                items.append(Item(
                    f"template-kept:{name}", WILL,
                    [f"keep your {label} template (decided {on})"], kept))
            continue
        is_old, release = _release_of(
            (regency_released if regency_build else released).get(name, []),
            {text_hash(current), text_hash(_with_values(current, text, filled))})
        if is_old:
            was = release or "an earlier release"

            def update(_value: str | None, path: Path = path, text: str = text,
                       written: str = written, name: str = name,
                       label: str = label, was: str = was) -> list[str]:
                write_text_atomic(path, written)
                remember((name, entry(name, written, text,
                                      f"It was {was}'s text, unedited, so it "
                                      f"was updated to {version}.")))
                return [f"Updated the {label} template to {version} "
                        f"(it was {was}'s text, unedited)."]

            items.append(Item(
                f"template:{name}", WILL,
                [f"update the {label} template to {version} "
                 f"(it is {was}'s text, unedited)"], update))
            continue
        if known is None and f"template:{name}" in held_left:
            # An older update's "leave" is a keep; the record takes it over
            # on apply (plan writes nothing).
            def adopt(_value: str | None, name: str = name, text: str = text,
                      label: str = label, current: str = current) -> list[str]:
                remember((name, entry(
                    name, current, text,
                    f"The GM chose to keep their own {label} template "
                    f"(answered leave in an earlier update).",
                    state="gms", matches=None, decision="keep")))
                return [f"Kept your {label} template (you answered before)."]

            items.append(Item(
                f"template-kept:{name}", WILL,
                [f"keep your {label} template (you answered before)"], adopt))
            continue
        comparison = compare(shown, text)

        def choose(value: str | None, path: Path = path, text: str = text,
                   written: str = written, name: str = name,
                   label: str = label, current: str = current) -> list[str]:
            if value in ("keep", "leave"):
                # "leave" is a keep too: never the same question twice.
                remember((name, entry(
                    name, current, text,
                    f"The GM chose to keep their own {label} template.",
                    state="gms", matches=None, decision="keep")))
                return [f"Kept your {label} template."]
            if value == "take":
                write_text_atomic(path, written)
                remember((name, entry(
                    name, written, text,
                    f"The GM chose the plugin's {version} {label} template.",
                    decision="take")))
                return [f"Took the plugin's {label} template."]
            raise StepFailed(f"template:{name} takes keep or take")

        items.append(Item(
            f"template:{name}", CHOICE,
            [f"Your {label} template differs from every release of the "
             f"plugin's. Keep yours, or take the plugin's?"],
            choose, wants="keep or take",
            detail={"file": f"_Templates/{name}", "label": label,
                    # What the GM is shown: an answer names it (gma update).
                    "texts_sha": hashlib.sha256(
                        (current + "\0" + text).encode("utf-8")).hexdigest(),
                    "comparison": comparison.as_dict(),
                    "summary": summary(comparison)}))
    return items, same


def _read(path: Path) -> str:
    """The file's text with its own line endings kept."""
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            return f.read()
    except (OSError, UnicodeDecodeError) as e:
        raise StepFailed(f"{path.parent.name}/{path.name} cannot be read "
                         f"({e.__class__.__name__})") from e


# --- schema mirror ------------------------------------------------------------

SECTION = "## Type-Specific Fields"
ENTRY_RE = re.compile(r"^\*\*([^*:\n]+):\*\*")


def _section_span(text: str) -> tuple[int, int] | None:
    start = re.search(rf"^{re.escape(SECTION)}[ \t]*\r?$", text, re.M)
    if not start:
        return None
    nxt = re.search(r"^## ", text[start.end():], re.M)
    return start.end(), start.end() + nxt.start() if nxt else len(text)


def _ends_entry(line: str) -> bool:
    """A line that is not a continuation of the entry above it."""
    bare = line.strip()
    return (not bare or bare == "---" or bare.startswith(("<!--", "#"))
            or bool(ENTRY_RE.match(bare)))


def _entry_spans(text: str) -> dict[str, tuple[int, int]]:
    """Type -> (start, end) offsets in `text` of each `**Type:** …` entry
    under `## Type-Specific Fields`: the entry line and its continuation
    lines, ending before the blank line, comment, rule or heading that
    follows. The end excludes the last line's line ending."""
    span = _section_span(text)
    if span is None:
        return {}
    out: dict[str, tuple[int, int]] = {}
    current: tuple[str, int, int] | None = None
    for m in re.finditer(r"[^\n]*\n|[^\n]+", text[span[0]:span[1]]):
        raw = m.group(0)
        line = raw.rstrip("\r\n")
        at = span[0] + m.start()
        entry = ENTRY_RE.match(line)
        if entry or (current and _ends_entry(line)):
            if current:
                out[current[0]] = (current[1], current[2])
            current = None
        if entry:
            current = (entry.group(1).strip(), at, at + len(line))
        elif current:
            current = (current[0], current[1], at + len(line))
    if current:
        out[current[0]] = (current[1], current[2])
    return out


def type_entries(text: str) -> dict[str, str]:
    """`**Type:** …` entries under `## Type-Specific Fields`, by type."""
    return {n: text[a:b] for n, (a, b) in _entry_spans(text).items()}


def find_schema_mirror(vault: Path) -> list[Item]:
    """Every pass: the vault's copy of the type fields matches the plugin's
    for every built-in type. Entries only the vault has are left alone."""
    path = vault / "_meta" / "entity-types.md"
    if not path.is_file():
        return []
    canonical = type_entries(
        (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
    text = _read(path)
    mine = type_entries(text)
    if _section_span(text) is None:
        return []
    stale = [n for n in canonical if n in mine and not _same_entry(mine[n], canonical[n])]
    missing = [n for n in canonical if n not in mine]
    if not stale and not missing:
        return []

    def apply(_value: str | None) -> list[str]:
        new = _read(path)
        eol = "\r\n" if "\r\n" in new else "\n"

        def fit(name: str) -> str:
            return canonical[name].replace("\n", eol)

        for name in stale:
            a, b = _entry_spans(new)[name]
            new = new[:a] + fit(name) + new[b:]
        order = list(canonical)
        for name in missing:
            have = _entry_spans(new)
            before = next((p for p in reversed(order[:order.index(name)])
                           if p in have), None)
            if before is not None:
                at = have[before][1]
                new = f"{new[:at]}{eol}{eol}{fit(name)}{new[at:]}"
            else:
                span = _section_span(new)
                assert span is not None
                rest = new[span[0]:].lstrip("\r\n")
                tail = f"{eol}{eol}{rest}" if rest else eol
                new = f"{new[:span[0]]}{eol}{eol}{fit(name)}{tail}"
        write_text_atomic(path, new)
        return ([f"updated the {n} entry" for n in stale]
                + [f"added the {n} entry" for n in missing])

    lines = ([f"update the {n} entry in _meta/entity-types.md (your edits "
              f"inside that entry are replaced)" for n in stale]
             + [f"add the {n} entry to _meta/entity-types.md" for n in missing])
    return [Item("schema-mirror", CHOICE, lines, apply)]


def _words(vault: Path | None) -> dict | None:
    """The publish tool's `relationships words --json` (for `vault`, the
    vault's own list), or None when it could not answer: no node, no tool,
    a failure, or an answer that is not what it should be."""
    args = ["relationships", "words", "--json"]
    if vault is not None:
        args += ["--vault", str(vault)]
    try:
        code, out, _err = plugin_tool(args)
    except StepFailed:
        return None
    if code != 0:
        return None
    try:
        data = json.loads(out)
    except ValueError:
        return None
    if (not isinstance(data, dict)
            or not isinstance(data.get("predicates"), list)
            or not all(isinstance(p, dict) and isinstance(p.get("type"), str)
                       for p in data["predicates"])):
        return None
    return data


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _table_cells(line: str) -> list[str]:
    body = line.rstrip("\r\n").strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return body.split("|")


# --- small per-release checks -------------------------------------------------

def _wrapup_target(rel: str, text: str) -> str | None:
    """Chapter_CC_Session_NN_Wrap_Up.md beside the note, or None."""
    name = wrapup_filename(rel, extract_frontmatter(text) or {})
    return posixpath.join(posixpath.dirname(rel), name) if name else None


def _relink_items(vault: Path, item_id: str, verb: str,
                  moves: list[tuple[str, str | None, str]]) -> list[Item]:
    """One choice for every move relink accepts, and one person row for
    each it cannot make. `moves` is (from, to or None, why-if-None). A move
    with a link that could mean either of two notes (or an alias that the
    new name would capture) is for a person: a rename must not settle it."""
    ok: list[tuple[str, str, int]] = []
    person: list[str] = []
    taken: set[str] = set()
    for src, dst, why in moves:
        if dst is not None and relink.name_key(dst) in taken:
            dst, why = None, f"another note would also become {dst}"
        if dst is not None:
            try:
                plan = relink.plan(vault, src, dst)
            except relink.ToolTooOld:
                dst, why = None, ("the site's publish tool is older than this "
                                  "needs; update it (the repin step), then "
                                  "run the plan again")
            except relink.RelinkError as e:
                dst, why = None, str(e)
            else:
                alias = plan.alias_warnings
                if plan.unsure or alias:
                    dst = None
                    why = (f"{len(plan.unsure)} link(s) could mean either "
                           f"note; settle them first, then rename"
                           if plan.unsure else alias[0])
                else:
                    taken.add(relink.name_key(dst))
                    ok.append((src, dst, len(plan.changes)))
                    continue
        person.append(f"{src}\t{why}")

    def apply(_value: str | None) -> list[str]:
        done = []
        for src, dst, shown in ok:
            # Planned again against the vault as the earlier moves left it:
            # what the GM was shown is what is done, and nothing is claimed
            # that was not.
            try:
                fresh = relink.plan(vault, src, dst)
            except relink.RelinkError as e:
                raise StepFailed(f"{src}: {e}") from e
            if fresh.unsure or len(fresh.changes) != shown:
                raise StepFailed(
                    f"{src}: the links it would change are no longer the "
                    f"ones shown ({'some could now mean either note' if fresh.unsure else 'the count changed'}); "
                    f"nothing more was renamed, run the migration again")
            try:
                relink.apply(fresh)
            except relink.RelinkError as e:
                raise StepFailed(f"{src}: {e}") from e
            done.append(f"{verb}d {src} to {dst}")
        return done

    items = []
    if ok:
        items.append(Item(item_id, CHOICE,
                          [f"{verb} {s} to {d} and update {n} link(s) to it"
                           for s, d, n in ok], apply))
    if person:
        items.append(Item(item_id, PERSON, person))
    return items


def find_wrapup_filenames(vault: Path) -> list[Item]:
    """Every pass: an old-pattern Wrap-Up filename, renamed with every link
    to it on a yes. A name that cannot be worked out, or is taken, is
    left for a person."""
    moves: list[tuple[str, str | None, str]] = []
    for rel, text in vault_files(vault):
        if entity_type(extract_frontmatter(text) or {}) not in WRAP_TYPES:
            continue
        if not any(f.level == "WARNING" for f in wrapup_filename_findings(rel)):
            continue
        moves.append((rel, _wrapup_target(rel, text),
                      "old Wrap-Up filename; its chapter or session number "
                      "cannot be read from the note, so the new name is "
                      "unknown"))
    return _relink_items(vault, "wrapup-filenames", "rename", moves)


AGENT_BLOCK_UNREADABLE = "agent-block-unreadable:"
AGENT_BLOCK_BROKE = "\x00unreadable:"   # an apply line the update files as Could not read


def find_skeleton(vault: Path) -> list[Item]:
    """Every pass: the folders and `_meta/` schema files a vault's skeleton
    lacks, as vault_scaffold.py defines it. Only adds, and a file that
    exists is never touched. `_Templates/` files are the `templates`
    check's. The one-off pages are not added here: they can publish. The
    Timeline is `find_timeline_page`'s; the others are never added."""
    import vault_scaffold as vs    # it imports this module

    found = plugin_version()
    try:
        pieces = [p for p in vs.missing(
            vault, vault_system(vault), campaign=vault.resolve().name,
            version=found[0] if found else "", templates=False,
            pages=False)
            if p.rel not in vs.NEW_FILES]
    except vs.ScaffoldError as e:
        raise StepFailed(str(e)) from e
    if not pieces:
        return []

    def apply(_value: str | None) -> list[str]:
        try:
            vs.build(vault, pieces)
        except vs.ScaffoldError as e:
            raise StepFailed(str(e)) from e
        return [f"created {vs.shown(p)}" for p in pieces]

    return [Item("skeleton", WILL,
                 [f"create {vs.shown(p)}" for p in pieces], apply)]


def find_agent_block(vault: Path) -> list[Item]:
    """Every pass: the plugin's block in the vault's CLAUDE.md (and
    AGENTS.md, if it has one), as agent_block.py writes it. Only the text
    between its markers changes; a file whose BEGIN marker has no END is
    left as it is and said."""
    import agent_block

    changes, problems = agent_block.plan(vault)
    items = [Item(f"{AGENT_BLOCK_UNREADABLE}{n}", PERSON, [line])
             for n, line in enumerate(problems)]
    if changes:
        def apply(_value: str | None) -> list[str]:
            # Planned again: a file may have changed since the find. One
            # that broke since is said here, as the find would have.
            fresh, broke = agent_block.plan(vault)
            # Only files that broke since the find are new; the find
            # already said the rest. The prefix routes them to Could not
            # read in the update.
            return agent_block.write(vault, fresh) + [
                AGENT_BLOCK_BROKE + line for line in broke
                if line not in problems]
        items.append(Item("agent-block", WILL,
                          [f"write the plugin's block in {c.rel}"
                           for c in changes], apply))
    return items


def find_timeline_page(vault: Path) -> list[Item]:
    """Every pass: the Timeline page, for a vault with no page of
    `type: timeline`. `vault_write.py timeline` needs one to write to. The
    page starts empty, and a site's publish tool before 1.12.4 sends Events
    to an empty Timeline, so this waits for the repin."""
    import vault_scaffold as vs    # it imports this module

    found = plugin_version()
    try:
        pieces = [p for p in vs.missing(
            vault, vault_system(vault), campaign=vault.resolve().name,
            version=found[0] if found else "", templates=False)
            if p.rel == vs.TIMELINE]
    except vs.ScaffoldError as e:
        raise StepFailed(str(e)) from e
    if not pieces:
        return []

    def apply(_value: str | None) -> list[str]:
        try:
            vs.build(vault, pieces)
        except vs.ScaffoldError as e:
            raise StepFailed(str(e)) from e
        return [f"created {vs.TIMELINE}"]

    return [Item("timeline-page", WILL,
                 [f"create {vs.TIMELINE} (empty, for session timeline "
                  f"entries)"], apply)]


# --- the tone list in _meta ---------------------------------------------------


# --- per-session open threads in PC Current Status ---------------------------


# --- retired scene/session keys -----------------------------------------------


def _frontmatter_lines(text: str) -> list[str] | None:
    """The frontmatter lines of a note read with its line endings, or None
    when it has none that can be edited line by line."""
    lines = text.removeprefix("\ufeff").splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    return None if error else lines[1:end]


def _notes_with(vault: Path, drop: Callable[[list[str], str], bool]
                ) -> list[str]:
    """The notes `drop(frontmatter, rel)` says hold something to remove.
    `_Templates/` is never walked: the `templates` check refreshes it."""
    found = []
    for rel, text in vault_files(vault, newline=""):
        fm = _frontmatter_lines(text)
        if fm is not None and drop(fm, rel):
            found.append(rel)
    return found


def _fm_type(fm: list[str]) -> str:
    return entity_type(extract_frontmatter("".join(["---\n", *fm, "---\n"]))
                       or {})


# --- lastUpdated: "null" -------------------------------------------------------

# The quoted string null the old `vw story` wrote from a Wrap-Up still at
# `play_date: null`. A bare `null` is YAML's own no-value and stays. The key
# is matched as written (YAML keys are case-sensitive); the value in any case.
NULL_DATE_RE = re.compile(r"""^lastUpdated:[ \t]*(["'])(?i:null)\1[ \t]*(#.*)?$""")


def _null_date(fm: list[str], rel: str) -> bool:
    """A `lastUpdated: "null"` on a `*_Story.md` companion or an NPC note."""
    if not (rel.endswith("_Story.md") or _fm_type(fm) == "npc"):
        return False
    return any(NULL_DATE_RE.match(line.rstrip("\r\n")) for line in fm)


def find_null_last_updated(vault: Path) -> list[Item]:
    """1.11.2: `vw story` (and the first `npc-story`) wrote the text
    `"null"` as a date when the Wrap-Up had no play date. The value is
    cleared to `""`, which every reader takes as no date."""
    found = _notes_with(vault, _null_date)
    if not found:
        return []

    def apply(_value: str | None) -> list[str]:
        done = []
        for rel in found:
            def change(fm: list[str], eol: str, rel: str = rel) -> None:
                if _null_date(fm, rel):
                    note = next(m.group(2) for line in fm
                                if (m := NULL_DATE_RE.match(line.rstrip("\r\n"))))
                    # Keep a trailing comment: `lastUpdated: ""  # old`.
                    set_key(fm, "lastUpdated",
                            '""' + (f"  {note}" if note else ""), eol)
            edit_frontmatter(vault / rel, change)
            done.append(f'cleared lastUpdated: "null" in {rel}')
        return done

    return [Item("null-last-updated", WILL,
                 [f'clear lastUpdated: "null" in {rel}' for rel in found],
                 apply)]


# --- the `publish` row of the schema table -----------------------------------

# 1.11.3: the stock schema table in `_meta/entity-types.md` once wrote the
# `publish` row's values as `false` \| `stub`. The table check rejects an
# escaped pipe in a cell. Only the second cell is matched, so any wording of
# the rest of the row (and a row the GM changed) is untouched.
PUBLISH_ROW_RE = re.compile(
    r"^(\|[ \t]*`publish`[ \t]*\|[ \t]*)`false` \\\| `stub`([ \t]*\|)",
    re.MULTILINE)
PUBLISH_ROW_FIXED = r"\1`false` or `stub`\2"
ENTITY_TYPES_REL = "_meta/entity-types.md"


def find_publish_row_pipe(vault: Path) -> list[Item]:
    """1.11.3: the `publish` row of `_meta/entity-types.md` holding
    `false` \\| `stub` as its values gets `false` or `stub`. Nothing else in
    the file changes; line endings are kept."""
    path = vault / ENTITY_TYPES_REL
    if not path.is_file() or not PUBLISH_ROW_RE.search(_read(path)):
        return []

    def apply(_value: str | None) -> list[str]:
        text = _read(path)
        new = PUBLISH_ROW_RE.sub(PUBLISH_ROW_FIXED, text)
        if new == text:
            return []
        write_text_atomic(path, new)
        return [f"{ENTITY_TYPES_REL}: publish row now reads `false` or `stub`"]

    return [Item("publish-row-pipe", WILL,
                 [f"{ENTITY_TYPES_REL}: write the publish row's values as "
                  f"`false` or `stub`, so the table check passes"], apply)]


# --- shared threads ------------------------------------------------------------

# 1.12.3: before the shared list, a thread several PCs shared was written
# word for word on each PC's Open threads. It moves to the Campaign
# Overview's `## Open Threads` once, naming those PCs; a bullet struck
# through whole is closed into the latest Wrap-Up. The editing is
# threads.py's, as `vw threads` uses it.
STRUCK_EVIDENCE = "struck through before the update"
NO_OVERVIEW = "no Campaign Overview to hold shared threads"
def _struck(bullet: str) -> str | None:
    """The text of a bullet struck through whole (`~~text~~`), else None."""
    b = bullet.strip()
    inner = b[2:-2]
    if len(b) > 4 and b[:2] == b[-2:] == "~~" and "~~" not in inner:
        return inner.strip()
    return None


def _shared_threads_plan(vault: Path) -> tuple[
        dict[str, str], list[tuple[str, str]], list[str]]:
    """(new text by note, (verb, what) per change, person rows): every edit
    worked out in memory, so a move or close that cannot be made is a
    person row before anything is written."""
    import session_context as sc

    files = list(sc.vault_files(vault))
    gone = out_of_play(vault)
    pcs = [rel for rel, _t, fm in files if is_active_pc(rel, fm, gone)]
    overview = campaign_overview((rel, fm) for rel, _t, fm in files)
    wraps = sorted((sc.campaign_order(rel, fm), rel) for rel, _t, fm in files
                   if entity_type(fm) in WRAP_UP_TYPES)
    wrapup = wraps[-1][1] if wraps else None

    texts: dict[str, str] = {}

    def text(rel: str) -> str:
        if rel not in texts:
            texts[rel] = _read(vault / rel)
        return texts[rel]

    # A thread is its whole bullet, wrapped lines and nested bullets
    # included; a template placeholder is none (see th.pc_thread_items).
    # One in or next to hidden text is never touched: one wholly hidden
    # is the GM's secret and is passed over; one that would otherwise
    # move or close is left with a notice. A group with any hidden copy
    # stays whole: moving the others would show its words to players.
    # Copies are grouped by their words on one line, whitespace collapsed
    # (the text the shared entry gets), so a wrap variant joins its group.
    holders: dict[str, list[tuple[str, th.PcThread]]] = {}
    struck: list[tuple[str, th.PcThread, str]] = []
    lines: list[tuple[str, str]] = []
    left: list[str] = []

    def near_hidden(rel: str, item: th.PcThread) -> None:
        if not item.fenced:
            left.append(f'{rel}\t"{th.lead(item.text)}" on '
                        f"{Path(rel).stem} left on the sheet: it sits "
                        f"next to hidden text")

    for rel in pcs:
        for item in th.pc_thread_items(text(rel)):
            if item.keep is not None:
                # Inline text on the label line is one GM's prose, not a
                # list item: never judged word for word, never moved or
                # closed here (`vw threads` may take it when asked).
                continue
            inner = _struck(item.text)
            if inner is not None:
                if item.hidden:
                    near_hidden(rel, item)
                else:
                    struck.append((rel, item, inner))
            else:
                holders.setdefault(" ".join(item.text.split()),
                                   []).append((rel, item))

    drop: dict[str, list[th.PcThread]] = {}
    # A hidden shared entry shares nothing with players: a group matching
    # only one is not shared, and is left with a notice.
    entries = th.shared_threads(text(overview)) if overview else []
    shared = {" ".join(t.text.split()) for t in entries if not t.hidden}
    hidden_shared = {" ".join(t.text.split()) for t in entries if t.hidden}
    # `since` reads the current chapter's Wrap-Ups, as `--threads` does;
    # with no current chapter there is no since.
    current, _notes = sc.select_session(files, None)
    chapter = current["chapter"] if current else None
    wrap_ups = sc.wrap_up_threads(files, chapter) if chapter else []
    def stems_of(rels: list[str]) -> str:
        stems = [Path(rel).stem for rel in rels]
        return (" and ".join(stems) if len(stems) < 3
                else ", ".join(stems[:-1]) + " and " + stems[-1])

    for where in holders.values():
        rels = sorted({rel for rel, _t in where})
        thread = where[0][1].text
        name = th.lead(thread)
        # A copy of a thread already shared word for word is a duplicate:
        # it goes, one copy or several.
        flat = " ".join(thread.split())
        already = flat in shared
        if len(rels) < 2 and not already:
            continue
        if not already and flat in hidden_shared:
            left.append(f"{name}\tleft on {stems_of(rels)}: a hidden copy "
                        f"is in the Overview's Open Threads")
            continue
        if any(item.hidden for _r, item in where):
            for rel, item in where:
                if item.hidden:
                    near_hidden(rel, item)
            public = sorted({rel for rel, item in where if not item.hidden})
            if public:
                hidden = sorted({rel for rel, item in where if item.hidden})
                left.append(
                    f"{name}\tleft on {stems_of(public)} as well: the copy "
                    f"on {stems_of(hidden)} is in or next to hidden text, "
                    f"so none moved")
            continue
        if already and overview is not None:
            # The entry comes to involve every holder (a party one stays).
            texts[overview] = th.widen_shared(
                text(overview), thread, [Path(rel).stem for rel in rels])
            for rel, item in where:
                drop.setdefault(rel, []).append(item)
            lines.append(("move", f'"{name}" from {stems_of(rels)}: already '
                          f"in the Campaign Overview's Open Threads"))
            continue
        if overview is None:
            left.append(f"{name}\t{NO_OVERVIEW}; left on each PC's sheet")
            continue
        hits, mark = sc.match_sessions(thread, wrap_ups)
        since = f"Session {min(hits)}" if hits and mark == "=" else None
        stems = [Path(rel).stem for rel in rels]
        try:
            texts[overview] = th.insert_shared(
                text(overview), th.format_shared(thread, since, stems))
        except ValueError:
            left.append(f"{name}\tleft on each PC's sheet: the Campaign "
                        f"Overview has no place outside a GM-only fence for "
                        f"Open Threads")
            continue
        for rel, item in where:
            drop.setdefault(rel, []).append(item)
        lines.append(("move", f'"{name}" from {" and ".join(stems)} to the '
                      f"Campaign Overview's Open Threads"
                      + (f" (since {since})" if since else "")))
    for rel, item, inner in struck:
        name = th.lead(inner)
        if wrapup is None:
            left.append(f'{rel}\tstruck-through thread "{name}" left on '
                        f"the sheet: no Wrap-Up to record it in")
            continue
        try:
            texts[wrapup] = th.append_resolved(
                text(wrapup), th.format_resolved(
                    inner, STRUCK_EVIDENCE, Path(rel).stem))
        except KeyError:
            left.append(f'{rel}\tstruck-through thread "{name}" left on '
                        f"the sheet: the latest Wrap-Up ({wrapup}) has no "
                        f"What Carries Forward to record it in")
            continue
        drop.setdefault(rel, []).append(item)
        lines.append(("close", f'"{name}" (struck through) on '
                      f"{Path(rel).stem} into {wrapup}'s Resolved Threads"))
    for rel, items in drop.items():
        for item in sorted(items, key=lambda t: t.start, reverse=True):
            texts[rel] = th.remove_pc_thread(texts[rel], item)
    changed = {rel: t for rel, t in texts.items()
               if t != _read(vault / rel)}
    return changed, lines, left


def find_shared_threads(vault: Path) -> list[Item]:
    """1.12.3: a thread written word for word on two or more active PCs'
    Open threads moves to the Campaign Overview's Open Threads once, with
    those PCs as `involves` and its first-seen session as `since` when a
    Wrap-Up of the current chapter matches it closely; a PC's word-for-word
    copy of a thread already there just comes off. A thread is the
    whole bullet (see `threads.pc_thread_items`); one in or next to
    hidden text is never touched. A bullet struck through whole is closed
    into the latest Wrap-Up's Resolved Threads. One that cannot be moved
    or closed stays where it is, and the GM is told (and, for a group held
    back by a hidden copy, which public copies stayed). While the site's
    publish tool is too old to show a moved thread on PC pages, nothing
    moves and the stamp waits."""
    old_tool = shared_threads_tool_too_old(vault)
    if old_tool is not None:
        site, why = old_tool
        return [Item("shared-threads-wait", PERSON,
                     [f"{site.as_posix()}\t{why}"], holds_stamp=True)]
    changed, lines, left = _shared_threads_plan(vault)
    items = []
    if changed:
        def apply(_value: str | None) -> list[str]:
            # Worked out again: a note may have changed since the find.
            fresh, done, _left = _shared_threads_plan(vault)
            for rel, text in fresh.items():
                write_text_atomic(vault / rel, text)
            return [f"{verb}d {what}" for verb, what in done]
        items.append(Item("shared-threads", WILL,
                          [f"{verb} {what}" for verb, what in lines], apply))
    if left:
        items.append(Item("shared-threads-left", PERSON, left, notice=True))
    return items


# --- D&D PC Background sections -----------------------------------------------

FACTS_LINE = " \u00b7 ".join(f"**{label}:** \u2014" for label in (
    "Age", "Height", "Weight", "Eyes", "Hair", "Skin", "Faith"))


# --- The wrap-up's Source callout -------------------------------------------

GM_OPEN, GM_CLOSE = "<!-- gm-only -->", "<!-- /gm-only -->"


VAULT_CHECKS: list[Check] = [
    Check("skeleton", None, 3, "the vault skeleton", find_skeleton,
          kind="bookkeeping",
          plain=("Added the folders and setup files your vault was missing; nothing already there was touched.")),
    Check("agent-block", None, 3, "the plugin's block in CLAUDE.md",
          find_agent_block,
          kind="bookkeeping",
          plain=("Wrote the plugin's short instructions for the vault's agent into its CLAUDE.md; nothing outside the block's markers was touched.")),
    Check("templates", None, 3, "templates", find_templates,
          choices=("template:=",),
          kind="bookkeeping",
          plain=("Brought your note templates up to date with the plugin's."),
          ask=("Replaces your template with the plugin's, keeping the values you filled in, so new notes follow the plugin's layout."),
          left=("Kept your own version of the template.")),
    Check("schema-mirror", None, 3, "the schema mirror", find_schema_mirror,
          choices=("schema-mirror",),
          kind="removes",
          plain=("Brought the vault's own copy of the built-in note types up to the plugin's."),
          ask=("Replaces the vault's copy of the built-in note types with the plugin's, so the skills read the same fields you do; your own changes inside those entries go."),
          left=("Kept your own version of the built-in note types.")),
    # An empty Timeline changes what an older publish tool shows, so it waits
    # for the repin: band 4, asks_site.
    Check("timeline-page", None, 4, "the Timeline page", find_timeline_page,
          asks_site=True,
          kind="bookkeeping",
          plain=("Created an empty Timeline page for session events to be written to.")),
    # A rename asks the site's publish tool (what it changes on the site), so
    # it waits for the repin: band 4, asks_site.
    Check("wrapup-filenames", None, 4, "Wrap-Up filenames",
          find_wrapup_filenames, asks_site=True,
          choices=("wrapup-filenames",),
          kind="bookkeeping",
          plain=("Renamed wrap-up notes to the current naming pattern and updated every link to them.")),
    Check("null-last-updated", "1.11.2", 3,
          'lastUpdated: "null" in story and NPC notes', find_null_last_updated,
          kind="bookkeeping",
          plain=("Cleared a last-updated date that read \"null\" on character story and NPC notes, left there when a wrap-up had no play date yet.")),
    Check("publish-row-pipe", "1.11.3", 3,
          "the publish row of the schema table", find_publish_row_pipe,
          kind="bookkeeping",
          plain=("Fixed the publish row of the schema table in _meta/entity-types.md so the table check no longer reports an error there; nothing else in the file was touched.")),
    # A moved thread shows on PC pages only from publish tool 1.70.3, so it
    # waits for the repin: band 4, asks_site.
    Check("shared-threads", "1.12.3", 4, "shared threads", find_shared_threads,
          asks_site=True, kind="bookkeeping",
          plain="Moved threads that sat word for word on several PC sheets into the Campaign Overview's Open Threads, once each with the PCs they involve (copies of one already there came off); struck-through threads went to the latest Wrap-Up's Resolved Threads."),
]

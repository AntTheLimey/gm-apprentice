#!/usr/bin/env python3
"""migrate_vault.py: the migration checks that read and write vault files
alone: templates, the schema mirror, and the small per-release fixes."""

from __future__ import annotations

import bisect
import datetime
import hashlib
import json
import posixpath
import re
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import relink
import update_record
from dnd_note import PLACEHOLDER
from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          cells, edit_frontmatter, plugin_tool, stopped,
                          write_text_atomic)
from schema_rules import system_id as _system_id
from schema_rules import STAGE_HIDES, TEMPLATE_NAMES
from schema_rules import tone_families, without_generated_markers
from template_compare import compare, summary
from vault_check import (RECONSTRUCTION_NOTE_RE, WRAP_TYPES, WrapDetail, check_wrapup,
                         configured_site, semver_below,
                         site_pin, wrapup_filename_findings)
from vaultlib import (SKIP_DIRS, StateUnreadable, entity_type, extract_frontmatter,
                      delete_key, set_key, fence_step, frontmatter_span, opens_a_block,
                      parse_version, plugin_version,
                      read_held, read_stamp, scan_body, settings, settings_file,
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
    if not lines or bare(0) != "---":
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


def find_regency_looks(vault: Path) -> list[Item]:
    """1.10.49: a vault stamped plain `coc-7e` whose templates look like
    Regency Cthulhu: a stat block with the Reputation line, or a template
    with "regency" in its name. A notice, said once (the release gate): it
    changes nothing, because only the GM knows which setting is right."""
    if vault_system(vault) != "coc-7e":
        return []
    folder = vault / "_Templates"
    looks = _regency_pc_template(vault)
    for name in ("_Template_NPC.md", "_Template_Creature.md"):
        try:
            looks = looks or bool(REPUTATION_LINE_RE.search(
                (folder / name).read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError):
            continue
    if not looks:
        return []
    return [Item("regency-looks", PERSON, [
        f"{settings_file(vault)}\tthe templates look like Regency Cthulhu, "
        f"but vault.system is coc-7e; if this is a Regency Cthulhu "
        f"campaign, set vault.system to coc-7e-regency in "
        f"{settings_file(vault)}. That changes two things on the site: every "
        f"sheet gets the Regency skill list, and a PC with no era is headed "
        f"Regency Cthulhu instead of Call of Cthulhu. Nothing else changes, "
        f"and this is said once"], notice=True)]


def find_pc_template_field(vault: Path) -> list[Item]:
    """1.10.22: the vault's own PC templates gain `sheet_source: ""`."""
    todo = [p for p in sorted((vault / "_Templates").glob("pc-*.md"))
            if not re.search(r"^sheet_source:", _read(p), re.M)]
    if not todo:
        return []

    def change(fm: list[str], eol: str) -> None:
        at = next((i for i, line in enumerate(fm)
                   if line.startswith("portrait:")), len(fm) - 1)
        fm.insert(at + 1, f'sheet_source: ""{eol}')

    def apply(_value: str | None) -> list[str]:
        for path in todo:
            edit_frontmatter(path, change)
        return [f'added sheet_source: "" to _Templates/{p.name}' for p in todo]

    return [Item("pc-template-sheet-source", WILL,
                 [f'add sheet_source: "" to _Templates/{p.name}' for p in todo],
                 apply)]


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


# The retired "Required Relationships" section. Its stock text: the one-liner
# the scaffold wrote and the table older plugins wrote.
_RETIRED_HEADING = "## Required Relationships"
_STOCK_TIES_LINES = {
    "`npc`, `pc`, `creature` → `located_at`; "
    "`faction`, `organization` → `headquartered_at`.",
    "| Entity Type | Required Relationship |",
    "|-------------|----------------------|",
    "| `npc` | `located_at` |",
    "| `pc` | `located_at` |",
    "| `creature` | `located_at` |",
    "| `faction` | `headquartered_at` |",
    "| `organization` | `headquartered_at` |",
    "| `heritage` | — (none required) |",
}


def find_required_ties_section(vault: Path) -> list[Item]:
    """1.10.65: the vault's `## Required Relationships` section goes, on a
    yes. Lines the GM added to it go too, and the offer shows them."""
    path = vault / "_meta" / "entity-types.md"
    if not path.is_file():
        return []
    text = _read(path)
    start = re.search(rf"^{re.escape(_RETIRED_HEADING)}[ \t]*\r?$", text, re.M)
    if not start:
        return []
    nxt = re.search(r"^#{1,2} ", text[start.end():], re.M)
    end = start.end() + nxt.start() if nxt else len(text)
    body = [ln.strip() for ln in text[start.end():end].splitlines() if ln.strip()]
    own = [ln for ln in body if ln not in _STOCK_TIES_LINES]

    def apply(_value: str | None) -> list[str]:
        new = _read(path)
        m = re.search(rf"^{re.escape(_RETIRED_HEADING)}[ \t]*\r?$", new, re.M)
        if not m:
            return []
        n = re.search(r"^#{1,2} ", new[m.end():], re.M)
        stop = m.end() + n.start() if n else len(new)
        write_text_atomic(path, new[:m.start()] + new[stop:])
        return ["removed the Required Relationships section"]

    line = ("remove the retired \"Required Relationships\" section from "
            "_meta/entity-types.md (nothing reads it any more); it reads: "
            + " ".join(body))
    if own:
        line += (f"; your own lines in it go too: "
                 + " / ".join(f"\"{ln}\"" for ln in own))
    return [Item("required-ties-section", CHOICE, [line], apply)]


RELATIONSHIP_TYPES_FILE = "_meta/relationship-types.md"


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


def _add_to_table(text: str, missing: list[dict]) -> str | None:
    """`text` with each missing type added to its category's row of a
    `| Category | Types |` table (a row for a missing category goes after
    the table's last row), or None when the file has no such table. Every
    other byte stays."""
    import vault_scaffold as vs    # it imports this module

    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        head = [c.strip().lower() for c in _table_cells(line)]
        if line.lstrip().startswith("|") and "category" in head \
                and "types" in head:
            cat_col, type_col = head.index("category"), head.index("types")
            break
    else:
        return None
    eol = "\r\n" if lines[i].endswith("\r\n") else "\n"
    end = i + 1
    while end < len(lines) and lines[end].lstrip().startswith("|"):
        end += 1
    wanted: dict[str, list[str]] = {}
    for p in missing:
        wanted.setdefault(p.get("category") or "", []).append(p["type"])
    for category, types in wanted.items():
        shown = vs.CATEGORY_NAMES.get(category, category.title())
        for j in range(i + 2, end):
            cols = _table_cells(lines[j])
            if len(cols) <= max(cat_col, type_col) or \
                    _squash(cols[cat_col]) not in (_squash(category),
                                                   _squash(shown)):
                continue
            cell = cols[type_col]
            body = cell.rstrip()
            if body.strip():
                cols[type_col] = body + ", " + ", ".join(types) + cell[len(body):]
            else:
                cols[type_col] = " " + ", ".join(types) + " "
            lead = lines[j][:len(lines[j]) - len(lines[j].lstrip())]
            tail = lines[j][len(lines[j].rstrip("\r\n")):]
            row_text = lines[j].rstrip("\r\n").strip()
            front = "|" if row_text.startswith("|") else ""
            back = "|" if row_text.endswith("|") else ""
            lines[j] = lead + front + "|".join(cols) + back + tail
            break
        else:
            width = len(_table_cells(lines[i]))
            cols = [" " + shown + " " if k == cat_col
                    else " " + ", ".join(types) + " " if k == type_col
                    else "  " for k in range(width)]
            row = "|" + "|".join(cols) + "|" + eol
            if end > 0 and not lines[end - 1].endswith("\n"):
                lines[end - 1] += eol
            lines.insert(end, row)
            end += 1
    return "".join(lines)


def find_relationship_types_missing(vault: Path) -> list[Item]:
    """1.10.66: a vault's `_meta/relationship-types.md` that names fewer of
    the relationship types than the vocabulary has gets the missing ones
    added, on a yes. What the file names is the publish tool's reading of
    it (`relationships words`), never a second one here. A tool that cannot
    answer gives no offer."""
    path = vault / RELATIONSHIP_TYPES_FILE
    if not path.is_file():
        return []
    mine = _words(vault)
    if not mine or mine.get("subset") is not True:
        return []
    every = _words(None)
    if not every:
        return []
    named = {p["type"] for p in mine["predicates"]}
    missing = [p for p in every["predicates"] if p["type"] not in named]
    if not missing:
        return []
    names = [p["type"] for p in missing]

    def apply(_value: str | None) -> list[str]:
        text = _read(path)
        new = _add_to_table(text, missing)
        if new is None:
            eol = "\r\n" if "\r\n" in text else "\n"
            new = (text + ("" if text.endswith("\n") or not text else eol)
                   + eol + "## Added by the update (1.10.66)" + eol + eol
                   + "".join(f"- {n}{eol}" for n in names))
        write_text_atomic(path, new)
        return [f"added {len(names)} relationship types to "
                f"{RELATIONSHIP_TYPES_FILE}"]

    line = (f"add the relationship types your list leaves out to "
            f"{RELATIONSHIP_TYPES_FILE}: it names {len(named)} of the "
            f"{len(every['predicates'])}, and is missing "
            f"{', '.join(names)}; answer no if the list is a deliberate "
            f"genre subset")
    return [Item("relationship-types-missing", CHOICE, [line], apply)]


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


MOBRPG_MAP = "_meta/mobrpg-map.json"
MOBRPG_ADD = ("Campaign Log", "Encounters")


def _mobrpg_map(vault: Path) -> dict | None:
    try:
        data = json.loads(_read(vault / MOBRPG_MAP))
    except (StepFailed, ValueError):
        return None
    return data if isinstance(data, dict) else None


def find_mobrpg_sections(vault: Path) -> list[Item]:
    """1.10.13: a vault's own `vaultOnlySections` replaces mobRPG's default
    list, so it does not gain the two titles the default gained."""
    data = _mobrpg_map(vault)
    titles = data.get("vaultOnlySections") if data else None
    if not isinstance(titles, list) or not titles:
        return []
    have = {str(t).strip().lower() for t in titles}
    add = [t for t in MOBRPG_ADD if t.lower() not in have]
    if not add:
        return []

    def apply(_value: str | None) -> list[str]:
        fresh = _mobrpg_map(vault)
        if fresh is None or not isinstance(fresh.get("vaultOnlySections"), list):
            raise StepFailed(f"{MOBRPG_MAP} changed and can no longer be read")
        fresh["vaultOnlySections"] = [*fresh["vaultOnlySections"], *add]
        eol = "\r\n" if "\r\n" in _read(vault / MOBRPG_MAP) else "\n"
        write_text_atomic(
            vault / MOBRPG_MAP,
            (json.dumps(fresh, indent=2, ensure_ascii=False) + "\n")
            .replace("\n", eol))
        return [f"added {', '.join(add)} to vaultOnlySections in {MOBRPG_MAP}"]

    return [Item("mobrpg-sections", CHOICE,
                 [f"add {', '.join(add)} to vaultOnlySections in {MOBRPG_MAP}, "
                  f"so wrap-up lines stay in the vault"], apply)]


HERITAGE_TYPES = {"heritage", "culture", "race"}


def find_heritage_notes(vault: Path) -> list[Item]:
    """1.10.15: mobRPG keeps culture and race notes in `Heritages/`. Each
    one outside it is moved there, with every link to it, on a yes."""
    if _mobrpg_map(vault) is None:
        return []
    # The folder may already exist in another case: move into it as it is.
    folder = next((d.name for d in sorted(vault.iterdir())
                   if d.is_dir() and d.name.casefold() == "heritages"),
                  "Heritages")
    moves: list[tuple[str, str | None, str]] = [
        (rel, f"{folder}/{Path(rel).name}", "")
        for rel, text in vault_files(vault)
        if entity_type(extract_frontmatter(text) or {}) in HERITAGE_TYPES
        and Path(rel).parts[0].casefold() != "heritages"]
    return _relink_items(vault, "heritage-notes", "move", moves)


def _name_headings(titles: list[str]) -> str:
    return ", ".join(f"'## {t}'" for t in titles)


def find_wrapup_sections(vault: Path) -> list[Item]:
    """1.10.28: a Wrap-Up H2 is Keeper-facing only under GM Notes. Under
    the reading before that, every H2 the vault did not list was Keeper
    content; those are offered once to be moved under GM Notes.

    A note with a fence the re-nest cannot handle, one the checker refuses
    to write, or one with no recap heading it recognises is never moved:
    it is for a person."""
    player: frozenset[str] = frozenset()
    seen: list[WrapDetail] = []
    rows = [cells(r) for r in check_wrapup(
        vault, None, False, player=player, renest_only=True, detail=seen)]
    stopped(rows)
    found = {d.finding.row for d in seen}
    by_note: dict[str, list[WrapDetail]] = {}
    for d in seen:
        by_note.setdefault(d.rel, []).append(d)
    # A row the checker printed that is not a finding: a refusal to write.
    refused = {where.rpartition(":")[0] or where: m
               for level, where, m in rows
               if level == "ERROR" and f"{level}\t{where}\t{m}" not in found}
    moves: list[str] = []
    person: list[str] = []
    for rel, ds in by_note.items():
        titles = [d.finding.data[0] for d in ds
                  if d.finding.kind == "keeper-h2"]
        if not titles:
            continue
        fence = next((d.finding for d in ds if d.finding.kind in (
            "fence-crosses", "fence-unbalanced")), None)
        if fence is not None or rel in refused:
            why = fence.message if fence is not None else refused[rel]
            person.append(f"{rel}\t{why}")
            person.append(
                f"{rel}\t{_name_headings(titles)} would have moved; after "
                f"it is repaired `vault_check.py <vault> wrapup --file "
                f"{rel} --fix` will not move them (the new rule leaves "
                f"them), so move them under ## GM Notes by hand if they "
                f"are Keeper content")
        elif any(d.finding.kind == "no-recap" for d in ds):
            person.append(
                f"{rel}\thas no recap heading the tool recognises, so "
                f"nothing in it was moved ({_name_headings(titles)}): "
                f"retitle the player-facing section '## Narrative Recap', "
                f"then run `vault_check.py <vault> wrapup --file {rel}`; it "
                f"leaves those headings where they are, so move any that are "
                f"Keeper content under ## GM Notes by hand")
        else:
            for d in ds:
                f = d.finding
                if f.kind == "keeper-h2":
                    state = ("not published" if not d.publishes
                             else "players can see it today"
                             if f.level == "ERROR" else "already hidden")
                    moves.append(f"{rel}: '## {f.data[0]}' — {state}")
                elif f.kind == "renest" and f.data == ("unfenced",):
                    moves.append(f"{rel}: GM Notes gets its hidden-markers "
                                 f"(it has none today)")
                elif f.kind == "renest" and f.data == ("openers",):
                    moves.append(f"{rel}: its two hidden blocks become one, "
                                 f"round GM Notes")
                elif f.kind == "recap":
                    moves.append(f"{rel}: '## {f.data[0]}' is renamed "
                                 f"'## Narrative Recap'")
    items: list[Item] = []
    if moves:
        def apply(value: str | None) -> list[str]:
            if value not in ("move", "leave"):
                raise StepFailed("wrapup-sections takes move or leave")
            if value == "leave":
                return ["left the Wrap-Up headings where they are"]
            fixed = [cells(r) for r in check_wrapup(
                vault, None, True, player=player, renest_only=True)]
            stopped(fixed)
            return [f"{where}: {m}" for level, where, m in fixed
                    if level == "FIXED"]

        items.append(Item(
            "wrapup-sections", CHOICE,
            ["move: put these under GM Notes, hidden from players; "
             "leave: keep them where they are", *moves],
            apply, wants="move or leave", holds_stamp=True))
    if person:
        items.append(Item("wrapup-sections-review", PERSON, person))
    return items


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


def find_tone_words(vault: Path) -> list[Item]:
    """1.10.44: a relationship's tone is one of the listed words. Offers
    the rewrites a rule gives (cordial -> friendly). A word with no rule
    is campaign-qa's to ask about and is never touched here."""
    import tones    # its refusals are StepFailed, which the update reports

    report = tones.report_lines(tones.survey(vault))
    near = [r.split("\t") for r in report if r.startswith("NEAR\t")]
    if not near:
        # Nothing for the script to tidy; the words that remain are for
        # campaign-qa, and update time is when the GM is told (once: the
        # release gate).
        asked = sum(1 for r in report if r.startswith("ASK\t"))
        if not asked:
            return []
        return [Item("tone-words-ask", PERSON, [
            f"relationship tones\t{asked} tone word"
            f"{'' if asked == 1 else 's'} "
            f"{'is' if asked == 1 else 'are'} not on the standard list and "
            f"{'has' if asked == 1 else 'have'} no rule to tidy "
            f"{'it' if asked == 1 else 'them'}; campaign-qa's Tone Words "
            f"check asks which word to use for each"], notice=True)]
    n_near = sum(int(r[3]) for r in near)
    n_ask = sum(int(r.split("\t")[2]) for r in report
                if r.startswith("ASK\t"))

    def words(n: int) -> str:
        return f"{n} tone word{'' if n == 1 else 's'}"

    head = (f"tidy: {words(n_near)} tidied to the standard list by rule"
            + (f"; {n_ask} for you to pick later in campaign-qa"
               if n_ask else "")
            + "; leave: keep them as written")

    def apply(value: str | None) -> list[str]:
        if value not in ("tidy", "leave"):
            raise StepFailed("tone-words takes tidy or leave")
        if value == "leave":
            return ["left the tone words as they are"]
        try:
            p = tones.plan_fix(vault, near=True, sets={})
            tones.apply(p)
        except tones.TonesError as e:
            raise StepFailed(str(e)) from e
        return [*(f"{c.rel}:{c.lineno}: {c.before} -> {c.after}"
                  for c in p.changes),
                *(f"{rel}:{lineno}: {tone} left as written ({why})"
                  for rel, lineno, tone, why in p.kept)]

    return [Item("tone-words", CHOICE,
                 [head, *(f"{w} -> {to} ({n})" for _, w, to, n in near)],
                 apply, wants="tidy or leave", holds_stamp=True)]


# --- the tone list in _meta ---------------------------------------------------

TONE_LIST_FILES = ("_meta/entity-types.md", "_meta/relationship-types.md")
# The eleven tone words a vault's `_meta` files listed before 1.10.44. They
# are frozen here, and nowhere else, because a list written then is known by
# them: the words to write come from the ontology (`tone_families`).
OLD_TONES = ("friendly", "romantic", "respectful", "professional", "hostile",
             "fearful", "distrustful", "contemptuous", "neutral", "unknown",
             "complicated")
_LIST_WORD = r"[A-Za-z][A-Za-z_-]*"
_LIST_GAP = r"[ \t]*(?:\r?\n[ \t]*)?"      # blanks, and at most one line break
_LIST_SEP = rf"{_LIST_GAP}[,|]{_LIST_GAP}"
# Five or more words with only a comma or a pipe between each two.
WORD_RUN_RE = re.compile(rf"(?<![\w-]){_LIST_WORD}(?:{_LIST_SEP}{_LIST_WORD})"
                         rf"{{4,}}(?![\w-])")
# What may follow a list: a full stop that ends a sentence, or the end of
# its paragraph.
RUN_END_RE = re.compile(
    r"[ \t]*(?:\.(?=\s|\Z)|(?:\r?\n[ \t]*)?\Z|\r?\n[ \t]*\r?\n)")
# What must come straight before a list, to the end of the text before it
# on its line: the word, at most one more word (`Tone values`), then `:`,
# `=`, `∈` or a dash, with any emphasis marks.
TONE_LABEL_RE = re.compile(
    r"(?<![\w-])tones?(?![\w-])[*`_]*(?:[ \t]+[A-Za-z]+)?[*`_]*[ \t]*"
    r"[:=∈–—-][*`_]*[ \t]*\Z", re.I)
# The comment vault_scaffold.py copied into _meta/entity-types.md from
# 1.10.29 to 1.10.43 (entity-schema.md's relationships example as it was):
# the old words, three to a `#` line, beside and under the `tone:` line.
_OLD_ROWS = [" \\| ".join(OLD_TONES[i:i + 3]) for i in range(0, 11, 3)]
OLD_COMMENT_RE = re.compile(
    r"^(?P<head>[ \t]*tone:[ \t]*[a-z]+[ \t]+)# " + _OLD_ROWS[0]
    + "".join(rf"[ \t]*\r?\n[ \t]*# {row}" for row in _OLD_ROWS[1:])
    + r"(?=[ \t]*\r?$)", re.M)
# The same line in the plugin's schema today, and the paragraph it points to.
NEW_COMMENT_RE = re.compile(r"^[ \t]*tone:[ \t]*[a-z]+[ \t]+(#[^\n]*?)[ \t]*$",
                            re.M)
TONES_MARK = "**Tones.**"


def _stale_tone_lists(text: str) -> list[tuple[int, int, str]]:
    """(start, end, replacement) for each list of tone words in `text` that
    is not the listed words: the words and their separators, nothing else.
    A list is the plugin's own: every one of the eleven old words, and no
    other word but a listed tone (a line the GM wrote names fewer, and is
    never taken). It has one
    kind of separator, straight after a label on its first line that says
    `tone`, ending at a full stop or its paragraph's end. Anything else is
    not a list this step can delimit, and is left out."""
    listed = list(tone_families())
    known = set(listed) | set(OLD_TONES)
    out = []
    # Where each line starts, found once: a backwards search from every
    # match is quadratic on a large file with no bare CR in it.
    breaks = [b.end() for b in re.finditer(r"[\r\n]", text)]
    for m in WORD_RUN_RE.finditer(text):
        run = m.group(0)
        words = re.findall(_LIST_WORD, run)
        seps = re.findall(_LIST_SEP, run)
        at = bisect.bisect_right(breaks, m.start())
        line_start = breaks[at - 1] if at else 0
        if (not set(words) <= known or set(words) == set(listed)
                or not set(OLD_TONES) <= set(words)
                or len({s.strip() for s in seps}) != 1
                or not TONE_LABEL_RE.search(text[line_start:m.start()])
                or not RUN_END_RE.match(text, m.end())):
            continue
        mark = seps[0].strip()
        joiner = next((s for s in seps if "\n" not in s),
                      ", " if mark == "," else f" {mark} ")
        out.append((m.start(), m.end(), joiner.join(listed)))
    return out


def _schema_tone_text() -> tuple[str, str, str] | None:
    """From the plugin's entity-schema.md: the comment on the example's
    `tone:` line, the paragraph before the Tones paragraph, and the Tones
    paragraph. None when the schema no longer has that shape."""
    schema = without_generated_markers(
        (SHARED / "entity-schema.md").read_text(encoding="utf-8"))
    comment = NEW_COMMENT_RE.search(schema)
    paragraphs = schema.split("\n\n")
    at = next((i for i, p in enumerate(paragraphs)
               if p.startswith(TONES_MARK)), 0)
    if not comment or at == 0:
        return None
    return comment.group(1), paragraphs[at - 1], paragraphs[at]


def _old_tone_comment(text: str) -> tuple[list[tuple[int, int, str]], bool]:
    """The edits that bring a scaffolded relationships example up to the
    plugin's, and whether the Tones paragraph is among them. The comment
    is taken only when it is exactly the old one, once. The paragraph is
    added only when the file has none and holds, exactly once and ending
    its paragraph, the paragraph the plugin's schema puts before it."""
    found = list(OLD_COMMENT_RE.finditer(text))
    now = _schema_tone_text()
    if len(found) != 1 or now is None:
        return [], False
    comment, before, tones = now
    m = found[0]
    edits = [(m.start(), m.end(), m.group("head") + comment)]
    eol = "\r\n" if "\r\n" in text else "\n"
    anchor = before.replace("\n", eol)
    at = text.find(anchor) + len(anchor)
    if (TONES_MARK in text or text.count(anchor) != 1
            or not re.match(r"(?:\r?\n){2}|(?:\r?\n)?\Z", text[at:])):
        return edits, False
    return [*edits, (at, at, eol * 2 + tones.replace("\n", eol))], True


def find_tone_list(vault: Path) -> list[Item]:
    """1.10.44: where a `_meta` schema file lists the tone words, the list
    becomes the listed words; and the relationships example a 1.10.29 to
    1.10.43 scaffold wrote, with the old words in a comment, becomes the
    plugin's. A file that is not UTF-8, and a list this step cannot
    delimit exactly, are left as they are."""
    n_words = len(tone_families())

    def stale(rel: str) -> tuple[str, list[tuple[int, int, str]], list[str],
                                 list[str]]:
        """The file's text, its edits, and a line per kind of edit: what
        will be done, and what was."""
        path = vault / rel
        if not path.is_file():
            return "", [], [], []
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                text = f.read()
        except UnicodeDecodeError:
            return "", [], [], []
        except OSError as e:
            raise StepFailed(f"{rel} cannot be read "
                             f"({e.__class__.__name__})") from e
        lists = _stale_tone_lists(text)
        comment, paragraph = _old_tone_comment(text)
        will, did = [], []
        if lists:
            n = len(lists)
            what = "the tone list" if n == 1 else f"the {n} tone lists"
            will.append(f"{rel}: {what} {'becomes' if n == 1 else 'become'} "
                        f"the {n_words} listed words")
            did.append(f"{rel}: {what} {'is' if n == 1 else 'are'} now the "
                       f"{n_words} listed words")
        if comment:
            will.append(
                f"{rel}: the old tone words leave the relationships example"
                + (f", and the Tones paragraph (the {n_words} listed words) "
                   f"is added" if paragraph else ""))
            did.append(
                f"{rel}: the relationships example"
                + (" and the Tones paragraph now match"
                   if paragraph else " now matches") + " the plugin's")
        return text, sorted(lists + comment), will, did

    lines = [line for rel in TONE_LIST_FILES for line in stale(rel)[2]]
    if not lines:
        return []

    def apply(_value: str | None) -> list[str]:
        done = []
        for rel in TONE_LIST_FILES:
            text, edits, _will, did = stale(rel)
            if not edits:
                continue
            for start, end, new in reversed(edits):
                text = text[:start] + new + text[end:]
            write_text_atomic(vault / rel, text)
            done += did
        return done

    return [Item("tone-list", WILL, lines, apply)]


# --- per-session open threads in PC Current Status ---------------------------

def _sessions(numbers: list[int]) -> str:
    return (f"Session{'s' if len(numbers) > 1 else ''} "
            + ", ".join(map(str, numbers)))


def find_open_threads_fold(vault: Path) -> list[Item]:
    """1.10.83: Current Status holds one cumulative Open threads list
    (`shared/pc-body-structure.md`). Wrap-ups once appended a
    `**New open threads (Session N):**` bullet each session instead; the
    GM may fold them into the list, each as `**Session N:**` and its text
    word for word. It rewrites what the GM wrote, so it is a choice."""
    import vault_write as vw

    found: list[tuple[str, list[int]]] = []
    for rel, text in vault_files(vault):
        if (rel.endswith("_Story.md") or rel.startswith("_Templates/")
                or vw.is_record(rel)
                or entity_type(extract_frontmatter(text) or {}) != "pc"):
            continue
        numbers = [n for n, _f in vw.session_threads(text)]
        if numbers:
            found.append((rel, numbers))
    if not found:
        return []

    def apply(value: str | None) -> list[str]:
        if value not in ("fold", "leave"):
            raise StepFailed("open-threads-fold takes fold or leave")
        if value == "leave":
            return ["left the per-session open threads as they are"]
        batch = vw.Batch(vault)
        done = []
        try:
            for rel, _numbers in found:
                folded = vw.fold_session_threads(batch, rel)
                if folded:
                    done.append(f"{rel}: folded {_sessions(folded)}")
            vw.check_fences(batch)
            vw.apply(batch)
        except vw.WriteError as e:
            raise StepFailed(str(e)) from e
        return done

    return [Item("open-threads-fold", CHOICE,
                 ["fold: put each PC's per-session 'New open threads' "
                  "bullets into its one Open threads list, text unchanged; "
                  "leave: keep them as written",
                  *(f"{rel}: {_sessions(numbers)}" for rel, numbers in found)],
                 apply, wants="fold or leave", holds_stamp=True)]


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


# The session family: the index, its Plan, Play Notes and Wrap-Up. Only
# these ever had a session `stage:`; any other type's is the GM's own.
STAGE_TYPES = frozenset({"session", "session-plan", "session-play-notes",
                         *WRAP_TYPES})


def _fm_type(fm: list[str]) -> str:
    return entity_type(extract_frontmatter("".join(["---\n", *fm, "---\n"]))
                       or {})


def _drop_stage(fm: list[str], _rel: str) -> bool:
    """A one-line `stage:` on a session-family note whose value hides
    nothing. A stage that keeps the note off a player site (STAGE_HIDES)
    stays: every publish tool still reads it, so removing it would
    publish the note."""
    if not any(ln.startswith("stage:") for ln in fm) \
            or opens_a_block(fm, "stage") or _fm_type(fm) not in STAGE_TYPES:
        return False
    # The value as the publish tool's YAML reads it: quotes and comments
    # go, an anchor (`&held draft`) names the value after it, and an alias
    # (`*held`) is a value set elsewhere, so it stays.
    parsed = extract_frontmatter("".join(["---\n", *fm, "---\n"])) or {}
    value = str(parsed.get("stage") or "").strip()
    if value.startswith("*"):
        return False
    value = re.sub(r"^&\S+\s*", "", value)
    return value.casefold() not in STAGE_HIDES


def _drop_empty_scenes(fm: list[str], _rel: str) -> bool:
    return (_fm_type(fm) == "session"
            and any(re.fullmatch(r"scenes:[ \t]*\[[ \t]*\][ \t]*", ln.rstrip("\r\n"))
                    for ln in fm))


def _remove_keys(vault: Path, rels: list[str], key: str,
                 only: Callable[[list[str]], bool]) -> list[str]:
    done = []
    for rel in rels:
        def change(fm: list[str], _eol: str) -> None:
            if only(fm):
                delete_key(fm, key)
        edit_frontmatter(vault / rel, change)
        done.append(f"removed {key}: from {rel}")
    return done


def find_stage_keys(vault: Path) -> list[Item]:
    """1.10.93: a session no longer has a `stage:`. The key goes from any
    session-family note (STAGE_TYPES) that has it as a one-line value that
    hides nothing; `stage: draft` and the other STAGE_HIDES words stay,
    because they still keep the note off a player site."""
    found = _notes_with(vault, _drop_stage)
    if not found:
        return []

    def apply(_value: str | None) -> list[str]:
        return _remove_keys(vault, found, "stage",
                            lambda fm: _drop_stage(fm, ""))

    return [Item("stage-keys", WILL,
                 [f"remove stage: from {rel}" for rel in found], apply)]


def find_empty_scenes_lists(vault: Path) -> list[Item]:
    """1.10.93: a session index no longer lists its scenes in frontmatter.
    An empty one-line `scenes: []` goes from `type: session` notes; a list
    with entries stays as the GM wrote it."""
    found = _notes_with(vault, _drop_empty_scenes)
    if not found:
        return []

    def apply(_value: str | None) -> list[str]:
        return _remove_keys(vault, found, "scenes",
                            lambda fm: _drop_empty_scenes(fm, ""))

    return [Item("empty-scenes-lists", WILL,
                 [f"remove scenes: [] from {rel}" for rel in found], apply)]


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


# --- D&D PC Background sections -----------------------------------------------

OLD_BACKSTORY = re.compile(r"^\*\*Backstory & Personality:\*\*[ \t]*(.*?)[ \t]*$")
OLD_APPEARANCE = re.compile(r"^\*\*Appearance:\*\*[ \t]*(.*?)[ \t]*$")
STOPS_VALUE = re.compile(r"\*\*[^*\n]+:\*\*|#{1,6}\s")
BACKSTORY_HINT = "{The character's backstory, as the player tells it}"
APPEARANCE_HINT = "{How they look}"
FACTS_LINE = " \u00b7 ".join(f"**{label}:** \u2014" for label in (
    "Age", "Height", "Weight", "Eyes", "Hair", "Skin", "Faith"))
PERSONALITY = [f"- **{label}:** \u2014" for label in
               ("Traits", "Ideals", "Bonds", "Flaws")]


SUBSECTIONS = ("backstory", "appearance", "personality")
OLD_LABEL = {"backstory": "Backstory & Personality", "appearance": "Appearance"}


def _fill_sections(text: str) -> tuple[str, list[str]]:
    """The note with what sync needs inside the sub-sections it already
    has: a facts line at the end of `### Appearance`, and the missing
    `- **Traits:** —` / Ideals / Bonds / Flaws lines at the end of
    `### Personality`. Existing text is never changed; also gives what was
    done, one phrase each."""
    import dnd_background

    lines = text.splitlines(keepends=True)
    eol = next((m.group(0) for raw in lines if (m := re.search(r"\r\n|\n|\r", raw))), "\n")
    subs = dnd_background._subsections(lines)
    parts = dnd_background.note_parts(text)
    adds: list[tuple[str, list[str], str]] = []
    if "appearance" in subs and parts["facts"] is None:
        adds.append(("appearance", [FACTS_LINE], "### Appearance gets its facts line"))
    missing = [b for b in dnd_background.BULLETS if parts[b] is None]
    if "personality" in subs and missing:
        names = [b.title() for b in missing]
        listed = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        adds.append(("personality", [f"- **{b}:** \u2014" for b in names],
                     f"### Personality gets its {listed} line{'s' if len(names) > 1 else ''}"))
    for name, new, _ in sorted(adds, key=lambda a: subs[a[0]][0], reverse=True):
        head, end = subs[name]
        last = end
        while last > head + 1 and not lines[last - 1].strip():
            last -= 1
        body = lines[head:last]
        if not body[-1].endswith(("\n", "\r")):
            body[-1] += eol
        joined = name == "personality" and last > head + 1 and dnd_background.BULLET.match(
            lines[last - 1].rstrip("\r\n")) is not None
        tail = [eol] if end < len(lines) else []
        lines[head:end] = body + ([] if joined else [eol]) + [line + eol for line in new] + tail
    return "".join(lines), [a[2] for a in adds]


def _background_sections(text: str) -> tuple[str, list[str]] | None:
    """The note with the `### Backstory` / `### Appearance` / `### Personality`
    sub-sections it is missing added under `## Background`, the one-line
    Backstory & Personality and Appearance values moved into theirs; None
    when it has no `## Background` or already has all three. A sub-section
    the note already has is kept as it is, and an old line for it stays where
    it is. Also gives what was done, one phrase each. Line endings are
    kept."""
    import dnd_background

    text, filled = _fill_sections(text)
    have = dnd_background.subsections(text)
    if all(name in have for name in SUBSECTIONS):
        return (text, filled) if filled else None
    lines = text.splitlines(keepends=True)
    start = end = -1
    fence: str | None = None
    for i, raw in enumerate(lines):
        fence, is_fence = fence_step(raw, fence)
        if is_fence or fence is not None:
            continue
        title = raw.strip().lower()
        if start < 0:
            if title == "## background":
                start = i
        elif re.match(r"#{1,2}\s", raw):
            end = i
            break
    if start < 0:
        return None
    if end < 0:
        end = len(lines)
    eol = next((m.group(0) for raw in lines if (m := re.search(r"\r\n|\n|\r", raw))), "\n")
    found: dict[str, str] = {}
    left: list[str] = []
    kept: list[str] = []
    body = lines[start + 1:end]
    fence = None
    n = 0
    while n < len(body):
        raw = body[n]
        n += 1
        fence, is_fence = fence_step(raw, fence)
        bare = raw.rstrip("\r\n")
        key, m = None, None
        if not is_fence and fence is None:
            for name, rx in (("backstory", OLD_BACKSTORY), ("appearance", OLD_APPEARANCE)):
                m = rx.match(bare)
                if m and name in have:
                    if name not in left:
                        left.append(name)
                elif m and name not in found:
                    key = name
                    break
                m = None
        if key is None or m is None:
            kept.append(raw)
            continue
        # The value runs on over the lines and paragraphs after it, up to the
        # next labelled line, heading or the end of Background.
        value_lines = [m.group(1)]
        while n < len(body) and not STOPS_VALUE.match(body[n]):
            value_lines.append(body[n].rstrip("\r\n"))
            n += 1
        while value_lines and not value_lines[-1].strip():
            value_lines.pop()
        found[key] = eol.join(value_lines)
    while kept and not kept[-1].strip():
        kept.pop()
    if kept and not kept[-1].endswith(("\n", "\r")):
        kept[-1] += eol

    def value(key: str, hint: str) -> str:
        got = found.get(key, "")
        return hint if not got or PLACEHOLDER.match(got) else got

    blocks = {"backstory": ["### Backstory", "", value("backstory", BACKSTORY_HINT)],
              "appearance": ["### Appearance", "", value("appearance", APPEARANCE_HINT), "", FACTS_LINE],
              "personality": ["### Personality", "", *PERSONALITY]}
    added = [name for name in SUBSECTIONS if name not in have]
    block: list[str] = []
    for name in added:
        block += ([""] if block else []) + blocks[name]
    tail = [eol] if end < len(lines) else []
    lead = [] if kept and not kept[0].strip() else [eol]
    new = (lines[:start + 1] + lead + kept + ([eol] if kept else [])
           + [line + eol for line in block] + tail + lines[end:])
    said = [f"{OLD_LABEL[name]} moves into ### {name.title()}" if name in found
            else f"### {name.title()} is added" for name in added]
    said += [f"the old **{OLD_LABEL[name]}:** line stays where it is: the note "
             f"already has ### {name.title()}" for name in left]
    return "".join(new), said[:len(added)] + filled + said[len(added):]


def find_dnd_background_sections(vault: Path) -> list[Item]:
    """1.10.94: a D&D PC's background lives in `### Backstory`, `### Appearance`
    and `### Personality` under `## Background` (`dnd_background.py`). The old
    one-line `**Backstory & Personality:**` and `**Appearance:**` values
    move there word for word; a `{placeholder}` counts as empty. Only the
    sub-sections a note is missing are added, and an existing Appearance or
    Personality gets the facts line or bullets it lacks. Frontmatter is not
    touched."""
    if vault_system(vault) != "dnd-5e-2024":
        return []
    todo: list[str] = []
    lines: list[str] = []
    for rel, text in vault_files(vault, newline=""):
        if (rel.endswith("_Story.md") or rel.startswith("_Templates/")
                or entity_type(extract_frontmatter(text) or {}) != "pc"):
            continue
        planned = _background_sections(text)
        if planned is None:
            continue
        todo.append(rel)
        moved = [p for p in planned[1] if not p.startswith("the old ")]
        lines.append(f"{rel}: " + "; ".join(moved))
        lines += [f"{rel}: {p}" for p in planned[1] if p.startswith("the old ")]
    if not todo:
        return []

    def apply(_value: str | None) -> list[str]:
        done = []
        for rel in todo:
            path = vault / rel
            new = _background_sections(_read(path))
            if new is not None:
                write_text_atomic(path, new[0])
                done.append(f"{rel}: " + "; ".join(new[1]))
        return done

    return [Item("dnd-background-sections", WILL, lines, apply)]


# --- The wrap-up's Source callout -------------------------------------------

# The callout that says where a wrap-up came from, read as the publish tool's
# excerpt.js `PROVENANCE_CALLOUT_RE` reads it: any callout kind, any fold mark.
SOURCE_CALLOUT_RE = re.compile(
    r"^\s*>\s*\[![A-Za-z][\w-]*\][-+]?\s*Source\s*$", re.I)
GM_OPEN, GM_CLOSE = "<!-- gm-only -->", "<!-- /gm-only -->"
# A line that starts a block of its own, so it never continues a callout lazily: a heading, a code
# fence, a rule, a list item, or HTML (a gm-only marker among it).
BLOCK_START_RE = re.compile(
    r"^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|<)")


def _fence_callouts(text: str, callout_re: re.Pattern[str]) -> str | None:
    """The note with every callout `callout_re` matches, that players can see, wrapped in a
    gm-only fence, or None when there is none. A callout already inside a
    gm-only or spoiler block, under `## GM Notes` (up to the next heading
    of level 1 or 2), or in a code fence is left as it is. Lazy continuation
    lines after the quote go inside the fence with it."""
    states, _problems = scan_body(text)
    lines = text.splitlines(keepends=True)
    eol = next((m.group(0) for raw in lines
                if (m := re.search(r"\r\n|\n|\r", raw))), "\n")
    spans: list[tuple[int, int]] = []
    h2: str | None = None
    i = 0
    while i < len(states):
        s = states[i]
        if s.heading and s.heading[0] <= 2:
            h2 = s.heading[1].strip().casefold()
        if (not s.in_code and s.gm_depth == 0 and s.spoiler_depth == 0
                and h2 != "gm notes" and callout_re.match(s.line)):
            j = i + 1
            while (j < len(states) and not states[j].in_code
                   and states[j].line.lstrip().startswith(">")):
                j += 1
            # Lazy continuation: markdown keeps a plain line after a quote inside it, up to a blank line.
            # A blank quoted line ends the paragraph inside the quote, so nothing continues lazily after it.
            ended = states[j - 1].line.lstrip()[1:].strip() == ""
            while (not ended and j < len(states) and not states[j].in_code and states[j].line.strip()
                   and not BLOCK_START_RE.match(states[j].line)):
                j += 1
            spans.append((s.lineno - 1, states[j - 1].lineno - 1))
            i = j
            continue
        i += 1
    if not spans:
        return None
    for start, end in reversed(spans):
        last = lines[end]
        ended = last.endswith(("\n", "\r"))
        lines[end] = (last if ended else last + eol) + GM_CLOSE + (
            eol if ended else "")
        lines[start] = GM_OPEN + eol + lines[start]
    return "".join(lines)


def _fence_source(text: str) -> str | None:
    """`_fence_callouts` for the wrap-up's Source callout."""
    return _fence_callouts(text, SOURCE_CALLOUT_RE)


def find_wrapup_source_fence(vault: Path) -> list[Item]:
    """1.10.114 (#542): a wrap-up's `> [!info] Source` callout is the GM's
    bookkeeping (which file, which skill), so it goes inside a gm-only
    fence, as the template and `vault_write.py` now write it. One players
    cannot see already is left alone."""
    todo = [rel for rel, text in vault_files(vault, newline="")
            if entity_type(extract_frontmatter(text) or {}) in WRAP_TYPES
            and _fence_source(text) is not None]
    if not todo:
        return []

    def apply(_value: str | None) -> list[str]:
        done = []
        for rel in todo:
            new = _fence_source(_read(vault / rel))
            if new is not None:
                write_text_atomic(vault / rel, new)
                done.append(f"{rel}: Source callout fenced gm-only")
        return done

    return [Item("wrapup-source-fence", WILL,
                 [f"{rel}: put the Source callout inside a gm-only fence, so "
                  f"the player site never shows it" for rel in todo], apply)]


def find_reconstruction_note_fence(vault: Path) -> list[Item]:
    """1.10.119: a `> [!info] Reconstruction Note` callout (vault-ingest's
    provenance note) goes inside a gm-only fence, as vault-ingest now writes
    it, so it stops publishing. Any note may hold one. One players cannot
    see already is left alone."""
    todo = [rel for rel, text in vault_files(vault, newline="", skip_dirs=SKIP_DIRS | {"_meta"})
            if _fence_callouts(text, RECONSTRUCTION_NOTE_RE) is not None]
    if not todo:
        return []

    def apply(_value: str | None) -> list[str]:
        done = []
        for rel in todo:
            new = _fence_callouts(_read(vault / rel), RECONSTRUCTION_NOTE_RE)
            if new is not None:
                write_text_atomic(vault / rel, new)
                done.append(f"{rel}: Reconstruction Note fenced gm-only")
        return done

    return [Item("reconstruction-note-fence", WILL,
                 [f"{rel}: put the Reconstruction Note inside a gm-only "
                  f"fence, so the player site never shows it"
                  for rel in todo], apply)]


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
    Check("regency-looks", "1.10.49", 3, "a Regency look to the templates",
          find_regency_looks,
          kind="bookkeeping",
          plain=("Noticed that your templates look like Regency Cthulhu while the vault is set to plain Call of Cthulhu, and said so; nothing was changed.")),
    Check("pc-template-sheet-source", "1.10.22", 3,
          "sheet_source in PC templates", find_pc_template_field,
          kind="bookkeeping",
          plain=("Added an empty place for a character sheet link to your PC templates.")),
    Check("schema-mirror", None, 3, "the schema mirror", find_schema_mirror,
          choices=("schema-mirror",),
          kind="removes",
          plain=("Brought the vault's own copy of the built-in note types up to the plugin's."),
          ask=("Replaces the vault's copy of the built-in note types with the plugin's, so the skills read the same fields you do; your own changes inside those entries go."),
          left=("Kept your own version of the built-in note types.")),
    Check("required-ties-section", "1.10.65",
          3, "the retired required-relationships section",
          find_required_ties_section, choices=("required-ties-section",),
          kind="removes",
          plain=("Removed the old Required Relationships section from your list of note types; nothing reads it any more."),
          ask=("Removes the old Required Relationships section, lines you added included, since nothing reads it any more."),
          left=("Kept the old Required Relationships section.")),
    Check("relationship-types-missing", "1.10.66", 3,
          "the relationship types a list is missing",
          find_relationship_types_missing,
          choices=("relationship-types-missing",),
          kind="asks",
          plain=("Added the relationship types your list was missing, so every kind of tie can be recorded."),
          ask=("Adds the relationship types your list leaves out, so every kind of tie can be recorded; say leave if your list is a deliberate choice for this genre."),
          left=("Kept your list of relationship types as it is.")),
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
    # Re-nesting changes what the site shows, so it waits for the repin.
    Check("wrapup-sections", "1.10.28", 4, "Wrap-Up sections",
          find_wrapup_sections, asks_site=True,
          choices=("wrapup-sections=",),
          kind="asks",
          plain=("Moved the wrap-up notes' GM headings under GM Notes, so they stay off the player site."),
          ask=("Moves GM headings in wrap-up notes under GM Notes, so they stay off the player site."),
          left=("Kept your wrap-up notes' headings where they are.")),
    Check("tone-words", "1.10.44", 3, "tone words",
          find_tone_words, choices=("tone-words=",),
          kind="asks",
          plain=("Changed the tone words on relationships to the listed ones."),
          ask=("Changes the tone words on relationships to the listed ones, so the site can show each tie as warm, hostile or neutral."),
          left=("Kept your relationship tone words as they are.")),
    Check("tone-list", "1.10.44", 3, "the tone list in _meta",
          find_tone_list,
          kind="bookkeeping",
          plain=("Updated the list of relationship tone words in your setup files to the current list.")),
    Check("mobrpg-sections", "1.10.13", 3, "mobRPG vault-only sections",
          find_mobrpg_sections, choices=("mobrpg-sections",),
          kind="bookkeeping",
          plain=("Added two section titles to mobRPG's list of sections kept in the vault, so wrap-up lines stay private.")),
    Check("heritage-notes", "1.10.15", 4, "mobRPG heritage notes",
          find_heritage_notes, asks_site=True,
          choices=("heritage-notes",),
          kind="bookkeeping",
          plain=("Moved culture and race notes into the Heritages folder and updated every link to them.")),
    Check("open-threads-fold", "1.10.83", 3,
          "per-session open threads in PC Current Status",
          find_open_threads_fold, choices=("open-threads-fold=",),
          kind="asks",
          plain=("Folded each session's new open threads into the one Open threads list in PC Current Status, word for word."),
          ask=("Folds each session's new open threads into the one Open threads list in PC Current Status, word for word."),
          left=("Kept the open threads where each session put them.")),
    Check("stage-keys", "1.10.93", 3, "the retired stage: key",
          find_stage_keys,
          kind="removes",
          plain=("Removed the old stage line from session notes; nothing reads it any more."),
          ask=("Removes the old stage line from session notes, since nothing reads it any more."),
          left=("Kept the old stage lines in your session notes.")),
    Check("empty-scenes-lists", "1.10.93", 3, "empty scenes: lists",
          find_empty_scenes_lists,
          kind="removes",
          plain=("Removed empty scene lists from session index notes."),
          ask=("Removes empty scene lists from session index notes, since nothing reads them any more."),
          left=("Kept the empty scene lists in your session notes.")),
    Check("dnd-background-sections", "1.10.94", 3,
          "backstory sections in D&D PC notes", find_dnd_background_sections,
          kind="bookkeeping",
          plain=("Moved D&D characters' backstory, appearance and personality into their own sections under Background, word for word.")),
    Check("wrapup-source-fence", "1.10.114", 3,
          "the Source callout in Wrap-Ups", find_wrapup_source_fence,
          kind="bookkeeping",
          plain=("Hid the line in each wrap-up that says where it came from, so the player site never shows it.")),
    Check("reconstruction-note-fence", "1.10.119", 3,
          "the Reconstruction Note callout", find_reconstruction_note_fence,
          kind="bookkeeping",
          plain=("Hid the Reconstruction Note on imported notes, so the player site never shows it.")),
    Check("null-last-updated", "1.11.2", 3,
          'lastUpdated: "null" in story and NPC notes', find_null_last_updated,
          kind="bookkeeping",
          plain=("Cleared a last-updated date that read \"null\" on character story and NPC notes, left there when a wrap-up had no play date yet.")),
]

#!/usr/bin/env python3
"""migrate_vault.py: the migration checks that read and write vault files
alone: templates, the schema mirror, and the small per-release fixes."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          edit_frontmatter, write_text_atomic)
from vault_check import WRAP_TYPES, wrapup_filename_findings
from vaultlib import (entity_type, extract_frontmatter, read_publish_scalar,
                      vault_files)

SHARED = Path(__file__).resolve().parent.parent
TEMPLATES = SHARED / "templates"
HISTORY = SHARED / "template-history.json"
CONFIG = "_meta/vault-config.md"

# shared/templates name -> _Templates name (vault-setup.md, Templates).
TEMPLATE_NAMES = {
    "npc.md": "_Template_NPC.md",
    "location.md": "_Template_Location.md",
    "item.md": "_Template_Item.md",
    "creature.md": "_Template_Creature.md",
    "organization.md": "_Template_Organization.md",
    "faction.md": "_Template_Faction.md",
    "event.md": "_Template_Event.md",
    "clue.md": "_Template_Clue.md",
    "document.md": "_Template_Document.md",
    "heritage.md": "_Template_Heritage.md",
    "world-domain.md": "_Template_World_Domain.md",
    "plan.md": "_Template_Plan.md",
    "campaign-overview.md": "_Template_Campaign_Overview.md",
    "session.md": "_Template_Session.md",
    "session-plan.md": "_Template_Session_Plan.md",
    "session-wrap.md": "_Template_Session_WrapUp.md",
    "character-story.md": "character-story.md",
}
SYSTEM_ALIASES = {
    "coc": "coc-7e", "regency-cthulhu": "coc-7e-regency", "gurps": "gurps-4e",
    "dnd": "dnd-5e-2024", "dnd-5e": "dnd-5e-2024", "pathfinder": "pf2e",
    "pathfinder-2e": "pf2e", "blades": "fitd",
}
STAT_BLOCK_RE = re.compile(r"^\{STAT BLOCK:.*?\}[ \t]*$", re.M | re.S)
GENERIC_BLOCK = "### Stats\n\n{System stat block.}"


def _system_id(raw: object) -> str | None:
    text = str(raw or "").strip().lower()
    return SYSTEM_ALIASES.get(text, text) or None


def vault_system(vault: Path) -> str | None:
    """`publish.system`, else the Campaign Overview's `game_system`, else
    the adventure brief's `system`; aliases mapped to the file ids."""
    found = _system_id(read_publish_scalar(vault, "system"))
    if found:
        return found
    for wanted, key in (("campaign_overview", "game_system"),
                        ("adventure_brief", "system")):
        for _rel, text in vault_files(vault):
            fm = extract_frontmatter(text) or {}
            if entity_type(fm) == wanted and _system_id(fm.get(key)):
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


GENERIC = "generic"   # the history's key for a vault with no known system


def _released_hashes(system: str | None) -> dict[str, list[str]]:
    """template-history.json: system -> vault filename -> hashes of what
    releases wrote for that system. A system the history does not know gets
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


def find_templates(vault: Path) -> list[Item]:
    folder = vault / "_Templates"
    items: list[Item] = []
    released = _released_hashes(vault_system(vault))
    for name, text in expected_templates(vault).items():
        path = folder / name

        def apply(_value: str | None, path: Path = path,
                  text: str = text, name: str = name) -> list[str]:
            write_text_atomic(path, text)
            return [f"wrote _Templates/{name}"]

        if not path.is_file():
            items.append(Item(f"template:{name}", WILL,
                              [f"copy the missing template _Templates/{name}"],
                              apply))
            continue
        try:
            current = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            raise StepFailed(f"_Templates/{name} cannot be read "
                             f"({e.__class__.__name__})") from e
        if _same(current, text):
            continue
        if text_hash(current) in released.get(name, []):
            items.append(Item(
                f"template:{name}", WILL,
                [f"update _Templates/{name} from an earlier release's text"],
                apply))
        else:
            items.append(Item(
                f"template:{name}", CHOICE,
                [f"overwrite _Templates/{name} with the plugin's version; "
                 f"local changes are lost"], apply))
    return items


def _read(path: Path) -> str:
    """The file's text with its own line endings kept."""
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            return f.read()
    except (OSError, UnicodeDecodeError) as e:
        raise StepFailed(f"{path.parent.name}/{path.name} cannot be read "
                         f"({e.__class__.__name__})") from e


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
    stale = [n for n in canonical if n in mine and not _same(mine[n], canonical[n])]
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

    lines = ([f"update the {n} entry in _meta/entity-types.md" for n in stale]
             + [f"add the {n} entry to _meta/entity-types.md" for n in missing])
    return [Item("schema-mirror", CHOICE, lines, apply)]


# --- small per-release checks -------------------------------------------------

def find_wrapup_filenames(vault: Path) -> list[Item]:
    """Every pass: an old-pattern Wrap-Up filename. The rename needs every
    link to it rewritten, which the relink script (a later release) does."""
    rows = []
    for rel, text in vault_files(vault):
        if entity_type(extract_frontmatter(text) or {}) not in WRAP_TYPES:
            continue
        if any(f.level == "WARNING" for f in wrapup_filename_findings(rel)):
            rows.append(f"{rel}\told Wrap-Up filename "
                        f"(not Chapter_CC_Session_NN_Wrap_Up.md); renaming it "
                        f"means updating every link to it")
    return [Item("wrapup-filenames", PERSON, rows)] if rows else []


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
    """1.10.15: mobRPG keeps culture and race notes in `Heritages/`. Moving
    one breaks path links to it, so it is listed, not moved."""
    if _mobrpg_map(vault) is None:
        return []
    rows = [f"{rel}\ta mobRPG heritage note outside Heritages/; mobrpg "
            f"tracks them there. Moving it means updating path links to it"
            for rel, text in vault_files(vault)
            if entity_type(extract_frontmatter(text) or {}) in HERITAGE_TYPES
            and Path(rel).parts[0] != "Heritages"]
    return [Item("heritage-notes", PERSON, rows)] if rows else []


VAULT_CHECKS: list[Check] = [
    Check("templates", None, 3, "templates", find_templates,
          choices=("template:",)),
    Check("pc-template-sheet-source", "1.10.22", 3,
          "sheet_source in PC templates", find_pc_template_field),
    Check("schema-mirror", None, 3, "the schema mirror", find_schema_mirror,
          choices=("schema-mirror",)),
    Check("wrapup-filenames", None, 3, "Wrap-Up filenames",
          find_wrapup_filenames),
    Check("mobrpg-sections", "1.10.13", 3, "mobRPG vault-only sections",
          find_mobrpg_sections, choices=("mobrpg-sections",)),
    Check("heritage-notes", "1.10.15", 3, "mobRPG heritage notes",
          find_heritage_notes),
]

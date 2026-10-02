#!/usr/bin/env python3
"""migrate_vault.py: the migration checks that read and write vault files
alone: templates, the schema mirror, and the small per-release fixes."""

from __future__ import annotations

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


def _stat_block(kind: str, system: str | None) -> str:
    base = "coc-7e" if system == "coc-7e-regency" else system
    for folder in ((f"{kind}-stats", "npc-stats") if kind == "creature"
                   else ("npc-stats",)):
        path = TEMPLATES / folder / f"{base}.md"
        if base and path.is_file():
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


def expected_templates(vault: Path) -> dict[str, str]:
    """What `_Templates/` should hold: vault filename -> text."""
    system = vault_system(vault)
    out: dict[str, str] = {}
    for source, name in TEMPLATE_NAMES.items():
        text = (TEMPLATES / source).read_text(encoding="utf-8")
        if source in ("npc.md", "creature.md"):
            block = _stat_block(source[:-3], system)
            text = STAT_BLOCK_RE.sub(lambda _m: block, text, count=1)
        out[name] = text
    pc = f"pc-{system}.md" if system and (TEMPLATES / f"pc-{system}.md").is_file() \
        else "pc-generic.md"
    out[pc] = (TEMPLATES / pc).read_text(encoding="utf-8")
    if system == "fitd":
        out["crew-fitd.md"] = (TEMPLATES / "crew-fitd.md").read_text(
            encoding="utf-8")
    return out


def _same(a: str, b: str) -> bool:
    """Equal but for trailing blanks and runs of blank lines: a template a
    model copied by hand differs that way and no other."""
    def norm(text: str) -> str:
        lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return norm(a) == norm(b)


def find_templates(vault: Path) -> list[Item]:
    folder = vault / "_Templates"
    items: list[Item] = []
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
        if not _same(current, text):
            items.append(Item(
                f"template:{name}", CHOICE,
                [f"overwrite _Templates/{name} with the plugin's version; "
                 f"local changes are lost"], apply))
    return items


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
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
    start = re.search(rf"^{re.escape(SECTION)}[ \t]*$", text, re.M)
    if not start:
        return None
    nxt = re.search(r"^## ", text[start.end():], re.M)
    return start.end(), start.end() + nxt.start() if nxt else len(text)


def type_entries(text: str) -> dict[str, str]:
    """`**Type:** …` paragraphs under `## Type-Specific Fields`, by type."""
    span = _section_span(text)
    if span is None:
        return {}
    out: dict[str, str] = {}
    for para in re.split(r"\n[ \t]*\n", text[span[0]:span[1]]):
        para = para.strip("\n")
        m = ENTRY_RE.match(para)
        if m:
            out[m.group(1).strip()] = para
    return out


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
        for name in stale:
            new = new.replace(type_entries(new)[name], canonical[name], 1)
        order = list(canonical)
        for name in missing:
            have = type_entries(new)
            before = next((have[p] for p in reversed(order[:order.index(name)])
                           if p in have), None)
            if before is not None:
                new = new.replace(before, f"{before}\n\n{canonical[name]}", 1)
            else:
                span = _section_span(new)
                assert span is not None
                head = new[:span[0]].rstrip("\n")
                rest = new[span[0]:].lstrip("\n")
                new = f"{head}\n\n{canonical[name]}\n\n{rest}"
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
        data = json.loads((vault / MOBRPG_MAP).read_text(encoding="utf-8"))
    except (OSError, ValueError):
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
        write_text_atomic(
            vault / MOBRPG_MAP,
            json.dumps(fresh, indent=2, ensure_ascii=False) + "\n")
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

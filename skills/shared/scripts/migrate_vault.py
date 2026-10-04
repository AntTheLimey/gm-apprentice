#!/usr/bin/env python3
"""migrate_vault.py: the migration checks that read and write vault files
alone: templates, the schema mirror, and the small per-release fixes."""

from __future__ import annotations

import hashlib
import json
import posixpath
import re
from pathlib import Path

import relink
from migrate_core import (CHOICE, PERSON, WILL, Check, Item, StepFailed,
                          cells, edit_frontmatter, stopped, write_text_atomic)
from vault_check import (WRAP_TYPES, WrapDetail, check_wrapup,
                         player_section_key, wrapup_filename_findings)
from vaultlib import (_KEY_LINE_RE, _frontmatter_lines, entity_type,
                      extract_frontmatter, frontmatter_span, parse_publish_list,
                      parse_version, plugin_version, read_publish_scalar,
                      vault_files, wrapup_filename)

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

    lines = ([f"update the {n} entry in _meta/entity-types.md (your edits "
              f"inside that entry are replaced)" for n in stale]
             + [f"add the {n} entry to _meta/entity-types.md" for n in missing])
    return [Item("schema-mirror", CHOICE, lines, apply)]


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


def read_wrap_up_player_sections(vault: Path) -> list[str]:
    """`publish.wrap_up.player_sections` from `_meta/vault-config.md`: the
    extra H2 titles the vault declares player-facing on a Wrap-Up.

    The nested `wrap_up:` block is lifted out and read through
    `parse_publish_list`, so the list syntax is exactly the one the
    other publish lists accept. Absent, empty, null, unreadable or not a
    list all read as no extra sections — the Keeper-facing default.
    """
    try:
        text = (vault / CONFIG).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return []
    lines = [line.rstrip("\r\n") for line in (_frontmatter_lines(text) or [])]
    start = next((i for i, line in enumerate(lines)
                  if re.match(r"""^["']?publish["']?\s*:\s*(#.*)?$""", line)), None)
    if start is None:
        return []
    block: list[str] = []
    wrap_indent: int | None = None
    inside = False
    for line in lines[start + 1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            if inside:
                block.append(line)
            continue
        depth = len(line) - len(line.lstrip())
        if depth == 0:
            break                                    # the next top-level key
        m = _KEY_LINE_RE.match(line)
        if inside and depth > (wrap_indent or 0):
            block.append(line)
            continue
        inside = False
        if m and m.group(3) == "wrap_up" and not (m.group(4) or "").strip().split("#")[0].strip():
            inside, wrap_indent = True, depth
    if not block:
        return []
    cfg = parse_publish_list(["publish:"] + block, "player_sections")
    return [] if cfg.error else list(cfg.value or [])


def _drop_player_sections(fm: list[str], _eol: str) -> None:
    """Remove `publish.wrap_up.player_sections` (and `wrap_up:` when that
    leaves it empty) from vault-config's frontmatter lines, keeping every
    other line as it is. Line endings ride on the lines themselves."""
    def depth(line: str) -> int:
        return len(line) - len(line.lstrip())

    def block_end(start: int) -> int:
        end = start + 1
        while end < len(fm) and (not fm[end].strip()
                                 or depth(fm[end]) > depth(fm[start])):
            end += 1
        while end > start + 1 and not fm[end - 1].strip():
            end -= 1
        return end

    def key_at(name: str, lo: int, hi: int, indented: bool) -> int | None:
        for i in range(lo, hi):
            m = _KEY_LINE_RE.match(fm[i].rstrip("\r\n"))
            if m and m.group(3) == name and bool(m.group(1)) == indented:
                return i
        return None

    def list_end(start: int) -> int:
        """The key's block; a block list written at the key's own indent
        belongs to it too."""
        end = block_end(start)
        m = _KEY_LINE_RE.match(fm[start].rstrip("\r\n"))
        if m and not (m.group(4) or "").split("#")[0].strip():
            while True:
                probe = end
                while probe < len(fm) and (
                        not fm[probe].strip()
                        or fm[probe].lstrip().startswith("#")):
                    probe += 1
                if not (probe < len(fm)
                        and depth(fm[probe]) == depth(fm[start])
                        and re.match(r"-(\s|$)", fm[probe].strip())):
                    break
                end = block_end(probe)
        return end

    publish = key_at("publish", 0, len(fm), False)
    if publish is None:
        return
    wrap = key_at("wrap_up", publish + 1, block_end(publish), True)
    if wrap is None:
        return
    key = key_at("player_sections", wrap + 1, block_end(wrap), True)
    if key is None:
        return
    del fm[key:list_end(key)]
    if block_end(wrap) == wrap + 1:
        del fm[wrap]


def _name_headings(titles: list[str]) -> str:
    return ", ".join(f"'## {t}'" for t in titles)


def find_wrapup_sections(vault: Path) -> list[Item]:
    """1.10.28: a Wrap-Up H2 is Keeper-facing only under GM Notes. Under
    the reading before that, every H2 the vault did not list was Keeper
    content; those are offered once to be moved under GM Notes.

    The list is read here and never removed here: it must still be there
    when the choice is applied, and when this is asked again before the
    vault is stamped. `find_wrapup_sections_key` drops it a release later.
    A note with a fence the re-nest cannot handle, one the checker refuses
    to write, or one with no recap heading it recognises is never moved:
    it is for a person."""
    listed = read_wrap_up_player_sections(vault)
    player = frozenset(k for k in map(player_section_key, listed) if k)
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
            apply, wants="move or leave"))
    if person:
        items.append(Item("wrapup-sections-review", PERSON, person))
    return items


def find_wrapup_sections_key(vault: Path) -> list[Item]:
    """Every pass: `publish.wrap_up.player_sections` is no longer read.
    It goes once the vault is stamped 1.10.28 or later, so the migration
    that stamps 1.10.28 could still read it. Offered only when removing it
    would change the file."""
    config = vault / CONFIG
    text = _read(config).removeprefix("\ufeff")
    stamp = (extract_frontmatter(text) or {}).get("gm_apprentice_version")
    if (not stamp or isinstance(stamp, list)
            or parse_version(str(stamp)) < parse_version("1.10.28")):
        return []
    lines = text.splitlines(keepends=True)
    end, error = frontmatter_span(lines)
    if error:
        return []
    fm = lines[1:end]
    after = list(fm)
    _drop_player_sections(after, "")
    if after == fm:
        return []

    def apply(_value: str | None) -> list[str]:
        edit_frontmatter(config, _drop_player_sections)
        return [f"removed publish.wrap_up.player_sections from {CONFIG}"]

    return [Item("wrapup-sections-key", WILL,
                 [f"remove publish.wrap_up.player_sections from {CONFIG} "
                  f"(no longer read)"], apply)]


def find_skeleton(vault: Path) -> list[Item]:
    """Every pass: the folders and one-off pages a vault's skeleton lacks,
    as vault_scaffold.py defines it. Only adds. `_Templates/` files are the
    `templates` check's, and a file that exists is never touched."""
    import vault_scaffold as vs    # it imports this module

    found = plugin_version()
    try:
        pieces = [p for p in vs.missing(
            vault, vault_system(vault), campaign=vault.resolve().name,
            version=found[0] if found else "", templates=False)
            if p.rel != vs.CONFIG]
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


VAULT_CHECKS: list[Check] = [
    Check("skeleton", None, 3, "the vault skeleton", find_skeleton),
    Check("templates", None, 3, "templates", find_templates,
          choices=("template:",)),
    Check("pc-template-sheet-source", "1.10.22", 3,
          "sheet_source in PC templates", find_pc_template_field),
    Check("schema-mirror", None, 3, "the schema mirror", find_schema_mirror,
          choices=("schema-mirror",)),
    # A rename asks the site's publish tool (what it changes on the site), so
    # it waits for the repin: band 4, asks_site.
    Check("wrapup-filenames", None, 4, "Wrap-Up filenames",
          find_wrapup_filenames, asks_site=True,
          choices=("wrapup-filenames",)),
    # Re-nesting changes what the site shows, so it waits for the repin.
    Check("wrapup-sections", "1.10.28", 4, "Wrap-Up sections",
          find_wrapup_sections, asks_site=True,
          choices=("wrapup-sections=",)),
    Check("wrapup-sections-key", None, 2, "the retired player-sections list",
          find_wrapup_sections_key),
    Check("mobrpg-sections", "1.10.13", 3, "mobRPG vault-only sections",
          find_mobrpg_sections, choices=("mobrpg-sections",)),
    Check("heritage-notes", "1.10.15", 4, "mobRPG heritage notes",
          find_heritage_notes, asks_site=True,
          choices=("heritage-notes",)),
]

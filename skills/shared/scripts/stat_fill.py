#!/usr/bin/env python3
"""Write a stock D&D creature's SRD numbers into the NPC or creature note that names it.

    stat_fill.py VAULT NOTE... [--as "SRD NAME"] [--write]

A note whose `### Stats` only says "Commoner (SRD)" has no numbers the run
sheet can read. This looks the creature up in the shipped SRD 5.2 creature
files and writes its block, in the vault's own Stats form, in place of the
stock line. The GM's own words on that line ("Blinded.", "with a knife") and
any other line under the heading stay below the block, so a tuned HP line
still wins (the last HP figure is the one read).

One row a note, `STATUS<TAB>path<TAB>what`:

  FILLED         the creature's block was (or, without --write, would be) written
  UNCHANGED      the note already has numbers of its own
  NOT-FOUND      no SRD creature of that name
  REFUSED-MAJOR  a companion or a key NPC: they need a full workup
  NOT-DND        the vault's system is not D&D 5e (2024)
  NO-SRD         the creature files are not installed

The creature is `--as`, else the name the note's stock line gives, else the
note's `name`. It reads only the top-level `monsters-cr*.md` and `animals.md` files of
the D&D folder (never a `personal/` copy). It previews unless --write is given.
The SRD 5.2 is CC-BY 4.0 (see ATTRIBUTION.md).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import npc_stats  # noqa: E402
import section  # noqa: E402
import vault_write as vw  # noqa: E402
import vaultlib as vl  # noqa: E402
from install_layout import LAYOUT  # noqa: E402
from migrate_vault import vault_system  # noqa: E402

SYSTEM = "dnd-5e-2024"
SYSTEMS_DIR = LAYOUT.shared.parent / "ttrpg-expert" / "systems"
CREDIT = ("*Stats condensed from the SRD 5.2 by Wizards of the Coast LLC "
          "(dndbeyond.com/srd), CC-BY 4.0 "
          "(creativecommons.org/licenses/by/4.0/legalcode).*")
NO_SRD_LINE = ("the SRD creature files are not installed in this copy of the "
               "plugin; reinstall it")

ABILITIES = ("STR", "DEX", "CON", "INT", "WIS", "CHA")

HEAD_RE = re.compile(
    r"^\*\*(?P<name>[^*]+)\*\* \| (?P<type>[^|]+) \| (?P<size>[TSMLHG]) \| "
    r"CR (?P<cr>[\d/]+) \((?P<xp>[\d,]+) XP\)$")
TOP_RE = re.compile(
    r"^AC (?P<ac>\d+) \| HP (?P<hp>\d+) \((?P<dice>[^)]+)\)"
    r"(?: \| Init (?P<init>[+-]\d+ \(\d+\)))? \| Speed (?P<speed>.+)$")
SCORES_RE = re.compile(r"^(?:STR \d+ DEX \d+ CON \d+ INT \d+ WIS \d+ CHA \d+"
                       r"|\d+(?:/\d+){5})$")
SAVE_RE = re.compile(r"\b(STR|DEX|CON|INT|WIS|CHA) ([+-]\d+)")
# A spellcasting action names its ability (`Spellcasting (WIS, DC 13): ...`);
# a trait of that name has none.
SPELL_ACTION_RE = re.compile(r"^[^:]*\((?:STR|DEX|CON|INT|WIS|CHA), DC \d+\)"
                             r"|^[^:]*\(Recharge ")
RECHARGE_RE = re.compile(r"\(Recharge (\d)-(\d)\)")
STAT_TITLE_RE = npc_stats.STAT_TITLE_RE
SLOT_START_RE = re.compile(r"^\{STAT BLOCK:")
CR_NUMBER_RE = re.compile(r"^(\d+)(?:/(\d+))?$")


@dataclass
class Creature:
    name: str
    kind: str
    size: str
    cr: str
    xp: str
    ac: str
    hp: str
    dice: str
    init: str | None
    speed: str
    scores: list[int]
    saves: dict[str, str] = field(default_factory=dict)
    senses: str = ""
    defenses: list[tuple[str, str]] = field(default_factory=list)
    traits: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    bonus: list[str] = field(default_factory=list)
    reactions: list[str] = field(default_factory=list)
    legendary: list[str] = field(default_factory=list)


# --- reading the shipped creature files -----------------------------------

def srd_files(systems_dir: Path) -> list[Path]:
    """The top-level `monsters-cr*.md` and `animals.md` of the D&D folder:
    never a subfolder's copy, so a `personal/` file is never read."""
    folder = systems_dir / SYSTEM
    return [*sorted(folder.glob("monsters-cr*.md")),
            *(p for p in (folder / "animals.md",) if p.is_file())]


def split_top(text: str, sep: str = ", ") -> list[str]:
    """`text` split at `sep` outside parentheses."""
    parts: list[str] = []
    depth, start = 0, 0
    for i, ch in enumerate(text):
        depth += ch == "("
        depth -= ch == ")"
        if depth == 0 and text.startswith(sep, i):
            parts.append(text[start:i])
            start = i + len(sep)
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def parse_block(lines: list[str]) -> Creature | None:
    head = HEAD_RE.match(lines[0]) if lines else None
    top = TOP_RE.match(lines[1]) if len(lines) > 1 else None
    if head is None or top is None or len(lines) < 3 \
            or not SCORES_RE.match(lines[2]):
        return None
    scores = [int(n) for n in re.findall(r"\d+", lines[2])]
    c = Creature(head["name"], head["type"].strip(), head["size"],
                 head["cr"], head["xp"], top["ac"], top["hp"], top["dice"],
                 top["init"], top["speed"].strip(), scores)
    started = False        # past the traits: legendary, multiattack, attacks
    for line in lines[3:]:
        if line.startswith("Saves: "):
            saves, _, senses = line[7:].partition(" | Senses: ")
            c.saves = {k: v for k, v in SAVE_RE.findall(saves)}
            c.senses = senses
        elif line.startswith("Senses: "):
            c.senses = line[8:]
        elif line.startswith(("Resistances: ", "Immunities: ",
                              "Vulnerabilities: ")) and not started:
            for part in line.split(" | "):
                key, _, value = part.partition(": ")
                c.defenses.append((key, value))
        elif line.startswith("Legendary ("):
            started = True
            c.legendary = split_top(line.partition(": ")[2])
        elif line.startswith("- [B] "):
            started = True
            c.bonus.append(line[6:])
        elif line.startswith("- [R] "):
            started = True
            c.reactions.append(line[6:])
        elif line.startswith("- "):
            started = True
            c.actions.append(line[2:])
        elif line.startswith("Multiattack: "):
            started = True
            c.actions.insert(0, line)
        elif started or SPELL_ACTION_RE.match(line):
            started = True
            c.actions.append(line)
        else:
            c.traits.append(line)
    return c


def load_srd(systems_dir: Path) -> dict[str, Creature]:
    """Every shipped creature by its casefolded name."""
    found: dict[str, Creature] = {}
    for path in srd_files(systems_dir):
        block: list[str] = []
        for line in [*path.read_text(encoding="utf-8").splitlines(), ""]:
            if line.strip():
                block.append(line)
                continue
            creature = parse_block(block)
            if creature is not None:
                found[creature.name.casefold()] = creature
            block = []
    return found


def lookup(srd: dict[str, Creature], name: str, exact: bool
           ) -> Creature | None:
    """The creature `name` names. A stock line's words may carry extra
    ones (`A tough Commoner`), so each run of its words is tried, longest
    first; `--as` is exact."""
    words = name.split()
    if exact:
        return srd.get(" ".join(words).casefold())
    for size in range(len(words), 0, -1):
        for at in range(len(words) - size + 1):
            hit = srd.get(" ".join(words[at:at + size]).casefold())
            if hit is not None:
                return hit
    return None


# --- writing a block ----------------------------------------------------------

def proficiency(cr: str) -> int:
    m = CR_NUMBER_RE.match(cr)
    value = int(m[1]) / int(m[2]) if m and m[2] else int(m[1]) if m else 0
    return 2 + max(0, int(value) - 1) // 4


def signed(n: int) -> str:
    return f"{n:+d}"


def monster_line(entry: str) -> str:
    """`Name: text` or `Name` as a bullet; a recharge range gets its en dash."""
    name, sep, rest = entry.partition(": ")
    if not sep and ")" in entry and entry.startswith("Multiattack"):
        name, rest = "Multiattack", entry
    name = RECHARGE_RE.sub(r"(Recharge \1–\2)", name)
    return f"- ***{name}.*** {rest}".rstrip() if sep or rest \
        else f"- ***{name}.***"


def actions_block(c: Creature) -> list[str]:
    out: list[str] = []
    for heading, items in (("Traits", c.traits), ("Actions", c.actions),
                           ("Bonus Actions", c.bonus),
                           ("Reactions", c.reactions)):
        if not items:
            continue
        out += ["", f"**{heading}**"]
        for entry in items:
            if entry.startswith("Multiattack: "):
                out.append(f"- ***Multiattack.*** {entry[13:]}")
            else:
                out.append(monster_line(entry))
    if c.legendary:
        out += ["", "**Legendary Actions (3)**"]
        for entry in c.legendary:
            m = re.match(r"^(.*?) \((.*)\)$", entry)
            out.append(f"- ***{m[1]}.*** {m[2]}" if m
                       else f"- ***{entry}.***")
    return out


def stats_block(c: Creature) -> list[str]:
    """The creature in the vault's Stats form, as lines."""
    out = [f"**{c.name}**", ""]
    init = f" · **Initiative** {c.init}" if c.init else ""
    out += [f"**AC** {c.ac}{init} · **HP** {c.hp} ({c.dice}) · "
            f"**Speed** {c.speed}", "",
            "|     | Score | Mod | Save |", "|-----|-------|-----|------|"]
    for name, score in zip(ABILITIES, c.scores):
        mod = (score - 10) // 2
        out.append(f"| {name} | {score} | {signed(mod)} | "
                   f"{c.saves.get(name, signed(mod))} |")
    out.append("")
    if c.senses:
        out.append(f"**Senses** {c.senses}")
    if c.defenses:
        out.append(" · ".join(f"**{k}** {v}" for k, v in c.defenses))
    out.append(f"**CR** {c.cr} (XP {c.xp}; PB +{proficiency(c.cr)})")
    out += actions_block(c)
    return out


# --- placing it in the note -------------------------------------------------

def old_section(doc: vw.Doc, rel: str, gm: tuple[int, int]
                ) -> tuple[vw.Head | None, int]:
    """(the first stat heading, where its section ends); the heading is None
    when the note has none. A heading outside GM Notes is refused: numbers
    written there would publish."""
    head = next((h for h in doc.heads if STAT_TITLE_RE.search(h.title)), None)
    if head is None:
        return None, 0
    if not gm[0] < head.idx < gm[1]:
        raise vw.WriteError(f"{rel}: its stat heading '{head.title}' is "
                            f"outside ## GM Notes; move it in first")
    return head, vw.section_end(doc, head)


def _tidy(out: list[str]) -> list[str]:
    tidy: list[str] = []
    for line in out:
        if line.strip() or (tidy and tidy[-1].strip()):
            tidy.append(line)
    while tidy and not tidy[-1].strip():
        tidy.pop()
    return tidy


def kept_lines(old: list[str]) -> list[str]:
    """What the GM wrote under a stock block, to sit below the new one: the
    words of the stock line, then every other line as it was."""
    out: list[str] = []
    done = False
    for line in old:
        stock = None if done else npc_stats._stock(line)
        if stock is not None:
            done = True
            if stock.words:
                out.insert(0, f"**As written:** {stock.words}")
        else:
            out.append(line)
    return _tidy(out)


_FILLER_RE = re.compile(r"\b(?:is|are|the|for|a|an|this|his|her|their|its|"
                        r"of|to|be|yet|here|stats?|stat ?blocks?)\b", re.I)


def _bare_deferral(line: str) -> bool:
    """Nothing in the line but deferral words (`Stats to come.`, `TBD`)."""
    rest = _FILLER_RE.sub("", npc_stats.DEFER_RE.sub("", line))
    return not re.search(r"\w", rest)


def kept_beside_placeholder(old: list[str]) -> list[str]:
    """What the GM wrote under a placeholder or blank block: every line but
    the bare deferral line (`Stats to come.`), embeds and an unfilled system
    template (`{...}` fields, an empty score table, its bare heads). A line
    that defers and says more (`Stats to come; he fights with a boat hook.`)
    stays whole under **As written:**; one whose only deferral word is an
    ordinary one (`Later, if it comes to blows, ...`) stays as it was. Any
    other table is the GM's own and stays."""
    lines = [ln for ln in old if npc_stats.DEFER_RE.search(ln)]
    drop = next((ln for ln in lines if _bare_deferral(ln)), None)
    said: str | None = None
    if drop is None:
        drop = next((ln for ln in lines if npc_stats._standalone(ln)), None)
        if drop is None:
            drop = next((ln for ln in lines
                         if npc_stats.STAT_WORD_RE.search(ln)), None)
        if drop is not None:
            said = " ".join(drop.split())
        drop = drop if said else None
    out: list[str] = []
    gone = False
    run: list[str] = []

    def flush() -> None:
        # A table run: an empty score table is the template's, any other is
        # the GM's own.
        if run and not npc_stats._blank_table("\n".join(run)):
            out.extend(run)
        run.clear()

    for line in old:
        if line.lstrip().startswith("|"):
            run.append(line)
            continue
        flush()
        if not gone and line is drop:
            gone = True
        elif not (npc_stats.EMBED_RE.search(line)
                  or npc_stats.BRACE_RE.search(line)):
            out.append(line)
    flush()
    if said:
        out.insert(0, f"**As written:** {npc_stats._unlabelled(said)}")
    return _tidy(_without_bare_heads(out))


# The bold heads the shipped npc-stats templates use (templates/npc-stats/).
_BARE_HEAD_RE = re.compile(
    r"^\*\*(?:Traits|Actions|Attacks|Combat|Bonus Actions / Reactions)\*\*:?"
    r"\s*$")


def _without_bare_heads(lines: list[str]) -> list[str]:
    """The template's bold heads (`**Traits**`) left with nothing under
    them once its field lines are gone."""
    keep: list[str] = []
    for i, line in enumerate(lines):
        if _BARE_HEAD_RE.match(line):
            nxt = next((ln for ln in lines[i + 1:] if ln.strip()), None)
            if nxt is None or _BARE_HEAD_RE.match(nxt):
                continue
        keep.append(line)
    return keep


def written(text: str, rel: str, c: Creature, stock_words: str | None
            ) -> str:
    """The note's text with the creature's block as its `### Stats`."""
    doc = vw.parse(text)
    gm_head, _opener, closer = vw.gm_region(doc, rel)
    head, end = old_section(doc, rel, (gm_head.idx, closer))
    keep: list[str] = []
    if head is not None:
        old = [ln.rstrip("\r\n") for ln in doc.lines[head.idx + 1:end]]
        verdict = npc_stats.classify(text, SYSTEM)
        if verdict is not None:
            keep = (kept_lines(old) if verdict[0] == "stock"
                    else kept_beside_placeholder(old))
    elif stock_words:
        keep = [f"**As written:** {stock_words}"]
    unit = ["### Stats", "", *stats_block(c)]
    if keep:
        unit += ["", *keep]
    unit += ["", CREDIT]
    if head is not None:
        return vw._replace(doc, head, unit)[0]
    # A new section opens GM Notes, where the template's block slot is.
    lines = [ln.rstrip("\r\n") for ln in doc.lines]
    at = next((h.idx for h in doc.heads
               if gm_head.idx < h.idx < closer), closer)
    slot = next((i for i in range(gm_head.idx + 1, at)
                 if SLOT_START_RE.match(lines[i])), None)
    if slot is not None:
        stop = slot
        while stop < at and "}" not in lines[stop]:
            stop += 1
        doc = vw.parse("".join(doc.lines[:slot] + doc.lines[stop + 1:]))
        at -= stop + 1 - slot
    return vw.place(doc, at, unit)


# --- the command -------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("vault", type=Path, help="the vault folder")
    ap.add_argument("notes", nargs="+", metavar="note",
                    help="an NPC or creature note: a vault-relative path, "
                         "name or alias")
    ap.add_argument("--as", dest="creature", metavar="NAME",
                    help="the SRD creature to write, in place of the one the "
                         "note names")
    ap.add_argument("--write", action="store_true",
                    help="write the blocks into the notes (default: preview)")
    ap.add_argument("--systems-dir", type=Path, default=SYSTEMS_DIR,
                    help="the systems folder to read")
    ap.epilog = 'Example: gma stat-fill "<vault>" "<note>" --write'
    return ap


def main(argv: list[str] | None = None) -> int:
    vl.utf8_output()
    args = build_parser().parse_args(argv)
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    batch = vw.Batch(args.vault)
    system = vault_system(args.vault)
    srd = load_srd(args.systems_dir) if system == SYSTEM else {}
    notes = npc_stats.Notes(args.vault)
    major = {rel: why for why, group in (
        ("companion", {rel for rel, _t, fm in notes.npcs
                       if npc_stats._is_true(fm.get("companion"))}),
        ("key-npc", npc_stats.key_npcs(notes))) for rel in group}
    names = section.name_index(vl.vault_files(args.vault))
    rows: list[str] = []
    errors = 0
    filled = 0
    try:
        for raw in args.notes:
            try:
                rel = section.resolve_note(batch, raw, names)
                row = fill_one(batch, rel, args, system, srd, major)
            except vw.WriteError as e:
                row = f"ERROR\t{raw}\t{e}"
            errors += row.startswith("ERROR")
            filled += row.startswith("FILLED")
            rows.append(row)
        vw.check_fences(batch)
        if args.write and not errors:
            vw.apply(batch)
    except vw.WriteError as e:
        print(f"ERROR\t{e}")
        print("# nothing written")
        return 1
    print("\n".join(rows))
    if errors:
        print("# nothing written")
    elif filled and not args.write:
        print("# dry run: nothing written (add --write)")
    return 1 if errors else 0


def fill_one(batch: vw.Batch, rel: str, args: argparse.Namespace,
             system: str | None, srd: dict[str, Creature],
             major: dict[str, str]) -> str:
    if system != SYSTEM:
        return f"NOT-DND\t{rel}\tthe vault's system is {system or 'not set'}"
    if not srd:
        return f"NO-SRD\t{rel}\t{NO_SRD_LINE}"
    text = batch.read(rel)
    verdict = npc_stats.classify(text, system)
    if verdict is None:
        return f"UNCHANGED\t{rel}\talready has numbers"
    if rel in major:
        return (f"REFUSED-MAJOR\t{rel}\t{major[rel]}: needs a full workup, "
                f"not a stock block")
    stock = npc_stats.note_stock(text)
    fm = vl.extract_frontmatter(text) or {}
    if args.creature:
        wanted, exact = args.creature, True
    elif stock is not None:
        wanted, exact = stock.name, False
    else:
        wanted, exact = str(fm.get("name") or Path(rel).stem), True
    creature = lookup(srd, wanted, exact)
    if creature is None:
        return f"NOT-FOUND\t{rel}\tno SRD creature named \"{wanted}\""
    batch.put(rel, written(text, rel, creature,
                           stock.words if stock else None))
    return f"FILLED\t{rel}\t{creature.name}"


if __name__ == "__main__":
    sys.exit(main())

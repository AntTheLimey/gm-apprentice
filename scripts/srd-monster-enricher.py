#!/usr/bin/env python3
"""Transform SRD 5.2 monster stat blocks into compact enriched reference format."""

import argparse
import re
import sys
from pathlib import Path

OUT_DIR = Path("skills/ttrpg-expert/systems/dnd-5e-2024")
MAX_REF_BYTES = 25 * 1024

SIZE_MAP = {"Tiny": "T", "Small": "S", "Medium": "M", "Large": "L", "Huge": "H", "Gargantuan": "G"}

TIERS = {
    "cr0-1":     {"label": "CR 0–1", "min": 0, "max": 1},
    "cr2-4":     {"label": "CR 2–4", "min": 2, "max": 4},
    "cr5-10":    {"label": "CR 5–10", "min": 5, "max": 10},
    "cr11-16":   {"label": "CR 11–16", "min": 11, "max": 16},
    "cr17-plus": {"label": "CR 17+", "min": 17, "max": 999},
}

CR_XP = {
    0: 0, 0.125: 25, 0.25: 50, 0.5: 100,
    1: 200, 2: 450, 3: 700, 4: 1100,
    5: 1800, 6: 2300, 7: 2900, 8: 3900,
    9: 5000, 10: 5900, 11: 7200, 12: 8400,
    13: 10000, 14: 11500, 15: 13000, 16: 15000,
    17: 18000, 18: 20000, 19: 22000, 20: 25000,
    21: 33000, 22: 41000, 23: 50000, 24: 62000,
    25: 75000, 26: 90000, 27: 105000, 28: 120000,
    29: 135000, 30: 155000,
}

CR_LABELS = {
    0: "0", 0.125: "1/8", 0.25: "1/4", 0.5: "1/2",
}


def parse_cr(cr_line):
    m = re.search(r'\*\*CR\*\*\s*(\d+(?:/\d+)?)', cr_line)
    if not m:
        return 0
    cr_str = m.group(1)
    if '/' in cr_str:
        n, d = cr_str.split('/')
        return int(n) / int(d)
    return int(cr_str)


def cr_display(cr_val):
    return CR_LABELS.get(cr_val, str(int(cr_val)))


def xp_display(cr_val):
    xp = CR_XP.get(cr_val, 0)
    return f"{xp:,}"


def parse_monsters(text):
    parts = re.split(r'^(## .+)$', text, flags=re.MULTILINE)
    monsters = []
    for i in range(1, len(parts) - 1, 2):
        name = parts[i].replace('## ', '').strip()
        body = parts[i + 1].strip()
        monsters.append(parse_one(name, body))
    return monsters


def parse_one(name, body):
    m = {}
    m['name'] = name
    lines = body.split('\n')

    # Type line: *Size Type (Subtype), Alignment*
    type_match = re.match(r'\*(\w+)\s+(.+?)(?:,\s*.+)?\*', lines[0])
    if type_match:
        m['size'] = SIZE_MAP.get(type_match.group(1), 'M')
        raw_type = type_match.group(2).strip()
        # Clean subtype: "Dragon (Chromatic)" -> "Dragon"
        raw_type = re.sub(r'\s*\([^)]*\)', '', raw_type)
        m['type'] = raw_type
    else:
        m['size'] = 'M'
        m['type'] = 'Unknown'

    # AC
    ac_match = re.search(r'\*\*Armor Class:\*\*\s*(\d+)', body)
    m['ac'] = ac_match.group(1) if ac_match else '10'

    # HP
    hp_match = re.search(r'\*\*Hit Points:\*\*\s*(\d+)\s*\(([^)]+)\)', body)
    if hp_match:
        m['hp'] = hp_match.group(1)
        m['hp_dice'] = hp_match.group(2).replace(' ', '')
    else:
        m['hp'] = '1'
        m['hp_dice'] = '1d4'

    # Speed
    spd_match = re.search(r'\*\*Speed:\*\*\s*(.+)', body)
    m['speed'] = spd_match.group(1).strip() if spd_match else '30 ft.'

    # Stats from table
    m['stats'] = {}
    for stat in ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']:
        pat = rf'\|\s*{stat}\s*\|\s*(\d+)\s*\|\s*([+-]?\d+)\s*\|\s*([+-]?\d+)\s*\|'
        sm = re.search(pat, body)
        if sm:
            score = int(sm.group(1))
            mod_val = int(sm.group(2))
            save_val = int(sm.group(3))
            m['stats'][stat] = score
            if save_val != mod_val:
                m.setdefault('saves', {})[stat] = save_val

    # CR
    m['cr'] = parse_cr(body)

    # Immunities (damage and condition)
    imm_match = re.search(r'\*\*Immunities\*\*:\s*(.+)', body)
    if imm_match:
        m['immunities'] = imm_match.group(1).strip()

    # Resistances
    res_match = re.search(r'\*\*Resistances\*\*:\s*(.+)', body)
    if res_match:
        m['resistances'] = res_match.group(1).strip()

    # Vulnerabilities
    vul_match = re.search(r'\*\*Vulnerabilities\*\*:\s*(.+)', body)
    if vul_match:
        m['vulnerabilities'] = vul_match.group(1).strip()

    # Senses
    sens_match = re.search(r'\*\*Senses\*\*:\s*(.+)', body)
    if sens_match:
        raw = sens_match.group(1).strip()
        # Remove "Passive Perception XX" part
        raw = re.sub(r';\s*Passive Perception \d+', '', raw).strip()
        if raw:
            m['senses'] = raw

    # Sections
    sections = {}
    current_section = None
    section_lines = []
    for line in lines:
        sec_match = re.match(r'^### (.+)', line)
        if sec_match:
            if current_section:
                sections[current_section] = '\n'.join(section_lines)
            current_section = sec_match.group(1).strip()
            section_lines = []
        elif current_section:
            section_lines.append(line)
    if current_section:
        sections[current_section] = '\n'.join(section_lines)

    m['traits'] = parse_traits(sections.get('Traits', ''))
    m['actions'] = parse_actions(sections.get('Actions', ''))
    m['bonus_actions'] = parse_actions(sections.get('Bonus Actions', ''))
    m['reactions'] = parse_actions(sections.get('Reactions', ''))
    m['legendary'] = parse_legendary(sections.get('Legendary Actions', ''))

    return m


def parse_traits(text):
    if not text.strip():
        return []
    traits = []
    for match in re.finditer(r'\*\*\*(.+?)\.\*\*\*\s*(.+?)(?=\n\n\*\*\*|\n\n###|\Z)', text, re.DOTALL):
        name = match.group(1).strip()
        desc = match.group(2).strip()
        desc = re.sub(r'\s+', ' ', desc)
        traits.append((name, desc))
    return traits


def parse_actions(text):
    if not text.strip():
        return []
    actions = []
    for match in re.finditer(r'\*\*\*(.+?)\.\*\*\*\s*(.+?)(?=\n\n\*\*\*|\n\n###|\Z)', text, re.DOTALL):
        name = match.group(1).strip()
        desc = match.group(2).strip()
        desc = re.sub(r'\s+', ' ', desc)
        actions.append((name, desc))
    return actions


def parse_legendary(text):
    if not text.strip():
        return []
    actions = []
    for match in re.finditer(r'\*\*\*(.+?)\.\*\*\*\s*(.+?)(?=\n\n\*\*\*|\n\n###|\Z)', text, re.DOTALL):
        name = match.group(1).strip()
        desc = match.group(2).strip()
        desc = re.sub(r'\s+', ' ', desc)
        actions.append((name, desc))
    return actions


def format_attack(name, desc, budget_tight=False):
    """Format an attack or ability into compact form."""
    # Melee/Ranged attack — allow parenthetical after +N (e.g. "+5 (with Advantage ...)")
    atk_match = re.search(
        r'\*(Melee|Ranged)(?: or (?:Melee|Ranged))? Attack Roll:\*\s*\+(\d+)'
        r'(?:\s*\([^)]*\))?'
        r',?\s*(?:reach\s*(\d+)\s*ft\.?)?'
        r'(?:,?\s*(?:or\s+)?range\s*[\d/]+\s*ft\.?)?'
        r'\s*(\d+)\s*\(([^)]+)\)\s*(\w+)\s*damage',
        desc
    )

    if atk_match:
        hit = atk_match.group(2)
        reach = atk_match.group(3)
        dice = atk_match.group(5).replace(' ', '')
        dmg_type = atk_match.group(6).lower()

        parts = [f"- {name}: +{hit}"]
        if reach and int(reach) > 5:
            parts[0] += f", reach {reach} ft."
        parts[0] += f", {dice} {dmg_type}"

        extra = desc[atk_match.end():]
        plus_match = re.search(r'plus\s+(\d+)\s*\(([^)]+)\)\s*(\w+)\s*damage', extra)
        if plus_match:
            parts[0] += f" + {plus_match.group(2).replace(' ', '')} {plus_match.group(3).lower()}"

        # Check for save effects
        save_match = re.search(r'\*([\w]+)\s*Saving Throw\*:\s*DC\s*(\d+)', extra)
        if save_match:
            save_type = save_match.group(1)[:3].upper()
            dc = save_match.group(2)
            fail_match = re.search(r'\*Failure:\*\s*(.+?)(?:\*Success|\Z)', extra, re.DOTALL)
            if fail_match:
                effect = fail_match.group(1).strip()
                effect = re.sub(r'\s+', ' ', effect)
                parts[0] += f"; DC {dc} {save_type} or {summarize_effect(effect, budget_tight)}"
            else:
                parts[0] += f"; DC {dc} {save_type}"

        # Check for grapple condition (no save, just condition text)
        if 'Grappled condition' in extra and 'escape DC' in extra:
            esc_match = re.search(r'escape DC (\d+)', extra)
            if esc_match:
                parts[0] += f"; grapple (escape DC {esc_match.group(1)})"

        return parts[0]

    # Attack roll with no damage (Roper Tentacle style — grapple on hit)
    atk_nodmg = re.search(
        r'\*(Melee|Ranged)(?: or (?:Melee|Ranged))? Attack Roll:\*\s*\+(\d+)'
        r'(?:\s*\([^)]*\))?'
        r',?\s*(?:reach\s*(\d+)\s*ft\.?)?',
        desc
    )
    if atk_nodmg and 'damage' not in desc.split('Attack Roll')[0]:
        hit = atk_nodmg.group(2)
        reach = atk_nodmg.group(3)
        result = f"- {name}: +{hit}"
        if reach and int(reach) > 5:
            result += f", reach {reach} ft."
        if 'Grappled condition' in desc:
            esc_match = re.search(r'escape DC (\d+)', desc)
            esc = f" (escape DC {esc_match.group(1)})" if esc_match else ""
            result += f", grapple{esc}"
            if 'Poisoned condition' in desc:
                result += " + poisoned"
        return result

    # Save-based ability with damage (breath weapon, etc.)
    save_match = re.search(
        r'\*([\w]+)\s*Saving Throw\*:\s*DC\s*(\d+),\s*(.+?)\.\s*\*Failure:\*\s*(\d+)\s*\(([^)]+)\)\s*(\w+)\s*damage',
        desc
    )
    if save_match:
        save_type = save_match.group(1)[:3].upper()
        dc = save_match.group(2)
        area = save_match.group(3).strip()
        area = re.sub(r'each creature (?:that [^.]+? )?in (?:a |an )?', '', area)
        area = area.replace('-foot', '-ft').replace(' Cone', ' cone').replace(' Line', ' line')
        area = area.replace(', 5-ft-wide', '')
        dice = save_match.group(5).replace(' ', '')
        dmg_type = save_match.group(6).lower()
        half = " (half)" if "Half damage" in desc else ""
        return f"- {name}: {area}, DC {dc} {save_type}, {dice} {dmg_type}{half}"

    # Save-based ability with *First Failure*/*Second Failure* (petrification, paralysis)
    first_fail = re.search(
        r'\*([\w]+)\s*Saving Throw\*:\s*DC\s*(\d+),\s*(.+?)\.\s*\*First Failure',
        desc
    )
    if first_fail:
        save_type = first_fail.group(1)[:3].upper()
        dc = first_fail.group(2)
        area = first_fail.group(3).strip()
        area = re.sub(r'each creature (?:that [^.]+? )?in (?:a |an )?', '', area)
        area = area.replace('-foot', '-ft').replace(' Cone', ' cone').replace(' Line', ' line')
        first_eff = re.search(r'\*First Failure\*?\s*(.+?)\s*\*Second Failure', desc, re.DOTALL)
        second_eff = re.search(r'\*Second Failure\*?\s*(.+?)(?:\n\n|\Z)', desc, re.DOTALL)
        effects = []
        if first_eff:
            eff = re.sub(r'\s+', ' ', first_eff.group(1).strip()).rstrip('.')
            eff = re.sub(r'The target has the ', '', eff)
            eff = re.sub(r' condition.*', '', eff)
            effects.append(f"1st: {eff}")
        if second_eff:
            eff = re.sub(r'\s+', ' ', second_eff.group(1).strip()).rstrip('.')
            eff = re.sub(r'The target has the ', '', eff)
            eff = re.sub(r' condition.*', '', eff)
            effects.append(f"2nd: {eff}")
        eff_str = '; '.join(effects) if effects else ''
        if budget_tight:
            eff_str = '; '.join(e.split(',')[0] for e in effects) if effects else ''
        if area:
            return f"- {name}: {area}, DC {dc} {save_type}, {eff_str}"
        return f"- {name}: DC {dc} {save_type}, {eff_str}"

    # Save-based ability with condition effect but no damage
    save_cond = re.search(
        r'\*([\w]+)\s*Saving Throw\*:\s*DC\s*(\d+),?\s*(.+?)\.\s*\*Failure:\*\s*(.+?)(?:\*Success:\*\s*(.+?))?(?:\n\n|\Z)',
        desc, re.DOTALL
    )
    if save_cond:
        save_type = save_cond.group(1)[:3].upper()
        dc = save_cond.group(2)
        area = save_cond.group(3).strip()
        area = re.sub(r'each creature (?:that [^.]+? )?in (?:a |an )?', '', area)
        area = area.replace('-foot', '-ft').replace(' Cone', ' cone').replace(' Line', ' line')
        fail_text = re.sub(r'\s+', ' ', save_cond.group(4).strip())
        eff = summarize_effect(fail_text, budget_tight)
        if area and not area.startswith('one'):
            return f"- {name}: {area}, DC {dc} {save_type}, {eff}"
        return f"- {name}: DC {dc} {save_type}, {eff}"

    # Spellcasting-style special ability ("casts *Spell*")
    spell_match = re.search(r'casts? \*([^*]+)\*.*?(?:spell save DC|save DC|DC)\s*(\d+)', desc)
    if spell_match:
        spell_name = spell_match.group(1)
        dc = spell_match.group(2)
        level_match = re.search(r'level (\d+) version', desc)
        level_str = f" (level {level_match.group(1)})" if level_match else ""
        replace_match = re.search(r'replace one .+ with \*([^*]+)\*(?:\s*or \*([^*]+)\*)?', desc)
        extras = ""
        if replace_match:
            alts = [replace_match.group(1)]
            if replace_match.group(2):
                alts.append(replace_match.group(2))
            extras = f" or {'/'.join(alts)}"
        return f"- {name}: casts {spell_name}{level_str} (DC {dc}){extras}"

    return None


def summarize_effect(text, tight=False):
    text = re.sub(r'The target has the\s+', '', text)
    text = re.sub(r'until the end of its next turn', '1 turn', text)
    text = re.sub(r'for \d+ minutes?', lambda m: m.group(0), text)
    text = re.sub(r' condition(?=\s+(?:until|for|and|,))', '', text)
    text = text.strip().rstrip('.')
    limit = 60 if tight else 120
    if len(text) > limit:
        sent_end = text.rfind('.', 0, limit)
        if sent_end > 30:
            text = text[:sent_end + 1]
        else:
            text = text[:limit - 3] + '...'
    return text


def format_multiattack(desc):
    """Summarize multiattack description."""
    desc = re.sub(r'The \w+ makes ', '', desc)
    desc = re.sub(r'It can replace .+', '', desc).strip().rstrip('.')
    desc = desc.replace(' attacks', '')
    desc = desc.replace(' attack', '')
    # Handle "three, using X or Y in any combination"
    combo_match = re.match(r'(two|three|four|\d+),\s*using (.+?)(?:\s+in any combination)?$', desc)
    if combo_match:
        count = {'two': '2', 'three': '3', 'four': '4'}.get(combo_match.group(1), combo_match.group(1))
        options = combo_match.group(2).replace(', or ', '/').replace(' or ', '/')
        return f"{count}× ({options})"
    desc = re.sub(r'(?:two|2)\s+(\w+)', r'2× \1', desc)
    desc = re.sub(r'(?:three|3)\s+(\w+)', r'3× \1', desc)
    desc = re.sub(r'(?:four|4)\s+(\w+)', r'4× \1', desc)
    desc = re.sub(r' and uses? ', ' + ', desc)
    desc = re.sub(r' and ', ' + ', desc)
    return desc.strip()


def format_trait(name, desc, budget_tight=False):
    """Format a trait into compact form. Returns None to skip."""
    # Skip flavor-only traits
    skip_always = {'Amphibious', 'Echolocation', 'False Appearance',
                   'Mimicry', 'Keen Smell', 'Keen Hearing',
                   'Keen Hearing and Sight', 'Hold Breath',
                   'Eldritch Restoration', 'Probing Telepathy',
                   'Ethereal Sight', 'Water Breathing',
                   'Illumination', 'Labyrinthine Recall',
                   'Diabolical Restoration', 'Elemental Restoration',
                   'Sure-Footed', 'Brave', 'Transparent'}

    skip_tight_only = {'Angelic Weapons', 'Elemental Demise',
                       'Devil\'s Sight', 'Wishes', 'Heated Body',
                       'Trampling Charge', 'Tunneler'}

    keep_tight = {'Legendary Resistance', 'Magic Resistance', 'Regeneration',
                  'Frightful Presence', 'Pack Tactics', 'Spider Climb',
                  'Undead Fortitude', 'Shapechanger', 'Flyby',
                  'Siege Monster', 'Incorporeal Movement'}

    if name in skip_always:
        return None
    if budget_tight:
        if name in skip_tight_only:
            return None
        if not any(name.startswith(k) for k in keep_tight):
            return None

    # Legendary Resistance
    if name.startswith('Legendary Resistance'):
        uses = re.search(r'(\d+)/Day', name)
        if uses:
            return f"Legendary Resistance ({uses.group(1)}/Day)"
        return f"Legendary Resistance"

    # Magic Resistance
    if name == 'Magic Resistance':
        return "Magic Resistance (advantage on saves vs spells)"

    # Regeneration
    if name == 'Regeneration':
        hp_match = re.search(r'regains (\d+)', desc)
        negate = re.search(r'takes? (\w+)(?: or (\w+))? damage', desc)
        parts = f"Regeneration: {hp_match.group(1)} HP/turn" if hp_match else "Regeneration"
        if negate:
            neg = negate.group(1)
            if negate.group(2):
                neg += f" or {negate.group(2)}"
            parts += f"; negated by {neg}"
        return parts

    # Pack Tactics, Spider Climb, etc. - just name
    simple_traits = {'Pack Tactics', 'Spider Climb', 'Siege Monster',
                     'Shapechanger', 'Flyby', 'Sunlight Sensitivity',
                     'Undead Fortitude', 'Incorporeal Movement',
                     'Web Walker', 'Web Sense', 'Petrification Immunity'}
    if name in simple_traits:
        return name

    # Innate spellcasting / spellcasting in traits
    if 'Spellcasting' in name:
        return format_spellcasting_trait(name, desc)

    # Damage transfer, frightful presence, etc - compact summary
    if 'Frightful Presence' in name:
        dc_match = re.search(r'DC\s*(\d+)', desc)
        range_match = re.search(r'(\d+)[- ]foot', desc)
        if dc_match and range_match:
            return f"Frightful Presence: {range_match.group(1)} ft., DC {dc_match.group(1)} WIS"
        return name

    # For other traits, give a very compact summary
    if budget_tight:
        # Just the name for budget mode
        return name if len(name) < 40 else None

    # Medium budget - name + key mechanic
    dc_match = re.search(r'DC\s*(\d+)', desc)
    dmg_match = re.search(r'(\d+)\s*\(([^)]+)\)\s*(\w+)\s*damage', desc)
    if dc_match and dmg_match:
        return f"{name}: DC {dc_match.group(1)}, {dmg_match.group(2).replace(' ','')} {dmg_match.group(3).lower()}"
    if dc_match:
        return f"{name}: DC {dc_match.group(1)}"
    return name


def format_spellcasting_trait(name, desc):
    """Extract key spells from spellcasting text."""
    dc_match = re.search(r'DC\s*(\d+)', desc)
    dc = dc_match.group(1) if dc_match else '?'

    # Find at-will and daily spells
    at_will = re.findall(r'\*([A-Z][a-z][^*]+)\*', desc)
    spells = []
    for spell in at_will[:4]:
        spells.append(spell.strip())

    if spells:
        return f"Spellcasting (DC {dc}): {', '.join(spells)}"
    return f"Spellcasting (DC {dc})"


def format_spellcasting_action(name, desc, budget_tight=False):
    """Format spellcasting action."""
    dc_match = re.search(r'DC\s*(\d+)', desc)
    ability_match = re.search(r'using (\w+)', desc)

    dc = dc_match.group(1) if dc_match else '?'
    ability = ability_match.group(1)[:3].upper() if ability_match else ''

    # Named spellcasting abilities (Hellfire Spellcasting, etc.)
    if name != 'Spellcasting':
        recharge = re.search(r'\(Recharge [\d-]+\)', name)
        recharge_str = f" {recharge.group(0)}" if recharge else ""
        base_name = re.sub(r'\s*\(Recharge [\d-]+\)', '', name)
        # Find spells cast
        spells = re.findall(r'\*([A-Z][^*]+)\*', desc)
        level_match = re.search(r'level (\d+) version', desc)
        level_str = f" (lv {level_match.group(1)})" if level_match else ""
        if spells:
            replace_match = re.search(r'replace one .+ with \*([^*]+)\*(?:\s*(?:or|,)\s*\*([^*]+)\*)?', desc)
            spell_parts = [f"{spells[0]}{level_str}"]
            if replace_match:
                alts = [replace_match.group(1)]
                if replace_match.group(2):
                    alts.append(replace_match.group(2))
                spell_parts.append(f"or {'/'.join(alts)}")
            return f"{base_name}{recharge_str} (DC {dc}): {' '.join(spell_parts)}"
        return f"{base_name}{recharge_str} (DC {dc})"

    if budget_tight:
        return f"Spellcasting ({ability}, DC {dc})"

    at_will = []
    daily = []
    at_will_match = re.search(r'At Will:?\*?\*?\s*(.+?)(?=\s*-\s*\*\*\d|$)', desc)
    if at_will_match:
        at_will = re.findall(r'\*([A-Z][^*]+)\*', at_will_match.group(1))

    daily_match = re.search(r'(\d+)/Day[^:]*:?\*?\*?\s*(.+?)(?=\s*-\s*\*\*|$)', desc)
    if daily_match:
        freq_str = f"{daily_match.group(1)}/day"
        daily = re.findall(r'\*([A-Z][^*]+)\*', daily_match.group(2))

    parts = [f"Spellcasting ({ability}, DC {dc}):"]
    if at_will:
        parts[0] += f" At Will — {', '.join(at_will[:4])}"
    if daily:
        parts[0] += f"; {freq_str} — {', '.join(daily[:3])}"
    return parts[0]


def format_legendary_summary(actions, budget_tight=False):
    """Format legendary actions into a compact one-line summary."""
    if not actions:
        return None
    if budget_tight:
        names = [name for name, _ in actions]
        return f"Legendary (3/round): {', '.join(names)}"
    parts = []
    for name, desc in actions:
        atk_match = re.search(r'makes (?:one|two|1|2) (\w+)', desc)
        if atk_match:
            parts.append(f"{name} ({atk_match.group(1)} attack)")
        elif 'Spellcasting' in desc:
            spell_match = re.search(r'\*([^*]+)\*', desc)
            if spell_match:
                parts.append(f"{name} ({spell_match.group(1)})")
            else:
                parts.append(name)
        elif 'moves up to' in desc:
            rend = re.search(r'makes (?:one|two) (\w+)', desc)
            if rend:
                parts.append(f"{name} (move + {rend.group(1)})")
            else:
                parts.append(f"{name} (move)")
        else:
            dc_match = re.search(r'DC\s*(\d+)', desc)
            dmg_match = re.search(r'(\d+)\s*\(([^)]+)\)', desc)
            if dc_match and dmg_match:
                parts.append(f"{name} (DC {dc_match.group(1)}, {dmg_match.group(2).replace(' ','')})")
            elif dc_match:
                parts.append(f"{name} (DC {dc_match.group(1)})")
            elif dmg_match:
                parts.append(f"{name} ({dmg_match.group(2).replace(' ','')})")
            else:
                parts.append(name)
    return f"Legendary (3/round): {', '.join(parts)}"


def format_monster(m, budget_tight=False):
    """Format a monster into compact enriched text."""
    cr = m['cr']
    cr_str = cr_display(cr)
    xp_str = xp_display(cr)
    stats = m.get('stats', {})

    out = []
    out.append(f"**{m['name']}** | {m['type']} | {m['size']} | CR {cr_str} ({xp_str} XP)")
    out.append(f"AC {m['ac']} | HP {m['hp']} ({m['hp_dice']}) | Speed {m['speed']}")

    if budget_tight:
        stat_line = '/'.join(str(stats.get(s, 10)) for s in ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'])
    else:
        stat_line = ' '.join(f"{s} {stats.get(s, 10)}" for s in ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'])
    out.append(stat_line)

    # Saves
    saves = m.get('saves', {})
    if saves:
        save_str = ', '.join(f"{s} {v:+d}" if v < 0 else f"{s} +{v}" for s, v in saves.items())
        save_line = f"Saves: {save_str}"
        # Combine with senses if present
        if 'senses' in m:
            save_line += f" | Senses: {m['senses']}"
        out.append(save_line)
    elif 'senses' in m:
        out.append(f"Senses: {m['senses']}")

    # Immunities, Resistances, Vulnerabilities
    defenses = []
    if 'resistances' in m:
        defenses.append(f"Resistances: {m['resistances']}")
    if 'immunities' in m:
        defenses.append(f"Immunities: {m['immunities']}")
    if 'vulnerabilities' in m:
        defenses.append(f"Vulnerabilities: {m['vulnerabilities']}")
    if defenses:
        out.append(' | '.join(defenses))

    # Traits
    for tname, tdesc in m.get('traits', []):
        formatted = format_trait(tname, tdesc, budget_tight)
        if formatted:
            out.append(formatted)

    # Legendary actions summary (before attacks for readability)
    legendary = m.get('legendary', [])
    if legendary:
        leg_summary = format_legendary_summary(legendary, budget_tight)
        if leg_summary:
            out.append(leg_summary)

    # Actions
    multiattack = None
    attacks = []
    spellcasting = None

    for aname, adesc in m.get('actions', []):
        if aname == 'Multiattack':
            multiattack = format_multiattack(adesc)
        elif aname == 'Spellcasting':
            spellcasting = format_spellcasting_action(aname, adesc, budget_tight)
        else:
            formatted = format_attack(aname, adesc, budget_tight)
            if formatted:
                attacks.append(formatted)
            elif 'Spellcasting' in aname and 'casts' in adesc:
                attacks.append(format_spellcasting_action(aname, adesc, budget_tight))

    if multiattack:
        out.append(f"Multiattack: {multiattack}")
    for atk in attacks:
        out.append(atk)
    if spellcasting:
        out.append(spellcasting)

    if not budget_tight:
        for aname, adesc in m.get('bonus_actions', []):
            formatted = format_attack(aname, adesc)
            if formatted:
                out.append(formatted.replace('- ', '- [B] '))

        for aname, adesc in m.get('reactions', []):
            formatted = format_attack(aname, adesc)
            if formatted:
                out.append(formatted.replace('- ', '- [R] '))
            else:
                dc_match = re.search(r'DC\s*(\d+)', adesc)
                if dc_match:
                    out.append(f"- [R] {aname}: DC {dc_match.group(1)}")
                else:
                    out.append(f"- [R] {aname}")

    return '\n'.join(out)


def cr_sort_key(cr):
    return cr


def write_tier(tier_key, tier_info, monsters, max_bytes=MAX_REF_BYTES):
    cr_groups = {}
    for m in monsters:
        cr = m['cr']
        cr_groups.setdefault(cr, []).append(m)

    # First pass: normal budget
    content = build_file(tier_key, tier_info, cr_groups, budget_tight=False)
    if len(content.encode('utf-8')) <= max_bytes:
        return content

    # Second pass: tight budget
    print(f"  {tier_key}: {len(content.encode('utf-8'))} bytes, switching to tight budget", file=sys.stderr)
    content = build_file(tier_key, tier_info, cr_groups, budget_tight=True)
    if len(content.encode('utf-8')) <= max_bytes:
        return content

    print(f"  WARNING: {tier_key} still {len(content.encode('utf-8'))} bytes after tight budget!", file=sys.stderr)
    return content


def build_file(tier_key, tier_info, cr_groups, budget_tight=False):
    total = sum(len(ms) for ms in cr_groups.values())
    lines = [
        f"# D&D 5e 2024 — Monsters: {tier_info['label']}",
        "",
        f"{total} monsters from SRD 5.2. Enriched stat blocks for encounter building.",
        "",
        "**Format:** Enriched stat blocks — see Response Templates in monsters.md (index)",
    ]
    if budget_tight:
        lines.append("**Ability scores:** STR/DEX/CON/INT/WIS/CHA")
    lines.append("")
    lines.append("**Size codes:** T=Tiny, S=Small, M=Medium, L=Large, H=Huge, G=Gargantuan")

    for cr in sorted(cr_groups.keys(), key=cr_sort_key):
        cr_str = cr_display(cr)
        xp_str = xp_display(cr)
        lines.append("")
        lines.append(f"## CR {cr_str} ({xp_str} XP)")
        lines.append("")
        for m in cr_groups[cr]:
            lines.append(format_monster(m, budget_tight))
            lines.append("")

    lines.append("---")
    lines.append('*This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.*')
    lines.append("")
    return '\n'.join(lines)


def fixup_speed(m):
    """Fix known SRD data issues."""
    speed = m.get('speed', '')
    # Werebear SRD has "Alternate ? ft." — should be 40 ft. (bear form)
    if 'Alternate ? ft.' in speed and 'werebear' in m['name'].lower():
        m['speed'] = speed.replace('Alternate ? ft.', '40 ft. (bear form)')
    elif 'Alternate ? ft.' in speed:
        m['speed'] = speed.replace('Alternate ? ft., ', '')


def main():
    parser = argparse.ArgumentParser(description='Enrich D&D 5e monster stat blocks from SRD 5.2')
    parser.add_argument('srd_path', type=Path, help='Path to SRD 12_MonstersA-Z.md')
    parser.add_argument('--out-dir', type=Path, default=OUT_DIR, help='Output directory')
    args = parser.parse_args()

    if not args.srd_path.exists():
        print(f"Error: SRD file not found: {args.srd_path}", file=sys.stderr)
        sys.exit(1)

    text = args.srd_path.read_text(encoding='utf-8')
    monsters = parse_monsters(text)
    print(f"Parsed {len(monsters)} monsters", file=sys.stderr)

    for m in monsters:
        fixup_speed(m)

    tier_monsters = {k: [] for k in TIERS}
    for m in monsters:
        cr = m['cr']
        for tk, tv in TIERS.items():
            if tv['min'] <= cr <= tv['max']:
                tier_monsters[tk].append(m)
                break

    for tk in TIERS:
        print(f"  {tk}: {len(tier_monsters[tk])} monsters", file=sys.stderr)

    for tk, tv in TIERS.items():
        content = write_tier(tk, tv, tier_monsters[tk])
        out_path = args.out_dir / f"monsters-{tk}.md"
        out_path.write_text(content, encoding='utf-8')
        size = len(content.encode('utf-8'))
        status = "✓" if size <= MAX_REF_BYTES else "✗ OVER LIMIT"
        print(f"  {out_path.name}: {size:,} bytes ({len(tier_monsters[tk])} monsters) {status}", file=sys.stderr)


if __name__ == '__main__':
    main()

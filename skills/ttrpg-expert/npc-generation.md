# NPC Generation

Frameworks for generating NPCs across all supported systems.
Quick methods for improvised NPCs, deep methods for recurring
and antagonist NPCs, system-specific stat blocks.

**System-specific NPC stats:** for stat blocks and skill
values when generating NPCs, also read:
- CoC 7e: `systems/coc-7e/occupations.md`, `systems/coc-7e/skills.md`
- D&D 5e: `systems/dnd-5e-2024/classes.md`, `systems/dnd-5e-2024/monsters.md`
- GURPS 4e: `systems/gurps-4e/character-generation.md`
- FitD: `systems/fitd/playbooks.md`, `systems/fitd/factions.md`

Generation order: Purpose (why they exist) → Personality
(how they behave) → Mechanics (what they can do). Reversing
this produces game constructs, not people.

## The 3-Line NPC (Quick Generation)

For improvised or minor NPCs, define three elements:

- **Appearance:** one distinctive physical detail. "A tall
  woman with ink-stained fingers and a permanent squint."
- **Portrayal:** actionable behaviour the GM can perform.
  "Speaks in questions, never makes statements."
- **Hook:** story connection to the campaign. "Knows where
  the cult meets but is terrified of being seen talking."

Record immediately. Unrecorded improvised NPCs create
continuity errors.

## The AIMS Framework (Deep Generation)

For recurring NPCs, antagonists, and quest-givers.

**Agenda** — goals in three layers:
- *Immediate:* what they want right now, this scene
- *Short-term:* this week / this adventure
- *Long-term:* campaign-spanning ambition
- Goals at different layers can conflict (protect family vs
  serve the cult = built-in tension)

**Instinct** — reaction under pressure before rational planning:
fight/flee/freeze/fawn; trusting/suspicious; generous/self-
preserving; honest/deceptive.

**Moves** — concrete observable actions advancing their agenda
on a timeline: "Bribes harbour master for manifests." "Sends
anonymous threatening letters." If PCs don't intervene, next
move fires on schedule.

**Secrets** — layered by discovery difficulty:
- *Surface:* casual interaction ("limps slightly, tries to hide it")
- *Investigation:* active effort ("limp from cult initiation wound")
- *Deep:* significant investigation ("cult treasurer, launders
  money through Merchant Guild")

## Five-Component NPC (Scenario Writing)

For NPCs in scenarios other GMs will run:

1. **Goal** — what they want
2. **Plan** — how they intend to achieve it
3. **Timeline** — when they act if unopposed
4. **Reaction** — response if PCs intervene
5. **Escalation** — what happens if PCs don't intervene

## Voice and Mannerism

**Speech** — one distinctive element per NPC:

| Pattern | Example |
|---------|---------|
| Always questions | "Is that so? And you think that's wise?" |
| Formal diction | "One might consider the ramifications" |
| Clipped/terse | "No. Won't work. Try again." |
| Rambling tangents | "The bridge, yes, well, it reminds me of..." |
| Verbal tic | "Allegedly" inserted into every claim |
| Third person | "The Professor does not approve" |
| Whispers intensity | Drops volume for the most important words |

**Mannerism** — limit to 1-2 per NPC: fidgets with object,
avoids/forces eye contact, stands too close/far, drums fingers,
adjusts clothing. Voice and mannerism should reinforce
personality (contradictions only if intentional).

## Relationship Web

When generating, immediately consider relationships:
- Reports to / takes orders from?
- Trusts with sensitive info?
- Fears, resents, avoids?
- Who depends on them?
- Which factions affected?
- Locations frequented? Items possessed/sought?

| NPC Importance | Relationships |
|---------------|:---:|
| Minor (walk-on) | 1-2 |
| Supporting | 3-5 |
| Major | 5-8 |
| Antagonist | 6-10 |

Zero connections = orphan. Connect or question existence.

## System-Specific Generation

### CoC 7e

**Quick (minor):** name + occupation; 2-3 characteristics
(avg 50, skilled 60-70, expert 75+); 2 relevant skills; 1
trait + 1 secret.

**Full (recurring):** all 8 characteristics (STR/CON/SIZ/DEX/
APP/INT/POW/EDU, 15-90); derived stats (HP/MP/SAN/Luck/MOV/
Build/DB); occupation skills; AIMS profile; sanity-relevant
details (Mythos knowledge, what they've witnessed).

**Antagonist:** + Cthulhu Mythos skill + spells known +
Mythos connection + plan/timeline/escalation + SAN loss for
true nature.

### D&D 5e (2024)

**Quick:** name, species, occupation; standard stat block
base (Commoner, Guard, Noble); 1 trait + 1 useful info.

**Full:** designed stat block with CR; ability scores per role;
proficient skills + equipment; AIMS with quest hook; faction
allegiances.

**Villain:** + Action-Oriented design (Colville/MCDM,
https://mcdm.gg/) + Legendary Resistances (2-3) + lair
actions + advancing timeline + minions/lieutenants.

### GURPS 4e

**Quick (25-50 pts):** name + concept; attributes near 10;
1-2 advantages/disadvantages; 3-5 role-relevant skills.

**Full (100-150 pts):** attributes per role; advantages for
strengths/status; disadvantages for hooks/weaknesses; quirks
(-1pt personality); skill list with levels; point total.

**Major (200+ pts):** + detailed advantage/disadvantage
interactions + combat secondaries + equipment lists +
disadvantages actively driving behaviour.

### Forged in the Dark

**Quick:** name + role (faction/district); 1-2 notable action
ratings; vice + quirk; faction relationship (tier, status).

**Full:** title + faction position; key action ratings (2-4
at 1-3); stress threshold + existing trauma; clock (working
toward what); what they want from crew + can offer; Devil's
Bargains they might propose.

## Output Format

```markdown
## [NPC Name]
Concept: [One sentence]
Appearance: [Distinctive detail]
Portrayal: [How to play at table]
Voice: [Speech pattern]

AIMS:
- Agenda: [Immediate / Short-term / Long-term]
- Instinct: [Under pressure]
- Moves: [2-3 specific actions]
- Secrets: [Surface / Investigation / Deep]

Relationships:
- [Entity]: [Type + description]

Stat Block: [System-specific]
GM Notes: [Running context]
```

## Generation from Constraints

When user provides partial info, fill gaps while respecting
constraints. Role specified → build from role. Relationship
specified → build history around it. Mechanical need → stat
block first, wrap personality. Name only → infer from setting.
Always generate something usable even with minimal input.

## Sources

Johnn Four (3 Line NPC); Sly Flourish (NPC Generation); The
Alexandrian (Proactive NPC Design); Robin Laws (DramaSystem);
Keith Ammann (Monsters Know); Chaosium (CoC Keeper Rulebook);
SJG (GURPS Characters); John Harper (BitD SRD); WotC (2024 DMG).

## External References

- **Action-Oriented Monsters:** https://mcdm.gg/
- **3-Line NPC:** https://roleplayingtips.com/
- **Dhole's House Character Library:** https://www.dholeshouse.org/

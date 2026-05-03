---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/INDEX.md
  - skills/ttrpg-expert/systems/fitd/factions.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
---

# Universal Faction Turn

The Universal Faction Turn is a cross-system GM procedure for advancing faction goals between sessions. It lives in `world-evolution.md` as Step 2 of the Post-Session Update Checklist.

**When to use it:** Run it after every session, for each active faction in your campaign. If your system has a dedicated module, that module takes priority — FitD uses its own clock-based override, CoC and D&D 5e have system-specific session procedures. For GURPS and generic systems, use the Universal Faction Turn as written.

---

## The Five Questions

For each active faction, answer these questions in order:

**1. What is their current goal?**
State it in concrete terms. Not "the cult seeks power" — "the cult intends to open the Millway Gate by Midsummer." Specificity is what makes subsequent questions meaningful.

**2. What would they do next if the PCs didn't exist?**
Project the faction's independent agenda forward by one step. Then classify the impact of that step:

| Impact | Meaning | If PCs miss it |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical/narrative consequence |

This classification tells you how much urgency to signal to players and how hard to press consequences if the faction advances uncontested.

**3. Did the PCs affect this faction — directly or indirectly?**
Review the session. Even indirect effects count: the PCs exposed the Bluecoats' informant, so the Lampblacks learn something useful. The PCs burned a building in the Narrows, so a rival faction's smuggling route is disrupted. Map cause to faction wherever possible.

**4. What changes?**
Apply the result of questions 2 and 3 together:
- No PC interference → faction advances one step toward their goal
- PC interference → the step is altered, delayed, accelerated, or entirely derailed — choose whichever fits the fiction

Be decisive. Name the change specifically: "The Dockers' 'Control Canal Shipments' clock ticks to 4/6" or "Inspector Brennan opens a formal investigation file on the crew."

**5. What becomes visible to the PCs?**
Choose a visibility level:
- **Directly** — the PCs witness it or find evidence
- **Through allies** — a contact mentions it in passing
- **Through rumour** — it reaches them indirectly, possibly distorted
- **Not at all** — the faction acts unseen (use sparingly; invisible pressure builds dramatic irony)

Visibility is a GM pacing tool. Critical-impact moves should almost always become visible. Flavour moves can stay invisible indefinitely.

---

## Integration with the Post-Session Checklist

The Faction Turn is Step 2 of six post-session steps in `world-evolution.md`. Run it after Thread State Updates (Step 1) and before Consequence Surfacing (Step 3). Select 2-4 factions per session — you don't need to run every faction every time. Neglected factions catch up when you turn attention to them.

All outputs are proposals. Present them to the GM alongside Steps 1–6 before filing anything to the vault.

---

## System-Specific Overrides

**FitD (Blades in the Dark):** Clock advancement replaces the abstract "one step" mechanic. PCs opposed the faction: tick back 1-2 segments. PCs ignored it: advance 1-2. PCs helped: advance 2-3. Tier and Hold changes are rare (every 5-10 sessions). Heat of 4+ causes nearby factions to notice. Full procedure in `systems/fitd/session-procedures.md`.

**CoC 7e and D&D 5e 2024:** System-specific session procedures in their respective `session-procedures.md` files augment or override the Universal Turn for those games.

**GURPS 4e and generic systems:** Use the Universal Faction Turn as described above without modification.

---

## Practical Tips

- Pick factions by relevance to the last session, not alphabetically. Two or three well-advanced factions are more useful than eight half-hearted ones.
- The "flavour" impact tier is not wasted — it builds world texture and player trust that the setting breathes on its own.
- Use question 5 to plant foreshadowing. A faction making a Critical move that becomes visible only through rumour creates the kind of slow-burn dread that pays off two sessions later.
- Write scene-level specifics, not summaries: "A flat-faced stranger is seen twice near the boarding house" beats "surveillance begins."

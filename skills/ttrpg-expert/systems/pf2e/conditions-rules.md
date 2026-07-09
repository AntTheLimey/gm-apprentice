# Pathfinder 2e (Remaster) — Conditions & Core Rules

All 43 conditions from Player Core and Player Core 2, grouped by function,
plus how condition values, overrides, and the death spiral work.

## GM Quick Table

| Condition | Type | One-phrase effect |
|-----------|------|-------------------|
| **Observed** | binary | You can perceive it precisely; it's in plain view. |
| **Concealed** | binary | DC 5 flat check to target it (fog, blur). |
| **Hidden** | binary | Foe knows your square but not exactly where; DC 11 flat to target you. |
| **Undetected** | binary | Foe can't see you or find your square; must guess to attack. |
| **Unnoticed** | binary | Foe has no idea you're there at all (also undetected). |
| **Invisible** | binary | Can't be seen; undetected to everyone. |
| **Blinded** | binary | Can't see; crit-fail sight Perception; overrides dazzled. |
| **Dazzled** | binary | Everything is concealed to you (if sight is your only precise sense). |
| **Deafened** | binary | Can't hear; crit-fail hearing Perception; DC 5 flat for auditory actions. |
| **Off-Guard** | binary | –2 circumstance penalty to AC. |
| **Prone** | binary | Off-guard, –2 to attacks; only Crawl or Stand to move. |
| **Grabbed** | binary | Off-guard and immobilized; DC 5 flat for manipulate actions. |
| **Immobilized** | binary | Can't use move actions. |
| **Restrained** | binary | Off-guard and immobilized; only Escape/Force Open; overrides grabbed. |
| **Fleeing** | binary | Must spend every action running from the source. |
| **Confused** | binary | Off-guard; attack random targets; DC 11 flat on damage to end. |
| **Controlled** | binary | Another creature dictates your actions. |
| **Paralyzed** | binary | Off-guard; can act only with the mind (Recall Knowledge). |
| **Fascinated** | binary | –2 to Perception/skills; concentrate actions limited to the subject. |
| **Quickened** | binary | Gain 1 extra action at the start of your turn. |
| **Helpful** | binary | Attitude: actively wants to aid you. |
| **Friendly** | binary | Attitude: likes you; grants simple Requests. |
| **Indifferent** | binary | Attitude: neutral (the default). |
| **Unfriendly** | binary | Attitude: distrusts you; won't grant Requests. |
| **Hostile** | binary | Attitude: seeks to harm you. |
| **Clumsy** | value | Status penalty to Dexterity-based rolls/DCs (AC, Reflex, ranged). |
| **Enfeebled** | value | Status penalty to Strength-based rolls/DCs (melee, Athletics). |
| **Stupefied** | value | Status penalty to mental rolls/DCs; flat check to Cast a Spell. |
| **Drained** | value | Status penalty to Con rolls; lose and cap HP by level × value. |
| **Frightened** | value | Status penalty to all checks/DCs; drops by 1 each turn. |
| **Sickened** | value | Status penalty to all checks/DCs; spend an action to retch and save. |
| **Slowed** | value | Regain that many fewer actions each turn. |
| **Stunned** | value | Lose that many actions total; overrides slowed. |
| **Persistent Damage** | value | Recurring damage each turn; DC 15 flat to end. |
| **Cursebound** | value | Oracle-only; curse effects scale with value; ends via Refocus. |
| **Dying** | value | Unconscious and bleeding out; dying 4 = death. |
| **Wounded** | value | Adds to future dying values. |
| **Doomed** | value | Lowers the dying value at which you die. |
| **Unconscious** | binary | Knocked out; –4 AC/Perc/Reflex; blinded and off-guard. |
| **Broken** | binary | Object can't function; broken armor takes an AC penalty. |
| **Petrified** | binary | Turned to stone; can't act or sense; becomes an object. |
| **Fatigued** | binary | –1 to AC and saves; no exploration activities while travelling. |
| **Encumbered** | binary | Clumsy 1 and –10-foot Speed penalty. |

## How Condition Values Work

Several conditions carry a numeric value (written "frightened 2", "drained 3").
The value scales the effect — usually a status penalty equal to the value — and
tracks how much of the condition remains. Different conditions decay differently:
some drop automatically (frightened each turn), some only over rest (drained,
doomed), some as you spend actions (slowed, stunned), and some via a check
(persistent damage, confused). If you gain a valued condition you already have,
use the higher value rather than adding them together.

## Detection & Senses

How well creatures can perceive one another. These form a ladder from fully
seen to completely unaware.

- **Observed** — In plain view and precisely perceived (by sight or another
  precise sense). The default when nothing hides a creature.
- **Concealed** — Hard to see (fog, dim light). Still observed, but attackers
  need a DC 5 flat check to affect you; area effects ignore it.
- **Hidden** — A foe knows your square but not your exact spot. Attackers need a
  DC 11 flat check; the creature is off-guard to you. Usually gained by Hiding.
- **Undetected** — A foe can't perceive you or know your square; they must guess
  a square and roll blind to attack. They're off-guard to you.
- **Unnoticed** — The foe doesn't even know you exist (also undetected). Matters
  for abilities that need a totally unaware target.
- **Invisible** — Can't be seen; undetected to everyone. Seeking can downgrade you
  to hidden; you can't become observed without special magic.
- **Blinded** — Can't see; normal terrain becomes difficult terrain; auto crit-fail
  sight-based Perception, and –4 to Perception if sight was your only precise sense.
  Immune to visual effects. **Overrides dazzled.**
- **Dazzled** — Vision swims; if sight is your only precise sense, everything is
  concealed to you.
- **Deafened** — Can't hear; auto crit-fail hearing Perception; –2 to initiative and
  sound-related Perception; DC 5 flat check to perform auditory actions.

## Movement & Action-Denial

- **Off-Guard** — Distracted; –2 circumstance penalty to AC. Many other conditions
  impose it. It applies to everything unless the effect limits it.
- **Prone** — Lying down; off-guard and –2 to attacks. Only Crawl or Stand as move
  actions; standing ends it. Take Cover while prone for +4 AC vs. ranged.
- **Grabbed** — Held by another creature; off-guard and immobilized. DC 5 flat check
  to perform manipulate actions or lose them.
- **Immobilized** — Can't take any action with the move trait. If something tries to
  drag you, it rolls against the holding effect's DC.
- **Restrained** — Tied up or pinned; off-guard and immobilized. Can only Escape or
  Force Open. **Overrides grabbed.**
- **Fleeing** — Fear or compulsion forces you to spend every action getting away from
  the source. Can't Delay or Ready.
- **Confused** — Off-guard; treat no one as an ally; can't use reactions. Spend all
  actions Striking random targets (or yourself). DC 11 flat check on taking damage
  to end it.
- **Controlled** — A dominator dictates your actions; they usually spend none of
  their own.
- **Paralyzed** — Frozen; off-guard and can act only with the mind (e.g. Recall
  Knowledge). Senses work but you can't Seek.
- **Fascinated** — –2 to Perception and skill checks; concentrate actions limited to
  the subject of your fascination. Ends when a creature acts hostilely toward you or
  an ally.
- **Quickened** — Gain 1 extra action at the start of each turn; most sources restrict
  what that action may be used for.

## Attitudes

A creature's disposition toward one character, from best to worst. Only supernatural
effects can force an attitude onto a PC. Hostile acts push a creature's attitude
downward.

- **Helpful** — Actively wants to aid the character; accepts reasonable Requests.
- **Friendly** — Likes the character; grants simple, safe, low-cost Requests.
- **Indifferent** — Neutral; the assumed default toward any character.
- **Unfriendly** — Dislikes and distrusts; refuses Requests.
- **Hostile** — Wants to harm the character; refuses Requests (may or may not attack).

## Value-Based Conditions

- **Clumsy** — Status penalty (= value) to Dexterity-based rolls and DCs, including
  AC, Reflex saves, ranged attacks, and Acrobatics/Stealth/Thievery.
- **Enfeebled** — Status penalty to Strength-based rolls and DCs: melee attack and
  damage rolls and Athletics.
- **Stupefied** — Status penalty to Int/Wis/Cha rolls and DCs (Will saves, spell
  attacks/DCs). Casting a spell requires a flat check of DC 5 + value or it's lost.
- **Drained** — Status penalty to Constitution rolls and DCs (Fortitude). You also
  lose HP equal to level × value and reduce your maximum HP by the same amount.
  Decreases by 1 per full night's rest (restoring max HP, not current).
- **Frightened** — Status penalty to every check and DC. Decreases by 1 at the end of
  each of your turns unless stated otherwise.
- **Sickened** — Status penalty to your checks and DCs. You can spend an action to
  retch, attempting a Fortitude save to reduce the value. (The dataset's condition
  entry is blank; effect reconstructed from the player-rules chapters.)
- **Slowed** — When you regain actions at the start of your turn, regain that many
  fewer. Gaining it mid-turn doesn't cost you current actions.
- **Stunned** — Can't act; lose that many actions total, possibly across turns; the
  value drops by the actions lost. May instead have a duration. **Overrides slowed**
  (actions lost to stunned count against slowed).
- **Persistent Damage** — Ongoing damage of a set type, taken at the end of each turn
  (rerolling dice each time). After taking it, roll a DC 15 flat check to end it.
- **Cursebound** — Affects only characters with an oracular curse; the curse's own
  effects scale with the value. Removable only by Refocusing.

## Death & Dying (the Death Spiral)

These four conditions interlock — track them together.

- **Dying** — You're at death's door and **unconscious**. At **dying 4 you die**. Each
  turn while dying you attempt a **recovery check** at the start of your turn to get
  better or worse. Taking damage while dying raises the value by 1 (by 2 from an
  enemy crit or your critical failure). Reaching 1+ HP ends dying and wakes you.
- **Wounded** — Whenever you lose the dying condition you gain **wounded 1** (or +1 if
  already wounded). If you later become dying again, **add your wounded value to the
  new dying value** — so repeated knockdowns escalate fast. Cleared by Treat Wounds
  healing, or by reaching full HP and resting 10 minutes.
- **Doomed** — A death-grip on your soul. The dying value at which you die is **reduced
  by your doomed value** (doomed 1 means you die at dying 3). If that maximum reaches
  0, you die instantly. Decreases by 1 per full night's rest.
- **Unconscious** — Knocked out or asleep: can't act, –4 to AC/Perception/Reflex, and
  you're **blinded and off-guard**; you fall prone and drop held items. If unconscious
  *because* you're dying, you can't wake at 0 HP; restoring you to 1+ HP ends both
  conditions. If unconscious at 0 HP but not dying, you return to 1 HP after a stretch
  of time. If unconscious with HP to spare (sleep), damage, healing, a shake, or loud
  noise can wake you.

**The spiral in one line:** get knocked to 0 → dying (unconscious) → survive a
recovery check → wounded 1 → next knockdown starts dying higher → doomed can shorten
the whole track. Wounded and doomed both make each future drop deadlier.

## Miscellaneous

- **Broken** — Affects objects only. A broken item can't perform its function or grant
  bonuses — except armor, which keeps its AC item bonus but takes a status penalty to
  AC (–1 light, –2 medium, –3 heavy) and still imposes its usual penalties.
- **Petrified** — Turned to stone: can't act or sense anything. You become an object
  (double Bulk, AC 9, Hardness 8, keeping your HP). If the statue is destroyed you die;
  otherwise you don't age or perceive time passing.
- **Fatigued** — –1 status penalty to AC and saving throws; can't use exploration
  activities while travelling. Recovered after a full night's rest.
- **Encumbered** — Overloaded: you're **clumsy 1** and take a –10-foot penalty to all
  Speeds (never below 5 feet).

## Overriding & Redundant Conditions

- **Specific overrides general** — the core principle. A more specific rule wins over a
  general one; when still ambiguous, the GM decides.
- Some conditions explicitly supersede a milder one: **blinded overrides dazzled**,
  **restrained overrides grabbed**, and **stunned overrides slowed**.
- **Bonuses and penalties of the same type don't stack** — apply only the worst penalty
  (and best bonus) of each type. But a bonus and a penalty of the same type can both
  apply to one roll (e.g. a +1 status bonus and a –2 status penalty net to –1).
- **Redundant valued conditions don't add** — gaining a condition you already have uses
  the higher value, not the sum.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*

# Pathfinder 2e (Remaster) -- Rules Reference

In-play quick lookup: basic actions, skill actions, exploration and downtime activities, cover, movement, and the death rules. For the resolution engine (degrees of success, proficiency, MAP, saves) see `mechanics.md`; for conditions see `conditions-rules.md`.

## Basic Actions

Every creature can use these. Costs: [1] single, [2] two, [R] reaction, [F] free.

| Action | Cost | Effect |
|--------|------|--------|
| **Stride** | [1] | Move up to your Speed. |
| **Step** | [1] | Move 5 ft without triggering reactions; not into difficult terrain. |
| **Strike** | [1] | Attack with a wielded weapon or unarmed attack vs AC; crit = double damage. |
| **Interact** | [1] | Draw/stow/manipulate an object, open a door, etc. |
| **Crawl** | [1] | Move 5 ft while prone. |
| **Stand** | [1] | Stand up from prone. |
| **Drop Prone** | [1] | Fall prone. |
| **Leap** | [1] | Jump 10 ft horizontally (15 ft if Speed 30+), or up 3 ft and over 5 ft. |
| **Seek** | [1] | Perception check to find hidden/undetected creatures or objects in an area (usually 30 ft). Secret. |
| **Sense Motive** | [1] | Perception vs Deception DC to read a creature's intentions. Secret. |
| **Aid** | [R] | Prepared beforehand; on a success give an ally +1 (+2/+3/+4 on a crit by rank) circumstance bonus to the triggering check. |
| **Ready** | [2] | Set one action + a trigger to use as a reaction before your next turn. |
| **Release** | [F] | Let go of a held item; doesn't trigger reactions. |
| **Delay** | [F] | Remove yourself from initiative and re-enter later after any creature's turn. |
| **Dismiss** | [1] | End an effect that says you can Dismiss it. |
| **Sustain** | [1] | Extend a sustained effect to the end of your next turn (or trigger its Sustain benefit). |

## Specialty Basic Actions

| Action | Cost | Effect |
|--------|------|--------|
| **Take Cover** | [1] | Upgrade standard cover to greater (+4), or gain standard cover (+2), while pressed to an obstacle or prone. |
| **Raise a Shield** | [1] | Gain the shield's circumstance bonus to AC until your next turn (requires a wielded shield). |
| **Escape** | [1] | Attack-trait check (unarmed attack, Acrobatics, or Athletics) vs the effect's DC to end grabbed/immobilized/restrained. |
| **Point Out** | [1] | Make a creature you sense undetected-to-an-ally merely hidden to that ally. |
| **Avert Gaze** | [1] | +2 circumstance bonus to saves vs visual gaze effects until your next turn. |
| **Fly** | [1] | Move up to your fly Speed (requires a fly Speed). |
| **Burrow** | [1] | Dig through loose earth up to your burrow Speed. |
| **Mount / Dismount** | [1] | Get on or off a willing creature at least one size larger. |
| **Arrest a Fall** | [R] | Acrobatics or Reflex (DC 15) to take no falling damage; requires fly Speed. |
| **Grab an Edge** | [R] | Acrobatics or Reflex to catch a ledge and reduce a fall. |

## Common Activities

- **Cast a Spell** -- usually 2 actions (verbal + somatic); see `spells.md`.
- **Sudden Charge**, class feats, etc. -- combine Strides and a Strike into one activity.
- **Reactive Strike** [R] -- a foe within reach uses a manipulate/move action, makes a ranged attack, or leaves a square during a move; make a melee Strike (a crit vs a manipulate action disrupts it). Not universal -- granted by fighters and some others.

## Skill Actions (Combat)

Attack-trait maneuvers count toward the multiple attack penalty. Athletics maneuvers roll vs the listed save DC.

| Action | Cost | Roll vs | Effect |
|--------|------|---------|--------|
| **Grapple** | [1] | Athletics vs Fortitude DC | Success: grabbed; crit: restrained (until end of your next turn). |
| **Trip** | [1] | Athletics vs Reflex DC | Success: target prone; crit: prone + 1d6 bludgeoning. Crit fail: you fall prone. |
| **Shove** | [1] | Athletics vs Fortitude DC | Push 5 ft (10 ft on crit); may Stride after. |
| **Disarm** | [1] | Athletics vs Reflex DC | Success: -2 to their attacks with the item; crit: knock it to the ground. |
| **Reposition** | [1] | Athletics vs Fortitude DC | Move the target 5 ft (10 ft on crit), staying within reach. |
| **Feint** | [1] | Deception vs Perception DC | Success: target off-guard to your next melee Strike this turn; crit: until your next turn. |
| **Demoralize** | [1] | Intimidation vs Will DC | Success: frightened 1; crit: frightened 2. -4 if no shared language. Immune 10 min after. |
| **Escape** | [1] | vs the effect's DC | Break free of grabbed/restrained/immobilized (see basic actions). |
| **Create a Diversion** | [1] | Deception vs Perception DC | Become hidden so you can Sneak away; +4 to their DC vs you afterward. |

## Skill Actions (Movement & Utility)

| Action | Skill | Notes |
|--------|-------|-------|
| **Climb** | Athletics | 5 ft up/down/across; off-guard while climbing without a climb Speed; crit fail = fall. |
| **Swim** | Athletics | 10 ft through water; calm water auto-crits. |
| **High Jump / Long Jump** | Athletics | [2]; must Stride 10+ ft first. High Jump DC 30; Long Jump DC 15 (leap up to result in feet). |
| **Balance** | Acrobatics | Cross narrow/uneven surfaces; off-guard while doing so. |
| **Tumble Through** | Acrobatics vs Reflex DC | Move through an enemy's space as difficult terrain. |
| **Force Open** | Athletics | Break a door/container open (Broken); -2 without a crowbar. |
| **Pick a Lock** | Thievery | [2]; needs Thieves' Toolkit; complex locks need multiple successes. |
| **Disable a Device** | Thievery | [2]; disarm traps; crit fail triggers the device. |
| **Hide** | Stealth | Observed to hidden while you have cover/greater cover or concealment. Secret. |
| **Sneak** | Stealth | [1]; move up to half Speed staying undetected. Secret. |
| **Command an Animal** | Nature vs Will DC | Direct a mount or companion; auto-fail vs hostile/unfriendly animals. |
| **Recall Knowledge** | varies | [1]; one question about a topic; crit fail = false info. |
| **Repair** | Crafting | 10 min with a repair kit; restores HP to an item by rank. |
| **Steal / Palm an Object** | Thievery vs Perception DC | Take a worn or unattended small object unnoticed. |

## Social Skill Actions

| Action | Skill | Effect |
|--------|-------|--------|
| **Make an Impression** | Diplomacy vs Will DC | 1 min of talk; improve an NPC's attitude one step (two on a crit) for the interaction. |
| **Request** | Diplomacy | Ask a friendly/helpful NPC for something; success may come with conditions. |
| **Coerce** | Intimidation vs Will DC | 1 min of threats; force cooperation, but the target turns unfriendly/hostile after. |
| **Lie** | Deception vs Perception DC | Get someone to believe an untruth; they may Sense Motive later. |
| **Feint / Demoralize** | see above | Also usable socially or in combat. |

**NPC attitudes** (worst to best): hostile, unfriendly, indifferent, friendly, helpful. Most NPCs start indifferent. You can't change a PC's attitude with these actions.

## Exploration Activities

Chosen while traveling; most move you at half travel Speed.

| Activity | Effect |
|----------|--------|
| **Avoid Notice** | Stealth to travel unseen; often sets initiative if combat starts. |
| **Search** | Seek repeatedly for hidden doors, hazards, and treasure. |
| **Investigate** | Recall Knowledge on things you pass to turn up clues (secret). |
| **Scout** | The whole party gains +1 circumstance to initiative next encounter. |
| **Defend** | Move with shield raised; get its bonus before your first turn. |
| **Detect Magic** | Cast detect magic at intervals to spot auras. |
| **Follow the Expert** | Match an expert ally's skill; add your level + a bonus by their rank. |
| **Hustle** | Double travel Speed for (Con mod x 10) minutes, min 10. |
| **Refocus** | 10 min to recover 1 Focus Point (requires a focus pool). |
| **Track** | Survival to follow tracks at up to half Speed. |
| **Sense Direction** | Survival to stay oriented; -2 without a compass. |
| **Cover Tracks** | Hide your own trail as you go. |

## Downtime Activities

Measured in days. See `session-procedures.md` for running downtime.

| Activity | Summary |
|----------|---------|
| **Earn Income** | Trained skill check vs a task-level DC; earn coin per day by result and rank. |
| **Craft** | Supply half the item's Price in materials, spend days, roll Crafting; extra days offset the rest of the Price. |
| **Retraining** | Spend a week+ to swap a feat, skill increase, or selectable class feature (not ancestry/background/class/attributes). |
| **Treat Wounds** | 10 min, Medicine DC 15 (higher DC = more healing); crit success also removes wounded. Target immune 1 hour. |
| **Long-Term Rest** | A full day and night restores Con mod x (2 x level) HP. |
| **Subsist** | Society or Survival to feed and shelter yourself; failure = fatigued. |
| **Gather Information** | Diplomacy around town to learn about a person or topic. |
| **Learn a Spell** | 1 hour/rank + materials + a tradition-skill check to add a spell you can cast. |
| **Identify Magic** | 10 min to determine a magic item's or effect's properties. |

## Cover and Concealment

| Cover | Bonus | Can Hide? |
|-------|-------|-----------|
| Lesser (a creature in the way) | +1 AC | No |
| Standard | +2 AC, Reflex vs areas, Stealth | Yes |
| Greater (Take Cover) | +4 AC, Reflex vs areas, Stealth | Yes |

**Concealed** (fog, dim light): attacker rolls a DC 5 flat check or the attack is wasted. **Hidden** creature: DC 11 flat check to target it, and you're off-guard to it. **Undetected/invisible:** you don't know its square; attacks are guesses rolled secretly. **Flanking:** you and an ally on opposite sides of a foe make it off-guard (-2 AC) to your melee attacks.

## Movement

- Speed is spent in feet; on a grid each square is 5 ft.
- **Diagonals** alternate 5 ft / 10 ft (first counts 5, second 10, and so on).
- **Difficult terrain** costs +5 ft per square entered; **greater** difficult terrain +10 ft. Can't Step into it.
- **Reach** is normally 5 ft; reach weapons and larger creatures extend it.
- **Falling:** bludgeoning equal to half the distance fallen; land prone. Soft landings (water, snow) treat the fall as 20 ft shorter (30 ft if you dove).

## Death and Dying

At 0 HP a PC is knocked out and gains **dying 1** (dying 2 if from a crit or your own crit fail; add your wounded value). You die at **dying 4**.

- **Recovery check** (start of each turn while dying): flat check vs `10 + dying value`. Crit success -2, success -1, failure +1, crit failure +2 (add wounded on a fail).
- **Losing dying** (reaching dying 0, or healed to 1+ HP): you gain or increase **wounded** by 1. Wounded adds to future dying values.
- **Wounded** ends when you're healed to full and rest 10 minutes, or via a successful Treat Wounds.
- **Doomed N** lowers your death threshold by N (doomed 1 = die at dying 3). Drops by 1 per full night's rest.
- **Instant death:** damage equal to twice your max HP in one blow, or a death-trait effect that reduces you to 0.
- **Heroic recovery:** spend all Hero Points when dying would increase to shed dying and stabilize at 0 HP without gaining wounded.

Undead and constructs are destroyed at 0 HP rather than dying. Nonlethal attacks knock out instead of killing.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*

# GURPS 4e Social Mechanics

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](http://www.sjgames.com/general/online_policy.html).

In-play procedural reference for GURPS 4e social interaction
mechanics. Covers reaction rolls, influence rolls, reputation,
and patron/ally frequency checks.

Source: GURPS Basic Set -- Campaigns, Chapter 19.

---

## Reaction Rolls

When the PCs meet an NPC whose attitude isn't predetermined,
the GM rolls 3d6 on the Reaction Table, modified by the PCs'
social traits.

### Reaction Modifiers

| Source | Typical Modifier |
|--------|-----------------|
| Appearance (Attractive) | +1 |
| Appearance (Beautiful/Handsome) | +4 |
| Appearance (Very Beautiful/Very Handsome) | +6 |
| Appearance (Ugly) | -2 |
| Appearance (Hideous) | -4 |
| Charisma | +1/level |
| Status | +1/level (or -1/level if low) |
| Reputation (positive) | +1 to +4 (based on recognition) |
| Reputation (negative) | -1 to -4 (based on recognition) |
| Voice | +2 |
| Odious Personal Habit | -1 to -3 |
| Social Stigma | -1 to -4 |
| Racial/species bias | varies |
| Fashion Sense | +1 |

### Reaction Table

| Roll | Reaction | Result |
|------|----------|--------|
| 0 or less | Disastrous | Attacks or acts against PCs with extreme hostility |
| 1-3 | Very Bad | Hostile; attacks if possible or actively works against PCs |
| 4-6 | Bad | Uncooperative; refuses requests, may insult or threaten |
| 7-9 | Poor | Unimpressed; reluctantly cooperates only if there's clear benefit |
| 10-12 | Neutral | Indifferent; cooperates if it costs nothing, fair business dealings |
| 13-15 | Good | Friendly; willing to help, offers fair terms, gives benefit of doubt |
| 16-18 | Very Good | Enthusiastic; actively helpful, offers good terms, goes out of way |
| 19+ | Excellent | Extremely impressed; offers exceptional help, strong loyalty |

---

## Influence Rolls

When a PC actively tries to change an NPC's mind, use an
Influence roll instead of (or in addition to) a Reaction roll.

### Influence Skills

| Skill | Attribute | Use When... |
|-------|-----------|-------------|
| Diplomacy | IQ/H | Negotiating, persuading through reason and tact |
| Fast-Talk | IQ/A | Deceiving, confusing, or rushing someone into agreement |
| Intimidation | Will/A | Threatening or coercing compliance |
| Sex Appeal | HT/A | Using attractiveness to persuade (modified by Appearance) |
| Savoir-Faire | IQ/E | Fitting in socially, making good impressions in specific groups |
| Streetwise | IQ/A | Dealing with criminals and the underworld |
| Leadership | IQ/A | Inspiring or commanding groups |
| Merchant | IQ/A | Haggling, evaluating deals |

### Influence Procedure

1. **Player describes approach** (what they say/do).
2. **GM determines appropriate skill**.
3. **Roll as Quick Contest**: PC's influence skill vs NPC's
   Will (for most skills) or the better of Will and the same
   skill (for Diplomacy and Fast-Talk).
4. **Apply result**:
   - PC wins: NPC is influenced as desired.
   - NPC wins: Attempt fails. Reaction may worsen.
   - Critical failure: NPC reacts very badly (-2 or worse
     to future interaction).

### Key Notes

- **Diplomacy** never makes things worse on a normal failure
  (only on critical failure). This makes it the safest
  influence skill.
- **Fast-Talk** works quickly but the NPC realizes the
  deception after minutes equal to the margin of success.
- **Intimidation** compels immediate compliance but creates
  resentment. The NPC will work against you when safe.
- **Sex Appeal** requires appropriate Appearance level to
  be effective. Modified by the NPC's attraction.

---

## Reputation

Reputation is a social advantage or disadvantage that modifies
reaction rolls from those who recognize the character.

### Cost Structure

| Reaction Modifier | Cost per Level |
|------------------|---------------|
| +1 reaction | 5 pts |
| -1 reaction | -5 pts |

### Frequency of Recognition

| Recognition | Multiplier |
|------------|-----------|
| All the time (10+) | x1 |
| Sometimes (7-9) | x1/2 |
| Occasionally (10-) | x1/3 |

### Scope Modifier

| Who Recognizes | Multiplier |
|---------------|-----------|
| Almost everyone | x1 |
| Large class of people | x2/3 |
| Small class of people | x1/2 |

A reputation can be positive with some groups and negative
with others. Multiple reputations stack.

---

## Patron and Ally Checks

### Patron Frequency Roll

At the start of each adventure (or when the GM deems
appropriate), roll to see if a Patron provides assistance.

| Frequency | Roll | Base Cost |
|-----------|------|-----------|
| Quite rarely | 6 or less | x1/2 |
| Fairly often | 9 or less | x1 |
| Quite often | 12 or less | x2 |
| Almost all the time | 15 or less | x3 |

**On success**: The Patron provides useful assistance --
information, equipment, backup, political cover, etc.

**On failure**: The Patron is unavailable this adventure.

### Ally Frequency Roll

Allies use the same frequency table. On a successful roll,
the Ally appears and is available to help.

| Frequency | Roll | Cost Modifier |
|-----------|------|--------------|
| Quite rarely | 6 or less | x1/2 |
| Fairly often | 9 or less | x1 |
| Quite often | 12 or less | x2 |
| Almost all the time | 15 or less | x3 |

### Enemy Frequency

Enemies also use frequency rolls, but a successful roll means
the Enemy shows up to cause trouble.

---

## Cross-References

- Reaction modifiers from advantages: `traits-social.md`
- Core roll mechanics: `mechanics.md`
- Character social traits: `character-generation.md`
- Social Engineering supplement: expands all rules in this
  file significantly (future integration)

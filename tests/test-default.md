# Test: Default Config (Skill Files Only)

**Prompt:** Build me a 150-point GURPS character: a former SAS operator turned private military contractor. Modern realistic campaign, TL8, Basic Set only. Disadvantage limit -50 points, quirk limit -5 points.

**Config:** Only skill files (mechanics.md, character-generation.md, rules-reference.md). No GCS JSON, no personal files.

---

CONNOR "MAC" MACALLISTER
Former SAS Operator / Private Military Contractor — 150 points
Campaign: Modern Realistic, TL8, Basic Set Only
Disadvantage limit: -50 pts  |  Quirk limit: -5 pts

## PRIMARY ATTRIBUTES [140 points]

| Attribute | Value | Cost | Calculation |
|-----------|-------|------|-------------|
| ST | 12 | +20 pts | base 10, +2 levels × 10 pts/level |
| DX | 13 | +60 pts | base 10, +3 levels × 20 pts/level |
| IQ | 12 | +40 pts | base 10, +2 levels × 20 pts/level |
| HT | 12 | +20 pts | base 10, +2 levels × 10 pts/level |

## SECONDARY CHARACTERISTICS [+5 points]

| Characteristic | Value | Cost | Derivation |
|----------------|-------|------|------------|
| HP | 12 | +0 pts | = ST 12, unmodified |
| Will | 12 | +0 pts | = IQ 12, unmodified |
| Per | 13 | +5 pts | = IQ 12, +1 level × 5 pts/level |
| FP | 12 | +0 pts | = HT 12, unmodified |
| Basic Speed | 6.25 | +0 pts | (HT 12 + DX 13) / 4 |
| Basic Move | 6 | +0 pts | floor of Basic Speed |
| Dodge | 9 | — | floor(6.25) + 3 |
| Damage | Thr 1d-1 / Sw 1d+2 | — | ST 12 damage table |
| Basic Lift | 28.8 lbs | — | 12×12/5 |

## ADVANTAGES [+30 points]

| Advantage | Cost | Notes |
|-----------|------|-------|
| Combat Reflexes | +15 pts | +1 all active defenses; +6 vs surprise; +2 Fright Checks; never freeze (B43) |
| High Pain Threshold | +10 pts | No shock penalties; +3 resist knockdown/stun/torture (B59) |
| Fit | +5 pts | +1 to all HT rolls except death checks (B55) |

## DISADVANTAGES [-50 points]

| Disadvantage | Cost | Notes |
|--------------|------|-------|
| Duty (PMC; 12 or less; Extremely Hazardous) | -20 pts | Base -10 for 12 or less, ×2 for Extremely Hazardous (B133) |
| Code of Honor (Soldier's) | -10 pts | (B127) |
| Enemy (Rival PMC; Equal Power; 9 or less) | -10 pts | Base -10 for equal power; ×1 for 9 or less (B135) |
| Sense of Duty (Teammates) | -5 pts | (B153) |
| Overconfidence (CR 12) | -5 pts | Base -5, CR 12 = ×1 (B148) |

## QUIRKS [-5 points]

- Drinks tea only — views coffee drinkers with quiet suspicion [-1]
- Kit must be immaculate; visibly judges sloppy teammates [-1]
- Defaults to British military slang in civilian company [-1]
- Dismisses every personal injury with "it's just a scratch" [-1]
- Deep, abiding distrust of politicians and senior officers [-1]

## SKILLS [+30 points]

| Skill | Diff | Ctrl Attr | Pts | Level | Notes |
|-------|------|-----------|-----|-------|-------|
| Guns (Rifle) | E | DX 13 | 4 | 15 | Attr+2 |
| Guns (Pistol) | E | DX 13 | 2 | 14 | Attr+1 |
| Brawling | E | DX 13 | 2 | 14 | Attr+1; Parry 10 |
| Fast-Draw (Pistol) | E | DX 13 | 1 | 13 | Attr+0 |
| Knife | E | DX 13 | 1 | 13 | Attr+0; Parry 9 |
| Stealth | A | DX 13 | 2 | 13 | Attr+0 |
| Climbing | A | DX 13 | 2 | 13 | Attr+0 |
| Driving (Auto) | A | DX 13 | 2 | 13 | Attr+0 |
| Observation | A | Per 13 | 2 | 13 | Attr+0 |
| Tactics | H | IQ 12 | 4 | 12 | Attr+0 |
| Navigation (Land) | A | IQ 12 | 2 | 12 | Attr+0 |
| Soldier | A | IQ 12 | 2 | 12 | Attr+0 |
| Explosives (Demo) | A | IQ 12 | 2 | 12 | Attr+0 |
| First Aid | E | IQ 12 | 1 | 12 | Attr+0 |
| Swimming | E | HT 12 | 1 | 12 | Attr+0 |

Skills total: 4+2+2+1+1+2+2+2+2+4+2+2+2+1+1 = 30 pts

## COMBAT STATISTICS

Active Defenses (with Combat Reflexes):
- Dodge: 10 (unencumbered) / 9 (combat-loaded)
- Parry (Brawling): 11
- Parry (Knife): 10

## EQUIPMENT ($20,000 TL8)

| Item | Cost | Weight |
|------|------|--------|
| H&K G36C assault rifle (5.56mm) | $1,500 | 7.1 lbs |
| Glock 17 pistol (9mm) | $600 | 2.1 lbs |
| Combat knife | $50 | 0.5 lbs |
| Holster and sling | $75 | 0.5 lbs |
| Tactical ballistic vest (DR 12/5*) | $900 | 10.0 lbs |
| Ballistic helmet (DR 4 skull) | $400 | 3.0 lbs |
| Trauma kit | $200 | 3.0 lbs |
| Night-vision monocular | $3,000 | 1.5 lbs |
| Tactical radio | $500 | 0.5 lbs |
| GPS unit | $150 | 0.25 lbs |
| Spare rifle mags ×4 | $120 | 2.8 lbs |
| Spare pistol mags ×3 | $60 | 0.9 lbs |
| Rifle ammo (100 rds) | $50 | 2.5 lbs |
| Pistol ammo (100 rds) | $25 | 2.5 lbs |
| Civilian clothes | $200 | 2.0 lbs |
| Laptop (field) | $800 | 4.0 lbs |
| Cover documents | $3,000 | 0.1 lbs |

Equipment total: $11,730 | Cash retained: $8,270

## ENCUMBRANCE (Combat Load)

Combat load: 37.15 lbs | BL: 28.8 lbs
Light encumbrance (level 1): Move 5, Dodge 8 (9 with CR)

## POINT SUMMARY

| Category | Points |
|----------|--------|
| Primary Attributes | +140 |
| Secondary Characteristics | +5 |
| Advantages | +30 |
| Disadvantages | -50 |
| Quirks | -5 |
| Skills | +30 |
| **TOTAL** | **150 / 150** |

/* To-hit calculator for the GURPS sheet's Combat tab. The pure half is exported for
   Node tests; the DOM half runs only in a browser. Mirrors js/gurps-live.js. */
(function (root) {
  'use strict';

  // ---------- rules numbers (names and numbers only; page references from the GURPS rules) ----------

  // Aim: Acc, then +1 for a 2nd turn and +2 for 3 or more (B364); braced +1 (B364).
  const EXTRA_AIM = [0, 0, 1, 2];
  const MAX_EXTRA_AIM_TURNS = 3;      // the extra-aim bonus stops growing at 3 turns (B364)
  const BRACED = 1;
  // Sighting aids together add no more than base Acc (B364); a variable scope gives +1 per
  // turn aimed up to its bonus, a fixed one all of it once aimed that many turns (B412);
  // Telescopic Vision follows the scope rule, and only one scope counts at a time (B92, B412).
  // All aiming bonuses together are at most twice Acc (B372); from a moving vehicle, at most
  // the vehicle's SR (B469).
  const AIM_LIMIT_FACTOR = 2;
  // All-Out Attack (Determined): ranged +1, melee +4 (B365). Committed Attack (Determined) +2 (MA99).
  const AOA_RANGED = 1;
  const AOA_MELEE = 4;
  const COMMITTED = 2;
  // Move and Attack: ranged takes the worse of -2 or Bulk (B325, B548); melee -4 and the
  // adjusted skill cannot exceed 9 (B325).
  const MOVE_RANGED_MIN = 2;
  const MOVE_MELEE = -4;
  const MOVE_MELEE_CAP = 9;
  const POPUP = -2;                   // pop-up attack, and no Aim (B390)
  // Rapid fire by shots (B373); 100 and more carries on in SS159 (+7 at 100, +8 at 200, +9 at
  // 400, +10 at 800); B373's own table ends at 99 shots.
  const ROF_STEPS = [[800, 10], [400, 9], [200, 8], [100, 7], [50, 6], [25, 5], [17, 4], [13, 3], [9, 2], [5, 1]];
  const RAPID_STRIKE = -6;            // each attack (B370)
  const RAPID_STRIKE_HALF = -3;       // with Trained by a Master (B93) or Weapon Master (MA48)
  const DECEPTIVE_STEP = 2;           // each -2 to hit is -1 to the foe's defence (B369, B548)
  const TELEGRAPHIC = 4;              // +4 to hit; the foe defends at +2 (MA113)
  const TELEGRAPHIC_FOE = 2;
  // Telegraphic does not stack with Evaluate and cannot be combined with Deceptive Attack (MA113).
  // Deceptive Attack may not take the final effective skill below 10 (B369).
  const DECEPTIVE_FLOOR = 10;
  // Free Fall: the lower of Free Fall and the skill is the base, then modifiers apply (B197, B344).
  // Cover (B407, B548): target only partly exposed -2; light cover or concealment -2; -4 for each
  // figure the shot passes. Target crouching, kneeling, sitting, crawling or lying: -2, but only
  // against the torso, groin or a leg (B548, B551).
  const COVER = { partial: -2, light: -2 };
  const BEHIND = -4;
  const BEHIND_MAX = 20;
  const TARGET_LOW = -2;
  const TARGET_LOW_LOCS = ['torso', 'groin', 'limb'];
  // Targeting systems count under the base-Acc sight cap and the twice-Acc cap when aiming
  // (B364, B372, HT155). A laser sight gives +1 with or without Aim (B412, HT156). A targeting
  // or silhouette program is a bonus to the shooting skill, not an Acc bonus (HT157), as is any
  // aid not named here: those are flat and outside the aim caps.
  const SIGHT_NAMES = ['Laser sight', 'Scope', 'HUD link', 'Smartgun'];
  // A reflex sight is +1 to the shooting skill, not to Acc, and needs no Aim (HT156); the programs
  // likewise (HT157). These apply with or without Aim whatever the sheet flagged, outside the caps.
  const SKILL_AIDS = ['Reflex sight', 'Targeting program', 'Silhouette program'];
  const SKILL_PREFIXES = ['Guns', 'Gunner', 'Beam Weapons'];
  const ALWAYS_ON = ['Laser sight'];
  const EVALUATE_MAX = 3;             // +1 a turn, at most +3 (B364)
  const DUAL = -4;                    // Dual-Weapon Attack, each attack; the foe defends at -1 (B417)
  const DUAL_FOE = -1;
  const DUAL_BOUGHT_MAX = 4;          // the technique buys off at most the -4 (B230)
  const OFF_HAND = -4;                // none with Ambidexterity (B39) or Off-Hand Weapon Training (B232); B417, B547
  const BAD_FOOTING = -2;             // -2 or worse at the GM's option (B547)
  const SHOCK_MAX = 4;                // shock is at most -4 (B419)
  const TOTAL_DARKNESS = -10;         // darkness is -1 to -9, total darkness -10 (B358); Night Vision
                                      // takes off one point a level but not from -10 (B71)
  const BLIND_CAP = 9;                // adjusted skill at most 9 when fighting blind (B389, B547)
  const FREE_FALL_BEAM_RCL = 2;       // zero gravity caps DX rolls at Free Fall; beam weapons exempt
                                      // below Rcl 2 (B197, B350)
  // Attacker's posture, melee: -2 crouching, kneeling, sitting; -4 crawling or lying (B551, B547).
  const POSTURE_MAX = 4;
  // Criticals: 3-4 always, 5 at skill 15+, 6 at 16+; misses: 18 always, 17 at skill 15 or less,
  // and any roll 10 over the skill (B556).
  const COUNTS = { 3: 1, 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3, 18: 1 };
  // Speed/Range: 2 yards is 0, then one point worse each step of 3, 5, 7, 10, 15, 20 and so on
  // by tens (B550, B372). A range between two entries takes the larger penalty.
  const RANGE_STEPS = [2, 3, 5, 7, 10, 15];

  const GROUPS = {
    ranged: ['weapon', 'aiming', 'attack', 'target', 'env', 'you', 'foe'],
    melee: ['weapon', 'setup', 'attack', 'target', 'env', 'you', 'foe'],
  };

  // ---------- reading input without trusting it ----------

  // A finite number in [min, max]; anything else is null.
  function num(v, min, max) {
    let n = null;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && v.trim() !== '') n = Number(v.replace(/−/g, '-'));
    if (n === null || !Number.isFinite(n)) return null;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }
  function int(v, min, max, neutral) {
    const n = num(v, min, max);
    return n === null ? (neutral || 0) : Math.trunc(n);
  }
  const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const isObj = (o) => o !== null && typeof o === 'object';

  // ---------- the pure functions ----------

  function rangePenalty(yards) {
    const y = num(yards, 0, 1e9);
    if (y === null) return 0;
    let pen = 0;
    for (let mult = 1; mult < 1e10; mult *= 10) {
      for (let i = 0; i < RANGE_STEPS.length; i++, pen++) {
        if (y <= RANGE_STEPS[i] * mult) return pen ? -pen : 0;
      }
    }
    return pen ? -pen : 0;
  }

  function rofBonus(shots) {
    for (const [n, b] of ROF_STEPS) if (shots >= n) return b;
    return 0;
  }

  // `crit` is the skill that sets the critical-success range; it is the skill itself unless a
  // Telegraphic Attack's +4 is in it: that +4 does not raise the chance of a critical hit
  // (MA113). Critical failures follow the full skill: MA113 says nothing of them.
  function outcome(roll, skill, crit) {
    const c = num(crit) === null ? skill : crit;
    if (roll <= 4 || (roll === 5 && c >= 15) || (roll === 6 && c >= 16)) return 'CS';
    if (roll === 18 || (roll === 17 && skill <= 15) || roll >= skill + 10) return 'CF';
    if (roll === 17) return 'F';
    return roll <= skill ? 'S' : 'F';
  }

  function dist(skill, crit) {
    const o = { CS: 0, S: 0, F: 0, CF: 0 };
    for (let r = 3; r <= 18; r++) o[outcome(r, skill, crit)] += COUNTS[r] / 216;
    return o;
  }

  function odds(skill, crit) {
    const s = num(skill);
    if (s === null || s < 3) return { hit: 0, crit: 0, fumble: 0, none: true };
    const d = dist(s, num(crit) === null ? undefined : crit);
    return { hit: d.CS + d.S, crit: d.CS, fumble: d.CF, none: false };
  }

  // The weapon's skill's techniques: shared by effective() and the page.
  function techniquesFor(data, weapon) {
    const t = (data && data.techniques) || {};
    const skill = weapon && weapon.skill;
    const mine = (list) => (Array.isArray(list) ? list : []).filter((x) => x && x.skill === skill);
    return { targeted: mine(t.targeted), other: mine(t.other) };
  }

  // A weapon is named by its `id` (unique); a block or a saved state from before ids existed names
  // it by `key`, which finds the first weapon of that name.
  const wid = (w) => String(w.id !== undefined && w.id !== null ? w.id : w.key);
  function findWeapon(list, ref) {
    return list.find((w) => w && wid(w) === ref) || list.find((w) => w && w.key === ref) || null;
  }
  function pickWeapon(data, ref) {
    const list = data && Array.isArray(data.weapons) ? data.weapons : [];
    return findWeapon(list, ref) || list[0] || null;
  }

  // opts.delta: the page's live to-hit number less the one the sheet printed (encumbrance changes
  // it); one line in `you`. Everything else works from the authored level in the data block.
  function effective(data, state, opts) {
    const st = isObj(state) ? state : {};
    const w = pickWeapon(data, st.weapon);
    if (!w) return { type: 'melee', roll: 0, critSkill: 0, lines: [], cap: null, included: null, notes: [], foe: null };

    const ranged = w.type === 'ranged';
    const type = ranged ? 'ranged' : 'melee';
    const traits = (data && data.traits) || {};
    const lines = [];
    const notes = [];
    const caps = [];
    let foeAdj = 0;
    let deceptive = 0;
    let telegraphicOn = false;
    const add = (group, label, value) => { if (value) lines.push({ group, label, value }); };

    const acc = ranged ? int(w.acc, 0, 99) : 0;
    const rof = ranged ? int(w.rof, 1, 9999, 1) : 1;
    const rcl = ranged ? int(w.rcl, 1, 99, 1) : 1;
    const bulk = ranged ? Math.abs(int(w.bulk, -99, 99)) : 0;
    const skill = typeof w.skill === 'string' ? w.skill : '';
    const level = int(w.level, -99, 99);
    const baseN = num(w.base);
    const base = baseN === null ? null : Math.trunc(baseN);
    const mine = techniquesFor(data, w);

    // The first line: the weapon's own level, or a technique's in its place.
    const tech = typeof st.technique === 'string' && st.technique
      ? mine.other.find((t) => t.name === st.technique) : null;
    // The Skill cell's level includes the row's own bonuses (the documented standard), so they
    // are never added here; when the level is above the skills-table level, `included` says so.
    // A picked technique carries that difference, since the technique is worked from the skill.
    let start = level;
    let startName = skill || w.name || 'Sheet to-hit';
    let included = null;
    const gap = base !== null && level > base ? level - base : 0;
    if (gap) {
      const names = (Array.isArray(w.bonuses) ? w.bonuses : []).map((b) => (b && typeof b.name === 'string' ? b.name : '')).filter(Boolean);
      included = { amount: gap, over: `${skill} ${base}`.trim(), names };
    }
    if (tech) {
      start = int(tech.level, -99, 99) + gap;
      startName = tech.name;
    }
    let startLabel = startName + (tech && gap ? ` (+${gap} included)` : '');
    // Free Fall replaces the base skill when it is lower; modifiers apply on top (B197, B344).
    // A beam weapon below Rcl 2 is exempt (B350).
    if (st.zerog === true) {
      const ff = num(data.freeFall) === null ? null : Math.trunc(num(data.freeFall));
      if (ranged && w.beam === true && rcl < FREE_FALL_BEAM_RCL) {
        notes.push('Zero gravity does not limit a beam weapon with Rcl under 2.');
      } else if (ff === null) {
        notes.push('The sheet has no Free Fall skill, so there is no zero-gravity limit to apply.');
      } else {
        const bonus = included ? included.amount : 0;
        const rolled = start - bonus;
        if (ff < rolled) {
          start = ff + bonus;
          startLabel = `Free Fall ${ff} in place of ${startName} ${rolled}` + (bonus ? ` (+${bonus} included)` : '');
        }
      }
    }
    lines.push({ group: 'weapon', label: startLabel, value: start });

    const man = typeof st.man === 'string' ? st.man : 'attack';
    const aim = int(st.aim, 0, 6);

    if (ranged) {
      const noAim = man === 'move' || man === 'popup';
      const aids = aidsFor(data, w);
      const isSight = (a) => SIGHT_NAMES.indexOf(a.name) >= 0;
      const alwaysOn = (a) => ALWAYS_ON.indexOf(a.name) >= 0 || a.acc !== true;
      if (aim > 0 && !noAim) {
        let flat = 0;
        const flatNames = [];
        let scope = 0;
        let scopeName = '';
        const tryScope = (name, bonus, fixed) => {
          let v;
          if (fixed) {
            v = aim >= bonus ? bonus : 0;
            if (aim < bonus) notes.push(`A fixed ${name.toLowerCase()} gives its +${bonus} only after ${bonus} turns of aiming.`);
          } else {
            v = Math.min(bonus, aim);
            if (aim < bonus) notes.push(`A scope gives +1 for each turn aimed, so +${bonus} needs ${bonus} turns.`);
          }
          if (v > scope) { scope = v; scopeName = name; }
        };
        for (const a of aids) {
          if (!isSight(a) || !ticked(st, a)) continue;
          const b = aidValue(st, a);
          if (!b) continue;
          if (a.name === 'Scope') tryScope('Scope', b, a.fixed === true);
          else { flat += b; flatNames.push(a.name); }
        }
        const manual = int(st.scope, 0, 20);
        if (manual > 0) tryScope('Scope', manual, false);
        const tv = int(traits.telescopic, 0, 20);
        if (tv > 0) tryScope('Telescopic Vision', tv, false);
        const sights = Math.min(flat + scope, acc);
        const extra = EXTRA_AIM[Math.min(aim, MAX_EXTRA_AIM_TURNS)];
        const braced = st.braced === true ? BRACED : 0;
        const parts = acc + extra + braced + sights;
        let limit = AIM_LIMIT_FACTOR * acc;
        let why = parts > limit ? 'capped at twice Acc' : '';
        const sr = int(st.sr, 0, 99);
        if (sr > 0 && sr < Math.min(parts, limit)) { limit = sr; why = "capped at the vehicle's SR"; }
        const names = flatNames.concat(scope ? [scopeName] : []);
        add('aiming',
          `Acc ${acc}` + (extra ? `, +${extra} extra aim` : '') + (braced ? ', braced' : '') +
          (sights ? `, sighting aids +${sights} (${names.join(', ')})` : '') + (why ? ` (${why})` : ''),
          Math.min(parts, limit));
      } else if (aim > 0) {
        notes.push('Move and Attack and pop-up attacks get no Aim bonus.');
      }
      // Flat aids: programs and unknown aids always; a sight that needs no Aim when it is not
      // counted in the aiming line above.
      const aimed = aim > 0 && !noAim;
      for (const a of aids) {
        if (!ticked(st, a)) continue;
        if (isSight(a)) { if (aimed || !alwaysOn(a)) continue; } else if (a.acc === true && !aimed && SKILL_AIDS.indexOf(a.name) < 0) continue; // an unknown aid marked Acc needs Aim
        add('aiming', a.name, aidValue(st, a));
      }
      if (man === 'aod') add('attack', 'All-Out Attack (Determined)', AOA_RANGED);
      if (man === 'move') add('attack', 'Move and Attack', -Math.max(MOVE_RANGED_MIN, bulk));
      if (man === 'popup') add('attack', 'Pop-up attack', POPUP);
      const yards = num(st.yards, 0, 1e8) || 0;
      const speed = num(st.speed, 0, 1e8) || 0;
      add('target', `Range ${yards} yd` + (speed ? ` + speed ${speed}` : ''), rangePenalty(yards + speed));
      const shots = int(st.shots, 1, 999, 1) || 1;
      add('attack', `Rapid fire, ${shots} shots`, rofBonus(shots));
      if (shots > rof) notes.push(`This weapon's RoF is ${rof}.`);
      if (shots > 1) notes.push(`Every ${rcl > 1 ? rcl + ' points' : 'point'} the roll is made by lands one more hit, up to ${shots}.`);
      const cover = typeof st.cover === 'string' ? COVER[st.cover] : undefined;
      if (cover) add('env', st.cover === 'light' ? 'Light cover or concealment' : 'Target only partly exposed', cover);
      add('env', 'Shot passes other figures', BEHIND * int(st.behind, 0, BEHIND_MAX));
    } else {
      const telegraphic = st.telegraphic === true;
      const evaluate = int(st.evaluate, 0, EVALUATE_MAX);
      if (evaluate && telegraphic) notes.push('Telegraphic Attack does not stack with Evaluate: the +4 stands in its place.');
      else add('setup', 'Evaluate', evaluate);
      const feint = int(st.feint, 0, 30);
      if (feint) { foeAdj -= feint; notes.push(`Feint won by ${feint}: the foe defends at −${feint}.`); }
      if (man === 'aod') add('attack', 'All-Out Attack (Determined)', AOA_MELEE);
      if (man === 'committed') add('attack', 'Committed Attack (Determined)', COMMITTED);
      if (man === 'move') { add('attack', 'Move and Attack', MOVE_MELEE); caps.push({ value: MOVE_MELEE_CAP, why: 'Move and Attack' }); }
      if (man === 'aodbl') notes.push('All-Out Attack (Double): two attacks at this number. The off hand takes its usual penalty.');
      if (man === 'aos') notes.push('All-Out Attack (Strong): no change to the roll. +2 damage, or +1 a die if better.');
      if (st.rapid === true && man === 'move') notes.push('Rapid Strike is not allowed with Move and Attack: it is ignored.');
      else if (st.rapid === true) add('attack', 'Rapid Strike, each attack', traits.halfRapid === true ? RAPID_STRIKE_HALF : RAPID_STRIKE);
      if (telegraphic) { add('attack', 'Telegraphic Attack', TELEGRAPHIC); foeAdj += TELEGRAPHIC_FOE; telegraphicOn = true; }
      deceptive = int(st.deceptive, -8, 0);
      if (deceptive && telegraphic) {
        notes.push('Telegraphic Attack and Deceptive Attack cannot be combined: Deceptive Attack is ignored.');
        deceptive = 0;
      }
      const posture = int(st.posture, -POSTURE_MAX, 0);
      add('you', 'Your posture', posture);
    }

    if (st.dual === true && man === 'aodbl' && !ranged) {
      notes.push('All-Out Attack (Double) with two weapons: one of the two attacks is traded for the Dual-Weapon Attack, giving three attacks.');
    }
    if (st.dual === true) {
      const dualMap = isObj(data.techniques) && isObj(data.techniques.dual) ? data.techniques.dual : {};
      const bought = int(dualMap[skill], 0, DUAL_BOUGHT_MAX);
      add('attack', 'Two weapons at once' + (bought ? ` (technique +${bought})` : ''), DUAL + bought);
      foeAdj += DUAL_FOE;
      notes.push('Both attacks on one foe: the foe defends at −1.');
    }
    if (st.offhand === true) {
      const offList = Array.isArray(traits.offHand) ? traits.offHand : [];
      if (traits.ambidextrous === true) notes.push('Ambidexterity: no off-hand penalty.');
      else if (offHand(offList, skill)) notes.push('Off-Hand Weapon Training for this skill: no off-hand penalty.');
      else add('attack', 'Off hand', OFF_HAND);
    }

    // Hit location: a matching Targeted Attack technique replaces the plain penalty.
    const locs = data && Array.isArray(data.locations) ? data.locations : [];
    const loc = locs.find((l) => Array.isArray(l) && l[0] === st.loc);
    if (loc && num(loc[2])) {
      const ta = mine.targeted.find((t) => t.loc === loc[0] && num(t.net) !== null);
      if (ta) add('target', `${loc[1]} (Targeted Attack, plain ${sgn(loc[2])})`, int(ta.net, -99, 99));
      else add('target', loc[1], int(loc[2], -99, 99));
    }
    if (ranged && st.targetLow === true && (!loc || TARGET_LOW_LOCS.indexOf(loc[0]) >= 0)) {
      add('target', 'Target crouching, kneeling, sitting or lying', TARGET_LOW);
      if (loc && loc[0] === 'limb') notes.push('A low target is harder to hit in the legs only; take it off for an arm.');
    }
    add('target', 'Target size', int(st.sm, -30, 30));

    let vis = int(st.vis, TOTAL_DARKNESS, 0);
    if (vis <= TOTAL_DARKNESS) {
      caps.push({ value: BLIND_CAP, why: 'total darkness' });
    } else if (vis < 0) {
      const nv = int(traits.nightVision, 0, 9);
      if (nv) { vis = Math.min(0, vis + nv); }
    }
    add('env', 'Light and visibility', vis);
    if (st.footing === true) add('env', 'Bad footing', BAD_FOOTING);
    add('you', 'Shock', -Math.abs(int(st.shock, -SHOCK_MAX, SHOCK_MAX)));

    add('you', 'Anything else', int(st.other, -30, 30));
    const delta = isObj(opts) ? int(opts.delta, -99, 99) : 0;
    if (delta) add('you', delta < 0 ? 'Encumbrance' : "Sheet's live number", delta);

    // The lowest cap that is below the roll is the one that bites.
    const settle = () => {
      let r = lines.reduce((a, l) => a + l.value, 0);
      let c = null;
      for (const k of caps) if (k.value < r && (!c || k.value < c.value)) c = k;
      return { roll: c ? c.value : r, cap: c };
    };
    let { roll, cap } = settle();
    // Deceptive Attack: only as many -2 steps as keep the final skill at 10 or more (B369).
    if (deceptive) {
      const want = Math.round(-deceptive / DECEPTIVE_STEP);
      const room = Math.max(0, Math.floor((roll - DECEPTIVE_FLOOR) / DECEPTIVE_STEP));
      const steps = Math.min(want, room);
      if (steps < want) notes.push('Deceptive Attack cannot take the final skill below 10' + (steps ? `: only \u2212${steps * DECEPTIVE_STEP} applied.` : ': it is not applied.'));
      if (steps) {
        add('attack', 'Deceptive Attack', -steps * DECEPTIVE_STEP);
        foeAdj -= steps;
        ({ roll, cap } = settle());
      }
    }
    // Below 3 the page says "no roll", though B369 has a 3 or 4 always hit; the rules server
    // says nothing stops the attempt, so this follows the plan and is reported as a difference.
    if (roll < 3) notes.push('Below 3 there is no roll to make.');

    // The skill that sets the critical-success range: the roll without Telegraphic's +4 (MA113).
    let critSkill = roll;
    if (telegraphicOn) {
      const keep = lines.filter((l) => l.label !== 'Telegraphic Attack');
      let r = keep.reduce((a, l) => a + l.value, 0);
      for (const k of caps) if (k.value < r) r = k.value;
      critSkill = Math.min(roll, r);
    }

    let foe = null;
    const foeIn = int(st.foe, 0, 40);
    if (foeIn > 0 && roll >= 3) {
      const defence = foeIn + foeAdj;
      let defends = 0;
      for (let r = 3; r <= 18; r++) {
        const o = outcome(r, defence);
        if (o === 'CS' || o === 'S') defends += COUNTS[r] / 216;
      }
      const d = dist(roll, critSkill);
      foe = { defence, defends, lands: d.CS + d.S * (1 - defends) };
    }
    return { type, roll, critSkill, lines, cap, included, notes, foe };
  }

  // Aids offered on a weapon: its own row's, then the character-wide ones (ranged only). One
  // physical aid found in both places (same name) is the row's. Each comes back with `on`, its
  // start for THIS weapon, and `tick`, the key its tick is kept under in state.aids: a
  // character-wide aid has a tick per weapon, so changing it on one weapon leaves the others.
  // A character-wide skill bonus (program, reflex sight) starts ticked only where the shooting
  // skill is one it helps: the aid's own `skills` prefixes, else Guns, Gunner, Beam Weapons.
  function aidsFor(data, w) {
    if (!w || w.type !== 'ranged') return [];
    const own = Array.isArray(w.aids) ? w.aids : [];
    const wide = data && Array.isArray(data.aids) ? data.aids : [];
    const ids = new Set();
    const names = new Set();
    const out = [];
    const take = (a, isWide) => {
      if (!a || ids.has(a.id) || names.has(a.name)) return;
      ids.add(a.id);
      names.add(a.name);
      let on = a.on === true;
      if (isWide && on && SKILL_AIDS.indexOf(a.name) >= 0) {
        const prefixes = Array.isArray(a.skills) && a.skills.length ? a.skills : SKILL_PREFIXES;
        const sk = typeof w.skill === 'string' ? w.skill : '';
        on = prefixes.some((p) => typeof p === 'string' && sk.indexOf(p) === 0);
      }
      out.push(Object.assign({}, a, { on, tick: isWide ? `${a.id}@${wid(w)}` : a.id }));
    };
    own.forEach((a) => take(a, false));
    wide.forEach((a) => take(a, true));
    return out;
  }

  // Which controls cannot be used together (MA113): the page disables the one marked true.
  function conflicts(state) {
    const st = isObj(state) ? state : {};
    const telegraphic = st.telegraphic === true;
    return { telegraphic: !telegraphic && int(st.deceptive, -8, 0) < 0, deceptive: telegraphic, rapid: st.man === 'move' };
  }
  const ticked = (st, a) => {
    if (!isObj(st.aids)) return false;
    return (a.tick !== undefined && a.tick in st.aids) ? st.aids[a.tick] === true : st.aids[a.id] === true;
  };
  function aidValue(st, a) {
    if (a.bonus !== null && a.bonus !== undefined) return int(a.bonus, 0, 30);
    return isObj(st.aidBonus) ? int(st.aidBonus[a.id], 0, 30) : 0;
  }
  const offHand = (list, skill) => list.indexOf(skill) >= 0;

  // ---------- the page's state: its start, and what is trusted when read back ----------

  // The values each choice box offers; a saved value outside them is not trusted.
  const MANEUVERS = ['attack', 'aod', 'move', 'popup', 'aodbl', 'aos', 'committed'];
  const ONE_OF = {
    deceptive: [0, -2, -4, -6, -8], posture: [0, -2, -4], cover: [0, 'partial', 'light'],
  };
  const RANGE_OF = { aim: [0, 6], scope: [0, 6], sm: [-6, 10], vis: [-10, 0], shock: [-4, 0], evaluate: [0, 3] };
  const FLAGS = ['braced', 'dual', 'offhand', 'targetLow', 'footing', 'zerog', 'rapid', 'telegraphic'];
  const BOXES = ['sr', 'shots', 'yards', 'speed', 'behind', 'feint', 'other', 'foe'];

  // Every control at its neutral value; every aid ticked as the data block's `on` says.
  function defaultState(data) {
    const list = data && Array.isArray(data.weapons) ? data.weapons.filter(isObj) : [];
    const aids = {};
    for (const w of list) for (const a of aidsFor(data, w)) if (typeof a.tick === 'string') aids[a.tick] = a.on === true;
    const locs = data && Array.isArray(data.locations) ? data.locations : [];
    const s = {
      weapon: list.length ? wid(list[0]) : '', technique: '', aim: 0, scope: 0, sm: 0, vis: 0, shock: 0, evaluate: 0,
      deceptive: 0, posture: 0, cover: 0, man: 'attack', loc: locs.some((l) => Array.isArray(l) && l[0] === 'torso') ? 'torso' : '',
      aids, aidBonus: {},
    };
    for (const k of FLAGS) s[k] = false;
    for (const k of BOXES) s[k] = '';
    return s;
  }

  // A saved state, or anything at all, turned into a state the page can use: each field is
  // kept only if it is one a control could have written, else it is the default.
  function cleanState(data, raw) {
    const s = defaultState(data);
    if (!isObj(raw) || Array.isArray(raw)) return s;
    const list = data && Array.isArray(data.weapons) ? data.weapons.filter(isObj) : [];
    const w = typeof raw.weapon === 'string' ? findWeapon(list, raw.weapon) : null;
    if (w) s.weapon = wid(w);
    const mine = techniquesFor(data, findWeapon(list, s.weapon));
    if (typeof raw.technique === 'string' && mine.other.some((t) => t.name === raw.technique)) s.technique = raw.technique;
    for (const k of Object.keys(RANGE_OF)) {
      const n = typeof raw[k] === 'number' && Number.isInteger(raw[k]) ? raw[k] : null;
      if (n !== null && n >= RANGE_OF[k][0] && n <= RANGE_OF[k][1]) s[k] = n;
    }
    for (const k of Object.keys(ONE_OF)) if (ONE_OF[k].indexOf(raw[k]) >= 0) s[k] = raw[k];
    if (MANEUVERS.indexOf(raw.man) >= 0) s.man = raw.man;
    const locs = data && Array.isArray(data.locations) ? data.locations : [];
    if (locs.some((l) => Array.isArray(l) && l[0] === raw.loc)) s.loc = raw.loc;
    for (const k of FLAGS) if (typeof raw[k] === 'boolean') s[k] = raw[k];
    for (const k of BOXES) {
      const v = raw[k];
      if (typeof v === 'number' && Number.isFinite(v)) s[k] = String(v);
      else if (typeof v === 'string' && num(v) !== null) s[k] = v.trim();
    }
    if (isObj(raw.aids)) for (const id of Object.keys(s.aids)) if (typeof raw.aids[id] === 'boolean') s.aids[id] = raw.aids[id];
    if (isObj(raw.aidBonus)) {
      const ids = new Set();
      for (const w of list) for (const a of aidsFor(data, w)) ids.add(a.id);
      for (const id of ids) {
        const n = Object.prototype.hasOwnProperty.call(raw.aidBonus, id) ? num(raw.aidBonus[id], 0, 30) : null;
        if (n !== null) s.aidBonus[id] = n;
      }
    }
    return s;
  }

  const api = { effective, outcome, odds, rangePenalty, techniquesFor, aidsFor, conflicts, defaultState, cleanState, weaponId: wid, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__gurpsTohit = api;
  if (typeof document === 'undefined') return;

  // ---------- the page ----------
  // Every string that came from the data block or from effective() is set as text
  // (textContent, or a value on a control), never parsed as markup.

  const TITLES = { aiming: 'Aiming', setup: 'Setup', attack: 'Attack', target: 'Target', env: 'Environment', you: 'You', foe: "Foe's defence" };
  const OPEN_BY_DEFAULT = ['aiming', 'setup', 'attack'];
  const FROM_TAG = { row: 'weapon', gear: 'gear', trait: 'trait' };
  const weaponId = wid;
  const SAY_DELAY = 600;
  const WHY_OFF = { telegraphic: 'Not with a Deceptive Attack', deceptive: 'Not with a Telegraphic Attack', rapid: 'Not with Move and Attack' };
  const OUTCOME_WORDS = { CS: 'critical hit', S: 'hit', F: 'miss', CF: 'critical miss' };
  const pctWord = (x) => (x * 100).toFixed(x > 0.9995 || x < 0.0005 ? 0 : 1);
  // "Critical hit on 3 to 4, hit up to 11, miss from 12, critical miss on 17 to 18"
  function stripWords(kinds) {
    const runs = [];
    kinds.forEach((k, i) => {
      const r = i + 3;
      const last = runs[runs.length - 1];
      if (last && last.k === k) last.to = r; else runs.push({ k, from: r, to: r });
    });
    return runs.map((x) => {
      const word = OUTCOME_WORDS[x.k];
      const span = x.from === x.to ? x.from : x.from + ' to ' + x.to;
      if (x.k === 'S') return word + ' up to ' + x.to;
      if (x.k === 'F') return word + ' from ' + x.from;
      return word + ' on ' + span;
    }).join(', ').replace(/^./, (c) => c.toUpperCase());
  }
  const pct = (x) => (x * 100).toFixed(x > 0.9995 || x < 0.0005 ? 0 : 1) + '%';

  function mount() {
    const box = document.getElementById('tohit-calc');
    const blob = document.getElementById('gurps-tohit-data');
    if (!box || !blob) return;
    let data = null;
    try { data = JSON.parse(blob.textContent); } catch (e) { return; }
    if (!isObj(data) || !Array.isArray(data.weapons)) return;
    data.weapons = data.weapons.filter((w) => isObj(w) && typeof w.key === 'string');
    if (!data.weapons.length) return;

    // ----- what is remembered: in this browser only, and never trusted -----
    // Per campaign, so two sites on one origin with a character of the same name keep apart. A
    // setup saved under the key from before campaigns were in it is read once, then saved under the new one.
    const OLD_KEY = 'tohit-calc:' + String(data.pc);
    const KEY = typeof data.campaign === 'string' && data.campaign ? 'tohit-calc:' + data.campaign + ':' + String(data.pc) : OLD_KEY;
    let fromOldKey = false;
    function readSaved() {
      try {
        let raw = root.localStorage.getItem(KEY);
        if (raw === null || raw === undefined) { raw = root.localStorage.getItem(OLD_KEY); fromOldKey = KEY !== OLD_KEY && !!raw; }
        const got = raw ? JSON.parse(raw) : null;
        return isObj(got) ? got : null;
      } catch (e) { return null; }
    }
    const saved = readSaved();
    let state = cleanState(data, saved && saved.state);
    let open = {};
    if (saved && isObj(saved.open)) for (const g of Object.keys(TITLES)) if (typeof saved.open[g] === 'boolean') open[g] = saved.open[g];
    function write() {
      try { root.localStorage.setItem(KEY, JSON.stringify({ v: 1, state, open })); } catch (e) { /* storage is off: nothing is remembered */ }
    }

    // ----- small helpers -----
    function h(tag, attrs, kids) {
      const e = document.createElement(tag);
      if (attrs) {
        for (const k of Object.keys(attrs)) {
          const v = attrs[k];
          if (v === false || v === null || v === undefined) continue;
          if (k === 'text') e.textContent = String(v);
          else e.setAttribute(k, v === true ? '' : String(v));
        }
      }
      if (kids) for (const c of kids) if (c) e.appendChild(c);
      return e;
    }
    const clear = (e) => { e.textContent = ''; };
    const boxVal = (v) => (v === undefined || v === null || v === '' ? '' : String(v));
    const seq = (a, b) => { const out = []; const d = a <= b ? 1 : -1; for (let i = a; d > 0 ? i <= b : i >= b; i += d) out.push(i); return out; };
    const traits = isObj(data.traits) ? data.traits : {};
    const freeFall = num(data.freeFall) === null ? null : Math.floor(num(data.freeFall));
    const refs = {};

    const curWeapon = () => pickWeapon(data, state.weapon);

    // The Combat tab's own to-hit cell holds the live level (the encumbrance script changes it).
    // The weapon's row is the nth row of its name in its own table (Melee Attacks or Ranged Attacks).
    function tableRows(type) {
      const title = type === 'ranged' ? 'Ranged Attacks' : 'Melee Attacks';
      const tables = document.querySelectorAll('#tab-combat .wide');
      for (let i = 0; i < tables.length; i++) {
        const head = tables[i].querySelector('h2');
        if (head && head.textContent.trim() === title) return tables[i].querySelectorAll('[data-weapon-key]');
      }
      return [];
    }
    function liveCell(w) {
      const rows = tableRows(w.type);
      let seen = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-weapon-key') !== w.key) continue;
        if (seen++ === (w.nth || 0)) return rows[i].querySelector('.wp-tohit');
      }
      return null;
    }
    function liveLevel(w) {
      const cell = liveCell(w);
      const m = cell ? /^\s*(-?\d+)\s*$/.exec(cell.textContent) : null;
      return m ? parseInt(m[1], 10) : null;
    }
    // The sum is worked from the authored level in the data block; the live cell only gives a
    // difference from the number the sheet printed (encumbrance lowers it), added once.
    function liveDelta(w) {
      const live = liveLevel(w);
      const shown = num(w.shown);
      return live === null || shown === null ? 0 : live - Math.trunc(shown);
    }

    function changed() { calc(); write(); }
    function bind(el, fn) {
      const go = () => { fn(); changed(); };
      el.addEventListener('input', go);
      el.addEventListener('change', go);
    }

    // ----- controls -----
    function wrap(key, label, control, cls) {
      return h('div', { class: 'th-f' + (cls ? ' ' + cls : '') }, [h('label', { class: 'th-lbl', for: 'th-' + key, text: label }), control]);
    }
    function pick(key, label, options, o) {
      const parse = (o && o.parse) || String;
      const sel = h('select', { id: 'th-' + key });
      const vals = options.map((x) => String(x[0]));
      for (const x of options) sel.appendChild(h('option', { value: String(x[0]), text: x[1] }));
      const cur = String(state[key]);
      sel.value = vals.indexOf(cur) >= 0 ? cur : vals[0];
      bind(sel, () => { state[key] = parse(sel.value); });
      refs[key] = sel;
      return wrap(key, label, sel, o && o.cls);
    }
    const numeric = (v) => Number(v);
    function boxInput(key, min, max, ph, o) {
      const attrs = { type: 'number', id: 'th-' + key, min, max, placeholder: ph || '' };
      if (!(o && o.signed)) attrs.inputmode = 'numeric';
      const inp = h('input', attrs);
      inp.value = boxVal(state[key]);
      bind(inp, () => { state[key] = inp.value; });
      refs[key] = inp;
      return inp;
    }
    const numBox = (key, label, min, max, ph, o) => wrap(key, label, boxInput(key, min, max, ph, o), o && o.cls);
    function tick(key, label, tag) {
      const inp = h('input', { type: 'checkbox', id: 'th-' + key });
      inp.checked = state[key] === true;
      bind(inp, () => { state[key] = inp.checked; });
      refs[key] = inp;
      return h('label', { class: 'th-c' }, [inp, h('span', { text: label }), tag ? h('span', { class: 'th-from', text: tag }) : null]);
    }
    const checks = (kids) => h('div', { class: 'th-checks' }, kids.filter(Boolean));

    function aidControl(a, n) {
      const tag = FROM_TAG[a.from] || 'sheet';
      if (a.bonus === null || a.bonus === undefined) {
        const inp = h('input', { type: 'number', inputmode: 'numeric', id: 'th-aid-' + n, 'data-aid': a.id, min: 0, max: 30, placeholder: '?' });
        inp.value = boxVal(state.aidBonus[a.id]);
        bind(inp, () => {
          state.aidBonus[a.id] = inp.value;
          if (inp.value.trim() !== '' && Number(inp.value) > 0) state.aids[a.tick] = true;
        });
        return h('div', { class: 'th-f th-aidnum' }, [
          h('label', { class: 'th-lbl', for: 'th-aid-' + n }, [h('span', { text: a.name + ' bonus ' }), h('span', { class: 'th-from', text: tag })]), inp,
        ]);
      }
      const inp = h('input', { type: 'checkbox', id: 'th-aid-' + n, 'data-aid': a.id });
      inp.checked = state.aids[a.tick] === true;
      bind(inp, () => { state.aids[a.tick] = inp.checked; });
      return h('label', { class: 'th-c' }, [
        inp, h('span', { text: a.name + ' ' + (a.acc ? 'Acc ' : '') + '+' + int(a.bonus, 0, 30) + (a.fixed === true ? ' (fixed)' : '') }), h('span', { class: 'th-from', text: tag }),
      ]);
    }

    const SM = seq(10, -6).map((i) => [i, 'SM ' + sgn(i) + (i === 0 ? ' (human)' : '')]);
    const VIS = [[0, 'Clear']].concat(seq(-1, -9).map((i) => [i, 'Dark, fog, smoke, rain ' + sgn(i)]), [[-10, 'Total darkness −10 (max 9)']]);
    const SHOCK = seq(0, -4).map((i) => [i, i ? sgn(i) : 'None']);
    const locOptions = () => (Array.isArray(data.locations) ? data.locations : []).filter((l) => Array.isArray(l)).map((l) => [l[0], l[1] + (num(l[2]) ? ' ' + sgn(num(l[2])) : '')]);
    const bandOptions = () => [['', 'band…']].concat((Array.isArray(data.bands) ? data.bands : []).map((b) => [b, 'to ' + b + ' yd (' + sgn(rangePenalty(b)) + ')']));

    function yardsField() {
      const yards = boxInput('yards', 0, 100000, '0');
      const band = h('select', { id: 'th-band', 'aria-label': 'Range band' });
      for (const x of bandOptions()) band.appendChild(h('option', { value: String(x[0]), text: x[1] }));
      band.value = '';
      band.addEventListener('change', () => {
        if (band.value === '') return;
        state.yards = band.value; refs.yards.value = band.value; band.value = '';
        changed();
      });
      return h('div', { class: 'th-f' }, [
        h('label', { class: 'th-lbl', for: 'th-yards', text: 'Range (yards)' }),
        h('div', { class: 'th-pair' }, [yards, band]),
      ]);
    }

    function groupFields(id, w) {
      const ranged = w.type === 'ranged';
      const zerog = freeFall === null ? null : tick('zerog', 'Zero gravity (Free Fall ' + freeFall + ')');
      switch (id) {
        case 'aiming': {
          const aids = aidsFor(data, w);
          return [
            pick('aim', 'Turns aimed', seq(0, 6).map((i) => [i, i === 0 ? 'None (no Acc)' : i + (i === 1 ? ' turn' : ' turns') + (i === 1 ? ': Acc' : i === 2 ? ': Acc +1' : ': Acc +2')]), { parse: numeric }),
            pick('scope', 'Another scope', seq(0, 6).map((i) => [i, i ? '+' + i : 'None']), { parse: numeric }),
            checks([tick('braced', 'Braced +1')].concat(aids.filter((a) => a.bonus !== null && a.bonus !== undefined).map((a) => aidControl(a, aids.indexOf(a))))),
          ].concat(
            aids.filter((a) => a.bonus === null || a.bonus === undefined).map((a) => aidControl(a, aids.indexOf(a))),
            [numBox('sr', 'Moving vehicle: its SR', 1, 99, 'not moving')]
          );
        }
        case 'setup':
          return [
            pick('evaluate', 'Evaluate first', [[0, 'No'], [1, '1 turn +1'], [2, '2 turns +2'], [3, '3 turns +3']], { parse: numeric }),
            numBox('feint', 'Feint: won by', 0, 30, '0'),
          ];
        case 'attack':
          return ranged ? [
            pick('man', 'Maneuver', [['attack', 'Attack'], ['aod', 'All-Out Attack (Determined) +1'], ['move', 'Move and Attack (−2 or Bulk, no Aim)'], ['popup', 'Pop-up attack −2, no Aim']], { cls: 'th-wide' }),
            numBox('shots', 'Shots fired', 1, 999, '1'),
            checks([tick('dual', 'Two weapons at once −4'), tick('offhand', 'Off hand −4')]),
          ] : [
            pick('man', 'Maneuver', [['attack', 'Attack'], ['aod', 'All-Out Attack (Determined) +4'], ['aodbl', 'All-Out Attack (Double): two attacks'], ['aos', 'All-Out Attack (Strong): +2 damage'], ['committed', 'Committed Attack (Determined) +2'], ['move', 'Move and Attack −4 (max 9)']], { cls: 'th-wide' }),
            pick('deceptive', 'Deceptive Attack', [[0, 'None']].concat([2, 4, 6, 8].map((i) => [-i, '−' + i + ' (foe defends at −' + i / 2 + ')'])), { parse: numeric }),
            checks([
              tick('rapid', 'Rapid Strike ' + (traits.halfRapid === true ? '−3' : '−6')), tick('dual', 'Two weapons at once −4'),
              tick('telegraphic', 'Telegraphic +4'), tick('offhand', 'Off hand −4'),
            ]),
          ];
        case 'target':
          return (ranged ? [yardsField(), numBox('speed', 'Crossing speed (yd/s)', 0, 100000, '0')] : [])
            .concat([pick('sm', 'Target size (SM)', SM, { parse: numeric }), pick('loc', 'Hit location', locOptions())]);
        case 'env':
          return (ranged ? [
            pick('cover', 'Cover', [[0, 'In the open'], ['partial', 'Target partly exposed −2'], ['light', 'Light cover or concealment −2']], { parse: (v) => (v === '0' ? 0 : v) }),
            numBox('behind', 'Figures in the way (−4 each)', 0, 20, '0'),
          ] : []).concat([pick('vis', 'Light and visibility', VIS, { parse: numeric }),
            checks((ranged ? [tick('targetLow', 'Target crouching, sitting or prone −2')] : []).concat([tick('footing', 'Bad footing −2'), zerog]))]);
        case 'you':
          return (ranged ? [] : [pick('posture', 'Your posture', [[0, 'Standing'], [-2, 'Crouching, kneeling, sitting −2'], [-4, 'Crawling or lying −4']], { parse: numeric })])
            .concat([pick('shock', 'Shock from last turn', SHOCK, { parse: numeric }), numBox('other', 'Anything else (+/−)', -30, 30, '0', { signed: true })]);
        default:
          return [numBox('foe', 'Active defence (optional)', 3, 40, '')];
      }
    }

    // ----- the frame -----
    const modeEl = h('span', { class: 'th-mode', id: 'th-mode' });
    const weaponSel = h('select', { id: 'th-weapon' });
    const weaponOpts = [];
    for (const [kind, label] of [['melee', 'Melee'], ['ranged', 'Ranged']]) {
      const mine = data.weapons.filter((w) => w.type === kind);
      if (!mine.length) continue;
      const g = h('optgroup', { label });
      for (const w of mine) { const o = h('option', { value: weaponId(w) }); weaponOpts.push([o, w]); g.appendChild(o); }
      weaponSel.appendChild(g);
    }
    const wline = h('p', { class: 'th-wline', id: 'th-wline' });
    const techBox = h('div', { class: 'th-techbox', id: 'th-techbox' });
    const suggEl = h('div', { class: 'th-sugg', id: 'th-sugg' });
    const groupsEl = h('div', { class: 'th-groups', id: 'th-groups' });
    const rollEl = h('div', { class: 'th-v', id: 'th-roll' });
    const hitEl = h('div', { class: 'th-v th-sm', id: 'th-hit' });
    const critEl = h('div', { class: 'th-v th-sm', id: 'th-crit' });
    const fumbleEl = h('div', { class: 'th-v th-sm', id: 'th-fumble' });
    const stripEl = h('div', { class: 'th-strip', id: 'th-strip', role: 'img', 'aria-label': 'Result of each roll from 3 to 18' });
    // One sentence, read out politely and not on every keystroke.
    const liveEl = h('div', { class: 'th-sr', id: 'th-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
    let sayTimer = null;
    function say(text, now) {
      const set = () => { liveEl.textContent = text; sayTimer = null; };
      if (typeof root.clearTimeout === 'function' && sayTimer !== null) root.clearTimeout(sayTimer);
      if (now || typeof root.setTimeout !== 'function') set();
      else sayTimer = root.setTimeout(set, SAY_DELAY);
    }
    const cells = [];
    for (let r = 3; r <= 18; r++) { const c = h('div', { class: 'th-cell', text: r }); cells.push(c); stripEl.appendChild(c); }
    const linesEl = h('tbody', { id: 'th-lines' });
    const notesEl = h('div', { class: 'th-notes', id: 'th-notes' });
    const resetBtn = h('button', { type: 'button', id: 'th-reset', text: 'Reset' });
    const big = (k, v) => h('div', {}, [h('div', { class: 'th-k', text: k }), v]);

    clear(box);
    box.appendChild(h('h2', {}, [h('span', { text: 'To-hit calculator' }), modeEl]));
    box.appendChild(h('div', { class: 'th-body' }, [
      h('div', { class: 'th-ctrls' }, [h('div', { class: 'th-weapon' }, [
        h('label', { class: 'th-lbl', for: 'th-weapon', text: 'Weapon' }), weaponSel, wline, techBox, suggEl,
      ]), groupsEl]),
      h('div', { class: 'th-out' }, [
        h('div', { class: 'th-big' }, [
          h('div', { class: 'th-stick' }, [big('Roll', rollEl), big('Hit', hitEl)]),
          h('div', { class: 'th-sub' }, [big('Critical', critEl), big('Fumble', fumbleEl)]),
        ]),
        liveEl,
        stripEl,
        h('table', { class: 'th-lines' }, [linesEl]),
        notesEl,
        h('div', { class: 'th-actions' }, [resetBtn]),
      ]),
    ]));

    const sums = {};
    function drawWeapon() {
      const w = curWeapon();
      clear(techBox); clear(suggEl);
      const mine = techniquesFor(data, w);
      if (mine.other.length) {
        const sel = h('select', { id: 'th-tech' });
        sel.appendChild(h('option', { value: '', text: 'No technique' }));
        for (const t of mine.other) sel.appendChild(h('option', { value: t.name, text: t.name + ' (' + int(t.level, -99, 99) + ')' }));
        sel.value = state.technique;
        bind(sel, () => { state.technique = sel.value; });
        refs.technique = sel;
        techBox.appendChild(h('div', { class: 'th-f' }, [h('label', { class: 'th-lbl', for: 'th-tech', text: 'Use a technique or default instead' }), sel]));
      }
      const locs = Array.isArray(data.locations) ? data.locations : [];
      const chips = [];
      for (const t of mine.targeted) {
        const loc = locs.find((l) => Array.isArray(l) && l[0] === t.loc);
        const net = num(t.net);
        if (!loc || net === null) continue;
        const chip = h('button', { type: 'button', class: 'th-chip', 'data-loc': loc[0], 'aria-pressed': 'false', text: loc[1] + ' ' + (net ? sgn(net) : 'no penalty') + ' (plain ' + sgn(num(loc[2]) || 0) + ')' });
        chip.addEventListener('click', () => {
          state.loc = state.loc === loc[0] ? 'torso' : loc[0];
          if (refs.loc) refs.loc.value = state.loc;
          open.target = true;
          const d = groupsEl.querySelector('[data-g="target"]');
          if (d) d.open = true;
          changed();
        });
        chips.push(chip);
      }
      if (chips.length) {
        suggEl.appendChild(h('span', { text: 'Your targeted attacks: ' }));
        chips.forEach((c) => suggEl.appendChild(c));
      }
    }
    function drawGroups() {
      const w = curWeapon();
      clear(groupsEl);
      for (const id of GROUPS[w.type === 'ranged' ? 'ranged' : 'melee']) {
        if (id === 'weapon') continue;
        const d = h('details', { class: 'th-grp', 'data-g': id });
        d.open = id in open ? open[id] === true : OPEN_BY_DEFAULT.indexOf(id) >= 0;
        d.addEventListener('toggle', () => { open[id] = d.open; write(); });
        const what = h('span', { class: 'th-gwhat' });
        const sum = h('span', { class: 'th-gsum', text: '0' });
        sums[id] = { what, sum };
        d.appendChild(h('summary', {}, [h('span', { class: 'th-gname', text: TITLES[id] }), what, sum]));
        d.appendChild(h('div', { class: 'th-gfields' }, groupFields(id, w)));
        groupsEl.appendChild(d);
      }
    }
    // A greyed control says why, beside it.
    const hints = {};
    function rebuild() {
      for (const k of Object.keys(refs)) delete refs[k];
      for (const k of Object.keys(hints)) delete hints[k];
      drawWeapon();
      drawGroups();
      for (const k of Object.keys(WHY_OFF)) {
        if (!refs[k] || !refs[k].parentNode) continue;
        hints[k] = h('span', { class: 'th-hint' });
        hints[k].hidden = true;
        refs[k].parentNode.appendChild(hints[k]);
      }
    }

    // ----- the answer -----
    const row = (cls, label, value, vcls) => h('tr', { class: cls }, [h('td', { text: label }), h('td', { class: 'th-n' + (vcls ? ' ' + vcls : ''), text: value })]);
    function calc(initial) {
      const w = curWeapon();
      const res = effective(data, state, { delta: liveDelta(w) });
      modeEl.textContent = res.type === 'ranged' ? 'Ranged' : 'Melee';
      for (const [o, x] of weaponOpts) {
        o.textContent = (x.name || x.key) + ' (' + (int(x.level, -99, 99) + liveDelta(x)) + ')';
      }
      weaponSel.value = weaponId(w);
      wline.textContent = res.type === 'ranged'
        ? ['Acc ' + int(w.acc, 0, 99), 'RoF ' + int(w.rof, 1, 9999, 1), 'Rcl ' + int(w.rcl, 1, 99, 1), 'Bulk −' + Math.abs(int(w.bulk, -99, 99)), String(w.range || '')].filter(Boolean).join(' · ')
        : String(w.damage || '');

      const c = conflicts(state);
      for (const k of Object.keys(WHY_OFF)) {
        const el = refs[k];
        if (!el) continue;
        el.disabled = c[k];
        el.title = c[k] ? WHY_OFF[k] : '';
        if (el.parentNode) el.parentNode.title = c[k] ? WHY_OFF[k] : '';
        if (hints[k]) { hints[k].hidden = !c[k]; hints[k].textContent = c[k] ? WHY_OFF[k] : ''; }
      }
      const chips = suggEl.querySelectorAll('.th-chip');
      for (let i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', String(chips[i].getAttribute('data-loc') === state.loc));

      rollEl.textContent = String(res.roll);
      const o = odds(res.roll, res.critSkill);
      hitEl.textContent = o.none ? 'no roll' : pct(o.hit);
      critEl.textContent = o.none ? '—' : pct(o.crit);
      fumbleEl.textContent = o.none ? '—' : pct(o.fumble);
      const kinds = [];
      for (let r = 3; r <= 18; r++) kinds.push(o.none ? 'F' : outcome(r, res.roll, res.critSkill));
      cells.forEach((cell, i) => {
        cell.className = 'th-cell th-' + kinds[i];
        cell.setAttribute('title', 'Roll ' + (i + 3) + ': ' + (o.none ? 'no roll' : OUTCOME_WORDS[kinds[i]]));
      });
      stripEl.setAttribute('aria-label', o.none ? 'No roll: the number is below 3' : stripWords(kinds));
      const sentence = o.none ? 'Roll below 3: no roll to make.' : 'Roll ' + res.roll + ' or less on 3d6. ' + pctWord(o.hit) + ' percent to hit.';
      say(sentence, initial === true);

      clear(linesEl);
      const first = res.lines[0];
      if (first) linesEl.appendChild(row('th-first', first.label, String(first.value)));
      if (res.included) linesEl.appendChild(row('th-included', 'Includes +' + res.included.amount + ' over ' + res.included.over, ''));
      for (const id of GROUPS[res.type]) {
        if (id === 'weapon') continue;
        const mine = res.lines.slice(1).filter((l) => l.group === id);
        const s = sums[id];
        if (s) {
          if (id === 'foe') {
            s.sum.textContent = res.foe ? String(res.foe.defence) : '—';
            s.sum.className = 'th-gsum';
          } else {
            const total = mine.reduce((a, l) => a + l.value, 0);
            s.sum.textContent = total ? sgn(total) : '0';
            s.sum.className = 'th-gsum';
          }
          s.what.textContent = mine.map((l) => l.label.split(',')[0].split(' (')[0]).join(' · ');
        }
        if (!mine.length) continue;
        linesEl.appendChild(h('tr', { class: 'th-gh' }, [h('td', { colspan: 2, text: TITLES[id] })]));
        for (const l of mine) linesEl.appendChild(row('', l.label, sgn(l.value)));
      }
      if (res.cap) linesEl.appendChild(row('th-cap', 'Capped by ' + res.cap.why, 'max ' + res.cap.value));
      linesEl.appendChild(row('th-total', 'Roll this or less on 3d6', String(res.roll)));

      clear(notesEl);
      for (const n of res.notes) notesEl.appendChild(h('div', { class: 'th-note', text: n }));
      if (res.foe) {
        notesEl.appendChild(h('div', { class: 'th-note th-foe', text: 'Against a defence of ' + res.foe.defence + ' (' + pct(res.foe.defends) + ' to defend), this attack lands ' + pct(res.foe.lands) + " of the time. A critical hit can't be defended." }));
      }
    }

    weaponSel.addEventListener('change', () => {
      state.weapon = weaponSel.value;
      state.technique = '';
      rebuild();
      changed();
    });
    resetBtn.addEventListener('click', () => {
      const keep = state.weapon;
      state = defaultState(data);
      state.weapon = keep;
      open = {};
      rebuild();
      changed();
    });

    rebuild();
    calc(true);
    if (fromOldKey) write();
    if (typeof MutationObserver === 'function') {
      const obs = new MutationObserver(() => calc());
      for (const w of data.weapons) {
        const cell = liveCell(w);
        if (cell) obs.observe(cell, { childList: true, characterData: true, subtree: true });
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(typeof window !== 'undefined' ? window : globalThis);

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
  const SIGHT_NAMES = ['Laser sight', 'Reflex sight', 'Scope', 'HUD link', 'Smartgun'];
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
    return n === null ? (neutral || 0) : Math.floor(n);
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

  function outcome(roll, skill) {
    if (roll <= 4 || (roll === 5 && skill >= 15) || (roll === 6 && skill >= 16)) return 'CS';
    if (roll === 18 || (roll === 17 && skill <= 15) || roll >= skill + 10) return 'CF';
    if (roll === 17) return 'F';
    return roll <= skill ? 'S' : 'F';
  }

  function dist(skill) {
    const o = { CS: 0, S: 0, F: 0, CF: 0 };
    for (let r = 3; r <= 18; r++) o[outcome(r, skill)] += COUNTS[r] / 216;
    return o;
  }

  function odds(skill) {
    const s = num(skill);
    if (s === null || s < 3) return { hit: 0, crit: 0, fumble: 0, none: true };
    const d = dist(s);
    return { hit: d.CS + d.S, crit: d.CS, fumble: d.CF, none: false };
  }

  // The weapon's skill's techniques: shared by effective() and the page.
  function techniquesFor(data, weapon) {
    const t = (data && data.techniques) || {};
    const skill = weapon && weapon.skill;
    const mine = (list) => (Array.isArray(list) ? list : []).filter((x) => x && x.skill === skill);
    return { targeted: mine(t.targeted), other: mine(t.other) };
  }

  function pickWeapon(data, key) {
    const list = data && Array.isArray(data.weapons) ? data.weapons : [];
    return list.find((w) => w && w.key === key) || list[0] || null;
  }

  function effective(data, state) {
    const st = isObj(state) ? state : {};
    const w = pickWeapon(data, st.weapon);
    if (!w) return { type: 'melee', roll: 0, lines: [], cap: null, included: null, notes: [], foe: null };

    const ranged = w.type === 'ranged';
    const type = ranged ? 'ranged' : 'melee';
    const traits = (data && data.traits) || {};
    const lines = [];
    const notes = [];
    const caps = [];
    let foeAdj = 0;
    let deceptive = 0;
    const add = (group, label, value) => { if (value) lines.push({ group, label, value }); };

    const acc = ranged ? int(w.acc, 0, 99) : 0;
    const rof = ranged ? int(w.rof, 1, 9999, 1) : 1;
    const rcl = ranged ? int(w.rcl, 1, 99, 1) : 1;
    const bulk = ranged ? Math.abs(int(w.bulk, -99, 99)) : 0;
    const skill = typeof w.skill === 'string' ? w.skill : '';
    const level = int(w.level, -99, 99);
    const baseN = num(w.base);
    const base = baseN === null ? null : Math.floor(baseN);
    const mine = techniquesFor(data, w);

    // The first line: the weapon's own level, or a technique's in its place.
    const tech = typeof st.technique === 'string' && st.technique
      ? mine.other.find((t) => t.name === st.technique) : null;
    let start = level;
    let startLabel = skill || w.name || 'Sheet to-hit';
    let included = null;
    if (tech) {
      start = int(tech.level, -99, 99);
      startLabel = tech.name;
    } else if (base !== null && level > base) {
      included = { amount: level - base, over: `${skill} ${base}`.trim() };
    }
    // Free Fall replaces the base skill when it is lower; modifiers apply on top (B197, B344).
    // A beam weapon below Rcl 2 is exempt (B350).
    if (st.zerog === true) {
      const ff = num(data.freeFall) === null ? null : Math.floor(num(data.freeFall));
      if (ranged && w.beam === true && rcl < FREE_FALL_BEAM_RCL) {
        notes.push('Zero gravity does not limit a beam weapon with Rcl under 2.');
      } else if (ff === null) {
        notes.push('The sheet has no Free Fall skill, so there is no zero-gravity limit to apply.');
      } else {
        const bonus = included ? included.amount : 0;
        const rolled = start - bonus;
        if (ff < rolled) {
          start = ff + bonus;
          startLabel = `Free Fall ${ff} in place of ${startLabel} ${rolled}` + (bonus ? ` (+${bonus} included)` : '');
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
          if (!isSight(a) || !ticked(st, a.id)) continue;
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
        if (!ticked(st, a.id)) continue;
        if (isSight(a)) { if (aimed || !alwaysOn(a)) continue; } else if (a.acc === true && !aimed) continue;
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
      if (st.rapid === true) add('attack', 'Rapid Strike, each attack', traits.halfRapid === true ? RAPID_STRIKE_HALF : RAPID_STRIKE);
      if (telegraphic) { add('attack', 'Telegraphic Attack', TELEGRAPHIC); foeAdj += TELEGRAPHIC_FOE; }
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

    // The weapon's own bonuses, unless the level already includes them.
    if (!included && Array.isArray(w.bonuses)) {
      for (const b of w.bonuses) {
        const v = b ? int(b.bonus, -99, 99) : 0;
        if (v) add('you', `${b.name} ${sgn(v)}`, v);
      }
    }
    add('you', 'Anything else', int(st.other, -30, 30));

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

    let foe = null;
    const foeIn = int(st.foe, 0, 40);
    if (foeIn > 0 && roll >= 3) {
      const defence = foeIn + foeAdj;
      let defends = 0;
      for (let r = 3; r <= 18; r++) {
        const o = outcome(r, defence);
        if (o === 'CS' || o === 'S') defends += COUNTS[r] / 216;
      }
      const d = dist(roll);
      foe = { defence, defends, lands: d.CS + d.S * (1 - defends) };
    }
    return { type, roll, lines, cap, included, notes, foe };
  }

  // Aids offered on a weapon: its own row's, then the character-wide ones (ranged only). One
  // physical aid found in both places (same name) is the row's. Shared with the page.
  function aidsFor(data, w) {
    if (!w || w.type !== 'ranged') return [];
    const own = Array.isArray(w.aids) ? w.aids : [];
    const wide = data && Array.isArray(data.aids) ? data.aids : [];
    const ids = new Set();
    const names = new Set();
    return own.concat(wide).filter((a) => {
      if (!a || ids.has(a.id) || names.has(a.name)) return false;
      ids.add(a.id);
      names.add(a.name);
      return true;
    });
  }

  // Which controls cannot be used together (MA113): the page disables the one marked true.
  function conflicts(state) {
    const st = isObj(state) ? state : {};
    const telegraphic = st.telegraphic === true;
    return { telegraphic: !telegraphic && int(st.deceptive, -8, 0) < 0, deceptive: telegraphic };
  }
  const ticked = (st, id) => isObj(st.aids) && st.aids[id] === true;
  function aidValue(st, a) {
    if (a.bonus !== null && a.bonus !== undefined) return int(a.bonus, 0, 30);
    return isObj(st.aidBonus) ? int(st.aidBonus[a.id], 0, 30) : 0;
  }
  const offHand = (list, skill) => list.indexOf(skill) >= 0;

  const api = { effective, outcome, odds, rangePenalty, techniquesFor, aidsFor, conflicts, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__gurpsTohit = api;
  if (typeof document === 'undefined') return;
  // The DOM half follows (Task 4).
})(typeof window !== 'undefined' ? window : globalThis);

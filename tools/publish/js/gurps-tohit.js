/* To-hit calculator for the GURPS sheet's Combat tab. The pure half is exported for
   Node tests; the DOM half runs only in a browser. Mirrors js/gurps-live.js.
   It carries logic only: every rules number comes from the data block's `rules`, written by
   lib/templates/gurps/tohit-data.js from lib/templates/gurps/blocks/tohit-rules.js (#420). */
(function (root) {
  'use strict';

  const GROUPS = {
    ranged: ['weapon', 'aiming', 'attack', 'target', 'env', 'you', 'foe'],
    melee: ['weapon', 'setup', 'attack', 'target', 'env', 'you', 'foe'],
  };
  // What the page's boxes offer, which are not rules numbers: figures in the way, turns aimed,
  // another scope's bonus, and target sizes.
  const BEHIND_MAX = 20;
  const AIM_TURNS = 6;
  const SCOPE_MAX = 6;
  const SM_LOW = -6;
  const SM_HIGH = 10;
  // Shots fired: every count up to this many is offered, then only the counts where the bonus
  // steps. Past it, more shots no longer change the hits a roll can make.
  const SHOTS_EACH = 200;

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

  // How many ways each total comes up on `dice` six-sided dice.
  function diceCounts(dice) {
    let counts = { 0: 1 };
    for (let d = 0; d < dice; d++) {
      const next = {};
      for (const k of Object.keys(counts)) for (let f = 1; f <= 6; f++) next[+k + f] = (next[+k + f] || 0) + counts[k];
      counts = next;
    }
    return counts;
  }

  // ---------- the pure functions that need no rules ----------

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
  const ticked = (st, a) => {
    if (!isObj(st.aids)) return false;
    return (a.tick !== undefined && a.tick in st.aids) ? st.aids[a.tick] === true : st.aids[a.id] === true;
  };
  function aidValue(st, a) {
    if (a.bonus !== null && a.bonus !== undefined) return int(a.bonus, 0, 30);
    return isObj(st.aidBonus) ? int(st.aidBonus[a.id], 0, 30) : 0;
  }
  const offHand = (list, skill) => list.indexOf(skill) >= 0;
  // The RoF as the sheet writes it: `3`, `3×9`, `10!`.
  function rofText(w) {
    const rof = int(w.rof, 1, 9999, 1);
    const mult = int(w.rofMult, 1, 999, 1);
    return rof + (mult > 1 ? '×' + mult : '') + (w.fullAuto === true ? '!' : '');
  }

  // The values each choice box offers that are not rules numbers.
  const MANEUVERS = ['attack', 'aod', 'move', 'popup', 'aodbl', 'aos', 'committed'];
  const FLAGS = ['braced', 'dual', 'offhand', 'targetLow', 'footing', 'zerog', 'rapid', 'telegraphic'];
  const BOXES = ['sr', 'shots', 'yards', 'speed', 'behind', 'feint', 'other', 'foe'];

  // ---------- the pure functions, over one set of rules ----------

  // `R` is the data block's `rules` object (tohit-rules.js). Returns the calculator for them.
  function make(R) {
    const DICE = R.dice;
    const LOW = DICE;
    const HIGH = 6 * DICE;
    const COUNTS = diceCounts(DICE);
    const ALL = Math.pow(6, DICE);
    const POSTURE_MIN = Math.min(0, R.posture.low, R.posture.prone);
    const DECEPTIVE_OFFERED = [];
    for (let i = R.deceptiveStep; i <= R.deceptiveMax; i += R.deceptiveStep) DECEPTIVE_OFFERED.push(i);

    function rangePenalty(yards) {
      const y = num(yards, 0, 1e9);
      if (y === null) return 0;
      let pen = 0;
      for (let mult = 1; mult < 1e10; mult *= 10) {
        for (let i = 0; i < R.rangeSteps.length; i++, pen++) {
          if (y <= R.rangeSteps[i] * mult) return pen ? -pen : 0;
        }
      }
      return pen ? -pen : 0;
    }

    function rofBonus(shots) {
      for (const [n, b] of R.rofSteps) if (shots >= n) return b;
      return 0;
    }

    // The shots a weapon can fire in one attack (#457): from 1, or a full-auto weapon's least
    // burst, up to its RoF (B373, B270, B408). `shots` is the state's count held to that, a blank
    // one the full RoF; `mult` is a shotgun's projectiles per shot (B409). A melee weapon fires 1.
    function shotsFor(w, state) {
      const st = isObj(state) ? state : {};
      if (!w || w.type !== 'ranged') return { options: [1], shots: 1, min: 1, max: 1, mult: 1, over: false, under: false };
      const max = int(w.rof, 1, 9999, 1);
      const mult = int(w.rofMult, 1, 999, 1);
      const min = w.fullAuto === true ? Math.min(max, Math.ceil(max / R.fullAutoMinDivisor)) : 1;
      const options = [];
      for (let n = min; n <= Math.min(max, SHOTS_EACH); n++) options.push(n);
      if (max > SHOTS_EACH) {
        // A full-auto weapon's least burst is always offered, however large.
        if (min > SHOTS_EACH) options.push(min);
        for (const [n] of R.rofSteps.slice().reverse()) if (n > Math.max(min, SHOTS_EACH) && n < max) options.push(n);
        options.push(max);
      }
      const asked = num(st.shots);
      // A blank count is the weapon's full RoF (Ant, 2026-10-18); a saved one wins.
      const want = asked === null ? max : Math.trunc(asked);
      // A count between two offered ones is the lower: the page shows what is counted.
      let shots = options[0];
      for (const n of options) if (n <= want) shots = n;
      return { options, shots, min, max, mult, over: want > max, under: min > 1 && want < min };
    }

    // The Rcl the hits are counted at: the one the player set for this weapon (state.rcl, by
    // weapon id), else the row's, else 1. Most sheets have no Rcl column (Ant, 2026-10-18).
    const setRcl = (w, st) => (isObj(st.rcl) && w ? num(st.rcl[wid(w)], 1, 99) : null);
    function rclFor(w, state) {
      const st = isObj(state) ? state : {};
      const set = setRcl(w, st);
      return set !== null ? Math.trunc(set) : int(w && w.rcl, 1, 99, 1);
    }

    // `crit` is the skill that sets the critical-success range; it is the skill itself unless a
    // Telegraphic Attack's bonus is in it: that bonus does not raise the chance of a critical hit
    // (MA113). Critical failures follow the full skill: MA113 says nothing of them.
    function outcome(roll, skill, crit) {
      const c = num(crit) === null ? skill : crit;
      if (roll <= R.crit.always || R.crit.more.some(([r, s]) => roll === r && c >= s)) return 'CS';
      if (roll >= R.fumble.always || (roll === R.fumble.always - 1 && skill <= R.fumble.seventeenUpTo) || roll >= skill + R.fumble.over) return 'CF';
      if (roll >= R.alwaysFails) return 'F';
      return roll <= skill ? 'S' : 'F';
    }

    function dist(skill, crit) {
      const o = { CS: 0, S: 0, F: 0, CF: 0 };
      for (let r = LOW; r <= HIGH; r++) o[outcome(r, skill, crit)] += COUNTS[r] / ALL;
      return o;
    }

    function odds(skill, crit) {
      const s = num(skill);
      if (s === null || s < LOW) return { hit: 0, crit: 0, fumble: 0, none: true };
      const d = dist(s, num(crit) === null ? undefined : crit);
      return { hit: d.CS + d.S, crit: d.CS, fumble: d.CF, none: false };
    }

    // opts.delta: the page's live to-hit number less the one the sheet printed (encumbrance changes
    // it); one line in `you`. Everything else works from the authored level in the data block.
    function effective(data, state, opts) {
      const st = isObj(state) ? state : {};
      const w = pickWeapon(data, st.weapon);
      if (!w) return { type: 'melee', roll: 0, critSkill: 0, lines: [], cap: null, included: null, notes: [], foe: null, damage: null };

      const ranged = w.type === 'ranged';
      const type = ranged ? 'ranged' : 'melee';
      const traits = (data && data.traits) || {};
      const lines = [];
      const notes = [];
      const caps = [];
      let foeAdj = 0;
      let deceptive = 0;
      let telegraphicOn = false;
      let rapid = null;
      const add = (group, label, value) => { if (value) lines.push({ group, label, value }); };

      const acc = ranged ? int(w.acc, 0, 99) : 0;
      const rcl = ranged ? rclFor(w, st) : 1;
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
      // A row written as a technique (`Choke Hold-16`) is named by it; its base is the technique's level.
      const rowTech = typeof w.technique === 'string' && w.technique ? w.technique : '';
      let startName = rowTech || skill || w.name || 'Sheet to-hit';
      let included = null;
      const gap = base !== null && level > base ? level - base : 0;
      if (gap) {
        const names = (Array.isArray(w.bonuses) ? w.bonuses : []).map((b) => (b && typeof b.name === 'string' ? b.name : '')).filter(Boolean);
        included = { amount: gap, over: `${rowTech || skill} ${base}`.trim(), names };
      }
      if (tech) {
        start = int(tech.level, -99, 99) + gap;
        startName = tech.name;
      }
      let startLabel = startName + (tech && gap ? ` (+${gap} included)` : '');
      // Free Fall replaces the base skill when it is lower; modifiers apply on top. A beam weapon
      // with a low Rcl is exempt.
      if (st.zerog === true) {
        const ff = num(data.freeFall) === null ? null : Math.trunc(num(data.freeFall));
        if (ranged && w.beam === true && rcl < R.freeFallBeamRcl) {
          notes.push(`Zero gravity does not limit a beam weapon with Rcl under ${R.freeFallBeamRcl}.`);
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
      const aim = int(st.aim, 0, AIM_TURNS);

      if (ranged) {
        const noAim = man === 'move' || man === 'popup';
        const aids = aidsFor(data, w);
        const isSight = (a) => R.sightNames.indexOf(a.name) >= 0;
        const alwaysOn = (a) => R.alwaysOn.indexOf(a.name) >= 0 || a.acc !== true;
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
          const extra = R.extraAim[Math.min(aim, R.maxExtraAimTurns)];
          const braced = st.braced === true ? R.braced : 0;
          const parts = acc + extra + braced + sights;
          let limit = R.aimLimitFactor * acc;
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
          if (isSight(a)) { if (aimed || !alwaysOn(a)) continue; } else if (a.acc === true && !aimed && R.skillAids.indexOf(a.name) < 0) continue; // an unknown aid marked Acc needs Aim
          add('aiming', a.name, aidValue(st, a));
        }
        if (man === 'aod') add('attack', 'All-Out Attack (Determined)', R.aoaRanged);
        if (man === 'move') add('attack', 'Move and Attack', -Math.max(R.moveRangedMin, bulk));
        if (man === 'popup') add('attack', 'Pop-up attack', R.popup);
        const yards = num(st.yards, 0, 1e8) || 0;
        const speed = num(st.speed, 0, 1e8) || 0;
        add('target', `Range ${yards} yd` + (speed ? ` + speed ${speed}` : ''), rangePenalty(yards + speed));
        const sf = shotsFor(w, st);
        const shots = sf.shots;
        // A shotgun closer than a tenth of its 1/2D: each shell is one shot (B409). Only a range the
        // player entered counts: a blank one shows the ordinary view.
        const halfD = num(w.halfD);
        const close = sf.mult > 1 && halfD !== null && num(st.yards) !== null && yards * R.closeRangeDivisor < halfD;
        const fired = close ? shots : shots * sf.mult;
        add('attack', sf.mult > 1 && !close ? `Rapid fire, ${shots}×${sf.mult} = ${fired} shots` : `Rapid fire, ${shots} shots`, rofBonus(fired));
        if (sf.over) notes.push(`This weapon's RoF is ${rofText(w)}.`);
        if (sf.under) notes.push(`Full auto only: this weapon fires at least ${sf.min} shots.`);
        if (close) notes.push(`At under ${halfD / R.closeRangeDivisor} yd, a tenth of its 1/2D, each shell is one shot: the ×${sf.mult} goes to damage instead.`);
        rapid = { fired, close, mult: sf.mult };
        const cover = typeof st.cover === 'string' ? R.cover[st.cover] : undefined;
        if (cover) add('env', st.cover === 'light' ? 'Light cover or concealment' : 'Target only partly exposed', cover);
        add('env', 'Shot passes other figures', R.behind * int(st.behind, 0, BEHIND_MAX));
      } else {
        const telegraphic = st.telegraphic === true;
        const evaluate = int(st.evaluate, 0, R.evaluateMax);
        if (evaluate && telegraphic) notes.push(`Telegraphic Attack does not stack with Evaluate: the ${sgn(R.telegraphic)} stands in its place.`);
        else add('setup', 'Evaluate', evaluate);
        const feint = int(st.feint, 0, 30);
        if (feint) { foeAdj -= feint; notes.push(`Feint won by ${feint}: the foe defends at −${feint}.`); }
        if (man === 'aod') add('attack', 'All-Out Attack (Determined)', R.aoaMelee);
        if (man === 'committed') add('attack', 'Committed Attack (Determined)', R.committed);
        if (man === 'move') { add('attack', 'Move and Attack', R.moveMelee); caps.push({ value: R.moveMeleeCap, why: 'Move and Attack' }); }
        if (man === 'aodbl') notes.push('All-Out Attack (Double): two attacks at this number. The off hand takes its usual penalty.');
        if (man === 'aos') notes.push(`All-Out Attack (Strong): no change to the roll. ${sgn(R.aosDamage)} damage, or ${sgn(R.aosPerDie)} a die if better.`);
        if (st.rapid === true && man === 'move') notes.push('Rapid Strike is not allowed with Move and Attack: it is ignored.');
        else if (st.rapid === true) add('attack', 'Rapid Strike, each attack', traits.halfRapid === true ? R.rapidStrikeHalf : R.rapidStrike);
        if (telegraphic) { add('attack', 'Telegraphic Attack', R.telegraphic); foeAdj += R.telegraphicFoe; telegraphicOn = true; }
        deceptive = int(st.deceptive, -R.deceptiveMax, 0);
        if (deceptive && telegraphic) {
          notes.push('Telegraphic Attack and Deceptive Attack cannot be combined: Deceptive Attack is ignored.');
          deceptive = 0;
        }
        const posture = int(st.posture, POSTURE_MIN, 0);
        add('you', 'Your posture', posture);
      }

      if (st.dual === true && man === 'aodbl' && !ranged) {
        notes.push('All-Out Attack (Double) with two weapons: one of the two attacks is traded for the Dual-Weapon Attack, giving three attacks.');
      }
      if (st.dual === true) {
        const dualMap = isObj(data.techniques) && isObj(data.techniques.dual) ? data.techniques.dual : {};
        const bought = int(dualMap[skill], 0, R.dualBoughtMax);
        add('attack', 'Two weapons at once' + (bought ? ` (technique +${bought})` : ''), R.dual + bought);
        foeAdj += R.dualFoe;
        notes.push(`Both attacks on one foe: the foe defends at ${sgn(R.dualFoe)}.`);
      }
      if (st.offhand === true) {
        const offList = Array.isArray(traits.offHand) ? traits.offHand : [];
        if (traits.ambidextrous === true) notes.push('Ambidexterity: no off-hand penalty.');
        else if (offHand(offList, skill)) notes.push('Off-Hand Weapon Training for this skill: no off-hand penalty.');
        else {
          // The technique buys the penalty off a point a level.
          const offMap = isObj(data.techniques) && isObj(data.techniques.offHand) ? data.techniques.offHand : {};
          const bought = int(offMap[skill], 0, R.offHandBoughtMax);
          if (bought >= R.offHandBoughtMax) notes.push('Off-Hand Weapon Training for this skill: no off-hand penalty.');
          else add('attack', 'Off hand' + (bought ? ` (technique +${bought})` : ''), R.offHand + bought);
        }
      }

      // Hit location: a matching Targeted Attack technique replaces the plain penalty.
      const locs = data && Array.isArray(data.locations) ? data.locations : [];
      const loc = locs.find((l) => Array.isArray(l) && l[0] === st.loc);
      if (loc && num(loc[2])) {
        const ta = mine.targeted.find((t) => t.loc === loc[0] && num(t.net) !== null);
        if (ta) add('target', `${loc[1]} (Targeted Attack, plain ${sgn(loc[2])})`, int(ta.net, -99, 99));
        else add('target', loc[1], int(loc[2], -99, 99));
      }
      if (ranged && st.targetLow === true && (!loc || R.targetLowLocs.indexOf(loc[0]) >= 0)) {
        add('target', 'Target crouching, kneeling, sitting or lying', R.targetLow);
      }
      add('target', 'Target size', int(st.sm, -30, 30));

      let vis = int(st.vis, R.totalDarkness, 0);
      if (vis <= R.totalDarkness) {
        caps.push({ value: R.blindCap, why: 'total darkness' });
      } else if (vis < 0) {
        const nv = int(traits.nightVision, 0, 9);
        if (nv) { vis = Math.min(0, vis + nv); }
      }
      add('env', 'Light and visibility', vis);
      if (st.footing === true) add('env', 'Bad footing', R.badFooting);
      add('you', 'Shock', -Math.abs(int(st.shock, -R.shockMax, R.shockMax)));

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
      // Deceptive Attack: only as many steps as keep the final skill at its floor or more.
      if (deceptive) {
        const want = Math.round(-deceptive / R.deceptiveStep);
        const room = Math.max(0, Math.floor((roll - R.deceptiveFloor) / R.deceptiveStep));
        const steps = Math.min(want, room);
        if (steps < want) notes.push(`Deceptive Attack cannot take the final skill below ${R.deceptiveFloor}` + (steps ? `: only −${steps * R.deceptiveStep} applied.` : ': it is not applied.'));
        if (steps) {
          add('attack', 'Deceptive Attack', -steps * R.deceptiveStep);
          foeAdj -= steps;
          ({ roll, cap } = settle());
        }
      }
      // Below the lowest roll the page says "no roll", though a 3 or 4 always hits; the rules server
      // says nothing stops the attempt, so this follows the plan and is reported as a difference.
      if (roll < LOW) notes.push(`Below ${LOW} there is no roll to make.`);

      // The skill that sets the critical-success range: the roll without Telegraphic's bonus (MA113).
      let critSkill = roll;
      if (telegraphicOn) {
        const keep = lines.filter((l) => l.label !== 'Telegraphic Attack');
        let r = keep.reduce((a, l) => a + l.value, 0);
        for (const k of caps) if (k.value < r) r = k.value;
        critSkill = Math.min(roll, r);
      }

      let foe = null;
      const foeIn = int(st.foe, 0, 40);
      if (foeIn > 0 && roll >= LOW) {
        const defence = foeIn + foeAdj;
        let defends = 0;
        for (let r = LOW; r <= HIGH; r++) {
          const o = outcome(r, defence);
          if (o === 'CS' || o === 'S') defends += COUNTS[r] / ALL;
        }
        const d = dist(roll, critSkill);
        foe = { defence, defends, lands: d.CS + d.S * (1 - defends) };
      }
      return { type, roll, critSkill, lines, cap, included, notes, foe, damage: damageFor(w, st, man, roll, rapid, rcl) };
    }

    // The damage rolls to make (#458); nothing is rolled here. Each hit is its own damage roll
    // (B379). A rapid-fire attack hits once, and once more for each full Rcl the roll is made by,
    // up to the shots fired (B373): `bands` gives, for each band of margin of success, the hits
    // it means; the last band (`to` null) is that margin or more. A shotgun closer than a tenth
    // of its 1/2D multiplies each hit's damage, and the target's DR, by half its multiplier,
    // rounded down (B409).
    function damageFor(w, st, man, roll, rapid, rcl) {
      const ranged = w.type === 'ranged';
      const maxHits = rapid ? rapid.fired : 1;
      const bands = [];
      // The largest margin the roll can be made by is the roll less the lowest roll: the bands
      // stop there, and the last one reads "or more".
      const most = roll - LOW;
      if (maxHits > 1 && most >= 0) {
        for (let hits = 1; hits <= maxHits && (hits - 1) * rcl <= most; hits++) {
          const last = hits === maxHits || hits * rcl > most;
          bands.push({ from: (hits - 1) * rcl, to: last ? null : hits * rcl - 1, hits });
        }
      }
      const text = typeof w.damage === 'string' ? w.damage.trim() : '';
      // Dice to roll: `3d`, `1d-3`, `d6`, `4dx3`, or swing or thrust (sw, thr). A cell without them
      // (`control`, an affliction's `HT-6(3) aff`) is shown as written, with no damage roll; a
      // slam's damage comes from the slam rules (B371).
      const rolled = /(?<![a-z])\d*d\d*(?:x\d+)?(?![a-z])|\b(?:sw|thr)\b/i.test(text);
      return {
        text,
        rolled,
        slam: !rolled && /\bslam\b/i.test(text),
        none: roll < LOW,
        maxHits,
        perHit: rcl,
        bands,
        close: rapid && rapid.close ? Math.floor(rapid.mult / R.closeDamageDivisor) : null,
        rclAssumed: ranged && w.noRcl === true && setRcl(w, st) === null && maxHits > 1,
        strong: !ranged && man === 'aos' ? [R.aosDamage, R.aosPerDie] : null,
        // Two weapons, Rapid Strike or All-Out Attack (Double): each attack that hits is rolled for.
        attacks: st.dual === true || (!ranged && (man === 'aodbl' || (st.rapid === true && man !== 'move'))),
      };
    }

    // Aids offered on a weapon: its own row's, then the character-wide ones (ranged only). One
    // physical aid found in both places (same name) is the row's. Each comes back with `on`, its
    // start for THIS weapon, and `tick`, the key its tick is kept under in state.aids: a
    // character-wide aid has a tick per weapon, so changing it on one weapon leaves the others.
    // A character-wide skill bonus (program, reflex sight) starts ticked only where the shooting
    // skill is one it helps: the aid's own `skills` prefixes, else the rules' shooting skills.
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
        if (isWide && on && R.skillAids.indexOf(a.name) >= 0) {
          const prefixes = Array.isArray(a.skills) && a.skills.length ? a.skills : R.skillPrefixes;
          const sk = typeof w.skill === 'string' ? w.skill : '';
          on = prefixes.some((p) => typeof p === 'string' && sk.indexOf(p) === 0);
        }
        out.push(Object.assign({}, a, { on, tick: isWide ? `${a.id}@${wid(w)}` : a.id }));
      };
      own.forEach((a) => take(a, false));
      wide.forEach((a) => take(a, true));
      // A row written above the skill by more than its named bonuses already has a character-wide
      // skill bonus in it: that aid starts unticked and says so. The surplus covers one aid, the
      // biggest that fits. Nothing can be inferred when the skills-table level is unknown.
      const baseN = num(w.base);
      const levelN = num(w.level);
      if (baseN !== null && levelN !== null) {
        const named = (Array.isArray(w.bonuses) ? w.bonuses : []).reduce((t, b) => t + (b ? (num(b.bonus) || 0) : 0), 0);
        const surplus = Math.trunc(levelN) - Math.trunc(baseN) - named;
        let best = -1;
        out.forEach((a, i) => {
          const b = num(a.bonus);
          if (a.tick === a.id || !a.on || R.skillAids.indexOf(a.name) < 0 || b === null || b <= 0 || b > surplus) return;
          if (best < 0 || b > num(out[best].bonus)) best = i;
        });
        if (best >= 0) out[best] = Object.assign({}, out[best], { on: false, inLevel: true });
      }
      return out;
    }

    // Which controls cannot be used together (MA113): the page disables the one marked true.
    function conflicts(state) {
      const st = isObj(state) ? state : {};
      const telegraphic = st.telegraphic === true;
      return { telegraphic: !telegraphic && int(st.deceptive, -R.deceptiveMax, 0) < 0, deceptive: telegraphic, rapid: st.man === 'move' };
    }

    // ---------- the page's state: its start, and what is trusted when read back ----------

    // The values each choice box offers; a saved value outside them is not trusted.
    const ONE_OF = {
      deceptive: [0].concat(DECEPTIVE_OFFERED.map((i) => -i)), posture: [0, R.posture.low, R.posture.prone], cover: [0].concat(Object.keys(R.cover)),
    };
    const RANGE_OF = { aim: [0, AIM_TURNS], scope: [0, SCOPE_MAX], sm: [SM_LOW, SM_HIGH], vis: [R.totalDarkness, 0], shock: [-R.shockMax, 0], evaluate: [0, R.evaluateMax] };

    // Every control at its neutral value; every aid ticked as the data block's `on` says.
    function defaultState(data) {
      const list = data && Array.isArray(data.weapons) ? data.weapons.filter(isObj) : [];
      const aids = {};
      for (const w of list) for (const a of aidsFor(data, w)) if (typeof a.tick === 'string') aids[a.tick] = a.on === true;
      const locs = data && Array.isArray(data.locations) ? data.locations : [];
      const s = {
        weapon: list.length ? wid(list[0]) : '', technique: '', aim: 0, scope: 0, sm: 0, vis: 0, shock: 0, evaluate: 0,
        deceptive: 0, posture: 0, cover: 0, man: 'attack', loc: locs.some((l) => Array.isArray(l) && l[0] === 'torso') ? 'torso' : '',
        aids, aidBonus: {}, rcl: {},
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
      // A tick is kept per weapon (`<aid>@<weapon>`); a state saved before that keeps one tick per
      // aid, which stands for every weapon that has no tick of its own.
      if (isObj(raw.aids)) {
        for (const tick of Object.keys(s.aids)) {
          const at = tick.lastIndexOf('@');
          const aid = at > 0 ? tick.slice(0, at) : '';
          if (typeof raw.aids[tick] === 'boolean') s.aids[tick] = raw.aids[tick];
          else if (aid && typeof raw.aids[aid] === 'boolean') s.aids[tick] = raw.aids[aid];
        }
      }
      if (isObj(raw.aidBonus)) {
        const ids = new Set();
        for (const w of list) for (const a of aidsFor(data, w)) ids.add(a.id);
        for (const id of ids) {
          const n = Object.prototype.hasOwnProperty.call(raw.aidBonus, id) ? num(raw.aidBonus[id], 0, 30) : null;
          if (n !== null) s.aidBonus[id] = n;
        }
      }
      // An Rcl the player set: kept for a ranged weapon there is, a whole number from 1 to 99.
      if (isObj(raw.rcl)) {
        for (const w of list) {
          if (w.type !== 'ranged') continue;
          const v = Object.prototype.hasOwnProperty.call(raw.rcl, wid(w)) ? num(raw.rcl[wid(w)]) : null;
          if (v !== null && Number.isInteger(v) && v >= 1 && v <= 99) s.rcl[wid(w)] = v;
        }
      }
      return s;
    }

    return {
      effective, outcome, odds, rangePenalty, techniquesFor, aidsFor, conflicts, defaultState, cleanState, shotsFor, rclFor, weaponId: wid, GROUPS,
      DECEPTIVE_OFFERED, LOW, HIGH,
    };
  }

  const api = { make };
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
  const pct = (x) => (x * 100).toFixed(x > 0.9995 || x < 0.0005 ? 0 : 1) + '%';

  function mount() {
    const box = document.getElementById('tohit-calc');
    const blob = document.getElementById('gurps-tohit-data');
    if (!box || !blob) return;
    let data = null;
    try { data = JSON.parse(blob.textContent); } catch (e) { return; }
    if (!isObj(data) || !Array.isArray(data.weapons) || !isObj(data.rules)) return;
    data.weapons = data.weapons.filter((w) => isObj(w) && typeof w.key === 'string');
    if (!data.weapons.length) return;
    const R = data.rules;
    const { effective, outcome, odds, rangePenalty, aidsFor, conflicts, defaultState, cleanState, shotsFor, rclFor, DECEPTIVE_OFFERED, LOW, HIGH } = make(R);
    const DICE_WORD = R.dice + 'd6';

    // "Critical hit on 3 to 4, hit up to 11, miss from 12, critical miss on 17 to 18"
    function stripWords(kinds) {
      const runs = [];
      kinds.forEach((k, i) => {
        const r = i + LOW;
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
      // A skill offered for its techniques has no row of its own.
      if (w.bySkill === true) return null;
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
      ].concat(a.inLevel === true ? [h('span', { class: 'th-from', text: "already in the sheet's number" })] : []));
    }

    const SM = seq(SM_HIGH, SM_LOW).map((i) => [i, 'SM ' + sgn(i) + (i === 0 ? ' (human)' : '')]);
    const VIS = [[0, 'Clear']].concat(seq(-1, R.totalDarkness + 1).map((i) => [i, 'Dark, fog, smoke, rain ' + sgn(i)]),
      [[R.totalDarkness, 'Total darkness ' + sgn(R.totalDarkness) + ' (max ' + R.blindCap + ')']]);
    const SHOCK = seq(0, -R.shockMax).map((i) => [i, i ? sgn(i) : 'None']);
    const aimWords = (i) => { const extra = R.extraAim[Math.min(i, R.maxExtraAimTurns)]; return ': Acc' + (extra ? ' ' + sgn(extra) : ''); };
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

    // Shots fired: the counts this weapon can fire, a shotgun's with its projectiles (#457). The
    // state holds the count the sum uses, so the box and the sum agree.
    function shotsField(w) {
      const sf = shotsFor(w, state);
      state.shots = String(sf.shots);
      const opts = sf.options.map((n) => [n, sf.mult > 1 ? n + '×' + sf.mult + ' (' + n * sf.mult + ')' : String(n)]);
      return pick('shots', 'Shots fired', opts);
    }
    // Rcl: the row's to start, else 1 marked as not on the sheet; what the player sets is kept for
    // this weapon and counts the hits.
    function rclField(w) {
      const id = weaponId(w);
      const inp = h('input', { type: 'number', inputmode: 'numeric', id: 'th-rcl', min: 1, max: 99 });
      inp.value = String(rclFor(w, state));
      bind(inp, () => {
        const n = num(inp.value);
        if (!isObj(state.rcl)) state.rcl = {};
        if (n !== null && Number.isInteger(n) && n >= 1 && n <= 99) state.rcl[id] = n; else delete state.rcl[id];
      });
      // Once the entry is done, an Rcl it cannot use shows the one that counts. (Not while typing:
      // clearing the box to type a new number must not refill it.)
      inp.addEventListener('change', () => { inp.value = String(rclFor(w, state)); });
      refs.rcl = inp;
      return wrap('rcl', 'Rcl' + (w.noRcl === true ? ' (not on the sheet)' : ''), inp);
    }

    function groupFields(id, w) {
      const ranged = w.type === 'ranged';
      const zerog = freeFall === null ? null : tick('zerog', 'Zero gravity (Free Fall ' + freeFall + ')');
      switch (id) {
        case 'aiming': {
          const aids = aidsFor(data, w);
          return [
            pick('aim', 'Turns aimed', seq(0, AIM_TURNS).map((i) => [i, i === 0 ? 'None (no Acc)' : i + (i === 1 ? ' turn' : ' turns') + aimWords(i)]), { parse: numeric }),
            pick('scope', 'Another scope', seq(0, SCOPE_MAX).map((i) => [i, i ? '+' + i : 'None']), { parse: numeric }),
            checks([tick('braced', 'Braced ' + sgn(R.braced))].concat(aids.filter((a) => a.bonus !== null && a.bonus !== undefined).map((a) => aidControl(a, aids.indexOf(a))))),
          ].concat(
            aids.filter((a) => a.bonus === null || a.bonus === undefined).map((a) => aidControl(a, aids.indexOf(a))),
            [numBox('sr', 'Moving vehicle: its SR', 1, 99, 'not moving')]
          );
        }
        case 'setup':
          return [
            pick('evaluate', 'Evaluate first', [[0, 'No']].concat(seq(1, R.evaluateMax).map((i) => [i, i + (i === 1 ? ' turn ' : ' turns ') + sgn(i)])), { parse: numeric }),
            numBox('feint', 'Feint: won by', 0, 30, '0'),
          ];
        case 'attack':
          return ranged ? [
            pick('man', 'Maneuver', [['attack', 'Attack'], ['aod', 'All-Out Attack (Determined) ' + sgn(R.aoaRanged)], ['move', 'Move and Attack (' + sgn(-R.moveRangedMin) + ' or Bulk, no Aim)'], ['popup', 'Pop-up attack ' + sgn(R.popup) + ', no Aim']], { cls: 'th-wide' }),
            shotsField(w),
            rclField(w),
            checks([tick('dual', 'Two weapons at once ' + sgn(R.dual)), tick('offhand', 'Off hand ' + sgn(R.offHand))]),
          ] : [
            pick('man', 'Maneuver', [['attack', 'Attack'], ['aod', 'All-Out Attack (Determined) ' + sgn(R.aoaMelee)], ['aodbl', 'All-Out Attack (Double): two attacks'], ['aos', 'All-Out Attack (Strong): ' + sgn(R.aosDamage) + ' damage'], ['committed', 'Committed Attack (Determined) ' + sgn(R.committed)], ['move', 'Move and Attack ' + sgn(R.moveMelee) + ' (max ' + R.moveMeleeCap + ')']], { cls: 'th-wide' }),
            pick('deceptive', 'Deceptive Attack', [[0, 'None']].concat(DECEPTIVE_OFFERED.map((i) => [-i, '−' + i + ' (foe defends at −' + i / R.deceptiveStep + ')'])), { parse: numeric }),
            checks([
              tick('rapid', 'Rapid Strike ' + sgn(traits.halfRapid === true ? R.rapidStrikeHalf : R.rapidStrike)), tick('dual', 'Two weapons at once ' + sgn(R.dual)),
              tick('telegraphic', 'Telegraphic ' + sgn(R.telegraphic)), tick('offhand', 'Off hand ' + sgn(R.offHand)),
            ]),
          ];
        case 'target':
          return (ranged ? [yardsField(), numBox('speed', 'Crossing speed (yd/s)', 0, 100000, '0')] : [])
            .concat([pick('sm', 'Target size (SM)', SM, { parse: numeric }), pick('loc', 'Hit location', locOptions())]);
        case 'env':
          return (ranged ? [
            pick('cover', 'Cover', [[0, 'In the open'], ['partial', 'Target partly exposed ' + sgn(R.cover.partial)], ['light', 'Light cover or concealment ' + sgn(R.cover.light)]], { parse: (v) => (v === '0' ? 0 : v) }),
            numBox('behind', 'Figures in the way (' + sgn(R.behind) + ' each)', 0, BEHIND_MAX, '0'),
          ] : []).concat([pick('vis', 'Light and visibility', VIS, { parse: numeric }),
            checks((ranged ? [tick('targetLow', 'Target crouching, sitting or prone ' + sgn(R.targetLow))] : []).concat([tick('footing', 'Bad footing ' + sgn(R.badFooting)), zerog]))]);
        case 'you':
          return (ranged ? [] : [pick('posture', 'Your posture', [[0, 'Standing'], [R.posture.low, 'Crouching, kneeling, sitting ' + sgn(R.posture.low)], [R.posture.prone, 'Crawling or lying ' + sgn(R.posture.prone)]], { parse: numeric })])
            .concat([pick('shock', 'Shock from last turn', SHOCK, { parse: numeric }), numBox('other', 'Anything else (+/−)', -30, 30, '0', { signed: true })]);
        default:
          return [numBox('foe', 'Active defence (optional)', LOW, 40, '')];
      }
    }

    // ----- the frame -----
    const modeEl = h('span', { class: 'th-mode', id: 'th-mode' });
    const weaponSel = h('select', { id: 'th-weapon' });
    const weaponOpts = [];
    for (const [kind, label, bySkill] of [['melee', 'Melee', false], ['ranged', 'Ranged', false], ['melee', 'Skills with techniques', true]]) {
      const mine = data.weapons.filter((w) => w.type === kind && (w.bySkill === true) === bySkill);
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
    const stripEl = h('div', { class: 'th-strip', id: 'th-strip', role: 'img', 'aria-label': 'Result of each roll from ' + LOW + ' to ' + HIGH });
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
    for (let r = LOW; r <= HIGH; r++) { const c = h('div', { class: 'th-cell', text: r }); cells.push(c); stripEl.appendChild(c); }
    const linesEl = h('tbody', { id: 'th-lines' });
    const notesEl = h('div', { class: 'th-notes', id: 'th-notes' });
    const dmgEl = h('div', { class: 'th-dmg', id: 'th-dmg' });
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
          // One line: on a phone the whole of it stays under the site header as the groups change.
          h('div', { class: 'th-stick' }, [big('Roll', rollEl), big('Hit', hitEl),
            h('div', { class: 'th-sub' }, [big('Critical', critEl), big('Fumble', fumbleEl)])]),
        ]),
        liveEl,
        stripEl,
        h('table', { class: 'th-lines' }, [linesEl]),
        notesEl,
        dmgEl,
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
        ? ['Acc ' + int(w.acc, 0, 99), 'RoF ' + rofText(w), w.noRcl === true ? '' : 'Rcl ' + int(w.rcl, 1, 99, 1), 'Bulk −' + Math.abs(int(w.bulk, -99, 99)), String(w.range || '')].filter(Boolean).join(' · ')
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
      for (let r = LOW; r <= HIGH; r++) kinds.push(o.none ? 'F' : outcome(r, res.roll, res.critSkill));
      cells.forEach((cell, i) => {
        cell.className = 'th-cell th-' + kinds[i];
        cell.setAttribute('title', 'Roll ' + (i + LOW) + ': ' + (o.none ? 'no roll' : OUTCOME_WORDS[kinds[i]]));
      });
      stripEl.setAttribute('aria-label', o.none ? 'No roll: the number is below ' + LOW : stripWords(kinds));
      const sentence = o.none ? 'Roll below ' + LOW + ': no roll to make.' : 'Roll ' + res.roll + ' or less on ' + DICE_WORD + '. ' + pctWord(o.hit) + ' percent to hit.';
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
      linesEl.appendChild(row('th-total', 'Roll this or less on ' + DICE_WORD, String(res.roll)));

      clear(notesEl);
      for (const n of res.notes) notesEl.appendChild(h('div', { class: 'th-note', text: n }));
      if (res.foe) {
        notesEl.appendChild(h('div', { class: 'th-note th-foe', text: 'Against a defence of ' + res.foe.defence + ' (' + pct(res.foe.defends) + ' to defend), this attack lands ' + pct(res.foe.lands) + " of the time. A critical hit can't be defended." }));
      }
      drawDamage(res.damage);
    }

    // The damage rolls to make: what to roll, and how many times. It never rolls them.
    function drawDamage(dm) {
      clear(dmgEl);
      if (!dm) return;
      if (dm.none) {
        dmgEl.appendChild(h('p', { class: 'th-dmg-how', text: 'No roll, so no damage to roll.' }));
        return;
      }
      // Laid out by the margin of success the player rolled (Ant, 2026-10-18): each row the hits
      // and the damage rolls to make, in full.
      const dmg = dm.text || "the weapon's damage";
      const roll = !dm.text || dm.rolled;
      const times = (n) => (n === 1 ? 'once' : n + ' times');
      const line = (cls, text) => dmgEl.appendChild(h('p', { class: cls, text }));
      // No dice in the cell: it is shown as written, and the rows say only the hits.
      if (!roll) line('th-dmg-row', 'Damage: ' + dm.text + (dm.slam ? '; slam damage: see the slam rules (B371)' : ' (no damage roll)'));
      if (!dm.bands.length && roll) line('th-dmg-row', 'Hit: roll ' + dmg + ' once');
      for (const b of dm.bands) {
        const by = b.to === null ? b.from + ' or more' : b.from === b.to ? String(b.from) : b.from + '-' + b.to;
        line('th-dmg-row', 'Made it by ' + by + ': ' + b.hits + (b.hits === 1 ? ' hit' : ' hits') + (roll ? ', roll ' + dmg + ' ' + times(b.hits) : ''));
      }
      if (dm.attacks) line('th-dmg-how', 'Make 1 damage roll for each attack that hits.');
      // All-Out Attack (Strong) adds to damage, so it is said only where there is damage to add to.
      if (dm.strong && (roll || dm.slam)) line('th-dmg-strong', 'All-Out Attack (Strong): add ' + sgn(dm.strong[0]) + ' to that damage, or ' + sgn(dm.strong[1]) + ' a die if better.');
      if (dm.close) line('th-dmg-close', 'Close range: each hit does ' + dm.close + ' times the damage, and the target\'s DR counts ' + dm.close + ' times against it.');
      if (dm.rclAssumed) line('th-dmg-how', 'The sheet gives no Rcl, so this counts Rcl 1: set the real one beside Shots fired.');
    }

    weaponSel.addEventListener('change', () => {
      state.weapon = weaponSel.value;
      state.technique = '';
      // A hit location is chosen for one attack: a new weapon starts back at the torso, and at its own first shot count.
      state.loc = defaultState(data).loc;
      state.shots = '';
      rebuild();
      changed();
    });
    resetBtn.addEventListener('click', () => {
      const keep = state.weapon;
      // An Rcl the player set is a fact about the weapon, not a choice for one attack: Reset keeps it.
      const rcl = state.rcl;
      state = defaultState(data);
      state.weapon = keep;
      state.rcl = rcl;
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

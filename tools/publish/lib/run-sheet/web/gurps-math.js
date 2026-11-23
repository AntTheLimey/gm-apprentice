'use strict';
// The run sheet's GURPS arithmetic, as pure helpers. UMD like fight-math.js: `module.exports` under node,
// `window.RunSheetGurpsMath` in a page, so the reader (systems/gurps.js), the reducer (fight.js) and the page share
// one copy. No DOM, no fetch, no require. The sums are the only rules here (names and numbers, GURPS Basic Set
// B15-B17, as skills/shared/scripts/gurps_calc.py does; a hit's injury reads its figures from the wounding table in
// systems/gurps.js, B377-381, B398, B420, B552); nothing in a comment or the UI prints them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetGurpsMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Was `field` typed by the GM: `typed` is an object of truthy fields or a list of field names.
  const wasTyped = (typed, field) => (Array.isArray(typed) ? typed.includes(field) : !!(typed && typed[field]));

  // The figures worked out from a row's typed ST, HT and DX, in the row's own field names: `max` (HP from ST),
  // `fpMax` (FP from HT), `speed` (Basic Speed from DX and HT, to two decimals), each only when its inputs are
  // numbers and the figure was not typed itself. `from` marks each one for the row ("from ST").
  function deriveGurps(row, typed) {
    const r = row || {};
    const out = { from: {} };
    if (isNum(r.st) && !wasTyped(typed, 'max')) { out.max = r.st; out.from.hp = 'from ST'; }
    if (isNum(r.ht) && !wasTyped(typed, 'fpMax')) { out.fpMax = r.ht; out.from.fp = 'from HT'; }
    if (isNum(r.dx) && isNum(r.ht) && !wasTyped(typed, 'speed')) {
      out.speed = Math.round(((r.dx + r.ht) / 4) * 100) / 100;
      out.from.speed = 'from DX and HT';
    }
    return out;
  }

  // A DR figure: a number, or the first whole number in the words typed for it (`2 (leather)`); null when none.
  const drFigure = (v) => { if (isNum(v)) return Math.max(0, Math.floor(v)); const m = /\d+/.exec(String(v == null ? '' : v)); return m ? Number(m[0]) : null; };
  const placeName = (location, side) => (side ? `${side} ${location}` : location);
  // The row's DR where the hit lands: a DR the GM typed in the fight first (armour put on mid-fight), then a PC's
  // sheet DR for the place (its side's first; an eye's is the face's), else its torso's; else the row's one DR.
  // `faceOpen` makes the face and the eyes 0.
  function drAt(row, location, side, loc) {
    const typed = row.typedKeys && row.typedKeys.dr ? drFigure(row.dr) : null;
    if (row.faceOpen && loc.face) return { dr: 0, open: true };
    if (typed !== null) return { dr: typed, open: false };
    const by = row.drByLocation && typeof row.drByLocation === 'object' ? row.drByLocation : null;
    if (by) {
      for (const k of [side ? placeName(location, side) : null, location, location === 'eye' ? 'face' : null, 'torso']) {
        if (k && isNum(by[k])) return { dr: by[k], open: false };
      }
    }
    const d = drFigure(row.dr);
    return { dr: d === null ? 0 : d, open: false };
  }
  const times = (x) => String(Math.round(x * 100) / 100);

  // A hit's injury (Task 12). `hit` { n, type, location, side, dice }, `row` { dr, drByLocation, typedKeys, faceOpen,
  // max }, `wounding` the table in systems/gurps.js (B377-381, B398, B420, B552). Answers { injury, line, location,
  // side, type, place, crippled }; `line` is the working.
  function gurpsInjury(hit, row, wounding) {
    const w = wounding || {};
    const r = row || {};
    const location = w.locations && w.locations[hit.location] ? hit.location : 'torso';
    const loc = (w.locations && w.locations[location]) || {};
    const type = hit.type;
    const usual = isNum((w.types || {})[type]) ? w.types[type] : 1;
    const side = loc.sided && hit.side ? hit.side : null;
    const place = placeName(location, side);
    const n = isNum(hit.n) ? Math.max(0, Math.floor(hit.n)) : 0;
    const left = (except) => (loc.except || []).includes(except);
    let mult = usual;
    let note = '';
    if (isNum(loc.all) && !left(type)) mult = loc.all;
    else if (loc.by && isNum(loc.by[type])) mult = loc.by[type];
    else if (loc.only || left(type)) note = ` (${location}: as torso for ${type})`;
    const extra = isNum(loc.dr) && !left(type) ? loc.dr : 0;
    const at = drAt(r, location, side, loc);
    const dr = at.dr + extra;
    const drText = extra ? `${dr} (${location} +${extra})` : at.open ? `${dr} (face open)` : String(dr);
    const fat = type === 'fat';
    const head = `${hit.dice ? `${hit.dice} = ` : ''}${n} ${type}${fat ? ` ${place}` : ''} \u2212 DR ${drText}`;
    const through = n - dr;
    const out = { injury: 0, location, side, type, place, crippled: false };
    if (through <= 0) return { ...out, line: `${head} = 0` };
    // `fat` (B398)
    if (fat) return { ...out, injury: through, line: `${head} = ${through} (fatigue: no location multiplier)` };
    const raw = Math.floor(through * mult);
    let injury = Math.max(1, raw);
    let line = `${head} = ${through}${mult !== 1 || note ? ` \u00d7 ${times(mult)}${note} = ${raw}` : ''}`;
    if (injury !== raw) line += `, at least ${injury}`;
    // `cripple` and `cap` (B420, B552)
    const max = isNum(r.max) && r.max > 0 ? r.max : null;
    if (isNum(loc.cripple) && !note && max !== null && injury * loc.cripple > max) {
      out.crippled = true;
      const cap = Math.floor(max / loc.cripple) + 1;
      if (loc.cap && injury > cap) { injury = cap; line += `, capped at ${cap} (${place})`; }
    }
    return { ...out, injury, line };
  }

  return { deriveGurps, gurpsInjury, drFigure };
}));

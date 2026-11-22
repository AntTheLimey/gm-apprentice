'use strict';
// The run sheet's GURPS arithmetic, as pure helpers. UMD like fight-math.js: `module.exports` under node,
// `window.RunSheetGurpsMath` in a page, so the reader (systems/gurps.js), the reducer (fight.js) and the page share
// one copy. No DOM, no fetch, no require. The sums are the only rules here (names and numbers, GURPS Basic Set
// B15-B17, as skills/shared/scripts/gurps_calc.py does); nothing in a comment or the UI prints them.
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

  return { deriveGurps };
}));

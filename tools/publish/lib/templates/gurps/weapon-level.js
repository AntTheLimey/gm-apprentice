'use strict';
// The level a weapon row's Skill cell ends with, the number the sheet wraps as the row's live
// to-hit cell: a trailing number (`Knife-12`, `Guns (Rifle) 17`, `Wrestling-15 +4 = 19`) or a
// trailing bracketed one (`Knife (12)`). One rule for the sheet (blocks/melee.js,
// blocks/ranged.js), the live stats (live-data.js) and the to-hit calculator (tohit-data.js).
// { before, level, after } as strings, or null when the cell does not end with its level.
function levelAtEnd(cell) {
  const s = String(cell === undefined || cell === null ? '' : cell);
  const bare = /^(.*?)(\d+)(\s*)$/.exec(s);
  if (bare) return { before: bare[1], level: bare[2], after: bare[3] };
  const bracketed = /^(.*\(\s*)(\d+)(\s*\)\s*)$/.exec(s);
  return bracketed ? { before: bracketed[1], level: bracketed[2], after: bracketed[3] } : null;
}

module.exports = { levelAtEnd };

// Static rules-reference appendix — collapsible, default closed.
// Contains Humanoid Hit Location (B552) and Size & Speed/Range (B550) tables.
// Source: GURPS Basic Set 4th Edition (Steve Jackson Games).
// Reproduced as an optional collapsible reference appendix with citation under SJG Online Policy.

const HIT_LOCATION_ROWS = [
  ['3–4',   'Skull',      '–7'],
  ['5',     'Face',       '–5'],
  ['6–7',   'Right Leg',  '–2'],
  ['8',     'Right Arm',  '–2'],
  ['9–10',  'Torso',      '—'],
  ['11',    'Groin',      '–3'],
  ['12',    'Left Arm',   '–2'],
  ['13–14', 'Left Leg',   '–2'],
  ['15',    'Hand',       '–4'],
  ['16',    'Foot',       '–4'],
  ['17–18', 'Neck',       '–5'],
  ['—',     'Vitals',     '–3'],
  ['—',     'Eye',        '–9'],
];

// [Speed/Range modifier, Size Modifier, Linear Measure]
const SIZE_SPEED_RANGE_ROWS = [
  ['0',    '0',    '2 yd'],
  ['-1/+1',  '±1',   '3 yd'],
  ['-2/+2',  '±2',   '5 yd'],
  ['-3/+3',  '±3',   '7 yd'],
  ['-4/+4',  '±4',   '10 yd'],
  ['-5/+5',  '±5',   '15 yd'],
  ['-6/+6',  '±6',   '20 yd'],
  ['-7/+7',  '±7',   '30 yd'],
  ['-8/+8',  '±8',   '50 yd'],
  ['-9/+9',  '±9',   '70 yd'],
  ['-10/+10', '±10', '100 yd'],
  ['-11/+11', '±11', '150 yd'],
  ['-12/+12', '±12', '200 yd'],
  ['-13/+13', '±13', '300 yd'],
  ['-14/+14', '±14', '500 yd'],
  ['-15/+15', '±15', '700 yd'],
];

function renderReference() {
  const hlRows = HIT_LOCATION_ROWS.map(([roll, loc, mod]) =>
    `<tr><td>${roll}</td><td>${loc}</td><td class="num">${mod}</td></tr>`
  ).join('\n');

  const hitLocationTable = `
<table class="ref-table">
  <caption>Humanoid Hit Location</caption>
  <thead><tr><th>Roll</th><th>Location</th><th class="num">Mod</th></tr></thead>
  <tbody>${hlRows}</tbody>
</table>
<p class="cite">Source: GURPS Basic Set 4e, p. B552</p>`;

  const ssrRows = SIZE_SPEED_RANGE_ROWS.map(([spd, sm, measure]) =>
    `<tr><td class="num">${spd}</td><td class="num">${sm}</td><td>${measure}</td></tr>`
  ).join('\n');

  const speedRangeTable = `
<table class="ref-table">
  <caption>Size &amp; Speed/Range</caption>
  <thead><tr><th class="num">Speed/Range</th><th class="num">Size</th><th>Linear Measure</th></tr></thead>
  <tbody>${ssrRows}</tbody>
</table>
<p class="cite">Source: GURPS Basic Set 4e, p. B550</p>`;

  return `<details class="rules-ref">
<summary>Rules Reference</summary>
<div class="rules-ref-body">
${hitLocationTable}
${speedRangeTable}
</div>
</details>`;
}

module.exports = { renderReference };

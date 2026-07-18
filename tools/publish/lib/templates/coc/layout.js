// tools/publish/lib/templates/coc/layout.js
//
// Turns the parsed CoC model (from parse.js) into HTML that reproduces the
// approved reference mockup's DOM:
//   docs/superpowers/specs/coc-investigator-sheet-mockup/index.html
// Every class name here is a contract shared with the Task 5 CSS, the Task 6
// client JS, and the Task 8 mount. Do not invent or rename classes; port the
// mockup markup verbatim, swapping its hard-coded values for model fields.
const { escapeHtml } = require('../../processor');
const { findSectionByTitle, parseTableRows } = require('../gurps/tables');

// Plain-text cell -> escaped string; null/undefined -> '' (never "null").
function txt(v) {
  return v == null ? '' : escapeHtml(String(v));
}

// A skill/weapon name with a trailing specialisation renders the parenthetical
// in an <em>, matching the mockup (`Art/Craft <em>(Embroidery)</em>`).
function nameHtml(name) {
  const m = String(name == null ? '' : name).match(/^(.*?)\s*(\([^)]*\))\s*$/);
  if (m) return `${escapeHtml(m[1])} <em>${escapeHtml(m[2])}</em>`;
  return txt(name);
}

// Zero-pad the regular skill value to two digits, as in the mockup ("05","01").
function pad2(v) {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 10 ? `0${n}` : String(v);
}

function pct(part, whole) {
  if (part == null || whole == null || !whole) return 0;
  return Math.round((Number(part) / Number(whole)) * 100);
}

// -- Status bar -------------------------------------------------------------

function pipTrack(track, cur, max) {
  const total = Math.max(0, Number(max) || 0);
  const filled = Math.max(0, Math.min(total, Number(cur) || 0));
  let pips = '';
  for (let i = 0; i < total; i++) {
    pips += `<span class="pip${i < filled ? ' on' : ''}"></span>`;
  }
  return `<div class="pips" data-track="${track}">${pips}</div>`;
}

const CONDITION_CHIPS = [
  ['temporaryInsanity', 'Temporary Insanity'],
  ['indefiniteInsanity', 'Indefinite Insanity'],
  ['majorWound', 'Major Wound'],
  ['unconscious', 'Unconscious'],
  ['dying', 'Dying'],
];

function buildStatusBar(model) {
  const d = (model && model.derived) || {};
  const hp = d.hp || {};
  const mp = d.mp || {};
  const san = d.sanity || {};
  const luck = d.luck || {};
  const rep = model && model.reputation;

  // No mutable vitals at all → no status bar.
  const hasAny = [hp.max, hp.cur, mp.max, mp.cur, san.cur, san.max, luck.cur]
    .some(v => v != null);
  if (!hasAny) return null;

  const cond = (model && model.conditions) || {};

  const sanMax = san.max;
  const sanOf = sanMax != null
    ? `/ ${escapeHtml(String(sanMax))} max${san.start != null ? ` · start ${escapeHtml(String(san.start))}` : ''}`
    : '';

  const cells = [];

  cells.push(
    `<div class="sb-cell">` +
      `<span class="sb-lab">Hit Points</span>` +
      `<span class="sb-count"><b data-hp>${txt(hp.cur)}</b><span class="sb-of">/${txt(hp.max)}</span></span>` +
      pipTrack('hp', hp.cur, hp.max) +
    `</div>`
  );
  cells.push(
    `<div class="sb-cell">` +
      `<span class="sb-lab">Magic Pts</span>` +
      `<span class="sb-count"><b data-mp>${txt(mp.cur)}</b><span class="sb-of">/${txt(mp.max)}</span></span>` +
      pipTrack('mp', mp.cur, mp.max) +
    `</div>`
  );
  cells.push(
    `<div class="sb-cell sb-wide">` +
      `<span class="sb-lab">Sanity</span>` +
      `<span class="sb-num" data-max="${txt(sanMax)}"><button type="button" class="step dn">−</button>` +
      `<b data-san>${txt(san.cur)}</b>` +
      `<button type="button" class="step up">+</button><span class="sb-of">${sanOf}</span></span>` +
      `<div class="sanbar"><div class="fill" style="width:${pct(san.cur, sanMax)}%"></div>` +
      `<div class="mark" style="left:${pct(san.start, sanMax)}%"></div></div>` +
    `</div>`
  );
  cells.push(
    `<div class="sb-cell">` +
      `<span class="sb-lab">Luck</span>` +
      `<span class="sb-num" data-max="99"><button type="button" class="step dn">−</button>` +
      `<b data-luck>${txt(luck.cur)}</b>` +
      `<button type="button" class="step up">+</button></span>` +
    `</div>`
  );
  if (rep) {
    cells.push(
      `<div class="sb-cell">` +
        `<span class="sb-lab">Reputation</span>` +
        `<span class="sb-num" data-max="99"><button type="button" class="step dn">−</button>` +
        `<b data-rep>${txt(rep.current)}</b>` +
        `<button type="button" class="step up">+</button></span>` +
      `</div>`
    );
  }

  const chips = CONDITION_CHIPS
    .map(([key, label]) => `<button type="button" class="cond-chip${cond[key] ? ' on' : ''}">${label}</button>`)
    .join('');

  return `<div class="statusbar" aria-label="Live status — touch to change">` +
    `<div class="sb-grid">${cells.join('')}</div>` +
    `<div class="sb-conditions"><span class="sb-condlab">Status</span>${chips}</div>` +
    `<p class="sb-hint">Tap a pip to set · ± to adjust · tap a status to toggle.</p>` +
    `</div>`;
}

// -- Character sheet --------------------------------------------------------

const IDENTITY_FIELDS = [
  ['Occupation', 'occupation'],
  ['Nationality', 'nationality'],
  ['Player', 'player'],
  ['Age / Sex', 'ageSex'],
  ['First Appearance', 'firstAppearance'],
  ['As Of', 'asOf'],
];

const CHAR_ORDER = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'];

function buildIdentity(identity) {
  const id = identity || {};
  const flds = IDENTITY_FIELDS
    .map(([label, key]) => `<div class="fld"><span class="lab">${label}</span><span class="val">${txt(id[key])}</span></div>`)
    .join('');
  return `<div class="identity">${flds}</div>`;
}

function buildChars(chars) {
  const src = chars || {};
  const rows = CHAR_ORDER.map(key => {
    const c = src[key] || {};
    return `<div class="char"><div class="cname">${key} <b>${txt(c.reg)}</b></div>` +
      `<div class="half"><span>half</span>${txt(c.half)}</div>` +
      `<div class="fifth"><span>fifth</span>${txt(c.fifth)}</div></div>`;
  }).join('');
  return `<div class="char-list">${rows}</div>`;
}

function buildCombatBox(combat) {
  const c = combat || {};
  const dodge = c.dodge || {};
  const dodgeVal = dodge.reg != null
    ? `${txt(dodge.reg)} <small>/${txt(dodge.half)}/${txt(dodge.fifth)}</small>`
    : '';
  return `<div class="combatbox">` +
    `<div class="cb"><span class="cb-l">Move</span><span class="cb-v">${txt(c.move)}</span></div>` +
    `<div class="cb"><span class="cb-l">Build</span><span class="cb-v">${txt(c.build)}</span></div>` +
    `<div class="cb"><span class="cb-l">Damage Bonus</span><span class="cb-v">${txt(c.db)}</span></div>` +
    `<div class="cb"><span class="cb-l">Dodge</span><span class="cb-v">${dodgeVal}</span></div>` +
    `</div>`;
}

function buildPortraitRow() {
  // Backstory fields (Personal Description, Ideology…) are not in the model —
  // they live in the Background prose, rendered by buildRecord. The portrait
  // <img> is a slot: pc.js (Task 8) injects the resolved src.
  return `<div class="portrait-row">` +
    `<div class="backstory"></div>` +
    `<img class="portrait" data-portrait alt="">` +
    `</div>`;
}

function skillRow(s) {
  const dev = s && s.developed ? ' dev' : '';
  return `<div class="skill${dev}"><span class="exp"></span>` +
    `<span class="sname">${nameHtml(s.name)}</span>` +
    `<span class="reg">${pad2(s.reg)}</span>` +
    `<span class="h">${txt(s.half)}</span>` +
    `<span class="f">${txt(s.fifth)}</span></div>`;
}

const COLCAP = `<div class="colcap"><span></span><span>Skill</span><span>reg</span><span>½</span><span>⅕</span></div>`;

function buildSkills(skills) {
  const all = skills || [];
  const split = Math.ceil(all.length / 2);
  const col = rows => `<div>${COLCAP}${rows.map(skillRow).join('')}</div>`;
  return `<h2 class="section">Investigator Skills <span class="rule"></span>` +
    `<span class="hint">○ tick on a successful roll · coloured value = above base · all skills shown, untouched at base</span></h2>` +
    `<div class="skills-wrap">${col(all.slice(0, split))}${col(all.slice(split))}</div>`;
}

function buildWeapons(weapons) {
  const w = weapons || [];
  if (w.length === 0) return '';
  const head = `<tr><th>Weapon</th><th>Skill%</th><th>Damage</th><th>Atk</th><th>Range</th><th>Ammo</th><th>Malf</th></tr>`;
  const rows = w.map(x =>
    `<tr><td>${nameHtml(x.weapon)}</td><td>${txt(x.skill)}</td><td>${txt(x.damage)}</td>` +
    `<td>${txt(x.attacks)}</td><td>${txt(x.range)}</td><td>${txt(x.ammo)}</td><td>${txt(x.malf)}</td></tr>`
  ).join('');
  return `<h2 class="section">Weapons <span class="rule"></span></h2><table class="weap">${head}${rows}</table>`;
}

function buildSheet(model) {
  const m = model || {};
  return `<div class="coc-charsheet">` +
    buildIdentity(m.identity) +
    `<div class="grid-main">` +
      `<div>${buildChars(m.chars)}${buildCombatBox(m.combat)}</div>` +
      `<div>${buildPortraitRow()}${buildSkills(m.skills)}${buildWeapons(m.weapons)}</div>` +
    `</div>` +
    `</div>`;
}

// -- Investigator's Record (prose accordions) -------------------------------

const RECORD_SECTIONS = [
  'Background',
  'Injuries & Scars',
  'Phobias & Manias',
  'Encounters with Strange Entities',
  'Arcane Tomes & Spells',
  'Fellow Investigators',
  'Current Status',
];

function buildRecord(model, sections) {
  const secs = sections || [];
  const parts = [];
  for (const title of RECORD_SECTIONS) {
    const sec = findSectionByTitle(secs, title);
    if (!sec || !sec.html || !sec.html.trim()) continue;
    // sec.html is already-rendered HTML — inject as-is; escape only the title.
    parts.push(`<details class="acc"><summary>${escapeHtml(title)}</summary>` +
      `<div class="acc-body">${sec.html}</div></details>`);
  }
  if (parts.length === 0) return null;
  return `<div class="rechead">The Investigator's Record</div>${parts.join('')}`;
}

// -- Equipment & Wealth -----------------------------------------------------

function liItems(html) {
  const out = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

function buildEquipment(model, sections) {
  const sec = findSectionByTitle(sections || [], 'equipment');
  if (!sec || !sec.html || !sec.html.trim()) return null;

  // Gear: every <li> in the section (the wealth table uses <td>, not <li>).
  // Inner HTML is already rendered by the processor — inject as-is.
  const items = liItems(sec.html);
  const gear = items.length
    ? `<ul class="gear-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`
    : `<p class="empty-note">None recorded.</p>`;

  // Wealth: the section's only table. Skip the header row; blank values render
  // as the mockup's muted "not recorded" placeholder — never an invented value.
  const wealthRows = parseTableRows(sec.html)
    .filter(r => r.length >= 1 && !/^attribute$/i.test((r[0] || '').trim()))
    .map(r => {
      const label = txt(r[0]);
      const val = (r[1] || '').trim();
      const cell = val ? `<td>${escapeHtml(val)}</td>` : `<td class="empty-note">not recorded</td>`;
      return `<tr><td>${label}</td>${cell}</tr>`;
    })
    .join('');
  const wealth = wealthRows
    ? `<table class="wealth">${wealthRows}</table>`
    : `<p class="empty-note">not recorded</p>`;

  return `<h2 class="section">Gear &amp; Possessions <span class="rule"></span></h2>${gear}` +
    `<h2 class="section">Wealth <span class="rule"></span></h2>${wealth}`;
}

module.exports = { buildStatusBar, buildSheet, buildRecord, buildEquipment };

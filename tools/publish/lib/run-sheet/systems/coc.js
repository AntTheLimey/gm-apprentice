'use strict';
// Call of Cthulhu 7e (and the Regency variant) for the run sheet: a foe's HP, MP, SAN and DEX from any of the five
// block shapes real vaults use (step 6b Task 3), and its combat figures (Task 16). No rules text ships; the two sums
// are the only rules here, and `rules.coc`'s numbers are data with their page cites.
// It fights (Task 7): `describe()` is D&D's shape with CoC's values for what is known so far.

const path = require('node:path');
const { SYSTEM_NAMES } = require('../../shared-lists');
const { dnd, describeAs } = require('./dnd');
const { statSection, combatSections, currentOf } = require('./stat-section');
const { pairs, firstOf, leadingNumber, clean, firstLine } = require('./pairs');
const { extractSections } = require('../../processor');
const { parseCoC } = require('../../templates/coc/parse');
const { buildCoCLiveData } = require('../../templates/coc/live-data');
const { malNumber } = require('../web/coc-math');

const FOE_TYPES = new Set(['npc', 'creature']);

const ALIASES = {
  hp: /^(?:HP|Hit Points)$/i, mp: /^(?:MP|Magic Points)$/i, san: /^(?:SAN|Sanity)$/i, dex: /^(?:DEX|Dexterity)$/i,
  luck: /^Luck$/i, armour: /^(?:Armour|Armor)$/i, str: /^(?:STR|Strength)$/i, con: /^(?:CON|Constitution)$/i,
  siz: /^(?:SIZ|Size)$/i, pow: /^(?:POW|Power|Willpower)$/i, mov: /^(?:MOV|Move)$/i, int: /^(?:INT|Intelligence)$/i,
  app: /^(?:APP|Appearance)$/i, edu: /^(?:EDU|Education)$/i, db: /^(?:DB|Damage Bonus)$/i, build: /^Build$/i,
  // the combat figures (Task 16): `Fighting (Brawl) 40`, `Brawl 40%`, `Firearms (Handgun) 30`, `Dodge 20%`
  fighting: /^(?:Fighting|Brawl)$/i, firearms: /^Firearms?$/i, dodge: /^Dodge$/i, attacks: /^(?:Attacks|Attacks per round|Attacks\/round)$/i,
};

// `STR (Strength)` is STR; a key that is no CoC word is null.
function keyOf(raw) {
  const s = clean(raw).replace(/\s*\(.*\)\s*$/, '').replace(/[:.]$/, '').trim();
  for (const [k, re] of Object.entries(ALIASES)) if (re.test(s)) return k;
  return null;
}

// An attack line a block writes with a name of its own (`- Boat hook 45% (22/9), damage 1D6+DB`): its name and skill.
// A firearm's name says so (`Pocket pistol`); any other is Fighting. Dodge and the named skills are pairs' (keyOf).
// The name may hold digits (`.38 Revolver`, `12-gauge shotgun`): it runs to the ` NN%` figure. The damage may be
// written without the word, as Canticle's blocks do (`- Knife: 35%, 1D4+2`, `* **Pistol (flintlock)** 45% — 1D10+2`):
// a dice figure right after the percentage counts, with only `,` `:` `—` `–` and spaces between, after the half and fifth group `(17/7)` if there is one (`First Aid 60%: restores
// 1D3` is a skill, not an attack).
const ATTACK_LINE = /^\s*[-*+]\s+(?:\*\*)?([^%*\s][^%]*?)(?:\*\*)?\s+(\d{1,3})\s*%(?=.*\bdamage\b|(?:\s*\(\d{1,3}\s*\/\s*\d{1,3}\))?[\s,:\u2014\u2013]*\d*d\d+\b)/i;
// A firearm's name says so: a calibre (`.45`, `.30-06`, `9mm`), a kind of gun, or a make (Task 19 widened it:
// `Colt .45`, `Thompson`, `Lee-Enfield`, `Brown Bess`). A make that is also a surname or a place (Colt, Thompson,
// Winchester, Remington, Springfield) never counts as a possessive (`Thompson's cleaver`). `Gunsmith`, `2-handed axe`
// and `Baker's knife` are not guns.
const MAKES = ['colt', 'webley', 'luger', 'mauser', 'enfield', 'lee-enfield', 'winchester', 'remington', 'thompson', 'springfield', 'brown bess'];
const FIREARM = new RegExp([
  '(?:^|[\\s(])\\.\\d{2,3}(?:-\\d{2,3})?\\b',
  '\\b\\d{1,2}(?:\\.\\d{1,2})?\\s?mm\\b',
  `\\b(?:${['firearms?', 'handguns?', 'pistols?', 'revolvers?', 'rifles?', 'shotguns?', 'carbines?', 'smgs?', 'submachine', 'machine[- ]?guns?',
    'muskets?', 'flintlocks?', 'matchlocks?', 'blunderbuss(?:es)?', 'derringers?', 'guns?', 'automatics?', 'semi-automatics?', 'bolt-action',
    'lever-action'].join('|')})\\b`,
  `\\b(?:${MAKES.join('|')})\\b(?!['’]s\\b)`,
].join('|'), 'i');
// A firearm line may say more (Task 19): its damage (`damage 2D6/1D6`, by range, or the dice after the percentage),
// its malfunction number (`malfunction 95`, `malf. 90`, `95 malf`, `misfire 5%`: 96), a slow reload and whether it
// impales. Flintlocks, muskets and the blunderbuss never impale (RC p187); a line that says `impales` does; any other
// is not known (null).
const DAMAGE_OF = /\bdamage\s*:?\s*(\d*d\d+(?:\s*[+\-/]\s*(?:\d*d\d+|\d+|DB))*)/i;
const DICE_AFTER = /\d\s*%[^%]*?(?:^|[^\w/])(\d*d\d+(?:\s*[+\-/]\s*(?:\d*d\d+|\d+|DB))*)/i;
const MALF_OF = /\bmalf(?:unction)?\.?\s*:?\s*(\d{2,3})\b|\b(\d{2,3})\+?\s*malf/i;
const MISFIRE_OF = /\bmisfires?\s*:?\s*(\d{1,2})\s*%/i;
// A slow reload as the vaults write it, giving the rounds until the next shot (one per round is none): `1 per 4
// rounds`, `1 shot per 4 rounds`, `one shot per 4 rounds`, `1 shot/4 rounds`, `one per four rounds`, `1/3 rounds`,
// `1/4 rounds to reload`, `reload 4 rounds`, `reload their flintlocks in 2 rounds`, `3 rounds to reload`,
// `(1/3, slow reload)`; a table's Attacks column `1/4`.
const WORD_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const N = `(\\d{1,2}|${Object.keys(WORD_N).join('|')})`;
const ROUNDS = '(?:rounds?|rnds?)';
const RELOADS = [
  new RegExp(`\\b(?:1|one)\\s*(?:shot\\s*)?(?:per|/|every)\\s*${N}\\s*${ROUNDS}\\b`, 'i'),
  new RegExp(`\\breload(?:s|ing)?\\b[^,;.]{0,30}?\\b${N}\\W{0,3}\\s*${ROUNDS}\\b`, 'i'),
  new RegExp(`\\b${N}\\s*${ROUNDS}\\s*to\\s*reload\\b`, 'i'),
  /\(\s*1\s*\/\s*(\d{1,2})\s*,\s*slow reload/i,
];
const NO_IMPALE = /\b(?:flintlocks?|blunderbuss|muskets?|brown bess)\b|\b(?:does not|doesn't|never|no|non-?)\s*impal/i;
const IMPALES = /\bimpal(?:e|es|ing)\b/i;
const malfOf = (text) => {
  const t = String(text || '');
  const m = MALF_OF.exec(t);
  if (m) return malNumber(m[1] || m[2]);
  const x = MISFIRE_OF.exec(t);
  return x && Number(x[1]) >= 1 ? malNumber(String(101 - Number(x[1]))) : null;
};
const numOf = (v) => (v === undefined ? null : WORD_N[String(v).toLowerCase()] || Number(v));
const reloadOf = (text) => {
  const t = clean(text);
  let n = null;
  for (const re of RELOADS) { const m = re.exec(t); if (m) { n = numOf(m[1]); break; } }
  if (n === null) { const m = /^1\s*(?:per|\/)\s*(\d{1,2})$/.exec(t); n = m ? Number(m[1]) : null; }
  return n !== null && n > 1 ? n : null;
};
const impalesOf = (text) => (NO_IMPALE.test(text) ? false : IMPALES.test(text) ? true : null);
const damageOf = (line) => { const d = DAMAGE_OF.exec(line) || DICE_AFTER.exec(line); return d ? d[1].replace(/\s+/g, '').toUpperCase() : null; };
// One firearm: { name, skill, damage, malfunction, reload, impales }, each null where the line does not say.
function gunOf(name, skill, line) {
  return { name: clean(name).replace(/:$/, ''), skill, damage: damageOf(line), malfunction: malfOf(line), reload: reloadOf(line), impales: impalesOf(line) };
}
// A Firearms skill line with a damage figure (`- Firearms (Rifle/Musket) 65% (32/13), damage 1D10+4, 1 shot per 4
// rounds (Brown Bess)`) is a gun too: named by a firearm in its last brackets, else by the skill.
function skillGunName(name, line) {
  const tail = /\(([^()]+)\)\s*\**\s*$/.exec(line.replace(/\s+$/, ''));
  return tail && FIREARM.test(tail[1]) && !/^\s*\d/.test(tail[1]) ? tail[1] : name;
}
function attackLines(stats) {
  const out = { fighting: [], firearms: [], guns: [] };
  for (const line of String(stats == null ? '' : stats).replace(/\r\n?/g, '\n').split('\n')) {
    const m = ATTACK_LINE.exec(line);
    if (!m) continue;
    const key = keyOf(m[1]);
    if (key === 'firearms') { out.guns.push(gunOf(skillGunName(m[1], line), Number(m[2]), line)); continue; }
    if (key) continue;
    const gun = FIREARM.test(m[1]);
    out[gun ? 'firearms' : 'fighting'].push(Number(m[2]));
    if (gun) out.guns.push(gunOf(m[1], Number(m[2]), line));
  }
  return out;
}
// A block that writes Firearms only as a skill (`Firearms (Musket) 50%`, no weapon line): one gun of unknown damage
// from its highest specialisation, its kind, reload and malfunction read from the specialisation and the block's
// Weapons or Equipment lines (`**Equipment:** … a flintlock pistol …`), so a musket still never impales.
function skillGun(stats, figure) {
  if (figure === null) return null;
  const text = String(stats == null ? '' : stats).replace(/\r\n?/g, '\n');
  let spec = null;
  for (const m of text.matchAll(/Firearms?\s*(?:\(([^)]+)\))?\**\s*:?\s*\**\s*(\d{1,3})\s*%/gi)) if (Number(m[2]) === figure) { spec = m[1] || ''; break; }
  const kit = text.split('\n').filter((l) => /\b(?:weapons?|equipment|gear|armed with|carries)\b/i.test(l)).join(' ');
  const kind = `${spec || ''} ${kit}`;
  return { name: spec ? `Firearms (${clean(spec)})` : 'Firearms', skill: figure, damage: null, malfunction: malfOf(kit), reload: reloadOf(kit), impales: impalesOf(kind) };
}
const highest = (list) => { const ok = list.filter((v) => typeof v === 'number' && Number.isFinite(v)); return ok.length ? Math.max(...ok) : null; };

// Shapes the readers below do not split, rewritten into ones they do (Task 32, Canticle's notes):
//   a heading that is a key and a number (`### Attacks per Round: 2`) loses its hashes;
//   a line of bold pairs with only spaces between (`**STR 55** **CON 60**`, `**HP:** 12 **MP:** 13`), every one a CoC
//   key, is joined with ` · `;
//   a table whose header names a Skill column after the first (`| Skill | Base | Skill | Notes |`, `| Weapon | Skill |
//   Damage | ... | Malf |`) becomes one line a row: `- Name 55%`, and with a Damage column `- Name 45%, damage 1D6+1,
//   malf 95, 1 per 4 rounds` (the Malf and Attacks columns when they hold one). The last Skill column counts, so a
//   Base column before it does not (`60% (30/12)` is 60, `Fighting (Sword) 85%` 85); a weapon row keeps its other
//   cells after a `;`, for a gun's reload and impaling. A row whose skill cell is no figure (`—`, `CON 70`), the header
//   and a table with no Skill column stay as they were.
const SKILL_HEAD = /^(?:skill|skill ?%|%|score|chance)$/;
// a skill cell's figure: `55%`, `55`, `60% (30/12)`, `55/27/11`, or one written after the skill's name (`Fighting (Sword) 85%`)
const SKILL_CELL = /^(\d{1,3})(?=\s*%|\s*\/|\s*\(|\s*$)|^[^\d%]*?\s(\d{1,3})\s*%/;
const isTableRow = (line) => /^\s*\|/.test(line);
const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
function boldPairs(line) {
  if (/[·|•]/.test(line)) return null;
  const parts = line.trim().split(/\s+(?=\*\*)/);
  if (parts.length < 2 || !parts.every((p) => /^\*\*[^*]+\*\*[^*]*$/.test(p))) return null;
  const keyed = parts.every((p) => {
    const head = clean(p).replace(/\s*:.*$/, '').replace(/\s+[-+\u2212\u2013\u2014]?\d.*$/, '').replace(/\s+[\u2013\u2014-]\s*$/, '');
    return keyOf(head) !== null;
  });
  return keyed ? parts.join(' · ') : null;
}
const blankRow = (cells) => cells.every((x) => /^:?-{2,}:?$/.test(x) || x === '');
function tableLines(rows) {
  const at = rows.findIndex((r) => !blankRow(tableCells(r)));
  if (at < 0) return rows;
  const head = tableCells(rows[at]).map((x) => x.toLowerCase());
  let skill = -1;
  head.forEach((x, n) => { if (n > 0 && SKILL_HEAD.test(x)) skill = n; });
  if (skill < 0) return rows;
  const col = (re) => head.findIndex((x) => re.test(x));
  const [damage, malf, attacks] = [col(/^damage$/), col(/^malf(?:unction)?\.?$/), col(/^(?:attacks|atts?|rof)$/)];
  return rows.map((row, i) => {
    const cells = tableCells(row);
    const m = i > at && cells[0] ? SKILL_CELL.exec(cells[skill] || '') : null;
    if (!m) return row;
    let line = `- ${cells[0]} ${m[1] || m[2]}%`;
    if (damage >= 0) {
      line += `, damage ${cells[damage] || '\u2014'}`;
      const mf = malf >= 0 ? /^(\d{2,3})$/.exec(cells[malf] || '') : null;
      if (mf) line += `, malf ${mf[1]}`;
      const re = attacks >= 0 ? reloadOf(cells[attacks]) : null;
      if (re) line += `, 1 per ${re} rounds`;
      // the rest (range, notes) for a gun's reload and impaling (`1/4 rounds to reload`)
      const rest = cells.filter((c, n) => ![0, skill, damage, malf, attacks].includes(n) && c && !/^[\u2014\u2013-]$/.test(c));
      if (rest.length) line += `; ${rest.join('; ')}`;
    }
    return line;
  });
}
function normalise(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableRow(lines[i])) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      i--;
      out.push(...tableLines(rows));
      continue;
    }
    const h = /^#{1,6}[ \t]+(.+?):[ \t]*(\d+)[ \t]*#*[ \t]*$/.exec(lines[i]);
    if (h && keyOf(h[1]) !== null) { out.push(`${clean(h[1])}: ${h[2]}`); continue; }
    out.push(boldPairs(lines[i]) || lines[i]);
  }
  return out.join('\n');
}

// A block's numbers: hp, mp and san are maxima; a value that is no number (`not tracked`, `n/a`, a dash) is null.
// Fighting and Firearms are the highest the block writes; DB stays words (`+1D4`).
function readNumbers(raw) {
  const stats = normalise(raw);
  const ps = pairs(stats, keyOf);
  const n = (k) => leadingNumber(firstOf(ps, k));
  const all = (k) => ps.filter(([key]) => key === k).map(([, v]) => leadingNumber(v));
  const lines = attackLines(stats);
  const db = firstOf(ps, 'db');
  const nums = { hp: n('hp'), mp: n('mp'), san: n('san'), dex: n('dex'), luck: n('luck'), armour: null,
    str: n('str'), con: n('con'), siz: n('siz'), pow: n('pow'), int: n('int'),
    fighting: highest(all('fighting').concat(lines.fighting)), firearms: highest(all('firearms').concat(lines.firearms)),
    dodge: n('dodge'), db: db === null ? null : (clean(db).replace(/\s*[·|].*$/, '') || null), build: n('build'), attacks: leadingNumber(String(firstOf(ps, 'attacks') || '').replace(/^per round\s*:?\s*/i, '')),
    guns: null, from: {} };
  // a Firearms figure written inside a run of skills (`**Skills:** Persuade 75%, Firearms (Pistol) 55%`), which
  // pairs does not split: the highest, when nothing else gave one
  if (nums.firearms === null) {
    const inline = [...String(stats == null ? '' : stats).matchAll(/\bFirearms?\s*(?:\([^)]*\))?\**\s*:?\s*\**\s*(\d{1,3})\s*%/gi)].map((m) => Number(m[1]));
    nums.firearms = highest(inline);
  }
  const sg = lines.guns.length ? null : skillGun(stats, nums.firearms);
  nums.guns = lines.guns.length ? lines.guns : (sg ? [sg] : null);
  const armour = firstOf(ps, 'armour');
  if (armour) nums.armour = clean(armour).replace(/\s*[·|].*$/, '') || null;
  if (nums.hp === null && nums.con !== null && nums.siz !== null) { nums.hp = Math.floor((nums.con + nums.siz) / 10); nums.from.hp = 'from CON+SIZ'; }
  if (nums.mp === null && nums.pow !== null) { nums.mp = Math.floor(nums.pow / 5); nums.from.mp = 'from POW'; }
  return nums;
}

const hasNumbers = (nums) => ['hp', 'mp', 'san', 'dex', 'luck', 'str', 'con', 'siz', 'pow'].some((k) => nums[k] !== null) || nums.armour !== null;

function lacks(name, nums) {
  if (!hasNumbers(nums)) return [{ kind: 'no-numbers', text: `${name} names a stat block with no numbers in the vault: fill them in prep` }];
  const out = [];
  if (nums.hp === null) out.push({ kind: 'no-hp', text: `${name} has no HP in its stats: type it in the fight, or fill it in prep` });
  if (nums.dex === null) out.push({ kind: 'no-dex', text: `${name} has no DEX: it sorts last until you type it` });
  return out;
}

const nameOf = (notePath, fm) => String(fm.name || path.posix.basename(notePath, '.md'));

function readFoe({ notePath, index, text }) {
  const fm = index.read(notePath).fm || {};
  const type = String(fm.type || '').toLowerCase();
  const found = FOE_TYPES.has(type) ? statSection(text == null ? index.read(notePath).body : text) : null;
  if (!found || !found.md) return { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null };
  const nums = readNumbers(found.md);
  // the combat figures the block does not write, from the Skills and Weapons sections beside it (Task 32)
  const beside = combatSections(text == null ? index.read(notePath).body : text);
  if (beside) {
    const more = readNumbers(beside);
    for (const k of COMBAT_KEYS) if (nums[k] === null && more[k] !== null) nums[k] = more[k];
  }
  return { stats: found.md, statsHeading: found.heading, nums, lacks: lacks(nameOf(notePath, fm), nums), hpStart: currentOf(found.md) };
}

// A PC's numbers come from the same reader the player site uses (parseCoC, then buildCoCLiveData), so the GM page
// and the PC's own page never disagree. An empty Current column reads as the maximum. A sheet with no derived HP
// falls back to the foe reader on its stat block, or on its Current Status line (current = max), with a quiet note.
const NONE = { hpNow: null, hpMax: null, mpNow: null, mpMax: null, sanNow: null, sanMax: null, luck: null, dex: null };
const NO_HP = 'no HP on the sheet: type it in the fight';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function statusBlock(body) {
  const m = /^#{1,6}[ \t]+Current Status[ \t]*$([\s\S]*?)(?=^#{1,6}[ \t]|(?![\s\S]))/im.exec(body);
  return m ? m[1] : '';
}

// The combat figures a PC's sheet writes (Task 16), only those it has: Fighting and Firearms its highest
// specialisations, Dodge, Build and the damage bonus from the Combat table.
const COMBAT_KEYS = ['fighting', 'firearms', 'dodge', 'db', 'build', 'attacks', 'guns'];
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
const combatOfNums = (nums) => Object.fromEntries(COMBAT_KEYS.map((k) => [k, nums[k]]));
function sheetCombat(model) {
  const skills = Array.isArray(model.skills) ? model.skills : [];
  const of = (re) => highest(skills.filter((s) => re.test(String(s.name || ''))).map((s) => num(s.reg)));
  const c = model.combat || {};
  return present({
    fighting: of(/^(?:Fighting\b|Brawl$)/i), firearms: of(/^Firearms?\b/i), dodge: of(/^Dodge$/i),
    build: leadingNumber(c.build), db: c.db ? clean(c.db) : null, guns: sheetGuns(model),
  });
}
// The sheet's firearms (Task 19), from its Combat table (Weapon, Skill %, Damage, Attacks, Range, Ammo, Malf): a row
// whose weapon or skill names a firearm. Its skill is the table's figure, its slow reload the Attacks column's
// `1/4`; null with none.
function sheetGuns(model) {
  const rows = Array.isArray(model.weapons) ? model.weapons : [];
  const guns = rows.filter((w) => w && (FIREARM.test(String(w.weapon || '')) || /firearm/i.test(String(w.skill || '')))).map((w) => {
    // the skill cell's first figure: `55`, `55/27/11`, `60% (30/12)`, `Firearms (Pistol) 55%`
    const sk = /(?:^|[^\w(/])(\d{1,3})(?=\s*%|\s*\/|\s*$|\s*\()/.exec(clean(w.skill));
    const d = DAMAGE_OF.exec(`damage ${clean(w.damage)}`);
    const all = `${clean(w.weapon)} ${clean(w.damage)}`;
    const cells = [w.attacks, w.range, w.ammo].map(clean);
    return { name: clean(w.weapon), skill: sk ? Number(sk[1]) : null, damage: d ? d[1].replace(/\s+/g, '').toUpperCase() : null,
      malfunction: malNumber((/^\s*(\d{1,3})/.exec(clean(w.malf)) || [])[1]), reload: reloadOf(cells[0]) || reloadOf(cells.join(' ')), impales: impalesOf(all) };
  });
  return guns.length ? guns : null;
}

// CON and INT from the sheet's characteristics, only those it writes (Task 18's cards show them; a PC's roll is the
// player's, so they are shown, never rolled).
const sheetChars = (model) => {
  const c = (model && model.chars) || {};
  return present({ con: c.CON ? num(c.CON.reg) : null, int: c.INT ? num(c.INT.reg) : null });
};

function readPc({ body, fm }) {
  try {
    const text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
    // the sheet's own skills only (no built-in list), so a figure is one the sheet writes
    const model = parseCoC(fm || {}, extractSections(text), 'coc-7e', { skillList: false });
    const live = buildCoCLiveData(model, { campaignId: 'run-sheet', pcSlug: 'run-sheet' });
    const d = (live && live.hp && num(live.hp.max) !== null) ? live : null;
    if (d) {
      const now = (o) => (num(o.cur) !== null ? o.cur : (num(o.max) !== null ? o.max : null));
      return { numbers: { ...NONE, hpMax: d.hp.max, hpNow: now(d.hp), mpMax: num(d.mp.max), mpNow: now(d.mp),
        sanMax: num(d.san.max), sanNow: now(d.san), luck: num(d.luck.cur), dex: num(d.dex), ...sheetCombat(model), ...sheetChars(model) } };
    }
    const block = statSection(text);
    const nums = readNumbers(`${block ? block.md : ''}\n${statusBlock(text)}`);
    if (nums.hp === null) return { numbers: { ...NONE }, note: NO_HP };
    return { numbers: { ...NONE, hpNow: nums.hp, hpMax: nums.hp, mpNow: nums.mp, mpMax: nums.mp, sanNow: nums.san, sanMax: nums.san,
      luck: nums.luck, dex: nums.dex, ...present(combatOfNums(nums)), ...present({ con: nums.con, int: nums.int }) }, note: 'numbers from a one-line sheet (current = max)' };
  } catch (e) {
    return { numbers: { ...NONE }, note: `the sheet could not be read: ${firstLine(e)}` };
  }
}

// The cards a hit and a SAN loss raise (Task 18), read by coc-math's cocCardForHit, cocCardsAtRoundEnd and sanCard and
// by the card actions Task 13 built for GURPS. Names, figures and page cites only: death over max HP (KR p119, p120);
// the Major Wound, Prone and its CON roll (KR p119, p120); Unconscious and Dying at 0 HP, Dying's CON rolls (KR p120);
// stabilising (KR p120, p65); the INT roll (KR p155); the bout's rounds (KR p156) and its tables (KR p157).
const COC_CARDS = {
  status: { major: 'Major wound', dying: 'Dying' },
  // the lines' names on the cards and in the log
  lines: { dead: 'Over max HP', dying: '0 HP, Major wound', unconscious: '0 HP', major: 'Major wound', dyingCon: 'Dying', int: 'SAN loss' },
  stats: { con: 'CON', int: 'INT' },
  offers: {
    dead: { label: 'Out (dead)', out: true, ends: true },
    // the hit that takes a row to 0 with the box ticked may be the Major Wound itself: Prone comes with it
    dying: { label: 'Dying, Unconscious, Prone', add: ['Dying', 'Unconscious', 'Prone'], ends: true },
    unconscious: { label: 'Unconscious', add: ['Unconscious'], ends: true },
    // the Major Wound's roll folds Prone in: a PC's Passed or Failed tap takes it in the same tap (`tap`)
    prone: { label: 'Prone', add: ['Prone'], tap: true },
    proneOut: { label: 'Prone, Unconscious', add: ['Prone', 'Unconscious'], ends: true, tap: true },
    // the bout's rounds are the Keeper's 1D10, rolled by the server when it is taken
    insane: { label: 'Temporary insanity', add: ['Temporary insanity'], bout: true },
    stabilised: { label: 'Stabilised', remove: ['Dying'] },
  },
  bout: { sides: 10 },
  // what a card names besides its lines: the bout's tables stay in the book
  notes: { int: 'bout tables: KR p157' },
};

// A shot's numbers (Task 19), read by coc-math's shotDice and the Shoot strip: names, dice and page cites only. The
// range sets the difficulty (KR p112); each chip is one bonus or penalty die (KR p113, p119, p410): aiming the round
// before, point blank, a large or small target (by Build when the target has one), partial concealment, a fast mover,
// firing into melee, loading and firing in one round, and one die on every shot when two or three are fired in a round.
// Prone (KR p128): a die against a Prone target unless point blank, one for a Prone shooter. A dive for cover that
// passes is a die on the shot (KR p113). A kept roll at or over the weapon's malfunction number is flagged (KR p118),
// and with no number, a roll of `hintFrom` or more says to check it. Regency's flintlocks (malfunction 95, the
// double-barreled pistol 90, one shot per 4 rounds, never impaling; the blunderbuss's damage by range) are read from the
// weapon line (RC p187).
const FIREARM_RULES = {
  ranges: [
    { key: 'regular', label: 'regular range', short: 'regular', difficulty: 'regular' },
    { key: 'long', label: 'long range', short: 'long', difficulty: 'hard' },
    { key: 'veryLong', label: 'very long range', short: 'very long', difficulty: 'extreme' },
  ],
  // `label` for the log line, `short` for the strip, under its `group`'s heading (none: the last, ungrouped)
  chips: [
    { key: 'large', label: 'large target', short: 'large', group: 'target', bonus: 1, size: true },
    { key: 'small', label: 'small target', short: 'small', group: 'target', penalty: 1, size: true },
    { key: 'proneTarget', label: 'target prone', short: 'prone', group: 'target', penalty: 1, notWith: 'pointBlank' },
    { key: 'cover', label: 'partly concealed', short: 'cover', group: 'target', penalty: 1 },
    { key: 'fast', label: 'fast mover', short: 'fast', group: 'target', penalty: 1 },
    { key: 'aim', label: 'aimed', short: 'aimed', group: 'shooter', bonus: 1 },
    { key: 'proneShooter', label: 'shooter prone', short: 'prone', group: 'shooter', bonus: 1 },
    { key: 'loading', label: 'loading', short: 'loading', group: 'shooter', penalty: 1 },
    { key: 'pointBlank', label: 'point blank', short: 'point blank', bonus: 1 },
    { key: 'intoMelee', label: 'into melee', short: 'into melee', penalty: 1 },
    { key: 'shots', label: '2-3 shots this round', short: '2-3 shots', penalty: 1 },
  ],
  // a target's Build that makes it large or small (KR p113, p410)
  size: { large: 4, small: -2 },
  dive: { label: 'dived for cover', penalty: 1 },
  malfunction: { hintFrom: 95, cite: 'KR p118' },
};

// Placeholders until later tasks fill them in: `vitals`, `wounding`, `consequences`, `defences`,
// `manoeuvres` keep D&D's shape (CoC-safe empties where D&D words would show).
function describeCoc(id) {
  const r = describeAs(id, id === 'coc-7e' ? 'Call of Cthulhu 7e' : SYSTEM_NAMES[id], true);
  // the order is DEX, plus 50 with a firearm ready (KR p409); HP never below 0 (KR p120); the entry box's pools:
  // MP never below 0 (KR p386), SAN never above 99 (KR p155, less Cthulhu Mythos, which the row does not hold)
  // melee (Task 16): the tie winners by response (KR p103), the outnumbered die (KR p108), the Prone die on a melee
  // attack (KR p128), the dice cap (KR p91, p407); Fight Back first on an NPC's or creature's row [CCx]. Tasks 17-19
  // add to it.
  const coc = {
    tie: { dodge: 'defender', fightBack: 'attacker' },
    outnumbered: { bonus: 1 },
    prone: { status: 'Prone', meleeBonus: 1 },
    // the same cap as lib/dice rollPercent's net of bonus and penalty dice (KR p91, p407): change both together
    maxDice: 2,
    defaultResponse: 'fightBack',
    // what a hit and a SAN loss owe, as cards of prompts (Task 18): names and figures only. The card's numbers are
    // `prompts` below; a line rolls the row's `stat`; each offer adds or removes statuses by name.
    cards: COC_CARDS,
    // a shot (Task 19): the range, the chips, Prone, the dive and the malfunction flag
    // Regency (RC p187): every gun is a flintlock, so one whose line does not say reads as never impaling
    firearm: id === 'coc-7e-regency' ? { ...FIREARM_RULES, unknownImpales: false } : FIREARM_RULES,
  };
  // a Major Wound is a hit of at least max HP over `majorWoundAt` (KR p119, p120); a SAN loss of `insanityAt` or more
  // in one entry asks for the INT roll (KR p155)
  const fight = {
    initiative: 'dex', initDecimals: 0, hpFloor: 0, autoOut: false, firearmBonus: 50, coc,
    prompts: { majorWoundAt: 2, insanityAt: 5 },
    pools: [
      { key: 'mp', prefix: 'm', label: 'MP', max: 'mpMax', floor: 0 },
      { key: 'san', prefix: 's', label: 'SAN', max: 'sanMax', floor: 0, cap: 99 },
    ],
  };
  Object.assign(r, { family: 'coc', ...JSON.parse(JSON.stringify(fight)) });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false, gun: true };
  r.statuses = ['Major wound', 'Prone', 'Unconscious', 'Dying', 'Temporary insanity', 'Indefinite insanity'];
  // the acting panel's boxes, in Tab order (the one list, Task 7 [P-C19]); `readout` ones are shown beside HP too
  r.panelBoxes = [
    { key: 'dex', label: 'DEX', readout: true }, { key: 'mp', label: 'MP' }, { key: 'san', label: 'SAN' },
    { key: 'fighting', label: 'Fighting' }, { key: 'firearms', label: 'Firearms' }, { key: 'dodge', label: 'Dodge' },
    { key: 'db', label: 'DB' }, { key: 'armour', label: 'Armour' }, { key: 'build', label: 'Build' }, { key: 'attacks', label: 'Attacks' },
  ];
  // the row's own figures: initiative, HP now/[max], MP and SAN as read-outs
  r.rowNumbers = ['ini', 'hp', 'max', 'mp', 'san'];
  r.words = {
    ...r.words, hp: 'HP', ac: '', temp: '', initiative: 'DEX', initBox: 'DEX', longRest: '', advancement: 'One line each, e.g. skill checks to roll', bloodied: '', noBlock: '',
    pcLine: [{ word: 'HP', now: 'hpNow', max: 'hpMax' }, { word: 'MP', now: 'mpNow' }, { word: 'SAN', now: 'sanNow' }, { word: 'DEX', now: 'dex' }],
    entryPlaceholder: '-7 / +3 / m-2 / s-5',
    entryInvalid: 'Type -7 or 7 (damage), 1D6+DB (dice), +3 (healing), m-2 (MP) or s-5 (SAN)',
    gun: 'gun', gunTitle: `Firearm ready: +${fight.firearmBonus} to DEX for the order`,
    // the melee exchange on the target's row (Task 16): a hint in our words, beside the buttons
    buildHint: 'Manoeuvre: compare Builds',
  };
  return r;
}

// The row's own fields: initiative is DEX.
const foeRow = (n) => ({ init: n.dex, mp: n.mp, mpMax: n.mp, san: n.san, sanMax: n.san, dex: n.dex, con: n.con, int: n.int, armour: n.armour, from: n.from,
  fighting: n.fighting, firearms: n.firearms, dodge: n.dodge, db: n.db, build: n.build, attacks: n.attacks, guns: n.guns || null });

// A gun whose line says nothing about impaling takes the system's reading (`rules.coc.firearm.unknownImpales`:
// Regency's false); a line that says it wins. Plain CoC leaves it null.
function settleGuns(guns, firearm) {
  if (!Array.isArray(guns) || !firearm || typeof firearm.unknownImpales !== 'boolean') return guns;
  return guns.map((g) => (g.impales === null ? { ...g, impales: firearm.unknownImpales } : g));
}
// The readers with the system's own rules object, the one describe() gives (no second lookup).
const make = (id) => {
  const firearm = () => describeCoc(id).fight.coc.firearm;
  return {
    ...dnd, id, fights: true, foeRow, stockNoActions: undefined, describe: () => describeCoc(id),
    readFoe: (a) => { const r = readFoe(a); if (r.nums && r.nums.guns) r.nums.guns = settleGuns(r.nums.guns, firearm()); return r; },
    readPc: (a) => { const r = readPc(a); if (r.numbers && r.numbers.guns) r.numbers = { ...r.numbers, guns: settleGuns(r.numbers.guns, firearm()) }; return r; },
  };
};

module.exports = { coc: make('coc-7e'), cocRegency: make('coc-7e-regency'), readNumbers, keyOf, lacks };

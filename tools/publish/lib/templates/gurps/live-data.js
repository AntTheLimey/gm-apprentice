'use strict';
const gc = require('./gurps-calc');

function num(v) {
  if (v == null) return null;
  // Only treat a leading `-` as a sign when it isn't a separator inside a token
  // like "Judo-14" / "Rapier-11" (skill cells use `Name-N` for the to-hit level).
  const m = String(v).match(/(?<![\w.])-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// A weapon's authored to-hit is the trailing integer of its skill cell, e.g.
// "Beam Weapons (Pistol)-15" -> 15. A signed scan (num) would misread the `-`
// after `)` as a negative sign, so extract the trailing number explicitly.
function weaponToHit(skillCell) {
  const m = String(skillCell).match(/(\d+)\s*$/);
  return m ? parseFloat(m[1]) : null;
}

function normalize(name) {
  return String(name).toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

// Skills-table entry -> [level0..level4] series.
function skillSeries(base, current, authoredLevel) {
  const per = authoredLevel > 0 ? (base - current) / authoredLevel : 0;
  return [0, 1, 2, 3, 4].map(L => Math.round(base - per * L));
}

function buildLevels(model) {
  const enc = model.encumbrance || [];
  if (enc.length < 5) return null;
  const levels = enc.slice(0, 5).map((e, i) => ({
    name: String(e.level).replace(/\s*\(\d+\)\s*$/, '').trim(),
    num: i,
    maxWeight: num(e.weight),
    move: num(e.move),
    dodge: num(e.dodge),
  }));
  if (levels.some(l => l.maxWeight == null || l.move == null || l.dodge == null)) return null;
  let authoredLevel = enc.findIndex(e => e.current);
  if (authoredLevel < 0) authoredLevel = 0;
  return { levels, authoredLevel };
}

function buildSkills(model, authoredLevel) {
  const out = {};
  for (const s of (model.skills || [])) {
    const cur = num(s.level);
    if (cur == null) continue;
    const base = num(s.base) != null ? num(s.base) : cur;
    out[s.name] = skillSeries(base, cur, authoredLevel);
  }
  return out;
}

// Find the [l0..l4] to-hit series for a weapon, or null if flat/unresolvable.
function weaponSeries(weapon, skillsByName, model, authoredLevel) {
  const skillCell = String(weapon.skill || '');
  const skillName = skillCell.replace(/[\s-]+\d+\s*$/, '').trim();
  const authoredToHit = weaponToHit(skillCell);
  // Case 1: linked skill present in the Skills table.
  const match = Object.keys(skillsByName).find(n => normalize(n) === normalize(skillName));
  if (match) return skillsByName[match];
  // Case 2: absent but enc-penalized -> synthesize from the weapon's own default.
  if (authoredToHit != null && gc.ENC_PENALIZED_SKILLS.includes(normalize(skillName))) {
    const base = authoredToHit + authoredLevel;
    return [0, 1, 2, 3, 4].map(L => base - L);
  }
  // Case 3: flat.
  return null;
}

function buildWeapons(model, skillsByName, authoredLevel) {
  const out = {};
  const rows = model.melee || [];
  for (const w of rows) {
    if (!w.weapon) continue;
    const authoredToHit = weaponToHit(w.skill);
    const series = weaponSeries(w, skillsByName, model, authoredLevel);
    const toHit = [0, 1, 2, 3, 4].map(L => {
      if (series && authoredToHit != null) return authoredToHit + (series[L] - series[authoredLevel]);
      return authoredToHit;
    });
    let parry = null;
    const authoredParry = num(w.parry);
    if (authoredParry != null) {
      parry = [0, 1, 2, 3, 4].map(L => {
        if (series) return authoredParry + (Math.floor(series[L] / 2) - Math.floor(series[authoredLevel] / 2));
        return authoredParry;
      });
    }
    out[w.weapon] = { toHit, parry, block: null };
  }
  return out;
}

function buildItems(model) {
  const items = [];
  for (const it of ((model.equipment || {}).items || [])) {
    items.push({ key: it.name, weight: gc.parseWeight(it.weight), defaultCarried: true, table: 'main' });
  }
  for (const lo of ((model.equipment || {}).loadouts || [])) {
    for (const it of (lo.items || [])) {
      items.push({ key: it.name, weight: gc.parseWeight(it.weight), defaultCarried: false, table: `loadout:${lo.name}` });
    }
  }
  return items;
}

// Max HP/FP and ST are the bought characteristics from the Attributes block;
// current HP/FP seed from the authored `## Current Status` (leading number of
// `HP: N/M` / `FP: N`), falling back to max. GURPS defaults HP->ST and FP->HT
// when the sheet omits the secondary characteristic.
function buildVitals(model) {
  const a = model.attributes || {};
  const prim = a.primary || {};
  const sec = a.secondary || {};
  const st = num(prim.ST && prim.ST.value);
  const basicSpeed = num(sec['Basic Speed'] && sec['Basic Speed'].value);
  const dx = num(prim.DX && prim.DX.value);
  const maxHp = num(sec.HP && sec.HP.value) != null ? num(sec.HP.value) : st;
  const maxFp = num(sec.FP && sec.FP.value) != null ? num(sec.FP.value) : num(prim.HT && prim.HT.value);
  if (maxHp == null || maxFp == null) return null;
  const s = model.status || {};
  const curHp = num(s.hp) != null ? num(s.hp) : maxHp;
  const curFp = num(s.fp) != null ? num(s.fp) : maxFp;
  return { hp: { cur: curHp, max: maxHp }, fp: { cur: curFp, max: maxFp }, st: st != null ? st : maxHp, basicSpeed, dx };
}

function buildLiveData(model, meta) {
  const lv = buildLevels(model);
  if (!lv) return null;
  const items = buildItems(model);
  if (items.length === 0) return null;
  const skills = buildSkills(model, lv.authoredLevel);
  const weapons = buildWeapons(model, skills, lv.authoredLevel);
  const v = buildVitals(model);
  return {
    buildVersion: meta.buildVersion,
    campaignId: meta.campaignId,
    pcSlug: meta.pcSlug,
    authoredLevel: lv.authoredLevel,
    levels: lv.levels,
    skills, weapons, items,
    vitals: v,
    basicSpeed: v ? v.basicSpeed : null,
    dx: v ? v.dx : null,
  };
}

function liveDataScript(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="gurps-live-data">${json}</script>`;
}

module.exports = { buildLiveData, liveDataScript, buildVitals };

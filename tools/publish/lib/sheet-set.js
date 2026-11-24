'use strict';

// `sheet set` command: write named vitals (hp=41 hit-dice=1/5) into one PC's note, by
// the same per-system writers `flush` uses. The values come from the command line
// instead of the live store, put in the record shape the writer already reads, so the
// row labels and the rule that a missing cell is never added stay in the writers.
//
// Each key is written on its own (a writer changes only the fields its record carries),
// so every key gets its own answer: written, already so, or no row on this sheet.
// "No row" is told from "already so" by asking the writer once more with values that
// would change any cell it can write: if none of them changes anything, the sheet has no
// cell for that key. Every side effect is behind an injectable dep, as in flush-cli.
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { scanVault } = require('./scanner');
const { resolveConfig, loadVaultConfig } = require('./config');
const { readSettings, forSite } = require('./settings');
const { readSwitch } = require('./settings/types');
const { systemId } = require('./shared-lists');
const { resolveSystem, summarize, WRITERS } = require('./flush-cli');
const { findPc, displayNameOf } = require('./sheet-cli');
const { liveSheet } = require('./flush/dnd-writeback');
const { fitConditions } = require('../js/dnd-live');
const { parseNote } = require('./frontmatter');
const { extractSections } = require('./processor');
const { parseCoC } = require('./templates/coc/parse');
const { deriveGurpsMax } = require('./flush/gurps-max');

class SheetSetError extends Error {}

// A whole number, at least 0 and at most `most`.
function whole(key, value, most) {
  if (!/^\d+$/.test(value)) throw new SheetSetError(`${key}=${value}: want a whole number`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new SheetSetError(`${key}=${value}: too large`);
  if (most !== undefined && n > most) throw new SheetSetError(`${key}=${value}: at most ${most}`);
  return n;
}

// A whole number that may go below 0 (GURPS HP and FP do).
function signed(key, value) {
  if (!/^-?\d+$/.test(value)) throw new SheetSetError(`${key}=${value}: want a whole number (it may be negative)`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new SheetSetError(`${key}=${value}: too large`);
  return n;
}

// A comma list of D&D conditions. The writer keeps only names that pass the page's own
// rule (fitConditions), so a name it would drop is refused here instead of lost quietly.
function conditionList(value) {
  if (/^(—|–|-|none)?$/i.test(value.trim())) return [];
  const names = [];
  for (const n of value.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!names.some(m => m.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  const bad = names.filter(n => fitConditions([n]).length === 0);
  if (bad.length) {
    throw new SheetSetError(`conditions=${value}: the sheet can't hold ${bad.map(n => `"${n}"`).join(', ')} (letters, digits, spaces, ' - and ( ) only, up to 60 characters a name); nothing written`);
  }
  if (fitConditions(names).length !== names.length) {
    throw new SheetSetError(`conditions=${value}: at most 20 conditions; nothing written`);
  }
  return names;
}

// yes/no, read with the settings' own switch words.
function yesNo(key, value) {
  const v = readSwitch(value);
  if (typeof v !== 'boolean') throw new SheetSetError(`${key}=${value}: want yes or no`);
  return v;
}

// "made/failed", each 0-3.
function pair(key, value, most) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (!m || +m[1] > most || +m[2] > most) throw new SheetSetError(`${key}=${value}: want two numbers like 1/2, each at most ${most}`);
  return [+m[1], +m[2]];
}

const NUMBER_PROBES = [0, 1];

// D&D keys: the writer's own scalars, and the counts the vitals hold (Hit Dice, Death
// Saves), in the record's `used` map under the live keys the page gives them.
const DND = {
  hp: { row: 'HP (Current)', record: v => ({ hp: whole('hp', v) }), probes: NUMBER_PROBES.map(n => ({ hp: n })) },
  temp: { row: 'Temp HP', record: v => ({ temp: whole('temp', v, 9999) }), probes: NUMBER_PROBES.map(n => ({ temp: n })) },
  exhaustion: { row: 'Exhaustion', record: v => ({ exhaustion: whole('exhaustion', v, 6) }), probes: NUMBER_PROBES.map(n => ({ exhaustion: n })) },
  conditions: {
    row: 'Conditions',
    // A comma list; a dash or "none" clears it.
    record: v => ({ conditions: conditionList(v) }),
    probes: [{ conditions: [] }, { conditions: ['Prone'] }],
  },
  inspiration: { row: 'Heroic Inspiration', record: v => ({ inspiration: yesNo('inspiration', v) }), probes: [{ inspiration: true }, { inspiration: false }] },
  'death-saves': {
    row: 'Death Saves',
    record: (v) => { const [s, f] = pair('death-saves', v, 3); return { used: { 'ds:s': s, 'ds:f': f } }; },
    probes: [{ used: { 'ds:s': 0, 'ds:f': 0 } }, { used: { 'ds:s': 1, 'ds:f': 1 } }],
  },
};

// The CoC writer's record: Derived Current cells, Reputation's current value (Regency), and
// the Status boxes, one record key each.
const COC_CONDITIONS = [
  ['temporary-insanity', 'temporaryInsanity', 'Temporary Insanity'],
  ['indefinite-insanity', 'indefiniteInsanity', 'Indefinite Insanity'],
  ['major-wound', 'majorWound', 'Major Wound'],
  ['unconscious', 'unconscious', 'Unconscious'],
  ['dying', 'dying', 'Dying'],
];
// A value over the sheet's own maximum is refused, never written: the maximum comes from
// the same parser the site reads the sheet with.
function underMax(key, n, most, label) {
  if (typeof most === 'number' && isFinite(most) && n > most) throw new SheetSetError(`${key}=${n}: this sheet's ${label} is ${most}`);
  return n;
}

// The CoC Derived table's Max column (HP, MP, Sanity), as the site parses it.
function cocMaxima(markdown, frontmatter, system) {
  try {
    const d = parseCoC(frontmatter || {}, extractSections(parseNote(String(markdown)).content), system).derived;
    return { hp: d.hp.max, mp: d.mp.max, san: d.sanity.max };
  } catch (e) {
    return {};
  }
}

function cocKeys(regency, maxima = {}) {
  const scalar = (field, row, most) => ({ row, record: v => ({ [field]: underMax(field, whole(field, v), most, `${row} maximum`) }), probes: NUMBER_PROBES.map(n => ({ [field]: n })) });
  const keys = { hp: scalar('hp', 'HP', maxima.hp), mp: scalar('mp', 'MP', maxima.mp), luck: scalar('luck', 'Luck'), san: scalar('san', 'Sanity', maxima.san) };
  if (regency) keys.rep = scalar('rep', 'Current Reputation');
  for (const [key, field, row] of COC_CONDITIONS) {
    keys[key] = { row, record: v => ({ conditions: { [field]: yesNo(key, v) } }), probes: [true, false].map(b => ({ conditions: { [field]: b } })) };
  }
  return keys;
}

// GURPS HP and FP may go below 0 but not over the maximum flush derives for the sheet.
function gurpsKeys(markdown, frontmatter) {
  const { maxHp, maxFp } = deriveGurpsMax(markdown, frontmatter);
  return {
    hp: { row: '**HP:** line in Current Status', record: v => ({ hp: underMax('hp', signed('hp', v), maxHp, 'HP maximum') }), probes: NUMBER_PROBES.map(n => ({ hp: n })) },
    fp: { row: '**FP:** line in Current Status', record: v => ({ fp: underMax('fp', signed('fp', v), maxFp, 'FP maximum') }), probes: NUMBER_PROBES.map(n => ({ fp: n })) },
  };
}

// A Hit Dice row's key on the command line: `hit-dice`, or `hit-dice-d10` beside a second row.
const hitDiceName = liveKeyName => 'hit-dice' + liveKeyName.replace(/^hd:hit dice/, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').replace(/^(?=[^-])/, '-');

// The keys a D&D note takes: the fixed ones, and one per live Hit Dice row.
function dndKeys(markdown) {
  const { hitDice: rows, hpMax } = liveSheet(markdown);
  // The writer fits HP to the sheet's maximum; a value over it is refused, never cut quietly.
  const hp = (v) => {
    const n = whole('hp', v);
    if (hpMax !== null && n > hpMax) throw new SheetSetError(`hp=${v}: this sheet's HP (Max) is ${hpMax}`);
    return { hp: n };
  };
  const keys = { ...DND, hp: { ...DND.hp, record: hp } };
  for (const r of rows) {
    keys[hitDiceName(r.key)] = {
      row: r.label,
      hitDice: r,
      record: (v) => {
        const name = hitDiceName(r.key);
        const m = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(v);
        if (!m) throw new SheetSetError(`${name}=${v}: want spent/max, like 1/${r.max}`);
        if (m[2] !== undefined && +m[2] !== r.max) {
          throw new SheetSetError(`${name}=${v}: this sheet's ${r.label} has ${r.max}, not ${m[2]}; only the spent number is written`);
        }
        if (+m[1] > r.max) throw new SheetSetError(`${name}=${v}: at most ${r.max} spent`);
        return { used: { [r.key]: +m[1] } };
      },
      probes: [0, 1].map(n => ({ used: { [r.key]: n } })),
    };
  }
  return { keys, hitDice: rows.map(r => hitDiceName(r.key)) };
}

// Which writer a note takes, and its keys. Flush reads any system it does not know as CoC
// (old CoC sites carry none); here a system must be named to be written.
function writerFor(frontmatter, campaignSystem, markdown) {
  const named = String((frontmatter && frontmatter.system) || campaignSystem || '').trim();
  const writer = resolveSystem(frontmatter, campaignSystem);
  const id = systemId(named);
  if (!writer || (writer === 'coc' && !/^coc-7e/.test(id || ''))) {
    throw new SheetSetError(`no live-sheet writer for ${named || 'a campaign with no system set'}`);
  }
  if (writer === 'dnd') return { writer, ...dndKeys(markdown) };
  if (writer === 'gurps') return { writer, keys: gurpsKeys(markdown, frontmatter), hitDice: [] };
  const regency = id === 'coc-7e-regency' || /regency/i.test(named);
  return { writer, keys: cocKeys(regency, cocMaxima(markdown, frontmatter, id || named)), hitDice: [] };
}

// Split `key=value` words. A key is lower-case letters, digits and dashes.
function readPairs(pairs) {
  const out = [];
  const seen = new Set();
  for (const p of pairs) {
    const m = /^([a-z][a-z0-9-]*)=(.*)$/s.exec(p);
    if (!m) throw new SheetSetError(`${p}: want key=value`);
    const key = m[1];
    if (seen.has(key)) throw new SheetSetError(`${key} is given twice`);
    seen.add(key);
    out.push({ key, value: m[2].trim() });
  }
  if (!out.length) throw new SheetSetError('name at least one key=value');
  return out;
}

function validKeys(sys) {
  const fixed = Object.keys(sys.keys).filter(k => !sys.keys[k].hitDice);
  return [...fixed, ...sys.hitDice].join(', ');
}

// Every key checked and turned into its record before anything is written: one bad key
// writes nothing.
function plan(sys, pairs) {
  return pairs.map(({ key, value }) => {
    // A sheet with one Hit Dice row takes plain `hit-dice` whatever the row adds (`Hit Dice d10`).
    const def = sys.keys[key] || (key === 'hit-dice' && sys.hitDice.length === 1 ? sys.keys[sys.hitDice[0]] : undefined);
    if (!def) {
      if (sys.writer === 'dnd' && /^hit-dice(-|$)/.test(key)) {
        // A Hit Dice row the sheet does not have: said, and left alone like any other.
        if (key === 'hit-dice' && sys.hitDice.length > 1) {
          throw new SheetSetError(`this sheet has ${sys.hitDice.length} Hit Dice rows: name one (${sys.hitDice.join(', ')})`);
        }
        return { key, value, missing: key === 'hit-dice' ? 'Hit Dice' : `Hit Dice ${key.slice('hit-dice-'.length)}` };
      }
      throw new SheetSetError(`unknown key "${key}". Keys for this sheet: ${validKeys(sys)}`);
    }
    return { key, value, def, record: def.record(value) };
  });
}

// Apply the planned keys to the note's text, one writer call each. Returns the new text,
// the changes (as flush reports them) and a line for each key that wrote nothing.
function setVitals(markdown, page, sys, planned, out) {
  const write = (text, rec) => WRITERS[sys.writer](text, rec, page, out);
  let text = markdown;
  const changes = [];
  const same = [];
  const missing = [];
  for (const p of planned) {
    if (p.missing) { missing.push(`no writable ${p.missing} row on this sheet: ${p.key} left alone`); continue; }
    const res = write(text, p.record);
    if (res === null) return null;          // the writer refused the note and said why
    if (res.changes.length) {
      text = res.markdown;
      changes.push(...res.changes);
      continue;
    }
    const placed = p.def.probes.some((probe) => {
      const r = write(text, probe);
      return r && r.changes.length > 0;
    });
    if (placed) same.push(p.key);
    else missing.push(`no writable ${p.def.row} row on this sheet: ${p.key} left alone`);
  }
  return { markdown: text, changes, same, missing };
}

// The lines a run prints, flush's shape: `✓ Name — HP (Current) 34→41`.
function report(name, result, dryRun) {
  const lines = [];
  if (result.changes.length) lines.push({ kind: 'set', text: `✓ ${name} — ${summarize(result.changes)}${dryRun ? '  (would write)' : ''}` });
  if (result.same.length) lines.push({ kind: 'same', text: `· ${name} — already so: ${result.same.join(', ')}` });
  for (const m of result.missing) lines.push({ kind: 'missing', text: `⚠ ${name} — ${m}` });
  if (!lines.length) lines.push({ kind: 'same', text: `· ${name} — no change` });
  return lines;
}

// The PC note: by --pc through the site's config (as `sheet show`), or by --file in --vault.
function findNote(deps) {
  if (deps.vault) {
    const vaultPath = path.resolve(deps.vault);
    const rel = String(deps.file || '');
    const sourcePath = path.resolve(vaultPath, rel);
    if (path.relative(vaultPath, sourcePath).startsWith('..')) throw new SheetSetError(`${rel} is outside the vault`);
    const readSettingsFn = deps.readSettings || readSettings;
    const values = forSite(readSettingsFn({ vaultPath }), 'player').vault || {};
    return { sourcePath, campaignSystem: values.system, title: path.basename(rel, '.md').replace(/_/g, ' ') };
  }
  const configPath = path.resolve(deps.configPath || './vault.config.json');
  const rawConfig = loadVaultConfig(configPath, deps);
  const vaultPath = deps.config ? rawConfig.vaultPath : path.resolve(path.dirname(configPath), rawConfig.vaultPath);
  const { config, publishConfig } = deps.publishConfig
    ? { config: rawConfig, publishConfig: deps.publishConfig }
    : resolveConfig(rawConfig, vaultPath);
  const scan = deps.scan || function () { return scanVault(Object.assign({}, config, { vaultPath })); };
  const pcs = scan().filter(p => p.frontmatter && p.frontmatter.type === 'pc');
  const page = findPc(pcs, deps.pc);
  if (!page) {
    throw new SheetSetError(`No PC named "${deps.pc}". PCs: ${pcs.map(displayNameOf).join(', ') || '(none in this vault)'}`);
  }
  return { sourcePath: page.sourcePath, campaignSystem: publishConfig.system, title: displayNameOf(page), page };
}

async function runSheetSet(deps) {
  deps = deps || {};
  const out = deps.out || console.log;
  const err = deps.err || console.error;
  const readFile = deps.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
  const writeFile = deps.writeFile || function (p, s) { fs.writeFileSync(p, s); };
  const dryRun = !!deps.dryRun;
  const stdin = deps.stdinText;              // --stdin: the note's text; JSON out, nothing written
  try {
    if (!deps.vault && !String(deps.pc || '').trim()) throw new SheetSetError('sheet set needs --pc <name>');
    if (deps.vault && !deps.file) throw new SheetSetError('sheet set --vault needs --file <note>');
    const pairs = readPairs(deps.pairs || []);
    const found = findNote(deps);
    const raw = stdin !== undefined ? stdin : readFile(found.sourcePath);
    const frontmatter = found.page ? found.page.frontmatter : matter(raw).data;
    if (!frontmatter || frontmatter.type !== 'pc') throw new SheetSetError(`${deps.file || found.title} is not a PC note (type: pc)`);
    const name = found.page ? found.title
      : String(frontmatter.name || '').trim() || found.title;
    const sys = writerFor(frontmatter, found.campaignSystem, raw);
    const planned = plan(sys, pairs);
    const page = found.page || { frontmatter, title: name, displayTitle: name };
    const said = [];
    const result = setVitals(raw, page, sys, planned, (line) => said.push(line));
    if (result === null) throw new SheetSetError(said.join('\n').replace(/^⚠ /, '') || `${name}: the writer refused this note`);
    const lines = report(name, result, dryRun && stdin === undefined);
    if (stdin !== undefined) {
      out(JSON.stringify({ pc: name, markdown: result.markdown, changed: result.markdown !== raw, lines }));
      return 0;
    }
    if (dryRun) out('DRY RUN — nothing will be written.');
    if (!dryRun && result.markdown !== raw) writeFile(found.sourcePath, result.markdown);
    for (const l of lines) out(l.text);
    return 0;
  } catch (e) {
    if (!(e instanceof SheetSetError)) throw e;
    err(`Error: ${e.message}`);
    return 1;
  }
}

module.exports = { runSheetSet, SheetSetError, writerFor };

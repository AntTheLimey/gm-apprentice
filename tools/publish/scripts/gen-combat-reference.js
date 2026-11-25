#!/usr/bin/env node
'use strict';
// Writes the combat references' tables from the code that uses the same figures, so the two cannot drift apart: the
// GURPS hit-location table in skills/ttrpg-expert/systems/gurps-4e/combat.md from the one hit-location table
// (lib/templates/gurps/hit-locations.js, read through the run sheet's WOUNDING: names, penalties, pages), and the
// CoC damage bonus by attack in skills/ttrpg-expert/systems/coc-7e/mechanics.md from coc-math's dbModeOf. Each table
// sits between two marker lines:
//   <!-- generated: <name> -->  ...  <!-- /generated -->
// and everything between them is replaced. The words around the tables are hand-written. Names, numbers, short notes
// and page cites only (GURPS: SJG Online Policy).
//
//   node tools/publish/scripts/gen-combat-reference.js           says whether the files are current (exit 1 if not)
//   node tools/publish/scripts/gen-combat-reference.js --write   rewrites them

const fs = require('node:fs');
const path = require('node:path');
const { WOUNDING } = require('../lib/run-sheet/systems/gurps');
const { dbModeOf, DB_WORDS } = require('../lib/run-sheet/web/coc-math');

const SYSTEMS = path.join(__dirname, '..', '..', '..', 'skills', 'ttrpg-expert', 'systems');
const GURPS_COMBAT = path.join(SYSTEMS, 'gurps-4e', 'combat.md');
const COC_MECHANICS = path.join(SYSTEMS, 'coc-7e', 'mechanics.md');

// the damage types, for the test that no column is one
const TYPES = ['cr', 'cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++', 'burn', 'tbb', 'cor', 'tox'];
const fig = (n) => (n < 0 ? `-${Math.abs(n)}` : n > 0 ? `+${n}` : '0');

// One row a place: its name, penalty and page only (Ant's pick on the PRENTICE review's C1, 2026-11-25). DR, wounding,
// crippling and knockdown stay in code, where the run sheet works them out; the doc points there and to the book.
function hitLocationTable() {
  const head = ['Location', 'Penalty', 'Page'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const key of WOUNDING.locationOrder) {
    const loc = WOUNDING.locations[key];
    lines.push(`| ${[loc.name, fig(loc.penalty), loc.cite].join(' | ')} |`);
  }
  return lines.join('\n');
}

const KINDS = [['melee', 'Melee'], ['thrown', 'Thrown weapon, or a bow drawn by the wielder'], ['shot', 'Firearm']];
function damageBonusTable() {
  const lines = ['| Attack | Damage bonus |', '|---|---|'];
  for (const [kind, name] of KINDS) lines.push(`| ${name} | ${DB_WORDS[dbModeOf(kind)]} |`);
  return lines.join('\n');
}

const FILES = [
  { file: GURPS_COMBAT, blocks: { 'hit-locations': hitLocationTable } },
  { file: COC_MECHANICS, blocks: { 'damage-bonus': damageBonusTable } },
];

// The file's text with each named block's lines replaced; throws when a marker pair is missing.
function render(text, blocks) {
  let out = String(text).replace(/\r\n?/g, '\n');
  for (const [name, make] of Object.entries(blocks)) {
    const open = `<!-- generated: ${name} -->`;
    const close = '<!-- /generated -->';
    const a = out.indexOf(open);
    const b = a < 0 ? -1 : out.indexOf(close, a);
    if (a < 0 || b < 0) throw new Error(`no ${open} ... ${close} pair`);
    out = `${out.slice(0, a + open.length)}\n${make()}\n${out.slice(b)}`;
  }
  return out;
}

function main(argv) {
  const write = argv.includes('--write');
  let stale = 0;
  for (const { file, blocks } of FILES) {
    const was = fs.readFileSync(file, 'utf8');
    const now = render(was, blocks);
    if (now === was.replace(/\r\n?/g, '\n')) continue;
    if (write) { fs.writeFileSync(file, now); console.log(`wrote ${path.relative(process.cwd(), file)}`); } else { stale++; console.log(`out of date: ${path.relative(process.cwd(), file)}`); }
  }
  if (stale) { console.log('run: node tools/publish/scripts/gen-combat-reference.js --write'); process.exitCode = 1; }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { render, FILES, hitLocationTable, damageBonusTable, TYPES };

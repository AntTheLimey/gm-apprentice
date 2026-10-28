#!/usr/bin/env node
'use strict';
// Writes the two hook tables of docs/theme-hooks.md from the one list (lib/theme-hooks.js). Each table sits between
// two marker lines, <!-- theme-hooks:always --> ... <!-- /theme-hooks:always --> (and the same for `switch`), and
// everything between them is replaced. The words around the tables are hand-written.
//
//   node tools/publish/scripts/gen-theme-hooks-doc.js           says whether the page is current (exit 1 if not)
//   node tools/publish/scripts/gen-theme-hooks-doc.js --write   rewrites it

const fs = require('node:fs');
const path = require('node:path');
const { HOOKS } = require('../lib/theme-hooks');

const DOC = path.join(__dirname, '..', '..', '..', 'docs', 'theme-hooks.md');
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function table(when) {
  const rows = HOOKS.filter((h) => h.when === when).map((h) => `| \`${h.selector}\` | ${cell(h.marks)} | \`${cell(h.example)}\` |`);
  return ['', '| Hook | What it marks | Example |', '|------|---------------|---------|', ...rows, ''].join('\n');
}

function render(doc) {
  let out = doc;
  for (const when of ['always', 'switch']) {
    const re = new RegExp(`(<!-- theme-hooks:${when} -->)[\\s\\S]*?(<!-- /theme-hooks:${when} -->)`);
    if (!re.test(out)) throw new Error(`docs/theme-hooks.md has no <!-- theme-hooks:${when} --> region`);
    out = out.replace(re, (m, open, close) => `${open}\n${table(when)}\n${close}`);
  }
  return out;
}

if (require.main === module) {
  const doc = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const next = render(doc);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(DOC, next);
    console.log('docs/theme-hooks.md rewritten');
  } else if (next !== doc) {
    console.log('docs/theme-hooks.md is out of date: run with --write');
    process.exit(1);
  } else console.log('docs/theme-hooks.md is current');
}

module.exports = { render };

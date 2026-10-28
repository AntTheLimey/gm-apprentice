#!/usr/bin/env node
'use strict';
// Writes the three hook tables of docs/theme-hooks.md from the one list (lib/theme-hooks.js), and the token tables of
// docs/theme-tokens.md from lib/theme-tokens.js. Each table sits between
// two marker lines, <!-- theme-hooks:always --> ... <!-- /theme-hooks:always --> (and the same for `switch` and `setting`), and
// everything between them is replaced. The words around the tables are hand-written.
//
//   node tools/publish/scripts/gen-theme-hooks-doc.js           says whether the page is current (exit 1 if not)
//   node tools/publish/scripts/gen-theme-hooks-doc.js --write   rewrites it

const fs = require('node:fs');
const path = require('node:path');
const { HOOKS } = require('../lib/theme-hooks');
const { TOKENS, GROUPS } = require('../lib/theme-tokens');

const DOC = path.join(__dirname, '..', '..', '..', 'docs', 'theme-hooks.md');
const TOKENS_DOC = path.join(__dirname, '..', '..', '..', 'docs', 'theme-tokens.md');
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function table(when) {
  const hooks = HOOKS.filter((h) => h.when === when);
  if (when === 'setting') {
    const rows = hooks.map((h) => `| \`${h.selector}\` | \`${cell(h.setting)}\` | ${cell(h.marks)} | \`${cell(h.example)}\` |`);
    return ['', '| Hook | Written with | What it marks | Example |', '|------|--------------|---------------|---------|', ...rows, ''].join('\n');
  }
  const rows = hooks.map((h) => `| \`${h.selector}\` | ${cell(h.marks)} | \`${cell(h.example)}\` |`);
  return ['', '| Hook | What it marks | Example |', '|------|---------------|---------|', ...rows, ''].join('\n');
}

function render(doc) {
  let out = doc;
  for (const when of ['always', 'switch', 'setting']) {
    const re = new RegExp(`(<!-- theme-hooks:${when} -->)[\\s\\S]*?(<!-- /theme-hooks:${when} -->)`);
    if (!re.test(out)) throw new Error(`docs/theme-hooks.md has no <!-- theme-hooks:${when} --> region`);
    out = out.replace(re, (m, open, close) => `${open}\n${table(when)}\n${close}`);
  }
  return out;
}

// docs/theme-tokens.md: one table per group of lib/theme-tokens.js, between <!-- theme-tokens:<group> --> and
// <!-- /theme-tokens:<group> -->.
function tokenTable(group) {
  const rows = TOKENS.filter((t) => t.group === group).map((t) => {
    const def = t.scope === 'unset' ? `Unset: ${t.value.startsWith('var(') || /^[a-z]+$/.test(t.value) ? `\`${cell(t.value)}\`` : cell(t.value)}` : `\`${cell(t.value)}\``;
    return `| \`${t.name}\` | ${cell(t.what)} | ${def}${t.light ? `; light \`${cell(t.light)}\`` : ''} |`;
  });
  return ['', '| Token | What it sets | Default |', '|-------|--------------|---------|', ...rows, ''].join('\n');
}

function renderTokens(doc) {
  let out = doc;
  for (const g of GROUPS) {
    const re = new RegExp(`(<!-- theme-tokens:${g.id} -->)[\\s\\S]*?(<!-- /theme-tokens:${g.id} -->)`);
    if (!re.test(out)) throw new Error(`docs/theme-tokens.md has no <!-- theme-tokens:${g.id} --> region`);
    out = out.replace(re, (m, open, close) => `${open}\n${g.about ? `\n${g.about}\n` : ''}${tokenTable(g.id)}\n${close}`);
  }
  return out;
}

if (require.main === module) {
  let stale = false;
  for (const [file, label, fn] of [[DOC, 'docs/theme-hooks.md', render], [TOKENS_DOC, 'docs/theme-tokens.md', renderTokens]]) {
    const doc = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const next = fn(doc);
    if (process.argv.includes('--write')) {
      fs.writeFileSync(file, next);
      console.log(`${label} rewritten`);
    } else if (next !== doc) {
      console.log(`${label} is out of date: run with --write`);
      stale = true;
    } else console.log(`${label} is current`);
  }
  if (stale) process.exit(1);
}

module.exports = { render, renderTokens };

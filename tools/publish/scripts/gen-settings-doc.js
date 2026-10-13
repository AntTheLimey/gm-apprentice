#!/usr/bin/env node
'use strict';
// Writes the settings tables of docs/site-settings.md from the one declared list
// (lib/settings/registry.js). Each table sits between two marker lines:
//   <!-- settings:<group> -->  ...  <!-- /settings:<group> -->
// and everything between them is replaced. The words around the tables are hand-written.
//
//   node tools/publish/scripts/gen-settings-doc.js           says whether the page and the schema file are current (exit 1 if not)
//   node tools/publish/scripts/gen-settings-doc.js --write   rewrites them
// It also writes schema/vault-config.schema.json, the JSON Schema of the vault settings file.

const fs = require('node:fs');
const path = require('node:path');
const { REGISTRY, GROUPS } = require('../lib/settings/registry');
const { row, leftOutCell, isLeaf, schemaText } = require('../lib/settings/describe');

const DOC = path.join(__dirname, '..', '..', '..', 'docs', 'site-settings.md');
const SCHEMA = path.join(__dirname, '..', 'schema', 'vault-config.schema.json');

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const ticks = (words) => words.map((w) => `\`${w}\``);
const orList = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

const upFirst = (text) => text.replace(/^[a-z]/, (c) => c.toUpperCase());

// What the Values column says. An entry's own `shape` wins; a switch points at the page's
// "On and off" section; a choice names its words; a text-or-list switch says what each
// word does; the rest is the sentence describe.js gives.
function valuesCell(entry) {
  if (entry.shape) return upFirst(entry.shape);
  if (entry.type === 'switch') return 'A switch';
  if (entry.type === 'switchOrList') return `\`on\` for all, \`off\` for none, or a list of ${entry.of || 'names'}`;
  if (entry.type === 'choice') return orList(ticks(entry.values));
  return upFirst(row(entry).takes);
}

// The names a setting had before, beneath its name (a site-file key is named as the key).
function wasNote(e) {
  const old = (e.was || []).map((w) => `\`${w.name}\``);
  return old.length ? `<br>was ${old.join(', ')}` : '';
}

function table(groupId) {
  const rows = REGISTRY.filter((e) => e.group === groupId && isLeaf(e, REGISTRY));
  const lines = ['| Setting | What it does | Values | Left out |', '|---------|--------------|--------|----------|'];
  for (const e of rows) {
    lines.push(`| \`${e.name}\`${wasNote(e)} | ${cell(e.does)} | ${cell(valuesCell(e))} | ${cell(leftOutCell(e))} |`);
  }
  return lines.join('\n');
}

// The settings that decide what players do not see: the build stops, and does not carry on
// with a safe guess, when one of these cannot be read or is misspelt.
function hidingList() {
  return REGISTRY.filter((e) => e.guards && isLeaf(e, REGISTRY)).map((e) => `- \`${e.name}\``).join('\n');
}

// Replace each marked region with its group's table, or (hiding-list) the stop list.
function render(markdown) {
  return markdown.replace(/<!-- settings:([a-z-]+) -->[\s\S]*?<!-- \/settings:\1 -->/g, (_, id) => {
    if (id !== 'hiding-list' && !GROUPS.some((g) => g.id === id)) throw new Error(`docs/site-settings.md marks a group the list does not have: ${id}`);
    const body = id === 'hiding-list' ? hidingList() : table(id);
    return `<!-- settings:${id} -->\n\n${body}\n\n<!-- /settings:${id} -->`;
  });
}

const readOr = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function main(argv) {
  const files = [
    { label: 'docs/site-settings.md', file: DOC, current: readOr(DOC), next: render(readOr(DOC)) },
    { label: 'tools/publish/schema/vault-config.schema.json', file: SCHEMA, current: readOr(SCHEMA), next: schemaText() },
  ];
  let stale = 0;
  for (const f of files) {
    const same = f.current === f.next;
    if (argv.includes('--write')) {
      if (!same) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.next); }
      console.log(same ? `${f.label} is already current` : `${f.label} rewritten`);
    } else if (same) {
      console.log(`${f.label} is current`);
    } else {
      stale++;
      console.log(`${f.label} is out of date: run \`node tools/publish/scripts/gen-settings-doc.js --write\``);
    }
  }
  return stale ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { render, table, valuesCell, hidingList };

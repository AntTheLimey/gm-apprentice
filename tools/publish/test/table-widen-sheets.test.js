'use strict';
// An over-wide row in any table of any system's PC template reaches the published page
// (#283): nothing in a section the sheet consumes may be dropped.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPc } = require('./helpers/pc-vault');
const { templateBody } = require('./helpers/pc-template');

const SYSTEMS = { 'dnd-5e-2024': 'pc-dnd-5e-2024.md', pf2e: 'pc-pf2e.md', fitd: 'pc-fitd.md', 'gurps-4e': 'pc-gurps-4e.md', 'coc-7e': 'pc-coc-7e.md' };

function quiet(fn) {
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
}

// Every table in the template, in turn: one over-wide row, the extra text on the page.
for (const [system, template] of Object.entries(SYSTEMS)) {
  const lines = templateBody(template).split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (/^\|/.test(lines[i]) && /^\|[-| :]+\|$/.test(lines[i + 1]) && /^\|/.test(lines[i + 2])) tables.push(i + 2);
  }
  test(`${system}: the template has tables to test`, () => assert.ok(tables.length >= 5));
  for (const [n, at] of tables.entries()) {
    test(`${system}: table ${n + 1} (${lines[at - 2].slice(0, 30)}) shows a cell beyond its header`, () => {
      const edited = lines.slice();
      edited[at] = edited[at].replace(/\|\s*$/, `| ZZEXTRA${n} |`);
      const { html } = quiet(() => buildPc(system, edited.join('\n')));
      assert.ok(html.includes(`ZZEXTRA${n}`), `${system} table ${n + 1} lost its extra cell`);
    });
  }
}

test('an extra cell on a CoC row is escaped, plain text', () => {
  const lines = templateBody('pc-coc-7e.md').split('\n');
  const at = lines.findIndex(l => l.startsWith('| STR |'));
  lines[at] = lines[at].replace(/\|\s*$/, '| <b>ZZ</b> & more |');
  const { html } = quiet(() => buildPc('coc-7e', lines.join('\n')));
  assert.ok(html.includes('&lt;b&gt;ZZ&lt;/b&gt;'));
});

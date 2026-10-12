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

const NOTES_GURPS = /\n?<section class="blk cat-skill"><h2>Notes on rows<\/h2>[\s\S]*?<\/section>/;
const NOTES_COC = /<h2 class="section">Notes on rows <span class="rule"><\/span><\/h2>(?:<p class="empty-note">[^<]*<\/p>)+/;

// Every table in the template, in turn. Its first body row is filled with numbers (so a reader
// has a value to keep), then given one extra cell. GURPS and CoC read columns by position:
// the sheet, less its "Notes on rows", must equal the sheet of the same row without the extra
// cell. D&D, PF2e and FitD pass an over-wide row through as written: every value and the extra
// cell are on the page.
for (const [system, template] of Object.entries(SYSTEMS)) {
  const lines = templateBody(template).split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (/^\|/.test(lines[i]) && /^\|[-| :]+\|$/.test(lines[i + 1]) && /^\|/.test(lines[i + 2])) tables.push(i + 2);
  }
  test(`${system}: the template has tables to test`, () => assert.ok(tables.length >= 5));
  for (const [n, at] of tables.entries()) {
    const label = `${system}: table ${n + 1} (${lines[at - 2].slice(0, 30)})`;
    const filled = lines.slice();
    filled[at] = filled[at].split('|').map((c, j, all) => (j >= 2 && j < all.length - 1 && c.trim() === '' ? ` ${n + 1}${j} ` : c)).join('|');
    const wide = filled.slice();
    wide[at] = wide[at].replace(/\|\s*$/, `| ZZEXTRA${n} |`);
    test(`${label} keeps its values and shows a cell beyond its header`, () => {
      const base = quiet(() => buildPc(system, filled.join('\n'))).html;
      const { html } = quiet(() => buildPc(system, wide.join('\n')));
      assert.ok(html.includes(`ZZEXTRA${n}`), `${label} lost its extra cell`);
      if (system === 'gurps-4e' || system === 'coc-7e') {
        assert.strictEqual(html.split(`ZZEXTRA${n}`).length - 1, 1, `${label} shows the extra cell more than once`);
        const stripped = html.replace(system === 'gurps-4e' ? NOTES_GURPS : NOTES_COC, '');
        assert.ok(!stripped.includes(`ZZEXTRA${n}`));
        assert.strictEqual(stripped, base, `${label}: a value on the sheet changed`);
      } else {
        const values = filled[at].split('|').map(c => c.trim()).filter(c => new RegExp(`^${n + 1}\\d+$`).test(c));
        for (const v of values) assert.ok(html.includes(v), `${label} lost ${v}`);
      }
    });
  }
}

test('GURPS Points Summary and Cultural Familiarities keep their numbers beside a note cell', () => {
  const lines = templateBody('pc-gurps-4e.md').split('\n');
  const pts = lines.findIndex(l => /^\| Attributes \|/.test(l));
  assert.ok(pts > 0);
  lines[pts] = '| Attributes | 120 | per GM ruling |';
  const cul = lines.findIndex(l => /^\| Culture \| Points \|/.test(l));
  lines[cul + 2] = '| Western | 1 |';
  lines[cul + 3] = '| Eastern | 2 | house rule |';
  const { html } = quiet(() => buildPc('gurps-4e', lines.join('\n')));
  assert.ok(/Attributes[\s\S]{0,80}120/.test(html));
  assert.ok(!/Attributes[\s\S]{0,80}per GM ruling[\s\S]{0,5}</.test(html.replace(NOTES_GURPS, '')));
  assert.ok(/Western[\s\S]{0,80}>1</.test(html), 'Western cost');
  assert.ok(/Eastern[\s\S]{0,80}>2</.test(html), 'Eastern cost');
});

test('a custom H2 table with an extra cell shows it once on a CoC and a GURPS sheet', () => {
  for (const [system, template] of [['coc-7e', 'pc-coc-7e.md'], ['gurps-4e', 'pc-gurps-4e.md']]) {
    const body = templateBody(template) + '\n## House Rules\n\n| Rule | Effect |\n|---|---|\n| Luck | spend it | ZZHOUSE |\n';
    const { html } = quiet(() => buildPc(system, body));
    assert.strictEqual(html.split('ZZHOUSE').length - 1, 1, system);
  }
});

test('an extra cell on a CoC row is escaped, plain text', () => {
  const lines = templateBody('pc-coc-7e.md').split('\n');
  const at = lines.findIndex(l => l.startsWith('| STR |'));
  lines[at] = lines[at].replace(/\|\s*$/, '| <b>ZZ</b> & more |');
  const { html } = quiet(() => buildPc('coc-7e', lines.join('\n')));
  assert.ok(html.includes('&lt;b&gt;ZZ&lt;/b&gt;'));
});

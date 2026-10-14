'use strict';
// The to-hit calculator reaches a GURPS character's built page (Task 4): the container,
// the data block and the script, with live stats off, and none of the three where it does not belong.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { buildPc } = require('../helpers/pc-vault');
const { templateBody } = require('../helpers/pc-template');

const RONNIE = matter(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;

function quiet(fn) {
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
}
const has = (html) => ({
  container: html.includes('id="tohit-calc"'),
  data: html.includes('id="gurps-tohit-data"'),
  script: html.includes('js/gurps-tohit.js'),
});
const dataOf = (html) => {
  const m = /<script type="application\/json" id="gurps-tohit-data">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
};
const NONE = { container: false, data: false, script: false };

test('a GURPS page with weapons holds the container, the data block and the script, live stats off', () => {
  const { html, out } = quiet(() => buildPc('gurps-4e', RONNIE));
  assert.deepStrictEqual(has(html), { container: true, data: true, script: true });
  assert.ok(!html.includes('gurps-live.js'), 'live stats are off in this build');
  assert.ok(fs.existsSync(path.join(out, 'js', 'gurps-tohit.js')));
  const data = dataOf(html);
  assert.ok(data.weapons.some((w) => w.type === 'ranged'));
  assert.ok(data.weapons.some((w) => w.type === 'melee'));
});

test('the container sits inside the Combat tab, before the rules reference', () => {
  const { html } = quiet(() => buildPc('gurps-4e', RONNIE));
  const tab = html.indexOf('id="tab-combat"');
  const box = html.indexOf('id="tohit-calc"');
  const ref = html.indexOf('class="rules-ref"');
  assert.ok(tab >= 0 && box > tab, 'after the Combat tab opens');
  assert.ok(ref > box, 'before the rules reference');
  assert.ok(html.indexOf('id="tab-equipment"') > box, 'inside the Combat panel');
});

test('with live stats on the page holds the three and the live script', () => {
  const { html } = quiet(() => buildPc('gurps-4e', RONNIE, ['live_stats: true']));
  assert.deepStrictEqual(has(html), { container: true, data: true, script: true });
});

test('tohit_calculator: off leaves none of the three', () => {
  const { html } = quiet(() => buildPc('gurps-4e', RONNIE, ['tohit_calculator: off']));
  assert.deepStrictEqual(has(html), NONE);
});

test('a GURPS character with no weapon tables holds none of the three', () => {
  const { html } = quiet(() => buildPc('gurps-4e', templateBody('pc-gurps-4e.md')));
  assert.deepStrictEqual(has(html), NONE);
});

test('a CoC, a D&D and a Pathfinder page hold none of the three', () => {
  for (const [system, template] of [['coc-7e', 'pc-coc-7e.md'], ['dnd-5e-2024', 'pc-dnd-5e-2024.md'], ['pf2e', 'pc-pf2e.md']]) {
    const { html } = quiet(() => buildPc(system, templateBody(template)));
    assert.deepStrictEqual(has(html), NONE, system);
  }
});

test('a weapon name that tries to close the script builds and reads back exactly', () => {
  const name = 'Gun</script><b>x';
  const body = RONNIE.replace('Colt M4A1 SOPMOD (5.56mm) ◇', name);
  assert.ok(body.includes(name));
  const { html } = quiet(() => buildPc('gurps-4e', body));
  const data = dataOf(html);
  assert.ok(data.weapons.some((w) => w.name === name), 'the block parses back to that exact name');
  assert.ok(!/<script[^>]*gurps-tohit-data[^>]*>[^]*?Gun<\/script>/.test(html));
});

// #357: the script is copied only into a site that can link it.
test('the calculator\'s script is copied only into a GURPS site with the calculator on', () => {
  const on = quiet(() => buildPc('gurps-4e', RONNIE));
  assert.ok(fs.existsSync(path.join(on.out, 'js', 'gurps-tohit.js')));
  const off = quiet(() => buildPc('gurps-4e', RONNIE, ['tohit_calculator: off']));
  assert.ok(!fs.existsSync(path.join(off.out, 'js', 'gurps-tohit.js')));
  const coc = quiet(() => buildPc('coc-7e', templateBody('pc-coc-7e.md')));
  assert.ok(!fs.existsSync(path.join(coc.out, 'js', 'gurps-tohit.js')));
  assert.ok(fs.existsSync(path.join(coc.out, 'js', 'coc-live.js')), 'the other scripts are still copied');
});

// #394: a row the calculator cannot fully read is a Site Faults finding on the PC's note,
// and the build's summary points at campaign-qa.
test('a row the calculator cannot read is a finding, with a summary line', () => {
  const body = RONNIE.replace(/\| SIG-Sauer P226 \(9mm\) \| [^|]*\|/, '| SIG-Sauer P226 (9mm) | DX-12 (default) |');
  assert.notStrictEqual(body, RONNIE);
  let faults = null;
  const lines = [];
  const warn = console.warn; const log = console.log;
  console.log = () => {}; console.warn = (m) => lines.push(String(m));
  try { buildPc('gurps-4e', body, [], { onNoteFaults: (f) => { faults = f; } }); } finally { console.warn = warn; console.log = log; }
  const mine = faults.filter((f) => f.code === 'TOHIT_UNREAD' && f.severity === 'warning');
  assert.ok(mine.some((f) => f.path === 'Characters/PCs/Test_Hero.md' && /SIG-Sauer P226 \(9mm\)".*names the attribute DX/.test(f.detail) && /default level/.test(f.fix)), JSON.stringify(mine));
  assert.ok(lines.some((l) => /rows? of (a )?PC sheets? (is|are) not fully read by the to-hit calculator \(Test_Hero \d+\) — campaign-qa's Site Faults check fixes/.test(l)), lines.join('\n'));
});

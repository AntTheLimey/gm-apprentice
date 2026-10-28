'use strict';
// player_site.sheets.gurps_reference_tables and player_site.sheets.coc_skill_list (#423): the tool's own rules lists
// on a character sheet, each on unless the vault turns it off. Off, the GURPS Combat tab has no reference block, and a
// Call of Cthulhu sheet (Regency too) lists only the skills the character's note has, with the values written there.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const matter = require('gray-matter');
const { build } = require('../../lib/build');
const { writeNewConfig } = require('../helpers/settings-files');
const { buildBoth } = require('../helpers/gm-build');
const { browserSkip, measure } = require('../helpers/browser');

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const RONNIE = matter(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;

// An investigator whose note lists two skills: one on the built-in lists, one that is on neither.
const INVESTIGATOR = `## Stat Sheet

### Characteristics

| Characteristic | Regular | Half | Fifth |
|---|---|---|---|
| STR | 50 | 25 | 10 |
| CON | 55 | 27 | 11 |
| DEX | 60 | 30 | 12 |
| INT | 70 | 35 | 14 |
| SIZ | 65 | 32 | 13 |
| POW | 45 | 22 | 9 |
| APP | 40 | 20 | 8 |
| EDU | 80 | 40 | 16 |

## Skills

| Skill | Base | Regular | Half | Fifth |
|---|---|---|---|---|
| Spot Hidden | 25 | 62 | 31 | 12 |
| Zither Playing | 05 | 41 | 20 | 8 |
`;

function quiet(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { Object.assign(console, saved); }
}

// One PC on the new settings file; `sheets` goes under player_site.sheets. Returns the PC page and the GM copy.
function buildOne(system, body, sheets = {}, { player = {}, buildOptions = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-lists-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Test Hero.md'),
    `---\ntype: pc\nplayer_name: Pat\nstatus: alive\n---\n\n${body}`);
  writeNewConfig(vault, {
    version: 1,
    vault: { system },
    player_site: { folder_map: { 'Characters/PCs': 'characters/pcs' }, ...(Object.keys(sheets).length ? { sheets } : {}), ...player },
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  quiet(() => build({ configPath, ...buildOptions }));
  return { root, html: fs.readFileSync(path.join(root, 'docs', 'characters', 'pcs', 'test-hero.html'), 'utf8') };
}

// The skill names a CoC sheet lists, in order.
const skillNames = (html) => [...html.matchAll(/<div class="skill(?: dev)?" data-skill="([^"]*)"/g)].map((m) => m[1]);
// A built page with its rules list taken out, to show nothing else on it moved.
const withoutRef = (html) => html.replace(/<details class="rules-ref">[\s\S]*?<\/details>/, '');

test('GURPS: left out, the Combat tab carries the rules reference, as before', () => {
  const { html } = buildOne('gurps-4e', RONNIE);
  assert.ok(html.includes('<details class="rules-ref">'));
  assert.ok(html.includes('Hit Location'));
});

test('GURPS: gurps_reference_tables off leaves no reference block, and the rest of the page is the same', () => {
  const on = buildOne('gurps-4e', RONNIE).html;
  const off = buildOne('gurps-4e', RONNIE, { gurps_reference_tables: false }).html;
  assert.ok(!off.includes('rules-ref'));
  assert.ok(!off.includes('Size &amp; Speed/Range') && !off.includes('Size & Speed/Range'));
  assert.ok(off.includes('id="tab-combat"'), 'the Combat tab is still there');
  assert.ok(off.includes('id="tohit-calc"'), 'the to-hit calculator is its own setting');
  assert.equal(off, withoutRef(on));
});

test('GURPS: turned on explicitly, the page is the one a vault that sets nothing gets', () => {
  assert.equal(buildOne('gurps-4e', RONNIE, { gurps_reference_tables: true }).html, buildOne('gurps-4e', RONNIE).html);
});

for (const system of ['coc-7e', 'coc-7e-regency']) {
  test(`${system}: left out, the note's skills are laid over the built-in list`, () => {
    const names = skillNames(buildOne(system, INVESTIGATOR).html);
    assert.ok(names.includes('Spot Hidden') && names.includes('Zither Playing'));
    assert.ok(names.includes('Library Use') && names.includes('Accounting'), 'the built-in list is merged');
    assert.ok(names.length > 30);
  });

  test(`${system}: coc_skill_list off lists only the note's skills, with the values written there`, () => {
    const { html } = buildOne(system, INVESTIGATOR, { coc_skill_list: false });
    assert.deepEqual(skillNames(html), ['Spot Hidden', 'Zither Playing']);
    const row = (name) => (html.match(new RegExp(`<div class="skill(?: dev)?" data-skill="${name}"[\\s\\S]*?</div>`)) || [''])[0];
    assert.match(row('Spot Hidden'), />62</);
    assert.match(row('Zither Playing'), />41</);
    assert.ok(!html.includes('all skills shown'), 'the hint does not claim the whole list is shown');
  });
}

test('CoC: the characteristics and the rest of the sheet do not change with the skill list off', () => {
  const on = buildOne('coc-7e', INVESTIGATOR).html;
  const off = buildOne('coc-7e', INVESTIGATOR, { coc_skill_list: false }).html;
  const chars = (html) => (html.match(/<div class="char-list">[\s\S]*?<h2/) || [''])[0];
  assert.ok(chars(on).length > 0);
  assert.equal(chars(off), chars(on));
});

test('the GM site follows the player site unless it sets its own', () => {
  const files = { 'Characters/PCs/Test Hero.md': `---\ntype: pc\nplayer_name: Pat\nstatus: alive\n---\n\n${RONNIE}` };
  const follows = buildBoth(files, { vault: { system: 'gurps-4e' }, player: { sheets: { gurps_reference_tables: false } } });
  const own = buildBoth(files, { vault: { system: 'gurps-4e' }, player: { sheets: { gurps_reference_tables: false } }, gm: { sheets: { gurps_reference_tables: true } } });
  try {
    assert.ok(!follows.gm.read('characters', 'pcs', 'test-hero.html').includes('rules-ref'));
    assert.ok(!own.player.read('characters', 'pcs', 'test-hero.html').includes('rules-ref'));
    assert.ok(own.gm.read('characters', 'pcs', 'test-hero.html').includes('rules-ref'));
  } finally { follows.cleanup(); own.cleanup(); }
});

// The live sheet's scripts read the skill rows and the Combat tab: with either list off, a page raises no error.
test('in a browser, a live CoC sheet without the skill list and a GURPS sheet without the reference raise no error', { skip: browserSkip() }, () => {
  const live = { player: { features: { live_stats: true } }, buildOptions: { assumeKv: true } };
  const coc = buildOne('coc-7e-regency', INVESTIGATOR, { coc_skill_list: false }, live);
  const gurps = buildOne('gurps-4e', RONNIE, { gurps_reference_tables: false }, live);
  for (const [root, want] of [[coc.root, 2], [gurps.root, 0]]) {
    const r = measure(path.join(root, 'docs', 'characters', 'pcs', 'test-hero.html'), 1200, function (done) {
      setTimeout(function () { done({ skills: document.querySelectorAll('.skill[data-skill]').length }); }, 300);
    });
    assert.deepEqual(r.errors || [], []);
    assert.equal(r.skills, want);
  }
});

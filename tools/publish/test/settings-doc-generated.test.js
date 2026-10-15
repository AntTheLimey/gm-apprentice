'use strict';
// docs/site-settings.md is the GM's list of every setting. Its tables are written from the
// one declared list (lib/settings/registry.js) by scripts/gen-settings-doc.js; this keeps
// the page current and checks it names what the tool reads, and nothing it does not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../scripts/gen-settings-doc');
const { REGISTRY, GROUPS } = require('../lib/settings/registry');
const { isLeaf } = require('../lib/settings/describe');
const { DEPLOY_KEYS } = require('../lib/settings/legacy');

const DOC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'site-settings.md'), 'utf8').replace(/\r\n/g, '\n');
// A twin under gm_site is described once, in the GM site section, not row by row.
const leaves = REGISTRY.filter((e) => isLeaf(e, REGISTRY) && !e.twinOf).map((e) => e.name);

test('the settings tables match the list', () => {
  assert.equal(render(DOC), DOC, 'docs/site-settings.md is out of date: run `node tools/publish/scripts/gen-settings-doc.js --write`');
});

test('the generator changes nothing on a second run', () => {
  const once = render(DOC);
  assert.equal(render(once), once);
});

test('every group of the list has a table on the page, and every marker pair is closed', () => {
  for (const g of GROUPS) {
    assert.ok(DOC.includes(`<!-- settings:${g.id} -->`), `no table for ${g.id}`);
    assert.ok(DOC.includes(`<!-- /settings:${g.id} -->`), `${g.id} is never closed`);
  }
  assert.equal((DOC.match(/<!-- settings:/g) || []).length, (DOC.match(/<!-- \/settings:/g) || []).length);
});

test('the page names every setting the tool reads', () => {
  const missing = leaves.filter((n) => !DOC.includes(`\`${n}\``));
  assert.deepEqual(missing, [], `docs/site-settings.md has no row for ${missing[0]}`);
  assert.ok(leaves.length >= 40, `only ${leaves.length} settings found; the list has stopped being read`);
});

test('the page names no setting the tool does not read', () => {
  // The page's words still use the names the settings had before; each is the list's own `was`.
  const known = new Set(REGISTRY.filter((e) => !e.retired && !e.state).flatMap((e) => [e.name, ...(e.was || []).map((w) => w.name)]));
  const named = new Set([...DOC.matchAll(/`((?:publish|vault|player_site|gm_site)\.[a-z][a-z_0-9.]*)`/g)].map((m) => m[1]).filter((n) => !n.startsWith('vault.config.json')));
  const stale = [...named].filter((n) => !known.has(n));
  assert.deepEqual(stale, [], `docs/site-settings.md names ${stale[0]}, which the tool does not read`);
});

test('no retired or bookkeeping setting has a row', () => {
  for (const e of REGISTRY.filter((x) => x.retired || x.state || x.container)) {
    assert.ok(!DOC.includes(`| \`${e.name}\` |`), `${e.name} has a row`);
  }
});

test('the site-file section names exactly the keys the site file still holds', () => {
  const section = DOC.match(/^## The site file[^\n]*\n([\s\S]*?)(?=^## )/m);
  assert.ok(section, 'the site-file section is missing');
  const named = [...section[1].matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(named, DEPLOY_KEYS);
});

test('the page lists, in one generated region, every setting that stops the build', () => {
  const region = DOC.match(/<!-- settings:hiding-list -->([\s\S]*?)<!-- \/settings:hiding-list -->/);
  assert.ok(region, 'the hiding-list region is missing');
  const listed = [...region[1].matchAll(/`(player_site\.[a-z_.]+)`/g)].map((m) => m[1]);
  const guards = REGISTRY.filter((e) => e.guards && isLeaf(e, REGISTRY)).map((e) => e.name);
  assert.deepEqual(listed, guards);
  assert.ok(guards.length >= 6);
});

test('the built-in character-page sections named for pc_prose_sections are the ones the tool keeps', () => {
  const { PC_PROSE_SECTIONS } = require('../lib/pc-prose');
  const text = REGISTRY.find((e) => e.name === 'player_site.sheets.prose_sections').left_out;
  for (const heading of PC_PROSE_SECTIONS) assert.ok(text.includes(heading), `${heading} is not named`);
});

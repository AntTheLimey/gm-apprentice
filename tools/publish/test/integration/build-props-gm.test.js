'use strict';
// The GM site shows every prop of every note it shows: uncut while gm_only_blocks is on, marked
// as the GM's copy, and with the reason when players do not see the page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../lib/build');
const { buildBoth } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');

const PROP = '---\ntype: prop\nprop_file: invitation.html\n---\nAn invitation to the ball.\n';
const PAGE = '<!doctype html><html><body><h1>You are invited</h1>\n<!-- gm-only --><div>KEEPER ONLY</div><!-- /gm-only -->\n<!-- note to self -->\n</body></html>';
const FILES = { 'Documents/Invitation.md': PROP, 'Documents/invitation.html': PAGE };
const LIST = (publishing) => listFileText({ publishing });
const quiet = (fn) => {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try { fn(); } finally { Object.assign(console, saved); }
};

describe('the GM site and props', () => {
  it('an unrevealed prop is on the GM site, marked', () => {
    const s = buildBoth({ ...FILES, 'Documents/Other.md': '---\ntype: document\n---\nOther.\n', '_meta/publish-list.yaml': LIST(['Documents/Other.md']) });
    try {
      const page = s.gm.read('props', 'invitation.html');
      assert.match(page, /GM copy: not for players/);
      assert.match(page, /Players don't see this page:/);
      assert.match(page, /KEEPER ONLY/);
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });

  it('a revealed prop on the GM site keeps its Keeper parts', () => {
    const s = buildBoth(FILES);
    try {
      const page = s.gm.read('props', 'invitation.html');
      assert.match(page, /KEEPER ONLY/);
      assert.match(page, /GM copy: not for players/);
      assert.doesNotMatch(page, /Players don't see this page:/);
      assert.doesNotMatch(s.player.read('props', 'invitation.html'), /KEEPER ONLY/);
    } finally { s.cleanup(); }
  });

  it('with gm_only_blocks off the GM copy is cut', () => {
    const s = buildBoth(FILES, { gm: { show: { gm_only_blocks: false } } });
    try {
      assert.doesNotMatch(s.gm.read('props', 'invitation.html'), /KEEPER ONLY/);
    } finally { s.cleanup(); }
  });

  it('the GM note page links its prop', () => {
    const s = buildBoth(FILES);
    try {
      assert.match(s.gm.read('documents', 'invitation.html'), /<a class="prop-btn" href="\.\.\/props\/invitation\.html">See the prop<\/a>/);
    } finally { s.cleanup(); }
  });

  it('a link left in the GM folder is cleared, not followed', () => {
    const s = buildBoth(FILES, { sites: ['gm'] });
    try {
      const outside = path.join(s.root, 'outside');
      fs.mkdirSync(outside);
      fs.rmSync(path.join(s.gm.dir, 'props'), { recursive: true });
      fs.symlinkSync(outside, path.join(s.gm.dir, 'props'));
      quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.ok(!fs.lstatSync(path.join(s.gm.dir, 'props')).isSymbolicLink());
      assert.match(s.gm.read('props', 'invitation.html'), /KEEPER ONLY/);
    } finally { s.cleanup(); }
  });

  it("a stub note's prop is on the GM site, not the player site", () => {
    const s = buildBoth({ ...FILES, 'Documents/Invitation.md': PROP.replace('---\nAn', 'publish: stub\n---\nAn') });
    try {
      assert.match(s.gm.read('props', 'invitation.html'), /KEEPER ONLY/);
      assert.deepEqual(s.player.files().map((f) => path.relative(s.player.dir, f).split(path.sep).join('/')).filter((f) => f.startsWith('props/')), ['props/index.html'], 'only the props page');
    } finally { s.cleanup(); }
  });

  it('a PDF prop is copied to the GM site as is', () => {
    const pdf = '%PDF-1.4\n<!-- gm-only -->not cut in a PDF<!-- /gm-only -->\n';
    const s = buildBoth({
      'Documents/Invitation.md': '---\ntype: prop\nprop_file: invitation.pdf\n---\nA letter.\n', 'Documents/invitation.pdf': pdf,
    });
    try {
      assert.equal(s.gm.read('props', 'invitation.pdf'), pdf);
      assert.match(s.gm.read('documents', 'invitation.html'), /href="\.\.\/props\/invitation\.pdf">See the prop/);
    } finally { s.cleanup(); }
  });
});

'use strict';
// The page writer never writes through a link in the site folder (#507): a kept folder that is a link
// (here, back into a folder outside the site) is not written through when the folder map also sends notes there.
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../lib/build');
const { buildBoth } = require('../helpers/gm-build');

const quiet = (fn) => {
  const saved = { log: console.log, warn: console.warn };
  const lines = [];
  console.log = (m) => lines.push(String(m)); console.warn = (m) => lines.push(String(m));
  try { fn(); } finally { Object.assign(console, saved); }
  return lines;
};

for (const sub of [false, true]) {
  const where = sub ? 'a linked folder inside a kept folder' : 'a kept folder that is a link';
  it(`${where}: a note's page is not written through it`, () => {
    const note = sub ? 'Gazetteer/Papers/Invitation.md' : 'Gazetteer/Invitation.md';
    const s = buildBoth({ [note]: '---\ntype: document\n---\nThe note page.\n', 'Other/Other.md': '---\ntype: document\n---\nOther.\n' },
      { sites: [], player: { keep: ['gazetteer'] } });
    try {
      const outside = path.join(s.root, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'invitation.html'), 'THE GM OWN PAGE');
      fs.mkdirSync(s.player.dir, { recursive: true });
      if (sub) {
        fs.mkdirSync(path.join(s.player.dir, 'gazetteer'));
        fs.symlinkSync(outside, path.join(s.player.dir, 'gazetteer', 'papers'));
      } else {
        fs.symlinkSync(outside, path.join(s.player.dir, 'gazetteer'));
      }
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(fs.readFileSync(path.join(outside, 'invitation.html'), 'utf8'), 'THE GM OWN PAGE');
      assert.deepEqual(fs.readdirSync(outside), ['invitation.html']);
      const out = sub ? 'gazetteer/papers/invitation.html' : 'gazetteer/invitation.html';
      assert.ok(lines.some((l) => l.includes(`WARNING: ${out} was not written: a folder on its path in the site folder is a link`)), lines.join('\n'));
      assert.ok(s.player.exists('other', 'other.html'), 'the other pages are still written');
    } finally { s.cleanup(); }
  });
}

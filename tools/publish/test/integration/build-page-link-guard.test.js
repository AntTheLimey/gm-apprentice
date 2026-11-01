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
      let thrown = null;
      const lines = quiet(() => { try { build({ configPath: s.configPath, site: 'player' }); } catch (e) { thrown = e; } });
      assert.ok(thrown && thrown.errorCount === 1, String(thrown));
      assert.equal(fs.readFileSync(path.join(outside, 'invitation.html'), 'utf8'), 'THE GM OWN PAGE');
      assert.deepEqual(fs.readdirSync(outside), ['invitation.html']);
      const out = sub ? 'gazetteer/papers/invitation.html' : 'gazetteer/invitation.html';
      assert.ok(lines.some((l) => l.includes(`WARNING: ${out} was not written: a folder on its path in the site folder is a link`)), lines.join('\n'));
      assert.ok(s.player.exists('other', 'other.html'), 'the other pages are still written');
    } finally { s.cleanup(); }
  });
}

// A refused page is a build error (the deploy is held), and no other part of the site names it: not the search
// index, not another page's link.
it('a page refused for a link is an error, and nothing on the site links or indexes it', () => {
  const s = buildBoth({
    'Gazetteer/Invitation.md': '---\ntype: document\n---\nThe note page.\n',
    'Other/Other.md': '---\ntype: document\n---\nSee [[Invitation]].\n',
  }, { sites: [], player: { keep: ['gazetteer'] } });
  try {
    const outside = path.join(s.root, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(s.player.dir, { recursive: true });
    fs.symlinkSync(outside, path.join(s.player.dir, 'gazetteer'));
    let thrown = null;
    const lines = quiet(() => { try { build({ configPath: s.configPath, site: 'player' }); } catch (e) { thrown = e; } });
    assert.ok(thrown && thrown.errorCount === 1, String(thrown));
    assert.ok(thrown.renderErrors.some((r) => r.startsWith('gazetteer/invitation.html: not written, a folder on its path in the site folder is a link')), JSON.stringify(thrown.renderErrors));
    assert.ok(lines.includes('Done with 1 error(s).'), lines.join('\n'));
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.doesNotMatch(s.player.read('search-index.json'), /"href":"gazetteer/);
    assert.doesNotMatch(s.player.read('other', 'other.html'), /href="[^"]*invitation\.html"/);
  } finally { s.cleanup(); }
});

// Every file the build writes goes through the same guard: a picture or a stylesheet is not written through a kept
// folder that is a link either, and each refusal is an error.
for (const [folder, files, wants] of [
  ['images', { 'Places/Inn.md': '---\ntype: location\n---\n![[inn.png]]\n', '_attachments/inn.png': 'PNGBYTES' }, 'inn.png'],
  ['css', { 'Places/Inn.md': '---\ntype: location\n---\nThe inn.\n' }, 'style.css'],
  ['fonts', { 'Places/Inn.md': '---\ntype: location\n---\nThe inn.\n', 'Assets/Fonts/hand.woff2': 'wOF2fake' }, 'hand.woff2'],
]) {
  it(`a kept ${folder}/ folder that is a link: nothing is written through it`, () => {
    const player = { keep: [folder] };
    if (folder === 'fonts') player.theme = { fonts: { source: 'local', heading: 'Hand', files: [{ path: 'Assets/Fonts/hand.woff2', family: 'Hand' }] } };
    const s = buildBoth(files, { sites: [], player });
    try {
      const outside = path.join(s.root, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      fs.mkdirSync(s.player.dir, { recursive: true });
      fs.symlinkSync(outside, path.join(s.player.dir, folder));
      let thrown = null;
      const lines = quiet(() => { try { build({ configPath: s.configPath, site: 'player' }); } catch (e) { thrown = e; } });
      const written = fs.readdirSync(outside, { recursive: true });
      assert.deepEqual(written, [], `written through the link: ${written.join(', ')}`);
      assert.ok(thrown && thrown.errorCount > 0, lines.join('\n'));
      assert.ok(lines.some((l) => l.includes(`was not written: a folder on its path in the site folder is a link`) && l.includes(wants)), lines.join('\n'));
    } finally { s.cleanup(); }
  });
}

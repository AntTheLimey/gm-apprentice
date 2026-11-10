const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('./helpers/build-vault');

// Every built file path under the output folder.
function paths(v) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else out.push(f);
    }
  })(path.join(v.root, 'docs'));
  return out;
}

// Every built file, whatever its type, as one text.
function everything(v) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else out.push(fs.readFileSync(f).toString('latin1'));
    }
  })(path.join(v.root, 'docs'));
  return out.join('\n');
}

const BODY = '# Image Guidance\n\n%OPEN%## Direction\n\nZZ-GUIDANCE-MARKER direction.\n\n## Always\n\nZZ-GUIDANCE-MARKER always.\n\n'
  + '## Blocks\n\n### Oil\n\nZZ-GUIDANCE-MARKER block.\n\n%CLOSE%';
const FRONT = '---\ntype: meta\npublish: false\ntags: [image-guidance]\n---\n';

for (const [name, wrapped] of [['with the gm-only wrapper', true], ['without the gm-only wrapper', false]]) {
  test(`the Image Guidance note is not published (${name})`, () => {
    const body = BODY.replace('%OPEN%', wrapped ? '<!-- gm-only -->\n\n' : '')
      .replace('%CLOSE%', wrapped ? '<!-- /gm-only -->\n' : '');
    const v = buildVault({
      '_Campaign/Image_Guidance.md': FRONT + body,
      'People/Jon.md': '---\ntype: npc\n---\nA clerk.\n',
    });
    try {
      const all = everything(v);
      assert.ok(all.includes('A clerk.'), 'the build produced the other page');
      assert.ok(!all.includes('ZZ-GUIDANCE-MARKER'), 'the guidance text is published');
      assert.ok(!all.includes('Image Guidance'), 'the note title is published');
      assert.ok(!all.includes('image-guidance'), 'the note tag or page is published');
      assert.deepStrictEqual(paths(v).filter((f) => /image-guidance/i.test(f)), [], 'the note has a page');
    } finally { v.cleanup(); }
  });
}

// The publish tool itself never publishes the note vault.images.guidance names, whatever its frontmatter says: a GM
// who writes it by hand may leave out `publish: false` and the gm-only wrapper.
const BARE = '---\ntype: meta\ntags: [image-guidance]\n---\n' + BODY.replace('%OPEN%', '').replace('%CLOSE%', '');

// A link to the note prints its words as plain text: the note is never a link target.
function assertHidden(v) {
  const jon = v.read('people', 'jon.html');
  assert.ok(jon.includes('the style notes') && !/<a [^>]*>\s*the style notes/.test(jon), 'the link to the note is a link');
  const all = everything(v);
  assert.ok(all.includes('A clerk.'), 'the build produced the other page');
  assert.ok(!all.includes('ZZ-GUIDANCE-MARKER'), 'the guidance text is published');
  assert.ok(!all.includes('Image Guidance'), 'the note title is published');
  assert.ok(!all.includes('image-guidance'), 'the note tag or page is published');
  assert.deepStrictEqual(paths(v).filter((f) => /image.guidance/i.test(f)), [], 'the note has a page');
}

test('the Image Guidance note with no publish: false and no wrapper is not published', () => {
  const v = buildVault({
    '_Campaign/Image_Guidance.md': BARE,
    'People/Jon.md': '---\ntype: npc\n---\nA clerk. See [[Image_Guidance|the style notes]].\n',
  });
  try { assertHidden(v); } finally { v.cleanup(); }
});

test('the Image Guidance note at the path the setting names is not published', () => {
  const v = buildVault({
    'Style/Look Book.md': BARE.replace('# Image Guidance', '# Image Guidance for pictures'),
    'People/Jon.md': '---\ntype: npc\n---\nA clerk. See [[Look Book|the style notes]].\n',
  }, { settings: { 'vault.images.guidance': 'Style/Look Book.md' } });
  try {
    assertHidden(v);
    assert.ok(!everything(v).includes('Look Book'), 'the note name is published');
  } finally { v.cleanup(); }
});

test('the setting names one note: another note with the same file name still publishes', () => {
  const v = buildVault({
    '_Campaign/Image_Guidance.md': BARE,
    'Handouts/Image_Guidance.md': '---\ntype: item\n---\nZZ-HANDOUT-MARKER, a painter\'s notebook.\n',
    'People/Jon.md': '---\ntype: npc\n---\nA clerk.\n',
  });
  try {
    const all = everything(v);
    assert.ok(all.includes('ZZ-HANDOUT-MARKER'), 'the other note was hidden too');
    assert.ok(!all.includes('ZZ-GUIDANCE-MARKER'), 'the guidance text is published');
  } finally { v.cleanup(); }
});

test('the Image Guidance note is never published, needs no decision, and explain says why', () => {
  const { decidePage } = require('../lib/publish-decision');
  const fm = { type: 'meta' };
  const manifest = { publishing: ['_Campaign/Image_Guidance.md'], excluded: [], needsDecision: ['Style/G.md'] };
  const cases = [
    ['_Campaign/Image_Guidance.md', {}, null],
    ['_Campaign/Image_Guidance.md', {}, manifest],                         // listed for publishing: still never
    ['_campaign/image_guidance.md', {}, null],                             // case, as the disk reads it
    ['Style/G.md', { imageGuidance: 'Style/G.md' }, manifest],             // the setting's own path
    ['Style/G.md', { imageGuidance: './Style\\G.md' }, null],
    ['Style/G.md', { imageGuidance: '  Style/G.md  ' }, null],             // spaces round the setting
    ['Style/G.md', { imageGuidance: ' ./Style\\G.md ' }, manifest],
  ];
  for (const [rel, extra, list] of cases) {
    const publishConfig = Object.defineProperty({}, 'imageGuidance', { value: extra.imageGuidance, enumerable: false });
    for (const front of [fm, null, { type: 'meta', publish: true }]) {
      const v = decidePage({ frontmatter: front, outputPath: 'x.html' }, { rel, publishConfig: extra.imageGuidance ? publishConfig : {}, manifest: list });
      assert.deepStrictEqual([v.bucket, v.code, v.reason], ['exclude', 'IMAGE_GUIDANCE', 'the Image Guidance note is never published'], rel);
    }
  }
  // With the setting moved, the default path is an ordinary note again.
  const moved = Object.defineProperty({}, 'imageGuidance', { value: 'Style/G.md', enumerable: false });
  const v = decidePage({ frontmatter: fm, outputPath: 'x.html' }, { rel: '_Campaign/Image_Guidance.md', publishConfig: moved, manifest: null });
  assert.strictEqual(v.code, 'OK');
});

test('explain says the Image Guidance note is never published', async () => {
  const os = require('os');
  const { runExplain } = require('../lib/explain-cli');
  const { writeSettings, writeSiteConfig } = require('./helpers/vault-files');
  const { writePublishList } = require('./helpers/publish-list');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-explain-'));
  try {
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, '_Campaign'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_Campaign', 'Image_Guidance.md'), BARE);
    writeSettings(vault, { 'player_site.title': 'T', 'player_site.folder_map': { _Campaign: '_campaign' } });
    writePublishList(vault, { publishing: [], excluded: [], needsDecision: [] });
    const configPath = path.join(root, 'vault.config.json');
    writeSiteConfig(configPath, { vaultPath: vault, outputDir: './docs' }, 2);
    const out = [];
    const rc = await runExplain({ configPath, target: '_Campaign/Image_Guidance.md' }, { out: (l) => out.push(String(l)) });
    assert.strictEqual(rc, 0);
    assert.match(out.join('\n'), /VERDICT: does not publish — the Image Guidance note is never published \(IMAGE_GUIDANCE\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a guidance path written with spaces round it still names the note', () => {
  const v = buildVault({
    'Style/Look Book.md': BARE,
    'People/Jon.md': '---\ntype: npc\n---\nA clerk. See [[Look Book|the style notes]].\n',
  }, { settings: { 'vault.images.guidance': '  Style/Look Book.md  ' } });
  try { assertHidden(v); } finally { v.cleanup(); }
});

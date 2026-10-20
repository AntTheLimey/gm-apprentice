const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanAllNotes, scanVaultReport, scanAttachments, pairStoryFiles } = require('../../lib/scanner');
const { findConventionBanner, resolveBanner } = require('../../lib/banners');

// #424: a vault on a share that drops part-way through must fail the scan, not publish fewer
// pages. Every disk read goes through `deps` ({ readFile, readdir, exists }), so a tool that
// predicts a build can hand in its own reader.
const eio = () => Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });

// A small in-memory vault: { 'People/Vex.md': text }. Returns a deps object.
function memory(files) {
  const dirs = new Set(['']);
  for (const rel of Object.keys(files)) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const relOf = (p) => path.relative('/v', p).split(path.sep).join('/');
  return {
    readFile: (p) => {
      const rel = relOf(p);
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[rel];
    },
    readdir: (p) => {
      const rel = relOf(p);
      const kids = new Map();
      for (const f of Object.keys(files)) {
        if (rel !== '' && !f.startsWith(rel + '/')) continue;
        const rest = rel === '' ? f : f.slice(rel.length + 1);
        const [name, ...more] = rest.split('/');
        kids.set(name, more.length > 0);
      }
      return [...kids].map(([name, isDir]) => ({ name, isDirectory: () => isDir, isFile: () => !isDir }));
    },
    exists: (p) => relOf(p) in files || dirs.has(relOf(p)),
  };
}

const NPC = '---\ntype: npc\n---\n\nBody.\n';

describe('the scanners read through deps, and a read error stops the scan (#424)', () => {
  it('scanVaultReport reads a vault that exists only behind the reader', () => {
    const deps = memory({ 'People/Vex.md': NPC });
    const report = scanVaultReport({ vaultPath: '/v', excludeDirs: [], folderMap: { People: 'npcs' } }, { deps });
    assert.deepStrictEqual(report.pages.map((p) => p.outputPath), ['npcs/vex.html']);
  });

  it('scanVaultReport throws when a note cannot be read', () => {
    const deps = { ...memory({ 'People/Vex.md': NPC }), readFile: () => { throw eio(); } };
    assert.throws(() => scanVaultReport({ vaultPath: '/v', excludeDirs: [], folderMap: { People: 'npcs' } }, { deps }), /EIO/);
  });

  it('scanAllNotes lists the notes behind the reader', () => {
    const notes = scanAllNotes('/v', memory({ 'People/Vex.md': NPC, 'Top.md': NPC }));
    assert.deepStrictEqual(notes.map((n) => n.vaultPath).sort(), ['People/Vex', 'Top']);
  });

  it('scanAllNotes throws, naming the folder, when a folder cannot be listed', () => {
    const base = memory({ 'People/Vex.md': NPC });
    const deps = { ...base, readdir: (p) => { if (p.endsWith('People')) throw eio(); return base.readdir(p); } };
    assert.throws(() => scanAllNotes('/v', deps), (e) => /could not read/.test(e.message) && /People/.test(e.message) && e.code === 'EIO');
  });

  it('scanAllNotes throws, naming the note, when a note cannot be read', () => {
    const base = memory({ 'People/Vex.md': NPC });
    const deps = { ...base, readFile: () => { throw eio(); } };
    assert.throws(() => scanAllNotes('/v', deps), (e) => /could not read/.test(e.message) && /Vex\.md/.test(e.message) && e.code === 'EIO');
  });

  it('scanAllNotes still lists a note whose frontmatter cannot be parsed', () => {
    const notes = scanAllNotes('/v', memory({ 'Bad.md': '---\ngm_aliases: [unclosed\n---\n\nx\n' }));
    assert.deepStrictEqual(notes.map((n) => n.vaultPath), ['Bad']);
  });

  it('scanAttachments lists images behind the reader and throws on a folder it cannot list', () => {
    const files = { '_attachments/a.png': 'x', '_attachments/sub/b.png': 'x' };
    const map = scanAttachments({ vaultPath: '/v', attachmentsDir: '_attachments', excludeDirs: [] }, memory(files));
    assert.deepStrictEqual(Object.keys(map).sort(), ['a.png', 'b.png']);
    const base = memory(files);
    const deps = { ...base, readdir: (p) => { if (p.endsWith('sub')) throw eio(); return base.readdir(p); } };
    assert.throws(() => scanAttachments({ vaultPath: '/v', attachmentsDir: '_attachments', excludeDirs: [] }, deps), /EIO/);
  });

  it('pairStoryFiles throws on a story file it cannot read, but only warns on one it cannot parse', () => {
    const pc = { sourcePath: '/v/PCs/Ro.md', frontmatter: { type: 'pc' } };
    const ok = memory({ 'PCs/Ro_Story.md': '---\ntype: character-story\n---\n\nTale.\n' });
    pairStoryFiles([pc], '/v', ok);
    assert.strictEqual(pc.storyMarkdown.trim(), 'Tale.');

    const dropped = { ...ok, readFile: () => { throw eio(); } };
    assert.throws(() => pairStoryFiles([{ sourcePath: '/v/PCs/Ro.md', frontmatter: { type: 'pc' } }], '/v', dropped), /could not read/);

    const bad = memory({ 'PCs/Ro_Story.md': '---\ntype: [unclosed\n---\n\nx\n' });
    const warned = [];
    const real = console.warn;
    console.warn = (m) => warned.push(String(m));
    try { pairStoryFiles([{ sourcePath: '/v/PCs/Ro.md', frontmatter: { type: 'pc' } }], '/v', bad); } finally { console.warn = real; }
    assert.ok(warned.some((m) => /malformed frontmatter/.test(m)));
  });

  it('the banner lookup asks the reader, and a read error is not "no banner"', () => {
    const present = { exists: (p) => p === path.join('/v', 'Places/_banner.png') };
    assert.strictEqual(findConventionBanner('/v', 'Places', present), 'Places/_banner.png');
    assert.strictEqual(findConventionBanner('/v', 'Places', { exists: () => false }), null);
    assert.throws(() => findConventionBanner('/v', 'Places', { exists: () => { throw eio(); } }), /EIO/);
    const entry = resolveBanner('places', { vaultPath: '/v', folderMap: { Places: 'places' }, banners: {}, deps: present });
    assert.strictEqual(entry.image, 'Places/_banner.png');
  });

  it('the real reader treats a missing file as absent and any other error as an error', () => {
    const { readerFrom } = require('../../lib/vault-reader');
    const real = readerFrom();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
    try {
      assert.strictEqual(real.exists(path.join(dir, 'nope.md')), false);
      fs.writeFileSync(path.join(dir, 'a.md'), 'x');
      assert.strictEqual(real.exists(path.join(dir, 'a.md')), true);
      assert.strictEqual(real.exists(path.join(dir, 'a.md', 'inside')), false);   // ENOTDIR
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

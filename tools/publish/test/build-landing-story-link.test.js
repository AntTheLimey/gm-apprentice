'use strict';
// #541: the landing page's "Read full session" goes to the session's Story page when it has one; without one, to
// its wrap-up (then the session note), as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeSiteConfig } = require('./helpers/vault-files');

const CHAPTER = '---\ntype: chapter\ntitle: Chapter 1 — Docks\nsort_order: 1\n---\n\n## Overview\n\nThe docks.\n';
const SESSION = (chapter) => `---\ntype: session\n${chapter ? 'chapter: "[[Chapter 1 Overview]]"\n' : ''}`
  + 'session_number: 1\nstatus: played\nplay_date: "2026-10-01"\ndocuments:\n  wrap_up: "[[Session 1 Wrap-Up]]"\n---\n\n# Session 1\n';
const WRAP = '---\ntype: session_wrap\nsession: "[[Session 1]]"\nsession_number: 1\n---\n\n'
  + '# Session 1 — Wrap-Up\n\n## Narrative Recap\n\nThe party reached the docks.\n';

function site(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-story-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const docs = path.join(root, 'docs');
  const configPath = path.join(root, 'config.json');
  writeSiteConfig(configPath, {
    vaultPath: vault, outputDir: docs, siteTitle: 'Landing Story', excludeSections: ['GM Notes'],
    folderMap: { Chapters: 'chapters', Sessions: 'sessions' },
  });
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { build({ configPath }); } finally { Object.assign(console, saved); }
  return {
    root,
    read: (rel) => fs.readFileSync(path.join(docs, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(docs, rel)),
  };
}

const recapLink = (html) => (html.match(/<a class="recap-link" href="([^"]+)"/) || [])[1];

test('a session with a Story page: Read full session goes to the Story page', (t) => {
  const s = site({
    'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER,
    'Chapters/Chapter 1/Sessions/Session 1/Session 1.md': SESSION(true),
    'Chapters/Chapter 1/Sessions/Session 1/Session 1 Wrap-Up.md': WRAP,
  });
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  const href = recapLink(s.read('index.html'));
  assert.match(href || '', /^story\/[^/]+\.html$/);
  assert.ok(s.exists(href), `${href} is a page the build wrote`);
  assert.match(s.read(href), /The party reached the docks/);
});

test('a session with no Story page: Read full session goes to the wrap-up, as before', (t) => {
  const s = site({
    'Sessions/Session 1/Session 1.md': SESSION(false),
    'Sessions/Session 1/Session 1 Wrap-Up.md': WRAP,
  });
  t.after(() => fs.rmSync(s.root, { recursive: true, force: true }));
  assert.equal(s.exists('story.html'), false, 'no Story section in this vault');
  const href = recapLink(s.read('index.html'));
  assert.match(href || '', /wrap-up\.html$/);
  assert.ok(s.exists(decodeURI(href)), `${href} is a page the build wrote`);
});

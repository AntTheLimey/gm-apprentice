'use strict';
// A paused scene's snapshot opens with the line scene-paused writes under `## Paused`: `After [[Session]].` Scenes
// never publish, but when that session does the line says nothing but its title, which the site prints wherever it
// links the session: no finding (#765). The snapshot under it is still hidden, and so is the line when the session is
// not on the site.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const SCENE = '---\ntype: scene\nstatus: paused\n---\n\n## Paused\n\nAfter [[Session 01 - The Climb]].\n\n'
  + '- **Where they stopped:** at the crypt door, the lamp still lit.\n<!-- /paused -->\n\n'
  + '**Situation:** The abbot waits below with the ledger.\n';
const NOTES = {
  'Sessions/Session 01 - The Climb.md': '---\ntype: session\nsession_number: 1\nstatus: reviewed\n---\n\nThey climbed to the pass.\n',
  'Scenes/What Sleeps Below.md': SCENE,
};
const SETTINGS = { player: { folder_map: { Sessions: 'sessions', Scenes: 'scenes' } } };
const PAGE = 'sessions/session-01-the-climb.html';

describe('leak gate: a paused scene\'s After line (#765)', () => {
  it('the After line naming a published session is no finding', () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      leakInto(site.outputDir, PAGE, 'After Session 01 - The Climb.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
    } finally { site.cleanup(); }
  });

  it('the snapshot under it is still hidden', () => {
    const site = leakSite(NOTES, SETTINGS);
    try {
      leakInto(site.outputDir, PAGE, 'Where they stopped: at the crypt door, the lamp still lit.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.equal(r.findings[0].note, 'Scenes/What Sleeps Below.md');
    } finally { site.cleanup(); }
  });

  it('an After line naming a session that is not on the site is still hidden', () => {
    const notes = { ...NOTES, 'Scenes/What Sleeps Below.md': SCENE.replace('Session 01 - The Climb', 'Session 09 - Unwritten') };
    const site = leakSite(notes, SETTINGS);
    try {
      leakInto(site.outputDir, PAGE, 'After Session 09 - Unwritten.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.equal(r.findings[0].note, 'Scenes/What Sleeps Below.md');
    } finally { site.cleanup(); }
  });

  it('an After line whose link carries a label is still hidden', () => {
    // scene-paused writes a bare link; a label is the GM's own words, which the site never printed.
    const notes = { ...NOTES, 'Scenes/What Sleeps Below.md': SCENE.replace('[[Session 01 - The Climb]]', '[[Session 01 - The Climb|the night Tam died]]') };
    const site = leakSite(notes, SETTINGS);
    try {
      leakInto(site.outputDir, PAGE, 'After the night Tam died.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.equal(r.findings[0].note, 'Scenes/What Sleeps Below.md');
    } finally { site.cleanup(); }
  });

  it('the same words anywhere else in a scene are still hidden', () => {
    const notes = { ...NOTES, 'Scenes/What Sleeps Below.md': SCENE.replace('**Situation:**', 'After [[Session 01 - The Climb]].\n\n**Situation:**') };
    const site = leakSite(notes, SETTINGS);
    try {
      // Only the line under `## Paused` is the tool's; the GM's own copy of it is the GM's text.
      leakInto(site.outputDir, PAGE, 'After Session 01 - The Climb.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
    } finally { site.cleanup(); }
  });
});

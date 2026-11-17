'use strict';
// A session page, and its preview, print the session's in-game date once a Wrap-Up replaces its hub body. The
// Wrap-Up's GM-only World State opens with the same date, so the gate must count it as visible (#704) — and must
// not when the GM hides the field from players.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

const NOTES = {
  'Sessions/Session 01 - The Climb.md': '---\ntype: session\nsession_number: 1\nstatus: reviewed\n'
    + 'in_game_date: "Day 2, morning"\ndocuments:\n  wrap_up: "[[Chapter_01_Session_01_Wrap_Up]]"\n---\n\nPrep notes.\n',
  'Sessions/Chapter_01_Session_01_Wrap_Up.md': '---\ntype: session_wrap\nsession: "[[Session 01 - The Climb]]"\n'
    + 'session_number: 1\ncanon_status: AUTHORITATIVE\n---\n\n## Narrative Recap\n\nThey climbed to the pass.\n\n'
    + '<!-- gm-only -->\n## GM Notes\n\n### World State\n\n- **In-game date:** Day 2, morning.\n'
    + '- **The abbot knows about the lamp.**\n<!-- /gm-only -->\n',
};

describe('leak gate: a session\'s in-game date (#704)', () => {
  it('the date the session page and its preview print is no finding', () => {
    const site = leakSite(NOTES, { player: { folder_map: { Sessions: 'sessions' } } });
    try {
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
    } finally { site.cleanup(); }
  });

  it('the rest of the World State is still hidden', () => {
    const site = leakSite(NOTES, { player: { folder_map: { Sessions: 'sessions' } } });
    try {
      leakInto(site.outputDir, 'sessions/session-01-the-climb.html', 'The abbot knows about the lamp.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
    } finally { site.cleanup(); }
  });

  it('with in_game_date hidden from players, the date is still a secret', () => {
    const site = leakSite(NOTES, { player: { folder_map: { Sessions: 'sessions' }, hide: { fields: ['in_game_date'] } } });
    try {
      leakInto(site.outputDir, 'sessions/session-01-the-climb.html', 'In-game date: Day 2, morning.');
      const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.equal(r.findings[0].code, 'HIDDEN_TEXT');
    } finally { site.cleanup(); }
  });
});

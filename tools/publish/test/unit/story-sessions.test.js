'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sessionLines } = require('../../lib/story-sessions');

describe('sessionLines', () => {
  it('sessionLines reads the italic line', () => {
    const html = '<h2>Session 1 — The Road</h2><p><em>Ilse leaves the archive.</em></p><p>Long prose here. More.</p>'
      + '<h2>Session 2 — The Gate</h2><p><em>She is turned away.</em></p><p>Prose.</p>';
    assert.deepEqual(sessionLines(html), [
      { n: '1', title: 'The Road', line: 'Ilse leaves the archive.', href: '#session-1' },
      { n: '2', title: 'The Gate', line: 'She is turned away.', href: '#session-2' },
    ]);
  });

  it('sessionLines falls back to the first sentence', () => {
    const html = '<h2>Session 1 — The Road</h2><p>Mr. Hale met <em>Ilse</em> at dawn. They walked on.</p>'
      + '<h2>Session 2 — Gate</h2><p><em>One</em> and <em>two</em> are not a summary line. Next.</p>';
    const lines = sessionLines(html);
    assert.equal(lines[0].line, 'Mr. Hale met Ilse at dawn.');
    assert.equal(lines[1].line, 'One and two are not a summary line.');
  });

  it('session lines tolerate odd stories', () => {
    assert.deepEqual(sessionLines(''), []);
    assert.deepEqual(sessionLines('<p>No sessions here.</p>'), []);
    assert.deepEqual(sessionLines(undefined), []);
    // One session: listed, no anchor to link to.
    assert.deepEqual(sessionLines('<h2>Session 1 — Only</h2><p>It began.</p>'),
      [{ n: '1', title: 'Only', line: 'It began.', href: '' }]);
    // Colon and em dash; a heading with a link keeps its label, drops the markup.
    const html = '<h3>Session 3: Title</h3><p>Three.</p><h3>Session 4 — <a href="x.html">Dun &amp; Co</a></h3><p>Four.</p>';
    const lines = sessionLines(html);
    assert.deepEqual(lines.map(l => [l.n, l.title, l.href]), [['3', 'Title', '#session-3'], ['4', 'Dun & Co', '#session-4']]);
    // An entry with no paragraph has an empty line.
    assert.equal(sessionLines('<h2>Session 1 — A</h2><h2>Session 2 — B</h2><p>x.</p>')[0].line, '');
  });
});

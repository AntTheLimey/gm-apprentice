// tools/publish/test/unit/coc-layout.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseCoC } = require('../../lib/templates/coc/parse');
const { buildStatusBar, buildSheet } = require('../../lib/templates/coc/layout');

// Minimal model via the parser (reuse Task 2's section shapes inline)
const stat = { title:'Stat Sheet', id:'stat-sheet', html:`
  <h3>Derived</h3><table><tr><th>Attribute</th><th>Max</th><th>Current</th></tr>
  <tr><td>HP</td><td>3</td><td>3</td></tr><tr><td>MP</td><td>2</td><td>2</td></tr>
  <tr><td>Luck</td><td>—</td><td>80 (starting 55)</td></tr>
  <tr><td>Sanity</td><td>92</td><td>35 (starting 60)</td></tr></table>
  <h3>Status</h3><ul><li>[x] Indefinite Insanity</li><li>[ ] Dying</li></ul>` };
const model = parseCoC({}, [stat], 'regency-cthulhu');

describe('buildStatusBar', () => {
  const html = buildStatusBar(model);
  it('renders pip tracks with the right filled count for HP', () => {
    const hp = html.match(/data-track="hp"[\s\S]*?<\/div>/)[0];
    assert.equal((hp.match(/pip on/g) || []).length, 3);
  });
  it('renders ± steppers for sanity/luck/reputation', () => {
    assert.ok(html.includes('data-san'));
    assert.ok(html.includes('class="step up"') || html.includes('step up'));
  });
  it('marks the active condition chip', () => {
    assert.match(html, /cond-chip on[^>]*>\s*Indefinite Insanity/i);
  });
});

describe('buildSheet', () => {
  it('renders an experience box and reg/half/fifth per skill', () => {
    const html = buildSheet(model);
    assert.ok(html.includes('class="exp"'), 'experience box present');
    assert.ok(html.includes('class="reg"'));
    assert.ok(html.includes('coc-sheet-root'));
  });
});

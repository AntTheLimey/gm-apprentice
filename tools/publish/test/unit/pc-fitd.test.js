const { describe, it } = require('node:test');
const assert = require('node:assert');
const { templateBody, setRow, replace, sectionsOf, cutterBody } = require('../helpers/pc-template');
const { renderFitDSheet, isFitDConsumedTitle } = require('../../lib/templates/pc-fitd');
const { pcTemplate } = require('../../lib/templates/pc');

const blank = () => templateBody('pc-fitd.md');


const render = (body, fm = { type: 'pc' }) => renderFitDSheet(fm, sectionsOf(body));
const dotsFor = (html, action) => {
  const row = html.match(new RegExp(`<div class="fitd-action-row">((?:(?!</div>)[\\s\\S])*)<span>${action}</span></div>`));
  return row ? (row[1].match(/fitd-dot filled/g) || []).length : null;
};

describe('renderFitDSheet from the real template body', () => {
  it('renders a sheet for the untouched template', () => {
    const html = render(blank());
    assert.ok(html.includes('fitd-action-ratings'));
    assert.ok(!html.includes('{'), 'no template placeholder reaches the sheet');
  });

  it('labels each identity field: playbook, heritage, background, look, vice', () => {
    const body = replace(cutterBody(), '**Look:** {Physical description}', '**Look:** Scarred, heavy coat');
    const identity = render(body).match(/<dl class="fitd-identity">[\s\S]*?<\/dl>/)[0];
    const fields = [...identity.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map(m => [m[1], m[2]]);
    assert.deepStrictEqual(fields, [
      ['Playbook', 'Cutter'],
      ['Heritage', 'Marrow Coast'],
      ['Background', 'Labor'],
      ['Look', 'Scarred, heavy coat'],
      ['Vice/Purveyor', 'Obligation — the old crew'],
    ]);
  });

  it('reads an identity label with an ampersand in it', () => {
    const body = replace(cutterBody(), '**Vice/Purveyor:**', '**Vice & Purveyor:**');
    assert.ok(render(body).includes('<dt>Vice &amp; Purveyor</dt><dd>Obligation — the old crew</dd>'));
  });

  it('keeps a bracketed aside inside one trauma', () => {
    const html = render(setRow(cutterBody(), 'Trauma', ['Cold (since the fire, mostly); Haunted']));
    assert.ok(html.includes('>Cold (since the fire, mostly)<') && html.includes('>Haunted<'));
  });

  it('leaves an unfilled identity field out', () => {
    assert.ok(!render(cutterBody()).includes('<dt>Look</dt>'));
  });

  it('does not repeat the Playbook line under the header', () => {
    assert.strictEqual(render(cutterBody()).split('Cutter').length - 1, 1);
  });

  it('renders action ratings as dots, grouped by attribute', () => {
    const html = render(cutterBody());
    assert.strictEqual(dotsFor(html, 'Skirmish'), 3);
    assert.strictEqual(dotsFor(html, 'Wreck'), 1);
    assert.strictEqual(dotsFor(html, 'Command'), 2);
    assert.strictEqual(dotsFor(html, 'Hunt'), 0);
    assert.strictEqual((html.match(/class="fitd-action-row"/g) || []).length, 12);
    const groups = [...html.matchAll(/<div class="fitd-attribute"><h4>([^<]*)<\/h4>/g)].map(m => m[1]);
    assert.deepStrictEqual(groups, ['Insight', 'Prowess', 'Resolve']);
    const prowess = html.split('<h4>Prowess</h4>')[1].split('<h4>Resolve</h4>')[0];
    assert.ok(prowess.includes('Skirmish') && !prowess.includes('Command'));
  });

  it('renders stress as a track and trauma as pills', () => {
    const html = render(cutterBody());
    const stress = html.match(/<div class="fitd-tracker"><strong>Stress<\/strong>[\s\S]*?<\/div>/)[0];
    assert.strictEqual((stress.match(/fitd-dot filled/g) || []).length, 4);
    assert.strictEqual((stress.match(/fitd-dot/g) || []).length - 1, 9);   // the wrapper class also matches
    assert.ok(stress.includes('4 / 9'));
    const trauma = html.match(/<div class="fitd-tracker"><strong>Trauma<\/strong>[\s\S]*?<\/div>/)[0];
    assert.ok(trauma.includes('>Cold<') && trauma.includes('>Haunted<'));
  });

  it('shows harm, armor uses and XP', () => {
    const html = render(cutterBody());
    assert.ok(html.includes('Cracked ribs'));
    const armor = html.match(/<div class="fitd-tracker"><strong>Armor<\/strong>[\s\S]*?<\/div>/)[0];
    assert.match(armor, /fitd-box filled"[^>]*><\/span> Heavy/);
    assert.match(armor, /fitd-box"[^>]*><\/span> Armor/);
    assert.ok(html.includes('5 / 8'));
  });

  it('shows special abilities and stash', () => {
    const html = render(cutterBody());
    assert.ok(html.includes('Battleborn.'));
    assert.match(html, /<span class="stat-label">Coin<\/span><span class="stat-value">2</);
    assert.match(html, /<span class="stat-label">Stash<\/span><span class="stat-value">12 \/ 40</);
  });
});

describe('renderFitDSheet drops nothing from a consumed section', () => {
  const cases = {
    'a rating above four': b => setRow(b, 'Hunt', ['MARKER 5']),
    'a Notes column on an action': b => replace(b, '| Action | Rating |\n|--------|--------|\n| Hunt | 0 |', '| Action | Rating | Notes |\n|---|---|---|\n| Hunt | 0 | MARKER |'),
    'an action table with no attribute name over it': b => replace(b, '### Stress & Trauma', '| Action | Rating |\n|---|---|\n| MARKER Flow | 2 |\n\n### Stress & Trauma'),
    'prose under the action tables': b => replace(b, '### Stress & Trauma', 'MARKER attuned to the ghost field.\n\n### Stress & Trauma'),
    'a stress value that is not n / max': b => setRow(b, 'Stress', ['MARKER lots']),
    'an extra Stress & Trauma row': b => replace(b, '| Trauma | Cold, Haunted |', '| Trauma | Cold, Haunted |\n| MARKER Vice | Overindulged |'),
    'an armor cell that is not yes or no': b => setRow(b, 'Special', ['MARKER once']),
    'prose beside the Playbook line': b => replace(b, '**Playbook:** Cutter', '**Playbook:** Cutter\n\nMARKER crew: the Tallow Street crew.'),
    'an unknown subsection': b => replace(b, '## Background', '### Healing Clock\n\nMARKER 2 of 4.\n\n## Background'),
    'a repeated ### Harm': b => replace(b, '## Background', '### Harm\n\nMARKER old wound.\n\n## Background'),
    'a repeated ## Special Abilities': b => b + '\n## Special Abilities\n\nMARKER veteran.\n',
    'an extra column in Stash & Coin': b => replace(b, '| Attribute | Value |\n|-----------|-------|\n| Coin | 2 |', '| Attribute | Value | Notes |\n|---|---|---|\n| Coin | 2 | MARKER |'),
    'braces an author wrote': b => replace(b, '**Battleborn.**', '{MARKER} **Battleborn.**'),
    'a line wrapped under Playbook': b => replace(b, '**Playbook:** Cutter', '**Playbook:** Cutter\nMARKER upgrade pending.'),
    'bold prose that starts with Playbook': b => replace(b, '**Playbook:** Cutter', '**Playbook:** Cutter\n\n**Playbook** MARKER moves are overleaf.'),
    'an attribute name over an empty table': b => replace(b, '### Stress & Trauma', '**MARKER Luck**\n\n| Action | Rating |\n|---|---|\n\n### Stress & Trauma'),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`keeps ${name}`, () => {
      const html = render(mutate(cutterBody()));
      assert.ok(html.includes('MARKER'), 'the marker must reach the sheet');
      assert.strictEqual(dotsFor(html, 'Command'), 2, 'the rest of the sheet still renders');
    });
  }
});

describe('pcTemplate with a FitD sheet', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const sections = sectionsOf(cutterBody());
  const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);
  const build = (system, sheet) => pcTemplate(page, { html: '', relationships: '' }, sections, () => '', { siteTitle: 'S', footer: '' }, {}, undefined,
    { publishConfig: { system }, systemSheetHtml: sheet });

  it('drops the consumed sections and keeps the rest, for every alias', () => {
    for (const system of ['fitd', 'blades']) {
      const titles = accordionTitles(build(system, renderFitDSheet(page.frontmatter, sections)));
      for (const t of ['Stat Sheet', 'Special Abilities', 'Stash &amp; Coin']) assert.ok(!titles.includes(t), `${system}: ${t}`);
      for (const t of ['Background', 'Friends &amp; Rivals', 'Long-Term Projects', 'Notes']) assert.ok(titles.includes(t), `${system}: ${t}`);
    }
  });

  it('keeps every section when no sheet rendered', () => {
    assert.ok(accordionTitles(build('fitd', null)).includes('Stat Sheet'));
  });

  it('matches titles the way the renderer reads them', () => {
    assert.ok(isFitDConsumedTitle('Stash and Coin'));
    assert.ok(!isFitDConsumedTitle('Skills'));
  });
});

describe('renderFitDSheet frontmatter fallback', () => {
  it('renders action ratings as dots', () => {
    const html = renderFitDSheet({ type: 'pc', action_ratings: { insight: { hunt: 2, study: 0 }, prowess: { skirmish: 1 } } }, []);
    assert.ok(html.includes('fitd-action-ratings'));
    assert.strictEqual(dotsFor(html, 'hunt'), 2);
  });

  it('prefers the body ratings over frontmatter', () => {
    const html = render(cutterBody(), { type: 'pc', action_ratings: { insight: { FMONLY: 4 } } });
    assert.ok(!html.includes('FMONLY'));
  });

  it('renders stress and trauma', () => {
    const html = renderFitDSheet({ type: 'pc', stress: { current: 4, max: 9 }, trauma: ['Cold', 'Haunted'] }, []);
    assert.ok(html.includes('4 / 9'));
    assert.ok(html.includes('Haunted'));
  });

  it('renders special abilities as cards', () => {
    const html = renderFitDSheet({ type: 'pc', special_abilities: [{ name: 'Ghost Mind', description: 'x' }, 'Shadow'] }, []);
    assert.ok(html.includes('fitd-special-ability'));
    assert.ok(html.includes('Ghost Mind') && html.includes('Shadow'));
  });

  it('uses frontmatter abilities when the body section is unfilled', () => {
    assert.ok(render(blank(), { type: 'pc', special_abilities: ['FMABILITY'] }).includes('FMABILITY'));
  });

  it('survives malformed frontmatter', () => {
    const html = renderFitDSheet({ type: 'pc', action_ratings: { insight: null, prowess: 'x' }, stress: 3, special_abilities: 'Mule', load: 'heavy' }, []);
    assert.ok(html.includes('Mule'));
  });

  it('returns null when no FitD data present', () => {
    assert.strictEqual(renderFitDSheet({ type: 'pc' }, []), null);
  });
});

// tools/publish/test/integration/build-dnd.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

// #271: a D&D PC written to the template's body structure got no sheet at all.
describe('build integration — D&D PC', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  let outputDir, html;
  before(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-dnd-'));
    const configPath = path.join(outputDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: path.join(fixturesDir, 'with-dnd-pc'),
      outputDir: path.join(outputDir, 'docs'),
      attachmentsDir: '_attachments', siteTitle: 'D&D Test',
      system: 'dnd-5e-2024',
      excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }, null, 2));
    build({ configPath });
    html = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'pcs', 'ilse-varn.html'), 'utf-8');
  });
  after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const accordionTitles = () => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);

  it('renders the structured sheet', () => assert.ok(html.includes('class="dnd-sheet"')));
  it('renders the header', () => {
    assert.match(html, /<div class="dnd-header"><span>Level 3<\/span><span>Wizard \(Evoker\)<\/span><span>Elf<\/span><span>Sage<\/span><\/div>/);
  });
  it('renders the vitals', () => {
    assert.match(html, /<span class="stat-label">AC<\/span><span class="stat-value">12</);
    assert.match(html, /<span class="stat-label">HP<\/span><span class="stat-value">14 \/ 17</);
  });
  it('renders skills, spellcasting and proficiencies on the sheet', () => {
    assert.match(html, /class="dnd-skill is-proficient is-expert"[\s\S]*?Arcana/);
    assert.match(html, /<span class="stat-label">Spell Save DC<\/span><span class="stat-value">13</);
    assert.ok(html.includes('Misty Step, Scorching Ray'));
    assert.ok(html.includes('Common, Elvish, Draconic'));
  });
  it('does not repeat consumed sections as accordions', () => {
    const titles = accordionTitles();
    for (const t of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies']) assert.ok(!titles.includes(t), t);
  });
  it('keeps prose sections as accordions', () => {
    const titles = accordionTitles();
    for (const t of ['Background', 'Class Features', 'Species Traits', 'Feats', 'Notes']) assert.ok(titles.includes(t), t);
  });
  it('keeps equipment on its own tab', () => {
    const tab = html.split('id="tab-equipment"')[1].split('id="tab-story"')[0];
    assert.ok(tab.includes('Quarterstaff'));
  });
  it('withholds GM Notes', () => assert.ok(!html.includes('FIXTURE-GM-SECRET')));
});

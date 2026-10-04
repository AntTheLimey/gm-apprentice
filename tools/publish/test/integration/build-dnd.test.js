// tools/publish/test/integration/build-dnd.test.js
require('../helpers/quiet-legacy-warning.js');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const matter = require('gray-matter');
const { build } = require('../../lib/build');

// #271: a D&D PC written to the template's body structure got no sheet at all.
// The full sheet (1.13.0): vitals strip, Sheet, Combat, Spells and Equipment
// tabs, all read from the note, with nothing in a consumed section lost.
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const TEMPLATE = path.join(__dirname, '..', '..', '..', '..', 'skills', 'shared', 'templates', 'pc-dnd-5e-2024.md');
const PCS = ['brannoch-vale', 'ilse-varn', 'oriel-thackeray', 'tamsin-reed', 'dov-ashgrove', 'ilse-varn-old-layout'];
const CONSUMED = ['stat sheet', 'skills', 'spellcasting', 'proficiencies', 'class features', 'species traits', 'feats', 'equipment'];

const lf = s => s.replace(/\r\n/g, '\n');
const read = (...p) => lf(fs.readFileSync(path.join(...p), 'utf-8'));

describe('build integration — D&D PC', () => {
  let work, pages, notes;
  const pagesDir = () => path.join(work, 'docs', 'characters', 'pcs');
  const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-dnd-'));
    // A scratch vault: the fixtures, plus a non-caster whose note still carries
    // the template's empty Spellcasting section (the other half of "no spells").
    const vault = path.join(work, 'vault');
    fs.cpSync(path.join(FIXTURES, 'with-dnd-pc'), vault, { recursive: true });
    const templateSpellcasting = matter(read(TEMPLATE)).content.match(/## Spellcasting[\s\S]*?(?=## Proficiencies)/)[0];
    const dov = read(vault, 'Characters', 'PCs', 'Dov_Ashgrove.md');
    fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Empty_Caster.md'),
      dov.replace('## Proficiencies', `${templateSpellcasting}## Proficiencies`));
    const configPath = path.join(work, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault,
      outputDir: path.join(work, 'docs'),
      attachmentsDir: '_attachments', siteTitle: 'D&D Test',
      system: 'dnd-5e-2024',
      excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }, null, 2));
    build({ configPath });
    pages = {}; notes = {};
    for (const slug of [...PCS, 'empty-caster']) pages[slug] = fs.readFileSync(path.join(pagesDir(), `${slug}.html`), 'utf-8');
    for (const slug of PCS) {
      const file = slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('_') + '.md';
      notes[slug] = read(vault, 'Characters', 'PCs', file);
    }
  });
  after(() => fs.rmSync(work, { recursive: true, force: true }));

  it('every PC gets the new sheet, the vitals strip above the tab bar, and no dead controls', () => {
    for (const [slug, html] of Object.entries(pages)) {
      assert.ok(html.includes('dnd5e-tab-sheet'), slug);
      assert.ok(html.indexOf('dnd5e-vitals') < html.indexOf('class="tab-bar"'), slug);
      const sheetArea = html.split('class="dnd5e-vitals"')[1].split('id="tab-story"')[0];
      // The tab buttons and the accordion headers are the page's own; the sheet adds none.
      assert.ok(!/<button(?![^>]*class="(?:pc-tab|accordion-header))/.test(sheetArea), `${slug} has a control in the sheet`);
      assert.ok(!/<script/.test(sheetArea.split('id="tab-sheet"')[1] || ''), `${slug} runs script in the sheet`);
    }
  });

  it('the Combat and Equipment tabs exist, and the old Equipment accordion does not repeat them', () => {
    for (const [slug, html] of Object.entries(pages)) {
      assert.ok(html.includes('id="tab-combat"') && html.includes('id="tab-equipment"'), slug);
      assert.equal((html.match(/id="tab-equipment"/g) || []).length, 1, slug);
    }
    const gear = pages['ilse-varn'].split('id="tab-equipment"')[1].split('id="tab-story"')[0];
    assert.ok(gear.includes('Spellbook'));
    const combat = pages['ilse-varn'].split('id="tab-combat"')[1].split('id="tab-spells"')[0];
    assert.ok(combat.includes('Quarterstaff') && !gear.includes('Quarterstaff'));
  });

  it('a caster has a Spells tab and a non-caster has none', () => {
    for (const slug of ['brannoch-vale', 'ilse-varn', 'oriel-thackeray', 'tamsin-reed', 'ilse-varn-old-layout']) {
      assert.ok(pages[slug].includes('id="tab-spells"') && pages[slug].includes('data-tab="spells"'), slug);
    }
    assert.ok(!pages['dov-ashgrove'].includes('id="tab-spells"'));
    assert.ok(!pages['dov-ashgrove'].includes('data-tab="spells"'));
  });

  it('a PC carrying the template\'s empty Spellcasting section has no Spells tab and no empty block', () => {
    const html = pages['empty-caster'];
    assert.ok(read(path.join(work, 'vault', 'Characters', 'PCs', 'Empty_Caster.md')).includes('## Spellcasting'));
    assert.ok(!html.includes('id="tab-spells"'));
    assert.ok(!html.includes('data-tab="spells"'));
    assert.ok(!html.includes('dnd5e-tab-spells'));
    assert.ok(!html.includes('Omit this section'));
    assert.ok(!/Spell slots|Spellcasting Ability/.test(html), 'an empty spellcasting block reached the page');
    assert.ok(!accordionTitles(html).includes('Spellcasting'));
  });

  it('a caster\'s Spells tab holds the casting stats, the slots and the spells by level', () => {
    const spells = pages['brannoch-vale'].split('id="tab-spells"')[1].split('id="tab-equipment"')[0];
    assert.match(spells, /Spell Save DC<\/span><span class="dnd5e-num">14</);
    assert.match(spells, /Spell slots, 1st: 3 of 4 left/);
    assert.match(spells, /<h3>1st level<\/h3>/);
    assert.match(spells, /<h3>2nd level<\/h3>/);
    assert.ok(spells.includes('Zone of Truth'));
    const warlock = pages['oriel-thackeray'].split('id="tab-spells"')[1].split('id="tab-equipment"')[0];
    assert.match(warlock, /Spell slots, Pact \(3rd\): 1 of 2 left/);
    assert.match(warlock, /<h3>Cantrips<\/h3>/);
  });

  it('consumed sections are not repeated as accordions', () => {
    for (const [slug, html] of Object.entries(pages)) {
      const titles = accordionTitles(html).map(t => t.toLowerCase());
      for (const t of CONSUMED) assert.ok(!titles.includes(t), `${slug} repeats ${t}`);
    }
  });

  it('Background and Notes stay; GM Notes are withheld', () => {
    for (const [slug, html] of Object.entries(pages)) {
      const titles = accordionTitles(html);
      assert.ok(titles.includes('Background') && titles.includes('Notes'), slug);
      assert.ok(!html.includes('FIXTURE-GM-SECRET'), slug);
    }
  });

  it('shows the multiclass line, both hit dice rows and the pact slot as written', () => {
    const tamsin = pages['tamsin-reed'];
    assert.ok(tamsin.includes('Fighter 3 (Champion) / Wizard 2'));
    assert.match(tamsin, /Hit Dice d10: 2 of 3 left/);
    assert.match(tamsin, /Hit Dice d6: 2 of 2 left/);
    assert.ok(pages['oriel-thackeray'].includes('Fire'));
  });

  it('shows a hand-set AC with its reason, a pool over ten as a count, and a long item name whole', () => {
    assert.match(pages['dov-ashgrove'], /dnd5e-num" title="Unarmored Defense">16<\/span><span class="dnd5e-why">Unarmored Defense</);
    assert.match(pages['brannoch-vale'], /dnd5e-count"[^>]*><span class="dnd5e-num">18<\/span> \/ 25/);
    assert.ok(pages['dov-ashgrove'].includes('Brass prayer beads from a hilltop shrine'));
  });

  it('the old layout still publishes in full', () => {
    const html = pages['ilse-varn-old-layout'];
    for (const s of ['Misty Step, Scorching Ray', 'Common, Elvish, Draconic', 'Spellbook, satchel of index cards', 'Quarterstaff', 'Magic Initiate.', 'Darkvision, Fey Ancestry']) assert.ok(html.includes(s), s);
    assert.equal((html.match(/Misty Step, Scorching Ray/g) || []).length, 1);
  });

  it('a wikilinked gear name is an entry with a working link', () => {
    const tab = pages['tamsin-reed'].split('id="tab-equipment"')[1].split('id="tab-story"')[0];
    assert.match(tab, /dnd5e-entry-name"><a href="[^"]*ilse-varn\.html"[^>]*>Ilse Varn<\/a>/);
  });

  // The completeness gate: every non-blank table cell and every prose line of
  // every consumed section of the note is on the built page.
  describe('nothing in the note is lost', () => {
    const decode = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()];
    });
    // Text compared without markdown emphasis, wikilink brackets, tags, case or punctuation (signs kept).
    const norm = s => decode(String(s))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, (m, bar, name) => name.replace(/_/g, ' ')) // the page shows a stem humanised
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/[^\p{L}\p{N}+-]+/gu, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
    const pageText = html => decode(html.split('class="dnd5e-vitals"')[1].split('id="tab-story"')[0].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
    const pageRaw = html => html.split('class="dnd5e-vitals"')[1].split('id="tab-story"')[0];

    const SKIP = /^(yes|no|—|-|–|)$/i;
    const cellsOf = line => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

    // Returns { tokens: [text...], raw: [exact strings the markup carries instead] }.
    function noteTokens(markdown, consumedTitles) {
      const tokens = []; const raw = [];
      let section = ''; let sub = ''; let header = null; let expectSep = false;
      const add = (...cells) => { for (const c of cells) { const n = norm(c); if (!SKIP.test(n) && !/^\{[^}]*\}$/.test(String(c).trim())) tokens.push(n); } };
      for (const line of markdown.split('\n')) {
        const h2 = line.match(/^## (.+?)\s*$/);
        const h3 = line.match(/^### (.+?)\s*$/);
        if (h2) { section = h2[1].toLowerCase(); sub = ''; header = null; continue; }
        if (h3) { sub = h3[1].toLowerCase(); header = null; continue; }
        if (!consumedTitles.includes(section)) continue;
        if (/^\s*\|/.test(line)) {
          const c = cellsOf(line);
          if (header === null) { header = c; expectSep = true; if (header[0] === 'CP') add(...c); continue; }
          if (expectSep) { expectSep = false; continue; }
          const h0 = header[0].toLowerCase(); const h1 = (header[1] || '').toLowerCase();
          if (h0 === 'level' && h1 === 'total') { // spell slots are drawn as marks
            const [level, total, spent] = c;
            if (total) raw.push(`Spell slots, ${level}: ${+total - (+spent || 0)} of ${total} left`);
          } else if (h0 === 'name' && h1 === 'action') { // features: Uses/Used are drawn as marks or a count
            const [name, action, uses, used, recovers, summary] = c;
            add(name, action, recovers, summary);
            if (uses && +uses > 10) tokens.push(norm(`${+uses - (+used || 0)} / ${uses}`));
            else if (uses) raw.push(`${name}: ${+uses - (+used || 0)} of ${uses} left`);
          } else if (h0 === 'spell') { // the level is a heading; C and R are spelled out
            const [name, level, time, range, comps, duration, hit, tags, summary] = c;
            add(name, time, range, comps, duration, hit, summary);
            for (const t of tags.split(',').map(x => x.trim()).filter(Boolean)) add(t === 'C' ? 'Concentration' : t === 'R' ? 'Ritual' : t);
            const n = /^cantrip/i.test(level) ? 0 : parseInt(level, 10);
            add(n === 0 ? 'Cantrips' : `${n}${['', 'st', 'nd', 'rd'][n] || 'th'} level`);
          } else if (h0 === 'item') { // a quantity above one is a tag
            const [item, qty, notes] = c;
            add(item, notes);
            if (qty && qty !== '1') raw.push(`× ${qty}`);
          } else if (h0 === 'slot') { add(c[1]); }
          else if (h0 === 'attribute') { // Core, Combat and the rest: the label is the template's, the value is the note's
            const [label, value] = c;
            if (sub === 'senses' || section === 'spellcasting') add(label);
            if (/^hit dice/i.test(label)) {
              const m = value.match(/^(\d+)\s*\/\s*(\d+)$/);
              if (m) raw.push(`${label.replace(/\s*\(\s*spent\s*\/\s*max\s*\)\s*$/i, '')}: ${+m[2] - +m[1]} of ${m[2]} left`); else add(value);
            } else if (/^death saves/i.test(label)) {
              const m = value.match(/^(\d+)\s*\/\s*(\d+)$/);
              if (m) raw.push(`Death saves made: ${m[1]} of 3 left`, `Death saves failed: ${m[2]} of 3 left`); else add(value);
            } else if (/^temp hp$/i.test(label) && /^0+$/.test(value)) { /* a plain zero is not drawn */ }
            else add(value);
          } else if (h0 === 'ability') { add(c[0], c[1], c[2], c[4] || ''); }
          else add(...c);
          continue;
        }
        header = null;
        const t = line.trim();
        if (!t || /^>/.test(t) || /^[-*]{3,}$/.test(t)) continue; // blanks, the template's own blockquote note
        const labelled = t.match(/^\*\*([^*]+?):?\*\*:?\s*(.*)$/);
        if (labelled) add(labelled[1], labelled[2]); else add(t);
      }
      return { tokens, raw };
    }

    for (const slug of PCS) {
      it(slug, () => {
        const { tokens, raw } = noteTokens(notes[slug], CONSUMED);
        assert.ok(tokens.length > 30, 'the gate must actually read the note');
        const text = norm(pageText(pages[slug]));
        const missing = tokens.filter(t => !text.includes(t));
        assert.deepEqual(missing, [], `${slug}: lost from the page`);
        const html = pageRaw(pages[slug]);
        // aria-labels keep the typographer's curly quotes, as the visible text does
        const marks = decode(html).replace(/[\u2018\u2019]/g, "'");
        const missingRaw = raw.filter(r => !marks.includes(r));
        assert.deepEqual(missingRaw, [], `${slug}: drawn marks missing`);
      });
    }
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../../css/style.css'), 'utf8');
const lib = path.join(__dirname, '../../../lib/templates/dnd');
const sources = [...fs.readdirSync(lib), ...fs.readdirSync(path.join(lib, 'blocks')).map(f => 'blocks/' + f)]
  .filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(lib, f), 'utf8')).join('\n');

describe('D&D sheet styles', () => {
  it('every dnd5e class the renderer writes has a rule', () => {
    const used = new Set([...sources.matchAll(/dnd5e-[a-z0-9-]+/g)].map(m => m[0]));
    // Modifier-built names: `dnd5e-blk-${key}`, `dnd5e-tab-${name}` need no rule of their own.
    const missing = [...used].filter(c => !/^dnd5e-(blk|tab)-/.test(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(missing, []);
  });
  it('the pieces that carry a note\'s own words wrap a long unbroken word', () => {
    // A rule that lists the class and sets overflow-wrap; selectors are split on commas.
    const wraps = cls => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .some(([, sel, body]) => sel.split(',').some(x => x.trim() === cls) && /overflow-wrap:\s*anywhere/.test(body));
    for (const c of ['.dnd5e-entry-name', '.dnd5e-tag', '.dnd5e-entry-text', '.dnd5e-v', '.dnd5e-why', '.dnd5e-recovers', '.dnd5e-skill-name', '.dnd5e-chip']) assert.ok(wraps(c), c);
  });
  it('uses only the site tokens for colour', () => {
    const block = css.slice(css.indexOf('.dnd5e-'), css.indexOf('/* PF2e */'));
    assert.ok(block.length > 500);
    assert.deepEqual(block.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
  });
  it('the existing .dnd- rules Pathfinder uses are still there', () => {
    for (const c of ['.dnd-sheet', '.dnd-ability-card', '.dnd-skill', '.dnd-header']) assert.ok(css.includes(c + ' '), c);
  });
});

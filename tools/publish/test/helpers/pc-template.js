// Build a PC body from a real skill template, so a sheet renderer and its
// template cannot drift apart (#271, #272).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { extractSections } = require('../../lib/processor');

const TEMPLATES = path.join(__dirname, '../../../../skills/shared/templates');

function templateBody(name) {
  // A Windows checkout has CRLF line endings; the mutations below match on \n.
  return matter(fs.readFileSync(path.join(TEMPLATES, name), 'utf8')).content.replace(/\r\n/g, '\n');
}

// Replace one table row, found by its first cell, with new cells.
function setRow(body, first, cells) {
  const re = new RegExp(`^\\| ${first.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\|.*$`, 'm');
  assert.ok(re.test(body), `template has no "${first}" row`);
  return body.replace(re, `| ${[first, ...cells].join(' | ')} |`);
}

function replace(body, from, to) {
  assert.ok(body.includes(from), `template has no "${from}"`);
  return body.replace(from, to);
}

const sectionsOf = body => extractSections(body);

// A 2nd-level druid, filled in the way a GM fills the template.
function druidBody() {
  let b = templateBody('pc-pf2e.md');
  b = setRow(b, 'Level', ['2']);
  b = setRow(b, 'Hero Points', ['2']);
  b = setRow(b, 'Class DC', ['18']);
  b = setRow(b, 'STR', ['+0']);
  b = setRow(b, 'DEX', ['+2']);
  b = setRow(b, 'WIS', ['+4']);
  b = setRow(b, 'CHA', ['-1']);
  b = setRow(b, 'AC', ['17']);
  b = setRow(b, 'HP (Current)', ['20']);
  b = setRow(b, 'HP (Max)', ['26']);
  b = setRow(b, 'Will', ['+10 (Expert)']);
  b = setRow(b, 'Nature', ['WIS', 'E', '+10']);
  b = setRow(b, 'Medicine', ['WIS', 'Trained', '+8']);
  b = setRow(b, 'Tradition', ['Primal']);
  b = setRow(b, 'Prepared / Spontaneous', ['Prepared']);
  b = setRow(b, 'Spell Attack Modifier', ['+8']);
  b = setRow(b, 'Spell DC', ['18']);
  b = setRow(b, '1', ['3', '1']);
  b = replace(b, '| Focus Points (Current/Max) | |', '| Focus Points (Current/Max) | 1/1 |');
  b = replace(b, '{Focus spell list, if any.}', 'Cornucopia');
  b = replace(b, '**Ancestry:** {Ancestry name}', '**Ancestry:** Elf');
  b = replace(b, '**Heritage:** {Heritage name}', '**Heritage:** Woodland Elf');
  b = replace(b, '**Background:** {Background name}', '**Background:** Herbalist');
  b = replace(b, '**Class/Subclass:** {Class (subclass choice — doctrine, muse, instinct, etc.)}', '**Class/Subclass:** Druid (Leaf)');
  b = replace(b, '**Cantrips:** {list}', '**Cantrips:** Electric Arc, Tangle Vine');
  b = replace(b, '**Rank 1:** {list}', '**Rank 1:** Heal, Gust of Wind');
  b = replace(b, '**Languages:** {list}', '**Languages:** Common, Elven, Fey');
  return b;
}

// A scoundrel a few scores in, filled in the way a GM fills the template.
function cutterBody() {
  let b = templateBody('pc-fitd.md');
  b = replace(b, '**Playbook:** {Playbook name}', '**Playbook:** Cutter');
  b = setRow(b, 'Skirmish', ['3']);
  b = setRow(b, 'Wreck', ['1']);
  b = setRow(b, 'Command', ['2']);
  b = setRow(b, 'Stress', ['4 / 9']);
  b = setRow(b, 'Trauma', ['Cold, Haunted']);
  b = setRow(b, '2 (Serious)', ['Cracked ribs', '']);
  b = setRow(b, 'Heavy', ['Yes']);
  b = replace(b, '**Playbook XP:** 0 / 8', '**Playbook XP:** 5 / 8');
  b = replace(b, '**Heritage:** {Heritage}', '**Heritage:** Marrow Coast');
  b = replace(b, '**Background:** {Background}', '**Background:** Labor');
  b = replace(b, '**Vice/Purveyor:** {Vice type — Purveyor name}', '**Vice/Purveyor:** Obligation — the old crew');
  b = replace(b, '{Selected special abilities from playbook list.}', '**Battleborn.** Reduce harm when you resist in a fight.');
  b = setRow(b, 'Coin', ['2']);
  b = setRow(b, 'Stash', ['12 / 40']);
  return b;
}


module.exports = { templateBody, setRow, replace, sectionsOf, druidBody, cutterBody };

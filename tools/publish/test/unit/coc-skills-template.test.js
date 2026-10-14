// The PC templates and the sheet's skill lists name the same skills at the same bases (#366): the sheet's list in
// skills-data.js is the one source, and this test keeps the shipped templates to it.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { REGENCY_SKILLS, BASE_SKILLS } = require('../../lib/templates/coc/skills-data');
const { baseText } = require('../../lib/templates/coc/skills');

const templatesDir = path.join(__dirname, '../../../../skills/shared/templates');

function templateRows(file) {
  const text = fs.readFileSync(path.join(templatesDir, file), 'utf8');
  const section = text.split(/^## Skills\s*$/m)[1].split(/^## /m)[0];
  const rows = [];
  for (const m of section.matchAll(/^\|([^|]*)\|([^|]*)\|/gm)) {
    const name = m[1].trim().replace(/\s*\(\s*\)$/, '');
    if (!name || /^skill$/i.test(name) || /^-+$/.test(name)) continue;
    rows.push([name, m[2].trim()]);
  }
  return rows;
}

for (const [file, list] of [['pc-coc-7e-regency.md', REGENCY_SKILLS], ['pc-coc-7e.md', BASE_SKILLS]]) {
  describe(`${file} and the sheet's skill list`, () => {
    it('list the same skills, in the same order, at the same bases', () => {
      const expected = list.map((s) => [s.name, baseText(s)]);
      const got = templateRows(file).map(([name, base]) => [name, /^\d+$/.test(base) ? String(Number(base)) : base]);
      assert.deepEqual(got, expected);
    });
  });
}

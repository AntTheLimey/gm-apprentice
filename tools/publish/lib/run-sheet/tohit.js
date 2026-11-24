'use strict';
// The GURPS to-hit calculator on the run sheet's GM page (step 6b Task 24, D7, D8, D8b): the data block a PC's
// sheet gives, read as the site build reads it (parseGurps, extractSections, buildTohitData), or the one-row block a
// typed skill gives, through the same builder, so no weapon is shaped by hand; and the calculator's stylesheet as
// the table server serves it, with the narrow layout copied out of its window query onto a class on the box.
// Not gated by player_site.features.tohit_calculator (D7): that switch decides what the published site carries.

const { extractSections } = require('../processor');
const { parseGurps } = require('../templates/gurps/parse');
const { buildTohitData } = require('../templates/gurps/tohit-data');
const { statements, splitSelectors } = require('../color-mode');

// A PC's data block, or null when the sheet has no attack the calculator can use. `meta` is the site build's:
// { campaignId, pcSlug } (the calculator's own memory key is the page's, not these).
function pcTohit(index, pcNote, meta = {}) {
  if (!index || !index.has(pcNote)) return null;
  const { fm, body } = index.read(pcNote);
  const text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
  const model = parseGurps(fm || {}, extractSections(text));
  return buildTohitData(model, meta);
}

// The levels a typed skill takes: the builder reads a Skill cell's level as a whole number from 1 to 99, so
// anything else would be read as another number than the one typed (12.5 as 12 shown as 5, -3 as 3).
const LEVEL_MIN = 1;
const LEVEL_MAX = 99;
const TYPED_NAME = 'Typed skill';
const NAME_MAX = 60;

// A typed skill's data block: one Melee or Ranged Attacks row whose Skill cell is the level. Throws, with words
// for the GM, on a level that is not a whole number the builder reads as typed. The builder's report (it calls a
// bare number a fault on a sheet) is never asked for: a typed skill is no sheet [D8].
function typedTohit({ name, type, level } = {}) {
  const t = type === 'ranged' ? 'ranged' : type === 'melee' ? 'melee' : null;
  if (!t) throw new Error('the type is melee or ranged');
  const n = typeof level === 'number' ? level : typeof level === 'string' && /^\s*\d+\s*$/.test(level) ? Number(level) : NaN;
  if (!Number.isInteger(n) || n < LEVEL_MIN || n > LEVEL_MAX) throw new Error(`the level is a whole number from ${LEVEL_MIN} to ${LEVEL_MAX}`);
  const named = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  // a name the builder would read as a split link or a sheet marker is said plainly
  const weapon = named.replace(/[[\]|*◇◆†‡]/g, '').trim() || TYPED_NAME;
  return buildTohitData({ [t]: [{ weapon, skill: String(n) }] }, { pcSlug: 'typed', campaignId: '' });
}

// The window query the narrow layout is written under in css/tohit.css.
const NARROW_MEDIA = '@media (max-width: 780px)';

// The `.tohit.th-narrow` copy of the 780 px block (D8b, B2): each rule's selector `.tohit X` as `.tohit.th-narrow X`,
// its declarations as written, the media wrapper dropped. Plain CSS cannot put one rule body under a query and a
// class, so the rules are written once and copied here.
function narrowCopy(css) {
  const block = statements(String(css).replace(/\r\n/g, '\n')).find((s) => s.kind === 'at' && s.prelude === NARROW_MEDIA);
  if (!block) throw new Error(`css/tohit.css has no ${NARROW_MEDIA} block`);
  const out = [];
  for (const st of statements(block.body)) {
    if (st.kind !== 'rule') continue;
    const sels = splitSelectors(st.prelude).map((s) => {
      if (!/^\.tohit\b/.test(s)) throw new Error(`a narrow rule not on the calculator's box: ${s}`);
      return s.replace(/^\.tohit\b/, '.tohit.th-narrow');
    });
    out.push(`${sels.join(', ')} {${st.body}}`);
  }
  return out.join('\n') + '\n';
}

// The stylesheet the GM page loads: css/tohit.css as it is, then its narrow copy.
function servedCss(css) {
  return `${css}\n/* The narrow layout on a class (the run sheet's dialog), copied from the ${NARROW_MEDIA} block above */\n${narrowCopy(css)}`;
}

module.exports = { pcTohit, typedTohit, narrowCopy, servedCss, NARROW_MEDIA, TYPED_NAME, LEVEL_MIN, LEVEL_MAX };

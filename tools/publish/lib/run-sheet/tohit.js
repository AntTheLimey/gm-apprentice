'use strict';
// The GURPS to-hit calculator on the run sheet's GM page (step 6b Task 24, D7, D8, D8b): the data block a PC's
// sheet gives, read as the site build reads it (parseGurps, extractSections, buildTohitData), or the one-row block a
// typed skill gives, through the same builder, so no weapon is shaped by hand; and the calculator's stylesheet as
// the table server serves it, with the narrow layout copied out of its window query onto a class on the box.
// Not gated by player_site.features.tohit_calculator (D7): that switch decides what the published site carries.

const { statements, splitSelectors } = require('../color-mode');

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

module.exports = { narrowCopy, servedCss, NARROW_MEDIA };

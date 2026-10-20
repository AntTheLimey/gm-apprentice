'use strict';
// A vault holding the Connections drawings that once looked wrong (#343): one name, groups of one, a very long
// subject, a tab of 25 groups, a tall tab, a "(named by)" label and a long name. The browser test builds it; so can
// a person who wants to look at the pages. Every page is in Characters/ (characters/<slug>.html on the site).
const LONG_NAME = 'Lady Wilhelmina Augusta Fenwick-Hartley of Lower Bramblecombe';
const SUBJECT_90 = 'Mr Bartholomew Fitzwilliam-Throckmorton of the Upper Hawthorne Grange Estate and Surrounds';
const SUBJECT_315 = `${SUBJECT_90} ${SUBJECT_90} ${SUBJECT_90} the Third, Keeper of the Keys`;

const note = (rels, extra = '') => `---\ntype: npc\n${extra}${rels.length ? `relationships:\n${rels.map(([to, type]) => `  - target: "[[${to}]]"\n    type: ${type}\n`).join('')}` : ''}---\nA person.\n`;
const people = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(2, '0')}`);

function connectionsCases() {
  const files = {};
  const add = (name, rels, extra) => { files[`Characters/${name}.md`] = note(rels, extra); };
  const others = new Set();
  const rel = (list) => { list.forEach(([to]) => others.add(to)); return list; };

  add('Lone', rel([['Ann Lowe', 'ally']]));
  add('Smalls', rel([['Bo Small', 'ally'], ['Cy Small', 'enemy'], ['Di Small', 'rival'], ['Ed Small', 'knows'],
    ...people('Staff', 6).map((p) => [p, 'employs'])]));
  add('Long90', rel([['Fay One', 'ally'], ['Gil Two', 'enemy'], ['Hal Three', 'knows'], ['Ivy Four', 'knows'], ['Jo Five', 'rival']]), `title: "${SUBJECT_90}"\n`);
  add('Long315', rel([['Fay One', 'ally'], ['Gil Two', 'enemy'], ['Hal Three', 'knows'], ['Ivy Four', 'knows'], ['Jo Five', 'rival']]), `title: "${SUBJECT_315}"\n`);
  // 25 kinds of tie the vocabulary does not hold, one or two names each: 25 groups in one tab.
  add('Crowd', rel(Array.from({ length: 25 }, (_, g) => [`Crowd ${String(g + 1).padStart(2, '0')}`, `tie_${String.fromCharCode(97 + g)}${String.fromCharCode(97 + g)}`])));
  add('Tall', rel([...people('Friend', 14).map((p) => [p, 'ally']), ...people('Foe', 14).map((p) => [p, 'enemy'])]));
  // The page that is named: the ties are written on the other notes, so its own groups read "(named by)".
  add('Named', []);
  for (const p of people('Caller', 3)) add(p, [['Named', 'contact_of']]);
  add('Wide', rel([[LONG_NAME, 'ally'], ['Kit Short', 'knows']]));
  for (const o of others) if (!files[`Characters/${o}.md`]) add(o, []);
  return files;
}

module.exports = { connectionsCases, LONG_NAME, SUBJECT_90, SUBJECT_315 };

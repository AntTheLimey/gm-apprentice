const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

const PRIMARY = ['ST', 'DX', 'IQ', 'HT'];
const SECONDARY_ORDER = ['HP', 'Will', 'Per', 'FP', 'Basic Speed', 'Basic Move'];
const DERIVED_LABELS = {
  'Basic Lift': 'BL',
  'Damage (Thr)': 'Thr',
  'Damage (Sw)': 'Sw',
  'Size Modifier': 'SM',
  'TL': 'TL',
};

function renderAttributes(model) {
  const a = model.attributes || {};
  const prim = a.primary || {};
  const sec = a.secondary || {};
  const der = a.derived || {};
  if (Object.keys(prim).length === 0 && Object.keys(sec).length === 0) return null;

  // PRIMARY: 4 large boxes with value and cost
  const cards = PRIMARY.filter(k => prim[k]).map(k => {
    const c = prim[k];
    const costHtml = c.cost ? `<div class="p">[${escapeHtml(c.cost)}]</div>` : '';
    const fnMark = c.markers && c.markers.length ? '<sup class="fn">*</sup>' : '';
    return `<div class="a"><div class="v">${escapeHtml(c.value)}${fnMark}</div><div class="l">${k}</div>${costHtml}</div>`;
  }).join('');

  // SECONDARY: ordered subset of secondary chars
  const secEntries = SECONDARY_ORDER.filter(k => sec[k]);
  // Also add any secondary keys not in SECONDARY_ORDER (catch-all)
  for (const k of Object.keys(sec)) {
    if (!SECONDARY_ORDER.includes(k)) secEntries.push(k);
  }
  const secCards = secEntries.map(k => {
    const c = sec[k];
    return `<div class="a"><div class="v">${escapeHtml(c.value)}</div><div class="l">${escapeHtml(k)}</div></div>`;
  }).join('');

  // DERIVED: compact strip
  const derivedSpans = Object.entries(der).map(([k, c]) => {
    const label = DERIVED_LABELS[k] || k;
    return `<span><span class="der-label">${escapeHtml(label)}</span> ${escapeHtml(c.value)}</span>`;
  });
  // Also include legacy bl/thrust/swing/dodge fields if present
  if (a.bl && !der['Basic Lift']) derivedSpans.unshift(`<span><span class="der-label">BL</span> ${escapeHtml(String(a.bl))}</span>`);
  if (a.thrust) derivedSpans.push(`<span><span class="der-label">Thr</span> ${escapeHtml(String(a.thrust))}</span>`);
  if (a.swing) derivedSpans.push(`<span><span class="der-label">Sw</span> ${escapeHtml(String(a.swing))}</span>`);
  if (a.dodge) derivedSpans.push(`<span><span class="der-label">Dodge</span> ${escapeHtml(String(a.dodge))}</span>`);

  const inner =
    `<div class="attrgrid">${cards}</div>` +
    (secCards ? `<div class="attr-sublabel">Secondary</div><div class="subgrid">${secCards}</div>` : '') +
    (derivedSpans.length ? `<div class="attr-sublabel">Derived</div><div class="derived">${derivedSpans.join('')}</div>` : '');

  return block('attr', 'Attributes', inner);
}

module.exports = { renderAttributes };
